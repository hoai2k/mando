import * as THREE from 'three';
import {
  buildDarkTrooper, buildDroid, buildGunfighter, buildIG, buildNikto,
  buildPirate, buildPyke, buildStormtrooper, buildTusken,
} from '../characters/enemies';
import type { CharacterInstance } from '../characters/builder';
import { clamp, damp, dampAngle } from '../core/math';
import { audio, type BarkName } from '../core/audio';
import type { Game } from '../game/game';

/** Anything that can be targeted and hurt — players, enemies, allies. */
export interface Combatant {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  alive: boolean;
  radius: number;
  height: number;
  team: number; // 0 = players/allies, 1 = hostiles
  damage(amount: number, from: THREE.Vector3, bySlot?: number): void;
}

export type EnemyKind =
  | 'tusken' | 'pirateMelee' | 'pyke' | 'pirate' | 'droid' | 'nikto' | 'jetpirate'
  | 'stormtrooper' | 'deathtrooper' | 'darktrooper'
  | 'ig11' | 'marshal' | 'fennec';

interface Def {
  hp: number; speed: number; radius: number; height: number;
  style: 'melee' | 'ranged' | 'swoop' | 'hover';
  damage: number; attackRange: number; attackCd: number;
  boltSpeed?: number; volley?: number;
  build: () => CharacterInstance;
}

const DEFS: Record<EnemyKind, Def> = {
  tusken:      { hp: 80, speed: 5.6, radius: 0.5, height: 1.8, style: 'melee', damage: 14, attackRange: 2.5, attackCd: 1.5, build: buildTusken },
  pirateMelee: { hp: 95, speed: 5.0, radius: 0.5, height: 1.9, style: 'melee', damage: 17, attackRange: 2.6, attackCd: 1.7, build: () => buildPirate(true) },
  pyke:        { hp: 70, speed: 4.6, radius: 0.5, height: 2.0, style: 'ranged', damage: 8, attackRange: 26, attackCd: 2.4, boltSpeed: 26, volley: 3, build: buildPyke },
  pirate:      { hp: 85, speed: 4.2, radius: 0.5, height: 1.9, style: 'ranged', damage: 9, attackRange: 30, attackCd: 2.6, boltSpeed: 28, volley: 3, build: () => buildPirate(false) },
  droid:       { hp: 170, speed: 1.6, radius: 0.55, height: 2.1, style: 'ranged', damage: 15, attackRange: 40, attackCd: 1.7, boltSpeed: 34, volley: 1, build: buildDroid },
  nikto:       { hp: 60, speed: 15, radius: 0.8, height: 1.6, style: 'swoop', damage: 8, attackRange: 40, attackCd: 0.4, boltSpeed: 34, build: buildNikto },
  jetpirate:   { hp: 70, speed: 6.5, radius: 0.5, height: 1.9, style: 'hover', damage: 9, attackRange: 30, attackCd: 2.2, boltSpeed: 28, volley: 2, build: () => buildPirate(false) },
  // Imperial remnant
  stormtrooper: { hp: 60, speed: 4.8, radius: 0.5, height: 1.9, style: 'ranged', damage: 8, attackRange: 28, attackCd: 2.1, boltSpeed: 27, volley: 3, build: () => buildStormtrooper(false) },
  deathtrooper: { hp: 150, speed: 5.2, radius: 0.52, height: 2.0, style: 'ranged', damage: 12, attackRange: 32, attackCd: 2.0, boltSpeed: 32, volley: 4, build: () => buildStormtrooper(true) },
  darktrooper:  { hp: 160, speed: 5.5, radius: 0.55, height: 2.2, style: 'hover', damage: 12, attackRange: 30, attackCd: 2.3, boltSpeed: 30, volley: 2, build: buildDarkTrooper },
  // Allies (spawned on team 0)
  ig11:    { hp: 220, speed: 6.2, radius: 0.5, height: 2.2, style: 'ranged', damage: 12, attackRange: 32, attackCd: 1.3, boltSpeed: 34, volley: 4, build: buildIG },
  marshal: { hp: 180, speed: 5.5, radius: 0.5, height: 1.85, style: 'ranged', damage: 14, attackRange: 30, attackCd: 2.0, boltSpeed: 34, volley: 2, build: () => buildGunfighter('marshal') },
  fennec:  { hp: 180, speed: 5.5, radius: 0.5, height: 1.85, style: 'ranged', damage: 40, attackRange: 55, attackCd: 2.8, boltSpeed: 60, volley: 1, build: () => buildGunfighter('fennec') },
};

const SPAWN_BARKS: Partial<Record<EnemyKind, BarkName>> = {
  tusken: 'tusken_cry', pyke: 'pyke_chatter', pirate: 'pirate_taunt', pirateMelee: 'pirate_taunt',
};
const DEATH_BARKS: Partial<Record<EnemyKind, BarkName>> = {
  tusken: 'tusken_cry', pyke: 'pyke_death', pirate: 'pirate_death', pirateMelee: 'pirate_death',
  stormtrooper: 'imperial_death', deathtrooper: 'imperial_death',
};

let nextId = 1;

export class Enemy {
  id = nextId++;
  def: Def;
  char: CharacterInstance;
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  hp: number;
  alive = true;
  radius: number;
  height: number;
  team = 1;
  removeMe = false;
  /** set by Game once the death has been scored/FX'd */
  counted = false;
  lastHitBy = -1;

  private attackCd = 0;
  private windup = 0;
  private windupTarget: Combatant | null = null;
  private prevPassing = false;
  /** while > 0 the AI stops steering so a knockback impulse actually carries */
  private stagger = 0;
  private volleyLeft = 0;
  private volleyTimer = 0;
  private strafePhase = Math.random() * Math.PI * 2;
  private facingYaw = 0;
  private deadTimer = 0;
  private spawnPos = new THREE.Vector3();
  private swoopPhase = Math.random() * Math.PI * 2;
  private hoverTarget = new THREE.Vector3();
  private hoverRetarget = 0;
  private hitFlash = 0;

  constructor(public kind: EnemyKind, pos: THREE.Vector3, team = 1) {
    this.def = DEFS[kind];
    this.team = team;
    this.char = this.def.build();
    this.hp = this.def.hp;
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.position.copy(pos);
    this.spawnPos.copy(pos);
    this.char.root.position.copy(pos);
    const bark = SPAWN_BARKS[kind];
    if (bark && team === 1) audio.bark(bark, 0.4);
  }

  damage(amount: number, from: THREE.Vector3, bySlot: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    if (bySlot >= 0) this.lastHitBy = bySlot;
    this.hitFlash = 0.15;
    if (this.hp > 0 && this.windup > 0) this.windup = 0; // hit out of the wind-up
    if (this.hp <= 0) {
      this.alive = false;
      this.deadTimer = 1.4;
      const bark = DEATH_BARKS[this.kind];
      if (bark) audio.bark(bark, 0.5);
      const anim = this.char.animator;
      if (anim) {
        anim.release('lower'); anim.release('upper');
        anim.playOnce('lower', 'deathLower', 0.08, true);
        anim.playOnce('upper', 'deathUpper', 0.08, true);
      }
      // fling the corpse a bit
      const dir = this.position.clone().sub(from).setY(0).normalize();
      this.velocity.addScaledVector(dir, 6);
      this.velocity.y = Math.max(this.velocity.y, 3.5);
    } else if (this.char.animator && this.windup <= 0) {
      this.char.animator.playOnce('upper', 'hitUpper', 0.05);
    }
  }

  /**
   * Shove this enemy away from `from`. The stagger window matters as much as
   * the impulse: without it the per-frame steering damp in updateMelee/Ranged
   * pulls velocity straight back to the AI's intended movement and the hit
   * reads as nothing.
   */
  knockback(from: THREE.Vector3, force: number, stagger = 0.3): void {
    const dir = this.position.clone().sub(from).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); // point-blank: shove along +Z
    dir.normalize();
    this.velocity.addScaledVector(dir, force);
    this.velocity.y += force * 0.35;
    this.stagger = Math.max(this.stagger, stagger);
  }

  private nearestFoe(game: Game): Combatant | null {
    let best: Combatant | null = null;
    let bestD = Infinity;
    const foes: Combatant[] = this.team === 1
      ? [...game.players, ...game.allies]
      : game.enemies;
    for (const f of foes) {
      if (!f.alive || f.team === this.team) continue;
      const d = f.position.distanceToSquared(this.position);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  update(dt: number, game: Game): void {
    const anim = this.char.animator;
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    if (!this.alive) {
      this.deadTimer -= dt;
      this.velocity.y -= 22 * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height * 0.5, this.velocity, dt);
      if (this.deadTimer <= 0) {
        this.char.root.position.y -= dt * 1.2; // sink away
        if (this.deadTimer < -1.2) this.removeMe = true;
      }
      this.syncVisual(dt, game);
      anim?.update(dt);
      return;
    }

    const target = this.nearestFoe(game);
    this.attackCd -= dt;
    const d = DEFS[this.kind];

    if (this.stagger > 0) {
      // reeling from a hit: coast on the impulse, just bleed it off slowly
      this.stagger -= dt;
      const grounded = d.style === 'melee' || d.style === 'ranged';
      this.velocity.x = damp(this.velocity.x, 0, grounded ? 2.2 : 1.2, dt);
      this.velocity.z = damp(this.velocity.z, 0, grounded ? 2.2 : 1.2, dt);
      this.volleyLeft = 0; // interrupt any burst in progress
    } else if (!target) {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    } else {
      switch (d.style) {
        case 'melee': this.updateMelee(dt, game, target); break;
        case 'ranged': this.updateRanged(dt, game, target); break;
        case 'swoop': this.updateSwoop(dt, game, target); break;
        case 'hover': this.updateHover(dt, game, target); break;
      }
    }

    // separation from other enemies
    for (const other of game.enemies) {
      if (other === this || !other.alive) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const dist2 = dx * dx + dz * dz;
      const min = this.radius + other.radius + 0.3;
      if (dist2 < min * min && dist2 > 1e-6) {
        const dist = Math.sqrt(dist2);
        const push = (min - dist) * 3;
        this.velocity.x += (dx / dist) * push;
        this.velocity.z += (dz / dist) * push;
      }
    }

    if (d.style === 'melee' || d.style === 'ranged') {
      this.velocity.y -= 24 * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
      if (this.position.y < game.board.physics.killY) { this.alive = false; this.removeMe = true; }
    } else {
      this.position.addScaledVector(this.velocity, dt);
    }

    // hazard: sarlacc eats enemies too
    const hz = game.board.hazard;
    if (hz) {
      const hd = Math.hypot(this.position.x - hz.center.x, this.position.z - hz.center.z);
      if (hd < hz.radius && this.position.y < hz.center.y + 3) { this.damage(9999, hz.center, -1); }
    }

    // locomotion animation
    if (anim) {
      const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.windup <= 0) {
        anim.play('lower', speed2 > 0.7 ? 'runLower' : 'idleLower', 0.2, clamp(speed2 / 6, 0.6, 1.4));
        if (d.style === 'ranged' || d.style === 'hover') anim.play('upper', 'enemyAimUpper', 0.25);
        else if (speed2 > 0.7) anim.play('upper', 'runUpper', 0.2, clamp(speed2 / 6, 0.6, 1.4));
        else anim.play('upper', 'idleUpper', 0.25);
      }
    }

    this.syncVisual(dt, game);
    anim?.update(dt);
  }

  private faceToward(dt: number, x: number, z: number, rate = 10): void {
    const yaw = Math.atan2(x - this.position.x, z - this.position.z);
    this.facingYaw = dampAngle(this.facingYaw, yaw, rate, dt);
  }

  private updateMelee(dt: number, game: Game, target: Combatant): void {
    const d = DEFS[this.kind];
    const to = target.position.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    this.faceToward(dt, target.position.x, target.position.z);

    if (this.windup > 0) {
      this.windup -= dt;
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);
      if (this.windup <= 0 && this.windupTarget) {
        const hd = this.windupTarget.position.distanceTo(this.position);
        if (hd < d.attackRange + 0.6 && this.windupTarget.alive) {
          this.windupTarget.damage(d.damage, this.position);
        }
        this.attackCd = d.attackCd;
      }
      return;
    }

    if (dist > d.attackRange) {
      to.normalize();
      // slight strafe while approaching so groups fan out
      this.strafePhase += dt;
      const strafe = Math.sin(this.strafePhase * 1.4 + this.id) * 0.35;
      const sx = -to.z * strafe, sz = to.x * strafe;
      this.velocity.x = damp(this.velocity.x, (to.x + sx) * d.speed, 8, dt);
      this.velocity.z = damp(this.velocity.z, (to.z + sz) * d.speed, 8, dt);
    } else {
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);
      if (this.attackCd <= 0) {
        this.windup = 0.55;
        this.windupTarget = target;
        if (this.char.animator) this.char.animator.playOnce('upper', 'enemySwing', 0.06);
      }
    }
  }

  private updateRanged(dt: number, game: Game, target: Combatant): void {
    const d = DEFS[this.kind];
    const to = target.position.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    this.faceToward(dt, target.position.x, target.position.z, 7);
    to.normalize();

    // keep distance band, strafe; leash to spawn on the station so nobody walks off
    this.strafePhase += dt;
    const strafe = Math.sin(this.strafePhase * 0.9 + this.id * 1.7);
    let mx = 0, mz = 0;
    const near = 11, far = Math.min(d.attackRange * 0.85, 24);
    if (dist > far) { mx += to.x; mz += to.z; }
    else if (dist < near) { mx -= to.x; mz -= to.z; }
    mx += -to.z * strafe * 0.7;
    mz += to.x * strafe * 0.7;
    if (game.board.kind === 'station' && this.team === 1) {
      const lx = this.spawnPos.x - this.position.x, lz = this.spawnPos.z - this.position.z;
      const ld = Math.hypot(lx, lz);
      if (ld > 4) { mx = lx / ld; mz = lz / ld; }
    }
    const ml = Math.hypot(mx, mz) || 1;
    this.velocity.x = damp(this.velocity.x, (mx / ml) * d.speed, 6, dt);
    this.velocity.z = damp(this.velocity.z, (mz / ml) * d.speed, 6, dt);

    this.updateVolley(dt, game, target, dist);
  }

  private updateVolley(dt: number, game: Game, target: Combatant, dist: number): void {
    const d = DEFS[this.kind];
    if (this.volleyLeft > 0) {
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0) {
        this.volleyLeft--;
        this.volleyTimer = 0.16;
        this.fireBoltAt(game, target);
      }
    } else if (this.attackCd <= 0 && dist < d.attackRange && this.hasLineOfSight(game, target)) {
      this.volleyLeft = d.volley ?? 1;
      this.attackCd = d.attackCd;
    }
  }

  private hasLineOfSight(game: Game, target: Combatant): boolean {
    const from = this.position.clone();
    from.y += this.height * 0.75;
    const to = target.position.clone();
    to.y += 1;
    const dir = to.sub(from);
    const dist = dir.length();
    dir.normalize();
    const hit = game.board.physics.raycast(from, dir, dist);
    return !hit;
  }

  private fireBoltAt(game: Game, target: Combatant): void {
    const d = DEFS[this.kind];
    const from = new THREE.Vector3();
    if (this.char.muzzle) this.char.muzzle.getWorldPosition(from);
    else { from.copy(this.position); from.y += this.height * 0.7; }
    // lead the target a little, with error so bolts are dodgeable
    const aim = target.position.clone();
    aim.y += 1.1;
    const t = from.distanceTo(aim) / (d.boltSpeed ?? 28);
    aim.addScaledVector(target.velocity, t * 0.55);
    aim.x += (Math.random() - 0.5) * 1.6;
    aim.y += (Math.random() - 0.5) * 1.2;
    aim.z += (Math.random() - 0.5) * 1.6;
    const dir = aim.sub(from).normalize();
    game.projectiles.fire(from, dir, d.boltSpeed ?? 28, d.damage, this.team);
    audio.enemyBlaster();
  }

  private updateSwoop(dt: number, game: Game, target: Combatant): void {
    const d = DEFS[this.kind];
    // figure-8 orbit with periodic dive-bys
    this.swoopPhase += dt * 0.55;
    const orbitR = 26;
    const cx = target.position.x, cz = target.position.z;
    const gx = cx + Math.sin(this.swoopPhase) * orbitR;
    const gz = cz + Math.sin(this.swoopPhase * 2) * orbitR * 0.55;
    const groundY = game.board.physics.heightAt ? game.board.physics.heightAt(this.position.x, this.position.z) : target.position.y;
    const passing = Math.cos(this.swoopPhase) < -0.25; // attack window on the inward leg
    if (passing && !this.prevPassing) audio.bark('swoop_pass', 0.5);
    this.prevPassing = passing;
    const gy = Math.max(groundY + (passing ? 2.2 : 5.5), target.position.y + (passing ? 1.2 : 4));
    const goal = new THREE.Vector3(gx, gy, gz);
    const to = goal.sub(this.position);
    const dist = to.length();
    to.normalize();
    this.velocity.x = damp(this.velocity.x, to.x * d.speed, 3.5, dt);
    this.velocity.y = damp(this.velocity.y, to.y * d.speed * 0.8, 3.5, dt);
    this.velocity.z = damp(this.velocity.z, to.z * d.speed, 3.5, dt);
    this.facingYaw = Math.atan2(this.velocity.x, this.velocity.z);
    if (passing && this.attackCd <= 0) {
      const pd = this.position.distanceTo(target.position);
      if (pd < 30) {
        this.fireBoltAt(game, target);
        this.attackCd = d.attackCd;
      }
    }
    // ram damage on close pass
    if (this.position.distanceTo(target.position) < 1.8 && target.alive) {
      target.damage(10, this.position);
      target.velocity.add(this.velocity.clone().multiplyScalar(0.4));
      this.attackCd = Math.max(this.attackCd, 1);
    }
  }

  private updateHover(dt: number, game: Game, target: Combatant): void {
    const d = DEFS[this.kind];
    this.hoverRetarget -= dt;
    if (this.hoverRetarget <= 0) {
      this.hoverRetarget = 2.5 + Math.random() * 2;
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 10;
      this.hoverTarget.set(
        target.position.x + Math.cos(a) * r,
        target.position.y + 4 + Math.random() * 6,
        target.position.z + Math.sin(a) * r
      );
    }
    const to = this.hoverTarget.clone().sub(this.position);
    to.normalize();
    this.velocity.x = damp(this.velocity.x, to.x * d.speed, 3, dt);
    this.velocity.y = damp(this.velocity.y, to.y * d.speed + Math.sin(game.time * 2.5 + this.id) * 0.8, 3, dt);
    this.velocity.z = damp(this.velocity.z, to.z * d.speed, 3, dt);
    this.faceToward(dt, target.position.x, target.position.z, 6);
    const dist = this.position.distanceTo(target.position);
    this.updateVolley(dt, game, target, dist);
    // jet flame
    if (Math.random() < dt * 30) {
      const p = this.position.clone();
      p.y += 1.1;
      game.particles.jetFlame(p, new THREE.Vector3(0, -4, 0));
    }
  }

  private syncVisual(dt: number, game: Game): void {
    this.char.root.position.copy(this.position);
    this.char.root.rotation.y = this.facingYaw;
    if (this.kind === 'nikto') {
      this.char.root.rotation.z = clamp(-this.velocity.x * Math.cos(this.facingYaw) * 0.03 + this.velocity.z * Math.sin(this.facingYaw) * 0.03, -0.5, 0.5);
    }
    this.char.cosmetic?.(dt, game.time);
    // hit flash: emissive pulse on all materials (cheap: scale pop)
    const s = 1 + this.hitFlash * 0.6;
    this.char.root.scale.setScalar(this.kind === 'nikto' ? 1 : s);
  }
}
