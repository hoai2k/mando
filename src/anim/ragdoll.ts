import * as THREE from 'three';
import type { Rig } from './skeleton';
import type { PhysicsWorld } from '../core/physics';

/**
 * Verlet ragdoll: a real simulation, not a canned fall.
 *
 * Fifteen point masses sit at the joints, joined by distance constraints
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
/**
 * The hip joints themselves, one each side of the pelvis. The thighs used to
 * be aimed from the pelvis centre, 13 cm inboard of where they really hang,
 * so every corpse landed ~16° knock-kneed with its feet crossed. These ride
 * rigidly with the pelvis and the chest and give each thigh its own origin.
 */
const HJL = 13, HJR = 14;
const COUNT = 15;

/** which rig bone each point is seeded from */
const SEED_BONE: string[] = [];
SEED_BONE[HEAD] = 'head'; SEED_BONE[CHEST] = 'chest'; SEED_BONE[HIPS] = 'hips';
SEED_BONE[SHL] = 'upperArmL'; SEED_BONE[ELL] = 'forearmL'; SEED_BONE[HAL] = 'handL';
SEED_BONE[SHR] = 'upperArmR'; SEED_BONE[ELR] = 'forearmR'; SEED_BONE[HAR] = 'handR';
SEED_BONE[KNL] = 'lowerLegL'; SEED_BONE[FTL] = 'footL';
SEED_BONE[KNR] = 'lowerLegR'; SEED_BONE[FTR] = 'footR';
SEED_BONE[HJL] = 'upperLegL'; SEED_BONE[HJR] = 'upperLegR';

/** [a, b, stiffness] — bone links are rigid, braces give the torso its shape */
const LINKS: [number, number, number][] = [
  [HIPS, CHEST, 1], [CHEST, HEAD, 1],
  [CHEST, SHL, 1], [SHL, ELL, 1], [ELL, HAL, 1],
  [CHEST, SHR, 1], [SHR, ELR, 1], [ELR, HAR, 1],
  // the pelvis: both hip joints rigid to its centre and to each other, and
  // braced to the chest so the girdle keeps its shape under the torso
  [HIPS, HJL, 1], [HIPS, HJR, 1], [HJL, HJR, 1], [CHEST, HJL, 0.8], [CHEST, HJR, 0.8],
  [HJL, KNL, 1], [KNL, FTL, 1],
  [HJR, KNR, 1], [KNR, FTR, 1],
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
  { bone: 'upperLegL', from: HJL, to: KNL, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'lowerLegL', from: KNL, to: FTL, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'upperLegR', from: HJR, to: KNR, axis: new THREE.Vector3(0, -1, 0) },
  { bone: 'lowerLegR', from: KNR, to: FTR, axis: new THREE.Vector3(0, -1, 0) },
];

/** bones the sim has no opinion about — straightened so they don't keep a pose */
const RELAX = ['spine', 'chest', 'head', 'shoulderL', 'shoulderR', 'footL', 'footR'];

const GRAVITY = 20;
/**
 * A corpse standing upright is a *stable* arrangement of distance constraints.
 *
 * That is the whole reason tuskens kept dying on their feet. Nothing in a
 * Verlet chain resists a lean, but nothing creates one either: gravity pulls
 * straight down, the feet are clamped on the sand pushing straight up, and a
 * body whose points happen to stack vertically will balance there forever. The
 * killing blow usually knocks it off that stack — which is why it looked
 * random, and why a raider shot square in the chest while standing still was
 * the one left sticking out of the dune.
 *
 * So the topple is supplied: while the torso is still near vertical and the
 * body is in contact with the ground, the upper points get a steady sideways
 * push in one direction chosen at death. It fades out as the body goes over
 * and is gone entirely by the time it is halfway down, so it tips a corpse
 * rather than dragging one.
 */
const TIP_ACCEL = 11;
/** how upright (torso · up) the body must still be for the push to apply */
const TIP_MIN = 0.5;
/** the points it pushes: everything above the waist */
const TIP_POINTS = [HEAD, CHEST, SHL, SHR];
const DAMPING = 0.992;
const GROUND_FRICTION = 0.62;
const BOUNCE = 0.12;
const STEP = 1 / 90;
const ITERATIONS = 7;

const _v = new THREE.Vector3();
const _lean = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

export class Ragdoll {
  private pos: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private radius: number[] = [];
  private rest: number[] = [];
  private accum = 0;
  /** consecutive quiet steps — a corpse's way of falling asleep */
  private quiet = 0;
  /** did any point rest on the world during the last step? */
  private touching = false;
  /** the bearing this body falls over on, fixed at death (see TIP_ACCEL) */
  private tip = new THREE.Vector3();
  /** false once the body has gone quiet on the ground — stop stepping it */
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
      this.radius.push(i === HEAD ? 0.13 : i === CHEST || i === HIPS ? 0.15 : i === HJL || i === HJR ? 0.11 : 0.08);
    }
    for (const [a, b] of LINKS) this.rest.push(this.pos[a].distanceTo(this.pos[b]));
    // fall the way the blow was going, where it was going anywhere flat;
    // a body shot straight down the barrel picks its own bearing
    this.tip.set(impulse.x, 0, impulse.z);
    if (this.tip.lengthSq() < 0.04) {
      const a = Math.random() * Math.PI * 2;
      this.tip.set(Math.cos(a), 0, Math.sin(a));
    }
    this.tip.normalize();
  }

  /** Where the body is now, for anything still tracking the corpse. */
  get hips(): THREE.Vector3 { return this.pos[HIPS]; }

  /** Slide the whole body, used to sink a corpse away once it has settled. */
  translate(dy: number): void {
    for (let i = 0; i < COUNT; i++) { this.pos[i].y += dy; this.prev[i].y += dy; }
  }

  /**
   * Hit a body that has already come to rest: wake it and knock it about.
   *
   * A corpse is still a thing in the world, so a bolt into one should move it.
   * The upper points take more of the shove than the lower, which is what
   * turns a hit into a roll rather than a slide.
   */
  shove(from: THREE.Vector3, force: number): void {
    _v.copy(this.pos[CHEST]).sub(from).setY(0);
    if (_v.lengthSq() < 1e-6) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _v.normalize();
    this.active = true;
    this.quiet = 0;
    for (let i = 0; i < COUNT; i++) {
      const high = i === HEAD || i === CHEST || i === SHL || i === SHR ? 1.4 : 0.5;
      this.prev[i].addScaledVector(_v, -force * high * STEP);
      this.prev[i].y -= force * 0.25 * high * STEP;
    }
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
    let fastest = 0;
    for (let i = 0; i < COUNT; i++) {
      const p = this.pos[i], q = this.prev[i];
      _v.copy(p).sub(q).multiplyScalar(DAMPING);
      fastest = Math.max(fastest, _v.lengthSq());
      q.copy(p);
      p.add(_v);
      p.y -= GRAVITY * dt * dt;
    }
    // Tip a body that is still on its feet (see TIP_ACCEL). Only once it is
    // touching the world: in the air it is already going somewhere, and a
    // sideways shove there would read as wind.
    if (this.touching) {
      _lean.copy(this.pos[CHEST]).sub(this.pos[HIPS]);
      const len = _lean.length();
      const upright = len > 1e-5 ? _lean.y / len : 0;
      if (upright > TIP_MIN) {
        const push = TIP_ACCEL * ((upright - TIP_MIN) / (1 - TIP_MIN)) * dt * dt;
        for (const i of TIP_POINTS) {
          this.pos[i].x += this.tip.x * push;
          this.pos[i].z += this.tip.z * push;
        }
      }
    }
    // Asleep means slow *and* resting on something — the same rule the rigid
    // solver next door already uses. On speed alone a body falls asleep at the
    // top of its arc: the knockback that throws a corpse up ends with every
    // point momentarily still, the sim stops there, and the body freezes
    // standing in the air with its legs in the sand. That is the tusken left
    // sticking up out of the dune; it only happened to the ones whose throw
    // peaked with every point quiet, which is why it looked random.
    this.quiet = fastest < 1e-6 && this.touching ? this.quiet + 1 : 0;
    if (this.quiet > 40) this.active = false;
    this.touching = false;
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
      this.touching = true;
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
/** how deep a contact box must be, as a fraction of its width (see `drawnBox`) */
const MIN_BOX_ASPECT = 0.8;
/** speed of the roll-over couple, m/s, and the lift that helps the top clear */
const ROLL_SPEED = 7;
const ROLL_LIFT = 4.5;
/** how many times a corpse may be rolled off its feet before it is left alone */
const MAX_ROLLS = 3;

const _up = new THREE.Vector3();
const _lo = new THREE.Vector3();
const _hi = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _inv = new THREE.Quaternion();

/**
 * The box the drawn body actually occupies, in its own frame: half-extents in
 * metres and where its middle sits relative to the node's origin.
 *
 * The collision capsule is what a creature *walks* in, not what it looks like.
 * A massiff is five metres of animal inside a 0.9 m capsule, so falling on the
 * capsule gave the solver a nearly cubic box: it tumbled to any angle at all
 * and left the long body standing on its nose with a metre and a half of it
 * underground. Measured on the drawn body, the same corpse has a long box and
 * lies down along its length, which is the whole difference.
 *
 * Bones for a skinned sculpt, mesh bounds otherwise. A skinned mesh's geometry
 * bounds are padded so animation cannot cull it — which is why they were
 * rejected here — but the bones are not padded and they are the posed truth.
 * Hidden subtrees are skipped, so the procedural stand-in under an authored
 * body never joins in.
 */
function drawnBox(node: THREE.Object3D, facing: THREE.Quaternion):
{ half: THREE.Vector3; centre: THREE.Vector3 } | null {
  node.updateMatrixWorld(true);
  _inv.copy(facing).invert();
  _lo.set(Infinity, Infinity, Infinity);
  _hi.set(-Infinity, -Infinity, -Infinity);
  let n = 0;
  let skinned = false;
  node.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) skinned = true;
  });
  const add = (x: number, y: number, z: number): void => {
    _pt.set(x, y, z).sub(node.position).applyQuaternion(_inv);
    _lo.min(_pt);
    _hi.max(_pt);
    n++;
  };
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;
    const sk = o as THREE.SkinnedMesh;
    const mesh = o as THREE.Mesh;
    if (sk.isSkinnedMesh) {
      for (const b of sk.skeleton.bones) {
        const e = b.matrixWorld.elements;
        add(e[12], e[13], e[14]);
      }
    } else if (!skinned && mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      if (bb) {
        for (const cx of [bb.min.x, bb.max.x]) {
          for (const cy of [bb.min.y, bb.max.y]) {
            for (const cz of [bb.min.z, bb.max.z]) {
              _pt.set(cx, cy, cz).applyMatrix4(mesh.matrixWorld);
              add(_pt.x, _pt.y, _pt.z);
            }
          }
        }
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(node);
  if (n < 4) return null;
  const half = new THREE.Vector3().subVectors(_hi, _lo).multiplyScalar(0.5);
  // Nothing may be paper-thin: eight coplanar corners give the shape match no
  // rotation to find, and a bone chain down one limb can be exactly that.
  half.set(Math.max(half.x, 0.18), Math.max(half.y, 0.18), Math.max(half.z, 0.18));
  const centre = new THREE.Vector3().addVectors(_lo, _hi).multiplyScalar(0.5);
  // And nothing may be a slab. A spider measures two and a half times wider
  // than it is deep, and a box that flat has exactly one stable face: it lands
  // squarely back on its feet however it is thrown, which reads as a live
  // animal that has stopped moving. Squaring it up gives the body sides to
  // come to rest on. Raised from the top alone — the bottom face is what the
  // corpse rests on, and moving that is what buries a body or floats it.
  //
  // Against the body's NARROW side, never its long one. A massiff is low and
  // long: measured against its length this would build a box two metres deep
  // around a knee-high animal, and a corpse coming to rest on the side of that
  // hangs in the air by the difference. Measured across, it barely moves.
  const flat = Math.min(half.x, half.z) * MIN_BOX_ASPECT;
  if (half.y < flat) {
    centre.y += flat - half.y;
    half.y = flat;
  }
  return { half, centre };
}

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
  /** the bearing this body rolls off on while it is still the right way up */
  private tip = new THREE.Vector3();
  /** how many times it has been rolled off its feet (see MAX_ROLLS) */
  private rolls = 0;
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
    // The body as drawn, where that can be read; the capsule, squared off and
    // drawn in a little, as the fallback. See `drawnBox` for why the capsule
    // was never a good description of a long animal.
    const box = drawnBox(node, this.startQuat);
    const hw = box ? box.half.x : bodyR * 0.75;
    const hh = box ? box.half.y : bodyH * 0.5;
    const hd = box ? box.half.z : bodyR * 0.75;
    if (box) this.center.copy(box.centre).applyQuaternion(this.startQuat).add(node.position);
    else this.center.set(0, hh, 0).applyQuaternion(this.startQuat).add(node.position);
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
    // roll off the way the blow was going, or pick a bearing if it had none
    this.tip.set(impulse.x, 0, impulse.z);
    if (this.tip.lengthSq() < 0.04) {
      const a = Math.random() * Math.PI * 2;
      this.tip.set(Math.cos(a), 0, Math.sin(a));
    }
    this.tip.normalize();
  }

  /**
   * Hit a body that has already come to rest: wake it and knock it about.
   *
   * The corners nearest the shot take the most of it, so a bolt into one side
   * of a corpse rolls it away rather than sliding the whole thing.
   */
  shove(from: THREE.Vector3, force: number): void {
    _dir.copy(this.center).sub(from).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _dir.normalize();
    this.active = true;
    this.quiet = 0;
    for (let i = 0; i < 8; i++) {
      // how exposed this corner is to the shot: the near side leads
      const face = 0.6 + 0.8 * Math.max(0, -_v.copy(this.pos[i]).sub(this.center).normalize().dot(_dir));
      this.prev[i].addScaledVector(_dir, -force * face * STEP);
      this.prev[i].y -= force * 0.3 * face * STEP;
    }
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
    if (this.quiet <= 40) return;
    // ...but not asleep the way it lived.
    //
    // A wide flat animal — a spider, a massiff — has its own underside for a
    // resting face, and once the contact box was fitted to the drawn body it
    // settled back onto its feet as often as not. A dead thing standing
    // squarely on its own feet reads as alive. A steady lean does nothing to a
    // box three times wider than it is tall, which is genuinely stable that
    // way up, so this is a shove rather than a lean: the top of the body one
    // way, the bottom the other, which is a couple and turns it. Capped,
    // because a body that keeps landing back on its feet has made its point —
    // and a corpse is shootable, so the player can finish the job.
    _up.set(0, 1, 0).applyQuaternion(this.rot);
    if (_up.y > TIP_MIN && this.rolls < MAX_ROLLS) {
      this.rolls++;
      this.quiet = 0;
      for (let i = 0; i < 8; i++) {
        const top = this.rest[i].y > 0;
        this.prev[i].addScaledVector(this.tip, (top ? -1 : 1) * ROLL_SPEED * STEP);
        if (top) this.prev[i].y -= ROLL_LIFT * STEP;
      }
      return;
    }
    this.active = false;
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
