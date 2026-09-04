/**
 * Wave arrival regression test (src/enemies/arrival.ts).
 *
 * From wave 2 on, reinforcements arrive instead of appearing: carrier passes
 * drop squads (some under parachutes), locals run in over the edge, quarren
 * surface from the sea, air squads fly in. Three things have to hold, on the
 * boards where each is hardest:
 *
 *  1. Everyone staged actually arrives, and lands somewhere legal — with room
 *     for the capsule AND ground under it. The station is the acid test: its
 *     posts are floating platforms and everything around them is void.
 *  2. Parachutes exist during the descent and are gone after it.
 *  3. The wave cannot be cleared while a carrier still holds bodies — killing
 *     everything on the field with drops inbound must not end the wave.
 *
 * The simulation is stepped directly (the fixed-dt trick from test-modes):
 * software rendering runs a frame a second, and a nine-second parachute
 * descent would otherwise take minutes of wall clock per board.
 *
 * Run:  node tools/test-arrivals.mjs
 */
import { launch } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

const STEP = `(n) => {
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const g = window.__game;
  const inputs = [blank(), blank(), blank(), blank()];
  for (let i = 0; i < n; i++) g.update(1/30, inputs);
}`;

const h = await launch();
await h.waitForText(/WAVE BATTLE|PRESS START/i);

// desert wave 2 exercises drops, chutes, runners and fliers; trask wave 2 the
// swimmers; station wave 3 puts every landing on a floating platform
for (const [board, wave] of [['desert', 2], ['trask', 2], ['station', 3]]) {
  await h.startCoop(1, board);
  const r = await h.page.evaluate(`(async () => {
    const g = window.__game;
    for (const e of g.enemies) e.removeMe = true;
    (${STEP})(2);
    g.wave = ${wave} - 1;
    g.nextWave();
    const staged = g.enemies.length + g.incomingCount;
    const carriers = g.carrierCount;
    // premature-clear probe: with bodies still aboard, an empty field must not
    // read as a cleared wave
    let clearedEarly = false;
    let culled = 0;
    if (g.incomingCount > 0) {
      for (const e of g.enemies) if (e.alive) { e.damage(99999, e.position, 0); culled++; }
      (${STEP})(10);
      clearedEarly = g.state !== 'fighting';
    }
    let sawChute = 0;
    for (let i = 0; i < 70 && (g.incomingCount > 0 || g.enemies.some((e) => e.alive && e.arriving)); i++) {
      (${STEP})(20);
      for (const e of g.enemies) {
        if (!e.alive || !e.arriving) continue;
        e.char.root.traverse((o) => {
          if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.side === 2) sawChute++;
        });
      }
    }
    const alive = g.enemies.filter((e) => e.alive);
    let bad = 0, leftoverChutes = 0;
    for (const e of alive) {
      const air = e.def.style === 'hover' || e.def.style === 'swoop';
      if (!air) {
        const ok = g.board.physics.capsuleFree(e.position.x, e.position.y + 0.05, e.position.z, e.radius * 0.9, e.height * 0.9);
        const gd = g.board.physics.groundHeight(e.position.x, e.position.z, e.position.y + 0.4);
        if (!ok || !isFinite(gd)) bad++;
      }
      e.char.root.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.side === 2) leftoverChutes++;
      });
    }
    return { staged, carriers, clearedEarly, culled, sawChute,
      arrived: alive.length, stillArriving: alive.filter((e) => e.arriving).length,
      incoming: g.incomingCount, bad, leftoverChutes, state: g.state };
  })()`);
  // the probe above culls whoever was already fielded, so what must arrive is
  // everything staged minus exactly those
  check(`${board}: the whole wave arrives`,
    r.arrived === r.staged - r.culled && r.stillArriving === 0 && r.incoming === 0, r);
  check(`${board}: everyone stands somewhere legal`, r.bad === 0, r.bad);
  check(`${board}: no parachute survives its landing`, r.leftoverChutes === 0, r.leftoverChutes);
  if (r.carriers > 0) {
    check(`${board}: an empty field with drops inbound is not a cleared wave`, !r.clearedEarly, r);
  }
}

// ---- landings: where the ground allows it, every other transport sets down ----
await h.startCoop(1, 'desert');
const land = await h.page.evaluate(`(async () => {
  const g = window.__game;
  for (const e of g.enemies) e.removeMe = true;
  (${STEP})(2);
  // squad posts are random per wave; a couple of waves is enough for one to
  // sit by open ground
  let staged = 0;
  for (let w = 0; w < 3 && g.landingPassCount === 0; w++) {
    g.nextWave();
    staged = g.enemies.length + g.incomingCount;
  }
  const landings = g.landingPassCount;
  if (!landings) return { landings };
  for (let i = 0; i < 80 && (g.incomingCount > 0 || g.enemies.some((e) => e.alive && e.arriving)); i++) (${STEP})(20);
  const alive = g.enemies.filter((e) => e.alive);
  let bad = 0;
  for (const e of alive) {
    const air = e.def.style === 'hover' || e.def.style === 'swoop';
    if (air) continue;
    const ok = g.board.physics.capsuleFree(e.position.x, e.position.y + 0.05, e.position.z, e.radius * 0.9, e.height * 0.9);
    const gd = g.board.physics.groundHeight(e.position.x, e.position.z, e.position.y + 0.4);
    if (!ok || !isFinite(gd)) bad++;
  }
  return { landings, staged, arrived: alive.length, bad,
    stillArriving: alive.filter((e) => e.arriving).length, incoming: g.incomingCount };
})()`);
check('a transport sets down where the ground allows', land.landings > 0, land);
if (land.landings > 0) {
  check('...and its squad walks off and takes its posts',
    land.stillArriving === 0 && land.incoming === 0 && land.bad === 0 && land.arrived > 0, land);
}

// ---- Missions: a sealed room's waves come in by transport too ----
// A mission level is a chain of walled rooms with the open sky above them, so
// the same carrier pass serves it. What has to hold is that the room is not
// declared clear while its defenders are still aboard, and that they end up on
// the room's floor rather than wherever the fall took them.
await h.page.evaluate(() => {
  window.__quitToTitle?.();
  window.__startMode('campaign', 1, 'desert', ['din']);
});
// The campaign opens on an intro card and the controller only ticks while the
// match is fighting — probing before that finds a level nobody is playing yet.
//
// Waiting that card out in real time is what made this suite flaky: software
// rendering runs about one frame a second, the intro is 2.2 simulated seconds
// at a 0.05 s per-frame clamp, and so the wait needs ~60 s of wall clock on an
// idle machine and more than the 120 s budget on a loaded one (CI run 179).
// Step it out instead, which is what the rest of this file already does — the
// live loop is paused first so the frames are ours and the count is exact.
await h.page.waitForFunction(() => !!window.__game && window.__state === 'playing', null, { timeout: 60000 });
await h.page.evaluate(`(() => {
  window.__manual = true;
  (${STEP})(120);          // 4 simulated seconds: past the 2.2 s intro
})()`);
await h.page.evaluate(() => { window.__manual = false; });
await sleep(500);
const miss = await h.page.evaluate(`(async () => {
  const g = window.__game;
  const c = g.campaign;
  const rooms = c.level.rooms;
  const i = rooms.findIndex((r) => r.spec.kind === 'assault');
  if (i < 0) return { skipped: true };
  const room = rooms[i];
  // stand the party in the middle of that room and let the seal happen
  c.idx = i;
  c.phase = 'travel';
  for (const p of g.players) {
    p.position.set(room.center.x, room.center.y + 0.2, room.center.z);
    p.velocity.set(0, 0, 0);
    p.hp = p.maxHp;
    p.alive = true;
  }
  for (const e of g.enemies) e.removeMe = true;
  (${STEP})(60);
  const calledWave = c.phase === 'fight';
  // the transport is inbound: nothing on the field, and the room must hold
  const inboundBefore = g.incomingCount;
  const carriers = g.carrierCount;
  (${STEP})(20);
  const clearedEarly = c.idx !== i;

  // fly it in
  let chutes = 0;
  for (let n = 0; n < 120 && (g.incomingCount > 0 || g.enemies.some((e) => e.alive && e.arriving)); n++) {
    (${STEP})(10);
    for (const e of g.enemies) {
      if (!e.alive || !e.arriving) continue;
      e.char.root.traverse((o) => {
        if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.side === 2) chutes++;
      });
    }
  }
  // The loop above stops the moment nobody is flagged as arriving, which is
  // the moment the transport lets go — not the moment the last man is standing
  // on the floor. Read there, a body still a few metres into its drop counts
  // as one that landed somewhere it should not have: offFloor came back 1-of-6
  // about one run in four, on a squad that was about to land perfectly well.
  //
  // So let the fall finish — and only the fall. Stepping a flat couple of
  // seconds instead would work too, and would also hand the room's firefight
  // two seconds it did not have: the squad this check is about was down to one
  // or two men by the time anyone measured them, which passes and means
  // nothing. This stops the moment the last of them is down.
  const down = () => g.enemies.filter((e) => e.alive)
    .every((e) => Math.abs(e.position.y - c.level.floorY) <= 2);
  for (let n = 0; n < 60 && !down(); n++) (${STEP})(2);
  const alive = g.enemies.filter((e) => e.alive);
  const r = room.rect;
  let outside = 0, offFloor = 0;
  for (const e of alive) {
    // two metres of slack: the wall itself is a metre thick and a body can
    // settle with its centre just inside it
    if (e.position.x < r.minX - 2 || e.position.x > r.maxX + 2
      || e.position.z < r.minZ - 2 || e.position.z > r.maxZ + 2) outside++;
    if (Math.abs(e.position.y - c.level.floorY) > 2) offFloor++;
  }
  return { calledWave, inboundBefore, carriers, clearedEarly, chutes,
    arrived: alive.length, stillArriving: alive.filter((e) => e.arriving).length,
    incoming: g.incomingCount, outside, offFloor };
})()`);
if (!miss.skipped) {
  check('missions: a sealed room calls its wave by transport',
    miss.calledWave && miss.carriers > 0 && miss.inboundBefore > 0, miss);
  check('missions: the room is not cleared while the squad is still aboard',
    !miss.clearedEarly, miss);
  check('missions: the squad lands on the room floor',
    miss.arrived > 0 && miss.stillArriving === 0 && miss.incoming === 0
    && miss.outside === 0 && miss.offFloor === 0, miss);
  check('missions: no parachutes indoors', miss.chutes === 0, miss.chutes);
}

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\narrivals: all checks passed');
