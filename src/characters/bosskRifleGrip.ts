import type * as THREE from 'three';
import { applyGrip } from './grips';

/** Hand-local transforms exported from Bossk's idle carry and standing aim. */
const CARRY = {
  editedPosition: [0.008026, -0.060982, 0.023936],
  editedQuaternion: [0.6696135, -0.0169063, 0.0185478, 0.7422856],
} as const;
const AIM = {
  editedPosition: [-0.10552, -0.358886, 0.114163],
  editedQuaternion: [0.6799579, -0.0927467, -0.0845205, 0.7224345],
} as const;

export const BOSSK_RIFLE_SCALE = 1.23;

export function applyBosskRifleGrip(rifle: THREE.Object3D, aiming: boolean): void {
  applyGrip(rifle, aiming ? AIM : CARRY);
}
