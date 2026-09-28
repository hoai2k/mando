import * as THREE from 'three';
import type { FrameInput } from '../../core/input';
import type { Player } from '../../player/player';
import type { Game } from '../../game/game';
import type { SectionMove } from '../api';
import { audio } from '../../core/audio';
import { dampAngle } from '../../core/math';

/**
 * K7 — locomotion modes (docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * Ways of moving a body that are not running: the **slide** (the Glacier
 * Chute), and — to come, from the sections that own them — **flight** (Covert
 * Sky) and the deck **tilt** (the Squall). Each is a factory that returns a
 * `SectionMove` for `Player.sectionMove`, so it composes with a section's
 * other input hooks through `composeMoves`.
 *
 * Every mode works through the same two hooks and leaves the rest of the frame
 * alone: `adjust` rewrites the input (what the buttons mean while sliding),
 * and `steer` owns the horizontal velocity (what the body does with it). The
 * jump, the jetpack, the gun, the landing, the animation and the camera all
 * run exactly as they do on foot around them — which is why a jetpack clears a
 * crevasse mid-slide with no special case anywhere.
 *
 * Shared helpers for the modes are at the bottom of the file.
 */

// ---------------------------------------------------------------- the slide

/**
 * The channel a slide runs down, as the section sees it at a point: the
 * downhill axis (unit, horizontal), how far right of the centre line the point
 * is (right = the axis turned a quarter to the right, negative = left), the
 * half-width of the flat floor, and the width of the bank beyond it. The
 * outer edge of the bank is the wall: nothing slides past it.
 */
export interface SlideLane { ax: number; az: number; side: number; half: number; bank: number }

export interface SlideOpts {
  /** the channel at (x, z), or null where there is none (a flat floor, a snowbank) */
  lane?: (x: number, z: number) => SlideLane | null;
  /** is this player on the slide right now? Default: always. Off, they walk as normal */
  active?: (p: Player) => boolean;
  /** extra drag on this player this frame, per second (a web patch) */
  drag?: (p: Player) => number;
  /** something the slide kick connected with besides a body (a web to tear) */
  onKick?: (p: Player, at: THREE.Vector3, game: Game) => void;
  /** sliding into a hostile at speed bowls it over and costs you (default true) */
  crash?: boolean;
}

/**
 * The numbers the slide is tuned by. All are per second or metres per second
 * squared; see docs/sections-notes/crevasse.md for why each is what it is.
 */
export const SLIDE = {
  /** the pull down the fall line on a 1-in-1 slope (arcade gravity is 26; this is the ice's share) */
  pull: 16,
  /** air and snow drag, ×speed² — sets the cruise: ~22 m/s on the 11° average */
  drag: 0.0064,
  /** the hardest the body is ever allowed to go */
  maxSpeed: 28,
  /** the stick's lateral force, m/s² — carves the heading rather than adding speed */
  steer: 11,
  /** the same, in the air: a lean, not a turn */
  airSteer: 3.5,
  /** pull back on the stick: the heels dig in, a drag that checks the speed but never stops it */
  dig: 0.4,
  /** push on the stick below this speed and the body shoves off (the flat, a stall) */
  pushBelow: 7,
  pushAccel: 6,
  /** how hard a bank turns you back along the channel as you ride up it */
  bankTurn: 6,
  /** the slide kick: reach, damage, shove, and how often */
  kickReach: 3.2,
  /** ...plus this much per m/s of speed: the faster you come, the earlier the boot is out */
  kickReachPerSpeed: 0.12,
  kickDamage: 22,
  kickShove: 18,
  kickCd: 0.55,
  /** sliding into a body: the speed you keep, what it costs you, and what it does to it */
  crashAbove: 8,
  crashKeep: 0.35,
  crashHurt: 10,
  crashHit: 12,
  /** how firmly the camera is swung to look down the line while the look stick is idle */
  lookAhead: 2.2,
};

/** one player's slide, for the section's HUD and tests */
export interface SlideState {
  sliding: boolean;
  speed: number;
  digging: boolean;
  kickCd: number;
  /** seconds since the last kick landed, for the HUD flash */
  kicked: number;
  /** seconds since the last crash into a body */
  crashed: number;
}

/**
 * The slide (the Glacier Chute): traction all but gone, gravity along the
 * slope, the stick as a lateral force, a dig-in drag, a crouched surf, a
 * slide kick on the melee button, and hip-fire only.
 */
export class SlideMove {
  readonly state: SlideState[] = [0, 1, 2, 3].map(() => ({ sliding: false, speed: 0, digging: false, kickCd: 0, kicked: 99, crashed: 99 }));
  private readonly n = new THREE.Vector3();

  constructor(private readonly opts: SlideOpts = {}) {}

  private on(p: Player): boolean {
    return this.opts.active ? this.opts.active(p) : true;
  }

  /** the hook to hang on `Player.sectionMove` (or to compose with others) */
  move(): SectionMove {
    return {
      adjust: (p, dt, input, game) => this.adjust(p, dt, input, game),
      steer: (p, dt, input, game) => this.steer(p, dt, input, game),
      crouch: (p) => this.on(p) && this.state[p.slot].speed > 2.5,
    };
  }

  private adjust(p: Player, dt: number, input: FrameInput, game: Game): FrameInput {
    const st = this.state[p.slot];
    st.kickCd -= dt;
    st.kicked += dt;
    st.crashed += dt;
    st.sliding = this.on(p);
    if (!st.sliding) return input;
    // what the buttons mean on the ice: no sprint and no dodge (there is no
    // footing to push off), hip-fire only (the sights want a stance), and the
    // melee button is the slide kick
    const out = { ...input, sprintHeld: false, dashPressed: false, aimHeld: false };
    if (input.meleePressed) {
      out.meleePressed = false;
      if (st.kickCd <= 0) this.kick(p, game);
    }
    // the look-ahead: while the look stick is idle the camera swings round to
    // the fall line, so the way down is what fills the screen
    const vx = p.velocity.x, vz = p.velocity.z;
    const sp = Math.hypot(vx, vz);
    if (sp > 6 && Math.abs(input.lookX) < 0.002) {
      p.cam.yaw = dampAngle(p.cam.yaw, Math.atan2(vx, vz), SLIDE.lookAhead * Math.min(1, sp / 16), dt);
    }
    // ...and tips down the slope by half its pitch, so the next lip is in frame
    if (sp > 6 && Math.abs(input.lookY) < 0.002 && p.grounded) {
      const n = game.board.physics.groundNormal(p.position.x, p.position.z);
      const slope = Math.acos(Math.min(1, n.y));
      p.cam.pitch += (-(0.1 + slope * 0.5) - p.cam.pitch) * Math.min(1, dt * 1.2);
    }
    return out;
  }

  private steer(p: Player, dt: number, input: FrameInput, game: Game): boolean {
    const st = this.state[p.slot];
    if (!st.sliding) return false;
    const v = p.velocity;
    const phys = game.board.physics;
    let speed = Math.hypot(v.x, v.z);

    // ---- gravity down the fall line (only on the ice itself) ----
    // The heightfield is the ice; a box under the feet (a slab, a ledge) is
    // flat ground and pulls nowhere.
    if (p.grounded && phys.heightAt && Math.abs(p.position.y - phys.heightAt(p.position.x, p.position.z)) < 0.25) {
      const n = this.n.copy(phys.groundNormal(p.position.x, p.position.z));
      v.x += SLIDE.pull * n.y * n.x * dt;
      v.z += SLIDE.pull * n.y * n.z * dt;
    }

    // ---- the stick: carve, shove off, dig in ----
    const { fwdX, fwdZ, rightX, rightZ } = basis(p.cam.yaw);
    speed = Math.hypot(v.x, v.z);
    const lateral = input.moveX;
    if (speed > 1.5 && Math.abs(lateral) > 0.05) {
      // turn the heading toward the stick's side at a lateral acceleration
      // of `steer`: the speed is kept, only its direction changes
      const hx = v.x / speed, hz = v.z / speed;
      // right of travel is (-hz, hx) (see `yawBasis`); the stick's right is
      // the camera's, so a camera looking back up the hill still steers true
      const camRight = -hz * rightX + hx * rightZ >= 0 ? 1 : -1;
      const accel = (p.grounded ? SLIDE.steer : SLIDE.airSteer) * lateral * camRight;
      const turn = (accel / Math.max(speed, 4)) * dt;
      rotate(v, -turn);
    }
    if (input.moveY > 0.2 && speed < SLIDE.pushBelow && p.grounded) {
      const wish = Math.hypot(fwdX * input.moveY + rightX * input.moveX, fwdZ * input.moveY + rightZ * input.moveX) || 1;
      v.x += ((fwdX * input.moveY + rightX * input.moveX) / wish) * SLIDE.pushAccel * dt;
      v.z += ((fwdZ * input.moveY + rightZ * input.moveX) / wish) * SLIDE.pushAccel * dt;
    }
    st.digging = p.grounded && input.moveY < -0.25;
    let drag = this.opts.drag?.(p) ?? 0;
    if (st.digging) {
      drag += SLIDE.dig * -input.moveY;
      if (Math.random() < dt * speed * 0.8) game.particles.dustPuff(p.position, 2);
    }
    // ---- drag: air, snow, heels, webs ----
    speed = Math.hypot(v.x, v.z);
    const k = Math.exp(-(SLIDE.drag * speed + drag) * dt);
    v.x *= k;
    v.z *= k;

    // ---- the banks, and the wall at the top of them ----
    const lane = this.opts.lane?.(p.position.x, p.position.z);
    if (lane) this.bank(p, lane, dt);

    if (this.opts.crash !== false) this.crash(p, game);
    speed = Math.hypot(v.x, v.z);
    if (speed > SLIDE.maxSpeed) { v.x *= SLIDE.maxSpeed / speed; v.z *= SLIDE.maxSpeed / speed; speed = SLIDE.maxSpeed; }
    st.speed = speed;
    // the spray off the edges of the boots
    if (p.grounded && speed > 8 && Math.random() < dt * speed * 0.5) game.particles.runDust(p.position);
    return true;
  }

  /**
   * A bobsleigh's banked turn, without a solver: riding up the bank turns the
   * heading back along the channel (keeping the speed), and the top of the
   * bank is a rail — the ice wall — that nothing crosses.
   */
  private bank(p: Player, lane: SlideLane, dt: number): void {
    const v = p.velocity;
    const over = Math.abs(lane.side) - lane.half;
    if (over <= 0) return;
    // outward, across the channel: right of the axis is (-az, ax) in this
    // game's yaw convention (see `yawBasis`), and `side` is signed that way
    const s = Math.sign(lane.side);
    const ox = -lane.az * s, oz = lane.ax * s;
    const out = v.x * ox + v.z * oz;
    const b = Math.min(1, over / Math.max(0.5, lane.bank));
    if (out > 0) {
      const speed = Math.hypot(v.x, v.z);
      const cut = Math.min(out, out * b * b * SLIDE.bankTurn * dt + (b >= 1 ? out : 0));
      v.x -= ox * cut;
      v.z -= oz * cut;
      // what was lost across is given back along — the bank turns, it does not brake
      const along = v.x * lane.ax + v.z * lane.az;
      const now = Math.hypot(v.x, v.z);
      if (now > 1e-3 && now < speed) {
        const give = Math.sqrt(Math.max(0, speed * speed - now * now)) * (along >= 0 ? 1 : -1);
        v.x += lane.ax * give;
        v.z += lane.az * give;
      }
    }
    // the wall: a hard edge at the top of the bank, whatever the height
    const wall = lane.half + lane.bank;
    if (Math.abs(lane.side) > wall) {
      const back = Math.abs(lane.side) - wall;
      p.position.x -= ox * back;
      p.position.z -= oz * back;
    }
  }

  /**
   * Into a body at speed: it goes over, and so does most of your speed, and
   * it gets a bite in on the way. This is what makes the gun and the kick
   * matter on the slide — the lane has to be cleared ahead, not ridden
   * through — and a crash is a stall, which is what the avalanche feeds on.
   */
  private crash(p: Player, game: Game): void {
    const st = this.state[p.slot];
    const v = p.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (sp < SLIDE.crashAbove || st.crashed < 0.8) return;
    for (const e of game.enemies) {
      if (!e.alive || e.team === p.team || e.downed) continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const reach = e.radius + p.radius + 0.25;
      if (dx * dx + dz * dz > reach * reach || Math.abs(e.position.y - p.position.y) > 1.6) continue;
      if (dx * v.x + dz * v.z < 0) continue;     // it is behind you: you have already gone through
      st.crashed = 0;
      v.x *= SLIDE.crashKeep;
      v.z *= SLIDE.crashKeep;
      p.damage(SLIDE.crashHurt, e.position);
      e.damage(SLIDE.crashHit, p.position, p.slot);
      e.knockback(p.position, 14, 0.5, 0.4);
      e.knockdown(0.9);
      p.cam.shake(0.25);
      audio.impact();
      game.particles.dustPuff(p.position, 16);
      return;
    }
  }

  private kick(p: Player, game: Game): void {
    const st = this.state[p.slot];
    st.kickCd = SLIDE.kickCd;
    const v = p.velocity;
    const sp = Math.hypot(v.x, v.z);
    const hx = sp > 0.5 ? v.x / sp : Math.sin(p.cam.yaw), hz = sp > 0.5 ? v.z / sp : Math.cos(p.cam.yaw);
    const at = p.position.clone().add(new THREE.Vector3(hx * 1.4, 0.6, hz * 1.4));
    let hit = false;
    for (const e of game.enemies) {
      if (!e.alive || e.team === p.team) continue;
      const dx = e.position.x - p.position.x, dz = e.position.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d > SLIDE.kickReach + SLIDE.kickReachPerSpeed * sp + e.radius || Math.abs(e.position.y - p.position.y) > 2.2) continue;
      if (d > 1.6 && (dx * hx + dz * hz) / d < -0.1) continue;   // behind you
      e.damage(SLIDE.kickDamage, p.position, p.slot);
      // out of the lane: shoved along your heading and off to whichever side it is on
      const side = (dx * -hz + dz * hx) >= 0 ? 1 : -1;
      const from = e.position.clone().add(new THREE.Vector3(-hx * 2 + hz * side * 2, 0, -hz * 2 - hx * side * 2));
      e.knockback(from, SLIDE.kickShove, 0.6, 0.45);
      e.knockdown(1.1);
      hit = true;
    }
    this.opts.onKick?.(p, at, game);
    game.particles.dustPuff(at, hit ? 14 : 6);
    audio.melee(0);
    if (hit) { st.kicked = 0; audio.meleeHit(); p.cam.shake(0.08); }
  }
}

/** the slide as a `Player.sectionMove` hook; keep the `SlideMove` for its state */
export function slideMove(opts: SlideOpts = {}): SlideMove {
  return new SlideMove(opts);
}

// ---------------------------------------------------------------- shared helpers

/** the camera's ground-plane basis (fwd/right), as `yawBasis` gives it */
function basis(yaw: number): { fwdX: number; fwdZ: number; rightX: number; rightZ: number } {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { fwdX: s, fwdZ: c, rightX: -c, rightZ: s };
}

/** turn a velocity's horizontal part by `a` radians (positive = toward +x from +z) */
function rotate(v: THREE.Vector3, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  const x = v.x * c + v.z * s;
  const z = -v.x * s + v.z * c;
  v.x = x;
  v.z = z;
}
