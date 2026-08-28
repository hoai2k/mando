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
  /** how far this kind can spot a foe it is facing, in metres */
  notice: number;
  boltSpeed?: number; volley?: number;
  build: () => CharacterInstance;
}

/** the board's gravity scale — a station in orbit runs light for everyone on it */
const grav = (game: Game): number => game.board.gravity ?? 1;

const DEFS: Record<EnemyKind, Def> = {
  tusken:      { hp: 80, speed: 5.6, radius: 0.5, height: 1.8, style: 'melee', damage: 14, attackRange: 2.5, attackCd: 1.5, notice: 32, build: buildTusken },
  pirateMelee: { hp: 95, speed: 5.0, radius: 0.5, height: 1.9, style: 'melee', damage: 17, attackRange: 2.6, attackCd: 1.7, notice: 30, build: () => buildPirate(true) },
  pyke:        { hp: 70, speed: 4.6, radius: 0.5, height: 2.0, style: 'ranged', damage: 8, attackRange: 26, attackCd: 2.4, notice: 42, boltSpeed: 26, volley: 3, build: buildPyke },
  pirate:      { hp: 85, speed: 4.2, radius: 0.5, height: 1.9, style: 'ranged', damage: 9, attackRange: 30, attackCd: 2.6, notice: 42, boltSpeed: 28, volley: 3, build: () => buildPirate(false) },
  droid:       { hp: 170, speed: 1.6, radius: 0.55, height: 2.1, style: 'ranged', damage: 15, attackRange: 40, attackCd: 1.7, notice: 48, boltSpeed: 34, volley: 1, build: buildDroid },
  nikto:       { hp: 60, speed: 15, radius: 0.8, height: 1.6, style: 'swoop', damage: 8, attackRange: 40, attackCd: 0.4, notice: 80, boltSpeed: 34, build: buildNikto },
  jetpirate:   { hp: 70, speed: 6.5, radius: 0.5, height: 1.9, style: 'hover', damage: 9, attackRange: 30, attackCd: 2.2, notice: 50, boltSpeed: 28, volley: 2, build: () => buildPirate(false) },
  // Imperial remnant
  stormtrooper: { hp: 60, speed: 4.8, radius: 0.5, height: 1.9, style: 'ranged', damage: 8, attackRange: 28, attackCd: 2.1, notice: 42, boltSpeed: 27, volley: 3, build: () => buildStormtrooper(false) },
  deathtrooper: { hp: 150, speed: 5.2, radius: 0.52, height: 2.0, style: 'ranged', damage: 12, attackRange: 32, attackCd: 2.0, notice: 48, boltSpeed: 32, volley: 4, build: () => buildStormtrooper(true) },
  darktrooper:  { hp: 160, speed: 5.5, radius: 0.55, height: 2.2, style: 'hover', damage: 12, attackRange: 30, attackCd: 2.3, notice: 48, boltSpeed: 30, volley: 2, build: buildDarkTrooper },
  // Allies (spawned on team 0)
  ig11:    { hp: 220, speed: 6.2, radius: 0.5, height: 2.2, style: 'ranged', damage: 12, attackRange: 32, attackCd: 1.3, notice: 70, boltSpeed: 34, volley: 4, build: buildIG },
  marshal: { hp: 180, speed: 5.5, radius: 0.5, height: 1.85, style: 'ranged', damage: 14, attackRange: 30, attackCd: 2.0, notice: 70, boltSpeed: 34, volley: 2, build: () => buildGunfighter('marshal') },
  fennec:  { hp: 180, speed: 5.5, radius: 0.5, height: 1.85, style: 'ranged', damage: 40, attackRange: 55, attackCd: 2.8, notice: 90, boltSpeed: 60, volley: 1, build: () => buildGunfighter('fennec') },
};

const SPAWN_BARKS: Partial<Record<EnemyKind, BarkName>> = {
  tusken: 'tusken_cry', pyke: 'pyke_chatter', pirate: 'pirate_taunt', pirateMelee: 'pirate_taunt',
};
const DEATH_BARKS: Partial<Record<EnemyKind, BarkName>> = {
  tusken: 'tusken_cry', pyke: 'pyke_death', pirate: 'pirate_death', pirateMelee: 'pirate_death',
  stormtrooper: 'imperial_death', deathtrooper: 'imperial_death',
};

let nextId = 1;

/**
 * How aware an enemy is of the players.
 *
 * `idle` holds position at its post — this is what makes the boards worth
 * exploring: hostiles are posted around the map and stay there until
 * something gives the player away. `alerted` is the investigate step (heard
 * a blaster, a squadmate shouted) and `engaged` is full combat.
 */
export type Awareness = 'idle' | 'alerted' | 'engaged';

/** how long an engaged enemy keeps hunting after losing sight, seconds */
const MEMORY = 9;
/** how long it pokes around a noise before shrugging and going home */
const INVESTIGATE_TIME = 8;
/** straight-down exhaust direction, shared so hover jets allocate nothing */
const _JET_DOWN = new THREE.Vector3(0, -1, 0);

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

  // ---- awareness / squad ----
  awareness: Awareness = 'idle';
  /** the spot this enemy is posted at and drifts back to when it loses interest */
  post = new THREE.Vector3();
  /** squad it was placed with; alerts spread through the squad */
  squad = 0;
  /** last place a foe was seen or heard */
  private interest = new THREE.Vector3();
  /** counts down while engaged without sight, or while investigating */
  private memory = 0;
  /** short delay between noticing something and acting on it */
  private reaction = 0;
  private idleTimer = Math.random() * 3;
  private idleGoal = new THREE.Vector3();
  private idleYaw = 0;
  /**
   * Director-assigned. `committed` enemies close to attacking range; the rest
   * hold at a standoff and shoot, so a squad pins the player down instead of
   * every member sprinting into melee at once.
   */
  committed = false;
  /** director-assigned bearing around the target, so squads surround it */
  slotAngle = Math.random() * Math.PI * 2;
  /** current foe, refreshed each frame by the senses */
  target: Combatant | null = null;
  /** whether that foe is in sight right now (vs. being hunted from memory) */
  private visible = false;
  /** how many were posted with this squad, for the morale check */
  squadSize = 1;
  // ---- hit reactions & self-preservation (the RDR2 feel) ----
  /** flat on the ground after a heavy hit; gets back up when it runs out */
  private downTimer = 0;
  /** gut-shot: crawling, out of the fight, bleeds out unless finished */
  wounded = false;
  private bleedOut = 0;
  private woundedPosed = false;
  /**
   * Builds up under incoming fire (hits and near misses) and drains over
   * time. Past ~0.55 a shooter stops working its firing position and just
   * holds where it is, ragged and inaccurate — fire keeps heads down.
   */
  suppression = 0;
  /** broke and ran after the squad collapsed; rallies at distance */
  fleeing = false;
  private fleeTimer = 0;
  // ---- cover: shooters fight from behind the crates ----
  /** current cover spot, if any: hide behind the box, peek out to fire */
  cover: { hide: THREE.Vector3; peek: THREE.Vector3 } | null = null;
  /** what the shooter is doing with its cover right now */
  coverState: 'seek' | 'hide' | 'peek' = 'seek';
  private coverTimer = 0;
  private coverRetry = Math.random() * 0.8;
  private coverCheck = 0;
  private peekFired = false;

  get downed(): boolean { return this.downTimer > 0; }
  /** out of the fight for commitment purposes */
  get outOfFight(): boolean { return !this.alive || this.wounded || this.fleeing || this.downed; }
  /**
   * Line-of-sight is a heightfield march, so it is rechecked a few times a
   * second (staggered per enemy) rather than every frame — with a board full
   * of hostiles a per-frame raycast each is the most expensive thing running.
   */
  private sightTimer = 0;
  private sightMemo = false;

  constructor(public kind: EnemyKind, pos: THREE.Vector3, team = 1) {
    this.def = DEFS[kind];
    this.team = team;
    this.char = this.def.build();
    this.hp = this.def.hp;
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.position.copy(pos);
    this.spawnPos.copy(pos);
    this.post.copy(pos);
    this.idleGoal.copy(pos);
    this.facingYaw = Math.random() * Math.PI * 2;
    this.idleYaw = this.facingYaw;
    this.char.root.position.copy(pos);
    // allies fight alongside the player rather than guarding a post
    if (team === 0) this.awareness = 'engaged';
    const bark = SPAWN_BARKS[kind];
    if (bark && team === 1) audio.bark(bark, 0.4);
  }

  /**
   * Something happened at `pos` worth looking at — a shot, a squadmate's
   * shout, a hit landing. `hard` skips straight to combat (being shot at
   * doesn't need investigating).
   */
  alert(pos: THREE.Vector3, hard = false): boolean {
    if (!this.alive || this.team === 0) return false;
    const wasCalm = this.awareness === 'idle';
    this.interest.copy(pos);
    if (hard) {
      if (this.awareness !== 'engaged') this.reaction = Math.max(this.reaction, 0.15);
      this.awareness = 'engaged';
      this.memory = MEMORY;
    } else {
      // Give it long enough to actually get there: a shot heard 80 m away is
      // worth a walk, and a memory that expires en route just turns the whole
      // board around and sends it home again.
      const travel = this.position.distanceTo(pos) / Math.max(this.def.speed * 0.5, 1) + 4;
      const patience = clamp(travel, INVESTIGATE_TIME, 60);
      if (this.awareness === 'idle') {
        this.awareness = 'alerted';
        this.reaction = 0.25 + Math.random() * 0.5;
        this.memory = patience;
      } else {
        this.memory = Math.max(this.memory, patience);
      }
    }
    return wasCalm;
  }

  /** true once this enemy is actually in the fight (used by the HUD radar) */
  get isEngaged(): boolean { return this.awareness === 'engaged'; }

  /** the squad broke — run from `threat`, rally at distance */
  breakAndRun(threat: THREE.Vector3): void {
    if (!this.alive || this.fleeing || this.wounded || this.team !== 1) return;
    if (this.kind === 'droid') return; // droids have no morale to break
    if (this.def.style === 'swoop' || this.def.style === 'hover') return;
    this.fleeing = true;
    this.fleeTimer = 5 + Math.random() * 3;
    this.interest.copy(threat);
    const bark = SPAWN_BARKS[this.kind];
    if (bark) audio.bark(bark, 0.45);
  }

  damage(amount: number, from: THREE.Vector3, bySlot: number): void {
    if (!this.alive) return;
    this.alert(from, true); // being shot at is not something you investigate
    this.suppress(0.35);
    // a shooter caught in the open dives for the nearest crate
    if (!this.cover && this.def.style === 'ranged' && this.team === 1) this.coverRetry = 0;
    // finishing blows on someone already on the ground hit twice as hard
    if (this.downed || this.wounded) amount *= 2;
    this.hp -= amount;
    if (bySlot >= 0) this.lastHitBy = bySlot;
    this.hitFlash = 0.15;
    if (this.hp > 0 && this.windup > 0) this.windup = 0; // hit out of the wind-up

    // Gut-shot: a hit that leaves a grounded humanoid nearly dead can drop it
    // into a wounded crawl instead of a clean fight-on — it is out of the
    // fight, dragging itself away, and bleeds out unless finished.
    if (
      this.hp > 0 && !this.wounded && this.team === 1 && this.downTimer <= 0 &&
      (this.def.style === 'melee' || this.def.style === 'ranged') &&
      this.kind !== 'droid' && // droids don't bleed
      this.hp < this.def.hp * 0.25 && Math.random() < 0.4
    ) {
      this.wounded = true;
      this.bleedOut = 8 + Math.random() * 4;
      this.woundedPosed = false;
      this.windup = 0;
      this.volleyLeft = 0;
      this.interest.copy(from);
      const bark = DEATH_BARKS[this.kind];
      if (bark) audio.bark(bark, 0.45);
    }

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
      // fling the corpse — harder killing blows throw harder, with a bit of
      // sideways scatter so a mowed-down line doesn't fall in lockstep
      const dir = this.position.clone().sub(from).setY(0).normalize();
      const heavy = amount >= 45 ? 1.6 : 1;
      dir.x += (Math.random() - 0.5) * 0.5;
      dir.z += (Math.random() - 0.5) * 0.5;
      dir.normalize();
      this.velocity.addScaledVector(dir, (4.5 + Math.random() * 3) * heavy);
      this.velocity.y = Math.max(this.velocity.y, (3 + Math.random() * 1.5) * heavy);
    } else if (this.char.animator && this.windup <= 0 && !this.wounded && !this.downed) {
      this.char.animator.playOnce('upper', 'hitUpper', 0.05);
    }
  }

  /**
   * Shove this enemy away from `from`. The stagger window matters as much as
   * the impulse: without it the per-frame steering damp in updateMelee/Ranged
   * pulls velocity straight back to the AI's intended movement and the hit
   * reads as nothing.
   */
  knockback(from: THREE.Vector3, force: number, stagger = 0.3, lift = 0.35): void {
    const dir = this.position.clone().sub(from).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1); // point-blank: shove along +Z
    dir.normalize();
    this.velocity.addScaledVector(dir, force);
    // `lift` is what separates a shove from a launch: keep it low to slide the
    // target clear along the ground, raise it when a pop is wanted (explosions)
    this.velocity.y += force * lift;
    this.stagger = Math.max(this.stagger, stagger);
  }

  /**
   * Put this enemy flat on the ground for `secs` — the big Euphoria-style hit
   * read. Only grounded humanoids go down (a swoop rider or a hover trooper
   * falling over mid-air reads as a bug, not a haymaker).
   */
  knockdown(secs = 1.8): void {
    if (!this.alive || this.def.style === 'swoop' || this.def.style === 'hover') return;
    if (this.wounded) return; // already on the ground
    this.downTimer = Math.max(this.downTimer, secs);
    this.windup = 0;
    this.volleyLeft = 0;
    const anim = this.char.animator;
    if (anim) {
      anim.release('lower'); anim.release('upper');
      anim.playOnce('lower', 'deathLower', 0.06, true);
      anim.playOnce('upper', 'deathUpper', 0.06, true);
    }
  }

  /** incoming fire, landed or close: keeps this enemy's head down */
  suppress(amount: number): void {
    if (this.team !== 0) this.suppression = Math.min(1.2, this.suppression + amount);
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
      this.velocity.y -= 22 * grav(game) * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height * 0.5, this.velocity, dt);
      if (this.deadTimer <= 0) {
        this.char.root.position.y -= dt * 1.2; // sink away
        if (this.deadTimer < -1.2) this.removeMe = true;
      }
      this.syncVisual(dt, game);
      anim?.update(dt);
      return;
    }

    this.attackCd -= dt;
    this.suppression = Math.max(0, this.suppression - dt * 0.25);
    const d = DEFS[this.kind];

    // ---- flat on the ground after a heavy hit ----
    if (this.downTimer > 0) {
      this.downTimer -= dt;
      this.velocity.x = damp(this.velocity.x, 0, 4, dt);
      this.velocity.z = damp(this.velocity.z, 0, 4, dt);
      this.velocity.y -= 24 * grav(game) * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height * 0.5, this.velocity, dt);
      if (this.downTimer <= 0) {
        // back on its feet, shaken
        const a = this.char.animator;
        if (a) { a.release('lower'); a.release('upper'); }
        this.stagger = Math.max(this.stagger, 0.25);
        this.attackCd = Math.max(this.attackCd, 0.8);
      }
      this.syncVisual(dt, game);
      anim?.update(dt);
      return;
    }

    // ---- wounded: crawling away, bleeding out ----
    if (this.wounded) {
      if (!this.woundedPosed) {
        this.woundedPosed = true;
        const a = this.char.animator;
        if (a) {
          a.release('lower'); a.release('upper');
          a.playOnce('lower', 'deathLower', 0.08, true);
          a.playOnce('upper', 'deathUpper', 0.08, true);
        }
      }
      this.bleedOut -= dt;
      // drag away from whatever did this, slowly
      const away = this.position.clone().sub(this.interest).setY(0);
      if (away.lengthSq() > 1e-4) away.normalize();
      this.velocity.x = damp(this.velocity.x, away.x * 0.7, 3, dt);
      this.velocity.z = damp(this.velocity.z, away.z * 0.7, 3, dt);
      this.velocity.y -= 24 * grav(game) * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height * 0.5, this.velocity, dt);
      if (this.bleedOut <= 0) {
        this.alive = false;
        this.deadTimer = 1.4;
      }
      this.syncVisual(dt, game);
      anim?.update(dt);
      return;
    }

    const target = this.senses(dt, game);

    // ---- broke and ran ----
    if (this.fleeing) {
      this.fleeTimer -= dt;
      const threat = this.interest;
      const away = this.position.clone().sub(threat).setY(0);
      const far = away.length();
      if (this.fleeTimer <= 0 || far > 55) {
        // rallied: turns and holds its ground out here
        this.fleeing = false;
        this.post.copy(this.position);
        this.attackCd = Math.max(this.attackCd, 0.6);
      } else if (far > 1e-2) {
        away.normalize();
        this.velocity.x = damp(this.velocity.x, away.x * d.speed * 1.05, 6, dt);
        this.velocity.z = damp(this.velocity.z, away.z * d.speed * 1.05, 6, dt);
        this.facingYaw = dampAngle(this.facingYaw, Math.atan2(away.x, away.z), 8, dt);
        this.velocity.y -= 24 * grav(game) * dt;
        game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
        if (anim) {
          anim.play('lower', 'runLower', 0.2, 1.2);
          anim.play('upper', 'runUpper', 0.2, 1.2);
        }
        this.syncVisual(dt, game);
        anim?.update(dt);
        return;
      }
    }

    if (this.stagger > 0) {
      // reeling from a hit: coast on the impulse, just bleed it off slowly
      this.stagger -= dt;
      const grounded = d.style === 'melee' || d.style === 'ranged';
      this.velocity.x = damp(this.velocity.x, 0, grounded ? 2.2 : 1.2, dt);
      this.velocity.z = damp(this.velocity.z, 0, grounded ? 2.2 : 1.2, dt);
      this.volleyLeft = 0; // interrupt any burst in progress
    } else if (this.reaction > 0) {
      // beat between noticing and reacting — turn toward it, don't move yet
      this.reaction -= dt;
      this.faceToward(dt, this.interest.x, this.interest.z, 6);
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
    } else if (target && this.visible) {
      switch (d.style) {
        case 'melee': this.updateMelee(dt, game, target); break;
        case 'ranged': this.updateRanged(dt, game, target); break;
        case 'swoop': this.updateSwoop(dt, game, target); break;
        case 'hover': this.updateHover(dt, game, target); break;
      }
    } else if (this.awareness !== 'idle') {
      // lost them, or never saw them: push to the last known position
      this.updateSearch(dt, game, this.awareness === 'engaged' ? 0.8 : 0.5);
    } else {
      this.updateIdle(dt, game);
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
      // Edge guard: on the platforms a walking enemy never steers itself into
      // the void — probe the ground a step ahead and stop at the lip. Only
      // voluntary movement is caught; a knockback can still throw them off,
      // which is half the fun of the station board.
      if (!game.board.physics.heightAt && this.stagger <= 0) {
        const sp = Math.hypot(this.velocity.x, this.velocity.z);
        // gate must be near zero: steering re-adds a trickle of velocity every
        // frame after a block, and a 0.3 m/s creep still walks off the lip
        if (sp > 0.05) {
          const ax = this.position.x + (this.velocity.x / sp) * 1.2;
          const az = this.position.z + (this.velocity.z / sp) * 1.2;
          const g = game.board.physics.groundHeight(ax, az, this.position.y + 0.5);
          if (!isFinite(g) || g < this.position.y - 3) {
            this.velocity.x = 0;
            this.velocity.z = 0;
          }
        }
      }
      this.velocity.y -= 24 * grav(game) * dt;
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

  /**
   * Refresh awareness and return the foe to fight, if any. Enemies only enter
   * combat once they can actually see a player (facing matters — you can slip
   * behind a posted guard), get shot, or are told by a squadmate.
   */
  private senses(dt: number, game: Game): Combatant | null {
    const foe = this.nearestFoe(game);
    this.target = foe;
    this.visible = false;
    this.sightTimer -= dt;
    if (this.team === 0) {
      // Allies fight whatever is near, but they escort rather than hunt: with
      // hostiles now posted all over the board, an ally that picked the
      // nearest one would jog off across the desert and never come back.
      const p = game.players.find((pl) => pl.alive) ?? game.players[0];
      // Leash the engagement to the player, not to the foe: chasing whatever
      // is nearest to *itself* walks an ally across the board one target at a
      // time. Anything worth shooting is near the person being escorted.
      const anchor = p ? p.position : this.position;
      const strayed = p ? this.position.distanceTo(p.position) > 34 : false;
      const close = foe && !strayed && foe.position.distanceTo(anchor) < 45 ? foe : null;
      this.visible = !!close;
      if (!close && p) this.interest.copy(p.position);
      return close;
    }

    if (foe && this.canSee(game, foe)) {
      this.visible = true;
      const first = this.awareness !== 'engaged';
      this.awareness = 'engaged';
      this.memory = MEMORY;
      this.interest.copy(foe.position);
      if (first) {
        this.reaction = Math.max(this.reaction, 0.2 + Math.random() * 0.4);
        const bark = SPAWN_BARKS[this.kind];
        if (bark) audio.bark(bark, 0.35);
        game.director.alertSquad(game, this, foe.position);
      }
      return foe;
    }

    if (this.awareness !== 'idle') {
      this.memory -= dt;
      if (this.memory <= 0) {
        this.awareness = 'idle';
        this.idleTimer = 0; // pick a fresh loiter goal, which walks it back to post
      }
    }
    return this.awareness === 'engaged' ? foe : null;
  }

  /** line of sight plus a facing cone — sneaking up from behind works */
  private canSee(game: Game, foe: Combatant): boolean {
    const d = DEFS[this.kind];
    const dx = foe.position.x - this.position.x;
    const dz = foe.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > d.notice) return false;
    const inv = 1 / (dist || 1);
    const dot = (dx * inv) * Math.sin(this.facingYaw) + (dz * inv) * Math.cos(this.facingYaw);
    // ahead: full range; peripheral: about half; behind: only right on top of them
    const range = dot > 0.25 ? d.notice : dot > -0.35 ? d.notice * 0.5 : 8;
    if (dist > range) { this.sightMemo = false; return false; }
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.2 + (this.id % 5) * 0.03;
      this.sightMemo = this.hasLineOfSight(game, foe);
    }
    return this.sightMemo;
  }

  /** posted and unbothered: mill around the post, look around, hold the ground */
  private updateIdle(dt: number, game: Game): void {
    const d = DEFS[this.kind];
    const air = d.style === 'swoop' || d.style === 'hover';
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.idleTimer = 2.5 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * (air ? 10 : 5);
      this.idleGoal.set(
        this.post.x + Math.cos(a) * r,
        this.post.y + (air ? 3 + Math.random() * 5 : 0),
        this.post.z + Math.sin(a) * r
      );
      this.idleYaw = Math.random() * Math.PI * 2;
    }
    const to = this.idleGoal.clone().sub(this.position);
    const flat = Math.hypot(to.x, to.z);
    const speed = Math.min(d.speed * 0.32, air ? 4 : 2.6);
    if (flat > 1.2) {
      const inv = 1 / flat;
      this.velocity.x = damp(this.velocity.x, to.x * inv * speed, 4, dt);
      this.velocity.z = damp(this.velocity.z, to.z * inv * speed, 4, dt);
      this.faceToward(dt, this.idleGoal.x, this.idleGoal.z, 4);
    } else {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
      this.facingYaw = dampAngle(this.facingYaw, this.idleYaw, 2, dt);
    }
    if (air) this.velocity.y = damp(this.velocity.y, clamp(to.y, -2.5, 2.5), 2.5, dt);
  }

  /** heading for the last thing it saw or heard */
  private updateSearch(dt: number, game: Game, speedScale: number): void {
    const d = DEFS[this.kind];
    // pinned applies here too: advancing into fire is exactly what stops
    if (this.suppression > 0.55 && d.style !== 'swoop') {
      this.faceToward(dt, this.interest.x, this.interest.z, 5);
      this.velocity.x = damp(this.velocity.x, 0, 8, dt);
      this.velocity.z = damp(this.velocity.z, 0, 8, dt);
      return;
    }
    const air = d.style === 'swoop' || d.style === 'hover';
    const to = this.interest.clone().sub(this.position);
    const flat = Math.hypot(to.x, to.z);
    this.faceToward(dt, this.interest.x, this.interest.z, 5);
    if (flat > (air ? 7 : 2.5)) {
      const inv = 1 / flat;
      const sp = d.speed * speedScale;
      this.velocity.x = damp(this.velocity.x, to.x * inv * sp, 5, dt);
      this.velocity.z = damp(this.velocity.z, to.z * inv * sp, 5, dt);
    } else {
      // arrived and found nothing — give it a moment, then head home
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
      this.memory = Math.min(this.memory, 2.5);
    }
    if (air) this.velocity.y = damp(this.velocity.y, clamp(to.y, -3, 3), 3, dt);
  }

  /**
   * Scan the board's collision boxes for a spot that hides this enemy from
   * `target`: standing on the far side of a box tall enough to block the
   * chest-to-eye sightline, with a peek position off the box's edge where the
   * sightline opens again. Raycast-heavy, so callers throttle it.
   */
  private findCover(game: Game, target: Combatant): { hide: THREE.Vector3; peek: THREE.Vector3 } | null {
    const phys = game.board.physics;
    const eye = target.position.clone();
    eye.y += 1.5;
    let best: { hide: THREE.Vector3; peek: THREE.Vector3 } | null = null;
    let bestD = Infinity;
    for (const b of phys.boxes) {
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      let dx = cx - target.position.x, dz = cz - target.position.z;
      const dl = Math.hypot(dx, dz);
      if (dl < 1e-3 || dl > 60) continue;
      dx /= dl; dz /= dl;
      // hide point just past the box on the side away from the target
      const ext = Math.abs(dx) * (b.max.x - b.min.x) / 2 + Math.abs(dz) * (b.max.z - b.min.z) / 2 + this.radius + 0.35;
      const hx = cx + dx * ext, hz = cz + dz * ext;
      const d = Math.hypot(hx - this.position.x, hz - this.position.z);
      if (d > 16 || d >= bestD) continue;
      // must be a spot it can actually fight from — cover out past blaster
      // range is just hiding, and hiding doesn't win territory
      if (Math.hypot(hx - target.position.x, hz - target.position.z) > DEFS[this.kind].attackRange * 0.9) continue;
      const gy = phys.groundHeight(hx, hz, this.position.y + 0.5);
      if (!isFinite(gy) || Math.abs(gy - this.position.y) > 2.2) continue; // off the platform / different floor
      if (b.max.y - gy < 1.1) continue; // too low to hide a standing humanoid
      // Must actually block the sightline — both ways. The muzzle check is
      // the same ray updateVolley uses (chest to target), so "hidden" also
      // means "holds fire"; without it, marginal cover like the barrels lets
      // a hiding shooter squeeze rounds over the top.
      const chest = new THREE.Vector3(hx, gy + this.height * 0.75, hz);
      const toC = chest.clone().sub(eye);
      const cd = toC.length();
      toC.normalize();
      if (!phys.raycast(eye, toC, cd)) continue;
      const muzzleTo = new THREE.Vector3(target.position.x, target.position.y + 1, target.position.z).sub(chest);
      const md = muzzleTo.length();
      muzzleTo.normalize();
      if (!phys.raycast(chest, muzzleTo, md)) continue;
      // peek point off one edge, where the sightline opens back up
      const tx = -dz, tz = dx;
      const lat = Math.abs(tx) * (b.max.x - b.min.x) / 2 + Math.abs(tz) * (b.max.z - b.min.z) / 2 + this.radius + 0.45;
      for (const side of [1, -1]) {
        const px = hx + tx * lat * side, pz = hz + tz * lat * side;
        const pgy = phys.groundHeight(px, pz, this.position.y + 0.5);
        if (!isFinite(pgy) || Math.abs(pgy - gy) > 1.2) continue;
        const pchest = new THREE.Vector3(px, pgy + this.height * 0.75, pz);
        const pMuzzle = new THREE.Vector3(target.position.x, target.position.y + 1, target.position.z).sub(pchest);
        const pmd = pMuzzle.length();
        pMuzzle.normalize();
        if (phys.raycast(pchest, pMuzzle, pmd)) continue; // peek blocked too — useless
        if (!this.pathOk(phys, hx, hz)) break;     // can't walk there (a gap between platforms)
        best = { hide: new THREE.Vector3(hx, gy, hz), peek: new THREE.Vector3(px, pgy, pz) };
        bestD = d;
        break;
      }
    }
    return best;
  }

  /** straight walk there without stepping into a void (station platforms) */
  private pathOk(phys: import('../core/physics').PhysicsWorld, x: number, z: number): boolean {
    if (phys.heightAt) return true; // solid ground everywhere
    const dx = x - this.position.x, dz = z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 2));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const g = phys.groundHeight(this.position.x + dx * t, this.position.z + dz * t, this.position.y + 0.5);
      if (!isFinite(g) || g < this.position.y - 2.5) return false;
    }
    return true;
  }

  /**
   * The cover loop: settle in behind the box, wait a beat, step out to the
   * peek point, fire, duck back. Suppression stretches the hiding — pouring
   * fire at a crate genuinely keeps the shooter behind it.
   */
  private updateCover(dt: number, game: Game, target: Combatant): void {
    const spot = this.cover!;
    const d = DEFS[this.kind];
    const goal = this.coverState === 'peek' ? spot.peek : spot.hide;
    const gx = goal.x - this.position.x, gz = goal.z - this.position.z;
    const gd = Math.hypot(gx, gz);
    this.faceToward(dt, target.position.x, target.position.z, 7);
    if (gd > 0.7) {
      const inv = 1 / gd;
      this.velocity.x = damp(this.velocity.x, gx * inv * d.speed * 0.95, 7, dt);
      this.velocity.z = damp(this.velocity.z, gz * inv * d.speed * 0.95, 7, dt);
    } else {
      this.velocity.x = damp(this.velocity.x, 0, 9, dt);
      this.velocity.z = damp(this.velocity.z, 0, 9, dt);
    }

    switch (this.coverState) {
      case 'seek':
        if (gd < 0.8) {
          this.coverState = 'hide';
          this.coverTimer = (0.6 + Math.random() * 1.2) * (this.committed ? 0.45 : 1);
          this.volleyLeft = 0; // ducking means holding fire
        }
        break;
      case 'hide':
        // pinned shooters stay hidden — this is what suppression buys
        this.coverTimer -= this.suppression > 0.55 ? dt * 0.3 : dt;
        if (this.coverTimer <= 0) {
          this.coverState = 'peek';
          this.coverTimer = 2.4;
          this.peekFired = false;
          this.attackCd = Math.min(this.attackCd, 0.25); // pop out ready to fire
        }
        break;
      case 'peek': {
        this.coverTimer -= dt;
        if (this.volleyLeft > 0) this.peekFired = true;
        const done = (this.peekFired && this.volleyLeft === 0) || this.coverTimer <= 0;
        if (done && gd < 1.2) {
          this.coverState = 'hide';
          this.coverTimer = (0.9 + Math.random() * 1.3) * (this.committed ? 0.45 : 1);
          this.volleyLeft = 0; // duck: any rounds left in the burst stay unfired
          // now and then abandon the crate and work a new angle
          if (Math.random() < 0.2) this.cover = null;
        }
        break;
      }
    }

    // Shooting only while out of cover: the sightline check handles most of
    // it, but separation shoves can hold a hider half a metre off its spot
    // where the crate no longer fully blocks — so hiding simply holds fire.
    if (this.coverState !== 'hide') {
      const dist = Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z);
      this.updateVolley(dt, game, target, dist);
    }
  }

  /**
   * Steer to a standing position `radius` out from the target on this enemy's
   * director-assigned bearing. Squads spread around their target instead of
   * piling into the same spot, and holding a bearing is what lets non-committed
   * fighters wait their turn instead of all charging at once.
   */
  private holdBearing(dt: number, target: Combatant, radius: number, speedScale = 1): void {
    const d = DEFS[this.kind];
    const ax = target.position.x + Math.cos(this.slotAngle) * radius;
    const az = target.position.z + Math.sin(this.slotAngle) * radius;
    const dx = ax - this.position.x, dz = az - this.position.z;
    const dist = Math.hypot(dx, dz);
    this.faceToward(dt, target.position.x, target.position.z, 7);
    if (dist < 1.5) {
      // in position: shuffle sideways so they aren't statues
      this.strafePhase += dt;
      const s = Math.sin(this.strafePhase * 0.8 + this.id) * 0.9;
      const tx = target.position.x - this.position.x, tz = target.position.z - this.position.z;
      const ti = 1 / (Math.hypot(tx, tz) || 1);
      this.velocity.x = damp(this.velocity.x, -tz * ti * s, 4, dt);
      this.velocity.z = damp(this.velocity.z, tx * ti * s, 4, dt);
      return;
    }
    const inv = 1 / dist;
    const sp = d.speed * speedScale;
    this.velocity.x = damp(this.velocity.x, dx * inv * sp, 6, dt);
    this.velocity.z = damp(this.velocity.z, dz * inv * sp, 6, dt);
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

    // Not our turn: hold at a standoff on the assigned bearing and wait for an
    // opening. Only the handful of fighters the director commits actually rush,
    // which is what keeps a group from becoming a conga line into the gaffi.
    if (!this.committed && dist < 20) {
      this.holdBearing(dt, target, 9 + (this.id % 3) * 1.7, 0.8);
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

    // ---- cover first: a shooter with a crate to fight from uses it ----
    // Everyone works the boxes — settle behind one, peek out, fire, duck
    // back. Committed shooters run the same loop at a much faster tempo, so
    // the director's pressure roles survive: they dart between peeks instead
    // of camping. Cover points are ground- and path-validated, so this also
    // overrides the station leash below: the crate is a safe destination.
    if (this.team === 1) {
      this.coverRetry -= dt;
      if (!this.cover && this.coverRetry <= 0) {
        this.cover = this.findCover(game, target);
        this.coverRetry = 1.4 + Math.random(); // the search raycasts; don't spam it
        if (this.cover) this.coverState = 'seek';
      }
      if (this.cover) {
        // flanked? if the hide spot no longer blocks the sightline, drop it
        this.coverCheck -= dt;
        if (this.coverCheck <= 0) {
          this.coverCheck = 0.8;
          const eye = target.position.clone();
          eye.y += 1.5;
          const chest = this.cover.hide.clone();
          chest.y += this.height * 0.75;
          const toC = chest.sub(eye);
          const cd = toC.length();
          if (!game.board.physics.raycast(eye, toC.normalize(), cd)) this.cover = null;
        }
      }
      if (this.cover) {
        this.updateCover(dt, game, target);
        return;
      }
    }

    if (game.board.kind === 'station' && this.team === 1) {
      // platforms: never walk off the edge chasing a firing angle
      const lx = this.spawnPos.x - this.position.x, lz = this.spawnPos.z - this.position.z;
      const ld = Math.hypot(lx, lz);
      if (ld > 4) {
        this.velocity.x = damp(this.velocity.x, (lx / ld) * d.speed, 6, dt);
        this.velocity.z = damp(this.velocity.z, (lz / ld) * d.speed, 6, dt);
        this.updateVolley(dt, game, target, dist);
        return;
      }
    }

    // Pinned: under enough incoming fire a shooter stops working its firing
    // position — it plants where it is, shrinks, and its return fire goes
    // ragged. Pouring shots at a camp genuinely keeps heads down.
    if (this.suppression > 0.55) {
      this.velocity.x = damp(this.velocity.x, 0, 8, dt);
      this.velocity.z = damp(this.velocity.z, 0, 8, dt);
      this.updateVolley(dt, game, target, dist);
      return;
    }

    // Work a firing position on the assigned bearing: committed shooters press
    // in to a shorter range, the rest hold the line further out and suppress.
    // Everyone still shoots, so the player is under fire from several angles
    // rather than being swarmed from one.
    const band = this.committed
      ? clamp(d.attackRange * 0.5, 9, 18)
      : clamp(d.attackRange * 0.85, 15, 30);
    this.holdBearing(dt, target, band, this.committed ? 1 : 0.85);

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
      // a pinned shooter pops up less often
      this.attackCd = d.attackCd * (this.suppression > 0.55 ? 1.6 : 1);
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
    // suppression wrecks the aim: shots snatched from behind cover go wide
    const err = 1 + this.suppression * 1.6;
    aim.x += (Math.random() - 0.5) * 1.6 * err;
    aim.y += (Math.random() - 0.5) * 1.2 * err;
    aim.z += (Math.random() - 0.5) * 1.6 * err;
    const dir = aim.sub(from).normalize();
    game.projectiles.fire(from, dir, d.boltSpeed ?? 28, d.damage, this.team);
    // a firefight pulls in whoever is posted nearby — an ally's covering fire
    // gives the position away just as readily as a hostile's
    game.director.noise(game, this.position, this.team === 1 ? 30 : 40);
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
    // hover jets — a short burn under each nozzle, riding along with us
    for (const side of [-1, 1]) {
      const fs = Math.sin(this.facingYaw), fc = Math.cos(this.facingYaw);
      const p = new THREE.Vector3(
        this.position.x - fs * 0.18 + fc * 0.08 * side,
        this.position.y + 1.1,
        this.position.z - fc * 0.18 - fs * 0.08 * side,
      );
      game.particles.jetPlume(p, _JET_DOWN, dt, { power: 0.7, carrier: this.velocity });
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
