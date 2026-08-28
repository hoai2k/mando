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
 *    Positive X swings a leg *backward*.
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

interface Builder {
  /** rotate `bone` by these XYZ degrees at these times, on top of its rest pose */
  rot: (name: string, times: number[], degrees: Array<[number, number, number]>) => void;
  tracks: THREE.KeyframeTrack[];
}

function builder(root: THREE.Object3D): Builder {
  const tracks: THREE.KeyframeTrack[] = [];
  const rot: Builder['rot'] = (name, times, degrees) => {
    const bone = findBone(root, name);
    if (!bone) return;                      // a rig without this bone just misses that motion
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
  return { rot, tracks };
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
const STEPS = 8;

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
    const swing = cycle(STEPS, leg.phase, (t) => (t < STANCE
      // planted: the body travels over a fixed foot, so the thigh sweeps back
      ? -22 + (t / STANCE) * 44
      // airborne: whipped forward again to catch the next stride
      : 22 - ((t - STANCE) / (1 - STANCE)) * 44));
    const flex = cycle(STEPS, leg.phase, (t) => (t < STANCE
      ? 4 + 8 * Math.sin((t / STANCE) * Math.PI)          // barely bent under load
      : 10 + 42 * Math.sin(((t - STANCE) / (1 - STANCE)) * Math.PI)));  // folds up to clear
    const paw = cycle(STEPS, leg.phase, (t) => (t < STANCE
      ? -6
      : -6 - 20 * Math.sin(((t - STANCE) / (1 - STANCE)) * Math.PI)));
    b.rot(leg.thigh, times, swing.map((v) => [v, 0, 0]));
    b.rot(leg.shin, times, flex.map((v) => [v, 0, 0]));
    b.rot(leg.foot, times, paw.map((v) => [v, 0, 0]));
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

  return new THREE.AnimationClip('gallop', GALLOP, b.tracks);
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

export function massiffClips(root: THREE.Object3D): THREE.AnimationClip[] {
  return [idle(root), gallop(root)];
}


// ---------- krykna: eight-legged skitter on the authored spider rig ----------
//
// The authored spiders carry leg roots legL1..legL4 / legR1..legR4, each with
// a _mid joint below it, plus `body` and `head` — the node names the model
// brief asked for. Same conventions as the massiff: rest rotations are baked,
// bones run along local +Y, X swings a limb fore and aft.

/** alternating tetrapod: two sets of four legs, half a cycle apart */
const SPIDER_LEGS = [
  { root: 'legL1', phase: 0 }, { root: 'legR1', phase: 0.5 },
  { root: 'legL2', phase: 0.5 }, { root: 'legR2', phase: 0 },
  { root: 'legL3', phase: 0 }, { root: 'legR3', phase: 0.5 },
  { root: 'legL4', phase: 0.5 }, { root: 'legR4', phase: 0 },
] as const;

const SKITTER = 0.45;   // seconds per cycle

function spiderMove(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * SKITTER);
  for (const leg of SPIDER_LEGS) {
    // fore-aft swing on the leg root, and a lift at mid-swing so the tip
    // clears the ground on the way forward instead of dragging through it
    b.rot(leg.root, times, cycle(STEPS, leg.phase, (t) => Math.sin(t * Math.PI * 2) * 20).map((v) => [v, 0, 0]));
    b.rot(`${leg.root}_mid`, times, cycle(STEPS, leg.phase, (t) => {
      const swing = Math.sin(t * Math.PI * 2);
      return swing > 0 ? -16 * swing : 4 * -swing;   // fold up forward, press back
    }).map((v) => [v, 0, 0]));
  }
  return new THREE.AnimationClip('move', SKITTER, b.tracks);
}

function spiderIdle(root: THREE.Object3D): THREE.AnimationClip {
  const b = builder(root);
  const DUR = 2.8;
  const times = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS) * DUR);
  for (const leg of SPIDER_LEGS) {
    b.rot(leg.root, times, cycle(STEPS, leg.phase, (t) => Math.sin(t * Math.PI * 2) * 2.5).map((v) => [v, 0, 0]));
  }
  b.rot('head', times, cycle(STEPS, 0, (t) => Math.sin(t * Math.PI * 2) * 6).map((v) => [0, v, 0]));
  return new THREE.AnimationClip('idle', DUR, b.tracks);
}

export function kryknaClips(root: THREE.Object3D): THREE.AnimationClip[] {
  return [spiderIdle(root), spiderMove(root)];
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
