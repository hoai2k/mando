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
    this.rig.root.position.set(0, 0, 0);
    this.rig.root.quaternion.identity();
    for (const name of RELAX) b[name as keyof typeof b]?.quaternion.identity();
    b.hips.position.copy(this.pos[HIPS]);
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
