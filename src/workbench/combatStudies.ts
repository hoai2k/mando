import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';
import { counterweightTracks } from '../anim/counterweight';
import { spearTestClips } from './spearTests';

/** Original game clips stay intact. Each study is a separate workbench clip. */
export interface Alternate {
  id: string;
  name: string;
  lower: string;
  upper: string;
  reference: 'spear' | 'staff' | 'saber' | 'close';
}

const spear: Alternate[] = [
  { id: 'spearTest1', name: 'Fixed-foot thrust', lower: 'spearTest1Lower', upper: 'spearTest1Upper', reference: 'spear' },
  { id: 'spearTest2', name: 'Long lunge thrust', lower: 'spearTest2Lower', upper: 'spearTest2Upper', reference: 'spear' },
  { id: 'spearTest3', name: 'Deflect → thrust', lower: 'spearTest3Lower', upper: 'spearTest3Upper', reference: 'spear' },
];

export const ATTACK_ALTERNATES: Record<string, Alternate[]> = {
  melee1: spear,
  melee2: [
    { id: 'staffReturn', name: 'Butt-end return', lower: 'staffReturnLower', upper: 'staffReturnUpper', reference: 'staff' },
    { id: 'staffRise', name: 'Low rising sweep', lower: 'staffRiseLower', upper: 'staffRiseUpper', reference: 'staff' },
  ],
  melee3: [
    { id: 'staffDrop', name: 'Two-hand descending blow', lower: 'staffDropLower', upper: 'staffDropUpper', reference: 'staff' },
    { id: 'staffDiagonal', name: 'Diagonal step and strike', lower: 'staffDiagonalLower', upper: 'staffDiagonalUpper', reference: 'staff' },
  ],
  saber1: [
    { id: 'saberLunge', name: 'Right-point lunge', lower: 'saberLungeLower', upper: 'saberLungeUpper', reference: 'saber' },
    { id: 'saberDraw', name: 'Right draw-cut', lower: 'saberDrawLower', upper: 'saberDrawUpper', reference: 'saber' },
  ],
  saber2: [
    { id: 'saberParry', name: 'Left parry and return', lower: 'saberParryLower', upper: 'saberParryUpper', reference: 'saber' },
    { id: 'saberOblique', name: 'Left oblique cut', lower: 'saberObliqueLower', upper: 'saberObliqueUpper', reference: 'saber' },
  ],
  saber3: [
    { id: 'saberCross', name: 'Cross then open', lower: 'saberCrossLower', upper: 'saberCrossUpper', reference: 'saber' },
    { id: 'saberDouble', name: 'Twin point finish', lower: 'saberDoubleLower', upper: 'saberDoubleUpper', reference: 'saber' },
  ],
  enemySwing: [
    { id: 'enemyShort', name: 'Compact counterstrike', lower: 'enemyShortLower', upper: 'enemyShortUpper', reference: 'close' },
    { id: 'enemyDrive', name: 'Committed driving strike', lower: 'enemyDriveLower', upper: 'enemyDriveUpper', reference: 'close' },
  ],
};

export type CombatStyle = 'measured' | 'heavy' | 'agile' | 'mechanical' | 'hunter';
const STYLE: Record<string, CombatStyle> = {
  din: 'measured', paz: 'heavy', bokatan: 'agile', armorer: 'heavy',
  ventress: 'agile', jedi: 'measured', maul: 'agile', revan: 'measured', embo: 'agile', bossk: 'hunter', duelist: 'measured', ig11: 'mechanical',
  tusken: 'hunter', pirateMelee: 'heavy', alamite: 'hunter', officer: 'measured', enforcer: 'heavy',
  droid: 'mechanical', darktrooper: 'mechanical', escortDroid: 'mechanical',
  fennec: 'agile', marshal: 'measured', gunslinger: 'measured',
};
export const combatStyle = (id: string): CombatStyle => STYLE[id] ?? 'measured';
const pace: Record<CombatStyle, number> = { measured: 1, heavy: 1.18, agile: 0.84, mechanical: 1.05, hunter: 1.08 };
const weight: Record<CombatStyle, number> = { measured: 1, heavy: 1.18, agile: 0.88, mechanical: 1.06, hunter: 1.08 };

type A = [number, number, number];
type Bone = 'chest' | 'head' | 'upperArmR' | 'forearmR' | 'handR' | 'upperArmL' | 'forearmL' | 'handL'
  | 'hips' | 'spine' | 'upperLegR' | 'lowerLegR' | 'upperLegL' | 'lowerLegL' | 'footR' | 'footL';
type Angles = Partial<Record<Bone, A[]>>;
interface Move {
  id: string;
  duration: number;
  times?: number[];
  upper: Angles;
  lower?: Angles;
  step?: 'still' | 'forward' | 'pivot' | 'low' | 'kick';
}

const qtrack = (bone: string, times: number[], angles: A[]): THREE.QuaternionKeyframeTrack => {
  const values = angles.flatMap(([x, y, z]) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180,
    ));
    return [q.x, q.y, q.z, q.w];
  });
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
};
const vtrack = (bone: string, times: number[], positions: A[]): THREE.VectorKeyframeTrack =>
  new THREE.VectorKeyframeTrack(`${bone}.position`, times, positions.flat());

/** Five readable beats: guard, preparation, contact, extension, recovery. */
const DEFAULT_TIMES = [0, 0.28, 0.53, 0.7, 1];

function addMove(clips: ClipSet, move: Move, p: Proportions, style: CombatStyle): void {
  const duration = move.duration * pace[style] * (move.id.startsWith('unarmed') ? 1 : 0.5);
  const times = (move.times ?? DEFAULT_TIMES).map((t) => t * duration);
  const power = weight[style];
  const scaled = (bone: Bone, poses: A[]): A[] => poses.map((v, i) => {
    if (i < 2 || i === poses.length - 1) return v;
    // Vary the committed part of the motion by character without changing its guard.
    return bone === 'chest' || bone === 'hips'
      ? [v[0] * power, v[1] * power, v[2] * power]
      : [v[0], v[1] * power, v[2] * power];
  });
  const upper = Object.entries(move.upper)
    .filter(([bone]) => !move.id.startsWith('staff') || (bone !== 'upperArmL' && bone !== 'forearmL'))
    .map(([bone, poses]) =>
    qtrack(bone, times, scaled(bone as Bone, poses)));
  if (move.id.startsWith('staff'))
    upper.push(...counterweightTracks(`${move.id}Upper`, times));
  clips[`${move.id}Upper`] = new THREE.AnimationClip(`${move.id}Upper`, duration, upper);

  const lowerAngles = move.lower ?? lowerStep(move.step ?? 'still', power);
  const lower = Object.entries(lowerAngles).map(([bone, poses]) =>
    qtrack(bone, times, scaled(bone as Bone, poses)));
  const z = move.step === 'forward' ? 0.09 : move.step === 'kick' ? 0.025 : 0.035;
  const dip = move.step === 'low' ? 0.12 : move.step === 'forward' ? 0.09 : 0.055;
  lower.unshift(vtrack('hips', times, [
    [0, p.hipHeight - 0.025, 0], [0, p.hipHeight - 0.045, 0],
    [0, p.hipHeight - dip * power, z], [0, p.hipHeight - dip * power, z],
    [0, p.hipHeight - 0.025, 0],
  ]));
  clips[`${move.id}Lower`] = new THREE.AnimationClip(`${move.id}Lower`, duration, lower);
}

function lowerStep(kind: NonNullable<Move['step']>, power: number): Angles {
  const lunge = kind === 'forward' ? 38 : kind === 'low' ? 32 : kind === 'kick' ? 24 : 20;
  const rear = kind === 'pivot' ? 22 : 12;
  return {
    hips: [[3, -10, 0], [4, -14, 0], [7, kind === 'pivot' ? 20 : 8, 0], [7, 8, 0], [3, -10, 0]],
    upperLegL: [[-16, 0, 5], [-20, 0, 5], [-lunge * power, 0, 5], [-lunge * power, 0, 5], [-16, 0, 5]],
    lowerLegL: [[20, 0, 0], [25, 0, 0], [lunge * power, 0, 0], [lunge * power, 0, 0], [20, 0, 0]],
    upperLegR: [[10, 0, -5], [12, 0, -5], [rear * power, 0, -5], [rear * power, 0, -5], [10, 0, -5]],
    lowerLegR: [[15, 0, 0], [16, 0, 0], [21, 0, 0], [21, 0, 0], [15, 0, 0]],
  };
}

/** Enemy equipment changes the contact silhouette, beyond cadence and mass. */
function enemyMove(move: Move, character: string): Move {
  if (!move.id.startsWith('enemy')) return move;
  const club = ['tusken', 'pirateMelee', 'alamite', 'officer'].includes(character);
  if (club) return move;
  const droid = ['droid', 'darktrooper', 'escortDroid', 'ig11', 'enforcer'].includes(character);
  if (droid) return {
    ...move, step: move.id === 'enemyDrive' ? 'forward' : 'still',
    upper: {
      chest: [[1, -9, 0], [1, -12, 0], [3, 7, 0], [3, 7, 0], [1, -9, 0]],
      upperArmR: [[-64, -18, -12], [-76, -19, -11], [-105, 2, -5], [-105, 2, -5], [-64, -18, -12]],
      forearmR: [[-65, 0, 0], [-50, 0, 0], [-5, 0, 0], [-5, 0, 0], [-65, 0, 0]],
      upperArmL: [[-62, 18, 12], [-67, 20, 12], [move.id === 'enemyDrive' ? -100 : -63, 8, 10],
        [move.id === 'enemyDrive' ? -100 : -63, 8, 10], [-62, 18, 12]],
      forearmL: [[-62, -8, -9], [-59, -8, -9], [move.id === 'enemyDrive' ? -6 : -58, -8, -9],
        [move.id === 'enemyDrive' ? -6 : -58, -8, -9], [-62, -8, -9]],
    },
  };
  // A ranged trooper uses the weapon already in hand: short stock jab or
  // two-handed stock shove, keeping the muzzle away from the face.
  return {
    ...move, step: move.id === 'enemyDrive' ? 'forward' : 'pivot',
    upper: {
      chest: [[2, -15, 0], [3, -23, 0], [8, 12, 0], [8, 12, 0], [2, -15, 0]],
      upperArmR: [[-69, -14, -11], [-77, -20, -10], [-88, 10, -5], [-88, 10, -5], [-69, -14, -11]],
      forearmR: [[-51, 0, 0], [-53, 0, 0], [-26, 0, 0], [-26, 0, 0], [-51, 0, 0]],
      upperArmL: [[-75, 27, 12], [-79, 33, 10], [-91, 10, 8], [-91, 10, 8], [-75, 27, 12]],
      forearmL: [[-58, -17, -23], [-59, -17, -23], [-40, -12, -18], [-40, -12, -18], [-58, -17, -23]],
    },
  };
}

function unarmedMove(move: Move, style: CombatStyle): Move {
  if (!move.id.startsWith('unarmed')) return move;
  if (style === 'hunter') return {
    ...move,
    upper: {
      ...move.upper,
      handR: [[-15, 0, 0], [-24, 0, 0], [-29, 0, 0], [-29, 0, 0], [-15, 0, 0]],
      handL: [[-15, 0, 0], [-24, 0, 0], [-29, 0, 0], [-29, 0, 0], [-15, 0, 0]],
    },
  };
  if (style === 'mechanical' && move.upper.chest) return {
    ...move,
    upper: { ...move.upper, chest: move.upper.chest.map(([x, y, z]) => [x * 0.6, y * 0.45, z]) },
  };
  return move;
}

const moves: Move[] = [
  // Staff and gaderffii: both ends stay available, with a body step under impact.
  { id: 'staffReturn', duration: 0.8, step: 'pivot', upper: {
    chest: [[2, 21, 0], [2, 35, 0], [4, -25, 0], [4, -28, 0], [2, 21, 0]],
    upperArmR: [[-65, 32, -9], [-68, 48, -9], [-83, -35, 8], [-84, -39, 8], [-65, 32, -9]],
    forearmR: [[-25, 0, 0], [-30, 0, 0], [-55, 0, 0], [-58, 0, 0], [-25, 0, 0]],
    upperArmL: [[-65, 20, 15], [-75, 12, 15], [-72, -25, 20], [-72, -25, 20], [-65, 20, 15]],
    forearmL: [[-48, -15, -20], [-44, -15, -20], [-34, -12, -18], [-34, -12, -18], [-48, -15, -20]],
  } },
  { id: 'staffRise', duration: 0.86, step: 'low', upper: {
    chest: [[11, -19, 0], [18, -22, 0], [-5, 18, 0], [-8, 20, 0], [11, -19, 0]],
    upperArmR: [[-42, -32, 12], [-30, -40, 12], [-112, 25, -5], [-115, 27, -5], [-42, -32, 12]],
    forearmR: [[-55, 0, 0], [-64, 0, 0], [-22, 0, 0], [-20, 0, 0], [-55, 0, 0]],
    upperArmL: [[-59, 12, 18], [-46, 9, 20], [-86, 17, 12], [-87, 17, 12], [-59, 12, 18]],
    forearmL: [[-48, -16, -20], [-55, -16, -20], [-34, -14, -18], [-34, -14, -18], [-48, -16, -20]],
  } },
  { id: 'staffDrop', duration: 0.96, step: 'forward', upper: {
    chest: [[-13, 0, 0], [-21, 0, 0], [22, 0, 0], [24, 0, 0], [-13, 0, 0]],
    upperArmR: [[-133, 0, 12], [-156, 0, 12], [-50, 0, 4], [-46, 0, 4], [-133, 0, 12]],
    forearmR: [[-68, 0, 0], [-78, 0, 0], [-8, 0, 0], [-8, 0, 0], [-68, 0, 0]],
    upperArmL: [[-122, 0, -15], [-143, 0, -18], [-67, 0, 13], [-63, 0, 13], [-122, 0, -15]],
    forearmL: [[-59, -10, -12], [-65, -10, -12], [-18, -8, -10], [-18, -8, -10], [-59, -10, -12]],
  } },
  { id: 'staffDiagonal', duration: 0.92, step: 'forward', upper: {
    chest: [[-9, -23, 0], [-16, -35, 0], [19, 25, 0], [18, 28, 0], [-9, -23, 0]],
    upperArmR: [[-135, -20, 13], [-156, -31, 14], [-49, 29, 3], [-45, 32, 3], [-135, -20, 13]],
    forearmR: [[-66, 0, 0], [-75, 0, 0], [-9, 0, 0], [-9, 0, 0], [-66, 0, 0]],
    upperArmL: [[-112, 22, -12], [-134, 27, -17], [-64, -22, 16], [-64, -22, 16], [-112, 22, -12]],
    forearmL: [[-57, -10, -12], [-66, -10, -12], [-17, -8, -10], [-17, -8, -10], [-57, -10, -12]],
  } },
  // Twin short blades: one blade protects the line as the other reaches.
  { id: 'saberLunge', duration: 0.66, step: 'forward', upper: {
    chest: [[2, -18, 0], [2, -22, 0], [4, 10, 0], [4, 10, 0], [2, -18, 0]],
    upperArmR: [[-73, -22, -7], [-78, -24, -7], [-101, 2, -5], [-103, 2, -5], [-73, -22, -7]],
    forearmR: [[-42, 0, 0], [-31, 0, 0], [-7, 0, 0], [-7, 0, 0], [-42, 0, 0]],
    upperArmL: [[-69, 26, 18], [-75, 32, 18], [-67, 29, 20], [-67, 29, 20], [-69, 26, 18]],
    forearmL: [[-49, -14, -18], [-46, -14, -18], [-38, -14, -18], [-38, -14, -18], [-49, -14, -18]],
  } },
  { id: 'saberDraw', duration: 0.72, step: 'pivot', upper: {
    chest: [[2, -27, 0], [2, -39, 0], [4, 27, 0], [4, 31, 0], [2, -27, 0]],
    upperArmR: [[-80, -42, 15], [-97, -51, 19], [-61, 49, -6], [-58, 53, -6], [-80, -42, 15]],
    forearmR: [[-67, 0, 0], [-71, 0, 0], [-12, 0, 0], [-10, 0, 0], [-67, 0, 0]],
    upperArmL: [[-65, 30, 20], [-70, 38, 22], [-75, 18, 15], [-75, 18, 15], [-65, 30, 20]],
    forearmL: [[-43, -15, -18], [-46, -15, -18], [-42, -18, -22], [-42, -18, -22], [-43, -15, -18]],
  } },
  { id: 'saberParry', duration: 0.74, step: 'pivot', upper: {
    chest: [[2, 18, 0], [2, 27, 0], [3, -22, 0], [3, -25, 0], [2, 18, 0]],
    upperArmL: [[-78, 29, 16], [-92, 50, 16], [-83, -40, 18], [-81, -43, 18], [-78, 29, 16]],
    forearmL: [[-58, -12, -12], [-71, -10, -11], [-17, -19, -19], [-15, -19, -19], [-58, -12, -12]],
    upperArmR: [[-64, -20, -12], [-69, -23, -12], [-75, -16, -12], [-75, -16, -12], [-64, -20, -12]],
    forearmR: [[-42, 0, 0], [-42, 0, 0], [-38, 0, 0], [-38, 0, 0], [-42, 0, 0]],
  } },
  { id: 'saberOblique', duration: 0.69, step: 'forward', upper: {
    chest: [[2, 25, 0], [2, 38, 0], [5, -25, 0], [5, -27, 0], [2, 25, 0]],
    upperArmL: [[-84, 31, 12], [-99, 44, 15], [-58, -48, 40], [-55, -50, 42], [-84, 31, 12]],
    forearmL: [[-62, -11, -11], [-73, -11, -11], [-13, -19, -18], [-11, -19, -18], [-62, -11, -11]],
    upperArmR: [[-64, -25, -10], [-73, -31, -10], [-71, -16, -12], [-71, -16, -12], [-64, -25, -10]],
    forearmR: [[-43, 0, 0], [-45, 0, 0], [-39, 0, 0], [-39, 0, 0], [-43, 0, 0]],
  } },
  { id: 'saberCross', duration: 0.9, step: 'low', upper: {
    chest: [[-6, 0, 0], [-17, 0, 0], [8, 0, 0], [13, 0, 0], [-6, 0, 0]],
    upperArmR: [[-73, 34, -9], [-84, 50, -12], [-73, -18, 18], [-60, -51, 20], [-73, 34, -9]],
    forearmR: [[-65, 0, 0], [-78, 0, 0], [-34, 0, 0], [-11, 0, 0], [-65, 0, 0]],
    upperArmL: [[-73, -34, 9], [-84, -50, 12], [-73, 18, 18], [-60, 51, 28], [-73, -34, 9]],
    forearmL: [[-65, -10, -10], [-78, -10, -10], [-34, -16, -17], [-11, -16, -17], [-65, -10, -10]],
  } },
  { id: 'saberDouble', duration: 0.81, step: 'forward', upper: {
    chest: [[1, -7, 0], [1, -10, 0], [8, 5, 0], [8, 5, 0], [1, -7, 0]],
    upperArmR: [[-69, -23, -10], [-78, -29, -10], [-101, -9, -6], [-102, -9, -6], [-69, -23, -10]],
    forearmR: [[-58, 0, 0], [-51, 0, 0], [-8, 0, 0], [-8, 0, 0], [-58, 0, 0]],
    upperArmL: [[-69, 23, 10], [-78, 29, 10], [-101, 9, 6], [-102, 9, 6], [-69, 23, 10]],
    forearmL: [[-58, -10, -10], [-51, -10, -10], [-8, -10, -10], [-8, -10, -10], [-58, -10, -10]],
  } },
  // Enemy strikes vary by mass and equipment through style and weapon family.
  { id: 'enemyShort', duration: 0.7, step: 'pivot', upper: {
    chest: [[2, -12, 0], [2, -19, 0], [8, 18, 0], [8, 18, 0], [2, -12, 0]],
    upperArmR: [[-73, -20, 8], [-81, -29, 9], [-67, 27, -5], [-67, 27, -5], [-73, -20, 8]],
    forearmR: [[-56, 0, 0], [-64, 0, 0], [-18, 0, 0], [-18, 0, 0], [-56, 0, 0]],
    upperArmL: [[-56, 16, 12], [-59, 16, 12], [-66, 8, 14], [-66, 8, 14], [-56, 16, 12]],
    forearmL: [[-48, -10, -13], [-48, -10, -13], [-40, -10, -13], [-40, -10, -13], [-48, -10, -13]],
  } },
  { id: 'enemyDrive', duration: 0.9, step: 'forward', upper: {
    chest: [[-8, 0, 0], [-19, 0, 0], [22, 0, 0], [25, 0, 0], [-8, 0, 0]],
    upperArmR: [[-115, 0, 12], [-142, 0, 12], [-53, 0, 4], [-49, 0, 4], [-115, 0, 12]],
    forearmR: [[-59, 0, 0], [-73, 0, 0], [-11, 0, 0], [-11, 0, 0], [-59, 0, 0]],
    upperArmL: [[-103, 0, -13], [-127, 0, -17], [-69, 0, 14], [-66, 0, 14], [-103, 0, -13]],
    forearmL: [[-56, -10, -13], [-67, -10, -13], [-19, -10, -13], [-19, -10, -13], [-56, -10, -13]],
  } },
  // Unarmed previews: drawn with each character's mass and cadence, no weapon.
  { id: 'unarmedJab', duration: 0.66, step: 'forward', upper: {
    chest: [[1, -13, 0], [1, -17, 0], [3, 9, 0], [3, 9, 0], [1, -13, 0]],
    upperArmL: [[-62, 15, 16], [-69, 13, 14], [-97, 1, 6], [-95, 1, 6], [-62, 15, 16]],
    forearmL: [[-69, -8, -9], [-57, -8, -9], [-9, -8, -9], [-11, -8, -9], [-69, -8, -9]],
    upperArmR: [[-62, -15, -16], [-65, -14, -15], [-66, -17, -16], [-66, -17, -16], [-62, -15, -16]],
    forearmR: [[-69, 0, 0], [-69, 0, 0], [-60, 0, 0], [-60, 0, 0], [-69, 0, 0]],
  } },
  { id: 'unarmedCross', duration: 0.75, step: 'pivot', upper: {
    chest: [[1, -24, 0], [2, -37, 0], [5, 24, 0], [5, 27, 0], [1, -24, 0]],
    upperArmR: [[-63, -19, -15], [-70, -27, -13], [-99, 5, -7], [-100, 5, -7], [-63, -19, -15]],
    forearmR: [[-68, 0, 0], [-58, 0, 0], [-8, 0, 0], [-8, 0, 0], [-68, 0, 0]],
    upperArmL: [[-62, 18, 17], [-65, 19, 16], [-65, 22, 16], [-65, 22, 16], [-62, 18, 17]],
    forearmL: [[-68, -8, -9], [-68, -8, -9], [-62, -8, -9], [-62, -8, -9], [-68, -8, -9]],
  } },
  { id: 'unarmedKick', duration: 0.92, step: 'kick', upper: {
    chest: [[3, -8, 0], [9, -11, 0], [-4, 8, 0], [-5, 8, 0], [3, -8, 0]],
    upperArmR: [[-63, -17, -14], [-58, -22, -14], [-65, -14, -14], [-65, -14, -14], [-63, -17, -14]],
    forearmR: [[-68, 0, 0], [-72, 0, 0], [-67, 0, 0], [-67, 0, 0], [-68, 0, 0]],
    upperArmL: [[-62, 17, 14], [-60, 21, 14], [-66, 14, 14], [-66, 14, 14], [-62, 17, 14]],
    forearmL: [[-68, -8, -9], [-72, -8, -9], [-67, -8, -9], [-67, -8, -9], [-68, -8, -9]],
  }, lower: {
    hips: [[2, -8, 0], [6, -10, 0], [-5, 8, 0], [-5, 8, 0], [2, -8, 0]],
    upperLegL: [[-8, 0, 5], [-48, 0, 5], [-100, 0, 5], [-95, 0, 5], [-8, 0, 5]],
    lowerLegL: [[15, 0, 0], [105, 0, 0], [18, 0, 0], [18, 0, 0], [15, 0, 0]],
    upperLegR: [[10, 0, -5], [18, 0, -5], [23, 0, -5], [23, 0, -5], [10, 0, -5]],
    lowerLegR: [[15, 0, 0], [22, 0, 0], [25, 0, 0], [25, 0, 0], [15, 0, 0]],
  } },
];

/** Build only the families that match this character's equipment. */
export function combatStudyClips(
  p: Proportions, character: string, weapons: { staff: boolean; sabers: boolean },
): ClipSet {
  const out: ClipSet = {};
  const style = combatStyle(character);
  if (weapons.staff) Object.assign(out, spearTestClips(p));
  for (const move of moves) {
    if (move.id.startsWith('staff') && !weapons.staff) continue;
    if (move.id.startsWith('saber') && !weapons.sabers) continue;
    addMove(out, unarmedMove(enemyMove(move, character), style), p, style);
  }
  return out;
}

/** The three extra gaderffii hits available to Din's existing combo steps. */
export function dinMeleeVariants(p: Proportions): ClipSet {
  const spear = spearTestClips(p);
  const out: ClipSet = {
    spearTest2Upper: spear.spearTest2Upper,
    spearTest2Lower: spear.spearTest2Lower,
  };
  for (const id of ['staffRise', 'staffDiagonal']) {
    const move = moves.find((candidate) => candidate.id === id)!;
    addMove(out, move, p, combatStyle('din'));
  }
  return out;
}
