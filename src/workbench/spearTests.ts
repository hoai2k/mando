import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';

/** Workbench-only spear studies. The game's melee combo remains untouched. */
const D = Math.PI / 180;
type Angles = [number, number, number];
const rot = (bone: string, times: number[], poses: Angles[]): THREE.QuaternionKeyframeTrack => {
  const values = poses.flatMap(([x, y, z]) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D));
    return [q.x, q.y, q.z, q.w];
  });
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
};
const pos = (bone: string, times: number[], poses: Angles[]): THREE.VectorKeyframeTrack =>
  new THREE.VectorKeyframeTrack(`${bone}.position`, times, poses.flat());

export function spearTestClips(p: Proportions): ClipSet {
  const y = p.hipHeight;
  // The point is local +Y and the mount turns it toward the extended arm's
  // forward axis. The base hand follows the rear shaft through polearmGrip.
  const guardR: Angles = [-69, -12, -15];
  const guardL: Angles = [-73, 25, 14];
  const recoverR: Angles = [-68, -10, -14];
  const recoverL: Angles = [-70, 24, 15];
  const clips: ClipSet = {};

  // Test 1: fixed-foot extension. Point and hands lead; torso arrives after.
  const a = [0, 0.17, 0.3, 0.39, 0.56, 0.9];
  clips.spearTest1Upper = new THREE.AnimationClip('spearTest1Upper', 0.9, [
    rot('chest', a, [[1, -18, 0], [1, -18, 0], [0, -12, 0], [3, 5, 0], [3, 5, 0], [1, -18, 0]]),
    rot('upperArmR', a, [guardR, guardR, [-82, -10, -10], [-94, 0, -7], [-90, 0, -7], recoverR]),
    rot('forearmR', a, [[-46, 0, 0], [-46, 0, 0], [-28, 0, 0], [-9, 0, 0], [-11, 0, 0], [-44, 0, 0]]),
    rot('handR', a, [[4, 0, 0], [4, 0, 0], [0, 0, 0], [-2, 0, 0], [-2, 0, 0], [4, 0, 0]]),
    rot('upperArmL', a, [guardL, guardL, [-79, 18, 12], [-83, 12, 10], [-81, 12, 10], recoverL]),
    rot('forearmL', a, [[-52, -18, -26], [-52, -18, -26], [-38, -18, -26], [-28, -16, -22], [-30, -16, -22], [-50, -18, -26]]),
    rot('head', a, [[0, 7, 0], [0, 7, 0], [0, 4, 0], [0, -2, 0], [0, -2, 0], [0, 7, 0]]),
  ]);
  clips.spearTest1Lower = new THREE.AnimationClip('spearTest1Lower', 0.9, [
    pos('hips', a, [[0, y - 0.035, 0], [0, y - 0.035, 0], [0, y - 0.04, 0], [0, y - 0.055, 0.025], [0, y - 0.055, 0.025], [0, y - 0.035, 0]]),
    rot('hips', a, [[2, -12, 0], [2, -12, 0], [2, -10, 0], [4, 2, 0], [4, 2, 0], [2, -12, 0]]),
    rot('upperLegL', [0, 0.39, 0.9], [[-18, 0, 5], [-24, 0, 5], [-18, 0, 5]]),
    rot('lowerLegL', [0, 0.39, 0.9], [[23, 0, 0], [30, 0, 0], [23, 0, 0]]),
    rot('upperLegR', [0, 0.39, 0.9], [[12, 0, -5], [15, 0, -5], [12, 0, -5]]),
    rot('lowerLegR', [0, 0.39, 0.9], [[17, 0, 0], [20, 0, 0], [17, 0, 0]]),
  ]);

  // Test 2: long thrust and front-foot lunge. The extension precedes the step.
  const b = [0, 0.18, 0.31, 0.47, 0.65, 1.08];
  clips.spearTest2Upper = new THREE.AnimationClip('spearTest2Upper', 1.08, [
    rot('chest', b, [[2, -22, 0], [2, -22, 0], [2, -14, 0], [7, 13, 0], [7, 13, 0], [2, -22, 0]]),
    rot('upperArmR', b, [guardR, guardR, [-86, -8, -10], [-103, 7, -5], [-100, 7, -5], recoverR]),
    rot('forearmR', b, [[-49, 0, 0], [-49, 0, 0], [-24, 0, 0], [-5, 0, 0], [-7, 0, 0], [-47, 0, 0]]),
    rot('upperArmL', b, [guardL, guardL, [-80, 19, 12], [-91, 12, 7], [-88, 12, 7], recoverL]),
    rot('forearmL', b, [[-54, -18, -27], [-54, -18, -27], [-38, -18, -24], [-21, -14, -19], [-23, -14, -19], [-52, -18, -27]]),
    rot('head', b, [[0, 8, 0], [0, 8, 0], [0, 5, 0], [0, -5, 0], [0, -5, 0], [0, 8, 0]]),
  ]);
  clips.spearTest2Lower = new THREE.AnimationClip('spearTest2Lower', 1.08, [
    pos('hips', b, [[0, y - 0.04, 0], [0, y - 0.04, 0], [0, y - 0.055, 0.015], [0, y - 0.14, 0.13], [0, y - 0.14, 0.13], [0, y - 0.04, 0]]),
    rot('hips', b, [[3, -15, 0], [3, -15, 0], [4, -11, 0], [9, 8, 0], [9, 8, 0], [3, -15, 0]]),
    rot('upperLegL', b, [[-20, 0, 6], [-20, 0, 6], [-25, 0, 6], [-48, 0, 5], [-48, 0, 5], [-20, 0, 6]]),
    rot('lowerLegL', b, [[23, 0, 0], [23, 0, 0], [27, 0, 0], [52, 0, 0], [52, 0, 0], [23, 0, 0]]),
    rot('upperLegR', b, [[13, 0, -6], [13, 0, -6], [16, 0, -6], [25, 0, -6], [25, 0, -6], [13, 0, -6]]),
    rot('lowerLegR', b, [[16, 0, 0], [16, 0, 0], [16, 0, 0], [27, 0, 0], [27, 0, 0], [16, 0, 0]]),
  ]);

  // Test 3: outward circular deflection, immediate straight riposte.
  const c = [0, 0.16, 0.31, 0.44, 0.55, 0.73, 1.16];
  clips.spearTest3Upper = new THREE.AnimationClip('spearTest3Upper', 1.16, [
    rot('chest', c, [[2, -17, 0], [2, -12, 0], [1, 9, 0], [1, 4, 0], [3, 16, 0], [3, 16, 0], [2, -17, 0]]),
    rot('upperArmR', c, [guardR, [-72, -34, -10], [-78, 32, -8], [-85, 18, -8], [-98, 4, -5], [-96, 4, -5], recoverR]),
    rot('forearmR', c, [[-46, 0, 0], [-38, 0, 0], [-33, 0, 0], [-24, 0, 0], [-8, 0, 0], [-9, 0, 0], [-45, 0, 0]]),
    rot('upperArmL', c, [guardL, [-77, 11, 15], [-82, 40, 10], [-82, 27, 10], [-87, 13, 8], [-86, 13, 8], recoverL]),
    rot('forearmL', c, [[-52, -18, -26], [-49, -20, -24], [-44, -12, -22], [-37, -14, -22], [-26, -14, -19], [-26, -14, -19], [-52, -18, -26]]),
    rot('head', c, [[0, 6, 0], [0, 2, 0], [0, -8, 0], [0, -4, 0], [0, -8, 0], [0, -8, 0], [0, 6, 0]]),
  ]);
  clips.spearTest3Lower = new THREE.AnimationClip('spearTest3Lower', 1.16, [
    pos('hips', c, [[0, y - 0.04, 0], [0, y - 0.05, 0], [0.025, y - 0.065, 0], [0.025, y - 0.055, 0], [0, y - 0.095, 0.07], [0, y - 0.095, 0.07], [0, y - 0.04, 0]]),
    rot('hips', c, [[2, -12, 0], [2, -8, 0], [3, 5, 0], [3, 2, 0], [6, 11, 0], [6, 11, 0], [2, -12, 0]]),
    rot('upperLegL', c, [[-20, 0, 5], [-20, 0, 5], [-20, 0, 5], [-22, 0, 5], [-36, 0, 5], [-36, 0, 5], [-20, 0, 5]]),
    rot('lowerLegL', c, [[24, 0, 0], [24, 0, 0], [26, 0, 0], [26, 0, 0], [40, 0, 0], [40, 0, 0], [24, 0, 0]]),
    rot('upperLegR', c, [[12, 0, -5], [12, 0, -5], [16, 0, -5], [16, 0, -5], [21, 0, -5], [21, 0, -5], [12, 0, -5]]),
    rot('lowerLegR', c, [[17, 0, 0], [17, 0, 0], [18, 0, 0], [18, 0, 0], [23, 0, 0], [23, 0, 0], [17, 0, 0]]),
  ]);
  return clips;
}
