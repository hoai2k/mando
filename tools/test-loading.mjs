/**
 * Asset warming and the drop screen.
 *
 * The point of the warming system is that the heavy files are already local by
 * the time they are needed, and the point of the loading screen is that a
 * territory is never shown as its procedural stand-in first. Both are invisible
 * when they work, which is exactly why they need a test: this one watches what
 * the page actually fetched, screen by screen, and checks that the match is not
 * revealed while anything it needs is still coming.
 *
 * Run:  node tools/test-loading.mjs
 */
import { launch, BTN } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const h = await launch();
/** every asset the page has actually pulled down, by file name */
const fetched = () => h.page.evaluate(() => performance.getEntriesByType('resource')
  .filter((e) => /\.glb$|assets\/textures\/.*\.(jpg|png)$/.test(e.name))
  .map((e) => e.name.split('/').pop()));
const has = async (name) => (await fetched()).includes(name);
const state = () => h.page.evaluate(() => window.__state);

// ---- 1. the title screen warms the first fighter and the territory art ----
await h.waitForText(/PRESS START/i);
await sleep(3000);
check('the title warms the first Mandalorian', await has('din.glb'));
check('the title warms the territory art', await has('board_tatooine.jpg'));

// ---- 2. the territory grid warms the rest of the roster ----
await h.pad.tap(BTN.START);
await h.waitForText(/CHOOSE|TERRITORY/i);
await sleep(4000);
const roster = ['din.glb', 'paz.glb', 'bokatan.glb', 'armorer.glb'];
const got = await fetched();
check('the grid warms every playable Mandalorian', roster.every((m) => got.includes(m)),
  roster.filter((m) => !got.includes(m)).join(', ') || 'all four');

// ---- 3. choosing a territory warms that territory ----
await h.pad.tap(BTN.A);                       // The Dune Sea
await h.waitForText(/MANDALORIAN|DIN DJARIN/i);
await sleep(7000);
check('the character select warms the chosen sky', await has('sky_desert.jpg'));
check('...and its ground textures', await has('sand_albedo.jpg'));
check('...and wave one\'s hostiles', await has('tusken.glb'));

// ---- 4. the drop screen, and what it is allowed to reveal ----
for (let i = 0; i < 8; i++) {
  if (/READY/.test(await h.text())) break;
  await h.pad.tap(BTN.A);
  await sleep(600);
}
await h.page.evaluate(() => { window.__holdLoading = true; });
await h.pad.tap(BTN.A);
await sleep(2500);
check('starting a match shows the drop screen', await state() === 'loading', await state());
const screen = await h.page.evaluate(() => {
  const el = document.querySelector('.loading-screen');
  if (!el || el.style.display === 'none') return null;
  return {
    title: el.querySelector('.loading-title').textContent,
    cast: [...el.querySelectorAll('.loading-card')].map((c) => c.querySelector('.cname').textContent),
    bar: el.querySelector('.loading-bar .fill').style.width,
  };
});
check('it names the territory', screen?.title === 'The Dune Sea', screen?.title ?? 'no screen');
check('it shows the player', !!screen?.cast.includes('Din Djarin'), (screen?.cast ?? []).join(', '));
check('it shows the hostiles waiting there', (screen?.cast.length ?? 0) > 1, (screen?.cast ?? []).join(', '));

await h.page.evaluate(() => { window.__holdLoading = false; });
await h.waitForPlaying();
check('nothing the match needed was still loading when it appeared',
  await h.page.evaluate(() => window.__loadPending()) === 0);
check('the match is running', await state() === 'playing');

// ---- 5. a cold drop waits, and a missing model does not strand it ----
// The Crevasse posts krykna, whose .glb is not in the repo: that load fails,
// the spiders fall back to their procedural build as they always have, and the
// drop must go ahead rather than sitting on a bar that can never fill.
await h.page.evaluate(() => { window.__holdLoading = true; window.__quitToTitle?.(); });
await sleep(800);
await h.page.evaluate(() => window.__startCoop(1, 'crevasse'));
await sleep(2000);
check('a fresh territory holds on the drop screen', await state() === 'loading', await state());
check('the drop screen follows the new territory',
  await h.page.evaluate(() => document.querySelector('.loading-title').textContent) === 'The Crevasse');
await h.page.evaluate(() => { window.__holdLoading = false; });
await h.waitForPlaying(30000);
check('a missing model settles instead of stranding the drop', await state() === 'playing');
check('the drop revealed with nothing outstanding',
  await h.page.evaluate(() => window.__loadPending()) === 0);
check('the spiders fell back to their procedural build',
  await h.page.evaluate(() => performance.getEntriesByType('resource')
    .some((e) => e.name.endsWith('krykna.glb'))));

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nasset warming: all checks passed');
