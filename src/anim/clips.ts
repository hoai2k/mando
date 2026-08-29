import * as THREE from 'three';
import type { Proportions } from './skeleton';

/**
 * Procedurally authored AnimationClips on the canonical skeleton.
 * Clips are split into LOWER (hips/legs/spine locomotion) and UPPER
 * (chest/arms/head actions) so the animator can layer shooting/melee
 * over any locomotion state. All clips are standard THREE.AnimationClips,
 * so authored clips from a glTF can replace them 1:1.
 *
 * ARM/LEG SPLAY SIGN: the rig's `L` bones sit at -X and `R` at +X, and a
 * positive Z rotation swings a downward-pointing bone toward +X. So a limb
 * spreads *away* from the body on negative Z for `L` and positive Z for `R`.
 * Getting this backwards tucks the arms into the torso, which is invisible on
 * a stick-figure build and clips straight through an authored one.
 *
 * ARM SPLAY AMOUNT: every authored character was sculpted in an A-pose with
 * the upper arm 16-31° out from vertical (mean ~24° — see the rest-pose
 * audit in docs/ANIMATION_AUDIT.md), and the retargeter pulls that rest to
 * straight-down before the clips pose it. Any "arms hanging" clip therefore
 * needs ~19-22° of Z splay or the deltoid/biceps geometry the artist built
 * around the A-pose presses into the torso and the arms read as pinned.
 */

const D = Math.PI / 180;
const euler = (x: number, y: number, z: number) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D));

function qt(bone: string, times: number[], rots: [number, number, number][]): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  for (const [x, y, z] of rots) {
    const q = euler(x, y, z);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

function pt(bone: string, times: number[], pos: [number, number, number][]): THREE.VectorKeyframeTrack {
  const values: number[] = [];
  for (const p of pos) values.push(...p);
  return new THREE.VectorKeyframeTrack(`${bone}.position`, times, values);
}

export interface ClipSet { [name: string]: THREE.AnimationClip; }

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const strideCache = new WeakMap<THREE.AnimationClip, number>();

/**
 * Ground distance one cycle of a locomotion clip covers, in metres.
 *
 * Measured off the clip rather than hand-tuned: run forward kinematics on the
 * leg chain across the cycle and take how far the foot travels, hip-relative,
 * between its most-forward and most-back pose. While a foot is planted the hip
 * travels exactly that far over it, and a cycle has two stances — so that
 * doubled is the distance the clip is "worth". Playing it at
 * speed * duration / distance is what makes the feet push off the ground
 * instead of skating over it.
 *
 * Positive X on a leg bone swings it backward (the bone points down -Y), so
 * the sagittal offset is negated to read forward-positive; only the range
 * matters, but keeping the sign honest makes the maths checkable.
 */
export function cycleDistance(clip: THREE.AnimationClip, p: Proportions): number {
  const cached = strideCache.get(clip);
  if (cached !== undefined) return cached;
  const track = (bone: string) => clip.tracks.find((t) => t.name === `${bone}.quaternion`);
  const upper = track('upperLegL');
  let out = 0;
  if (upper) {
    const upperI = upper.createInterpolant();
    const lowerT = track('lowerLegL');
    const lowerI = lowerT?.createInterpolant();
    const pitch = (buf: ArrayLike<number>): number => {
      _q.set(buf[0], buf[1], buf[2], buf[3]);
      _e.setFromQuaternion(_q, 'XYZ');
      return _e.x;
    };
    let min = Infinity, max = -Infinity;
    const STEPS = 48;
    for (let i = 0; i <= STEPS; i++) {
      const t = (clip.duration * i) / STEPS;
      const thigh = pitch(upperI.evaluate(t));
      const shin = lowerI ? pitch(lowerI.evaluate(t)) : 0;
      const x = -(p.upperLegLen * Math.sin(thigh) + p.lowerLegLen * Math.sin(thigh + shin));
      if (x < min) min = x;
      if (x > max) max = x;
    }
    out = Math.max(0, max - min) * 2;
  }
  strideCache.set(clip, out);
  return out;
}

const clipCache = new Map<string, ClipSet>();
let clipCaching = true;

/**
 * Clips depend on proportions and nothing else, so every character of a species
 * can share one set — building them per spawn meant ~28 clips and ~170
 * keyframe tracks allocated for every enemy in every wave, and defeated the
 * stride cache along with it.
 *
 * The workbench's pose editor rewrites clip tracks in place, which one shared
 * set cannot survive: it turns caching off so each figure gets its own.
 */
export function setClipCaching(on: boolean): void {
  clipCaching = on;
  clipCache.clear();
}

const proportionKey = (p: Proportions): string =>
  `${p.hipHeight},${p.spineLen},${p.chestLen},${p.neckLen},${p.headSize},${p.shoulderWidth},` +
  `${p.upperArmLen},${p.forearmLen},${p.upperLegLen},${p.lowerLegLen},${p.hipWidth}`;

export function buildClips(p: Proportions): ClipSet {
  if (!clipCaching) return makeClips(p);
  const key = proportionKey(p);
  let set = clipCache.get(key);
  if (!set) { set = makeClips(p); clipCache.set(key, set); }
  return set;
}

function makeClips(p: Proportions): ClipSet {
  const hipY = p.hipHeight;
  const clips: ClipSet = {};

  // ---------- LOWER: idle ----------
  clips.idleLower = new THREE.AnimationClip('idleLower', 3, [
    pt('hips', [0, 1.5, 3], [[0, hipY, 0], [0, hipY - 0.015, 0], [0, hipY, 0]]),
    qt('hips', [0, 1.5, 3], [[0, 0, 0], [1, 0, 1], [0, 0, 0]]),
    qt('spine', [0, 1.5, 3], [[2, 0, 0], [3.5, 0, 0], [2, 0, 0]]),
    qt('upperLegL', [0, 3], [[-3, 0, -2], [-3, 0, -2]]),
    qt('upperLegR', [0, 3], [[-3, 0, 2], [-3, 0, 2]]),
    qt('lowerLegL', [0, 3], [[5, 0, 0], [5, 0, 0]]),
    qt('lowerLegR', [0, 3], [[5, 0, 0], [5, 0, 0]]),
  ]);

  // ---------- UPPER: idle ----------
  clips.idleUpper = new THREE.AnimationClip('idleUpper', 3, [
    qt('chest', [0, 1.5, 3], [[1, 0, 0], [2.5, 1, 0], [1, 0, 0]]),
    qt('upperArmL', [0, 1.5, 3], [[8, 0, -21], [10, 0, -22], [8, 0, -21]]),
    qt('upperArmR', [0, 1.5, 3], [[8, 0, 21], [10, 0, 22], [8, 0, 21]]),
    qt('forearmL', [0, 3], [[-18, 0, 0], [-18, 0, 0]]),
    qt('forearmR', [0, 3], [[-18, 0, 0], [-18, 0, 0]]),
    qt('head', [0, 1.5, 3], [[0, 0, 0], [1, 3, 0], [0, 0, 0]]),
  ]);

  // ---------- LOWER: run (0.6s cycle) ----------
  const rt = [0, 0.15, 0.3, 0.45, 0.6];
  clips.runLower = new THREE.AnimationClip('runLower', 0.6, [
    pt('hips', rt, [[0, hipY - 0.03, 0], [0, hipY + 0.03, 0], [0, hipY - 0.03, 0], [0, hipY + 0.03, 0], [0, hipY - 0.03, 0]]),
    qt('hips', rt, [[8, 0, 3], [8, 0, 0], [8, 0, -3], [8, 0, 0], [8, 0, 3]]),
    qt('spine', rt, [[4, -4, 0], [4, 0, 0], [4, 4, 0], [4, 0, 0], [4, -4, 0]]),
    qt('upperLegL', rt, [[-62, 0, 0], [-12, 0, 0], [42, 0, 0], [-6, 0, 0], [-62, 0, 0]]),
    qt('lowerLegL', rt, [[20, 0, 0], [12, 0, 0], [70, 0, 0], [92, 0, 0], [20, 0, 0]]),
    qt('upperLegR', rt, [[42, 0, 0], [-6, 0, 0], [-62, 0, 0], [-12, 0, 0], [42, 0, 0]]),
    qt('lowerLegR', rt, [[70, 0, 0], [92, 0, 0], [20, 0, 0], [12, 0, 0], [70, 0, 0]]),
    qt('footL', rt, [[10, 0, 0], [0, 0, 0], [-15, 0, 0], [-5, 0, 0], [10, 0, 0]]),
    qt('footR', rt, [[-15, 0, 0], [-5, 0, 0], [10, 0, 0], [0, 0, 0], [-15, 0, 0]]),
  ]);

  // ---------- UPPER: run (arm swing) ----------
  clips.runUpper = new THREE.AnimationClip('runUpper', 0.6, [
    qt('chest', rt, [[6, 5, 0], [6, 0, 0], [6, -5, 0], [6, 0, 0], [6, 5, 0]]),
    qt('upperArmL', rt, [[35, 0, -19], [5, 0, -19], [-30, 0, -19], [5, 0, -19], [35, 0, -19]]),
    qt('forearmL', rt, [[-40, 0, 0], [-55, 0, 0], [-70, 0, 0], [-55, 0, 0], [-40, 0, 0]]),
    qt('upperArmR', rt, [[-30, 0, 19], [5, 0, 19], [35, 0, 19], [5, 0, 19], [-30, 0, 19]]),
    qt('forearmR', rt, [[-70, 0, 0], [-55, 0, 0], [-40, 0, 0], [-55, 0, 0], [-70, 0, 0]]),
    qt('head', rt, [[-4, 0, 0], [-4, 0, 0], [-4, 0, 0], [-4, 0, 0], [-4, 0, 0]]),
  ]);

  // ---------- LOWER: airborne / jump ----------
  clips.airLower = new THREE.AnimationClip('airLower', 1, [
    pt('hips', [0, 1], [[0, hipY, 0], [0, hipY, 0]]),
    qt('hips', [0, 1], [[5, 0, 0], [5, 0, 0]]),
    qt('upperLegL', [0, 0.5, 1], [[-35, 0, -4], [-30, 0, -4], [-35, 0, -4]]),
    qt('lowerLegL', [0, 1], [[60, 0, 0], [60, 0, 0]]),
    qt('upperLegR', [0, 0.5, 1], [[-12, 0, 4], [-8, 0, 4], [-12, 0, 4]]),
    qt('lowerLegR', [0, 1], [[35, 0, 0], [35, 0, 0]]),
  ]);
  clips.airUpper = new THREE.AnimationClip('airUpper', 1, [
    qt('chest', [0, 1], [[-4, 0, 0], [-4, 0, 0]]),
    qt('upperArmL', [0, 0.5, 1], [[15, 0, -45], [18, 0, -50], [15, 0, -45]]),
    qt('forearmL', [0, 1], [[-25, 0, 0], [-25, 0, 0]]),
    qt('upperArmR', [0, 0.5, 1], [[15, 0, 45], [18, 0, 50], [15, 0, 45]]),
    qt('forearmR', [0, 1], [[-25, 0, 0], [-25, 0, 0]]),
  ]);

  // ---------- LOWER/UPPER: jetpack flight (legs trail, superman-lite) ----------
  clips.flyLower = new THREE.AnimationClip('flyLower', 1.6, [
    pt('hips', [0, 0.8, 1.6], [[0, hipY, 0], [0, hipY + 0.02, 0], [0, hipY, 0]]),
    qt('hips', [0, 0.8, 1.6], [[18, 0, 0], [22, 0, 0], [18, 0, 0]]),
    qt('upperLegL', [0, 0.8, 1.6], [[14, 0, -3], [18, 0, -3], [14, 0, -3]]),
    qt('lowerLegL', [0, 0.8, 1.6], [[28, 0, 0], [32, 0, 0], [28, 0, 0]]),
    qt('upperLegR', [0, 0.8, 1.6], [[18, 0, 3], [14, 0, 3], [18, 0, 3]]),
    qt('lowerLegR', [0, 0.8, 1.6], [[32, 0, 0], [28, 0, 0], [32, 0, 0]]),
    qt('footL', [0, 1.6], [[35, 0, 0], [35, 0, 0]]),
    qt('footR', [0, 1.6], [[35, 0, 0], [35, 0, 0]]),
  ]);
  clips.flyUpper = new THREE.AnimationClip('flyUpper', 1.6, [
    qt('chest', [0, 0.8, 1.6], [[-8, 0, 0], [-10, 0, 0], [-8, 0, 0]]),
    qt('upperArmL', [0, 0.8, 1.6], [[10, 0, -28], [12, 0, -32], [10, 0, -28]]),
    qt('forearmL', [0, 1.6], [[-30, 0, 0], [-30, 0, 0]]),
    qt('upperArmR', [0, 0.8, 1.6], [[10, 0, 28], [12, 0, 32], [10, 0, 28]]),
    qt('forearmR', [0, 1.6], [[-30, 0, 0], [-30, 0, 0]]),
    qt('head', [0, 1.6], [[-14, 0, 0], [-14, 0, 0]]),
  ]);

  // ---------- LOWER/UPPER: riding a vehicle (saddle straddle, hands to bars) ----------
  // Thighs forward and spread over the saddle, shins folded down, a forward
  // lean with both arms reaching the controls. The hips hold hipY over the
  // root, so a rider is placed by setting the root to saddleTop - hipHeight.
  clips.rideLower = new THREE.AnimationClip('rideLower', 2, [
    pt('hips', [0, 1, 2], [[0, hipY, 0], [0, hipY + 0.015, 0], [0, hipY, 0]]),
    qt('hips', [0, 2], [[10, 0, 0], [10, 0, 0]]),
    qt('upperLegL', [0, 2], [[-92, 0, -14], [-92, 0, -14]]),
    qt('lowerLegL', [0, 2], [[96, 0, 0], [96, 0, 0]]),
    qt('footL', [0, 2], [[28, 0, 0], [28, 0, 0]]),
    qt('upperLegR', [0, 2], [[-92, 0, 14], [-92, 0, 14]]),
    qt('lowerLegR', [0, 2], [[96, 0, 0], [96, 0, 0]]),
    qt('footR', [0, 2], [[28, 0, 0], [28, 0, 0]]),
  ]);
  clips.rideUpper = new THREE.AnimationClip('rideUpper', 2, [
    qt('chest', [0, 1, 2], [[20, 0, 0], [22, 0, 0], [20, 0, 0]]),
    qt('upperArmL', [0, 2], [[-66, 22, -12], [-66, 22, -12]]),
    qt('forearmL', [0, 2], [[-34, 0, 0], [-34, 0, 0]]),
    qt('upperArmR', [0, 2], [[-66, -22, 12], [-66, -22, 12]]),
    qt('forearmR', [0, 2], [[-34, 0, 0], [-34, 0, 0]]),
    qt('head', [0, 2], [[-16, 0, 0], [-16, 0, 0]]),
  ]);

  // ---------- UPPER: aim carbine (two-handed, right shoulder) ----------
  clips.aimUpper = new THREE.AnimationClip('aimUpper', 1, [
    qt('chest', [0, 1], [[2, -18, 0], [2, -18, 0]]),
    qt('shoulderR', [0, 1], [[0, -8, 10], [0, -8, 10]]),
    qt('shoulderL', [0, 1], [[0, 8, -10], [0, 8, -10]]),
    qt('upperArmR', [0, 1], [[-62, 12, 12], [-62, 12, 12]]),
    qt('forearmR', [0, 1], [[-38, 0, 0], [-38, 0, 0]]),
    qt('handR', [0, 1], [[11.1, 9.6, -8.4], [11.1, 9.6, -8.4]]),
    qt('upperArmL', [0, 1], [[-78, -36, -8], [-78, -36, -8]]),
    qt('forearmL', [0, 1], [[-56.5, 29.7, 108.3], [-56.5, 29.7, 108.3]]),
    qt('head', [0, 1], [[0, 16, 0], [0, 16, 0]]),
  ]);

  // ---------- UPPER: melee combo (gaffi stick in right hand) ----------
  clips.melee1 = new THREE.AnimationClip('melee1', 0.38, [
    qt('chest', [0, 0.1, 0.22, 0.38], [[2, 28, 0], [2, 34, 0], [4, -30, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.1, 0.22, 0.38], [[-95, 30, -20], [-105, 40, -20], [-55, -45, 0], [-30, 0, -8]]),
    qt('forearmR', [0, 0.1, 0.22, 0.38], [[-55, 0, 0], [-65, 0, 0], [-10, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.22, 0.38], [[-10.6, -0.6, -24.9], [4.4, -0.6, -12.9], [-18.6, -0.6, -39.9]]),
    qt('forearmL', [0, 0.38], [[-27.3, 19.6, 22.1], [-27.3, 19.6, 22.1]]),
    qt('head', [0, 0.22, 0.38], [[0, -10, 0], [0, 10, 0], [0, 0, 0]]),
  ]);
  clips.melee2 = new THREE.AnimationClip('melee2', 0.42, [
    qt('chest', [0, 0.1, 0.24, 0.42], [[2, -30, 0], [2, -38, 0], [4, 32, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.1, 0.24, 0.42], [[-60, -50, 10], [-70, -60, 10], [-85, 55, -10], [-30, 0, -8]]),
    qt('forearmR', [0, 0.1, 0.24, 0.42], [[-15, 0, 0], [-20, 0, 0], [-60, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.24, 0.42], [[-0.6, -0.6, -16.9], [-20.6, -0.6, -42.9], [-18.6, -0.6, -39.9]]),
    qt('forearmL', [0, 0.42], [[-27.3, 19.6, 22.1], [-27.3, 19.6, 22.1]]),
  ]);
  clips.melee3 = new THREE.AnimationClip('melee3', 0.55, [
    qt('chest', [0, 0.16, 0.3, 0.55], [[-14, 0, 0], [-20, 0, 0], [30, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.16, 0.3, 0.55], [[-150, 0, -10], [-165, 0, -10], [-40, 0, -5], [-30, 0, -8]]),
    qt('forearmR', [0, 0.16, 0.3, 0.55], [[-70, 0, 0], [-80, 0, 0], [-5, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.16, 0.3, 0.55], [[-120, 0, 20], [-140, 0, 25], [-70, 0, -15], [-18.6, -0.6, -39.9]]),
    qt('forearmL', [0, 0.3, 0.55], [[-60, 0, 0], [-18, 12, 12], [-27.3, 19.6, 22.1]]),
    qt('head', [0, 0.3, 0.55], [[-12, 0, 0], [14, 0, 0], [0, 0, 0]]),
  ]);

  // ---------- UPPER: twin-saber combo ----------
  // The staff combo above parks the off hand: it is holding the far end of a
  // two-handed weapon, so hits one and two swing the right arm alone. With a
  // blade in each hand that reads as one dead arm, so the dual-wield set
  // alternates leads and finishes on a cross-slash that throws both out at once.
  clips.saber1 = new THREE.AnimationClip('saber1', 0.36, [
    qt('chest', [0, 0.1, 0.22, 0.36], [[2, 26, 0], [2, 32, 0], [4, -26, 0], [2, 0, 0]]),
    // right leads: cocked high outside, then cuts down across the body
    qt('upperArmR', [0, 0.1, 0.22, 0.36], [[-100, 34, -24], [-112, 44, -26], [-52, -48, 4], [-30, 0, -8]]),
    qt('forearmR', [0, 0.1, 0.22, 0.36], [[-58, 0, 0], [-70, 0, 0], [-8, 0, 0], [-25, 0, 0]]),
    // left counter-poises out and back, so the second blade is always live
    qt('upperArmL', [0, 0.1, 0.22, 0.36], [[-24, -10, -46], [-34, -14, -58], [-14, -4, -30], [-22, -2, -42]]),
    qt('forearmL', [0, 0.22, 0.36], [[-40, 14, 18], [-22, 20, 24], [-30, 18, 22]]),
    qt('head', [0, 0.22, 0.36], [[0, -12, 0], [0, 12, 0], [0, 0, 0]]),
  ]);
  clips.saber2 = new THREE.AnimationClip('saber2', 0.38, [
    qt('chest', [0, 0.1, 0.24, 0.38], [[2, -28, 0], [2, -36, 0], [4, 28, 0], [2, 0, 0]]),
    // left leads this time, mirroring the first hit
    qt('upperArmL', [0, 0.1, 0.24, 0.38], [[-100, -34, -24], [-112, -44, -18], [-52, 48, -52], [-22, -2, -42]]),
    qt('forearmL', [0, 0.1, 0.24, 0.38], [[-58, 10, 10], [-70, 12, 12], [-8, 20, 20], [-30, 18, 22]]),
    qt('upperArmR', [0, 0.1, 0.24, 0.38], [[-26, 10, -6], [-36, 14, -4], [-16, 4, -10], [-30, 0, -8]]),
    qt('forearmR', [0, 0.24, 0.38], [[-40, 0, 0], [-18, 0, 0], [-25, 0, 0]]),
    qt('head', [0, 0.24, 0.38], [[0, 12, 0], [0, -12, 0], [0, 0, 0]]),
  ]);
  clips.saber3 = new THREE.AnimationClip('saber3', 0.5, [
    // finisher: both blades gathered across the chest, then thrown apart
    qt('chest', [0, 0.18, 0.32, 0.5], [[-6, 0, 0], [-16, 0, 0], [16, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.18, 0.32, 0.5], [[-70, -40, 10], [-84, -52, 14], [-64, 62, -22], [-30, 0, -8]]),
    qt('forearmR', [0, 0.18, 0.32, 0.5], [[-72, 0, 0], [-88, 0, 0], [-10, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.18, 0.32, 0.5], [[-70, 40, -10], [-84, 52, -14], [-64, -62, -70], [-22, -2, -42]]),
    qt('forearmL', [0, 0.18, 0.32, 0.5], [[-72, 10, 10], [-88, 12, 12], [-10, 20, 20], [-30, 18, 22]]),
    qt('head', [0, 0.32, 0.5], [[-10, 0, 0], [12, 0, 0], [0, 0, 0]]),
  ]);

  // ---------- UPPER: block (shield up, braced behind it) ----------
  clips.blockUpper = new THREE.AnimationClip('blockUpper', 2, [
    qt('chest', [0, 1, 2], [[10, 6, 0], [12, 7, 0], [10, 6, 0]]),
    qt('head', [0, 2], [[6, -10, 0], [6, -10, 0]]),
    // forearm across the body, the other bracing it — the shield hangs off both
    qt('upperArmL', [0, 1, 2], [[-64, -22, -14], [-66, -24, -15], [-64, -22, -14]]),
    qt('forearmL', [0, 2], [[-74, 0, 0], [-74, 0, 0]]),
    qt('upperArmR', [0, 1, 2], [[-52, 26, 18], [-54, 28, 19], [-52, 26, 18]]),
    qt('forearmR', [0, 2], [[-62, 0, 0], [-62, 0, 0]]),
  ]);
  // legs braced wide, weight back
  clips.blockLower = new THREE.AnimationClip('blockLower', 2, [
    pt('hips', [0, 1, 2], [[0, hipY - 0.08, 0], [0, hipY - 0.09, 0], [0, hipY - 0.08, 0]]),
    qt('hips', [0, 2], [[6, 12, 0], [6, 12, 0]]),
    qt('spine', [0, 2], [[4, 0, 0], [4, 0, 0]]),
    qt('upperLegL', [0, 2], [[-26, 0, -8], [-26, 0, -8]]),
    qt('lowerLegL', [0, 2], [[34, 0, 0], [34, 0, 0]]),
    qt('upperLegR', [0, 2], [[16, 0, 10], [16, 0, 10]]),
    qt('lowerLegR', [0, 2], [[26, 0, 0], [26, 0, 0]]),
  ]);

  // ---------- UPPER: hit flinch ----------
  clips.hitUpper = new THREE.AnimationClip('hitUpper', 0.28, [
    qt('chest', [0, 0.08, 0.28], [[-14, 6, 0], [-18, 8, 0], [1, 0, 0]]),
    qt('head', [0, 0.08, 0.28], [[-16, 0, 0], [-20, 4, 0], [0, 0, 0]]),
    qt('upperArmL', [0, 0.08, 0.28], [[20, 0, -30], [26, 0, -36], [8, 0, -10]]),
    qt('upperArmR', [0, 0.08, 0.28], [[20, 0, 30], [26, 0, 36], [8, 0, 10]]),
  ]);

  // ---------- FULL: death (crumple back) ----------
  clips.deathLower = new THREE.AnimationClip('deathLower', 0.8, [
    pt('hips', [0, 0.35, 0.8], [[0, hipY, 0], [0, hipY * 0.45, -0.2], [0, 0.22, -0.45]]),
    qt('hips', [0, 0.35, 0.8], [[0, 0, 0], [-38, 0, 6], [-78, 0, 10]]),
    qt('upperLegL', [0, 0.8], [[-20, 0, -6], [-40, 0, -10]]),
    qt('lowerLegL', [0, 0.8], [[30, 0, 0], [55, 0, 0]]),
    qt('upperLegR', [0, 0.8], [[-30, 0, 8], [-25, 0, 12]]),
    qt('lowerLegR', [0, 0.8], [[40, 0, 0], [30, 0, 0]]),
  ]);
  clips.deathUpper = new THREE.AnimationClip('deathUpper', 0.8, [
    qt('chest', [0, 0.35, 0.8], [[-10, 0, 0], [-18, 8, 0], [-14, 12, 0]]),
    qt('head', [0, 0.8], [[-10, 0, 0], [-24, 14, 0]]),
    qt('upperArmL', [0, 0.8], [[20, 0, -40], [40, 0, -70]]),
    qt('upperArmR', [0, 0.8], [[20, 0, 40], [50, 0, 60]]),
    qt('forearmL', [0, 0.8], [[-30, 0, 0], [-10, 0, 0]]),
    qt('forearmR', [0, 0.8], [[-30, 0, 0], [-15, 0, 0]]),
  ]);

  // ---------- DEATH: limp collapse, toppled by the enemy's root ----------
  // The death* clips above fold the body up for the wounded crawl. An actual
  // kill instead lays the whole root flat on the ground, so these keep the
  // body roughly straight and just go limp — folding here as well would land
  // the corpse bent double, half-upright, instead of prone.
  clips.collapseLower = new THREE.AnimationClip('collapseLower', 0.6, [
    pt('hips', [0, 0.6], [[0, hipY, 0], [0, hipY * 0.94, 0]]),
    qt('hips', [0, 0.6], [[0, 0, 0], [-7, 0, 5]]),
    qt('upperLegL', [0, 0.6], [[0, 0, -4], [-7, 0, -14]]),
    qt('lowerLegL', [0, 0.6], [[0, 0, 0], [16, 0, 0]]),
    qt('upperLegR', [0, 0.6], [[0, 0, 4], [-3, 0, 11]]),
    qt('lowerLegR', [0, 0.6], [[0, 0, 0], [23, 0, 0]]),
  ]);
  clips.collapseUpper = new THREE.AnimationClip('collapseUpper', 0.6, [
    qt('chest', [0, 0.6], [[0, 0, 0], [7, 7, 0]]),
    qt('head', [0, 0.6], [[0, 0, 0], [12, 14, 0]]),
    qt('upperArmL', [0, 0.6], [[10, 0, -30], [26, 0, -64]]),
    qt('upperArmR', [0, 0.6], [[10, 0, 30], [30, 0, 60]]),
    qt('forearmL', [0, 0.6], [[-14, 0, 0], [-24, 0, 0]]),
    qt('forearmR', [0, 0.6], [[-14, 0, 0], [-18, 0, 0]]),
  ]);

  // ---------- UPPER: one-hand pistol/rifle aim for enemies ----------
  clips.enemyAimUpper = new THREE.AnimationClip('enemyAimUpper', 1, [
    qt('chest', [0, 1], [[2, -12, 0], [2, -12, 0]]),
    qt('shoulderR', [0, 1], [[0, -7, 9], [0, -7, 9]]),
    qt('shoulderL', [0, 1], [[0, 7, -9], [0, 7, -9]]),
    qt('upperArmR', [0, 1], [[-68, 8, 10], [-68, 8, 10]]),
    qt('forearmR', [0, 1], [[-24, 0, 0], [-24, 0, 0]]),
    qt('handR', [0, 1], [[7.5, 12.7, -4.7], [7.5, 12.7, -4.7]]),
    qt('upperArmL', [0, 1], [[-52, -28, -8], [-52, -28, -8]]),
    qt('forearmL', [0, 1], [[-58, 12, 34], [-58, 12, 34]]),
  ]);

  // ---------- UPPER: two-hand overhead swing for melee enemies ----------
  clips.enemySwing = new THREE.AnimationClip('enemySwing', 0.7, [
    qt('chest', [0, 0.3, 0.45, 0.7], [[-16, 0, 0], [-24, 0, 0], [34, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.3, 0.45, 0.7], [[-150, 0, -14], [-168, 0, -14], [-45, 0, -6], [-20, 0, -8]]),
    qt('forearmR', [0, 0.3, 0.45, 0.7], [[-65, 0, 0], [-80, 0, 0], [-8, 0, 0], [-20, 0, 0]]),
    qt('upperArmL', [0, 0.3, 0.45, 0.7], [[-130, 0, 18], [-150, 0, 22], [-70, 0, -15], [-18.6, -0.6, -39.9]]),
    qt('forearmL', [0, 0.45, 0.7], [[-60, 0, 0], [-18, 12, 12], [-27.3, 19.6, 22.1]]),
  ]);

  return clips;
}
