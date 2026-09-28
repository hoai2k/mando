import type { Board } from '../board';
import type { MissionSpec, MissionStage } from '../mission';
import { SHOCK_CYCLE, SHOCK_CHARGE_AT, SHOCK_LIVE_AT, SHOCK_DPS } from './common';
import { createStageBuilder } from './builder';
import { layZones } from './zones';
import { layCanyon } from './canyon';
import { layDoors } from './doors';
import { settleBorders, raiseHorizon } from './borders';
import { validateSpots, layWater, stageTeardown } from './finish';

/**
 * Raise one stage of a territory's run over the board.
 *
 * Everything the stage puts into the world — meshes, colliders, hazards,
 * board hooks — is recorded, so `dispose()` can take it all back out again
 * when the party crosses a transport door into the next one.
 */
export function buildStage(board: Board, spec: MissionSpec, index: number, beat0 = 0): MissionStage {
  const b = createStageBuilder(board, spec, index, beat0);
  const { stage, defenders, pickups, rides, path, rects, shockStrips, floorY, ceilingY, groundAt } = b;

  // The phases run in the order the one function ran them in, and that order
  // is load-bearing: the seeded dice are drawn as each phase goes, and each
  // lays against what the ones before it built — the canyon against the
  // zones, the doors against the gorge, the border merge against every floor
  // and doorway, validation against every collider.
  const chain = layZones(b);
  const { zones } = chain;
  const { gorgeDepth, gorgeHalf } = layCanyon(b, chain);
  const { exitPortal, backPortal } = layDoors(b, chain, gorgeDepth, gorgeHalf);
  settleBorders(b, exitPortal, backPortal);
  raiseHorizon(b);
  const starts = validateSpots(b, zones);
  const waterY = layWater(b);

  const contains = (x: number, z: number): boolean =>
    rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);

  const dispose = stageTeardown(b, zones, exitPortal, backPortal);

  return {
    spec: stage,
    index,
    zones, defenders, pickups, starts, rides, path,
    exitPortal, backPortal,
    floorY, ceilingY, waterY, groundAt,
    contains, dispose,
    tick: (time: number) => {
      for (const s of shockStrips) {
        const t = (time + s.phase) % SHOCK_CYCLE;
        const live = t >= SHOCK_LIVE_AT;
        const charging = !live && t >= SHOCK_CHARGE_AT;
        for (const h of s.hazards) h.dps = live ? SHOCK_DPS : 0;
        s.mat.opacity = live ? 0.85 + Math.sin(time * 30) * 0.12
          : charging ? 0.2 + ((t - SHOCK_CHARGE_AT) / (SHOCK_LIVE_AT - SHOCK_CHARGE_AT)) * 0.4 * (Math.sin(time * 14) * 0.5 + 0.5)
            : 0.12;
      }
    },
  };
}
