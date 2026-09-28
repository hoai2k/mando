import * as THREE from 'three';
import type { FrameInput } from '../../core/input';
import type { Player } from '../../player/player';
import type { Game } from '../../game/game';
import type { SectionMove } from '../api';

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
