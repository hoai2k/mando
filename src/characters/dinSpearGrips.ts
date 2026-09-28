import type * as THREE from 'three';
import workbenchExport from './data/dinSpearGrips.json';
import { applyGrip, clipGrips } from './grips';

/** Workbench pose names for Din's six spear attacks. */
const UPPER_CLIP: Record<string, string> = {
  melee1: 'melee1',
  'melee1:spearTest2': 'spearTest2Upper',
  melee2: 'melee2',
  'melee2:staffRise': 'staffRiseUpper',
  melee3: 'melee3',
  'melee3:staffDiagonal': 'staffDiagonalUpper',
};

const gripFor = clipGrips(workbenchExport.entries, UPPER_CLIP);

/** Keep the old point-up carry, then use the exported hand-local grip for each strike. */
export function applyDinSpearGrip(spear: THREE.Object3D, upperClip: string | null): void {
  const grip = gripFor(upperClip);
  if (grip) {
    applyGrip(spear, grip);
  } else {
    spear.position.set(0, 0, 0);
    spear.rotation.set(Math.PI, 0, 0);
  }
  spear.scale.setScalar(workbenchExport.weaponScales[0].scaleMultiplier);
}
