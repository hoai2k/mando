import type * as THREE from 'three';
import { gripClipKey } from './gripClipKey';

/**
 * One weapon placement as the workbench exports it (`data/*.json`): absolute
 * and local to the hand mount the weapon sits on, so applying it replaces the
 * weapon's transform rather than adjusting it.
 */
export interface WorkbenchGrip {
  editedPosition: readonly number[];
  editedQuaternion: readonly number[];
}

/**
 * Index an export's grips by the upper clip each exported pose stands for, and
 * look one up by the clip that is playing. `clipOf` translates workbench pose
 * names to shipped clips; a counterweight variant of a strike finds the grip
 * of the strike it was built from (see gripClipKey).
 */
export function clipGrips<E extends WorkbenchGrip & { pose: string }>(
  entries: readonly E[], clipOf: Record<string, string>,
): (upperClip: string | null) => E | undefined {
  const grips = new Map(entries.map((entry) => [clipOf[entry.pose], entry]));
  return (upperClip) => grips.get(gripClipKey(upperClip));
}

/**
 * Put a weapon where the grip says. The exported quaternion is renormalised,
 * since the export rounds it; `scale`, where given, is the export's one
 * multiplier for that weapon in every pose.
 */
export function applyGrip(weapon: THREE.Object3D, grip: WorkbenchGrip, scale?: number): void {
  const p = grip.editedPosition;
  const q = grip.editedQuaternion;
  weapon.position.set(p[0], p[1], p[2]);
  weapon.quaternion.set(q[0], q[1], q[2], q[3]).normalize();
  if (scale !== undefined) weapon.scale.setScalar(scale);
}
