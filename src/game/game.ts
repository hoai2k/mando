import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Board, Breakable } from '../world/board';
import { Player } from '../player/player';
import { Enemy, ENEMY_NAME, type Combatant, type EnemyKind } from '../enemies/enemy';
import { ALLY_WAVES, FINAL_WAVE, MID_BOSS_WAVE, spawnWave, standingSpot, waveComposition } from '../enemies/spawner';
import { CombatDirector } from '../enemies/director';
import { ProjectileSystem, type BoltTarget } from '../fx/projectiles';
import { playableDef, type PlayableId } from '../characters/roster';
import { ParticleFX } from '../fx/particles';
import { audio } from '../core/audio';
import { yawBasis } from '../core/math';
import { glRect, splitLayout } from '../core/layout';
import { loadOptionalTexture } from '../core/assets';
import { disposeSubtree } from '../core/dispose';
import { ENEMY_MODEL_ID, preloadAuthored } from '../characters/authored';
import type { FrameInput } from '../core/input';
import { spawnVehicles, type Vehicle } from './vehicles';
import { BOSS_KIND, BOSS_NAME, BOSS_RETINUE, MID_BOSS, MONSTER_BOSS, type GameMode } from './modes';
import { Campaign } from './campaign';

export type MatchState = 'intro' | 'fighting' | 'break' | 'victory' | 'defeat';

/** length of the boss introduction card, in real seconds */
const BOSS_INTRO_LEN = 3.4;
/** the quake between the warlord falling and the monster surfacing */
const MONSTER_QUAKE_LEN = 4;
/** simulation rate under the card — slow enough to read as a held breath */
const BOSS_INTRO_TIMESCALE = 0.12;

/** hands-off-the-sticks input, fed to everyone while the boss card is up */
const BLANK_INPUT: FrameInput = {
  moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
  dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
  meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
  zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
  throttleHeld: false, brakeHeld: false,
};

export interface GameEvents {
  banner: (text: string, sub?: string) => void;
  /** the boss introduction card: letterbox + name, over the slow-motion reveal */
  bossIntro?: (title: string, sub: string) => void;
  /** the little card naming enemy kinds making their first appearance this wave */
  newContacts?: (names: string[]) => void;
  stateChanged: (s: MatchState) => void;
  hitMarker: (slot: number) => void;
}

/** a bolt target that lives in the pool, remembering what it stands for */
interface PooledTarget extends BoltTarget {
  position: THREE.Vector3;
  enemy: Enemy | null;
  player: Player | null;
  breakable?: Breakable | null;
  vehicle?: Vehicle | null;
}

/** the rocket mesh's own axis, for orienting it along its velocity */
const UP = new THREE.Vector3(0, 1, 0);

interface Rocket {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  target: Combatant | null;
  life: number;
  bySlot: number;
}

export class Game {
  scene = new THREE.Scene();
  players: Player[] = [];
  enemies: Enemy[] = [];
  allies: Enemy[] = [];
  /** rides parked around the board (PLAN.md §17) */
  vehicles: Vehicle[] = [];
  projectiles = new ProjectileSystem();
  particles = new ParticleFX();
  /** spreads alerts and decides who is allowed to push the player */
  director = new CombatDirector();
  time = 0;
  wave = 0;
  state: MatchState = 'intro';
  private stateTimer = 2.2;
  private rockets: Rocket[] = [];
  private tmpSize = new THREE.Vector2();
  /** the world seen from below the surface: dense teal murk */
  private underFog = new THREE.Fog(0x0d3240, 2, 52);
  private underColor = new THREE.Color(0x0d3240);
  private envSource: THREE.Texture | null = null;
  private envBuilt = false;
  /** PMREM output; three hands back a render target that has to be freed too */
  private envRT: THREE.WebGLRenderTarget | null = null;
  /** set by dispose(), so async loads that land afterwards stay out of a dead scene */
  private disposed = false;
  private rocketGeo = new THREE.ConeGeometry(0.09, 0.42, 6);
  /**
   * Bolt targets, reused frame to frame. Rebuilding ~45 of these every frame —
   * each with a freshly cloned vector and a freshly allocated onHit closure —
   * was the update loop's largest source of garbage. The entries are filled in
   * place instead; `targets` is the same array object every frame.
   */
  private targetPool: PooledTarget[] = [];
  private targets: BoltTarget[] = [];
  /** scratch for the rocket integration */
  private rkTo = new THREE.Vector3();
  private rkStep = new THREE.Vector3();
  private rkDir = new THREE.Vector3();
  private rocketMat = new THREE.MeshBasicMaterial({ color: 0xffd090 });
  totalKills = 0;
  elapsed = 0;
  /** seconds spent on the current wave, for the hunt escalation below */
  private waveTimer = 0;
  /** hostiles this wave put on the board — see the wave-clear check */
  private waveSpawned = 0;
  private huntCall = 0;
  private huntAnnounced = false;
  // ---- modes (docs/MODES.md) ----
  /** the standing boss battle — the mid-board champion or the warlord */
  boss: Enemy | null = null;
  /** true while the mid-board boss battle (rung in after wave MID_BOSS_WAVE) runs */
  private midBossActive = false;
  /** the champion has fallen; the second run of waves is open */
  private midBossDown = false;
  private bossPhase = 0;
  /** seconds left of the boss introduction: slow-motion, cameras on the warlord */
  bossIntroT = 0;
  /** countdown to the boss's shock-slam; re-armed after each one */
  private bossMoveCd = 0;
  /** seconds left of the slam telegraph — the get-out-of-range window */
  private bossTelegraph = 0;
  /**
   * The monster stage (docs/BOSSES.md): where the warlord fell, and how long
   * the ground has left to shake before the thing under it comes up. Both
   * modes read `monsterStaging` to know the fight is not over yet — the wave
   * game would otherwise call victory into an empty field, and the campaign
   * would walk the party on past a boss step that has not finished.
   */
  private monsterAt: THREE.Vector3 | null = null;
  private monsterQuake = 0;
  /** the monster is on the field; its retinue answers to it, not the board's */
  private monsterKind: EnemyKind | null = null;
  /** campaign controller; null outside campaign mode */
  campaign: Campaign | null = null;
  /** PvP: the slot that took the territory, for the end screen */
  winnerSlot = -1;
  /** per-frame cache behind hostilesFor */
  private hostileCache = new Map<number, Combatant[]>();

  constructor(public board: Board, playerCount: number, aspect: number, private events: GameEvents,
    characters: PlayableId[] = ['din', 'paz'], public mode: GameMode = 'wave') {
    this.scene.add(board.group);
    this.scene.add(this.projectiles.group);
    this.scene.add(this.particles.group);
    this.scene.background = board.background;
    this.scene.fog = board.fog;

    // authored equirect panorama replaces the procedural sky dome when present
    if (board.skyFile) {
      loadOptionalTexture(board.skyFile, (tex) => {
        // the panorama is megabytes; quitting or restarting mid-download used
        // to drop it into a torn-down scene, orphaning the decoded texture
        if (this.disposed) { tex.dispose(); return; }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.background = tex;
        this.scene.backgroundIntensity = board.skyIntensity ?? 1;
        this.envSource = tex;
        this.envBuilt = false;   // rebuild the reflection probe off the real sky
        if (board.proceduralSky) board.proceduralSky.visible = false;
      });
    }

    for (let i = 0; i < playerCount; i++) {
      const p = new Player(i, aspect, characters[i] ?? 'din');
      if (mode === 'pvp') {
        // every fighter is their own side; 0/1 stay meaningful as co-op/hostile
        p.team = 2 + i;
        p.lives = 2; // three stands in total
        p.spawnAt(this.pvpSpawn(i));
      } else {
        p.spawnAt(this.startFor(board, i));
      }
      p.char.setHeroLight(board.heroLight ?? 0);
      this.scene.add(p.char.root);
      this.players.push(p);
    }
    // PvP squad leaders bring their fireteam (docs/MODES.md §3)
    if (mode === 'pvp') for (const p of this.players) this.spawnSquadFor(p);

    if (mode === 'campaign') {
      // raises the mission level over the territory and moves the party to its
      // trailhead; every player keeps their own camera, split-screen as ever
      this.campaign = new Campaign(this);
    }

    this.vehicles = spawnVehicles(board, this.scene);


    // a bolt turned around by a shield: sparks at the pane, and the blocker
    // feels it land
    this.projectiles.onDeflect = (point) => {
      this.particles.impactSparks(point, 10);
      audio.impact();
      for (const p of this.players) {
        if (p.position.distanceToSquared(point) >= 2.5 * 2.5) continue;
        if (p.blocking) {
          p.char.shieldHit();
          p.cam.shake(0.05);
        } else if (p.sabersDrawn) {
          // no pane to flash: the blade sells it on sound and a short jolt
          audio.saberDeflect();
          p.cam.shake(0.035);
        }
      }
    };
    this.projectiles.onWaterHit = (point) => {
      this.particles.splash(point, 5);
    };
    this.projectiles.onImpact = (point, hitTarget, team) => {
      this.particles.impactSparks(point, hitTarget ? 12 : 6);
      audio.impact();
      // player bolts slamming into the dirt next to someone still count as
      // incoming fire — near misses are what keep heads down
      if (team === 0 && !hitTarget) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (e.position.distanceToSquared(point) < 4.5 * 4.5) e.suppress(0.22);
        }
      }
    };

    // The intro banner buys a couple of seconds; spend them fetching the models
    // wave one is about to need, rather than parsing them on the spawn frame.
    if (mode === 'wave') {
      this.preloadWave(1);
      // The three allies are certain to appear in a full match and are only three
      // files, so warm them now rather than the instant one walks into a firefight.
      for (const kind of Object.values(ALLY_WAVES)) {
        const id = ENEMY_MODEL_ID[kind];
        if (id) preloadAuthored(id);
      }
    }
    // wave and campaign both run the champion and end at the territory's
    // warlord: warm both models now
    if (mode !== 'pvp') {
      for (const kind of [MID_BOSS[board.kind].kind, BOSS_KIND[board.kind]]) {
        const bossId = ENEMY_MODEL_ID[kind];
        if (bossId) preloadAuthored(bossId);
      }
    }

    audio.startAmbient(board.ambience.sample, board.ambience.bed);
    audio.startMusic(board.music, board.kind);
    const objective = mode === 'pvp' ? 'Last fighter standing takes it'
      : mode === 'campaign' ? 'Follow the beacon · liberate the territory'
        : board.objective ?? 'Survive 7 waves and two warlords';
    this.events.banner(board.name, objective);
  }

  /** PvP spawns: the board's own posts, farthest-first so fighters start apart. */
  private pvpSpawn(slot: number, awayFrom?: THREE.Vector3): THREE.Vector3 {
    const spawns = this.board.groundSpawns;
    if (!spawns.length) return this.startFor(this.board, slot);
    const others = this.players.filter((p) => p.alive).map((p) => p.position);
    if (awayFrom) others.push(awayFrom);
    let best = spawns[slot % spawns.length];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const o of others) d = Math.min(d, s.distanceToSquared(o));
      if (others.length === 0) d = Math.random();
      if (d > bestD) { bestD = d; best = s; }
    }
    return standingSpot(this.board, best.clone().add(new THREE.Vector3(0, 0.2, 0)), 'pyke');
  }

  /** spawn (or re-spawn) a PvP squad leader's AI fireteam beside them */
  private spawnSquadFor(p: Player): void {
    const squad = playableDef(p.characterId).profile.squad;
    if (!squad) return;
    // any followers it still has stay; only the missing places are refilled
    const have = this.enemies.filter((e) => e.owner === p && e.alive).length;
    for (let i = have; i < squad.count; i++) {
      const a = (i / squad.count) * Math.PI * 2;
      const at = standingSpot(this.board, p.position.clone().add(new THREE.Vector3(Math.cos(a) * 2.5, 0.2, Math.sin(a) * 2.5)), squad.kind);
      const e = new Enemy(squad.kind, at, p.team);
      e.setOwner(p);
      this.enemies.push(e);
      this.scene.add(e.char.root);
      this.particles.dustPuff(at, 6);
    }
  }

  /**
   * Everything alive that `who` may fight: any combatant on another team.
   * One list per team per frame — every aim cone, melee sweep and rocket
   * seeker reads the same referee, which is what makes PvP work at all.
   */
  hostilesFor(who: { team: number }): Combatant[] {
    let list = this.hostileCache.get(who.team);
    if (list) return list;
    list = [];
    for (const e of this.enemies) if (e.alive && e.team !== who.team) list.push(e);
    for (const p of this.players) if (p.alive && p.team !== who.team) list.push(p);
    for (const a of this.allies) if (a.alive && a.team !== who.team) list.push(a);
    this.hostileCache.set(who.team, list);
    return list;
  }

  /** the campaign controller's mouthpiece (events is private) */
  announce(text: string, sub?: string): void {
    this.events.banner(text, sub);
  }

  /**
   * Spawn a boss battle (docs/MODES.md §4a) at `pos` with a small honour
   * guard. `tier` picks the fight: the mid-board champion (MID_BOSS, a
   * lighter promotion and a thinner guard) or the territory's warlord.
   * Shared by the wave game's boss battles and the campaign's two arenas.
   */
  spawnBoss(pos: THREE.Vector3, tier: 'mid' | 'final' = 'final'): Enemy {
    const mid = MID_BOSS[this.board.kind];
    const kind = tier === 'mid' ? mid.kind : BOSS_KIND[this.board.kind];
    const at = this.campaign
      ? this.campaign.placeNear(pos.clone(), kind)
      : standingSpot(this.board, pos.clone(), kind);
    const boss = new Enemy(kind, at);
    if (tier === 'mid') boss.promoteBoss(mid.name, mid.hp, mid.dmg, mid.bulk);
    else boss.promoteBoss(BOSS_NAME[this.board.kind]);
    // On a monster board the warlord is the herald: remember where it made its
    // stand, and the monster comes up there when it falls.
    if (tier === 'final' && MONSTER_BOSS[this.board.kind]) this.monsterAt = at.clone();
    this.waveSpawned++;
    this.enemies.push(boss);
    this.scene.add(boss.char.root);
    this.particles.explosion(at.clone());
    this.boss = boss;
    this.bossPhase = 0;
    const guard = BOSS_RETINUE[this.board.kind];
    const guards = tier === 'mid' ? 2 : 3;
    for (let i = 0; i < guards; i++) {
      const a = (i / guards) * Math.PI * 2;
      this.addReinforcement(guard, at.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0.2, Math.sin(a) * 6)), 9900);
    }
    // The introduction: three and a half seconds of slow motion with every
    // camera on the warlord, under the letterboxed name card. Everyone on the
    // field keeps their head down through it, so the reveal is never a cheap
    // shot in either direction.
    this.bossIntroT = BOSS_INTRO_LEN;
    this.bossMoveCd = 8;
    this.bossTelegraph = 0;
    for (const e of this.enemies) if (e.alive) e.suppress(1.2);
    const sub = tier === 'mid' ? `Champion of ${this.board.name}` : `Warlord of ${this.board.name}`;
    if (this.events.bossIntro) this.events.bossIntro(boss.bossName, sub);
    else this.events.banner(boss.bossName, 'Bring them down');
    audio.bossHorn();
    return boss;
  }

  /** how deep into the fight the warlord is, 0..2 — the HUD tints its bar by this */
  get bossPhaseLevel(): number { return this.bossPhase; }

  /**
   * True while the warlord is down but the fight is not over: the ground is
   * shaking and the monster has not surfaced yet. Nothing that ends an
   * encounter — the wave game's victory check, the campaign's boss step — may
   * fire while this holds.
   */
  get monsterStaging(): boolean { return this.monsterQuake > 0 || this.monsterAt !== null; }

  /**
   * The second stage (docs/BOSSES.md §1): the warlord falls, the ground shakes
   * for a few seconds, and the board's monster erupts with its own entrance.
   *
   * Deliberately the same `spawnBoss` furniture rather than a parallel one —
   * introduction card, bar, phase turns, retinue calls, enrage — because the
   * monster's `Def` already carries its final numbers. `promoteBoss(name, 1, 1, 1)`
   * hangs the banner on it and scales nothing.
   */
  private updateMonsterStage(dt: number): void {
    const monster = MONSTER_BOSS[this.board.kind];
    if (!monster) return;

    // the warlord is down and the monster has not been called: start the quake
    if (this.monsterAt && this.boss && !this.boss.alive && this.monsterQuake <= 0) {
      this.monsterQuake = MONSTER_QUAKE_LEN;
      this.events.banner('Something is coming up', 'the ground will not hold');
      audio.mythosaur(0.6);
      for (const p of this.players) p.cam.shake(0.5);
      return;
    }
    if (this.monsterQuake <= 0) return;

    this.monsterQuake -= dt;
    // a rolling shake rather than one jolt, so the beat builds
    for (const p of this.players) p.cam.shake(0.12);
    if (this.monsterQuake > 0) return;

    const wanted = (this.monsterAt ?? this.players[0].position).clone();
    const at = this.campaign
      ? this.campaign.placeNear(wanted, monster.kind)
      : standingSpot(this.board, wanted, monster.kind);
    this.monsterAt = null;
    const beast = new Enemy(monster.kind, at);
    beast.promoteBoss(monster.name, 1, 1, 1);
    this.waveSpawned++;
    this.enemies.push(beast);
    this.scene.add(beast.char.root);
    this.particles.explosion(at.clone());
    this.boss = beast;
    this.monsterKind = monster.kind;
    this.bossPhase = 0;
    this.bossIntroT = BOSS_INTRO_LEN;
    this.bossMoveCd = 8;
    this.bossTelegraph = 0;
    for (const e of this.enemies) if (e.alive) e.suppress(1.2);
    const sub = `The ${this.board.name} was never empty`;
    if (this.events.bossIntro) this.events.bossIntro(monster.name, sub);
    else this.events.banner(monster.name, sub);
    audio.bossHorn();
    audio.beastGrowl(0.9);
  }

  /**
   * The boss fight's rhythm (docs/MODES.md §4a): phase turns at ⅔ and ⅓ health
   * — a repulsor pulse that throws everyone off the warlord, a retinue call,
   * and at the last third an enrage — plus a telegraphed shock-slam whenever
   * someone camps inside arm's reach too long. The pulse deals no damage and
   * the slam is survivable but emphatic: the fight punishes standing still,
   * never punishes approaching.
   */
  private updateBoss(dt: number): void {
    const b = this.boss;
    if (!b || !b.alive || this.state !== 'fighting') return;

    // ---- phase turns ----
    const frac = b.hp / b.maxHp;
    const due = frac < 1 / 3 ? 2 : frac < 2 / 3 ? 1 : 0;
    if (due > this.bossPhase) {
      this.bossPhase = due;
      // a monster calls its own hangers-on, not the board's garrison
      const guard = (this.monsterKind === b.kind
        ? MONSTER_BOSS[this.board.kind]?.retinue
        : undefined) ?? BOSS_RETINUE[this.board.kind];
      const lead = this.players.find((p) => p.alive) ?? this.players[0];
      for (let i = 0; i < 3 + due; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = this.addReinforcement(guard, b.position.clone().add(new THREE.Vector3(Math.cos(a) * 10, 0.2, Math.sin(a) * 10)), 9900 + due);
        if (lead) e.alert(lead.position, true);
      }
      // the turn itself is a beat: a damage-free repulsor pulse breaks any
      // melee scrum so the new phase starts at range, on both sides' terms
      this.bossShockwave(b, 10, 0, 9);
      if (due === 2) b.enrage();
      this.events.banner(b.bossName, due === 1 ? 'They call for backup' : 'Enraged — a last stand');
      audio.bossHorn(false);
    }

    // ---- the shock-slam: the anti-camping move ----
    if (this.bossIntroT > 0) return;
    if (this.bossTelegraph > 0) {
      // winding up: ember ring so the radius is readable, then the hit
      this.bossTelegraph -= dt;
      if (Math.floor((this.bossTelegraph + dt) * 8) !== Math.floor(this.bossTelegraph * 8)) {
        const a = Math.random() * Math.PI * 2;
        this.particles.impactSparks(b.position.clone().add(new THREE.Vector3(Math.cos(a) * 3, 0.4, Math.sin(a) * 3)), 4);
      }
      if (this.bossTelegraph <= 0) {
        this.bossShockwave(b, 8.5, 26, 12);
        this.particles.explosion(b.position.clone());
        this.bossMoveCd = 11 + Math.random() * 4;
      }
      return;
    }
    this.bossMoveCd -= dt;
    if (this.bossMoveCd <= 0) {
      const near = this.players.some((p) => p.alive && p.position.distanceToSquared(b.position) < 12 * 12);
      if (!near) { this.bossMoveCd = 2; return; }   // nobody to punish — re-check soon
      this.bossTelegraph = 1.15;
      audio.impact();
    }
  }

  /** throw every player inside `radius` up and away from the warlord */
  private bossShockwave(b: Enemy, radius: number, dmg: number, push: number): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      const away = p.position.clone().sub(b.position);
      const d = away.setY(0).length();
      if (d > radius) continue;
      away.normalize();
      if (dmg > 0) p.damage(dmg, b.position);
      p.velocity.y = Math.max(p.velocity.y, push * 0.8);
      p.velocity.x += away.x * push;
      p.velocity.z += away.z * push;
      p.cam.shake(dmg > 0 ? 0.3 : 0.15);
    }
    audio.explosion();
  }

  /**
   * Add a hostile mid-wave (brood spawns, reinforcement events). It counts
   * toward the wave like anything the spawner posted, so the clear check and
   * the radar tally stay honest.
   */
  addReinforcement(kind: EnemyKind, pos: THREE.Vector3, squad = 0): Enemy {
    // Same guard the wave spawner uses: whoever asked for this position was
    // not looking at the colliders, and a body dropped inside one is ejected
    // through its nearest face on the first frame. In a mission the placement
    // stays inside the level — the board-wide fallback is ninety metres down.
    pos = this.campaign ? this.campaign.placeNear(pos, kind) : standingSpot(this.board, pos, kind);
    const e = new Enemy(kind, pos);
    e.squad = squad;
    this.waveSpawned++;
    this.enemies.push(e);
    this.scene.add(e.char.root);
    this.particles.dustPuff(pos, 8);
    return e;
  }

  /**
   * Hurt every breakable prop within `radius` of `point` — explosions and
   * ground slams reach the scenery just like they reach people.
   */
  damageBreakablesNear(point: THREE.Vector3, radius: number, dmg: number): void {
    const list = this.board.breakables;
    if (!list) return;
    for (const b of list) {
      if (b.broken) continue;
      const d = b.center.distanceTo(point);
      if (d < radius + b.radius) this.hurtBreakable(b, dmg * (1 - Math.max(0, d - b.radius) / (radius + 1)));
    }
  }

  private hurtBreakable(b: Breakable, dmg: number): void {
    if (b.broken || dmg <= 0) return;
    b.hp -= dmg;
    if (b.hp > 0) return;
    b.broken = true;
    // the collision box goes with the prop — it no longer blocks or shelters
    const boxes = this.board.physics.boxes;
    const bi = boxes.indexOf(b.box);
    if (bi >= 0) boxes.splice(bi, 1);
    b.mesh.visible = false;
    for (const p of this.players) if (p.cover?.box === b.box) { p.cover = null; p.peeking = false; }
    this.particles.deathBurst(b.center, 18);
    b.onBreak?.(this);
    if (b.explosive) this.explode(b.center.clone(), -1);
    else audio.impact();
  }

  /**
   * Give the GPU back everything this match built.
   *
   * Three frees buffers and textures only on an explicit dispose(), so without
   * this every "Retry Board" left a whole previous board — terrain, props,
   * skies, characters, the reflection probe — resident for the life of the tab,
   * and repeated restarts walked GPU memory upward until the browser dropped
   * the context. Resources shared across matches (the character material cache,
   * the texture cache, loaded .glb scenes) are tagged and skipped; see
   * core/dispose.ts.
   */
  dispose(): void {
    this.disposed = true;
    audio.stopAmbient();
    audio.stopMusic();
    audio.stopJetpacks();
    audio.stopSabers();
    audio.stopEngines();

    disposeSubtree(this.scene);
    this.rocketGeo.dispose();
    this.rocketMat.dispose();
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.background = null;
    this.scene.environment?.dispose();
    this.envRT?.dispose();
    this.envRT = null;
    this.scene.environment = null;
    this.envSource = null;
    this.rockets.length = 0;
    this.vehicles.length = 0;
    this.enemies.length = 0;
    this.allies.length = 0;
    this.players.length = 0;
  }

  fireRocket(origin: THREE.Vector3, dir: THREE.Vector3, target: Combatant | null, bySlot: number): void {
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.rockets.push({ mesh, vel: dir.clone().multiplyScalar(38), target, life: 4, bySlot });
  }

  /**
   * Where player `i` starts. Boards declare two spots; a third and fourth are
   * fanned out sideways from them rather than asking nine board files to each
   * remember a number, and the height is taken from the spot they extend so
   * nobody starts inside the ground or under a deck.
   */
  private startFor(board: Board, i: number): THREE.Vector3 {
    const declared = board.playerStarts[i];
    if (declared) return declared;
    const base = board.playerStarts[board.playerStarts.length - 1] ?? board.playerStarts[0];
    const step = board.playerStarts.length > 1
      ? board.playerStarts[1].x - board.playerStarts[0].x
      : 3;
    return base.clone().setX(base.x + step * (i - board.playerStarts.length + 1));
  }

  hitMarker(slot: number): void {
    this.events.hitMarker(slot);
    audio.hitMarker();
  }

  private explode(point: THREE.Vector3, bySlot: number): void {
    this.particles.explosion(point);
    audio.explosion();
    this.director.noise(this, point, 70, true); // an explosion is not subtle
    this.damageBreakablesNear(point, 6, 90);    // scenery is not exempt (chains!)
    for (const p of this.players) p.cam.shake(Math.max(0, 0.35 - point.distanceTo(p.position) * 0.01));
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(point);
      if (d < 7) {
        e.damage(90 * (1 - d / 8), point, bySlot);
        e.knockback(point, 18, 0.6);
        e.knockdown(1.4 + Math.random() * 0.8); // blast wave puts them flat
      }
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = p.position.distanceTo(point);
      // in pvp a rocket is a duel-ender against the rival, but never turns
      // its own thrower into the easier kill
      const base = this.mode === 'pvp' && bySlot >= 0 && p.slot !== bySlot ? 70 : 18;
      if (d < 4.5) p.damage(base * (1 - d / 4.5), point, bySlot);
    }
    // parked rides are scenery with hit points — blasts reach them too
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const d = v.pos.distanceTo(point);
      if (d > 0.5 && d < 7) v.damage(80 * (1 - d / 8), point, bySlot);
    }
  }

  get aliveEnemyCount(): number { return this.enemies.filter((e) => e.alive).length; }

  update(dt: number, inputs: FrameInput[]): void {
    // ---- the boss introduction ----
    // Real time keeps passing for the card; the simulation runs at a fraction
    // of it, and nobody's hands are on the sticks — the blanked inputs also
    // stop a held trigger from firing through the reveal. Cameras converge on
    // the warlord each frame; snapToward eases, so the pan reads as a shot
    // rather than a cut.
    if (this.bossIntroT > 0) {
      this.bossIntroT -= dt;
      dt *= BOSS_INTRO_TIMESCALE;
      inputs = inputs.map(() => BLANK_INPUT);
      const b = this.boss;
      if (b && b.alive) {
        const head = b.position.clone();
        head.y += b.height * 0.7;
        for (const p of this.players) p.cam.snapToward(head);
      }
    }
    this.time += dt;
    this.hostileCache.clear();
    if (this.state === 'fighting' || this.state === 'break' || this.state === 'intro') this.elapsed += dt;
    this.board.update?.(dt, this.time, this);

    // ---- moving platforms carry their riders ----
    // The board has already re-placed each mover's box; whoever is standing on
    // the old top rides the frame's displacement, so a heaving deck under your
    // feet is ground, not a treadmill.
    if (this.board.movers) {
      for (const m of this.board.movers) {
        if (m.delta.lengthSq() < 1e-10) continue;
        const b = m.box;
        const carry = (pos: THREE.Vector3, radius: number): void => {
          if (pos.x < b.min.x - radius || pos.x > b.max.x + radius) return;
          if (pos.z < b.min.z - radius || pos.z > b.max.z + radius) return;
          if (Math.abs(pos.y - (b.max.y - m.delta.y)) > 0.5) return;
          pos.add(m.delta);
        };
        for (const p of this.players) if (p.alive) carry(p.position, p.radius);
        for (const e of this.enemies) if (e.alive) carry(e.position, e.radius);
        for (const a of this.allies) if (a.alive) carry(a.position, a.radius);
      }
    }

    // ---- match flow (per mode) ----
    this.stateTimer -= dt;
    if (this.mode === 'wave') {
      if (this.state === 'intro' && this.stateTimer <= 0) this.nextWave();
      if (this.state === 'break' && this.stateTimer <= 0) this.nextWave();
      // A wave is cleared once everything it spawned is down. Testing
      // `enemies.length > 0` instead — as a stand-in for "the wave has started" —
      // stalled the station permanently: enemies knocked into the abyss are
      // removed the same frame they die, rather than lingering as a corpse, so
      // the array could empty completely and the check could never fire again.
      if (this.state === 'fighting' && this.waveSpawned > 0 && this.aliveEnemyCount === 0
          && !this.monsterStaging) {
        // the fallen fade away now that the wave is decided
        for (const e of this.enemies) if (!e.alive) e.fadeOut();
        if (this.wave > FINAL_WAVE) {
          // the warlord is down: the territory is truly held
          this.setState('victory');
          this.events.banner('Territory held', 'This is the Way');
          audio.waveClear();
        } else if (this.midBossActive) {
          // the champion falls; the second run of waves opens
          this.midBossActive = false;
          this.midBossDown = true;
          this.setState('break');
          this.stateTimer = 4.5;
          this.events.banner('The champion falls', 'The warlord is watching');
          audio.waveClear();
        } else if (this.wave === FINAL_WAVE || (this.wave === MID_BOSS_WAVE && !this.midBossDown)) {
          // a boss battle rings in on the next bell
          this.setState('break');
          this.stateTimer = 4.5;
          this.events.banner(`Wave ${this.wave} cleared`, 'Something big is coming');
          audio.waveClear();
        } else {
          this.setState('break');
          this.stateTimer = 4.5;
          this.events.banner(`Wave ${this.wave} cleared`);
          audio.waveClear();
        }
      }
    } else if (this.state === 'intro' && this.stateTimer <= 0) {
      // pvp and campaign have no wave clock: the intro simply opens the match
      this.setState('fighting');
      this.wave = 1;
    }

    // boss phases run wherever a boss stands (either boss battle, campaign arenas)
    if (this.state === 'fighting') this.updateMonsterStage(dt);
    this.updateBoss(dt);

    // ---- campaign objectives ----
    if (this.campaign && this.state === 'fighting') {
      this.campaign.update(dt);
      if (this.campaign.done && this.state === 'fighting') {
        this.setState('victory');
        this.events.banner('Territory liberated', 'This is the Way');
        audio.waveClear();
      }
    }

    // ---- pvp: lives, credit, the last one standing ----
    if (this.mode === 'pvp' && this.state === 'fighting') this.updatePvp();

    // ---- players ----
    const ended = this.state === 'defeat' || this.state === 'victory';
    for (const p of this.players) {
      p.update(dt, inputs[p.slot], this);
      if (p.alive || p.respawnTimer > 0 || ended) continue;
      if (this.mode === 'pvp') {
        if (p.lives > 0) {
          p.lives--;
          p.deathCounted = false;
          p.spawnAt(this.pvpSpawn(p.slot, p.position));
          this.spawnSquadFor(p);   // the fireteam re-forms on its leader
          this.particles.dustPuff(p.position, 10);
        }
        // out of lives: eliminated — updatePvp calls the match
      } else if (this.mode === 'campaign') {
        // arcade checkpointing: the walk back is the cost (LEVEL_DESIGN.md §2)
        p.spawnAt(this.campaign?.respawnSpot(p.slot) ?? this.board.playerStarts[0].clone());
        p.hp = p.maxHp * 0.8;
        this.events.banner('Back on your feet', 'the beacon waits');
      } else {
        const partnerAlive = this.players.some((o) => o !== p && o.alive);
        if (this.players.length > 1 && partnerAlive) {
          p.spawnAt(this.board.playerStarts[p.slot] ?? this.board.playerStarts[0]);
          p.hp = p.maxHp * 0.6;
        } else {
          this.setState('defeat');
          this.events.banner('The hunter has fallen');
        }
      }
    }
    if (this.mode === 'wave' && this.state !== 'defeat' && this.state !== 'victory' && this.players.every((p) => !p.alive) && this.players.length > 1) {
      this.setState('defeat');
      this.events.banner('The hunters have fallen');
    }

    // ---- vehicles ----
    // Ridden ones were driven inside their rider's update; this settles the
    // parked ones and detonates anything that died this frame.
    for (const v of this.vehicles) {
      v.update(dt, this);
      if (v.pendingExplosion) {
        const px = v.pendingExplosion;
        v.pendingExplosion = null;
        this.explode(px.at, px.slot);
      }
      if (v.removeMe) this.scene.remove(v.group);
    }
    this.vehicles = this.vehicles.filter((v) => !v.removeMe);

    // ---- hunt escalation (wave mode only: campaign posts hold their path) ----
    // Posted enemies wait to be found, which must not let a wave stall out: if
    // one drags on, the remnant starts sweeping toward the players instead.
    if (this.mode === 'wave' && this.state === 'fighting') {
      this.waveTimer += dt;
      this.huntCall -= dt;
      if (this.waveTimer > 80 && this.huntCall <= 0) {
        this.huntCall = 22;
        const p = this.players.find((pl) => pl.alive) ?? this.players[0];
        for (const e of this.enemies) if (e.alive) e.alert(p.position, false);
        if (!this.huntAnnounced) {
          this.huntAnnounced = true;
          this.events.banner('They are sweeping for you');
        }
      }
    }

    // ---- enemies ----
    this.director.update(dt, this);
    for (const e of this.enemies) {
      e.update(dt, this);
      if (!e.alive && !e.counted) {
        e.counted = true;
        this.totalKills++;
        this.particles.deathBurst(e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)));
        audio.killConfirm();
        this.director.deathNearby(this, e.position);
        if (e.lastHitBy >= 0 && this.players[e.lastHitBy]) {
          this.players[e.lastHitBy].kills++;
          this.events.hitMarker(e.lastHitBy);
        }
      }
      if (e.removeMe) this.scene.remove(e.char.root);
    }
    this.enemies = this.enemies.filter((e) => !e.removeMe);

    // ---- allies ----
    for (const a of this.allies) {
      a.update(dt, this);
      if (!a.alive && !a.counted) {
        a.counted = true;
        this.particles.deathBurst(a.position.clone().add(new THREE.Vector3(0, a.height * 0.5, 0)));
      }
      if (a.removeMe) this.scene.remove(a.char.root);
    }
    this.allies = this.allies.filter((a) => !a.removeMe);


    // ---- projectiles ----
    const targets = this.targets;
    targets.length = 0;
    let slot = 0;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const t = this.pooledTarget(slot++);
      t.enemy = e;
      t.player = null;
      t.position.set(e.position.x, e.position.y + e.height * 0.5, e.position.z);
      t.radius = e.radius + 0.35;
      t.team = e.team;
      t.alive = true;
      t.shield = e.shieldCollider;
      t.slot = undefined;
      t.breakable = null;
      t.vehicle = null;
      targets.push(t);
      // long bodies (the war massiff) need more than the one centre sphere
      if (e.def.hitParts) {
        const sin = Math.sin(e.yaw), cos = Math.cos(e.yaw);
        for (const part of e.def.hitParts) {
          const h = this.pooledTarget(slot++);
          h.enemy = e;
          h.player = null;
          h.position.set(
            e.position.x + sin * part.z,
            e.position.y + part.y,
            e.position.z + cos * part.z,
          );
          h.radius = part.r;
          h.team = e.team;
          h.alive = true;
          h.shield = null;
          h.slot = undefined;
          h.breakable = null;
          h.vehicle = null;
          targets.push(h);
        }
      }
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const t = this.pooledTarget(slot++);
      t.enemy = null;
      t.player = p;
      t.position.set(p.position.x, p.position.y + 0.9, p.position.z);
      t.radius = p.radius + 0.35;
      t.team = p.team;
      t.alive = true;
      // a blade sends the bolt back at somebody, so the player needs to be
      // told who is in front of them before the collider is read
      p.deflectEnemy = p.sabersDrawn ? this.nearestHostileInFront(p) : null;
      t.shield = p.shieldCollider;
      t.slot = p.slot;
      t.breakable = null;
      t.vehicle = null;
      targets.push(t);
    }
    // breakable props sit on team 2, so both sides' fire chips at them
    if (this.board.breakables) {
      for (const b of this.board.breakables) {
        if (b.broken) continue;
        // A breakable is hit as a sphere, which a long prop outgrows: Nevarro's
        // crust plates are 26 m of bridge behind a 4.2 m sphere, so only the
        // middle third could be shot and a bolt aimed anywhere else sparked off
        // the collider for no damage. Lay spheres along the box's longest axis
        // so the whole visible prop is a target, the way a long body gets extra
        // hit spheres.
        const size = b.box.max.clone().sub(b.box.min);
        const long = Math.max(size.x, size.z);
        const span = Math.max(0, long / 2 - b.radius);
        const steps = Math.min(6, Math.ceil(span / Math.max(1, b.radius)));
        const alongX = size.x >= size.z;
        for (let i = -steps; i <= steps; i++) {
          const t = steps === 0 ? 0 : (i / steps) * span;
          const p = this.pooledBreakTarget(slot++);
          p.position.set(b.center.x + (alongX ? t : 0), b.center.y, b.center.z + (alongX ? 0 : t));
          p.radius = b.radius;
          p.team = 2;
          p.alive = true;
          p.shield = null;
          p.slot = undefined;
          p.enemy = null;
          p.player = null;
          p.breakable = b;
          p.vehicle = null;
          targets.push(p);
        }
      }
    }
    // vehicles are props with hit points: team 2, spheres laid along the hull
    // so a long skiff is hittable bow to stern
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const sin = Math.sin(v.yaw), cos = Math.cos(v.yaw);
      const r = Math.max(v.def.radius, 0.9);
      const steps = Math.max(0, Math.ceil(v.def.length / 2 / r) - 1);
      for (let i = -steps; i <= steps; i++) {
        const along = steps === 0 ? 0 : (i / steps) * (v.def.length / 2 - r * 0.5);
        const t = this.pooledTarget(slot++);
        t.enemy = null;
        t.player = null;
        t.breakable = null;
        t.vehicle = v;
        t.position.set(v.pos.x + sin * along, v.pos.y + v.def.body * 0.5, v.pos.z + cos * along);
        t.radius = r;
        t.team = 2;
        t.alive = true;
        t.shield = null;
        t.slot = undefined;
        targets.push(t);
      }
    }
    for (const a of this.allies) {
      if (!a.alive) continue;
      const t = this.pooledTarget(slot++);
      t.enemy = a;
      t.player = null;
      t.position.set(a.position.x, a.position.y + a.height * 0.5, a.position.z);
      t.radius = a.radius + 0.35;
      t.team = 0;
      t.alive = true;
      t.shield = null;
      t.slot = undefined;
      t.breakable = null;
      t.vehicle = null;
      targets.push(t);
    }
    this.projectiles.update(dt, this.board.physics, targets, this.board.waterY);

    // ---- rockets ----
    for (const r of this.rockets) {
      r.life -= dt;
      if (r.target && r.target.alive) {
        const to = this.rkTo.set(
          r.target.position.x,
          r.target.position.y + r.target.height * 0.5,
          r.target.position.z,
        ).sub(r.mesh.position).normalize();
        r.vel.lerp(to.multiplyScalar(38), Math.min(1, dt * 4));
      }
      const step = this.rkStep.copy(r.vel).multiplyScalar(dt);
      const hit = this.board.physics.raycast(r.mesh.position, this.rkDir.copy(step).normalize(), step.length() + 0.2);
      let exploded = false;
      if (hit) { this.explode(hit.point, r.bySlot); exploded = true; }
      else {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (e.position.distanceTo(r.mesh.position) < e.radius + 0.9) {
            this.explode(r.mesh.position.clone(), r.bySlot);
            exploded = true;
            break;
          }
        }
        // pvp: a rival's body sets it off just like a hostile's
        if (!exploded && this.mode === 'pvp') {
          for (const p of this.players) {
            if (!p.alive || p.slot === r.bySlot) continue;
            if (p.position.distanceTo(r.mesh.position) < p.radius + 0.9) {
              this.explode(r.mesh.position.clone(), r.bySlot);
              exploded = true;
              break;
            }
          }
        }
      }
      if (r.life <= 0 && !exploded) { this.explode(r.mesh.position.clone(), r.bySlot); exploded = true; }
      if (exploded) { this.scene.remove(r.mesh); r.life = -1; }
      else {
        r.mesh.position.add(step);
        r.mesh.quaternion.setFromUnitVectors(UP, this.rkDir.copy(r.vel).normalize());
        this.particles.rocketExhaust(r.mesh.position, this.rkDir.negate(), dt);
      }
    }
    this.rockets = this.rockets.filter((r) => r.life > 0);

    this.particles.update(dt);
  }

  /**
   * Whoever a deflected bolt should be thrown at: the nearest live hostile
   * inside the arc the player is facing. Nothing in front means the blade
   * mirrors the shot instead, which still sends it away from her.
   */
  private nearestHostileInFront(p: Player): Combatant | null {
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    let best: Combatant | null = null;
    let bestD = 60 * 60;
    for (const e of this.hostilesFor(p)) {
      if (!e.alive) continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD || d2 < 0.01) continue;
      const d = Math.sqrt(d2);
      if ((dx * fx + dz * fz) / d < 0.2) continue;   // behind her, or nearly
      best = e;
      bestD = d2;
    }
    return best;
  }

  /**
   * A reusable bolt-target entry. Its `onHit` is allocated once and dispatches
   * through the entry, so credit still goes to whoever pulled the trigger —
   * deriving it from the impact position handed player A's kills to player B
   * whenever the target stood nearer B, and credited ally fire at random.
   */
  private pooledTarget(i: number): PooledTarget {
    let t = this.targetPool[i];
    if (t) return t;
    const entry: PooledTarget = {
      position: new THREE.Vector3(), radius: 0, team: 0, alive: false,
      shield: null, slot: undefined, enemy: null, player: null,
      onHit: (dmg: number, from: THREE.Vector3, bySlot: number, tag?: string): void => {
        if (entry.breakable) { this.hurtBreakable(entry.breakable, dmg); return; }
        if (entry.vehicle) { entry.vehicle.damage(dmg, from, bySlot); return; }
        if (entry.player) {
          const p = entry.player;
          p.damage(dmg, from, bySlot);
          // a net barely hurts; being rooted in the open is the damage
          if (tag === 'net' && p.alive) p.snareTimer = Math.max(p.snareTimer, 2.4);
          if (p.alive && bySlot >= 0 && bySlot !== p.slot) this.hitMarker(bySlot);
          return;
        }
        const e = entry.enemy;
        if (!e) return;
        const wasAlive = e.alive;
        e.damage(dmg, from, bySlot);
        if (e.team !== 1) return;   // allies take the damage without the shove
        // every hit shoves: light per bolt, but it stacks over a burst
        e.knockback(from, 5.5, 0.2);
        if (wasAlive && bySlot >= 0) this.hitMarker(bySlot);
      },
    };
    this.targetPool[i] = entry;
    return entry;
  }

  /** A pooled entry standing in for part of a breakable prop. */
  private pooledBreakTarget(i: number): PooledTarget {
    return this.pooledTarget(i);
  }

  /** Warm the .glb cache for everything a wave can put on the board. */
  private preloadWave(wave: number): void {
    if (wave > FINAL_WAVE) return;
    for (const entry of waveComposition(this.board.kind, wave, this.players.length)) {
      const id = ENEMY_MODEL_ID[entry.kind];
      if (id) preloadAuthored(id);
    }
    // Allies are not part of a wave's composition, so they were downloading
    // cold at the moment they walked in — mid-fight, against a spawn storm.
    const ally = ALLY_WAVES[wave];
    if (ally) {
      const id = ENEMY_MODEL_ID[ally];
      if (id) preloadAuthored(id);
    }
  }

  private setState(s: MatchState): void {
    this.state = s;
    if (s === 'victory') audio.sting(true);
    if (s === 'defeat') audio.sting(false);
    this.events.stateChanged(s);
  }

  /** PvP scoring and the last-one-standing call (docs/MODES.md §3). */
  private updatePvp(): void {
    for (const p of this.players) {
      if (p.alive || p.deathCounted) continue;
      p.deathCounted = true;
      const killer = p.lastHitBy >= 0 && p.lastHitBy !== p.slot ? this.players[p.lastHitBy] : null;
      if (killer) {
        killer.kills++;
        this.events.hitMarker(killer.slot);
        this.events.banner(`${killer.profile.name} downs ${p.profile.name}`,
          p.lives > 0 ? `${p.lives} stand${p.lives === 1 ? '' : 's'} left` : `${p.profile.name} is out`);
      } else if (p.lives <= 0) {
        this.events.banner(`${p.profile.name} is out`);
      }
      audio.killConfirm();
    }
    const standing = this.players.filter((p) => p.alive || p.lives > 0 || p.respawnTimer > 0);
    if (this.players.length > 1 && standing.length <= 1) {
      const winner = standing[0]
        ?? this.players.reduce((a, b) => (b.kills > a.kills ? b : a), this.players[0]);
      this.winnerSlot = winner.slot;
      this.setState('victory');
      this.events.banner(`${winner.profile.name} takes the territory`, 'This is the Way');
    }
  }

  /** HUD top line, per mode (the HUD stays mode-agnostic) */
  hudTopLine(p: Player): string {
    if (this.state === 'victory') return 'VICTORY';
    if (this.mode === 'pvp') {
      const stands = (p.alive ? 1 : 0) + p.lives;
      return stands > 0 ? `${stands} stand${stands === 1 ? '' : 's'} left` : 'ELIMINATED';
    }
    if (this.mode === 'campaign') return this.campaign?.hint(p.position) ?? 'Follow the beacon';
    if (this.midBossActive || this.wave > FINAL_WAVE) return this.boss?.bossName ?? 'The warlord';
    return `Wave ${Math.max(this.wave, 1)}`;
  }

  /** HUD score line, per mode */
  hudScoreLine(p: Player): string {
    if (this.mode === 'pvp') {
      const rivals = this.players.filter((o) => o !== p && (o.alive || o.lives > 0 || o.respawnTimer > 0)).length;
      return `${p.kills} kills · ${rivals} rival${rivals === 1 ? '' : 's'} left`;
    }
    return `${p.kills} kills · ${this.aliveEnemyCount} hostiles remaining`;
  }

  /** the far side of the board, where a boss battle posts its warlord */
  private farPost(): THREE.Vector3 {
    const near = this.players[0]?.position ?? this.board.playerStarts[0];
    let far = this.board.groundSpawns[0] ?? near;
    for (const s of this.board.groundSpawns) {
      if (s.distanceToSquared(near) > far.distanceToSquared(near)) far = s;
    }
    return far.clone();
  }

  private nextWave(): void {
    this.waveTimer = 0;
    this.waveSpawned = 0;
    this.huntCall = 0;
    this.huntAnnounced = false;
    this.setState('fighting');
    // clearing wave MID_BOSS_WAVE rings in the champion's battle instead of
    // the next wave: the board's first boss posts at the far side with a guard
    if (this.wave === MID_BOSS_WAVE && !this.midBossDown) {
      this.midBossActive = true;
      this.spawnBoss(this.farPost(), 'mid');
      return;
    }
    this.wave++;
    // past the final wave is the warlord's battle, and the last bell
    if (this.wave > FINAL_WAVE) {
      this.spawnBoss(this.farPost(), 'final');
      return;
    }
    const near = this.players[0]?.position ?? this.board.playerStarts[0];
    spawnWave(this.board, this.wave, this.players.length, near, (e) => {
      this.waveSpawned++;
      this.enemies.push(e);
      this.scene.add(e.char.root);
      this.particles.dustPuff(e.position, 10);
    });
    // the break before the next wave is the lead time for its new arrivals
    this.preloadWave(this.wave + 1);
    const scattered = this.aliveEnemyCount;
    this.events.banner(
      `Wave ${this.wave}`,
      this.wave === FINAL_WAVE ? `Final wave · ${scattered} hostiles` : `${scattered} hostiles · hunt them down`
    );
    // the little card naming kinds that debut this wave — the wave tables
    // are deterministic in which kinds appear, so a diff against every
    // earlier wave is exactly "first appearance"
    const seen = new Set<EnemyKind>();
    for (let w = 1; w < this.wave; w++) {
      for (const entry of waveComposition(this.board.kind, w, this.players.length)) seen.add(entry.kind);
    }
    const fresh = [...new Set(
      waveComposition(this.board.kind, this.wave, this.players.length).map((entry) => entry.kind)
    )].filter((k) => !seen.has(k));
    if (fresh.length) this.events.newContacts?.(fresh.map((k) => ENEMY_NAME[k]));
    audio.waveStart();

    // ally reinforcements from the covert on milestone waves
    const allyKind = ALLY_WAVES[this.wave] ?? null;
    if (allyKind) {
      // offset from the player start so the ally doesn't land on top of it —
      // and checked, because 2.5 m along the diagonal is a wall on some boards
      const start = standingSpot(this.board, this.board.playerStarts[0].clone().add(new THREE.Vector3(2.5, 0, 2.5)), allyKind);
      const ally = new Enemy(allyKind, start, 0);
      this.allies.push(ally);
      this.scene.add(ally.char.root);
      this.particles.dustPuff(start, 12);
      const names: Record<string, string> = { marshal: 'The Marshal joins the fight', ig11: 'IG-11 joins the fight', fennec: 'Fennec Shand joins the fight' };
      this.events.banner(`Wave ${this.wave}`, names[allyKind]);
    }
  }

  /**
   * Give the scene something for metal to reflect.
   *
   * The authored characters are PBR: their metallic-roughness maps drive most
   * of the armour to full metal, and a metal with nothing to reflect renders
   * black — which is exactly how they looked before this existed. Pre-filter
   * the board's sky into a reflection probe (a neutral room when a board has no
   * panorama) and every metal surface, procedural ones included, picks up the
   * light of the place it is standing in.
   */
  private buildEnvironment(renderer: THREE.WebGLRenderer): void {
    this.envBuilt = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = this.envSource
      ? pmrem.fromEquirectangular(this.envSource)
      : pmrem.fromScene(new RoomEnvironment(), 0.04);
    // The probe is rebuilt once when the authored sky lands, so the first one
    // has to go — and it is a render target, which pmrem.dispose() does not
    // free. Freeing the texture alone left the framebuffer behind.
    this.scene.environment?.dispose();
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  /** Split-screen render: one viewport per player (horizontal split). */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.envBuilt) this.buildEnvironment(renderer);
    // getSize reports CSS pixels, which is what setViewport/setScissor expect —
    // they scale by the renderer's pixel ratio themselves. Passing
    // domElement.width here applies devicePixelRatio twice, blowing the
    // viewport past the drawing buffer on HiDPI screens and shoving the
    // rendered scene up and to the right.
    renderer.getSize(this.tmpSize);
    const w = this.tmpSize.x;
    const h = this.tmpSize.y;

    const n = this.players.length;
    const rects = splitLayout(n);
    renderer.setScissorTest(n > 1);
    // each viewport judges the water for itself: a diver's screen goes to
    // teal murk while the partner's stays in daylight
    const surfaceFog = this.scene.fog;
    const surfaceBg = this.scene.background;
    const wY = this.board.waterY;
    for (let i = 0; i < n; i++) {
      const [vx, vy, vw, vh] = glRect(rects[i], w, h);
      const cam = this.players[i].cam.camera;
      cam.aspect = vw / vh;
      cam.updateProjectionMatrix();
      renderer.setViewport(vx, vy, vw, vh);
      renderer.setScissor(vx, vy, vw, vh);
      const under = wY !== undefined && cam.position.y < wY;
      this.scene.fog = under ? this.underFog : surfaceFog;
      this.scene.background = under ? this.underColor : surfaceBg;
      renderer.render(this.scene, cam);
    }
    this.scene.fog = surfaceFog;
    this.scene.background = surfaceBg;
    // Hand the renderer back the whole canvas. The viewport is renderer state,
    // not per-render state: leaving it on the last player's half meant every
    // later full-screen draw — the character select's stage above all — was
    // squeezed into that strip, which is why its Mandalorians came back
    // squashed flat after a split-screen board.
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
  }
}
