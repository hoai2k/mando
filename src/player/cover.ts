import * as THREE from 'three';
import type { FrameInput } from '../core/input';
import { clamp, damp, dampAngle, yawBasis } from '../core/math';
import { audio } from '../core/audio';
import { applyGravity } from '../core/body';
import type { Game } from '../game/game';
import { COVER_STAND_OVER, FUEL_SECONDS, JUMP_VEL, SPRINT_REFILL, type Player } from './player';

/**
 * Hugging a box, RDR2-style: slide along the face with the stick, hold aim
 * to lean out past the corner and shoot, release to tuck back in. Jump,
 * dash, melee, pressing the cover button again, or pushing away all leave.
 *
 * Moved out of player.ts the way `saberthrow.ts` was, to keep one state's
 * rules in one file. It runs *as* the player — `Player.updateInCover` calls
 * it with its own `this` — so the body reads exactly as it did as a method,
 * and the player state it drives is the player's own.
 */
export function updateInCover(this: Player, dt: number, input: FrameInput, game: Game, realDt: number): void {
  const anim = this.char.animator!;
  // The gauges the open-field path owns still have to tick here, because this
  // branch returns before reaching them. Ducking behind a crate used to leave
  // jetpack fuel and sprint energy frozen exactly where they stood — and,
  // worse, froze the shield: take cover with block held and `blockRaise`
  // stayed pinned at 1, so `shieldCollider` kept reflecting bolts for as long
  // as the player stayed tucked, draining nothing and leaving peek-fire
  // available. Cover is made of real geometry; it does not also get a shield.
  this.blocking = false;
  this.blockRaise = damp(this.blockRaise, 0, 14, dt);
  this.char.setBlock(this.blockRaise);
  this.dashArmed = false;
  this.sprintLatched = false;
  this.sprinting = false;
  this.thrusting = 0;
  this.wasThrusting = false;
  this.char.setThrust(0);
  audio.setJetpackThrust(this.slot, 0);
  this.sprintRefillDelay -= dt;
  if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
  // tucked against a box is a grounded state, so fuel comes back at the
  // grounded rate — catching your breath behind cover is the point of it
  this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.55));

  const c = this.cover!;
  // Cover has to stand a head over you before it is worth standing behind.
  // At or below your own height, the body ducks under its line.
  const crouched = c.top - this.position.y < this.height + COVER_STAND_OVER;
  // face geometry: n = outward normal, t = tangent along the face
  const tx = -c.nz, tz = c.nx;
  const facePlane = c.plane;
  const hugDist = this.radius + 0.22;
  const { tMin, tMax } = c;
  const myT = c.nx !== 0 ? this.position.z : this.position.x;

  // ---- exits ----
  const { fwdX, fwdZ, rightX, rightZ } = yawBasis(this.cam.yaw);
  const wishX = fwdX * input.moveY + rightX * input.moveX;
  const wishZ = fwdZ * input.moveY + rightZ * input.moveX;
  const away = wishX * c.nx + wishZ * c.nz; // pushing off the wall
  this.pushAwayTime = away > 0.6 ? this.pushAwayTime + dt : 0;
  let leave = input.slamPressed || input.dashPressed || input.meleePressed || this.pushAwayTime > 0.18;
  if (input.jumpPressed) {
    leave = true;
    this.velocity.y = JUMP_VEL;
    this.grounded = false;
  }
  if (leave) {
    this.cover = null;
    this.peeking = false;
    // a melee press still swings: fall through to the normal path next frame
    this.syncVisual(dt, game);
    anim.update(dt);
    this.cam.update(realDt, this.position, game.board.physics, { aiming: input.aimHeld, speed: 0, dashing: false });
    return;
  }

  // ---- desired spot on the face ----
  const wasPeeking = this.peeking;
  this.peeking = input.aimHeld && this.weapon === 'blaster';
  let targetT: number;
  if (this.peeking) {
    // Pick the corner: prefer the side the camera leans toward, but when a
    // target is locked, take whichever corner has a clear shot to it —
    // boxes often sit in rows (crate stacks), and leaning out into the
    // neighbouring crate is a peek wasted. Re-checked a few times a second
    // while the aim is held, since targets move; the cone is cast from the
    // chest, not the camera, which can be a frame stale on the first peek.
    this.peekRecheck -= dt;
    if (!wasPeeking || this.peekSide === 0 || this.peekRecheck <= 0) {
      this.peekRecheck = 0.35;
      const aim = this.cam.aimDir(new THREE.Vector3());
      const along = aim.x * tx + aim.z * tz;
      let side = this.peekSide !== 0 ? this.peekSide
        : Math.abs(along) > 0.25 ? Math.sign(along)
        : (myT - (tMin + tMax) / 2 >= 0 ? 1 : -1);
      const chest = this.position.clone();
      chest.y += 1.4;
      const lock = this.aimAssistTarget(game, aim, chest, 0.9, 70);
      if (lock) {
        const clear = (sd: number): boolean => {
          const pt = (sd > 0 ? tMax : tMin) + sd * (this.radius + 0.55);
          const from = c.nx !== 0
            ? new THREE.Vector3(facePlane + c.nx * hugDist, this.position.y + 1.4, pt)
            : new THREE.Vector3(pt, this.position.y + 1.4, facePlane + c.nz * hugDist);
          const to = lock.position.clone();
          to.y += lock.height * 0.55;
          const dir = to.sub(from);
          const dist = dir.length();
          return !game.board.physics.raycast(from, dir.normalize(), dist);
        };
        if (!clear(side) && clear(-side)) side = -side;
      }
      this.peekSide = side;
    }
    targetT = (this.peekSide > 0 ? tMax : tMin) + this.peekSide * (this.radius + 0.55);
  } else {
    this.peekSide = 0;
    // tucked: slide along the face with the stick, staying behind the box
    const slide = wishX * tx + wishZ * tz;
    targetT = clamp(myT + slide * 3.6 * dt * 12, tMin + 0.2, tMax - 0.2);
  }
  let dx: number, dz: number;
  if (c.nx !== 0) {
    dx = (facePlane + c.nx * hugDist) - this.position.x;
    dz = targetT - this.position.z;
  } else {
    dx = targetT - this.position.x;
    dz = (facePlane + c.nz * hugDist) - this.position.z;
  }
  this.velocity.x = clamp(dx * 12, -6.5, 6.5);
  this.velocity.z = clamp(dz * 12, -6.5, 6.5);
  applyGravity(this.velocity, game.board, this.position, dt);
  const res = game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
  this.grounded = res.grounded;
  this.wasGrounded = res.grounded;
  if (!res.grounded && this.position.y < (game.board.voidY ?? game.board.physics.killY)) {
    this.cover = null; // the floor is gone; back to normal rules
  }

  // out of bounds / hazard (same rules as the open field)
  if (this.position.y < game.board.physics.killY) this.damage(999, this.position);
  this.applyHazards(dt, game);

  // ---- combat: shoot only while leaning out ----
  this.lockedOn = this.peeking &&
    !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
  const masked: FrameInput = {
    ...input,
    shootHeld: input.shootHeld && this.peeking,
    rocketPressed: input.rocketPressed && this.peeking,
    meleePressed: false,
    // no swinging and no rummaging through the loadout from behind cover
    meleeSwapPressed: false,
    rangedSwapPressed: false,
  };
  this.updateCombat(dt, masked, game);

  // ---- facing & pose ----
  const targetYaw = this.peeking ? this.cam.yaw : Math.atan2(c.nx, c.nz);
  this.facingYaw = dampAngle(this.facingYaw, targetYaw, 14, dt);
  // Behind cover shorter than you are, get under its line. Standing at full
  // height behind a crate that comes up to your chest is not cover, it is a
  // man standing next to a crate — which is what a playtest saw. The crouch
  // holds while leaning out too: the peek goes round the corner, not over
  // the top, so there is nothing to stand up for.
  anim.play('lower', crouched ? 'coverLower' : 'idleLower');
  if (this.meleeTimer <= 0) anim.play('upper', this.peeking ? this.gunAimClip : this.sabersDrawn ? (this.characterId === 'maris' ? 'tonfaIdleUpper' : this.characterId === 'maul' ? 'staffIdleUpper' : 'saberIdleUpper') : 'idleUpper');

  this.syncVisual(dt, game);
  anim.update(dt);
  this.cam.update(realDt, this.position, game.board.physics, {
    aiming: input.aimHeld, speed: Math.hypot(this.velocity.x, this.velocity.z), dashing: false,
  });
}
