import * as THREE from 'three';
import { gravityScale, hazardAt, type Board } from '../world/board';
import type { GroundHit } from './physics';

/**
 * The body rules every capsule on the board shares — the player's and every
 * enemy's alike: what gravity pulls on it, what the floor under it does to it,
 * and what a hit shoves it with.
 *
 * These lived twice (`Player` and `Enemy`) and had drifted apart: the burn
 * tick ran at 0.4 s on one side and 0.5 s on the other, gravity was 26 in one
 * file and a hard-coded 24 (and 22 for corpses) in the other. Where the two
 * disagreed the player's number is the one kept here — it is the tuned one,
 * the one a player has been feeling since the game had a player — and each
 * such case says so at the constant. The one number that stays different for
 * hostiles is drowning (`DROWN_DPS`), which exists so a swimming enemy dies;
 * the player swims on purpose and is never drowned by it.
 */

/** the fall every body takes, before the board's local field scales it */
export const GRAVITY = 26;

/**
 * Seconds between burn ticks. Damage accrues continuously and lands in beats,
 * so the hurt feedback reads as heat rather than a buzzer, and the alert /
 * flash machinery in `damage()` isn't hammered every frame.
 *
 * Unified: the player ticked at 0.4 s, the enemy at 0.5 s — the player's is
 * kept (same total damage per second either way, one beat sooner).
 */
export const BURN_TICK = 0.4;

/** a tick smaller than this is held over rather than delivered */
export const BURN_MIN = 0.5;

/**
 * Extra damage per second on a body whose head is under water. Deliberately
 * hostile-only: it is what kills an enemy that walks into the sea, while the
 * player's sealed helmet is the whole point of the swimming mode.
 */
export const DROWN_DPS = 15;

/** the accumulator a burning body carries between ticks */
export interface BurnState {
  /** damage banked since the last tick landed */
  acc: number;
  /** seconds left of the current beat */
  tick: number;
}

export const newBurnState = (): BurnState => ({ acc: 0, tick: 0 });

/**
 * The gravity acting on a body where it stands (or flies).
 *
 * Floored a little above zero for *bodies*, which is not the same rule the
 * player gets. A space board's open volume pulls at nothing, and that is the
 * point of it — but a hostile shoved off a gantry into true zero-g hangs
 * there forever, alive, out of reach, and a wave that never clears is a run
 * that cannot be finished. The floor is small enough to be invisible over the
 * seconds a fight lasts and large enough that anything knocked into the dark
 * eventually reaches the kill plane and is cleaned up.
 */
const BODY_MIN_G = 0.05;

export function bodyGravity(board: Board, at: THREE.Vector3): number {
  return GRAVITY * Math.max(BODY_MIN_G, gravityScale(board, at.x, at.y, at.z));
}

/** one step of falling: the board's pull, applied to a velocity */
export function applyGravity(vel: THREE.Vector3, board: Board, at: THREE.Vector3, dt: number, scale = 1): void {
  vel.y -= bodyGravity(board, at) * dt * scale;
}

/** gravity for this step, then the capsule move it produces */
export function stepBody(
  board: Board, pos: THREE.Vector3, radius: number, height: number,
  vel: THREE.Vector3, dt: number,
): GroundHit {
  applyGravity(vel, board, pos, dt);
  return board.physics.moveCapsule(pos, radius, height, vel, dt);
}

/**
 * What the board's floor does to a body standing on it: kill zones end it,
 * burn zones tick damage in beats, and (for anything that breathes) deep water
 * drowns.
 *
 * `apply` takes the damage — the caller owns what a hit means for it, since a
 * player's `damage()` wants the `dot` flag and an enemy's wants none.
 * `opts.drownAt` is the height above `pos` that has to be under the waterline
 * for the body to be drowning; leave it out for anything that does not drown.
 */
export function tickHazards(
  burn: BurnState,
  board: Board,
  pos: THREE.Vector3,
  dt: number,
  apply: (amount: number, kill: boolean) => void,
  opts: { drownAt?: number; immune?: boolean } = {},
): void {
  const hzd = hazardAt(board, pos);
  if (hzd.kill) { apply(0, true); return; }
  if (opts.immune) return;
  let dps = hzd.dps;
  if (opts.drownAt !== undefined) {
    const wY = board.waterY;
    if (wY !== undefined && pos.y + opts.drownAt < wY) dps += DROWN_DPS;
  }
  if (dps <= 0) return;
  burn.acc += dps * dt;
  burn.tick -= dt;
  if (burn.tick > 0) return;
  burn.tick = BURN_TICK;
  if (burn.acc > BURN_MIN) { apply(burn.acc, false); burn.acc = 0; }
}

const _knock = new THREE.Vector3();

/**
 * Shove a body away from `from`. `lift` is the vertical impulse in m/s (the
 * caller scales it: an enemy's knockback takes a fraction of the force, the
 * player's is a flat pop), and `fallback` decides a point-blank hit — a
 * hostile is shoved along +Z so a hit at zero distance still reads, while the
 * player is left where they are, as their inline path always did.
 *
 * The impulse alone is not the whole move: on the enemy side the stagger
 * window that stops the AI steering it straight back matters as much, and that
 * stays with `Enemy.knockback`.
 */
export function applyKnockback(
  vel: THREE.Vector3, pos: THREE.Vector3, from: THREE.Vector3,
  force: number, lift = 0, fallback = false,
): void {
  _knock.subVectors(pos, from).setY(0);
  if (_knock.lengthSq() < 1e-6) {
    if (!fallback) return;
    _knock.set(0, 0, 1);
  }
  _knock.normalize();
  vel.addScaledVector(_knock, force);
  vel.y += lift;
}
