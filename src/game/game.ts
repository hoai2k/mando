import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Board, Breakable } from '../world/board';
import { Player } from '../player/player';
import { BotBrain } from './bot';
import { TEXT } from '../text';
import { Enemy, type Combatant, type EnemyKind } from '../enemies/enemy';
import { ALLY_WAVES, standingSpot, type Placement } from '../enemies/spawner';
import { Carrier, carrierShipId, landingSite, squadArrival, DROP_HEIGHT } from '../enemies/arrival';
import { CombatDirector } from '../enemies/director';
import { ProjectileSystem, type BoltTarget, type DeflectSphere } from '../fx/projectiles';
import type { PlayableId } from '../characters/roster';
import { ParticleFX } from '../fx/particles';
import { audio } from '../core/audio';
import { yawBasis } from '../core/math';
import { glRect, splitLayout } from '../core/layout';
import { loadOptionalTexture } from '../core/assets';
import { disposeSubtree } from '../core/dispose';
import { enemyModelIds, warmAuthored } from '../characters/authored';
import type { FrameInput } from '../core/input';
import { spawnVehicles, type Vehicle } from './vehicles';
import { BOSS_KIND, BOSS_NAME, BOSS_RETINUE, MID_BOSS, MONSTER_BOSS, type GameMode } from './modes';
import type { AllyCrate } from './allycrate';
import type { MissionController } from './mission-api';
import type { ModeRules } from './rules/rules';
import { WaveRules } from './rules/wave';
import { PvpRules } from './rules/pvp';
import { CampaignRules } from './rules/campaign-rules';

export type MatchState = 'intro' | 'fighting' | 'break' | 'victory' | 'defeat';

/** length of the boss introduction card, in real seconds */
const BOSS_INTRO_LEN = 3.4;
/** the quake between the warlord falling and the monster surfacing */
const MONSTER_QUAKE_LEN = 4;
/** simulation rate under the card — slow enough to read as a held breath */
const BOSS_INTRO_TIMESCALE = 0.12;
/** reach of the warlord's shock-slam, and the radius its ember ring is drawn at */
const BOSS_SLAM_R = 8.5;
/** a wave this old starts sweeping for the players rather than waiting to be found... */
const HUNT_AFTER = 45;
/** ...as does one down to this many bodies, scattered over the board */
const HUNT_REMNANT = 3;

/** hands-off-the-sticks input, fed to everyone while the boss card is up */
const BLANK_INPUT: FrameInput = {
  moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
  dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
  meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
  zoomDelta: 0, blockHeld: false, pausePressed: false,
  meleeSwapPressed: false, rangedSwapPressed: false,
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
  /** this entry stands for `enemy`'s corpse, not the living body */
  corpse?: boolean;
}

/** one extra hit sphere, in body-local metres */
interface HitPart { z: number; y: number; r: number }

/**
 * A body's hit volume, as the target builder needs it. `Enemy` and `Player`
 * both fill one of these — no base class, no adapter — which is what lets one
 * emitter stand a hostile and a playable up the same way.
 */
interface HitBody {
  position: THREE.Vector3;
  yaw: number;
  team: number;
  /** the sphere on the chest */
  hitHeight: number;
  hitRadius: number;
  /** the extra spheres a long body carries */
  parts: readonly HitPart[];
  shield: DeflectSphere | null;
  /** a raised pane covers the whole fighter; a hostile's covers its chest */
  shieldCoversParts: boolean;
  /** player slot, so a bolt this body deflects is credited to them */
  slot: number | undefined;
}

/** filled and re-filled per body per frame: the builder must not make garbage */
const NO_PARTS: readonly HitPart[] = [];
const _body: HitBody = {
  position: new THREE.Vector3(), yaw: 0, team: 0, hitHeight: 0, hitRadius: 0,
  parts: NO_PARTS, shield: null, shieldCoversParts: false, slot: undefined,
};

/** the rocket mesh's own axis, for orienting it along its velocity */
const UP = new THREE.Vector3(0, 1, 0);
/** scratch for laying a drop squad out along its carrier's flight line */
const _stick = new THREE.Vector3();
const _stickVel = new THREE.Vector3();

/**
 * One class of victim inside a blast: how far it reaches them, how hard it
 * hits at the centre, and where the falloff runs out. `zero` beyond `radius`
 * is what leaves the rim still taking something.
 */
interface Ring {
  radius: number;
  damage: number;
  zero?: number;
  /** the whole reach takes the full number — the warlord's slam, not a rocket */
  flat?: boolean;
}

/** A ring of force — see `Game.blast`. A class left out is not touched. */
interface BlastSpec {
  /** who threw it: their squad and brood are spared, and kills credit them */
  bySlot?: number;
  enemies?: Ring & { push?: number; stagger?: number; knockdown?: [number, number] };
  /** `rival` replaces `damage` for a player who is not the thrower (PvP) */
  players?: Ring & { push?: number; lift?: number; rival?: number };
  /** `damage` is the shove, not damage — a corpse is past hurting */
  corpses?: Ring;
  vehicles?: Ring;
  breakables?: Ring;
  shake?: { amount: number; radius: number; flat?: boolean; ground?: boolean };
  /** how far the bang carries to the AI director */
  noise?: number;
  sound?: 'explosion' | 'impact';
}

/** scratch for the direction a blast throws a player */
const _away = new THREE.Vector3();

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
  /** the intro clock, and the pause between waves — the rule sets read it */
  stateTimer = 2.2;
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
  /** hostiles this wave put on the board — the wave rules' clear check reads it */
  waveSpawned = 0;
  // ---- modes (docs/MODES.md) ----
  /** the standing boss battle — the mid-board lieutenant or the warlord */
  boss: Enemy | null = null;
  /** the covert's supply cache on the old ally-milestone waves, if one is down */
  allyCrate: AllyCrate | null = null;
  private bossPhase = 0;
  /** true while the warlord's theme has the music bus (see updateBossMusic) */
  private bossMusic = false;
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
  /** carrier passes currently crossing the sky (src/enemies/arrival.ts) */
  private carriers: Carrier[] = [];
  /** bodies a carrier still holds — counted as hostiles, but not yet spawned */
  private incoming = 0;
  /** alternates eligible transports between setting down and overflying */
  private landToggle = 0;
  /** campaign controller; null outside campaign mode (set by CampaignRules) */
  campaign: MissionController | null = null;
  /**
   * The playable sky's lid (docs/MISSIONS_OUTDOOR.md §2), absolute Y — null
   * everywhere but a mission level.
   *
   * Two jobs and no others: a border cannot be flown over, so a beat cannot be
   * skipped; and the sky is cut into a **playable** band the fight lives in
   * and an **ambient** band above it that belongs to the backdrop. It is set
   * well above what one jetpack burn reaches, so free flight never meets it.
   *
   * The clamp is one-directional by design: a body below it cannot climb
   * through, but a body above it — a carrier's squad on the way down, a flier
   * crossing the rim — is left alone and falls in. That is what keeps a drop
   * reading as reinforcements committed from above.
   */
  ceilingY: number | null = null;
  /**
   * How high a carrier pass flies over its drop. The wave game's 38 m; a
   * mission level raises it clear of the ceiling so the squad falls *through*
   * the cut rather than being clamped on the way in.
   */
  dropHeight = DROP_HEIGHT;
  /** the mode's rule set: everything Wave Battle, PvP and Missions disagree on */
  readonly rules: ModeRules;
  /**
   * How many of `players` are human, and so how many pieces the screen is cut
   * into. Bots sit after them in the same list — they are players in every way
   * that matters to the match, and in none that matters to the window.
   */
  readonly humans: number;
  /**
   * One hand on the controller per bot, made when that bot first needs one and
   * kept for the life of the match so its burst timing and the way it circles
   * are its own rather than reset every frame.
   */
  private brains = new Map<number, BotBrain>();
  /** PvP: the slot that took the territory, for the end screen */
  winnerSlot = -1;
  /** per-frame cache behind hostilesFor */
  private hostileCache = new Map<number, Combatant[]>();

  constructor(public board: Board, playerCount: number, aspect: number, private events: GameEvents,
    characters: PlayableId[] = ['din', 'paz'], public mode: GameMode = 'wave', bots = 0) {
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

    // The rule set comes first: it places the players (PvP starts them apart
    // on the board's own posts) and, once they exist, opens the match.
    this.rules = mode === 'pvp' ? new PvpRules(this)
      : mode === 'campaign' ? new CampaignRules(this)
        : new WaveRules(this);

    this.humans = playerCount;
    for (let i = 0; i < playerCount + bots; i++) {
      const p = new Player(i, aspect, characters[i] ?? 'din');
      // a bot is a player with nobody holding the controller: same body, same
      // weapons, same rules — its input comes from `BotBrain` instead of a pad
      p.isBot = i >= playerCount;
      if (mode === 'pvp') {
        // every fighter is their own side; 0/1 stay meaningful as co-op/hostile
        p.team = 2 + i;
        p.lives = 2; // three stands in total
      }
      p.spawnAt(this.rules.startFor?.(i) ?? this.startFor(i));
      p.char.setHeroLight(board.heroLight ?? 0);
      this.scene.add(p.char.root);
      this.players.push(p);
    }
    // squads, the mission level, the first wave's models: whatever the mode
    // wants doing once there are players standing on the board
    this.rules.begin();

    // Parked rides belong to the territory's own ground, so they only make
    // sense in the modes fought on it. A mission level is raised to
    // MISSION_Y, which left every ride sitting 82-89 m below the floor the
    // party walks: unreachable, un-mountable, and still costing a model, a
    // collider and a bolt target. Waves and PvP get them; Missions does not.
    if (mode !== 'campaign') this.vehicles = spawnVehicles(board, this.scene);


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

    // The three allies are certain to appear in a full match and are only three
    // files, so warm them now rather than the instant one walks into a firefight.
    // A mission drops two of the same caches, before its arenas.
    if (mode !== 'pvp') {
      for (const kind of Object.values(ALLY_WAVES)) {
        for (const id of enemyModelIds(kind)) warmAuthored(id, 'soon');
      }
    }
    // wave and campaign both run the lieutenant and end at the territory's
    // warlord: warm both models now
    if (mode !== 'pvp') {
      for (const kind of [MID_BOSS[board.kind].kind, BOSS_KIND[board.kind]]) {
        for (const bossId of enemyModelIds(kind)) warmAuthored(bossId, 'soon');
      }
    }

    audio.startAmbient(board.ambience.sample, board.ambience.bed);
    audio.startMusic(board.music, board.kind);
    this.events.banner(board.name, this.rules.objective);
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

  /**
   * What a player's HUD says about the transport door, if anything.
   *
   * Going back through one needs the whole party aboard, so a player who has
   * stepped into the pocket sees how to change their mind and everyone else
   * sees who they are waiting on — without that, the run just stops for
   * reasons nobody on the other screens can see.
   */
  exitNotice(p: Player): string {
    const c = this.campaign;
    if (!c || c.exited.size === 0) return '';
    if (c.exited.has(p.slot)) return TEXT.missions.exited;
    const waiting = this.players.filter((q) => q.alive && !c.exited.has(q.slot)).length;
    const who = this.players.find((q) => c.exited.has(q.slot));
    return TEXT.missions.waitingOn(who?.profile.name ?? '', waiting);
  }

  /** the campaign controller's mouthpiece (events is private) */
  announce(text: string, sub?: string): void {
    this.events.banner(text, sub);
  }

  /** the card naming enemy kinds making their first appearance this wave */
  announceContacts(names: string[]): void {
    this.events.newContacts?.(names);
  }

  /**
   * Spawn a boss battle (docs/MODES.md §4a) at `pos` with a small honour
   * guard. `tier` picks the fight: the mid-board lieutenant (MID_BOSS, a
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
    this.addEnemy(boss, { counts: true });
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
    const sub = tier === 'mid' ? TEXT.banners.lieutenantOf(this.board.name) : TEXT.banners.warlordOf(this.board.name);
    if (this.events.bossIntro) this.events.bossIntro(boss.bossName, sub);
    else this.events.banner(boss.bossName, TEXT.banners.bringThemDown);
    audio.bossHorn();
    // The warlord brings his own music. The lieutenant does not: the board's
    // score carrying on through the mid-board fight is what leaves the change
    // at the last one meaning something.
    if (tier === 'final') this.startBossMusic();
    return boss;
  }

  /**
   * Put a staged wave on its way in (docs/PLAN.md; src/enemies/arrival.ts).
   *
   * Each squad arrives whole, by the route `squadArrival` picks for it. Drop
   * squads ride a carrier pass — the carriers launch staggered a second and a
   * bit apart, so a big wave reads as a stream of ships crossing the sky
   * rather than one impossible lift — and until a carrier releases, its
   * bodies exist only in `incoming`, which the wave-clear check and the
   * hostiles counter both treat as hostiles the wave still owes.
   */
  stageArrivals(plan: Placement[]): void {
    const squads = new Map<number, Placement[]>();
    for (const p of plan) {
      const list = squads.get(p.squad);
      if (list) list.push(p);
      else squads.set(p.squad, [p]);
    }
    let pass = 0;
    const field = (p: Placement): Enemy => {
      const e = new Enemy(p.kind, p.pos);
      e.squad = p.squad;
      e.squadSize = p.squadSize;
      return this.addEnemy(e);   // the squad was counted when it was staged
    };
    for (const members of squads.values()) {
      const lead = members[0];
      const { mode, from } = squadArrival(this.board, lead.kind, !!lead.air, lead.pos);
      this.waveSpawned += members.length;
      if (mode === 'post') {
        // nothing can carry this squad in: stand it up in place, as ever
        for (const m of members) this.particles.dustPuff(field(m).position, 10);
      } else if (mode === 'drop') {
        // Where the ground is open enough, every other transport sets down to
        // unload instead of overflying — a landing is the better show, but a
        // sky full of parked ships is a car park, so they alternate.
        const site = landingSite(this.board, members.map((m) => m.pos));
        if (site && this.landToggle++ % 2 === 0) {
          this.incoming += members.length;
          const carrier = new Carrier(site, pass * 1.35 + Math.random() * 0.5, carrierShipId(this.board.kind), () => {
            this.incoming -= members.length;
            if (this.disposed) return;
            // skids down, ramp open: the squad steps off around the hull and
            // walks the last stretch to its posts
            this.particles.dustPuff(site, 18);
            members.forEach((m, i) => {
              const e = field(m);
              const a = (i / members.length) * Math.PI * 2 + 0.7;
              const off = _stick.set(site.x + Math.cos(a) * 3.8, site.y + 0.2, site.z + Math.sin(a) * 3.8);
              e.beginArrival('run', off, m.pos);
            });
          }, { landAt: site });
          pass++;
          this.carriers.push(carrier);
          this.scene.add(carrier.group);
          continue;
        }
        this.flybyDrop(members, pass * 1.35 + Math.random() * 0.5, field);
        pass++;
      } else {
        // edge squads enter now, spread a little along the boundary
        members.forEach((m, i) => {
          const e = field(m);
          const enter = from!.clone();
          enter.x += (Math.random() - 0.5) * 6;
          enter.z += (Math.random() - 0.5) * 6;
          if (mode === 'fly') enter.y += i * 2;
          e.beginArrival(mode, enter, m.pos);
        });
      }
    }
  }

  /**
   * Fly one transport over these placements and let a squad go over them.
   *
   * The bodies do not exist until the ship releases them: until then they are
   * `incoming`, which the wave-clear check and the hostiles counter both read
   * as hostiles the wave still owes. `field` builds each body at the moment of
   * release, so what the squad belongs to stays the caller's business.
   */
  private flybyDrop<T extends { kind: EnemyKind; pos: THREE.Vector3 }>(
    members: T[], delay: number, field: (m: T) => Enemy,
    opts: { chute?: number; onRelease?: (bodies: Enemy[]) => void } = {},
  ): Carrier {
    // centroid, so one pass covers the whole squad's spread of targets
    const at = new THREE.Vector3();
    for (const m of members) at.add(m.pos);
    at.divideScalar(members.length);
    this.incoming += members.length;
    const chute = opts.chute ?? 0.38;
    const carrier = new Carrier(at, delay, carrierShipId(this.board.kind), (release, vel) => {
      this.incoming -= members.length;
      if (this.disposed) return;
      const bodies = members.map((m, i) => {
        const e = field(m);
        // let go in a stick: each body a couple of metres behind the
        // last along the flight line, with a shove of the ship's speed
        const back = _stick.copy(vel).normalize().multiplyScalar(-i * 2.2);
        back.x += (Math.random() - 0.5) * 1.5;
        back.z += (Math.random() - 0.5) * 1.5;
        e.beginArrival('drop', back.add(release), m.pos, {
          chute: Math.random() < chute,
          // a fraction of the ship's speed: enough that the fall arcs
          // out of the pass instead of stopping dead, small enough that
          // the steering always wins before a platform edge does
          velocity: _stickVel.copy(vel).multiplyScalar(0.12).setY(0),
        });
        return e;
      });
      opts.onRelease?.(bodies);
    }, { dropHeight: this.dropHeight });
    this.carriers.push(carrier);
    this.scene.add(carrier.group);
    return carrier;
  }

  /**
   * Missions: bring a room's wave in by transport instead of standing it up in
   * the room (src/game/campaign.ts).
   *
   * A mission level is a chain of walled rooms with the open sky for a ceiling,
   * so the wave game's carrier pass works over it unchanged — which is the
   * point: a squad that descends into the room reads as reinforcements being
   * committed, where bodies appearing beside the wall read as a spawn. No
   * parachutes: a canopy takes seven seconds to cover the drop and a sealed
   * room is not the place to wait it out.
   *
   * `onRelease` receives the bodies the moment the ship lets them go, which is
   * the first moment they exist. Until then the room is still owed them.
   * Returns the seconds until that moment, so the room can telegraph where
   * the squad is about to come down.
   */
  dropReinforcements(
    kinds: EnemyKind[], spots: THREE.Vector3[], squad: number,
    onRelease: (bodies: Enemy[]) => void,
  ): number {
    const members = kinds.map((kind, i) => ({
      kind,
      pos: this.campaign ? this.campaign.placeNear(spots[i].clone(), kind) : spots[i].clone(),
    }));
    this.waveSpawned += members.length;
    return this.flybyDrop(members, 0.2 + Math.random() * 0.5, (m) => {
      const e = new Enemy(m.kind, m.pos);
      e.squad = squad;
      e.squadSize = members.length;
      return this.addEnemy(e);   // counted above, when the drop was staged
    }, { chute: 0, onRelease }).eta;
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
      this.events.banner(TEXT.banners.groundOpening.title, TEXT.banners.groundOpening.sub);
      audio.mythosaur(0.6);
      for (const p of this.players) p.groundShake(0.5);
      return;
    }
    if (this.monsterQuake <= 0) return;

    this.monsterQuake -= dt;
    // A rolling shake rather than one jolt, so the beat builds — and it is the
    // *ground* opening, so it reaches whoever is standing on it. A player up
    // on the jetpack watches it happen instead of being rattled by it.
    for (const p of this.players) p.groundShake(0.12);
    if (this.monsterQuake > 0) return;

    const wanted = (this.monsterAt ?? this.players[0].position).clone();
    const at = this.campaign
      ? this.campaign.placeNear(wanted, monster.kind)
      : standingSpot(this.board, wanted, monster.kind);
    this.monsterAt = null;
    const beast = new Enemy(monster.kind, at);
    beast.promoteBoss(monster.name, 1, 1, 1);
    this.addEnemy(beast, { counts: true });
    this.particles.explosion(at.clone());
    this.boss = beast;
    this.monsterKind = monster.kind;
    this.bossPhase = 0;
    this.bossIntroT = BOSS_INTRO_LEN;
    this.bossMoveCd = 8;
    this.bossTelegraph = 0;
    for (const e of this.enemies) if (e.alive) e.suppress(1.2);
    const sub = TEXT.banners.neverEmpty(this.board.name);
    if (this.events.bossIntro) this.events.bossIntro(monster.name, sub);
    else this.events.banner(monster.name, sub);
    audio.bossHorn();
    audio.beastGrowl(0.9);
    // the monster is the same battle continuing, so the theme carries over
    // rather than starting again under it
    this.startBossMusic();
  }

  /** Hand the music bus to the warlord's theme, unless it already has it. */
  private startBossMusic(): void {
    if (this.bossMusic) return;
    this.bossMusic = true;
    audio.startBossMusic(this.board.music, this.board.kind);
  }

  /**
   * Give the board its own score back once the boss battle is over.
   *
   * The theme belongs to the fight, not to the rest of the match: a campaign
   * arena carries on after its boss falls, and on a monster board the warlord
   * going down is an interval, not the end — so the handover waits for the
   * monster too.
   */
  private updateBossMusic(): void {
    if (!this.bossMusic || this.state !== 'fighting') return;
    if (this.boss?.alive || this.monsterAt || this.monsterQuake > 0) return;
    this.bossMusic = false;
    audio.startMusic(this.board.music, this.board.kind);
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
    const wanted = frac < 1 / 3 ? 2 : frac < 2 / 3 ? 1 : 0;
    if (wanted > this.bossPhase) {
      // one turn per frame: a rocket that carries the bar through both marks
      // at once still plays the first retinue call, then the enrage next frame
      const due = this.bossPhase + 1;
      this.bossPhase = due;
      // a monster calls its own hangers-on, not the board's garrison
      const guard = (this.monsterKind === b.kind
        ? MONSTER_BOSS[this.board.kind]?.retinue
        : undefined) ?? BOSS_RETINUE[this.board.kind];
      const lead = this.players.find((p) => p.alive) ?? this.players[0];
      for (let i = 0; i < 3 + due; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = this.addReinforcement(guard, b.position.clone().add(new THREE.Vector3(Math.cos(a) * 10, 0.2, Math.sin(a) * 10)), 9900 + due);
        // The retinue lands ten metres out, right after the pulse has thrown
        // the player, and used to open fire the frame it stood up (audit B6).
        // A soft alert first gives it the beat everyone else gets between
        // noticing and acting (a quarter-second and change, turning to look);
        // the hard alert then commits it without shortening that beat.
        if (lead) {
          e.alert(lead.position, false);
          e.alert(lead.position, true);
        }
      }
      // the turn itself is a beat: a damage-free repulsor pulse breaks any
      // melee scrum so the new phase starts at range, on both sides' terms
      this.bossShockwave(b, 10, 0, 9);
      if (due === 2) b.enrage();
      this.events.banner(b.bossName, due === 1 ? TEXT.banners.callsForBackup : TEXT.banners.lastStand);
      audio.bossHorn(false);
    }

    // ---- the shock-slam: the anti-camping move ----
    if (this.bossIntroT > 0) return;
    // a burrower under the ground has its own answer to a camper — the
    // eruption — and a slam telegraphed from under the sand would promise a
    // hit from a body nobody can see
    if (b.submerged) { this.bossTelegraph = 0; return; }
    if (this.bossTelegraph > 0) {
      // winding up: ember ring so the radius is readable, then the hit
      this.bossTelegraph -= dt;
      // The ring is drawn where the hit lands: sparks used to sit at 3 m
      // while the slam reached 8.5 m, so a player standing outside the ring
      // at 6 m ate a hit the telegraph had promised would miss. Denser, and
      // at the edge, so the get-out line is the line drawn on the ground.
      if (Math.floor((this.bossTelegraph + dt) * 16) !== Math.floor(this.bossTelegraph * 16)) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          this.particles.impactSparks(b.position.clone().add(new THREE.Vector3(Math.cos(a) * BOSS_SLAM_R, 0.4, Math.sin(a) * BOSS_SLAM_R)), 4);
        }
      }
      if (this.bossTelegraph <= 0) {
        this.bossShockwave(b, BOSS_SLAM_R, 26, 12);
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
      // the ember ring promises where the slam lands: no super jump mid-promise
      b.superJumpCd = Math.max(b.superJumpCd, 1.4);
      audio.impact();
    }
  }

  /**
   * The droid servo bed's level: every walking droid within earshot, weighted
   * by how close it is and whether it is actually moving. A still droid is a
   * quiet one, so a room of powered-down machines does not hum.
   */
  private updateDroidServo(): void {
    let level = 0;
    for (const e of this.enemies) {
      if (!e.alive || (e.kind !== 'droid' && e.kind !== 'darktrooper')) continue;
      let near = Infinity;
      for (const p of this.players) {
        if (!p.alive) continue;
        near = Math.min(near, p.position.distanceToSquared(e.position));
      }
      if (near > 30 * 30) continue;
      const moving = Math.min(1, Math.hypot(e.velocity.x, e.velocity.z) / 3);
      level += (1 - Math.sqrt(near) / 30) * (0.25 + moving * 0.75);
    }
    audio.setDroidServo(Math.min(1, level * 0.5));
  }

  /** throw every player inside `radius` up and away from the warlord */
  private bossShockwave(b: Enemy, radius: number, dmg: number, push: number): void {
    this.blast(b.position, {
      // flat, not falling off: standing at the rim of a warlord's slam has
      // always cost the full 26, and the ember ring promises exactly that reach
      players: { radius, damage: dmg, flat: true, push, lift: push * 0.8 },
      shake: { amount: dmg > 0 ? 0.3 : 0.15, radius, flat: true, ground: true },
      sound: 'explosion',
    });
  }

  /**
   * One ring of force, wherever one is needed: the rocket, the warlord's
   * shock-slam and its phase pulse, a ground slam, an elite's stomp.
   *
   * Each class of victim carries its own reach and its own numbers, because
   * they genuinely differ — a rocket reaches an enemy at 7 m and a player at
   * 4.5, and scatters corpses further than it hurts anyone. What they share
   * is everything that used to be copied around them: the distance test, the
   * linear falloff, the alive check, the friendly-fire guard, and the fact
   * that a blast is loud. `zero` is where the falloff reaches nothing; left
   * out it is the reach itself, and set beyond it the rim still takes some.
   */
  private blast(point: THREE.Vector3, spec: BlastSpec): void {
    const byTeam = spec.bySlot !== undefined && spec.bySlot >= 0
      ? this.players[spec.bySlot]?.team ?? -1 : -1;
    const bySlot = spec.bySlot ?? -1;
    const share = (ring: Ring, d: number): number =>
      ring.flat ? 1 : Math.max(0, 1 - d / (ring.zero ?? ring.radius));

    // Scenery first: an explosive barrel detonates from in here, and resolving
    // the chain outward before anything else is hurt is the order this has
    // always run in.
    if (spec.breakables) this.damageBreakablesNear(point, spec.breakables.radius, spec.breakables.damage);
    if (spec.enemies) {
      const ring = spec.enemies;
      for (const e of this.enemies) {
        if (!e.alive || e.team === byTeam) continue;
        const d = e.position.distanceTo(point);
        if (d >= ring.radius) continue;
        if (ring.damage) e.damage(ring.damage * share(ring, d), point, bySlot);
        if (ring.push) e.knockback(point, ring.push, ring.stagger);
        if (ring.knockdown) e.knockdown(ring.knockdown[0] + Math.random() * ring.knockdown[1]);
      }
    }
    if (spec.corpses) {
      // a blast scatters what is already lying there, which is half of what
      // an explosion looks like
      const ring = spec.corpses;
      for (const e of this.enemies) {
        if (!e.corpse) continue;
        const d = e.position.distanceTo(point);
        if (d < ring.radius) e.shoveCorpse(point, ring.damage * share(ring, d));
      }
    }
    if (spec.players) {
      const ring = spec.players;
      // No friendly-fire guard here, deliberately: your own rocket at your own
      // feet has always cost you, and a co-op partner standing in it takes the
      // same graze. The guard above is about a squad and a brood, which live
      // in `enemies` on their owner's team.
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = p.position.distanceTo(point);
        if (d >= ring.radius) continue;
        // PvP lets a rocket end a duel, but never turns its own thrower into
        // the easier kill: the rival's share is the caller's `rival` number.
        const dmg = ring.rival !== undefined && bySlot >= 0 && p.slot !== bySlot
          ? ring.rival : ring.damage;
        if (dmg) p.damage(dmg * share(ring, d), point, bySlot, { heavy: true });
        if (ring.push) {
          _away.subVectors(p.position, point).setY(0);
          if (_away.lengthSq() > 1e-6) _away.normalize();
          p.velocity.x += _away.x * ring.push;
          p.velocity.z += _away.z * ring.push;
          if (ring.lift) p.velocity.y = Math.max(p.velocity.y, ring.lift);
        }
      }
    }
    if (spec.vehicles) {
      const ring = spec.vehicles;
      for (const v of this.vehicles) {
        if (!v.alive) continue;
        const d = v.pos.distanceTo(point);
        // dead centre is the rider's own ride going up under them
        if (d > 0.5 && d < ring.radius) v.damage(ring.damage * share(ring, d), point, bySlot);
      }
    }
    if (spec.shake) {
      const { amount, radius, flat, ground } = spec.shake;
      for (const p of this.players) {
        const d = p.position.distanceTo(point);
        const amt = flat ? (d < radius ? amount : 0) : Math.max(0, amount * (1 - d / radius));
        // a ring that travels through the floor (a slam, a stomp) only shakes
        // what is standing on it; a blast wave in the air reaches everyone
        if (ground) p.groundShake(amt);
        else p.cam.shake(amt);
      }
    }
    if (spec.noise) this.director.noise(this, point, spec.noise, true);
    if (spec.sound === 'explosion') audio.explosion();
    else if (spec.sound === 'impact') audio.impact();
  }

  /**
   * The one way a body joins the match. Every spawn path — the wave spawner,
   * arrivals and drops, the campaign's posts, eggs and hatchlings, PvP squads,
   * the bosses — comes through here, so the scene, the list and the per-frame
   * hostile cache can never disagree about who is on the field. Five hand
   * copies of push-and-add used to exist, and the hatch path had forgotten
   * the cache: a spiderling was invisible to every aim cone until the next
   * frame. `counts` adds the body to the wave's tally (the clear check);
   * `puff` kicks up that much dust where it stands.
   */
  addEnemy(e: Enemy, opts: { counts?: boolean; puff?: number } = {}): Enemy {
    if (opts.counts) this.waveSpawned++;
    this.enemies.push(e);
    this.scene.add(e.char.root);
    this.hostileCache.clear();
    if (opts.puff) this.particles.dustPuff(e.position, opts.puff);
    return e;
  }

  /**
   * Every body on the field with an AI behind it, hostiles and allies alike.
   * Two lists exist because spawning and cleanup differ, not because the AI
   * does — anything planning for the fight as a whole (the director) wants
   * both.
   */
  *fighters(): Generator<Enemy> {
    for (const e of this.enemies) yield e;
    for (const a of this.allies) yield a;
  }

  /**
   * A clear patch of ground for a body of `kind` at or near `want`.
   *
   * In a mission the level's own placement is the only safe one: the
   * board-wide `standingSpot` falls back to the territory's ground ninety
   * metres below the mission floor. Three callers had grown their own copy of
   * this two-line pick; they all come through here now.
   */
  groundSpot(want: THREE.Vector3, kind: EnemyKind): THREE.Vector3 {
    return this.campaign ? this.campaign.placeNear(want, kind) : standingSpot(this.board, want, kind);
  }

  /** the same door for the allies' list */
  addAlly(a: Enemy, puff = 0): Enemy {
    this.allies.push(a);
    this.scene.add(a.char.root);
    this.hostileCache.clear();
    if (puff) this.particles.dustPuff(a.position, puff);
    return a;
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
    return this.addEnemy(e, { counts: true, puff: 8 });
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

  /**
   * A swing lands on the world, not only on bodies.
   *
   * Everything a bolt can break — the supply cache, the barrels, the ice
   * plates, a parked ride — a blade, a gaffi stick or a bare fist can break
   * too. Anything a player can do with the trigger has to be something the
   * melee build can do as well, and the cache was the case that made it plain:
   * the only way to spring it was to shoot it, so a fighter who had put the
   * gun away could not open their own reinforcements.
   *
   * Same arc as the body hit — reach in front of the swinger — but measured to
   * the nearest point of the prop rather than to its middle, so a long plate
   * is struck where the blade actually met it.
   *
   * @returns true if the swing found something, so the swing can play contact
   */
  meleeProps(from: THREE.Vector3, facingYaw: number, range: number, dmg: number, bySlot: number): boolean {
    const fx = Math.sin(facingYaw), fz = Math.cos(facingYaw);
    // chest height: a swing is not a scan of the ground under your boots
    const y = from.y + 1;
    let hit = false;
    const inFront = (x: number, z: number, reach: number): boolean => {
      const dx = x - from.x, dz = z - from.z;
      const flat = Math.hypot(dx, dz);
      if (flat > reach) return false;
      return flat < 0.2 || (dx * fx + dz * fz) / flat > 0.25;
    };
    for (const b of this.board.breakables ?? []) {
      if (b.broken) continue;
      const box = b.box;
      const nx = Math.min(Math.max(from.x, box.min.x), box.max.x);
      const nz = Math.min(Math.max(from.z, box.min.z), box.max.z);
      const ny = Math.min(Math.max(y, box.min.y), box.max.y);
      if (Math.abs(ny - y) > range) continue;                 // over your head / at your feet
      if (!inFront(nx, nz, range)) continue;
      this.hurtBreakable(b, dmg);
      hit = true;
    }
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      if (Math.abs(v.pos.y + 1 - y) > range + 1) continue;
      if (!inFront(v.pos.x, v.pos.z, range + v.def.radius)) continue;
      v.damage(dmg, from, bySlot);
      hit = true;
    }
    return hit;
  }

  /**
   * Hurt one prop, and break it when it runs out. Public because the things
   * that can hit a prop are not all bolts: a swing, a thrown blade and a blast
   * all come through here.
   */
  hurtBreakable(b: Breakable, dmg: number): void {
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
    audio.stopDroidServo();
    audio.stopBurrowRumble();
    audio.stopEngines();

    for (const c of this.carriers) c.dispose();
    this.carriers.length = 0;
    this.incoming = 0;

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
  startFor(i: number): THREE.Vector3 {
    const board = this.board;
    const declared = board.playerStarts[i];
    if (declared) return declared;
    const base = board.playerStarts[board.playerStarts.length - 1] ?? board.playerStarts[0];
    const step = board.playerStarts.length > 1
      ? board.playerStarts[1].x - board.playerStarts[0].x
      : 3;
    return base.clone().setX(base.x + step * (i - board.playerStarts.length + 1));
  }

  /** one hand on the controller per bot, kept for the life of the match */
  private botInput(p: Player, dt: number): FrameInput {
    let brain = this.brains.get(p.slot);
    if (!brain) { brain = new BotBrain(); this.brains.set(p.slot, brain); }
    return brain.think(p, this, dt);
  }

  hitMarker(slot: number): void {
    this.events.hitMarker(slot);
    audio.hitMarker();
  }

  /**
   * The HUD's marker without the sound: a scoring beat (a PvP down) rather
   * than a bolt landing, which already made its own noise where it hit.
   */
  scoreMarker(slot: number): void {
    this.events.hitMarker(slot);
  }

  /**
   * `scale` sizes the whole event — the fireball, how far the wave reaches and
   * what it is worth when it gets there. A rocket is 1; a destroyed ride
   * passes its own hull's measure (see `Vehicle.blastScale`), so a swoop going
   * up beside you is survivable and a skiff going up beside you is not.
   */
  private explode(point: THREE.Vector3, bySlot: number, scale = 1): void {
    this.particles.explosion(point, scale);
    const r = (base: number) => base * (0.75 + scale * 0.25);
    const d = (base: number) => base * (0.6 + scale * 0.4);
    this.blast(point, {
      bySlot,
      // the blast wave puts a body flat as well as hurting it
      enemies: { radius: r(7), damage: d(90), zero: r(8), push: 18, stagger: 0.6, knockdown: [1.4, 0.8] },
      corpses: { radius: r(9), damage: d(26), zero: r(10) },
      // in PvP a rocket is a duel-ender against a rival; against yourself it
      // is the same graze it has always been
      players: { radius: r(4.5), damage: d(18), rival: this.mode === 'pvp' ? d(70) : undefined },
      vehicles: { radius: r(7), damage: d(80), zero: r(8) },
      breakables: { radius: r(6), damage: d(90) },   // scenery is not exempt (chains!)
      shake: { amount: 0.35 * (0.7 + scale * 0.4), radius: 35 * (0.8 + scale * 0.2) },
      noise: 70,                                // an explosion is not subtle
      sound: 'explosion',
    });
  }

  /**
   * Take a body out of the match for good. `dispose()` at the end walks only
   * what is still in the scene, so a body merely removed here — every corpse
   * that faded mid-match, every hatched egg — kept its procedural limb
   * geometry resident for the life of the tab: seven waves of bodies, per
   * match, forever. Shared resources (the material cache, authored .glb
   * geometry) are tagged and skipped by the teardown.
   */
  private retire(root: THREE.Object3D): void {
    this.scene.remove(root);
    disposeSubtree(root);
  }

  get aliveEnemyCount(): number { return this.enemies.filter((e) => e.alive).length; }
  /** hostiles the wave has staged that are not on the field yet (aboard a carrier) */
  get incomingCount(): number { return this.incoming; }
  /** carrier passes currently in the sky, for the tests */
  get carrierCount(): number { return this.carriers.length; }
  /** how many of those set down to unload rather than overflying */
  get landingPassCount(): number { return this.carriers.filter((c) => c.lands).length; }

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

    // carrier passes: fly, release their squads over the posts, leave
    for (let i = this.carriers.length - 1; i >= 0; i--) {
      if (!this.carriers[i].update(dt)) {
        const gone = this.carriers.splice(i, 1)[0];
        this.scene.remove(gone.group);
        gone.dispose();
      }
    }

    // ---- moving platforms carry their riders ----
    // The board has already re-placed each mover's box; whoever is standing on
    // the old top rides the frame's displacement, so a heaving deck under your
    // feet is ground, not a treadmill.
    if (this.board.movers) {
      for (const m of this.board.movers) {
        if (m.delta.lengthSq() < 1e-10) continue;
        // Anything the mover carries counts as ground: a ship whose colliders
        // were fitted to its hull is several surfaces, and a rider standing on
        // any of them travels with it.
        const surfaces = m.surfaces();
        const carry = (pos: THREE.Vector3, radius: number): void => {
          for (const b of surfaces) {
            if (pos.x < b.min.x - radius || pos.x > b.max.x + radius) continue;
            if (pos.z < b.min.z - radius || pos.z > b.max.z + radius) continue;
            if (Math.abs(pos.y - (b.max.y - m.delta.y)) > 0.5) continue;
            pos.add(m.delta);
            return;
          }
        };
        for (const p of this.players) if (p.alive) carry(p.position, p.radius);
        for (const e of this.enemies) if (e.alive) carry(e.position, e.radius);
        for (const a of this.allies) if (a.alive) carry(a.position, a.radius);
      }
    }

    // ---- the mode's own rules (docs/MODES.md §1) ----
    // The wave clock, PvP's scoring, the campaign's objectives: one call, and
    // the simulation below it is the same in all three.
    this.stateTimer -= dt;
    this.rules.update(dt);

    // boss phases run wherever a boss stands (either boss battle, campaign arenas)
    if (this.state === 'fighting') this.updateMonsterStage(dt);
    this.updateBoss(dt);
    this.updateDroidServo();
    this.updateBossMusic();

    // the supply cache pulses until someone cracks it, then sheds its panels
    this.allyCrate?.update(dt);

    // the doors move whatever the match is doing; what they are *for* is
    // decided by the campaign's own rules above
    this.campaign?.animateGates(dt);

    // ---- players ----
    const ended = this.state === 'defeat' || this.state === 'victory';
    for (const p of this.players) {
      p.update(dt, p.isBot ? this.botInput(p, dt) : inputs[p.slot], this);
      if (p.alive || p.respawnTimer > 0 || ended) continue;
      this.rules.respawn(p);
    }
    this.rules.partyWiped?.();

    // ---- vehicles ----
    // Ridden ones were driven inside their rider's update; this settles the
    // parked ones and detonates anything that died this frame.
    for (const v of this.vehicles) {
      v.update(dt, this);
      if (v.pendingExplosion) {
        const px = v.pendingExplosion;
        v.pendingExplosion = null;
        this.explode(px.at, px.slot, px.scale);
      }
      // a mount has no repulsor core to go up: it drops, and the sand it
      // kicks up is the whole of it
      if (v.pendingCollapse) {
        const at = v.pendingCollapse;
        v.pendingCollapse = null;
        this.particles.dustPuff(at, 26);
        this.particles.disintegrate(at.clone().setY(at.y + 1.2), 14);
        audio.banthaLow(0.6);
      }
      // twenty seconds on, it is back where it was parked: the sand gathers
      // itself up into an animal again, or a hull settles onto its repulsors
      if (v.pendingReform) {
        const at = v.pendingReform;
        v.pendingReform = null;
        this.particles.dustPuff(at, 16);
        if (v.def.living) {
          this.particles.disintegrate(at.clone().setY(at.y + 1.4), 16);
          audio.banthaLow(0.4);
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
      if (e.removeMe) this.retire(e.char.root);
    }
    this.enemies = this.enemies.filter((e) => !e.removeMe);

    // ---- allies ----
    for (const a of this.allies) {
      a.update(dt, this);
      if (!a.alive && !a.counted) {
        a.counted = true;
        this.particles.deathBurst(a.position.clone().add(new THREE.Vector3(0, a.height * 0.5, 0)));
      }
      if (a.removeMe) this.retire(a.char.root);
    }
    this.allies = this.allies.filter((a) => !a.removeMe);


    // ---- projectiles ----
    const targets = this.targets;
    targets.length = 0;
    let slot = 0;
    for (const e of this.enemies) {
      // a burrower under the ground is alive and on the bar, and not a body
      // to shoot: bolts pass over the wake and the lock-on finds nothing
      if (!e.targetable) continue;
      // the extra spheres come off the instance, not the shared Def: a
      // promoted boss carries its own grown copy
      _body.position = e.position;
      _body.yaw = e.yaw;
      _body.team = e.team;
      _body.hitHeight = e.height;
      _body.hitRadius = e.radius;
      _body.parts = e.hitParts;
      _body.shield = e.shieldCollider;
      _body.shieldCoversParts = false;
      _body.slot = undefined;
      slot = this.addBody(slot, _body, e, null);
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      // a blade sends the bolt back at somebody, so the player needs to be
      // told who is in front of them before the collider is read
      p.deflectEnemy = p.sabersDrawn ? this.nearestHostileInFront(p) : null;
      // Shot as the creature they are, not as the collider they walk in: the
      // profile's hit volume is the NPC's own, so a playable massiff takes a
      // bolt anywhere the same animal would as a hostile. A Mandalorian's two
      // numbers agree, so this is where it has always been for him.
      _body.position = p.position;
      _body.yaw = p.yaw;
      _body.team = p.team;
      _body.hitHeight = p.profile.hitHeight;
      _body.hitRadius = p.profile.hitRadius;
      _body.parts = p.profile.hitParts;
      _body.shield = p.shieldCollider;
      _body.shieldCoversParts = true;
      _body.slot = p.slot;
      slot = this.addBody(slot, _body, null, p);
    }
    // ---- corpses ----
    // A body that has stopped moving is still a body. Team 2 is the scenery
    // team, hit by both sides and hitting neither back, which is what a corpse
    // is now: no damage, no kill credit, no lock-on (aim assist only ever
    // considers the living) — just something that moves when it is shot. It is
    // also the answer for a wide flat animal that settles the right way up
    // despite the roll: another bolt tips it the rest of the way.
    for (const e of this.enemies) {
      const body = e.corpse;
      if (!body) continue;
      const t = this.claim(slot++);
      t.enemy = e;
      t.corpse = true;
      t.position.copy(body.at);
      t.radius = body.radius;
      t.team = 2;
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
          const p = this.claim(slot++);
          p.position.set(b.center.x + (alongX ? t : 0), b.center.y, b.center.z + (alongX ? 0 : t));
          p.radius = b.radius;
          p.team = 2;
          p.breakable = b;
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
        const t = this.claim(slot++);
        t.vehicle = v;
        t.position.set(v.pos.x + sin * along, v.pos.y + v.def.body * 0.5, v.pos.z + cos * along);
        t.radius = r;
        t.team = 2;
        targets.push(t);
      }
    }
    for (const a of this.allies) {
      if (!a.alive) continue;
      _body.position = a.position;
      _body.yaw = a.yaw;
      _body.team = 0;
      _body.hitHeight = a.height;
      _body.hitRadius = a.radius;
      _body.parts = NO_PARTS;   // an ally is a body, not a boss: one sphere is enough
      _body.shield = null;
      _body.shieldCoversParts = false;
      _body.slot = undefined;
      slot = this.addBody(slot, _body, a, null);
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
   * A blank pooled entry: every owner field cleared, so nothing an earlier
   * frame put on it can leak into what this one stands for.
   */
  private claim(i: number): PooledTarget {
    const t = this.pooledTarget(i);
    t.enemy = null;
    t.player = null;
    t.breakable = null;
    t.vehicle = null;
    t.corpse = false;
    t.shield = null;
    t.slot = undefined;
    t.alive = true;
    return t;
  }

  /**
   * Stand one body up as bolt targets: the sphere on its chest, plus the extra
   * spheres a long body carries (a war massiff is five metres of animal behind
   * one 0.85 m sphere, and shots at its head used to pass through).
   *
   * A hostile and a playable are the same problem, and were two nearly
   * identical twenty-line blocks — the second of which had already drifted
   * (the player's pane answers for every sphere, the enemy's only for its
   * chest, which is deliberate and now says so once).
   */
  private addBody(slot: number, b: HitBody, enemy: Enemy | null, player: Player | null): number {
    const t = this.claim(slot++);
    t.enemy = enemy;
    t.player = player;
    t.position.set(b.position.x, b.position.y + b.hitHeight * 0.5, b.position.z);
    t.radius = b.hitRadius + 0.35;
    t.team = b.team;
    t.shield = b.shield;
    t.slot = b.slot;
    this.targets.push(t);
    if (!b.parts.length) return slot;
    const sin = Math.sin(b.yaw), cos = Math.cos(b.yaw);
    for (const part of b.parts) {
      const h = this.claim(slot++);
      h.enemy = enemy;
      h.player = player;
      h.position.set(
        b.position.x + sin * part.z,
        b.position.y + part.y,
        b.position.z + cos * part.z,
      );
      h.radius = part.r;
      h.team = b.team;
      // the raised pane is a real thing in front of the whole fighter, so it
      // answers for every sphere; a hostile's shield only covers its chest
      h.shield = b.shieldCoversParts ? b.shield : null;
      h.slot = b.slot;
      this.targets.push(h);
    }
    return slot;
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
        // A corpse takes no damage — it is already dead — but it moves.
        if (entry.corpse) { entry.enemy?.shoveCorpse(from, 9); return; }
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
        // damage() alerts to `from`, which is where the bolt was — a metre
        // off the victim — so a target shot from beyond its notice range
        // "arrived" at once, found nothing, and went back to its post. Tell
        // it where the shot actually came from.
        const shooter = bySlot >= 0 ? this.players[bySlot] : undefined;
        if (shooter && e.alive) e.alert(shooter.position, true);
        if (e.team !== 1) return;   // allies take the damage without the shove
        // every hit shoves: light per bolt, but it stacks over a burst
        e.knockback(from, 5.5, 0.2);
        if (wasAlive && bySlot >= 0) this.hitMarker(bySlot);
      },
    };
    this.targetPool[i] = entry;
    return entry;
  }

  setState(s: MatchState, timer?: number): void {
    this.state = s;
    if (timer !== undefined) this.stateTimer = timer;
    if (s === 'victory') audio.sting(true);
    if (s === 'defeat') audio.sting(false);
    this.events.stateChanged(s);
  }

  /**
   * The playable broodmother puts an egg down at `at` (her Y — docs/MODES.md
   * §3). It hatches into a hunting spiderling on her team after 5 s and can
   * be destroyed the whole time.
   */
  layEgg(p: Player, from: THREE.Vector3, vel: THREE.Vector3): boolean {
    // born at the back-sac it left and tossed gently off: it falls with real
    // physics and settles behind her, rather than snapping to the ground
    const egg = this.spawnEggFor(p, from);
    if (!egg) return false;
    egg.velocity.copy(vel);
    return true;
  }

  /**
   * The broodmother's RT: the same egg, lobbed on an arc at the aim. On the
   * way it is a soft cannonball — the first body it meets is knocked back,
   * unhurt — and wherever it lands it incubates on the ordinary 5 s clock.
   */
  throwEgg(p: Player, from: THREE.Vector3, dir: THREE.Vector3): boolean {
    const egg = this.spawnEggFor(p, from);
    if (!egg) return false;
    egg.eggThrown = true;
    egg.velocity.copy(dir).multiplyScalar(17);
    egg.velocity.y += 4.5;
    return true;
  }

  /**
   * There is no ceiling on the brood, by design: the only thing rationing it
   * is how fast she can grow eggs (one every three seconds, six on her back),
   * so a queen who spends a whole match laying earns the swarm she built. The
   * old head-count cap of eight made the sixth egg silently do nothing, which
   * read as the button being broken rather than as a limit.
   */
  private spawnEggFor(p: Player, at: THREE.Vector3): Enemy | null {
    const egg = new Enemy('spiderEgg', at, p.team);
    egg.setOwner(p);
    this.addEnemy(egg, { puff: 5 });
    audio.bark('spider_chitter', 0.5);
    return egg;
  }

  /**
   * Ring the next wave. Only the wave game has one; the other modes ignore
   * it. Kept on `Game` because the suites drive the flow through it.
   */
  nextWave(): void {
    if (this.rules instanceof WaveRules) this.rules.nextWave();
  }

  /** HUD top line: the mode's, or the shared default (the HUD stays mode-agnostic) */
  hudTopLine(p: Player): string {
    if (this.state === 'victory') return TEXT.hud.victory;
    return this.rules.topLine(p) ?? TEXT.hud.wave(Math.max(this.wave, 1));
  }

  /** HUD score line: the mode's, or the shared kills-and-hostiles count */
  hudScoreLine(p: Player): string {
    return this.rules.scoreLine(p)
      ?? TEXT.hud.killsAndHostiles(p.kills, this.aliveEnemyCount + this.incoming);
  }

  /** the far side of the board: the last resort for a boss with nowhere in view to stand */
  farPost(): THREE.Vector3 {
    const near = this.players[0]?.position ?? this.board.playerStarts[0];
    let far = this.board.groundSpawns[0] ?? near;
    for (const s of this.board.groundSpawns) {
      if (s.distanceToSquared(near) > far.distanceToSquared(near)) far = s;
    }
    return far.clone();
  }

  /**
   * Where a boss battle posts its warlord: 30–40 m out from player one,
   * inside their camera's view arc, on ground the boss can stand on — so the
   * reveal pans onto a figure, not a dot on the horizon (audit B10). Only the
   * far side of the board when nothing in view will hold him.
   */
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

    const n = this.humans;
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
