import * as THREE from 'three';
import workbenchExport from './data/armorerWeaponGrips.json';

/**
 * Workbench pose names translated to the upper clips used in play. The export
 * contains hand-local, absolute transforms, so each pose keeps its deliberate
 * axe-head direction instead of inheriting a single shared roll.
 */
const UPPER_CLIP: Record<string, string> = {
  idle: 'idleUpper',
  melee1: 'melee1',
  'melee1:spearTest2': 'spearTest2Upper',
  melee2: 'melee2',
  'melee2:staffRise': 'staffRiseUpper',
  melee3: 'melee3',
  'melee3:staffDiagonal': 'staffDiagonalUpper',
};

const grips = new Map(workbenchExport.entries.map((entry) => [UPPER_CLIP[entry.pose], entry]));
const idleGrip = grips.get('idleUpper')!;

/**
 * The authored poleaxe mesh runs along model Z, with its heavy axe head at
 * model -Z. swapWeapon turns model -Z into grip-local -Y; the cutting blade
 * projects toward grip-local +Z. These are the attack-side axes when posing
 * or making a hit trail, even though most supplied attack grips reverse the
 * weapon relative to its old default rotation.
 */
export const ARMORER_AXE_HEAD_LOCAL = new THREE.Vector3(0, -1, 0);
export const ARMORER_AXE_EDGE_LOCAL = new THREE.Vector3(0, 0, 1);

export function armorerAxeGripForClip(upperClip: string | null): typeof idleGrip {
  // The workbench can substitute a counterweight variant of the same upper
  // attack. That only changes the free arm, not the right-hand weapon grip.
  return grips.get((upperClip ?? '').replace(/Offhand\d+$/, '')) ?? idleGrip;
}

/** Apply the absolute hand-local pose and the one scale shared by all clips. */
export function applyArmorerAxeGrip(axe: THREE.Object3D, upperClip: string | null): void {
  const grip = armorerAxeGripForClip(upperClip);
  axe.position.set(grip.editedPosition[0], grip.editedPosition[1], grip.editedPosition[2]);
  axe.quaternion.set(grip.editedQuaternion[0], grip.editedQuaternion[1],
    grip.editedQuaternion[2], grip.editedQuaternion[3]).normalize();
  axe.scale.setScalar(workbenchExport.weaponScales[0].scaleMultiplier);
}
