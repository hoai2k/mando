import type * as THREE from 'three';
import workbenchExport from './data/armorerWeaponGrips.json';
import { applyGrip, clipGrips } from './grips';

/**
 * Workbench pose names translated to the upper clips used in play. The export
 * contains hand-local, absolute transforms, so each pose keeps its deliberate
 * axe-head direction instead of inheriting a single shared roll.
 */
const UPPER_CLIP: Record<string, string> = {
  idle: 'idleUpper',
  melee1: 'melee1',
  'melee1:spearTest2': 'spearTest2Upper',
  melee2: 'melee2',
  'melee2:staffRise': 'staffRiseUpper',
  melee3: 'melee3',
  'melee3:staffDiagonal': 'staffDiagonalUpper',
};

const gripFor = clipGrips(workbenchExport.entries, UPPER_CLIP);
const idleGrip = gripFor('idleUpper')!;

export function armorerAxeGripForClip(upperClip: string | null): typeof idleGrip {
  // The workbench can substitute a counterweight variant of the same upper
  // attack. That only changes the free arm, not the right-hand weapon grip.
  return gripFor(upperClip) ?? idleGrip;
}

/** Apply the absolute hand-local pose and the one scale shared by all clips. */
export function applyArmorerAxeGrip(axe: THREE.Object3D, upperClip: string | null): void {
  applyGrip(axe, armorerAxeGripForClip(upperClip), workbenchExport.weaponScales[0].scaleMultiplier);
}
