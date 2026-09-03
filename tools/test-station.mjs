/**
 * The station board's own rules — the two play reports it came from.
 *
 * **Local gravity.** The station is a vacuum, not a planet.
 *
 * "The Spice Run" is a constellation of platforms in deep space, and it used to
 * pull everyone down everywhere at a flat 0.45 g, so flying between islands was
 * a fight against a floor that wasn't there. Now the pull exists only over
 * something you could land on: out in the open you drift and fly wherever you
 * point; over a deck it comes back, full strength, so landing and fighting on a
 * platform are exactly as they were.
 *
 * What is checked here is the shape of that field, and that no other board
 * grew one by accident.
 *
 * **Riding the freighter.** The visitor that lands on the north-east pad is a
 * mover, and its colliders are now fitted to the hull rather than being one box
 * drawn around it — so "standing on the ship" means standing on any of several
 * surfaces, and the ride has to carry a rider off all of them. Getting this
 * wrong is invisible until the ship lifts off and leaves someone behind in the
 * air where the deck used to be.
 *
 * Run:  node tools/test-station.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const h = await launch();
await h.waitForText(/WAVE BATTLE|PRESS START/i);

const out = await h.page.evaluate(() => {
  const res = { boards: {} };
  for (const info of window.__boards) {
    const b = info.build();
    if (!b.gravityAt) { res.boards[info.id] = null; continue; }
    // the main pad is at the origin, its deck top at y = 0
    const overDeck = b.gravityAt(0, 1, 0);
    const justAbove = b.gravityAt(0, 6, 0);
    // far out between the islands, with nothing under it for 200 m
    const open = b.gravityAt(0, 120, 0);
    const wayOut = b.gravityAt(300, 30, 300);
    // hanging underneath the main pad: a deck over your head is not a deck
    // you could land on, so it should pull at nothing
    const underDeck = b.gravityAt(0, -4, 0);
    res.boards[info.id] = {
      flat: b.gravity ?? 1,
      overDeck: +overDeck.toFixed(3),
      justAbove: +justAbove.toFixed(3),
      open: +open.toFixed(3),
      wayOut: +wayOut.toFixed(3),
      underDeck: +underDeck.toFixed(3),
    };
  }
  return res;
});

const station = out.boards.station;
check('the station has a local gravity field', !!station, station);
if (station) {
  check('standing on a deck pulls exactly as the board always did',
    Math.abs(station.overDeck - station.flat) < 0.02, station);
  check('the pull is still there a jump above the deck',
    station.justAbove > station.flat * 0.4, { justAbove: station.justAbove });
  // Open space pulls at *nothing*, which is stronger than the old rule and
  // deliberately so: the drift used to be 0.05 g, which reads as nothing and
  // is 1.3 m/s² — enough that five seconds between platforms had you falling
  // at 6.5 m/s on a board whose whole idea is that it has no down.
  check('open space pulls at nothing at all',
    station.open === 0 && station.wayOut === 0, { open: station.open, wayOut: station.wayOut });
  check('and neither does a deck over your head',
    station.underDeck === 0, { underDeck: station.underDeck });
}

const others = Object.entries(out.boards).filter(([id, v]) => id !== 'station' && v);
check('no other board gained a gravity field', others.length === 0, others.map(([id]) => id));

// ---- the landing freighter carries whoever is standing on it ----
await h.page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('wave', 1, 'station', ['din']);
});
await h.page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
// the sculpts land seconds after the board is built; the fit follows them
await new Promise((r) => setTimeout(r, 12000));
await h.page.evaluate(() => { window.__manual = true; });

const ride = await h.page.evaluate(`(async () => {
  const g = window.__game;
  const p = g.players[0];
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const step = (n) => { for (let i = 0; i < n; i++) g.update(1/30, [blank(), blank(), blank(), blank()]); };
  const mover = g.board.movers[0];
  // wait for the hull to be on the move — that is when a rider is dropped
  let moving = 0;
  for (let i = 0; i < 4000 && moving < 3; i++) {
    step(1);
    if (Math.abs(mover.delta.y) > 0.002) moving++; else moving = 0;
  }
  // stand on the highest surface the ship carries, dead centre
  const surfaces = mover.surfaces();
  let top = surfaces[0];
  for (const s of surfaces) if (s.max.y > top.max.y) top = s;
  p.position.set((top.min.x + top.max.x) / 2, top.max.y, (top.min.z + top.max.z) / 2);
  p.velocity.set(0, 0, 0);
  step(4);
  const startGap = p.position.y - top.max.y;
  let travelled = 0;
  let worstGap = 0;
  for (let i = 0; i < 90; i++) {
    const before = top.max.y;
    step(1);
    travelled += Math.abs(top.max.y - before);
    worstGap = Math.max(worstGap, Math.abs(p.position.y - top.max.y - startGap));
  }
  return { travelled: +travelled.toFixed(2), worstGap: +worstGap.toFixed(2), startGap: +startGap.toFixed(2) };
})()`);

check('the freighter actually moves during the test', ride.travelled > 1, ride);
check('and a rider on its hull goes with it', ride.worstGap < 0.6, ride);

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall station checks passed');
process.exit(failures.length ? 1 : 0);
