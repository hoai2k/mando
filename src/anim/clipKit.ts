import * as THREE from 'three';
import type { Proportions } from './skeleton';

/**
 * A small kit for writing clips the way choreography describes them: limbs
 * pointed in the chest's frame, keys placed at shares of the clip, stances
 * named rather than spelled out in Euler angles.
 */

export type V3 = [number, number, number];
export type Key = V3 | THREE.Quaternion;
const D = Math.PI / 180;
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * An upper arm aimed along `dir` in the chest's frame (+X the fighter's left,
 * +Y up, +Z forward), turned `twist` degrees about itself.
 */
export function aim(dir: V3, twist = 0): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(DOWN, new THREE.Vector3(...dir).normalize());
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(DOWN, twist * D));
}
/** the same aim for the left arm: across the body's midline */
export const aimL = (dir: V3, twist = 0): THREE.Quaternion => aim([-dir[0], dir[1], dir[2]], -twist);
/** an Euler key mirrored onto the other side, as `mirrorClip` does it */
export const mir = ([x, y, z]: V3): V3 => [x, -y, -z];

function track(bone: string, times: number[], keys: Key[]): THREE.QuaternionKeyframeTrack {
  const values = keys.flatMap((k) => (k instanceof THREE.Quaternion ? k
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(k[0] * D, k[1] * D, k[2] * D))).toArray());
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

export interface Spec {
  dur: number;
  /** key times as shares of the clip */
  at: number[];
  bones: Record<string, Key[]>;
  hips?: V3[];
}

export function build(name: string, spec: Spec): THREE.AnimationClip {
  const times = spec.at.map((t) => t * spec.dur);
  const tracks: THREE.KeyframeTrack[] = Object.entries(spec.bones).map(([bone, keys]) => {
    if (keys.length !== times.length) throw new Error(`${name}.${bone}: ${keys.length} keys for ${times.length} times`);
    return track(bone, times, keys);
  });
  if (spec.hips) tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, spec.hips.flat()));
  return new THREE.AnimationClip(name, spec.dur, tracks);
}

export type Legs = Record<'upperLegL' | 'lowerLegL' | 'upperLegR' | 'lowerLegR', V3>;
export const SET: Legs = { upperLegL: [-14, 0, 5], lowerLegL: [18, 0, 0], upperLegR: [8, 0, -5], lowerLegR: [16, 0, 0] };
export const LUNGE: Legs = { upperLegL: [-40, 0, 5], lowerLegL: [44, 0, 0], upperLegR: [24, 0, -6], lowerLegR: [34, 0, 0] };
export const WIDE: Legs = { upperLegL: [-22, 0, 14], lowerLegL: [40, 0, 0], upperLegR: [-8, 0, -14], lowerLegR: [38, 0, 0] };
export const legs = (...poses: Legs[]): Record<string, Key[]> => ({
  upperLegL: poses.map((p) => p.upperLegL), lowerLegL: poses.map((p) => p.lowerLegL),
  upperLegR: poses.map((p) => p.upperLegR), lowerLegR: poses.map((p) => p.lowerLegR),
});

/** hips at a drop below standing and a shift forward, in metres */
export const hipsAt = (p: Proportions, ...drops: Array<[number, number]>): V3[] =>
  drops.map(([down, fwd]) => [0, p.hipHeight - down, fwd]);

/** a two-bone limb's keys: the upper bone's turn and the hinge's bend */
export interface Limb { upper: THREE.Quaternion; lower: V3 }

/**
 * Put the end of a two-bone limb at `to`, from the limb's root, in the
 * parent's frame (the chest's for an arm, the hips' for a leg), with the
 * middle joint bowed toward `pole`. The hinge is the lower bone's X: an elbow
 * folds the forearm forward (a negative turn), a knee folds the shin back
 * (`knee` true, a positive one). Past full reach the limb lies straight at it.
 */
export function reach(lenA: number, lenB: number, to: V3, pole: V3, knee = false): Limb {
  const t = new THREE.Vector3(...to);
  const d = THREE.MathUtils.clamp(t.length(), Math.abs(lenA - lenB) + 1e-3, lenA + lenB - 1e-4);
  const dir = t.normalize();
  const side = new THREE.Vector3(...pole).addScaledVector(dir, -new THREE.Vector3(...pole).dot(dir)).normalize();
  const cosA = (lenA * lenA + d * d - lenB * lenB) / (2 * lenA * d);
  const along = dir.clone().multiplyScalar(cosA).addScaledVector(side, Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  const lower = dir.clone().multiplyScalar(d).addScaledVector(along, -lenA).normalize();
  const flex = Math.acos(THREE.MathUtils.clamp(along.dot(lower), -1, 1));
  // the bone's -Y runs down the upper bone; the lower one folds toward +Z for
  // an elbow, -Z for a knee, so Z follows the lower bone's offset from
  // straight — away from the pole, the way it folds once bent
  const y = along.clone().negate();
  const off = lower.clone().addScaledVector(along, -lower.dot(along));
  const z = (off.lengthSq() > 1e-6 ? off.normalize() : side.clone().negate()).multiplyScalar(knee ? -1 : 1);
  const x = new THREE.Vector3().crossVectors(y, z);
  const upper = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return { upper, lower: [(knee ? 1 : -1) * flex / D, 0, 0] };
}
