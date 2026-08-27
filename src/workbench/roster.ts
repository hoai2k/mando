import type { CharacterInstance } from '../characters/builder';
import { buildMandalorian, MANDO_ROSTER, type MandoId } from '../characters/mandalorians';
import {
  buildDarkTrooper, buildDroid, buildGunfighter, buildIG, buildNikto,
  buildPirate, buildPyke, buildStormtrooper, buildTusken,
} from '../characters/enemies';

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
}

export interface SubjectGroup { label: string; subjects: Subject[]; }

const mando = (id: MandoId): Subject => ({
  id,
  name: MANDO_ROSTER[id].name,
  build: (authored) => buildMandalorian(id, { authored }),
  hasModel: true,
});

const plain = (id: string, name: string, build: () => CharacterInstance): Subject =>
  ({ id, name, build, hasModel: false });

export const GROUPS: SubjectGroup[] = [
  {
    label: 'Playable',
    subjects: [mando('din'), mando('paz')],
  },
  {
    label: 'Allies',
    subjects: [
      plain('ig11', 'IG-11', buildIG),
      plain('marshal', 'Cobb Vanth', () => buildGunfighter('marshal')),
      plain('fennec', 'Fennec Shand', () => buildGunfighter('fennec')),
    ],
  },
  {
    label: 'Enemies',
    subjects: [
      plain('tusken', 'Tusken Raider', buildTusken),
      plain('pyke', 'Pyke Soldier', buildPyke),
      plain('pirate', 'Pirate — blaster', () => buildPirate(false)),
      plain('pirateMelee', 'Pirate — melee', () => buildPirate(true)),
      plain('droid', 'Assassin Droid', buildDroid),
      plain('nikto', 'Nikto Swoop Rider', buildNikto),
      plain('stormtrooper', 'Stormtrooper', () => buildStormtrooper(false)),
      plain('deathtrooper', 'Death Trooper', () => buildStormtrooper(true)),
      plain('darktrooper', 'Dark Trooper', buildDarkTrooper),
    ],
  },
];

export const SUBJECTS: Subject[] = GROUPS.flatMap((g) => g.subjects);
export const findSubject = (id: string): Subject => SUBJECTS.find((s) => s.id === id) ?? SUBJECTS[0];
