import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { Player } from '../../player/player';
import type { Enemy } from '../../enemies/enemy';
import type { SectionMove } from '../api';
import { GRAVITY } from '../../core/body';

/**
 * K7 — locomotion modes (docs/SECTIONS_IMPLEMENTATION.md §3).
 *
 * This file holds the section kit's ways of moving a body that the engine's
 * own locomotion does not have. Each is self-contained and goes in through
 * `Player.sectionMove` (with `composeMoves` when a section has several);
 * nothing here edits the player or the enemy.
 */

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
