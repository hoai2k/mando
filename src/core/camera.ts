import * as THREE from 'three';
import { clamp, damp, dampAngle, yawBasis } from './math';
import { config } from '../config';
import type { PhysicsWorld } from './physics';

/** default chase distance, and the range the right-stick dolly can set */
const BASE_DIST = 4.6;
const MIN_DIST = 1.9;
const MAX_DIST = 11;
/** aiming sits this fraction of the chase distance out */
const AIM_RATIO = 2.7 / BASE_DIST;

// ---- dynamic follow ----
// The chase distance is the dialled-in `baseDist` times a pace multiplier, so
// the right-stick dolly still scales both ends of the range together: pull the
// camera out and the close mode is proportionally closer, not fixed.
/** multiplier at a standstill — intimate, reads the character and their footing */
const NEAR_RATIO = 0.74;
/** multiplier at full tilt — wide, reads where you are going and what is in the way */
const FAR_RATIO = 1.34;
/** below this ground speed the pace reads as "still"; at or above HOT it is fully out */
const CALM_SPEED = 2.4;
const HOT_SPEED = 13;
/** climb/dive counts alongside ground speed while airborne, at this weight */
const CLIMB_WEIGHT = 0.7;
/** flight and dashes are salient on their own, whatever the speedometer says */
const FLYING_FLOOR = 0.5;
const DASH_FLOOR = 0.85;
/**
 * Widening chases the action (you accelerate, the camera is already there);
 * closing lags well behind it, so tapping the stick in a firefight or clipping
 * a wall mid-sprint doesn't pump the camera in and out.
 */
const OPEN_LAMBDA = 3.6;
const CLOSE_LAMBDA = 1.15;
/** ...and a stop is not believed at all for this long, for the same reason */
const CLOSE_HOLD = 0.4;

/** Smooth ease so the multiplier has no corners at either end of its travel. */
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

/** What the camera is being asked to follow this frame. */
export interface CameraMotion {
  aiming: boolean;
  /** horizontal speed, m/s */
  speed: number;
  dashing: boolean;
  /** under jetpack thrust, or swimming — wide on its own, even hovering still */
  flying?: boolean;
  /** vertical speed, m/s; counted alongside `speed`, so a long fall reads wide */
  climb?: number;
}

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
  /** eased 0-1 pace: 0 = the close framing, 1 = the wide one */
  private pace = 0;
  /** countdown that keeps the pace from falling right after it last rose */
  private paceHold = 0;
  /** first frame snaps to its framing rather than drifting out of the default */
  private framed = false;
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

  /**
   * How wide the follow wants to be this frame, 0-1, before smoothing: ground
   * speed against the calm/hot band, with airborne climb folded in and floors
   * for the states that are wide on their own.
   */
  private paceTarget(opts: CameraMotion): number {
    const travel = opts.speed + Math.abs(opts.climb ?? 0) * CLIMB_WEIGHT;
    let want = clamp((travel - CALM_SPEED) / (HOT_SPEED - CALM_SPEED), 0, 1);
    if (opts.flying) want = Math.max(want, FLYING_FLOOR);
    if (opts.dashing) want = Math.max(want, DASH_FLOOR);
    return want;
  }

  update(dt: number, feetPos: THREE.Vector3, physics: PhysicsWorld, opts: CameraMotion): void {
    if (this.snapT > 0) {
      this.snapT -= dt;
      this.yaw = dampAngle(this.yaw, this.snapYaw, 22, dt);
      this.pitch = damp(this.pitch, this.snapPitch, 22, dt);
    }
    // ---- dynamic follow distance ----
    // The pace is smoothed twice — asymmetrically here, then again through the
    // distance damp below — so every shift between the close and wide framings
    // is a continuous drift the player reads as the camera breathing with them,
    // never a cut. With the setting off the multiplier below is a flat 1 and
    // this settles on the dialled-in distance, exactly as it did before.
    const want = this.paceTarget(opts);
    if (want > this.pace) this.paceHold = CLOSE_HOLD;
    else this.paceHold = Math.max(0, this.paceHold - dt);
    if (want > this.pace) this.pace = damp(this.pace, want, OPEN_LAMBDA, dt);
    else if (this.paceHold <= 0) this.pace = damp(this.pace, want, CLOSE_LAMBDA, dt);
    // the pace tracks the player whether or not the setting is on, so turning
    // it on mid-sprint eases out to the right framing instead of from a
    // standstill; off, the multiplier is a flat 1 and nothing here is felt
    const follow = config.camera.dynamic
      ? NEAR_RATIO + (FAR_RATIO - NEAR_RATIO) * smoothstep(this.pace)
      : 1;

    // aiming pulls in proportionally, so the over-the-shoulder framing keeps
    // its relationship to whatever chase distance the player has dialled in.
    // ADS is its own framing: it ignores the pace and sits where it always did.
    const targetDist = this.baseDist * (opts.aiming ? AIM_RATIO : follow);
    const targetFov = opts.aiming ? 52 : 72 + Math.min(opts.speed / 14, 1) * 7 + (opts.dashing ? 6 : 0);
    this.dist = this.framed ? damp(this.dist, targetDist, 10, dt) : targetDist;
    this.framed = true;
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
