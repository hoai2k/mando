import type * as THREE from 'three';
import workbenchExport from './data/heroStaffGrips.json';

/**
 * Hand grips for the staffs Embo and IG-11 carry in their gaffi slot, as
 * placed in the workbench's weapon choice. Each export was sampled in one
 * melee pose and, like the shared weapon grips, holds for every pose of that
 * staff. Hand-local: the staff sits on the authored weapon mount.
 */
const grips = new Map(workbenchExport.entries.map((entry) => [entry.character, entry]));

export function applyHeroStaffGrip(character: string, staff: THREE.Object3D): void {
  const grip = grips.get(character);
  if (!grip) return;
  staff.position.set(grip.editedPosition[0], grip.editedPosition[1], grip.editedPosition[2]);
  staff.quaternion.set(grip.editedQuaternion[0], grip.editedQuaternion[1],
    grip.editedQuaternion[2], grip.editedQuaternion[3]).normalize();
}
