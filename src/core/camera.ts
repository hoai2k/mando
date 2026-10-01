import * as THREE from 'three';
import { clamp, damp, dampAngle, yawBasis } from './math';
import { config } from '../config';
import { rayCylinder, type PhysicsWorld, type StaticCylinder } from './physics';
import cameraTuning from './data/cameraTuning.json';

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
/** ...and pulls the chase distance out in proportion to its size, up to this */
const MAX_SUBJECT_SCALE = 3;
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
/**
 * Points on the body the framing check projects onto the screen, as
 * [share of the body's height, sideways in shoulder half-widths]: feet,
 * knees, hips, chest, head, and both shoulders.
 */
const FRAME_POINTS: readonly (readonly [number, number])[] = [
  [0.04, 0], [0.28, 0], [0.53, 0], [0.72, 0], [0.93, 0], [0.8, 1], [0.8, -1],
];
/** ...of which this one is the body's centre for "is it near the middle" */
const FRAME_CHEST = 3;

// ---- dynamic follow ----
// The chase distance is the dialled-in `baseDist` times a pace multiplier, so
// the right-stick dolly still scales both ends of the range together: pull the
// camera out and the close mode is proportionally closer, not fixed.
//
// Every number here lives in data/cameraTuning.json, so the framing can be
// tuned without touching code:
//  - nearRatio / farRatio: the multiplier at a standstill (intimate, reads the
//    character and their footing) and at full tilt (wide, reads where you are
//    going and what is in the way);
//  - calmSpeed / hotSpeed: the ground speeds that map to those two ends, with
//    the pace running smoothly between them;
//  - towardExtra / towardFullSpeed: a further pull-back while running at the
//    lens, full at that closing speed — a body coming at the camera otherwise
//    fills the frame and hides what it is running from;
//  - climbWeight: airborne climb/dive counted alongside ground speed;
//  - flyingFloor / dashFloor: flight and dashes are wide on their own;
//  - openLambda / closeLambda / closeHold: widening chases the action (you
//    accelerate, the camera is already there); closing lags well behind it,
//    and a stop is not believed at all for closeHold seconds, so tapping the
//    stick in a firefight or clipping a wall mid-sprint doesn't pump the
//    camera in and out.
const T = cameraTuning;

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
  /** follow a ducking body below a low overhead collider */
  crouching?: boolean;
  /** horizontal velocity, m/s: running at the lens pulls the camera further back */
  velX?: number;
  velZ?: number;
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
  /** eased 0-1 share of the pull-back for running toward the camera */
  private toward = 0;
  private towardHold = 0;
  /** first frame snaps to its framing rather than drifting out of the default */
  private framed = false;
  private fov = 72;
  private shakeAmt = 0;
  /**
   * How far the shake moved the eye this frame.
   *
   * The ground going is the *world* lurching, and a camera translation says
   * that — except that it says it about the body in front of the lens too,
   * which rattles on screen along with everything else and reads as a broken
   * character rather than a shaken world. Anything that wants to sit still in
   * the frame through a shake rides this same offset; see `Player.syncVisual`.
   */
  readonly shakeOffset = new THREE.Vector3();
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
  /**
   * How much bigger than a Mandalorian the followed body is, as a multiplier
   * on the chase distance. The rig's distances were tuned to frame a 1.8 m
   * figure; framed at those same distances a bantha with a rider on it was
   * mostly *under* the lens — a wall of hide across the bottom of the screen
   * and the animal itself invisible. The floor under the distance kept the
   * camera outside the body, but outside is not the same as seeing it. So a
   * bigger subject is framed as a Mandalorian would be if they were that
   * size: the camera pulls back in proportion and still centres on the rider.
   */
  private scale = 1;
  private tmpTarget = new THREE.Vector3();
  private tmpDesired = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private tmpBack = new THREE.Vector3();
  private tmpBase = new THREE.Vector3();
  private tmpSide = new THREE.Vector3();
  private tmpUp = new THREE.Vector3();
  private tmpEye = new THREE.Vector3();
  private tmpHead = new THREE.Vector3();
  private tmpPt = new THREE.Vector3();
  private tmpR = new THREE.Vector3();
  private tmpU = new THREE.Vector3();
  /**
   * Framing state: the share of the shoulder step in use (1 = the tuned one)
   * and how far the pivot is lifted, both eased; and the room this frame's
   * probes found beside and above the head, which caps them.
   */
  private frameK = 1;
  private frameH = 0;
  private frameInit = false;
  private roomRight = Infinity;
  private roomLeft = Infinity;
  private upRoom = Infinity;
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
    // Height counts in full; the span only by its square root, because a long
    // body is seen along its length from behind — the depth it adds to the
    // shot is not the width it adds. Never under 1: the eight Mandalorians
    // measure the reference and keep the framing tuned by hand.
    this.scale = clamp(Math.max(height / REF_HEIGHT, Math.sqrt(reach / REF_REACH)), 1, MAX_SUBJECT_SCALE);
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
    const travel = opts.speed + Math.abs(opts.climb ?? 0) * T.climbWeight;
    let want = clamp((travel - T.calmSpeed) / Math.max(T.hotSpeed - T.calmSpeed, 0.01), 0, 1);
    if (opts.flying) want = Math.max(want, T.flyingFloor);
    if (opts.dashing) want = Math.max(want, T.dashFloor);
    return want;
  }

  /**
   * How much of the toward-the-lens pull-back this frame wants, 0-1: the
   * velocity's component along the line from the body back to the camera.
   * The camera sits behind the look direction, so that line is minus it.
   */
  private towardTarget(opts: CameraMotion): number {
    const closing = -((opts.velX ?? 0) * Math.sin(this.yaw) + (opts.velZ ?? 0) * Math.cos(this.yaw));
    return clamp(closing / Math.max(T.towardFullSpeed, 0.01), 0, 1);
  }

  /** ease `cur` toward `want`: open fast, close slowly, and only after the hold runs out */
  private ease(cur: number, want: number, hold: number, dt: number): [number, number] {
    if (want > cur) return [damp(cur, want, T.openLambda, dt), T.closeHold];
    hold = Math.max(0, hold - dt);
    return [hold <= 0 ? damp(cur, want, T.closeLambda, dt) : cur, hold];
  }

  /**
   * Where the lens goes for a shoulder share `k` (negative: over the left
   * shoulder) and lift `h`: the pivot is stepped out (never through a wall at
   * the side) and up (never through a
   * ceiling), then the chase ray runs back from it and stops short of
   * whatever it hits, exactly as it always has. Writes the eye to `eye` and
   * the pivot to `head`, and returns `head`.
   */
  private place(base: THREE.Vector3, shoulder: number, k: number, h: number,
    back: THREE.Vector3, physics: PhysicsWorld, eye: THREE.Vector3, head: THREE.Vector3): THREE.Vector3 {
    const { rightX, rightZ } = yawBasis(this.yaw);
    const step = k >= 0 ? Math.min(shoulder * k, this.roomRight) : -Math.min(-shoulder * k, this.roomLeft);
    head.copy(base);
    head.x += rightX * step;
    head.z += rightZ * step;
    head.y += Math.min(h, this.upRoom) * this.scale;
    const reach = this.dist + 0.3;
    const hit = physics.raycast(head, back, reach);
    let stop = hit ? Math.max(hit.dist - 0.25, 0.3) : this.dist;
    // ...and with the big bodies, which are not in the world's colliders
    for (const b of this.blockers) {
      const bh = rayCylinder(head, back, b, reach);
      if (bh) stop = Math.min(stop, Math.max(bh.dist - BLOCKER_PAD, 0.3));
    }
    eye.copy(head).addScaledVector(back, Math.min(stop, this.dist));
    // The ground is a floor under all of it: never below the surface, whatever
    // the march between its samples missed.
    if (physics.heightAt) {
      const floor = physics.heightAt(eye.x, eye.z) + CAM_GROUND_CLEAR;
      if (eye.y < floor) eye.y = floor;
    }
    return head;
  }

  /**
   * How well a lens at `eye` looking along `dir` frames the body: points on
   * it (feet, knees, hips, chest, both shoulders, head) projected onto the
   * screen. 1 means it passes — at least `minVis` of them on screen and the
   * chest inside the central `framingCentre` of it; under 1 is a score to
   * rank the failures by (more of the body on screen, chest nearer the middle).
   * `slack` shrinks the screen it counts as inside, for hysteresis.
   */
  private framing(eye: THREE.Vector3, dir: THREE.Vector3, feet: THREE.Vector3,
    bodyH: number, tanV: number, aspect: number, minVis: number, slack = 0): number {
    const r = this.tmpR.crossVectors(dir, this.tmpUp.set(0, 1, 0));
    if (r.lengthSq() < 1e-6) r.set(1, 0, 0);
    r.normalize();
    const u = this.tmpU.crossVectors(r, dir);
    const tanH = tanV * aspect;
    const sh = this.reach * 0.45;
    let inside = 0;
    let chestOff = 4;
    for (let i = 0; i < FRAME_POINTS.length; i++) {
      const [hy, sx] = FRAME_POINTS[i];
      const p = this.tmpPt.set(feet.x + r.x * sx * sh, feet.y + bodyH * hy, feet.z + r.z * sx * sh).sub(eye);
      const z = p.dot(dir);
      if (z <= 0.12) continue;
      const x = p.dot(r) / (z * tanH);
      const y = p.dot(u) / (z * tanV);
      if (Math.abs(x) <= 1 - slack && Math.abs(y) <= 1 - slack) inside++;
      if (i === FRAME_CHEST) chestOff = Math.max(Math.abs(x), Math.abs(y));
    }
    const frac = inside / FRAME_POINTS.length;
    if (frac >= minVis && chestOff <= T.framingCentre - slack) return 1;
    return 0.63 * Math.min(frac / Math.max(minVis, 1e-3), 1)
      + 0.27 * clamp(1 - (chestOff - T.framingCentre) / 2, 0, 1);
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
    [this.pace, this.paceHold] = this.ease(this.pace, this.paceTarget(opts), this.paceHold, dt);
    [this.toward, this.towardHold] = this.ease(this.toward, this.towardTarget(opts), this.towardHold, dt);
    // the pace tracks the player whether or not the setting is on, so turning
    // it on mid-sprint eases out to the right framing instead of from a
    // standstill; off, the multiplier is a flat 1 and nothing here is felt
    const follow = config.camera.dynamic
      ? T.nearRatio + (T.farRatio - T.nearRatio) * smoothstep(this.pace) + T.towardExtra * smoothstep(this.toward)
      : 1;

    // aiming pulls in proportionally, so the over-the-shoulder framing keeps
    // its relationship to whatever chase distance the player has dialled in.
    // ADS is its own framing: it ignores the pace and sits where it always did.
    // ...and never nearer than the body's own outline, so a big fighter is
    // something you are looking at rather than something you are looking from
    // inside. A Mandalorian's outline sits under even the closest framing the
    // tuning asks for, so for the eight of them this max() never binds.
    const targetDist = Math.max(this.clearance,
      this.baseDist * this.scale * (opts.aiming ? AIM_RATIO : follow));
    const targetFov = opts.aiming ? 52 : 72 + Math.min(opts.speed / 14, 1) * 7 + (opts.dashing ? 6 : 0);
    this.dist = this.framed ? damp(this.dist, targetDist, 10, dt) : targetDist;
    this.framed = true;
    this.fov = damp(this.fov, targetFov, 8, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    // the body's own head, before any over-the-shoulder step
    const base = this.tmpBase.copy(feetPos);
    const crouch = opts.crouching ? 0.72 : 1;
    base.y += this.eye * crouch;
    // over-the-right-shoulder offset, matching the right-handed carbine
    const { rightX, rightZ } = yawBasis(this.yaw);
    // A wide body needs the step out to clear its own flank, or the shoulder
    // view is a view of the shoulder. Only ever outward: a body narrower than
    // the reference keeps the offset that was tuned for it, rather than having
    // it quietly shaved because it measured a few centimetres under.
    const shoulderScale = clamp(this.reach / REF_REACH, 1, MAX_SHOULDER_SCALE);
    const shoulder = (opts.aiming ? SHOULDER_AIM : SHOULDER_HIP) * shoulderScale;
    this.aimDir(this.tmpDir);
    const back = this.tmpBack.copy(this.tmpDir).multiplyScalar(-1);

    // ---- framing: keep the body on screen ----
    // The shoulder step is a fixed sideways distance, so once a wall pulls the
    // lens in close the same 0.55 m that opens up the sightline out in the open
    // puts the body beside the camera instead of in front of it: backed onto a
    // wall the lens sat 0.3 m behind the shoulder pivot and the body projected
    // more than a screen-width off to the left. So the step is scaled by
    // `frameK` (and the pivot lifted by `frameH`), eased toward whatever keeps
    // most of the body in shot; the collision in `place` stays authoritative,
    // and in the open the tuned framing passes on its own and nothing changes.
    const side = this.tmpSide.set(rightX, 0, rightZ);
    const sideReach = shoulder + T.shoulderWallPad;
    const hitR = physics.raycast(base, side, sideReach);
    this.roomRight = hitR ? Math.max(hitR.dist - T.shoulderWallPad, 0) : shoulder;
    // the left side and the headroom only matter once framing is in play, so
    // out in the open they are not probed at all
    this.roomLeft = 0;
    this.upRoom = 0;
    let probed = false;
    const probe = (): void => {
      if (probed) return;
      probed = true;
      if (T.shoulderSwap > 0) {
        const hitL = physics.raycast(base, this.tmpSide.set(-rightX, 0, -rightZ), sideReach);
        this.roomLeft = hitL ? Math.max(hitL.dist - T.shoulderWallPad, 0) : shoulder;
      }
      if (T.framingRaise > 0) {
        const upHit = physics.raycast(base, this.tmpUp.set(0, 1, 0), T.framingRaise * this.scale + T.shoulderWallPad);
        this.upRoom = upHit ? Math.max(upHit.dist - T.shoulderWallPad, 0) / this.scale : T.framingRaise;
      }
    };
    if (this.frameK < 0 || this.frameH > 0) probe();
    const floorK = Math.min(1, (T.shoulderFloor * shoulderScale) / Math.max(shoulder, 1e-3));
    const minVis = opts.aiming ? T.framingAimMinVisible : T.framingMinVisible;
    const tanV = Math.tan((this.fov * Math.PI) / 360);
    const bodyH = this.eye * (REF_HEIGHT / REF_EYE) * crouch;
    const score = (k: number, h: number, slack = 0): number => {
      this.place(base, shoulder, k, h, back, physics, this.tmpEye, this.tmpHead);
      return this.framing(this.tmpEye, this.tmpDir, feetPos, bodyH, tanV, this.camera.aspect, minVis, slack);
    };
    // the tuned framing first: out in the open it passes and that is the end of it
    let wantK = 1;
    let wantH = 0;
    // Once framing has taken over, the tuned framing has to pass with a little
    // room to spare before it is handed back, or a body standing right on the
    // edge of passing would have the camera tugged in and out every frame.
    const engaged = this.frameK !== 1 || this.frameH !== 0;
    const tunedOk = score(1, 0, engaged ? T.framingHysteresis : 0) >= 1;
    if (!tunedOk) {
      probe();
      // Nothing to do but look for a framing that does pass: slide in off the
      // right shoulder first, then (if allowed) over the left one, then the
      // same again lifted. The side the camera is already on goes first, and
      // the other side has to beat it by a margin, so it never flip-flops.
      const right = [1, 0.75, 0.5, 0.25, 0].map((k) => Math.max(k, floorK));
      const left = T.shoulderSwap > 0
        ? [floorK, 0.5, 0.75, 1].filter((k) => k <= T.shoulderSwap).map((k) => -Math.max(k, floorK))
        : [];
      const sides = this.frameK < 0 ? [left, right] : [right, left];
      let best = -Infinity;
      search: for (const h of [0, T.framingRaise]) {
        for (let si = 0; si < sides.length; si++) {
          const margin = si === 0 ? 0 : T.framingSwapMargin;
          for (const k of sides[si]) {
            const sc = score(k, h);
            // strictly better only, so ties keep the wider shoulder / lower lens
            if ((sc >= 1 && best < 1) || sc > best + margin + 1e-6) { best = sc; wantK = k; wantH = h; }
            if (best >= 1) break search;
          }
        }
      }
    }
    if (!this.frameInit) {
      this.frameK = wantK; this.frameH = wantH; this.frameInit = true;
    } else {
      // Easing in off the shoulder (or across to the left one) is quick: the
      // body is leaving the frame. Easing back out to the tuned right-shoulder
      // framing is slow, so the camera drifts back rather than snapping, and
      // a wall closing in stops it short instead of pushing on past the body.
      this.frameK = damp(this.frameK, wantK, wantK < this.frameK ? T.framingInLambda : T.framingOutLambda, dt);
      this.frameH = damp(this.frameH, wantH, wantH > this.frameH ? T.framingInLambda : T.framingOutLambda, dt);
      // the last millimetre is the target, so a settled camera is exactly settled
      if (Math.abs(this.frameK - wantK) < 1e-3) this.frameK = wantK;
      if (Math.abs(this.frameH - wantH) < 1e-3) this.frameH = wantH;
    }
    // settled on the tuned framing: that is the placement already worked out
    const head = tunedOk && this.frameK === 1 && this.frameH === 0
      ? (this.tmpDesired.copy(this.tmpEye), this.tmpTarget.copy(this.tmpHead))
      : this.place(base, shoulder, this.frameK, this.frameH, back, physics, this.tmpDesired, this.tmpTarget);

    // hand-off glide: blend from the stored start toward the live chase
    // framing, so a body swap flies the view over instead of cutting
    if (this.glideT > 0) {
      this.glideT -= dt;
      const k = smoothstep(clamp(1 - this.glideT / this.glideDur, 0, 1));
      this.tmpDesired.lerpVectors(this.glidePos, this.tmpDesired, k);
    }

    this.camera.position.copy(this.tmpDesired);
    if (this.shakeAmt > 0.001) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * this.shakeAmt,
        (Math.random() - 0.5) * this.shakeAmt,
        (Math.random() - 0.5) * this.shakeAmt,
      );
      this.camera.position.add(this.shakeOffset);
      this.shakeAmt *= Math.exp(-9 * dt);
    } else {
      this.shakeOffset.set(0, 0, 0);
    }
    // The look target moves with the eye, so the shake is a *translation* of
    // the whole rig rather than a wobble of its aim. That matters to whoever
    // reads `shakeOffset`: a body translated by the same vector holds exactly
    // still in the frame while everything around it moves.
    const lookAt = head.clone().add(this.shakeOffset).addScaledVector(this.tmpDir, 30);
    this.camera.lookAt(lookAt);
  }
}
