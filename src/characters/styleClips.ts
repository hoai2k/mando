import type * as THREE from 'three';
import type { ClipSet } from '../anim/clips';
import type { Proportions } from '../anim/skeleton';
import { aim, aimL, build, hipsAt, legs, LUNGE, mir, SET, WIDE, type V3 } from '../anim/clipKit';
import { registerGripSpin } from './gripSpin';

/**
 * Signature saber styles in play: each fighter's own blade work, drawn at
 * random against their original strikes and flourish.
 *
 * Maul's wushu staff (Ray Park's cudgel and sword forms, choreographed with
 * Nick Gillard), Starkiller's reverse-grip Shien from The Force Unleashed,
 * Maris Brood's tonfa sabers, made for blocking and spinning, and Ventress's
 * twin wheels.
 *
 * Wrists are keyed on the hand bones for the snap of a cut. Anything a wrist
 * cannot do — a full twirl, a reverse grip, a tonfa wheeling round its handle —
 * turns the weapon inside the hand through its grip pivot (`gripSpin.ts`).
 * Strikes put contact at 45% of the clip, the melee controller's hit frame.
 */

export type StyleSlot = 1 | 2 | 3 | 'flourish';
export interface StyleMove {
  id: string;
  name: string;
  /** combo step it can stand in for, or the flourish */
  slot: StyleSlot;
  upper: string;
  lower: string;
  /** the move turns the whole body, so its legs play even under a lunge */
  lowerAlways?: boolean;
}

const MOVES: Record<string, StyleMove[]> = {
  maul: [
    { id: 'maulPropeller', name: 'Propeller advance', slot: 1, upper: 'maulPropellerUpper', lower: 'maulPropellerLower' },
    { id: 'maulBothEnds', name: 'Both ends — fall, turn, rise', slot: 2, upper: 'maulBothEndsUpper', lower: 'maulBothEndsLower' },
    { id: 'maulHelicopter', name: 'Overhead wheel into chop', slot: 3, upper: 'maulHelicopterUpper', lower: 'maulHelicopterLower' },
    { id: 'maulFigureEight', name: 'Figure-eight flourish', slot: 'flourish', upper: 'maulFigureEightUpper', lower: 'maulFigureEightLower' },
  ],
  jedi: [
    { id: 'starkillerSweep', name: 'Reverse-grip sweep', slot: 1, upper: 'starkillerSweepUpper', lower: 'starkillerSweepLower' },
    { id: 'starkillerFlip', name: 'Flip to reverse and stab', slot: 2, upper: 'starkillerFlipUpper', lower: 'starkillerFlipLower' },
    { id: 'starkillerWhirl', name: 'Reverse-grip whirlwind', slot: 3, upper: 'starkillerWhirlUpper', lower: 'starkillerWhirlLower', lowerAlways: true },
  ],
  maris: [
    { id: 'marisJab', name: 'Spinning jab', slot: 1, upper: 'marisJabUpper', lower: 'marisJabLower' },
    { id: 'marisFlipOut', name: 'Block, then flip out', slot: 2, upper: 'marisFlipOutUpper', lower: 'marisFlipOutLower' },
    { id: 'marisCyclone', name: 'Cyclone', slot: 3, upper: 'marisCycloneUpper', lower: 'marisCycloneLower', lowerAlways: true },
  ],
  ventress: [
    { id: 'ventressWheels', name: 'Twin wheels', slot: 'flourish', upper: 'ventressWheelsUpper', lower: 'ventressWheelsLower' },
  ],
};

export const styleMoves = (character: string): readonly StyleMove[] => MOVES[character] ?? [];

// A reverse grip is half a roll about the forearm: the blade sits square to
// his forearm, so the roll lands it below the little finger without passing
// through the arm — and when a clip starts or ends reversed, the grip blend
// in `gripSpin.ts` turns it over along the same roll.
const REVERSED = { about: 'forearm' as const, keys: [[0, 180], [1, 180]] as Array<[number, number]> };

registerGripSpin('maulPropellerUpper', { right: [{ about: 'forearm', keys: [[0, 0], [0.1, 90], [0.2, 270], [0.3, 450], [0.45, 630], [0.6, 780], [0.8, 870], [1, 900]] }] });
registerGripSpin('maulBothEndsUpper', { right: [{ about: 'forearm', keys: [[0, 0], [0.22, 0], [0.4, 180], [1, 180]] }] });
registerGripSpin('maulHelicopterUpper', { right: [{ about: 'forearm', keys: [[0, 0], [0.1, 180], [0.2, 400], [0.32, 630], [0.45, 810], [1, 900]] }] });
registerGripSpin('maulFigureEightUpper', { right: [{ about: 'forearm', keys: [[0, 0], [1, 1080]] }] });
registerGripSpin('starkillerSweepUpper', { right: [REVERSED], left: [REVERSED] });
registerGripSpin('starkillerFlipUpper', { right: [{ about: 'forearm', keys: [[0, 0], [0.18, 0], [0.32, 180], [1, 180]] }] });
registerGripSpin('starkillerWhirlUpper', { right: [REVERSED], left: [REVERSED] });
registerGripSpin('marisJabUpper', { right: [{ about: 'crossGrip', keys: [[0, 0], [0.18, -25], [0.45, 540], [0.7, 720], [1, 720]] }] });
registerGripSpin('marisFlipOutUpper', { left: [{ about: 'crossGrip', keys: [[0, 0], [0.34, 0], [0.45, -180], [0.62, -180], [0.85, -360], [1, -360]] }] });
registerGripSpin('marisCycloneUpper', {
  right: [{ about: 'crossGrip', keys: [[0, 0], [0.12, -30], [0.8, 1080], [1, 1080]] }],
  left: [{ about: 'crossGrip', keys: [[0, 0], [0.12, 30], [0.8, -1080], [1, -1080]] }],
});
// both blades wheel forward in upright discs beside her, clear of the body
const WHEEL: Array<[number, number]> = [[0, 0], [0.15, 60], [0.8, 720], [1, 720]];
registerGripSpin('ventressWheelsUpper', { right: [{ about: 'sideWheel', keys: WHEEL }], left: [{ about: 'sideWheel', keys: WHEEL }] });

function maul(p: Proportions): THREE.AnimationClip[] {
  const guardL = { upperArmL: [-25, 20, 18] as V3, forearmL: [-105, -12, -12] as V3 };
  const out: THREE.AnimationClip[] = [];

  // Propeller advance: the staff turns a disc in front of the fist while he
  // walks it in, and the cut comes out of the spin without it stopping.
  {
    const at = [0, 0.15, 0.3, 0.45, 0.62, 1];
    out.push(build('maulPropellerUpper', { dur: 0.8, at, bones: {
      chest: [[5, -18, 0], [6, -14, 0], [7, -4, 0], [9, 18, 0], [8, 12, 0], [5, -12, 0]],
      upperArmR: [aim([-0.12, 0.1, 1]), aim([-0.1, 0.15, 1]), aim([-0.05, 0.18, 1]), aim([0.3, 0.02, 1]), aim([0.25, -0.1, 1]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-18, 0, 0], [-14, 0, 0], [-12, 0, 0], [-8, 0, 0], [-15, 0, 0], [-60, 0, 0]],
      upperArmL: [guardL.upperArmL, guardL.upperArmL, guardL.upperArmL, [-35, 25, 30], [-35, 25, 30], guardL.upperArmL],
      forearmL: [guardL.forearmL, guardL.forearmL, guardL.forearmL, [-85, -12, -12], [-85, -12, -12], guardL.forearmL],
      head: [[0, 14, 0], [0, 12, 0], [0, 6, 0], [0, -12, 0], [0, -8, 0], [0, 10, 0]],
    } }));
    out.push(build('maulPropellerLower', { dur: 0.8, at, bones: {
      hips: [[3, -12, 0], [3, -10, 0], [4, -4, 0], [6, 12, 0], [6, 10, 0], [3, -8, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.04, 0.02], [0.08, 0.06], [0.1, 0.09], [0.1, 0.09], [0.03, 0]) }));
  }

  // Both ends: a falling cut with the top blade, then half a turn in the hand
  // and the other blade rises through the same line. One phrase, two hits.
  {
    const at = [0, 0.22, 0.32, 0.45, 0.62, 1];
    out.push(build('maulBothEndsUpper', { dur: 0.72, at, bones: {
      chest: [[4, -32, 0], [8, 28, 0], [6, 10, 0], [4, -26, 0], [4, -24, 0], [5, -12, 0]],
      upperArmR: [aim([-0.6, 0.7, 0.4]), aim([0.15, -0.4, 0.9]), aim([0, -0.4, 0.9]), aim([-0.55, 0.45, 0.7]), aim([-0.6, 0.5, 0.6]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-40, 0, 0], [-10, 0, 0], [-25, 0, 0], [-12, 0, 0], [-18, 0, 0], [-60, 0, 0]],
      handR: [[0, 0, -25], [0, 0, 20], [0, 0, 0], [0, 0, -20], [0, 0, -10], [0, 0, 0]],
      upperArmL: [[-30, 30, 35], [-20, 10, 20], guardL.upperArmL, [-40, 30, 40], [-35, 28, 36], guardL.upperArmL],
      forearmL: [guardL.forearmL, guardL.forearmL, guardL.forearmL, [-70, -12, -12], [-75, -12, -12], guardL.forearmL],
      head: [[0, 18, 0], [0, -12, 0], [0, -4, 0], [0, 14, 0], [0, 12, 0], [0, 10, 0]],
    } }));
    out.push(build('maulBothEndsLower', { dur: 0.72, at, bones: {
      hips: [[3, -18, 0], [5, 16, 0], [4, 6, 0], [4, -14, 0], [4, -12, 0], [3, -8, 0]],
      ...legs(SET, WIDE, WIDE, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.12, 0.02], [0.1, 0.03], [0.09, 0.07], [0.09, 0.07], [0.03, 0]) }));
  }

  // Overhead wheel: the staff spins flat above his head, then the spin is
  // dropped into a chop with the whole body behind it. The spin stops a
  // quarter turn on, so the staff lies across the chop rather than hanging at
  // his side, and the recovery turns it the last quarter — half a turn leaves
  // a double blade looking exactly as it started.
  {
    const at = [0, 0.12, 0.3, 0.45, 0.6, 1];
    out.push(build('maulHelicopterUpper', { dur: 0.9, at, bones: {
      chest: [[-4, -8, 0], [-8, -4, 0], [-10, 0, 0], [22, 6, 0], [18, 4, 0], [5, -12, 0]],
      upperArmR: [aim([-0.3, 0.9, 0.2]), aim([-0.15, 1, 0.15]), aim([-0.1, 1, 0.1]), aim([0, -0.35, 1]), aim([0, -0.55, 0.9]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-10, 0, 0], [-5, 0, 0], [-5, 0, 0], [-10, 0, 0], [-20, 0, 0], [-60, 0, 0]],
      upperArmL: [[-40, 30, 40], [-60, 30, 45], [-60, 30, 45], [-30, 10, 25], [-30, 10, 25], guardL.upperArmL],
      forearmL: [[-60, -12, -12], [-50, -12, -12], [-50, -12, -12], [-90, -12, -12], [-95, -12, -12], guardL.forearmL],
      head: [[-15, 0, 0], [-20, 0, 0], [-18, 0, 0], [12, 0, 0], [10, 0, 0], [0, 10, 0]],
    } }));
    out.push(build('maulHelicopterLower', { dur: 0.9, at, bones: {
      hips: [[-4, 0, 0], [-6, 0, 0], [-6, 0, 0], [14, 0, 0], [12, 0, 0], [3, -8, 0]],
      ...legs(SET, SET, SET, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.02, 0], [0, -0.02], [0, -0.02], [0.14, 0.1], [0.13, 0.1], [0.03, 0]) }));
  }

  // Figure eight: the staff wheels down one side, the arm carries it across
  // the front, and it wheels down the other. Half again the study's pace.
  {
    const at = [0, 0.25, 0.5, 0.75, 1];
    const dur = 1.3 / 1.5;
    out.push(build('maulFigureEightUpper', { dur, at, bones: {
      chest: [[5, -24, 0], [5, -26, 0], [5, 22, 0], [5, 24, 0], [5, -12, 0]],
      upperArmR: [aim([-0.9, -0.15, 0.45]), aim([-0.85, -0.2, 0.5]), aim([0.55, -0.2, 0.8]), aim([0.5, -0.2, 0.85]), aim([-0.3, -0.45, 0.8])],
      forearmR: [[-20, 0, 0], [-20, 0, 0], [-30, 0, 0], [-30, 0, 0], [-60, 0, 0]],
      upperArmL: [guardL.upperArmL, guardL.upperArmL, [-20, 10, 40], [-20, 10, 40], guardL.upperArmL],
      forearmL: [guardL.forearmL, guardL.forearmL, [-80, -12, -12], [-80, -12, -12], guardL.forearmL],
      head: [[0, 20, 0], [0, 18, 0], [0, -14, 0], [0, -12, 0], [0, 10, 0]],
    } }));
    out.push(build('maulFigureEightLower', { dur, at, bones: {
      hips: [[3, -12, 0], [3, -12, 0], [3, 10, 0], [3, 10, 0], [3, -8, 0]],
      ...legs(SET, SET, SET, SET, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.05, 0], [0.05, 0], [0.05, 0], [0.03, 0]) }));
  }
  return out;
}

/** Starkiller's ready: lead fist at the belt, the off arm low and back */
export const STARKILLER_STANCE = { right: aim([-0.15, -0.55, 0.8]), left: aimL([-0.45, -0.75, -0.3]) };

function starkiller(p: Proportions): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  const stanceR = STARKILLER_STANCE.right, stanceL = STARKILLER_STANCE.left;

  // Reverse sweep: the fist starts at the far shoulder and is thrown out wide;
  // held reversed, the blade trails the hand and sweeps the whole arc behind it.
  {
    const at = [0, 0.25, 0.45, 0.62, 1];
    out.push(build('starkillerSweepUpper', { dur: 0.72, at, bones: {
      chest: [[8, -20, 0], [8, 32, 0], [6, -40, 0], [5, -52, 0], [8, -26, 0]],
      upperArmR: [stanceR, aim([0.7, 0.05, 0.6]), aim([-1, 0.05, 0.35]), aim([-0.8, 0.1, -0.4]), stanceR],
      forearmR: [[-50, 0, 0], [-110, 0, 0], [-12, 0, 0], [-15, 0, 0], [-50, 0, 0]],
      handR: [[10, 0, 0], [30, 0, 0], [-20, 0, 0], [-10, 0, 0], [10, 0, 0]],
      upperArmL: [stanceL, aimL([-0.3, -0.6, -0.5]), aimL([-0.35, -0.45, 0.6]), aimL([-0.4, -0.5, 0.5]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-30, 0, 0]), mir([-35, 0, 0]), mir([-30, 0, 0]), mir([-25, 0, 0])],
      head: [[-4, 18, 0], [-4, -8, 0], [-4, 30, 0], [-4, 36, 0], [-4, 22, 0]],
    } }));
    out.push(build('starkillerSweepLower', { dur: 0.72, at, bones: {
      hips: [[4, -18, 0], [4, 20, 0], [5, -30, 0], [5, -38, 0], [4, -24, 0]],
      ...legs(WIDE, WIDE, WIDE, WIDE, WIDE),
    }, hips: hipsAt(p, [0.12, 0], [0.1, 0], [0.16, 0.02], [0.16, 0.02], [0.12, 0]) }));
  }

  // Flip and stab: a forward-grip cut that rolls the hilt over in the hand on
  // its way down and finishes as a reversed, downward stab — the grip change
  // is the move.
  {
    const at = [0, 0.25, 0.45, 0.62, 1];
    out.push(build('starkillerFlipUpper', { dur: 0.7, at, bones: {
      chest: [[4, -24, 0], [-4, -30, 0], [18, 12, 0], [16, 10, 0], [8, -20, 0]],
      upperArmR: [aim([-0.4, -0.3, 0.8]), aim([-0.85, 0.45, 0.35]), aim([0, -0.2, 1]), aim([0, -0.35, 0.95]), stanceR],
      forearmR: [[-40, 0, 0], [-35, 0, 0], [-20, 0, 0], [-25, 0, 0], [-50, 0, 0]],
      handR: [[0, 0, 0], [20, 0, 0], [30, 0, 0], [25, 0, 0], [10, 0, 0]],
      upperArmL: [stanceL, stanceL, aimL([-0.5, -0.6, -0.5]), aimL([-0.5, -0.6, -0.5]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-25, 0, 0]), mir([-20, 0, 0]), mir([-20, 0, 0]), mir([-25, 0, 0])],
      head: [[0, 16, 0], [-10, 14, 0], [18, -4, 0], [16, -4, 0], [-4, 20, 0]],
    } }));
    out.push(build('starkillerFlipLower', { dur: 0.7, at, bones: {
      hips: [[3, -14, 0], [0, -18, 0], [12, 6, 0], [12, 6, 0], [4, -20, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, WIDE),
    }, hips: hipsAt(p, [0.03, 0], [0.02, -0.02], [0.16, 0.1], [0.16, 0.1], [0.12, 0]) }));
  }

  // Whirlwind: both reversed blades held out to the sides as he turns a full
  // circle on the spot, and settles into the crouch facing where he started.
  // Half again the study's pace.
  {
    const at = [0, 0.12, 0.28, 0.45, 0.62, 0.78, 1];
    const dur = 0.95 / 1.5;
    const outR = aim([-1, 0.05, 0.15]), outL = aimL([-1, 0.05, 0.15]);
    out.push(build('starkillerWhirlUpper', { dur, at, bones: {
      chest: [[6, -20, 0], [4, -30, 0], [4, 0, 0], [4, 0, 0], [4, 0, 0], [6, 0, 0], [8, -26, 0]],
      upperArmR: [stanceR, aim([0.4, -0.2, 0.8]), outR, outR, outR, aim([-0.6, -0.4, 0.6]), stanceR],
      forearmR: [[-50, 0, 0], [-100, 0, 0], [-8, 0, 0], [-8, 0, 0], [-8, 0, 0], [-40, 0, 0], [-50, 0, 0]],
      upperArmL: [stanceL, aimL([0.4, -0.2, 0.8]), outL, outL, outL, aimL([-0.6, -0.4, 0.2]), stanceL],
      forearmL: [mir([-25, 0, 0]), mir([-100, 0, 0]), mir([-8, 0, 0]), mir([-8, 0, 0]), mir([-8, 0, 0]), mir([-40, 0, 0]), mir([-25, 0, 0])],
      head: [[-4, 20, 0], [0, 20, 0], [0, 10, 0], [0, 10, 0], [0, 10, 0], [0, 10, 0], [-4, 22, 0]],
    } }));
    // the body turns on the hips a full circle; keys a third of a turn apart
    // so each leg of it interpolates the short way round
    out.push(build('starkillerWhirlLower', { dur, at, bones: {
      hips: [[4, -24, 0], [4, -40, 0], [4, 60, 0], [4, 180, 0], [4, 300, 0], [4, 336, 0], [4, 336, 0]],
      ...legs(WIDE, SET, SET, SET, SET, WIDE, WIDE),
    }, hips: hipsAt(p, [0.12, 0], [0.06, 0], [0.04, 0], [0.04, 0], [0.04, 0], [0.14, 0], [0.12, 0]) }));
  }
  return out;
}

function maris(p: Proportions): THREE.AnimationClip[] {
  const out: THREE.AnimationClip[] = [];
  const guardR: V3 = [-56, -12, -18], guardFR: V3 = [-68, 18, 0], handIdle: V3 = [8, -16, -10];

  // Spinning jab: the tonfa wheels a turn and a half round its grip as the fist
  // drives straight out, so the blade arrives leading the punch, then turns the
  // last half back to lie along her forearm.
  {
    const at = [0, 0.18, 0.45, 0.62, 1];
    out.push(build('marisJabUpper', { dur: 0.6, at, bones: {
      chest: [[7, -12, 0], [8, -22, 0], [8, 16, 0], [8, 14, 0], [7, -12, 0]],
      upperArmR: [guardR, [-50, -20, -22], aim([-0.12, 0.05, 1]), aim([-0.12, 0, 1]), guardR],
      forearmR: [guardFR, [-95, 18, 0], [-4, 0, 0], [-8, 0, 0], guardFR],
      handR: [handIdle, handIdle, [0, 0, 0], [0, 0, 0], handIdle],
      upperArmL: [mir(guardR), mir(guardR), [-60, 20, 30], [-60, 20, 30], mir(guardR)],
      forearmL: [mir(guardFR), mir(guardFR), mir([-80, 18, 0]), mir([-80, 18, 0]), mir(guardFR)],
      head: [[1, 10, 0], [1, 14, 0], [2, -6, 0], [2, -4, 0], [1, 10, 0]],
    } }));
    out.push(build('marisJabLower', { dur: 0.6, at, bones: {
      hips: [[3, -10, 0], [3, -16, 0], [6, 12, 0], [6, 10, 0], [3, -10, 0]],
      ...legs(SET, SET, LUNGE, LUNGE, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.05, -0.01], [0.1, 0.08], [0.1, 0.08], [0.04, 0]) }));
  }

  // Block, then flip out: the left forearm comes up across her face with the
  // blade lying along it as a shield, and from the block the tonfa is spun
  // half a turn outward to cut, held a beat, and turned home.
  {
    const at = [0, 0.2, 0.34, 0.45, 0.62, 0.85, 1];
    const blockL = aimL([0.25, 0.1, 1]);
    out.push(build('marisFlipOutUpper', { dur: 0.75, at, bones: {
      chest: [[7, -12, 0], [6, 10, 0], [6, 12, 0], [8, -18, 0], [8, -20, 0], [7, -14, 0], [7, -12, 0]],
      upperArmL: [mir(guardR), blockL, blockL, aimL([-0.85, 0.1, 0.5]), aimL([-0.9, 0.1, 0.4]), mir(guardR), mir(guardR)],
      forearmL: [mir(guardFR), mir([-115, 60, 0]), mir([-115, 60, 0]), mir([-10, 0, 0]), mir([-12, 0, 0]), mir(guardFR), mir(guardFR)],
      handL: [mir(handIdle), mir([0, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0]), mir([0, 0, 0]), mir(handIdle), mir(handIdle)],
      upperArmR: [guardR, guardR, guardR, [-50, -10, -30], [-50, -10, -30], guardR, guardR],
      forearmR: [guardFR, guardFR, guardFR, [-80, 18, 0], [-80, 18, 0], guardFR, guardFR],
      head: [[1, 10, 0], [4, -8, 0], [4, -8, 0], [1, 18, 0], [1, 20, 0], [1, 12, 0], [1, 10, 0]],
    } }));
    out.push(build('marisFlipOutLower', { dur: 0.75, at, bones: {
      hips: [[3, -10, 0], [2, 8, 0], [2, 8, 0], [5, -14, 0], [5, -16, 0], [3, -10, 0], [3, -10, 0]],
      ...legs(SET, WIDE, WIDE, SET, SET, SET, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.1, -0.02], [0.1, -0.02], [0.06, 0.03], [0.06, 0.03], [0.04, 0], [0.04, 0]) }));
  }

  // Cyclone: arms out, both tonfas wheeling opposite ways, and a full turn of
  // the body through them. Elbows bent so the forearms point forward: a blade
  // turned back along the forearm then passes beside the body rather than
  // into it. Half again the study's pace.
  {
    const at = [0, 0.12, 0.28, 0.45, 0.62, 0.8, 1];
    const dur = 0.9 / 1.5;
    const wideR = aim([-0.85, -0.35, 0.4]), wideL = aimL([-0.85, -0.35, 0.4]);
    out.push(build('marisCycloneUpper', { dur, at, bones: {
      chest: [[7, -12, 0], [4, -20, 0], [4, 0, 0], [4, 0, 0], [4, 0, 0], [6, 0, 0], [7, -12, 0]],
      upperArmR: [guardR, wideR, wideR, wideR, wideR, wideR, guardR],
      forearmR: [guardFR, [-80, 0, 0], [-75, 0, 0], [-75, 0, 0], [-75, 0, 0], [-80, 0, 0], guardFR],
      upperArmL: [mir(guardR), wideL, wideL, wideL, wideL, wideL, mir(guardR)],
      forearmL: [mir(guardFR), mir([-80, 0, 0]), mir([-75, 0, 0]), mir([-75, 0, 0]), mir([-75, 0, 0]), mir([-80, 0, 0]), mir(guardFR)],
      head: [[1, 10, 0], [0, 10, 0], [0, 8, 0], [0, 8, 0], [0, 8, 0], [0, 8, 0], [1, 10, 0]],
    } }));
    out.push(build('marisCycloneLower', { dur, at, bones: {
      hips: [[3, -10, 0], [3, -20, 0], [3, 80, 0], [3, 200, 0], [3, 320, 0], [3, 350, 0], [3, 350, 0]],
      ...legs(SET, WIDE, SET, SET, SET, WIDE, SET),
    }, hips: hipsAt(p, [0.04, 0], [0.12, 0], [0.06, 0], [0.06, 0], [0.06, 0], [0.12, 0], [0.04, 0]) }));
  }
  return out;
}

function ventress(p: Proportions): THREE.AnimationClip[] {
  // Twin wheels: arms thrown straight out to the sides, both blades wheeling
  // forward in upright discs beside her, then gathered into a crossed guard.
  // Straight out, each arm crosses its wheel only at the fist, so neither
  // blade can reach her arms or her body. Three quarters again the study's pace.
  const guardR = aim([-0.3, -0.5, 0.8]), guardL = aimL([-0.35, -0.2, 0.9]);
  const at = [0, 0.2, 0.75, 1];
  const dur = 1.1 / 1.75;
  const side = aim([-1, 0.02, 0.1]), sideL = aimL([-1, 0.02, 0.1]);
  return [
    build('ventressWheelsUpper', { dur, at, bones: {
      chest: [[4, 0, 0], [6, 0, 0], [6, 0, 0], [3, 0, 0]],
      upperArmR: [guardR, side, side, aim([0.2, -0.2, 0.9])],
      forearmR: [[-40, 0, 0], [-6, 0, 0], [-6, 0, 0], [-70, 0, 0]],
      upperArmL: [guardL, sideL, sideL, aimL([0.2, -0.2, 0.9])],
      forearmL: [mir([-40, 0, 0]), mir([-6, 0, 0]), mir([-6, 0, 0]), mir([-70, 0, 0])],
      head: [[0, 0, 0], [4, 0, 0], [4, 0, 0], [0, 0, 0]],
    } }),
    build('ventressWheelsLower', { dur, at, bones: {
      hips: [[3, 0, 0], [3, 0, 0], [3, 0, 0], [3, 0, 0]],
      ...legs(SET, WIDE, WIDE, SET),
    }, hips: hipsAt(p, [0.03, 0], [0.1, 0], [0.1, 0], [0.03, 0]) }),
  ];
}

const BUILDERS: Record<string, (p: Proportions) => THREE.AnimationClip[]> = { maul, jedi: starkiller, maris, ventress };

/** The fighter's style clips, built on its own proportions. */
export function styleClips(character: string, p: Proportions): ClipSet {
  const clips: ClipSet = {};
  for (const clip of BUILDERS[character]?.(p) ?? []) clips[clip.name] = clip;
  return clips;
}

/** An approved style move for this combo step or the flourish, or null for the original. */
export function pickStyleMove(character: string, slot: StyleSlot): StyleMove | null {
  const moves = styleMoves(character).filter((m) => m.slot === slot);
  // no draw at all when there is nothing to choose: a fighter without a style
  // leaves the dice where they were, so a seeded run replays as it always did
  if (!moves.length) return null;
  const pick = Math.floor(Math.random() * (moves.length + 1));
  return pick < moves.length ? moves[pick] : null;
}
