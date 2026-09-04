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
 * What is checked here is the shape of that field, that no other board grew
 * one by accident, and what the field means for how a body moves inside it:
 * no vertical drift out in the open, the shield as a reverse burn down, the
 * pack as the way up, and the pull still landing you close over a deck.
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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
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

// ---- how a body moves out in the vacuum ----
//
// Momentum out here is horizontal. There is nothing to fall towards, so a
// nudge up or down used to be kept forever and the whole board drifted away
// under you; and holding the shield — a brace that expects a floor to catch
// it — was a dive at 16 m/s² to the kill plane. Altitude is something you
// hold now: A to climb, B for a reverse burn down at a set speed, and
// nothing at all to stay where you are. Close over a deck the board's own
// field takes over again, which is what still lands you on one.
const vacuum = await h.page.evaluate(`(() => {
  const g = window.__game, p = g.players[0];
  const blank = (o) => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false, ...(o || {}) });
  const step = (n, o) => { const i = [blank(o), blank(o), blank(o), blank(o)];
    for (let k = 0; k < n; k++) g.update(1/60, i); };
  // out in the open, with nothing under it for a long way
  const park = () => { p.position.set(40, 40, 40); p.velocity.set(0, 0, 0);
    p.grounded = false; p.hp = p.maxHp; p.alive = true; p.energy = 1; p.fuel = 1; };
  const out = {};
  park(); p.velocity.y = 8; step(120);
  out.upDrift = { vy: +p.velocity.y.toFixed(2), y: +p.position.y.toFixed(2) };
  park(); p.velocity.y = -8; step(120);
  out.downDrift = { vy: +p.velocity.y.toFixed(2), y: +p.position.y.toFixed(2) };
  park(); p.velocity.x = 12; step(30);
  out.horizontal = +(p.position.x - 40).toFixed(2);
  park(); step(180, { blockHeld: true });
  out.block = { vy: +p.velocity.y.toFixed(2), dropped: +(40 - p.position.y).toFixed(2) };
  park(); step(60, { jumpHeld: true });
  out.jet = { vy: +p.velocity.y.toFixed(2), climbed: +(p.position.y - 40).toFixed(2) };
  // and a body a jump above a deck is still pulled onto it
  p.position.set(0, 6, -6); p.velocity.set(0, 0, 0); p.grounded = false;
  step(400);
  out.overDeck = { y: +p.position.y.toFixed(2), grounded: p.grounded };
  return out;
})()`);

check('a vertical nudge in open space bleeds off instead of drifting',
  Math.abs(vacuum.upDrift.vy) < 0.2 && Math.abs(vacuum.downDrift.vy) < 0.2
  && Math.abs(vacuum.upDrift.y - 40) < 4 && Math.abs(vacuum.downDrift.y - 40) < 4, vacuum);
check('...while horizontal momentum still carries', vacuum.horizontal > 1, vacuum.horizontal);
check('block is a reverse burn: a steady descent, not a dive',
  vacuum.block.vy < -3 && vacuum.block.vy > -9 && vacuum.block.dropped > 8, vacuum.block);
check('and the pack still climbs against it', vacuum.jet.climbed > 3, vacuum.jet);
check('close over a deck the board\'s own pull still lands you',
  vacuum.overDeck.grounded && vacuum.overDeck.y < 1, vacuum.overDeck);

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall station checks passed');
process.exit(failures.length ? 1 : 0);
