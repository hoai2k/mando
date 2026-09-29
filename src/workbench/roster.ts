import type { CharacterInstance } from '../characters/builder';
import { BENCHED_MANDO_IDS, buildMandalorian, MANDO_ROSTER, PLAYABLE_MANDO_IDS, type MandoId } from '../characters/mandalorians';
import {
  buildAlamite, buildBroodmother, buildDarkTrooper, buildDroid,
  buildFlametrooper, buildGunfighter, buildGunslinger, buildImperialOfficer, buildInterceptorDrone,
  buildKrykna, buildKraytDragon, buildKwazelMaw, buildMamacore, buildMassiff, buildMudhorn, buildMythosaur,
  buildNexu, buildNikto, buildPirate, buildPyke, buildPykeCapo, buildRancor, buildRavinak, buildSandworm,
  buildSpiderling, buildZillo,
  buildEscortDroid, buildQuarren, buildRingEnforcer, buildStormtrooper, buildTusken, buildWookieeEnforcer,
} from '../characters/enemies';
import { enemyModel } from '../characters/authored';
import type { EnemyKind } from '../enemies/enemy';
import { VEHICLE_DEFS } from '../game/vehicles';
import type { VehicleSpec } from '../world/board';
import { buildVehicleFigure } from './vehicleFigure';

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
  /**
   * The character this subject plays as, when it is a variant of one — a
   * re-rigged copy of Din is Din for every pose, weapon and grip, and only its
   * file differs.
   */
  character?: string;
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
 * A creature on a rig of its own: it animates itself from a reported ground
 * speed and strikes on its own attack hook, so the picker offers it the
 * creature poses (idle, walk, run, attack) rather than the humanoid clips.
 * Built authored-only — there is no procedural twin worth comparing.
 */
const creature = (id: string, name: string, build: () => CharacterInstance, modelFile?: string): Subject =>
  ({ id, name, hasModel: true, modelFile, build: () => build() });

/**
 * A ride, parked on the turntable with Din in the seat — the same sculpt, seat
 * and grips the game uses, so its seat and hand anchors can be placed by eye
 * (Weapon grips, in edit mode) and exported to `vehicleAnchors.json`.
 */
const vehicle = (kind: VehicleSpec['kind']): Subject => ({
  id: `vehicle:${kind}`,
  name: VEHICLE_DEFS[kind].name,
  hasModel: true,
  modelFile: VEHICLE_DEFS[kind].modelId,
  build: () => buildVehicleFigure(kind),
});

export const GROUPS: SubjectGroup[] = [
  {
    label: 'Playable',
    subjects: PLAYABLE_MANDO_IDS.map(mando),
  },
  {
    label: 'Re-rigged (joint audit)',
    subjects: [{
      // docs/audits/rig-joints.md: the joints the audit calls likely misplaced
      // moved to where the mesh bends, skin untouched — tools/asset-pipeline/rerig.mjs
      id: 'din_rerig', name: 'Din Djarin — re-rigged', character: 'din', modelFile: 'din_rerig', hasModel: true,
      build: (authored) => buildMandalorian('din', { authored, modelFile: 'din_rerig' }),
    }, {
      id: 'duelist_rerig', name: 'Cad Bane — re-rigged', character: 'duelist', modelFile: 'duelist_rerig', hasModel: true,
      build: (authored) => buildMandalorian('duelist', { authored, modelFile: 'duelist_rerig' }),
    }, {
      // docs/audits/geo-joints.md: the joints read off the mesh's volume alone
      // (no bones, no weights), moved where confident — rerig.mjs --source=geo
      id: 'din_rerig_geo', name: 'Din Djarin — re-rigged from geometry', character: 'din', modelFile: 'din_rerig_geo', hasModel: true,
      build: (authored) => buildMandalorian('din', { authored, modelFile: 'din_rerig_geo' }),
    }, {
      id: 'duelist_rerig_geo', name: 'Cad Bane — re-rigged from geometry', character: 'duelist', modelFile: 'duelist_rerig_geo', hasModel: true,
      build: (authored) => buildMandalorian('duelist', { authored, modelFile: 'duelist_rerig_geo' }),
    }],
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
      plain('drone', 'Interceptor Drone', (a) => buildInterceptorDrone(a)),
    ],
  },
];

GROUPS.push({
  label: 'Creatures & vehicles',
  subjects: [
    plain('massiff', 'War Massiff', (a) => buildMassiff(a)),
    plain('krykna', 'Krykna', (a) => buildKrykna(a)),
    plain('broodmother', 'Krykna Broodmother', (a) => buildBroodmother(a)),
    creature('spiderling', 'Krykna Hatchling', buildSpiderling, 'krykna'),
    creature('mudhorn', 'Mudhorn', buildMudhorn),
    creature('ravinak', 'Ravinak', buildRavinak),
    creature('mamacore', 'Mamacore', buildMamacore),
    creature('rancor', 'Rancor', buildRancor),
    creature('kraytDragon', 'Greater Krayt', buildKraytDragon, 'krayt_dragon'),
    creature('mythosaur', 'Mythosaur', buildMythosaur),
    creature('sandworm', 'Dune Worm', buildSandworm),
    creature('zillo', 'Zillo Beast', buildZillo),
    creature('nexu', 'Nexu', buildNexu),
    creature('kwazelMaw', 'Kwazel Maw', buildKwazelMaw, 'kwazel_maw'),
    ...(Object.keys(VEHICLE_DEFS) as VehicleSpec['kind'][]).map(vehicle),
  ],
});

export const SUBJECTS: Subject[] = GROUPS.flatMap((g) => g.subjects);
export const findSubject = (id: string): Subject => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
