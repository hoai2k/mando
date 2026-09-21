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

// ---- Missions: a sealed room is held, and its hatches supply the rest ----
//
// This section used to read "a sealed room's waves come in by transport too",
// and that stopped being true when Missions changed what a wave *is*. Ground
// is now held by whoever is standing on it: an assault zone's force is posted
// across it at stage raise, and entering counts that standing force as the
// first wave, so nothing has to be flown in to start a fight. Outdoors that is
// the whole of it — `waveCount` is 1 under the sky and no carrier ever comes.
// A roofed hall keeps its reinforcements, because a hatch opening in a room
// you are locked into is the room doing what it was built for: later waves are
// posted in the closets behind the wall hatches and the doors open.
//
// So this asks the sealed room's version of the same three questions the
// transport version asked. Is the ground held before you get there; is the
// room refused a clear while it still owes a wave; and does that wave end up
// on the room's floor rather than wherever it was put.
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
  // Missions has two level builders behind one controller interface. The
  // outdoor stage chain (the default since the stage chain landed) raises one
  // **stage** of the run at a time and calls its fight areas zones; the walled
  // room chain still reachable at \`?missions=old\` calls them rooms. Either
  // way what this is after is an assault area — the kind that seals and calls
  // its wave — and both spell that \`spec.kind === 'assault'\`.
  //
  // Only one stage of the run stands at a time, and the trailhead is a walk
  // in rather than a fight: the desert's first stage is start/trek/camp, so
  // looking only at what happens to be up found no assault area and skipped
  // this whole section without saying so. Walk the chain to the first stage
  // that has one — \`enterStage\` is the transport door's own path, and lowers
  // the stage it leaves before raising the next.
  //
  // A **hall** assault, specifically. The shell is what decides how a wave
  // arrives now, and only a roofed one has hatches to send anything through;
  // an outdoor assault posts its whole fight and calls nothing, which is the
  // design and not a thing this section can measure. Taking the first assault
  // of any shell is what put this on the Dune Sea's canyon and failed the
  // nightly with "called the wave, nobody came" — quite right, nobody was
  // coming.
  const areas = () => (c.stage ? c.stage.zones : c.level.rooms);
  const sealedRoom = (r) => r.spec.kind === 'assault' && r.spec.shell === 'hall';
  const findRoom = () => areas().findIndex(sealedRoom);
  let i = findRoom();
  const kinds = [areas().map((r) => r.spec.shell + ':' + r.spec.kind).join(' ')];
  for (let s = 1; i < 0 && c.stage && s < c.memory.length; s++) {
    c.enterStage(s, false);
    (${STEP})(30);
    i = findRoom();
    kinds.push(areas().map((r) => r.spec.shell + ':' + r.spec.kind).join(' '));
  }
  if (i < 0) return { skipped: true, kinds };
  const rooms = areas();
  const room = rooms[i];
  // Where the floor is under a body. A walled room has one floor height for
  // the whole level; an outdoor stage may stand on the territory's own
  // terrain, where \"the floor\" is not one number — so ask the stage, which
  // is the question \`floorY\` was standing in for all along.
  const floorAt = c.stage
    ? (x, z) => c.stage.groundAt(x, z)
    : () => c.level.floorY;
  const inRoom = (e) => e.position.x >= room.rect.minX - 2 && e.position.x <= room.rect.maxX + 2
    && e.position.z >= room.rect.minZ - 2 && e.position.z <= room.rect.maxZ + 2;

  // ---- 1. the ground is held before you reach it ----
  // Read before the party is anywhere near: this force is posted at stage
  // raise, not summoned by arriving. That is the whole of the change this
  // section was rewritten for, so it is worth an assertion of its own rather
  // than being assumed by the ones below.
  const heldBefore = (c.garrison.get(room) ?? []).filter((e) => e.alive).length;
  const hatches = room.hatches.length;
  const shutBefore = room.hatches.filter((x) => x.gate.closed).length;

  // stand the party in the middle of that room and let the seal happen
  c.idx = i;
  c.phase = 'travel';
  for (const p of g.players) {
    p.position.set(room.center.x, room.center.y + 0.2, room.center.z);
    p.velocity.set(0, 0, 0);
    p.hp = p.maxHp;
    p.alive = true;
  }
  (${STEP})(60);
  const calledWave = c.phase === 'fight';
  // ---- 2. ...and that standing force is the first wave ----
  // Nothing is in the sky over a room: no carrier, nobody mid-arrival. The
  // fight starts because the men holding it are already in it.
  const firstWave = g.enemies.filter((e) => e.alive && inRoom(e)).length;
  const flownIn = g.carrierCount;
  const inboundBefore = g.incomingCount;

  // ---- 3. cut the standing force down and the hatches supply the rest ----
  // The zone owes another wave (\`waveCount\` is the hall's \`waves\`, 2 by
  // default) and may not call itself clear until it has sent it.
  //
  // Killed, not deleted. \`removeMe\` takes a body out of \`game.enemies\` and
  // leaves \`alive\` where it was, and the next wave is owed on
  // \`zoneForce.every(e => !e.alive)\` — which stayed false forever against a
  // force that had been spirited away rather than beaten. Shooting them is
  // also the only way a room is cleared in play.
  const lead = g.players.find((p) => p.alive) ?? g.players[0];
  for (const e of g.enemies) if (e.alive) e.damage(9999, lead.position, 0);
  (${STEP})(20);
  const clearedEarly = c.idx !== i;
  let chutes = 0;
  for (let n = 0; n < 120 && !g.enemies.some((e) => e.alive); n++) (${STEP})(10);
  for (const e of g.enemies) {
    if (!e.alive) continue;
    e.char.root.traverse((o) => {
      if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.side === 2) chutes++;
    });
  }
  // The doors are asked to open on the frame the wave is posted and take about
  // three quarters of a second to travel, so \`closed\` is still true the
  // instant the men appear. Waited for rather than timed.
  for (let n = 0; n < 90 && room.hatches.some((x) => x.gate.closed); n++) (${STEP})(2);
  const openedHatches = room.hatches.filter((x) => !x.gate.closed).length;
  // A hatch wave is put on the floor rather than dropped onto it, so there is
  // no fall to wait out — but wait for one anyway, and only for as long as it
  // takes. Stepping a flat couple of seconds instead would work and would also
  // hand the room's firefight two seconds it did not have: the squad this
  // check is about was down to one or two men by the time anyone measured
  // them, which passes and means nothing. This stops the moment they are down,
  // which for a hatch wave is the first look.
  const down = () => g.enemies.filter((e) => e.alive)
    .every((e) => Math.abs(e.position.y - floorAt(e.position.x, e.position.z)) <= 2);
  for (let n = 0; n < 60 && !down(); n++) (${STEP})(2);
  const alive = g.enemies.filter((e) => e.alive);
  const r = room.rect;
  // A hatch is a door in a side wall with a *closet* behind it, and the post a
  // body is put on is that closet — 3.2 m beyond the room's own wall by
  // construction. So a man who has just come through one is briefly outside
  // the rect and entirely where he should be. Legal is: in the room, or still
  // stepping out of the hatch he was posted in.
  const atAHatch = (e) => room.hatches.some((x) =>
    Math.hypot(e.position.x - x.post.x, e.position.z - x.post.z) < 5);
  let outside = 0, offFloor = 0;
  for (const e of alive) {
    // two metres of slack: the wall itself is a metre thick and a body can
    // settle with its centre just inside it
    if ((e.position.x < r.minX - 2 || e.position.x > r.maxX + 2
      || e.position.z < r.minZ - 2 || e.position.z > r.maxZ + 2) && !atAHatch(e)) outside++;
    if (Math.abs(e.position.y - floorAt(e.position.x, e.position.z)) > 2) offFloor++;
  }
  // Where the strays actually are, not just how many: a body four metres up
  // on the wall at the zone's edge and one forty-three metres up on the rim
  // are the same count and different bugs, and the count alone sent the first
  // reading of this after the wrong one.
  const strays = alive
    .filter((e) => Math.abs(e.position.y - floorAt(e.position.x, e.position.z)) > 2
      || ((e.position.x < r.minX - 2 || e.position.x > r.maxX + 2
        || e.position.z < r.minZ - 2 || e.position.z > r.maxZ + 2) && !atAHatch(e)))
    .map((e) => e.kind + ' at ' + e.position.x.toFixed(1) + ',' + e.position.z.toFixed(1)
      + ' ' + (e.position.y - floorAt(e.position.x, e.position.z)).toFixed(1) + ' m up');
  return { strays, calledWave, heldBefore, hatches, shutBefore, firstWave,
    flownIn, inboundBefore, clearedEarly, chutes, openedHatches,
    arrived: alive.length, stillArriving: alive.filter((e) => e.arriving).length,
    incoming: g.incomingCount, outside, offFloor };
})()`);
// Not a silent skip. This section stopped running at all when the level
// builder changed under it, and a section that quietly runs no checks looks
// exactly like a section that passed.
check('missions: the run has a sealed room to fight in', !miss.skipped,
  miss.skipped ? `no assault zone in ${miss.kinds.join(' | ')}` : 'found');
if (!miss.skipped) {
  check('missions: the room is held before the party reaches it',
    miss.heldBefore > 0 && miss.hatches > 0 && miss.shutBefore === miss.hatches,
    { heldBefore: miss.heldBefore, hatches: miss.hatches, shut: miss.shutBefore });
  check('missions: entering seals it, and the men standing in it are the wave',
    miss.calledWave && miss.firstWave > 0 && miss.flownIn === 0 && miss.inboundBefore === 0,
    { calledWave: miss.calledWave, firstWave: miss.firstWave,
      carriers: miss.flownIn, inbound: miss.inboundBefore });
  check('missions: the room is not cleared while it still owes a wave',
    !miss.clearedEarly, miss);
  check('missions: and the hatches supply that wave',
    miss.arrived > 0 && miss.openedHatches > 0,
    { arrived: miss.arrived, opened: miss.openedHatches, of: miss.hatches });
  check('missions: the squad lands on the room floor',
    miss.arrived > 0 && miss.stillArriving === 0 && miss.incoming === 0
    && miss.outside === 0 && miss.offFloor === 0, miss);
  check('missions: no parachutes indoors', miss.chutes === 0, miss.chutes);
}

// ---- Missions: the one outdoor fight that *is* a wave battle ----
//
// The rule above is the run's rule: open ground is held by whoever is standing
// on it and nothing is flown in. A run still wants one of the other thing —
// late, on a big piece of open ground, ships crossing the ceiling and putting
// squads down — so `ZoneSpec.siege` marks the zones that get it.
//
// Both halves are checked, because each is only worth having if the other
// holds. A siege that gets no ships is the feature not working; ordinary open
// ground that *does* get them is the wave game creeping back in, which is the
// thing the posted-garrison design was built to stop.
// Nevarro, because that is where one of the two is: the Lava Flats' crossing,
// the big open assault of its last stage. The Dune Sea the section above runs
// on has none, and should not.
await h.page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('campaign', 1, 'nevarro', ['din']);
});
await h.page.waitForFunction(() => !!window.__game && window.__state === 'playing', null, { timeout: 60000 });
await h.page.evaluate(`(() => {
  window.__manual = true;
  (${STEP})(120);          // past the intro card, as above
})()`);
const siege = await h.page.evaluate(`(async () => {
  const g = window.__game, c = g.campaign;
  const blank = () => ({ moveX:0,moveY:0,lookX:0,lookY:0,jumpHeld:false,jumpPressed:false,
    dashPressed:false,sprintHeld:false,shootHeld:false,aimHeld:false,meleePressed:false,
    rocketPressed:false,slamPressed:false,zoomHeld:false,zoomDelta:0,blockHeld:false,
    pausePressed:false,meleeSwapPressed:false,rangedSwapPressed:false });
  const inputs = [blank(),blank(),blank(),blank()];
  const step = (n) => { for (let i = 0; i < n; i++) g.update(1/30, inputs); };

  const hold = (zone, idx) => {
    c.idx = idx; c.phase = 'travel';
    for (const p of g.players) {
      p.position.set(zone.center.x, zone.center.y + 0.2, zone.center.z);
      p.velocity.set(0,0,0); p.maxHp = 1e6; p.hp = 1e6; p.alive = true;
    }
    step(60);
  };
  // Shoot whatever is standing and report what brings the next lot, if
  // anything does. Waited for, not timed: a carrier flies a real pass.
  const nextWave = (idx) => {
    const lead = g.players.find((p) => p.alive) ?? g.players[0];
    for (const e of g.enemies) if (e.alive) e.damage(9999, lead.position, 0);
    let carriers = 0, incoming = 0;
    for (let n = 0; n < 200 && !g.enemies.some((e) => e.alive) && c.idx === idx; n++) {
      step(10);
      carriers = Math.max(carriers, g.carrierCount);
      incoming = Math.max(incoming, g.incomingCount);
    }
    return { arrived: g.enemies.filter((e) => e.alive).length, carriers, incoming,
      cleared: c.idx !== idx };
  };
  const find = (pick) => {
    for (let s = 0; s < c.memory.length; s++) {
      if (s) { c.enterStage(s, false); step(30); }
      const i = c.stage.zones.findIndex(pick);
      if (i >= 0) return i;
    }
    return -1;
  };

  // First, ordinary open ground — on this board it comes before the siege in
  // walk order, so the same forward walk finds both. Its whole fight is
  // posted: shoot it and the zone is done, with nothing called and no ship.
  const oi = find((z) => z.spec.kind === 'assault' && !z.spec.siege
    && ['open', 'canyon', 'road'].includes(z.spec.shell));
  let ordinary = null;
  if (oi >= 0) {
    const oz = c.stage.zones[oi];
    hold(oz, oi);
    const held = c.waveCount;
    const after = nextWave(oi);
    ordinary = { label: oz.spec.label, shell: oz.spec.shell, waveCount: held,
      waves: oz.spec.waves ?? 2, ...after };
  }

  // the siege zone: a holding force, and the rest arrives by air
  const si = find((z) => z.spec.siege);
  if (si < 0) return { err: 'no siege zone on this board' };
  const zone = c.stage.zones[si];
  const posted = (c.garrison.get(zone) ?? []).filter((e) => e.alive).length;
  hold(zone, si);
  const waveCount = c.waveCount;
  const supplied = nextWave(si);
  return { label: zone.spec.label, shell: zone.spec.shell, waves: zone.spec.waves,
    posted, waveCount, supplied, ordinary };
})()`);
check('missions: the run\'s one wave battle holds with what is posted',
  !siege.err && siege.posted > 0 && siege.waveCount === siege.waves,
  { label: siege.label, shell: siege.shell, posted: siege.posted,
    waveCount: siege.waveCount, of: siege.waves, err: siege.err });
check('missions: ordinary open ground is held, never supplied',
  !siege.err && siege.ordinary && siege.ordinary.waveCount === 1
  && siege.ordinary.carriers === 0 && siege.ordinary.arrived === 0
  && siege.ordinary.cleared, siege.ordinary);
check('missions: ...and the rest of it comes in by ship',
  !siege.err && siege.supplied && siege.supplied.carriers > 0
  && siege.supplied.arrived > 0 && !siege.supplied.cleared, siege.supplied);

// ---- ...and it stays rare ----
// A wave battle is a beat, not the run. Counted across every territory rather
// than trusted to stay rare on its own: the check that keeps this from
// becoming the thing it was introduced as an exception to.
const zones = await h.page.evaluate(() => window.__missionZones());
const sieges = zones.filter((z) => z.siege);
const outdoor = zones.filter((z) => ['open', 'canyon', 'road'].includes(z.shell));
check('missions: a wave battle is rare, and outdoors',
  sieges.length > 0 && sieges.length <= 3 && sieges.every((z) => z.shell === 'open'),
  { sieges: sieges.map((z) => `${z.board} ${z.label}`), ofOutdoor: outdoor.length });

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\narrivals: all checks passed');
