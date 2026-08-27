import * as THREE from 'three';
import { clamp, damp, yawBasis } from './math';
import type { PhysicsWorld } from './physics';

/** Third-person orbit camera with collision, aim zoom, and shake. */
export class ThirdPersonCamera {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI; // face -Z toward scene by default
  pitch = -0.12;
  private dist = 4.6;
  private fov = 72;
  private shakeAmt = 0;
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

  /** Forward direction of aim (unit). */
  aimDir(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
  }

  update(dt: number, feetPos: THREE.Vector3, physics: PhysicsWorld, opts: { aiming: boolean; speed: number; dashing: boolean }): void {
    const targetDist = opts.aiming ? 2.7 : 4.6;
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
