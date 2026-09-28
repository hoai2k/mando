import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import { halfCycle } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';
import type { Alternate } from './combatStudies';

/**
 * Run-cycle studies: other readings of the run, offered as alternates on the
 * Run pose. None is in the game.
 *
 * All four keep the game run's structure — a 0.6 s cycle, a contact shorter
 * than the flight, hips lowest under the planted foot and highest in the air,
 * arms against the legs and at their widest in the flight — and change what
 * animators change to make a run read faster or heavier: how far the body
 * leans into it (a run leans; a sprint 15-30°), how high the knee drives and
 * the heel kicks up behind, how hard the arms pump, and how much the body
 * rises and falls.
 */

type Deg = [number, number, number];
const D = Math.PI / 180;
const DUR = 0.6;
const RT = [0, 0.15, 0.3, 0.45, 0.6];

const q = (bone: string, times: number[], rots: Deg[]): THREE.QuaternionKeyframeTrack =>
  new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, rots.flatMap(([x, y, z]) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D)).toArray()));
const p = (bone: string, times: number[], at: Deg[]): THREE.VectorKeyframeTrack =>
  new THREE.VectorKeyframeTrack(`${bone}.position`, times, at.flat());

interface RunSpec {
  id: string;
  name: string;
  /** key times of the left leg: contact, down, push-off, knee-drive passing (then contact again at DUR) */
  legT: number[];
  thigh: Deg[];
  shin: Deg[];
  foot: Deg[];
  /** hips pitch forward, spine and chest pitch on top of it: the lean */
  hips: number;
  spine: number;
  chest: number;
  /** hip rise and fall, metres, and how low the whole run carries */
  bob: number;
  crouch: number;
  /** upper arms' swing (forward, back), their splay, and the elbow (forward, back) */
  arm: [number, number];
  splay: number;
  elbow: [number, number];
  /** the shoulders' twist against the stride, and the head held up against the lean */
  twist: number;
  head: number;
  /** a side-to-side sway, for a heavy body */
  roll?: number;
}

function runClips(s: RunSpec, prop: Proportions): THREE.AnimationClip[] {
  const hipY = prop.hipHeight - s.crouch;
  const [c, down, push] = s.legT;
  const thighR = halfCycle(s.legT, s.thigh.map(([x, y, z]) => [x, y, -z] as Deg), DUR);
  const shinR = halfCycle(s.legT, s.shin, DUR);
  const footR = halfCycle(s.legT, s.foot, DUR);
  const legT = [...s.legT, DUR];
  const close = <T>(a: T[]): T[] => [...a, a[0]];
  // lowest under each planted foot, highest in each flight: halfway from the
  // push-off to the other foot's contact
  const flight = (push + DUR / 2) / 2;
  const lower = new THREE.AnimationClip(`${s.id}Lower`, DUR, [
    p('hips', [c, down, flight, down + DUR / 2, flight + DUR / 2, DUR],
      [[0, hipY, 0], [0, hipY - s.bob, 0], [0, hipY + s.bob, 0], [0, hipY - s.bob, 0], [0, hipY + s.bob, 0], [0, hipY, 0]]),
    q('hips', RT, [[s.hips, 0, -3 - (s.roll ?? 0)], [s.hips, 0, 0], [s.hips, 0, 3 + (s.roll ?? 0)], [s.hips, 0, 0], [s.hips, 0, -3 - (s.roll ?? 0)]]),
    q('spine', RT, [[s.spine, 4, 0], [s.spine, 0, 0], [s.spine, -4, 0], [s.spine, 0, 0], [s.spine, 4, 0]]),
    q('upperLegL', legT, close(s.thigh)),
    q('lowerLegL', legT, close(s.shin)),
    q('footL', legT, close(s.foot)),
    q('upperLegR', thighR.times, thighR.rots),
    q('lowerLegR', shinR.times, shinR.rots),
    q('footR', footR.times, footR.rots),
  ]);
  // left leg forward at 0: the right arm forward, the left back; widest in the flight
  const [fwd, back] = s.arm;
  const [eF, eB] = s.elbow;
  const mid = (fwd + back) / 2, eMid = (eF + eB) / 2;
  const upper = new THREE.AnimationClip(`${s.id}Upper`, DUR, [
    q('chest', RT, [[s.chest, -s.twist, 1.5 + (s.roll ?? 0)], [s.chest, 0, 0], [s.chest, s.twist, -1.5 - (s.roll ?? 0)], [s.chest, 0, 0], [s.chest, -s.twist, 1.5 + (s.roll ?? 0)]]),
    q('upperArmR', RT, [[fwd, 0, -s.splay], [mid, 0, -s.splay], [back, 0, -s.splay], [mid, 0, -s.splay], [fwd, 0, -s.splay]]),
    q('forearmR', RT, [[eF, 0, 0], [eMid, 0, 0], [eB, 0, 0], [eMid, 0, 0], [eF, 0, 0]]),
    q('upperArmL', RT, [[back, 0, s.splay], [mid, 0, s.splay], [fwd, 0, s.splay], [mid, 0, s.splay], [back, 0, s.splay]]),
    q('forearmL', RT, [[eB, 0, 0], [eMid, 0, 0], [eF, 0, 0], [eMid, 0, 0], [eB, 0, 0]]),
    q('head', RT, [[s.head, 0, 0], [s.head, 0, 0], [s.head, 0, 0], [s.head, 0, 0], [s.head, 0, 0]]),
  ]);
  return [lower, upper];
}

const RUNS: RunSpec[] = [
  // The athlete: a committed lean from the ankles up, knees driven high in
  // front and heels folded up tight behind, arms pumping hard with the elbows
  // held near square — the body falls forward and the legs catch it.
  {
    id: 'runDrive', name: 'Driving lean — athletic',
    legT: [0, 0.1, 0.2, 0.39],
    thigh: [[-72, 0, 0], [-14, 0, 0], [46, 0, 0], [-10, 0, 0]],
    shin: [[16, 0, 0], [12, 0, 0], [80, 0, 0], [112, 0, 0]],
    foot: [[14, 0, 0], [2, 0, 0], [-20, 0, 0], [-6, 0, 0]],
    hips: 12, spine: 7, chest: 8, bob: 0.055, crouch: 0.02,
    arm: [-48, 42], splay: 16, elbow: [-95, -70], twist: 6, head: -14,
  },
  // Low and ready: hunched over the hips, knees soft, a short quick stride
  // that barely leaves the ground, and both hands held up by the chest as if
  // carrying a weapon — the soldier's advance under fire.
  {
    id: 'runTactical', name: 'Low tactical',
    legT: [0, 0.11, 0.22, 0.41],
    thigh: [[-50, 0, 0], [-10, 0, 0], [34, 0, 0], [-4, 0, 0]],
    shin: [[30, 0, 0], [24, 0, 0], [66, 0, 0], [86, 0, 0]],
    foot: [[10, 0, 0], [0, 0, 0], [-14, 0, 0], [-4, 0, 0]],
    hips: 14, spine: 10, chest: 10, bob: 0.025, crouch: 0.08,
    arm: [-34, -8], splay: 14, elbow: [-100, -88], twist: 3, head: -20,
  },
  // The hero's sprint lean: everything thrown into it — the deepest lean, the
  // longest reach and flight, arms driving from far forward to far behind.
  // The head stays up to keep the eyes on where the body is going.
  {
    id: 'runHero', name: 'Hero sprint lean',
    legT: [0, 0.09, 0.19, 0.38],
    thigh: [[-82, 0, 0], [-16, 0, 0], [52, 0, 0], [-12, 0, 0]],
    shin: [[14, 0, 0], [10, 0, 0], [84, 0, 0], [118, 0, 0]],
    foot: [[16, 0, 0], [2, 0, 0], [-22, 0, 0], [-6, 0, 0]],
    hips: 16, spine: 8, chest: 10, bob: 0.07, crouch: 0.01,
    arm: [-62, 56], splay: 14, elbow: [-100, -55], twist: 8, head: -20,
  },
  // Beskar-heavy: a planted, weighty jog — a longer contact and less flight,
  // a bigger drop onto each foot, the stance a little wide and the body
  // rolling over each leg, arms swinging out and round rather than pumping.
  {
    id: 'runHeavy', name: 'Heavy armoured jog',
    legT: [0, 0.13, 0.26, 0.43],
    thigh: [[-56, 0, 6], [-12, 0, 6], [36, 0, 6], [-4, 0, 6]],
    shin: [[22, 0, 0], [20, 0, 0], [62, 0, 0], [84, 0, 0]],
    foot: [[10, 0, 0], [0, 0, 0], [-14, 0, 0], [-4, 0, 0]],
    hips: 6, spine: 3, chest: 4, bob: 0.06, crouch: 0.03,
    arm: [-32, 34], splay: 26, elbow: [-62, -40], twist: 5, head: -5, roll: 3,
  },
];

export function runStudyClips(prop: Proportions): ClipSet {
  const out: ClipSet = {};
  for (const s of RUNS) for (const clip of runClips(s, prop)) out[clip.name] = clip;
  return out;
}

export const RUN_ALTERNATES: Alternate[] = RUNS.map((s) => ({
  id: s.id, name: s.name, lower: `${s.id}Lower`, upper: `${s.id}Upper`, reference: 'run',
}));
