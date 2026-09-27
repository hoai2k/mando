import * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';
import { registerGripSpin, type GripSpin } from '../characters/gripSpin';
import type { Alternate } from './combatStudies';

/**
 * Signature saber styles, as workbench alternates.
 *
 * Each fighter's blade work is its own: Maul's wushu staff (Ray Park's cudgel
 * and sword forms, choreographed with Nick Gillard), Ventress's twin-blade
 * Jar'Kai on a Makashi base, Starkiller's reverse-grip Shien from The Force
 * Unleashed, and Maris Brood's tonfa sabers, whose perpendicular grips are
 * made for blocking and spinning.
 *
 * Two kinds of motion carry them. The wrist is keyed on the hand bones for the
 * snap and cock of a cut. Anything a wrist cannot do — a full twirl, a flip
 * into a reverse grip, a tonfa wheeling round its handle — turns the weapon
 * inside the hand through its grip pivot (`registerGripSpin`), so the blade
 * travels and the glove does not corkscrew.
 *
 * Strikes put contact at 45% of the clip, the melee controller's hit frame
 * (player.ts `meleeHitPending`), so any of these could be wired in as-is.
 */

type V3 = [number, number, number];
type Key = V3 | THREE.Quaternion;
const D = Math.PI / 180;
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * An upper arm aimed along `dir` in the chest's frame (+X the fighter's left,
 * +Y up, +Z forward), turned `twist` degrees about itself. Pointing a limb is
 * what choreography describes; three Euler angles are not.
 */
function aim(dir: V3, twist = 0): THREE.Quaternion {
  const q = new THREE.Quaternion().setFromUnitVectors(DOWN, new THREE.Vector3(...dir).normalize());
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(DOWN, twist * D));
}
/** the same aim for the left arm: across the body's midline */
const aimL = (dir: V3, twist = 0): THREE.Quaternion => aim([-dir[0], dir[1], dir[2]], -twist);
/** an Euler key mirrored onto the other side, as `mirrorClip` does it */
const mir = ([x, y, z]: V3): V3 => [x, -y, -z];

function track(bone: string, times: number[], keys: Key[]): THREE.QuaternionKeyframeTrack {
  const values = keys.flatMap((k) => (k instanceof THREE.Quaternion ? k
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(k[0] * D, k[1] * D, k[2] * D))).toArray());
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

interface Spec {
  dur: number;
  /** key times as shares of the clip */
  at: number[];
  bones: Record<string, Key[]>;
  hips?: V3[];
}

function build(name: string, spec: Spec): THREE.AnimationClip {
  const times = spec.at.map((t) => t * spec.dur);
  const tracks: THREE.KeyframeTrack[] = Object.entries(spec.bones).map(([bone, keys]) => {
    if (keys.length !== times.length) throw new Error(`${name}.${bone}: ${keys.length} keys for ${times.length} times`);
    return track(bone, times, keys);
  });
  if (spec.hips) tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, spec.hips.flat()));
  return new THREE.AnimationClip(name, spec.dur, tracks);
}

// ---- stances for the legs ----
type Legs = Record<'upperLegL' | 'lowerLegL' | 'upperLegR' | 'lowerLegR', V3>;
const SET: Legs = { upperLegL: [-14, 0, 5], lowerLegL: [18, 0, 0], upperLegR: [8, 0, -5], lowerLegR: [16, 0, 0] };
const LUNGE: Legs = { upperLegL: [-40, 0, 5], lowerLegL: [44, 0, 0], upperLegR: [24, 0, -6], lowerLegR: [34, 0, 0] };
const WIDE: Legs = { upperLegL: [-22, 0, 14], lowerLegL: [40, 0, 0], upperLegR: [-8, 0, -14], lowerLegR: [38, 0, 0] };
const legs = (...poses: Legs[]): Record<string, Key[]> => ({
  upperLegL: poses.map((p) => p.upperLegL), lowerLegL: poses.map((p) => p.lowerLegL),
  upperLegR: poses.map((p) => p.upperLegR), lowerLegR: poses.map((p) => p.lowerLegR),
});

/** hips at a drop below standing and a shift forward, in metres */
const hipsAt = (p: Proportions, ...drops: Array<[number, number]>): V3[] =>
  drops.map(([down, fwd]) => [0, p.hipHeight - down, fwd]);

interface Study { alt: Alternate; pose: string; upper: THREE.AnimationClip; lower: THREE.AnimationClip; spin?: GripSpin }

function maul(p: Proportions): Study[] {
  const guardL = { upperArmL: [-25, 20, 18] as V3, forearmL: [-105, -12, -12] as V3 };
  const out: Study[] = [];

  // Propeller advance: the staff turns a disc in front of the fist while he
  // walks it in, and the cut comes out of the spin without it stopping.
  {
    const at = [0, 0.15, 0.3, 0.45, 0.62, 1];
    const upper = build('maulPropellerUpper', { dur: 0.8, at, bones: {
      chest: [[5, -18, 0], [6, -14, 0], [7, -4, 0], [9, 18, 0], [8, 12, 0], [5, -12, 0]],
      upperArmR: [aim([-0.12, 0.1, 1]), aim([-0.1, 0.15, 1]), aim([-0.05, 0.18, 1]), aim([0.3, 0.02, 1]), aim([0.25, -0.1, 1]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-18, 0, 0], [-14, 0, 0], [-12, 0, 0], [-8, 0, 0], [-15, 0, 0], [-60, 0, 0]],
      upperArmL: [guardL.upperArmL, guardL.upperArmL, guardL.upperArmL, [-35, 25, 30], [-35, 25, 30], guardL.upperArmL],
      forearmL: [guardL.forearmL, guardL.forearmL, guardL.forearmL, [-85, -12, -12], [-85, -12, -12], guardL.forearmL],
      head: [[0, 14, 0], [0, 12, 0], [0, 6, 0], [0, -12, 0], [0, -8, 0], [0, 10, 0]],
    } });
    const lower = build('maulPropellerLower', { dur: 0.8, at, bones: {
      hips: [[3, -12, 0], [3, -10, 0], [4, -4, 0], [6, 12, 0], [6, 10, 0], [3, -8, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.04, 0.02], [0.08, 0.06], [0.1, 0.09], [0.1, 0.09], [0.03, 0]) });
    out.push({ pose: 'saber1', upper, lower,
      alt: { id: 'maulPropeller', name: 'Propeller advance', lower: lower.name, upper: upper.name, reference: 'staff' },
      spin: { right: [{ about: 'forearm', keys: [[0, 0], [0.1, 90], [0.2, 270], [0.3, 450], [0.45, 630], [0.6, 780], [0.8, 870], [1, 900]] }] } });
  }

  // Both ends: a falling cut with the top blade, then half a turn in the hand
  // and the other blade rises through the same line. One phrase, two hits.
  {
    const at = [0, 0.22, 0.32, 0.45, 0.62, 1];
    const upper = build('maulBothEndsUpper', { dur: 0.72, at, bones: {
      chest: [[4, -32, 0], [8, 28, 0], [6, 10, 0], [4, -26, 0], [4, -24, 0], [5, -12, 0]],
      upperArmR: [aim([-0.6, 0.7, 0.4]), aim([0.15, -0.4, 0.9]), aim([0, -0.4, 0.9]), aim([-0.55, 0.45, 0.7]), aim([-0.6, 0.5, 0.6]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-40, 0, 0], [-10, 0, 0], [-25, 0, 0], [-12, 0, 0], [-18, 0, 0], [-60, 0, 0]],
      handR: [[0, 0, -25], [0, 0, 20], [0, 0, 0], [0, 0, -20], [0, 0, -10], [0, 0, 0]],
      upperArmL: [[-30, 30, 35], [-20, 10, 20], guardL.upperArmL, [-40, 30, 40], [-35, 28, 36], guardL.upperArmL],
      forearmL: [guardL.forearmL, guardL.forearmL, guardL.forearmL, [-70, -12, -12], [-75, -12, -12], guardL.forearmL],
      head: [[0, 18, 0], [0, -12, 0], [0, -4, 0], [0, 14, 0], [0, 12, 0], [0, 10, 0]],
    } });
    const lower = build('maulBothEndsLower', { dur: 0.72, at, bones: {
      hips: [[3, -18, 0], [5, 16, 0], [4, 6, 0], [4, -14, 0], [4, -12, 0], [3, -8, 0]],
      ...legs(SET, WIDE, WIDE, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.12, 0.02], [0.1, 0.03], [0.09, 0.07], [0.09, 0.07], [0.03, 0]) });
    out.push({ pose: 'saber2', upper, lower,
      alt: { id: 'maulBothEnds', name: 'Both ends — fall, turn, rise', lower: lower.name, upper: upper.name, reference: 'staff' },
      spin: { right: [{ about: 'forearm', keys: [[0, 0], [0.22, 0], [0.4, 180], [1, 180]] }] } });
  }

  // Overhead wheel: the staff spins flat above his head, then the spin is
  // dropped into a chop with the whole body behind it. The spin stops a
  // quarter turn on, so the staff lies across the chop rather than hanging at
  // his side, and the recovery turns it the last quarter — half a turn leaves
  // a double blade looking exactly as it started.
  {
    const at = [0, 0.12, 0.3, 0.45, 0.6, 1];
    const upper = build('maulHelicopterUpper', { dur: 0.9, at, bones: {
      chest: [[-4, -8, 0], [-8, -4, 0], [-10, 0, 0], [22, 6, 0], [18, 4, 0], [5, -12, 0]],
      upperArmR: [aim([-0.3, 0.9, 0.2]), aim([-0.15, 1, 0.15]), aim([-0.1, 1, 0.1]), aim([0, -0.35, 1]), aim([0, -0.55, 0.9]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-10, 0, 0], [-5, 0, 0], [-5, 0, 0], [-10, 0, 0], [-20, 0, 0], [-60, 0, 0]],
      upperArmL: [[-40, 30, 40], [-60, 30, 45], [-60, 30, 45], [-30, 10, 25], [-30, 10, 25], guardL.upperArmL],
      forearmL: [[-60, -12, -12], [-50, -12, -12], [-50, -12, -12], [-90, -12, -12], [-95, -12, -12], guardL.forearmL],
      head: [[-15, 0, 0], [-20, 0, 0], [-18, 0, 0], [12, 0, 0], [10, 0, 0], [0, 10, 0]],
    } });
    const lower = build('maulHelicopterLower', { dur: 0.9, at, bones: {
      hips: [[-4, 0, 0], [-6, 0, 0], [-6, 0, 0], [14, 0, 0], [12, 0, 0], [3, -8, 0]],
      ...legs(SET, SET, SET, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.02, 0], [0, -0.02], [0, -0.02], [0.14, 0.1], [0.13, 0.1], [0.03, 0]) });
    out.push({ pose: 'saber3', upper, lower,
      alt: { id: 'maulHelicopter', name: 'Overhead wheel into chop', lower: lower.name, upper: upper.name, reference: 'staff' },
      spin: { right: [{ about: 'forearm', keys: [[0, 0], [0.1, 180], [0.2, 400], [0.32, 630], [0.45, 810], [1, 900]] }] } });
  }

  // Figure eight: the staff wheels down one side, the arm carries it across
  // the front, and it wheels down the other — the flourish he opens fights with.
  {
    const at = [0, 0.25, 0.5, 0.75, 1];
    const upper = build('maulFigureEightUpper', { dur: 1.3, at, bones: {
      chest: [[5, -24, 0], [5, -26, 0], [5, 22, 0], [5, 24, 0], [5, -12, 0]],
      upperArmR: [aim([-0.9, -0.15, 0.45]), aim([-0.85, -0.2, 0.5]), aim([0.55, -0.2, 0.8]), aim([0.5, -0.2, 0.85]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-20, 0, 0], [-20, 0, 0], [-30, 0, 0], [-30, 0, 0], [-60, 0, 0]],
      upperArmL: [guardL.upperArmL, guardL.upperArmL, [-20, 10, 40], [-20, 10, 40], guardL.upperArmL],
      forearmL: [guardL.forearmL, guardL.forearmL, [-80, -12, -12], [-80, -12, -12], guardL.forearmL],
      head: [[0, 20, 0], [0, 18, 0], [0, -14, 0], [0, -12, 0], [0, 10, 0]],
    } });
    const lower = build('maulFigureEightLower', { dur: 1.3, at, bones: {
      hips: [[3, -12, 0], [3, -12, 0], [3, 10, 0], [3, 10, 0], [3, -8, 0]],
      ...legs(SET, SET, SET, SET, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.05, 0], [0.05, 0], [0.05, 0], [0.03, 0]) });
    out.push({ pose: 'flourish', upper, lower,
      alt: { id: 'maulFigureEight', name: 'Figure-eight flourish', lower: lower.name, upper: upper.name, reference: 'staff' },
      spin: { right: [{ about: 'forearm', keys: [[0, 0], [1, 1080]] }] } });
  }
  return out;
}

function ventress(p: Proportions): Study[] {
  const out: Study[] = [];
  const guardR = aim([-0.3, -0.5, 0.8]), guardL = aimL([-0.35, -0.2, 0.9]);

  // Scissor: both blades drawn wide behind the shoulders, then brought across
  // together so they cross in front of her — and snapped apart off the cross.
  {
    const at = [0, 0.22, 0.45, 0.6, 1];
    const upper = build('ventressScissorUpper', { dur: 0.62, at, bones: {
      chest: [[2, 0, 0], [-8, 0, 0], [10, 0, 0], [8, 0, 0], [3, 0, 0]],
      upperArmR: [guardR, aim([-1, 0.15, -0.25]), aim([0.35, 0, 1]), aim([-0.5, 0.05, 0.9]), guardR],
      forearmR: [[-40, 0, 0], [-20, 0, 0], [-6, 0, 0], [-10, 0, 0], [-40, 0, 0]],
      handR: [[0, 0, 0], [30, 0, 0], [-20, 0, 0], [-35, 0, 0], [0, 0, 0]],
      upperArmL: [guardL, aimL([-1, 0.15, -0.25]), aimL([0.35, 0, 1]), aimL([-0.5, 0.05, 0.9]), guardL],
      forearmL: [mir([-40, 0, 0]), mir([-20, 0, 0]), mir([-6, 0, 0]), mir([-10, 0, 0]), mir([-40, 0, 0])],
      handL: [mir([0, 0, 0]), mir([30, 0, 0]), mir([-20, 0, 0]), mir([-35, 0, 0]), mir([0, 0, 0])],
      head: [[0, 0, 0], [-4, 0, 0], [6, 0, 0], [4, 0, 0], [0, 0, 0]],
    } });
    const lower = build('ventressScissorLower', { dur: 0.62, at, bones: {
      hips: [[3, 0, 0], [0, 0, 0], [8, 0, 0], [7, 0, 0], [3, 0, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.02, -0.02], [0.1, 0.08], [0.1, 0.08], [0.03, 0]) });
    out.push({ pose: 'saber1', upper, lower,
      alt: { id: 'ventressScissor', name: 'Scissor — cross and open', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }

  // Serpent: three quick cuts off alternating hands, each driven by the wrist
  // more than the shoulder, finishing on a straight lunge — Makashi precision
  // in both hands at once.
  {
    const at = [0, 0.2, 0.33, 0.45, 0.58, 0.72, 1];
    const upper = build('ventressSerpentUpper', { dur: 0.8, at, bones: {
      chest: [[4, -22, 0], [6, 20, 0], [5, 4, 0], [6, -24, 0], [5, -8, 0], [6, 10, 0], [4, -8, 0]],
      upperArmR: [aim([-0.7, 0.55, 0.45]), aim([0.3, -0.3, 1]), guardR, guardR, guardR, aim([-0.1, 0.02, 1]), guardR],
      forearmR: [[-55, 0, 0], [-10, 0, 0], [-40, 0, 0], [-40, 0, 0], [-40, 0, 0], [-4, 0, 0], [-40, 0, 0]],
      handR: [[30, 0, 0], [-30, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [-10, 0, 0], [0, 0, 0]],
      upperArmL: [guardL, guardL, aimL([-0.7, 0.55, 0.45]), aimL([0.3, -0.3, 1]), guardL, guardL, guardL],
      forearmL: [mir([-40, 0, 0]), mir([-40, 0, 0]), mir([-55, 0, 0]), mir([-10, 0, 0]), mir([-40, 0, 0]), mir([-40, 0, 0]), mir([-40, 0, 0])],
      handL: [mir([0, 0, 0]), mir([0, 0, 0]), mir([30, 0, 0]), mir([-30, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0])],
      head: [[0, 16, 0], [0, -10, 0], [0, 0, 0], [0, 14, 0], [0, 4, 0], [0, -4, 0], [0, 6, 0]],
    } });
    const lower = build('ventressSerpentLower', { dur: 0.8, at, bones: {
      hips: [[3, -14, 0], [4, 12, 0], [3, 2, 0], [4, -14, 0], [3, -4, 0], [6, 6, 0], [3, -6, 0]],
      ...legs(SET, SET, SET, SET, SET, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.04, 0.01], [0.04, 0.01], [0.05, 0.02], [0.05, 0.02], [0.12, 0.1], [0.03, 0]) });
    out.push({ pose: 'saber2', upper, lower,
      alt: { id: 'ventressSerpent', name: 'Serpent — three cuts and a lunge', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }

  // Twin wheels: both blades turned in discs at her sides, opposite ways,
  // then gathered into a crossed guard.
  {
    const at = [0, 0.2, 0.75, 1];
    const low = aim([-0.9, 0.05, 0.4]), lowL = aimL([-0.9, 0.05, 0.4]);
    const upper = build('ventressWheelsUpper', { dur: 1.1, at, bones: {
      chest: [[4, 0, 0], [6, 0, 0], [6, 0, 0], [3, 0, 0]],
      upperArmR: [guardR, low, low, aim([0.2, -0.2, 0.9])],
      forearmR: [[-40, 0, 0], [-12, 0, 0], [-12, 0, 0], [-70, 0, 0]],
      upperArmL: [guardL, lowL, lowL, aimL([0.2, -0.2, 0.9])],
      forearmL: [mir([-40, 0, 0]), mir([-12, 0, 0]), mir([-12, 0, 0]), mir([-70, 0, 0])],
      head: [[0, 0, 0], [4, 0, 0], [4, 0, 0], [0, 0, 0]],
    } });
    const lower = build('ventressWheelsLower', { dur: 1.1, at, bones: {
      hips: [[3, 0, 0], [3, 0, 0], [3, 0, 0], [3, 0, 0]],
      ...legs(SET, WIDE, WIDE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.1, 0], [0.1, 0], [0.03, 0]) });
    out.push({ pose: 'flourish', upper, lower,
      alt: { id: 'ventressWheels', name: 'Twin wheels', lower: lower.name, upper: upper.name, reference: 'saber' },
      spin: {
        right: [{ about: 'forearm', keys: [[0, 0], [0.15, 60], [0.8, 720], [1, 720]] }],
        left: [{ about: 'forearm', keys: [[0, 0], [0.15, -60], [0.8, -720], [1, -720]] }],
      } });
  }
  return out;
}

function starkiller(p: Proportions): Study[] {
  const out: Study[] = [];
  // Both hilts turned end over end in the palm: the blades come out below the
  // little finger and lie back along the forearms.
  const reversed: GripSpin = {
    right: [{ about: 'palm', keys: [[0, 180], [1, 180]] }],
    left: [{ about: 'palm', keys: [[0, 180], [1, 180]] }],
  };
  const stanceR = aim([-0.15, -0.55, 0.8]), stanceL = aimL([-0.45, -0.75, -0.3]);

  // Reverse-grip stance: low, turned side-on, the lead blade trailing back from
  // a fist held in front of the belt — the Force Unleashed ready.
  {
    const at = [0, 0.5, 1];
    const upper = build('starkillerStanceUpper', { dur: 3, at, bones: {
      chest: [[8, -26, 0], [9, -28, 0], [8, -26, 0]],
      head: [[-4, 22, 0], [-4, 20, 0], [-4, 22, 0]],
      upperArmR: [stanceR, aim([-0.15, -0.5, 0.82]), stanceR],
      forearmR: [[-50, 0, 0], [-53, 0, 0], [-50, 0, 0]],
      handR: [[10, 0, 0], [12, 0, 0], [10, 0, 0]],
      upperArmL: [stanceL, aimL([-0.45, -0.72, -0.32]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-28, 0, 0]), mir([-25, 0, 0])],
    } });
    const lower = build('starkillerStanceLower', { dur: 3, at, bones: {
      hips: [[4, -24, 0], [4, -25, 0], [4, -24, 0]],
      ...legs(WIDE, WIDE, WIDE),
    }, hips: hipsAt(p, [0.12, 0], [0.13, 0], [0.12, 0]) });
    out.push({ pose: 'saberIdle', upper, lower, spin: reversed,
      alt: { id: 'starkillerStance', name: 'Reverse-grip stance', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }

  // Reverse sweep: the fist starts at the far shoulder and is thrown out wide;
  // held reversed, the blade trails the hand and sweeps the whole arc behind it.
  {
    const at = [0, 0.25, 0.45, 0.62, 1];
    const upper = build('starkillerSweepUpper', { dur: 0.72, at, bones: {
      chest: [[8, -20, 0], [8, 32, 0], [6, -40, 0], [5, -52, 0], [8, -26, 0]],
      upperArmR: [stanceR, aim([0.7, 0.05, 0.6]), aim([-1, 0.05, 0.35]), aim([-0.8, 0.1, -0.4]), stanceR],
      forearmR: [[-50, 0, 0], [-110, 0, 0], [-12, 0, 0], [-15, 0, 0], [-50, 0, 0]],
      handR: [[10, 0, 0], [30, 0, 0], [-20, 0, 0], [-10, 0, 0], [10, 0, 0]],
      upperArmL: [stanceL, aimL([-0.3, -0.6, -0.5]), aimL([-0.35, -0.45, 0.6]), aimL([-0.4, -0.5, 0.5]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-30, 0, 0]), mir([-35, 0, 0]), mir([-30, 0, 0]), mir([-25, 0, 0])],
      head: [[-4, 18, 0], [-4, -8, 0], [-4, 30, 0], [-4, 36, 0], [-4, 22, 0]],
    } });
    const lower = build('starkillerSweepLower', { dur: 0.72, at, bones: {
      hips: [[4, -18, 0], [4, 20, 0], [5, -30, 0], [5, -38, 0], [4, -24, 0]],
      ...legs(WIDE, WIDE, WIDE, WIDE, WIDE),
    }, hips: hipsAt(p, [0.12, 0], [0.1, 0], [0.16, 0.02], [0.16, 0.02], [0.12, 0]) });
    out.push({ pose: 'saber1', upper, lower, spin: reversed,
      alt: { id: 'starkillerSweep', name: 'Reverse-grip sweep', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }

  // Flip and stab: a forward-grip cut that turns the hilt over in the hand on
  // its way down and finishes as a reversed, downward stab — the grip change
  // is the move. Turned end over end across the palm, the blade has to pass
  // along the forearm and cut through the arm and chest on the way; half a
  // roll about the forearm lands it in the same reverse grip and never does.
  // The blade sits square to his forearm, which is what makes that true.
  {
    const at = [0, 0.25, 0.45, 0.62, 1];
    const upper = build('starkillerFlipUpper', { dur: 0.7, at, bones: {
      chest: [[4, -24, 0], [-4, -30, 0], [18, 12, 0], [16, 10, 0], [8, -20, 0]],
      upperArmR: [aim([-0.4, -0.3, 0.8]), aim([-0.85, 0.45, 0.35]), aim([0, -0.2, 1]), aim([0, -0.35, 0.95]), stanceR],
      forearmR: [[-40, 0, 0], [-35, 0, 0], [-20, 0, 0], [-25, 0, 0], [-50, 0, 0]],
      handR: [[0, 0, 0], [20, 0, 0], [30, 0, 0], [25, 0, 0], [10, 0, 0]],
      upperArmL: [stanceL, stanceL, aimL([-0.5, -0.6, -0.5]), aimL([-0.5, -0.6, -0.5]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-25, 0, 0]), mir([-20, 0, 0]), mir([-20, 0, 0]), mir([-25, 0, 0])],
      head: [[0, 16, 0], [-10, 14, 0], [18, -4, 0], [16, -4, 0], [-4, 20, 0]],
    } });
    const lower = build('starkillerFlipLower', { dur: 0.7, at, bones: {
      hips: [[3, -14, 0], [0, -18, 0], [12, 6, 0], [12, 6, 0], [4, -20, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, WIDE),
    }, hips: hipsAt(p, [0.03, 0], [0.02, -0.02], [0.16, 0.1], [0.16, 0.1], [0.12, 0]) });
    out.push({ pose: 'saber2', upper, lower,
      alt: { id: 'starkillerFlip', name: 'Flip to reverse and stab', lower: lower.name, upper: upper.name, reference: 'saber' },
      spin: { right: [{ about: 'forearm', keys: [[0, 0], [0.18, 0], [0.32, 180], [1, 180]] }] } });
  }

  // Whirlwind: both reversed blades held out to the sides as he turns a full
  // circle on the spot, and settles into the crouch facing where he started.
  {
    const at = [0, 0.12, 0.28, 0.45, 0.62, 0.78, 1];
    const out2 = aim([-1, 0.05, 0.15]), out2L = aimL([-1, 0.05, 0.15]);
    const upper = build('starkillerWhirlUpper', { dur: 0.95, at, bones: {
      chest: [[6, -20, 0], [4, -30, 0], [4, 0, 0], [4, 0, 0], [4, 0, 0], [6, 0, 0], [8, -26, 0]],
      upperArmR: [stanceR, aim([0.4, -0.2, 0.8]), out2, out2, out2, aim([-0.6, -0.4, 0.6]), stanceR],
      forearmR: [[-50, 0, 0], [-100, 0, 0], [-8, 0, 0], [-8, 0, 0], [-8, 0, 0], [-40, 0, 0], [-50, 0, 0]],
      upperArmL: [stanceL, aimL([0.4, -0.2, 0.8]), out2L, out2L, out2L, aimL([-0.6, -0.4, 0.2]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-100, 0, 0]), mir([-8, 0, 0]), mir([-8, 0, 0]), mir([-8, 0, 0]), mir([-40, 0, 0]), mir([-25, 0, 0])],
      head: [[-4, 20, 0], [0, 20, 0], [0, 10, 0], [0, 10, 0], [0, 10, 0], [0, 10, 0], [-4, 22, 0]],
    } });
    // the body turns on the hips a full circle; keys a third of a turn apart
    // so each leg of it interpolates the short way round
    const lower = build('starkillerWhirlLower', { dur: 0.95, at, bones: {
      hips: [[4, -24, 0], [4, -40, 0], [4, 60, 0], [4, 180, 0], [4, 300, 0], [4, 336, 0], [4, 336, 0]],
      ...legs(WIDE, SET, SET, SET, SET, WIDE, WIDE),
    }, hips: hipsAt(p, [0.12, 0], [0.06, 0], [0.04, 0], [0.04, 0], [0.04, 0], [0.14, 0], [0.12, 0]) });
    out.push({ pose: 'saber3', upper, lower, spin: reversed,
      alt: { id: 'starkillerWhirl', name: 'Reverse-grip whirlwind', lower: lower.name, upper: upper.name, reference: 'saber' } });
  }
  return out;
}

function maris(p: Proportions): Study[] {
  const out: Study[] = [];
  const guardR: V3 = [-56, -12, -18], guardFR: V3 = [-68, 18, 0], handIdle: V3 = [8, -16, -10];

  // Spinning jab: the tonfa wheels a turn and a half round its grip as the fist
  // drives straight out, so the blade arrives leading the punch, then turns the
  // last half back to lie along her forearm.
  {
    const at = [0, 0.18, 0.45, 0.62, 1];
    const upper = build('marisJabUpper', { dur: 0.6, at, bones: {
      chest: [[7, -12, 0], [8, -22, 0], [8, 16, 0], [8, 14, 0], [7, -12, 0]],
      upperArmR: [guardR, [-50, -20, -22], aim([-0.12, 0.05, 1]), aim([-0.12, 0, 1]), guardR],
      forearmR: [guardFR, [-95, 18, 0], [-4, 0, 0], [-8, 0, 0], guardFR],
      handR: [handIdle, handIdle, [0, 0, 0], [0, 0, 0], handIdle],
      upperArmL: [mir(guardR), mir(guardR), [-60, 20, 30], [-60, 20, 30], mir(guardR)],
      forearmL: [mir(guardFR), mir(guardFR), mir([-80, 18, 0]), mir([-80, 18, 0]), mir(guardFR)],
      head: [[1, 10, 0], [1, 14, 0], [2, -6, 0], [2, -4, 0], [1, 10, 0]],
    } });
    const lower = build('marisJabLower', { dur: 0.6, at, bones: {
      hips: [[3, -10, 0], [3, -16, 0], [6, 12, 0], [6, 10, 0], [3, -10, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.05, -0.01], [0.1, 0.08], [0.1, 0.08], [0.04, 0]) });
    out.push({ pose: 'saber1', upper, lower,
      alt: { id: 'marisJab', name: 'Spinning jab', lower: lower.name, upper: upper.name, reference: 'saber' },
      spin: { right: [{ about: 'crossGrip', keys: [[0, 0], [0.18, -25], [0.45, 540], [0.7, 720], [1, 720]] }] } });
  }

  // Block, then flip out: the left forearm comes up across her face with the
  // blade lying along it as a shield, and from the block the tonfa is spun
  // half a turn outward to cut, held a beat, and turned home.
  {
    const at = [0, 0.2, 0.34, 0.45, 0.62, 0.85, 1];
    const blockL = aimL([0.25, 0.1, 1]);
    const upper = build('marisFlipOutUpper', { dur: 0.75, at, bones: {
      chest: [[7, -12, 0], [6, 10, 0], [6, 12, 0], [8, -18, 0], [8, -20, 0], [7, -14, 0], [7, -12, 0]],
      upperArmL: [mir(guardR), blockL, blockL, aimL([-0.85, 0.1, 0.5]), aimL([-0.9, 0.1, 0.4]), mir(guardR), mir(guardR)],
      forearmL: [mir(guardFR), mir([-115, 60, 0]), mir([-115, 60, 0]), mir([-10, 0, 0]), mir([-12, 0, 0]), mir(guardFR), mir(guardFR)],
      handL: [mir(handIdle), mir([0, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0]), mir(handIdle), mir(handIdle)],
      upperArmR: [guardR, guardR, guardR, [-50, -10, -30], [-50, -10, -30], guardR, guardR],
      forearmR: [guardFR, guardFR, guardFR, [-80, 18, 0], [-80, 18, 0], guardFR, guardFR],
      head: [[1, 10, 0], [4, -8, 0], [4, -8, 0], [1, 18, 0], [1, 20, 0], [1, 12, 0], [1, 10, 0]],
    } });
    const lower = build('marisFlipOutLower', { dur: 0.75, at, bones: {
      hips: [[3, -10, 0], [2, 8, 0], [2, 8, 0], [5, -14, 0], [5, -16, 0], [3, -10, 0], [3, -10, 0]],
      ...legs(SET, WIDE, WIDE, SET, SET, SET, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.1, -0.02], [0.1, -0.02], [0.06, 0.03], [0.06, 0.03], [0.04, 0], [0.04, 0]) });
    out.push({ pose: 'saber2', upper, lower,
      alt: { id: 'marisFlipOut', name: 'Block, then flip out', lower: lower.name, upper: upper.name, reference: 'saber' },
      spin: { left: [{ about: 'crossGrip', keys: [[0, 0], [0.34, 0], [0.45, -180], [0.62, -180], [0.85, -360], [1, -360]] }] } });
  }

  // Cyclone: arms out, both tonfas wheeling opposite ways, and a full turn of
  // the body through them — close-quarters, everything around her is cut.
  {
    const at = [0, 0.12, 0.28, 0.45, 0.62, 0.8, 1];
    const wideR = aim([-0.85, -0.35, 0.4]), wideL = aimL([-0.85, -0.35, 0.4]);
    const upper = build('marisCycloneUpper', { dur: 0.9, at, bones: {
      chest: [[7, -12, 0], [4, -20, 0], [4, 0, 0], [4, 0, 0], [4, 0, 0], [6, 0, 0], [7, -12, 0]],
      upperArmR: [guardR, wideR, wideR, wideR, wideR, wideR, guardR],
      forearmR: [guardFR, [-80, 0, 0], [-75, 0, 0], [-75, 0, 0], [-75, 0, 0], [-80, 0, 0], guardFR],
      upperArmL: [mir(guardR), wideL, wideL, wideL, wideL, wideL, mir(guardR)],
      forearmL: [mir(guardFR), mir([-80, 0, 0]), mir([-75, 0, 0]), mir([-75, 0, 0]), mir([-75, 0, 0]), mir([-80, 0, 0]), mir(guardFR)],
      head: [[1, 10, 0], [0, 10, 0], [0, 8, 0], [0, 8, 0], [0, 8, 0], [0, 8, 0], [1, 10, 0]],
    } });
    const lower = build('marisCycloneLower', { dur: 0.9, at, bones: {
      hips: [[3, -10, 0], [3, -20, 0], [3, 80, 0], [3, 200, 0], [3, 320, 0], [3, 350, 0], [3, 350, 0]],
      ...legs(SET, WIDE, SET, SET, SET, WIDE, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.12, 0], [0.06, 0], [0.06, 0], [0.06, 0], [0.12, 0], [0.04, 0]) });
    out.push({ pose: 'saber3', upper, lower,
      alt: { id: 'marisCyclone', name: 'Cyclone', lower: lower.name, upper: upper.name, reference: 'saber' },
      spin: {
        right: [{ about: 'crossGrip', keys: [[0, 0], [0.12, -30], [0.8, 1080], [1, 1080]] }],
        left: [{ about: 'crossGrip', keys: [[0, 0], [0.12, 30], [0.8, -1080], [1, -1080]] }],
      } });
  }
  return out;
}

const BUILDERS: Record<string, (p: Proportions) => Study[]> = { maul, ventress, jedi: starkiller, maris };

const built = new Map<string, Study[]>();

/**
 * The character's style clips, built on its own proportions. Clips are fresh
 * per figure, since the workbench edits them in place; the grip spins are
 * keyed by clip name and registered the first time a character is built.
 */
export function styleStudyClips(character: string, p: Proportions): ClipSet {
  const make = BUILDERS[character];
  if (!make) return {};
  const studies = make(p);
  if (!built.has(character)) {
    for (const s of studies) if (s.spin) registerGripSpin(s.upper.name, s.spin);
    built.set(character, studies);
  }
  const clips: ClipSet = {};
  for (const s of studies) {
    clips[s.upper.name] = s.upper;
    clips[s.lower.name] = s.lower;
  }
  return clips;
}

/** Alternates offered on each workbench pose for a character with a style of its own. */
export function styleAlternates(character: string, poseId: string): Alternate[] {
  return (built.get(character) ?? []).filter((s) => s.pose === poseId).map((s) => s.alt);
}
