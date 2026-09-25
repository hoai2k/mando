import * as THREE from 'three';
import workbenchExport from './data/dinSpearGrips.json';

/** Workbench pose names for Din's six spear attacks. */
const UPPER_CLIP: Record<string, string> = {
  melee1: 'melee1',
  'melee1:spearTest2': 'spearTest2Upper',
  melee2: 'melee2',
  'melee2:staffRise': 'staffRiseUpper',
  melee3: 'melee3',
  'melee3:staffDiagonal': 'staffDiagonalUpper',
};

const grips = new Map(workbenchExport.entries.map((entry) => [UPPER_CLIP[entry.pose], entry]));

/** Keep the old point-up carry, then use the exported hand-local grip for each strike. */
export function applyDinSpearGrip(spear: THREE.Object3D, upperClip: string | null): void {
  const grip = grips.get((upperClip ?? '').replace(/Offhand\d+$/, ''));
  if (grip) {
    spear.position.set(grip.editedPosition[0], grip.editedPosition[1], grip.editedPosition[2]);
    spear.quaternion.set(grip.editedQuaternion[0], grip.editedQuaternion[1],
      grip.editedQuaternion[2], grip.editedQuaternion[3]).normalize();
  } else {
    spear.position.set(0, 0, 0);
    spear.rotation.set(Math.PI, 0, 0);
  }
  spear.scale.setScalar(workbenchExport.weaponScales[0].scaleMultiplier);
}
