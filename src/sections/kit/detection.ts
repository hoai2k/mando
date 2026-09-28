import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Player } from '../../player/player';
import type { Enemy, Combatant } from '../../enemies/enemy';

/**
 * K6 — the detection field (docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * One meter per player, 0..1, that fills when the player gives themselves
 * away and drains when they stop. Two things feed it:
 *
 * - **Noise.** Firing, a jetpack burn (or a super-jump's thrust), sprinting
 *   and landing hard are read off each player every frame; a section can add
 *   its own (`noise(slot, amount)`: a thumper planted, a crate knocked over).
 *   A `noiseGate` scales it per player — Worm Sign only hears you on sand,
 *   Lights Out only when a hostile is near enough to hear.
 * - **Light.** A `LightCone` (a searchlight, a sensor post, a patrol's torch)
 *   fills the meter of anyone standing inside it with a clear line of sight
 *   back to its origin, faster the closer they stand.
 *
 * A **mask** (a steam plume, a dust cloud) blocks a cone's sight through it
 * and swallows the noise of anyone standing in it while it is on.
 *
 * Thresholds fire callbacks on the way up (`onCross`) and, once the meter
 * has dropped back under half the mark, on the way down (`onClear`) — so a
 * meter hovering at the line does not fire every frame.
 *
 * The field only reports; what a full meter *means* (an alarm, a worm) is the
 * section's.
 */

/** meter per second (continuous) or per event, before the gate */
export interface NoiseRates {
  /** one shot fired (blaster, rocket) */
  fire: number;
  /** a second of jetpack or super-jump thrust */
  jet: number;
  /** a second of sprinting on the ground */
  sprint: number;
  /** a second of plain walking/running on the ground (0 in most sections) */
  walk: number;
  /** touching down from a drop of ordinary speed */
  land: number;
  /** touching down hard (falling faster than 12 m/s, or a slam) */
  hardLand: number;
}

export const DEFAULT_NOISE: NoiseRates = { fire: 0.22, jet: 0.35, sprint: 0.18, walk: 0, land: 0.05, hardLand: 0.2 };

export interface Threshold {
  /** 0..1 */
  at: number;
  onCross(slot: number): void;
  onClear?(slot: number): void;
}

export interface LightConeSpec {
  origin: THREE.Vector3;
  /** unit direction the cone points (mutate it to sweep) */
  dir: THREE.Vector3;
  /** half the cone's opening angle, radians */
  halfAngle: number;
  /** metres */
  range: number;
  /** meter per second for someone in the middle of it at half range */
  rate: number;
  /** a name for HUD lines and tests */
  tag?: string;
}

export class LightCone {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  halfAngle: number;
  range: number;
  rate: number;
  tag: string;
  /** switched off (a booth killed it, it is broken): sees nothing */
  on = true;
  private cos: number;

  constructor(spec: LightConeSpec) {
    this.origin = spec.origin.clone();
    this.dir = spec.dir.clone().normalize();
    this.halfAngle = spec.halfAngle;
    this.range = spec.range;
    this.rate = spec.rate;
    this.tag = spec.tag ?? 'light';
    this.cos = Math.cos(spec.halfAngle);
  }

  /**
   * How squarely `p` sits in the cone, geometry only (no line of sight): 0
   * outside, rising to 1 on the axis close in. Used for the fill rate.
   */
  exposure(p: THREE.Vector3): number {
    if (!this.on) return 0;
    const dx = p.x - this.origin.x, dy = p.y - this.origin.y, dz = p.z - this.origin.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > this.range || d < 1e-3) return 0;
    const c = (dx * this.dir.x + dy * this.dir.y + dz * this.dir.z) / d;
    if (c < this.cos) return 0;
    // the edge of the beam counts for less than its axis, the far end less than close in
    const edge = (c - this.cos) / Math.max(1e-3, 1 - this.cos);
    const near = 1 - d / this.range;
    return (0.55 + 0.45 * Math.min(1, edge * 2)) * (0.5 + near);
  }

  /** where the axis meets the ground plane at height `y` (for drawing the pool of light) */
  groundHit(y: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    if (this.dir.y >= -1e-3) return null;
    const t = (y - this.origin.y) / this.dir.y;
    if (t < 0 || t > this.range) return null;
    return out.copy(this.origin).addScaledVector(this.dir, t);
  }
}

/** a sight blocker and noise muffler: a steam plume, a dust cloud */
export interface DetectionMask {
  center: THREE.Vector3;
  radius: number;
  on: boolean;
}

export interface DetectionOptions {
  /** meter drained per second once `hold` has passed with nothing feeding it */
  decay?: number;
  /** seconds a meter holds before it starts to drain */
  hold?: number;
  noise?: Partial<NoiseRates>;
  /** multiplies every noise a player makes (0 = unheard); default 1 */
  noiseGate?: (p: Player) => number;
  /** multiplies every light fill (a disguise, a stealth field); default 1 */
  lightGate?: (p: Player) => number;
  thresholds?: Threshold[];
}

interface Watch {
  fireCd: number;
  grounded: boolean;
  vy: number;
  /** seconds since something last fed the meter */
  quiet: number;
  /** which thresholds are armed (below and ready to fire) */
  armed: boolean[];
}

const _to = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _from = new THREE.Vector3();

export class DetectionField {
  /** each player's meter, by slot */
  readonly meters: number[] = [0, 0, 0, 0];
  /** noise each player made this frame (for "the loudest player") */
  readonly heard: number[] = [0, 0, 0, 0];
  /** the cone lighting each player this frame, or null */
  readonly litBy: (LightCone | null)[] = [null, null, null, null];
  readonly cones: LightCone[] = [];
  readonly masks: DetectionMask[] = [];
  /** false freezes every meter where it is (an alarm already running) */
  enabled = true;
  private rates: NoiseRates;
  private decay: number;
  private hold: number;
  private thresholds: Threshold[];
  private watch: Watch[] = [];
  /** throttled line-of-sight answers: cone index × slot → [clear, age] */
  private los = new Map<number, { clear: boolean; age: number }>();

  constructor(private game: Game, private opts: DetectionOptions = {}) {
    this.rates = { ...DEFAULT_NOISE, ...opts.noise };
    this.decay = opts.decay ?? 0.3;
    this.hold = opts.hold ?? 1.2;
    this.thresholds = [...(opts.thresholds ?? [])].sort((a, b) => a.at - b.at);
  }

  addCone(spec: LightConeSpec): LightCone {
    const c = new LightCone(spec);
    this.cones.push(c);
    return c;
  }

  addMask(center: THREE.Vector3, radius: number): DetectionMask {
    const m = { center: center.clone(), radius, on: false };
    this.masks.push(m);
    return m;
  }

  addThreshold(t: Threshold): void {
    this.thresholds.push(t);
    this.thresholds.sort((a, b) => a.at - b.at);
    this.watch.length = 0;   // re-armed on the next update
  }

  /** the meter of player `slot`, 0..1 */
  level(slot: number): number { return this.meters[slot] ?? 0; }
  /** the fullest meter in the party */
  peak(): number {
    let m = 0;
    for (const p of this.game.players) if (p.alive) m = Math.max(m, this.meters[p.slot]);
    return m;
  }
  /** the slot that made the most noise this frame, or -1 */
  loudest(): number {
    let best = -1, v = 0;
    for (const p of this.game.players) if (p.alive && this.heard[p.slot] > v) { v = this.heard[p.slot]; best = p.slot; }
    return best;
  }

  /** empty one meter (or all of them), re-arming its thresholds */
  reset(slot?: number): void {
    for (let s = 0; s < this.meters.length; s++) {
      if (slot !== undefined && s !== slot) continue;
      this.meters[s] = 0;
      const w = this.watch[s];
      if (w) w.armed = this.thresholds.map(() => true);
    }
  }

  /** is `pos` inside a mask that is blowing right now? */
  masked(pos: THREE.Vector3): boolean {
    for (const m of this.masks) if (m.on && m.center.distanceToSquared(pos) < m.radius * m.radius) return true;
    return false;
  }

  /**
   * Add noise to player `slot`: the gate and any mask they stand in apply.
   * Sections call this for their own sounds; the common ones are read off the
   * player in `update`.
   */
  noise(slot: number, amount: number): void {
    const p = this.game.players[slot];
    if (!p || !p.alive || !this.enabled || amount <= 0) return;
    if (this.masked(p.position)) return;
    const g = this.opts.noiseGate ? this.opts.noiseGate(p) : 1;
    if (g <= 0) return;
    this.heard[slot] += amount * g;
    this.feed(slot, amount * g);
  }

  /**
   * The cone that would see a body standing at `pos` right now (geometry and
   * line of sight, no throttling), or null. For HUD warnings and autopilots:
   * "is the next step lit?"
   */
  coneAt(pos: THREE.Vector3): LightCone | null {
    _chest.set(pos.x, pos.y + 1.2, pos.z);
    for (const c of this.cones) {
      if (c.exposure(_chest) <= 0) continue;
      if (this.clearLine(c.origin, _chest)) return c;
    }
    return null;
  }

  /** how lit a ground column is: 1 in a cone's pool, else 0 (for `board.lightAt`) */
  lightAtGround(x: number, y: number, z: number): number {
    _chest.set(x, y + 1.2, z);
    for (const c of this.cones) if (c.exposure(_chest) > 0) return 1;
    return 0;
  }

  update(dt: number): void {
    const game = this.game;
    for (let s = 0; s < 4; s++) { this.heard[s] = 0; this.litBy[s] = null; }
    for (const [k, v] of this.los) { v.age += dt; if (v.age > 0.6) this.los.delete(k); }

    for (const p of game.players) {
      const s = p.slot;
      const w = this.watch[s] ??= {
        fireCd: p.fireCd, grounded: p.grounded, vy: p.velocity.y, quiet: 0,
        armed: this.thresholds.map(() => true),
      };
      if (w.armed.length !== this.thresholds.length) w.armed = this.thresholds.map(() => true);
      if (!p.alive) {
        this.meters[s] = 0;
        w.fireCd = 0; w.grounded = true; w.vy = 0; w.quiet = 0;
        w.armed = this.thresholds.map(() => true);
        continue;
      }
      if (this.enabled) {
        // ---- noise, read off the body ----
        const r = this.rates;
        if (p.fireCd > w.fireCd + 0.02) this.noise(s, r.fire);
        const flat = Math.hypot(p.velocity.x, p.velocity.z);
        if (p.thrusting > 0 && !p.grounded) this.noise(s, r.jet * dt);
        else if (p.grounded && flat > 3) this.noise(s, (p.sprinting ? r.sprint : r.walk) * dt);
        if (p.grounded && !w.grounded) {
          const impact = -w.vy;
          if (p.slamming || impact > 12) this.noise(s, r.hardLand);
          else if (impact > 4) this.noise(s, r.land);
        }
        // ---- light ----
        const lg = this.opts.lightGate ? this.opts.lightGate(p) : 1;
        _chest.set(p.position.x, p.position.y + 1.2, p.position.z);
        if (lg > 0) {
          this.cones.forEach((c, ci) => {
            const ex = c.exposure(_chest);
            if (ex <= 0) return;
            if (!this.throttledLine(ci, s, c.origin, _chest)) return;
            this.litBy[s] = c;
            this.feed(s, c.rate * ex * lg * dt);
          });
        }
      }
      w.fireCd = p.fireCd;
      w.grounded = p.grounded;
      w.vy = p.velocity.y;

      // ---- decay ----
      if (this.enabled) {
        w.quiet += dt;
        if (this.heard[s] > 0 || this.litBy[s]) w.quiet = 0;
        if (w.quiet > this.hold) this.meters[s] = Math.max(0, this.meters[s] - this.decay * dt);
      }

      // ---- thresholds ----
      this.thresholds.forEach((t, i) => {
        if (w.armed[i] && this.meters[s] >= t.at) {
          w.armed[i] = false;
          t.onCross(s);
        } else if (!w.armed[i] && this.meters[s] < t.at * 0.5) {
          w.armed[i] = true;
          t.onClear?.(s);
        }
      });
    }
  }

  private feed(slot: number, amount: number): void {
    this.meters[slot] = Math.min(1, this.meters[slot] + amount);
    const w = this.watch[slot];
    if (w) w.quiet = 0;
  }

  /**
   * A clear line from `a` to `b`: no solid in the way and no mask blowing
   * across it. The first metre is skipped — a lamp sits on its own mast, a
   * sensor on its own post, and neither blinds itself.
   */
  clearLine(a: THREE.Vector3, b: THREE.Vector3): boolean {
    _to.subVectors(b, a);
    const len = _to.length();
    if (len < 1e-3) return true;
    _to.multiplyScalar(1 / len);
    const skip = Math.min(1, len * 0.5);
    _from.copy(a).addScaledVector(_to, skip);
    const hit = this.game.board.physics.raycastSolids(_from, _to, len - skip);
    if (hit && hit.dist < len - skip - 0.6) return false;
    for (const m of this.masks) {
      if (!m.on) continue;
      // distance from the mask's centre to the segment
      const t = Math.max(0, Math.min(len, (m.center.x - a.x) * _to.x + (m.center.y - a.y) * _to.y + (m.center.z - a.z) * _to.z));
      const cx = a.x + _to.x * t - m.center.x, cy = a.y + _to.y * t - m.center.y, cz = a.z + _to.z * t - m.center.z;
      if (cx * cx + cy * cy + cz * cz < m.radius * m.radius) return false;
    }
    return true;
  }

  /** `clearLine`, asked at most every 0.12 s per cone and player */
  private throttledLine(ci: number, slot: number, a: THREE.Vector3, b: THREE.Vector3): boolean {
    const key = ci * 4 + slot;
    const memo = this.los.get(key);
    if (memo && memo.age < 0.12) return memo.clear;
    const clear = this.clearLine(a, b);
    this.los.set(key, { clear, age: 0 });
    return clear;
  }
}

/**
 * The silent takedown: a melee hit on a hostile that has not clocked you,
 * from behind, kills in one blow and makes no noise.
 *
 * "Has not clocked you" is the enemy's own awareness (`idle` or `alerted` —
 * posted, or poking round a noise), with a moment's grace for one that has
 * only just turned: a guard who notices you as the blade is already coming
 * is still taken. "From behind" is outside the front 110° of its facing.
 *
 * Route the player's melee through `meleeHit` (a `SectionMove` hook), and
 * call `update` every frame so the grace clock knows who turned when.
 */
export class Takedowns {
  /** when each enemy was last seen go from calm to engaged, by game time */
  private turned = new WeakMap<Enemy, number>();
  private calm = new WeakMap<Enemy, boolean>();
  /** the way each enemy faced the last time it was calm: a guard who turns as the blow comes was still caught from behind */
  private calmYaw = new WeakMap<Enemy, number>();
  /** how many have been taken, for HUD lines and tests */
  count = 0;
  /** called with each one taken */
  onTakedown: ((e: Enemy, bySlot: number) => void) | null = null;

  constructor(private game: Game, private opts: { grace?: number; arc?: number } = {}) {}

  update(): void {
    const t = this.game.time;
    for (const e of this.game.enemies) {
      if (!e.alive || e.team !== 1) continue;
      const calm = e.awareness !== 'engaged';
      if (this.calm.get(e) === true && !calm) this.turned.set(e, t);
      this.calm.set(e, calm);
      if (calm) this.calmYaw.set(e, e.yaw);
    }
  }

  /** would a melee hit from `from` on `e` right now be a takedown? */
  eligible(e: Enemy, from: THREE.Vector3): boolean {
    if (!e.alive || e.team !== 1 || e.boss) return false;
    const grace = this.opts.grace ?? 0.6;
    const since = this.turned.has(e) ? this.game.time - this.turned.get(e)! : Infinity;
    const calmNow = e.awareness !== 'engaged';
    if (!calmNow && since >= grace) return false;
    const yaw = calmNow ? e.yaw : (this.calmYaw.get(e) ?? e.yaw);
    const dx = from.x - e.position.x, dz = from.z - e.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const facing = (dx / d) * Math.sin(yaw) + (dz / d) * Math.cos(yaw);
    // cos of half the front arc: in front of that is "seen coming"
    return facing < Math.cos((this.opts.arc ?? (110 * Math.PI / 180)) / 2);
  }

  /** a `SectionMove.meleeHit`: a takedown's blow is the whole of its health */
  meleeHit = (p: Player, target: Combatant, amount: number): number => {
    // only a hostile with awareness can be caught unaware — not a rival player
    if (!('awareness' in target)) return amount;
    const e = target as Enemy;
    if (!this.eligible(e, p.position)) return amount;
    this.count++;
    this.onTakedown?.(e, p.slot);
    return Math.max(amount, e.hp + 1);
  };
}
