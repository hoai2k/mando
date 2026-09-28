import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Enemy } from '../../enemies/enemy';
import type { SectionBar } from '../api';

/**
 * K5 — the objective with a bar (docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * Two pieces, used together or apart:
 *
 * - `DefendTarget`: an ally the hostiles want more than they want you. It
 *   carries a **target weight** (a hostile picking its foe reads the ally as
 *   `weight` times nearer than it is — the hook in `Enemy.nearestFoe`), is
 *   held on a leash round its post, knows how many hostiles are crowding it,
 *   and when it falls it re-forms at its post after a wait instead of ending
 *   anything. The Armorer at her forge; the frigate's hull could be one too.
 * - `Progress`: a value that climbs 0 → 1 on a clock, stalls when told to,
 *   runs slower when told to, and remembers its **quarter marks** so a
 *   setback drops it to the last mark reached rather than to zero.
 *
 * Both give a `SectionBar` for `SectionInstance.hud`.
 */

/** the fields of a defended body this kit reads and writes */
export interface Defended {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  alive: boolean;
  hp: number;
  maxHp: number;
  team: number;
  /** read by `Enemy.nearestFoe`: >1 makes hostiles prefer this body */
  targetWeight?: number;
  removeMe?: boolean;
}

export interface DefendSpec<T extends Defended> {
  /** make (or re-make) the body at `post`; the section adds it to the match */
  make: (post: THREE.Vector3) => T;
  post: THREE.Vector3;
  /** how far from the post the body may go, metres (it is held inside) */
  leash: number;
  /** hostiles pick it as if it were this many times nearer (default 2.4) */
  weight?: number;
  /** seconds from falling to standing again at the post (default 10) */
  reform?: number;
  /** health a second while no hostile is within `threat` (default 0) */
  regen?: number;
  /** a hostile this close counts as on top of it (default 6) */
  threat?: number;
  onDown?: () => void;
  onUp?: () => void;
}

export class DefendTarget<T extends Defended = Defended> {
  body: T;
  /** seconds until a fallen body re-forms; 0 while it stands */
  downT = 0;
  /** hostiles inside the threat radius this frame */
  crowd = 0;
  private wasAlive = true;

  constructor(private game: Game, readonly spec: DefendSpec<T>) {
    this.body = spec.make(spec.post.clone());
    this.body.targetWeight = spec.weight ?? 2.4;
  }

  get down(): boolean { return this.downT > 0 || !this.body.alive; }
  get threat(): number { return this.spec.threat ?? 6; }
  /** health, 0..1 (0 while down) */
  get health(): number { return this.down ? 0 : Math.max(0, this.body.hp / this.body.maxHp); }

  update(dt: number): void {
    const b = this.body;
    if (this.wasAlive && !b.alive) {
      this.wasAlive = false;
      this.downT = this.spec.reform ?? 10;
      this.spec.onDown?.();
    }
    if (!b.alive) {
      this.downT -= dt;
      if (this.downT <= 0) {
        this.downT = 0;
        b.removeMe = true;
        this.body = this.spec.make(this.spec.post.clone());
        this.body.targetWeight = this.spec.weight ?? 2.4;
        this.wasAlive = true;
        this.spec.onUp?.();
      }
      this.crowd = 0;
      return;
    }
    // the leash: the body is held inside its circle, whatever its AI wants
    const post = this.spec.post;
    const dx = b.position.x - post.x, dz = b.position.z - post.z;
    const d = Math.hypot(dx, dz);
    if (d > this.spec.leash) {
      const k = this.spec.leash / d;
      b.position.x = post.x + dx * k;
      b.position.z = post.z + dz * k;
      const out = (b.velocity.x * dx + b.velocity.z * dz) / d;
      if (out > 0) { b.velocity.x -= (dx / d) * out; b.velocity.z -= (dz / d) * out; }
    }
    this.crowd = this.hostilesWithin(this.threat);
    if (!this.crowd && this.spec.regen) b.hp = Math.min(b.maxHp, b.hp + this.spec.regen * dt);
  }

  /** how many living hostiles stand within `r` metres of the body (same level) */
  hostilesWithin(r: number): number {
    if (this.down) return 0;
    let n = 0;
    const p = this.body.position;
    for (const e of this.game.enemies) {
      if (!e.alive || e.team === this.body.team) continue;
      if (Math.abs(e.position.y - p.y) > 4) continue;
      if (Math.hypot(e.position.x - p.x, e.position.z - p.z) < r) n++;
    }
    return n;
  }

  bar(label: string, downLabel?: string): SectionBar {
    const h = this.health;
    return {
      label: this.down && downLabel ? downLabel : label,
      value: this.down ? 1 - this.downT / (this.spec.reform ?? 10) : h,
      tone: this.down ? 'info' : h < 0.3 ? 'danger' : h < 0.6 ? 'warn' : 'good',
    };
  }
}

export class Progress {
  /** 0..1 */
  value = 0;
  /** stalled this frame (the last `update` was told to stall) */
  stalled = false;
  /** the rate multiplier the last `update` ran at */
  scale = 1;

  /**
   * @param seconds  time from 0 to 1 at full speed
   * @param marks    the checkpoints a setback falls back to (default quarters)
   */
  constructor(public seconds: number, readonly marks: number[] = [0.25, 0.5, 0.75]) {}

  get done(): boolean { return this.value >= 1; }
  /** the highest mark reached (0 before the first) */
  get lastMark(): number {
    let m = 0;
    for (const k of this.marks) if (this.value >= k) m = k;
    return m;
  }

  /**
   * Advance. `stall` holds it still; `scale` multiplies the rate (0.5 runs at
   * half speed); `cap` stops it short of a value until something else lets
   * it past. Returns the mark crossed this frame, if one was.
   */
  update(dt: number, opts: { stall?: boolean; scale?: number; cap?: number } = {}): number | null {
    this.stalled = !!opts.stall;
    this.scale = opts.scale ?? 1;
    if (this.stalled || this.done) return null;
    const before = this.value;
    this.value = Math.min(opts.cap ?? 1, 1, this.value + (dt / this.seconds) * this.scale);
    for (const k of [...this.marks, 1]) if (before < k && this.value >= k) return k;
    return null;
  }

  /** a setback: back to the last mark reached */
  setBack(): void { this.value = this.lastMark; }

  /** `label` gets the percentage appended; keep it a word or two, the bar is narrow */
  bar(label: string): SectionBar {
    return {
      label: `${label} ${Math.floor(this.value * 100)}%`,
      value: this.value,
      tone: this.stalled ? 'danger' : this.scale < 1 ? 'warn' : 'good',
    };
  }
}

/** true when `e` is a living hostile to team 0 */
export function hostile(e: Enemy): boolean { return e.alive && e.team !== 0; }
