/**
 * Death physics regression test.
 *
 * Two things have to hold, and they used to hold for only half the roster.
 *
 * 1. **Everything ragdolls.** A humanoid dies on the articulated solver; a
 *    creature on a free-form rig — the krykna, the massiff, the drone — has no
 *    canonical skeleton to hang that on and used to get a canned tip onto its
 *    flank instead, which always looked the same and always ended flat on the
 *    spot it died. Both now simulate: the body turns, it travels, and it comes
 *    to rest somewhere the sim chose.
 * 2. **The corpse ends up on the ground it fell onto**, not inside it and not
 *    hanging in the air — which is what a solver that never saw the world
 *    would do.
 *
 * Run:  node tools/test-ragdoll.mjs
 */
import { launch } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

const h = await launch();
await h.waitForText(/WAVE BATTLE|PRESS START/i);
await h.page.evaluate(() => window.__startCoop(1, 'desert'));
// wall clock is right here: this waits for the board and its models to load,
// which is real elapsed time, not simulated time
await sleep(9000);

const results = await h.page.evaluate(async () => {
  // Step the simulation directly rather than sleeping on the wall clock.
  // Waiting 2.6 s of real time and then reading the body measures the
  // renderer, not the physics: under CI's software rendering that is a
  // handful of solver steps and the corpse has barely begun to turn, which
  // is why "massiff ragdolls" failed there at tilt 0.44 while passing on a
  // developer's machine. Two and a half seconds of *simulated* death is the
  // same amount of settling everywhere.
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
  const DT = 1 / 60;
  const g = window.__game;
  const run = (seconds) => {
    for (let t = 0; t < seconds; t += DT) g.update(DT, inputs);
  };
  const p = g.players[0];
  const out = {};
  // one of each family: a spider and a beast on free-form rigs, a trooper on
  // the canonical one
  // Three deaths per kind, judged on the majority. A ragdoll is a stochastic
  // sim — where the body lands, which corner catches, which way it rolls —
  // and asserting a hard threshold on one sample tests the dice as much as
  // the solver. What these checks mean is "this kind ragdolls", which is a
  // property of the population, so two of three has to hold. A kind that has
  // genuinely stopped ragdolling fails all three.
  const TRIALS = 3;
  for (const kind of ['krykna', 'massiff', 'stormtrooper']) {
   const trials = [];
   for (let trial = 0; trial < TRIALS; trial++) {
    const spot = p.position.clone();
    spot.x += 14;
    spot.z += 6;
    const e = g.addReinforcement(kind, spot);
    // Let it land before killing it — waited for, not timed. Reinforcements
    // arrive now (carrier drop, parachute, a run in from the board edge), so a
    // fixed 2.5 s sometimes killed a body still in the air or still walking
    // on, and a corpse that never stood up is not what any of these checks
    // mean to measure. `arrival` is live for exactly as long as that is going
    // on; give it a little settling afterwards.
    for (let t = 0; t < 15 && e.arrival; t += DT) g.update(DT, inputs);
    run(0.6);
    const root = e.char.root;
    const before = {
      pos: root.position.clone(),
      quat: root.quaternion.clone(),
    };
    // Killed from one side, hard, so the body is thrown as well as dropped —
    // which means killing it the way the game does. A bolt's onHit runs
    // damage() *and then* knockback() on a hostile, and it is the knockback
    // that puts speed into the body; damage() alone imparts none. Seeding the
    // ragdoll from velocity, the shove is what turns the corpse over, so
    // without it the check was really asking whether the creature happened to
    // be charging at the moment it died: a massiff mid-run turned over (tilt
    // ~1.5), one standing still stayed bolt upright (~0.1), and the test
    // flipped between them run to run.
    const from = p.position.clone();
    e.damage(9999, from, 0);
    e.knockback(from, 5.5, 0.2);
    run(2.6);
    const tilt = before.quat.angleTo(root.quaternion);
    const moved = root.position.distanceTo(before.pos);
    // Ground under the body, sampled in a small ring rather than at the one
    // centre point. A corpse settling against a crate has the crate's lid
    // directly over its origin, so a single sample reads the body as buried
    // 1.6 m inside the sand it is plainly lying on top of. Every sample the
    // body could legitimately be resting on is kept, and the check below
    // passes if any of them puts it on the deck.
    const grounds = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]
      .map(([dx, dz]) => g.board.physics.groundHeight(
        root.position.x + dx, root.position.z + dz, root.position.y + 2))
      .filter((v) => v > -Infinity);
    trials.push({
      rigged: !!e.char.rig,
      alive: e.alive,
      height: e.height,
      tilt: +tilt.toFixed(2),
      moved: +moved.toFixed(2),
      // how far the body's origin sits off each candidate surface under it
      offGround: grounds.length
        ? grounds.map((v) => +(root.position.y - v).toFixed(2))
        : null,
    });
    e.removeMe = true;
    run(0.2);
   }
   out[kind] = trials;
  }
  window.__manual = false;
  return out;
});

/** how many of the three trials have to hold for the property to count */
const MOST = 2;
const most = (trials, pred) => trials.filter(pred).length >= MOST;

for (const [kind, trials] of Object.entries(results)) {
  const height = trials[0].height;
  check(`${kind} dies`, trials.every((r) => r.alive === false),
    trials.map((r) => r.alive));
  // A ragdoll turns the body over — a corpse left standing bolt upright is the
  // bug this test exists for.
  check(`${kind} ragdolls (body turns over)`, most(trials, (r) => r.tilt > 0.5),
    { tilt: trials.map((r) => r.tilt), rigged: trials[0].rigged });
  // and it goes somewhere: thrown by the killing blow, then settled
  check(`${kind} corpse is thrown clear`, most(trials, (r) => r.moved > 0.4),
    { moved: trials.map((r) => r.moved) });
  // It must end on the ground it fell onto, not sunk into it or floating. The
  // measurement is of the model's origin, which sits at the creature's feet —
  // so a body lying on its side legitimately carries that origin up by about
  // its own half-width, and the tolerance scales with the animal.
  check(`${kind} rests on the ground`,
    most(trials, (r) => r.offGround === null
      || r.offGround.some((off) => off > -height * 0.4 && off < height * 0.9)),
    { offGround: trials.map((r) => r.offGround), height });
}

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall ragdoll checks passed');
process.exit(failures.length ? 1 : 0);
