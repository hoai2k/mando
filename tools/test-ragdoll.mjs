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

  /**
   * The body as it is DRAWN, in world space.
   *
   * Everything here used to be measured off `char.root` — its position and its
   * quaternion — and neither means what it reads as once a solver has posed
   * the body. The articulated solver parks the root quaternion at identity
   * every frame, so "how far did it turn" was really "which way was it facing
   * when it died"; and the root origin stops being the feet the moment the
   * body lies down, so "how far off the ground" drifted by up to a body
   * height. Both were dice rolls that flipped run to run.
   *
   * A skinned mesh's geometry bounding box is its REST pose, so for an
   * authored body the posed truth is the bones; a rigless model is
   * transformed whole, so its mesh boxes are honest. Hidden subtrees are
   * skipped, which is what keeps the procedural stand-in out of the answer
   * once the sculpt has replaced it.
   */
  const drawn = (root) => {
    root.updateMatrixWorld(true);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    let pts = 0;
    let skinned = false;
    const add = (x, y, z) => {
      pts++;
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    };
    const walk = (o, useBones) => {
      if (!o.visible) return;
      if (o.isSkinnedMesh) {
        for (const b of o.skeleton.bones) {
          const m = b.matrixWorld.elements;
          add(m[12], m[13], m[14]);
        }
      } else if (o.isMesh && !useBones) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        if (bb) {
          // the eight corners through the world matrix, by hand, so the probe
          // needs no THREE of its own
          const e = o.matrixWorld.elements;
          for (const cx of [bb.min.x, bb.max.x]) {
            for (const cy of [bb.min.y, bb.max.y]) {
              for (const cz of [bb.min.z, bb.max.z]) {
                add(
                  e[0] * cx + e[4] * cy + e[8] * cz + e[12],
                  e[1] * cx + e[5] * cy + e[9] * cz + e[13],
                  e[2] * cx + e[6] * cy + e[10] * cz + e[14],
                );
              }
            }
          }
        }
      }
      for (const c of o.children) walk(c, useBones);
    };
    root.traverse((o) => { if (o.isSkinnedMesh && o.visible) skinned = true; });
    walk(root, skinned);
    if (!pts) return null;
    return {
      skinned,
      cx: (lo[0] + hi[0]) / 2, cz: (lo[2] + hi[2]) / 2,
      bottom: lo[1],
      tall: hi[1] - lo[1],
      wide: Math.max(hi[0] - lo[0], hi[2] - lo[2]),
    };
  };

  /**
   * How far this body's own up-axis has tipped away from world up, radians.
   *
   * Read off whichever thing is actually posing the body. A rigless corpse is
   * transformed whole, so its root quaternion is its orientation; a rigged one
   * has that root parked at identity by the solver every frame, so the torso —
   * hips to chest — is where the truth is. Reading the root for both is what
   * made this check report which way a trooper happened to be *facing* when he
   * died, and pass or fail on that.
   *
   * Height is no use here: a massiff lying on its side is no shorter than one
   * standing, and neither is a spider.
   */
  const upTilt = (e) => {
    const b = e.char.rig?.bones;
    if (b?.hips && b?.chest) {
      e.char.root.updateMatrixWorld(true);
      const m = b.hips.matrixWorld.elements, n = b.chest.matrixWorld.elements;
      const dx = n[12] - m[12], dy = n[13] - m[13], dz = n[14] - m[14];
      const len = Math.hypot(dx, dy, dz);
      return len > 1e-5 ? Math.acos(Math.max(-1, Math.min(1, dy / len))) : null;
    }
    // (0,1,0) through the root's rotation, then the angle to world up
    const q = e.char.root.quaternion;
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    return Math.acos(Math.max(-1, Math.min(1, uy)));
  };

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
    // The sculpt arrives on wall-clock time, not simulated time, and the
    // sculpt is the body the player watches fall: measuring the procedural
    // stand-in would be measuring something that is about to be replaced.
    for (let i = 0; i < 60 && !(e.char.modelReady?.() ?? true); i++) {
      await new Promise((r) => setTimeout(r, 100));
      run(0.1);
    }
    const root = e.char.root;
    const standing = drawn(root);
    const before = { pos: root.position.clone() };
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
    const fallen = drawn(root);
    const tipped = upTilt(e);
    const moved = root.position.distanceTo(before.pos);
    // Ground under the DRAWN body, sampled in a small ring rather than at one
    // point. A corpse settling against a crate has the crate's lid directly
    // over its middle, so a single sample reads the body as buried in the sand
    // it is plainly lying on top of. Every surface it could legitimately be
    // resting on is kept and the check below takes the best of them.
    const grounds = fallen
      ? [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]
        .map(([dx, dz]) => g.board.physics.groundHeight(
          fallen.cx + dx, fallen.cz + dz, fallen.bottom + 2))
        .filter((v) => v > -Infinity)
      : [];
    trials.push({
      rigged: !!e.char.rig,
      alive: e.alive,
      skinned: !!fallen?.skinned,
      // how far the body's own up-axis has tipped from world up, radians
      tipped: tipped === null ? null : +tipped.toFixed(2),
      // did this creature stand taller than it was wide? Only such a body has
      // an upright it can be wrongly left in — see the check below
      upright: standing ? standing.tall > standing.wide : null,
      moved: +moved.toFixed(2),
      // and how far the lowest drawn point sits off each surface under it
      offGround: fallen && grounds.length
        ? grounds.map((v) => +(fallen.bottom - v).toFixed(2))
        : null,
    });
    e.removeMe = true;
    run(0.2);
   }
   out[kind] = trials;
  }

  // ---- and the case the flags used to hide: killed on the way down ----
  //
  // `downTimer` runs from the moment a body is knocked over until it is back
  // on its feet, and a rigged enemy that died anywhere inside that window used
  // to skip the solver entirely and keep whatever pose it was holding — which,
  // in the first fraction of a second, is still standing. That is the raider
  // left sticking diagonally out of the sand.
  //
  // Measured on the body that is DRAWN, not on the procedural rig: the sculpt
  // is what the player sees, and a rig lying flat under a standing model has
  // fooled this test before. A fallen body is wider than it is tall.
  const felled = [];
  for (let trial = 0; trial < TRIALS; trial++) {
    const spot = p.position.clone();
    spot.x += 14;
    spot.z -= 8;
    const e = g.addReinforcement('tusken', spot);
    for (let t = 0; t < 15 && e.arrival; t += DT) g.update(DT, inputs);
    run(0.8);
    // the .glb lands on wall-clock time, not simulated time
    const skinCount = () => { let n = 0; e.char.root.traverse((o) => { if (o.isSkinnedMesh) n++; }); return n; };
    for (let i = 0; i < 60 && !skinCount(); i++) {
      await new Promise((r) => setTimeout(r, 100));
      run(0.1);
    }
    e.velocity.set(0, 0, 0);
    e.knockdown(1.8);
    run(0.1);                       // over, but nowhere near flat yet
    e.velocity.set(0, 0, 0);
    e.damage(9999, e.position.clone(), 0);
    run(3.5);
    e.char.root.updateMatrixWorld(true);
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9, bones = 0;
    e.char.root.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      for (const bone of o.skeleton.bones) {
        const el = bone.matrixWorld.elements;
        bones++;
        minX = Math.min(minX, el[12]); maxX = Math.max(maxX, el[12]);
        minY = Math.min(minY, el[13]); maxY = Math.max(maxY, el[13]);
        minZ = Math.min(minZ, el[14]); maxZ = Math.max(maxZ, el[14]);
      }
    });
    felled.push(bones
      ? { tall: +(maxY - minY).toFixed(2), wide: +Math.max(maxX - minX, maxZ - minZ).toFixed(2) }
      : null);
    e.removeMe = true;
    run(0.2);
  }
  out.__felled = felled;

  // ---- a corpse is still a body in the world ----
  //
  // The promise for a creature that comes to rest the way it lived — a wide
  // flat animal has its own underside for a resting face, and no amount of
  // physics keeps one propped at an angle — is that you can shoot it again and
  // move it. Checked on the spider, which is the shape that provokes it.
  const shoved = [];
  for (let trial = 0; trial < TRIALS; trial++) {
    const spot = p.position.clone();
    spot.x += 12;
    spot.z += 10 + trial * 3;
    const e = g.addReinforcement('krykna', spot);
    for (let t = 0; t < 15 && e.arrival; t += DT) g.update(DT, inputs);
    run(0.6);
    const from = p.position.clone();
    e.damage(9999, from, 0);
    e.knockback(from, 5.5, 0.2);
    run(5);
    const target = !!e.corpse;
    const before = e.char.root.position.clone();
    if (target) e.shoveCorpse(e.position.clone().setX(e.position.x + 2), 9);
    run(1.5);
    shoved.push({ target, moved: +e.char.root.position.distanceTo(before).toFixed(2) });
    e.removeMe = true;
    run(0.2);
  }
  out.__shoved = shoved;

  // ---- and the world is solid: a body thrown at a wall stays out of it ----
  //
  // The articulated solver knew about the floor and nothing else. Every point
  // was clamped to the ground height under it and left free in every other
  // direction, so a body that died against a crate, a wall or a pillar sank
  // straight through the side of it and came to rest inside the scenery —
  // which is the corpse the player sees half-buried in a wall. The rigid
  // solver next door had been pushing its corners out of the world all along.
  const walled = [];
  {
    const phys = g.board.physics;
    // a solid the board actually has: something tall and wide enough to throw
    // a body at, as near the player as one gets
    const solid = phys.boxes
      .filter((b) => b.max.y - b.min.y > 1.8 && b.max.x - b.min.x > 1.2 && b.max.z - b.min.z > 1.2)
      .sort((u, v) => Math.hypot(u.min.x - p.position.x, u.min.z - p.position.z)
        - Math.hypot(v.min.x - p.position.x, v.min.z - p.position.z))[0];
    // every bone of the drawn body, so this measures what is on screen
    const bones = (root) => {
      root.updateMatrixWorld(true);
      const pts = [];
      root.traverse((o) => {
        if (!o.isSkinnedMesh || !o.visible) return;
        for (const b of o.skeleton.bones) {
          const e = b.matrixWorld.elements;
          pts.push([e[12], e[13], e[14]]);
        }
      });
      return pts;
    };
    for (let trial = 0; solid && trial < TRIALS; trial++) {
      const cz = (solid.min.z + solid.max.z) / 2;
      const e = g.addReinforcement('stormtrooper', p.position.clone());
      for (let t = 0; t < 15 && e.arrival; t += DT) g.update(DT, inputs);
      for (let i = 0; i < 60 && !(e.char.modelReady?.() ?? true); i++) {
        await new Promise((r) => setTimeout(r, 100));
        run(0.1);
      }
      // stood just off one face, then thrown flat into it
      const stand = phys.groundHeight(solid.max.x + 1.4, cz, solid.max.y + 2);
      e.position.set(solid.max.x + 1.4, stand > -Infinity ? stand : solid.min.y, cz);
      e.velocity.set(0, 0, 0);
      run(0.2);
      const from = e.position.clone();
      from.x += 5;
      e.damage(9999, from, 0);
      e.knockback(from, 14, 0.2);
      run(3);
      const pts = bones(e.char.root);
      // how far the deepest bone is inside the box: the shallowest face it
      // would have to come out through
      const depth = ([x, y, z]) => (x <= solid.min.x || x >= solid.max.x
        || y <= solid.min.y || y >= solid.max.y || z <= solid.min.z || z >= solid.max.z)
        ? 0
        : Math.min(x - solid.min.x, solid.max.x - x, y - solid.min.y,
          solid.max.y - y, z - solid.min.z, solid.max.z - z);
      const rag = e.ragdoll;
      walled.push({
        bones: pts.length,
        // the simulated body itself — the fifteen points the solver moves
        points: rag?.pos?.length ?? 0,
        pointsInside: rag?.pos?.filter((q) => phys.solidAt(q.x, q.y, q.z)).length ?? -1,
        // and the drawn body, which hangs off those points on the sculpt's own
        // bone lengths: a hand may overlap a face, a body may not be in there
        deepest: +Math.max(0, ...pts.map(depth)).toFixed(2),
        // it is genuinely against the thing, not stopped metres short of it
        reached: +Math.min(...pts.map(([x]) => x - solid.max.x)).toFixed(2),
      });
      e.removeMe = true;
      run(0.2);
    }
  }
  out.__walled = walled;
  window.__manual = false;
  return out;
});

/** how many of the three trials have to hold for the property to count */
const MOST = 2;
const most = (trials, pred) => trials.filter(pred).length >= MOST;

const felled = results.__felled;
delete results.__felled;
const shoved = results.__shoved;
delete results.__shoved;
const walled = results.__walled;
delete results.__walled;
// The simulated body has to stay out of the solid outright. The drawn one is
// allowed to graze it: fifteen points drive an authored sculpt with its own
// bone lengths, so a hand or a boot can overlap a face by a hand's width —
// what this rules out is the body lying *in* the crate, which is what a solver
// that only knew about the floor did with every corpse that fell against one.
check('a corpse thrown at a wall does not end up inside it',
  walled.length > 0 && walled.every((r) => r.points > 0 && r.pointsInside === 0), walled);
check('...and the body it draws stays out of it too',
  walled.every((r) => r.bones > 0 && r.deepest < 0.5), walled);
check('...having actually been thrown against it',
  walled.every((r) => r.reached < 0.5), walled);
check('a settled corpse is still something you can shoot',
  shoved.every((r) => r.target), shoved);
check('...and shooting it moves it', most(shoved, (r) => r.moved > 0.4), shoved);
// A body on the ground is wider than it is tall. One left standing measures
// its own height — 1.5 m of tusken against a metre of shoulders.
check('a body killed the instant it is knocked over still ends up flat',
  felled.filter((v) => v && v.wide > v.tall).length >= MOST, { felled });

for (const [kind, trials] of Object.entries(results)) {
  check(`${kind} dies`, trials.every((r) => r.alive === false),
    trials.map((r) => r.alive));
  // A body that stood taller than it was wide has an upright it can be left
  // wrongly standing in, and a ragdoll has to take it out of that: its own
  // up-axis ends up well away from world up. Measured on whatever is posing
  // the body — see `upTilt` — since reading the root quaternion for a rigged
  // corpse reported which way the creature happened to be facing when it
  // died, and nothing else.
  //
  // A low, wide animal is exempt, and deliberately: a spider's resting shape
  // *is* its standing one, and a dead krykna settling onto its own underside
  // is what a wide flat body does. It used to tumble to a random angle here,
  // and that was the bug — the solver was falling on a cube cut from its
  // collision capsule rather than on the shape of the animal. Travel and
  // grounding are what those bodies are held to, and both are checked below.
  const standsTall = trials.some((r) => r.upright);
  if (standsTall) {
    check(`${kind} ragdolls (body goes over)`,
      most(trials, (r) => r.tipped !== null && r.tipped > 0.6),
      { tipped: trials.map((r) => r.tipped) });
  } else {
    console.log(`  --   ${kind} is wider than it is tall: no upright to be left in`);
  }
  // and it goes somewhere: thrown by the killing blow, then settled
  check(`${kind} corpse is thrown clear`, most(trials, (r) => r.moved > 0.4),
    { moved: trials.map((r) => r.moved) });
  // It must end on the ground it fell onto, not sunk into it or floating.
  // The lowest drawn point is the contact: bones sit inside the flesh, so a
  // little clearance is expected, and a body draped over something the ring
  // missed is allowed a little more.
  check(`${kind} rests on the ground`,
    most(trials, (r) => r.offGround === null
      || r.offGround.some((off) => off > -0.5 && off < 0.75)),
    { offGround: trials.map((r) => r.offGround) });
}

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall ragdoll checks passed');
process.exit(failures.length ? 1 : 0);
