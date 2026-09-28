import type { MandoId } from '../characters/mandalorians';

/**
 * A rival is a playable identity on the hostile side, never a party member:
 * each kind here fights as, looks like and is named after the hero it maps to.
 *
 * This is the one place that pairing is written. The `EnemyKind` union takes
 * its rival members from these keys, and the rival's stats, model, portrait
 * and display name are all looked up through it, so adding a rival is a line
 * here and a line in `DEFS` (which the compiler will ask for).
 *
 * Order matters within a family: src/game/rivals.ts fields the rivals of one
 * group in the order they appear here.
 *
 * Only a type is imported, on purpose: the asset layer reads this table, and
 * must not drag the character factory in behind it.
 */
export const RIVALS = {
  rivalMaul: 'maul', rivalRevan: 'revan', rivalVentress: 'ventress',
  rivalGalen: 'jedi', rivalMaris: 'maris',
  rivalCadBane: 'duelist', rivalEmbo: 'embo', rivalBossk: 'bossk',
  rivalBoKatan: 'bokatan',
} as const satisfies Record<string, MandoId>;

export type RivalKind = keyof typeof RIVALS;

export const RIVAL_KINDS = Object.keys(RIVALS) as RivalKind[];

/** The hero a kind stands in for, or undefined for anything that is not a rival. */
export function rivalHero(kind: string): MandoId | undefined {
  return (RIVALS as Record<string, MandoId>)[kind];
}
