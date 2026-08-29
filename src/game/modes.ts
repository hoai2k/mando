import type { BoardId } from '../world/board';
import type { EnemyKind } from '../enemies/enemy';

/**
 * The three game modes (docs/MODES.md). 'wave' is the game as it has always
 * been; 'pvp' and 'campaign' joined it on the title screen.
 */
export type GameMode = 'wave' | 'pvp' | 'campaign';

/**
 * Whether the title screen offers the mode select.
 *
 * On by default as of 2026-08-29 — the modes were behind `?modes` while they
 * were being built, and are now the default title screen. The escape hatch
 * survives the promotion rather than being deleted: `?nomodes` (or
 * `?modes=off`, or `=0`, or `=false`) puts the single Press Start back, which
 * is what the regression test uses to check the old path still works and what
 * anyone can reach for if a mode turns out to be broken in the wild.
 */
export function modesEnabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('nomodes')) return false;
    const v = q.get('modes');
    return !(v === 'off' || v === '0' || v === 'false');
  } catch {
    // no location to read (a non-browser host): the default stands
    return true;
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
