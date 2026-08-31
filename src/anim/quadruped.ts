import * as THREE from 'three';

/**
 * Gait clips for the creatures on their own free-form rigs — the war massiff,
 * the krykna spiders, the interceptor drone. Nothing here touches the
 * canonical humanoid rig.
 *
 * The massiff is not on our canonical humanoid rig — it is a quadruped with
 * four legs on a 44-bone Rigify skeleton — so nothing in `clips.ts` reaches it
 * and the retargeter has nothing to say to it. Its model also ships no
 * animation of its own, so these are what move it.
 *
 * Two things make this different from `clips.ts`:
 *
 *  - Our biped clips are authored against a rest pose of all-identity
 *    rotations, so a clip quaternion *is* the local rotation. This skeleton
 *    has real rest rotations baked in — a thigh already points down and out —
 *    so every value here is `rest * delta`, and the clips have to be built
 *    once the model is loaded and its rest pose can be read.
 *  - Every bone runs along its local +Y (Blender's convention), so a rotation
 *    about local X swings a limb fore and aft, which is the whole of a gait.
 *    *Which* way it swings is not a constant, though: on the boss rigs
 *    positive X carries a leg backward, and on the massiff and the spiders the
 *    same rotation carries it forward. This file used to assert the first as a
 *    universal rule, and the massiff duly galloped backwards. So nothing here
 *    assumes it any more — `swing` and `fold` take the motion the gait wants
 *    (forward-positive, and fold-positive for "draw the foot up toward the
 *    hip") and measure the rig to find the local sign that produces it.
 *
 * If the model is ever re-exported with real animation baked in, those win:
 * the loader only falls back to these when the file carries none.
 */

const D = Math.PI / 180;

/** Bone names arrive with their dots stripped — see `norm` in authored.ts. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const flat = name.replace(/\./g, '');
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => { if (!hit && (o.name === name || o.name === flat)) hit = o; });
  return hit;
}

/**
 * The bone's own tip, in its local frame: bones run along +Y, as far as the
 * child sitting on the end of them. A bone with no child (the last segment of
 * a leg on several of the rigs) is assumed to be about as long as the step
 * that placed it, which is close enough to measure a direction with.
 */
function tipOf(bone: THREE.Object3D): THREE.Vector3 {
  const kid = bone.children.find((c) => (c as THREE.Bone).isBone) ?? bone.children[0];
  const len = (kid ? kid.position.length() : bone.position.length()) || 1;
  return new THREE.Vector3(0, len, 0);
}

/** where this bone's tip ends up in world space with `deg` of local X on top of its rest */
function tipAt(bone: THREE.Object3D, tip: THREE.Vector3, deg: number): THREE.Vector3 {
  const rest = bone.quaternion.clone();
  bone.quaternion.multiply(_probe.setFromEuler(_probeE.set(deg * D, 0, 0)));
  bone.updateWorldMatrix(true, false);
  const out = tip.clone().applyMatrix4(bone.matrixWorld);
  bone.quaternion.copy(rest);
  bone.updateWorldMatrix(true, false);
  return out;
}

const _probe = new THREE.Quaternion();
const _probeE = new THREE.Euler();

/**
 * Does a positive local-X rotation carry this bone *forward*?
 *
 * Every model in the game faces +Z, so "forward" is a question about world Z,
 * and the rig answers it: swing the bone's tip and see which way it went. The
 * boss rigs say -1 and the massiff and spiders say +1 — which is exactly the
 * assumption this file used to hard-code, and exactly why the massiff ran
 * backwards.
 */
function swingSign(bone: THREE.Object3D): number {
  const tip = tipOf(bone);
  return tipAt(bone, tip, 15).z >= tipAt(bone, tip, -15).z ? 1 : -1;
}

/**
 * Which way this joint folds: the sign that draws its tip in toward the root
 * of the limb, shortening it so the foot clears the ground on the way through.
 * Measured the same way — the leg's effective length is the distance from the
 * segment's parent (the hip, for a knee) to the tip, and folding is whichever
 * direction makes that smaller.
 */
function foldSign(bone: THREE.Object3D): number {
  if (!bone.parent) return 1;
  const tip = tipOf(bone);
  const hip = bone.parent.getWorldPosition(new THREE.Vector3());
  return tipAt(bone, tip, 25).distanceTo(hip) <= tipAt(bone, tip, -25).distanceTo(hip) ? 1 : -1;
}

interface Builder {
  /** rotate `bone` by these XYZ degrees at these times, on top of its rest pose */
  rot: (name: string, times: number[], degrees: Array<[number, number, number]>) => void;
  /**
   * Swing `bone` fore and aft, in degrees that mean the same thing on every
   * rig: positive is forward, the way the animal is facing.
   */
  swing: (name: string, times: number[], degrees: number[]) => void;
  /** Fold `bone` up under the body — positive draws its tip toward the limb's root. */
  fold: (name: string, times: number[], degrees: number[]) => void;
  /** bob `bone` vertically (world metres) around its rest position at these times */
  lift: (name: string, times: number[], metres: number[]) => void;
  tracks: THREE.KeyframeTrack[];
}

function builder(root: THREE.Object3D): Builder {
  const tracks: THREE.KeyframeTrack[] = [];
  const rotBone = (bone: THREE.Object3D, times: number[], degrees: Array<[number, number, number]>) => {
    const rest = bone.quaternion.clone();
    const values: number[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const [x, y, z] of degrees) {
      q.copy(rest).multiply(new THREE.Quaternion().setFromEuler(e.set(x * D, y * D, z * D)));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  };
  const rot: Builder['rot'] = (name, times, degrees) => {
    const bone = findBone(root, name);
    if (!bone) return;                      // a rig without this bone just misses that motion
    rotBone(bone, times, degrees);
  };
  const swing: Builder['swing'] = (name, times, degrees) => {
    const bone = findBone(root, name);
    if (!bone) return;
    const sign = swingSign(bone);
    rotBone(bone, times, degrees.map((v): [number, number, number] => [v * sign, 0, 0]));
  };
  const fold: Builder['fold'] = (name, times, degrees) => {
    const bone = findBone(root, name);
    if (!bone) return;
    const sign = foldSign(bone);
    rotBone(bone, times, degrees.map((v): [number, number, number] => [v * sign, 0, 0]));
  };
  // A position track lives in the bone's parent space, whose axes need not be
  // world-aligned (the exporter's Y-up fix sits on an ancestor) — so world-up
  // is carried back into that space and scaled from metres to local units.
  const lift: Builder['lift'] = (name, times, metres) => {
    const bone = findBone(root, name);
    if (!bone || !bone.parent) return;
    bone.updateWorldMatrix(true, false);
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const ws = bone.parent.getWorldScale(new THREE.Vector3()).y || 1;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(parentQ.invert()).normalize().divideScalar(ws);
    const values: number[] = [];
    for (const m of metres) {
      values.push(
        bone.position.x + up.x * m,
        bone.position.y + up.y * m,
        bone.position.z + up.z * m,
      );
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, values));
  };
  return { rot, swing, fold, lift, tracks };
}

/** the four legs, and how far through the cycle each one plants */
const LEGS = [
  { thigh: 'DEF-front_thigh.L', shin: 'DEF-front_shin.L', foot: 'DEF-front_foot.L', phase: 0 },
  { thigh: 'DEF-front_thigh.R', shin: 'DEF-front_shin.R', foot: 'DEF-front_foot.R', phase: 0.12 },
  { thigh: 'DEF-thigh.L', shin: 'DEF-shin.L', foot: 'DEF-foot.L', phase: 0.52 },
  { thigh: 'DEF-thigh.R', shin: 'DEF-shin.R', foot: 'DEF-foot.R', phase: 0.64 },
] as const;

/** sample a cycle at `steps` even points, wrapping the phase */
function cycle(steps: number, phase: number, f: (t: number) => number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(f((i / steps + phase) % 1));
  return out;
}

const GALLOP = 0.5;   // seconds per stride

/**
 * Samples per cycle.
 *
 * This was 8, which is where the gaits got their shudder: a stride is a
 * piecewise curve — planted, then whipped through — and eight evenly spaced
 * samples land nowhere near the corner between the two, so each leg planted at
 * a slightly wrong time at a slightly wrong angle and the body bob (two per
 * stride, so *four* samples an oscillation) aliased into a jitter. Sampling
 * finely enough to resolve the shape costs a few dozen keyframes per clip and
 * nothing at all at runtime.
 */
const STEPS = 24;

/**
 * One leg's stride at phase `t`, in terms every rig understands: where the
 * limb is fore and aft (forward-positive degrees) and how far it is folded up.
 *
 * The first `stance` of the cycle is planted — the body travels over a fixed
 * foot at a constant speed, so the limb sweeps from its forward reach to its
 * back extreme at a constant rate, and the leg stays long to carry the weight.
 * The rest is airborne: the limb eases forward again to catch the next stride,
 * folding at mid-swing so the foot clears the ground rather than dragging
 * through it. Easing the airborne half is what keeps the whip from snapping.
 */
function stride(t: number, stance: number, reach: number, fold: number): { swing: number; fold: number } {
  if (t < stance) return { swing: reach * (1 - 2 * (t / stance)), fold: 0 };
  const u = (t - stance) / (1 - stance);
  // The fold peaks early and is gone by three-quarters through, which is what
  // a leg actually does: gather the moment it leaves the ground, then extend
  // into the reach before it lands. Folded symmetrically about mid-swing it
  // instead drew the foot back exactly as hard as the swing carried it
  // forward, and the front paw hung in place while the leg passed under it.
  return {
    swing: reach * (1 - 2 * Math.cos(u * Math.PI * 0.5) ** 2),
    fold: fold * Math.sin(Math.PI * Math.min(1, u * 1.4)),
  };
}

/**
 * A transverse gallop: the front pair reaches, the rear pair gathers and
 * drives, and the back flexes between them. Front and rear are half a cycle
 * apart, and left leads right by a beat, which is what stops it reading as a
 * pantomime horse.
 */
function gallop(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * GALLOP);

  // A leg spends the first half of its cycle planted and the second half in
  // the air. Nothing moves the body up and down — the enemy's own position
  // does that — so the stance half has to hold the foot at the height it rests
  // at, or the animal prances along above the ground it is supposed to be
  // pushing off.
  const STANCE = 0.55;
  for (const leg of LEGS) {
    b.swing(leg.thigh, times, cycle(STEPS, leg.phase, (t) => stride(t, STANCE, 22, 0).swing));
    // barely bent under load, folding right up to clear on the way through
    b.fold(leg.shin, times, cycle(STEPS, leg.phase, (t) => {
      const s = stride(t, STANCE, 22, 42);
      return s.fold + (t < STANCE ? 4 + 8 * Math.sin((t / STANCE) * Math.PI) : 10);
    }));
    b.fold(leg.foot, times, cycle(STEPS, leg.phase, (t) => 6 + stride(t, STANCE, 22, 20).fold));
  }

  // the back bunches and extends twice per stride, which is what sells a bound
  const arch = cycle(STEPS, 0, (t) => 7 * Math.sin(t * Math.PI * 4));
  b.rot('DEF-spine.002', times, arch.map((v) => [v, 0, 0]));
  b.rot('DEF-spine.003', times, arch.map((v) => [v * 0.8, 0, 0]));
  b.rot('DEF-spine.004', times, arch.map((v) => [-v * 0.7, 0, 0]));
  // head drives forward and steadies, counter to the shoulders
  const head = cycle(STEPS, 0, (t) => -5 - 6 * Math.sin(t * Math.PI * 2));
  b.rot('DEF-spine.007', times, head.map((v) => [v * 0.5, 0, 0]));
  b.rot('DEF-spine.008', times, head.map((v) => [v * 0.7, 0, 0]));
  b.rot('DEF-spine.009', times, head.map((v) => [v, 0, 0]));

  // The whole mass rises and falls with the bound — twice per stride, timed
  // to the rear pair's drive. The enemy root never bobs (it carries the clip
  // instead), and without this the beast galloped on a dead-level spine and
  // read as a prop on wheels.
  b.lift('DEF-spine', times, cycle(STEPS, 0.1, (t) => Math.abs(Math.sin(t * Math.PI * 2)) * 0.09 - 0.03));

  return new THREE.AnimationClip('gallop', GALLOP, b.tracks);
}

/**
 * A four-beat lateral walk for the approach: LH, LF, RH, RF at quarter-cycle
 * offsets, long stance, small lift. Below ~2.5 m/s the gallop played at 0.4x
 * was slow motion, not stalking; this is the gait the massiff hunts in.
 */
const WALK = 1.1;   // seconds per stride

function walk(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * WALK);
  const WALK_LEGS = [
    { thigh: 'DEF-front_thigh.L', shin: 'DEF-front_shin.L', foot: 'DEF-front_foot.L', phase: 0.25 },
    { thigh: 'DEF-front_thigh.R', shin: 'DEF-front_shin.R', foot: 'DEF-front_foot.R', phase: 0.75 },
    { thigh: 'DEF-thigh.L', shin: 'DEF-shin.L', foot: 'DEF-foot.L', phase: 0 },
    { thigh: 'DEF-thigh.R', shin: 'DEF-shin.R', foot: 'DEF-foot.R', phase: 0.5 },
  ] as const;
  const STANCE = 0.72;   // a walk keeps most feet down most of the time
  for (const leg of WALK_LEGS) {
    b.swing(leg.thigh, times, cycle(STEPS, leg.phase, (t) => stride(t, STANCE, 13, 0).swing));
    b.fold(leg.shin, times, cycle(STEPS, leg.phase, (t) => {
      const s = stride(t, STANCE, 13, 26);
      return s.fold + (t < STANCE ? 3 + 3 * Math.sin((t / STANCE) * Math.PI) : 6);
    }));
    b.fold(leg.foot, times, cycle(STEPS, leg.phase, (t) => 4 + stride(t, STANCE, 13, 12).fold));
  }
  // weight rolls side to side over the planted pair, and the head prowls low
  const sway = cycle(STEPS, 0, (t) => 2.5 * Math.sin(t * Math.PI * 2));
  b.rot('DEF-spine.003', times, sway.map((v) => [0, 0, v]));
  b.rot('DEF-spine.004', times, sway.map((v) => [0, 0, -v * 0.6]));
  const prowl = cycle(STEPS, 0.3, (t) => Math.sin(t * Math.PI * 2));
  b.rot('DEF-spine.008', times, prowl.map((v) => [-3 + v * 2, v * 3, 0]));
  b.rot('DEF-spine.009', times, prowl.map((v) => [-4 + v * 3, v * 4, 0]));
  b.lift('DEF-spine', times, cycle(STEPS, 0.05, (t) => Math.abs(Math.sin(t * Math.PI * 2)) * 0.03 - 0.01));
  return new THREE.AnimationClip('walk', WALK, b.tracks);
}

/** Standing: breathing through the ribs, a slow head sway, weight shifting. */
function idle(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const DUR = 3.4;
  const times = Array.from({ length: 9 }, (_, i) => (i / 8) * DUR);
  const wave = (amp: number, cycles: number, off = 0) =>
    Array.from({ length: 9 }, (_, i) => amp * Math.sin((i / 8) * Math.PI * 2 * cycles + off));

  const breath = wave(2.4, 1);
  b.rot('DEF-spine.003', times, breath.map((v) => [v, 0, 0]));
  b.rot('DEF-spine.004', times, breath.map((v) => [-v, 0, 0]));
  b.rot('DEF-spine.005', times, breath.map((v) => [-v * 0.6, 0, 0]));

  // head casting slowly side to side, dipping as it turns
  const sway = wave(9, 1, 0.7);
  const dip = wave(3.5, 2, 0.7);
  b.rot('DEF-spine.007', times, sway.map((v, i) => [dip[i] * 0.4, v * 0.35, 0]));
  b.rot('DEF-spine.008', times, sway.map((v, i) => [dip[i] * 0.6, v * 0.5, 0]));
  b.rot('DEF-spine.009', times, sway.map((v, i) => [dip[i], v * 0.7, 0]));

  // weight rocking between the forelegs
  const shift = wave(3.2, 1, 1.4);
  b.rot('DEF-front_thigh.L', times, shift.map((v) => [v, 0, 0]));
  b.rot('DEF-front_thigh.R', times, shift.map((v) => [-v, 0, 0]));

  return new THREE.AnimationClip('idle', DUR, b.tracks);
}

// ---------- attacks: the coil-and-strike every creature shares ----------
//
// One shape covers all of them: a short coil (the mass gathers, the head or
// limbs draw back) and then the strike, snapping through to the far side of
// rest before recovering. Enemy AI wind-ups and the player controller both
// time the damage to land around the strike frame (~55% of the clip), which
// is exactly where these clips put the hit.

interface StrikeSpec {
  dur: number;
  /** per bone: degrees at the coil, degrees at the strike (rest at both ends) */
  bones: Array<{ name: string; coil: [number, number, number]; hit: [number, number, number] }>;
  /** optional body bob: metres at the coil and at the strike */
  lift?: { bone: string; coil: number; hit: number };
}

function strikeClip(root: THREE.Object3D, spec: StrikeSpec): THREE.AnimationClip {
  const b = builder(root);
  const t = [0, spec.dur * 0.3, spec.dur * 0.55, spec.dur];
  const zero: [number, number, number] = [0, 0, 0];
  for (const bone of spec.bones) b.rot(bone.name, t, [zero, bone.coil, bone.hit, zero]);
  if (spec.lift) b.lift(spec.lift.bone, t, [0, spec.lift.coil, spec.lift.hit, 0]);
  return new THREE.AnimationClip('attack', spec.dur, b.tracks);
}

/** The massiff's lunge-bite: the neck coils up and back, then drives forward and down. */
function massiffAttack(root: THREE.Object3D): THREE.AnimationClip {
  return strikeClip(root, {
    dur: 0.6,
    bones: [
      { name: 'DEF-spine.007', coil: [10, 0, 0], hit: [-14, 0, 0] },
      { name: 'DEF-spine.008', coil: [14, 0, 0], hit: [-20, 0, 0] },
      { name: 'DEF-spine.009', coil: [16, 0, 0], hit: [-26, 0, 0] },
      { name: 'DEF-spine.004', coil: [8, 0, 0], hit: [-10, 0, 0] },
      // the forelegs brace back as the chest rises, then plant into the bite
      { name: 'DEF-front_thigh.L', coil: [18, 0, 0], hit: [-10, 0, 0] },
      { name: 'DEF-front_thigh.R', coil: [18, 0, 0], hit: [-10, 0, 0] },
    ],
    lift: { bone: 'DEF-spine', coil: 0.08, hit: -0.05 },
  });
}

export function massiffClips(root: THREE.Object3D): THREE.AnimationClip[] {
  return [idle(root), walk(root), gallop(root), massiffAttack(root)];
}


// ---------- krykna: eight-legged skitter on the authored spider rig ----------
//
// The authored spiders carry leg roots legL1..legL4 / legR1..legR4, each with
// a _mid joint below it, plus `body` and `head` — the node names the model
// brief asked for. Same conventions as the massiff: rest rotations are baked,
// bones run along local +Y, X swings a limb fore and aft.

/**
 * Alternating tetrapod: two sets of four legs, half a cycle apart — but each
 * leg inside a tetrad lands a few hundredths early or late. Locked at exactly
 * 0 / 0.5 the eight feet struck in two metronome beats and the whole animal
 * read as a wind-up toy; the ripple is what makes it read as alive.
 */
const SPIDER_LEGS = [
  { root: 'legL1', phase: 0 }, { root: 'legR1', phase: 0.55 },
  { root: 'legL2', phase: 0.47 }, { root: 'legR2', phase: 0.06 },
  { root: 'legL3', phase: 0.94 }, { root: 'legR3', phase: 0.5 },
  { root: 'legL4', phase: 0.42 }, { root: 'legR4', phase: 0.97 },
] as const;

const SKITTER = 0.45;   // seconds per cycle

function spiderMove(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * SKITTER);
  for (const leg of SPIDER_LEGS) {
    // fore-aft swing on the leg root, and a fold at mid-swing so the tip
    // clears the ground on the way forward instead of dragging through it
    b.swing(leg.root, times, cycle(STEPS, leg.phase, (t) => stride(t, 0.6, 20, 0).swing));
    b.fold(`${leg.root}_mid`, times, cycle(STEPS, leg.phase, (t) => {
      const s = stride(t, 0.6, 20, 16);
      return s.fold + (t < 0.6 ? -4 : 0);   // pressed out under load, folded up to clear
    }));
  }
  // the carapace rides the churn of the legs — a small, fast bob
  b.lift('body', times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 4) * 0.02));
  return new THREE.AnimationClip('move', SKITTER, b.tracks);
}

function spiderIdle(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const DUR = 2.8;
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * DUR);
  for (const leg of SPIDER_LEGS) {
    b.swing(leg.root, times, cycle(STEPS, leg.phase, (t) => Math.sin(t * Math.PI * 2) * 2.5));
  }
  b.rot('head', times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 2) * 6).map((v) => [0, v, 0]));
  return new THREE.AnimationClip('idle', DUR, b.tracks);
}

/**
 * The spider's strike: rear up on the back legs, front pair raised, then slam
 * them down with the head driving in. Front legs are the L1/R1 pair (the hips
 * sit furthest along +z), with the second pair joining softer.
 */
function spiderAttack(root: THREE.Object3D): THREE.AnimationClip {
  return strikeClip(root, {
    dur: 0.55,
    bones: [
      { name: 'legL1', coil: [-55, 0, 0], hit: [20, 0, 0] },
      { name: 'legR1', coil: [-55, 0, 0], hit: [20, 0, 0] },
      { name: 'legL1_mid', coil: [-45, 0, 0], hit: [12, 0, 0] },
      { name: 'legR1_mid', coil: [-45, 0, 0], hit: [12, 0, 0] },
      { name: 'legL2', coil: [-25, 0, 0], hit: [8, 0, 0] },
      { name: 'legR2', coil: [-25, 0, 0], hit: [8, 0, 0] },
      { name: 'head', coil: [-10, 0, 0], hit: [18, 0, 0] },
    ],
    lift: { bone: 'body', coil: 0.14, hit: -0.06 },
  });
}

export function kryknaClips(root: THREE.Object3D): THREE.AnimationClip[] {
  return [spiderIdle(root), spiderMove(root), spiderAttack(root)];
}

// ---------- interceptor drone: hover bob and dangling arms ----------
//
// One looping idle is the whole performance — the dive, the orbit and every
// other motion is the enemy controller moving the root.

export function droneClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const b = builder(root);
  const DUR = 3.6;
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * DUR);
  for (let i = 1; i <= 5; i++) {
    b.rot(`arm${i}`, times, cycle(STEPS, i / 5, (t) => Math.sin(t * Math.PI * 2) * 7).map((v) => [v, 0, v * 0.4]));
  }
  b.rot('body', times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 2) * 9).map((v) => [0, v, 0]));
  // the hover bob is a position track on the body, in its own local units
  const body = findBone(root, 'body');
  if (body) {
    const ws = body.getWorldScale(new THREE.Vector3()).y || 1;
    const amp = 0.03 / ws;
    const values: number[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      values.push(body.position.x, body.position.y + Math.sin(t * Math.PI * 2) * amp, body.position.z);
    }
    b.tracks.push(new THREE.VectorKeyframeTrack(`${body.name}.position`, times, values));
  }
  return [new THREE.AnimationClip('idle', DUR, b.tracks)];
}

// ---------- monster bosses: gaits for the four creature rigs ----------
//
// The boss sculpts (docs/BOSSES.md) ship the node names their briefs asked for
// and no animation, so — like the massiff and the spiders — these are what move
// them. They are big, slow animals: the amplitudes here are smaller in degrees
// than the massiff's and read larger on screen, because the limbs are metres
// long rather than tens of centimetres.
//
// Each set is one `idle` and one `move`, which is the contract the creature
// builder blends between (`clipStride` rate-matches `move` to ground speed).

/** the mudhorn's and ravinak's legs share a naming shape: `<leg>` over `<leg>_lower` */
function legPairs(prefix: string): Array<{ root: string; phase: number }> {
  return [
    { root: `${prefix}FL`, phase: 0 },
    { root: `${prefix}FR`, phase: 0.5 },
    { root: `${prefix}BL`, phase: 0.55 },
    { root: `${prefix}BR`, phase: 0.05 },
  ];
}

/**
 * A heavy walk on a four-legged rig with one joint per leg: the upper segment
 * swings fore and aft, the lower folds on the forward half so the foot clears.
 * Diagonal pairs, which is what a walking quadruped of this weight does.
 */
function heavyWalk(
  root: THREE.Object3D, prefix: string, dur: number,
  swing: number, fold: number, bodyBone: string, bob: number,
): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * dur);
  // Stance is the long half of a heavy walk: three feet down while the fourth
  // swings. The fold belongs to that airborne quarter and nowhere else — as a
  // plain sine against a plain sine it sat a quarter-cycle out, folding the
  // leg while it was planted and straightening it while it was in the air.
  for (const leg of legPairs(prefix)) {
    b.swing(leg.root, times, cycle(STEPS, leg.phase, (t) => stride(t, 0.7, swing, 0).swing));
    b.fold(`${leg.root}_lower`, times, cycle(STEPS, leg.phase, (t) => stride(t, 0.7, swing, fold).fold));
  }
  // the mass rides the stride: two bobs per cycle, one per diagonal pair
  b.lift(bodyBone, times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 4) * bob));
  return new THREE.AnimationClip('move', dur, b.tracks);
}

/** Breathing and a slow cast of the head — what a big animal does standing still. */
function beastIdle(
  root: THREE.Object3D, head: string, body: string, dur: number, breath: number,
): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * dur);
  b.rot(body, times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 2) * breath).map((v) => [v, 0, 0]));
  b.rot(head, times, cycle(STEPS, 0.3, (t) => Math.sin(t * Math.PI * 2) * 7).map((v) => [v * 0.4, v, 0]));
  b.rot('jaw', times, cycle(STEPS, 0.15, (t) => 3 + Math.sin(t * Math.PI * 2) * 3).map((v) => [v, 0, 0]));
  return new THREE.AnimationClip('idle', dur, b.tracks);
}

export function mudhornClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const tail = (b: Builder, times: number[], amp: number) => {
    b.rot('tail1', times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 2) * amp).map((v) => [0, v, 0]));
    b.rot('tail2', times, cycle(STEPS, 0.25, (t) => Math.sin(t * Math.PI * 2) * amp).map((v) => [0, v, 0]));
  };
  const move = heavyWalk(root, 'leg', 0.9, 20, 26, 'body', 0.06);
  const idle = beastIdle(root, 'head', 'body', 3.6, 2.2);
  // the tail swats on both clips, at its own tempo
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * 3.6);
  tail(b, times, 9);
  idle.tracks.push(...b.tracks);
  // the gore: head dropped to the horn, then tossed up and through
  const attack = strikeClip(root, {
    dur: 0.8,
    bones: [
      { name: 'head', coil: [24, 0, 0], hit: [-32, 0, 0] },
      { name: 'jaw', coil: [4, 0, 0], hit: [26, 0, 0] },
      { name: 'legFL', coil: [12, 0, 0], hit: [-8, 0, 0] },
      { name: 'legFR', coil: [12, 0, 0], hit: [-8, 0, 0] },
    ],
    lift: { bone: 'body', coil: -0.06, hit: 0.12 },
  });
  return [idle, move, attack];
}

export function ravinakClips(root: THREE.Object3D): THREE.AnimationClip[] {
  // Flippers, not legs: a hauled-out pinniped humps along, so the swing is
  // short and the body carries most of the motion.
  const move = heavyWalk(root, 'flipper', 1.1, 16, 20, 'body1', 0.09);
  const b = builder(move ? root : root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * 1.1);
  // the long body flexes down its length as it hauls
  b.rot('body2', times, cycle(STEPS, 0.15, (t) => Math.sin(t * Math.PI * 2) * 5).map((v) => [v, 0, 0]));
  b.rot('body3', times, cycle(STEPS, 0.3, (t) => Math.sin(t * Math.PI * 2) * 6).map((v) => [v, 0, 0]));
  b.rot('tail', times, cycle(STEPS, 0.45, (t) => Math.sin(t * Math.PI * 2) * 10).map((v) => [0, v, 0]));
  move.tracks.push(...b.tracks);
  // rears back with the mouth wide, then the whole front slams down into the bite
  const attack = strikeClip(root, {
    dur: 0.85,
    bones: [
      { name: 'head', coil: [-16, 0, 0], hit: [26, 0, 0] },
      { name: 'jaw', coil: [32, 0, 0], hit: [4, 0, 0] },
      { name: 'body2', coil: [-8, 0, 0], hit: [10, 0, 0] },
      { name: 'flipperFL', coil: [14, 0, 0], hit: [-10, 0, 0] },
      { name: 'flipperFR', coil: [14, 0, 0], hit: [-10, 0, 0] },
    ],
    lift: { bone: 'body1', coil: 0.12, hit: -0.08 },
  });
  return [beastIdle(root, 'head', 'body1', 4.2, 2.6), move, attack];
}

export function mamacoreClips(root: THREE.Object3D): THREE.AnimationClip[] {
  // A fish has no gait: both clips are the same travelling wave down the body,
  // the move clip simply harder and faster. `clipStride` does the rest.
  const swim = (name: string, dur: number, amp: number): THREE.AnimationClip => {
    const b = builder(root);
    const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * dur);
    // the wave runs nose to tail, so each segment lags the one ahead of it
    const seg = ['body1', 'body2', 'body3', 'body4', 'body5', 'tailFin'];
    seg.forEach((bone, i) => {
      b.rot(bone, times, cycle(STEPS, -i * 0.12, (t) => Math.sin(t * Math.PI * 2) * amp * (0.5 + i * 0.14))
        .map((v) => [0, v, 0]));
    });
    for (const fin of ['finL', 'finR']) {
      b.rot(fin, times, cycle(STEPS, 0.2, (t) => Math.sin(t * Math.PI * 2) * amp * 0.8).map((v) => [v, 0, 0]));
    }
    b.rot('jaw', times, cycle(STEPS, 0, (t) => 4 + Math.sin(t * Math.PI * 2) * 4).map((v) => [v, 0, 0]));
    return new THREE.AnimationClip(name, dur, b.tracks);
  };
  // the lunge-bite: the body whips forward down its length, jaws thrown wide
  // through the coil and snapped shut on the strike
  const attack = strikeClip(root, {
    dur: 0.75,
    bones: [
      { name: 'jaw', coil: [42, 0, 0], hit: [4, 0, 0] },
      { name: 'body1', coil: [-10, 0, 0], hit: [14, 0, 0] },
      { name: 'body2', coil: [-6, 0, 0], hit: [10, 0, 0] },
      { name: 'finL', coil: [18, 0, 0], hit: [-12, 0, 0] },
      { name: 'finR', coil: [18, 0, 0], hit: [-12, 0, 0] },
    ],
  });
  return [swim('idle', 4.4, 3.5), swim('move', 1.8, 8), attack];
}

export function rancorClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const gait = (name: string, dur: number, amp: number): THREE.AnimationClip => {
    const b = builder(root);
    const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * dur);
    // legs out of phase with each other, arms counter-swinging to them
    for (const [leg, phase] of [['L', 0], ['R', 0.5]] as const) {
      b.swing(`upperLeg${leg}`, times, cycle(STEPS, phase, (t) => stride(t, 0.62, amp, 0).swing));
      b.fold(`lowerLeg${leg}`, times, cycle(STEPS, phase, (t) => stride(t, 0.62, amp, amp * 1.4).fold));
      const arm = leg === 'L' ? 'R' : 'L';
      b.swing(`upperArm${arm}`, times, cycle(STEPS, phase, (t) => Math.sin(t * Math.PI * 2) * amp * 0.55));
      b.rot(`forearm${arm}`, times, cycle(STEPS, phase, (t) => -amp * 0.4 + Math.sin(t * Math.PI * 2) * amp * 0.3).map((v) => [v, 0, 0]));
    }
    // the hunch rolls with the stride and the tail counterweights it
    b.rot('spine1', times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 4) * amp * 0.18).map((v) => [v, 0, 0]));
    b.rot('spine2', times, cycle(STEPS, 0.1, (t) => Math.sin(t * Math.PI * 2) * amp * 0.25).map((v) => [0, v, 0]));
    b.rot('tail1', times, cycle(STEPS, 0.5, (t) => Math.sin(t * Math.PI * 2) * amp * 0.5).map((v) => [0, v, 0]));
    b.rot('tail2', times, cycle(STEPS, 0.7, (t) => Math.sin(t * Math.PI * 2) * amp * 0.7).map((v) => [0, v, 0]));
    b.rot('head', times, cycle(STEPS, 0.25, (t) => Math.sin(t * Math.PI * 2) * amp * 0.2).map((v) => [v * 0.5, -v, 0]));
    return new THREE.AnimationClip(name, dur, b.tracks);
  };
  // the double overhead slam: both arms hauled up past the shoulders, then
  // driven down and through with the spine pitching into it
  const attack = strikeClip(root, {
    dur: 0.85,
    bones: [
      { name: 'upperArmL', coil: [-75, 0, 0], hit: [38, 0, 0] },
      { name: 'upperArmR', coil: [-75, 0, 0], hit: [38, 0, 0] },
      { name: 'forearmL', coil: [-40, 0, 0], hit: [18, 0, 0] },
      { name: 'forearmR', coil: [-40, 0, 0], hit: [18, 0, 0] },
      { name: 'spine1', coil: [-8, 0, 0], hit: [14, 0, 0] },
      { name: 'head', coil: [-10, 0, 0], hit: [8, 0, 0] },
    ],
  });
  return [gait('idle', 4.0, 3), gait('move', 1.25, 17), attack];
}

// ---------- the two half-buried colossi ----------
//
// The krayt and the mythosaur are only ever *partly* on the surface — the rest
// of the animal is under the sand or the water (docs/BOSSES.md §2.5, §2.6), and
// the creature builder sinks and pitches them to sit that way. So their motion
// is not a gait: there are no legs to walk on, only a body hauling itself
// through the ground it is buried in. Both clips are the same serpentine drive
// down the neck, the move clip harder — the same shape as the mamacore's swim,
// which is the right instinct for an animal that swims through sand.

function serpentine(
  root: THREE.Object3D, name: string, dur: number, amp: number,
  spine: string[], head: string, claws: [string, string] | null,
): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * dur);
  // the wave runs from the buried end forward, so the head is the last to move
  spine.forEach((bone, i) => {
    b.rot(bone, times, cycle(STEPS, -i * 0.1, (t) => Math.sin(t * Math.PI * 2) * amp * (1 - i * 0.1))
      .map((v) => [v * 0.35, v, 0]));
  });
  b.rot(head, times, cycle(STEPS, 0.3, (t) => Math.sin(t * Math.PI * 2) * amp * 0.6).map((v) => [v * 0.5, v, 0]));
  b.rot('jaw', times, cycle(STEPS, 0.1, (t) => 5 + Math.sin(t * Math.PI * 2) * 5).map((v) => [v, 0, 0]));
  if (claws) {
    // the forelimbs claw at the surface, out of phase with each other — this is
    // what it hauls itself forward on
    claws.forEach((claw, i) => {
      b.rot(claw, times, cycle(STEPS, i * 0.5, (t) => Math.sin(t * Math.PI * 2) * amp * 1.4).map((v) => [v, 0, 0]));
    });
  }
  return new THREE.AnimationClip(name, dur, b.tracks);
}

/**
 * A half-buried colossus strikes like a snake: the neck rears away, jaws
 * thrown wide, then plunges down at the ground in front of it with both
 * foreclaws raking in.
 */
function colossusStrike(root: THREE.Object3D, necks: string[], dur: number): THREE.AnimationClip {
  return strikeClip(root, {
    dur,
    bones: [
      ...necks.map((name, i): StrikeSpec['bones'][number] => ({
        name,
        coil: [-8 - i * 4, 0, 0],
        hit: [9 + i * 5, 0, 0],
      })),
      { name: 'head', coil: [-16, 0, 0], hit: [26, 0, 0] },
      { name: 'jaw', coil: [38, 0, 0], hit: [5, 0, 0] },
      { name: 'clawL', coil: [-35, 0, 0], hit: [28, 0, 0] },
      { name: 'clawR', coil: [-35, 0, 0], hit: [28, 0, 0] },
    ],
  });
}

export function kraytClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const spine = ['body6', 'body5', 'body4', 'body3', 'body2', 'body1', 'collar', 'neck1', 'neck2', 'neck3', 'neck4'];
  return [
    serpentine(root, 'idle', 5.2, 3, spine, 'head', ['clawL', 'clawR']),
    serpentine(root, 'move', 2.2, 8, spine, 'head', ['clawL', 'clawR']),
    colossusStrike(root, ['neck1', 'neck2', 'neck3', 'neck4'], 0.95),
  ];
}

export function mythosaurClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const spine = ['back', 'neck1', 'neck2', 'neck3', 'neck4'];
  const clips = [
    serpentine(root, 'idle', 5.6, 2.5, spine, 'head', ['clawL', 'clawR']),
    serpentine(root, 'move', 2.6, 7, spine, 'head', ['clawL', 'clawR']),
  ];
  // the horns swing with the head's weight, a beat behind it
  for (const clip of clips) {
    const b = builder(root);
    const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * clip.duration);
    for (const horn of ['hornL', 'hornR']) {
      b.rot(horn, times, cycle(STEPS, 0.42, (t) => Math.sin(t * Math.PI * 2) * 3).map((v) => [v, 0, 0]));
    }
    clip.tracks.push(...b.tracks);
  }
  clips.push(colossusStrike(root, ['neck1', 'neck2', 'neck3', 'neck4'], 1.05));
  return clips;
}
