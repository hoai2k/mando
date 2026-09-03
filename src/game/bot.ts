import * as THREE from 'three';
import type { FrameInput } from '../core/input';
import type { Combatant } from '../enemies/enemy';
import type { Player } from '../player/player';
import type { Game } from './game';
import { clamp } from '../core/math';

/**
 * The AI behind a bot fighter.
 *
 * A bot is not a special kind of combatant: it is a `Player`, with the same
 * body, the same weapons and the same rules as a human's, and this is the hand
 * on its controller. So everything it does it does by filling in a
 * `FrameInput` — the same struct a gamepad produces — and the player
 * controller then applies it exactly as it would anyone's. Nothing in the
 * match has to know the difference, which is what keeps PvP honest: a bot
 * cannot turn faster than a stick, shoot through its own cooldown, or move
 * where a player could not.
 *
 * The behaviour is deliberately plain — close to a range, keep circling,
 * shoot when the sights are near enough to the target, swing when it is close
 * enough to touch, and jump out of trouble now and then. It plays a competent
 * opponent, not a superhuman one.
 */

/** how fast a bot may swing its aim, radians a second — a human's stick, roughly */
const TURN_RATE = 4.2;
/** it stops closing here and starts circling, in metres */
const HOLD_RANGE = 14;
/** closer than this and it backs off rather than crowding */
const CLOSE_RANGE = 7;
/** inside this a blade is the answer, whatever else it was doing */
const MELEE_RANGE = 3.2;
/** how near the sights must be to the target before the trigger comes down */
const FIRE_CONE = 0.16;
/** it cannot see or care past this */
const NOTICE = 70;

const _to = new THREE.Vector3();
const _aim = new THREE.Vector3();

const blank = (): FrameInput => ({
  moveX: 0, moveY: 0, lookX: 0, lookY: 0,
  jumpHeld: false, jumpPressed: false, dashPressed: false, sprintHeld: false,
  shootHeld: false, aimHeld: false, meleePressed: false, rocketPressed: false,
  zoomHeld: false, zoomDelta: 0, blockHeld: false,
  throttleHeld: false, brakeHeld: false, slamPressed: false,
  meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false,
});

/** shortest signed way round from `a` to `b` */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class BotBrain {
  /** which way it is currently circling; flips now and then so it is not a carousel */
  private strafe = Math.random() < 0.5 ? -1 : 1;
  private strafeFor = 0;
  /** trigger discipline: bursts with gaps, rather than a held beam */
  private burst = 0;
  private rest = 0;
  private meleeCd = 0;
  private jumpCd = 2 + Math.random() * 3;
  /** where its aim is wandering this moment, so it is not pixel-perfect */
  private driftT = Math.random() * 10;

  constructor(private readonly skill = 0.8) {}

  /** the target worth fighting: the nearest living hostile inside NOTICE */
  private target(p: Player, game: Game): Combatant | null {
    let best: Combatant | null = null;
    let bestD = NOTICE * NOTICE;
    for (const c of game.hostilesFor(p)) {
      if (!c.alive) continue;
      const d = c.position.distanceToSquared(p.position);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  think(p: Player, game: Game, dt: number): FrameInput {
    const input = blank();
    this.strafeFor -= dt;
    this.meleeCd -= dt;
    this.jumpCd -= dt;
    this.driftT += dt;
    if (this.strafeFor <= 0) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.strafeFor = 1.2 + Math.random() * 2.2;
    }

    const target = this.target(p, game);
    if (!target) {
      // nobody about: wander forward so a bot is never a statue on the board
      input.moveY = 0.35;
      input.lookX = Math.sin(this.driftT * 0.4) * 0.6 * dt;
      return input;
    }

    // ---- aim ----
    // at the chest, not the boots, and never instantly: the sights swing at a
    // stick's pace, and a little wander keeps them honestly imperfect
    _to.copy(target.position).sub(p.position);
    _to.y += (target.hitHeight ?? target.height) * 0.55 - p.height * 0.5;
    const dist = Math.hypot(_to.x, _to.z);
    const wobble = (1 - this.skill) * 0.09;
    const wantYaw = Math.atan2(_to.x, _to.z) + Math.sin(this.driftT * 1.7) * wobble;
    const wantPitch = Math.atan2(_to.y, Math.max(0.3, dist)) + Math.cos(this.driftT * 1.3) * wobble;
    const dYaw = wrap(wantYaw - p.cam.yaw);
    const dPitch = wantPitch - p.cam.pitch;
    const step = TURN_RATE * dt;
    input.lookX = clamp(dYaw, -step, step);
    input.lookY = clamp(dPitch, -step, step);

    // ---- feet ----
    // Move in the frame the camera is looking down, which is the frame a human
    // stick moves in: forward closes, sideways circles.
    const range = target.position.distanceTo(p.position);
    input.moveY = range > HOLD_RANGE ? 1 : range < CLOSE_RANGE ? -0.7 : 0.15;
    input.moveX = this.strafe * (range < HOLD_RANGE * 1.5 ? 0.85 : 0.3);
    input.sprintHeld = range > HOLD_RANGE * 1.6;

    const onTarget = Math.abs(dYaw) < FIRE_CONE && Math.abs(dPitch) < FIRE_CONE * 2;

    // ---- blade ----
    if (range < MELEE_RANGE && this.meleeCd <= 0) {
      input.meleePressed = true;
      this.meleeCd = 0.8 + Math.random() * 0.5;
      return input;
    }

    // ---- trigger ----
    // A gun it does not have is a gun it does not pull: a melee-only fighter
    // (Ventress, whose ranged weapon is a thrown blade) still presses the
    // trigger, and the controller decides what that means for her.
    if (this.rest > 0) {
      this.rest -= dt;
    } else if (this.burst > 0) {
      this.burst -= dt;
      input.shootHeld = onTarget;
      input.aimHeld = range > MELEE_RANGE * 2;
      if (this.burst <= 0) this.rest = 0.35 + Math.random() * 0.5 * (1 - this.skill);
    } else if (onTarget && range < 55) {
      this.burst = 0.35 + Math.random() * 0.4;
    }

    // ---- a hop, now and then ----
    // Never while shooting: a bot that jumps mid-burst throws its own aim off,
    // and one that never jumps is a target standing still.
    if (this.jumpCd <= 0 && !input.shootHeld) {
      input.jumpPressed = true;
      input.jumpHeld = true;
      this.jumpCd = 3 + Math.random() * 4;
    }
    return input;
  }
}
