import * as THREE from 'three';
import type { Rig } from './skeleton';
import type { PhysicsWorld } from '../core/physics';

/**
 * Verlet ragdoll: a real simulation, not a canned fall.
 *
 * Thirteen point masses sit at the joints, joined by distance constraints
 * along the bones plus a few braces that stand in for the torso's stiffness.
 * Gravity, damping, ground contact and friction act on the points; a handful
 * of relaxation passes per step keeps the limbs the right length. The rig is
 * then driven from the result — every bone aims at the point that follows it —
 * so the body finds its own way onto the ground, drapes over whatever it lands
 * on, and never dies the same way twice.
 *
 * Positions only ever rotate bones; the skeleton stays connected by
 * construction, so the sim can drift a little without tearing the character
 * apart. Only the hips are placed outright, as the root of the chain.
 */

const HEAD = 0, CHEST = 1, HIPS = 2;
const SHL = 3, ELL = 4, HAL = 5;
const SHR = 6, ELR = 7, HAR = 8;
const KNL = 9, FTL = 10;
const KNR = 11, FTR = 12;
const COUNT = 13;

/** which rig bone each point is seeded from */
const SEED_BONE: string[] = [];
SEED_BONE[HEAD] = 'head'; SEED_BONE[CHEST] = 'chest'; SEED_BONE[HIPS] = 'hips';
SEED_BONE[SHL] = 'upperArmL'; SEED_BONE[ELL] = 'forearmL'; SEED_BONE[HAL] = 'handL';
SEED_BONE[SHR] = 'upperArmR'; SEED_BONE[ELR] = 'forearmR'; SEED_BONE[HAR] = 'handR';
SEED_BONE[KNL] = 'lowerLegL'; SEED_BONE[FTL] = 'footL';
SEED_BONE[KNR] = 'lowerLegR'; SEED_BONE[FTR] = 'footR';

/** [a, b, stiffness] — bone links are rigid, braces give the torso its shape */
const LINKS: [number, number, number][] = [
  [HIPS, CHEST, 1], [CHEST, HEAD, 1],
  [CHEST, SHL, 1], [SHL, ELL, 1], [ELL, HAL, 1],
  [CHEST, SHR, 1], [SHR, ELR, 1], [ELR, HAR, 1],
  [HIPS, KNL, 1], [KNL, FTL, 1],
  [HIPS, KNR, 1], [KNR, FTR, 1],
  // braces: a chain of pure bone links folds flat like wet rope
  [SHL, SHR, 0.9], [HIPS, SHL, 0.7], [HIPS, SHR, 0.7], [HIPS, HEAD, 0.35],
  [HEAD, SHL, 0.4], [HEAD, SHR, 0.4], [KNL, KNR, 0.15], [FTL, FTR, 0.1],
];

/**
 * Bones driven by aiming at a following point. `axis` is the direction in the
 * bone's own space that should end up pointing at `to`: limbs hang down -Y,
 * the spine and neck run up +Y.
 */
const DRIVE: { bone: string; from: number; to: number; axis: THREE.Vector3 }[] = [
  { bone: 'hips', from: HIPS, to: CHEST, axis: new THREE.Vector3(0, 1, 0) },
  { bone: 'neck', from: CHEST, to: HEAD, axis: new THREE.Vector3(0, 1, 0) },
  { bone: 'upperArmL', from: SHL, to: ELL, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'forearmL', from: ELL, to: HAL, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'upperArmR', from: SHR, to: ELR, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'forearmR', from: ELR, to: HAR, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'upperLegL', from: HIPS, to: KNL, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'lowerLegL', from: KNL, to: FTL, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'upperLegR', from: HIPS, to: KNR, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'lowerLegR', from: KNR, to: FTR, axis: new THREE.Vector3(0, -1, 0) },
];

/** bones the sim has no opinion about — straightened so they don't keep a pose */
const RELAX = ['spine', 'chest', 'head', 'shoulderL', 'shoulderR', 'footL', 'footR'];

const GRAVITY = 20;
const DAMPING = 0.992;
const GROUND_FRICTION = 0.62;
const BOUNCE = 0.12;
const STEP = 1 / 90;
const ITERATIONS = 7;

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

export class Ragdoll {
  private pos: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private radius: number[] = [];
  private rest: number[] = [];
  private accum = 0;
  /** false once every point has gone quiet — the sim can stop being stepped */
  active = true;

  /**
   * @param impulse  velocity added to the body at the moment it dies; the
   *   upper body takes more of it, which is what makes a shot spin the corpse
   *   instead of sliding it
   */
  constructor(private rig: Rig, velocity: THREE.Vector3, impulse: THREE.Vector3) {
    rig.root.updateMatrixWorld(true);
    for (let i = 0; i < COUNT; i++) {
      const bone = rig.bones[SEED_BONE[i] as keyof typeof rig.bones];
      const p = new THREE.Vector3();
      bone.getWorldPosition(p);
      this.pos.push(p);
      // upper body catches more of the hit, so the body turns as it falls
      const share = i === HEAD || i === CHEST || i === SHL || i === SHR ? 1.35 : 0.55;
      _v.copy(velocity).addScaledVector(impulse, share);
      this.prev.push(p.clone().addScaledVector(_v, -STEP));
      this.radius.push(i === HEAD ? 0.13 : i === CHEST || i === HIPS ? 0.15 : 0.08);
    }
    for (const [a, b] of LINKS) this.rest.push(this.pos[a].distanceTo(this.pos[b]));
  }

  /** Where the body is now, for anything still tracking the corpse. */
  get hips(): THREE.Vector3 { return this.pos[HIPS]; }

  /** Slide the whole body, used to sink a corpse away once it has settled. */
  translate(dy: number): void {
    for (let i = 0; i < COUNT; i++) { this.pos[i].y += dy; this.prev[i].y += dy; }
  }

  step(dt: number, physics: PhysicsWorld): void {
    // fixed substeps: Verlet with a variable dt changes stiffness frame to frame
    this.accum = Math.min(this.accum + dt, 0.1);
    // a settled corpse stops simulating: nothing can wake it, and leaving it
    // integrating only lets round-off jitter it
    while (this.active && this.accum >= STEP) {
      this.accum -= STEP;
      this.integrate(STEP);
      for (let n = 0; n < ITERATIONS; n++) {
        this.solveLinks();
        this.collide(physics);
      }
    }
    this.driveRig();
  }

  private integrate(dt: number): void {
    let moving = false;
    for (let i = 0; i < COUNT; i++) {
      const p = this.pos[i], q = this.prev[i];
      _v.copy(p).sub(q).multiplyScalar(DAMPING);
      if (_v.lengthSq() > 1e-6) moving = true;
      q.copy(p);
      p.add(_v);
      p.y -= GRAVITY * dt * dt;
    }
    this.active = moving;
  }

  private solveLinks(): void {
    for (let i = 0; i < LINKS.length; i++) {
      const [a, b, stiff] = LINKS[i];
      const pa = this.pos[a], pb = this.pos[b];
      _dir.copy(pb).sub(pa);
      const d = _dir.length();
      if (d < 1e-6) continue;
      const diff = ((d - this.rest[i]) / d) * 0.5 * stiff;
      _dir.multiplyScalar(diff);
      pa.add(_dir);
      pb.sub(_dir);
    }
  }

  private collide(physics: PhysicsWorld): void {
    for (let i = 0; i < COUNT; i++) {
      const p = this.pos[i];
      const g = physics.groundHeight(p.x, p.z, p.y);
      if (g === -Infinity) continue;
      const floor = g + this.radius[i];
      if (p.y >= floor) continue;
      const q = this.prev[i];
      p.y = floor;
      // friction bleeds the horizontal slide, and the little bounce left keeps
      // a body from looking glued the instant it touches down
      const vy = p.y - q.y;
      q.x += (p.x - q.x) * GROUND_FRICTION;
      q.z += (p.z - q.z) * GROUND_FRICTION;
      q.y = p.y + vy * BOUNCE;
    }
  }

  /** Aim every driven bone at the point that follows it. */
  private driveRig(): void {
    const b = this.rig.bones;
    // Place the body with the root and leave the hips bone at its rest offset.
    //
    // Writing the corpse's world position straight onto the hips bone (with the
    // root parked at the origin) worked for the procedural skin, but never
    // reached an authored one: that model hangs off this same root and is
    // driven by bone *rotations* plus the hips' vertical bob, so the world X/Z
    // stayed behind on the procedural skeleton and the visible body rendered
    // back at the map origin. Carrying the placement on the root reaches both.
    // The root's scale is the character's bulk, so the hip offset is in its
    // units; rotations are unaffected by a uniform scale.
    const rest = this.rig.proportions.hipHeight;
    this.rig.root.position.copy(this.pos[HIPS]);
    this.rig.root.position.y -= rest * (this.rig.root.scale.y || 1);
    this.rig.root.quaternion.identity();
    for (const name of RELAX) b[name as keyof typeof b]?.quaternion.identity();
    // rest, not zero: the authored retarget reads this bone's height as the
    // clips' vertical bob and would sink the model by a hip's worth otherwise
    b.hips.position.set(0, rest, 0);
    this.rig.root.updateMatrixWorld(true);
    for (const d of DRIVE) {
      const bone = b[d.bone as keyof typeof b];
      if (!bone) continue;
      _dir.copy(this.pos[d.to]).sub(this.pos[d.from]);
      if (_dir.lengthSq() < 1e-8) continue;
      _dir.normalize();
      _q.setFromUnitVectors(d.axis, _dir);            // world rotation we want
      bone.parent?.getWorldQuaternion(_pq);
      bone.quaternion.copy(_pq.invert()).multiply(_q); // back into parent space
      bone.updateMatrixWorld(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Rigless bodies: the same simulation, one rigid piece
// ---------------------------------------------------------------------------

/**
 * Ragdoll for a creature that is not on our canonical skeleton — the krykna,
 * the massiff, the drone. They have no named bones to hang the articulated
 * solver on, and the canned tip-onto-the-flank they used to get read as a
 * scripted animation: a spider always fell the same way, never off a ledge,
 * never onto the crate it died on.
 *
 * This is the same Verlet world as `Ragdoll`, with the constraint solver
 * replaced by shape matching: eight points at the corners of the body's box
 * fall, hit things and lose energy independently, then every iteration the
 * cloud is snapped back to the rigid shape it started as, rotated to fit
 * wherever the corners have got to. What comes out is a body that tumbles,
 * bounces off its corners, comes to rest against whatever it fell against, and
 * drops off a platform edge if it dies on one — with the body itself, not a
 * skeleton, as the thing being simulated.
 *
 * The rotation is recovered with Müller's iterative polar decomposition, which
 * is a handful of cross products per step and needs no matrix library.
 */
export class RigidRagdoll {
  private pos: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  /** corner offsets from the centroid in the body's own frame at death */
  private rest: THREE.Vector3[] = [];
  /** where the object's origin sits relative to the centroid, body frame */
  private originOffset = new THREE.Vector3();
  private startQuat = new THREE.Quaternion();
  /** the body's world rotation now; warm-starts the polar decomposition */
  private rot = new THREE.Quaternion();
  private center = new THREE.Vector3();
  private accum = 0;
  private radius: number;
  /** consecutive steps with nothing moving — the corpse's way of falling asleep */
  private quiet = 0;
  /** was any corner in contact with the world on the last step? */
  private touching = false;
  active = true;

  /**
   * @param node      the character root; this writes its position and rotation
   * @param bodyR     body half-width, metres (the enemy's collision radius)
   * @param bodyH     body height, metres
   * @param velocity  how fast the body was moving as it died
   * @param impulse   the killing blow's shove — what sets it spinning
   */
  constructor(
    private node: THREE.Object3D,
    bodyR: number, bodyH: number,
    velocity: THREE.Vector3, impulse: THREE.Vector3,
  ) {
    node.updateMatrixWorld(true);
    this.startQuat.copy(node.quaternion);
    this.rot.copy(node.quaternion);
    // The box the body lives in: the creature's own collision capsule, squared
    // off. Its corners are the sim's contact points, and they are drawn in a
    // little on the horizontal — a capsule is cut to the widest part of the
    // animal, and a corpse resting on that would float. The drawn mesh is not
    // used for this: a skinned sculpt's bounds are deliberately padded so
    // animation cannot cull it, which makes them much larger than the body.
    this.radius = 0.1;
    const hw = bodyR * 0.75, hh = bodyH * 0.5, hd = bodyR * 0.75;
    this.center.set(0, hh, 0).applyQuaternion(this.startQuat).add(node.position);
    // Spin: mostly about the axis perpendicular to the shove, so a hit from the
    // side rolls the body over rather than sliding it away flat, plus a little
    // off-axis wobble so no two bodies turn the same way. It is deliberately
    // strong — a corpse that lands still standing on its own feet is the thing
    // this replaced.
    const spin = new THREE.Vector3(0, 1, 0).cross(impulse);
    if (spin.lengthSq() < 1e-4) spin.set(1, 0, 0);
    spin.normalize().multiplyScalar(2.4 + Math.random() * 2.2);
    spin.x += (Math.random() - 0.5) * 1.6;
    spin.y += (Math.random() - 0.5) * 1.6;
    spin.z += (Math.random() - 0.5) * 1.6;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      const local = new THREE.Vector3(
        i & 1 ? hw : -hw,
        i & 2 ? hh : -hh,
        i & 4 ? hd : -hd,
      );
      this.rest.push(local.clone());
      const p = local.clone().applyQuaternion(this.startQuat).add(this.center);
      this.pos.push(p);
      // v = linear + ω × r: the corners on one side lead, and the body turns
      v.copy(velocity).addScaledVector(impulse, 0.55)
        .add(new THREE.Vector3().copy(spin).cross(p.clone().sub(this.center)));
      this.prev.push(p.clone().addScaledVector(v, -STEP));
    }
    this.originOffset.copy(node.position).sub(this.center).applyQuaternion(
      this.startQuat.clone().invert(),
    );
  }

  /** Where the body is now, for anything still tracking the corpse. */
  get hips(): THREE.Vector3 { return this.center; }

  step(dt: number, physics: PhysicsWorld): void {
    this.accum = Math.min(this.accum + dt, 0.1);
    while (this.active && this.accum >= STEP) {
      this.accum -= STEP;
      // Order matters, and only one pass of each: contacts push the corners
      // out, then the shape match turns that into a rotation of the whole
      // body. Iterating the pair instead ratchets — each match folds the last
      // push-out into the centroid, and the corpse climbs the ground it is
      // lying on.
      this.integrate(STEP);
      this.collide(physics);
      this.matchShape();
    }
    this.drive();
  }

  private integrate(dt: number): void {
    // A rigid body settling on its corners never goes perfectly still — the
    // shape match and the contacts trade a millimetre back and forth forever —
    // so rest is "slow for a while" rather than "stopped".
    let fastest = 0;
    for (let i = 0; i < 8; i++) {
      const p = this.pos[i], q = this.prev[i];
      _v.copy(p).sub(q).multiplyScalar(DAMPING);
      fastest = Math.max(fastest, _v.lengthSq());
      q.copy(p);
      p.add(_v);
      p.y -= GRAVITY * dt * dt;
    }
    // Asleep means slow *and* touching something: a body drifting down a long
    // fall is slow too, and freezing it in mid-air is worse than simulating it.
    this.quiet = fastest < 2e-5 && this.touching ? this.quiet + 1 : 0;
    if (this.quiet > 40) this.active = false;
  }

  /**
   * Snap the cloud back onto the rigid shape: centroid, then the rotation that
   * best takes the rest corners onto where the points have drifted to.
   */
  private matchShape(): void {
    this.center.set(0, 0, 0);
    for (const p of this.pos) this.center.add(p);
    this.center.multiplyScalar(1 / 8);
    this.extractRotation();
    for (let i = 0; i < 8; i++) {
      _v.copy(this.rest[i]).applyQuaternion(this.rot).add(this.center);
      this.pos[i].copy(_v);
    }
  }

  /**
   * Müller's "robust extraction of the rotation from a matrix": a few
   * Gauss-Newton steps on the current guess, each one a rotation about the
   * axis that most reduces the mismatch. Warm-started from last frame's
   * answer, three iterations are plenty.
   */
  private extractRotation(): void {
    // A = Σ (p_i − c) ⊗ rest_i, held as its three column vectors
    const a0 = _a0.set(0, 0, 0), a1 = _a1.set(0, 0, 0), a2 = _a2.set(0, 0, 0);
    for (let i = 0; i < 8; i++) {
      _v.copy(this.pos[i]).sub(this.center);
      const r = this.rest[i];
      a0.addScaledVector(_v, r.x);
      a1.addScaledVector(_v, r.y);
      a2.addScaledVector(_v, r.z);
    }
    for (let iter = 0; iter < 3; iter++) {
      // the guess's own axes, which A's columns should line up with
      _r0.set(1, 0, 0).applyQuaternion(this.rot);
      _r1.set(0, 1, 0).applyQuaternion(this.rot);
      _r2.set(0, 0, 1).applyQuaternion(this.rot);
      _omega.set(0, 0, 0)
        .add(_cross.copy(_r0).cross(a0))
        .add(_cross.copy(_r1).cross(a1))
        .add(_cross.copy(_r2).cross(a2));
      const denom = Math.abs(_r0.dot(a0) + _r1.dot(a1) + _r2.dot(a2)) + 1e-9;
      _omega.multiplyScalar(1 / denom);
      const w = _omega.length();
      if (w < 1e-9) break;
      _q.setFromAxisAngle(_omega.multiplyScalar(1 / w), w);
      this.rot.premultiply(_q).normalize();
    }
  }

  private collide(physics: PhysicsWorld): void {
    this.touching = false;
    for (let i = 0; i < 8; i++) {
      const p = this.pos[i], q = this.prev[i];
      // out of anything solid first, so a corner never comes to rest inside a
      // crate it fell against
      if (physics.pushOutPoint(p, this.radius)) {
        this.touching = true;
        q.x += (p.x - q.x) * GROUND_FRICTION;
        q.z += (p.z - q.z) * GROUND_FRICTION;
      }
      const g = physics.groundHeight(p.x, p.z, p.y);
      if (g === -Infinity) continue;
      const floor = g + this.radius;
      if (p.y >= floor) continue;
      this.touching = true;
      p.y = floor;
      const vy = p.y - q.y;
      q.x += (p.x - q.x) * GROUND_FRICTION;
      q.z += (p.z - q.z) * GROUND_FRICTION;
      q.y = p.y + vy * BOUNCE;
    }
  }

  /** Carry the simulated body back onto the character. */
  private drive(): void {
    this.node.quaternion.copy(this.rot);
    _v.copy(this.originOffset).applyQuaternion(this.rot);
    this.node.position.copy(this.center).add(_v);
    this.node.updateMatrixWorld(true);
  }
}

const _a0 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _a2 = new THREE.Vector3();
const _r0 = new THREE.Vector3();
const _r1 = new THREE.Vector3();
const _r2 = new THREE.Vector3();
const _omega = new THREE.Vector3();
const _cross = new THREE.Vector3();
