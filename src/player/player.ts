import * as THREE from 'three';
import { buildMandalorian, type MandoId, type PlayerCharacter } from '../characters/mandalorians';
import { ThirdPersonCamera } from '../core/camera';
import type { FrameInput } from '../core/input';
import { clamp, damp, dampAngle, yawBasis } from '../core/math';
import { audio } from '../core/audio';
import type { Game } from '../game/game';
import type { Enemy } from '../enemies/enemy';
import type { StaticBox } from '../core/physics';

// scratch vectors for the per-frame jetpack emission
const _jetPos = new THREE.Vector3();
const _jetDir = new THREE.Vector3();
const _jetRot = new THREE.Quaternion();

const GRAVITY = 26;
const RUN_SPEED = 9.2;
const AIR_CONTROL = 7.5;
const JUMP_VEL = 10;
const JET_ACCEL = 34;
const JET_MAX_UP = 11.5;
const FUEL_SECONDS = 3.4;
const DASH_SPEED = 19;
const SPRINT_SPEED = 14.4;      // vs RUN_SPEED 9.2
const SPRINT_SECONDS = 6;       // full gauge held down
const SPRINT_REFILL = 4.5;      // seconds to refill from empty
const DASH_ENERGY = 0.22;
/** seconds of block on a full gauge */
const BLOCK_SECONDS = 5;
/** you can shuffle behind the shield, but not run */
const BLOCK_SPEED = 3.2;
/** extra downward pull while blocking in the air, m/s² */
const BLOCK_SINK = 16;
const ROCKET_CD = 12;
/** seconds of Dead Eye on a full meter */
const DEADEYE_SECONDS = 6;
/** trickle refill: seconds from empty to full without kills */
const DEADEYE_REFILL = 45;

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
  /** sprint gauge, separate from jetpack fuel: 1 = full */
  energy = 1;
  sprinting = false;
  /** shield up: drains the same gauge sprinting does */
  blocking = false;
  /** scratch for the shield collider handed to the projectile system */
  private shieldSphere = { center: new THREE.Vector3(), radius: 0.78, normal: new THREE.Vector3() };
  /** 0..1 raise animation for the shield pane */
  private blockRaise = 0;
  /**
   * RB pressed with the stick centred arms a dash instead of a sprint; the
   * next direction pushed spends it. See the dash block below.
   */
  private dashArmed = false;
  /** RB was pressed while already moving, so this hold is a sprint */
  private sprintLatched = false;
  /** Dead Eye meter, 0..1 — drains while active, feeds on kills */
  deadeye = 1;
  deadeyeActive = false;
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
  private sprintRefillDelay = 0;
  private wasThrusting = false;
  private wasAiming = false;
  /** true while ADS — the HUD only draws a crosshair when this is set */
  aiming = false;
  lastDamageDir = new THREE.Vector3();
  // ---- cover (RDR2 snap-to-cover) ----
  /** the box being hugged, plus the outward normal of the face we're on */
  cover: { box: StaticBox; nx: number; nz: number } | null = null;
  /** a face is close enough to snap to right now (drives the HUD prompt) */
  nearCover = false;
  /** currently leaning out past the corner to shoot */
  peeking = false;
  /** which corner this peek leans around: -1/+1 along the face tangent, 0 = unset */
  private peekSide = 0;
  private peekRecheck = 0;
  private pushAwayTime = 0;

  constructor(public slot: number, aspect: number, public characterId: MandoId = 'din') {
    this.char = buildMandalorian(characterId);
    this.cam = new ThirdPersonCamera(aspect);
  }

  spawnAt(p: THREE.Vector3): void {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.hp = this.maxHp;
    this.fuel = 1;
    this.energy = 1;
    this.alive = true;
    this.respawnTimer = 0;
    this.slamming = false;
    this.deadeye = Math.max(this.deadeye, 0.5);
    this.deadeyeActive = false;
    this.cover = null;
    this.peeking = false;
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
    this.deadeyeActive = false;
    this.cover = null;
    this.peeking = false;
    audio.setJetpackThrust(this.slot, 0);
  }

  get hurtIntensity(): number { return this.hurtFlash; }
  get meleeActive(): boolean { return this.meleeTimer > 0; }

  /**
   * The block shield as the projectile system sees it: a sphere sitting a
   * little in front of the chest, facing the way we are. Null until the pane
   * is most of the way up, so a shield that is still rising does not yet
   * bounce anything.
   */
  get shieldCollider(): { center: THREE.Vector3; radius: number; normal: THREE.Vector3 } | null {
    if (this.blockRaise < 0.6) return null;
    const s = this.shieldSphere;
    s.normal.set(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
    s.center.copy(this.position).addScaledVector(s.normal, 0.6);
    s.center.y += 1.05;
    return s;
  }

  /** enemy currently under the crosshair's assist cone, for HUD feedback */
  lockedOn = false;

  update(dt: number, input: FrameInput, game: Game, realDt = dt): void {
    const anim = this.char.animator!;
    if (!this.alive) {
      this.respawnTimer -= dt;
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.z = damp(this.velocity.z, 0, 6, dt);
      this.velocity.y -= GRAVITY * (game.board.gravity ?? 1) * dt;
      game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
      this.syncVisual(dt, game);
      anim.update(dt);
      return;
    }

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    // fire rate and cooldowns run on the wall clock: in Dead Eye the world
    // crawls but the trigger finger doesn't — that gap is the whole power
    this.fireCd -= realDt;
    this.dashCd -= realDt;
    this.rocketCd -= realDt;
    this.meleeComboWindow -= dt;
    this.regenDelay -= dt;
    if (this.regenDelay <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 14 * dt);

    // ---- Dead Eye ----
    if (input.deadeyePressed) {
      if (this.deadeyeActive) this.deadeyeActive = false;
      else if (this.deadeye > 0.15) {
        this.deadeyeActive = true;
        audio.dash(); // the whoosh into slow motion
      }
    }
    if (this.deadeyeActive) {
      this.deadeye = Math.max(0, this.deadeye - realDt / DEADEYE_SECONDS);
      if (this.deadeye <= 0) this.deadeyeActive = false;
    } else {
      this.deadeye = Math.min(1, this.deadeye + realDt / DEADEYE_REFILL);
    }

    // aiming steadies the hand: finer look control while ADS
    const lookScale = input.aimHeld ? 0.55 : 1;
    this.cam.addLook(input.lookX * lookScale, input.lookY * lookScale);

    // lock-on: pressing aim snaps the camera onto the target nearest the
    // reticle, then fine aim is yours (RDR2's "Normal" lock-on)
    if (input.aimHeld && !this.wasAiming && this.weapon === 'blaster') {
      const dir = this.cam.aimDir(new THREE.Vector3());
      const lock = this.aimAssistTarget(game, dir, this.cam.camera.position, 0.9, 50);
      if (lock) {
        const chest = lock.position.clone();
        chest.y += lock.height * 0.55;
        this.cam.snapToward(chest);
      }
    }
    this.wasAiming = input.aimHeld;
    this.aiming = input.aimHeld;

    // ---- cover: on the ground the slam button snaps to a nearby box ----
    // (the air keeps its ground slam — the button splits by grounded state)
    const face = this.grounded ? this.findCoverFace(game) : null;
    this.nearCover = !!face && !this.cover;
    if (!this.cover && face && input.slamPressed) {
      this.cover = face;
      this.peeking = false;
      this.pushAwayTime = 0;
      audio.land(false); // the thump of shoulder meeting crate
      // the press that got us in must not also read as the press that exits
      this.updateInCover(dt, { ...input, slamPressed: false }, game, realDt);
      return;
    }
    if (this.cover) {
      this.updateInCover(dt, input, game, realDt);
      return;
    }

    // ---- movement basis from camera yaw ----
    const { fwdX, fwdZ, rightX, rightZ } = yawBasis(this.cam.yaw);
    const wishX = fwdX * input.moveY + rightX * input.moveX;
    const wishZ = fwdZ * input.moveY + rightZ * input.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    const nx = wishLen > 0 ? wishX / wishLen : 0;
    const nz = wishLen > 0 ? wishZ / wishLen : 0;
    // ---- block (hold B / R) ----
    // The shield is the same gauge as sprinting, so a fight is a budget: run
    // it down blocking and you have nothing left to run with.
    const moving = wishLen > 0.2;
    this.blocking = input.blockHeld && this.energy > 0 && this.meleeTimer <= 0 && this.dashTimer <= 0;
    if (this.blocking) {
      this.energy = Math.max(0, this.energy - dt / BLOCK_SECONDS);
      this.sprintRefillDelay = 0.7;
      this.dashArmed = false;
      this.sprintLatched = false;
    }
    this.blockRaise = damp(this.blockRaise, this.blocking ? 1 : 0, 14, dt);
    this.char.setBlock(this.blockRaise);

    // ---- RB: a dash from a standstill, a sprint on the move ----
    // Pressing with the stick centred arms a dash and waits for a direction;
    // pressing while already moving is a sprint for as long as it is held. In
    // the air sprint means nothing, so a press there is always the jet burst.
    if (input.dashPressed && !this.blocking) {
      if (!this.grounded) this.dashArmed = true;
      else if (moving) { this.sprintLatched = true; this.dashArmed = false; }
      else { this.dashArmed = true; this.sprintLatched = false; }
    }
    if (!input.sprintHeld) { this.dashArmed = false; this.sprintLatched = false; }

    const canDash = this.dashCd <= 0 && this.energy > DASH_ENERGY && !this.blocking;
    const dashNow = this.dashArmed && canDash && (moving || !this.grounded);
    if (dashNow) {
      this.dashArmed = false;
      this.dashTimer = 0.24;
      this.dashCd = 0.75;
      this.energy = Math.max(0, this.energy - DASH_ENERGY);
      this.sprintRefillDelay = 0.7;
      const dir = wishLen > 0 ? new THREE.Vector3(nx, 0, nz) : new THREE.Vector3(fwdX, 0, fwdZ);
      this.dashDir.copy(dir);
      audio.dash();
      this.cam.shake(0.06);
      game.particles.dustPuff(this.position, 6);
      // holding on through the dash rolls into a sprint when it ends
      this.sprintLatched = true;
    }

    // ---- sprint ----
    const wantsSprint = this.sprintLatched && input.sprintHeld && moving
      && this.grounded && this.energy > 0 && !this.blocking;
    this.sprinting = wantsSprint;
    if (wantsSprint) {
      this.energy = Math.max(0, this.energy - dt / SPRINT_SECONDS);
      this.sprintRefillDelay = 0.7;
    } else if (!this.blocking) {
      this.sprintRefillDelay -= dt;
      if (this.sprintRefillDelay <= 0) this.energy = Math.min(1, this.energy + dt / SPRINT_REFILL);
    }
    const topSpeed = this.blocking ? BLOCK_SPEED : this.sprinting ? SPRINT_SPEED : RUN_SPEED;
    const speedTarget = Math.min(wishLen, 1) * topSpeed;

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
    if (input.jumpPressed && this.coyote > 0 && !this.blocking) {
      this.velocity.y = JUMP_VEL;
      this.coyote = 0;
      this.grounded = false;
      game.particles.dustPuff(this.position, 4);
    }
    this.thrusting = 0;
    if (input.jumpHeld && !this.grounded && !this.blocking && this.velocity.y < JUMP_VEL * 0.7 && this.fuel > 0) {
      this.thrusting = 1;
      this.velocity.y = Math.min(this.velocity.y + JET_ACCEL * dt, JET_MAX_UP);
      this.fuel = Math.max(0, this.fuel - dt / FUEL_SECONDS);
      // Twin nozzle jets, born at the thruster mouths themselves. The offset
      // is taken against the character root rather than the world so the jets
      // do not lag a frame behind us, and the exhaust inherits most of our own
      // velocity — that is what keeps it a short jet stuck under the pack
      // instead of a long trail left behind in world space.
      const ignite = this.thrusting > 0 && !this.wasThrusting;
      for (const nozzle of this.char.nozzles) {
        nozzle.getWorldPosition(_jetPos).sub(this.char.root.position).add(this.position);
        _jetDir.set(0, -1, 0).applyQuaternion(nozzle.getWorldQuaternion(_jetRot));
        if (ignite) game.particles.jetIgnite(_jetPos, _jetDir);
        game.particles.jetPlume(_jetPos, _jetDir, dt, { power: 1, carrier: this.velocity });
      }
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
    // Below a board's voidY there is no floor left to land on, so gravity
    // eases right off: you drift, and a tap of jetpack lifts you back out.
    const board = game.board;
    const inVoid = board.voidY !== undefined && this.position.y < board.voidY && !this.grounded;
    if (this.dashTimer <= 0) {
      this.velocity.y -= GRAVITY * (board.gravity ?? 1) * (inVoid ? (board.voidGravity ?? 0.15) : 1) * dt;
      // A brace wants the ground under it: raising the shield mid-air kills any
      // rise you had and pulls you down to meet it.
      if (this.blocking && !this.grounded) {
        if (this.velocity.y > 0) this.velocity.y = damp(this.velocity.y, 0, 9, dt);
        this.velocity.y -= BLOCK_SINK * dt;
      }
      if (inVoid) {
        const terminal = -(board.voidFallSpeed ?? 3.2);
        if (this.velocity.y < terminal) this.velocity.y = terminal;
      }
    }
    // never strand a drifting player with an empty tank
    if (inVoid) this.fuel = Math.min(1, this.fuel + dt / (FUEL_SECONDS * 0.9));
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
            e.knockback(this.position, 16, 0.55);
            e.knockdown(1.2 + Math.random() * 0.6);
          }
        }
      }
    }
    this.grounded = res.grounded;
    this.wasGrounded = res.grounded;

    // out of bounds / hazard
    if (this.position.y < game.board.physics.killY) {
      if (game.board.voidY !== undefined) {
        // backstop only — the drift above makes this almost unreachable, and
        // sinking out of a space station shouldn't cost anything
        const s = game.board.playerStarts[this.slot] ?? game.board.playerStarts[0];
        this.position.copy(s);
        this.velocity.set(0, 0, 0);
        this.fuel = 1;
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
    this.lockedOn = this.weapon === 'blaster' &&
      !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
    // Both hands are on the shield: no firing, no swinging, no weapon swap
    // from behind it. Everything else in updateCombat still ticks down.
    this.updateCombat(dt, this.blocking
      ? { ...input, shootHeld: false, aimHeld: false, meleePressed: false, rocketPressed: false, switchPressed: false }
      : input, game);

    // ---- facing ----
    const combatFacing = this.blocking || input.aimHeld || input.shootHeld || this.meleeTimer > 0 || this.weapon === 'blaster' && this.fireCd > -0.6;
    const speed2 = Math.hypot(this.velocity.x, this.velocity.z);
    let targetYaw = this.facingYaw;
    if (combatFacing) targetYaw = this.cam.yaw;
    else if (speed2 > 0.8) targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
    this.facingYaw = dampAngle(this.facingYaw, targetYaw, 14, dt);

    // ---- animation state ----
    if (this.blocking) {
      // the brace owns both channels: no running, no firing from behind it
      anim.play('lower', speed2 > 0.6 ? 'runLower' : 'blockLower', 0.14, 0.6);
      anim.play('upper', 'blockUpper', 0.12);
    } else if (this.thrusting > 0 || (!this.grounded && this.velocity.y > 2 && input.jumpHeld)) {
      anim.play('lower', 'flyLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'flyUpper');
    } else if (!this.grounded) {
      anim.play('lower', 'airLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'airUpper');
    } else if (speed2 > 0.6) {
      // the gait runs at whatever rate plants the feet at our actual ground
      // speed, so the stride pushes off instead of skating
      const gait = anim.gaitRate('runLower', speed2);
      anim.play('lower', 'runLower', 0.15, gait);
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'runUpper', 0.15, gait);
      if (Math.random() < speed2 * dt * 0.7) game.particles.runDust(this.position);
      // footfalls follow the same cadence, so the sound lands on the plant
      this.footTimer -= dt;
      if (this.footTimer <= 0) {
        this.footTimer = anim.stepInterval('runLower', gait);
        audio.footstep(game.board.kind === 'desert' ? 'sand' : 'metal');
      }
    } else {
      anim.play('lower', 'idleLower');
      if (this.meleeTimer <= 0) anim.play('upper', input.aimHeld || input.shootHeld ? 'aimUpper' : 'idleUpper');
    }

    this.syncVisual(dt, game);
    anim.update(dt);

    // camera last (after position settles) — on the wall clock, so the
    // camera stays crisp while the world is in slow motion
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: input.aimHeld, speed: speed2, dashing: this.dashTimer > 0,
    });
  }

  /**
   * Nearest box face worth hugging: tall enough to hide behind, wide enough
   * to matter, within snap range, and not the thing we're standing on.
   */
  private findCoverFace(game: Game): { box: StaticBox; nx: number; nz: number } | null {
    let best: { box: StaticBox; nx: number; nz: number } | null = null;
    let bestD = 2.4; // snap range
    for (const b of game.board.physics.boxes) {
      if (b.max.y - this.position.y < 1.0) continue;              // too low to cover the chest
      if (b.min.y > this.position.y + 0.5) continue;              // floating above us
      if (this.position.y > b.max.y - 0.3) continue;              // we're standing on it
      // outside distance to the box, and which face is closest
      const cx = clamp(this.position.x, b.min.x, b.max.x);
      const cz = clamp(this.position.z, b.min.z, b.max.z);
      const ox = this.position.x - cx, oz = this.position.z - cz;
      const dist = Math.hypot(ox, oz);
      if (dist < 0.01 || dist > bestD) continue;
      let nx = 0, nz = 0;
      if (Math.abs(ox) >= Math.abs(oz)) nx = Math.sign(ox) || 1;
      else nz = Math.sign(oz) || 1;
      // the face must be wide enough to actually hide a person
      const width = nx !== 0 ? b.max.z - b.min.z : b.max.x - b.min.x;
      if (width < 1.0) continue;
      bestD = dist;
      best = { box: b, nx, nz };
    }
    return best;
  }

  /**
   * Hugging a box, RDR2-style: slide along the face with the stick, hold aim
   * to lean out past the corner and shoot, release to tuck back in. Jump,
   * dash, melee, pressing the cover button again, or pushing away all leave.
   */
  private updateInCover(dt: number, input: FrameInput, game: Game, realDt: number): void {
    const anim = this.char.animator!;
    const c = this.cover!;
    const b = c.box;
    // face geometry: n = outward normal, t = tangent along the face
    const tx = -c.nz, tz = c.nx;
    const facePlane = (c.nx > 0 ? b.max.x : c.nx < 0 ? b.min.x : c.nz > 0 ? b.max.z : b.min.z);
    const hugDist = this.radius + 0.22;
    const tMin = (c.nx !== 0 ? b.min.z : b.min.x);
    const tMax = (c.nx !== 0 ? b.max.z : b.max.x);
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
    this.velocity.y -= GRAVITY * dt;
    const res = game.board.physics.moveCapsule(this.position, this.radius, this.height, this.velocity, dt);
    this.grounded = res.grounded;
    this.wasGrounded = res.grounded;
    if (!res.grounded && this.position.y < (game.board.voidY ?? game.board.physics.killY)) {
      this.cover = null; // the floor is gone; back to normal rules
    }

    // out of bounds / hazard (same rules as the open field)
    if (this.position.y < game.board.physics.killY) this.damage(999, this.position);
    const hz = game.board.hazard;
    if (hz && this.alive) {
      const hd = Math.hypot(this.position.x - hz.center.x, this.position.z - hz.center.z);
      if (hd < hz.radius && this.position.y < hz.center.y + 3) this.damage(999, hz.center);
    }

    // ---- combat: shoot only while leaning out ----
    this.lockedOn = this.peeking &&
      !!this.aimAssistTarget(game, this.cam.aimDir(new THREE.Vector3()), this.cam.camera.position);
    const masked: FrameInput = {
      ...input,
      shootHeld: input.shootHeld && this.peeking,
      rocketPressed: input.rocketPressed && this.peeking,
      meleePressed: false,
      switchPressed: false, // the gaffi has no place in cover
    };
    this.updateCombat(dt, masked, game);

    // ---- facing & pose ----
    const targetYaw = this.peeking ? this.cam.yaw : Math.atan2(c.nx, c.nz);
    this.facingYaw = dampAngle(this.facingYaw, targetYaw, 14, dt);
    anim.play('lower', 'idleLower');
    if (this.meleeTimer <= 0) anim.play('upper', this.peeking ? 'aimUpper' : 'idleUpper');

    this.syncVisual(dt, game);
    anim.update(dt);
    this.cam.update(realDt, this.position, game.board.physics, {
      aiming: input.aimHeld, speed: Math.hypot(this.velocity.x, this.velocity.z), dashing: false,
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
          // the finisher is the haymaker: it puts the target flat on the
          // ground (follow up while they're down and hits land double)
          if (this.meleeStep === 3) {
            e.knockback(this.position, 12, 0.35, 0.08);
            e.knockdown(1.6 + Math.random() * 0.5);
          } else {
            e.knockback(this.position, 11, 0.32);
          }
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

      // Converge the shot on whatever the crosshair is actually over, rather
      // than firing parallel from the muzzle. The muzzle sits off to the side
      // of the camera, so a parallel shot misses what the crosshair covers at
      // close range — which is what made aiming feel unreadable.
      const shotDir = this.aimPointFrom(game, muzzlePos);

      // spread when hip-firing (worse on the move); aiming removes it, and
      // Dead Eye shots always fly true
      if (!input.aimHeld && !this.deadeyeActive) {
        const spread = 0.008 + Math.min(Math.hypot(this.velocity.x, this.velocity.z) / RUN_SPEED, 1) * 0.015;
        shotDir.x += (Math.random() - 0.5) * spread;
        shotDir.y += (Math.random() - 0.5) * spread;
        shotDir.z += (Math.random() - 0.5) * spread;
        shotDir.normalize();
      }
      const dmg = this.deadeyeActive ? 55 : 34; // Dead Eye shots hit like a rifle round
      game.projectiles.fire(muzzlePos, shotDir, 75, dmg, 0);
      game.particles.muzzleFlash(muzzlePos, shotDir);
      // blaster fire carries: nearby posted enemies come looking
      game.director.noise(game, this.position, 55);
      audio.blaster();
      this.cam.shake(0.035);
      // recoil: the muzzle climbs, less when shouldered — you ride it back down
      this.cam.addLook((Math.random() - 0.5) * 0.003, input.aimHeld ? 0.005 : 0.01);
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

  /**
   * Direction from `from` to whatever the crosshair is pointing at: a
   * soft-locked enemy if one sits in the assist cone, else the first thing the
   * camera ray hits, else a point far downrange.
   */
  private aimPointFrom(game: Game, from: THREE.Vector3): THREE.Vector3 {
    const camDir = this.cam.aimDir(new THREE.Vector3());
    const camPos = this.cam.camera.position;
    const lock = this.aimAssistTarget(game, camDir, camPos);
    const aimPoint = new THREE.Vector3();
    if (lock) {
      aimPoint.copy(lock.position);
      aimPoint.y += lock.height * 0.55;
    } else {
      const hit = game.board.physics.raycast(camPos, camDir, 200);
      aimPoint.copy(camPos).addScaledVector(camDir, hit ? hit.dist : 120);
    }
    return aimPoint.sub(from).normalize();
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
