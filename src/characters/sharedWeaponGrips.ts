import type * as THREE from 'three';
import exportData from './data/sharedWeaponGrips.json';
import { applyGrip } from './grips';

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
  if (grip) applyGrip(weapon, grip, sharedWeaponScale(character, side));
}
