import * as THREE from 'three';
import type { Enemy } from './enemy';
import type { Game } from '../game/game';

/**
 * The combat director: the difference between "a crowd runs at you" and a
 * fight that feels fought.
 *
 * It owns two jobs the individual AI can't do for itself, because both are
 * about the *group*:
 *
 * 1. **Alerts** — noise (blaster fire, explosions, a jetpack overhead) and
 *    sightings spread outward from where they happened, so a firefight pulls
 *    in the nearby squad rather than the whole board.
 * 2. **Commitment** — of the enemies engaged with a given player, only a few
 *    are allowed to close to attacking range at a time. The rest hold a
 *    bearing at standoff distance and shoot. That is what produces pressure
 *    from several angles instead of a stampede, and it gives the player
 *    openings to push one flank.
 */

/** how far a squadmate's shout carries */
const SQUAD_RADIUS = 34;
/** enemies allowed to rush into melee range per player at once */
const MELEE_COMMIT = 2;
/** ranged enemies allowed to press to short range per player at once */
const RANGED_COMMIT = 2;
/** director re-plan interval, seconds — roles should not flicker per frame */
const REPLAN = 0.4;

export class CombatDirector {
  private timer = 0;

  /**
   * Something loud happened at `pos`. Anything hostile within `radius` looks
   * into it; `hard` means it goes straight to combat instead of investigating.
   */
  noise(game: Game, pos: THREE.Vector3, radius: number, hard = false): void {
    const r2 = radius * radius;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      if (e.position.distanceToSquared(pos) <= r2) e.alert(pos, hard);
    }
  }

  /** a squadmate spotted something — tell the rest of their squad */
  alertSquad(game: Game, from: Enemy, pos: THREE.Vector3): void {
    const r2 = SQUAD_RADIUS * SQUAD_RADIUS;
    for (const e of game.enemies) {
      if (e === from || !e.alive || e.squad !== from.squad) continue;
      if (e.position.distanceToSquared(from.position) <= r2) e.alert(pos, false);
    }
  }

  update(dt: number, game: Game): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REPLAN;

    // group the engaged hostiles by whichever player they are fighting
    const byTarget = new Map<unknown, Enemy[]>();
    for (const e of game.enemies) {
      if (!e.alive || !e.isEngaged || !e.target) { e.committed = false; continue; }
      const list = byTarget.get(e.target);
      if (list) list.push(e);
      else byTarget.set(e.target, [e]);
    }

    for (const [target, group] of byTarget) {
      const t = target as { position: THREE.Vector3 };
      group.sort(
        (a, b) =>
          a.position.distanceToSquared(t.position) - b.position.distanceToSquared(t.position)
      );
      let melee = 0;
      let ranged = 0;
      // Bearings are handed out around the whole circle so the group encircles
      // rather than clumping on the side it happened to approach from.
      const step = (Math.PI * 2) / Math.max(group.length, 1);
      for (let i = 0; i < group.length; i++) {
        const e = group[i];
        // keep each enemy near the bearing it already holds, but spread the set
        e.slotAngle = i * step + (e.id % 7) * 0.09;
        if (e.def.style === 'melee') e.committed = melee++ < MELEE_COMMIT;
        else if (e.def.style === 'ranged') e.committed = ranged++ < RANGED_COMMIT;
        else e.committed = true; // fliers run their own orbit patterns
      }
    }
  }
}
