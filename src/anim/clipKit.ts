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
