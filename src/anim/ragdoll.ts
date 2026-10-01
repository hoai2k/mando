import * as THREE from 'three';
import type { Rig } from './skeleton';
import type { PhysicsWorld, SolidSet } from '../core/physics';

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
 * How far around a body its shortlist of colliders is gathered (see
 * `PhysicsWorld.solidsNear`). A corpse is about two metres from head to foot,
 * and a frame of falling adds under one more at any speed the game throws a
 * body at; four metres covers both with room to spare.
 */
const SOLID_REACH = 4;
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
  /** the colliders near the body, refreshed once a frame (see SOLID_REACH) */
  private near: SolidSet = { boxes: [], cylinders: [] };
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
    // The crates, walls and pillars this body might touch this frame. Gathered
    // once here rather than per point per iteration: the contact pass below
    // runs a hundred times a step, and the whole board's boxes in each of them
    // is what a corpse solver cannot afford.
    if (this.active) {
      const h = this.pos[HIPS];
      physics.solidsNear(h.x, h.y, h.z, SOLID_REACH, this.near);
    }
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
      const q = this.prev[i];
      // Out of anything solid first. This solver used to know about the floor
      // and nothing else, so a body that died against a wall, a crate or a
      // pillar simply sank through it — the ground under the far side caught
      // it, and the corpse ended up inside the scenery. The rigid solver next
      // door had the world all along; this is the same call.
      if (physics.pushOutPoint(p, this.radius[i], this.near)) {
        this.touching = true;
        q.x += (p.x - q.x) * GROUND_FRICTION;
        q.z += (p.z - q.z) * GROUND_FRICTION;
      }
      const g = physics.groundHeight(p.x, p.z, p.y);
      if (g === -Infinity) continue;
      const floor = g + this.radius[i];
      if (p.y >= floor) continue;
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
// Rigless bodies: one rounded rigid body
// ---------------------------------------------------------------------------

/**
 * Ragdoll for a creature that is not on our canonical skeleton — the krykna,
 * the broodmother and her spiderlings, the massiff, the drone, the monster
 * bosses. They have no named bones to hang the articulated solver on, so they
 * die as one rigid body.
 *
 * WHY AN ELLIPSOID, AND NOT A BOX.
 *
 * This used to be eight Verlet points at the corners of the body's box,
 * shape-matched back to the box every step. A box has six faces it is happy
 * to rest on, and two of them are its small ends: a krykna thrown nose-first
 * into the sand came to rest balanced on its nose, or its tail, the long body
 * pointing at the sky — stable as a brick stood on end, and nothing like an
 * animal. Its "roll it off its feet" shove only ever fought the belly-down
 * case, and pushed as many bodies onto an end as it pushed off one.
 *
 * The animal is rounded, and a rounded body has no such rest. An ellipsoid on
 * the ground balanced on its long axis has its centre of mass as high as it
 * can go: the contact point sits under the centre only at that exact angle,
 * and the ground's push at any other angle is off-centre and torques the body
 * over onto its side, its back or its belly. That torque is not added here as
 * a fudge — it falls out of resolving the ground contact at the true contact
 * point of the ellipsoid, which is the whole reason for the shape.
 *
 * So this is a real rigid-body sim: position, orientation, linear and angular
 * velocity, the inertia of a solid ellipsoid, gravity, and impulse contacts
 * with restitution, Coulomb friction (which is what makes it roll rather than
 * skate) and rolling resistance. The killing blow throws it — linear velocity
 * from the hit with a little pop, spin about the axis across the hit — and it
 * tumbles, bounces, rolls and settles. A body that comes to rest anywhere near
 * end-on (pinned against a wall, say) is eased over onto the nearest lying
 * orientation as the last step, so nothing is ever left standing on end.
 *
 * The ellipsoid is measured off the drawn body — its skinned vertices, in the
 * pose it will lie in (a spider's legs curled) — not the walking capsule.
 */

/** semi-axes no thinner than this, metres: nothing may be a knife edge */
const MIN_SEMI = 0.12;
/** substep for the rigid body, seconds */
const RB_STEP = 1 / 120;
/** bounce off the ground; none at all for a slow contact, so a resting body cannot buzz */
const RB_BOUNCE = 0.18;
const RB_BOUNCE_MIN = 1.2;
/** Coulomb friction against the ground and the scenery */
const RB_FRICTION = 0.7;
/** rolling resistance while in contact, 1/s (angular velocity decay) */
const RB_ROLL_DRAG = 1.6;
/**
 * Coulomb rolling resistance once the body is lying down, as the deceleration
 * of its surface, m/s². A carcass is not a ball bearing: it flattens where it
 * touches and stops on a gentle dune instead of rolling down it for ever. Only
 * while lying — on its end the restoring torque is small, and resistance there
 * would hold the body up exactly where it must not stay.
 */
const RB_ROLL_RESIST = 12;
/** a little drag on everything while touching — sand, not ice */
const RB_CONTACT_DRAG = 2.5;
/** how close to horizontal the long axis must be (|axis·up|) to count as lying */
const RB_LYING = Math.sin((35 * Math.PI) / 180);
/** how many of the drawn body's points are kept for the final placement */
const CLOUD_POINTS = 240;
/** air drag, 1/s, on spin and travel */
const RB_AIR_DRAG = 0.05;
/** asleep: slower than these (m/s, rad/s) for RB_SLEEP_TIME seconds, in contact */
const RB_SLEEP_V = 0.12;
const RB_SLEEP_W = 0.25;
const RB_SLEEP_TIME = 0.35;
/** never simulate a corpse longer than this, seconds, before settling it */
const RB_MAX_TIME = 7;
/** how far off its nearest lying orientation a resting body may be before it is eased onto it, radians */
const RB_SETTLE_SLACK = (25 * Math.PI) / 180;
/** how long the final ease takes, seconds */
const RB_SETTLE_TIME = 0.45;
/** how long a dead spider's legs take to curl, seconds */
const CURL_TIME = 0.7;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();
const _j = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/**
 * A dead spider's legs: each chain eased from the pose it died in to a curl.
 *
 * Spiders die with their legs drawn in under the body — the flexors win once
 * nothing holds the legs out. The upper segment of each leg swings toward the
 * belly, the lower one folds back in under it. Computed once, geometrically,
 * in the body's own frame (no assumption about which way a bone's local axes
 * point), then blended in over CURL_TIME.
 */
class LegCurl {
  private bones: THREE.Object3D[] = [];
  private from: THREE.Quaternion[] = [];
  private to: THREE.Quaternion[] = [];
  private t = 0;

  /** the spider leg chains under `node`, or null for a body without them */
  static find(node: THREE.Object3D, facing: THREE.Quaternion, centre: THREE.Vector3): LegCurl | null {
    const roots: THREE.Object3D[] = [];
    const seen = new Set<string>();
    const walk = (o: THREE.Object3D): void => {
      if (!o.visible) return;
      // the first of each name: the sculpt is searched before its stand-in
      if ((o as THREE.Bone).isBone && /^leg[LR]\d+$/.test(o.name) && !seen.has(o.name)) {
        seen.add(o.name);
        roots.push(o);
      }
      for (const c of o.children) walk(c);
    };
    walk(node);
    // six legs or more: a spider. A four-legged animal keeps its legs as they fell.
    if (roots.length < 6) return null;
    const curl = new LegCurl();
    curl.build(node, roots, facing, centre);
    return curl.bones.length ? curl : null;
  }

  private build(node: THREE.Object3D, roots: THREE.Object3D[], facing: THREE.Quaternion, centre: THREE.Vector3): void {
    node.updateMatrixWorld(true);
    const down = _a.set(0, -1, 0).applyQuaternion(facing).clone();
    // hip, knee, foot: legL1 → legL1_mid → legL1_tip on the krykna rigs
    const chains: THREE.Object3D[][] = roots.map((r) => {
      const chain = [r];
      for (let o: THREE.Object3D | undefined = r; chain.length < 3;) {
        o = o.children.find((c) => (c as THREE.Bone).isBone);
        if (!o) break;
        chain.push(o);
      }
      return chain;
    });
    for (const chain of chains) {
      // outward, across the ground from the middle of the body to the hip
      const hip = chain[0].getWorldPosition(new THREE.Vector3());
      const out = hip.clone().sub(centre);
      out.addScaledVector(down, -out.dot(down));
      if (out.lengthSq() < 1e-8) out.set(1, 0, 0).applyQuaternion(facing);
      out.normalize();
      for (let i = 0; i < chain.length; i++) {
        const bone = chain[i];
        bone.updateMatrixWorld(true);
        const p = bone.getWorldPosition(new THREE.Vector3());
        // the segment's direction: toward its child bone, else along its own +Y
        const kid = bone.children.find((c) => (c as THREE.Bone).isBone);
        const dir = kid
          ? kid.getWorldPosition(new THREE.Vector3()).sub(p)
          : new THREE.Vector3(0, 1, 0).applyQuaternion(bone.getWorldQuaternion(_qa));
        if (dir.lengthSq() < 1e-10) continue;
        dir.normalize();
        // Upper segment toward the belly and a little out; the middle folded
        // back in under the body; the foot hooked back up toward the belly —
        // the closed curl of a dead spider's leg.
        const want = new THREE.Vector3();
        if (i === 0) want.copy(down).addScaledVector(out, 0.55);
        else if (i === 1) want.copy(out).multiplyScalar(-1).addScaledVector(down, 0.45);
        else want.copy(out).multiplyScalar(-1).addScaledVector(down, -0.6);
        want.normalize();
        _qb.setFromUnitVectors(dir, want);
        const world = bone.getWorldQuaternion(new THREE.Quaternion());
        const parent = bone.parent ? bone.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
        const local = parent.invert().multiply(_qb).multiply(world);
        this.bones.push(bone);
        this.from.push(bone.quaternion.clone());
        this.to.push(local.normalize());
        // posed now, so the next segment down is aimed from where it will be
        bone.quaternion.copy(local);
        bone.updateMatrixWorld(true);
      }
    }
  }

  /** pose the legs at fraction `w` of the curl (1 = fully curled) */
  pose(w: number): void {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].quaternion.slerpQuaternions(this.from[i], this.to[i], w);
    }
  }

  /** advance the curl; true while it is still moving */
  tick(dt: number): boolean {
    if (this.t >= CURL_TIME) return false;
    this.t = Math.min(CURL_TIME, this.t + dt);
    const k = this.t / CURL_TIME;
    this.pose(k * k * (3 - 2 * k));   // smoothstep: a twitch in, not a snap
    return true;
  }
}

/**
 * The ellipsoid the drawn body fills, in the body's own frame (`facing`):
 * semi-axes in metres, and where its middle sits relative to the node's origin.
 *
 * Measured on the skinned vertices as they are posed, so a sculpt's padded
 * culling bounds never come into it, and on mesh vertices for a model built of
 * plain meshes. Hidden subtrees (the stand-in under a loaded sculpt) and the
 * readout beads sit out. The ellipsoid has the vertices' box proportions and
 * is sized to hold nearly all of them: a body lying on any face then touches
 * the ground with its flesh, neither floating on its corners nor sunk.
 */
function drawnEllipsoid(node: THREE.Object3D, facing: THREE.Quaternion):
{ semi: THREE.Vector3; centre: THREE.Vector3; cloud: THREE.Vector3[] } | null {
  node.updateMatrixWorld(true);
  _inv.copy(facing).invert();
  const pts: number[] = [];
  const meshes: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible || o.userData?.readout) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.attributes?.position) meshes.push(mesh);
    for (const c of o.children) walk(c);
  };
  walk(node);
  let total = 0;
  for (const m of meshes) total += m.geometry.attributes.position.count;
  if (!total) return null;
  // a few thousand samples is plenty to find a body's extent
  const stride = Math.max(1, Math.floor(total / 4000));
  for (const m of meshes) {
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i += stride) {
      m.getVertexPosition(i, _pt);   // skinned: posed by the bones
      _pt.applyMatrix4(m.matrixWorld).sub(node.position).applyQuaternion(_inv);
      pts.push(_pt.x, _pt.y, _pt.z);
    }
  }
  const count = pts.length / 3;
  if (count < 8) return null;
  _lo.set(Infinity, Infinity, Infinity);
  _hi.set(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < pts.length; i += 3) {
    _pt.set(pts[i], pts[i + 1], pts[i + 2]);
    _lo.min(_pt);
    _hi.max(_pt);
  }
  const centre = new THREE.Vector3().addVectors(_lo, _hi).multiplyScalar(0.5);
  const half = new THREE.Vector3().subVectors(_hi, _lo).multiplyScalar(0.5);
  half.set(Math.max(half.x, MIN_SEMI), Math.max(half.y, MIN_SEMI), Math.max(half.z, MIN_SEMI));
  // How far out the flesh reaches in the box's own proportions: 1 on a face,
  // up to √3 in a corner. An ellipsoid with the box's proportions, scaled to
  // hold 95% of the body, touches down on flesh; one sized to the box itself
  // lets every corner of a blocky shape sink, and one sized to hold the very
  // last vertex floats the body on its extremities.
  const r: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const x = (pts[i] - centre.x) / half.x;
    const y = (pts[i + 1] - centre.y) / half.y;
    const z = (pts[i + 2] - centre.z) / half.z;
    r.push(Math.sqrt(x * x + y * y + z * z));
  }
  r.sort((p, q) => p - q);
  const k = THREE.MathUtils.clamp(r[Math.floor(r.length * 0.95)], 0.9, 1.12);
  // a thinned copy of the points, about the centre: the flesh, for laying the
  // body down onto the ground once it has stopped (see `settleStep`)
  const cloud: THREE.Vector3[] = [];
  const every = Math.max(1, Math.floor(count / CLOUD_POINTS));
  for (let i = 0; i < count; i += every) {
    cloud.push(new THREE.Vector3(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).sub(centre));
  }
  return { semi: half.multiplyScalar(k), centre, cloud };
}

export class RigidRagdoll {
  /** ellipsoid centre, world */
  private center = new THREE.Vector3();
  /** the body's world rotation */
  private rot = new THREE.Quaternion();
  private vel = new THREE.Vector3();
  /** angular velocity, world, rad/s */
  private omega = new THREE.Vector3();
  /** semi-axes in the body frame, metres */
  private semi = new THREE.Vector3();
  /** inverse inertia of a unit-mass solid ellipsoid, body frame (diagonal) */
  private invI = new THREE.Vector3();
  /** where the node's origin sits relative to the centre, body frame */
  private originOffset = new THREE.Vector3();
  private accum = 0;
  private time = 0;
  /** time spent slow and in contact */
  private quiet = 0;
  private touching = false;
  /** the final ease onto a lying orientation: from, to, and how far along */
  private settleFrom: THREE.Quaternion | null = null;
  private settleTo = new THREE.Quaternion();
  private settleT = 0;
  private legs: LegCurl | null = null;
  /** the colliders near the body, refreshed once a frame */
  private near: SolidSet = { boxes: [], cylinders: [] };
  private reach = SOLID_REACH;
  /** surface sample directions for the scenery contacts, body frame (unit) */
  private probes: THREE.Vector3[] = [];
  /** the drawn body's points about the centre, body frame (see `drawnEllipsoid`) */
  private cloud: THREE.Vector3[] = [];
  /** longest semi-axis, as a body-frame unit vector */
  private longAxis = new THREE.Vector3(0, 0, 1);
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
    const facing = node.quaternion.clone();
    this.rot.copy(facing);
    // The pose it will lie in comes first, so the shape is measured on the
    // curled spider rather than one with its legs flung out.
    const roughCentre = new THREE.Vector3(0, bodyH * 0.5, 0).applyQuaternion(facing).add(node.position);
    this.legs = LegCurl.find(node, facing, roughCentre);
    // find() left the legs fully curled for measuring; measure, then put them back
    const shape = drawnEllipsoid(node, facing);
    this.legs?.pose(0);
    node.updateMatrixWorld(true);
    if (shape) {
      this.semi.copy(shape.semi);
      this.cloud = shape.cloud;
      this.center.copy(shape.centre).applyQuaternion(facing).add(node.position);
    } else {
      this.semi.set(bodyR * 0.8, bodyH * 0.5, bodyR * 0.8);
      this.center.set(0, bodyH * 0.5, 0).applyQuaternion(facing).add(node.position);
    }
    const { x: a, y: b, z: c } = this.semi;
    this.longAxis.copy(AXES[a >= b && a >= c ? 0 : b >= c ? 1 : 2]);
    this.invI.set(5 / (b * b + c * c), 5 / (a * a + c * c), 5 / (a * a + b * b));
    this.originOffset.copy(node.position).sub(this.center).applyQuaternion(_inv.copy(facing).invert());
    this.reach = SOLID_REACH + Math.max(a, b, c);
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x || y || z) this.probes.push(new THREE.Vector3(x, y, z).normalize());
        }
      }
    }

    // Thrown: the velocity it died with, the hit's shove on top, and spin
    // about the axis across the hit — the top of the body goes the way the
    // blow went, so it tumbles over rather than sliding away flat. Harder
    // hits spin faster; a little off-axis wobble so no two fall alike.
    this.vel.copy(velocity).addScaledVector(impulse, 0.2);
    const hx = impulse.x, hz = impulse.z;
    const along = Math.hypot(hx, hz);
    const size = (a + b + c) / 3;
    if (along > 1e-3) this.omega.set(hz, 0, -hx).multiplyScalar(1 / along);
    else {
      const t = Math.random() * Math.PI * 2;
      this.omega.set(Math.cos(t), 0, Math.sin(t));
    }
    this.omega.multiplyScalar(THREE.MathUtils.clamp((along * 1.6) / size, 2.5, 8) * (0.85 + Math.random() * 0.3));
    this.omega.x += (Math.random() - 0.5) * 2;
    this.omega.y += (Math.random() - 0.5) * 2.4;
    this.omega.z += (Math.random() - 0.5) * 2;
    this.drive();
  }

  /**
   * Hit a body that has already come to rest: wake it and knock it about. The
   * shove lands on the near side, so it rolls the body away as well as
   * pushing it.
   */
  shove(from: THREE.Vector3, force: number): void {
    _dir.copy(this.center).sub(from).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    _dir.normalize();
    this.active = true;
    this.quiet = 0;
    this.settleFrom = null;
    this.time = Math.min(this.time, RB_MAX_TIME - 3);
    this.vel.addScaledVector(_dir, force * 0.6);
    this.vel.y += force * 0.25;
    const size = (this.semi.x + this.semi.y + this.semi.z) / 3;
    this.omega.addScaledVector(_c.set(_dir.z, 0, -_dir.x), (force * 0.5) / size);
  }

  /** Where the body is now, for anything still tracking the corpse. */
  get hips(): THREE.Vector3 { return this.center; }

  step(dt: number, physics: PhysicsWorld): void {
    if (this.legs && !this.legs.tick(dt)) this.legs = null;
    this.accum = Math.min(this.accum + dt, 0.1);
    if (this.active) {
      const c = this.center;
      physics.solidsNear(c.x, c.y, c.z, this.reach, this.near);
    }
    while (this.active && this.accum >= RB_STEP) {
      this.accum -= RB_STEP;
      this.time += RB_STEP;
      if (this.settleFrom) this.settleStep(RB_STEP, physics);
      else this.simStep(RB_STEP, physics);
    }
    // asleep is the last step it is given: the legs finish their curl now
    if (!this.active && this.legs) { this.legs.pose(1); this.legs = null; }
    this.drive();
  }

  // ---- the rigid body ----

  /** world-space inverse inertia applied to `v`, in place */
  private invInertia(v: THREE.Vector3): THREE.Vector3 {
    _qa.copy(this.rot).invert();
    v.applyQuaternion(_qa);
    v.set(v.x * this.invI.x, v.y * this.invI.y, v.z * this.invI.z);
    return v.applyQuaternion(this.rot);
  }

  /** The ellipsoid's furthest point in world direction `d` (unit), into `out`. */
  private support(d: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _qa.copy(this.rot).invert();
    out.copy(d).applyQuaternion(_qa);
    const s = this.semi;
    out.set(out.x * s.x * s.x, out.y * s.y * s.y, out.z * s.z * s.z);
    const len = Math.sqrt(out.x * out.x / (s.x * s.x) + out.y * out.y / (s.y * s.y) + out.z * out.z / (s.z * s.z)) || 1;
    out.multiplyScalar(1 / len);
    return out.applyQuaternion(this.rot).add(this.center);
  }

  /**
   * The ground under the body: the contact point, the surface normal there and
   * how deep the body is into it. Null when nothing is under it.
   */
  private groundContact(physics: PhysicsWorld, point: THREE.Vector3, normal: THREE.Vector3): number | null {
    // the lowest point straight down first, then again across the slope's own normal
    normal.set(0, 1, 0);
    for (let pass = 0; pass < 2; pass++) {
      this.support(_c.copy(normal).negate(), point);
      const g = physics.groundHeight(point.x, point.z, point.y + 0.3);
      if (g === -Infinity) return null;
      const terrain = physics.heightAt && Math.abs(physics.heightAt(point.x, point.z) - g) < 1e-3;
      if (terrain) normal.copy(physics.groundNormal(point.x, point.z));
      else normal.set(0, 1, 0);
      if (pass === 1) return (g - point.y) * normal.y;
    }
    return null;
  }

  /** resolve one contact: push out by `depth` along `n`, then impulses at `p` */
  private contact(p: THREE.Vector3, n: THREE.Vector3, depth: number): void {
    this.touching = true;
    this.center.addScaledVector(n, depth);
    _r.copy(p).sub(this.center);
    // velocity of the contact point
    const vAt = (out: THREE.Vector3): THREE.Vector3 => out.copy(this.omega).cross(_r).add(this.vel);
    vAt(_a);
    const vn = _a.dot(n);
    if (vn >= 0) return;
    // normal impulse, with the ellipsoid's inertia about the contact
    _w.copy(_r).cross(n);
    this.invInertia(_w).cross(_r);
    const kn = 1 + n.dot(_w);
    const e = -vn > RB_BOUNCE_MIN ? RB_BOUNCE : 0;
    const jn = (-(1 + e) * vn) / kn;
    this.applyImpulse(_j.copy(n).multiplyScalar(jn));
    // friction: oppose the contact's slide, no more than μ·jn — this is what
    // turns a skid into a roll
    vAt(_a);
    _b.copy(_a).addScaledVector(n, -_a.dot(n));
    const vt = _b.length();
    if (vt < 1e-6) return;
    _b.multiplyScalar(1 / vt);
    _w.copy(_r).cross(_b);
    this.invInertia(_w).cross(_r);
    const kt = 1 + _b.dot(_w);
    const jt = Math.min(vt / kt, RB_FRICTION * jn);
    this.applyImpulse(_j.copy(_b).multiplyScalar(-jt));
  }

  private applyImpulse(j: THREE.Vector3): void {
    this.vel.add(j);
    this.omega.add(this.invInertia(_w.copy(_r).cross(j)));
  }

  private integrate(dt: number): void {
    this.center.addScaledVector(this.vel, dt);
    const w = this.omega;
    const ang = w.length() * dt;
    if (ang > 1e-9) {
      _qb.setFromAxisAngle(_c.copy(w).normalize(), ang);
      this.rot.premultiply(_qb).normalize();
    }
  }

  private collide(physics: PhysicsWorld, ground = true): void {
    this.touching = false;
    // the ground
    const depth = ground ? this.groundContact(physics, _s, _n) : null;
    if (depth !== null && depth > 0) this.contact(_s, _n, depth);
    // the scenery: points over the ellipsoid's surface, each pushed out of
    // anything solid, the deepest of them resolved as a contact
    let best = 0;
    for (const d of this.probes) {
      _a.copy(d).set(_a.x * this.semi.x, _a.y * this.semi.y, _a.z * this.semi.z)
        .applyQuaternion(this.rot).add(this.center);
      _b.copy(_a);
      if (!physics.pushOutPoint(_b, 0, this.near)) continue;
      const push = _b.distanceTo(_a);
      if (push <= best) continue;
      best = push;
      _s.copy(_a);
      _n.copy(_b).sub(_a).multiplyScalar(1 / push);
    }
    if (best > 0) this.contact(_s, _n, best);
  }

  private simStep(dt: number, physics: PhysicsWorld): void {
    this.vel.y -= GRAVITY * dt;
    this.integrate(dt);
    this.collide(physics);
    // drag: a little in the air, more on the ground — sand eats a roll
    const air = Math.exp(-RB_AIR_DRAG * dt);
    this.vel.multiplyScalar(air);
    this.omega.multiplyScalar(air);
    if (this.touching) {
      const roll = Math.exp(-RB_ROLL_DRAG * dt);
      this.omega.multiplyScalar(roll);
      _a.copy(this.longAxis).applyQuaternion(this.rot);
      if (Math.abs(_a.y) < RB_LYING) {
        const size = (this.semi.x + this.semi.y + this.semi.z) / 3;
        const w = this.omega.length();
        const cut = (RB_ROLL_RESIST / size) * dt;
        this.omega.multiplyScalar(w > cut ? (w - cut) / w : 0);
      }
      const drag = Math.exp(-RB_CONTACT_DRAG * dt);
      this.vel.x *= drag;
      this.vel.z *= drag;
    }
    const slow = this.touching && this.vel.length() < RB_SLEEP_V && this.omega.length() < RB_SLEEP_W;
    this.quiet = slow ? this.quiet + dt : 0;
    if (this.quiet >= RB_SLEEP_TIME || this.time >= RB_MAX_TIME) this.beginSettle(physics);
  }

  /**
   * The body has stopped. If it is lying the way a rounded body lies — one of
   * its two shorter axes square to the ground — that is the end of it.
   * Anything else (balanced on an end against a wall, or simply out of time)
   * is eased onto the nearest such orientation.
   */
  private beginSettle(physics: PhysicsWorld): void {
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    const up = this.groundContact(physics, _s, _n) !== null ? _n.clone() : _UP.clone();
    // the longest axis never stands up: candidates are the two shorter ones
    const s = this.semi;
    const order = [0, 1, 2].sort((i, j) => s.getComponent(i) - s.getComponent(j));
    let bestAngle = Infinity;
    for (const i of order.slice(0, 2)) {
      for (const sign of [1, -1]) {
        _a.copy(AXES[i]).multiplyScalar(sign).applyQuaternion(this.rot);
        const angle = _a.angleTo(up);
        if (angle < bestAngle) {
          bestAngle = angle;
          _qc.setFromUnitVectors(_a, up).multiply(this.rot);
        }
      }
    }
    // Lying already: stay as it lies, and only the placement below is eased.
    // Anything else is turned onto the nearest lying orientation.
    this.settleFrom = this.rot.clone();
    if (bestAngle <= RB_SETTLE_SLACK) this.settleTo.copy(this.rot);
    else this.settleTo.copy(_qc).normalize();
    this.settleT = 0;
  }

  /** the final ease: turn onto the lying orientation, keeping the body on the ground */
  private settleStep(dt: number, physics: PhysicsWorld): void {
    this.settleT = Math.min(1, this.settleT + dt / RB_SETTLE_TIME);
    const k = this.settleT * this.settleT * (3 - 2 * this.settleT);
    this.rot.slerpQuaternions(this.settleFrom!, this.settleTo, k);
    // Rest on the ground: the ellipsoid onto it, then the body down by however
    // much of the ellipsoid under it is not flesh. The rounded shape is what
    // rolls; the drawn body is what lies on the sand, and a spider resting on
    // its curled legs, or a broad one on its side, has air under the
    // ellipsoid's lowest point that would otherwise read as floating.
    const depth = this.groundContact(physics, _s, _n);
    if (depth !== null) {
      this.center.addScaledVector(_n, depth);
      this.center.addScaledVector(_n, -this.fleshGap(_n) * k);
    }
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.collide(physics, false);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    if (this.settleT >= 1) {
      this.settleFrom = null;
      this.active = false;
      this.layOnTerrain(physics);
    }
  }

  /**
   * How far the drawn body's lowest point along `-n` sits above the
   * ellipsoid's: zero for a body with no points, never negative (the ellipsoid
   * is never pushed further into the ground than it already is).
   */
  private fleshGap(n: THREE.Vector3): number {
    if (!this.cloud.length) return 0;
    _c.copy(n).negate();
    const shell = this.support(_c, _b).sub(this.center).dot(_c);
    let flesh = -Infinity;
    for (const p of this.cloud) flesh = Math.max(flesh, _a.copy(p).applyQuaternion(this.rot).dot(_c));
    return Math.max(0, shell - flesh);
  }

  /**
   * The last word on height, against the real ground under every part of the
   * drawn body rather than the plane at one contact: lower (or raise) it until
   * its lowest point just touches. A body the size of the broodmother spans
   * enough dune that the plane alone leaves a hand's width of air under her.
   */
  private layOnTerrain(physics: PhysicsWorld): void {
    if (!this.cloud.length) return;
    let gap = Infinity;
    for (const p of this.cloud) {
      _a.copy(p).applyQuaternion(this.rot).add(this.center);
      const g = physics.groundHeight(_a.x, _a.z, _a.y + 0.3);
      if (g > -Infinity) gap = Math.min(gap, _a.y - g);
    }
    // never more than the ellipsoid's own size: a cliff edge is not a correction
    const most = Math.min(this.semi.x, this.semi.y, this.semi.z);
    if (Number.isFinite(gap)) this.center.y -= THREE.MathUtils.clamp(gap, -most, most);
  }

  /** Carry the simulated body back onto the character. */
  private drive(): void {
    this.node.quaternion.copy(this.rot);
    _v.copy(this.originOffset).applyQuaternion(this.rot);
    this.node.position.copy(this.center).add(_v);
    this.node.updateMatrixWorld(true);
  }
}

const _lo = new THREE.Vector3();
const _hi = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _inv = new THREE.Quaternion();
