import type * as THREE from 'three';
import exportData from './data/sharedWeaponGrips.json';
import type { EnemyKind } from '../enemies/enemy';
import { applyGrip } from './grips';
import type { MandoId } from './mandalorians';

/**
 * These exports were sampled in idle (or Revan's flourish) to calibrate the
 * hand anchor. They are shared by every pose of that weapon, as requested;
 * the selected clip never changes its hand-local placement.
 */
// Export names are the workbench's subject ids, which are the playable and
// enemy-kind ids (escortDroid, pirateMelee), and every caller asks by those —
// never by a model filename. Keep the hand in the key as well: the gunslinger
// has two independently authored pistol grips.
type GripOwner = MandoId | EnemyKind;
const key = (character: string, side: string): string => `${character}:${side}`;
const entries = new Map(exportData.entries.map((entry) => [key(entry.character, entry.side), entry]));
const scales = new Map(exportData.weaponScales.map((entry) =>
  [key(entry.character, entry.side), entry.scaleMultiplier]));

export function sharedWeaponScale(character: GripOwner, side: 'left' | 'right' = 'right'): number {
  return scales.get(key(character, side)) ?? 1;
}

export function applySharedWeaponGrip(character: GripOwner, weapon: THREE.Object3D,
  side: 'left' | 'right' = 'right'): void {
  const grip = entries.get(key(character, side));
  if (grip) applyGrip(weapon, grip, sharedWeaponScale(character, side));
}
