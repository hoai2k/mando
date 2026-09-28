import type { CharacterInstance } from '../characters/builder';
import { BENCHED_MANDO_IDS, buildMandalorian, MANDO_ROSTER, PLAYABLE_MANDO_IDS, type MandoId } from '../characters/mandalorians';
import {
  buildAlamite, buildBroodmother, buildDarkTrooper, buildDroid,
  buildFlametrooper, buildGunfighter, buildGunslinger, buildImperialOfficer, buildInterceptorDrone,
  buildKrykna, buildMassiff, buildNikto, buildPirate, buildPyke, buildPykeCapo,
  buildEscortDroid, buildQuarren, buildRingEnforcer, buildStormtrooper, buildTusken, buildWookieeEnforcer,
} from '../characters/enemies';
import { enemyModel, loadProp } from '../characters/authored';
import type { EnemyKind } from '../enemies/enemy';
import { WEAPON_PROPS } from '../characters/weaponProps';

/**
 * Everything the workbench can put on the turntable, in the order the picker
 * shows it: the playable Mandalorians first, then the rest of the cast.
 */
export interface Subject {
  id: string;
  name: string;
  /** `authored: false` forces the procedural build of a character that has a model */
  build: (authored: boolean) => CharacterInstance;
  /** true when a .glb exists for this character, so the compare view is meaningful */
  hasModel: boolean;
  /** model filename when it differs from the id, e.g. officer -> imperial_officer */
  modelFile?: string;
}

export interface SubjectGroup { label: string; subjects: Subject[]; }

const mando = (id: MandoId): Subject => ({
  id,
  name: MANDO_ROSTER[id].name,
  build: (authored) => buildMandalorian(id, { authored }),
  hasModel: true,
});

/**
 * A non-playable character, by its enemy kind. Whether it has an authored .glb
 * to compare against its procedural build, and under what filename, is the
 * kind's entry in ENEMY_MODELS (characters/authored.ts) — the same table its
 * factory loads the skin by.
 */
const plain = (
  kind: EnemyKind,
  name: string,
  build: (authored: boolean) => CharacterInstance,
): Subject => {
  const model = enemyModel(kind)?.model;
  return { id: kind, name, build, hasModel: !!model, modelFile: model !== kind ? model : undefined };
};

/**
 * Props and creatures: models nothing on the canonical rig drives — weapons,
 * the swoop bike, the massiff. They have no rig and no clips, so the animation
 * picker does nothing for them; they are here to be looked at and measured.
 */
const prop = (id: string, name: string, size: number, axis: 'y' | 'longest' = 'longest'): Subject => ({
  id,
  name,
  hasModel: true,
  build: () => {
    // A prop has no stand-in at all — the group is empty until the file lands —
    // so the workbench holds a progress card over its place, and needs the same
    // "is it here yet" answer every character gives it.
    let settled = false;
    const root = loadProp(id, size, { axis, ground: axis === 'y', onSettle: () => { settled = true; } });
    return { root, rig: null, animator: null, height: size, baseScale: 1, modelReady: () => settled };
  },
});

export const GROUPS: SubjectGroup[] = [
  {
    label: 'Playable',
    subjects: PLAYABLE_MANDO_IDS.map(mando),
  },
  {
    label: 'Benched',
    subjects: [...BENCHED_MANDO_IDS].map(mando),
  },
  {
    label: 'Allies',
    subjects: [
      plain('escortDroid', 'Escort Droid — ally build', (a) => buildEscortDroid(a)),
      plain('marshal', 'Cobb Vanth', (a) => buildGunfighter('marshal', a)),
      plain('fennec', 'Fennec Shand', (a) => buildGunfighter('fennec', a)),
    ],
  },
  {
    label: 'Enemies',
    subjects: [
      plain('tusken', 'Tusken Raider', (a) => buildTusken(a)),
      plain('pyke', 'Pyke Soldier', (a) => buildPyke(a)),
      plain('pirate', 'Pirate — blaster (backup body)', (a) => buildPirate(false, a)),
      plain('pirateMelee', 'Pirate — melee', (a) => buildPirate(true, a)),
      plain('droid', 'Assassin Droid', (a) => buildDroid(a)),
      plain('nikto', 'Nikto Swoop Rider', (a) => buildNikto(a)),
      plain('massiff', 'War Massiff', (a) => buildMassiff(a)),
      plain('stormtrooper', 'Stormtrooper', (a) => buildStormtrooper(false, a)),
      plain('deathtrooper', 'Death Trooper', (a) => buildStormtrooper(true, a)),
      plain('darktrooper', 'Dark Trooper', (a) => buildDarkTrooper(a)),
      plain('gunslinger', 'Guild Gunslinger', (a) => buildGunslinger(a)),
      plain('capo', 'Pyke Capo', (a) => buildPykeCapo(a)),
      plain('enforcer', 'Wookiee Enforcer', (a) => buildWookieeEnforcer(a)),
      plain('officer', 'Imperial Officer', (a) => buildImperialOfficer(a)),
      plain('flametrooper', 'Incinerator Trooper', (a) => buildFlametrooper(a)),
      plain('quarren', 'Quarren Netcaster', (a) => buildQuarren(a)),
      plain('alamite', 'Alamite Charger', (a) => buildAlamite(a)),
      plain('ringEnforcer', 'Ringworld Enforcer', (a) => buildRingEnforcer(a)),
      plain('krykna', 'Krykna', (a) => buildKrykna(a)),
      plain('broodmother', 'Krykna Broodmother', (a) => buildBroodmother(a)),
      plain('drone', 'Interceptor Drone', (a) => buildInterceptorDrone(a)),
    ],
  },
];

GROUPS.push({
  label: 'Props & creatures',
  subjects: [
    prop('massiff', 'Massiff', 1.15, 'y'),
    prop('massiff_static', 'Massiff — unrigged', 1.15, 'y'),
    prop('nikto_swoop', 'Swoop bike', 2.6),
    prop('carbine', 'EE-3 carbine', WEAPON_PROPS.carbine.length),
    prop('gaffi', 'Gaderffii stick', WEAPON_PROPS.gaffi.length),
    prop('enemy_blaster_rifle', 'Infantry blaster rifle', WEAPON_PROPS.enemy_blaster_rifle.length),
    prop('pirate_boarding_club', 'Pirate boarding club', WEAPON_PROPS.pirate_boarding_club.length),
    prop('flame_projector', 'Flame projector', WEAPON_PROPS.flame_projector.length),
    prop('net_launcher', 'Net launcher', WEAPON_PROPS.net_launcher.length),
    prop('alamite_stone_club', 'Alamite stone club', WEAPON_PROPS.alamite_stone_club.length),
    prop('electrostaff', 'Electrostaff', WEAPON_PROPS.electrostaff.length),
  ],
});

export const SUBJECTS: Subject[] = GROUPS.flatMap((g) => g.subjects);
export const findSubject = (id: string): Subject => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
