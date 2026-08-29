import type { BoardId } from '../world/board';
import type { EnemyKind } from '../enemies/enemy';

/**
 * The three game modes (docs/MODES.md). 'wave' is the game as it has always
 * been; 'pvp' and 'campaign' are experimental and only reachable while the
 * `?modes` URL flag is present — without it the title shows the single
 * Press Start and nothing below ever sees another mode.
 */
export type GameMode = 'wave' | 'pvp' | 'campaign';

/** True when the experimental mode select is enabled via `?modes`. */
export function modesEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('modes');
  } catch {
    return false;
  }
}

/**
 * Each territory's boss: its signature final-wave elite, promoted
 * (Enemy.promoteBoss) rather than a new character. Caps the wave game after
 * wave 10 and holds the campaign's final arena — docs/MODES.md §4a.
 */
export const BOSS_KIND: Record<BoardId, EnemyKind> = {
  desert: 'enforcer', station: 'capo', nevarro: 'officer',
  crevasse: 'broodmother', trask: 'capo', refinery: 'officer',
  forge: 'enforcer', ringworld: 'duelist', narkina: 'officer',
};

/** Banner/boss-bar name per territory. */
export const BOSS_NAME: Record<BoardId, string> = {
  desert: 'The Pit Warlord',
  station: 'The Spice Baron',
  nevarro: 'The Garrison Commander',
  crevasse: 'The Broodmother',
  trask: 'The Harbourmaster',
  refinery: 'The Darksaber Officer',
  forge: 'The Forge Tyrant',
  ringworld: 'The Fastest Gun on Glavis',
  narkina: 'The Prison Warden',
};

/**
 * Grunts a boss calls at its ⅔ and ⅓ health marks — the board's wave-one
 * backbone, spawned on the arena rim so the fight sweeps outward.
 */
export const BOSS_RETINUE: Record<BoardId, EnemyKind> = {
  desert: 'tusken', station: 'pirate', nevarro: 'pirate',
  crevasse: 'krykna', trask: 'quarren', refinery: 'stormtrooper',
  forge: 'alamite', ringworld: 'pirate', narkina: 'stormtrooper',
};
