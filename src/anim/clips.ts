import * as THREE from 'three';
import type { Proportions } from './skeleton';

/**
 * Procedurally authored AnimationClips on the canonical skeleton.
 * Clips are split into LOWER (hips/legs/spine locomotion) and UPPER
 * (chest/arms/head actions) so the animator can layer shooting/melee
 * over any locomotion state. All clips are standard THREE.AnimationClips,
 * so authored clips from a glTF can replace them 1:1.
 *
 * ARM/LEG SPLAY SIGN: the rig's `L` bones sit at +X and `R` at -X (the rig
 * faces +Z, so +X is the character's own left — see skeleton.ts), and a
 * positive Z rotation swings a downward-pointing bone toward +X. So a limb
 * spreads *away* from the body on positive Z for `L` and negative Z for `R`.
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
 *
 * A strafe cycle swings the legs sideways (Z on the thigh) rather than fore
 * and aft, so both planes are measured and the larger sweep wins — a forward
 * gait keeps its old number exactly, and a lateral one stops measuring as
 * "no stride" and freezing at rate 1.
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
    const angles = (buf: ArrayLike<number>): [number, number] => {
      _q.set(buf[0], buf[1], buf[2], buf[3]);
      _e.setFromQuaternion(_q, 'XYZ');
      return [_e.x, _e.z];
    };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const STEPS = 48;
    for (let i = 0; i <= STEPS; i++) {
      const t = (clip.duration * i) / STEPS;
      const [thigh, thighZ] = angles(upperI.evaluate(t));
      const [shin] = lowerI ? angles(lowerI.evaluate(t)) : [0, 0];
      const x = -(p.upperLegLen * Math.sin(thigh) + p.lowerLegLen * Math.sin(thigh + shin));
      const z = (p.upperLegLen + p.lowerLegLen) * Math.sin(thighZ);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    out = Math.max(0, maxX - minX, maxZ - minZ) * 2;
  }
  strideCache.set(clip, out);
  return out;
}

/**
 * Mirror a clip through the X = 0 plane: L and R tracks swap, rotations are
 * conjugated `(x, -y, -z, w)`, and positions negate x. This is how one
 * authored strafe cycle serves both directions without a hand-mirrored twin.
 */
function mirrorClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
  const swapSide = (n: string) => n.replace(/[LR]\.(quaternion|position)$/, (m) => (m[0] === 'L' ? 'R' : 'L') + m.slice(1));
  const tracks = clip.tracks.map((t) => {
    const values = t.values.slice();
    if (t instanceof THREE.QuaternionKeyframeTrack) {
      for (let i = 0; i < values.length; i += 4) { values[i + 1] *= -1; values[i + 2] *= -1; }
      return new THREE.QuaternionKeyframeTrack(swapSide(t.name), Array.from(t.times), Array.from(values));
    }
    for (let i = 0; i < values.length; i += 3) values[i] *= -1;
    return new THREE.VectorKeyframeTrack(swapSide(t.name), Array.from(t.times), Array.from(values));
  });
  return new THREE.AnimationClip(name, clip.duration, tracks);
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
    qt('hips', [0, 1.5, 3], [[0, 0, 0], [1, 0, -1], [0, 0, 0]]),
    qt('spine', [0, 1.5, 3], [[2, 0, 0], [3.5, 0, 0], [2, 0, 0]]),
    qt('upperLegL', [0, 3], [[-3, 0, 2], [-3, 0, 2]]),
    qt('upperLegR', [0, 3], [[-3, 0, -2], [-3, 0, -2]]),
    qt('lowerLegL', [0, 3], [[5, 0, 0], [5, 0, 0]]),
    qt('lowerLegR', [0, 3], [[5, 0, 0], [5, 0, 0]]),
  ]);

  // ---------- UPPER: idle ----------
  clips.idleUpper = new THREE.AnimationClip('idleUpper', 3, [
    qt('chest', [0, 1.5, 3], [[1, 0, 0], [2.5, -1, 0], [1, 0, 0]]),
    qt('upperArmL', [0, 1.5, 3], [[8, 0, 21], [10, 0, 22], [8, 0, 21]]),
    qt('upperArmR', [0, 1.5, 3], [[8, 0, -21], [10, 0, -22], [8, 0, -21]]),
    qt('forearmL', [0, 3], [[-18, 0, 0], [-18, 0, 0]]),
    qt('forearmR', [0, 3], [[-18, 0, 0], [-18, 0, 0]]),
    qt('head', [0, 1.5, 3], [[0, 0, 0], [1, -3, 0], [0, 0, 0]]),
  ]);

  // ---------- LOWER: run (0.6s cycle) ----------
  const rt = [0, 0.15, 0.3, 0.45, 0.6];
  clips.runLower = new THREE.AnimationClip('runLower', 0.6, [
    pt('hips', rt, [[0, hipY - 0.03, 0], [0, hipY + 0.03, 0], [0, hipY - 0.03, 0], [0, hipY + 0.03, 0], [0, hipY - 0.03, 0]]),
    qt('hips', rt, [[8, 0, -3], [8, 0, 0], [8, 0, 3], [8, 0, 0], [8, 0, -3]]),
    qt('spine', rt, [[4, 4, 0], [4, 0, 0], [4, -4, 0], [4, 0, 0], [4, 4, 0]]),
    qt('upperLegL', rt, [[-62, 0, 0], [-12, 0, 0], [42, 0, 0], [-6, 0, 0], [-62, 0, 0]]),
    qt('lowerLegL', rt, [[20, 0, 0], [12, 0, 0], [70, 0, 0], [92, 0, 0], [20, 0, 0]]),
    qt('upperLegR', rt, [[42, 0, 0], [-6, 0, 0], [-62, 0, 0], [-12, 0, 0], [42, 0, 0]]),
    qt('lowerLegR', rt, [[70, 0, 0], [92, 0, 0], [20, 0, 0], [12, 0, 0], [70, 0, 0]]),
    // a couple of degrees of left/right asymmetry so the cycle doesn't read
    // as perfectly mirrored clockwork
    qt('footL', rt, [[12, 0, 0], [1, 0, 0], [-16, 0, 0], [-4, 0, 0], [12, 0, 0]]),
    qt('footR', rt, [[-14, 0, 0], [-6, 0, 0], [9, 0, 0], [0, 0, 0], [-14, 0, 0]]),
  ]);

  // ---------- LOWER: sprint (0.6s cycle) ----------
  // The run opened up: the lead thigh reaches further forward and the shin
  // straightens into that reach, so the stride lands ahead of where the run
  // would put it, with a deeper hip pitch behind it. Longer strides also mean
  // cycleDistance measures a bigger number, so gaitRate plays it *slower* per
  // metre than the run — fewer, longer steps at speed rather than the same
  // gait spun faster.
  clips.sprintLower = new THREE.AnimationClip('sprintLower', 0.6, [
    pt('hips', rt, [[0, hipY - 0.04, 0], [0, hipY + 0.035, 0], [0, hipY - 0.04, 0], [0, hipY + 0.035, 0], [0, hipY - 0.04, 0]]),
    qt('hips', rt, [[12, 0, -3], [12, 0, 0], [12, 0, 3], [12, 0, 0], [12, 0, -3]]),
    qt('spine', rt, [[6, 5, 0], [6, 0, 0], [6, -5, 0], [6, 0, 0], [6, 5, 0]]),
    qt('upperLegL', rt, [[-76, 0, 0], [-14, 0, 0], [46, 0, 0], [-8, 0, 0], [-76, 0, 0]]),
    qt('lowerLegL', rt, [[12, 0, 0], [10, 0, 0], [74, 0, 0], [100, 0, 0], [12, 0, 0]]),
    qt('upperLegR', rt, [[46, 0, 0], [-8, 0, 0], [-76, 0, 0], [-14, 0, 0], [46, 0, 0]]),
    qt('lowerLegR', rt, [[74, 0, 0], [100, 0, 0], [12, 0, 0], [10, 0, 0], [74, 0, 0]]),
    qt('footL', rt, [[14, 0, 0], [2, 0, 0], [-18, 0, 0], [-5, 0, 0], [14, 0, 0]]),
    qt('footR', rt, [[-16, 0, 0], [-7, 0, 0], [10, 0, 0], [0, 0, 0], [-16, 0, 0]]),
  ]);

  // ---------- LOWER: back-pedal (0.6s cycle, played in reverse) ----------
  // Backing up is this cycle run backward, so the poses are the run's with the
  // reach rebalanced for it: the trailing leg no longer stretches far behind
  // (nothing is being pushed off toward), while the leading leg reaches a
  // little further forward to catch the body's weight as it travels back.
  clips.backpedalLower = new THREE.AnimationClip('backpedalLower', 0.6, [
    pt('hips', rt, [[0, hipY - 0.025, 0], [0, hipY + 0.025, 0], [0, hipY - 0.025, 0], [0, hipY + 0.025, 0], [0, hipY - 0.025, 0]]),
    qt('hips', rt, [[8, 0, -3], [8, 0, 0], [8, 0, 3], [8, 0, 0], [8, 0, -3]]),
    qt('spine', rt, [[4, 4, 0], [4, 0, 0], [4, -4, 0], [4, 0, 0], [4, 4, 0]]),
    qt('upperLegL', rt, [[-70, 0, 0], [-14, 0, 0], [24, 0, 0], [-6, 0, 0], [-70, 0, 0]]),
    qt('lowerLegL', rt, [[22, 0, 0], [14, 0, 0], [62, 0, 0], [88, 0, 0], [22, 0, 0]]),
    qt('upperLegR', rt, [[24, 0, 0], [-6, 0, 0], [-70, 0, 0], [-14, 0, 0], [24, 0, 0]]),
    qt('lowerLegR', rt, [[62, 0, 0], [88, 0, 0], [22, 0, 0], [14, 0, 0], [62, 0, 0]]),
    qt('footL', rt, [[12, 0, 0], [1, 0, 0], [-14, 0, 0], [-4, 0, 0], [12, 0, 0]]),
    qt('footR', rt, [[-12, 0, 0], [-6, 0, 0], [9, 0, 0], [0, 0, 0], [-12, 0, 0]]),
  ]);

  // ---------- LOWER: strafe (lateral shuffle, 0.6s cycle) ----------
  // Side-stepping toward -X — the character's own right, so `strafeLower` is
  // the step to the right: the -X leg reaches wide, the other pushes and
  // gathers under the body, knees lifting on the gather so the feet step
  // rather than mop. Travel toward +X is this clip mirrored (strafeLLower).
  // The controller picks between them whenever combat facing and travel
  // diverge by 45-135°, which is what stops sidesteps playing the forward run.
  clips.strafeLower = new THREE.AnimationClip('strafeLower', 0.6, [
    pt('hips', rt, [[0, hipY - 0.02, 0], [0, hipY + 0.02, 0], [0, hipY - 0.03, 0], [0, hipY + 0.02, 0], [0, hipY - 0.02, 0]]),
    qt('hips', rt, [[4, 0, 5], [4, 0, 3], [4, 0, 5], [4, 0, 3], [4, 0, 5]]),   // lean into the travel
    qt('spine', rt, [[2, 0, -3], [2, 0, -2], [2, 0, -3], [2, 0, -2], [2, 0, -3]]),       // counter so the head stays level
    qt('upperLegR', rt, [[0, 0, -28], [-4, 0, -10], [2, 0, 4], [-4, 0, -12], [0, 0, -28]]),
    qt('lowerLegR', rt, [[8, 0, 0], [34, 0, 0], [10, 0, 0], [30, 0, 0], [8, 0, 0]]),
    qt('upperLegL', rt, [[0, 0, 2], [-4, 0, -8], [2, 0, -20], [-4, 0, -8], [0, 0, 2]]),
    qt('lowerLegL', rt, [[10, 0, 0], [28, 0, 0], [8, 0, 0], [32, 0, 0], [10, 0, 0]]),
    qt('footL', rt, [[4, 0, 0], [-6, 0, 0], [4, 0, 0], [-6, 0, 0], [4, 0, 0]]),
    qt('footR', rt, [[4, 0, 0], [-6, 0, 0], [4, 0, 0], [-6, 0, 0], [4, 0, 0]]),
  ]);
  clips.strafeLLower = mirrorClip(clips.strafeLower, 'strafeLLower');

  // ---------- UPPER: run (arm swing) ----------
  clips.runUpper = new THREE.AnimationClip('runUpper', 0.6, [
    // a touch of roll against the yaw twist, so the shoulders ride the stride
    qt('chest', rt, [[6, -5, 1.5], [6, 0, 0], [6, 5, -1.5], [6, 0, 0], [6, -5, 1.5]]),
    qt('upperArmL', rt, [[35, 0, 19], [5, 0, 19], [-30, 0, 19], [5, 0, 19], [35, 0, 19]]),
    qt('forearmL', rt, [[-40, 0, 0], [-55, 0, 0], [-70, 0, 0], [-55, 0, 0], [-40, 0, 0]]),
    qt('upperArmR', rt, [[-30, 0, -19], [5, 0, -19], [35, 0, -19], [5, 0, -19], [-30, 0, -19]]),
    qt('forearmR', rt, [[-70, 0, 0], [-55, 0, 0], [-40, 0, 0], [-55, 0, 0], [-70, 0, 0]]),
    qt('head', rt, [[-4, 0, 0], [-4, 0, 0], [-4, 0, 0], [-4, 0, 0], [-4, 0, 0]]),
  ]);

  // ---------- LOWER: airborne / jump ----------
  clips.airLower = new THREE.AnimationClip('airLower', 1, [
    pt('hips', [0, 1], [[0, hipY, 0], [0, hipY, 0]]),
    qt('hips', [0, 1], [[5, 0, 0], [5, 0, 0]]),
    qt('upperLegL', [0, 0.5, 1], [[-35, 0, 4], [-30, 0, 4], [-35, 0, 4]]),
    qt('lowerLegL', [0, 1], [[60, 0, 0], [60, 0, 0]]),
    qt('upperLegR', [0, 0.5, 1], [[-12, 0, -4], [-8, 0, -4], [-12, 0, -4]]),
    qt('lowerLegR', [0, 1], [[35, 0, 0], [35, 0, 0]]),
  ]);
  clips.airUpper = new THREE.AnimationClip('airUpper', 1, [
    qt('chest', [0, 1], [[-4, 0, 0], [-4, 0, 0]]),
    qt('upperArmL', [0, 0.5, 1], [[15, 0, 45], [18, 0, 50], [15, 0, 45]]),
    qt('forearmL', [0, 1], [[-25, 0, 0], [-25, 0, 0]]),
    qt('upperArmR', [0, 0.5, 1], [[15, 0, -45], [18, 0, -50], [15, 0, -45]]),
    qt('forearmR', [0, 1], [[-25, 0, 0], [-25, 0, 0]]),
  ]);

  // ---------- LOWER: landing (absorb the drop) ----------
  //
  // A one-shot under whatever the upper body is doing: the knees fold to take
  // the impact in the first tenth of a second, then push back up to standing.
  // The controller plays it from the speed the ground was met at, faster for a
  // light landing than a heavy one, so a hop and a rooftop drop do not read the
  // same. Nothing here moves the character — the crouch is hips-down over feet
  // that stay planted, which is what keeps it from looking like a second fall.
  clips.landLower = new THREE.AnimationClip('landLower', 0.38, [
    pt('hips', [0, 0.1, 0.24, 0.38], [[0, hipY - 0.04, 0], [0, hipY - 0.26, 0], [0, hipY - 0.1, 0], [0, hipY, 0]]),
    qt('hips', [0, 0.1, 0.24, 0.38], [[6, 0, 0], [16, 0, 0], [9, 0, 0], [0, 0, 0]]),
    qt('spine', [0, 0.1, 0.24, 0.38], [[3, 0, 0], [10, 0, 0], [5, 0, 0], [2, 0, 0]]),
    qt('upperLegL', [0, 0.1, 0.24, 0.38], [[-18, 0, 5], [-48, 0, 9], [-24, 0, 6], [-3, 0, 2]]),
    qt('lowerLegL', [0, 0.1, 0.24, 0.38], [[26, 0, 0], [70, 0, 0], [34, 0, 0], [5, 0, 0]]),
    qt('footL', [0, 0.1, 0.24, 0.38], [[-4, 0, 0], [-18, 0, 0], [-8, 0, 0], [0, 0, 0]]),
    // a couple of degrees between the legs so the absorb isn't a piston
    qt('upperLegR', [0, 0.1, 0.24, 0.38], [[-15, 0, -5], [-44, 0, -9], [-21, 0, -6], [-3, 0, -2]]),
    qt('lowerLegR', [0, 0.1, 0.24, 0.38], [[23, 0, 0], [64, 0, 0], [31, 0, 0], [5, 0, 0]]),
    qt('footR', [0, 0.1, 0.24, 0.38], [[-3, 0, 0], [-16, 0, 0], [-7, 0, 0], [0, 0, 0]]),
  ]);

  // ---------- LOWER/UPPER: jetpack flight (legs trail, superman-lite) ----------
  clips.flyLower = new THREE.AnimationClip('flyLower', 1.6, [
    pt('hips', [0, 0.8, 1.6], [[0, hipY, 0], [0, hipY + 0.02, 0], [0, hipY, 0]]),
    qt('hips', [0, 0.8, 1.6], [[18, 0, 0], [22, 0, 0], [18, 0, 0]]),
    // pose-edit pass: a touch more forward lean through the torso in flight
    qt('spine', [0, 1.6], [[11.16, 0.89, 0.13], [11.16, 0.89, 0.13]]),
    qt('upperLegL', [0, 0.8, 1.6], [[14, 0, 3], [18, 0, 3], [14, 0, 3]]),
    qt('lowerLegL', [0, 0.8, 1.6], [[28, 0, 0], [32, 0, 0], [28, 0, 0]]),
    qt('upperLegR', [0, 0.8, 1.6], [[18, 0, -3], [14, 0, -3], [18, 0, -3]]),
    qt('lowerLegR', [0, 0.8, 1.6], [[32, 0, 0], [28, 0, 0], [32, 0, 0]]),
    qt('footL', [0, 1.6], [[35, 0, 0], [35, 0, 0]]),
    qt('footR', [0, 1.6], [[35, 0, 0], [35, 0, 0]]),
  ]);
  clips.flyUpper = new THREE.AnimationClip('flyUpper', 1.6, [
    qt('chest', [0, 0.8, 1.6], [[-8, 0, 0], [-10, 0, 0], [-8, 0, 0]]),
    // ...with the neck tipping back against it so the visor still reads level
    qt('neck', [0, 1.6], [[-4.16, -0.31, -0.14], [-4.16, -0.31, -0.14]]),
    qt('upperArmL', [0, 0.8, 1.6], [[10, 0, 28], [12, 0, 32], [10, 0, 28]]),
    qt('forearmL', [0, 1.6], [[-30, 0, 0], [-30, 0, 0]]),
    qt('upperArmR', [0, 0.8, 1.6], [[10, 0, -28], [12, 0, -32], [10, 0, -28]]),
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
    qt('upperLegL', [0, 2], [[-92, 0, 14], [-92, 0, 14]]),
    qt('lowerLegL', [0, 2], [[96, 0, 0], [96, 0, 0]]),
    qt('footL', [0, 2], [[28, 0, 0], [28, 0, 0]]),
    qt('upperLegR', [0, 2], [[-92, 0, -14], [-92, 0, -14]]),
    qt('lowerLegR', [0, 2], [[96, 0, 0], [96, 0, 0]]),
    qt('footR', [0, 2], [[28, 0, 0], [28, 0, 0]]),
  ]);
  clips.rideUpper = new THREE.AnimationClip('rideUpper', 2, [
    qt('chest', [0, 1, 2], [[20, 0, 0], [22, 0, 0], [20, 0, 0]]),
    qt('upperArmL', [0, 2], [[-66, -22, 12], [-66, -22, 12]]),
    qt('forearmL', [0, 2], [[-34, 0, 0], [-34, 0, 0]]),
    qt('upperArmR', [0, 2], [[-66, 22, -12], [-66, 22, -12]]),
    qt('forearmR', [0, 2], [[-34, 0, 0], [-34, 0, 0]]),
    qt('head', [0, 2], [[-16, 0, 0], [-16, 0, 0]]),
  ]);

  // ---------- UPPER: aim carbine (two-handed, right shoulder) ----------
  clips.aimUpper = new THREE.AnimationClip('aimUpper', 1, [
    qt('chest', [0, 1], [[2, 18, 0], [2, 18, 0]]),
    qt('shoulderR', [0, 1], [[0, 8, -10], [0, 8, -10]]),
    qt('shoulderL', [0, 1], [[0, -8, 10], [0, -8, 10]]),
    qt('upperArmR', [0, 1], [[-62, -12, -12], [-62, -12, -12]]),
    qt('forearmR', [0, 1], [[-38, 0, 0], [-38, 0, 0]]),
    qt('handR', [0, 1], [[11.1, -9.6, 8.4], [11.1, -9.6, 8.4]]),
    qt('upperArmL', [0, 1], [[-78, 36, 8], [-78, 36, 8]]),
    qt('forearmL', [0, 1], [[-56.5, -29.7, -108.3], [-56.5, -29.7, -108.3]]),
    qt('head', [0, 1], [[0, -16, 0], [0, -16, 0]]),
  ]);

  // ---------- UPPER: melee combo (gaffi stick in right hand) ----------
  // KEY TIMING: the poses hold their shapes, but the strike key sits close
  // behind a *held* windup — a real hit cocks, hangs a beat, and releases
  // fast. Evenly spaced keys gave the cut the same angular velocity as the
  // windup and the whole swing read as a wave. Contact lands at 45% of the
  // clip (player.ts `meleeHitPending`), which every strike interval below
  // still straddles — re-check that before re-timing again.
  clips.melee1 = new THREE.AnimationClip('melee1', 0.38, [
    qt('chest', [0, 0.14, 0.2, 0.38], [[2, -28, 0], [2, -34, 0], [4, 30, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.14, 0.2, 0.38], [[-95, -30, 20], [-105, -40, 20], [-55, 45, 0], [-30, 0, 8]]),
    qt('forearmR', [0, 0.14, 0.2, 0.38], [[-55, 0, 0], [-65, 0, 0], [-10, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.2, 0.38], [[-10.6, 0.6, 24.9], [4.4, 0.6, 12.9], [-18.6, 0.6, 39.9]]),
    qt('forearmL', [0, 0.38], [[-27.3, -19.6, -22.1], [-27.3, -19.6, -22.1]]),
    qt('head', [0, 0.2, 0.38], [[0, 10, 0], [0, -10, 0], [0, 0, 0]]),
  ]);
  clips.melee2 = new THREE.AnimationClip('melee2', 0.42, [
    qt('chest', [0, 0.15, 0.22, 0.42], [[2, 30, 0], [2, 38, 0], [4, -32, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.15, 0.22, 0.42], [[-60, 50, -10], [-70, 60, -10], [-85, -55, 10], [-30, 0, 8]]),
    qt('forearmR', [0, 0.15, 0.22, 0.42], [[-15, 0, 0], [-20, 0, 0], [-60, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.22, 0.42], [[-0.6, 0.6, 16.9], [-20.6, 0.6, 42.9], [-18.6, 0.6, 39.9]]),
    qt('forearmL', [0, 0.42], [[-27.3, -19.6, -22.1], [-27.3, -19.6, -22.1]]),
  ]);
  clips.melee3 = new THREE.AnimationClip('melee3', 0.55, [
    qt('chest', [0, 0.22, 0.3, 0.55], [[-14, 0, 0], [-20, 0, 0], [30, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.22, 0.3, 0.55], [[-150, 0, 10], [-165, 0, 10], [-40, 0, 5], [-30, 0, 8]]),
    qt('forearmR', [0, 0.22, 0.3, 0.55], [[-70, 0, 0], [-80, 0, 0], [-5, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.22, 0.3, 0.55], [[-120, 0, -20], [-140, 0, -25], [-70, 0, 15], [-18.6, 0.6, 39.9]]),
    qt('forearmL', [0, 0.3, 0.55], [[-60, 0, 0], [-18, -12, -12], [-27.3, -19.6, -22.1]]),
    qt('head', [0, 0.3, 0.55], [[-12, 0, 0], [14, 0, 0], [0, 0, 0]]),
  ]);

  // ---------- LOWER: melee stances, layered under the swings ----------
  // The legs join the fight: a weight drop and front step under the cross
  // cut, a rear pivot under the backhand, a deep lunge under the overhead.
  // One-shots on the lower channel, same durations as their upper halves so
  // both release together; the controller only plays them when grounded and
  // near-stationary — at speed the lunge impulse owns the legs.
  clips.meleeLower1 = new THREE.AnimationClip('meleeLower1', 0.38, [
    pt('hips', [0, 0.14, 0.2, 0.38], [[0, hipY - 0.01, 0], [0, hipY - 0.03, 0], [0, hipY - 0.06, 0], [0, hipY - 0.01, 0]]),
    qt('hips', [0, 0.14, 0.2, 0.38], [[4, -12, 0], [4, -16, 0], [6, 10, 0], [2, 0, 0]]),
    qt('upperLegL', [0, 0.14, 0.2, 0.38], [[-14, 0, 4], [-18, 0, 4], [-24, 0, 4], [-4, 0, 2]]),
    qt('lowerLegL', [0, 0.2, 0.38], [[16, 0, 0], [30, 0, 0], [6, 0, 0]]),
    qt('upperLegR', [0, 0.2, 0.38], [[6, 0, -4], [14, 0, -4], [-2, 0, -2]]),
    qt('lowerLegR', [0, 0.2, 0.38], [[14, 0, 0], [24, 0, 0], [6, 0, 0]]),
  ]);
  clips.meleeLower2 = new THREE.AnimationClip('meleeLower2', 0.42, [
    pt('hips', [0, 0.15, 0.22, 0.42], [[0, hipY - 0.01, 0], [0, hipY - 0.03, 0], [0, hipY - 0.06, 0], [0, hipY - 0.01, 0]]),
    qt('hips', [0, 0.15, 0.22, 0.42], [[4, 12, 0], [4, 16, 0], [6, -10, 0], [2, 0, 0]]),
    qt('upperLegR', [0, 0.15, 0.22, 0.42], [[-14, 0, -4], [-18, 0, -4], [-24, 0, -4], [-4, 0, -2]]),
    qt('lowerLegR', [0, 0.22, 0.42], [[16, 0, 0], [30, 0, 0], [6, 0, 0]]),
    qt('upperLegL', [0, 0.22, 0.42], [[6, 0, 4], [14, 0, 4], [-2, 0, 2]]),
    qt('lowerLegL', [0, 0.22, 0.42], [[14, 0, 0], [24, 0, 0], [6, 0, 0]]),
  ]);
  clips.meleeLower3 = new THREE.AnimationClip('meleeLower3', 0.55, [
    pt('hips', [0, 0.22, 0.3, 0.55], [[0, hipY - 0.02, 0], [0, hipY - 0.04, 0], [0, hipY - 0.11, 0.06], [0, hipY - 0.02, 0]]),
    qt('hips', [0, 0.22, 0.3, 0.55], [[-6, 0, 0], [-8, 0, 0], [10, 0, 0], [2, 0, 0]]),
    qt('upperLegL', [0, 0.22, 0.3, 0.55], [[-18, 0, 5], [-24, 0, 5], [-38, 0, 5], [-4, 0, 2]]),
    qt('lowerLegL', [0, 0.3, 0.55], [[20, 0, 0], [42, 0, 0], [6, 0, 0]]),
    qt('upperLegR', [0, 0.3, 0.55], [[10, 0, -5], [24, 0, -5], [-2, 0, -2]]),
    qt('lowerLegR', [0, 0.3, 0.55], [[18, 0, 0], [34, 0, 0], [6, 0, 0]]),
  ]);

  // ---------- UPPER: twin-saber combo ----------
  // The staff combo above parks the off hand: it is holding the far end of a
  // two-handed weapon, so hits one and two swing the right arm alone. With a
  // blade in each hand that reads as one dead arm, so the dual-wield set
  // alternates leads and finishes on a cross-slash that throws both out at once.
  clips.saber1 = new THREE.AnimationClip('saber1', 0.36, [
    qt('chest', [0, 0.13, 0.19, 0.36], [[2, -26, 0], [2, -32, 0], [4, 26, 0], [2, 0, 0]]),
    // right leads: cocked high outside, then cuts down across the body
    qt('upperArmR', [0, 0.13, 0.19, 0.36], [[-100, -34, 24], [-112, -44, 26], [-52, 48, -4], [-30, 0, 8]]),
    qt('forearmR', [0, 0.13, 0.19, 0.36], [[-58, 0, 0], [-70, 0, 0], [-8, 0, 0], [-25, 0, 0]]),
    // left counter-poises out and back, so the second blade is always live
    qt('upperArmL', [0, 0.13, 0.19, 0.36], [[-24, 10, 46], [-34, 14, 58], [-14, 4, 30], [-22, 2, 42]]),
    qt('forearmL', [0, 0.19, 0.36], [[-40, -14, -18], [-22, -20, -24], [-30, -18, -22]]),
    qt('head', [0, 0.19, 0.36], [[0, 12, 0], [0, -12, 0], [0, 0, 0]]),
  ]);
  clips.saber2 = new THREE.AnimationClip('saber2', 0.38, [
    qt('chest', [0, 0.15, 0.21, 0.38], [[2, 28, 0], [2, 36, 0], [4, -28, 0], [2, 0, 0]]),
    // left leads this time, mirroring the first hit
    qt('upperArmL', [0, 0.15, 0.21, 0.38], [[-100, 34, 24], [-112, 44, 18], [-52, -48, 52], [-22, 2, 42]]),
    qt('forearmL', [0, 0.15, 0.21, 0.38], [[-58, -10, -10], [-70, -12, -12], [-8, -20, -20], [-30, -18, -22]]),
    qt('upperArmR', [0, 0.15, 0.21, 0.38], [[-26, -10, 6], [-36, -14, 4], [-16, -4, 10], [-30, 0, 8]]),
    qt('forearmR', [0, 0.21, 0.38], [[-40, 0, 0], [-18, 0, 0], [-25, 0, 0]]),
    qt('head', [0, 0.21, 0.38], [[0, -12, 0], [0, 12, 0], [0, 0, 0]]),
  ]);
  clips.saber3 = new THREE.AnimationClip('saber3', 0.5, [
    // finisher: both blades gathered across the chest, held a beat, then
    // thrown apart fast — the gather is the anticipation, the throw the snap
    qt('chest', [0, 0.22, 0.29, 0.5], [[-6, 0, 0], [-16, 0, 0], [16, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.22, 0.29, 0.5], [[-70, 40, -10], [-84, 52, -14], [-64, -62, 22], [-30, 0, 8]]),
    qt('forearmR', [0, 0.22, 0.29, 0.5], [[-72, 0, 0], [-88, 0, 0], [-10, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.22, 0.29, 0.5], [[-70, -40, 10], [-84, -52, 14], [-64, 62, 70], [-22, 2, 42]]),
    qt('forearmL', [0, 0.22, 0.29, 0.5], [[-72, -10, -10], [-88, -12, -12], [-10, -20, -20], [-30, -18, -22]]),
    qt('head', [0, 0.29, 0.5], [[-10, 0, 0], [12, 0, 0], [0, 0, 0]]),
  ]);

  // ---------- UPPER: saber stance (blades lit, between swings) ----------
  // A duelist reads from the ready, not the swing. Out of a swing the twin
  // blades used to hang from the generic idle/run arms like tools; these hold
  // a right-lead guard — main blade low and forward, off blade high and back —
  // and the controller picks them whenever the sabers are drawn.
  clips.saberIdleUpper = new THREE.AnimationClip('saberIdleUpper', 3, [
    qt('chest', [0, 1.5, 3], [[4, -18, 0], [5, -21, 0], [4, -18, 0]]),
    qt('head', [0, 1.5, 3], [[2, 15, 0], [2, 13, 0], [2, 15, 0]]),
    // main blade: low guard, point toward the threat
    qt('upperArmR', [0, 1.5, 3], [[-38, -8, -16], [-41, -8, -17], [-38, -8, -16]]),
    qt('forearmR', [0, 1.5, 3], [[-42, 10, 0], [-45, 10, 0], [-42, 10, 0]]),
    // off blade: raised behind the lead shoulder, live and visible
    qt('upperArmL', [0, 1.5, 3], [[-26, 18, 38], [-29, 19, 40], [-26, 18, 38]]),
    qt('forearmL', [0, 1.5, 3], [[-64, -12, -16], [-67, -12, -17], [-64, -12, -16]]),
  ]);
  clips.saberRunUpper = new THREE.AnimationClip('saberRunUpper', 0.6, [
    // blades carried, not pumped: held out of the legs' way with a small
    // counter-swing, so a lit run doesn't windmill plasma past her own hips
    qt('chest', rt, [[6, -8, 1], [6, -4, 0], [6, 0, -1], [6, -4, 0], [6, -8, 1]]),
    qt('head', rt, [[-4, 6, 0], [-4, 4, 0], [-4, 2, 0], [-4, 4, 0], [-4, 6, 0]]),
    qt('upperArmR', rt, [[-30, -6, -22], [-24, -6, -20], [-18, -6, -22], [-24, -6, -20], [-30, -6, -22]]),
    qt('forearmR', rt, [[-38, 8, 0], [-32, 8, 0], [-26, 8, 0], [-32, 8, 0], [-38, 8, 0]]),
    qt('upperArmL', rt, [[-16, 12, 34], [-22, 12, 36], [-28, 12, 34], [-22, 12, 36], [-16, 12, 34]]),
    qt('forearmL', rt, [[-52, -10, -14], [-58, -10, -16], [-64, -10, -14], [-58, -10, -16], [-52, -10, -14]]),
  ]);

  // ---------- UPPER: saber flourish (combo punctuation) ----------
  // Played once when the combo window lapses with blades still lit: both
  // wrists circle the blades once and settle back into the guard. Pure
  // theatre, no hitbox — the beat between phrases of the fight.
  clips.saberFlourish = new THREE.AnimationClip('saberFlourish', 0.55, [
    qt('chest', [0, 0.2, 0.4, 0.55], [[2, 0, 0], [3, -10, 0], [4, -16, 0], [4, -18, 0]]),
    qt('upperArmR', [0, 0.14, 0.28, 0.42, 0.55], [[-30, 0, 8], [-52, -24, -10], [-46, 30, -24], [-40, -4, -18], [-38, -8, -16]]),
    qt('forearmR', [0, 0.14, 0.28, 0.42, 0.55], [[-25, 0, 0], [-48, -60, 0], [-40, 70, 0], [-44, 16, 0], [-42, 10, 0]]),
    qt('handR', [0, 0.14, 0.28, 0.42, 0.55], [[0, 0, 0], [26, 0, -30], [-26, 0, 30], [6, 0, -8], [0, 0, 0]]),
    qt('upperArmL', [0, 0.18, 0.32, 0.46, 0.55], [[-22, 2, 42], [-38, 20, 50], [-32, -22, 34], [-27, 16, 39], [-26, 18, 38]]),
    qt('forearmL', [0, 0.18, 0.32, 0.46, 0.55], [[-30, -18, -22], [-56, 48, -18], [-48, -58, -20], [-62, -14, -17], [-64, -12, -16]]),
    qt('handL', [0, 0.18, 0.32, 0.46, 0.55], [[0, 0, 0], [-26, 0, 28], [26, 0, -28], [-5, 0, 6], [0, 0, 0]]),
    qt('head', [0, 0.28, 0.55], [[0, 0, 0], [1, 8, 0], [2, 15, 0]]),
  ]);

  // ---------- UPPER: block (shield up, braced behind it) ----------
  //
  // The shield hangs off the chest and opens along its +Z, so every degree the
  // chest is pitched forward is a degree the shield is aimed at the floor.
  // Stacked on the spine and the braced hips this came to about 20°, and the
  // block read as cowering into the ground rather than facing what is shooting
  // at it. The lean is now a few degrees of brace, and the head tips up over
  // the rim by as much, so the visor and the dome both point down the sights.
  clips.blockUpper = new THREE.AnimationClip('blockUpper', 2, [
    qt('chest', [0, 1, 2], [[2, -6, 0], [3, -7, 0], [2, -6, 0]]),
    qt('head', [0, 2], [[-3, 10, 0], [-3, 10, 0]]),
    // forearm across the body, the other bracing it — the shield hangs off both
    qt('upperArmL', [0, 1, 2], [[-64, 22, 14], [-66, 24, 15], [-64, 22, 14]]),
    qt('forearmL', [0, 2], [[-74, 0, 0], [-74, 0, 0]]),
    qt('upperArmR', [0, 1, 2], [[-52, -26, -18], [-54, -28, -19], [-52, -26, -18]]),
    qt('forearmR', [0, 2], [[-62, 0, 0], [-62, 0, 0]]),
  ]);
  // legs braced wide, weight back
  clips.blockLower = new THREE.AnimationClip('blockLower', 2, [
    pt('hips', [0, 1, 2], [[0, hipY - 0.08, 0], [0, hipY - 0.09, 0], [0, hipY - 0.08, 0]]),
    // the crouch and the bladed stance stay; the forward pitch does not — it is
    // what tipped the shield toward the ground (see blockUpper)
    qt('hips', [0, 2], [[2, -12, 0], [2, -12, 0]]),
    qt('spine', [0, 2], [[1, 0, 0], [1, 0, 0]]),
    qt('upperLegL', [0, 2], [[-26, 0, 8], [-26, 0, 8]]),
    qt('lowerLegL', [0, 2], [[34, 0, 0], [34, 0, 0]]),
    qt('upperLegR', [0, 2], [[16, 0, -10], [16, 0, -10]]),
    qt('lowerLegR', [0, 2], [[26, 0, 0], [26, 0, 0]]),
  ]);

  // ---------- UPPER: hit flinch ----------
  clips.hitUpper = new THREE.AnimationClip('hitUpper', 0.28, [
    qt('chest', [0, 0.08, 0.28], [[-14, -6, 0], [-18, -8, 0], [1, 0, 0]]),
    qt('head', [0, 0.08, 0.28], [[-16, 0, 0], [-20, -4, 0], [0, 0, 0]]),
    qt('upperArmL', [0, 0.08, 0.28], [[20, 0, 30], [26, 0, 36], [8, 0, 10]]),
    qt('upperArmR', [0, 0.08, 0.28], [[20, 0, -30], [26, 0, -36], [8, 0, -10]]),
  ]);
  // Directional variants: a bolt from the flank rocks the body away from it
  // and snaps the head toward the shooter. `hitFromR` is a hit arriving from
  // the rig's `R` side (-X, the character's right); the +X side is its mirror.
  // The controller picks by the attacker's bearing and falls back to the
  // frontal flinch.
  clips.hitFromR = new THREE.AnimationClip('hitFromR', 0.28, [
    qt('chest', [0, 0.08, 0.28], [[-6, -10, 9], [-8, -14, 12], [1, 0, 0]]),
    qt('head', [0, 0.08, 0.28], [[-6, -18, 6], [-8, -26, 8], [0, 0, 0]]),
    qt('upperArmR', [0, 0.08, 0.28], [[14, 0, -34], [18, 0, -42], [8, 0, -10]]),
    qt('upperArmL', [0, 0.08, 0.28], [[10, 0, 16], [12, 0, 20], [8, 0, 10]]),
  ]);
  clips.hitFromL = mirrorClip(clips.hitFromR, 'hitFromL');

  // ---------- FULL: death (crumple back) ----------
  clips.deathLower = new THREE.AnimationClip('deathLower', 0.8, [
    pt('hips', [0, 0.35, 0.8], [[0, hipY, 0], [0, hipY * 0.45, -0.2], [0, 0.22, -0.45]]),
    qt('hips', [0, 0.35, 0.8], [[0, 0, 0], [-38, 0, -6], [-78, 0, -10]]),
    qt('upperLegL', [0, 0.8], [[-20, 0, 6], [-40, 0, 10]]),
    qt('lowerLegL', [0, 0.8], [[30, 0, 0], [55, 0, 0]]),
    qt('upperLegR', [0, 0.8], [[-30, 0, -8], [-25, 0, -12]]),
    qt('lowerLegR', [0, 0.8], [[40, 0, 0], [30, 0, 0]]),
  ]);
  clips.deathUpper = new THREE.AnimationClip('deathUpper', 0.8, [
    qt('chest', [0, 0.35, 0.8], [[-10, 0, 0], [-18, -8, 0], [-14, -12, 0]]),
    qt('head', [0, 0.8], [[-10, 0, 0], [-24, -14, 0]]),
    qt('upperArmL', [0, 0.8], [[20, 0, 40], [40, 0, 70]]),
    qt('upperArmR', [0, 0.8], [[20, 0, -40], [50, 0, -60]]),
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
    qt('hips', [0, 0.6], [[0, 0, 0], [-7, 0, -5]]),
    qt('upperLegL', [0, 0.6], [[0, 0, 4], [-7, 0, 14]]),
    qt('lowerLegL', [0, 0.6], [[0, 0, 0], [16, 0, 0]]),
    qt('upperLegR', [0, 0.6], [[0, 0, -4], [-3, 0, -11]]),
    qt('lowerLegR', [0, 0.6], [[0, 0, 0], [23, 0, 0]]),
  ]);
  clips.collapseUpper = new THREE.AnimationClip('collapseUpper', 0.6, [
    qt('chest', [0, 0.6], [[0, 0, 0], [7, -7, 0]]),
    qt('head', [0, 0.6], [[0, 0, 0], [12, -14, 0]]),
    qt('upperArmL', [0, 0.6], [[10, 0, 30], [26, 0, 64]]),
    qt('upperArmR', [0, 0.6], [[10, 0, -30], [30, 0, -60]]),
    qt('forearmL', [0, 0.6], [[-14, 0, 0], [-24, 0, 0]]),
    qt('forearmR', [0, 0.6], [[-14, 0, 0], [-18, 0, 0]]),
  ]);

  // ---------- UPPER: one-hand pistol/rifle aim for enemies ----------
  clips.enemyAimUpper = new THREE.AnimationClip('enemyAimUpper', 1, [
    qt('chest', [0, 1], [[2, 12, 0], [2, 12, 0]]),
    qt('shoulderR', [0, 1], [[0, 7, -9], [0, 7, -9]]),
    qt('shoulderL', [0, 1], [[0, -7, 9], [0, -7, 9]]),
    qt('upperArmR', [0, 1], [[-68, -8, -10], [-68, -8, -10]]),
    qt('forearmR', [0, 1], [[-24, 0, 0], [-24, 0, 0]]),
    qt('handR', [0, 1], [[7.5, -12.7, 4.7], [7.5, -12.7, 4.7]]),
    qt('upperArmL', [0, 1], [[-52, 28, 8], [-52, 28, 8]]),
    qt('forearmL', [0, 1], [[-58, -12, -34], [-58, -12, -34]]),
  ]);

  // ---------- UPPER: two-hand overhead swing for melee enemies ----------
  // The long cock IS the telegraph (enemy.ts winds up 0.55 s before damage),
  // so the hold stretches to 0.42 and the drop lands its strike key at 0.55 —
  // exactly when the damage does. The old even spacing had the club already
  // in follow-through when the hit landed.
  clips.enemySwing = new THREE.AnimationClip('enemySwing', 0.7, [
    qt('chest', [0, 0.42, 0.55, 0.7], [[-16, 0, 0], [-24, 0, 0], [34, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.42, 0.55, 0.7], [[-150, 0, 14], [-168, 0, 14], [-45, 0, 6], [-20, 0, 8]]),
    qt('forearmR', [0, 0.42, 0.55, 0.7], [[-65, 0, 0], [-80, 0, 0], [-8, 0, 0], [-20, 0, 0]]),
    qt('upperArmL', [0, 0.42, 0.55, 0.7], [[-130, 0, -18], [-150, 0, -22], [-70, 0, 15], [-18.6, 0.6, 39.9]]),
    qt('forearmL', [0, 0.55, 0.7], [[-60, 0, 0], [-18, -12, -12], [-27.3, -19.6, -22.1]]),
  ]);

  return clips;
}
