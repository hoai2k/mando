import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';
import { counterweightTracks } from '../anim/counterweight';

/** Spear studies shared by the workbench and selected game combo variants. */
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
  // forward axis. These are one-handed strikes with a keyed free-arm counterweight.
  const guardR: Angles = [-69, -12, -15];
  const recoverR: Angles = [-68, -10, -14];
  const clips: ClipSet = {};

  // Test 2: long thrust and front-foot lunge. The extension precedes the step.
  const b = [0, 0.18, 0.31, 0.47, 0.65, 1.08];
  clips.spearTest2Upper = new THREE.AnimationClip('spearTest2Upper', 1.08, [
    rot('chest', b, [[2, -22, 0], [2, -22, 0], [2, -14, 0], [7, 13, 0], [7, 13, 0], [2, -22, 0]]),
    rot('upperArmR', b, [guardR, guardR, [-86, -8, -10], [-103, 7, -5], [-100, 7, -5], recoverR]),
    rot('forearmR', b, [[-49, 0, 0], [-49, 0, 0], [-24, 0, 0], [-5, 0, 0], [-7, 0, 0], [-47, 0, 0]]),
    ...counterweightTracks('spearTest2Upper', b),
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

  // The study was deliberately slow for inspection. Its keyed
  // timing now matches the faster combat preview and occasional game use.
  for (const clip of Object.values(clips)) {
    for (const track of clip.tracks) track.scale(0.5);
    clip.duration *= 0.5;
  }
  return clips;
}
