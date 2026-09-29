import type * as THREE from 'three';
import type { Animator } from '../anim/animator';
import { UNARMED_MOVES } from '../anim/unarmed';
import { clench, fistModel } from './fistRig';

/**
 * When a fighter's hands close in play.
 *
 * The fist rig (`fistRig.ts`) can curl any sculpt's fingers; this decides when
 * the game does. A hand closes when it has something to close on or to hit
 * with: the hand holding the gun (both of them when the support hand is on the
 * foregrip), both hands on a ride's grips, both in a bare-handed fight, and
 * both on the move, the way a runner's hands close. Anything else leaves the
 * hands as sculpted.
 *
 * Only the sculpts whose fists have been looked at and passed do this: some
 * everywhere, and some only on a fighter the game drives, where the camera is
 * never close enough for a rough fist to show.
 */
export const FISTS_IN_PLAY: Readonly<Record<string, 'all' | 'npc'>> = {
  din: 'all', paz: 'all', bossk: 'all', ig11: 'all',
  bokatan: 'npc', nikto: 'npc', pirate_melee: 'npc', wookiee_enforcer: 'npc',
};

/** the aims that put both hands on the gun: the carbine's support hand, or a pistol in each */
const BOTH_ON_GUN = new Set(['aimUpper', 'dualPistolAimUpper']);
/** the one-handed enemy aim: only the gun hand closes */
const GUN_HAND_ONLY = new Set(['enemyAimUpper']);
/** hands on a ride's grips */
const ON_GRIPS = new Set(['rideUpper', 'driveUpper']);
/** travelling on the feet: the gaits, each way round */
const ON_THE_MOVE = new Set([
  'runLower', 'sprintLower', 'walkLower', 'strafeLower', 'strafeLLower', 'backpedalLower', 'crouchWalkLower',
]);
/** every bare-handed strike (`anim/unarmed.ts`) */
const STRIKES = new Set(UNARMED_MOVES.map((m) => m.upper));

/** what the caller knows that the clips do not */
export interface FistCue {
  /** a gun is in the right hand */
  gun?: boolean;
  /** in a bare-handed fight: between strikes, the guard stays closed */
  fight?: boolean;
}

/** How closed each hand should be (right, left), 0 open to 1 a fist, for what the body is playing. */
export function fistTargets(anim: Pick<Animator, 'playing'> | null, cue: FistCue = {}): [number, number] {
  const upper = anim?.playing('upper') ?? null;
  const lower = anim?.playing('lower') ?? null;
  if (cue.fight || (upper && STRIKES.has(upper))) return [1, 1];
  if (upper && (BOTH_ON_GUN.has(upper) || ON_GRIPS.has(upper))) return [1, 1];
  if (lower && ON_THE_MOVE.has(lower)) return [1, 1];
  if (upper && GUN_HAND_ONLY.has(upper)) return [1, 0];
  return [cue.gun ? 1 : 0, 0];
}

/** Whether the game closes this character's hands itself; `npc` for a fighter it drives. */
export function fistsInPlay(root: THREE.Object3D, npc: boolean): boolean {
  const model = fistModel(root);
  const tier = model ? FISTS_IN_PLAY[model] : undefined;
  return tier === 'all' || (tier === 'npc' && npc);
}

/** how fast a hand closes or opens (1/s): a fist is made in about a tenth of a second */
const CLOSE_RATE = 18;

/**
 * One character's hands, eased toward what `fistTargets` asks for each frame.
 * A no-op for a sculpt that is not passed for play (or not loaded yet), so
 * every character can carry one.
 */
export class FistDriver {
  private right = 0;
  private left = 0;
  /** decided once the sculpt's fingers are found; until then looked for twice a second */
  private allowed: boolean | null = null;
  private look = 0;
  constructor(readonly root: THREE.Object3D, private readonly npc: boolean) {}

  update(dt: number, anim: Pick<Animator, 'playing'> | null, cue: FistCue = {}): void {
    if (this.allowed === null) {
      this.look -= dt;
      if (this.look > 0) return;
      this.look = 0.5;
      if (fistModel(this.root) === null) return;
      this.allowed = fistsInPlay(this.root, this.npc);
    }
    if (!this.allowed) return;
    const [r, l] = fistTargets(anim, cue);
    const k = dt > 0 ? 1 - Math.exp(-CLOSE_RATE * dt) : 1;
    this.right += (r - this.right) * k;
    this.left += (l - this.left) * k;
    clench(this.root, this.right, this.left);
  }
}
