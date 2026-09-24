import * as THREE from 'three';
import type { Rig } from './skeleton';
import { reachArm } from './seating';

const shoulder = new THREE.Vector3();
const target = new THREE.Vector3();
const candidate = new THREE.Vector3();
const elbow = new THREE.Vector3();
const local = new THREE.Vector3();
const facing = new THREE.Quaternion();
const REAR_GRIPS = [-0.64, -0.58, -0.52, -0.46, -0.4, -0.34];

/**
 * Keep the base hand on the rear half of a spear or staff. The point is local
 * +Y; the right hand grips near its middle, and the left hand supports the
 * butt. Choosing among a few nearby shaft positions lets the base hand slide
 * when a strike extends, without asking an arm shorter than the reach to bend
 * through the torso. Call after the animator and before authored retargeting.
 */
export function holdPolearm(rig: Rig, mount: THREE.Object3D, grips = REAR_GRIPS): void {
  rig.root.updateMatrixWorld(true);
  rig.bones.upperArmL.getWorldPosition(shoulder);
  let best = Infinity;
  for (const y of grips) {
    local.set(0, y, 0);
    mount.localToWorld(candidate.copy(local));
    const overreach = Math.max(0, shoulder.distanceTo(candidate)
      - rig.proportions.upperArmLen - rig.proportions.forearmLen + 0.015);
    const score = overreach * 4 + Math.abs(y - grips[(grips.length / 2) | 0]) * 0.04;
    if (score < best) { best = score; target.copy(candidate); }
  }
  // An outward, slightly trailing elbow avoids an inverted forearm while the
  // shaft passes across the chest. The hint follows character facing.
  elbow.set(0.22, -0.18, -0.1).applyQuaternion(rig.root.getWorldQuaternion(facing));
  elbow.add(shoulder);
  reachArm(rig, 'L', target, elbow);
}
