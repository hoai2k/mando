import * as THREE from 'three';
import { travelClip, type Animator } from '../anim/animator';
import { beginArrival, clearArrival, updateArrival, type ArrivalState } from './arrival';
import {
  buildAlamite, buildBroodmother, buildDarkTrooper, buildDroid, buildDuelist,
  buildFlametrooper, buildGunfighter, buildIG, buildImperialOfficer,
  buildInterceptorDrone, buildKrykna, buildMassiff, buildNikto, buildPykeCapo,
  buildKraytDragon, buildMamacore, buildMudhorn, buildMythosaur,
  buildKwazelMaw, buildNexu, buildSandworm, buildZillo,
  buildQuarren, buildRancor, buildRavinak,
  buildSpiderEgg, buildSpiderling,
  buildRingEnforcer, buildWookieeEnforcer,
  buildPirate, buildPyke, buildStormtrooper, buildTusken,
} from '../characters/enemies';
import type { CharacterInstance } from '../characters/builder';
import { clamp, damp, dampAngle } from '../core/math';
import { bodyLuma, contrastNeed, haloPeak, haloStrength, makeHalo, skylineTone, type HaloTone } from '../fx/skyline';
import { Ragdoll, RigidRagdoll } from '../anim/ragdoll';
import { markOwned } from '../core/dispose';
import { audio, type BarkName } from '../core/audio';
import { applyKnockback, bodyGravity, newBurnState, stepBody, tickHazards } from '../core/body';
import type { Game } from '../game/game';

/** Anything that can be targeted and hurt — players, enemies, allies. */
export interface Combatant {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  alive: boolean;
  radius: number;
  height: number;
  /**
   * The body to *shoot at*, when that differs from the capsule to walk around.
   * A playable NPC's collider is clamped so a war beast still fits the boards'
   * doorways, which makes `height` the wrong number to aim by — a shooter
   * using it puts bolts through a five-metre creature's ankles. Absent means
   * the two agree, which is true of every hostile.
   */
  hitHeight?: number;
  team: number; // 0 = players/allies, 1 = hostiles
  /**
   * `opts.heavy` marks a committed, telegraphed hit — a slam, a pounce, a
   * wind-up swing landing, a detonation — which a player's hit window never
   * swallows. Enemies do not have the window and ignore the flag.
   */
  damage(amount: number, from: THREE.Vector3, bySlot?: number, opts?: { dot?: boolean; heavy?: boolean }): void;
}

/** the directional flinch clips — a re-trigger of one of these waits for the last to mostly resolve */
const HIT_REACTS = new Set(['hitUpper', 'hitFromL', 'hitFromR']);

/**
 * The second, committed moves (audit B11). Each is a telegraphed wind-up
 * with a real get-out window and lands the kind's ordinary melee damage —
 * they replace a swing on the same cooldown, never add to it.
 *
 * The officer's dash-slash: half a second of blade sparks and a bark, then
 * a straight lunge along the line fixed at launch. No tracking after that,
 * so a dash sideways beats it; the reach on contact is deliberately tighter
 * than the swing's so a sidestep is enough.
 */
const DASH_WINDUP = 0.5;
const DASH_SPEED = 20;
const DASH_LENGTH = 7;
const DASH_REACH = 2.4;
const DASH_CD = 4.5;
/** how far away the officer will open with the lunge */
const DASH_TRIGGER = 9;
/**
 * The enforcer's overhead slam: 0.7 s of wind-up with an ember ring drawn
 * at the radius the shock will reach (the same telegraph as the warlord's
 * shock-slam in game.ts), then the ground answers inside it.
 */
const SLAM_WINDUP = 0.7;
const SLAM_RADIUS = 3;
const SLAM_CD = 5;

/** where to aim on a body: mid-chest of whatever it actually is */
export function aimHeight(target: Combatant): number {
  return (target.hitHeight ?? target.height) * 0.55;
}

export type EnemyKind =
  | 'tusken' | 'massiff' | 'pirateMelee' | 'pyke' | 'pirate' | 'droid' | 'nikto' | 'jetpirate'
  | 'stormtrooper' | 'deathtrooper' | 'darktrooper' | 'duelist' | 'officer'
  | 'capo' | 'enforcer'
  | 'flametrooper' | 'krykna' | 'broodmother' | 'quarren' | 'alamite' | 'drone' | 'ringEnforcer'
  | 'ig11' | 'marshal' | 'fennec'
  | 'mudhorn' | 'ravinak' | 'mamacore' | 'rancor' | 'kraytDragon' | 'mythosaur'
  | 'sandworm' | 'zillo' | 'nexu' | 'kwazelMaw'
  | 'spiderEgg' | 'spiderling';

/**
 * Display names, for the places the game talks about a kind rather than
 * spawning it — the loading screen names who is waiting on the territory.
 */
export const ENEMY_NAME: Record<EnemyKind, string> = {
  tusken: 'Tusken Raider', massiff: 'War Massiff', pirateMelee: 'Pirate Brawler', pyke: 'Pyke Syndicate',
  pirate: 'Pirate Gunner', droid: 'Battle Droid', nikto: 'Nikto Swoop', jetpirate: 'Jetpack Pirate',
  stormtrooper: 'Stormtrooper', deathtrooper: 'Death Trooper', darktrooper: 'Dark Trooper',
  duelist: 'Gunslinger', officer: 'Imperial Officer', capo: 'Pyke Capo', enforcer: 'Wookiee Enforcer',
  flametrooper: 'Flametrooper', krykna: 'Krykna', broodmother: 'Broodmother', quarren: 'Quarren',
  alamite: 'Alamite', drone: 'Interceptor Drone', ringEnforcer: 'Ring Enforcer',
  ig11: 'IG-11', marshal: 'The Marshal', fennec: 'Fennec Shand',
  mudhorn: 'Mudhorn', ravinak: 'Ravinak', mamacore: 'Mamacore', rancor: 'Rancor',
  kraytDragon: 'Greater Krayt', mythosaur: 'Mythosaur',
  sandworm: 'Dune Worm', zillo: 'Zillo Beast', nexu: 'Nexu', kwazelMaw: 'Kwazel Maw',
  spiderEgg: 'Krykna Egg', spiderling: 'Krykna Hatchling',
};

interface Def {
  hp: number; speed: number; radius: number; height: number;
  style: 'melee' | 'ranged' | 'swoop' | 'hover';
  damage: number; attackRange: number; attackCd: number;
  /** how far this kind can spot a foe it is facing, in metres */
  notice: number;
  /**
   * Half-buried: this creature's body runs *through* the ground rather than
   * over it, so the surface has to answer for it. The number is the radius, in
   * metres, of the wake of thrown ground it drags along behind its head while
   * it moves (docs/BOSSES.md §2.5, §2.6).
   */
  plows?: number;
  /**
   * Closes the last stretch in a committed ballistic leap — the massiff's
   * signature, shared by any beast built the same way (the nexu). The arc is
   * unsteered once airborne, so a dash or a jetpack hop beats it.
   */
  pounces?: boolean;
  /**
   * Lives *under* the ground and fights in cycles (docs/BOSSES.md §2.7): it
   * hunts submerged — untargetable, unhurtable, a running wake of thrown
   * ground — erupts under its prey, fights rooted on the surface for a
   * spell, and sinks again. Numbers are seconds unless named otherwise.
   */
  burrows?: {
    /** longest it stays under before surfacing wherever it is */
    under: number;
    /** how long it fights on the surface before it sinks */
    up: number;
    rise: number;
    sink: number;
    /** it erupts once within this many metres of its prey */
    strikeAt: number;
    /** the eruption: damage, and the radius it lands in */
    erupt: number;
    eruptR: number;
  };
  /**
   * Never waits its turn. The director's standoff rotation is what stops a
   * crowd of grunts mobbing the player, but a beast that politely holds a
   * bearing while you jog away isn't a predator — relentless kinds are always
   * committed and simply run you down.
   */
  relentless?: boolean;
  /**
   * Extra hit spheres in body-local metres (z forward, y up), for anyone too
   * long to cover with the one capsule sphere — without these, shots at a
   * five-metre beast's head sail straight through it.
   */
  hitParts?: { z: number; y: number; r: number }[];
  boltSpeed?: number; volley?: number;
  /**
   * Fires a flame stream instead of bolts: the volley becomes a fan of damage
   * ticks along a fixed aim line, so sidestepping the stream beats it.
   */
  flame?: boolean;
  /** its bolts snare instead of hurting much — the net gun */
  boltTag?: string;
  /** hover kind that ends itself in a dive — the interceptor drone */
  kamikaze?: boolean;
  /** carries a frontal energy shield that turns bolts away — flank it */
  frontShield?: boolean;
  /** burn zones don't bite (a Quarren in the harbour is at home) */
  burnImmune?: boolean;
  /** every `per` fraction of max HP lost, `count` of `kind` crawl out (≤ max) */
  spawnOnHurt?: { kind: EnemyKind; per: number; count: number; max: number };
  /**
   * This kind does not fight — it sits, wobbles, and hatches: after `hatchIn`
   * seconds a `hatchTo` stands up in its place, on the egg's team and owner.
   * Destroyable the whole time through the ordinary damage path.
   */
  egg?: { hatchIn: number; hatchTo: EnemyKind };
  build: () => CharacterInstance;
}

const DEFS: Record<EnemyKind, Def> = {
  tusken:      { hp: 80, speed: 5.6, radius: 0.5, height: 1.8, style: 'melee', damage: 14, attackRange: 2.5, attackCd: 1.5, notice: 32, build: buildTusken },
  pirateMelee: { hp: 95, speed: 5.0, radius: 0.5, height: 1.9, style: 'melee', damage: 17, attackRange: 2.6, attackCd: 1.7, notice: 30, build: () => buildPirate(true) },
  // War massiff: an elite beast, not a wave-1 critter. Outruns a jog but not a
  // sprint, so breaking away costs the energy gauge; hits hard enough that
  // letting one close is a real mistake, and it pounces to cover the last gap.
  massiff:     { hp: 300, speed: 10.5, radius: 0.85, height: 2.0, style: 'melee', damage: 30, attackRange: 3.6, attackCd: 1.8, notice: 52, relentless: true,
    // skull/neck out front and the haunches behind the shoulders
    hitParts: [{ z: 1.75, y: 1.0, r: 0.65 }, { z: -1.15, y: 1.15, r: 0.7 }], build: buildMassiff },
  pyke:        { hp: 70, speed: 4.6, radius: 0.5, height: 2.0, style: 'ranged', damage: 8, attackRange: 26, attackCd: 2.4, notice: 42, boltSpeed: 26, volley: 3, build: buildPyke },
  pirate:      { hp: 85, speed: 4.2, radius: 0.5, height: 1.9, style: 'ranged', damage: 9, attackRange: 30, attackCd: 2.6, notice: 42, boltSpeed: 28, volley: 3, build: () => buildPirate(false) },
  droid:       { hp: 170, speed: 1.6, radius: 0.55, height: 2.1, style: 'ranged', damage: 15, attackRange: 40, attackCd: 1.7, notice: 48, boltSpeed: 34, volley: 1, build: buildDroid },
  nikto:       { hp: 60, speed: 15, radius: 0.8, height: 1.6, style: 'swoop', damage: 8, attackRange: 40, attackCd: 0.4, notice: 80, boltSpeed: 34, build: buildNikto },
  jetpirate:   { hp: 70, speed: 6.5, radius: 0.5, height: 1.9, style: 'hover', damage: 9, attackRange: 30, attackCd: 2.2, notice: 50, boltSpeed: 28, volley: 2, build: () => buildPirate(false) },
  // Imperial remnant
  stormtrooper: { hp: 60, speed: 4.8, radius: 0.5, height: 1.9, style: 'ranged', damage: 8, attackRange: 28, attackCd: 2.1, notice: 42, boltSpeed: 27, volley: 3, build: () => buildStormtrooper(false) },
  deathtrooper: { hp: 150, speed: 5.2, radius: 0.52, height: 2.0, style: 'ranged', damage: 12, attackRange: 32, attackCd: 2.0, notice: 48, boltSpeed: 32, volley: 4, build: () => buildStormtrooper(true) },
  // Fast, accurate and hits hard, but folds if you can close on him.
  duelist:      { hp: 190, speed: 7.2, radius: 0.5, height: 1.9, style: 'ranged', damage: 16, attackRange: 34, attackCd: 1.5, notice: 55, boltSpeed: 44, volley: 2, build: buildDuelist },
  // Closes to the darksaber's reach and hits like a truck when he gets there.
  officer:      { hp: 240, speed: 6.4, radius: 0.52, height: 1.95, style: 'melee', damage: 26, attackRange: 3.0, attackCd: 1.3, notice: 50, build: buildImperialOfficer },
  // Shielded shooter: out-range him or flank him, he will not be rushed down.
  capo:         { hp: 260, speed: 4.2, radius: 0.55, height: 2.05, style: 'ranged', damage: 14, attackRange: 30, attackCd: 1.8, notice: 50, boltSpeed: 30, volley: 4, build: buildPykeCapo },
  // Two and a half metres of gladiator; slow to arrive, ruinous once there.
  enforcer:     { hp: 420, speed: 5.4, radius: 0.68, height: 2.6, style: 'melee', damage: 34, attackRange: 3.4, attackCd: 1.6, notice: 45, build: buildWookieeEnforcer },
  darktrooper:  { hp: 160, speed: 5.5, radius: 0.55, height: 2.2, style: 'hover', damage: 12, attackRange: 30, attackCd: 2.3, notice: 48, boltSpeed: 30, volley: 2, build: buildDarkTrooper },
  // ---- the new-board roster ----
  // Flame projector: short reach, but the stream suppresses nothing — it has
  // to be sidestepped, and it cooks anyone who tries to hold a crate against it.
  flametrooper: { hp: 130, speed: 5.0, radius: 0.52, height: 1.9, style: 'ranged', damage: 6, attackRange: 12, attackCd: 2.6, notice: 42, volley: 9, flame: true, build: buildFlametrooper },
  // Cave spiders hunt like the massiff hunts: no turns taken, no morale. Low
  // HP each — the fight is volume, not weight.
  krykna:       { hp: 55, speed: 8.5, radius: 0.6, height: 1.6, style: 'melee', damage: 12, attackRange: 2.5, attackCd: 1.3, notice: 46, relentless: true, build: buildKrykna },
  broodmother:  { hp: 560, speed: 6.2, radius: 0.95, height: 2.6, style: 'melee', damage: 30, attackRange: 3.8, attackCd: 1.9, notice: 60, relentless: true,
    // slung high on its legs: the body rides around y=2.4, well over the
    // centre sphere, and runs the full 6 m from spinnerets to fangs
    hitParts: [{ z: 0, y: 2.5, r: 1.5 }, { z: -2.1, y: 2.5, r: 1.4 }, { z: 2.0, y: 2.0, r: 1.4 }],
    spawnOnHurt: { kind: 'krykna', per: 0.22, count: 2, max: 8 }, build: buildBroodmother },
  // The net gun barely hurts; being rooted in front of his friends is the hurt.
  quarren:      { hp: 100, speed: 5.2, radius: 0.5, height: 1.9, style: 'ranged', damage: 5, attackRange: 20, attackCd: 3.4, notice: 40, boltSpeed: 19, volley: 1, boltTag: 'net', burnImmune: true, build: buildQuarren },
  alamite:      { hp: 65, speed: 6.4, radius: 0.5, height: 1.85, style: 'melee', damage: 13, attackRange: 2.5, attackCd: 1.4, notice: 32, build: buildAlamite },
  // The drone *is* the projectile: it stalks, then dives and detonates. The
  // dive is committed like the massiff's pounce — a dash beats it.
  drone:        { hp: 45, speed: 8.0, radius: 0.55, height: 1.7, style: 'hover', damage: 24, attackRange: 30, attackCd: 4.0, notice: 60, kamikaze: true, build: buildInterceptorDrone },
  // A walking priority-target puzzle: bolts bounce off the front pane, so the
  // answer is a flank, a melee rush, or a rocket.
  ringEnforcer: { hp: 260, speed: 3.8, radius: 0.55, height: 2.1, style: 'ranged', damage: 13, attackRange: 30, attackCd: 2.2, notice: 48, boltSpeed: 30, volley: 3, frontShield: true, build: buildRingEnforcer },
  // Allies (spawned on team 0)
  // Monster bosses (docs/BOSSES.md §1). Their Defs *are* boss-scale — the
  // health and damage here are the design's final numbers, so they take
  // `promoteBoss(name, 1, 1, 1)`, which hangs the banner and the bar on them
  // without scaling anything. Big, slow, relentless: they never lose the scent,
  // never break morale and cannot be knocked down.
  mudhorn:  { hp: 2600, speed: 7.2, radius: 1.8, height: 3.0, style: 'melee', damage: 40, attackRange: 4.4, attackCd: 2.0, notice: 90, relentless: true,
    hitParts: [{ z: -2.5, y: 1.4, r: 1.2 }], build: buildMudhorn },
  ravinak:  { hp: 3000, speed: 5.4, radius: 2.2, height: 3.4, style: 'melee', damage: 40, attackRange: 5.2, attackCd: 2.2, notice: 90, relentless: true,
    hitParts: [{ z: 3.2, y: 1.3, r: 1.6 }, { z: -2.5, y: 0.7, r: 1.3 }], build: buildRavinak },
  mamacore: { hp: 3400, speed: 5.0, radius: 2.6, height: 4.6, style: 'melee', damage: 50, attackRange: 6.0, attackCd: 2.4, notice: 90, relentless: true,
    hitParts: [{ z: 4.3, y: 1.9, r: 2.1 }, { z: -3.5, y: 1.9, r: 1.6 }], build: buildMamacore },
  rancor:   { hp: 3600, speed: 6.4, radius: 2.0, height: 5.0, style: 'melee', damage: 45, attackRange: 5.0, attackCd: 2.1, notice: 90, relentless: true,
    // twelve metres nose to tail, with the reach out front where the centre
    // sphere has never come close
    hitParts: [{ z: 3.5, y: 2.1, r: 2.0 }, { z: 5.0, y: 1.3, r: 1.9 }, { z: -2.6, y: 1.9, r: 1.4 }], build: buildRancor },
  // The two colossi are half-buried: `plows` is what makes the ground answer
  // for the part of them that is under it.
  kraytDragon: { hp: 5200, speed: 5.6, radius: 3.0, height: 5.0, style: 'melee', damage: 45, attackRange: 7.0, attackCd: 2.3, notice: 110, relentless: true, plows: 3.4,
    // the head and the length of neck in front of it; the coils behind are
    // under the sand, and stay unhittable on purpose
    hitParts: [{ z: 4.6, y: 2.2, r: 2.4 }, { z: 7.0, y: 2.4, r: 2.0 }], build: buildKraytDragon },
  mythosaur:   { hp: 5600, speed: 4.6, radius: 3.0, height: 5.0, style: 'melee', damage: 50, attackRange: 6.6, attackCd: 2.5, notice: 110, relentless: true, plows: 3.0,
    // the skull and horns, five metres up and three forward of the mass
    hitParts: [{ z: 4.2, y: 5.1, r: 2.1 }, { z: 5.6, y: 5.2, r: 1.6 }], build: buildMythosaur },
  // ---- the second monster batch (docs/BOSSES.md §2.7–2.10) ----
  // The Dune Sea's champion: a burrowing worm that is only ever *briefly* on
  // the surface. `speed` is its pace under the sand; surfaced it is rooted
  // and bites, and the eruption under a player is its opening hit. It is a
  // champion, so it sits under the krayt in every number.
  sandworm: { hp: 2000, speed: 9.5, radius: 2.2, height: 4.5, style: 'melee', damage: 36, attackRange: 6.5, attackCd: 2.0, notice: 120, relentless: true, plows: 2.4,
    burrows: { under: 9, up: 7, rise: 0.9, sink: 0.8, strikeAt: 5, erupt: 30, eruptR: 6 },
    // the reared head and the neck under it; the coils behind are under the sand
    hitParts: [{ z: 1.8, y: 3.6, r: 1.9 }, { z: 0.4, y: 1.9, r: 1.7 }], build: buildSandworm },
  // The Refinery's specimen: an armored crawler five metres at the shoulder,
  // loose in the reactor hall. Slow, and nothing turns it.
  zillo:    { hp: 4200, speed: 5.8, radius: 2.0, height: 5.0, style: 'melee', damage: 45, attackRange: 5.4, attackCd: 2.2, notice: 90, relentless: true,
    hitParts: [{ z: 3.0, y: 3.4, r: 1.7 }, { z: -3.0, y: 2.2, r: 1.6 }, { z: -6.0, y: 1.4, r: 1.2 }], build: buildZillo },
  // The Ringworld's night hunter: a quilled cat the size of a landspeeder,
  // faster than anything else on four legs, and it pounces like the massiff.
  nexu:     { hp: 2800, speed: 11.5, radius: 1.2, height: 2.2, style: 'melee', damage: 36, attackRange: 3.8, attackCd: 1.6, notice: 95, relentless: true, pounces: true,
    hitParts: [{ z: 2.2, y: 1.3, r: 0.95 }, { z: -1.9, y: 1.3, r: 0.9 }], build: buildNexu },
  // The Prison Rig's thing from the moon pool: an amphibian hauling itself
  // onto the decks, glowing down both flanks. At home in the sea.
  kwazelMaw: { hp: 3800, speed: 5.2, radius: 2.4, height: 4.2, style: 'melee', damage: 48, attackRange: 6.0, attackCd: 2.3, notice: 90, relentless: true, burnImmune: true,
    hitParts: [{ z: 3.6, y: 2.2, r: 1.9 }, { z: -3.0, y: 1.6, r: 1.5 }], build: buildKwazelMaw },

  ig11:    { hp: 220, speed: 6.2, radius: 0.5, height: 2.2, style: 'ranged', damage: 12, attackRange: 32, attackCd: 1.3, notice: 70, boltSpeed: 34, volley: 4, build: buildIG },
  marshal: { hp: 180, speed: 5.5, radius: 0.5, height: 1.85, style: 'ranged', damage: 14, attackRange: 30, attackCd: 2.0, notice: 70, boltSpeed: 34, volley: 2, build: () => buildGunfighter('marshal') },
  fennec:  { hp: 180, speed: 5.5, radius: 0.5, height: 1.85, style: 'ranged', damage: 40, attackRange: 55, attackCd: 2.8, notice: 90, boltSpeed: 60, volley: 1, build: () => buildGunfighter('fennec') },

  // ---- the playable broodmother's brood (docs/MODES.md §3) ----
  // The egg is a target, not a fighter: 5 s on the clock, destroyable the
  // whole time, and what crawls out is a half-size krykna that hunts for
  // whoever laid it.
  spiderEgg:  { hp: 60, speed: 0, radius: 0.45, height: 0.9, style: 'melee', damage: 0, attackRange: 0, attackCd: 9, notice: 0, egg: { hatchIn: 5, hatchTo: 'spiderling' }, build: buildSpiderEgg },
  spiderling: { hp: 40, speed: 9.0, radius: 0.35, height: 0.9, style: 'melee', damage: 8, attackRange: 1.8, attackCd: 1.1, notice: 46, relentless: true, build: buildSpiderling },
};

/**
 * Kinds with an animal's voice rather than a mouth: they growl when they arrive
 * and yelp when they go down, through the synth beast voices, because none of
 * the barks in `SPAWN_BARKS` is a sound a creature this size makes. The
 * monster bosses are here for the same reason the massiff always was — until
 * their own roar/hurt/death sets land (docs/ASSETS_AUDIO.md).
 */
const BEASTS = new Set<EnemyKind>([
  'massiff', 'mudhorn', 'ravinak', 'mamacore', 'rancor', 'kraytDragon', 'mythosaur',
  'sandworm', 'zillo', 'nexu', 'kwazelMaw',
]);

/**
 * Sample prefix for a monster with its own voice set (`<voice>_roar/_hurt/
 * _death`). A beast absent from this table — the massiff — keeps the shared
 * growl and yelp; so does any monster whose files have not landed yet, since
 * `audio.monster` falls back on its own.
 */
const MONSTER_VOICE: Partial<Record<EnemyKind, string>> = {
  mudhorn: 'mudhorn', ravinak: 'ravinak', mamacore: 'mamacore',
  rancor: 'rancor', kraytDragon: 'krayt', mythosaur: 'mythosaur',
  sandworm: 'sandworm', zillo: 'zillo', nexu: 'nexu', kwazelMaw: 'kwazel',
};

const SPAWN_BARKS: Partial<Record<EnemyKind, BarkName>> = {
  tusken: 'tusken_cry', pyke: 'pyke_chatter', pirate: 'pirate_taunt', pirateMelee: 'pirate_taunt',
  duelist: 'pirate_taunt', officer: 'imperial_bark', capo: 'pyke_chatter', enforcer: 'pirate_taunt',
  flametrooper: 'imperial_bark', krykna: 'spider_chitter', broodmother: 'spider_chitter',
  spiderling: 'spider_chitter',
  quarren: 'quarren_bark', alamite: 'alamite_shriek', drone: 'drone_whine',
  ringEnforcer: 'pirate_taunt',
};
const DEATH_BARKS: Partial<Record<EnemyKind, BarkName>> = {
  tusken: 'tusken_cry', pyke: 'pyke_death', pirate: 'pirate_death', pirateMelee: 'pirate_death',
  stormtrooper: 'imperial_death', deathtrooper: 'imperial_death',
  // droid_death has existed since the first audio batch and was never wired:
  // every droid on the board died silently. Nothing mechanical borrows a
  // human death rattle — they get the power-down that was made for them.
  droid: 'droid_death', darktrooper: 'droid_death', ig11: 'droid_death',
  duelist: 'pirate_death', officer: 'imperial_death', capo: 'pyke_death', enforcer: 'pirate_death',
  flametrooper: 'imperial_death', krykna: 'spider_chitter', broodmother: 'spider_chitter',
  spiderling: 'spider_chitter',
  quarren: 'quarren_bark', alamite: 'alamite_shriek',
  ringEnforcer: 'pirate_death',
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
/** scratch for seeding a ragdoll */
const _base = new THREE.Vector3();
const _spin = new THREE.Vector3();
/** scratch for reading how upright a dying body is */
const _hip = new THREE.Vector3();
const _torso = new THREE.Vector3();
/** crowd separation, m/s² per metre of overlap (tuned to the old 60 Hz feel) */
const SEPARATION_ACCEL = 180;

/** how far an ally may drift from the player it escorts before it stops fighting and heads back */
const ESCORT_LEASH = 34;
/** a hostile counts as the escort's business inside this much of the player */
const ESCORT_ENGAGE = 45;
/** close enough to be *with* the player: the ally stops walking in and mills instead */
const ESCORT_NEAR = 5;
/** how far a milling ally's loiter goal may fall behind the player before it picks a new one */
const ESCORT_DRIFT = 8;

/**
 * Blaster heat, the same mechanic the players carry. Volleys are small and
 * spaced, so a tusken squeezing off pairs every two seconds never troubles it;
 * a rapid-fire shooter leaning on a firefight does, and has to break off to
 * vent. That break is the opening — the hostile who never stops shooting was
 * the one you could never push.
 */
const ENEMY_HEAT_PER_SHOT = 0.07;
/**
 * Hostiles shed heat far more slowly than a player does. They fire in short
 * volleys with long gaps, so a player's cooling rate is paid off by every gap
 * and the meter never climbs — the heat has to survive the gaps for sustained
 * contact to mean anything.
 */
const ENEMY_HEAT_COOL = 0.1;
/** the barrel sheds nothing until this long after the last bolt */
const ENEMY_HEAT_HOLD = 0.5;
/** how long a vented shooter stays out of the fight */
const ENEMY_VENT_TIME = 2.2;
/** scratch for the per-frame hot paths: ~45 hostiles all run these every frame */
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _jet = new THREE.Vector3();
/** reused foe list, so nearestFoe doesn't build one per enemy per frame */
const _foes: Combatant[] = [];
/** scratch for the second moves' telegraph sparks */
const _cue = new THREE.Vector3();
/** scratch for the half-buried creatures' ground wake */
const _plow = new THREE.Vector3();
/**
 * The capsule an enemy of this kind occupies. The spawner needs it before the
 * enemy exists, to check that where it is about to put one is somewhere a body
 * of that size actually fits — a massiff needs a lot more room than a Pyke.
 */
export function enemyBody(kind: EnemyKind): { radius: number; height: number } {
  const d = DEFS[kind];
  return { radius: d.radius, height: d.height };
}

/** Every kind there is, so an audit never has to keep its own list in step. */
export function enemyKinds(): EnemyKind[] {
  return Object.keys(DEFS) as EnemyKind[];
}

/** The kind's extra hit spheres, for the hitbox audit. Empty when it has none. */
export function enemyHitParts(kind: EnemyKind): { z: number; y: number; r: number }[] {
  return DEFS[kind].hitParts ?? [];
}

/**
 * The character build for a kind, without the AI wrapped around it — the PvP
 * playable-NPC adapter dresses these in the PlayerCharacter surface rather
 * than re-implementing two dozen characters.
 */
export function buildEnemyCharacter(kind: EnemyKind): CharacterInstance {
  return DEFS[kind].build();
}

/** Read-only stat sheet for a kind, for deriving player-side PvP profiles. */
export function enemyStats(kind: EnemyKind): {
  hp: number; speed: number; radius: number; height: number;
  style: 'melee' | 'ranged' | 'swoop' | 'hover'; damage: number; attackCd: number;
} {
  const d = DEFS[kind];
  return { hp: d.hp, speed: d.speed, radius: d.radius, height: d.height, style: d.style, damage: d.damage, attackCd: d.attackCd };
}

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
  /**
   * PvP squad follower: the player this enemy escorts. Set via setOwner();
   * the escort AI (the branch wave-mode allies use) anchors to them instead
   * of to player one, and the follower fights whatever threatens them.
   */
  owner: { position: THREE.Vector3; alive: boolean; team: number } | null = null;
  /**
   * A hunter rather than a follower: it keeps its `owner` — for the team it
   * fights on and the credit its kills earn — but takes none of the escort
   * leash. The broodmother's brood is what this exists for. They used to be
   * plain followers, which pinned them to her: the escort AI anchors to the
   * leader and only engages what comes within `ESCORT_ENGAGE` of *her*, so a
   * hatchling would trot at her heels past anything worth biting. A brood
   * that hunts is the whole point of laying it.
   */
  hunts = false;
  /**
   * Boss promotion (promoteBoss): scales outgoing damage at the point each
   * attack lands, since the shared per-kind def cannot carry per-instance HP.
   */
  dmgScale = 1;
  /** max HP after any boss scaling, for the HUD boss bar */
  maxHp: number;
  /** a promoted boss: shrugs off knockdowns, never flees, never crawls */
  boss = false;
  bossName = '';
  /** warlords parry; the monster bosses answer with mass instead */
  private parries = false;
  /** seconds until the next parry can happen — this is what guarantees hits land */
  private defenseCd = 0;
  /** red hurt-flash timer (bosses only — grunts keep the scale pop alone) */
  private bossHurtT = 0;
  /** throttle on the monster hurt cry, so sustained fire doesn't machine-gun it */
  private hurtVoiceCd = 0;
  /** pale parry-flash timer, so a turned hit reads differently from a landed one */
  private bossParryT = 0;
  /** this boss's own material copies, mapped to each one's resting emissive */
  private tintedMats = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  /** true while a tint is applied, so restore happens exactly once */
  private tintOn = false;

  private attackCd = 0;
  private windup = 0;
  /** burn-zone damage accrues and lands in ticks, not per frame (src/core/body.ts) */
  private burn = newBurnState();
  /** where a flame volley was aimed when it started — the stream holds its line */
  private flameAim = new THREE.Vector3();
  /** kamikaze dive: seconds left of committed dive, 0 = stalking */
  private diving = 0;
  /** HP mark the last spawn-on-hurt brood crawled out at */
  private spawnMark: number;
  private spawnedCount = 0;
  /** scratch for the frontal shield handed to the projectile system */
  private shieldSphere = { center: new THREE.Vector3(), radius: 0.95, normal: new THREE.Vector3() };
  /** massiff leap: >0 while airborne mid-pounce, damage lands on contact */
  private pounce = 0;
  private pounceHit = false;
  /** boss super jump: >0 while airborne mid-leap; the slam lands on touchdown */
  private leapT = 0;
  /**
   * A burrowing kind's place in its cycle (Def.burrows): under the ground,
   * coming up, fighting on the surface, or going back down. Public so the
   * boss fight and the test harness can read where it is.
   */
  burrow: 'under' | 'rising' | 'up' | 'sinking' = 'under';
  /** seconds left in the current burrow stage */
  private burrowT = 0;
  /** eruptions so far, for the test harness */
  eruptions = 0;
  /**
   * Spacing between super jumps; starts short so the fight opens with one.
   * Public because the warlord's shock-slam (game.ts updateBoss) pushes it
   * out while its telegraph runs — the ember ring promises where the hit
   * lands, so the boss must not leap somewhere else mid-promise.
   */
  superJumpCd = 2;
  /** leaps taken, for the test harness */
  superJumps = 0;
  /** egg kinds: seconds to the hatch; < 0 = not started (lazy-armed on first tick) */
  private hatchT = -1;
  /** this egg was lobbed (RT): it flies an arc and shoves the first body it meets */
  eggThrown = false;
  private eggHit = false;
  private windupTarget: Combatant | null = null;
  /** the committed second move winding up or in flight, if any (see DASH_* / SLAM_*) */
  private special: 'dash' | 'slam' | null = null;
  /** seconds of the officer's lunge left; `dashDir` is the line, fixed at launch */
  private dashT = 0;
  private dashDir = new THREE.Vector3();
  private dashHit = false;
  /** spacing between second moves, so they punctuate a fight rather than run it */
  private specialCd = 0;
  /** an ally's most recent target and how recently it shot at it — the kill bark reads these */
  private killWatch: Combatant | null = null;
  private shotRecently = 0;
  private prevPassing = false;
  /** while > 0 the AI stops steering so a knockback impulse actually carries */
  private stagger = 0;
  private volleyLeft = 0;
  private volleyTimer = 0;
  private strafePhase = Math.random() * Math.PI * 2;
  /** public because src/enemies/arrival.ts steers an arriving body by it */
  facingYaw = 0;
  spawnPos = new THREE.Vector3();
  // ---- ragdoll & corpse ----
  /**
   * Deaths hand the rig to an articulated solver: point masses at the joints
   * under gravity, bone-length constraints, ground contact and friction. The
   * body finds its own way down and drapes over whatever it lands on, so no
   * two deaths are alike and none of them argue with the terrain.
   */
  private ragdoll: Ragdoll | RigidRagdoll | null = null;
  /**
   * Armed by the killing blow, built on the first dead frame. Waiting a frame
   * lets knockback stacked after damage() — explosions, melee — steer the fall,
   * since the sim seeds its motion from this.velocity as it stands then.
   */
  private ragdollArmed = false;
  /** on the floor this frame (drives the massiff's pounce landing) */
  private grounded = true;
  /** corpse has come to rest: skip physics and limb work from here on */
  private settled = false;
  /** wave ended: corpse fading out, then removed */
  private fadeT = -1;
  private swoopPhase = Math.random() * Math.PI * 2;
  private hoverTarget = new THREE.Vector3();
  private hoverRetarget = 0;
  private hitFlash = 0;
  /** memo for the firing line-of-sight check; see losThrottled */
  private losCheckAt = -1;
  private losMemo = false;

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
  idleGoal = new THREE.Vector3();
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
   * Under the ground, where nothing reaches it: a burrowing kind between
   * surfacings. It is still alive, still on the radar as a wake, and still
   * a boss on the bar — it simply is not a body to shoot at until it comes up.
   */
  get submerged(): boolean {
    return !!this.def.burrows && (this.burrow === 'under' || this.burrow === 'sinking');
  }

  /** a body a bolt, a blade or a lock-on can find */
  get targetable(): boolean { return this.alive && !this.submerged; }
  /**
   * Line-of-sight is a heightfield march, so it is rechecked a few times a
   * second (staggered per enemy) rather than every frame — with a board full
   * of hostiles a per-frame raycast each is the most expensive thing running.
   */
  private sightTimer = 0;
  private sightMemo = false;
  /** countdown to the next puff of ground thrown by a half-buried body */
  private plowT = 0;
  /** the skyline halo that keeps this body readable in the air, once airborne */
  private halo: THREE.Sprite | null = null;
  private haloTone: HaloTone | null = null;
  private haloLevel = 0;
  /** how light this body's own artwork is, once there is artwork to measure */
  private haloBody: number | null = null;
  /** staggered clock for the ground probe the halo reads (it is a raycast) */
  private haloProbe = 0;
  /**
   * How this enemy is getting onto the board, while it still is (waves 2+
   * arrive rather than appear — src/enemies/arrival.ts). Normal AI is
   * suspended until the arrival completes; the body is alive and targetable
   * the whole way down, so a parachutist can be shot out of the sky.
   */
  arrival: ArrivalState | null = null;
  /** blaster heat, 0..1 — see the constants above */
  heat = 0;
  /** seconds left venting; nothing fires while this is running */
  venting = 0;
  private heatHold = 0;

  /**
   * This body's extra hit spheres, in its *current* size.
   *
   * Not read straight off the Def at fire time, because a promoted boss grows:
   * `promoteBoss` scales radius, height and the model together, and hit
   * spheres left at the shared Def's numbers stay where the unpromoted body
   * used to be. On a 1.35x Pit Beast that put the skull sphere well inside the
   * animal's actual head, so shots at the head of the biggest target on the
   * board passed through it.
   */
  hitParts: { z: number; y: number; r: number }[];

  /**
   * @param opts.silent  no arrival bark or growl. For a body that is *already
   *   there* when the match begins — a mission level's posted garrison — as
   *   opposed to one arriving mid-fight. Building the garrison used to play
   *   every one of its spawn barks at once, so a Missions board opened on a
   *   chorus of grunts from bodies standing quietly three rooms away.
   */
  constructor(public kind: EnemyKind, pos: THREE.Vector3, team = 1,
    opts: { silent?: boolean } = {}) {
    this.def = DEFS[kind];
    this.hitParts = (this.def.hitParts ?? []).map((p) => ({ ...p }));
    this.team = team;
    this.char = this.def.build();
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.spawnMark = this.def.hp;
    this.radius = this.def.radius;
    this.height = this.def.height;
    this.position.copy(pos);
    this.spawnPos.copy(pos);
    this.post.copy(pos);
    this.idleGoal.copy(pos);
    this.facingYaw = Math.random() * Math.PI * 2;
    this.idleYaw = this.facingYaw;
    this.char.root.position.copy(pos);
    // A burrower begins its life under the ground, and comes up soon: long
    // enough for the entrance card to play over a wake, short enough that
    // the fight is not a wait.
    if (this.def.burrows) {
      this.burrowT = Math.min(this.def.burrows.under, 4);
      this.char.setBurrow?.(1);
    }
    // allies fight alongside the player rather than guarding a post
    if (team === 0) this.awareness = 'engaged';
    if (!opts.silent) {
      if (BEASTS.has(kind)) {
        const voice = MONSTER_VOICE[kind];
        if (team === 1) {
          if (voice) audio.monster(voice, 'roar', 0.95);
          else audio.beastGrowl(this.def.hp > 2000 ? 0.85 : 0.4);
        }
      }
      else {
        const bark = SPAWN_BARKS[kind];
        if (bark && team === 1) audio.bark(bark, 0.4);
      }
    }
  }

  /**
   * Put this enemy under `p`: their team, their kill credit. `hunt` chooses
   * the posture — a follower escorts them (the PvP squad), a hunter goes after
   * the enemy on its own (the broodmother's brood).
   */
  setOwner(p: { position: THREE.Vector3; alive: boolean; team: number }, hunt = false): void {
    this.owner = p;
    this.team = p.team;
    this.hunts = hunt;
    this.awareness = 'engaged';
  }

  /**
   * Promote to a boss: more health and hide, harder hits, a bigger frame, a
   * name for the banner and the HUD bar. Everything else — AI, death, credit —
   * is the enemy it already was.
   */
  promoteBoss(name: string, hpScale = 5, dmgScale = 1.5, bulk?: number): void {
    this.boss = true;
    this.bossName = name;
    this.hp *= hpScale;
    this.maxHp = this.hp;
    this.spawnMark = this.hp;
    this.dmgScale = dmgScale;
    // A warlord has to read as a warlord from across the arena, not as one
    // more trooper with a health bar: human-sized kinds grow to giant scale,
    // already-big kinds a step less so they don't turn comical. The monster
    // bosses pass bulk 1 (and hpScale 1) — their size is already the point.
    const grow = bulk ?? (this.def.height < 2.2 ? 1.6 : 1.35);
    this.radius *= grow;
    this.height *= grow;
    // the extra spheres are body-local metres, so they grow with the body
    for (const p of this.hitParts) { p.z *= grow; p.y *= grow; p.r *= grow; }
    this.char.baseScale *= grow;
    this.char.root.scale.setScalar(this.char.baseScale);
    // hpScale 1 is the monsters' banner-only promotion; a scaled warlord is
    // the one who has learned to turn a hit aside
    this.parries = hpScale > 1;
  }

  /** a phase-two boss stops pacing itself */
  enraged = false;
  /** has already broken and run once this life — morale does not break twice */
  broke = false;

  /**
   * The last phase gets faster instead of only longer: the warlord closes
   * quicker and swings/fires more often. Done by giving this one instance its
   * own def — every movement and cooldown site reads `this.def`, so one copy
   * retunes all of them without touching a shared table.
   */
  enrage(): void {
    if (this.enraged) return;
    this.enraged = true;
    this.def = {
      ...this.def,
      speed: this.def.speed * 1.28,
      attackCd: this.def.attackCd * 0.6,
    };
    this.dmgScale *= 1.15;
  }

  /**
   * Something happened at `pos` worth looking at — a shot, a squadmate's
   * shout, a hit landing. `hard` skips straight to combat (being shot at
   * doesn't need investigating).
   */
  alert(pos: THREE.Vector3, hard = false): boolean {
    // only wave hostiles keep posts to be alerted from; allies and PvP
    // followers are permanently engaged escorts
    if (!this.alive || this.team !== 1) return false;
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

  /**
   * On the platforms a walking enemy never steers itself into the void: probe
   * the ground a step ahead and stop at the lip. Only voluntary movement is
   * caught — a knockback can still throw them off, which is half the fun of the
   * station board.
   */
  private edgeGuard(game: Game): void {
    // a super jump is committed the moment it leaves the ground — the guard
    // must not zero the launch velocity at a platform lip
    if (this.stagger > 0 || this.leapT > 0) return;
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    // gate must be near zero: steering re-adds a trickle of velocity every
    // frame after a block, and a 0.3 m/s creep still walks off the lip
    if (sp <= 0.05) return;
    const ax = this.position.x + (this.velocity.x / sp) * 1.2;
    const az = this.position.z + (this.velocity.z / sp) * 1.2;
    const g = game.board.physics.groundHeight(ax, az, this.position.y + 0.5);
    // No ground at all ahead is the edge of the world on any board — a station
    // platform's lip, the end of the Ringworld's deck — and nothing walks off
    // it on purpose.
    if (!isFinite(g)) { this.velocity.x = 0; this.velocity.z = 0; return; }
    if (g >= this.position.y - 3) return;
    // A long drop only stops the ones with nowhere to land: on open terrain a
    // slope is not a cliff. Shallow water (Trask's chest-deep harbour) is
    // walkable; deep water is a drop, except to whatever is at home in it.
    const guardWater = game.board.waterY !== undefined;
    const intoDeep = guardWater && game.board.waterY! - g > 1.7;
    if (!game.board.physics.heightAt || (intoDeep && !this.def.burnImmune)) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  /**
   * What the board does to a body wherever it is: the void under the platforms,
   * and every hazard the board carries — the sarlacc, the lava, the harbour.
   * Every moving state owes these checks.
   *
   * The states that return early — knocked flat, crawling wounded, broken and
   * running — used to skip them. A crawler shoved off the station stayed
   * "alive" below the kill plane and held the wave open for its whole
   * bleed-out, and nothing prone could burn or fall into a pit. Returns true
   * when this enemy is gone and the caller should stop touching it.
   *
   * Burn damage accrues and lands in half-second ticks, so the alert-and-flash
   * machinery in damage() isn't hammered every frame.
   */
  private boardHazards(game: Game, dt: number): boolean {
    if (this.position.y < game.board.physics.killY) {
      this.alive = false;
      this.removeMe = true;
      return true;
    }
    // The tick is the player's 0.4 s beat now, not the 0.5 s this side had
    // drifted to (src/core/body.ts). Drowning stays a hostile-only term:
    // fully under the surface, anything that breathes (or shorts) drowns —
    // aquatic kinds (`burnImmune`) are at home down there.
    tickHazards(this.burn, game.board, this.position, dt, (amount, kill) => {
      this.damage(kill ? 9999 : amount, this.position, -1);
    }, { drownAt: this.height * 0.85, immune: this.def.burnImmune });
    return !this.alive;
  }

  /** world yaw the body is facing, for placing the extra hit spheres */
  get yaw(): number { return this.facingYaw; }

  /**
   * The enforcer's frontal pane, as the projectile system sees it: a sphere
   * held out in front of wherever the body faces. Bolts bounce; melee, rockets
   * and anything from behind land as normal. Down or wounded drops the pane.
   */
  get shieldCollider(): { center: THREE.Vector3; radius: number; normal: THREE.Vector3 } | null {
    if (!this.def.frontShield || !this.alive || this.downed || this.wounded || this.fleeing) return null;
    const s = this.shieldSphere;
    s.normal.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
    s.center.copy(this.position).addScaledVector(s.normal, 0.7);
    s.center.y += 1.15;
    return s;
  }

  /** true once this enemy is actually in the fight (used by the HUD radar) */
  get isEngaged(): boolean { return this.awareness === 'engaged'; }

  /**
   * A corpse the solver has finished with is still a body lying in the world:
   * shooting it knocks it about. Null while it is alive, still falling, or
   * already fading out — there is no point handing back a target that is on
   * its way to being deleted.
   */
  get corpse(): { at: THREE.Vector3; radius: number } | null {
    if (this.alive || !this.ragdoll || this.fadeT >= 0) return null;
    return { at: this.ragdoll.hips, radius: Math.max(0.45, this.radius * 0.8) };
  }

  /** Knock a settled corpse about; it goes back to simulating. */
  shoveCorpse(from: THREE.Vector3, force: number): void {
    if (this.alive || !this.ragdoll) return;
    this.settled = false;
    this.ragdoll.shove(from, force);
  }

  /** the squad broke — run from `threat`, rally at distance */
  breakAndRun(threat: THREE.Vector3): void {
    if (!this.alive || this.fleeing || this.wounded || this.team !== 1) return;
    // Morale breaks once. Without this the director rolled the lone survivor
    // again every replan after it rallied, so the last body of a squad
    // sprinted 55 m away, turned round, and sprinted off again until the
    // wave's sweep timer finally dragged it back — a wave that could not end.
    if (this.broke) return;
    if (this.boss) return;               // a warlord does not run from its own arena
    if (this.kind === 'droid') return;   // droids have no morale to break
    if (this.def.relentless) return;     // nor does a war beast: it comes anyway
    if (this.def.style === 'swoop' || this.def.style === 'hover') return;
    this.fleeing = true;
    this.broke = true;
    this.fleeTimer = 5 + Math.random() * 3;
    this.interest.copy(threat);
    const bark = SPAWN_BARKS[this.kind];
    if (bark) audio.bark(bark, 0.45);
  }

  damage(amount: number, from: THREE.Vector3, bySlot: number, _opts?: { dot?: boolean; heavy?: boolean }): void {
    if (!this.alive) return;
    // under the ground nothing lands — the whole lesson of the burrower is
    // that it has to be hurt while it is up
    if (this.submerged) { this.alert(from, true); return; }
    // A warlord turns some hits aside — a sharp sidestep off the line of the
    // shot, a pale flash, and almost none of the damage. The cooldown is the
    // fairness: at most one parry every 1.2 s, so sustained fire always gets
    // through, and the roll means even a single volley usually lands some.
    if (this.parries && this.defenseCd <= 0 && this.downTimer <= 0 && this.stagger <= 0 && Math.random() < 0.55) {
      this.defenseCd = 1.2;
      this.bossParryT = 0.25;
      amount *= 0.15;
      // step perpendicular to the incoming line, whichever side is random
      const lx = this.position.x - from.x, lz = this.position.z - from.z;
      const ll = Math.hypot(lx, lz) || 1;
      const side = Math.random() < 0.5 ? 1 : -1;
      this.velocity.x += (-lz / ll) * 7 * side;
      this.velocity.z += (lx / ll) * 7 * side;
      // the step has to be seen: without a stagger the steering damped the
      // sidestep away within a tenth of a second and the parry read as a
      // flash and nothing else
      this.stagger = Math.max(this.stagger, 0.15);
      audio.impact();
    }
    if (this.boss) this.bossHurtT = 0.3;
    // A monster answers being hurt, but not per bolt: under sustained fire an
    // untimed cry would machine-gun. One every 1.6 s, and only for a wound
    // that is actually worth a noise.
    const hurtVoice = MONSTER_VOICE[this.kind];
    if (hurtVoice && this.hurtVoiceCd <= 0 && amount > this.maxHp * 0.01) {
      this.hurtVoiceCd = 1.6;
      audio.monster(hurtVoice, 'hurt', 0.75);
    }
    this.alert(from, true); // being shot at is not something you investigate
    this.suppress(0.35);
    // a shooter caught in the open dives for the nearest crate
    if (!this.cover && this.def.style === 'ranged' && this.team === 1) this.coverRetry = 0;
    // finishing blows on someone already on the ground hit twice as hard
    // (a boss never lies down — knockdown() caps it at a half-second stagger
    // — so the finishing-blow bonus is for the bodies actually on the floor)
    if ((this.downed || this.wounded) && !this.boss) amount *= 2;
    this.hp -= amount;
    if (bySlot >= 0) this.lastHitBy = bySlot;
    this.hitFlash = 0.15;
    // hit out of the wind-up — except the committed second moves, which are
    // telegraphed precisely so that the answer is to move, not to shoot
    if (this.hp > 0 && this.windup > 0 && !this.special) this.windup = 0;

    // Gut-shot: a hit that leaves a grounded humanoid nearly dead can drop it
    // into a wounded crawl instead of a clean fight-on — it is out of the
    // fight, dragging itself away, and bleeds out unless finished.
    if (
      this.hp > 0 && !this.wounded && this.team === 1 && this.downTimer <= 0 && !this.boss &&
      (this.def.style === 'melee' || this.def.style === 'ranged') &&
      this.kind !== 'droid' && // droids don't bleed
      this.hp < this.def.hp * 0.25 && Math.random() < 0.4
    ) {
      this.wounded = true;
      this.bleedOut = 8 + Math.random() * 4;
      this.woundedPosed = false;
      this.windup = 0;
      this.volleyLeft = 0;
      this.special = null;
      this.dashT = 0;
      this.interest.copy(from);
      const bark = DEATH_BARKS[this.kind];
      if (bark) audio.bark(bark, 0.45);
    }

    if (this.hp <= 0) {
      this.alive = false;
      if (BEASTS.has(this.kind)) {
        const voice = MONSTER_VOICE[this.kind];
        if (voice) audio.monster(voice, 'death', 1);
        else audio.beastYelp(this.def.hp > 2000 ? 0.9 : 0.6);
      }
      // a burrower killed under the sand would otherwise leave its wake
      // rumbling for the rest of the match
      if (this.def.burrows) audio.setBurrowRumble(0);
      else {
        const bark = DEATH_BARKS[this.kind];
        if (bark) audio.bark(bark, 0.5);
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
      // Someone already flat (wounded crawl, knockdown) keeps the held prone
      // pose — tipping the root again would fold them through the floor. The
      // upright die the ragdoll death; the ragdoll reads its direction from
      // this.velocity on its first frame, so knockbacks applied right after
      // this call (explosions, melee) still steer the fall.
      // A creature has no prone pose to preserve — its animator is a stub, so
      // a knocked-down spider is still standing as far as the model is
      // concerned — and it always dies into the sim.
      //
      // But the flags are not the question — the body is. `downTimer` runs
      // through the *get-up* as well as the fall, so a raider knocked over and
      // finished halfway back to his feet was frozen in that pose and slid to
      // a stop still standing: the tusken left sticking diagonally out of the
      // sand. Anyone whose torso is still up dies into the solver whatever the
      // flags say, and only a body that is genuinely flat keeps its pose.
      if (!this.char.rig || (!this.wounded && this.downTimer <= 0) || this.torsoUp()) {
        this.startRagdoll();
      }
      this.settled = false;
    } else if (this.char.animator && this.windup <= 0 && !this.wounded && !this.downed) {
      // Flinch away from where the shot came from: rotate the bearing into
      // the rig's frame and a hit from either flank plays its side variant —
      // the head snaps toward the shooter, the body rocks off it. Head-on
      // (or from behind) keeps the frontal flinch.
      const bearing = Math.atan2(from.x - this.position.x, from.z - this.position.z) - this.facingYaw;
      const side = Math.sin(bearing);
      const clip = side > 0.45 ? 'hitFromL' : side < -0.45 ? 'hitFromR' : 'hitUpper';
      // Under sustained fire (a 0.24 s carbine cycle against a 0.28 s clip)
      // every shot snapped the flinch back to its first frame and it never
      // resolved. A react already most of the way through restarts; one
      // that has barely begun is left to play out — the body still reads
      // as being hit, because it visibly is.
      const a = this.char.animator;
      const flinching = HIT_REACTS.has(a.playing('upper') ?? '') && a.oneShotProgress('upper') < 0.6;
      if (!flinching) a.playOnce('upper', clip, 0.05);
    }
  }

  /**
   * Hit-stop on the swing that just landed: this body's animation hangs on
   * its contact frame for a few hundredths of a second, the way the player's
   * does (`Player.animDt`). Without it an enemy's swing passed through the
   * target at full speed and landed soft. Nothing else in the world feels
   * it — only this mixer.
   */
  private contactStop(seconds = 0.07): void {
    this.char.animator?.freeze(seconds);
  }

  /**
   * Shove this enemy away from `from`. The stagger window matters as much as
   * the impulse: without it the per-frame steering damp in updateMelee/Ranged
   * pulls velocity straight back to the AI's intended movement and the hit
   * reads as nothing.
   */
  knockback(from: THREE.Vector3, force: number, stagger = 0.3, lift = 0.35): void {
    if (this.submerged) return;   // the ground it is under does not shove
    // `lift` is what separates a shove from a launch: keep it low to slide the
    // target clear along the ground, raise it when a pop is wanted (explosions)
    applyKnockback(this.velocity, this.position, from, force, force * lift, true);
    this.stagger = Math.max(this.stagger, stagger);
  }

  /**
   * Put this enemy flat on the ground for `secs` — the big Euphoria-style hit
   * read. Only grounded humanoids go down (a swoop rider or a hover trooper
   * falling over mid-air reads as a bug, not a haymaker).
   */
  knockdown(secs = 1.8): void {
    if (!this.alive || this.def.style === 'swoop' || this.def.style === 'hover') return;
    if (this.def.burrows) return;   // a worm has no feet to be knocked off
    if (this.def.egg) return;   // an egg has nothing to knock over
    if (this.wounded) return; // already on the ground
    if (this.boss) secs = Math.min(secs, 0.5); // a boss staggers, it doesn't lie down
    // already flat: a second finisher keeps it there longer, and does not
    // replay the fall — which snapped the body upright to topple it again
    const wasDown = this.downTimer > 0;
    this.downTimer = Math.max(this.downTimer, secs);
    this.windup = 0;
    this.volleyLeft = 0;
    this.leapT = 0;   // knocked out of the air: the leap (and its slam) is lost
    this.special = null;   // and a lunge or slam winding up is lost with it
    this.dashT = 0;
    const anim = this.char.animator;
    if (anim && !wasDown) {
      anim.release('lower'); anim.release('upper');
      anim.playOnce('lower', 'deathLower', 0.06, true);
      anim.playOnce('upper', 'deathUpper', 0.06, true);
    }
  }

  /** incoming fire, landed or close: keeps this enemy's head down */
  suppress(amount: number): void {
    if (this.team !== 0) this.suppression = Math.min(1.2, this.suppression + amount);
  }

  /** the living player this one is closest to, for an ally deciding who to escort */
  private nearestPlayer(game: Game): Combatant | null {
    let best: Combatant | null = null;
    let bestD = Infinity;
    for (const p of game.players) {
      if (!p.alive) continue;
      const d = p.position.distanceToSquared(this.position);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ?? game.players[0] ?? null;
  }

  nearestFoe(game: Game): Combatant | null {
    let best: Combatant | null = null;
    let bestD = Infinity;
    // filled rather than allocated: this runs once per enemy per frame.
    // Everyone is considered and the team filter decides — which is what
    // makes PvP fall out of the same code: a follower on player two's team
    // sees player one, player one's followers, and wave hostiles alike.
    const foes = _foes;
    foes.length = 0;
    for (const p of game.players) foes.push(p);
    for (const a of game.allies) foes.push(a);
    for (const e of game.enemies) if (e !== this) foes.push(e);
    for (const f of foes) {
      if (!f.alive || f.team === this.team) continue;
      const d = f.position.distanceToSquared(this.position);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /**
   * Is this body still standing, as the rig has it?
   *
   * Asked of the bones rather than of a state flag, because the flags describe
   * what was *done* to the body and this needs to know what shape it is in.
   */
  private torsoUp(): boolean {
    const b = this.char.rig?.bones;
    if (!b?.hips || !b?.chest) return false;
    this.char.root.updateMatrixWorld(true);
    b.hips.getWorldPosition(_hip);
    b.chest.getWorldPosition(_torso);
    _torso.sub(_hip);
    const len = _torso.length();
    // half way over still counts as up: there is somewhere left to fall
    return len > 1e-5 && _torso.y / len > 0.45;
  }

  /** arm the ragdoll; it is seeded from velocity on the first dead frame */
  private startRagdoll(): void {
    // the mixer stops here so nothing fights the solver for the bones
    const anim = this.char.animator;
    if (anim) { anim.release('lower'); anim.release('upper'); }
    // syncVisual keeps its hands off a ragdoll, so settle the hit-flash pop
    // back to the body's own bulk now or the corpse wears it for good
    this.char.root.scale.setScalar(this.char.baseScale);
    this.ragdollArmed = true;
  }
  /** wave over: fade the corpse out, then remove it */
  fadeOut(): void {
    if (this.alive || this.fadeT >= 0) return;
    this.fadeT = 0;
    // materials are shared from a cache — clone them so only this corpse fades
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clone = (m: THREE.Material): THREE.Material => {
        const c = markOwned(m.clone());   // a per-corpse copy, not the shared cache entry
        c.transparent = true;
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    });
  }

  private setOpacity(alpha: number): void {
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.opacity = alpha;
    });
  }

  update(dt: number, game: Game): void {
    const anim = this.char.animator;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.defenseCd -= dt;
    this.bossHurtT = Math.max(0, this.bossHurtT - dt);
    this.hurtVoiceCd -= dt;
    this.bossParryT = Math.max(0, this.bossParryT - dt);

    // shot out of the sky (or the water): the parachute goes, the corpse
    // keeps the velocity it died with and the ordinary death physics land it
    if (this.arrival && !this.alive) clearArrival(this);

    if (!this.alive) { this.updateCorpse(dt, game); return; }

    if (this.arrival) {
      updateArrival(this, dt, game);
      return;
    }

    this.tickTimers(dt);
    const d = this.def;

    // ---- an egg: no AI, just the clock to the hatch ----
    if (d.egg) {
      this.updateEgg(dt, game);
      return;
    }

    // ---- flat on the ground after a heavy hit ----
    if (this.downTimer > 0) { this.updateDowned(dt, game, anim); return; }

    // ---- wounded: crawling away, bleeding out ----
    if (this.wounded) { this.updateWounded(dt, game, anim); return; }

    const target = this.senses(dt, game);
    this.updateKillWatch();

    // ---- boss super jump: airborne and committed ----
    if (this.leapT > 0) {
      this.updateLeap(dt, game);
      return;
    }

    // ---- broke and ran ----
    if (this.updateFleeing(dt, game, anim)) return;

    this.steer(dt, game, target);
    this.separate(dt, game);
    this.integrate(dt, game);
    if (this.boardHazards(game, dt)) return;
    this.updateBroodSpawn(game);
    if (d.plows) this.updatePlowWake(dt, game);
    if (anim) this.updateLocomotionAnim(anim);

    this.syncVisual(dt, game);
    anim?.update(dt);
  }

  /** a body that is down: the ragdoll (or a slide to rest), the fade, the kill plane */
  private updateCorpse(dt: number, game: Game): void {
    // ---- corpse ----
    // Bodies stay where they fell for the rest of the wave (the mixer is
    // simply never updated again, freezing the last live pose under the
    // ragdoll), then fade out when the wave clears.
    if (this.fadeT >= 0) {
      this.fadeT += dt;
      this.setOpacity(Math.max(0, 1 - this.fadeT / 1.2));
      if (this.fadeT > 1.3) this.removeMe = true;
    }
    if (this.settled) return; // at rest: nothing left to simulate

    // Seeded a frame late on purpose: velocity now carries the damage fling
    // plus any knockback stacked after it, and that is what steers the fall.
    // The upper body takes a larger share, so a hit turns the body over
    // rather than sliding it away flat.
    if (this.ragdollArmed) {
      this.ragdollArmed = false;
      _base.copy(this.velocity).multiplyScalar(0.85);
      _spin.copy(this.velocity).multiplyScalar(0.3);
      // A free-form rig (the spiders, the massiff, the drone) has no named
      // skeleton for the articulated solver, so it dies as one rigid body
      // instead — same Verlet world, same contacts, shape-matched every
      // step. Both simulate; neither plays a canned fall.
      this.ragdoll = this.char.rig
        ? new Ragdoll(this.char.rig, _base, _spin)
        : new RigidRagdoll(this.char.root, this.radius, this.height, _base, _spin);
    }

    if (this.ragdoll) {
      this.ragdoll.step(dt, game.board.physics);
      // anything still tracking the corpse follows the body itself, not a
      // capsule left standing where it died
      this.position.copy(this.ragdoll.hips);
      if (this.position.y < game.board.physics.killY) { this.removeMe = true; return; }
      if (!this.ragdoll.active && this.fadeT < 0) this.settled = true;
      // A rigged corpse keeps its cosmetic tick (a cape still swings on the
      // way down). A creature's tick *is* its gait — leave it unrun and the
      // legs freeze where they were, instead of a dead spider skittering as
      // it tumbles.
      if (this.char.rig) this.char.cosmetic?.(dt, game.time);
      return;
    }

    // No solver: a body that was already flat when it died (a wounded crawl,
    // a knockdown) keeps the pose it was holding and simply slides to a stop.
    this.velocity.x = damp(this.velocity.x, 0, 3, dt);
    this.velocity.z = damp(this.velocity.z, 0, 3, dt);
    // the shared body pull (26): this path had drifted to its own 22
    const res = stepBody(game.board, this.position, this.radius, this.height * 0.35, this.velocity, dt);
    if (this.position.y < game.board.physics.killY) { this.removeMe = true; return; }
    if (res.grounded && this.velocity.lengthSq() < 0.1 && this.fadeT < 0) this.settled = true;

    this.syncVisual(dt, game);
    return;
  }

  /** the AI clocks a live body runs down every frame */
  private tickTimers(dt: number): void {
    this.attackCd -= dt;
    this.superJumpCd -= dt;
    this.specialCd -= dt;
    this.shotRecently = Math.max(0, this.shotRecently - dt);
    this.suppression = Math.max(0, this.suppression - dt * 0.25);
    this.venting = Math.max(0, this.venting - dt);
    this.heatHold = Math.max(0, this.heatHold - dt);
    if (this.heatHold <= 0) this.heat = Math.max(0, this.heat - ENEMY_HEAT_COOL * dt);
  }

  /** flat on the ground after a heavy hit */
  private updateDowned(dt: number, game: Game, anim: Animator | null): void {
    this.downTimer -= dt;
    this.velocity.x = damp(this.velocity.x, 0, 4, dt);
    this.velocity.z = damp(this.velocity.z, 0, 4, dt);
    stepBody(game.board, this.position, this.radius, this.height * 0.5, this.velocity, dt);
    if (this.boardHazards(game, dt)) return;
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

  /** wounded: crawling away, bleeding out */
  private updateWounded(dt: number, game: Game, anim: Animator | null): void {
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
    stepBody(game.board, this.position, this.radius, this.height * 0.5, this.velocity, dt);
    if (this.boardHazards(game, dt)) return;
    if (this.bleedOut <= 0) {
      this.alive = false; // already prone: the held pose is the corpse
    }
    this.syncVisual(dt, game);
    anim?.update(dt);
    return;
  }

  /** an ally that just dropped what it was shooting at says so */
  private updateKillWatch(): void {
    // An ally that just dropped what it was shooting at says so. Fennec's
    // shots decide fights and used to do it in silence; a bark on the kill
    // is the credit, and the player's cue that a flank has been cleared.
    if (this.team === 0 && this.killWatch && !this.killWatch.alive) {
      if (this.shotRecently > 0) {
        const bark = SPAWN_BARKS[this.kind];
        if (bark) audio.bark(bark, 0.5);
      }
      this.killWatch = null;
    }
  }

  /** broke and ran. True = the flight took the frame; false = it rallied and fights on */
  private updateFleeing(dt: number, game: Game, anim: Animator | null): boolean {
    if (!this.fleeing) return false;
    const d = this.def;
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
      // a morale break is still voluntary movement: it does not get to sprint
      // off a platform lip that the same enemy would have stopped at walking
      this.edgeGuard(game);
      stepBody(game.board, this.position, this.radius, this.height, this.velocity, dt);
      if (this.boardHazards(game, dt)) return true;
      if (anim) {
        anim.play('lower', 'runLower', 0.2, anim.gaitRate('runLower', Math.hypot(this.velocity.x, this.velocity.z), this.char.baseScale));
        anim.play('upper', 'runUpper', 0.2, 1.2);
      }
      this.syncVisual(dt, game);
      anim?.update(dt);
      return true;
    }
    return false;
  }

  /** the AI proper: what this body does with the frame, by state and by style */
  private steer(dt: number, game: Game, target: Combatant | null): void {
    const d = this.def;
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
    } else if (d.burrows) {
      // a burrower runs its cycle with or without a target in sight: a
      // surfaced worm with nothing to bite goes back under
      this.updateBurrower(dt, game, target && this.visible ? target : null);
    } else if (target && this.visible) {
      if (!this.trySuperJump(game, target)) {
        switch (d.style) {
          case 'melee': this.updateMelee(dt, game, target); break;
          case 'ranged': this.updateRanged(dt, game, target); break;
          case 'swoop': this.updateSwoop(dt, game, target); break;
          case 'hover': this.updateHover(dt, game, target); break;
        }
      }
    } else if (this.team === 0 && !this.hunts) {
      // an ally with nothing to shoot: catch up to the player, or keep them
      // company once alongside
      this.updateEscort(dt, game);
    } else if (this.awareness !== 'idle') {
      // lost them, or never saw them: push to the last known position
      this.updateSearch(dt, game, this.awareness === 'engaged' ? 0.8 : 0.5);
    } else {
      this.updateIdle(dt, game);
    }
  }

  /** crowd spacing: bodies push each other apart rather than stacking */
  private separate(dt: number, game: Game): void {
    for (const other of game.enemies) {
      if (other === this || !other.alive) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const dist2 = dx * dx + dz * dz;
      const min = this.radius + other.radius + 0.3;
      if (dist2 < min * min && dist2 > 1e-6) {
        const dist = Math.sqrt(dist2);
        // An acceleration, so it has to be scaled by dt like every other
        // steering write in here — as a raw per-frame velocity add it was
        // ~2.4x stronger at 144 Hz than at 60, which moved crowd spacing,
        // cover displacement and the pounce arc with the refresh rate. The
        // constant reproduces the old 60 Hz feel; the clamp keeps a deep
        // overlap on a long frame from launching anyone.
        const push = Math.min((min - dist) * SEPARATION_ACCEL * dt, 6);
        this.velocity.x += (dx / dist) * push;
        this.velocity.z += (dz / dist) * push;
      }
    }
  }

  /** the capsule move (walkers) or the straight drift (fliers) */
  private integrate(dt: number, game: Game): void {
    const d = this.def;
    if (d.style === 'melee' || d.style === 'ranged') {
      this.edgeGuard(game);
      const res = stepBody(game.board, this.position, this.radius, this.height, this.velocity, dt);
      this.grounded = res.grounded;
      // A half-buried colossus is *of* the ground: it swims through the
      // surface rather than standing on it, never jumps and never falls. Left
      // to the capsule it can be squeezed off a ledge by a push-out — a
      // three-metre body against a one-metre wall picks whichever face is
      // nearer, and that is sometimes the outside — and then it drops away
      // under the floor and is deleted at the kill plane, taking the fight
      // with it. Pinning it to the surface each step is what its own design
      // already claims: the ground answers for it.
      if (d.plows) this.pinToGround(game);
    } else {
      this.position.addScaledVector(this.velocity, dt);
    }
  }

  /** brood spawns: enough damage taken and the egg sacs let go */
  private updateBroodSpawn(game: Game): void {
    const brood = this.def.spawnOnHurt;
    if (brood && this.spawnedCount < brood.max &&
        this.hp < this.spawnMark - this.def.hp * brood.per) {
      this.spawnMark = this.hp;
      for (let i = 0; i < brood.count && this.spawnedCount < brood.max; i++) {
        this.spawnedCount++;
        const a = Math.random() * Math.PI * 2;
        const p = this.position.clone().add(new THREE.Vector3(Math.cos(a) * 2, 0.2, Math.sin(a) * 2));
        const hatchling = game.addReinforcement(brood.kind, p, this.squad);
        if (this.target) hatchling.alert(this.target.position, true);
      }
      audio.bark('spider_chitter', 0.6);
    }
  }

  /** the ground answers for a half-buried body: the wake it ploughs through the surface */
  private updatePlowWake(dt: number, game: Game): void {
    const d = this.def;
    if (d.plows) {
      const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
      this.plowT -= dt * (0.4 + speed2 * 0.55);
      if (this.plowT <= 0 && speed2 > 0.4) {
        this.plowT = 0.08;
        // spread along the body behind the head, and across its width
        const back = 1.5 + Math.random() * 3.5;
        const side = (Math.random() - 0.5) * d.plows * 2;
        const sin = Math.sin(this.facingYaw), cos = Math.cos(this.facingYaw);
        _plow.set(
          this.position.x - sin * back + cos * side,
          this.position.y + 0.15,
          this.position.z - cos * back - sin * side,
        );
        // water throws spray, ground throws dust — the board decides which
        const wy = game.board.waterY;
        if (wy !== undefined && _plow.y < wy + 0.5) game.particles.splash(_plow, 5);
        else game.particles.dustPuff(_plow, 5);
      }
    }
  }

  /** which gait the body plays for the speed and heading it actually has */
  private updateLocomotionAnim(anim: Animator): void {
    const d = this.def;
    const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.windup <= 0 && this.leapT <= 0) {
      // A hover trooper is in the air: it flies, it does not pump a run
      // cycle on nothing. On the ground the cycle is picked by where the
      // feet are going relative to the chest — a shooter shuffling
      // sideways on its bearing, or fanning out on approach, used to run
      // the forward cycle through it and moonwalk — and paced by the
      // stride the clip actually covers (as the player's is), so a 7 m/s
      // duelist's feet keep up with the ground instead of skating.
      let lower = 'idleLower';
      let rate = 1;
      if (d.style === 'hover') lower = 'flyLower';
      else if (speed2 > 0.7) {
        const travel = travelClip(this.velocity.x, this.velocity.z, this.facingYaw);
        lower = travel.clip;
        rate = travel.dir * anim.gaitRate(lower, speed2, this.char.baseScale) * (travel.dir < 0 ? 0.9 : 1);
      }
      anim.play('lower', lower, 0.2, rate);
      // A shooter holds the aim while it is firing or standing; on the move
      // between shots it runs with the gun, instead of the frozen aim pose
      // gliding along at any speed. A hover trooper is always in the air
      // and always aiming.
      const shooting = this.volleyLeft > 0 || this.attackCd > this.def.attackCd - 0.35;
      if (d.style === 'hover' || (d.style === 'ranged' && (shooting || speed2 <= 0.7))) anim.play('upper', 'enemyAimUpper', 0.25);
      else if (speed2 > 0.7) anim.play('upper', 'runUpper', 0.2, Math.abs(rate));
      else anim.play('upper', 'idleUpper', 0.25);
    }
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
    if (this.hunts) {
      // A hunter needs no line of sight to know where the prey is: the brood
      // is one animal with the mother, and she can see the whole board. It
      // crosses to whatever is nearest and bites it.
      this.visible = !!foe;
      if (foe) {
        this.awareness = 'engaged';
        this.memory = MEMORY;
        this.interest.copy(foe.position);
      }
      return foe;
    }
    if (this.team === 0 || this.owner) {
      // Allies fight whatever is near, but they escort rather than hunt: with
      // hostiles now posted all over the board, an ally that picked the
      // nearest one would jog off across the desert and never come back.
      //
      // Whoever is *nearest* is the one being escorted. Taking the first
      // living player instead made an ally player one's alone: in co-op the
      // marshal would stand beside player two in the middle of a firefight and
      // never fire, because both gates below were measured against a player a
      // hundred metres away. A PvP squad follower is the exception: it is
      // pinned to its own leader, whoever else is closer.
      const p = this.owner && this.owner.alive ? this.owner : this.nearestPlayer(game);
      // Leash the engagement to the player, not to the foe: chasing whatever
      // is nearest to *itself* walks an ally across the board one target at a
      // time. Anything worth shooting is near the person being escorted.
      const anchor = p ? p.position : this.position;
      const strayed = p ? this.position.distanceTo(p.position) > ESCORT_LEASH : false;
      const close = foe && !strayed && foe.position.distanceTo(anchor) < ESCORT_ENGAGE ? foe : null;
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
        if (this.kind === 'massiff') audio.beastGrowl(0.45);
        else {
          const bark = SPAWN_BARKS[this.kind];
          if (bark) audio.bark(bark, 0.35);
        }
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
    const d = this.def;
    const dx = foe.position.x - this.position.x;
    const dz = foe.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    // sight range scales with the light falling on the *target*: on a board
    // with a moving terminator the night side is genuinely safer to cross
    const lit = game.board.lightAt ? 0.45 + 0.55 * game.board.lightAt(foe.position.x, foe.position.z) : 1;
    let notice = d.notice * lit;
    // a submerged target is a shadow under the chop: near-invisible from
    // above, which is what makes the water a stealth route
    const wY = game.board.waterY;
    if (wY !== undefined && foe.position.y + 1.2 < wY) notice = Math.min(notice, 7);
    if (dist > notice) return false;
    const inv = 1 / (dist || 1);
    const dot = (dx * inv) * Math.sin(this.facingYaw) + (dz * inv) * Math.cos(this.facingYaw);
    // ahead: full range; peripheral: about half; behind: only right on top of them
    const range = dot > 0.25 ? notice : dot > -0.35 ? notice * 0.5 : 8;
    if (dist > range) { this.sightMemo = false; return false; }
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.2 + (this.id % 5) * 0.03;
      this.sightMemo = this.hasLineOfSight(game, foe);
    }
    return this.sightMemo;
  }

  /** posted and unbothered: mill around the post, look around, hold the ground */
  private updateIdle(dt: number, game: Game): void {
    const d = this.def;
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

  /**
   * An ally between fights. Out of reach of the player they are escorting they
   * walk in; alongside them they mill — the same loiter a posted hostile does,
   * but around the player instead of a fixed post.
   *
   * The milling is not decoration. `updateSearch` stops dead the moment it is
   * within a couple of metres of what it is heading for, so an ally who had
   * caught up simply froze mid-stride and stood there like a prop until a
   * hostile came within range of the player.
   */
  private updateEscort(dt: number, game: Game): void {
    const p = this.nearestPlayer(game);
    if (!p) { this.updateSearch(dt, game, 0.8); return; }
    if (this.position.distanceTo(p.position) > ESCORT_NEAR) {
      this.updateSearch(dt, game, 0.8);
      return;
    }
    // loiter around the player rather than a post they never took. The goal is
    // only re-rolled on the idle timer, so a player who walks off drags it out
    // of range: re-roll early in that case, or the ally mills where the player
    // used to be until the timer happens to come round.
    this.post.copy(p.position);
    if (this.idleGoal.distanceTo(this.post) > ESCORT_DRIFT) this.idleTimer = 0;
    this.updateIdle(dt, game);
  }

  /** heading for the last thing it saw or heard */
  private updateSearch(dt: number, game: Game, speedScale: number): void {
    const d = this.def;
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
      if (Math.hypot(hx - target.position.x, hz - target.position.z) > this.def.attackRange * 0.9) continue;
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
      const muzzleTo = new THREE.Vector3(target.position.x, target.position.y + aimHeight(target), target.position.z).sub(chest);
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
        const pMuzzle = new THREE.Vector3(target.position.x, target.position.y + aimHeight(target), target.position.z).sub(pchest);
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
    const d = this.def;
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
    const d = this.def;
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

  faceToward(dt: number, x: number, z: number, rate = 10): void {
    const yaw = Math.atan2(x - this.position.x, z - this.position.z);
    this.facingYaw = dampAngle(this.facingYaw, yaw, rate, dt);
  }

  /**
   * An egg's whole life: settle, wobble, and count down to the hatch. It
   * never fights or flees, and dying (the ordinary damage path — bolts,
   * melee, hazards) simply ends it before anything crawls out. On the hatch
   * the sac retires without a death (no burst, no credit) and the hatchling
   * stands up in its place: same team, same owner, so a PvP broodmother's
   * eggs grow into her escort.
   */
  private updateEgg(dt: number, game: Game): void {
    if (this.hatchT < 0) this.hatchT = this.def.egg!.hatchIn;
    // a lobbed egg keeps its arc; a laid (or landed) one settles where it is
    const settle = this.grounded ? 6 : this.eggThrown && !this.eggHit ? 0.3 : 2;
    this.velocity.x = damp(this.velocity.x, 0, settle, dt);
    this.velocity.z = damp(this.velocity.z, 0, settle, dt);
    const res = stepBody(game.board, this.position, this.radius, this.height, this.velocity, dt);
    this.grounded = res.grounded;
    if (this.boardHazards(game, dt)) return;

    // the throw's payoff: the first body the flying egg meets is shoved off
    // its feet, unhurt — the hurt is what hatches if nobody deals with it
    if (this.eggThrown && !this.eggHit) {
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      if (sp > 4) {
        for (const f of game.hostilesFor(this)) {
          if (this.position.distanceTo(f.position) > f.radius + this.radius + 0.4) continue;
          const en = f as Partial<Enemy> & typeof f;
          if (en.knockback) {
            en.knockback(this.position, 12, 0.4);
          } else {
            const push = f.position.clone().sub(this.position).setY(0).normalize();
            f.velocity.addScaledVector(push, 9);
            f.velocity.y += 3.5;
          }
          this.eggHit = true;
          this.velocity.multiplyScalar(0.2);
          audio.impact();
          game.particles.dustPuff(this.position, 5);
          break;
        }
      } else if (this.grounded) {
        this.eggHit = true;   // landed without meeting anyone: just an egg now
      }
    }
    this.hatchT -= dt;
    if (this.hatchT <= 0) {
      this.alive = false;
      this.counted = true;   // hatched, not killed
      this.removeMe = true;
      const spider = new Enemy(this.def.egg!.hatchTo, this.position, this.team);
      if (this.owner) spider.setOwner(this.owner, true);   // the brood hunts
      game.addEnemy(spider, { puff: 8 });
      audio.bark('spider_chitter', 0.6);
      return;
    }
    this.syncVisual(dt, game);
  }

  /**
   * The boss gap-closer: a committed ballistic super jump onto where the
   * target is headed, ending in a ground slam (docs/MODES.md §4a). Only
   * promoted bosses jump — never the half-buried colossi, whose bodies are
   * part of the terrain, and never the fliers, who don't need it. Committed
   * like the massiff's pounce: no steering in the air, so a dash or a
   * jetpack hop as the shadow arrives beats the landing.
   */
  private trySuperJump(game: Game, target: Combatant): boolean {
    const d = this.def;
    if (!this.boss || d.plows) return false;
    if (d.style !== 'melee' && d.style !== 'ranged') return false;
    if (this.superJumpCd > 0 || this.windup > 0 || this.pounce > 0 || !this.grounded) return false;
    const dist = Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z);
    // a melee boss leaps to close mid-range; a ranged boss only crosses a
    // real gap — it should not leap out of its own firing band every clock
    if (dist < (d.style === 'ranged' ? 14 : 7) || dist > 34) return false;
    if (!this.losThrottled(game, target)) return false;
    // aim at where they'll be when the arc comes down
    const vy = 9 + Math.min(dist * 0.12, 3.5);
    const flight = (2 * vy) / bodyGravity(game.board, this.position);
    const aim = target.position.clone().addScaledVector(target.velocity, flight * 0.8);
    const ax = aim.x - this.position.x, az = aim.z - this.position.z;
    const gap = Math.hypot(ax, az);
    const need = gap / flight;
    if (need > 30 || gap < 1) return false;
    this.velocity.x = (ax / gap) * need;
    this.velocity.z = (az / gap) * need;
    this.velocity.y = vy;
    this.leapT = flight + 0.6;
    this.grounded = false;
    this.superJumpCd = this.enraged ? 4 : 7;
    this.superJumps++;
    this.volleyLeft = 0;          // nothing fires through a leap
    this.char.attack?.();         // a creature coils into the jump
    if (BEASTS.has(this.kind)) {
      const voice = MONSTER_VOICE[this.kind];
      if (voice) audio.monster(voice, 'roar', 0.8);
      else audio.beastGrowl(0.8);
    }
    else {
      const bark = SPAWN_BARKS[this.kind];
      if (bark) audio.bark(bark, 0.6);
    }
    game.particles.dustPuff(this.position, 14);
    return true;
  }

  /** Glue a burrowing body to the surface under it; it has no airborne state. */
  private pinToGround(game: Game): void {
    const g = game.board.physics.groundHeight(this.position.x, this.position.z, this.position.y + 2);
    if (g === -Infinity) return;
    this.position.y = g;
    if (this.velocity.y < 0) this.velocity.y = 0;
    this.grounded = true;
  }

  /** Mid-leap: ballistic, unsteered, air pose held until the ground arrives. */
  private updateLeap(dt: number, game: Game): void {
    this.leapT -= dt;
    const res = stepBody(game.board, this.position, this.radius, this.height, this.velocity, dt);
    this.grounded = res.grounded;
    if (this.boardHazards(game, dt)) return;
    const anim = this.char.animator;
    if (anim) {
      anim.play('lower', 'airLower', 0.12);
      anim.play('upper', 'airUpper', 0.12);
    }
    if (this.leapT <= 0 || (this.grounded && this.leapT < 0.5)) {
      this.leapT = 0;
      this.landSlam(game);
      // the ground is taken in the knees, the same crouch the player lands
      // in — the leap used to cut from the air pose straight into the run
      anim?.playOnce('lower', 'landLower', 0.05);
    }
    this.syncVisual(dt, game);
    anim?.update(dt);
  }

  /**
   * The super jump's landing: the ground answers. Splash damage and a shove
   * on anyone underneath, and every nearby camera feels the impact. The slam
   * hits softer than the boss's swing — it is pressure and displacement; the
   * swing stays the killer.
   */
  private landSlam(game: Game): void {
    const d = this.def;
    const r = 4 + this.radius * 1.5;
    game.particles.dustPuff(this.position, 20);
    audio.land(true);
    game.director.noise(game, this.position, 40);
    for (const p of game.players) {
      const dd = p.position.distanceTo(this.position);
      if (dd < 18) p.cam.shake(0.3 * (1 - dd / 18));
      if (!p.alive || dd > r) continue;
      p.damage(d.damage * this.dmgScale * 0.6, this.position, -1, { heavy: true });
      const push = p.position.clone().sub(this.position).setY(0).normalize();
      p.velocity.addScaledVector(push, 10);
      p.velocity.y += 4;
    }
    for (const a of game.allies) {
      if (!a.alive || a.team === this.team) continue;
      if (a.position.distanceTo(this.position) > r) continue;
      a.damage(d.damage * this.dmgScale * 0.6, this.position, -1);
      a.knockback(this.position, 12, 0.4);
    }
    this.attackCd = Math.max(this.attackCd, 0.6);
    this.char.attack?.();   // a creature punctuates the landing with its strike
  }

  /**
   * The burrower's cycle (docs/BOSSES.md §2.7). Under the ground it hunts —
   * fast, unseen but for the wake, untouchable — and erupts once it is under
   * its prey or has been down long enough. On the surface it is rooted: it
   * turns, it bites, and after its spell (or once the prey is out of reach)
   * it sinks and hunts again. `target` is null when nothing is in sight, in
   * which case a surfaced worm goes under and an underground one waits.
   */
  private updateBurrower(dt: number, game: Game, target: Combatant | null): void {
    const d = this.def;
    const b = d.burrows!;
    this.burrowT -= dt;
    const dist = target ? Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z) : Infinity;
    if (target) this.faceToward(dt, target.position.x, target.position.z, this.burrow === 'under' ? 4 : 7);
    const rooted = (): void => {
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);
    };
    let depth = 1;
    switch (this.burrow) {
      case 'under': {
        if (target) {
          const to = _to.set(target.position.x - this.position.x, 0, target.position.z - this.position.z);
          if (to.lengthSq() > 1e-4) to.normalize();
          this.velocity.x = damp(this.velocity.x, to.x * d.speed, 5, dt);
          this.velocity.z = damp(this.velocity.z, to.z * d.speed, 5, dt);
          // the wake's own voice: a continuous rumble that swells as it closes,
          // driven from here because this is the only place that knows the worm
          // is under the sand and how far off it still is
          audio.setBurrowRumble(Math.max(0.25, Math.min(1, 34 / Math.max(dist, 6))));
        } else rooted();
        if (target && (dist < b.strikeAt || this.burrowT <= 0)) {
          this.burrow = 'rising';
          this.burrowT = b.rise;
          this.windup = 0;
          audio.setBurrowRumble(0);   // it is out of the ground; the wake is over
          const rising = MONSTER_VOICE[this.kind];
          if (rising) audio.monster(rising, 'roar', 0.95);
          else audio.beastGrowl(0.9);
          game.particles.dustPuff(this.position, 24);
          game.director.noise(game, this.position, 40, true);
        }
        break;
      }
      case 'rising': {
        rooted();
        // the ground boils before it breaks
        if (Math.random() < dt * 30) game.particles.dustPuff(this.position, 3);
        for (const p of game.players) {
          const dd = p.position.distanceTo(this.position);
          if (dd < 20) p.cam.shake(0.05 * (1 - dd / 20));
        }
        const prog = 1 - Math.max(0, this.burrowT) / b.rise;
        depth = 1 - prog * prog;
        if (this.burrowT <= 0) {
          this.burrow = 'up';
          this.burrowT = b.up;
          this.erupt(game);
        }
        break;
      }
      case 'up': {
        rooted();
        depth = 0;
        if (this.windup > 0) {
          this.windup -= dt;
          if (this.windup <= 0 && this.windupTarget) {
            const hd = this.windupTarget.position.distanceTo(this.position);
            if (hd < d.attackRange + 0.6 && this.windupTarget.alive) {
              this.windupTarget.damage(d.damage * this.dmgScale, this.position, -1, { heavy: true });
            }
            this.attackCd = d.attackCd;
          }
          break;
        }
        if (target && dist <= d.attackRange && this.attackCd <= 0) {
          this.windupTarget = target;
          this.windup = this.char.attack ? Math.max(0.4, this.char.attack() * 0.7) : 0.55;
          break;
        }
        // its spell is up, or the prey has run: back under, and hunt
        const gone = !target || (dist > d.attackRange * 1.8 && this.burrowT < b.up - 2.5);
        if (this.burrowT <= 0 || gone) {
          this.burrow = 'sinking';
          this.burrowT = b.sink;
          game.particles.dustPuff(this.position, 16);
        }
        break;
      }
      case 'sinking': {
        rooted();
        const prog = 1 - Math.max(0, this.burrowT) / b.sink;
        depth = prog * prog;
        if (Math.random() < dt * 20) game.particles.dustPuff(this.position, 2);
        if (this.burrowT <= 0) {
          this.burrow = 'under';
          this.burrowT = b.under;
        }
        break;
      }
    }
    this.char.setBurrow?.(depth);
  }

  /**
   * The burrower breaking the surface: everyone standing over it is hit,
   * thrown up and out, and every nearby camera feels the ground go. The
   * eruption is the burrower's opening move and its answer to a camper: the
   * wake tells you where it is coming up, so the hit is the cost of not
   * moving.
   */
  private erupt(game: Game): void {
    const d = this.def;
    const b = d.burrows!;
    this.eruptions++;
    game.particles.explosion(this.position.clone());
    game.particles.dustPuff(this.position, 40);
    audio.land(true);
    audio.beastGrowl(1);
    game.director.noise(game, this.position, 50, true);
    for (const p of game.players) {
      const dd = p.position.distanceTo(this.position);
      if (dd < 24) p.cam.shake(0.45 * (1 - dd / 24));
      if (!p.alive || dd > b.eruptR) continue;
      p.damage(b.erupt * this.dmgScale, this.position, -1, { heavy: true });
      const push = p.position.clone().sub(this.position).setY(0);
      if (push.lengthSq() > 1e-4) push.normalize();
      p.velocity.addScaledVector(push, 9);
      p.velocity.y = Math.max(p.velocity.y, 9);
    }
    for (const a of game.allies) {
      if (!a.alive || a.team === this.team) continue;
      if (a.position.distanceTo(this.position) > b.eruptR) continue;
      a.damage(b.erupt * this.dmgScale, this.position, -1);
      a.knockback(this.position, 12, 0.5, 0.8);
    }
    for (const e of game.enemies) {
      if (e === this || !e.alive || e.team === this.team) continue;
      if (e.position.distanceTo(this.position) > b.eruptR) continue;
      e.damage(b.erupt * this.dmgScale, this.position, this.lastHitBy);
      e.knockback(this.position, 12, 0.5, 0.8);
    }
    this.attackCd = Math.max(this.attackCd, 0.9);
  }

  private updateMelee(dt: number, game: Game, target: Combatant): void {
    const d = this.def;
    const to = target.position.clone().sub(this.position);
    to.y = 0;
    const dist = to.length();
    this.faceToward(dt, target.position.x, target.position.z);

    if (this.windup > 0) {
      this.windup -= dt;
      this.velocity.x = damp(this.velocity.x, 0, 10, dt);
      this.velocity.z = damp(this.velocity.z, 0, 10, dt);
      if (this.special) this.telegraphSpecial(dt, game);
      if (this.windup <= 0 && this.special === 'dash') { this.launchDash(target); return; }
      if (this.windup <= 0 && this.special === 'slam') { this.groundShock(game); return; }
      if (this.windup <= 0 && this.windupTarget) {
        const hd = this.windupTarget.position.distanceTo(this.position);
        if (hd < d.attackRange + 0.6 && this.windupTarget.alive) {
          this.windupTarget.damage(d.damage * this.dmgScale, this.position, -1, { heavy: true });
          this.contactStop();
        }
        this.attackCd = d.attackCd;
      }
      return;
    }

    // ---- the officer's lunge: on its line, no steering ----
    if (this.dashT > 0) { this.updateDash(dt, game); return; }

    // ---- pounce (the massiff's signature) ----
    // Mid-leap it steers not at all: the arc is committed the moment it jumps,
    // so a dash or a jetpack hop to the side beats it. Contact during the leap
    // is the hit, and landing ends it either way.
    if (this.pounce > 0) {
      this.pounce -= dt;
      if (!this.pounceHit && target.alive) {
        const pd = target.position.distanceTo(this.position);
        if (pd < d.attackRange + 0.4) {
          this.pounceHit = true;
          target.damage(d.damage * 1.15 * this.dmgScale, this.position, -1, { heavy: true });
          if ('velocity' in target) target.velocity.addScaledVector(this.velocity.clone().setY(0).normalize(), 5);
          this.attackCd = d.attackCd;
        }
      }
      if (this.pounce <= 0 || (this.grounded && this.pounce < 0.4)) {
        this.pounce = 0;
        // land and get straight back to running; a miss shouldn't gift a rest
        this.attackCd = Math.max(this.attackCd, this.pounceHit ? d.attackCd : 0.7);
        game.particles.dustPuff(this.position, 10); // heavy landing
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

    // The second moves: the officer opens with a lunge from outside reach,
    // the enforcer answers a target inside the ring with the slam (a roll
    // keeps its plain swing in the mix). Both wait on the same attack clock
    // as a swing and on their own spacing, so neither raises the damage rate.
    if (this.specialCd <= 0 && this.attackCd <= 0 && this.grounded && this.stagger <= 0) {
      if (this.kind === 'officer' && dist > d.attackRange && dist < DASH_TRIGGER && this.losThrottled(game, target)) {
        this.startSpecial('dash', target);
        return;
      }
      if (this.kind === 'enforcer' && dist < SLAM_RADIUS + 1.2 && Math.random() < 0.6) {
        this.startSpecial('slam', target);
        return;
      }
    }

    // Beasts close the last stretch in one leap rather than jogging into reach.
    // The arc is ballistic and committed — no steering once airborne, so a dash
    // or a jetpack hop beats it — which means it has to be aimed at where the
    // target *will* be. Without the lead, pouncing at a running player lands
    // behind them and actually loses ground.
    if ((this.kind === 'massiff' || d.pounces) && this.attackCd <= 0 && this.grounded &&
        dist > d.attackRange && dist < 16 && this.losThrottled(game, target)) {
      const vy = 6.2 + dist * 0.12;
      const flight = (2 * vy) / bodyGravity(game.board, this.position);       // ballistic hang time
      const aim = target.position.clone().addScaledVector(target.velocity, flight * 0.85);
      const ax = aim.x - this.position.x, az = aim.z - this.position.z;
      const gap = Math.hypot(ax, az);
      const need = gap / flight;
      // only leap if the beast can actually land on them
      if (need <= 24 && gap > 1) {
        this.velocity.x = (ax / gap) * need;
        this.velocity.z = (az / gap) * need;
        this.velocity.y = vy;
        this.pounce = flight + 0.5;
        this.pounceHit = false;
        this.grounded = false;
        this.char.attack?.();   // jaws open through the leap
        audio.beastGrowl(0.6);
        game.particles.dustPuff(this.position, 8);
        return;
      }
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
        // creatures animate their own strike (attack hook); rigged humanoids
        // play the overhead swing. The damage lands when the wind-up expires,
        // so time it near the clip's strike frame (~55% in) rather than its tail.
        if (this.char.attack) this.windup = Math.max(0.4, this.char.attack() * 0.7);
        else if (this.char.animator) this.char.animator.playOnce('upper', 'enemySwing', 0.06);
      }
    }
  }

  /**
   * Begin a second move: the wind-up is the telegraph. The swing clip is
   * played slow enough that its strike key lands where the move does — the
   * lunge's launch, the slam's shock — so the body reads the timing too.
   */
  private startSpecial(kind: 'dash' | 'slam', target: Combatant): void {
    this.special = kind;
    this.windupTarget = target;
    this.windup = kind === 'dash' ? DASH_WINDUP : SLAM_WINDUP;
    this.specialCd = kind === 'dash' ? DASH_CD : SLAM_CD;
    const bark = SPAWN_BARKS[this.kind];
    if (bark) audio.bark(bark, 0.55);
    // the swing's strike key sits at 0.55 s of 0.7: scale so it meets the move
    const scale = 0.55 / (kind === 'dash' ? DASH_WINDUP + 0.2 : SLAM_WINDUP);
    this.char.animator?.playOnce('upper', 'enemySwing', 0.06, false, scale);
  }

  /** the wind-up's visible cue, every frame it runs */
  private telegraphSpecial(dt: number, game: Game): void {
    // a spark clock at 16 Hz, so the cue does not scale with the frame rate
    if (Math.floor((this.windup + dt) * 16) === Math.floor(this.windup * 16)) return;
    if (this.special === 'dash') {
      // the blade throws sparks as it is drawn back
      const at = _cue;
      const blade = this.char.rig?.bones.weaponR;
      if (blade) blade.getWorldPosition(at);
      else at.copy(this.position).setY(this.position.y + this.height * 0.7);
      game.particles.impactSparks(at, 3);
    } else {
      // the ember ring is drawn where the shock will reach — the get-out line
      // is the line on the ground, exactly as the warlord's shock-slam draws it
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        _cue.set(this.position.x + Math.cos(a) * SLAM_RADIUS, this.position.y + 0.4, this.position.z + Math.sin(a) * SLAM_RADIUS);
        game.particles.impactSparks(_cue, 3);
      }
    }
  }

  /** everyone this body could hurt within `r` of it, this frame */
  private foesWithin(game: Game, r: number): Combatant[] {
    const out = _foes;
    out.length = 0;
    const consider = (c: Combatant) => {
      if (!c.alive || c.team === this.team) return;
      if (c.position.distanceTo(this.position) <= r + c.radius) out.push(c);
    };
    for (const p of game.players) consider(p);
    for (const a of game.allies) if (a !== this) consider(a);
    for (const e of game.enemies) if (e !== this) consider(e);
    return out;
  }

  /** the wind-up is done: fix the line on where the target stands now and go */
  private launchDash(target: Combatant): void {
    this.special = null;
    this.windupTarget = null;
    this.dashDir.copy(target.position).sub(this.position).setY(0);
    if (this.dashDir.lengthSq() < 1e-4) this.dashDir.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
    this.dashDir.normalize();
    this.dashT = DASH_LENGTH / DASH_SPEED;
    this.dashHit = false;
    this.facingYaw = Math.atan2(this.dashDir.x, this.dashDir.z);
  }

  /**
   * Mid-lunge: the velocity is written outright every frame so nothing
   * steers it (the edge guard downstream may still stop it dead at a lip,
   * which is the right answer there). Contact along the line is the hit;
   * the slash lands once and the lunge is over a beat later.
   */
  private updateDash(dt: number, game: Game): void {
    this.dashT -= dt;
    this.velocity.x = this.dashDir.x * DASH_SPEED;
    this.velocity.z = this.dashDir.z * DASH_SPEED;
    if (!this.dashHit) {
      const d = this.def;
      for (const c of this.foesWithin(game, DASH_REACH)) {
        this.dashHit = true;
        c.damage(d.damage * this.dmgScale, this.position, -1, { heavy: true });
        c.velocity.addScaledVector(this.dashDir, 4);
      }
      if (this.dashHit) { this.contactStop(0.08); this.dashT = Math.min(this.dashT, 0.06); }
    }
    if (this.dashT <= 0) {
      this.dashT = 0;
      this.attackCd = this.def.attackCd;
      this.velocity.x *= 0.3;
      this.velocity.z *= 0.3;
    }
  }

  /**
   * The slam's landing: the ground answers inside the ring. The kind's own
   * melee damage, plus a shove out of the ring — and the enforcer's own
   * animation hangs on the contact when it connects.
   */
  private groundShock(game: Game): void {
    this.special = null;
    this.windupTarget = null;
    this.attackCd = this.def.attackCd;
    game.particles.dustPuff(this.position, 20);
    game.particles.impactSparks(this.position, 14);
    audio.land(true);
    game.director.noise(game, this.position, 25);
    for (const p of game.players) {
      const dd = p.position.distanceTo(this.position);
      if (dd < 12) p.cam.shake(0.25 * (1 - dd / 12));
    }
    let hit = false;
    for (const c of this.foesWithin(game, SLAM_RADIUS)) {
      hit = true;
      c.damage(this.def.damage * this.dmgScale, this.position, -1, { heavy: true });
      if (c instanceof Enemy) c.knockback(this.position, 9, 0.35);
      else {
        const push = c.position.clone().sub(this.position).setY(0);
        if (push.lengthSq() < 1e-4) push.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
        c.velocity.addScaledVector(push.normalize(), 7);
        c.velocity.y += 3;
      }
    }
    if (hit) this.contactStop(0.09);
  }

  private updateRanged(dt: number, game: Game, target: Combatant): void {
    const d = this.def;
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

    if (game.board.rangedLeash && this.team === 1) {
      // island boards: never walk off the edge chasing a firing angle
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
    const d = this.def;
    if (d.kamikaze) return; // the drone's whole body is the attack
    if (this.volleyLeft > 0) {
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0) {
        this.volleyLeft--;
        this.volleyTimer = d.flame ? 0.09 : 0.16;
        if (d.flame) {
          // a flame stream runs out of fuel, it does not overheat
          this.flameTick(game, target);
        } else {
          this.fireBoltAt(game, target);
          // heat builds per bolt; a barrel that has had enough cuts the burst
          // short and goes quiet rather than finishing it
          this.heat = Math.min(1, this.heat + ENEMY_HEAT_PER_SHOT);
          this.heatHold = ENEMY_HEAT_HOLD;
          if (this.heat >= 1) {
            // The vent is what does the cooling: it purges the barrel outright
            // rather than waiting on the slow bleed, which would otherwise
            // leave the shooter at the ceiling and venting again on its very
            // next bolt.
            this.heat = 0;
            this.heatHold = 0;
            this.volleyLeft = 0;
            this.venting = ENEMY_VENT_TIME;
            this.attackCd = Math.max(this.attackCd, ENEMY_VENT_TIME);
          }
        }
      }
    } else if (this.venting <= 0 && this.attackCd <= 0 && dist < d.attackRange && this.losThrottled(game, target)) {
      this.volleyLeft = d.volley ?? 1;
      // a pinned shooter pops up less often
      this.attackCd = d.attackCd * (this.suppression > 0.55 ? 1.6 : 1);
      if (d.flame) {
        // the stream commits to a line when the trigger is squeezed: it leads
        // the target a touch, and then holds — stepping off the line beats it
        this.flameAim.copy(target.position).addScaledVector(target.velocity, 0.35);
        this.flameAim.y += 1.0;
        audio.flame();
      }
    }
  }

  /**
   * Line of sight for the firing checks, memoised a dozen times a second.
   *
   * The class throttles its *spotting* raycast deliberately (see `canSee`), but
   * these two ran every frame: `updateVolley` whenever a shooter sat in range
   * with its cooldown up, and the massiff's pounce gate for every frame a
   * target sat in the band where the leap keeps failing its distance test — a
   * target sprinting away holds it there indefinitely. Each is a march through
   * the whole world, times every hostile on the board.
   */
  private losThrottled(game: Game, target: Combatant): boolean {
    const period = 0.08 + (this.id % 4) * 0.01;   // staggered, so they don't all land together
    if (game.time - this.losCheckAt >= period) {
      this.losCheckAt = game.time;
      this.losMemo = this.hasLineOfSight(game, target);
    }
    return this.losMemo;
  }

  /**
   * One tick of the flame stream: a jet of fire along the committed aim line.
   * Damage lands only on a target still standing in the stream's cone.
   */
  private flameTick(game: Game, target: Combatant): void {
    const d = this.def;
    const from = new THREE.Vector3();
    if (this.char.muzzle) this.char.muzzle.getWorldPosition(from);
    else { from.copy(this.position); from.y += this.height * 0.7; }
    const dir = this.flameAim.clone().sub(from);
    const reach = Math.min(dir.length(), d.attackRange + 1);
    dir.normalize();
    game.particles.jetPlume(from, dir, 0.09, { power: 1, scale: 2.6 });
    if (!target.alive) return;
    const toT = target.position.clone();
    toT.y += target.height * 0.5;
    toT.sub(from);
    const tDist = toT.length();
    if (tDist > reach + 1.2) return;
    toT.normalize();
    if (toT.dot(dir) < 0.9) return; // stepped out of the stream
    target.damage(d.damage * this.dmgScale, from);
  }

  private hasLineOfSight(game: Game, target: Combatant): boolean {
    const from = _from.copy(this.position);
    from.y += this.height * 0.75;
    const to = _to.copy(target.position);
    to.y += 1;
    const dir = to.sub(from);
    const dist = dir.length();
    dir.normalize();
    return !game.board.physics.raycast(from, dir, dist);
  }

  fireBoltAt(game: Game, target: Combatant): void {
    const d = this.def;
    const from = new THREE.Vector3();
    if (this.char.muzzle) this.char.muzzle.getWorldPosition(from);
    else { from.copy(this.position); from.y += this.height * 0.7; }
    // lead the target a little, with error so bolts are dodgeable
    const aim = target.position.clone();
    aim.y += aimHeight(target);
    const t = from.distanceTo(aim) / (d.boltSpeed ?? 28);
    aim.addScaledVector(target.velocity, t * 0.55);
    // suppression wrecks the aim: shots snatched from behind cover go wide
    const err = 1 + this.suppression * 1.6;
    aim.x += (Math.random() - 0.5) * 1.6 * err;
    aim.y += (Math.random() - 0.5) * 1.2 * err;
    aim.z += (Math.random() - 0.5) * 1.6 * err;
    const dir = aim.sub(from).normalize();
    game.projectiles.fire(from, dir, d.boltSpeed ?? 28, d.damage * this.dmgScale, this.team, -1, d.boltTag);
    // A firefight pulls in whoever is posted nearby. An ally's covering fire
    // used to carry 40 m — further than the player's own carbine reaches
    // posted enemies — so a squad of allies woke the whole board; it now
    // carries about as far as a hostile's.
    game.director.noise(game, this.position, this.team === 1 ? 30 : 22);
    if (this.team === 0) { this.killWatch = target; this.shotRecently = 0.9; }
    audio.enemyBlaster();
  }

  private updateSwoop(dt: number, game: Game, target: Combatant): void {
    const d = this.def;
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
    // Ram damage on a close pass — once per pass, not once per frame. The
    // cooldown was set here but never tested, so a swoop overlapping the player
    // billed 10 damage on every rendered frame it stayed in contact (~30-60 a
    // pass, and worse the higher the refresh rate).
    if (this.attackCd <= 0 && this.position.distanceTo(target.position) < 1.8 && target.alive) {
      this.char.attack?.();   // the ram reads on the bike, not just the numbers
      target.damage(10 * this.dmgScale, this.position);
      target.velocity.add(this.velocity.clone().multiplyScalar(0.4));
      this.attackCd = Math.max(this.attackCd, 1);
    }
  }

  private updateHover(dt: number, game: Game, target: Combatant): void {
    const d = this.def;

    // ---- kamikaze (the interceptor drone) ----
    // It stalks like any hover flier, then commits: a straight, unsteered dive
    // at where the target was heading. Contact — or anything solid — sets it
    // off. A dash or a jetpack hop after the whine beats it clean.
    if (d.kamikaze) {
      if (this.diving > 0) {
        this.diving -= dt;
        const pd = this.position.distanceTo(target.position);
        const hitGround = game.board.physics.groundHeight(this.position.x, this.position.z, this.position.y + 0.5) >= this.position.y - 0.1;
        if (pd < 1.6 || hitGround || this.diving <= 0) {
          // detonation: FX + splash on whoever is close, then nothing left
          game.particles.explosion(this.position.clone());
          audio.explosion();
          game.director.noise(game, this.position, 55, true);
          for (const p of game.players) {
            if (!p.alive) continue;
            const dd = p.position.distanceTo(this.position);
            if (dd < 4.5) p.damage(d.damage * (1 - dd / 5.5), this.position, -1, { heavy: true });
          }
          for (const e of game.enemies) {
            if (!e.alive || e === this) continue;
            const dd = e.position.distanceTo(this.position);
            if (dd < 4) { e.damage(30 * (1 - dd / 4.5), this.position, this.lastHitBy); e.knockback(this.position, 10, 0.4); }
          }
          this.hp = 0;
          this.alive = false;
          this.settled = true; // nothing left to tip over
          return;
        }
        // committed: no steering, just the trail
        game.particles.jetPlume(this.position, _JET_DOWN, dt, { power: 0.9, carrier: this.velocity });
        return;
      }
      const dist = this.position.distanceTo(target.position);
      // it only commits from altitude: a dive that starts at ground level
      // trips its own ground-contact fuse before it has gone anywhere
      const clearance = this.position.y -
        game.board.physics.groundHeight(this.position.x, this.position.z, this.position.y + 0.5);
      if (this.attackCd <= 0 && dist < 18 && (!isFinite(clearance) || clearance > 3) &&
          this.hasLineOfSight(game, target)) {
        const aim = target.position.clone();
        aim.y += 0.9;
        aim.addScaledVector(target.velocity, dist / 17 * 0.7);
        this.velocity.copy(aim.sub(this.position).normalize().multiplyScalar(17));
        this.diving = 1.8;
        this.attackCd = d.attackCd;
        audio.bark('drone_whine', 0.7);
        return;
      }
    }

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
    const fs = Math.sin(this.facingYaw), fc = Math.cos(this.facingYaw);
    for (const side of [-1, 1]) {
      _jet.set(
        this.position.x - fs * 0.18 + fc * 0.08 * side,
        this.position.y + 1.1,
        this.position.z - fc * 0.18 - fs * 0.08 * side,
      );
      game.particles.jetPlume(_jet, _JET_DOWN, dt, { power: 0.7, carrier: this.velocity });
    }
  }

  // ---------- arriving on the board (src/enemies/arrival.ts) ----------

  /**
   * Start this enemy on its way in instead of at its post. The trajectory, the
   * parachute and the touchdown live in `arrival.ts`, which drives this body
   * through the `ArrivalBody` interface.
   */
  beginArrival(
    mode: 'drop' | 'run' | 'fly' | 'swim',
    from: THREE.Vector3,
    target: THREE.Vector3,
    opts: { chute?: boolean; velocity?: THREE.Vector3 } = {},
  ): void {
    beginArrival(this, mode, from, target, opts);
  }

  /** true while this enemy is still on its way in */
  get arriving(): boolean { return this.arrival !== null; }

  /**
   * Keep this body readable against the sky (src/fx/skyline.ts).
   *
   * Only bodies actually up in the air get one, which is why the ground probe
   * decides it: an enemy standing on a platform has that platform directly
   * underneath and is not skylined, while the same enemy twenty metres over it
   * is. The probe is a surface query, so it runs a few times a second on a
   * per-enemy stagger rather than every frame, and the level it produces is
   * eased into so a body crossing a rooftop does not blink.
   */
  private updateHalo(dt: number, game: Game): void {
    this.haloProbe -= dt;
    if (this.haloProbe <= 0) {
      this.haloProbe = 0.2 + (this.id % 5) * 0.02;
      const ground = game.board.physics.groundHeight(this.position.x, this.position.z, this.position.y + 0.4);
      const skylined = this.alive ? haloStrength(this.position.y - ground) : 0;
      // Re-read the body until it has been read: the authored sculpt swaps in
      // a beat after the procedural build, and it is the one that will be
      // looked at. Textures are averaged once and remembered, so this settles
      // to a walk over a handful of materials.
      this.haloTone ??= skylineTone(game.board);
      this.haloBody ??= bodyLuma(this.char.root);
      this.haloLevel = skylined * contrastNeed(this.haloTone, this.haloBody);
    }
    if (this.haloLevel <= 0 && !this.halo) return;
    if (!this.halo && this.haloLevel > 0) {
      this.halo = makeHalo(this.haloTone!, this.height);
      this.char.root.add(this.halo);
    }
    const halo = this.halo!;
    const want = this.haloLevel * haloPeak(this.haloTone!);
    const mat = halo.material as THREE.SpriteMaterial;
    mat.opacity = damp(mat.opacity, want, 4, dt);
    halo.visible = mat.opacity > 0.01;
  }

  syncVisual(dt: number, game: Game): void {
    // a ragdolled corpse is placed entirely by the solver — it writes the root
    // and every bone itself, so syncVisual must keep its hands off
    if (this.ragdoll) return;
    this.char.root.position.copy(this.position);
    this.char.root.rotation.y = this.facingYaw;
    if (this.kind === 'nikto') {
      this.char.root.rotation.z = clamp(-this.velocity.x * Math.cos(this.facingYaw) * 0.03 + this.velocity.z * Math.sin(this.facingYaw) * 0.03, -0.5, 0.5);
    }
    // creatures that animate themselves need to know how fast they're going
    this.updateHalo(dt, game);
    this.char.setGait?.(this.alive ? Math.hypot(this.velocity.x, this.velocity.z) : 0);
    this.char.cosmetic?.(dt, game.time);
    // Hit flash: a brief scale pop, multiplied into the species bulk rather
    // than written over it. Overwriting meant every scaled enemy (dark trooper
    // 1.15, death trooper 1.08, pirate 1.05) lost its bulk on the first frame
    // in game and rendered smaller than its own hit spheres.
    const base = this.char.baseScale;
    this.char.root.scale.setScalar(this.kind === 'nikto' ? base : base * (1 + this.hitFlash * 0.6));
    if (this.boss) this.applyBossTint(game.time);
  }

  /**
   * The boss's damage read: the body flashes red when a hit lands and pale
   * blue-white when one is turned aside, on the emissive channel so it shows
   * against any lighting. Materials are adopted lazily — cloned the first
   * time this boss needs to tint them — which keeps the flash off the shared
   * material cache and automatically picks up an authored model that swaps
   * in after promotion, since its fresh materials get adopted on the next
   * flash. Restore happens exactly once when both timers run out.
   */
  private applyBossTint(time: number): void {
    const hurt = Math.min(1, this.bossHurtT / 0.3);
    const parry = Math.min(1, this.bossParryT / 0.25);
    // Enraged, the body holds a red glow that breathes slowly — the last
    // phase used to be announced by the banner and by nothing on the boss
    const rage = this.enraged ? 0.26 + 0.1 * Math.sin(time * 4.5) : 0;
    if (hurt <= 0 && parry <= 0 && rage <= 0) {
      if (this.tintOn) {
        for (const [m, rest] of this.tintedMats) m.emissive.copy(rest);
        this.tintOn = false;
      }
      return;
    }
    this.tintOn = true;
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (let i = 0; i < mats.length; i++) {
        let m = mats[i] as THREE.MeshStandardMaterial;
        if (!m || !('emissive' in m)) continue;   // basic/additive FX materials sit out
        if (!this.tintedMats.has(m)) {
          const c = markOwned(m.clone()) as THREE.MeshStandardMaterial;
          if (Array.isArray(mesh.material)) (mesh.material as THREE.Material[])[i] = c;
          else mesh.material = c;
          this.tintedMats.set(c, c.emissive.clone());
          m = c;
        }
        const rest = this.tintedMats.get(m)!;
        m.emissive.setRGB(
          Math.min(1, rest.r + hurt * 0.85 + parry * 0.45 + rage),
          Math.min(1, rest.g + hurt * 0.06 + parry * 0.65 + rage * 0.08),
          Math.min(1, rest.b + hurt * 0.04 + parry * 0.85 + rage * 0.02),
        );
      }
    });
  }
}
