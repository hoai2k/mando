import * as THREE from 'three';
import type { Enemy } from '../../enemies/enemy';
import type { Game } from '../../game/game';

/**
 * K8 — the pursuit target (docs/SECTIONS_IMPLEMENTATION.md §3, LEVEL_SECTIONS §2.16).
 *
 * A `Runner` is a hostile on a route of its own: a graph of points he runs
 * between, some legs of which are jetpack leaps over a gap, some nodes of
 * which are forks. He is not steered by the AI — `Enemy.scripted` hands him
 * to this — so he goes exactly where the level says, at exactly the speed the
 * chase wants, and the level can promise the player a fair race.
 *
 * **The speed curve is the chase.** He reads the gap to the nearest living
 * hunter every frame: close in and he sprints (on a stamina bar, so a burst
 * can be outlasted); a comfortable lead and he runs; a long one and he jogs,
 * and now and then stops to catch his breath and look back. So the gap is
 * always *about* to close or open — tight whoever is chasing — and the only
 * way to lose him is to stop chasing: once he is more than `escape.dist`
 * ahead for `escape.secs` he is gone, and the section decides what that costs.
 *
 * **Hits change his run, not his health.** A hit staggers him (he stops and
 * stumbles, which is his lead dropping by his speed times the stagger), with
 * a short immunity after so four hunters cannot hold him still. A net snares
 * him for longer. A hit in mid-leap staggers him when he lands. What else a
 * hit costs — bounty value, say — is the section's (`onHit`).
 *
 * **Forks are chosen, not rolled.** Arriving at a node with more than one way
 * on, he counts the hunters nearest each way and takes the one with fewest;
 * a tie goes to the way whose nearest hunter is farthest. Spreading out is
 * how a party keeps someone on his line.
 */

export interface RunNode {
  /** where his feet are at this node */
  at: THREE.Vector3;
  /** the node ids he can run on to; more than one is a fork, none is the end */
  next: number[];
  /** getting *to* this node is a jetpack leap over a gap */
  leap?: boolean;
  /** passed to `onNode` when he reaches it: a trick, a call to his pirates */
  tag?: string;
}

export interface RunnerOpts {
  /** m/s: flat out (stamina), running, jogging with a lead */
  sprint: number;
  run: number;
  jog: number;
  /** below this gap he sprints; above `far` he jogs and may stop to breathe */
  close: number;
  far: number;
  /** seconds of sprint in a full tank, and the tank refilled per second */
  stamina: number;
  staminaRegen: number;
  /** a leap's speed along its chord, m/s, and the arc's lift over the higher end */
  leapSpeed: number;
  leapLift: number;
  /** he gets away past `dist` metres ahead of every hunter for `secs` seconds */
  escape: { dist: number; secs: number };
  /** a stagger stops him this long; then he cannot be staggered for `staggerGuard` */
  stagger: number;
  staggerGuard: number;
  /** a stop to catch his breath: how long, and how long before the next */
  breather: number;
  breatherCd: number;
  /** a snap shot over the shoulder at the nearest hunter within `shotRange` */
  shotEvery?: number;
  shotRange?: number;
  shotDamage?: number;
  /** living hunters' positions (a fresh array each call is fine) */
  hunters: () => THREE.Vector3[];
  /** he reached a node */
  onNode?: (id: number, node: RunNode) => void;
  /** he chose a way on at a fork */
  onFork?: (from: number, to: number) => void;
  /** he has been out of reach long enough */
  onEscape?: () => void;
  /** he reached a node with no way on */
  onEnd?: (id: number) => void;
}

export type RunnerState = 'hold' | 'run' | 'leap' | 'stagger' | 'snared' | 'breather' | 'done';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Runner {
  state: RunnerState = 'hold';
  /** the node he last reached, and the one he is heading for */
  from = 0;
  to = 0;
  /** metres along the leg from `from` to `to` (a leap: seconds into it) */
  s = 0;
  /** horizontal metres to the nearest living hunter (Infinity with none) */
  gap = Infinity;
  /** seconds he has been past the escape distance (decays when you close) */
  escapeT = 0;
  /** 0..1 */
  stamina = 1;
  /** his speed along the route this frame, m/s */
  speed = 0;
  /** true while the sprint is on */
  sprinting = false;
  private stateT = 0;
  private guardT = 0;
  private breatherCdT = 0;
  private shotT = 0;
  /** a hit landed mid-leap: stagger on touchdown */
  private pendingStagger = false;
  private leapDur = 1;
  private escaped = false;
  private jetOrigin = new THREE.Vector3();
  private down = new THREE.Vector3(0, -1, 0);

  constructor(readonly body: Enemy, readonly nodes: RunNode[], readonly opts: RunnerOpts, private game: Game) {
    body.scripted = { ...(body.scripted ?? {}), drive: (_e, dt) => this.drive(dt) };
    this.placeAt(0);
  }

  /** the leg he is on, as positions */
  get legFrom(): THREE.Vector3 { return this.nodes[this.from].at; }
  get legTo(): THREE.Vector3 { return this.nodes[this.to].at; }
  /** 0..1 how far the escape clock has run */
  get escapeLevel(): number { return Math.min(1, this.escapeT / this.opts.escape.secs); }
  get airborne(): boolean { return this.state === 'leap'; }
  /** seconds of stagger/snare/breather left */
  get stateLeft(): number { return this.stateT; }

  /** stand him on node `id`, facing on, held until `go()` */
  placeAt(id: number, hold = true): void {
    this.from = id;
    this.to = id;
    this.s = 0;
    this.state = hold ? 'hold' : 'run';
    this.escapeT = 0;
    this.escaped = false;
    this.pendingStagger = false;
    this.stateT = 0;
    this.stamina = 1;
    this.body.position.copy(this.nodes[id].at);
    this.body.velocity.set(0, 0, 0);
    if (!hold) this.pickNext();
  }

  /** start (or restart) the run from wherever he stands */
  go(): void {
    if (this.state !== 'hold') return;
    this.state = 'run';
    this.escaped = false;
    this.pickNext();
  }

  /** stop him where he is (a wipe, a cut-scene beat) */
  hold(): void { if (this.state !== 'done') { this.state = 'hold'; this.stateT = 0; } }

  /**
   * A hit landed. `kind` 'net' snares for `secs`; anything else staggers
   * (unless he is guarded from the last one). Returns true if it stopped him.
   */
  hit(kind: 'bolt' | 'melee' | 'net', secs?: number): boolean {
    if (this.state === 'done' || this.state === 'hold') return false;
    if (kind === 'net') {
      if (this.state === 'leap') { this.pendingStagger = true; return true; }
      this.state = 'snared';
      this.stateT = Math.max(this.stateT, secs ?? this.opts.stagger * 2);
      this.body.velocity.set(0, 0, 0);
      return true;
    }
    if (this.guardT > 0 || this.state === 'snared' || this.state === 'stagger') return false;
    if (this.state === 'leap') { this.pendingStagger = true; return true; }
    this.startStagger(kind === 'melee' ? this.opts.stagger * 1.3 : this.opts.stagger);
    return true;
  }

  private startStagger(secs: number): void {
    this.state = 'stagger';
    this.stateT = secs;
    // a stumble: a step back off the line he was running
    const d = _v.copy(this.legTo).sub(this.legFrom).setY(0);
    if (d.lengthSq() > 1e-4) d.normalize().multiplyScalar(-1.6);
    this.body.velocity.set(d.x, 0, d.z);
  }

  /** at a node: choose where to go next (a fork looks at the hunters) */
  private pickNext(): void {
    const node = this.nodes[this.from];
    if (!node.next.length) {
      this.state = 'done';
      this.opts.onEnd?.(this.from);
      return;
    }
    let pick = node.next[0];
    if (node.next.length > 1) {
      const hunters = this.opts.hunters();
      let best = Infinity;
      let bestFar = -1;
      for (const n of node.next) {
        const at = this.nodes[n].at;
        // hunters for whom this way is the nearest one
        let count = 0;
        let nearest = Infinity;
        for (const h of hunters) {
          const d = Math.hypot(h.x - at.x, h.z - at.z);
          nearest = Math.min(nearest, d);
          let mine = true;
          for (const m of node.next) {
            if (m === n) continue;
            const o = this.nodes[m].at;
            if (Math.hypot(h.x - o.x, h.z - o.z) < d) { mine = false; break; }
          }
          if (mine) count++;
        }
        if (count < best || (count === best && nearest > bestFar)) {
          best = count;
          bestFar = nearest;
          pick = n;
        }
      }
      this.opts.onFork?.(this.from, pick);
    }
    this.to = pick;
    this.s = 0;
    if (this.nodes[pick].leap) {
      this.state = 'leap';
      const len = this.nodes[this.from].at.distanceTo(this.nodes[pick].at);
      this.leapDur = Math.max(0.8, len / this.opts.leapSpeed);
      this.jetOrigin.copy(this.body.position);
      this.game.particles.jetIgnite(this.jetOrigin.setY(this.body.position.y + 1.1), this.down, 1.2);
    } else if (this.state !== 'stagger' && this.state !== 'snared') this.state = 'run';
  }

  /** the gap and the escape clock; call every frame (the drive does) */
  private measure(dt: number): void {
    const hunters = this.opts.hunters();
    let g = Infinity;
    const p = this.body.position;
    for (const h of hunters) g = Math.min(g, Math.hypot(h.x - p.x, h.z - p.z));
    this.gap = g;
    if (this.state === 'hold' || this.state === 'done' || !hunters.length) return;
    if (g > this.opts.escape.dist) this.escapeT += dt;
    else this.escapeT = Math.max(0, this.escapeT - dt * 2);
    if (this.escapeT >= this.opts.escape.secs && !this.escaped) {
      this.escaped = true;
      this.opts.onEscape?.();
    }
  }

  private groundSpeed(dt: number): number {
    const o = this.opts;
    const g = this.gap;
    let v: number;
    this.sprinting = false;
    if (g < o.close && this.stamina > 0.05) {
      v = o.sprint;
      this.sprinting = true;
      this.stamina = Math.max(0, this.stamina - dt / o.stamina);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * o.staminaRegen);
      // run → jog across the band from `close` to `far`
      const k = THREE.MathUtils.clamp((g - o.close) / Math.max(1, o.far - o.close), 0, 1);
      v = THREE.MathUtils.lerp(o.run, o.jog, k);
    }
    return v;
  }

  /** the enemy's update hands us the frame here */
  private drive(dt: number): 'ground' | 'air' {
    this.measure(dt);
    this.guardT = Math.max(0, this.guardT - dt);
    this.breatherCdT = Math.max(0, this.breatherCdT - dt);
    const e = this.body;
    const hunters = this.opts.hunters();

    switch (this.state) {
      case 'hold':
      case 'done':
        e.velocity.set(0, 0, 0);
        this.speed = 0;
        this.faceNearest(dt, hunters);
        return 'ground';
      case 'stagger':
      case 'snared':
      case 'breather': {
        this.stateT -= dt;
        // the stumble decays; a breather and a snare stand still
        e.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
        e.position.addScaledVector(e.velocity, dt);
        this.speed = 0;
        this.faceNearest(dt, hunters);
        if (this.stateT <= 0) {
          if (this.state === 'stagger' || this.state === 'snared') this.guardT = this.opts.staggerGuard;
          if (this.state === 'breather') this.breatherCdT = this.opts.breatherCd;
          // back onto the line he was on (a stumble can take him a step off it)
          this.state = 'run';
          this.stamina = Math.max(this.stamina, 0.5);
        }
        return 'ground';
      }
      case 'leap': {
        this.s += dt;
        const k = Math.min(1, this.s / this.leapDur);
        const a = this.legFrom, b = this.legTo;
        const lift = this.opts.leapLift + Math.max(0, b.y - a.y) * 0.5 + a.distanceTo(b) * 0.08;
        const x = THREE.MathUtils.lerp(a.x, b.x, k);
        const z = THREE.MathUtils.lerp(a.z, b.z, k);
        const y = THREE.MathUtils.lerp(a.y, b.y, k) + 4 * lift * k * (1 - k);
        e.velocity.set((b.x - a.x) / this.leapDur, 0, (b.z - a.z) / this.leapDur);
        e.velocity.y = (y - e.position.y) / Math.max(dt, 1e-3);
        e.position.set(x, y, z);
        this.speed = a.distanceTo(b) / this.leapDur;
        this.faceAlong(dt, b.x - a.x, b.z - a.z);
        // the pack burns on the way up and hisses on the way down
        this.jetOrigin.set(x - Math.sin(e.facingYaw) * 0.3, y + 1.15, z - Math.cos(e.facingYaw) * 0.3);
        this.game.particles.jetPlume(this.jetOrigin, this.down, dt, { power: k < 0.55 ? 1 : 0.35, scale: 1.1, carrier: e.velocity });
        if (k >= 1) {
          e.velocity.set(0, 0, 0);
          this.arrive();
          if (this.pendingStagger && (this.state as RunnerState) !== 'done') {
            this.pendingStagger = false;
            this.startStagger(this.opts.stagger);
          }
        }
        return 'air';
      }
      case 'run':
      default: {
        // a breather: far enough ahead, on his feet, and not already past the lip
        if (this.gap > this.opts.far && this.breatherCdT <= 0 && this.gap < this.opts.escape.dist
          && !this.nodes[this.to].leap) {
          this.state = 'breather';
          this.stateT = this.opts.breather;
          e.velocity.set(0, 0, 0);
          return 'ground';
        }
        const v = this.groundSpeed(dt);
        const a = this.legFrom, b = this.legTo;
        const len = Math.max(1e-3, a.distanceTo(b));
        // closest point on the leg to where he stands (a stumble may have moved him)
        _w.copy(b).sub(a);
        const along = THREE.MathUtils.clamp(_v.copy(e.position).sub(a).dot(_w) / (len * len), 0, 1);
        this.s = along * len + v * dt;
        const k = Math.min(1, this.s / len);
        const tx = THREE.MathUtils.lerp(a.x, b.x, k), tz = THREE.MathUtils.lerp(a.z, b.z, k);
        const ty = THREE.MathUtils.lerp(a.y, b.y, k);
        e.velocity.set((tx - e.position.x) / Math.max(dt, 1e-3), 0, (tz - e.position.z) / Math.max(dt, 1e-3));
        e.position.set(tx, ty, tz);
        this.speed = v;
        this.faceAlong(dt, b.x - a.x, b.z - a.z);
        this.maybeShoot(dt, hunters);
        if (k >= 1) this.arrive();
        return 'ground';
      }
    }
  }

  private arrive(): void {
    this.from = this.to;
    this.s = 0;
    const node = this.nodes[this.from];
    if (this.state === 'leap') this.state = 'run';
    this.opts.onNode?.(this.from, node);
    if (this.state === 'hold' || this.state === 'done') return;
    this.pickNext();
  }

  private faceAlong(dt: number, dx: number, dz: number): void {
    if (dx * dx + dz * dz < 1e-6) return;
    this.body.faceToward(dt, this.body.position.x + dx, this.body.position.z + dz, 12);
  }

  private faceNearest(dt: number, hunters: THREE.Vector3[]): void {
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const h of hunters) {
      const d = h.distanceToSquared(this.body.position);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) this.body.faceToward(dt, best.x, best.z, 8);
  }

  /** a snap shot over the shoulder, now and then */
  private maybeShoot(dt: number, hunters: THREE.Vector3[]): void {
    const o = this.opts;
    if (!o.shotEvery) return;
    this.shotT -= dt;
    if (this.shotT > 0) return;
    let best: THREE.Vector3 | null = null;
    let bd = o.shotRange ?? 30;
    for (const h of hunters) {
      const d = h.distanceTo(this.body.position);
      if (d < bd && d > 4) { bd = d; best = h; }
    }
    if (!best) return;
    this.shotT = o.shotEvery * (0.8 + Math.random() * 0.4);
    const from = _v.copy(this.body.position);
    from.y += 1.4;
    const dir = _w.set(best.x - from.x, best.y + 1.0 - from.y, best.z - from.z).normalize();
    // over the shoulder on the run: it is a warning more than a shot
    dir.x += (Math.random() - 0.5) * 0.06;
    dir.z += (Math.random() - 0.5) * 0.06;
    this.game.projectiles.fire(from.clone(), dir.clone(), 44, o.shotDamage ?? 6, 1, -1);
    this.game.particles.muzzleFlash(from, dir);
  }
}
