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
 * Infinite lives in the PvE modes (2026-08-30, "for now"): Waves and Missions
 * never end in defeat — every fall plays the full dissolve-and-re-form and
 * the fight goes on, the walk back being the cost. PvP is *not* covered:
 * its three stands are the mode's win condition and stay finite. Flip this
 * to false to restore the wave game's defeat state; the machinery is intact.
 */
export const INFINITE_LIVES = true;

/**
 * ?waves=boss — boss rush, for testing the boss battles: a single wave
 * before each boss. Wave 1 rings in the champion, wave 2 the warlord (and
 * the monster, where the territory has one).
 */
export function bossRush(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('waves') === 'boss';
  } catch {
    return false;
  }
}

/**
 * Each territory's boss: its signature final-wave elite, promoted
 * (Enemy.promoteBoss) rather than a new character. Caps the wave game after
 * the final wave and holds the campaign's final arena — docs/MODES.md §4a.
 * Always the harder of the board's two boss battles: the warlord takes the
 * full promotion (×4.5 HP), where the mid-board champion below is promoted
 * lighter and ends up with roughly half the warlord's health everywhere.
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
 * The mid-board boss battle: after wave MID_BOSS_WAVE (and at the campaign
 * path's midpoint) the warlord sends its champion — a monster where the
 * board has one, an elite lieutenant otherwise. Promoted through the same
 * machinery as the warlord but lighter (the scales below are per-kind, so a
 * grunt-sized creature can be blown up into a proper monster), and always
 * the easier of the board's two boss battles.
 */
export interface MidBossDef {
  kind: EnemyKind;
  name: string;
  /** promoteBoss scales: health, damage, frame */
  hp: number; dmg: number; bulk: number;
}

export const MID_BOSS: Record<BoardId, MidBossDef> = {
  // The Dune Sea's champion is a monster in its own right — a burrowing worm
  // whose Def is already champion-scale, so it takes the banner-only
  // promotion the final monsters do. It used to be a promoted war massiff,
  // which the Lava Flats also field: no creature bosses two territories now.
  desert:    { kind: 'sandworm',     name: 'The Hunger Under the Sand', hp: 1, dmg: 1, bulk: 1 },
  station:   { kind: 'duelist',      name: 'The Dock Assassin',     hp: 3.0, dmg: 1.3,  bulk: 1.15 },
  nevarro:   { kind: 'massiff',      name: "The Magistrate's Hound", hp: 2.6, dmg: 1.2, bulk: 1.3 },
  crevasse:  { kind: 'krykna',       name: 'The Tunnel Queen',      hp: 14,  dmg: 2.0,  bulk: 1.9 },
  trask:     { kind: 'officer',      name: 'The Freighter Captain', hp: 2.6, dmg: 1.25, bulk: 1.15 },
  refinery:  { kind: 'flametrooper', name: 'The Furnace Master',    hp: 4.2, dmg: 1.5,  bulk: 1.25 },
  forge:     { kind: 'alamite',      name: 'The Rockdweller Alpha', hp: 11,  dmg: 1.9,  bulk: 1.6 },
  ringworld: { kind: 'ringEnforcer', name: 'The Silent Sentinel',   hp: 2.4, dmg: 1.3,  bulk: 1.2 },
  narkina:   { kind: 'deathtrooper', name: 'The Floor Supervisor',  hp: 4.0, dmg: 1.4,  bulk: 1.2 },
};

/**
 * Grunts a boss calls at its ⅔ and ⅓ health marks — the board's wave-one
 * backbone, spawned on the arena rim so the fight sweeps outward.
 */
/**
 * The monster that erupts when the warlord falls (docs/BOSSES.md §1).
 *
 * These are a *second, final stage* rather than a replacement: on a board with
 * a monster the elite going down is not victory — a short quake beat, and the
 * thing the territory has been sitting on top of comes up. Every territory
 * has one now — the Refinery, the Ringworld and the Prison Rig joined with the
 * second batch (docs/BOSSES.md §2.8–2.10) — and no creature serves two boards.
 * The map stays `Partial` only so a board can ship ahead of its monster; a
 * board without an entry would end at the warlord as they all once did.
 *
 * The `Def` behind each kind already carries its final boss stats, so nothing
 * here scales anything: `name` is the banner, `retinue` is who it calls at the
 * phase turns (the monster's own hangers-on rather than the board's garrison).
 */
export interface MonsterBossDef {
  kind: EnemyKind;
  name: string;
  retinue: EnemyKind;
}

export const MONSTER_BOSS: Partial<Record<BoardId, MonsterBossDef>> = {
  station:  { kind: 'mudhorn',  name: "The Smugglers' Prize",  retinue: 'pirate' },
  crevasse: { kind: 'ravinak',  name: 'The Ice-Breaker',       retinue: 'krykna' },
  trask:    { kind: 'mamacore', name: 'The Mamacore',          retinue: 'quarren' },
  nevarro:  { kind: 'rancor',   name: "The Warlord's Rancor",  retinue: 'pirate' },
  desert:   { kind: 'kraytDragon', name: 'The Old One of the Dune Sea', retinue: 'massiff' },
  forge:    { kind: 'mythosaur', name: 'The Sleeper Below',      retinue: 'alamite' },
  refinery:  { kind: 'zillo',     name: 'The Specimen',            retinue: 'stormtrooper' },
  ringworld: { kind: 'nexu',      name: 'The Night-Side Stalker',  retinue: 'pirate' },
  narkina:   { kind: 'kwazelMaw', name: 'The Thing in the Moon Pool', retinue: 'stormtrooper' },
};

export const BOSS_RETINUE: Record<BoardId, EnemyKind> = {
  desert: 'tusken', station: 'pirate', nevarro: 'pirate',
  crevasse: 'krykna', trask: 'quarren', refinery: 'stormtrooper',
  forge: 'alamite', ringworld: 'pirate', narkina: 'stormtrooper',
};
