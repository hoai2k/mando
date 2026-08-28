import * as THREE from 'three';
import type { Proportions } from './skeleton';

/**
 * Procedurally authored AnimationClips on the canonical skeleton.
 * Clips are split into LOWER (hips/legs/spine locomotion) and UPPER
 * (chest/arms/head actions) so the animator can layer shooting/melee
 * over any locomotion state. All clips are standard THREE.AnimationClips,
 * so authored clips from a glTF can replace them 1:1.
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

export function buildClips(p: Proportions): ClipSet {
  const hipY = p.hipHeight;
  const clips: ClipSet = {};

  // ---------- LOWER: idle ----------
  clips.idleLower = new THREE.AnimationClip('idleLower', 3, [
    pt('hips', [0, 1.5, 3], [[0, hipY, 0], [0, hipY - 0.015, 0], [0, hipY, 0]]),
    qt('hips', [0, 1.5, 3], [[0, 0, 0], [1, 0, 1], [0, 0, 0]]),
    qt('spine', [0, 1.5, 3], [[2, 0, 0], [3.5, 0, 0], [2, 0, 0]]),
    qt('upperLegL', [0, 3], [[-3, 0, 2], [-3, 0, 2]]),
    qt('upperLegR', [0, 3], [[-3, 0, -2], [-3, 0, -2]]),
    qt('lowerLegL', [0, 3], [[5, 0, 0], [5, 0, 0]]),
    qt('lowerLegR', [0, 3], [[5, 0, 0], [5, 0, 0]]),
  ]);

  // ---------- UPPER: idle ----------
  clips.idleUpper = new THREE.AnimationClip('idleUpper', 3, [
    qt('chest', [0, 1.5, 3], [[1, 0, 0], [2.5, 1, 0], [1, 0, 0]]),
    qt('upperArmL', [0, 1.5, 3], [[8, 0, 10], [10, 0, 11], [8, 0, 10]]),
    qt('upperArmR', [0, 1.5, 3], [[8, 0, -10], [10, 0, -11], [8, 0, -10]]),
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
    qt('upperLegL', rt, [[-48, 0, 0], [-10, 0, 0], [30, 0, 0], [-5, 0, 0], [-48, 0, 0]]),
    qt('lowerLegL', rt, [[25, 0, 0], [15, 0, 0], [55, 0, 0], [80, 0, 0], [25, 0, 0]]),
    qt('upperLegR', rt, [[30, 0, 0], [-5, 0, 0], [-48, 0, 0], [-10, 0, 0], [30, 0, 0]]),
    qt('lowerLegR', rt, [[55, 0, 0], [80, 0, 0], [25, 0, 0], [15, 0, 0], [55, 0, 0]]),
    qt('footL', rt, [[10, 0, 0], [0, 0, 0], [-15, 0, 0], [-5, 0, 0], [10, 0, 0]]),
    qt('footR', rt, [[-15, 0, 0], [-5, 0, 0], [10, 0, 0], [0, 0, 0], [-15, 0, 0]]),
  ]);

  // ---------- UPPER: run (arm swing) ----------
  clips.runUpper = new THREE.AnimationClip('runUpper', 0.6, [
    qt('chest', rt, [[6, 5, 0], [6, 0, 0], [6, -5, 0], [6, 0, 0], [6, 5, 0]]),
    qt('upperArmL', rt, [[35, 0, 8], [5, 0, 8], [-30, 0, 8], [5, 0, 8], [35, 0, 8]]),
    qt('forearmL', rt, [[-40, 0, 0], [-55, 0, 0], [-70, 0, 0], [-55, 0, 0], [-40, 0, 0]]),
    qt('upperArmR', rt, [[-30, 0, -8], [5, 0, -8], [35, 0, -8], [5, 0, -8], [-30, 0, -8]]),
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

  // ---------- LOWER/UPPER: jetpack flight (legs trail, superman-lite) ----------
  clips.flyLower = new THREE.AnimationClip('flyLower', 1.6, [
    pt('hips', [0, 0.8, 1.6], [[0, hipY, 0], [0, hipY + 0.02, 0], [0, hipY, 0]]),
    qt('hips', [0, 0.8, 1.6], [[18, 0, 0], [22, 0, 0], [18, 0, 0]]),
    qt('upperLegL', [0, 0.8, 1.6], [[14, 0, 3], [18, 0, 3], [14, 0, 3]]),
    qt('lowerLegL', [0, 0.8, 1.6], [[28, 0, 0], [32, 0, 0], [28, 0, 0]]),
    qt('upperLegR', [0, 0.8, 1.6], [[18, 0, -3], [14, 0, -3], [18, 0, -3]]),
    qt('lowerLegR', [0, 0.8, 1.6], [[32, 0, 0], [28, 0, 0], [32, 0, 0]]),
    qt('footL', [0, 1.6], [[35, 0, 0], [35, 0, 0]]),
    qt('footR', [0, 1.6], [[35, 0, 0], [35, 0, 0]]),
  ]);
  clips.flyUpper = new THREE.AnimationClip('flyUpper', 1.6, [
    qt('chest', [0, 0.8, 1.6], [[-8, 0, 0], [-10, 0, 0], [-8, 0, 0]]),
    qt('upperArmL', [0, 0.8, 1.6], [[10, 0, 28], [12, 0, 32], [10, 0, 28]]),
    qt('forearmL', [0, 1.6], [[-30, 0, 0], [-30, 0, 0]]),
    qt('upperArmR', [0, 0.8, 1.6], [[10, 0, -28], [12, 0, -32], [10, 0, -28]]),
    qt('forearmR', [0, 1.6], [[-30, 0, 0], [-30, 0, 0]]),
    qt('head', [0, 1.6], [[-14, 0, 0], [-14, 0, 0]]),
  ]);

  // ---------- UPPER: aim carbine (two-handed, right shoulder) ----------
  clips.aimUpper = new THREE.AnimationClip('aimUpper', 1, [
    qt('chest', [0, 1], [[2, -18, 0], [2, -18, 0]]),
    qt('upperArmR', [0, 1], [[-72, 12, -4], [-72, 12, -4]]),
    qt('forearmR', [0, 1], [[-18, 0, 0], [-18, 0, 0]]),
    qt('handR', [0, 1], [[0, -8, 0], [0, -8, 0]]),
    qt('upperArmL', [0, 1], [[-58, -38, 10], [-58, -38, 10]]),
    qt('forearmL', [0, 1], [[-52, 0, 0], [-52, 0, 0]]),
    qt('head', [0, 1], [[0, 16, 0], [0, 16, 0]]),
  ]);

  // ---------- UPPER: melee combo (gaffi stick in right hand) ----------
  clips.melee1 = new THREE.AnimationClip('melee1', 0.38, [
    qt('chest', [0, 0.1, 0.22, 0.38], [[2, 28, 0], [2, 34, 0], [4, -30, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.1, 0.22, 0.38], [[-95, 30, -20], [-105, 40, -20], [-55, -45, 0], [-30, 0, -8]]),
    qt('forearmR', [0, 0.1, 0.22, 0.38], [[-55, 0, 0], [-65, 0, 0], [-10, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.22, 0.38], [[20, 0, 30], [35, 0, 42], [12, 0, 15]]),
    qt('head', [0, 0.22, 0.38], [[0, -10, 0], [0, 10, 0], [0, 0, 0]]),
  ]);
  clips.melee2 = new THREE.AnimationClip('melee2', 0.42, [
    qt('chest', [0, 0.1, 0.24, 0.42], [[2, -30, 0], [2, -38, 0], [4, 32, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.1, 0.24, 0.42], [[-60, -50, 10], [-70, -60, 10], [-85, 55, -10], [-30, 0, -8]]),
    qt('forearmR', [0, 0.1, 0.24, 0.42], [[-15, 0, 0], [-20, 0, 0], [-60, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.24, 0.42], [[30, 0, 38], [10, 0, 12], [12, 0, 15]]),
  ]);
  clips.melee3 = new THREE.AnimationClip('melee3', 0.55, [
    qt('chest', [0, 0.16, 0.3, 0.55], [[-14, 0, 0], [-20, 0, 0], [30, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.16, 0.3, 0.55], [[-150, 0, -10], [-165, 0, -10], [-40, 0, -5], [-30, 0, -8]]),
    qt('forearmR', [0, 0.16, 0.3, 0.55], [[-70, 0, 0], [-80, 0, 0], [-5, 0, 0], [-25, 0, 0]]),
    qt('upperArmL', [0, 0.16, 0.3, 0.55], [[-120, 0, 20], [-140, 0, 25], [-30, 0, 12], [12, 0, 15]]),
    qt('forearmL', [0, 0.3, 0.55], [[-60, 0, 0], [-5, 0, 0], [-25, 0, 0]]),
    qt('head', [0, 0.3, 0.55], [[-12, 0, 0], [14, 0, 0], [0, 0, 0]]),
  ]);

  // ---------- UPPER: hit flinch ----------
  clips.hitUpper = new THREE.AnimationClip('hitUpper', 0.28, [
    qt('chest', [0, 0.08, 0.28], [[-14, 6, 0], [-18, 8, 0], [1, 0, 0]]),
    qt('head', [0, 0.08, 0.28], [[-16, 0, 0], [-20, 4, 0], [0, 0, 0]]),
    qt('upperArmL', [0, 0.08, 0.28], [[20, 0, 30], [26, 0, 36], [8, 0, 10]]),
    qt('upperArmR', [0, 0.08, 0.28], [[20, 0, -30], [26, 0, -36], [8, 0, -10]]),
  ]);

  // ---------- FULL: death (crumple back) ----------
  clips.deathLower = new THREE.AnimationClip('deathLower', 0.8, [
    pt('hips', [0, 0.35, 0.8], [[0, hipY, 0], [0, hipY * 0.45, -0.2], [0, 0.22, -0.45]]),
    qt('hips', [0, 0.35, 0.8], [[0, 0, 0], [-38, 0, 6], [-78, 0, 10]]),
    qt('upperLegL', [0, 0.8], [[-20, 0, 6], [-40, 0, 10]]),
    qt('lowerLegL', [0, 0.8], [[30, 0, 0], [55, 0, 0]]),
    qt('upperLegR', [0, 0.8], [[-30, 0, -8], [-25, 0, -12]]),
    qt('lowerLegR', [0, 0.8], [[40, 0, 0], [30, 0, 0]]),
  ]);
  clips.deathUpper = new THREE.AnimationClip('deathUpper', 0.8, [
    qt('chest', [0, 0.35, 0.8], [[-10, 0, 0], [-18, 8, 0], [-14, 12, 0]]),
    qt('head', [0, 0.8], [[-10, 0, 0], [-24, 14, 0]]),
    qt('upperArmL', [0, 0.8], [[20, 0, 40], [40, 0, 70]]),
    qt('upperArmR', [0, 0.8], [[20, 0, -40], [50, 0, -60]]),
    qt('forearmL', [0, 0.8], [[-30, 0, 0], [-10, 0, 0]]),
    qt('forearmR', [0, 0.8], [[-30, 0, 0], [-15, 0, 0]]),
  ]);

  // ---------- UPPER: one-hand pistol/rifle aim for enemies ----------
  clips.enemyAimUpper = new THREE.AnimationClip('enemyAimUpper', 1, [
    qt('chest', [0, 1], [[2, -12, 0], [2, -12, 0]]),
    qt('upperArmR', [0, 1], [[-78, 8, 0], [-78, 8, 0]]),
    qt('forearmR', [0, 1], [[-8, 0, 0], [-8, 0, 0]]),
    qt('upperArmL', [0, 1], [[-50, -30, 8], [-50, -30, 8]]),
    qt('forearmL', [0, 1], [[-45, 0, 0], [-45, 0, 0]]),
  ]);

  // ---------- UPPER: two-hand overhead swing for melee enemies ----------
  clips.enemySwing = new THREE.AnimationClip('enemySwing', 0.7, [
    qt('chest', [0, 0.3, 0.45, 0.7], [[-16, 0, 0], [-24, 0, 0], [34, 0, 0], [2, 0, 0]]),
    qt('upperArmR', [0, 0.3, 0.45, 0.7], [[-150, 0, -14], [-168, 0, -14], [-45, 0, -6], [-20, 0, -8]]),
    qt('forearmR', [0, 0.3, 0.45, 0.7], [[-65, 0, 0], [-80, 0, 0], [-8, 0, 0], [-20, 0, 0]]),
    qt('upperArmL', [0, 0.3, 0.45, 0.7], [[-130, 0, 18], [-150, 0, 22], [-35, 0, 10], [10, 0, 12]]),
    qt('forearmL', [0, 0.45, 0.7], [[-60, 0, 0], [-6, 0, 0], [-20, 0, 0]]),
  ]);

  return clips;
}
