import * as THREE from 'three';
import workbenchExport from './data/tuskenWeaponGrips.json';

const CLIP: Record<string, string> = {
  idle: 'idleUpper',
  run: 'runUpper',
  enemySwing: 'enemySwing',
  'enemySwing:enemyDrive': 'enemyDriveUpper',
};
const grips = new Map(workbenchExport.entries.map((entry) => [CLIP[entry.pose], entry]));
const carry = grips.get('idleUpper')!;

/** The hand-local gaffi grip for each upper clip; other states carry it. */
export function applyTuskenWeaponGrip(gaffi: THREE.Object3D, upperClip: string | null): void {
  const grip = grips.get((upperClip ?? '').replace(/Offhand\d+$/, '')) ?? carry;
  gaffi.position.set(grip.editedPosition[0], grip.editedPosition[1], grip.editedPosition[2]);
  gaffi.quaternion.set(grip.editedQuaternion[0], grip.editedQuaternion[1],
    grip.editedQuaternion[2], grip.editedQuaternion[3]).normalize();
}
