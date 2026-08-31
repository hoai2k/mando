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
/**
 * Warming is asynchronous by nature — the queue runs two files at a time and
 * waits for idle gaps — so "has it arrived?" is a question with a deadline,
 * not an instant. Sampling once raced the arrival and failed the run on a file
 * that turned up a beat later.
 */
const waitForAsset = async (name, ms = 20000) => {
  for (let waited = 0; waited < ms; waited += 250) {
    if (await has(name)) return true;
    await sleep(250);
  }
  return false;
};
const state = () => h.page.evaluate(() => window.__state);

// ---- 1. the title screen warms the first fighter and the territory art ----
await h.waitForText(/PRESS START|WAVE BATTLE/i);
await sleep(3000);
check('the title warms the first Mandalorian', await waitForAsset('din.glb'));
check('the title warms the territory art', await waitForAsset('board_tatooine.jpg'));
// the planet discs are the Missions strip two screens on, and they are the
// whole screen there — warming them is not conditional on picking that mode
check('the title warms the planet discs', await waitForAsset('planet_desert.png'));

// ---- 2. the territory grid warms the rest of the roster ----
await h.pad.tap(BTN.START);
await h.waitForText(/CHOOSE|TERRITORY/i);
await sleep(4000);
// The roster comes from the game rather than a list here: it has gained
// characters and been renamed wholesale, and a frozen copy silently stops
// covering whoever was added last.
const roster = (await h.page.evaluate(() => window.__roster)).map((c) => `${c.id}.glb`);
for (const m of roster) await waitForAsset(m);
const got = await fetched();
check('the grid warms every playable fighter', roster.every((m) => got.includes(m)),
  roster.filter((m) => !got.includes(m)).join(', ') || `all ${roster.length}`);

// ---- 3. choosing a territory warms that territory ----
await h.pad.tap(BTN.A);                       // The Dune Sea
await h.waitForText(/CHOOSE YOUR/i);
await sleep(7000);
check('the character select warms the chosen sky', await waitForAsset('sky_desert.jpg'));
check('...and its ground textures', await waitForAsset('sand_albedo.jpg'));
check('...and wave one\'s hostiles', await waitForAsset('tusken.glb'),
  `glb fetched: ${(await fetched()).filter((f) => f.endsWith('.glb')).join(' ') || 'none'}`);
// the drop screen is the next screen and is nothing but pictures: its cast
// should be local before it is shown, or every face pops from drawn helmet to
// photograph a beat after it appears
check('...and the drop screen\'s portraits', await waitForAsset('portrait_din.jpg'));
check('...for the hostiles it will name too', await waitForAsset('portrait_tusken.jpg'));

// ---- 4. the drop screen, and what it is allowed to reveal ----
// Whoever the select is showing is who the next A press picks; hold onto the
// name it displayed so the drop screen can be checked against it.
const picked = await h.page.evaluate(() => document.querySelector('.charsel-name')?.textContent ?? '');
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
check('it shows the player', !!picked && !!screen?.cast.includes(picked),
  `picked ${picked || '(nothing)'} — cast ${(screen?.cast ?? []).join(', ')}`);
check('it shows the hostiles waiting there', (screen?.cast.length ?? 0) > 1, (screen?.cast ?? []).join(', '));

await h.page.evaluate(() => { window.__holdLoading = false; });
await h.waitForPlaying();
check('nothing the match needed was still loading when it appeared',
  await h.page.evaluate(() => window.__loadPending()) === 0);
check('the match is running', await state() === 'playing');

// ---- 5. a cold drop waits, and a missing model does not strand it ----
// The Crevasse posts krykna. Its .glb now ships, so the failure this guards
// against is staged rather than waited for: block that one request, and the
// spiders must fall back to their procedural build and let the drop go ahead
// rather than sitting on a bar that can never fill.
let kryknaBlocked = 0;
await h.page.route('**/krykna.glb', (route) => { kryknaBlocked++; route.abort(); });
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
check('the spiders fell back to their procedural build', kryknaBlocked > 0,
  `${kryknaBlocked} blocked request(s)`);
// The blocked file is now re-attempted in the background, and those attempts
// must stay off the ledger the drop screen reads. They report under a key of
// their own for that reason: counted as real loads they would reopen a file
// the drop had already settled and, with nothing capping that wait, hold the
// screen on a model nothing is waiting for.
const blockedBefore = kryknaBlocked;
await sleep(5000);            // past the first re-attempt of the blocked spiders
check('a re-attempt is made in the background', kryknaBlocked > blockedBefore,
  `${blockedBefore} -> ${kryknaBlocked} blocked request(s)`);
check('...and does not put the drop back to waiting on it',
  await h.page.evaluate(() => window.__loadPending()) === 0,
  `${await h.page.evaluate(() => window.__loadPending())} outstanding`);

// ---- 6. a file that missed on a bad connection is asked for again in play ----
// A 404 is an answer — most characters have no .glb and the procedural build is
// their finished look — but a dropped connection is not, and the file behind it
// is one we know exists. Fail the ringworld enforcer's model once at the
// transport level (an abort, not a 404), build one, and the retry should go out
// on its own a few seconds later with nothing new having asked for it.
let enforcerTries = 0;
await h.page.route('**/ring_enforcer.glb', (route) => {
  enforcerTries++;
  if (enforcerTries === 1) route.abort('connectionfailed');
  else route.continue();
});
check('the match is still running for the retry to happen during',
  await state() === 'playing', await state());
await h.page.evaluate(() => window.__buildBody('npc:ringEnforcer'));
const cached = () => h.page.evaluate(() => window.__modelCached('ring_enforcer'));
await sleep(1500);
const missed = await cached();
// The first re-attempt is armed a few seconds out and nothing else asks in the
// meantime — but "has it landed?" is a question with a deadline here, not an
// instant: this runs over a live match on a software renderer, where the
// download and the parse both take their time. Sampling once raced them.
let recovered = false;
for (let waited = 0; waited < 25000 && !recovered; waited += 500) {
  await sleep(500);
  recovered = await cached();
}
check('a dropped model is asked for again without anything new requesting it',
  enforcerTries >= 2, `${enforcerTries} request(s)`);
check('...and the retry lands, so the character is not stuck on its stand-in',
  missed === false && recovered === true, `missed ${missed} -> recovered ${recovered}`);

// The blocked krykna request above logs a console error in the page. That is
// this test staging a failure on purpose, so it must not count as one.
const unexpected = h.errors.filter((e) => !/ERR_FAILED|Failed to load resource/.test(e));
console.log('page errors:', unexpected.length ? unexpected.slice(0, 3) : 'none');
await h.close();
if (failures.length || unexpected.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nasset warming: all checks passed');
