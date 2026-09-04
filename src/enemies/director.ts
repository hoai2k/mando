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

  /**
   * Someone just died at `pos`. Everyone hostile standing close enough to see
   * it flinches — suppression spikes, and their next shots go wide. Stacked
   * with the morale check above, mowing down half a squad visibly rattles
   * the rest before it breaks them.
   */
  deathNearby(game: Game, pos: THREE.Vector3): void {
    for (const e of game.enemies) {
      if (!e.alive || e.team === 0) continue;
      if (e.position.distanceToSquared(pos) < 12 * 12) e.suppress(0.45);
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

    // ---- morale: a squad that collapses breaks ----
    // RDR2 outlaws value their own lives: watch enough of the squad die and
    // the survivors run for it, rallying at distance instead of standing in
    // the open trading fire to the last man.
    const squads = new Map<number, { alive: Enemy[]; size: number }>();
    for (const e of game.enemies) {
      if (e.team !== 0 && e.squad > 0) {
        let rec = squads.get(e.squad);
        if (!rec) { rec = { alive: [], size: e.squadSize }; squads.set(e.squad, rec); }
        if (e.alive) rec.alive.push(e);
      }
    }
    for (const { alive, size } of squads.values()) {
      if (size >= 3 && alive.length === 1 && alive[0].isEngaged && alive[0].target && !alive[0].broke) {
        // last one standing from a real squad: even odds it breaks
        if (Math.random() < 0.5) alive[0].breakAndRun(alive[0].target.position);
      }
    }

    // Group the fighters by whatever they are fighting — the hostiles by the
    // player they have picked, the allies by the hostile they have picked.
    //
    // The allies were left out of this entirely, and it was why a cache squad
    // never joined a fight: `committed` is what tells a shooter to press in to
    // killing range and a melee body to actually charge, and an ally could
    // never be granted it. Five marshals would jog to the standoff band
    // fifteen to thirty metres off the nearest hostile, hold a bearing nobody
    // ever re-planned, and shuffle there for the rest of the wave. They are
    // the player's muscle: every one of them commits.
    const byTarget = new Map<unknown, Enemy[]>();
    for (const e of game.fighters()) {
      if (!e.alive || !e.isEngaged || !e.target || e.outOfFight) { e.committed = false; continue; }
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
        if (e.team === 0) e.committed = true;          // the player's own never hang back
        else if (e.def.relentless) e.committed = true; // beasts never hold back
        else if (e.def.style === 'melee') e.committed = melee++ < MELEE_COMMIT;
        else if (e.def.style === 'ranged') e.committed = ranged++ < RANGED_COMMIT;
        else e.committed = true; // fliers run their own orbit patterns
      }
    }
  }
}
