/**
 * Menu navigation is spatial.
 *
 * A menu is not always a list, and stepping the focus by declaration order
 * through a grid once meant DOWN moved *right* — the order the items were
 * written in rather than the shape on screen. So a direction press is measured
 * against where things actually are: DOWN goes down, RIGHT goes along a row,
 * both wrap on their own axis, and a press along an axis a menu does not use
 * at all steps its order, so a plain stack still behaves like the list it is.
 *
 * Two shapes are walked here: the title's modes, a row along the letterbox,
 * and the territory departures board, a single column of rows.
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

/** which departures row is focused, and how many columns the rows stand in */
const board = () => h.page.evaluate(() => {
  const rows = [...document.querySelectorAll('.board-card')];
  const focused = rows.findIndex((c) => c.classList.contains('focused'));
  const cx = (c) => { const r = c.getBoundingClientRect(); return Math.round(r.left + r.width / 2); };
  return { focused, cols: new Set(rows.map(cx)).size, n: rows.length };
});

const press = async (btn) => { await h.pad.tap(btn); await sleep(260); };

await h.waitForText(/PRESS START|WAVE BATTLE/i);

// ---- 1. the title's modes are a row ----
const titleFocus = () => h.page.evaluate(() => {
  const btns = [...document.querySelectorAll('.menu-screen:not([style*="none"]) .menu-btn')];
  return btns.findIndex((b) => b.classList.contains('focused'));
});
const t0 = await titleFocus();
await press(BTN.DRIGHT);
check('RIGHT along the title row steps one', await titleFocus(), t0 + 1);
await press(BTN.DLEFT);
check('...and LEFT comes back', await titleFocus(), t0);
// the row has no height to move in, so DOWN steps the order like a list
await press(BTN.DDOWN);
check('DOWN on a row still steps it, list-fashion', await titleFocus(), t0 + 1);
await press(BTN.DUP);
check('...and UP steps back', await titleFocus(), t0);

// ---- 2. the departures board is a column ----
// The board belongs to Wave Battle and PvP; Missions opens the galaxy map
// instead, and it is the first button on the title. Ask for the mode by name
// rather than relying on which one the menu happens to focus.
await h.focusButton(/WAVE BATTLE/i);
await press(BTN.START);
await h.waitForText(/DEPARTURES/i);
await sleep(500);
const shape = await board();
console.log(`  (board is ${shape.n} rows in ${shape.cols} column${shape.cols === 1 ? '' : 's'})`);
check('the departures stand in one column', shape.cols, 1);

await h.page.evaluate((i) => window.__selectFocus(i), 1);
await sleep(150);
check('starts on the second departure', (await board()).focused, 1);
await press(BTN.DDOWN);
check('DOWN goes to the next departure', (await board()).focused, 2);
await press(BTN.DUP);
check('...and UP comes back', (await board()).focused, 1);
// the column has no width to move in, so RIGHT steps it — which is what lets
// the harness walk to a board by pressing RIGHT a counted number of times
await press(BTN.DRIGHT);
check('RIGHT steps down the list too', (await board()).focused, 2);

// the column wraps on itself both ways
await h.page.evaluate((i) => window.__selectFocus(i), shape.n - 1);
await sleep(150);
await press(BTN.DDOWN);
check('DOWN off the last departure wraps to the first', (await board()).focused, 0);
await press(BTN.DUP);
check('UP off the first wraps to the last', (await board()).focused, shape.n - 1);

// the ticket follows the focus
const ticket = await h.page.evaluate(() => document.querySelector('.fe-ticket .name')?.textContent ?? '');
const label = await h.page.evaluate(() => document.querySelector('.board-card.focused')?.getAttribute('aria-label') ?? '');
check('the ticket is for the focused departure', ticket, label);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nmenu navigation: all checks passed');
