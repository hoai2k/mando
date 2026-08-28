import type { CharacterInstance } from '../characters/builder';
import { buildMandalorian, MANDO_ROSTER, type MandoId } from '../characters/mandalorians';
import {
  buildAlamite, buildBroodmother, buildDarkTrooper, buildDroid, buildDuelist,
  buildFlametrooper, buildGunfighter, buildIG, buildImperialOfficer, buildInterceptorDrone,
  buildKrykna, buildMassiff, buildNikto, buildPirate, buildPyke, buildPykeCapo,
  buildQuarren, buildRingEnforcer, buildStormtrooper, buildTusken, buildWookieeEnforcer,
} from '../characters/enemies';
import { loadProp } from '../characters/authored';

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
 * A non-playable character. `hasModel` marks the ones with an authored .glb —
 * only those can be compared against their procedural build, and only their
 * factories call the loader, so it has to match `AUTHORED_ENEMY` in
 * `characters/enemies.ts`.
 */
const plain = (
  id: string,
  name: string,
  build: (authored: boolean) => CharacterInstance,
  hasModel = false,
  modelFile?: string,
): Subject => ({ id, name, build, hasModel, modelFile });

/**
 * Props and creatures: models nothing on the canonical rig drives — weapons,
 * the swoop bike, the massiff. They have no rig and no clips, so the animation
 * picker does nothing for them; they are here to be looked at and measured.
 */
const prop = (id: string, name: string, size: number, axis: 'y' | 'longest' = 'longest'): Subject => ({
  id,
  name,
  hasModel: true,
  build: () => ({ root: loadProp(id, size, { axis, ground: axis === 'y' }), rig: null, animator: null, height: size, baseScale: 1 }),
});

export const GROUPS: SubjectGroup[] = [
  {
    label: 'Playable',
    subjects: (Object.keys(MANDO_ROSTER) as MandoId[]).map(mando),
  },
  {
    label: 'Allies',
    subjects: [
      plain('ig11', 'VX-9 — ally build', (a) => buildIG(a), true),
      plain('marshal', 'Cobb Vanth', (a) => buildGunfighter('marshal', a), true),
      plain('fennec', 'Fennec Shand', (a) => buildGunfighter('fennec', a), true),
    ],
  },
  {
    label: 'Enemies',
    subjects: [
      plain('tusken', 'Tusken Raider', (a) => buildTusken(a), true),
      plain('pyke', 'Pyke Soldier', (a) => buildPyke(a), true),
      plain('pirate', 'Pirate — blaster', (a) => buildPirate(false, a), true),
      plain('pirateMelee', 'Pirate — melee', (a) => buildPirate(true, a), true, 'pirate_melee'),
      plain('droid', 'Assassin Droid', (a) => buildDroid(a), true),
      plain('nikto', 'Nikto Swoop Rider', (a) => buildNikto(a), true),
      plain('massiff', 'War Massiff', (a) => buildMassiff(a), true),
      plain('stormtrooper', 'Stormtrooper', (a) => buildStormtrooper(false, a), true),
      plain('deathtrooper', 'Death Trooper', (a) => buildStormtrooper(true, a), true),
      plain('darktrooper', 'Dark Trooper', (a) => buildDarkTrooper(a), true),
      plain('duelist', 'Duelist', (a) => buildDuelist(a), true),
      plain('capo', 'Pyke Capo', (a) => buildPykeCapo(a), true, 'pyke_capo'),
      plain('enforcer', 'Wookiee Enforcer', (a) => buildWookieeEnforcer(a), true, 'wookiee_enforcer'),
      plain('officer', 'Imperial Officer', (a) => buildImperialOfficer(a), true, 'imperial_officer'),
      plain('flametrooper', 'Incinerator Trooper', (a) => buildFlametrooper(a), true),
      plain('quarren', 'Quarren Netcaster', (a) => buildQuarren(a), true),
      plain('alamite', 'Alamite Charger', (a) => buildAlamite(a), true),
      plain('ringEnforcer', 'Ringworld Enforcer', (a) => buildRingEnforcer(a), true, 'ring_enforcer'),
      plain('krykna', 'Krykna', (a) => buildKrykna(a), true),
      plain('broodmother', 'Krykna Broodmother', (a) => buildBroodmother(a), true, 'krykna_brood'),
      plain('drone', 'Interceptor Drone', (a) => buildInterceptorDrone(a), true, 'interceptor_drone'),
    ],
  },
];

GROUPS.push({
  label: 'Props & creatures',
  subjects: [
    prop('massiff', 'Massiff', 1.15, 'y'),
    prop('massiff_static', 'Massiff — unrigged', 1.15, 'y'),
    prop('nikto_swoop', 'Swoop bike', 2.6),
    prop('carbine', 'EE-3 carbine', 0.72),
    prop('gaffi', 'Gaderffii stick', 1.5),
  ],
});

export const SUBJECTS: Subject[] = GROUPS.flatMap((g) => g.subjects);
export const findSubject = (id: string): Subject => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
