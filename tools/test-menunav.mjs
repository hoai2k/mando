/**
 * Menu navigation is spatial.
 *
 * A menu is not always a list. The territory grid is three cards across, and
 * stepping the focus by declaration order through it meant DOWN from the top
 * middle card moved *right* — the order the cards were written in rather than
 * the shape on screen. What this checks is that a direction press lands where
 * the player is looking: DOWN goes down a column, RIGHT goes along a row, both
 * wrap on their own axis, and a plain stack of buttons still behaves like the
 * list it is.
 *
 * Run:  node tools/test-menunav.mjs
 */
import { launch, BTN } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  if (!ok) failures.push(name);
}

const h = await launch();

/** which card is focused, and the grid's shape as it is actually laid out */
const grid = () => h.page.evaluate(() => {
  const cards = [...document.querySelectorAll('.board-card')];
  const focused = cards.findIndex((c) => c.classList.contains('focused'));
  // Columns = how many cards share the top row. Grouped by a tolerance rather
  // than an exact y: the focused card is scaled up a little, which lifts its
  // rect a few pixels above its neighbours'.
  const mid = (c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; };
  const first = Math.min(...cards.map(mid));
  const cols = cards.filter((c) => Math.abs(mid(c) - first) < 40).length;
  return { focused, cols, n: cards.length };
});

const press = async (btn) => { await h.pad.tap(btn); await sleep(260); };

await h.waitForText(/PRESS START|WAVE BATTLE/i);

// ---- 1. a stack of buttons is still a list ----
const titleFocus = () => h.page.evaluate(() => {
  const btns = [...document.querySelectorAll('.menu-screen:not([style*="none"]) .menu-btn')];
  return btns.findIndex((b) => b.classList.contains('focused'));
});
const t0 = await titleFocus();
await press(BTN.DDOWN);
check('a stack of buttons steps down one', await titleFocus(), t0 + 1);
await press(BTN.DUP);
check('...and back up one', await titleFocus(), t0);

// ---- 2. the territory grid moves by where the cards are ----
await press(BTN.START);
await h.waitForText(/CHOOSE|TERRITORY/i);
await sleep(500);
const shape = await grid();
console.log(`  (grid is ${shape.n} cards, ${shape.cols} across)`);
if (shape.cols < 2) {
  console.error('the territory grid is a single column here — nothing spatial to test');
  await h.close();
  process.exit(1);
}
const cols = shape.cols;

// from the top middle, DOWN belongs in the middle of the next row
await h.page.evaluate((i) => window.__selectFocus(i), 1);
await sleep(150);
check('starts on the top middle card', (await grid()).focused, 1);
await press(BTN.DDOWN);
check('DOWN from the top middle lands in the middle of the next row',
  (await grid()).focused, 1 + cols);
await press(BTN.DUP);
check('...and UP comes back to it', (await grid()).focused, 1);

// RIGHT walks the row it is on
await press(BTN.DRIGHT);
check('RIGHT moves along the row', (await grid()).focused, 2);

// each axis wraps on itself: DOWN off the bottom returns to the top of the
// same column, never to the next column along
const lastRowStart = Math.floor((shape.n - 1) / cols) * cols;
await h.page.evaluate((i) => window.__selectFocus(i), lastRowStart);
await sleep(150);
await press(BTN.DDOWN);
check('DOWN off the bottom wraps to the top of the same column',
  (await grid()).focused % cols, lastRowStart % cols);

await h.page.evaluate((i) => window.__selectFocus(i), 0);
await sleep(150);
await press(BTN.DLEFT);
const wrapped = (await grid()).focused;
check('LEFT off the near edge wraps within the same row',
  Math.floor(wrapped / cols), 0);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nmenu navigation: all checks passed');
