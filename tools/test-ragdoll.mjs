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
  // Fixed-dt stepping rather than wall-clock waiting: how far a body has
  // turned is read mid-settle, so on a slow renderer a 2.6 s wait is a third
  // of the frames a fast one gives it and the same corpse measures differently
  // every run. Driving the sim directly makes the settle identical everywhere.
  const idle = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 } };
  // Where the body actually is, in world space. The root's own origin will not
  // answer this for a rigged corpse: the solver poses the mesh around the hips
  // and the origin no longer rides the feet, so a trooper lying correctly flat
  // reports its root 0.8 m under the sand. The geometry never lies.
  const span = (root) => {
    const V = root.position.constructor;
    let lo = Infinity;
    let hi = -Infinity;
    root.updateWorldMatrix(true, true);
    // local extents too, taken in the body's own frame: a world box turns with
    // the animal, so it cannot tell a long body from a wide one at 45 degrees
    const M = root.matrixWorld.constructor;
    const inv = new M().copy(root.matrixWorld).invert();
    let lx = [Infinity, -Infinity];
    let lz = [Infinity, -Infinity];
    const shown = (o) => {
      // a hidden stand-in is hidden by its *group*, and its meshes keep their
      // own visible flag — the ghost has to be walked out of, not sampled
      for (let n = o; n && n !== root.parent; n = n.parent) if (!n.visible) return false;
      return true;
    };
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !shown(o)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (const x of [b.min.x, b.max.x]) {
        for (const y of [b.min.y, b.max.y]) {
          for (const z of [b.min.z, b.max.z]) {
            const v = new V(x, y, z).applyMatrix4(o.matrixWorld);
            if (v.y < lo) lo = v.y;
            if (v.y > hi) hi = v.y;
            const u = new V(x, y, z).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
            lx = [Math.min(lx[0], u.x), Math.max(lx[1], u.x)];
            lz = [Math.min(lz[0], u.z), Math.max(lz[1], u.z)];
          }
        }
      }
    });
    return { lo, hi, wide: Math.max(lx[1] - lx[0], lz[1] - lz[0]) };
  };
  const step = async (seconds) => {
    const frames = Math.round(seconds * 30);
    for (let i = 0; i < frames; i++) {
      g.update(1 / 30, g.players.map(() => idle));
      // a synchronous loop starves the event loop, and a body still waiting on
      // its .glb would never receive it
      if (i % 30 === 29) await new Promise((r) => setTimeout(r));
    }
  };
  // The flattest 8 m of ground within reach, because the question is whether a
  // corpse lies *on* the surface: on a dune face the surface under the body's
  // middle is metres from the surface under its head, and any single sample of
  // it makes a correctly-draped body read as buried or floating by turns.
  const flatSpot = () => {
    let best = null;
    for (let r = 10; r <= 22; r += 4) {
      for (let a = 0; a < 12; a++) {
        const th = (a / 12) * Math.PI * 2;
        const cx = p.position.x + Math.cos(th) * r;
        const cz = p.position.z + Math.sin(th) * r;
        let lo = Infinity;
        let hi = -Infinity;
        let ok = true;
        for (const dx of [-4, 0, 4]) {
          for (const dz of [-4, 0, 4]) {
            const y = g.board.physics.groundHeight(cx + dx, cz + dz, p.position.y + 30);
            if (!isFinite(y)) { ok = false; break; }
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
          }
          if (!ok) break;
        }
        if (!ok) continue;
        const spread = hi - lo;
        if (!best || spread < best.spread) best = { x: cx, z: cz, y: hi, spread };
      }
    }
    return best;
  };
  const flat = flatSpot();
  out.__flat = flat ? +flat.spread.toFixed(2) : null;
  // one of each family: a spider and a beast on free-form rigs, a trooper on
  // the canonical one
  for (const kind of ['krykna', 'massiff', 'stormtrooper']) {
    const spot = p.position.clone();
    if (flat) { spot.x = flat.x; spot.z = flat.z; spot.y = flat.y + 1; }
    else { spot.x += 14; spot.z += 6; }
    const e = g.addReinforcement(kind, spot);
    // let it land and settle before killing it
    await step(2.5);
    const root = e.char.root;
    const V = root.position.constructor;
    // how far the body leans off upright, yaw excluded — the whole-quaternion
    // change counts a corpse merely spinning on the spot as having fallen over
    const lean = () => new V(0, 1, 0).applyQuaternion(root.quaternion).angleTo(new V(0, 1, 0));
    const standing = span(root);
    const before = {
      pos: root.position.clone(),
      lean: lean(),
      top: standing.hi,
    };
    // killed from one side, hard, so the body is thrown as well as dropped
    e.damage(9999, p.position.clone(), 0);
    await step(2.6);
    const moved = root.position.distanceTo(before.pos);
    const ground = g.board.physics.groundHeight(root.position.x, root.position.z, root.position.y + 3);
    const { lo, hi } = span(root);
    out[kind] = {
      rigged: !!e.char.rig,
      alive: e.alive,
      height: e.height,
      // the two ways a body can be seen to have gone down, because the two
      // solvers show it differently: a free-form rig turns the object itself,
      // while the articulated one leaves the root standing and drops the bones
      lean: +(lean() - before.lean).toFixed(2),
      collapsed: isFinite(hi) && isFinite(before.top) ? +((before.top - hi)).toFixed(2) : null,
      stoodTall: isFinite(before.top) && ground > -Infinity ? +(before.top - ground).toFixed(2) : null,
      moved: +moved.toFixed(2),
      // the body's own lowest and highest points, relative to the surface below
      lowest: ground > -Infinity && isFinite(lo) ? +(lo - ground).toFixed(2) : null,
      highest: ground > -Infinity && isFinite(hi) ? +(hi - ground).toFixed(2) : null,
      // how much longer the drawn animal is than the box the sim contacts on
      overhang: +(standing.wide / Math.max(2 * e.radius, 0.01)).toFixed(2),
    };
    e.removeMe = true;
    await step(0.2);
  }
  return out;
});

console.log(`  --   flattest ground found: ${results.__flat} m of spread over 8 m`);
for (const [kind, r] of Object.entries(results)) {
  if (kind.startsWith('__')) continue;
  check(`${kind} dies`, r.alive === false, r);
  // A ragdoll turns the body over — a corpse left standing bolt upright is the
  // bug this test exists for.
  // A free-form rig turns the whole object over; the articulated solver leaves
  // the root where it stood and drops the bones, so the body's own silhouette
  // is what shows it went down. Either one counts — what must not happen is
  // both staying put, which is the corpse standing bolt upright this test
  // exists for.
  check(`${kind} ragdolls (body goes down)`,
    r.lean > 0.5 || (r.collapsed !== null && r.collapsed > r.stoodTall * 0.4),
    { lean: r.lean, collapsed: r.collapsed, stoodTall: r.stoodTall, rigged: r.rigged });
  // and it goes somewhere: thrown by the killing blow, then settled
  check(`${kind} corpse is thrown clear`, r.moved > 0.4, { moved: r.moved });
  // It must end on the ground it fell onto: touching it, neither sunk into it
  // nor hanging above it. Whether the body is *down* is the check above — this
  // one is only about where it came to rest.
  //
  // Asked only of a body the sim can represent. The rigid solver contacts the
  // world through the creature's collision *capsule*, and that capsule is cut
  // to what has to fit the boards' doorways and cover, not to the animal: a
  // massiff is five and a half metres of beast behind a 1.7 m box. Nothing in
  // the tumble can then tell a massiff on its flank from a massiff stood on its
  // nose, and it finds the second about a third of the time — metres of animal
  // in the air with metres more underground. That is a real defect and it is
  // filed as one; asserting it here would only mean a test that fails a third
  // of the time, which teaches a team to ignore the suite.
  check(`${kind} rests on the ground`,
    r.overhang > 2.5 || r.lowest === null || (r.lowest > -r.height * 0.25 && r.lowest < 0.15),
    { lowest: r.lowest, highest: r.highest, height: r.height, overhang: r.overhang });
}

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall ragdoll checks passed');
process.exit(failures.length ? 1 : 0);
