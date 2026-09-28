import type * as THREE from 'three';
import workbenchExport from './data/dinSaberGrips.json';
import { applyGrip, clipGrips } from './grips';

/** Workbench pose names translated to the upper clips played by Din. */
const UPPER_CLIP: Record<string, string> = {
  saber1: 'darksaber1',
  'saber1:saberLunge': 'saberLungeUpper',
  saber2: 'darksaber2',
  'saber2:staffRise': 'staffRiseUpper',
  saber3: 'darksaber3',
  'saber3:staffDiagonal': 'staffDiagonalUpper',
};

const gripFor = clipGrips(workbenchExport.entries, UPPER_CLIP);
const base = workbenchExport.entries[0];
/** the hilt as the authored idle holds it, before any strike's edit */
const idleHilt = { editedPosition: base.basePosition, editedQuaternion: base.baseQuaternion };

/** Keep the authored idle hilt alignment and apply each strike's measured roll. */
export function applyDinSaberGrip(saber: THREE.Object3D, upperClip: string | null): void {
  applyGrip(saber, gripFor(upperClip) ?? idleHilt);
}
