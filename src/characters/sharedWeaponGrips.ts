import * as THREE from 'three';
import exportData from './data/sharedWeaponGrips.json';

/**
 * These exports were sampled in idle (or Revan's flourish) to calibrate the
 * hand anchor. They are shared by every pose of that weapon, as requested;
 * the selected clip never changes its hand-local placement.
 */
const entries = new Map(exportData.entries.map((entry) => [entry.character, entry]));
const scales = new Map(exportData.weaponScales.map((entry) => [entry.character, entry.scaleMultiplier]));

export function sharedWeaponScale(character: string): number {
  return scales.get(character) ?? 1;
}

export function applySharedWeaponGrip(character: string, weapon: THREE.Object3D): void {
  const grip = entries.get(character);
  if (!grip) return;
  weapon.position.set(grip.editedPosition[0], grip.editedPosition[1], grip.editedPosition[2]);
  weapon.quaternion.set(grip.editedQuaternion[0], grip.editedQuaternion[1],
    grip.editedQuaternion[2], grip.editedQuaternion[3]).normalize();
  weapon.scale.setScalar(sharedWeaponScale(character));
}
