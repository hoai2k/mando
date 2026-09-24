import type { MandoId } from '../characters/mandalorians';
import type { EnemyKind } from '../enemies/enemy';

/** A rival is a playable identity on the hostile side, never a party member. */
export const RIVAL_CHARACTER = {
  rivalMaul: 'maul', rivalRevan: 'revan', rivalVentress: 'ventress',
  rivalGalen: 'jedi', rivalMaris: 'maris',
  rivalCadBane: 'duelist', rivalEmbo: 'embo', rivalBossk: 'bossk',
  rivalBoKatan: 'bokatan',
} as const satisfies Partial<Record<EnemyKind, MandoId>>;

const FORCE = new Set<string>(['jedi', 'maris', 'ventress', 'maul', 'revan']);
const SITH = new Set<string>(['ventress', 'maul', 'revan']);
const HUNTERS = new Set<string>(['duelist', 'embo', 'bossk', 'ig11']);
const MANDOS = new Set<string>(['din', 'paz', 'bokatan', 'armorer']);

export function ringworldRivalBoss(party: readonly string[]): EnemyKind {
  if (!party.includes('maul')) return 'rivalMaul';
  if (!party.includes('revan')) return 'rivalRevan';
  return 'gunslinger';
}

/** Waves six and seven replace one or two ordinary soldiers with peers. */
export function rivalsForWave(wave: number, party: readonly string[]): EnemyKind[] {
  if (wave < 6) return [];
  const chosen = new Set(party);
  const groups: EnemyKind[][] = [];
  if (party.some((id) => FORCE.has(id))) {
    const preferLight = party.some((id) => SITH.has(id));
    const order: EnemyKind[] = preferLight
      ? ['rivalGalen', 'rivalMaris', 'rivalMaul', 'rivalRevan', 'rivalVentress']
      : ['rivalMaul', 'rivalRevan', 'rivalVentress', 'rivalGalen', 'rivalMaris'];
    groups.push(order.filter((kind) => !chosen.has(RIVAL_CHARACTER[kind as keyof typeof RIVAL_CHARACTER])));
  }
  if (party.some((id) => HUNTERS.has(id))) {
    groups.push((['rivalCadBane', 'rivalEmbo', 'rivalBossk'] as const)
      .filter((kind) => !chosen.has(RIVAL_CHARACTER[kind])));
  }
  if (party.some((id) => MANDOS.has(id)) && !chosen.has('bokatan')) groups.push(['rivalBoKatan']);
  const picks: EnemyKind[] = [];
  for (let index = 0; picks.length < (wave >= 7 ? 2 : 1); index++) {
    let added = false;
    for (const group of groups) {
      if (group[index]) { picks.push(group[index]); added = true; }
      if (picks.length >= (wave >= 7 ? 2 : 1)) break;
    }
    if (!added) break;
  }
  return picks;
}

const SOLDIERS = new Set<EnemyKind>([
  'tusken', 'pirateMelee', 'pyke', 'pirate', 'stormtrooper', 'deathtrooper',
  'alamite', 'quarren', 'ringEnforcer', 'officer', 'gunslinger',
]);

/** Preserve squad size and posting; only the identity of selected soldiers changes. */
export function replaceWithRivals(kinds: readonly EnemyKind[], wave: number,
  party: readonly string[]): EnemyKind[] {
  const out = [...kinds];
  for (const rival of rivalsForWave(wave, party)) {
    const index = out.findIndex((kind) => SOLDIERS.has(kind));
    if (index < 0) break;
    out[index] = rival;
  }
  return out;
}
