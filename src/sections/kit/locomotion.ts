import * as THREE from 'three';
import type { FrameInput } from '../../core/input';
import type { Player } from '../../player/player';
import type { Game } from '../../game/game';
import type { SectionMove } from '../api';
import { audio } from '../../core/audio';
import { dampAngle } from '../../core/math';
import type { Combatant, Enemy } from '../../enemies/enemy';
import { GRAVITY } from '../../core/body';

/**
 * K7 — locomotion modes (docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * Ways of moving a body that are not running: the **slide** (the Glacier
 * Chute), **flight** (Covert Sky) and the deck **tilt** (the Squall). Each is a factory that returns a
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
  /**
   * The stick is a lateral force across the channel, m/s², not a heading
   * change: it builds sideways momentum, and the ice keeps it (`lateralGrip`),
   * so a turn drifts on after the stick lets go. This is the even-handed
   * figure; `steerOut` / `steerIn` shape it by which way the body is already
   * going.
   */
  steer: 15,
  /** the same, in the air: a lean, not a turn */
  airSteer: 3.5,
  /**
   * Edging out — pushing the way the body is already sliding across the ice,
   * or downhill on a bank — goes with the momentum and bites harder...
   */
  steerOut: 1.3,
  /** ...and digging back in against it bites less: the edges skate before they hold */
  steerIn: 0.55,
  /**
   * Lateral momentum, m/s, at which that asymmetry is all the way in. With
   * none at all the stick gets the mean of the two, either way.
   */
  steerMomentum: 2,
  /**
   * How much the cross-slope pull counts toward that momentum, in seconds of
   * it: on a sideways tilt, downhill is the outward edge before the body has
   * started to drift that way.
   */
  steerTilt: 0.3,
  /** the stick can push sideways momentum this far and no further, m/s (the edge lets go) */
  maxLateral: 12,
  /**
   * The ice's grip on sideways momentum, per second. Low: what the stick
   * builds is still mostly there a second later. (Banks and walls catch the
   * rest, as before.)
   */
  lateralGrip: 0.35,
  /** pull back on the stick: the heels dig in, a drag that checks the speed but never stops it */
  dig: 0.4,
  /** push on the stick below this speed and the body shoves off (the flat, a stall) */
  pushBelow: 7,
  pushAccel: 6,
  /** how hard a bank turns you back along the channel as you ride up it */
  bankTurn: 6,
  /**
   * Melee on the slide is the fighter's own swing, on the arms, while the
   * legs ride; the boots go out with it and tear a web in front of them, at
   * most every `kickCd` seconds. A swing that connects while sliding bowls
   * what it hits over: down for `kickDown` seconds, and at least `kickDamage`
   * of hurt, more the faster you are coming (`kickDamagePerSpeed` per m/s
   * over `crashAbove`).
   */
  kickDamage: 22,
  kickDamagePerSpeed: 0.6,
  kickDown: 1.1,
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
 * slope, the stick as a lateral force, a dig-in drag, a feet-first surf, the
 * fighter's own melee swung from it, and hip-fire only.
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
      carried: (p) => this.state[p.slot].sliding,
      meleeHit: (p, target, amount) => this.meleeHit(p, target, amount),
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
    // footing to push off), and hip-fire only (the sights want a stance).
    // Melee goes through: the fighter swings their own weapon (or fists) from
    // the slide — the player plays it on the arms and lands it as normal, and
    // `carried` keeps the lunge and the planted feet out of it. The boots
    // going out with it are what tear a web.
    const out = { ...input, sprintHeld: false, dashPressed: false, aimHeld: false };
    if (input.meleePressed && st.kickCd <= 0) this.kick(p, game);
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
    const onIce = p.grounded && !!phys.heightAt && Math.abs(p.position.y - phys.heightAt(p.position.x, p.position.z)) < 0.25;
    const n = this.n.set(0, 1, 0);
    if (onIce) {
      n.copy(phys.groundNormal(p.position.x, p.position.z));
      v.x += SLIDE.pull * n.y * n.x * dt;
      v.z += SLIDE.pull * n.y * n.z * dt;
    }

    // ---- the stick: carve, shove off, dig in ----
    const { fwdX, fwdZ, rightX, rightZ } = basis(p.cam.yaw);
    speed = Math.hypot(v.x, v.z);
    // The frame the carve works in: along the channel and across it (the
    // lane's axis; off the lane, the way the body is going). Right of an axis
    // is (-az, ax) in this game's yaw convention (see `yawBasis`).
    const lane = this.opts.lane?.(p.position.x, p.position.z);
    const ax = lane ? lane.ax : speed > 1.5 ? v.x / speed : fwdX;
    const az = lane ? lane.az : speed > 1.5 ? v.z / speed : fwdZ;
    const rx = -az, rz = ax;
    const lateral = input.moveX;
    if (speed > 1.5 && Math.abs(lateral) > 0.05) {
      // A force across the channel, not a turn: it adds sideways momentum and
      // the heading follows from the velocity. The stick's right is the
      // camera's, so a camera looking back up the hill still steers true.
      const push = lateral * (rx * rightX + rz * rightZ >= 0 ? 1 : -1);
      // The momentum the push meets: what the body already has across the
      // channel, plus the bank's pull downhill. Pushing with it is edging out
      // (`steerOut`), against it digging back in (`steerIn`); in between the
      // two shade into each other.
      const across = v.x * rx + v.z * rz;
      const tilt = SLIDE.pull * n.y * (n.x * rx + n.z * rz);
      const momentum = across + tilt * SLIDE.steerTilt;
      const withIt = Math.max(0, Math.min(1, 0.5 + Math.sign(push) * momentum / (2 * SLIDE.steerMomentum)));
      const gain = SLIDE.steerIn + (SLIDE.steerOut - SLIDE.steerIn) * withIt;
      let dw = (p.grounded ? SLIDE.steer : SLIDE.airSteer) * gain * push * dt;
      // the edge holds only so much: past `maxLateral` the push slips
      const room = Math.max(0, SLIDE.maxLateral - Math.sign(push) * across);
      dw = Math.sign(dw) * Math.min(Math.abs(dw), room);
      v.x += rx * dw;
      v.z += rz * dw;
    }
    if (p.grounded) {
      // what the ice keeps of the sideways momentum: most of it
      const across = v.x * rx + v.z * rz;
      const lose = across * (1 - Math.exp(-SLIDE.lateralGrip * dt));
      v.x -= rx * lose;
      v.z -= rz * lose;
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

  /**
   * The boots going out with a swing: whatever web is in front of them tears
   * (the section's `onKick`). The swing itself is the player's own.
   */
  private kick(p: Player, game: Game): void {
    const st = this.state[p.slot];
    st.kickCd = SLIDE.kickCd;
    const v = p.velocity;
    const sp = Math.hypot(v.x, v.z);
    const hx = sp > 0.5 ? v.x / sp : Math.sin(p.cam.yaw), hz = sp > 0.5 ? v.z / sp : Math.cos(p.cam.yaw);
    const at = p.position.clone().add(new THREE.Vector3(hx * 1.4, 0.6, hz * 1.4));
    this.opts.onKick?.(p, at, game);
    game.particles.dustPuff(at, 6);
  }

  /**
   * A swing thrown from the slide has the slide behind it: what it lands on
   * goes over, and it hurts more the faster you are coming. This is what
   * clears the lane ahead (the crash is what happens when you do not).
   */
  private meleeHit(p: Player, target: Combatant, amount: number): number {
    const st = this.state[p.slot];
    if (!st.sliding) return amount;
    st.kicked = 0;
    (target as Partial<Enemy>).knockdown?.(SLIDE.kickDown);
    const over = Math.max(0, st.speed - SLIDE.crashAbove);
    return Math.max(amount, SLIDE.kickDamage + over * SLIDE.kickDamagePerSpeed);
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


/**
 * K7 — locomotion modes (docs/SECTIONS_IMPLEMENTATION.md §3): the ways a
 * section can change how a body moves, each going in through
 * `Player.sectionMove`. Each mode below is self-contained.
 */

// ------------------------------------------------------------------ flight

/**
 * `flightMove` — the Armorer's boosters (Covert Sky).
 *
 * For one beat everybody flies and nobody runs dry:
 *
 * - **A** is lift. A jetpack burns with no fuel cost (the tank is held full);
 *   a super-jumper, who wears no pack, is fitted with the same boosters, so
 *   holding A relights the rise in mid-air (`Player.relightRise`) and a
 *   plume shows it is the boosters doing the work.
 * - Off A, the boosters **carry the fall**: it is capped at a glide rather
 *   than a drop, so letting go is how you lose height, not how you die.
 * - The airborne top speed is raised (`Player.flightTopSpeed`), so the stick
 *   flies you rather than drifting you.
 * - **LB (dash) is a boost**: a burst along the line you are looking down,
 *   pitch included, at a higher top speed for a moment.
 * - **Y (slam) is a dive**: nose down, fast, and it holds until you land or
 *   press A to pull out. The ground is met as a landing, never a slam.
 *
 * On the ground everything is normal on-foot play, which is what makes
 * landing on a tower top to plant a charge a change of pace.
 */
export interface FlightOpts {
  /** airborne top speed, m/s (a run is ~9) */
  topSpeed?: number;
  /** the boost's speed, and how long it holds */
  boostSpeed?: number;
  boostTime?: number;
  /** seconds between boosts */
  boostCd?: number;
  /** the dive's sink rate, m/s */
  diveSpeed?: number;
  /** the fall is held to this, m/s, while nothing is pressed */
  glideFall?: number;
}

export interface FlightMove extends SectionMove {
  /** is this slot mid-dive? (for animation, HUD, autopilots) */
  diving(slot: number): boolean;
  /** push a body along `dir` at `speed` for `secs` — a ring's boost */
  boost(p: Player, dir: THREE.Vector3, speed: number, secs: number): void;
  /** take the boosters off every player (the section's dispose) */
  release(players: Player[]): void;
}

const _dir = new THREE.Vector3();
const _at = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export function flightMove(opts: FlightOpts = {}): FlightMove {
  const top = opts.topSpeed ?? 21;
  const boostSpeed = opts.boostSpeed ?? 34;
  const boostTime = opts.boostTime ?? 0.8;
  const boostCd = opts.boostCd ?? 1.4;
  const diveSpeed = opts.diveSpeed ?? 26;
  const glideFall = opts.glideFall ?? 6;
  const st = new Map<number, { boostT: number; boostV: number; cd: number; dive: boolean; dir: THREE.Vector3 }>();
  const state = (slot: number) => {
    let s = st.get(slot);
    if (!s) { s = { boostT: 0, boostV: 0, cd: 0, dive: false, dir: new THREE.Vector3() }; st.set(slot, s); }
    return s;
  };

  const startBoost = (p: Player, dir: THREE.Vector3, speed: number, secs: number): void => {
    const s = state(p.slot);
    s.boostT = secs;
    s.boostV = speed;
    s.dir.copy(dir).normalize();
    s.dive = false;
    p.velocity.copy(s.dir).multiplyScalar(speed);
  };

  return {
    adjust(p: Player, dt: number, input: FrameInput, game: Game): FrameInput {
      const s = state(p.slot);
      // the boosters burn free
      p.fuel = 1;
      s.cd = Math.max(0, s.cd - dt);
      if (p.grounded || p.vehicle || !p.alive) {
        s.dive = false;
        s.boostT = 0;
        p.flightTopSpeed = null;
        return input;
      }
      let inp = input;
      // LB: a boost down the sight line
      if (input.dashPressed && s.cd <= 0) {
        s.cd = boostCd;
        startBoost(p, p.cam.aimDir(_dir), boostSpeed, boostTime);
        game.particles.dustPuff(p.position, 4);
        p.cam.shake(0.08);
        inp = { ...inp, dashPressed: false };
      } else if (input.dashPressed) inp = { ...inp, dashPressed: false };
      // Y: a dive (and never the slam it would otherwise be)
      if (input.slamPressed) {
        s.dive = true;
        s.boostT = 0;
        inp = { ...inp, slamPressed: false };
      }
      if (s.dive && input.jumpPressed) s.dive = false;
      if (s.boostT > 0) {
        // the boost holds its line (gravity is paid back here), easing out
        s.boostT -= dt;
        const k = Math.max(0, s.boostT / boostTime);
        const v = top + (s.boostV - top) * k;
        p.velocity.x = s.dir.x * v;
        p.velocity.z = s.dir.z * v;
        p.velocity.y = Math.max(p.velocity.y, s.dir.y * v);
        p.flightTopSpeed = v;
      } else p.flightTopSpeed = top;
      if (s.dive) {
        p.velocity.y = Math.min(p.velocity.y, -diveSpeed);
        p.flightTopSpeed = top * 1.2;
      } else if (!input.jumpHeld && p.velocity.y < -glideFall) {
        // the boosters carry the fall: a glide, not a drop
        p.velocity.y = -glideFall;
      }
      // a super-jumper's boosters: A relights the rise, and shows it
      if (p.profile.flight === 'superjump' && input.jumpHeld && !s.dive) {
        p.relightRise();
        _at.copy(p.position);
        _at.y += p.height * 0.55;
        _at.x -= Math.sin(p.facingYaw) * 0.35;
        _at.z -= Math.cos(p.facingYaw) * 0.35;
        game.particles.jetPlume(_at, _down, dt, { power: 0.7, scale: 0.8, carrier: p.velocity });
      }
      return inp;
    },
    diving: (slot) => state(slot).dive,
    boost: startBoost,
    release(players: Player[]): void {
      for (const p of players) p.flightTopSpeed = null;
      st.clear();
    },
  };
}

// ---------------------------------------------------------------- deck tilt

/**
 * A deck that rolls (The Squall): a trawler heeling on the swell.
 *
 * **Nothing solid rotates.** The colliders stay flat and level — a rotating
 * box would mean every body, bolt and ragdoll learning about tilted ground —
 * and the roll is two things laid over a level deck instead:
 *
 *  - **the drift**: a lateral acceleration on every body toward the low side,
 *    `gain · g · sin(roll)`, added to its velocity before it moves. A body's
 *    own footing damps it, so on the ground it is a lean you correct without
 *    thinking and in the air (a jump, a burn, a knockdown's flight) it is a
 *    real slide — which is how a heeling deck feels to stand on;
 *  - **the picture**: the hull rolls about its keel line, and every body on
 *    the deck is carried with the point of the hull it stands on (after it
 *    has written its own pose, through `SectionInstance.afterFrame`), upright
 *    — people on a rolling deck stand plumb, not square to the planks. The
 *    camera stays level: it follows the body's physical position, so the
 *    horizon holds still and the deck moves under it, which is both what the
 *    design asks for and far kinder to the stomach than a rolling view.
 *
 * `roll` is in radians about the +Z axis (the keel), **positive when the +X
 * side is low** — so the drift is toward +X for a positive roll. The section
 * sets it every frame; this does the rest.
 */
export interface DeckTiltOptions {
  /** the keel line the hull rolls about: x of the centreline, y of the pivot */
  axisX?: number;
  pivotY: number;
  /** the deck's own height (a body more than `airAbove` over it is airborne) */
  deckY: number;
  /** the drift's strength as a multiple of gravity (1 = a frictionless plank) */
  gain?: number;
  /** is this x,z over the deck? Bodies off it are neither pushed nor carried */
  onDeck(x: number, z: number): boolean;
  /**
   * How much of the roll a body `h` metres over the pivot is carried with —
   * 1 on the deck and the deckhouse roof, fading out for a jetpack high over
   * the mast, so a flyer is not swung about by a hull it is not touching.
   */
  carryUpTo?: number;
}

/** what the tilt pushes: anything with a position and a velocity */
export interface TiltBody { position: THREE.Vector3; velocity: THREE.Vector3 }

export class DeckTilt {
  /** radians; positive = +X side low */
  roll = 0;
  readonly axisX: number;
  readonly pivotY: number;
  readonly deckY: number;
  gain: number;
  readonly carryUpTo: number;
  private readonly onDeck: (x: number, z: number) => boolean;

  constructor(opts: DeckTiltOptions) {
    this.axisX = opts.axisX ?? 0;
    this.pivotY = opts.pivotY;
    this.deckY = opts.deckY;
    this.gain = opts.gain ?? 1.6;
    this.carryUpTo = opts.carryUpTo ?? 7;
    this.onDeck = opts.onDeck;
  }

  /** the lateral acceleration toward the low side right now, m/s² (signed along +X) */
  get accel(): number {
    return this.gain * GRAVITY * Math.sin(this.roll);
  }

  /** push one body for a frame; `scale` lets a section weaken it (a flyer, a braced body) */
  push(b: TiltBody, dt: number, scale = 1): void {
    if (!this.onDeck(b.position.x, b.position.z)) return;
    b.velocity.x += this.accel * scale * dt;
  }

  /**
   * The drift for players, as a `sectionMove`: added before the body moves,
   * so its own footing is what damps it. `scale(p)` may return 0 for a body
   * the section holds still (braced in cover, riding something).
   */
  move(scale?: (p: Player) => number): SectionMove {
    return {
      adjust: (p, dt, input) => {
        if (p.alive && !p.vehicle && !p.cover) this.push(p, dt, scale ? scale(p) : 1);
        return input;
      },
    };
  }

  /**
   * The drift for every hostile on the deck. Call from the section's `update`
   * (which runs before the enemies move). Bodies still arriving — swimming in,
   * dropping, flying to a post — are left to their arrival.
   */
  pushEnemies(game: Game, dt: number): void {
    for (const e of game.enemies) {
      if (!e.alive || e.arriving || e.team !== 1) continue;
      // the air is not the deck: a hovering flyer holds its own station
      const over = e.position.y - this.deckY;
      this.push(e, dt, over > 3 ? 0 : 1);
    }
  }

  /**
   * Where a point riding the hull at `p` is drawn this frame: rotated about
   * the keel line with the hull. Returns the offset to add to it.
   */
  carry(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (this.roll === 0 || !this.onDeck(p.x, p.z)) return out;
    const x = p.x - this.axisX;
    const h = p.y - this.pivotY;
    // a body well above the hull is not riding it: carry fades out overhead
    const over = p.y - this.deckY;
    const k = over <= this.carryUpTo ? 1 : Math.max(0, 1 - (over - this.carryUpTo) / 4);
    if (k <= 0) return out;
    // the hull turns by -roll about +Z (so a positive roll drops +X)
    const c = Math.cos(this.roll), s = Math.sin(this.roll);
    out.x = (x * c + h * s - x) * k;
    out.y = (-x * s + h * c - h) * k;
    return out;
  }

  /**
   * Carry every living body on the deck with the hull, after it has written
   * its own pose. Call from `SectionInstance.afterFrame`. The next frame's
   * `syncVisual` writes each root afresh from the body's position, so this
   * never accumulates.
   */
  poseBodies(game: Game): void {
    if (this.roll === 0) return;
    for (const p of game.players) {
      if (p.vehicle) continue;
      this.carry(p.position, _off);
      p.char.root.position.add(_off);
    }
    for (const e of game.enemies) {
      // a corpse is placed by its ragdoll, which owns the root
      if (!e.alive) continue;
      this.carry(e.position, _off);
      e.char.root.position.add(_off);
    }
  }

  /** the hull's own rotation, for the group the section rolls (about +Z) */
  get hullRotation(): number { return -this.roll; }
}

const _off = new THREE.Vector3();

/** a deck that rolls: see `DeckTilt` */
export function deckTilt(opts: DeckTiltOptions): DeckTilt {
  return new DeckTilt(opts);
}

/** the hostiles `DeckTilt` would push — exported for a section's own sweeps */
export function deckHostiles(game: Game): Enemy[] {
  return game.enemies.filter((e) => e.alive && !e.arriving && e.team === 1);
}
