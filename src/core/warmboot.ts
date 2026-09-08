/**
 * The game's answer to "the player is reading something, start pulling".
 *
 * This exists to be imported WITHOUT booting the game. `main.ts` builds a
 * renderer and starts a loop the moment it is imported, which is exactly right
 * for the entry point and exactly wrong for a warm-up behind a sign-in door —
 * so the warming plan gets this doorway of its own into the same modules.
 *
 * Importing it is most of the point. `prefetch.ts` reaches the board tables,
 * the roster and the asset helpers, which reach Three.js, so the chunks the
 * game is about to need come down as a side effect of asking what to fetch.
 * Then `warmFor` does the real work: the title screen's art at `now`, whatever
 * screen comes next at `soon`, the rest on idle time — the same plan, in the
 * same lanes, that the game itself runs on every screen change. Nothing here
 * is a second copy of that policy; it is the same call, made earlier.
 *
 * Everything it starts is a hint. A file that is missed is downloaded later in
 * exactly the place it always was.
 */
import { warmFor } from './prefetch';
import { warmQueue } from './warm';

/**
 * Start pulling what the title screen and the screens after it are made of.
 *
 * `signal` is aborted when the visitor turns out not to be getting in, at which
 * point the queue drops whatever has not started. It is checked up front too,
 * for the race where the answer arrives before this module has finished
 * loading.
 */
export function warmAhead(signal?: AbortSignal): void {
  if (signal?.aborted) return;
  signal?.addEventListener('abort', () => warmQueue.clear(), { once: true });
  // No mode, no board, nobody picked — the plan reads a bare title context as
  // "both paths are still open" and warms the fork, which is the honest guess
  // for somebody who has not touched anything yet.
  warmFor({ screen: 'title' });
}
