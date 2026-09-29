import type { ClipSet } from './clips';
import type { Proportions } from './skeleton';
import { build, hipsAt, legs, LUNGE, reach, SET, WIDE, type Key, type Legs, type Limb, type V3 } from './clipKit';

/**
 * Bare-handed strikes, drawn the way fight films stage them: every blow is
 * loaded before it is thrown, so the audience reads it coming.
 *
 * The punches take their wind-up from screen boxing and brawling — the rear
 * fist cocked by the ear while the lead hand measures the distance, the hips
 * turning ahead of the shoulders, the head held on the target. The kicks take
 * theirs from wushu and taekwondo as film uses them: a chambered knee, a pivot
 * on the standing foot, and the spinning and jumping forms that turn the whole
 * body through the strike.
 *
 * Every clip puts contact at 45% of the clip, the melee controller's hit
 * frame, so any of them drops into a combo step. The stance is orthodox: left
 * foot and fist lead. Each is built at a standard pace and played faster or
 * slower for each fighter's cadence (`combatStyle.ts`), so bodies that share
 * a clip set share these too.
 */

/** the combo step a move is thrown as: two punches, then a kick to finish */
export type UnarmedSlot = 1 | 2 | 3;
export interface UnarmedMove {
  slot: UnarmedSlot;
  id: string;
  name: string;
  upper: string;
  lower: string;
  /** struck with a foot: the contact sweeps the legs as well as the hands */
  kick: boolean;
}

const move = (slot: UnarmedSlot, id: string, name: string): UnarmedMove =>
  ({ slot, id, name, upper: `${id}Upper`, lower: `${id}Lower`, kick: id.startsWith('kick') });

/** every move by its combo step; the first in each step is the workbench pose's own */
export const UNARMED_MOVES: readonly UnarmedMove[] = [
  move(1, 'fistCross', 'Wound-up cross'),
  move(1, 'fistHaymaker', 'Haymaker'),
  move(1, 'fistSuperman', 'Superman punch'),
  move(1, 'fistUppercut', 'Rising uppercut'),
  move(2, 'fistHook', 'Lead hook'),
  move(2, 'fistBackfist', 'Spinning backfist'),
  move(2, 'fistElbow', 'Horizontal elbow'),
  move(3, 'kickRoundhouse', 'Roundhouse kick'),
  move(3, 'kickSpinHook', 'Spinning hook kick'),
  move(3, 'kickPush', 'Push kick'),
  move(3, 'kickTornado', 'Jumping tornado kick'),
];

/** One of a combo step's moves, at random — or of all of them, for a lone strike. */
export function pickUnarmed(slot?: UnarmedSlot): UnarmedMove {
  const pool = slot ? UNARMED_MOVES.filter((m) => m.slot === slot) : UNARMED_MOVES;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Limbs are placed by where the fist or foot goes, not by joint angles: a fist
 * in the chest's frame (+X the fighter's left, +Y up, +Z forward, from the
 * point between the shoulders), a foot in the hips' frame from its hip joint.
 * Each fighter's own limb lengths solve the elbow and knee, so a blow lands
 * where it is aimed on every body.
 */
type Reach = [to: V3, pole?: V3];

// the guard: hands high, chin tucked, the body bladed a quarter turn so the
// left shoulder leads — the rear fist by the jaw, the lead a forearm out
const GUARD_R: Reach = [[-0.04, 0.12, 0.27]], GUARD_L: Reach = [[0.2, 0.12, 0.42]];
/** a fist tucked back to the chin once its partner has been thrown */
const TUCK_R: Reach = [[-0.02, 0.16, 0.24]], TUCK_L: Reach = [[0.02, 0.16, 0.24]];
const G_CHEST: V3 = [4, 5, 0], G_HIPS: V3 = [3, -25, 0], G_HEAD: V3 = [-2, 18, 0];
/** the rear knee folded, heel up: weight on the lead foot */
const LOADED: Legs = { upperLegL: [-18, 0, 5], lowerLegL: [26, 0, 0], upperLegR: [14, 0, -6], lowerLegR: [30, 0, 0] };

/** Every move's upper and lower clip, solved on these proportions, at a pace (1 is standard). */
export function unarmedClips(p: Proportions, pace = 1): ClipSet {
  const out: ClipSet = {};
  const add = (id: string, dur: number, at: number[],
    upper: Record<string, Key[]>, lower: Record<string, Key[]>, hips: V3[]): void => {
    out[`${id}Upper`] = build(`${id}Upper`, { dur: dur * pace, at, bones: upper });
    out[`${id}Lower`] = build(`${id}Lower`, { dur: dur * pace, at, bones: lower, hips });
  };
  const shoulder = p.shoulderWidth + 0.06, shoulderUp = p.neckLen * 0.4;
  const track = (upper: string, lower: string, limbs: Limb[]): Record<string, Key[]> =>
    ({ [upper]: limbs.map((l) => l.upper), [lower]: limbs.map((l) => l.lower) });
  // the fist's knuckles sit a hand's breadth past the wrist
  const arm = (side: 'R' | 'L', ...poses: Reach[]): Record<string, Key[]> => {
    const sx = side === 'R' ? -1 : 1;
    return track(`upperArm${side}`, `forearm${side}`, poses.map(([[x, y, z], pole]) =>
      reach(p.upperArmLen, p.forearmLen + 0.07, [x - sx * shoulder, y - shoulderUp, z], pole ?? [sx * 0.3, -1, 0])));
  };
  const leg = (side: 'R' | 'L', ...poses: Array<Reach | Legs>): Record<string, Key[]> => {
    const limbs = poses.map((q): Limb => Array.isArray(q)
      ? reach(p.upperLegLen, p.lowerLegLen, q[0], q[1] ?? [0, 0, 1], true)
      : { upper: q[`upperLeg${side}`] as unknown as Limb['upper'], lower: q[`lowerLeg${side}`] });
    return track(`upperLeg${side}`, `lowerLeg${side}`, limbs);
  };

  // ---------------------------------------------------------------- slot 1
  // Wound-up cross: the rear fist draws back wide and high, out past its
  // elbow, as the lead hand reaches out to measure, then the hips turn and the
  // right drives straight through the target while the left snaps home to the
  // chin. The wind-up key is in the chest's frame, which the counter-turn has
  // swung ~47° away, so "out and forward" there reads as out and back.
  {
    const at = [0, 0.25, 0.38, 0.45, 0.6, 1];
    add('fistCross', 0.75, at, {
      chest: [G_CHEST, [2, -15, 0], [6, 10, 0], [10, 22, 0], [10, 24, 0], G_CHEST],
      head: [G_HEAD, [-4, 40, 0], [0, 0, 0], [4, -32, 0], [4, -34, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.64, 0.15, 0.12], [0.3, -1, 0]], [[-0.15, 0.03, 0.35], [-0.3, -1, -0.2]],
        [[-0.5, 0.35, 0.58]], [[-0.5, 0.33, 0.56]], GUARD_R),
      ...arm('L', GUARD_L, [[0.55, 0.1, 0.55]], [[0.2, 0.05, 0.35]], TUCK_L, TUCK_L, GUARD_L),
    }, {
      hips: [G_HIPS, [4, -32, 0], [5, -5, 0], [6, 20, 0], [6, 20, 0], G_HIPS],
      ...legs(SET, LOADED, LUNGE, LUNGE, LUNGE, SET),
    }, hipsAt(p, [0.04, 0], [0.07, -0.04], [0.08, 0.06], [0.09, 0.12], [0.09, 0.12], [0.04, 0]));
  }

  // Haymaker: the brawler's swing — the arm thrown wide behind and up, a
  // looping arc round to the jaw, and the whole body falling after it.
  {
    const at = [0, 0.28, 0.4, 0.45, 0.62, 1];
    add('fistHaymaker', 0.85, at, {
      chest: [G_CHEST, [-4, -28, 4], [4, 10, 0], [12, 34, -4], [14, 48, -6], G_CHEST],
      head: [G_HEAD, [-6, 44, 0], [0, 6, 0], [6, -34, 0], [8, -40, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.65, 0.2, 0], [0, -1, -0.3]], [[-0.7, 0.15, 0.25], [-0.5, 0, -1]],
        [[-0.55, 0.35, 0.45], [-0.5, 0.2, -1]], [[-0.4, 0, 0.45], [-0.5, -0.2, -1]], GUARD_R),
      ...arm('L', GUARD_L, [[0.45, 0, 0.45]], [[0.25, 0.05, 0.3]], TUCK_L, [[0.15, 0, 0.2]], GUARD_L),
    }, {
      hips: [G_HIPS, [2, -38, 0], [4, -5, 0], [8, 25, 0], [9, 32, 0], G_HIPS],
      ...legs(SET, LOADED, LUNGE, LUNGE, LUNGE, SET),
    }, hipsAt(p, [0.04, 0], [0.06, -0.06], [0.08, 0.08], [0.1, 0.16], [0.11, 0.2], [0.04, 0]));
  }

  // Superman punch: the rear knee drives up as if to kick, then scissors back
  // as the body springs forward off the lead foot, and the right comes over
  // the top in the air — the fist arriving with the rear leg trailing straight.
  {
    const at = [0, 0.22, 0.35, 0.45, 0.62, 1];
    add('fistSuperman', 0.9, at, {
      chest: [G_CHEST, [-6, -10, 0], [4, 0, 0], [16, 20, 0], [14, 20, 0], G_CHEST],
      head: [G_HEAD, [4, 30, 0], [0, 14, 0], [-10, -18, 0], [-8, -18, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.3, -0.35, -0.1], [-0.2, -0.3, -1]], [[-0.3, 0.1, -0.05], [-0.5, 0.2, -1]],
        [[-0.45, 0.3, 0.6]], [[-0.45, 0.25, 0.58]], GUARD_R),
      ...arm('L', GUARD_L, [[0.1, 0.1, 0.3]], [[0.35, -0.3, -0.2]], [[0.4, -0.35, -0.25]], [[0.3, -0.1, 0.1]], GUARD_L),
    }, {
      hips: [G_HIPS, [-4, -20, 0], [0, -10, 0], [10, 15, 0], [8, 15, 0], G_HIPS],
      upperLegL: [SET.upperLegL, [-10, 0, 5], [-20, 0, 5], [-30, 0, 5], [-40, 0, 5], SET.upperLegL],
      lowerLegL: [SET.lowerLegL, [30, 0, 0], [20, 0, 0], [30, 0, 0], [50, 0, 0], SET.lowerLegL],
      upperLegR: [SET.upperLegR, [-60, 0, -5], [10, 0, -5], [40, 0, -5], [30, 0, -6], SET.upperLegR],
      lowerLegR: [SET.lowerLegR, [95, 0, 0], [60, 0, 0], [20, 0, 0], [40, 0, 0], SET.lowerLegR],
    }, hipsAt(p, [0.04, 0], [0.02, 0], [-0.08, 0.12], [-0.04, 0.26], [0.12, 0.3], [0.04, 0]));
  }

  // Rising uppercut: a dip and a turn that drops the right fist to the hip,
  // then legs, hips and shoulders all rise at once behind a fist driven
  // straight up the centre line.
  {
    const at = [0, 0.28, 0.38, 0.45, 0.6, 1];
    add('fistUppercut', 0.8, at, {
      chest: [G_CHEST, [16, -20, -6], [8, 0, 0], [-10, 22, 0], [-12, 24, 0], G_CHEST],
      head: [G_HEAD, [-10, 34, 0], [0, 10, 0], [10, -26, 0], [12, -28, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.25, -0.4, 0.1], [-0.3, 0, -1]], [[-0.2, -0.2, 0.3], [-0.3, -1, -0.3]],
        [[-0.18, 0.12, 0.42], [0, -1, 0.5]], [[-0.14, 0.3, 0.36], [0, -1, 0.5]], GUARD_R),
      ...arm('L', GUARD_L, TUCK_L, TUCK_L, TUCK_L, TUCK_L, GUARD_L),
    }, {
      hips: [G_HIPS, [8, -30, 0], [4, -10, 0], [-2, 18, 0], [-2, 20, 0], G_HIPS],
      ...legs(SET, WIDE, SET, SET, SET, SET),
    }, hipsAt(p, [0.04, 0], [0.16, -0.02], [0.08, 0.08], [-0.02, 0.16], [-0.01, 0.16], [0.04, 0]));
  }

  // ---------------------------------------------------------------- slot 2
  // Lead hook: the left shoulder opens as the weight settles on the lead
  // foot, then the hips snap round and the arm, bent square with the elbow
  // raised level with the fist, swings through the jaw line.
  {
    const at = [0, 0.25, 0.38, 0.45, 0.6, 1];
    add('fistHook', 0.7, at, {
      chest: [G_CHEST, [2, 22, 0], [4, 5, 0], [6, -10, 0], [6, -14, 0], G_CHEST],
      head: [G_HEAD, [-4, 0, 0], [0, 14, 0], [2, 40, 0], [2, 44, 0], G_HEAD],
      ...arm('L', GUARD_L, [[0.55, 0, 0.2], [1, 0.2, -0.3]], [[0.45, 0.05, 0.4], [1, 0.3, 0]],
        [[0.47, 0.23, 0.45], [1, 0.5, -0.2]], [[0.3, 0.2, 0.45], [1, 0.5, -0.2]], GUARD_L),
      ...arm('R', GUARD_R, GUARD_R, GUARD_R, TUCK_R, TUCK_R, GUARD_R),
    }, {
      hips: [G_HIPS, [4, -10, 0], [5, -25, 0], [6, -40, 0], [6, -44, 0], G_HIPS],
      ...legs(SET, LOADED, SET, SET, SET, SET),
    }, hipsAt(p, [0.04, 0], [0.09, 0.02], [0.08, 0.04], [0.08, 0.05], [0.08, 0.05], [0.04, 0]));
  }

  // Spinning backfist: a wind the other way, then the body turns clockwise
  // on the balls of the feet with the head leading, and the right arm unfurls
  // straight out of the turn to land the back of the fist. The hips' keys sit
  // under half a turn apart so each leg of the spin goes the long way round.
  {
    const at = [0, 0.15, 0.28, 0.38, 0.45, 0.6, 1];
    add('fistBackfist', 0.8, at, {
      chest: [G_CHEST, [4, 12, 0], [4, -10, 0], [4, -10, 0], [4, 0, 0], [4, 0, 0], G_CHEST],
      head: [G_HEAD, [-2, 0, 0], [-2, -60, 0], [-2, -70, 0], [-2, -60, 0], [-2, -30, 0], G_HEAD],
      ...arm('R', GUARD_R, [[0.15, 0.05, 0.2], [-0.3, -0.5, 1]], [[-0.2, 0.05, 0.3], [-0.5, 0, 1]],
        [[-0.6, 0.08, 0.1], [0, -1, 0.3]], [[-0.78, 0.18, 0.45], [0, -1, 0.3]], [[-0.3, 0.02, 0.35]], GUARD_R),
      ...arm('L', GUARD_L, TUCK_L, TUCK_L, TUCK_L, TUCK_L, TUCK_L, GUARD_L),
    }, {
      hips: [G_HIPS, [3, -10, 0], [3, -130, 0], [3, -240, 0], [3, -300, 0], [3, -345, 0], [3, -385, 0]],
      ...legs(SET, LOADED, SET, SET, SET, SET, SET),
    }, hipsAt(p, [0.04, 0], [0.08, 0], [0.03, 0.04], [0.03, 0.08], [0.05, 0.1], [0.06, 0.1], [0.04, 0]));
  }

  // Horizontal elbow: at knife range. The right arm rises level with the
  // shoulder, folded tight, and the turn of the body carries the point of the
  // elbow across the jaw.
  {
    const at = [0, 0.25, 0.38, 0.45, 0.6, 1];
    add('fistElbow', 0.65, at, {
      chest: [G_CHEST, [0, -30, 0], [4, 0, 0], [8, 32, 0], [8, 40, 0], G_CHEST],
      head: [G_HEAD, [-4, 44, 0], [0, 14, 0], [2, -22, 0], [2, -28, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.35, 0.12, 0.08], [-1, 0.1, -0.5]], [[-0.2, 0.12, 0.1], [-0.3, 0.05, 1]],
        [[-0.12, 0.14, 0.12], [0.4, 0.1, 1]], [[0, 0.14, 0.1], [0.8, 0.1, 0.6]], GUARD_R),
      ...arm('L', GUARD_L, [[0.3, 0, 0.45]], TUCK_L, TUCK_L, TUCK_L, GUARD_L),
    }, {
      hips: [G_HIPS, [3, -34, 0], [5, -5, 0], [6, 18, 0], [6, 20, 0], G_HIPS],
      ...legs(SET, LOADED, LUNGE, LUNGE, LUNGE, SET),
    }, hipsAt(p, [0.04, 0], [0.07, -0.03], [0.08, 0.08], [0.09, 0.16], [0.09, 0.16], [0.04, 0]));
  }

  // ---------------------------------------------------------------- slot 3
  // Roundhouse: the rear knee chambers high, the standing foot pivots so the
  // hips turn over, and the shin whips out level through the target; then the
  // knee folds back and the foot is set down where it came from. The standing
  // foot is kept under the body as the hips tip away from the kick.
  {
    const at = [0, 0.2, 0.33, 0.45, 0.6, 0.8, 1];
    add('kickRoundhouse', 0.9, at, {
      chest: [G_CHEST, [2, 0, 0], [0, -10, 8], [-4, -20, 14], [-4, -18, 12], [2, -5, 4], G_CHEST],
      head: [G_HEAD, [0, 22, 0], [0, 10, -6], [2, -20, -10], [2, -18, -8], [0, 10, 0], G_HEAD],
      ...arm('R', GUARD_R, GUARD_R, [[-0.35, -0.3, 0.1]], [[-0.4, -0.45, -0.2]], [[-0.4, -0.4, -0.1]], GUARD_R, GUARD_R),
      ...arm('L', GUARD_L, GUARD_L, TUCK_L, TUCK_L, TUCK_L, GUARD_L, GUARD_L),
    }, {
      hips: [G_HIPS, [3, -20, 0], [0, 25, -10], [-4, 70, -20], [-4, 66, -18], [0, 15, -5], G_HIPS],
      ...leg('L', SET, LOADED, [[0.15, -0.87, 0.05]], [[0.28, -0.84, 0]], [[0.26, -0.85, 0]], [[0.08, -0.87, 0.05]], SET),
      ...leg('R', SET, LOADED, [[-0.5, 0, 0.1], [0.2, 0.05, 1]], [[-0.85, 0.25, 0.32], [0.34, 0.1, 0.94]],
        [[-0.8, 0.2, 0.35], [0.34, 0.1, 0.94]], [[-0.3, -0.5, 0], [0, 0, 1]], SET),
    }, hipsAt(p, [0.04, 0], [0.06, -0.02], [0.03, 0], [0.02, 0.02], [0.02, 0.02], [0.05, 0], [0.04, 0]));
  }

  // Spinning hook kick: the body turns clockwise, back to the target, the
  // head whipping round first to spot it; the right leg rises straight out of
  // the turn and the heel reaps across, the knee hooking as it passes.
  {
    const at = [0, 0.12, 0.25, 0.35, 0.45, 0.6, 0.8, 1];
    add('kickSpinHook', 1.0, at, {
      chest: [G_CHEST, [4, 12, 0], [10, -10, 8], [16, -10, 14], [18, 0, 16], [10, 0, 8], [4, 0, 0], G_CHEST],
      head: [G_HEAD, [0, 0, 0], [-4, -60, 0], [-10, -80, -8], [-12, -60, -10], [-6, -30, -4], [0, 0, 0], G_HEAD],
      ...arm('R', GUARD_R, GUARD_R, [[-0.35, -0.3, 0.1]], [[-0.4, -0.45, -0.1]], [[-0.4, -0.45, -0.2]], [[-0.35, -0.3, 0.1]], GUARD_R, GUARD_R),
      ...arm('L', GUARD_L, GUARD_L, TUCK_L, TUCK_L, TUCK_L, TUCK_L, GUARD_L, GUARD_L),
    }, {
      hips: [G_HIPS, [3, -15, 0], [4, -100, -6], [8, -190, -16], [10, -270, -24], [6, -320, -12], [3, -360, 0], [3, -385, 0]],
      ...leg('L', SET, SET, [[0.1, -0.87, 0.05]], [[0.25, -0.84, 0]], [[0.35, -0.82, 0]], [[0.2, -0.86, 0]], [[0.05, -0.88, 0.05]], SET),
      ...leg('R', SET, LOADED, [[-0.3, -0.7, -0.2]], [[-0.7, -0.3, -0.35], [0, -0.3, 1]],
        [[-0.85, 0.35, -0.15], [0, -0.2, 1]], [[-0.5, 0.1, -0.45]], [[-0.15, -0.85, -0.3]], SET),
    }, hipsAt(p, [0.04, 0], [0.07, 0], [0.04, 0.02], [0.03, 0.04], [0.02, 0.06], [0.03, 0.06], [0.06, 0.04], [0.04, 0]));
  }

  // Push kick: the rear knee comes straight up to the chest, the body leans
  // back over the standing leg, and the sole is driven flat through the
  // target — the kick that sends a man backwards off a ledge.
  {
    const at = [0, 0.25, 0.38, 0.45, 0.6, 0.8, 1];
    add('kickPush', 0.8, at, {
      chest: [G_CHEST, [4, 0, 0], [8, 10, 0], [10, 14, 0], [10, 12, 0], [6, 5, 0], G_CHEST],
      head: [G_HEAD, [0, 16, 0], [4, 4, 0], [8, 0, 0], [8, 0, 0], [2, 10, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.3, -0.1, 0.3]], [[-0.4, -0.4, -0.15]], [[-0.4, -0.45, -0.25]], [[-0.4, -0.4, -0.2]], GUARD_R, GUARD_R),
      ...arm('L', GUARD_L, GUARD_L, [[0.3, -0.05, 0.35]], [[0.3, -0.05, 0.35]], [[0.3, -0.05, 0.35]], GUARD_L, GUARD_L),
    }, {
      hips: [G_HIPS, [0, -15, 0], [-14, -5, 0], [-18, 0, 0], [-16, 0, 0], [-4, -15, 0], G_HIPS],
      ...leg('L', SET, LOADED, [[0, -0.86, -0.22]], [[0, -0.85, -0.28]], [[0, -0.85, -0.26]], [[0, -0.87, -0.05]], SET),
      ...leg('R', SET, [[-0.1, -0.35, 0.3], [0, 0.3, 1]], [[-0.1, -0.2, 0.25], [0, 1, 0.6]], [[-0.05, -0.15, 0.9], [0, 1, 0]],
        [[-0.05, -0.2, 0.85], [0, 1, 0.2]], [[-0.1, -0.5, 0.3], [0, 0.3, 1]], SET),
    }, hipsAt(p, [0.04, 0], [0.05, 0], [0.03, 0.02], [0.02, 0.12], [0.02, 0.14], [0.05, 0.08], [0.04, 0]));
  }

  // Tornado kick: a turn and a crouch, a leap spinning counter-clockwise off
  // the lead foot with the left knee tucked, and the right roundhouse thrown
  // at the top of the jump a full turn later; the spin carries on through the
  // landing to face the target again. No two keys of the turn sit half a
  // turn apart, so every leg of it goes the way it spins.
  {
    const at = [0, 0.12, 0.25, 0.35, 0.45, 0.6, 0.75, 0.9, 1];
    add('kickTornado', 1.1, at, {
      chest: [G_CHEST, [8, -20, 0], [4, 10, 0], [0, 0, 8], [-4, -20, 14], [-2, -10, 8], [4, 0, 0], [6, 0, 0], G_CHEST],
      head: [G_HEAD, [0, 30, 0], [0, 40, 0], [0, 30, -6], [2, -20, -10], [0, -10, -6], [0, 0, 0], [0, 10, 0], G_HEAD],
      ...arm('R', GUARD_R, [[-0.4, -0.35, -0.15]], [[-0.65, 0.1, 0.1]], [[-0.55, 0.2, 0.05]], [[-0.4, -0.45, -0.2]],
        [[-0.4, -0.3, 0.1]], [[-0.3, -0.2, 0.3]], GUARD_R, GUARD_R),
      ...arm('L', GUARD_L, [[0.3, -0.4, 0.1]], [[0.65, 0.1, 0.1]], [[0.35, -0.05, 0.3]], TUCK_L, [[0.35, -0.1, 0.3]],
        [[0.3, -0.1, 0.35]], GUARD_L, GUARD_L),
    }, {
      hips: [G_HIPS, [6, -10, 0], [2, 150, 0], [0, 290, -8], [-4, 430, -20], [-2, 470, -10], [2, 560, 0], [3, 650, 0], [3, 695, 0]],
      ...leg('L', SET, [[0, -0.72, 0.15]], [[0, -0.8, 0.1]], [[0.1, -0.45, -0.1]], [[0.2, -0.5, -0.1]],
        [[0.1, -0.6, 0.05]], [[0.05, -0.7, 0.1]], [[0, -0.85, 0.05]], SET),
      ...leg('R', SET, [[0, -0.75, -0.3]], [[0, -0.85, -0.2]], [[-0.5, 0, 0.1], [0.2, 0.05, 1]],
        [[-0.85, 0.25, 0.32], [0.34, 0.1, 0.94]], [[-0.3, -0.5, 0.1]], [[-0.05, -0.75, -0.15]], [[0, -0.85, -0.25]], SET),
    }, hipsAt(p, [0.04, 0], [0.18, 0], [0.06, 0.02], [-0.22, 0.05], [-0.28, 0.08], [-0.15, 0.08], [0.16, 0.06], [0.08, 0.02], [0.04, 0]));
  }
  return out;
}
