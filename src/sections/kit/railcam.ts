import * as THREE from 'three';
import type { FrameInput } from '../../core/input';
import type { Rect } from '../../core/layout';
import { clamp, damp, yawBasis } from '../../core/math';
import type { Game } from '../../game/game';
import type { Player } from '../../player/player';
import type { SectionMove } from '../api';

/**
 * K1 — the rail camera (docs/LEVEL_SECTIONS.md §1 "K1", SECTIONS_IMPLEMENTATION.md §3).
 *
 * One full-screen camera for the whole party, riding an authored rail beside
 * a lane narrow enough that nobody can be walled out of the shot: a ring's
 * hull spine, a pier, a tram roof. It is the one place the shared camera the
 * game cut for good (LEVEL_DESIGN.md §6) comes back, and the two things that
 * killed it are designed out here:
 *
 * - **The frame is a leash.** The lane is measured in metres along it (`s`).
 *   The camera keeps a *window* `[rear, front]` of the lane in shot with the
 *   party's centroid at `lead` of it. The rear edge is a soft wall — a player
 *   left behind it is carried along, gently, never hurt — and it only ever
 *   moves forward, so the scroll is one-way. The front edge is a wall the
 *   party cannot outrun the camera through; a **lock** pins it at an arena's
 *   far side until the section unlocks it (clear the wave, move on).
 * - **Aim is twin-stick.** While a rail section stands the right stick stops
 *   orbiting (there is nothing to orbit) and points the gun in the ground
 *   plane; the existing soft-lock pulls bolts onto the nearest target in that
 *   direction, with a wider cone (`Player.aimCone`). The mouse moves a reticle
 *   on the ground instead. LT hard-locks the nearest target in front. Each
 *   player's own chase camera still runs, unseen, pointed along their aim —
 *   which is what lets every existing firing path (camera ray, soft-lock,
 *   lock-on, squaring the body) work untouched.
 *
 * Stick "up" is along the rail (`Player.moveYaw`), taken at each player's own
 * point on the lane so holding it walks a curve. **Reversed** (Run the Pier)
 * puts the camera ahead of the party looking back; "up" is then away from the
 * lens, so the party runs at the camera by pulling down, as they see it.
 *
 * Entering blends the split viewports into one over `BLEND` seconds: each
 * player's view flies from behind their hunter to the rail camera's pose while
 * its viewport's projection is walked to *its own piece* of the full-screen
 * frame (`setViewOffset`), so at the end the pieces tile one picture and the
 * split lines have faded out of the HUD; then it is drawn as one. `release()`
 * plays it backwards onto each player's live chase camera.
 *
 * The kit is the camera, the leash, the gates, the aim and the blend. What the
 * lane *is* (a curve, a line, a pier chain), where it is safe to stand and when
 * to lock is the section's.
 */

/** seconds the split blends into one screen, and back */
const BLEND = 0.6;
/** the soft-lock cone while twin-stick aiming: cos of ~24°, against 9.6° normally */
const TWIN_CONE = 0.91;
/** how far the right stick has to go before it takes the aim */
const STICK_TAKES = 0.35;
/** the mouse reticle: metres per radian of mouse look, and its reach */
const RETICLE_GAIN = 22;
const RETICLE_MIN = 2.5;
const RETICLE_MAX = 22;
/** how fast a straggler is carried by the rear edge, m/s */
const CARRY = 8;
/** stuck behind the rear edge this far, this long: re-formed forward */
const STUCK_BEHIND = 4;
const STUCK_TIME = 2;

export interface RailPose { eye: THREE.Vector3; look: THREE.Vector3 }

export interface RailOpts {
  /** the lane the party walks, start to end: a polyline through its middle, roughly a metre a point */
  lane: THREE.Vector3[];
  /** where the party's centroid sits in the window, 0 = rear edge, 1 = front (default 0.45) */
  lead?: number;
  /** the window's length along the lane, metres (default 36) */
  span?: number;
  /** the camera's top speed along the lane, m/s (default 9) */
  maxSpeed?: number;
  /** vertical field of view (default 55) */
  fov?: number;
  /**
   * The camera's offsets from the lane at its focus: `back` metres behind it
   * along the lane (ahead of it, reversed), `side` metres to the lane's right
   * (negative: its left), `up` over it, looking at the lane `lookAhead`
   * metres on (back, reversed). A lock that widens the window pulls all of
   * them out in proportion. Ignored when `pose` is given.
   */
  eye?: { back: number; side: number; up: number; lookAhead?: number };
  /** an authored pose instead: the eye and look for a focus `s` and a zoom (1 = the span) */
  pose?: (s: number, zoom: number, out: RailPose) => void;
  /** rail gates, metres along the lane, in order: where the fallen re-form */
  gates?: number[];
  /** the camera ahead of the party looking back at it (Run the Pier) */
  reverse?: boolean;
  /** may a body stand here? (a gap, a vent, a hole in the pier is not) — default: anywhere */
  safe?: (s: number, lateral: number) => boolean;
  /** the floor height at a lane point, for a re-form (default: the lane point's own y) */
  groundAt?: (x: number, z: number) => number;
  /** how far either side of the lane the leash reaches, metres (default 14) */
  width?: number;
  /** lateral offsets the party re-forms at, by slot (default ±1.8, ±3.6) */
  formation?: number[];
  /** the focus never runs past this, metres along the lane (the camera stops short of the end door) */
  stop?: number;
}

/** a point on the lane: metres along it, and metres to its right (negative: left) */
export interface LanePoint { s: number; lateral: number }

export class RailCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** metres of lane */
  readonly length: number;
  /** the camera's focus on the lane: only ever moves forward */
  focus: number;
  /** the window's edges on the lane */
  rear: number;
  front: number;
  /** 0 = the split screen, 1 = merged; runs up on `engage`, down on `release` */
  blend = 0;
  /** index into `gates` of the last gate the leading edge has crossed */
  gateIdx = 0;

  private readonly pts: THREE.Vector3[];
  private readonly cum: number[];
  private readonly lead: number;
  private readonly span: number;
  private readonly maxSpeed: number;
  private readonly gates: number[];
  private readonly formation: number[];
  private blendDir = 0;
  private engaged = false;
  private released = false;
  private lockWin: { from: number; to: number } | null = null;
  private game: Game | null = null;
  private readonly pose: RailPose = { eye: new THREE.Vector3(), look: new THREE.Vector3() };
  private readonly look = new THREE.Vector3();
  private framed = false;
  /** per slot: its viewport's camera while blending, and where it flew from */
  private readonly views: THREE.PerspectiveCamera[] = [];
  private readonly from: { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number }[] = [];
  /** per slot: aim yaw, the mouse reticle (lane-basis metres), and the stuck clock */
  private readonly aim: { yaw: number; rx: number; ry: number; mouseT: number; stuck: number }[] = [];
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpVel = new THREE.Vector3();

  constructor(readonly opts: RailOpts) {
    if (opts.lane.length < 2) throw new Error('[railcam] a lane needs two points');
    this.pts = opts.lane.map((p) => p.clone());
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    }
    this.length = this.cum[this.cum.length - 1];
    this.lead = opts.lead ?? 0.45;
    this.span = opts.span ?? 36;
    this.maxSpeed = opts.maxSpeed ?? 9;
    this.gates = [...(opts.gates ?? [0])].sort((a, b) => a - b);
    this.formation = opts.formation ?? [-1.8, 1.8, -3.6, 3.6];
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 55, 16 / 9, 0.5, 5000);
    this.focus = 0;
    this.rear = -this.lead * this.span;
    this.front = (1 - this.lead) * this.span;
  }

  // ------------------------------------------------------------------ the lane

  /** the lane point `s` metres along, `lateral` metres to its right */
  pointAt(s: number, lateral = 0, out = new THREE.Vector3()): THREE.Vector3 {
    const { i, t } = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    out.lerpVectors(a, b, t);
    if (lateral) {
      const tx = b.x - a.x, tz = b.z - a.z;
      const len = Math.hypot(tx, tz) || 1;
      // the lane's right: tangent × up
      out.x += (-tz / len) * lateral;
      out.z += (tx / len) * lateral;
    }
    return out;
  }

  /** the lane's direction of travel at `s`, flat and unit */
  tangentAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const { i } = this.seg(s);
    const a = this.pts[i], b = this.pts[i + 1];
    return out.set(b.x - a.x, 0, b.z - a.z).normalize();
  }

  /** the yaw of the direction of travel at `s` (0 = +z, as `yawBasis`) */
  yawAt(s: number): number {
    const t = this.tangentAt(s, this.tmpV);
    return Math.atan2(t.x, t.z);
  }

  /** where a world point is along the lane, and how far off to its right */
  project(p: THREE.Vector3): LanePoint {
    let best = Infinity, bs = 0, bl = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const t = clamp(((p.x - a.x) * ex + (p.z - a.z) * ez) / len2, 0, 1);
      const qx = a.x + ex * t, qz = a.z + ez * t;
      const d2 = (p.x - qx) ** 2 + (p.z - qz) ** 2;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        bs = this.cum[i] + t * len;
        // signed: positive to the lane's right (tangent × up)
        bl = ((p.x - a.x) * (-ez) + (p.z - a.z) * ex) / len;
      }
    }
    // beyond either end the lane runs on straight, so a body past it still measures
    const first = this.pts[0], last = this.pts[this.pts.length - 1];
    if (bs <= 0) {
      const t = this.tangentAt(0, this.tmpV);
      bs = (p.x - first.x) * t.x + (p.z - first.z) * t.z;
      if (bs > 0) bs = 0;
    } else if (bs >= this.length) {
      const t = this.tangentAt(this.length, this.tmpV);
      bs = this.length + Math.max(0, (p.x - last.x) * t.x + (p.z - last.z) * t.z);
    }
    return { s: bs, lateral: bl };
  }

  private seg(s: number): { i: number; t: number } {
    const c = this.cum;
    const n = this.pts.length - 1;
    if (s <= 0) return { i: 0, t: s / Math.max(1e-6, c[1]) };
    if (s >= this.length) return { i: n - 1, t: 1 + (s - this.length) / Math.max(1e-6, c[n] - c[n - 1]) };
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= s) lo = mid; else hi = mid;
    }
    return { i: lo, t: (s - c[lo]) / Math.max(1e-6, c[lo + 1] - c[lo]) };
  }

  // ------------------------------------------------------------------ the frame

  /** hold the window at an arena, `from`..`to` along the lane: the front edge is a wall until `unlock` */
  lock(from: number, to: number): void { this.lockWin = { from, to }; }
  unlock(): void { this.lockWin = null; }
  get locked(): boolean { return !!this.lockWin; }

  /** the last rail gate the leading edge has crossed, metres along the lane */
  get gate(): number { return this.gates[this.gateIdx] ?? 0; }

  /** true once `release()` has blended back out to the split */
  get out(): boolean { return this.released && this.blend <= 0; }

  /**
   * Take the screen: set the shared view, hand every player the rail's
   * stick basis and the twin-stick aim, and start the blend in. Call once,
   * from the section's first update. Compose `move` into each player's
   * `sectionMove` yourself if the section has other input hooks; otherwise
   * this sets it.
   */
  engage(game: Game, opts: { setMove?: boolean } = {}): void {
    this.game = game;
    this.engaged = true;
    this.released = false;
    this.blendDir = 1;
    this.blend = 0;
    // start the window on the party, wherever the section stood them
    const c = this.centroid(game);
    if (c !== null) {
      this.focus = c;
      this.rear = c - this.lead * this.span;
      this.front = c + (1 - this.lead) * this.span;
    }
    this.framed = false;
    this.updatePose(0);
    for (const p of game.players) {
      const { s } = this.project(p.position);
      const yaw = this.yawAt(s) + (this.opts.reverse ? Math.PI : 0);
      p.moveYaw = yaw;
      p.aimCone = TWIN_CONE;
      this.aim[p.slot] = { yaw: this.yawAt(s), rx: 0, ry: 8, mouseT: 0, stuck: 0 };
      if (opts.setMove !== false) p.sectionMove = this.move;
      // the blend flies from just behind each hunter, looking where they face
      const f = this.from[p.slot] ??= { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 72 };
      const b = yawBasis(p.cam.yaw);
      f.pos.set(p.position.x - b.fwdX * 3.2, p.position.y + 2.2, p.position.z - b.fwdZ * 3.2);
      const m = new THREE.Matrix4().lookAt(f.pos,
        this.tmpV.set(p.position.x + b.fwdX * 10, p.position.y + 1.2, p.position.z + b.fwdZ * 10), THREE.Object3D.DEFAULT_UP);
      f.quat.setFromRotationMatrix(m);
      f.fov = 72;
    }
    game.sharedView = {
      camera: this.camera,
      blend: 0,
      viewFor: (i, rect, w, h) => this.viewFor(i, rect, w, h),
    };
  }

  /**
   * Give the screen back: blend to each player's own chase camera, pointed
   * along the rail, and hand the sticks back to the camera. `out` turns true
   * when the split is whole again — the section completes then.
   */
  release(): void {
    const game = this.game;
    if (!game || this.released) return;
    this.released = true;
    this.blendDir = -1;
    for (const p of game.players) {
      const { s } = this.project(p.position);
      p.cam.face(this.yawAt(s));
      p.moveYaw = null;
      p.aimCone = null;
    }
  }

  /** the party's centroid along the lane (living players), or null for none */
  centroid(game: Game): number | null {
    let sum = 0, n = 0;
    for (const p of game.players) {
      if (!p.alive || p.exited) continue;
      sum += this.project(p.position).s;
      n++;
    }
    return n ? sum / n : null;
  }

  /**
   * Tick the camera, the leash and the blend. Call every section update
   * while engaged (and on after `release()` until `out`).
   */
  update(dt: number): void {
    const game = this.game;
    if (!game || !this.engaged) return;

    // ---- the blend ----
    if (this.blendDir) {
      this.blend = clamp(this.blend + (this.blendDir * dt) / BLEND, 0, 1);
      if (this.blend >= 1 || this.blend <= 0) this.blendDir = 0;
    }
    if (this.released && this.blend <= 0) {
      if (game.sharedView?.camera === this.camera) game.sharedView = null;
      return;
    }
    if (game.sharedView) game.sharedView.blend = this.blend;

    // ---- the window ----
    const lock = this.lockWin;
    const c = this.centroid(game);
    if (lock) {
      const want = lock.from + this.lead * (lock.to - lock.from);
      this.focus = Math.max(this.focus, Math.min(want, this.focus + this.maxSpeed * dt));
    } else if (c !== null && c > this.focus) {
      this.focus = Math.min(c, this.focus + this.maxSpeed * dt);
    }
    this.focus = Math.min(this.focus, this.opts.stop ?? Infinity);
    const rearT = lock ? lock.from : this.focus - this.lead * this.span;
    const frontT = lock ? lock.to : this.focus + (1 - this.lead) * this.span;
    // the rear edge is one-way; the front eases (a lock closing is a push, not a teleport)
    this.rear = Math.max(this.rear, Math.min(rearT, this.rear + this.maxSpeed * 1.4 * dt));
    this.front = this.front < frontT
      ? Math.min(frontT, this.front + this.maxSpeed * 1.6 * dt)
      : Math.max(frontT, this.front - 14 * dt);
    while (this.gateIdx + 1 < this.gates.length && this.gates[this.gateIdx + 1] <= this.front - 1) this.gateIdx++;

    // ---- the leash ----
    const width = this.opts.width ?? 14;
    const phys = game.board.physics;
    for (const p of game.players) {
      if (!p.alive || p.exited || p.formT > 0) continue;
      const lp = this.project(p.position);
      const a = this.aim[p.slot];
      if (!this.released) p.moveYaw = this.yawAt(lp.s) + (this.opts.reverse ? Math.PI : 0);
      if (this.released || Math.abs(lp.lateral) > width) continue;
      const t = this.tangentAt(lp.s, this.tmpV);
      if (lp.s < this.rear) {
        // carried by the rear edge: a shove along the lane, through the solver
        const step = Math.min(this.rear - lp.s, CARRY * dt);
        this.tmpVel.set(t.x * step / dt, 0, t.z * step / dt);
        phys.moveCapsule(p.position, p.radius, p.height, this.tmpVel, dt);
        if (a) {
          a.stuck = lp.s < this.rear - STUCK_BEHIND ? a.stuck + dt : 0;
          if (a.stuck > STUCK_TIME) {
            a.stuck = 0;
            p.position.copy(this.respawnSpot(p.slot));
            p.velocity.set(0, 0, 0);
          }
        }
      } else if (a) a.stuck = 0;
      if (lp.s > this.front) {
        // the leading edge: nobody leaves the shot ahead of the camera
        const back = lp.s - this.front;
        this.tmpVel.set(-t.x * back / dt, 0, -t.z * back / dt);
        phys.moveCapsule(p.position, p.radius, p.height, this.tmpVel, dt);
        const into = p.velocity.x * t.x + p.velocity.z * t.z;
        if (into > 0) { p.velocity.x -= t.x * into; p.velocity.z -= t.z * into; }
      }
    }

    this.updatePose(dt);
  }

  /** point the camera for the current window, eased */
  private updatePose(dt: number): void {
    const zoom = Math.max(1, (this.front - this.rear) / this.span);
    const s = this.rear + this.lead * (this.front - this.rear);
    const out = this.pose;
    if (this.opts.pose) this.opts.pose(s, zoom, out);
    else {
      const e = this.opts.eye ?? { back: 10, side: 12, up: 10, lookAhead: 8 };
      const dir = this.opts.reverse ? -1 : 1;
      this.pointAt(s - dir * e.back * zoom, e.side * zoom, out.eye);
      out.eye.y += e.up * zoom;
      this.pointAt(s + dir * (e.lookAhead ?? 8), 0, out.look);
      out.look.y += 1.2;
    }
    const cam = this.camera;
    if (!this.framed || dt <= 0) {
      cam.position.copy(out.eye);
      this.look.copy(out.look);
      this.framed = true;
    } else {
      cam.position.x = damp(cam.position.x, out.eye.x, 4, dt);
      cam.position.y = damp(cam.position.y, out.eye.y, 4, dt);
      cam.position.z = damp(cam.position.z, out.eye.z, 4, dt);
      this.look.x = damp(this.look.x, out.look.x, 5, dt);
      this.look.y = damp(this.look.y, out.look.y, 5, dt);
      this.look.z = damp(this.look.z, out.look.z, 5, dt);
    }
    cam.lookAt(this.look);
    cam.updateMatrixWorld();
  }

  /**
   * Where a fallen player of `slot` re-forms: the last gate the leading edge
   * crossed, or — once the window has scrolled past it — the rear of the
   * frame; then forward from there to the first spot the section calls safe.
   * Never behind the camera, never outside the shot.
   */
  respawnSpot(slot: number): THREE.Vector3 {
    const lat = this.formation[slot % this.formation.length] ?? 0;
    const start = Math.max(this.gate, this.rear + 3);
    const stop = Math.max(start, this.front - 2);
    const safe = this.opts.safe ?? (() => true);
    let s = start;
    for (let k = start; k <= stop; k += 0.75) {
      if (safe(k, lat) && safe(k, 0)) { s = k; break; }
    }
    const at = this.pointAt(s, lat);
    if (this.opts.groundAt) at.y = this.opts.groundAt(at.x, at.z);
    return at;
  }

  // ------------------------------------------------------------------ twin-stick

  /**
   * The rail's input hook for `Player.sectionMove`: turns the right stick (or
   * the mouse, or LT) into an aim yaw in the ground plane and points the
   * player's own (unseen) camera along it, so every firing path aims there.
   */
  readonly move: SectionMove = {
    adjust: (p: Player, dt: number, input: FrameInput, game: Game): FrameInput => {
      if (!this.engaged || this.released || !p.alive) return input;
      const a = this.aim[p.slot] ??= { yaw: p.cam.yaw, rx: 0, ry: 8, mouseT: 0, stuck: 0 };
      const basis = p.moveYaw ?? p.cam.yaw;
      const b = yawBasis(basis);
      const ax = input.aimStickX ?? 0, ay = input.aimStickY ?? 0;
      const moveMag = Math.hypot(input.moveX, input.moveY);
      let pitch = -0.05;
      if (Math.hypot(ax, ay) > STICK_TAKES) {
        // the stick points the gun: its direction on the rail's own basis
        a.yaw = Math.atan2(b.fwdX * ay + b.rightX * ax, b.fwdZ * ay + b.rightZ * ax);
        a.mouseT = 0;
      } else if (input.lookX || input.lookY) {
        // the mouse walks a reticle across the ground, in the same basis
        a.mouseT = 3;
        a.rx = a.rx - input.lookX * RETICLE_GAIN;
        a.ry = a.ry + input.lookY * RETICLE_GAIN;
        const r = Math.hypot(a.rx, a.ry);
        if (r > RETICLE_MAX) { a.rx *= RETICLE_MAX / r; a.ry *= RETICLE_MAX / r; }
        if (r < RETICLE_MIN) { const k = RETICLE_MIN / Math.max(r, 1e-3); a.rx *= k; a.ry *= k; }
        a.yaw = Math.atan2(b.fwdX * a.ry + b.rightX * a.rx, b.fwdZ * a.ry + b.rightZ * a.rx);
      } else if (moveMag > 0.3 && a.mouseT <= 0) {
        // nothing on the aim: the gun follows the feet, as twin-stick shooters do
        a.yaw = Math.atan2(b.fwdX * input.moveY + b.rightX * input.moveX, b.fwdZ * input.moveY + b.rightZ * input.moveX);
      }
      a.mouseT = Math.max(0, a.mouseT - dt);
      // LT hard-locks the nearest target in front and keeps the gun on it
      if (input.aimHeld) {
        const t = this.hardLock(p, game, a.yaw);
        if (t) {
          const dx = t.position.x - p.position.x, dz = t.position.z - p.position.z;
          a.yaw = Math.atan2(dx, dz);
          const dy = t.position.y + t.height * 0.55 - (p.position.y + 1.6);
          pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.6, 0.6);
        }
      }
      p.cam.face(a.yaw, pitch);
      // the camera does not orbit or dolly in a rail section
      return { ...input, lookX: 0, lookY: 0, zoomDelta: 0 };
    },
  };

  /** the mouse reticle's world point for a slot, while the mouse is steering it */
  reticle(slot: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const a = this.aim[slot];
    const p = this.game?.players[slot];
    if (!a || !p || a.mouseT <= 0 || !p.alive || this.released) return null;
    const b = yawBasis(p.moveYaw ?? p.cam.yaw);
    return out.set(p.position.x + b.fwdX * a.ry + b.rightX * a.rx, p.position.y + 0.05,
      p.position.z + b.fwdZ * a.ry + b.rightZ * a.rx);
  }

  private hardLock(p: Player, game: Game, yaw: number): { position: THREE.Vector3; height: number } | null {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best: { position: THREE.Vector3; height: number } | null = null;
    let bestScore = -Infinity;
    for (const e of game.hostilesFor(p)) {
      if (!e.alive) continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 45 || d < 0.5) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.35) continue;
      const score = dot * 2 - d / 25;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------ the blend

  /**
   * The camera viewport `i` draws while the split and the shared screen blend
   * (`Game.render`): flown from that player's own view to the rail camera,
   * and cropped to that viewport's own piece of the full-screen frame.
   */
  private viewFor(i: number, rect: Rect, w: number, h: number): THREE.PerspectiveCamera {
    const cam = this.views[i] ??= new THREE.PerspectiveCamera(55, 1, 0.3, 5000);
    const k = this.blend * this.blend * (3 - 2 * this.blend);
    const p = this.game?.players[i];
    // entering: from the pose captured behind the hunter; leaving: to their live camera
    let pos: THREE.Vector3, quat: THREE.Quaternion, fov: number;
    if (this.released && p) {
      pos = p.cam.camera.position; quat = p.cam.camera.quaternion; fov = p.cam.camera.fov;
    } else {
      const f = this.from[i];
      pos = f?.pos ?? this.camera.position; quat = f?.quat ?? this.camera.quaternion; fov = f?.fov ?? this.camera.fov;
    }
    cam.position.lerpVectors(pos, this.camera.position, k);
    cam.quaternion.slerpQuaternions(quat, this.camera.quaternion, k);
    cam.fov = fov + (this.camera.fov - fov) * k;
    // walk the projection from "this viewport is a whole picture" to "this
    // viewport is its own piece of one full-screen picture"
    const vw = rect.w * w, vh = rect.h * h;
    const fullW = vw + (w - vw) * k, fullH = vh + (h - vh) * k;
    cam.setViewOffset(fullW, fullH, rect.x * w * k, rect.y * h * k, vw, vh);
    cam.updateMatrixWorld();
    return cam;
  }

  /** put everything back the way the split screen had it */
  dispose(): void {
    const game = this.game;
    if (!game) return;
    if (game.sharedView?.camera === this.camera) game.sharedView = null;
    for (const p of game.players) {
      p.moveYaw = null;
      p.aimCone = null;
      if (p.sectionMove === this.move) p.sectionMove = null;
    }
    this.engaged = false;
    this.game = null;
  }
}
