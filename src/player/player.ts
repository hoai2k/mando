import * as THREE from 'three';
import { buildMandalorian, type MandoId, type PlayerCharacter } from '../characters/mandalorians';
import { ThirdPersonCamera } from '../core/camera';
import type { FrameInput } from '../core/input';
import { clamp, damp, dampAngle } from '../core/math';
import { audio } from '../core/audio';
import type { Game } from '../game/game';
import type { Enemy } from '../enemies/enemy';

const GRAVITY = 26;
const RUN_SPEED = 9.2;
const AIR_CONTROL = 7.5;
const JUMP_VEL = 10;
const JET_ACCEL = 34;
const JET_MAX_UP = 11.5;
const FUEL_SECONDS = 3.4;
const DASH_SPEED = 19;
const ROCKET_CD = 12;

export class Player {
  char: PlayerCharacter;
  cam: ThirdPersonCamera;
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  radius = 0.45;
  height = 1.75;
  hp = 100;
  maxHp = 100;
  fuel = 1;
  weapon: 'blaster' | 'gaffi' = 'blaster';
  alive = true;
  kills = 0;
  team = 0;

  grounded = false;
  private coyote = 0;
  private fireCd = 0;
  private thrusting = 0;
  private dashTimer = 0;
  private dashCd = 0;
  private dashDir = new THREE.Vector3();
  private slamming = false;
  private meleeStep = 0;
  private meleeTimer = 0;
  private meleeComboWindow = 0;
  private meleeHitPending = 0;
  private meleeDamage = 0;
  rocketCd = 0;
  private regenDelay = 0;
  respawnTimer = 0;
  private hurtFlash = 0;
  private facingYaw = Math.PI;
  private wasGrounded = true;
  private footTimer = 0;
  private wasThrusting = false;
  lastDamageDir = new THREE.Vector3();

  constructor(public slot: number, aspect: number, public characterId: MandoId = 'boba') {
    this.char = buildMandalorian(characterId);
    this.cam = new ThirdPersonCamera(aspect);
  }

  spawnAt(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.hp = this.maxHp;
    this.fuel = 1;
    this.alive = true;
    this.respawnTimer = 0;
    this.slamming = false;
    this.char.animator!.releaseAll();
    this.char.root.visible = true;
  }

  damage(amount: number, from: THREE.Vector3): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.regenDelay = 5;
    this.hurtFlash = 1;
    this.lastDamageDir.subVectors(from, this.position);
    audio.hurt();
    this.cam.shake(0.12);
    if (this.hp <= 0) this.die();
  }

  private die(): void {
    this.hp = 0;
    this.alive = false;
    this.respawnTimer = 4;
    const anim = this.char.animator!;
    anim.release('lower');
    anim.release('upper');
    anim.playOnce('lower', 'deathLower', 0.1, true);
    anim.playOnce('upper', 'deathUpper', 0.1, true);
    audio.setJetpackThrust(this.slot, 0);
  }

  get hurtIntensity(): number { return this.hurtFlash; }
  get meleeActive(): boolean { return this.meleeTimer > 0; }

  update(dt: number, input: FrameInput, game: Game): void {
    const anim = this.char.animator!;
    if (!this.alive) {
      this.respawnTimer -= dt;
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
      this.velocity.y -= GRAVITY * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
      this.syncVisual(dt, game);
      anim.update(dt);
      return;
    }

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    this.fireCd -= dt;
    this.dashCd -= dt;
    this.rocketCd -= dt;
    this.meleeComboWindow -= dt;
    this.regenDelay -= dt;
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 14 * dt);

    this.cam.addLook(input.lookX, input.lookY);

    // ---- movement basis from camera yaw ----
    const yaw = this.cam.yaw;
    const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
    const wishX = fwdX * input.moveY + rightX * input.moveX;
    const wishZ = fwdZ * input.moveY + rightZ * input.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    const speedTarget = Math.min(wishLen, 1) * RUN_SPEED;

    // ---- dash ----
    if (input.dashPressed && this.dashCd <= 0 && this.fuel > 0.12) {
      this.dashTimer = 0.24;
      this.dashCd = 0.75;
      this.fuel = Math.max(0, this.fuel - 0.13);
      const dir = wishLen > 0 ? new THREE.Vector3(nx, 0, nz) : new THREE.Vector3(fwdX, 0, fwdZ);
      this.dashDir.copy(dir);
      audio.dash();
      this.cam.shake(0.06);
      game.particles.dustPuff(this.position, 6);
    }

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.velocity.x = this.dashDir.x * DASH_SPEED;
      this.velocity.z = this.dashDir.z * DASH_SPEED;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else {
      const lambda = this.grounded ? 13 : (this.thrusting > 0 ? 9 : AIR_CONTROL * 0.6);
      this.velocity.x = damp(this.velocity.x, nx * speedTarget, lambda, dt);
      this.velocity.z = damp(this.velocity.z, nz * speedTarget, lambda, dt);
    }

    // ---- jump / jetpack ----
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    if (input.jumpPressed && this.coyote > 0) {
      this.velocity.y = JUMP_VEL;
      this.coyote = 0;
      this.grounded = false;
      game.particles.dustPuff(this.position, 4);
    }
    this.thrusting = 0;
    if (input.jumpHeld && !this.grounded && this.velocity.y < JUMP_VEL * 0.7 && this.fuel > 0) {
      this.thrusting = 1;
      this.velocity.y = Math.min(this.velocity.y + JET_ACCEL * dt, JET_MAX_UP);
      this.fuel = Math.max(0, this.fuel - dt / FUEL_SECONDS);
      // flame particles from the jetpack
      const jetPos = this.position.clone();
      jetPos.y += 1.15;
      jetPos.x -= Math.sin(this.facingYaw) * 0.25;
      jetPos.z -= Math.cos(this.facingYaw) * 0.25;
      game.particles.jetFlame(jetPos, new THREE.Vector3(0, -5, 0));
    } else if (this.grounded) {
      this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.55));
    } else {
      this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 3.2));
    }
    audio.setJetpackThrust(this.slot, this.thrusting * (0.6 + 0.4 * Math.min(1, Math.abs(this.velocity.y) / 8)));
    if (this.thrusting > 0 && !this.wasThrusting) audio.jetpackIgnite();
    this.wasThrusting = this.thrusting > 0;
    this.char.setThrust(this.thrusting);

    // ---- slam ----
    if (input.slamPressed && !this.grounded && this.velocity.y < 6) {
      this.slamming = true;
      this.velocity.y = -30;
    }

    // ---- gravity + integrate ----
    if (this.dashTimer <= 0) this.velocity.y -= GRAVITY * dt;
    const res = game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
    if (res.grounded && !this.wasGrounded) {
      audio.land(this.slamming || this.velocity.y < -14);
      game.particles.dustPuff(this.position, this.slamming ? 18 : 6);
      if (this.slamming) {
        this.slamming = false;
        this.cam.shake(0.2);
        audio.explosion();
        for (const e of game.enemies) {
          if (!e.alive) continue;
          const d = e.position.distanceTo(this.position);
          if (d < 5) {
            e.damage(20, this.position, this.slot);
            e.knockback(this.position, 14);
          }
        }
      }
    }
    this.grounded = res.grounded;
    this.wasGrounded = res.grounded;

    // out of bounds / hazard
    if (this.position.y < game.board.physics.killY) {
      if (game.board.kind === 'station') {
        // arcade fall: respawn on start pad with a health cost
        this.hp -= 20;
        this.regenDelay = 5;
        audio.hurt();
        if (this.hp <= 0) { this.die(); } else {
          const s = game.board.playerStarts[this.slot] ?? game.board.playerStarts[0];
          this.position.copy(s);
          this.velocity.set(0, 0, 0);
        }
      } else {
        this.damage(999, this.position);
      }
    }
    const hz = game.board.hazard;
    if (hz && this.alive) {
      const d = Math.hypot(this.position.x - hz.center.x, this.position.z - hz.center.z);
      if (d < hz.radius && this.position.y < hz.center.y + 3) this.damage(999, hz.center);
    }

    // ---- combat ----
    this.updateCombat(dt, input, game);

    // ---- facing ----
    const combatFacing = input.aimHeld || input.shootHeld || this.meleeTimer > 0 || this.weapon === 'blaster' && this.fireCd > -0.6;
    const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
    let targetYaw = this.facingYaw;
    if (combatFacing) targetYaw = this.cam.yaw;
    else if (speed2 > 0.8) targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
    this.facingYaw = dampAngle(this.facingYaw, targetYaw, 14, dt);

    // ---- animation state ----
    if (this.thrusting > 0 || (!this.grounded && this.velocity.y > 2 && input.jumpHeld)) {
      anim.play('lower', 'flyLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'flyUpper');
    } else if (!this.grounded) {
      anim.play('lower', 'airLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'airUpper');
    } else if (speed2 > 0.6) {
      anim.play('lower', 'runLower', 0.15, clamp(speed2 / RUN_SPEED, 0.5, 1.3));
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'runUpper', 0.15, clamp(speed2 / RUN_SPEED, 0.5, 1.3));
      if (Math.random() < speed2 * dt * 0.7) game.particles.runDust(this.position);
      this.footTimer -= dt * (speed2 / RUN_SPEED);
      if (this.footTimer <= 0) {
        this.footTimer = 0.31;
        audio.footstep(game.board.kind === 'desert' ? 'sand' : 'metal');
      }
    } else {
      anim.play('lower', 'idleLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'idleUpper');
    }

    this.syncVisual(dt, game);
    anim.update(dt);

    // camera last (after position settles)
    this.cam.update(dt, this.position, game.board.physics, {
      aiming: input.aimHeld, speed: speed2, dashing: this.dashTimer > 0,
    });
  }

  private updateCombat(dt: number, input: FrameInput, game: Game): void {
    // weapon switch
    if (input.switchPressed) {
      this.weapon = this.weapon === 'blaster' ? 'gaffi' : 'blaster';
      this.char.setWeapon(this.weapon);
      audio.uiMove();
    }

    // melee (always available; swaps to gaffi visual during swing)
    this.meleeTimer -= dt;
    if (input.meleePressed && this.meleeTimer <= 0) {
      this.meleeStep = this.meleeComboWindow > 0 ? (this.meleeStep % 3) + 1 : 1;
      const clip = this.meleeStep === 1 ? 'melee1' : this.meleeStep === 2 ? 'melee2' : 'melee3';
      const dur = this.char.animator!.playOnce('upper', clip, 0.05);
      this.meleeTimer = dur;
      this.meleeComboWindow = dur + 0.55;
      this.meleeHitPending = dur * 0.45;
      this.meleeDamage = this.meleeStep === 3 ? 55 : 32;
      this.char.setWeapon('gaffi');
      audio.melee(this.meleeStep);
      // lunge toward nearest enemy in front
      const target = this.nearestEnemy(game, 5.5, 0.4);
      if (target) {
        const dir = target.position.clone().sub(this.position).setY(0).normalize();
        this.velocity.x = dir.x * 13;
        this.velocity.z = dir.z * 13;
        this.facingYaw = Math.atan2(dir.x, dir.z);
      }
    }
    if (this.meleeTimer <= 0 && this.meleeComboWindow < 0 && this.weapon === 'blaster' && this.char.gaffi.visible) {
      this.char.setWeapon('blaster');
    }
    if (this.meleeHitPending > 0) {
      this.meleeHitPending -= dt;
      if (this.meleeHitPending <= 0) {
        let hitAny = false;
        for (const e of game.enemies) {
          if (!e.alive) continue;
          const to = e.position.clone().sub(this.position);
          const dist = to.length();
          if (dist > 3 + e.radius) continue;
          to.normalize();
          const facing = new THREE.Vector3(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
          if (to.dot(facing) < 0.25) continue;
          const wasAlive = e.alive;
          e.damage(this.meleeDamage, this.position, this.slot);
          e.knockback(this.position, this.meleeStep === 3 ? 16 : 8);
          hitAny = true;
          if (wasAlive && !e.alive) this.fuel = Math.min(1, this.fuel + 0.4); // melee kill refunds fuel
        }
        if (hitAny) { audio.meleeHit(); this.cam.shake(0.1); game.hitMarker(this.slot); }
      }
    }

    // blaster
    if (input.shootHeld && this.weapon === 'blaster' && this.fireCd <= 0 && this.meleeTimer <= 0) {
      this.fireCd = 0.24;
      const muzzlePos = new THREE.Vector3();
      this.char.muzzle!.getWorldPosition(muzzlePos);
      const dir = new THREE.Vector3();
      this.cam.aimDir(dir);
      // aim from camera through crosshair: target point far ahead
      const aimPoint = this.cam.camera.position.clone().addScaledVector(dir, 90);
      let shotDir = aimPoint.sub(muzzlePos).normalize();
      // soft-lock aim assist: bend toward the best enemy near the crosshair
      const assist = this.aimAssistTarget(game, shotDir, muzzlePos);
      if (assist) {
        const to = assist.position.clone();
        to.y += assist.height * 0.55;
        shotDir = shotDir.lerp(to.sub(muzzlePos).normalize(), 0.65).normalize();
      }
      // slight spread when moving unaimed
      if (!input.aimHeld) {
        const spread = Math.min(Math.hypot(this.velocity.x, this.velocity.z) / RUN_SPEED, 1) * 0.02;
        shotDir.x += (Math.random() - 0.5) * spread;
        shotDir.y += (Math.random() - 0.5) * spread;
        shotDir.z += (Math.random() - 0.5) * spread;
        shotDir.normalize();
      }
      game.projectiles.fire(muzzlePos, shotDir, 85, 34, 0);
      audio.blaster();
      this.cam.shake(0.03);
    }

    // rocket
    if (input.rocketPressed && this.rocketCd <= 0) {
      this.rocketCd = ROCKET_CD;
      const dir = new THREE.Vector3();
      this.cam.aimDir(dir);
      const origin = this.position.clone();
      origin.y += 1.9;
      const lock = this.aimAssistTarget(game, dir, origin, 0.85, 80);
      game.fireRocket(origin, dir, lock, this.slot);
      audio.rocket();
      this.cam.shake(0.15);
    }
  }

  /** Best enemy near the aim direction (dot threshold), for soft-lock. */
  private aimAssistTarget(game: Game, dir: THREE.Vector3, from: THREE.Vector3, minDot = 0.986, maxDist = 65): Enemy | null {
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    const to = new THREE.Vector3();
    for (const e of game.enemies) {
      if (!e.alive) continue;
      to.copy(e.position);
      to.y += e.height * 0.55;
      to.sub(from);
      const d = to.length();
      if (d > maxDist || d < 1.2) continue;
      to.normalize();
      const dot = to.dot(dir);
      // widen the cone slightly for close targets
      const need = d < 12 ? minDot - 0.02 : minDot;
      if (dot < need) continue;
      const score = dot * 10 - d * 0.02;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  private nearestEnemy(game: Game, maxDist: number, minDot: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist;
    const facing = new THREE.Vector3(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    const to = new THREE.Vector3();
    for (const e of game.enemies) {
      if (!e.alive) continue;
      to.copy(e.position).sub(this.position);
      to.y = 0;
      const d = to.length();
      if (d > bestD) continue;
      if (d > 1 && to.normalize().dot(facing) < minDot) continue;
      bestD = d;
      best = e;
    }
    return best;
  }

  private syncVisual(dt: number, game: Game): void {
    this.char.root.position.copy(this.position);
    this.char.root.rotation.y = this.facingYaw;
    // lean into velocity while flying
    const lean = clamp((this.velocity.x * Math.sin(this.facingYaw) + this.velocity.z * Math.cos(this.facingYaw)) / 18, -0.35, 0.35);
    this.char.root.rotation.x = damp(this.char.root.rotation.x, this.grounded ? 0 : lean * (this.thrusting ? 1 : 0.4), 8, dt);
    this.char.cosmetic?.(dt, game.time);
  }
}
