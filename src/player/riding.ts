import * as THREE from 'three';
import type { FrameInput } from '../core/input';
import { damp, dampAngle } from '../core/math';
import { audio } from '../core/audio';
import { hazardAt } from '../world/board';
import { hipsOverFeet, stanceRise } from '../game/vehicleAnchors';
import type { Game } from '../game/game';
import { COYOTE_TIME, FUEL_SECONDS, JUMP_VEL, SPRINT_REFILL, type Player } from './player';

/**
 * In the saddle: input drives the vehicle and the rider sits its seat —
 * exposed, since a mounted rider takes what is aimed at them (only a
 * quarter of it bleeds into the ride) unless the ride's own deflector is up
 * over both of them. Y steps off beside a parked ride and bails out of a
 * moving one; either way a ride left with speed in it rolls on driverless
 * until it stops.
 *
 * Moved out of player.ts the way `saberthrow.ts` was, to keep one state's
 * rules in one file. It runs *as* the player — `Player.updateRiding` calls it
 * with its own `this` — so the body reads exactly as it did as a method, and
 * the player state it drives is the player's own.
 */
export function updateRiding(this: Player, dt: number, input: FrameInput, game: Game, realDt: number): void {
  const anim = this.char.animator!;
  const v = this.vehicle!;
  // A machine takes both hands — bars, tiller, controls — but an animal
  // takes one: reins in the off hand, blaster in the other. So a mount is
  // the one ride you can fight from, and every ride still stows the rocket
  // rack and the blade (X is the animal's own charge).
  const armed = !!v.def.living && this.alive && !this.meleeOnly;
  // gauges keep ticking and the pack stays cold — mirror of the cover branch
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
  this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.55));
  this.sprintRefillDelay -= dt;
  if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
  this.snareTimer -= dt;
  this.meleeTimer = 0;
  this.meleeHitPending = 0;
  this.swingDur = 0;
  this.slamming = false;
  this.swimming = false;
  this.wading = false;
  this.waterTime = 0; // the hull is between you and whatever hunts the water
  this.aiming = armed && input.aimHeld;
  this.lockedOn = false;
  this.cover = null;

  // ---- dismount ----
  // Y is the only exit now that A is the accelerator, and it reads the
  // speedometer: step off a parked ride, bail out of a moving one. Bailing
  // keeps the ride's momentum and pops you up into a jetpack chain, which
  // is both the fun exit and the one you want when the hull is about to go.
  if (input.slamPressed || !v.alive) {
    const carry = v.vel.clone();
    const hop = Math.hypot(carry.x, carry.z) > 6;
    v.dropRider(this);
    this.velocity.copy(carry);
    if (hop) {
      this.velocity.y = JUMP_VEL;
      game.particles.dustPuff(this.position, 6);
    } else {
      // step clear sideways so we don't stand inside the newly parked box
      this.position.x += Math.cos(v.yaw) * (v.def.radius + 0.75);
      this.position.z -= Math.sin(v.yaw) * (v.def.radius + 0.75);
    }
    this.grounded = false;
    audio.setEngine(this.slot, 0);
    this.syncVisual(dt, game);
    anim.update(dt);
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: false, speed: Math.hypot(carry.x, carry.z), dashing: false,
    });
    return;
  }

  // K3 (docs/SECTIONS_IMPLEMENTATION.md §3): the pillion works the weapons
  // and the driver drives — one ride, two riders, each with their own frame
  if (v.pillion === this) v.ridePillion(dt, input, this, game);
  else v.drive(dt, input, this, game);
  // a crash or a ram chip can end the ride inside drive(): destroy() has
  // already thrown us clear — settle the visuals and let next frame be normal
  if (!this.vehicle) {
    this.syncVisual(dt, game);
    anim.update(dt);
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: false, speed: Math.hypot(this.velocity.x, this.velocity.z), dashing: false,
    });
    return;
  }

  // sit the seat, carry the ride's momentum (the camera paces off velocity)
  v.seatWorld(this.position, stanceRise(v.def.stance, hipsOverFeet(this.char)), this);
  this.velocity.copy(v.vel);
  this.grounded = true;
  this.wasGrounded = true;
  this.coyote = COYOTE_TIME;

  // kill zones still end the rider (the hull is not armour against a sarlacc);
  // burn zones cook the hull instead
  const hzd = hazardAt(game.board, this.position);
  if (hzd.kill) { this.takenByHazard(hzd.by ? hzd.by.center : this.position); return; }
  if (hzd.dps > 0 && this.vehicle) v.damage(hzd.dps * dt, this.position, -1);
  if (!this.vehicle) return; // the burn just finished the ride

  // ---- firing from the saddle ----
  // The same combat path the feet use, with the melee swing masked out (X
  // charges the animal instead) and the ordnance with it: the free hand
  // holds a blaster, not a launcher.
  if (armed) {
    this.lockedOn = this.weapon === 'blaster' &&
      !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
    this.updateCombat(dt, {
      ...input, meleePressed: false, rocketPressed: false, slamPressed: false,
    }, game);
  }
  // The chest turns to the camera while you are working the gun and back to
  // the animal's nose when you are not — a rider twists in the saddle, and
  // the bolts have to leave where the crosshair is looking.
  const gunUp = armed && (input.aimHeld || input.shootHeld
    || (this.weapon === 'blaster' && this.fireCd > -0.6));
  // K3: a swing from the saddle turns the body to its flank, a gunner turns with the gun
  this.facingYaw = dampAngle(this.facingYaw, v.riderFacing(this) ?? (gunUp ? this.cam.yaw : v.yaw + v.seatYaw), gunUp ? 14 : 10, dt);
  // three ways to be carried, three poses: on your feet at a tiller, sat in
  // a seat with the legs forward, or straddling a saddle over the hull
  const stance = v.def.stance;
  const lower = stance === 'stand' ? 'idleLower' : stance === 'seated' ? 'driveLower' : 'rideLower';
  const upper = stance === 'stand' ? 'idleUpper' : stance === 'seated' ? 'driveUpper' : 'rideUpper';
  anim.play('lower', lower);
  if (this.meleeTimer <= 0) {
    anim.play('upper', gunUp ? this.gunAimClip : upper);
  }

  this.syncVisual(dt, game);
  anim.update(dt);
  if (this.char.rig) v.poseLegs(this.char.rig);
  // K3: a swing takes the hands off the bars, and a pillion has none to hold
  if (!v.swinging(this) && v.pillion !== this) this.handsToControls(v, gunUp);
  this.frameCamera();
  const speed = Math.hypot(v.vel.x, v.vel.z);
  this.cam.update(realDt, this.position, game.board.physics, {
    aiming: this.aiming, speed, dashing: false, flying: false, climb: 0,
    velX: v.vel.x, velZ: v.vel.z,
  });
  // K3: a turret's gunner sees down the barrels (and gets the crosshair)
  if (v.def.turret) { this.aiming = true; v.applySight(this); }
}
