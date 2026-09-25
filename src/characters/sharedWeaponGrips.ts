import * as THREE from 'three';
import exportData from './data/sharedWeaponGrips.json';

/**
 * These exports were sampled in idle (or Revan's flourish) to calibrate the
 * hand anchor. They are shared by every pose of that weapon, as requested;
 * the selected clip never changes its hand-local placement.
 */
// Export names use workbench IDs (escortDroid, pirateMelee), while enemy
// builders use model IDs (escort_droid, pirate_melee). Keep the hand in the
// key as well: the gunslinger has two independently authored pistol grips.
const key = (character: string, side: string): string =>
  `${character.replace(/_/g, '').toLowerCase()}:${side}`;
const entries = new Map(exportData.entries.map((entry) => [key(entry.character, entry.side), entry]));
const scales = new Map(exportData.weaponScales.map((entry) =>
  [key(entry.character, entry.side), entry.scaleMultiplier]));

export function sharedWeaponScale(character: string, side: 'left' | 'right' = 'right'): number {
  return scales.get(key(character, side)) ?? 1;
}

export function applySharedWeaponGrip(character: string, weapon: THREE.Object3D,
  side: 'left' | 'right' = 'right'): void {
  const grip = entries.get(key(character, side));
  if (!grip) return;
  weapon.position.set(grip.editedPosition[0], grip.editedPosition[1], grip.editedPosition[2]);
  weapon.quaternion.set(grip.editedQuaternion[0], grip.editedQuaternion[1],
    grip.editedQuaternion[2], grip.editedQuaternion[3]).normalize();
  weapon.scale.setScalar(sharedWeaponScale(character, side));
}
