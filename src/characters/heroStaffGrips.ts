import type * as THREE from 'three';
import workbenchExport from './data/heroStaffGrips.json';
import { applyGrip } from './grips';

/**
 * Hand grips for the staffs heroes carry in their gaffi slot (their roster
 * `staffProp`), as placed in the workbench's weapon choice. Each export was sampled in one
 * melee pose and, like the shared weapon grips, holds for every pose of that
 * staff. Hand-local: the staff sits on the authored weapon mount.
 */
// keyed by character and weapon, so a grip only lands on the staff it was set for
const grips = new Map(workbenchExport.entries.map((entry) => [`${entry.character}:${entry.weapon.replace(/^right: /, '')}`, entry]));

export function applyHeroStaffGrip(character: string, prop: string, staff: THREE.Object3D): void {
  const grip = grips.get(`${character}:${prop}`);
  if (grip) applyGrip(staff, grip);
}
