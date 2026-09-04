import * as THREE from 'three';
import { clamp, damp, dampAngle, yawBasis } from './math';
import { config } from '../config';
import { rayCylinder, type PhysicsWorld, type StaticCylinder } from './physics';

/**
 * Default chase distance, and the range the right-stick dolly can set.
 *
 * The default is what used to be the *closest* the dolly could go: over the
 * shoulder and in the fight, where the armour, the footing and the swing of a
 * gaffi stick read, rather than a wide arena view of a small figure. The
 * dynamic follow (below) opens out from here when the pace picks up, so the
 * old middle distance is still where a sprint puts you — it is just no longer
 * where standing still puts you. The dolly can still push closer than the
 * default and pull much further out, for anyone who wants either.
 */
const BASE_DIST = 1.9;
const MIN_DIST = 1.1;
const MAX_DIST = 11;
/** aiming sits this fraction of the chase distance out */
const AIM_RATIO = 0.59;
/**
 * Over-the-shoulder offset, in metres and deliberately not scaled by distance:
 * a fixed sideways step subtends a wider angle the closer the camera sits, so
 * it opens the sightline up exactly where a close camera would otherwise put
 * the character's back over the crosshair, and fades toward a centred frame
 * out at the far end of the dolly, which is the classic wide chase look.
 */
const SHOULDER_HIP = 0.55;
const SHOULDER_AIM = 0.8;

// ---- the body being followed ----
// Every number above is tuned around a Mandalorian: 1.8 m tall, half a metre
// across, eye at 1.58. PvP hands the same rig bodies that are nothing like
// that — a war massiff is 4.2 m from nose to tail, a broodmother 6.5 m across
// and 3.9 m tall — and their colliders do not say so, because the roster
// clamps a playable NPC's capsule to 0.6 × 2.1 so it still fits the cover and
// doorways the boards were built around. Framed as if they were a Mandalorian,
// the camera sat *inside* them: the massiff's player got a wall of hide across
// the whole screen and no view of the world at all.
//
// So the rig is told what it is following, and the reference below is what
// makes that free for everyone else: a Mandalorian measures REF exactly, so
// the ratios come out at 1 and the framing is the one that was tuned by hand.
const REF_EYE = 1.58;
const REF_HEIGHT = 1.8;
const REF_REACH = 0.5;
/**
 * Air the camera keeps between itself and the body's own outline.
 *
 * Chosen so a Mandalorian's floor (0.47 + this) still sits under the closest
 * framing the tuning above ever asks for — 1.41 m, the standstill end of the
 * dynamic follow. That is the point: the floor exists for bodies the tuning
 * never anticipated, and must not quietly re-frame the eight it did.
 */
const BODY_CLEARANCE = 0.85;
/** a wide body pushes the over-the-shoulder step out too, but only so far */
const MAX_SHOULDER_SCALE = 3;
/**
 * Air kept between the lens and a big body it would otherwise sit inside.
 *
 * The world's colliders are in `PhysicsWorld`; the monsters are not — a
 * krayt dragon or a rancor is a capsule the enemy solver carries, invisible
 * to the raycast that keeps the camera out of walls. So one backed into
 * during a boss fight swallowed the camera whole, and the shot became the
 * inside of its hide. `blockers` is the game's live list of the big ones,
 * and the chase ray treats them exactly as it treats a rock.
 */
const BLOCKER_PAD = 0.35;
/**
 * ...and the ground, which the camera used to be able to dip under.
 *
 * `raycast` marches the heightfield in fixed 0.6 m steps, so a ridge or a
 * dune crest between two samples is a hole the lens goes through and the
 * shot is suddenly the underside of the world. The march finds the far
 * ones; this is the floor under the result, which cannot be stepped over.
 */
const CAM_GROUND_CLEAR = 0.4;

// ---- dynamic follow ----
// The chase distance is the dialled-in `baseDist` times a pace multiplier, so
// the right-stick dolly still scales both ends of the range together: pull the
// camera out and the close mode is proportionally closer, not fixed.
/** multiplier at a standstill — intimate, reads the character and their footing */
const NEAR_RATIO = 0.86;   // was 0.74: at 1.4 m the helmet sat under every banner
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
  baseDist = BASE_DIST;
  private dist = BASE_DIST;
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
  // body hand-off glide: eases position from where the camera stood (see glideFrom)
  private glideT = 0;
  private glideDur = 0;
  private glidePos = new THREE.Vector3();
  /** where the look sits above the feet, and how far the body reaches sideways */
  private eye = REF_EYE;
  private reach = REF_REACH;
  private tmpTarget = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private tmpBack = new THREE.Vector3();
  /**
   * Bodies too big to see past, as cylinders: the game refreshes this list in
   * place every frame, so the camera holds the array rather than a copy.
   */
  blockers: readonly StaticCylinder[] = [];

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

  /**
   * Tell the rig how big the body it follows is: `height` and `reach` (half the
   * body's widest horizontal span) in metres, measured off the built character
   * rather than its clamped collider.
   *
   * A Mandalorian measures the reference, so this is a no-op for the eight of
   * them and for every humanoid NPC — the framing stays the one that was tuned
   * by hand. Anything bigger gets its eye line lifted to its own head and a
   * floor under the chase distance that keeps the lens outside its hide.
   */
  setSubject(height: number, reach: number): void {
    this.eye = REF_EYE * (height / REF_HEIGHT);
    this.reach = reach;
  }

  /**
   * The closest the camera may sit to the look point: far enough that the body
   * itself is not the shot. Aiming and the dolly both defer to it — pushing the
   * lens inside a war beast is not a framing anyone chose.
   */
  private get clearance(): number { return this.reach + BODY_CLEARANCE; }

  /**
   * Point the view along a bearing outright, cancelling any lock-on snap.
   *
   * Used where a body is placed rather than moved to — a respawn — so the
   * camera comes back behind it looking the way it is meant to run, not at
   * the wall it re-formed against. Position is still eased by `glideFrom`;
   * this is only where the rig is looking.
   */
  face(yaw: number, pitch = -0.12): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -1.25, 1.05);
    this.snapT = 0;
  }

  /** Pull the view onto a world point over ~0.15 s (aim-press lock-on). */
  snapToward(point: THREE.Vector3, duration = 0.15): void {
    const dx = point.x - this.camera.position.x;
    const dy = point.y - this.camera.position.y;
    const dz = point.z - this.camera.position.z;
    this.snapYaw = Math.atan2(dx, dz);
    this.snapPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.25, 1.05);
    this.snapT = duration;
  }

  /**
   * Fly, don't cut: ease the camera from wherever it stands now to its next
   * framing over `duration` seconds. The chase update below hard-sets position
   * every frame, so a body handed to the camera at a new spot (the PvP squad
   * takeover) would otherwise teleport the view. Pair with snapToward at the
   * new body so the look swings over while the position glides.
   */
  glideFrom(duration = 0.8): void {
    this.glideT = duration;
    this.glideDur = duration;
    this.glidePos.copy(this.camera.position);
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
    // ...and never nearer than the body's own outline, so a big fighter is
    // something you are looking at rather than something you are looking from
    // inside. A Mandalorian's outline sits under even the closest framing the
    // tuning asks for, so for the eight of them this max() never binds.
    const targetDist = Math.max(this.clearance, this.baseDist * (opts.aiming ? AIM_RATIO : follow));
    const targetFov = opts.aiming ? 52 : 72 + Math.min(opts.speed / 14, 1) * 7 + (opts.dashing ? 6 : 0);
    this.dist = this.framed ? damp(this.dist, targetDist, 10, dt) : targetDist;
    this.framed = true;
    this.fov = damp(this.fov, targetFov, 8, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    const head = this.tmpTarget.copy(feetPos);
    head.y += this.eye;
    // over-the-right-shoulder offset, matching the right-handed carbine
    const { rightX, rightZ } = yawBasis(this.yaw);
    // A wide body needs the step out to clear its own flank, or the shoulder
    // view is a view of the shoulder. Only ever outward: a body narrower than
    // the reference keeps the offset that was tuned for it, rather than having
    // it quietly shaved because it measured a few centimetres under.
    const shoulder = (opts.aiming ? SHOULDER_AIM : SHOULDER_HIP)
      * clamp(this.reach / REF_REACH, 1, MAX_SHOULDER_SCALE);
    head.x += rightX * shoulder;
    head.z += rightZ * shoulder;

    this.aimDir(this.tmpDir);
    this.tmpDesired.copy(head).addScaledVector(this.tmpDir, -this.dist);

    // collide camera with world
    const back = this.tmpBack.copy(this.tmpDir).multiplyScalar(-1);
    const reach = this.dist + 0.3;
    const hit = physics.raycast(head, back, reach);
    let stop = hit ? Math.max(hit.dist - 0.25, 0.3) : this.dist;
    // ...and with the big bodies, which are not in the world's colliders
    for (const b of this.blockers) {
      const bh = rayCylinder(head, back, b, reach);
      if (bh) stop = Math.min(stop, Math.max(bh.dist - BLOCKER_PAD, 0.3));
    }
    if (stop < this.dist) this.tmpDesired.copy(head).addScaledVector(back, stop);
    // The ground is a floor under all of it: never below the surface, whatever
    // the march between its samples missed.
    if (physics.heightAt) {
      const floor = physics.heightAt(this.tmpDesired.x, this.tmpDesired.z) + CAM_GROUND_CLEAR;
      if (this.tmpDesired.y < floor) this.tmpDesired.y = floor;
    }

    // hand-off glide: blend from the stored start toward the live chase
    // framing, so a body swap flies the view over instead of cutting
    if (this.glideT > 0) {
      this.glideT -= dt;
      const k = smoothstep(clamp(1 - this.glideT / this.glideDur, 0, 1));
      this.tmpDesired.lerpVectors(this.glidePos, this.tmpDesired, k);
    }

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
