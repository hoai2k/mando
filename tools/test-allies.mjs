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

// ---- 1. an ally fights alongside the player it is actually with ----
const engage = await h.page.evaluate(() => new Promise((res) => {
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
  let n = 0;
  let engagedFrames = 0;
  const tick = () => {
    foe.position.set(far.x + 6, far.y, far.z);   // hold it in the ally's face
    if (a.visible) engagedFrames++;
    if (++n >= 25) {
      res({
        engagedFrames, frames: n,
        p1ToP2: Math.round(p1.position.distanceTo(p2.position)),
        allyToFoe: +a.position.distanceTo(foe.position).toFixed(1),
      });
    } else requestAnimationFrame(tick);
  };
  tick();
}));
check('an ally engages a hostile on the player it is with, not on player one',
  engage.engagedFrames > engage.frames * 0.8, engage);

// ---- 2. an ally with nothing to fight mills instead of standing dead still ----
// With a whole cache squad around the player, any one ally may idle while
// its squadmates shuffle — the freeze bug this guards against locked the
// *escort*, so the squad going still is the failure, not one body resting.
const mill = await h.page.evaluate(() => new Promise((res) => {
  const g = window.__game;
  const p = g.players[0];
  const park = () => { for (const e of g.enemies) e.position.set(p.position.x + 400, p.position.y, p.position.z); };
  park();
  g.allies.forEach((a, i) => a.position.set(p.position.x + 1.5 + (i % 3), p.position.y, p.position.z + (i / 3 | 0)));
  let n = 0;
  let moving = 0;
  let maxOff = 0;
  const tick = () => {
    park();
    if (g.allies.some((a) => Math.hypot(a.velocity.x, a.velocity.z) > 0.3)) moving++;
    for (const a of g.allies) maxOff = Math.max(maxOff, a.position.distanceTo(p.position));
    if (++n >= 70) {
      res({ moving, frames: n, maxDistFromPlayer: +maxOff.toFixed(1) });
    } else requestAnimationFrame(tick);
  };
  tick();
}));
check('an idle squad keeps moving', mill.moving > mill.frames * 0.25, mill);
// and stays with the player rather than wandering off the board
check('...and stays with the player', mill.maxDistFromPlayer < 10, mill.maxDistFromPlayer);

// ---- 3. the cache squad is for this wave only ----
const retired = await h.page.evaluate(() => new Promise((res) => {
  const g = window.__game;
  // Deciding the wave means killing everything it staged — and since waves
  // arrive now, that includes bodies a carrier has not released yet. Cull
  // every tick rather than once, and give the last transports time to let go.
  let n = 0;
  const tick = () => {
    for (const e of g.enemies) if (e.alive) e.damage(999999, e.position, 0);
    const done = g.allies.length === 0 && !g.allyCrate;
    if (done || ++n >= 400) res({ allies: g.allies.length, crate: !!g.allyCrate, state: g.state });
    else requestAnimationFrame(tick);
  };
  tick();
}));
check('the squad melts away when the wave is decided', retired.allies === 0 && !retired.crate, retired);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nallies: all checks passed');
