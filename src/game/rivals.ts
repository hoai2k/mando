import { MANDO_ROSTER, type MandoConfig } from '../characters/mandalorians';
import type { EnemyKind } from '../enemies/enemy';
import { RIVALS, RIVAL_KINDS, type RivalKind } from '../enemies/rivals';

/** every playable the roster files under `test`, by id; benched ones included */
function heroes(test: (cfg: MandoConfig) => boolean): ReadonlySet<string> {
  return new Set(Object.entries(MANDO_ROSTER).filter(([, cfg]) => test(cfg)).map(([id]) => id));
}
/** every rival whose hero `test` accepts, in the rival table's order */
function rivals(test: (cfg: MandoConfig) => boolean): RivalKind[] {
  return RIVAL_KINDS.filter((kind) => test(MANDO_ROSTER[RIVALS[kind]]));
}

const isForce = (cfg: MandoConfig) => cfg.group === 'force';
const isSith = (cfg: MandoConfig) => !!cfg.sith;
const isHunter = (cfg: MandoConfig) => cfg.group === 'hunter';
const isMando = (cfg: MandoConfig) => cfg.group === 'mando';
const FORCE = heroes(isForce);
const SITH = heroes(isSith);
const HUNTERS = heroes(isHunter);
const MANDOS = heroes(isMando);

export function ringworldRivalBoss(party: readonly string[]): EnemyKind {
  if (!party.includes('maul')) return 'rivalMaul';
  if (!party.includes('revan')) return 'rivalRevan';
  return 'gunslinger';
}

/** Waves six and seven replace one or two ordinary soldiers with peers. */
export function rivalsForWave(wave: number, party: readonly string[]): EnemyKind[] {
  if (wave < 6) return [];
  const chosen = new Set(party);
  // nobody fights their own double
  const open = (kinds: RivalKind[]) => kinds.filter((kind) => !chosen.has(RIVALS[kind]));
  const groups: EnemyKind[][] = [];
  if (party.some((id) => FORCE.has(id))) {
    // a Sith in the party is met by the light side first, anyone else by the dark
    const light = rivals((cfg) => isForce(cfg) && !isSith(cfg));
    const dark = rivals((cfg) => isForce(cfg) && isSith(cfg));
    const preferLight = party.some((id) => SITH.has(id));
    groups.push(open(preferLight ? [...light, ...dark] : [...dark, ...light]));
  }
  if (party.some((id) => HUNTERS.has(id))) groups.push(open(rivals(isHunter)));
  if (party.some((id) => MANDOS.has(id))) groups.push(open(rivals(isMando)));
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
