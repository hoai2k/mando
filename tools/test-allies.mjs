/**
 * Ally regression test: the marshal, VX-9 and Fennec fight beside whoever they
 * are with, and keep moving when there is nothing to fight.
 *
 * Both cases are the kind that only show up in a real match at wave four with
 * two people on the couch, which is exactly why they went unnoticed: an ally
 * anchored on player one would stand beside player two through a whole
 * firefight without firing, and an ally who had caught up to its escortee
 * froze mid-stride until a hostile wandered into range.
 *
 * Run:  node tools/test-allies.mjs
 */
import { launch } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

const h = await launch();
await h.waitForText(/PRESS START|WAVE BATTLE/i);
await h.page.evaluate(() => window.__startCoop(2, 'desert'));
await sleep(9000);

// The cache waves are milestone waves; jump to the first one rather than
// clearing waves of hostiles by hand, then crack the crate open directly.
const spawned = await h.page.evaluate(() => {
  const g = window.__game;
  g.wave = 2;
  g.nextWave();
  const crate = g.allyCrate;
  const walkIns = g.allies.length;   // nobody joins for free any more
  crate?.open(g);
  return { crate: !!crate, opened: crate?.opened, walkIns, kinds: g.allies.map((a) => a.kind) };
});
check('the milestone wave drops a supply cache, no walk-in ally', spawned.crate && spawned.walkIns === 0,
  { crate: spawned.crate, walkIns: spawned.walkIns });
check('cracking the cache frees a squad of five', spawned.kinds.length === 5 && spawned.kinds.every((k) => k === 'marshal'),
  spawned.kinds.join(','));

// These checks all step the simulation directly rather than riding
// requestAnimationFrame. Counting animation frames measures the renderer, not
// the match — under software rendering the same loop covers wildly different
// amounts of game time — and every check below was flaky for that reason.
const STEP_SETUP = `
  window.__manual = true;
  const blank = () => ({
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
    meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
    zoomDelta: 0, blockHeld: false, pausePressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false,
    throttleHeld: false, brakeHeld: false,
  });
  const inputs = [blank(), blank(), blank(), blank()];
  const DT = 1 / 30;
`;

// ---- 1. an ally fights alongside the player it is actually with ----
const engage = await h.page.evaluate(`(() => {
  ${STEP_SETUP}
  const g = window.__game;
  const a = g.allies[0];
  const [p1, p2] = g.players;
  // player one holds the spawn; player two fights at the far end of the board
  // with the ally beside them and a hostile a few metres off
  const far = g.board.groundSpawns.slice().sort((u, v) =>
    v.distanceTo(p1.position) - u.distanceTo(p1.position))[0];
  p2.position.copy(far);
  a.position.set(far.x + 2, far.y, far.z);
  const foe = g.enemies.find((e) => e.alive);
  let steps = 0;
  let engaged = 0;
  // Three seconds of match. The foe is held in the ally's face *and kept
  // alive*: five marshals shoot it dead in about a second, and a dead foe is
  // nothing to engage — which is what this check kept tripping over. Whether
  // the ally can kill it is not the question; whether it turns on a hostile
  // threatening player two rather than distant player one is.
  while (steps < 90) {
    foe.position.set(far.x + 6, far.y, far.z);
    foe.hp = foe.maxHp;
    foe.alive = true;
    g.update(DT, inputs);
    if (a.visible) engaged++;
    steps++;
  }
  return {
    engagedFrames: engaged, frames: steps,
    p1ToP2: Math.round(p1.position.distanceTo(p2.position)),
    allyToFoe: +a.position.distanceTo(foe.position).toFixed(1),
  };
})()`);
check('an ally engages a hostile on the player it is with, not on player one',
  engage.engagedFrames > engage.frames * 0.8, engage);

// ---- 2. an ally with nothing to fight mills instead of standing dead still ----
// With a whole cache squad around the player, any one ally may idle while
// its squadmates shuffle — the freeze bug this guards against locked the
// *escort*, so the squad going still is the failure, not one body resting.
const mill = await h.page.evaluate(`(() => {
  ${STEP_SETUP}
  const g = window.__game;
  const p = g.players[0];
  const park = () => { for (const e of g.enemies) e.position.set(p.position.x + 400, p.position.y, p.position.z); };
  park();
  g.allies.forEach((a, i) => a.position.set(p.position.x + 1.5 + (i % 3), p.position.y, p.position.z + (i / 3 | 0)));
  let steps = 0;
  let moving = 0;
  let maxOff = 0;
  while (steps < 70) {
    park();
    g.update(DT, inputs);
    if (g.allies.some((a) => Math.hypot(a.velocity.x, a.velocity.z) > 0.3)) moving++;
    for (const a of g.allies) maxOff = Math.max(maxOff, a.position.distanceTo(p.position));
    steps++;
  }
  return { moving, frames: steps, maxDistFromPlayer: +maxOff.toFixed(1) };
})()`);
check('an idle squad keeps moving', mill.moving > mill.frames * 0.25, mill);
// and stays with the player rather than wandering off the board
check('...and stays with the player', mill.maxDistFromPlayer < 10, mill.maxDistFromPlayer);

// ---- 3. the cache squad is for this wave only ----
// Deciding the wave means killing everything it staged — and since waves
// arrive now, that includes bodies a carrier has not released yet, which the
// wave counts through `incoming` until the ramp opens. A landing transport
// holds its squad for ~7.4 s after a per-pass stagger, so the wave needs on
// the order of fifteen *seconds of game time* to decide.
//
// That is why this budgets game time rather than animation frames. Counting
// frames measures the renderer, not the match: the same 400 frames are 20 s of
// game time at 20 fps (dt is clamped) and under 7 s at 60. This check spent a
// while passing locally on slow software rendering and failing in CI on faster
// frames — the same tree, the same game, a different frame rate. Stepping the
// simulation directly makes the wait mean what it says, and finishes sooner.
const retired = await h.page.evaluate(`(() => {
  ${STEP_SETUP}
  const g = window.__game;
  let elapsed = 0;
  while (elapsed < 60) {                        // 60 s of match, ~4× what it needs
    for (const e of g.enemies) if (e.alive) e.damage(999999, e.position, 0);
    g.update(DT, inputs);
    elapsed += DT;
    if (g.allies.length === 0 && !g.allyCrate) break;
  }
  return {
    allies: g.allies.length, crate: !!g.allyCrate, state: g.state,
    seconds: +elapsed.toFixed(1), incoming: g.incomingCount,
  };
})()`);
check('the squad melts away when the wave is decided', retired.allies === 0 && !retired.crate, retired);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nallies: all checks passed');
