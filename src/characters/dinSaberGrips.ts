import * as THREE from 'three';
import workbenchExport from './data/dinSaberGrips.json';

/** Workbench pose names translated to the upper clips played by Din. */
const UPPER_CLIP: Record<string, string> = {
  saber1: 'darksaber1',
  'saber1:saberLunge': 'saberLungeUpper',
  saber2: 'darksaber2',
  'saber2:staffRise': 'staffRiseUpper',
  saber3: 'darksaber3',
  'saber3:staffDiagonal': 'staffDiagonalUpper',
};

const grips = new Map(workbenchExport.entries.map((entry) => [UPPER_CLIP[entry.pose], entry]));
const base = workbenchExport.entries[0];

/** Keep the authored idle hilt alignment and apply each strike's measured roll. */
export function applyDinSaberGrip(saber: THREE.Object3D, upperClip: string | null): void {
  const grip = grips.get((upperClip ?? '').replace(/Offhand\d+$/, ''));
  const position = grip?.editedPosition ?? base.basePosition;
  const quaternion = grip?.editedQuaternion ?? base.baseQuaternion;
  saber.position.set(position[0], position[1], position[2]);
  saber.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]).normalize();
}
