/**
 * K2 — the treadmill kit (src/sections/kit/treadmill.ts), and The Lift that
 * is built on it.
 *
 * The kit is checked on its own first, in the page, with nothing but plain
 * objects for colliders and textures: that a speed change is an eased S-curve
 * that covers v·T/2, that `stopAt` lands the odometer exactly on its mark,
 * that a conveyor item is recycled upstream (and a one-pass item retired),
 * that a collider rides as a `Mover` that carries its riders one frame's
 * travel and *never* a recycle's jump, that parallax runs at its fraction,
 * that a strip's texture slides by metres ÷ repeat, and that `spawnAhead`
 * arrives when it says it will.
 *
 * Then the Lift, driven by its own autopilot: the platform's collider does
 * not move a millimetre while the shaft goes by, the lift stops with the
 * first power-cut landing exactly level, and it restarts.
 *
 * Run:  node tools/test-section-treadmill.mjs     (HARNESS_PORT, CHROMIUM_PATH as usual)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${PORT}/?section=the-lift`);
await page.waitForFunction(() => !!window.__startMode && !!window.__kitTreadmill, null, { timeout: 60000 });

// ---------------------------------------------------------------- the kit alone
const kit = await page.evaluate(() => {
  const { Treadmill } = window.__kitTreadmill;
  const out = {};
  const dt = 1 / 30;
  const run = (m, secs) => { for (let i = 0; i < Math.round(secs / dt); i++) m.update(dt); };

  // The kit's own Vector3, whatever the bundle calls it: a carried point is one.
  const probe = new Treadmill({ dir: { x: 0, y: -1, z: 0, clone() { return this; }, normalize() { return this; } } });
  const vec = (x, y, z) => probe.spawnAhead(0).pos.clone().set(x, y, z);
  const board = { movers: [] };
  const m = new Treadmill({ dir: vec(0, -1, 0), speed: 0, ease: 2, board });

  // eased start: half way through the ease, half the speed; at the end, all of it; v·T/2 covered
  m.setSpeed(2);
  run(m, 1);
  out.halfEase = m.speed;
  run(m, 1);
  out.fullSpeed = m.speed;
  out.easeDistance = m.travelled;

  // a looping item recycles upstream; a one-pass item is retired and says so
  const loopItem = m.conveyor(null, { behind: 10, loop: 30 });
  let passed = 0;
  const passItem = m.conveyor(null, { behind: 5, onPass: () => { passed++; } });
  // a collider that rides: its mover carries one frame of travel
  const box = { min: vec(-1, 9, -1), max: vec(1, 10, 1) };
  const moverItem = m.conveyor(null, { behind: 4, loop: 20, boxes: [box] });
  m.update(dt);
  out.moverRegistered = board.movers.length === 1 && board.movers[0] === moverItem.mover;
  out.frameDelta = moverItem.mover.delta.y;
  out.boxTop = box.max.y;
  // run on until the mover's item recycles: the frame it jumps carries nobody
  let jumpDelta = null;
  for (let i = 0; i < 200 && jumpDelta === null; i++) {
    const laps = moverItem.laps;
    m.update(dt);
    if (moverItem.laps !== laps) jumpDelta = moverItem.mover.delta.length();
  }
  out.jumpDelta = jumpDelta;
  out.jumpBoxTop = box.max.y;
  run(m, 6);
  out.loopS = loopItem.s;
  out.loopLaps = loopItem.laps;
  out.passed = passed;
  out.passRetired = passItem.retired && !m.conveyed.includes(passItem);

  // parallax at a quarter of the speed
  const far = m.parallax({ position: vec(0, 0, 0) }, 0.25, 1000);
  const t0 = m.travelled;
  run(m, 3);
  out.parallaxRatio = far.s / (m.travelled - t0);

  // a strip: the texture slides one repeat per `metresPerRepeat`
  const tex = { offset: { x: 0, y: 0 } };
  m.strip(tex, { metresPerRepeat: 50, axis: 'y' });
  const t1 = m.travelled;
  run(m, 5);
  out.stripOffset = tex.offset.y;
  out.stripWant = ((m.travelled - t1) / 50) % 1;

  // spawnAhead: a point 30 m upstream arrives in 15 s at 2 m/s
  const ahead = m.spawnAhead(30, vec(0, 0, 0));
  out.eta = ahead.eta;
  out.aheadStartY = ahead.pos.y;
  run(m, 15);
  out.aheadRemaining = ahead.remaining;
  out.aheadY = ahead.pos.y;

  // stopAt: the odometer lands exactly on the mark, and stays there
  const mark = Math.ceil(m.travelled) + 7.3;
  m.stopAt(mark);
  run(m, 12);
  out.stopMark = mark;
  out.stopAt = m.travelled;
  out.stopped = m.stopped;
  out.stoppedDelta = moverItem.mover.delta.length();
  run(m, 2);
  out.stayed = m.travelled;

  // stop(): two seconds of deceleration covering v·T/2
  m.setSpeed(2, 0);
  const t2 = m.travelled;
  m.stop();
  run(m, 1);
  out.stopHalf = m.speed;
  run(m, 1.5);
  out.stopDistance = m.travelled - t2;
  out.stopEnd = m.speed;

  m.dispose();
  out.disposedMovers = board.movers.length;
  return out;
});

const near = (a, b, eps) => Math.abs(a - b) <= eps;
check('an eased start is an S-curve: half speed half way through', near(kit.halfEase, 1, 0.05), kit.halfEase);
check('and full speed at the end of the ease', near(kit.fullSpeed, 2, 1e-6), kit.fullSpeed);
check('the ease covers v·T/2', near(kit.easeDistance, 2, 0.05), kit.easeDistance);
check('a conveyor collider is registered on the board as a mover', kit.moverRegistered);
check('the mover carries one frame of travel', near(kit.frameDelta, -2 / 30, 1e-6), kit.frameDelta);
check('and its box moved with it', near(kit.boxTop, 10 - 2 / 30, 1e-6), kit.boxTop);
check('a recycle jump carries nobody (delta zero on that frame)', kit.jumpDelta === 0, kit.jumpDelta);
check('the recycled box is back upstream', kit.jumpBoxTop > 10, kit.jumpBoxTop);
check('a looping item comes round again upstream', kit.loopLaps >= 1 && kit.loopS <= 10, { s: kit.loopS, laps: kit.loopLaps });
check('a one-pass item says it went by, once, and is retired', kit.passed === 1 && kit.passRetired, { passed: kit.passed, retired: kit.passRetired });
check('parallax runs at its fraction of the speed', near(kit.parallaxRatio, 0.25, 1e-6), kit.parallaxRatio);
check('a strip slides one repeat per metresPerRepeat', near(kit.stripOffset, kit.stripWant, 1e-6), { got: kit.stripOffset, want: kit.stripWant });
check('spawnAhead knows when it arrives', near(kit.eta, 15, 1e-6), kit.eta);
check('and arrives then', near(kit.aheadRemaining, 0, 0.07) && near(kit.aheadY, 0, 0.07), { rem: kit.aheadRemaining, y: kit.aheadY, from: kit.aheadStartY });
check('stopAt lands the odometer exactly on its mark', near(kit.stopAt, kit.stopMark, 1e-9), { mark: kit.stopMark, at: kit.stopAt });
check('and it is stopped, carrying nobody', kit.stopped && kit.stoppedDelta === 0, { stopped: kit.stopped, delta: kit.stoppedDelta });
check('and stays stopped', kit.stayed === kit.stopAt, kit.stayed);
check('stop() decelerates over two seconds', near(kit.stopHalf, 1, 0.05) && kit.stopEnd === 0, { half: kit.stopHalf, end: kit.stopEnd });
check('covering v·T/2', near(kit.stopDistance, 2, 0.05), kit.stopDistance);
check('dispose takes its movers off the board', kit.disposedMovers === 0, kit.disposedMovers);

// ---------------------------------------------------------------- the Lift on it
await h.startStepped('campaign', 2, 'narkina', ['din', 'maul']);
const lift = await page.evaluate(async (blank) => {
  const g = window.__game, c = g.campaign, s = c.section;
  const Y0 = s.floorY;
  // the platform's deck: the 12 × 12 box whose top is the floor
  const deck = g.board.physics.boxes.find((b) => Math.abs(b.max.y - Y0) < 1e-6
    && Math.abs(b.max.x - b.min.x - 12) < 1e-6 && Math.abs(b.max.z - b.min.z - 12) < 1e-6);
  const deck0 = deck ? [deck.min.toArray(), deck.max.toArray()] : null;
  const out = { found: !!deck, movers: 0, Y0 };
  let stopFrame = null;
  for (let f = 0; f < 70 * 30; f++) {
    const inputs = [0, 1, 2, 3].map((slot) => {
      const p = g.players[slot]; if (!p) return blank;
      const a = s.autopilot(slot) || {};
      if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
      const { yaw, ...r } = a; return { ...blank, ...r };
    });
    g.update(1 / 30, inputs);
    if (f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    const d = s.debug();
    if (f === 25 * 30) { out.at25 = d; out.movers = (g.board.movers ?? []).length; }
    if (stopFrame === null && d.phase === 'stopped') {
      stopFrame = f;
      out.atStop = d;
      // the first cut's landing: the conveyor item whose deck top is nearest the platform
      const tops = g.board.movers.map((m) => m.box.max.y - Y0).filter((t) => Math.abs(t) < 3);
      out.landingTop = tops.length ? tops.reduce((a, b) => (Math.abs(a) < Math.abs(b) ? a : b)) : null;
    }
    if (stopFrame !== null && d.phase === 'ride' && !out.restarted) out.restarted = d;
    if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  out.deckSame = !!deck && JSON.stringify([deck.min.toArray(), deck.max.toArray()]) === JSON.stringify(deck0);
  out.deckStill = !!deck && g.board.physics.boxes.includes(deck);
  return out;
}, blankInput());

check('the Lift: the platform deck is found', lift.found);
check('the Lift: the world goes by at 2 m/s', lift.at25 && Math.abs(lift.at25.speed - 2) < 1e-6, lift.at25);
check('the Lift: the shaft has gone down past the platform by what the odometer says',
  lift.at25 && Math.abs((lift.Y0 - lift.at25.wallY) - lift.at25.travelled) < 1e-6, lift.at25);
// the landings already gone by below are retired, so it is the walls, the top
// deck and the landings still to come
check('the Lift: the landings, walls and top deck ride as movers', lift.movers >= 5, lift.movers);
check('the Lift: the first power cut stops on its mark', lift.atStop && lift.atStop.travelled === 75, lift.atStop);
check('the Lift: with the landing exactly level', lift.landingTop !== null && Math.abs(lift.landingTop) < 0.01, lift.landingTop);
check('the Lift: the breaker restarts it', !!lift.restarted, lift.restarted);
check('the Lift: the platform never moved in physics', lift.deckSame && lift.deckStill);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('treadmill');
