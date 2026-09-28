import { BOARDS } from '../world/boards';

/**
 * The bounty hunt's ledger: which territories this device has liberated in
 * Missions, and the takedowns each hunter has put into them.
 *
 * It is what lets the map tick off the worlds already freed, and the game
 * know when the ninth one falls — the moment the campaign-complete screen is
 * for. Kept in localStorage beside the settings; a browser that will not
 * store it (private mode, storage off) simply plays each run fresh.
 */

const STORE = 'bountyHunters.hunt.v1';

export interface HuntLedger {
  /** territories liberated, in the order they fell */
  liberated: string[];
  /** takedowns across every liberated territory, by fighter id */
  kills: Record<string, number>;
  /** seconds on the clock across them */
  elapsed: number;
}

const empty = (): HuntLedger => ({ liberated: [], kills: {}, elapsed: 0 });

export function readHunt(): HuntLedger {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Partial<HuntLedger> | null;
    if (!raw || !Array.isArray(raw.liberated)) return empty();
    return {
      liberated: raw.liberated.filter((id) => BOARDS.some((b) => b.id === id)),
      kills: raw.kills && typeof raw.kills === 'object' ? raw.kills : {},
      elapsed: typeof raw.elapsed === 'number' ? raw.elapsed : 0,
    };
  } catch {
    return empty();
  }
}

function write(h: HuntLedger): void {
  try { localStorage.setItem(STORE, JSON.stringify(h)); } catch { /* private mode */ }
}

/** every territory on the route is free */
export const huntComplete = (h: HuntLedger): boolean => BOARDS.every((b) => h.liberated.includes(b.id));

/**
 * Enter a liberated territory in the ledger. Returns true when this was the
 * one that completed the hunt — the only time the complete screen is shown,
 * so replaying a freed world later does not roll it again.
 */
export function recordLiberation(board: string, fighters: Array<{ id: string; kills: number }>, elapsed: number): boolean {
  const h = readHunt();
  const was = huntComplete(h);
  if (!h.liberated.includes(board)) h.liberated.push(board);
  for (const f of fighters) h.kills[f.id] = (h.kills[f.id] ?? 0) + f.kills;
  h.elapsed += elapsed;
  write(h);
  return !was && huntComplete(h);
}

/** start the hunt over: every territory held by its warlord again */
export function resetHunt(): void { write(empty()); }
