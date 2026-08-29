/**
 * Couch co-op regression test: controller seating, joining, and dropping out.
 *
 * These are the paths that need four hands and four controllers to try by
 * hand, which is exactly why they broke unnoticed — a second controller once
 * joined as player three (idle devices had taken the seats between) and then
 * drove nobody once the match started. Each case here asserts on the seating
 * (`InputManager.padForPlayer`), the line on screen, and, where a match
 * starts, that a controller moves its own character and only its own.
 *
 * Run:  node tools/test-coop.mjs
 */
import { launch, BTN } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`);
  if (!ok) failures.push(name);
}

const h = await launch();
const seats = () => h.page.evaluate(() => window.__input.padForPlayer.slice());
/** the plinths currently on stage, as their plates read */
const line = () => h.page.evaluate(() => [...document.querySelectorAll('.charsel-panel')]
  .filter((p) => p.style.display !== 'none')
  .map((p) => p.innerText.replace(/\s+/g, ' ').trim()));
const speeds = () => h.page.evaluate(() => window.__game.players.map(
  (p) => +(Math.hypot(p.velocity.x, p.velocity.z) > 0.5)));

/** title -> board -> the character select, driven by pad 0 */
async function toCharacterSelect() {
  await h.waitForText(/PRESS START/i);
  await h.pad.tap(BTN.START);
  await h.waitForText(/CHOOSE|TERRITORY|DUNE SEA/i);
  await h.pad.tap(BTN.A);
  await h.waitForText(/MANDALORIAN|DIN DJARIN/i);
  await sleep(900);
}

/** lock every listed pad in and start; returns the player count that resulted */
async function startWith(padIndexes) {
  for (let round = 0; round < 10; round++) {
    const t = await line();
    if (t.filter((x) => /READY/.test(x)).length === padIndexes.length) break;
    for (const i of padIndexes) { await h.pads[i].tap(BTN.A); await sleep(400); }
    await sleep(500);
  }
  await h.pads[padIndexes[0]].tap(BTN.A);
  await sleep(2200);
  return h.page.evaluate(() => (window.__game ? window.__game.players.length : 0));
}

// ---- 1. idle controllers take no seats ----
// Browsers report pads nobody is holding: one asleep in a drawer, a dongle
// with nothing paired, the same pad twice over two transports.
await h.pads[1].connect();
await h.pads[2].connect();
await sleep(600);
check('idle pads hold no seats', await seats(), [-1, -1, -1, -1]);

await toCharacterSelect();
check('the pad driving the menus is player one', await seats(), [0, -1, -1, -1]);

// ---- 2. the controller that joins becomes player two, whatever its index ----
await h.pads[3].connect();
await h.pads[3].tap(BTN.A);
await sleep(900);
check('the joining pad takes seat two', await seats(), [0, 3, -1, -1]);
check('the line is two players and one open place', (await line()).length, 3);

check('two players start', await startWith([0, 3]), 2);
await h.pads[3].stick('left', 0, -1, 1000);
check('player two moves, and only player two', await speeds(), [0, 1]);
await h.pads[3].release();

// ---- 3. a player who drops out closes the line up behind them ----
await h.page.evaluate(() => window.__quitToTitle?.());
await sleep(1200);
await toCharacterSelect();
for (const i of [1, 2, 3]) { await h.pads[i].tap(BTN.A); await sleep(700); }
check('four seated', await seats(), [0, 1, 2, 3]);
await h.pads[1].connect(false);           // player two's controller dies
await sleep(1200);
check('the line closes up', await seats(), [0, 2, 3, -1]);
check('one open place returns', (await line()).length, 4);
check('three players start', await startWith([0, 2, 3]), 3);
await h.pads[3].stick('left', 0, -1, 1000);
check('the last player drives their own character', await speeds(), [0, 0, 1]);
await h.pads[3].release();

// ---- 4. a split-screen match hands the whole canvas back ----
// The viewport is renderer state that outlives a render: left on the last
// player's half, the character select's stage drew into that strip and its
// Mandalorians came back squashed flat.
const canvas = await h.page.evaluate(() => {
  const c = document.querySelector('canvas');
  return [c.clientWidth, c.clientHeight];
});
await h.page.evaluate(() => window.__quitToTitle?.());
await sleep(1200);
await toCharacterSelect();
check('the character select draws on the whole canvas',
  (await h.page.evaluate(() => window.__viewport())).map(Math.round), [0, 0, ...canvas]);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nco-op seating: all checks passed');
