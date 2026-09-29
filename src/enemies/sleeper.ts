import * as THREE from 'three';
import type { Game } from '../game/game';
import type { DeflectSphere } from '../fx/projectiles';
import type { Enemy, Combatant } from './enemy';
import { audio } from '../core/audio';
import { TEXT } from '../text';

/**
 * The Sleeper's own moves (the mythosaur, the Great Forge's monster).
 *
 * A half-buried colossus fought in an open basin had one problem: it could
 * be pushed. Every rocket and blast shoved it, and a party that kept firing
 * walked it back into a corner of the arena and fought it there, pinned. It
 * now answers that two ways, both telegraphed:
 *
 * - **It goes under.** Every so often, and at once when it has been driven
 *   far from where it made its stand, it sinks into the ground (untouchable
 *   while under), a wake of dust runs across the basin, the ground boils
 *   where it is coming up, and it erupts there — throwing anyone standing
 *   over the spot.
 * - **It roars.** With someone close, it rears back while a ring of fire
 *   spreads over the ground to the roar's reach and its body glows (the
 *   warning), then roars: everyone inside the ring is thrown clear, and for a
 *   few seconds after, a shimmering shell turns every attack back — bolts
 *   fly back at the party, and blades and blasts that land are thrown back at
 *   whoever struck.
 *
 * On top of both, a shove moves it only a third as far as it moves anything
 * else its size: it is of the ground, and the ground does not slide.
 */

/** metres the body sinks to be fully under */
const SINK = 10;
const SINK_T = 1.1;
const RISE_T = 1.0;
/** reach of the eruption where it comes up, and its bite */
const ERUPT_R = 6.5;
const ERUPT_DMG = 30;
/** driven this far from where it made its stand, it dives at the next chance */
const CORNERED = 16;
/** the roar: warning, reach, push and how long the shell lasts after */
const REAR_T = 1.5;
const ROAR_R = 15;
const ROAR_DMG = 10;
const ROAR_PUSH = 18;
const REFLECT_T = 2.8;
/** seconds the roar keeps throwing whoever it caught */
const ROAR_HOLD = 0.6;
/** a shove on the Sleeper is this share of a shove on anything else */
export const SLEEPER_SHOVE = 0.33;

const _v = new THREE.Vector3();

type Mode = 'free' | 'sinking' | 'under' | 'rising' | 'rearing';

export class SleeperMoves {
  mode: Mode = 'free';
  /** 0 fully out … 1 fully under */
  depth = 0;
  /** seconds of turned-back attacks left */
  reflectT = 0;
  /** for the test harness */
  dives = 0;
  roars = 0;

  private home: THREE.Vector3;
  private t = 0;
  private diveCd = 14;
  private roarCd = 9;
  private from = new THREE.Vector3();
  private dest = new THREE.Vector3();
  private wakeT = 0;
  private underT = 1;
  private warned = 0;
  /**
   * Players the roar is still throwing. A one-frame impulse is gone in a
   * metre — the walk damps it back to the stick on the ground and the air
   * does in the air — so the roar holds its push on them for a moment.
   */
  private blown: { p: { velocity: THREE.Vector3; alive: boolean }; dir: THREE.Vector3; speed: number; t: number }[] = [];
  /** blows landed on the shell, owed back to whoever struck */
  private owed: { slot: number; dmg: number }[] = [];
  private shield: DeflectSphere = {
    center: new THREE.Vector3(), radius: 6.5, normal: new THREE.Vector3(), minDot: -2, aim: new THREE.Vector3(),
  };
  private ring: THREE.Mesh | null = null;
  private shell: THREE.Mesh | null = null;

  constructor(home: THREE.Vector3) {
    this.home = home.clone();
  }

  /** under the ground, where nothing reaches it */
  get submerged(): boolean { return this.depth > 0.55; }
  /** rooted in one of its own moves: nothing shoves it and it does not strike */
  get busy(): boolean { return this.mode !== 'free'; }
  get reflecting(): boolean { return this.reflectT > 0; }
  /** how far down to draw the body this frame */
  get sinkOffset(): number { return this.depth * SINK; }

  /** the shell as the projectile system sees it: all round, sending bolts at the party */
  deflector(e: Enemy, game: Game): DeflectSphere | null {
    if (!this.reflecting) return null;
    const s = this.shield;
    s.normal.set(Math.sin(e.facingYaw), 0, Math.cos(e.facingYaw));
    s.center.copy(e.position).addScaledVector(s.normal, 2.2);
    s.center.y += 3.4;
    s.radius = Math.max(6.5, e.radius * 2.2);
    const p = nearestPlayer(game, e.position);
    if (p) s.aim!.copy(p.position).setY(p.position.y + 1.1);
    else s.aim!.copy(s.center).addScaledVector(s.normal, 10);
    return s;
  }

  /** a blow that reached the shell: it does no harm, and half of it goes back */
  turnBack(amount: number, bySlot: number): void {
    if (bySlot >= 0) this.owed.push({ slot: bySlot, dmg: amount * 0.5 });
  }

  /** gone: put away everything it drew */
  end(): void {
    if (this.ring) this.ring.visible = false;
    if (this.shell) this.shell.visible = false;
    if (this.mode === 'under' || this.mode === 'sinking') audio.setBurrowRumble(0);
    this.reflectT = 0;
  }

  /**
   * One frame. Returns true when a move of its own took the frame (the body
   * is rooted, sinking, under or rising), false to let the ordinary melee AI
   * run it.
   */
  update(e: Enemy, dt: number, game: Game, target: Combatant | null): boolean {
    this.t -= dt;
    this.diveCd -= dt;
    this.roarCd -= dt;
    this.reflectT = Math.max(0, this.reflectT - dt);
    this.drawShell(e, game);
    this.payBack(e, game);
    for (let i = this.blown.length - 1; i >= 0; i--) {
      const b = this.blown[i];
      b.t -= dt;
      if (b.t <= 0 || !b.p.alive) { this.blown.splice(i, 1); continue; }
      const along = b.p.velocity.x * b.dir.x + b.p.velocity.z * b.dir.z;
      const want = b.speed * Math.min(1, b.t / ROAR_HOLD + 0.3);
      if (along < want) {
        b.p.velocity.x += b.dir.x * (want - along);
        b.p.velocity.z += b.dir.z * (want - along);
      }
    }
    const vx = (k: number): void => {
      e.velocity.x *= Math.max(0, 1 - k * dt);
      e.velocity.z *= Math.max(0, 1 - k * dt);
    };

    switch (this.mode) {
      case 'free': {
        // a dive wants only a fight to be in; the roar wants someone close
        if (!target && !e.target) return false;
        const cornered = Math.hypot(e.position.x - this.home.x, e.position.z - this.home.z) > CORNERED;
        if (this.diveCd <= 0 || (cornered && this.diveCd < 9)) {
          this.startDive(e, game);
          return true;
        }
        const near = nearestPlayer(game, e.position);
        if (this.roarCd <= 0 && near && near.position.distanceTo(e.position) < ROAR_R - 2) {
          this.startRoar(e, game);
          return true;
        }
        return false;
      }
      case 'sinking': {
        vx(12);
        const k = 1 - Math.max(0, this.t) / SINK_T;
        this.depth = k * k;
        if (Math.random() < dt * 24) game.particles.dustPuff(e.position, 4);
        if (this.t <= 0) {
          this.mode = 'under';
          this.depth = 1;
          this.t = this.underT = 1.5 + Math.random() * 0.8;
          this.from.copy(e.position);
          this.dest.copy(this.pickSpot(e, game));
          audio.setBurrowRumble(0.7);
        }
        return true;
      }
      case 'under': {
        e.velocity.set(0, 0, 0);
        this.depth = 1;
        // the wake: a line of dust running from where it went down to where it will come up
        this.wakeT -= dt;
        if (this.wakeT <= 0) {
          this.wakeT = 0.05;
          const k = 1 - Math.max(0, this.t) / this.underT;
          _v.lerpVectors(this.from, this.dest, Math.min(1, Math.max(0, k)));
          game.particles.dustPuff(_v, 5);
        }
        if (this.t <= 0) {
          e.position.copy(this.dest);
          const p = nearestPlayer(game, e.position);
          if (p) e.facingYaw = Math.atan2(p.position.x - e.position.x, p.position.z - e.position.z);
          this.mode = 'rising';
          this.t = RISE_T;
          audio.setBurrowRumble(0);
          audio.beastGrowl(0.9);
        }
        return true;
      }
      case 'rising': {
        vx(12);
        const k = 1 - Math.max(0, this.t) / RISE_T;
        this.depth = 1 - k * k;
        // the ground boils where it is coming up: the warning to get off the spot
        if (Math.random() < dt * 30) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * ERUPT_R;
          game.particles.dustPuff(_v.set(e.position.x + Math.cos(a) * r, e.position.y + 0.2, e.position.z + Math.sin(a) * r), 4);
        }
        for (const p of game.players) {
          const d = p.position.distanceTo(e.position);
          if (d < 22) p.groundShake(0.06 * (1 - d / 22));
        }
        if (this.t <= 0) {
          this.mode = 'free';
          this.depth = 0;
          this.erupt(e, game);
          this.diveCd = e.enraged ? 10 + Math.random() * 3 : 15 + Math.random() * 5;
          this.roarCd = Math.max(this.roarCd, 3);
        }
        return true;
      }
      case 'rearing': {
        vx(10);
        const p = nearestPlayer(game, e.position);
        if (p) {
          const want = Math.atan2(p.position.x - e.position.x, p.position.z - e.position.z);
          let d = want - e.facingYaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          e.facingYaw += d * Math.min(1, dt * 5);
        }
        e.parryFlash(0.12);
        const k = 1 - Math.max(0, this.t) / REAR_T;
        this.drawRing(e, k);
        // sparks round the rim: the line to be outside of
        if (Math.random() < dt * 20) {
          const a = Math.random() * Math.PI * 2, r = ROAR_R * (0.35 + 0.65 * k);
          game.particles.impactSparks(_v.set(e.position.x + Math.cos(a) * r, e.position.y + 0.4, e.position.z + Math.sin(a) * r), 3);
        }
        if (this.t <= 0) {
          this.mode = 'free';
          if (this.ring) this.ring.visible = false;
          this.roar(e, game);
        }
        return true;
      }
    }
    return false;
  }

  private startDive(e: Enemy, game: Game): void {
    e.interruptMoves();
    this.mode = 'sinking';
    this.t = SINK_T;
    this.dives++;
    game.particles.dustPuff(e.position, 24);
    audio.beastGrowl(0.8);
  }

  private startRoar(e: Enemy, game: Game): void {
    e.interruptMoves();
    this.mode = 'rearing';
    this.t = REAR_T;
    audio.beastGrowl(1);
    // the first two are named, so the ring is learned; after that it speaks for itself
    if (this.warned < 2) {
      this.warned++;
      game.announce(TEXT.banners.sleeperRoar.title, TEXT.banners.sleeperRoar.sub);
    }
  }

  /** the roar: everyone in the ring thrown clear, then the shell */
  private roar(e: Enemy, game: Game): void {
    this.roars++;
    this.roarCd = e.enraged ? 9 + Math.random() * 2 : 13 + Math.random() * 4;
    this.reflectT = REFLECT_T;
    audio.monster('mythosaur', 'roar', 1);
    game.particles.dustPuff(e.position, 40);
    for (const p of game.players) {
      const d = p.position.distanceTo(e.position);
      if (d < 30) p.groundShake(0.4 * (1 - d / 30));
      if (!p.alive || d > ROAR_R) continue;
      p.damage(ROAR_DMG * e.dmgScale, e.position, -1, { heavy: true });
      const push = _v.copy(p.position).sub(e.position).setY(0);
      if (push.lengthSq() < 1e-4) push.set(Math.sin(e.facingYaw), 0, Math.cos(e.facingYaw));
      push.normalize();
      this.blown.push({ p, dir: push.clone(), speed: ROAR_PUSH * (1 - 0.35 * d / ROAR_R), t: ROAR_HOLD });
      p.velocity.y = Math.max(p.velocity.y, 7);
    }
    for (const a of game.allies) {
      if (!a.alive || a.team === e.team || a.position.distanceTo(e.position) > ROAR_R) continue;
      a.knockback(e.position, 14, 0.6, 0.6);
    }
  }

  /** coming up: whoever is standing over it is hit and thrown */
  private erupt(e: Enemy, game: Game): void {
    game.particles.explosion(e.position.clone());
    game.particles.dustPuff(e.position, 40);
    audio.land(true);
    audio.monster('mythosaur', 'roar', 0.9);
    for (const p of game.players) {
      const d = p.position.distanceTo(e.position);
      if (d < 26) p.groundShake(0.45 * (1 - d / 26));
      if (!p.alive || d > ERUPT_R) continue;
      p.damage(ERUPT_DMG * e.dmgScale, e.position, -1, { heavy: true });
      const push = _v.copy(p.position).sub(e.position).setY(0);
      if (push.lengthSq() > 1e-4) push.normalize();
      p.velocity.addScaledVector(push, 11);
      p.velocity.y = Math.max(p.velocity.y, 9);
    }
    for (const a of game.allies) {
      if (!a.alive || a.team === e.team || a.position.distanceTo(e.position) > ERUPT_R) continue;
      a.knockback(e.position, 12, 0.5, 0.8);
    }
  }

  /**
   * Where to come up: somewhere round where it made its stand, well away from
   * where it went down, with standing room, and not right on top of anyone
   * (the boiling ground is a warning, not a guarantee).
   */
  private pickSpot(e: Enemy, game: Game): THREE.Vector3 {
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 12;
      const want = new THREE.Vector3(this.home.x + Math.cos(a) * r, this.home.y, this.home.z + Math.sin(a) * r);
      const spot = game.placeBoss(want, e.kind);
      if (Math.hypot(spot.x - want.x, spot.z - want.z) > 3) continue;
      const p = nearestPlayer(game, spot);
      const pd = p ? p.position.distanceTo(spot) : 20;
      const score = Math.min(30, spot.distanceTo(e.position)) - (pd < 4 ? 25 : 0) + (pd < 18 ? 6 : 0);
      if (score > bestScore) { bestScore = score; best = spot; }
    }
    return best ?? game.placeBoss(this.home.clone(), e.kind);
  }

  /** hand back what the shell owes */
  private payBack(e: Enemy, game: Game): void {
    if (!this.owed.length) return;
    for (const o of this.owed) {
      const p = game.players[o.slot];
      if (!p || !p.alive) continue;
      p.damage(o.dmg, e.position, -1, { heavy: true });
      game.particles.impactSparks(_v.copy(p.position).setY(p.position.y + 1.2), 10);
    }
    this.owed.length = 0;
  }

  /** the roar's warning: a ring of fire spreading out to its reach */
  private drawRing(e: Enemy, k: number): void {
    if (!this.ring) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xff7a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), m);
      this.ring.rotation.x = -Math.PI / 2;
      e.char.root.add(this.ring);
    }
    const s = e.char.root.scale.x || 1;
    const r = ROAR_R * (0.2 + 0.8 * Math.min(1, k * 1.25));
    this.ring.visible = true;
    this.ring.scale.setScalar(r / s);
    this.ring.position.set(0, 0.2 / s, 0);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * Math.abs(Math.sin(k * 18));
  }

  /** the shell: a gold shimmer round the body while attacks are turned back */
  private drawShell(e: Enemy, game: Game): void {
    if (!this.reflecting) {
      if (this.shell) this.shell.visible = false;
      return;
    }
    if (!this.shell) {
      const m = new THREE.MeshBasicMaterial({
        color: 0xffd070, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), m);
      e.char.root.add(this.shell);
    }
    const s = e.char.root.scale.x || 1;
    const r = Math.max(6.5, e.radius * 2.2);
    this.shell.visible = true;
    this.shell.scale.setScalar(r / s);
    this.shell.position.set(0, 3.4 / s, 2.2 / s);
    const fade = Math.min(1, this.reflectT / 0.5);
    (this.shell.material as THREE.MeshBasicMaterial).opacity = (0.16 + 0.1 * Math.sin(game.time * 14)) * fade;
    e.parryFlash(0.05);
  }
}

function nearestPlayer(game: Game, at: THREE.Vector3): { position: THREE.Vector3 } | null {
  let best: { position: THREE.Vector3 } | null = null, bd = Infinity;
  for (const p of game.players) {
    if (!p.alive) continue;
    const d = p.position.distanceToSquared(at);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
