import type * as THREE from 'three';
import workbenchExport from './data/tuskenWeaponGrips.json';
import { applyGrip, clipGrips } from './grips';

const CLIP: Record<string, string> = {
  idle: 'idleUpper',
  run: 'runUpper',
  enemySwing: 'enemySwing',
  'enemySwing:enemyDrive': 'enemyDriveUpper',
};
const gripFor = clipGrips(workbenchExport.entries, CLIP);
const carry = gripFor('idleUpper')!;

/** The hand-local gaffi grip for each upper clip; other states carry it. */
export function applyTuskenWeaponGrip(gaffi: THREE.Object3D, upperClip: string | null): void {
  applyGrip(gaffi, gripFor(upperClip) ?? carry);
}
