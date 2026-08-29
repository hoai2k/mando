/**
 * Loading and memory guards.
 *
 * Two regressions this catches, both found by profiling the nine boards after
 * the environment sculpts landed:
 *
 * 1. **The model cache used to grow without bound.** Its clones are what make a
 *    model cheap to reuse, so its resources are deliberately beyond a match's
 *    teardown — but a territory's own sculpts are wanted on that territory and
 *    nowhere else. Five boards in a row walked the renderer's live texture
 *    count 28 → 45 → 58 → 61 → 74 and the sixth crashed the tab. `disposeGame`
 *    now hands them back, and this asserts the count stays bounded across a
 *    full tour of every board.
 *
 * 2. **The prefetcher's per-board sculpt list can go stale.** `BOARD_PROPS` in
 *    core/prefetch.ts exists so a territory's art downloads while the player is
 *    still choosing a character; nothing but a list kept by hand can know it
 *    before the board is built. So the board records what it really asked for
 *    (`propsUsed`) and this holds the two against each other.
 *
 *   node tools/test-loadperf.mjs
 */
import { launch } from './harness.mjs';

const BOARDS = ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];
/** headroom over the worst board's own working set, before we call it a leak */
const TEXTURE_CEILING = 110;

const h = await launch();
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

const settle = async (board) => {
  await h.page.evaluate((b) => window.__startCoop(1, b), board);
  for (let i = 0; i < 240; i++) {
    if (await h.page.evaluate((b) => window.__game?.board.kind === b && window.__state === 'playing', board)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 7000));   // let the sculpts land
};

const peak = { tex: 0, board: '' };
const drift = [];
for (const board of BOARDS) {
  await settle(board);
  const r = await h.page.evaluate(() => ({
    tex: window.__renderer.info.memory.textures,
    geo: window.__renderer.info.memory.geometries,
    used: window.__propsUsed(),
    warmed: window.__boardProps ? window.__boardProps() : null,
  }));
  if (r.tex > peak.tex) { peak.tex = r.tex; peak.board = board; }
  drift.push({ board, used: r.used });
  console.log(`  ${board.padEnd(10)} textures ${String(r.tex).padStart(3)}  geometries ${String(r.geo).padStart(4)}  sculpts ${r.used.length}`);
}
check('GPU textures stay bounded across every board',
  peak.tex < TEXTURE_CEILING, `peak ${peak.tex} on ${peak.board}, ceiling ${TEXTURE_CEILING}`);

// the prefetcher's list against what the boards really loaded
const warmLists = await h.page.evaluate(() => window.__boardProps());
for (const { board, used } of drift) {
  const warmed = new Set(warmLists[board] ?? []);
  const missing = used.filter((id) => !warmed.has(id));
  check(`${board}: every sculpt it builds is prefetched`, missing.length === 0, missing.join(', '));
}
const allUsed = new Set(drift.flatMap((d) => d.used));
const stale = Object.entries(warmLists).flatMap(([b, ids]) => ids.filter((id) => !allUsed.has(id)).map((id) => `${b}:${id}`));
check('no stale entries in the prefetch list', stale.length === 0, stale.join(', '));

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
process.exit(failed || h.errors.length ? 1 : 0);
