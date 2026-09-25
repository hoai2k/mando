import * as THREE from 'three';

/** Hand-local transforms exported from Bossk's idle carry and standing aim. */
const CARRY = {
  position: [0.008026, -0.060982, 0.023936],
  quaternion: [0.6696135, -0.0169063, 0.0185478, 0.7422856],
} as const;
const AIM = {
  position: [-0.10552, -0.358886, 0.114163],
  quaternion: [0.6799579, -0.0927467, -0.0845205, 0.7224345],
} as const;

export const BOSSK_RIFLE_SCALE = 1.23;

export function applyBosskRifleGrip(rifle: THREE.Object3D, aiming: boolean): void {
  const grip = aiming ? AIM : CARRY;
  rifle.position.set(grip.position[0], grip.position[1], grip.position[2]);
  rifle.quaternion.set(grip.quaternion[0], grip.quaternion[1], grip.quaternion[2], grip.quaternion[3]).normalize();
}
