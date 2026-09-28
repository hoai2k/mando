import * as THREE from 'three';
import type { Board } from '../../world/board';
import { Mover } from '../../world/board';
import type { StaticBox } from '../../core/physics';

/**
 * K2 — the treadmill arena (docs/LEVEL_SECTIONS.md §1 K2,
 * docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * Every "fight on a moving thing" beat is built the same way: **the thing
 * does not move.** The lift's platform, the barge's deck, the frigate's hull
 * and the tram's roof are static colliders, and every body on them uses the
 * ordinary rules. What moves is the *world*: the shaft wall, the dunes, the
 * starfield, the city, scrolled past in the opposite direction.
 *
 * The treadmill is the one clock all of that runs off:
 *
 * - `speed` is how fast the world is going by, metres a second, along `dir`
 *   (the direction the world moves: down a shaft for a rising lift, astern
 *   for a barge under way). Changes are **eased** — a stop is a two-second
 *   deceleration, never a cut — so a section says `stop()` and `go()` and the
 *   motion reads as a machine, not a pause button.
 * - `strip(...)` — a ground or wall surface whose texture slides by. A
 *   uniform surface is a static collider with a moving picture on it.
 * - `conveyor(...)` — a thing that travels with the world (a landing, a
 *   dune, a gantry) and is **recycled ahead** once it has gone by behind, or
 *   retired if it only passes once. Give it colliders and they become a
 *   `Mover`, so whoever stands on a landing as it slides by is carried with it.
 * - `parallax(...)` — a far layer (a skyline, a ridge) at a fraction of the
 *   speed, recycled on its own loop.
 * - `spawnAhead(dist)` — a point `dist` metres upstream that the scroll
 *   carries in: where an enemy skiff, a station platform or the top of the
 *   shaft should be placed so it *arrives*.
 * - `travelled` — the odometer: how far the platform has "gone". Sections
 *   hang their beats on it (a landing every 25 m, a stop at 60 m).
 *
 * Positions are measured as `s`, metres along `dir` from where a thing was
 * registered: it sits at `base + dir·s`. "Ahead" (upstream, where things come
 * from) is negative `s`; "behind" (downstream, where they go) is positive.
 */

export interface TreadmillOpts {
  /** the direction the world moves past the platform (normalised for you) */
  dir: THREE.Vector3;
  /** metres a second to start at (default 0: standing) */
  speed?: number;
  /** seconds a speed change takes by default (default 2 — the stop the design asks for) */
  ease?: number;
  /** the board, if any conveyor item has colliders (its movers are registered there) */
  board?: Board;
}

export interface ConveyorOpts {
  /** past this `s` (metres downstream of where it was added) it has gone by */
  behind: number;
  /**
   * Recycle: once gone by, jump back upstream by this many metres and come
   * round again. Leave it out for a thing that passes once and is retired.
   */
  loop?: number;
  /** multiple of the treadmill's speed it travels at (parallax layers < 1; default 1) */
  factor?: number;
  /**
   * Colliders that travel with it. They are wrapped in one `Mover` (the first
   * box is the envelope, the rest are carried rigidly) and registered on the
   * board, so bodies standing on them are carried.
   */
  boxes?: StaticBox[];
  /** called each time it is recycled upstream (refresh its dressing, re-post its squad) */
  onRecycle?(item: ConveyorItem): void;
  /** called once when a non-looping item has gone by, just before it is retired */
  onPass?(item: ConveyorItem): void;
}

export interface ConveyorItem {
  obj: THREE.Object3D | null;
  /** metres along `dir` from where it was added */
  s: number;
  /** where it was added (s = 0) */
  readonly base: THREE.Vector3;
  /** its world position now */
  readonly pos: THREE.Vector3;
  readonly mover: Mover | null;
  /** how many times it has come round */
  laps: number;
  retired: boolean;
  opts: ConveyorOpts;
  /** set `s` directly (a section placing it for a stop); colliders jump without carrying anyone */
  place(s: number): void;
}

/** a point upstream that the scroll carries in (`spawnAhead`) */
export interface Carried {
  readonly pos: THREE.Vector3;
  /** metres still to come before it reaches the spot it was aimed at (≤ 0 once there) */
  readonly remaining: number;
  /** seconds until it arrives at the current speed (Infinity while stopped) */
  readonly eta: number;
  retire(): void;
}

interface Strip {
  tex: () => THREE.Texture | null | undefined;
  metresPerRepeat: number;
  axis: 'x' | 'y';
  sign: number;
  factor: number;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

export class Treadmill {
  readonly dir: THREE.Vector3;
  /** metres a second the world is going by right now */
  speed: number;
  /** the odometer: metres of world that have gone by */
  travelled = 0;
  readonly ease: number;

  private from: number;
  private to: number;
  private easeT = 0;
  private easeDur = 0;
  private strips: Strip[] = [];
  private items: ConveyorItem[] = [];
  private points: { base: THREE.Vector3; s: number; pos: THREE.Vector3; aim: number; retired: boolean }[] = [];
  private board: Board | null;
  private movers: Mover[] = [];
  private stopTarget: number | null = null;

  constructor(opts: TreadmillOpts) {
    this.dir = opts.dir.clone().normalize();
    this.speed = opts.speed ?? 0;
    this.from = this.to = this.speed;
    this.ease = opts.ease ?? 2;
    this.board = opts.board ?? null;
  }

  /** where the speed is heading (the speed itself may still be easing there) */
  get target(): number { return this.to; }
  /** easing between speeds right now */
  get easing(): boolean { return this.easeT < this.easeDur; }
  /** standing, and not about to move */
  get stopped(): boolean { return this.speed === 0 && this.to === 0; }

  /** change speed to `v` over `secs` (default: the treadmill's `ease`), on an S-curve */
  setSpeed(v: number, secs = this.ease): void {
    if (v !== 0) this.stopTarget = null;
    this.from = this.speed;
    this.to = v;
    this.easeT = 0;
    this.easeDur = Math.max(0, secs);
    if (this.easeDur === 0) this.speed = v;
  }

  /** ease to a stop (the design's two-second deceleration) */
  stop(secs = this.ease): void { this.stopTarget = null; this.setSpeed(0, secs); }

  /**
   * Come to rest with the odometer reading exactly `odometer`: a landing
   * level with the platform, a station platform alongside the tram. The
   * deceleration starts when there is just room for an eased stop at the
   * current speed (it is shortened if there is less), and the last few
   * centimetres of integration error are taken up when it stops.
   */
  stopAt(odometer: number): void { this.stopTarget = odometer; }

  /** where a pending `stopAt` will leave the odometer, or null */
  get stoppingAt(): number | null { return this.stopTarget; }

  /**
   * A surface whose picture slides with the world: a wall of panels, a strip
   * of dunes. `tex` is read every frame, so it may be a texture that has not
   * landed yet (`() => mat.map`). `metresPerRepeat` is how many metres of
   * world one repeat of the texture covers along the scroll; `axis` is which
   * texture axis runs that way (`y` for a wall scrolling down, with `sign`
   * saying which way along it).
   */
  strip(tex: THREE.Texture | (() => THREE.Texture | null | undefined), opts: {
    metresPerRepeat: number; axis?: 'x' | 'y'; sign?: number; factor?: number;
  }): void {
    this.strips.push({
      tex: typeof tex === 'function' ? tex : () => tex,
      metresPerRepeat: opts.metresPerRepeat,
      axis: opts.axis ?? 'y',
      sign: opts.sign ?? 1,
      factor: opts.factor ?? 1,
    });
  }

  /** a thing that travels with the world; see `ConveyorOpts` */
  conveyor(obj: THREE.Object3D | null, opts: ConveyorOpts): ConveyorItem {
    const base = obj ? obj.position.clone() : new THREE.Vector3();
    let mover: Mover | null = null;
    if (opts.boxes?.length) {
      mover = new Mover(opts.boxes[0], null);
      if (opts.boxes.length > 1) mover.carry(opts.boxes.slice(1));
      this.movers.push(mover);
      if (this.board) (this.board.movers ??= []).push(mover);
    }
    const centre0 = mover ? mover.box.min.clone().add(mover.box.max).multiplyScalar(0.5) : null;
    const pos = base.clone();
    const item: ConveyorItem = {
      obj, s: 0, base, pos, mover, laps: 0, retired: false, opts,
      place: (s: number) => {
        item.s = s;
        this.apply(item, centre0, true);
      },
    };
    (item as ConveyorItem & { centre0: THREE.Vector3 | null }).centre0 = centre0;
    this.items.push(item);
    return item;
  }

  /** a far layer at `factor` of the speed, recycled every `loop` metres */
  parallax(obj: THREE.Object3D, factor: number, loop: number, behind = loop / 2): ConveyorItem {
    return this.conveyor(obj, { behind, loop, factor });
  }

  /**
   * A point `dist` metres upstream of `at` that the scroll carries in: place
   * whatever should *arrive* (a skiff, a squad's landing, the shaft's top)
   * there, and read `pos` each frame. `remaining` counts down to zero as it
   * reaches `at`, and it keeps travelling past.
   */
  spawnAhead(dist: number, at = new THREE.Vector3()): Carried {
    const base = at.clone().addScaledVector(this.dir, -dist);
    const pt = { base, s: 0, pos: base.clone(), aim: dist, retired: false };
    this.points.push(pt);
    const self = this;
    return {
      get pos() { return pt.pos; },
      get remaining() { return pt.aim - pt.s; },
      get eta() { return self.speed > 1e-6 ? (pt.aim - pt.s) / self.speed : Infinity; },
      retire() { pt.retired = true; },
    };
  }

  /** move everything by one frame of the world going by */
  update(dt: number): void {
    if (this.easeT < this.easeDur) {
      this.easeT = Math.min(this.easeDur, this.easeT + dt);
      this.speed = this.from + (this.to - this.from) * smooth(this.easeT / this.easeDur);
    }
    if (this.stopTarget !== null && this.to !== 0) {
      const left = this.stopTarget - this.travelled;
      // an S-curve from v to 0 over T covers v·T/2
      if (this.speed > 1e-6 && left <= (this.speed * this.ease) / 2) {
        const v = this.speed;
        this.setSpeed(0, Math.max(0.05, (2 * Math.max(0, left)) / v));
      }
    }
    let step = this.speed * dt;
    if (this.stopTarget !== null && this.to === 0) {
      // never run past the mark; on the last frame, land on it
      const left = this.stopTarget - this.travelled;
      if (step > left || !this.easing) step = Math.max(0, left);
      if (!this.easing) { this.speed = 0; this.stopTarget = null; }
    }
    this.travelled += step;

    for (const st of this.strips) {
      const tex = st.tex();
      if (!tex) continue;
      const d = (step * st.factor * st.sign) / st.metresPerRepeat;
      if (st.axis === 'y') tex.offset.y = (tex.offset.y + d) % 1;
      else tex.offset.x = (tex.offset.x + d) % 1;
    }

    for (const it of this.items) {
      if (it.retired) continue;
      it.s += step * (it.opts.factor ?? 1);
      let jumped = false;
      if (it.s > it.opts.behind) {
        if (it.opts.loop) {
          while (it.s > it.opts.behind) it.s -= it.opts.loop;
          it.laps++;
          jumped = true;
        } else {
          it.opts.onPass?.(it);
          this.retire(it);
          continue;
        }
      }
      this.apply(it, (it as ConveyorItem & { centre0: THREE.Vector3 | null }).centre0, jumped);
      if (jumped) it.opts.onRecycle?.(it);
    }
    // a retired item stops being ticked; keep the list short
    if (this.items.some((i) => i.retired)) this.items = this.items.filter((i) => !i.retired);

    for (const p of this.points) {
      if (p.retired) continue;
      p.s += step;
      p.pos.copy(p.base).addScaledVector(this.dir, p.s);
    }
    if (this.points.some((p) => p.retired)) this.points = this.points.filter((p) => !p.retired);
  }

  /** stop ticking an item and take its colliders out of the carry */
  retire(it: ConveyorItem): void {
    it.retired = true;
    if (it.mover) {
      it.mover.delta.set(0, 0, 0);
      this.movers = this.movers.filter((m) => m !== it.mover);
      if (this.board?.movers) this.board.movers = this.board.movers.filter((m) => m !== it.mover);
    }
  }

  /** every item still travelling */
  get conveyed(): readonly ConveyorItem[] { return this.items; }

  /** take the movers off the board (the section's colliders go with its context) */
  dispose(): void {
    for (const it of this.items) this.retire(it);
    this.items = [];
    this.points = [];
    this.strips = [];
  }

  private apply(it: ConveyorItem, centre0: THREE.Vector3 | null, jumped: boolean): void {
    (it.pos as THREE.Vector3).copy(it.base).addScaledVector(this.dir, it.s);
    if (it.obj) it.obj.position.copy(it.pos);
    if (it.mover && centre0) {
      const c = centre0.clone().addScaledVector(this.dir, it.s);
      it.mover.moveTo(c.x, c.y, c.z);
      // A recycle is a jump of a whole loop, not a frame of travel: nobody
      // standing on it may be carried the length of the shaft with it.
      if (jumped) it.mover.delta.set(0, 0, 0);
    }
  }
}

// the kit's own suite builds one in the page (tools/test-section-treadmill.mjs)
(globalThis as unknown as { __kitTreadmill: unknown }).__kitTreadmill = { Treadmill };
