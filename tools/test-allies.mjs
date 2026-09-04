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
// clearing waves of hostiles by hand.
const spawned = await h.page.evaluate(() => {
  const g = window.__game;
  g.wave = 2;
  g.nextWave();
  const crate = g.allyCrate;
  const p = g.players[0];
  return {
    crate: !!crate,
    walkIns: g.allies.length,        // nobody joins for free any more
    hp: crate?.breakable.maxHp ?? 0,
    bolt: p.profile.boltDamage,
    swing: p.profile.meleeDamage,
  };
});
check('the milestone wave drops a supply cache, no walk-in ally', spawned.crate && spawned.walkIns === 0,
  { crate: spawned.crate, walkIns: spawned.walkIns });
// The cache used to carry a single hit point, which made it a target for
// exactly one thing: a bolt. Everything a player can hit with has to be able
// to spring it, so its health is set where a couple of either does.
check('a couple of bolts or a couple of swings springs the cache',
  spawned.hp > 0 && spawned.hp <= spawned.bolt * 2 && spawned.hp <= spawned.swing * 2
  && spawned.hp > spawned.bolt && spawned.hp > spawned.swing, spawned);

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
  });
  const inputs = [blank(), blank(), blank(), blank()];
  const DT = 1 / 30;
`;

// ---- 0. the cache opens to a melee build, not only to a trigger ----
// A fighter who has put the gun away (or never had one — Ventress) could not
// open their own reinforcements: the crate answered bolts and nothing else.
const cracked = await h.page.evaluate(`(() => {
  ${STEP_SETUP}
  const g = window.__game;
  const p = g.players[0];
  const crate = g.allyCrate;
  // stand in front of it, facing it, with the blades out and nothing else in
  // reach — no hostile is going to be credited with this
  for (const e of g.enemies) e.position.set(p.position.x + 500, p.position.y, p.position.z);
  p.position.set(crate.pos.x, crate.pos.y, crate.pos.z + 2.6);
  p.velocity.set(0, 0, 0);
  p.facingYaw = Math.atan2(crate.pos.x - p.position.x, crate.pos.z - p.position.z);
  const before = crate.breakable.hp;
  let swings = 0;
  for (let t = 0; t < 6 && !crate.opened; t += DT) {
    // one press per swing: the combo window eats a held button
    const swing = p.meleeActive === false && !crate.opened;
    if (swing) swings++;
    inputs[0].meleePressed = swing;
    p.facingYaw = Math.atan2(crate.pos.x - p.position.x, crate.pos.z - p.position.z);
    g.update(DT, inputs);
    inputs[0].meleePressed = false;
  }
  return { before, opened: !!crate.opened, swings, kinds: g.allies.map((a) => a.kind) };
})()`);
check('a melee swing cracks the supply cache open', cracked.opened, cracked);
check('...in about two swings', cracked.swings > 0 && cracked.swings <= 3, cracked.swings);
check('cracking the cache frees a squad of five',
  cracked.kinds.length === 5 && cracked.kinds.every((k) => k === 'marshal'), cracked.kinds.join(','));

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

// ---- 1b. the ally fights what threatens its player, not what is nearest it ----
// The pick used to be "whichever hostile is closest to *me*", measured for
// range against the player. On a board with hostiles posted all over, that is
// routinely one across the map: the squad measured it, found it far from the
// player, and stood down — beside a player being shot at.
const pick = await h.page.evaluate(`(() => {
  ${STEP_SETUP}
  const g = window.__game;
  const p = g.players[0];
  const live = g.enemies.filter((e) => e.alive);
  const near = live[0], far = live[1];
  for (const e of live.slice(2)) e.position.set(p.position.x + 500, p.position.y, p.position.z);
  // the squad stands between the two: the far hostile is the nearer of the two
  // to the allies, and only the near one of them is anywhere near the player
  g.allies.forEach((a, i) => a.position.set(p.position.x + i * 1.2, p.position.y, p.position.z + 30));
  const place = () => {
    near.position.set(p.position.x + 25, p.position.y, p.position.z);
    far.position.set(p.position.x, p.position.y, p.position.z + 58);
    for (const e of [near, far]) { e.hp = e.maxHp; e.alive = true; }
  };
  let onNear = 0, steps = 0;
  let closed = 99;
  while (steps < 210) {
    place();
    g.update(DT, inputs);
    // engaged *on that one*: the target picked and a fight actually joined
    if (g.allies.every((a) => a.target === near && a.visible)) onNear++;
    for (const a of g.allies) closed = Math.min(closed, a.position.distanceTo(near.position));
    steps++;
  }
  return { onNear, frames: steps, closed: +closed.toFixed(1) };
})()`);
check('the squad turns on the hostile threatening its player, not the nearest one',
  pick.onNear > pick.frames * 0.9, pick);
// and presses it. An ally was never committed by the director — nobody put
// allies in that plan — so it held the uncommitted shooter's standoff band,
// twenty-five metres off a hostile that is twenty-five metres from the player:
// the squad watched the fight from the far side of it. Committed, it closes.
check('...and presses in to fight it', pick.closed < 20, pick.closed);

// ---- 1c. the squad follows the player across the board ----
const follow = await h.page.evaluate(`(() => {
  ${STEP_SETUP}
  const g = window.__game;
  const p = g.players[0];
  const spawns = g.board.groundSpawns;
  for (const e of g.enemies) e.position.set(p.position.x + 500, p.position.y, p.position.z);
  // the player walks the board: three posts in turn, ten seconds at each
  let steps = 0;
  let post = 0;
  let worst = 0;
  const legs = spawns.slice().sort((u, v) => v.distanceTo(p.position) - u.distanceTo(p.position)).slice(0, 3);
  while (post < legs.length) {
    // the whole party moves: an ally escorts whoever is nearest, so leaving
    // player two behind would only measure the distance to the wrong person
    for (const q of g.players) q.position.copy(legs[post]);
    for (let t = 0; t < 12; t += DT) {
      for (const e of g.enemies) e.position.set(p.position.x + 500, p.position.y, p.position.z);
      g.update(DT, inputs);
      steps++;
    }
    // measured at the end of each leg: how far the squad is from the player
    // once it has had time to walk (or be set down) there
    for (const a of g.allies) worst = Math.max(worst, a.position.distanceTo(p.position));
    post++;
  }
  const gaps = g.allies.map((a) => +a.position.distanceTo(p.position).toFixed(1));
  return { frames: steps, worstEndOfLeg: +worst.toFixed(1), gaps, legs: legs.length };
})()`);
check('the squad follows the player wherever they go', follow.gaps.every((d) => d < 12), follow);

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
