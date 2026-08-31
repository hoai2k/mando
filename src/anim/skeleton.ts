import * as THREE from 'three';

/**
 * Canonical humanoid rig. Every biped character (player and enemies) is built
 * on this named bone hierarchy; animation clips target bones by these names.
 *
 * SWAP CONTRACT: an authored glTF character can replace a procedural one by
 * shipping a skeleton whose nodes use these exact names — the animator,
 * controller, and combat code never reference meshes, only bone names.
 *
 * SIDES: the rig faces +Z with +Y up, so the character's own left is +X and
 * its right is -X — stand in front of one and its left hand is on your right.
 * The `L` bones therefore sit at +X and the `R` bones at -X, which is also
 * where a Rigify `DEF-*.L` / `DEF-*.R` pair sits in the authored models. That
 * agreement is what lets the retargeter map the two skeletons name for name
 * (see `src/characters/authored.ts`); the labels used to be the other way
 * round, which drove every authored model as its own mirror image.
 */

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'upperLegL', 'lowerLegL', 'footL',
  'upperLegR', 'lowerLegR', 'footR',
  'weaponR', 'weaponL', 'jetpack', 'capeRoot',
] as const;
export type BoneName = (typeof BONES)[number];

export interface Proportions {
  hipHeight: number;      // ground → hips
  spineLen: number;
  chestLen: number;
  neckLen: number;
  headSize: number;
  shoulderWidth: number;  // half-width, chest → shoulder
  upperArmLen: number;
  forearmLen: number;
  upperLegLen: number;
  lowerLegLen: number;
  hipWidth: number;       // half-width
}

export const HUMAN: Proportions = {
  hipHeight: 0.95, spineLen: 0.22, chestLen: 0.28, neckLen: 0.12, headSize: 0.24,
  shoulderWidth: 0.26, upperArmLen: 0.30, forearmLen: 0.28,
  upperLegLen: 0.46, lowerLegLen: 0.48, hipWidth: 0.13,
};

export interface Rig {
  root: THREE.Group;                      // at feet, +Z facing forward
  bones: Record<BoneName, THREE.Object3D>;
  proportions: Proportions;
  height: number;
}

function bone(name: BoneName, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const b = new THREE.Group();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

export function buildRig(p: Proportions = HUMAN): Rig {
  const root = new THREE.Group();
  root.name = 'rigRoot';
  const bones = {} as Record<BoneName, THREE.Object3D>;

  const hips = bones.hips = bone('hips', root, 0, p.hipHeight, 0);
  const spine = bones.spine = bone('spine', hips, 0, p.spineLen, 0);
  const chest = bones.chest = bone('chest', spine, 0, p.chestLen, 0);
  const neck = bones.neck = bone('neck', chest, 0, p.neckLen, 0);
  bones.head = bone('head', neck, 0, p.headSize * 0.4, 0);

  bones.shoulderL = bone('shoulderL', chest, p.shoulderWidth, p.neckLen * 0.4, 0);
  bones.upperArmL = bone('upperArmL', bones.shoulderL, 0.06, 0, 0);
  bones.forearmL = bone('forearmL', bones.upperArmL, 0, -p.upperArmLen, 0);
  bones.handL = bone('handL', bones.forearmL, 0, -p.forearmLen, 0);
  bones.weaponL = bone('weaponL', bones.handL, 0, -0.05, 0.02);

  bones.shoulderR = bone('shoulderR', chest, -p.shoulderWidth, p.neckLen * 0.4, 0);
  bones.upperArmR = bone('upperArmR', bones.shoulderR, -0.06, 0, 0);
  bones.forearmR = bone('forearmR', bones.upperArmR, 0, -p.upperArmLen, 0);
  bones.handR = bone('handR', bones.forearmR, 0, -p.forearmLen, 0);
  bones.weaponR = bone('weaponR', bones.handR, 0, -0.05, 0.02);

  bones.upperLegL = bone('upperLegL', hips, p.hipWidth, -0.02, 0);
  bones.lowerLegL = bone('lowerLegL', bones.upperLegL, 0, -p.upperLegLen, 0);
  bones.footL = bone('footL', bones.lowerLegL, 0, -p.lowerLegLen, 0.03);

  bones.upperLegR = bone('upperLegR', hips, -p.hipWidth, -0.02, 0);
  bones.lowerLegR = bone('lowerLegR', bones.upperLegR, 0, -p.upperLegLen, 0);
  bones.footR = bone('footR', bones.lowerLegR, 0, -p.lowerLegLen, 0.03);

  bones.jetpack = bone('jetpack', chest, 0, 0.05, -0.16);
  bones.capeRoot = bone('capeRoot', chest, 0, p.neckLen * 0.5, -0.1);

  const height = p.hipHeight + p.spineLen + p.chestLen + p.neckLen + p.headSize;
  return { root, bones, proportions: p, height };
}
