import * as THREE from 'three';
import {
  buildMandalorian, MANDO_ROSTER, MELEE_NAMES, RANGED_NAMES,
  type MandoId, type PlayerCharacter,
} from './mandalorians';
import { buildEnemyCharacter, enemyStats, ENEMY_NAME, type EnemyKind } from '../enemies/enemy';
import { ENEMY_MODEL_ID } from './authored';
import type { CharacterInstance } from './builder';
import type { VoiceId } from '../core/audio';

/**
 * The playable roster, across every mode (docs/MODES.md).
 *
 * Wave Battle and Campaign play the Mandalorian/hunter roster; PvP adds the
 * NPCs. A playable NPC is an *adapter*, not a re-implemented character:
 * `buildPlayableNpc` wraps the exact enemy build the wave game spawns — same
 * rig, same authored-model swap, same muzzle — in the PlayerCharacter surface
 * the Player controller expects, and a PlayerProfile supplies the stats the
 * controller used to hard-code for Mandalorians.
 */

/** A playable id: a Mandalorian/hunter id, or 'npc:<enemyKind>'. */
export type PlayableId = string;

export interface PlayerProfile {
  name: string;
  desc: string;
  maxHp: number;
  runSpeed: number;
  sprintSpeed: number;
  /** the jetpack/fuel loop is live only where the in-game version flies */
  canFly: boolean;
  fireCd: number;
  boltDamage: number;
  boltSpeed: number;
  meleeDamage: number;
  meleeFinisher: number;
  meleeKind: 'gaffi' | 'sabers';
  /** null = melee-only fighter (no gun, no ADS, no lock-on) */
  rangedName: string | null;
  meleeName: string;
  /** which blaster report the audio plays */
  blasterVoice: 'carbine' | 'crossbow' | 'longrifle' | 'pistols';
  voice: VoiceId;
  /** PvP: this character leads a squad of AI teammates of this kind */
  squad?: { kind: EnemyKind; count: number };
  radius: number;
  height: number;
}

export interface PlayableDef {
  id: PlayableId;
  profile: PlayerProfile;
  build: () => PlayerCharacter;
  /** authored .glb id for warming, or null when none exists */
  modelId: string | null;
}

const mandoProfile = (id: MandoId): PlayerProfile => {
  const cfg = MANDO_ROSTER[id];
  const melee = cfg.melee ?? 'gaffi';
  const ranged = cfg.ranged ?? 'carbine';
  return {
    name: cfg.name, desc: cfg.desc,
    maxHp: 100, runSpeed: 9.2, sprintSpeed: 14.4, canFly: true,
    fireCd: 0.24, boltDamage: 34, boltSpeed: 75,
    meleeDamage: 32, meleeFinisher: 55,
    meleeKind: melee,
    rangedName: ranged === 'none' ? null : RANGED_NAMES[ranged],
    meleeName: MELEE_NAMES[melee],
    blasterVoice: ranged === 'none' ? 'carbine' : ranged,
    voice: cfg.voice ?? 'mando_m',
    radius: 0.45, height: 1.75,
  };
};

/**
 * PvP stat lanes for the NPC roster (docs/MODES.md §3): skirmishers are
 * ~Mandalorian-fragile but bring a squad; elites carry a signature hook;
 * heavies are melee monsters. Balance is deliberately approximate.
 */
interface NpcTuning {
  desc: string;
  hp: number;
  run: number;
  sprint?: number;
  fly?: boolean;
  fireCd?: number;
  boltDamage?: number;
  boltSpeed?: number;
  melee?: [number, number];
  meleeOnly?: boolean;
  squad?: { kind: EnemyKind; count: number };
  voice: VoiceId;
  blaster?: 'carbine' | 'crossbow' | 'longrifle' | 'pistols';
}

const NPC_TUNING: Partial<Record<EnemyKind, NpcTuning>> = {
  // ---- skirmishers: cheap bodies, real squads ----
  tusken:       { desc: 'A raider of the wastes — and the two cousins who swing beside you.', hp: 100, run: 9.0, melee: [40, 62], meleeOnly: true, squad: { kind: 'tusken', count: 2 }, voice: 'masked' },
  pyke:         { desc: 'Syndicate muscle. Thin blood, thick numbers.', hp: 95, run: 8.8, fireCd: 0.3, boltDamage: 24, squad: { kind: 'pyke', count: 2 }, voice: 'alien_m' },
  pirate:       { desc: 'A gunner with a crew that follows the loudest voice — yours.', hp: 100, run: 8.6, fireCd: 0.28, boltDamage: 26, squad: { kind: 'pirate', count: 2 }, voice: 'masked' },
  pirateMelee:  { desc: 'A brawler and his boarding party. Get close, stay close.', hp: 115, run: 9.2, melee: [42, 66], meleeOnly: true, squad: { kind: 'pirateMelee', count: 2 }, voice: 'masked' },
  stormtrooper: { desc: 'The armour cannot aim, but three of you missing together adds up.', hp: 95, run: 8.8, fireCd: 0.26, boltDamage: 24, squad: { kind: 'stormtrooper', count: 2 }, voice: 'masked' },
  quarren:      { desc: 'A dock hand with a net gun and two mates off the trawler.', hp: 105, run: 8.4, fireCd: 0.5, boltDamage: 20, boltSpeed: 45, squad: { kind: 'quarren', count: 2 }, voice: 'alien_m' },
  alamite:      { desc: 'A cave-dweller and its pack — stone clubs, no manners.', hp: 95, run: 9.6, melee: [38, 58], meleeOnly: true, squad: { kind: 'alamite', count: 2 }, voice: 'masked' },
  krykna:       { desc: 'One spider you steer, three that follow. The nest hunts as one.', hp: 85, run: 10.4, melee: [34, 52], meleeOnly: true, squad: { kind: 'krykna', count: 3 }, voice: 'reptile' },
  nikto:        { desc: 'A swoop rider — the bike flies, and so do you.', hp: 90, run: 9.6, fly: true, fireCd: 0.26, boltDamage: 24, voice: 'alien_m' },
  // ---- elites: one hook each, no squad ----
  deathtrooper: { desc: 'Black armour, better rifle, no backup needed.', hp: 140, run: 9.4, fireCd: 0.22, boltDamage: 30, voice: 'masked', blaster: 'longrifle' },
  darktrooper:  { desc: 'A war droid on thrusters. Slow trigger, heavy bolt, real flight.', hp: 160, run: 8.2, fly: true, fireCd: 0.34, boltDamage: 32, voice: 'droid' },
  jetpirate:    { desc: 'A pirate with a stolen jetpack and everything that implies.', hp: 105, run: 8.8, fly: true, fireCd: 0.28, boltDamage: 25, voice: 'masked' },
  droid:        { desc: 'A security frame: walks slowly, hits like a turret.', hp: 170, run: 6.2, sprint: 9.5, fireCd: 0.5, boltDamage: 40, boltSpeed: 85, voice: 'droid' },
  flametrooper: { desc: 'Short reach, terrible opinions about your cover.', hp: 130, run: 8.6, fireCd: 0.09, boltDamage: 7, boltSpeed: 40, voice: 'masked' },
  officer:      { desc: 'The darksaber does the talking.', hp: 150, run: 9.8, melee: [46, 72], meleeOnly: true, voice: 'masked' },
  capo:         { desc: 'Pyke royalty behind a personal shield-heavy frame.', hp: 160, run: 7.8, fireCd: 0.3, boltDamage: 27, voice: 'alien_m' },
  ringEnforcer: { desc: 'Oxblood plate and a tower shield habit — a walking wall.', hp: 160, run: 7.6, fireCd: 0.32, boltDamage: 28, voice: 'masked' },
  marshal:      { desc: 'The Marshal of Mos Pelgo, quick on the draw.', hp: 120, run: 9.6, fireCd: 0.2, boltDamage: 28, voice: 'mando_m', blaster: 'pistols' },
  fennec:       { desc: 'One shot, one answer. The rifle decides at any range.', hp: 110, run: 9.6, fireCd: 0.9, boltDamage: 65, boltSpeed: 110, voice: 'human_f', blaster: 'longrifle' },
  // ---- heavies: melee monsters ----
  massiff:      { desc: 'Five and a half metres of war beast. You are the pounce now.', hp: 240, run: 11.5, sprint: 15.5, melee: [50, 75], meleeOnly: true, voice: 'reptile' },
  broodmother:  { desc: 'The Crevasse made flesh. Slow, vast, and very final up close.', hp: 300, run: 7.0, melee: [55, 85], meleeOnly: true, voice: 'reptile' },
  enforcer:     { desc: 'A Wookiee gladiator. Doors are a suggestion.', hp: 260, run: 8.4, melee: [52, 80], meleeOnly: true, voice: 'reptile' },
};

/**
 * Wrap an enemy character build in the PlayerCharacter surface. The
 * Mandalorian-only affordances become safe no-ops: NPC models carry their
 * weapon permanently (setWeapon changes nothing), the block shield has no
 * pane (blocking still slows and drains, it just doesn't glow), and flight
 * flames are skipped for the kinds that don't fly.
 */
/**
 * The creature builds (massiff, krykna, broodmother) animate themselves and
 * carry no Animator; the Player controller assumes one. A stub keeps every
 * anim.play/playOnce call site valid while `setGait` does the real work.
 */
function stubAnimator(): NonNullable<CharacterInstance['animator']> {
  return {
    play: () => {},
    playOnce: () => 0.5,
    release: () => {},
    releaseAll: () => {},
    invalidate: () => {},
    update: () => {},
    gaitRate: () => 1,
    stepInterval: () => 0.34,
  } as unknown as NonNullable<CharacterInstance['animator']>;
}

function buildPlayableNpc(kind: EnemyKind): PlayerCharacter {
  const inst = buildEnemyCharacter(kind);
  if (!inst.animator) inst.animator = stubAnimator();
  // shots need a muzzle even for kinds whose build carries none (beasts):
  // a chest-height reference that turns with the body
  let muzzle = inst.muzzle;
  if (!muzzle) {
    muzzle = new THREE.Group();
    muzzle.position.set(0, enemyStats(kind).height * 0.7, 0.5);
    inst.root.add(muzzle);
  }
  return {
    ...inst,
    muzzle,
    gaffi: new THREE.Group(),          // no swap prop: the model owns its weapon
    nozzles: [],
    modelReady: () => true,            // procedural stand-in is fine to show
    setWeapon: () => {},
    setThrust: () => {},
    setHeroLight: () => {},
    setBlock: () => {},
    shieldHit: () => {},
    setTrail: () => {},   // blade trails belong to the saber fighters
  };
}

function npcDef(kind: EnemyKind): PlayableDef {
  const t = NPC_TUNING[kind]!;
  const s = enemyStats(kind);
  const meleeOnly = t.meleeOnly ?? false;
  return {
    id: `npc:${kind}`,
    modelId: ENEMY_MODEL_ID[kind] ?? null,
    build: () => buildPlayableNpc(kind),
    profile: {
      name: ENEMY_NAME[kind],
      desc: t.desc,
      maxHp: t.hp,
      runSpeed: t.run,
      sprintSpeed: t.sprint ?? Math.max(t.run + 4.5, 13),
      canFly: t.fly ?? false,
      fireCd: t.fireCd ?? 0.3,
      boltDamage: t.boltDamage ?? 24,
      boltSpeed: t.boltSpeed ?? 60,
      meleeDamage: t.melee?.[0] ?? 30,
      meleeFinisher: t.melee?.[1] ?? 50,
      meleeKind: 'gaffi',
      rangedName: meleeOnly ? null : ENEMY_NAME[kind] + (t.blaster === 'longrifle' ? ' Rifle' : ' Blaster'),
      meleeName: meleeOnly ? 'Claws & Steel' : 'Rifle Butt',
      blasterVoice: t.blaster ?? 'carbine',
      voice: t.voice,
      squad: t.squad,
      radius: Math.min(s.radius, 0.6),
      height: Math.min(s.height, 2.1),
    },
  };
}

const DEFS = new Map<PlayableId, PlayableDef>();
for (const id of Object.keys(MANDO_ROSTER) as MandoId[]) {
  DEFS.set(id, {
    id,
    modelId: id,
    build: () => buildMandalorian(id),
    profile: mandoProfile(id),
  });
}
for (const kind of Object.keys(NPC_TUNING) as EnemyKind[]) {
  const def = npcDef(kind);
  DEFS.set(def.id, def);
}

/** the roster the wave game and campaign have always had */
export const STANDARD_ROSTER: PlayableId[] = Object.keys(MANDO_ROSTER);
/** PvP: the standard roster plus every playable NPC */
export const PVP_ROSTER: PlayableId[] = [
  ...STANDARD_ROSTER,
  ...(Object.keys(NPC_TUNING) as EnemyKind[]).map((k) => `npc:${k}`),
];

export function playableDef(id: PlayableId): PlayableDef {
  return DEFS.get(id) ?? DEFS.get('din')!;
}

/** authored model id behind a playable, for the prefetcher; null = none */
export function playableModelId(id: PlayableId): string | null {
  return playableDef(id).modelId;
}
