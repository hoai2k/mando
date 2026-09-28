import * as THREE from 'three';
import { Vehicle, type SplineLane, type VehicleOpts } from '../../game/vehicles';
import type { VehicleSpec } from '../../world/board';
import type { Enemy } from '../../enemies/enemy';
import type { SectionContext } from '../context';

/**
 * K3 — mounted weapons (docs/SECTIONS_IMPLEMENTATION.md §3), the section side.
 *
 * The rides themselves carry the weapons, the lane mode, the pillion and the
 * turret (`game/vehicles.ts`, `VehicleOpts`). What a section needs on top is
 * here: a **lane** to guide rides along, and a **ride ledger** that puts rides
 * into the match mid-stage (a fresh bike at a gate, a biker pulling in, a gun
 * on a hull) and takes every one of them back out on teardown.
 */

/** how the lane's heading turns: `turn` radians spread over `span` metres centred on `at` */
export interface LaneBend { at: number; turn: number; span: number }

export interface HeadingLaneOpts {
  /** the start of the line (s = 0), and its heading there (yaw: 0 = +Z) */
  origin: { x: number; z: number; heading: number };
  /** metres of line past s = 0; `before` metres more are laid upstream of it */
  length: number;
  before?: number;
  bends: LaneBend[];
  halfWidth(s: number): number;
  speed(s: number): { min: number; cruise: number; max: number };
  /** the floor at a point on the lane, absolute y (what `point` stands on) */
  floor(s: number, lat: number): number;
  sinks?(s: number, lat: number): boolean;
  /** how far either side of the line `project` has to answer, metres (default 60) */
  reach?: number;
}

const STEP = 1;
const CELL = 2;
const FAR = 0xffff;

/**
 * A lane laid by heading: straight runs joined by smooth bends, sampled every
 * metre. Built for a river two kilometres long, so the question every body
 * asks every frame — *where on the lane am I?* — is a lookup, not a search:
 * the ground round the line is rasterised once into two-metre cells, each
 * holding the sample nearest it, and `project` refines from that sample.
 * A bend that doubles back stays honest, because each cell keeps the sample
 * it is *closest* to.
 */
export class HeadingLane implements SplineLane {
  readonly length: number;
  /** metres laid upstream of s = 0 (a lane may start behind its own zero) */
  readonly before: number;
  private xs: Float32Array;
  private zs: Float32Array;
  private hs: Float32Array;
  private n: number;
  private grid: Uint16Array;
  private gridD: Float32Array;
  private gx0: number;
  private gz0: number;
  private gw: number;
  private gh: number;

  constructor(private opts: HeadingLaneOpts) {
    this.length = opts.length;
    this.before = opts.before ?? 0;
    const total = this.before + opts.length;
    this.n = Math.ceil(total / STEP) + 1;
    this.xs = new Float32Array(this.n);
    this.zs = new Float32Array(this.n);
    this.hs = new Float32Array(this.n);
    // lay the line from s = 0 both ways, integrating the heading
    const i0 = Math.round(this.before / STEP);
    const head = (s: number): number => {
      let h = opts.origin.heading;
      for (const b of opts.bends) {
        const t = THREE.MathUtils.clamp((s - (b.at - b.span / 2)) / b.span, 0, 1);
        h += b.turn * t * t * (3 - 2 * t);
      }
      return h;
    };
    this.xs[i0] = opts.origin.x;
    this.zs[i0] = opts.origin.z;
    this.hs[i0] = head(0);
    for (let i = i0 + 1; i < this.n; i++) {
      const s = (i - i0) * STEP;
      const h = head(s - STEP / 2);
      this.xs[i] = this.xs[i - 1] + Math.sin(h) * STEP;
      this.zs[i] = this.zs[i - 1] + Math.cos(h) * STEP;
      this.hs[i] = head(s);
    }
    for (let i = i0 - 1; i >= 0; i--) {
      const s = (i - i0) * STEP;
      const h = head(s + STEP / 2);
      this.xs[i] = this.xs[i + 1] - Math.sin(h) * STEP;
      this.zs[i] = this.zs[i + 1] - Math.cos(h) * STEP;
      this.hs[i] = head(s);
    }

    // the raster: every cell within reach of the line knows its nearest sample
    const reach = opts.reach ?? 60;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.n; i++) {
      minX = Math.min(minX, this.xs[i]); maxX = Math.max(maxX, this.xs[i]);
      minZ = Math.min(minZ, this.zs[i]); maxZ = Math.max(maxZ, this.zs[i]);
    }
    this.gx0 = minX - reach - CELL;
    this.gz0 = minZ - reach - CELL;
    this.gw = Math.ceil((maxX - minX + 2 * reach) / CELL) + 3;
    this.gh = Math.ceil((maxZ - minZ + 2 * reach) / CELL) + 3;
    this.grid = new Uint16Array(this.gw * this.gh).fill(FAR);
    this.gridD = new Float32Array(this.gw * this.gh).fill(Infinity);
    const r = Math.ceil(reach / CELL) + 1;
    for (let i = 0; i < this.n; i++) {
      const cx = Math.floor((this.xs[i] - this.gx0) / CELL);
      const cz = Math.floor((this.zs[i] - this.gz0) / CELL);
      for (let dz = -r; dz <= r; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= this.gh) continue;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= this.gw) continue;
          const wx = this.gx0 + (x + 0.5) * CELL, wz = this.gz0 + (z + 0.5) * CELL;
          const d = (wx - this.xs[i]) ** 2 + (wz - this.zs[i]) ** 2;
          if (d > reach * reach) continue;
          const k = z * this.gw + x;
          if (d < this.gridD[k]) { this.gridD[k] = d; this.grid[k] = i; }
        }
      }
    }
  }

  /** the sample index nearest a point, or -1 off the raster */
  private nearest(x: number, z: number): number {
    const cx = Math.floor((x - this.gx0) / CELL);
    const cz = Math.floor((z - this.gz0) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.gw || cz >= this.gh) return -1;
    const i = this.grid[cz * this.gw + cx];
    return i === FAR ? -1 : i;
  }

  project(x: number, z: number, hint?: number): { s: number; lat: number } {
    let i = this.nearest(x, z);
    if (i < 0) {
      // off the raster: the hint's neighbourhood, or the ends
      const guess = hint !== undefined ? this.index(hint) : 0;
      let best = Infinity;
      for (let k = Math.max(0, guess - 80); k < Math.min(this.n, guess + 80); k++) {
        const d = (x - this.xs[k]) ** 2 + (z - this.zs[k]) ** 2;
        if (d < best) { best = d; i = k; }
      }
      if (i < 0) i = 0;
    }
    // refine: two steps of projecting onto the local tangent
    let s = 0, lat = 0;
    for (let pass = 0; pass < 2; pass++) {
      const h = this.hs[i];
      const fx = Math.sin(h), fz = Math.cos(h);
      const dx = x - this.xs[i], dz = z - this.zs[i];
      const along = dx * fx + dz * fz;
      s = (i * STEP - this.before) + along;
      lat = dx * -Math.cos(h) + dz * Math.sin(h);
      const j = this.index(s);
      if (j === i) break;
      i = j;
    }
    return { s, lat };
  }

  /** the sample index at distance `s`, clamped */
  private index(s: number): number {
    return THREE.MathUtils.clamp(Math.round((s + this.before) / STEP), 0, this.n - 1);
  }

  point(s: number, lat: number, out: THREE.Vector3): THREE.Vector3 {
    const f = THREE.MathUtils.clamp((s + this.before) / STEP, 0, this.n - 1);
    const i = Math.min(this.n - 2, Math.floor(f));
    const t = f - i;
    const x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    const z = this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t;
    // past either end the line carries straight on
    const over = (s + this.before) / STEP - f;
    const h = this.heading(s);
    const ex = x + Math.sin(h) * over * STEP, ez = z + Math.cos(h) * over * STEP;
    return out.set(ex - Math.cos(h) * lat, this.opts.floor(s, lat), ez + Math.sin(h) * lat);
  }

  heading(s: number): number {
    const f = THREE.MathUtils.clamp((s + this.before) / STEP, 0, this.n - 1);
    const i = Math.min(this.n - 2, Math.floor(f));
    const t = f - i;
    return this.hs[i] + (this.hs[i + 1] - this.hs[i]) * t;
  }

  halfWidth(s: number): number { return this.opts.halfWidth(s); }
  speed(s: number): { min: number; cruise: number; max: number } { return this.opts.speed(s); }
  sinks(s: number, lat: number): boolean { return this.opts.sinks?.(s, lat) ?? false; }
  floor(s: number, lat: number): number { return this.opts.floor(s, lat); }
}

/**
 * The rides a section puts into the match itself, mid-stage — a fresh bike
 * at a gate, a biker pulling in, a gun on a hull — as opposed to the ones
 * parked by `ctx.rides` at the start. Each is added to `game.vehicles` and
 * the scene, and every one comes back out on `dispose`, retired so its parked
 * collider does not stand in the next stage.
 */
export class RideLedger {
  readonly list: Vehicle[] = [];
  private gone = new Map<Vehicle, number>();

  constructor(private ctx: SectionContext) {}

  add(spec: VehicleSpec, opts: VehicleOpts = {}): Vehicle {
    const game = this.ctx.game;
    const v = new Vehicle(spec, game.board, opts);
    game.scene.add(v.group);
    game.vehicles.push(v);
    this.list.push(v);
    return v;
  }

  /** a hostile in the saddle at once — a biker who arrives riding */
  seat(v: Vehicle, e: Enemy): void {
    v.mountHostile(e);
    e.ride = v;
  }

  /**
   * Retire a ride now — out of the match and the scene. For wrecks that are
   * done sinking, and rides left far behind the party.
   */
  drop(v: Vehicle): void {
    const game = this.ctx.game;
    if (v.hostile) { const e = v.hostile; v.dropHostile(); e.removeMe = true; }
    v.retire();
    game.scene.remove(v.group);
    game.vehicles = game.vehicles.filter((x) => x !== v);
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** take out the wrecks that will not be coming back, once they have finished going */
  prune(dt: number): void {
    for (const v of [...this.list]) {
      if (v.alive || v.respawns) { this.gone.delete(v); continue; }
      const t = (this.gone.get(v) ?? 0) + dt;
      this.gone.set(v, t);
      if (t > 3) { this.gone.delete(v); this.drop(v); }
    }
  }

  dispose(): void {
    for (const v of [...this.list]) this.drop(v);
  }
}
