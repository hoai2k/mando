import * as THREE from 'three';
import type { FrameInput } from '../../core/input';
import type { Game } from '../../game/game';
import type { Player } from '../../player/player';
import type { Enemy } from '../../enemies/enemy';
import type { SectionMove, SectionBar } from '../api';
import { audio } from '../../core/audio';
import { damp } from '../../core/math';

/**
 * K9 — darkness (docs/SECTIONS_IMPLEMENTATION.md §3; Lamplight is its home).
 *
 * While a dark stage stands the world's own light is all but put out — the
 * sun, the sky fill and the ambient drop to a few percent — and what the
 * party sees by is what it carries:
 *
 * - **Helmet lamps.** A shadowless `SpotLight` on each player's helmet (four at
 *   most), pointed along the aim. You see what you point at.
 * - **The focused beam.** Holding aim narrows the lamp and drives it harder.
 *   It drains a battery (six seconds from full) that refills when you let go.
 *   A body held in a focused beam for `dazzleAfter` seconds is **dazzled**: put
 *   down for two, and taking double damage while it is (that is the existing
 *   rule for anything on the ground).
 * - **Flares.** The rocket button throws one instead: a red light that arcs,
 *   lands and burns for twenty seconds. Two point lights are pooled for them;
 *   a third flare takes the oldest one's light.
 * - **Warm pools.** Fixed pools of light a section lays down (a brazier, a
 *   lamp post). The nearest `poolLights` of them to the party carry a real
 *   light; the rest are their own glow.
 *
 * Light is also a mechanic, so the kit answers questions about it for enemy
 * code: `lit(pos)` names the light a point is standing in, if any, and
 * `fearOfLight(...)` is a ready-made `Enemy.sectionSteer` that makes a body
 * shy out of the lamps and flares and never step into a warm pool.
 *
 * The light count is fixed from the start (every light exists, unused ones sit
 * at zero) so nothing recompiles a shader mid-fight.
 */

export type LightKind = 'lamp' | 'beam' | 'flare' | 'pool';

/** the light a point is standing in: where it comes from and which way it points */
export interface LitBy {
  kind: LightKind;
  from: THREE.Vector3;
  /** unit direction of the cone (lamps); zero for round lights */
  dir: THREE.Vector3;
  /** for lamps and beams: whose it is */
  slot: number;
  /** for round lights: how far the light reaches */
  radius: number;
}

export interface DarknessOpts {
  /** what fraction of their intensity the world's own lights keep (default 0.04) */
  dim?: number;
  /** how many warm pools carry a real light at once (default 3) */
  poolLights?: number;
  /** seconds in a focused beam before a body is dazzled (default 1.5) */
  dazzleAfter?: number;
  /** seconds a dazzle lasts (default 2) */
  dazzleFor?: number;
  /** seconds between one player's flares (default 7) */
  flareCd?: number;
  /** lights under this are the section's own and are left burning (its egg sacs, a glow) */
  keep?: THREE.Object3D | null;
}

/** the numbers the lamp is tuned by (see docs/sections-notes/crevasse.md) */
export const LAMP = {
  /** the wide lamp: half-angle, reach, intensity */
  angle: 0.46, range: 30, power: 70,
  /** the focused beam */
  beamAngle: 0.17, beamRange: 44, beamPower: 260,
  /** seconds of focus on a full battery, and seconds to refill it from empty */
  battery: 6, recharge: 9,
  /** below this the beam will not come on again until it has refilled a little */
  reserve: 0.2,
  /** a flare's burn, its light's reach, and how hard it is thrown */
  flareLife: 20, flareRadius: 11, flareThrow: 15,
};

interface Lamp {
  light: THREE.SpotLight;
  target: THREE.Object3D;
  /** a small bright disc on the helmet, so a lamp is seen from the front */
  glint: THREE.Mesh;
  battery: number;
  focusing: boolean;
  /** the aim button this frame (from `move().adjust`) */
  aim: boolean;
  /** the beam cannot relight until the battery is back over the reserve */
  spent: boolean;
  flareCd: number;
  from: THREE.Vector3;
  dir: THREE.Vector3;
}

interface Flare {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  resting: boolean;
}

interface Pool {
  pos: THREE.Vector3;
  radius: number;
  color: number;
}

export class Darkness {
  readonly lamps: Lamp[] = [];
  readonly flares: Flare[] = [];
  readonly pools: Pool[] = [];
  /** seconds each body has spent in a focused beam, and when its dazzle ends */
  private readonly glare = new Map<Enemy, number>();
  private readonly dazzled = new Map<Enemy, number>();
  private readonly dimmed: { light: THREE.Light; was: number }[] = [];
  private readonly poolLights: THREE.PointLight[] = [];
  private readonly flareLights: THREE.PointLight[] = [];
  private readonly flareGeo = new THREE.SphereGeometry(0.14, 8, 6);
  private readonly flareMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
  private readonly glintGeo = new THREE.CircleGeometry(0.07, 10);
  /** front face only: it faces along the lamp, so the camera behind the helmet never sees it */
  private readonly glintMat = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
  private readonly opts: Required<DarknessOpts>;
  private time = 0;

  constructor(private readonly game: Game, private readonly group: THREE.Group, opts: DarknessOpts = {}) {
    this.opts = { dim: 0.04, poolLights: 3, dazzleAfter: 1.5, dazzleFor: 2, flareCd: 7, keep: null, ...opts };
    // put the world's own light out, remembering what it was
    const kept = new Set<THREE.Object3D>();
    this.opts.keep?.traverse((o) => kept.add(o));
    game.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (!l.isLight || kept.has(o)) return;
      this.dimmed.push({ light: l, was: l.intensity });
      l.intensity *= this.opts.dim;
    });
    for (let i = 0; i < 4; i++) {
      const light = new THREE.SpotLight(0xfff0d8, 0, LAMP.range, LAMP.angle, 0.45, 1.3);
      light.castShadow = false;
      const target = new THREE.Object3D();
      light.target = target;
      group.add(light, target);
      const glint = new THREE.Mesh(this.glintGeo, this.glintMat);
      glint.visible = false;
      group.add(glint);
      this.lamps.push({
        light, target, glint, battery: 1, focusing: false, aim: false, spent: false, flareCd: 0,
        from: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
      });
    }
    for (let i = 0; i < this.opts.poolLights; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 16, 1.4);
      group.add(l);
      this.poolLights.push(l);
    }
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff3020, 0, LAMP.flareRadius + 4, 1.4);
      group.add(l);
      this.flareLights.push(l);
    }
  }

  /**
   * The input hook for each player (`Player.sectionMove`, composed with the
   * section's own): the aim button focuses the lamp and the rocket button
   * throws a flare instead of a rocket.
   */
  move(): SectionMove {
    return {
      adjust: (p: Player, _dt: number, input: FrameInput, game: Game): FrameInput => {
        const lamp = this.lamps[p.slot];
        if (!lamp) return input;
        lamp.aim = input.aimHeld;
        if (input.rocketPressed) {
          if (lamp.flareCd <= 0 && p.alive) this.throwFlare(p, game);
          return { ...input, rocketPressed: false };
        }
        return input;
      },
    };
  }

  /** a permanent pool of warm light (a lit brazier): `radius` is how far enemies keep off */
  addPool(pos: THREE.Vector3, radius: number, color = 0xff9a40): void {
    this.pools.push({ pos: pos.clone(), radius, color });
  }

  /** the battery bar for a player's HUD */
  bar(slot: number): SectionBar | null {
    const lamp = this.lamps[slot];
    if (!lamp) return null;
    return {
      label: lamp.focusing ? 'Beam' : 'Lamp',
      value: lamp.battery,
      tone: lamp.spent ? 'danger' : lamp.battery < 0.35 ? 'warn' : 'info',
    };
  }

  /** seconds until this player can throw another flare (0 = ready) */
  flareReady(slot: number): number {
    return Math.max(0, this.lamps[slot]?.flareCd ?? 0);
  }

  isDazzled(e: Enemy): boolean {
    return (this.dazzled.get(e) ?? 0) > this.time;
  }

  update(dt: number): void {
    this.time += dt;
    const game = this.game;
    // ---- the lamps ----
    for (let i = 0; i < 4; i++) {
      const lamp = this.lamps[i];
      const p = game.players[i];
      lamp.flareCd -= dt;
      if (!p || !p.alive) {
        lamp.light.intensity = 0;
        lamp.glint.visible = false;
        lamp.focusing = false;
        continue;
      }
      const want = lamp.aim && !lamp.spent && lamp.battery > 0;
      lamp.focusing = want;
      if (want) {
        lamp.battery = Math.max(0, lamp.battery - dt / LAMP.battery);
        if (lamp.battery <= 0) lamp.spent = true;
      } else {
        lamp.battery = Math.min(1, lamp.battery + dt / LAMP.recharge);
        if (lamp.spent && lamp.battery >= LAMP.reserve) lamp.spent = false;
      }
      // on the helmet, along the aim
      p.cam.aimDir(lamp.dir);
      lamp.from.set(p.position.x, p.position.y + p.height * 0.93, p.position.z);
      lamp.from.addScaledVector(lamp.dir, 0.3);
      const L = lamp.light;
      L.position.copy(lamp.from);
      lamp.target.position.copy(lamp.from).addScaledVector(lamp.dir, 10);
      const k = lamp.focusing ? 1 : 0;
      L.angle = damp(L.angle, k ? LAMP.beamAngle : LAMP.angle, 14, dt);
      L.distance = damp(L.distance, k ? LAMP.beamRange : LAMP.range, 14, dt);
      // a flat battery is a guttering lamp, not a dead one
      const flicker = lamp.spent ? 0.55 + Math.random() * 0.25 : 1;
      L.intensity = damp(L.intensity, (k ? LAMP.beamPower : LAMP.power) * flicker, 14, dt);
      lamp.glint.visible = true;
      lamp.glint.position.copy(lamp.from).addScaledVector(lamp.dir, 0.05);
      lamp.glint.lookAt(lamp.from.x + lamp.dir.x, lamp.from.y + lamp.dir.y, lamp.from.z + lamp.dir.z);
      lamp.glint.scale.setScalar(k ? 1.5 : 1);
    }

    // ---- the flares ----
    const phys = game.board.physics;
    for (let i = this.flares.length - 1; i >= 0; i--) {
      const f = this.flares[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        if (f.light) f.light.intensity = 0;
        this.flares.splice(i, 1);
        continue;
      }
      if (!f.resting) {
        f.vel.y -= 16 * dt;
        const next = f.pos.clone().addScaledVector(f.vel, dt);
        const g = phys.groundHeight(next.x, next.z, f.pos.y);
        if (phys.solidAt(next.x, next.y, next.z)) {
          // off a wall: drop straight down it
          f.vel.x *= -0.25; f.vel.z *= -0.25;
        } else f.pos.copy(next);
        if (f.pos.y <= g + 0.1) {
          f.pos.y = g + 0.1;
          if (Math.abs(f.vel.y) < 2.5) { f.resting = true; f.vel.set(0, 0, 0); }
          else { f.vel.y *= -0.3; f.vel.x *= 0.5; f.vel.z *= 0.5; }
        }
      }
      f.mesh.position.copy(f.pos);
      if (f.light) {
        f.light.position.set(f.pos.x, f.pos.y + 0.6, f.pos.z);
        // sputters, and fades in its last two seconds
        f.light.intensity = (26 + Math.sin(this.time * 31 + i) * 5 + Math.random() * 4) * Math.min(1, f.life / 2);
      }
      if (Math.random() < dt * 14) game.particles.dustPuff(f.pos, 1);
    }

    // ---- the warm pools: the nearest few to the party carry a light ----
    const centre = new THREE.Vector3();
    let n = 0;
    for (const p of game.players) if (p.alive) { centre.add(p.position); n++; }
    if (n) centre.divideScalar(n);
    const near = [...this.pools].sort((a, b) => a.pos.distanceToSquared(centre) - b.pos.distanceToSquared(centre));
    this.poolLights.forEach((l, i) => {
      const pool = near[i];
      if (!pool) { l.intensity = 0; return; }
      l.color.setHex(pool.color);
      l.position.set(pool.pos.x, pool.pos.y + 2.2, pool.pos.z);
      l.distance = pool.radius * 2.2;
      l.intensity = 34 + Math.sin(this.time * 7 + i * 2) * 3 + Math.random() * 2;
    });

    // ---- the dazzle: held in a focused beam ----
    for (const e of game.enemies) {
      if (!e.alive || e.team === 0) continue;
      const beam = this.lit(e.position, e.height * 0.55, ['beam']);
      const t = this.glare.get(e) ?? 0;
      if (beam) {
        const g2 = t + dt;
        if (g2 >= this.opts.dazzleAfter && !this.isDazzled(e)) {
          this.glare.set(e, 0);
          this.dazzled.set(e, this.time + this.opts.dazzleFor);
          e.knockdown(this.opts.dazzleFor);
          e.damage(1, beam.from, beam.slot);
          game.particles.dustPuff(e.position.clone().setY(e.position.y + e.height * 0.6), 10);
          audio.bark('spider_chitter', 0.5);
        } else this.glare.set(e, g2);
      } else if (t > 0) this.glare.set(e, Math.max(0, t - dt * 0.5));
    }
    for (const [e] of this.glare) if (!e.alive) { this.glare.delete(e); this.dazzled.delete(e); }
  }

  /**
   * The light standing at `pos` (lifted `lift` metres — a chest, not the
   * feet), if any: a focused beam first, then a lamp, a flare, a warm pool.
   * `kinds` narrows the question. Lamps and beams need line of sight from the
   * helmet.
   */
  lit(pos: THREE.Vector3, lift = 0.8, kinds?: LightKind[]): LitBy | null {
    const want = (k: LightKind): boolean => !kinds || kinds.includes(k);
    const at = _at.set(pos.x, pos.y + lift, pos.z);
    const phys = this.game.board.physics;
    let lampHit: LitBy | null = null;
    for (let i = 0; i < 4; i++) {
      const lamp = this.lamps[i];
      if (lamp.light.intensity < 1) continue;
      const beam = lamp.focusing;
      if (!want(beam ? 'beam' : 'lamp')) continue;
      _d.subVectors(at, lamp.from);
      const dist = _d.length();
      const range = beam ? LAMP.beamRange : LAMP.range;
      if (dist > range || dist < 1e-3) continue;
      _d.divideScalar(dist);
      const half = beam ? LAMP.beamAngle * 1.25 : LAMP.angle * 0.9;
      if (_d.dot(lamp.dir) < Math.cos(half)) continue;
      const hit = phys.raycastSolids(lamp.from, _d, dist);
      if (hit && hit.dist < dist - 0.6) continue;
      const found: LitBy = { kind: beam ? 'beam' : 'lamp', from: lamp.from, dir: lamp.dir, slot: i, radius: range };
      if (beam) return found;
      lampHit ??= found;
    }
    if (lampHit) return lampHit;
    if (want('flare')) {
      for (const f of this.flares) {
        if (!f.light) continue;
        if (f.pos.distanceToSquared(at) < LAMP.flareRadius * LAMP.flareRadius) {
          return { kind: 'flare', from: f.pos, dir: _zero, slot: -1, radius: LAMP.flareRadius };
        }
      }
    }
    if (want('pool')) {
      for (const pool of this.pools) {
        const dx = at.x - pool.pos.x, dz = at.z - pool.pos.z;
        if (dx * dx + dz * dz < pool.radius * pool.radius && Math.abs(at.y - pool.pos.y) < 6) {
          return { kind: 'pool', from: pool.pos, dir: _zero, slot: -1, radius: pool.radius };
        }
      }
    }
    return null;
  }

  private throwFlare(p: Player, game: Game): void {
    const lamp = this.lamps[p.slot];
    lamp.flareCd = this.opts.flareCd;
    const dir = p.cam.aimDir(new THREE.Vector3());
    const pos = p.position.clone();
    pos.y += p.height * 0.85;
    pos.addScaledVector(dir, 0.6);
    const vel = dir.clone().multiplyScalar(LAMP.flareThrow);
    vel.y += 4;
    const mesh = new THREE.Mesh(this.flareGeo, this.flareMat);
    mesh.position.copy(pos);
    this.group.add(mesh);
    // two lights between all the flares: a third takes the oldest's
    let light = this.flareLights.find((l) => !this.flares.some((f) => f.light === l)) ?? null;
    if (!light) {
      const oldest = this.flares.reduce<Flare | null>((a, f) => (f.light && (!a || f.life < a.life) ? f : a), null);
      if (oldest) { light = oldest.light; oldest.light = null; }
    }
    this.flares.push({ pos, vel, life: LAMP.flareLife, mesh, light, resting: false });
    audio.jetpackIgnite();
    game.particles.dustPuff(pos, 4);
  }

  dispose(): void {
    for (const d of this.dimmed) d.light.intensity = d.was;
    this.dimmed.length = 0;
    for (const f of this.flares) this.group.remove(f.mesh);
    this.flares.length = 0;
    this.flareGeo.dispose();
    this.flareMat.dispose();
    this.glintGeo.dispose();
    this.glintMat.dispose();
    for (const l of [...this.lamps.map((x) => x.light), ...this.poolLights, ...this.flareLights]) l.dispose();
  }
}

const _at = new THREE.Vector3();
const _d = new THREE.Vector3();
const _zero = new THREE.Vector3();

/**
 * A ready-made `Enemy.sectionSteer` for things that live in the dark: out of
 * a lamp's cone it hunts as it always did; caught in one it backs off out of
 * the cone and circles to the flank of whoever is holding it; it never steps
 * into a warm pool, and a flare drives it off. `bold(e)` switches the fear of
 * the *lamps* off (the swarm that has stopped caring); pools and flares still
 * hold it.
 */
export function fearOfLight(dark: Darkness, bold: (e: Enemy) => boolean) {
  return (e: Enemy, dt: number): boolean => {
    const kinds: LightKind[] = bold(e) ? ['flare', 'pool'] : ['beam', 'lamp', 'flare', 'pool'];
    const light = dark.lit(e.position, e.height * 0.5, kinds);
    if (!light) {
      // the edge of a warm pool is a line it will not cross even hunting
      for (const pool of dark.pools) {
        const dx = e.position.x - pool.pos.x, dz = e.position.z - pool.pos.z;
        const d = Math.hypot(dx, dz);
        const edge = pool.radius + e.radius + 0.6;
        if (d < edge && d > 1e-3) {
          const into = -(e.velocity.x * dx + e.velocity.z * dz) / d;
          if (into > 0) { e.velocity.x += (dx / d) * into; e.velocity.z += (dz / d) * into; }
        }
      }
      return false;
    }
    const speed = e.def.speed;
    const ax = e.position.x - light.from.x, az = e.position.z - light.from.z;
    const d = Math.hypot(ax, az) || 1;
    let wx: number, wz: number;
    if (light.kind === 'lamp' || light.kind === 'beam') {
      // out of the cone sideways (the short way out of it) and a little back,
      // which is also the way round to the lamp-holder's flank
      const cx = light.dir.x, cz = light.dir.z;
      const cl = Math.hypot(cx, cz) || 1;
      const side = (ax * -cz + az * cx) / cl >= 0 ? 1 : -1;
      wx = (-cz / cl) * side * 0.85 + (ax / d) * 0.45;
      wz = (cx / cl) * side * 0.85 + (az / d) * 0.45;
    } else {
      // a round light: straight out of it
      wx = ax / d;
      wz = az / d;
    }
    const wl = Math.hypot(wx, wz) || 1;
    const run = light.kind === 'lamp' ? 0.85 : 1.05;
    e.velocity.x = damp(e.velocity.x, (wx / wl) * speed * run, 7, dt);
    e.velocity.z = damp(e.velocity.z, (wz / wl) * speed * run, 7, dt);
    // it keeps its eyes on the light it is backing away from
    e.faceToward(dt, light.from.x, light.from.z, 8);
    return true;
  };
}
