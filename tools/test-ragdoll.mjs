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
await sleep(9000);

const results = await h.page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  const out = {};
  // one of each family: a spider and a beast on free-form rigs, a trooper on
  // the canonical one
  for (const kind of ['krykna', 'massiff', 'stormtrooper']) {
    const spot = p.position.clone();
    spot.x += 14;
    spot.z += 6;
    const e = g.addReinforcement(kind, spot);
    // let it land and settle before killing it
    await new Promise((r) => setTimeout(r, 2500));
    const root = e.char.root;
    const before = {
      pos: root.position.clone(),
      quat: root.quaternion.clone(),
    };
    // killed from one side, hard, so the body is thrown as well as dropped
    e.damage(9999, p.position.clone(), 0);
    await new Promise((r) => setTimeout(r, 2600));
    const tilt = before.quat.angleTo(root.quaternion);
    const moved = root.position.distanceTo(before.pos);
    const ground = g.board.physics.groundHeight(root.position.x, root.position.z, root.position.y + 2);
    out[kind] = {
      rigged: !!e.char.rig,
      alive: e.alive,
      height: e.height,
      tilt: +tilt.toFixed(2),
      moved: +moved.toFixed(2),
      // how far the body's origin sits off the surface under it
      offGround: ground > -Infinity ? +(root.position.y - ground).toFixed(2) : null,
    };
    e.removeMe = true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
});

for (const [kind, r] of Object.entries(results)) {
  check(`${kind} dies`, r.alive === false, r);
  // A ragdoll turns the body over — a corpse left standing bolt upright is the
  // bug this test exists for.
  check(`${kind} ragdolls (body turns over)`, r.tilt > 0.5, { tilt: r.tilt, rigged: r.rigged });
  // and it goes somewhere: thrown by the killing blow, then settled
  check(`${kind} corpse is thrown clear`, r.moved > 0.4, { moved: r.moved });
  // It must end on the ground it fell onto, not sunk into it or floating. The
  // measurement is of the model's origin, which sits at the creature's feet —
  // so a body lying on its side legitimately carries that origin up by about
  // its own half-width, and the tolerance scales with the animal.
  check(`${kind} rests on the ground`,
    r.offGround === null || (r.offGround > -r.height * 0.4 && r.offGround < r.height * 0.9),
    { offGround: r.offGround, height: r.height });
}

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall ragdoll checks passed');
process.exit(failures.length ? 1 : 0);
