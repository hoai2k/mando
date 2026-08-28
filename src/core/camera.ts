import * as THREE from 'three';
import { clamp, damp, dampAngle, yawBasis } from './math';
import type { PhysicsWorld } from './physics';

/** default chase distance, and the range the right-stick dolly can set */
const BASE_DIST = 4.6;
const MIN_DIST = 1.9;
const MAX_DIST = 11;
/** aiming sits this fraction of the chase distance out */
const AIM_RATIO = 2.7 / BASE_DIST;

/** Third-person orbit camera with collision, aim zoom, and shake. */
export class ThirdPersonCamera {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // face -Z toward scene by default
  pitch = -0.12;
  /**
   * The player's chosen chase distance, held across the whole session: the
   * right-stick dolly writes it and everything else works relative to it, so
   * a camera you pulled out stays pulled out until you change it again.
   */
  baseDist = 4.6;
  private dist = 4.6;
  private fov = 72;
  private shakeAmt = 0;
  // lock-on snap: on aim-press the camera pulls onto the target over a few
  // frames (RDR2's "Normal" lock-on), then hands fine aim back to the player
  private snapYaw = 0;
  private snapPitch = 0;
  private snapT = 0;
  private tmpTarget = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(72, aspect, 0.1, 2000);
  }

  addLook(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = clamp(this.pitch + dy, -1.25, 1.05);
  }

  shake(amount: number): void { this.shakeAmt = Math.min(this.shakeAmt + amount, 0.5); }

  /** dolly the chase camera; + pulls out, - pushes in. Persists. */
  dolly(delta: number): void {
    this.baseDist = clamp(this.baseDist + delta * BASE_DIST, MIN_DIST, MAX_DIST);
  }

  /** Pull the view onto a world point over ~0.15 s (aim-press lock-on). */
  snapToward(point: THREE.Vector3): void {
    const dx = point.x - this.camera.position.x;
    const dy = point.y - this.camera.position.y;
    const dz = point.z - this.camera.position.z;
    this.snapYaw = Math.atan2(dx, dz);
    this.snapPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.25, 1.05);
    this.snapT = 0.15;
  }

  /** Forward direction of aim (unit). */
  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  update(dt: number, feetPos: THREE.Vector3, physics: PhysicsWorld, opts: { aiming: boolean; speed: number; dashing: boolean }): void {
    if (this.snapT > 0) {
      this.snapT -= dt;
      this.yaw = dampAngle(this.yaw, this.snapYaw, 22, dt);
      this.pitch = damp(this.pitch, this.snapPitch, 22, dt);
    }
    // aiming pulls in proportionally, so the over-the-shoulder framing keeps
    // its relationship to whatever chase distance the player has dialled in
    const targetDist = this.baseDist * (opts.aiming ? AIM_RATIO : 1);
    const targetFov = opts.aiming ? 52 : 72 + Math.min(opts.speed / 14, 1) * 7 + (opts.dashing ? 6 : 0);
    this.dist = damp(this.dist, targetDist, 10, dt);
    this.fov = damp(this.fov, targetFov, 8, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    const head = this.tmpTarget.copy(feetPos);
    head.y += 1.58;
    // over-the-right-shoulder offset, matching the right-handed carbine
    const { rightX, rightZ } = yawBasis(this.yaw);
    const shoulder = opts.aiming ? 0.7 : 0.45;
    head.x += rightX * shoulder;
    head.z += rightZ * shoulder;

    this.aimDir(this.tmpDir);
    this.tmpDesired.copy(head).addScaledVector(this.tmpDir, -this.dist);

    // collide camera with world
    const back = this.tmpDir.clone().multiplyScalar(-1);
    const hit = physics.raycast(head, back, this.dist + 0.3);
    if (hit) this.tmpDesired.copy(head).addScaledVector(back, Math.max(hit.dist - 0.25, 0.3));

    this.camera.position.copy(this.tmpDesired);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-9 * dt);
    }
    const lookAt = head.clone().addScaledVector(this.tmpDir, 30);
    this.camera.lookAt(lookAt);
  }
}
