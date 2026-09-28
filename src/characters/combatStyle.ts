/**
 * How each fighter moves in a fight: the cadence and weight their strikes are
 * thrown with. A heavy brawler takes longer to load a blow and leans further
 * into it; an agile one snaps it out. The workbench studies build their clips
 * at these rates, and the game plays the shared unarmed clips at them.
 */
export type CombatStyle = 'measured' | 'heavy' | 'agile' | 'mechanical' | 'hunter';

const STYLE: Record<string, CombatStyle> = {
  din: 'measured', paz: 'heavy', bokatan: 'agile', armorer: 'heavy',
  ventress: 'agile', jedi: 'measured', maul: 'agile', revan: 'measured', embo: 'agile', bossk: 'hunter', duelist: 'measured', ig11: 'mechanical',
  tusken: 'hunter', pirateMelee: 'heavy', alamite: 'hunter', officer: 'measured', enforcer: 'heavy',
  droid: 'mechanical', darktrooper: 'mechanical', escortDroid: 'mechanical',
  fennec: 'agile', marshal: 'measured', gunslinger: 'measured',
};

/** A fighter's style by character id; a playable NPC (`npc:fennec`) goes by its kind. */
export const combatStyle = (id: string): CombatStyle => STYLE[id.replace(/^npc:/, '')] ?? 'measured';

/** how much longer than standard a strike takes, by style */
export const PACE: Record<CombatStyle, number> = { measured: 1, heavy: 1.18, agile: 0.84, mechanical: 1.05, hunter: 1.08 };
/** how far into a strike the body commits, by style */
export const WEIGHT: Record<CombatStyle, number> = { measured: 1, heavy: 1.18, agile: 0.88, mechanical: 1.06, hunter: 1.08 };

/** a fighter's strike duration against standard: >1 is slower */
export const strikePace = (id: string): number => PACE[combatStyle(id)];

/**
 * Hostiles who fight with their bare hands: the brawlers outright, and the
 * gunfighters when a body walks up on them. Heroes who do go by their roster
 * entry's `melee: 'fists'`.
 */
export const FIST_ENEMIES: ReadonlySet<string> = new Set(['enforcer', 'pirateMelee', 'fennec', 'marshal', 'gunslinger']);
