/**
 * Regression test for the outdoor Missions levels (docs/MISSIONS_OUTDOOR.md).
 *
 * `test-modes.mjs` covers the mode itself — three-way title, per-player
 * cameras, sealed fights, bosses, liberation. This is about the level design
 * that replaced the room chain: the shells and their borders, the flight
 * ceiling and the sky it cuts in two, the stages and their transport doors,
 * the guidance, and the rides. That design is what Missions runs, so every
 * check here is on the plain page; the last section checks that
 * `?missions=old` still runs the walled room chain.
 *
 * The headless GPU renders this game at a crawl, so the checks drive the
 * *simulation* directly: `__manual` pauses the live loop and `game.update` is
 * stepped with blank inputs, which covers minutes of match in seconds.
 *
 * Run:  node tools/test-missions.mjs
 */
import { launch, blankInput } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/` });
const { page } = h;

const STEP = `(args) => {
  const [n, over] = args;
  const g = window.__game;
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const inputs = [0,1,2,3].map(() => ({ ...blank(), ...(over ?? {}) }));
  for (let i = 0; i < n; i++) g.update(1/30, inputs);
}`;

const step = (n, over = null) => page.evaluate(STEP, [n, over]);

/**
 * The outdoor stages are what Missions raises with no flag at all (as of
 * 2026-09-06), so the plain page is the one every check in this file wants;
 * `?missions=old` is the room chain, and the last section is what holds that.
 * Pass `reload` where a check wants a fresh page on the query it is already on
 * (the per-board audit builds nine levels and does not want the last one's
 * geometry still standing).
 */
const OUTDOOR = '';
/** the query the page currently stands on, so only a change costs a reload */
let onQuery = null;
const startMode = async (mode, players, board, chars, query = OUTDOOR, reload = false) => {
  if (reload || query !== onQuery) {
    await page.goto(`http://localhost:${PORT}/${query}`);
    await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
    onQuery = query;
  }
  await page.evaluate(([m, n, b, c]) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode(m, n, b, c);
  }, [mode, players, board, chars]);
  await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => { window.__manual = true; });
};

// ---------------------------------------------------------------- the build

await startMode('campaign', 2, 'desert', ['din', 'armorer']);

const built = await page.evaluate(() => {
  const c = window.__game.campaign;
  const s = c.stage;
  return {
    outdoor: !!c.stage && Array.isArray(c.stage.zones),
    zones: s.zones.map((z) => `${z.spec.shell}:${z.spec.kind}`).join(','),
    labels: s.zones.map((z) => z.spec.label),
    floorY: s.floorY,
    ceilingY: s.ceilingY,
    hasExitPortal: !!s.exitPortal,
    hasBackPortal: !!s.backPortal,
    rides: s.rides.length,
    path: s.path.length,
    onFloor: window.__game.players.every((p) => Math.abs(p.position.y - s.floorY) < 4),
  };
});
check('the run opens on a built outdoor stage', built.outdoor, JSON.stringify(built.outdoor));
check('the first stage begins outdoors, not in a box',
  built.zones.startsWith('open:start'), built.zones);
check('every beat of the stage is named',
  built.labels.every((l) => !!l && !/^beat /.test(l)), built.labels.join(' / '));
check('the party stands on the stage floor', built.onFloor, String(built.floorY));
check('the stage has a way on to the next one', built.hasExitPortal && !built.hasBackPortal,
  JSON.stringify({ on: built.hasExitPortal, back: built.hasBackPortal }));
check('the golden path is laid out for the guidance', built.path >= 4, String(built.path));
check('rides are parked on the stage', built.rides > 0, String(built.rides));

// ---- the borders clear the ceiling, and there is a rim at all ----
const rim = await page.evaluate(() => {
  const g = window.__game;
  const s = g.campaign.stage;
  // the rim's collision is one slab per run, taller than the ceiling; the
  // rock pieces you see are merged mesh with no colliders of their own
  // A rim slab is as tall as the ceiling plus its clearance, which is what
  // tells it apart from a hall's walls and roof (8 m) in the same list.
  const walls = g.board.physics.boxes.filter((b) => b.max.y - b.min.y > (s.ceilingY - s.floorY) * 0.8);
  const over = walls.filter((b) => b.max.y >= s.ceilingY);
  let bigMeshes = 0;
  let rockVerts = 0;
  g.board.group.traverse((o) => {
    const n = o.geometry?.attributes?.position?.count ?? 0;
    if (n > 5000) { bigMeshes++; rockVerts += n; }
  });
  // ...and the trailhead is the one outdoor zone that gets none of them: a
  // rim has to clear the ceiling whatever it rings, and a 45 m wall 1.5 m
  // outside a 56 x 44 m opening zone is a box canyon, not the Dune Sea.
  // A rim run is a slab laid along one edge of the zone it rings, so its
  // centre sits on that edge; a link's or the next zone's rim has its centre
  // well outside. Counting centres inside the rect (with the 1.5 m the rim
  // stands off it, and a little slack) is what tells the two apart.
  const z0 = s.zones[0].rect;
  const mid = (a, b) => (a + b) / 2;
  const boxedIn = walls.filter((b) => {
    const cx = mid(b.min.x, b.max.x), cz = mid(b.min.z, b.max.z);
    return cx > z0.minX - 3 && cx < z0.maxX + 3 && cz > z0.minZ - 3 && cz < z0.maxZ + 3;
  }).length;
  return {
    walls: walls.length, over: over.length, bigMeshes, rockVerts, boxedIn,
    ceiling: s.ceilingY - s.floorY,
  };
});
check('the borders hold the level in', rim.walls >= 5, `${rim.walls} wall runs`);
check('...but not the trailhead, which the territory holds', rim.boxedIn === 0,
  `${rim.boxedIn} wall runs around the opening zone`);
check('and every one of them clears the flight ceiling',
  rim.walls > 0 && rim.over === rim.walls, `${rim.over}/${rim.walls} over ${rim.ceiling} m`);
check('the rock they are made of is merged, not a mesh per boulder',
  rim.bigMeshes > 0 && rim.rockVerts / rim.bigMeshes > 5000,
  `${rim.bigMeshes} meshes carrying ${rim.rockVerts} verts`);

// ---------------------------------------------------------------- the ceiling

const ceiling = await page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  const s = g.campaign.stage;
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  // one full burn from the floor: the ceiling is meant to sit clear above it
  p.position.copy(s.zones[0].center);
  p.velocity.set(0, 0, 0);
  p.fuel = 1;
  let burn = p.position.y;
  const hold = [{ ...blank(), jumpHeld: true, jumpPressed: true }, blank(), blank(), blank()];
  for (let i = 0; i < 150; i++) {
    g.update(1 / 30, hold);
    burn = Math.max(burn, p.position.y);
  }
  const oneBurn = burn;
  // then keep the button down long past the tank: nothing gets over the lid
  let peak = burn;
  for (let i = 0; i < 900; i++) {
    p.fuel = 1;    // an infinite tank is the honest test of a hard ceiling
    g.update(1 / 30, hold);
    peak = Math.max(peak, p.position.y + p.height);
  }
  return { oneBurn: oneBurn - s.floorY, peak: peak - s.floorY, ceiling: s.ceilingY - s.floorY };
});
check('a full jetpack burn does not reach the ceiling',
  ceiling.oneBurn < ceiling.ceiling - 3, `${ceiling.oneBurn.toFixed(1)} m of ${ceiling.ceiling}`);
check('and no amount of thrust gets over it',
  ceiling.peak <= ceiling.ceiling + 0.1, `${ceiling.peak.toFixed(2)} m of ${ceiling.ceiling}`);

const flier = await page.evaluate(async () => {
  const g = window.__game;
  const s = g.campaign.stage;
  const c = g.campaign;
  // a flier let go in the ambient band has to come down before it fights
  const spot = c.placeNear(s.zones[0].center.clone(), 'nikto');
  const e = g.addReinforcement('nikto', spot, 7777);
  e.position.y = s.ceilingY + 14;
  e.alert(g.players[0].position, true);
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const idle = [blank(), blank(), blank(), blank()];
  // count the shots it actually takes, and where it was standing to take them
  let firedHigh = 0;
  let firedLow = 0;
  // Attribute the bolt to whoever it came out of, and judge its height by its
  // own muzzle. This used to count *every* bolt in the level as the flier's
  // and classify it by where the flier happened to be standing — which was
  // sound only while the flier was the one thing shooting. It is not any more:
  // a stage now stands its fights up posted rather than dropping them in, so
  // there are bolts in the air from the first frame, and all of them were
  // being read as this one nikto firing out of the sky.
  const realFire = g.projectiles.fire.bind(g.projectiles);
  g.projectiles.fire = (origin, ...rest) => {
    const mine = e.alive
      && Math.hypot(origin.x - e.position.x, origin.z - e.position.z) < 2.5
      && Math.abs(origin.y - (e.position.y + e.height * 0.6)) < 2.5;
    if (mine) {
      if (origin.y > s.ceilingY + 0.5) firedHigh++; else firedLow++;
    }
    return realFire(origin, ...rest);
  };
  let settled = -1;
  for (let i = 0; i < 400; i++) {
    g.update(1 / 30, idle);
    if (settled < 0 && e.position.y + e.height <= s.ceilingY) settled = i;
  }
  g.projectiles.fire = realFire;
  return { firedHigh, firedLow, settled, y: e.position.y - s.floorY, ceiling: s.ceilingY - s.floorY };
});
check('a flier entering over the rim comes down into the fight',
  flier.settled >= 0 && flier.y <= flier.ceiling + 0.5,
  `settled after ${flier.settled} frames at ${flier.y.toFixed(1)} m`);
check('and never fires from the ambient sky',
  flier.firedHigh === 0, `${flier.firedHigh} high, ${flier.firedLow} once it was down`);

// ---------------------------------------------------------------- the walk

const walk = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.campaign;
  const out = { stagesSeen: new Set(), sealed: false, hatched: false, done: false, offPath: 0, turns: 0 };
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });

  // Walk the level's own golden path rather than steering at the objective.
  // The crow's line into a bend is a cliff, and the path is the route the
  // level was authored around — zone entries and exits with the legs of every
  // link between them, in order. The cursor only ever advances by *arriving*:
  // snapping it forward to the next zone's entry would skip the bend the
  // party still has to walk through, and walk them into the rock.
  let cursor = 0;
  let stuck = 0;
  let lastStage = c.stageIdx;
  for (let turn = 0; turn < 1200 && !c.done; turn++) {
    out.turns = turn;
    out.stagesSeen.add(c.stageIdx);
    const stage = c.stage;
    if (c.stageIdx !== lastStage) { lastStage = c.stageIdx; cursor = 0; stuck = 0; }
    const zone = stage.zones[Math.min(c.idx, stage.zones.length - 1)];
    const atPortal = c.idx >= stage.zones.length && stage.exitPortal;
    const fighting = c.phase === 'fight'
      && (zone.spec.kind === 'assault' || zone.spec.kind === 'lieutenant' || zone.spec.kind === 'warlord');
    let goal;
    if (atPortal) goal = stage.exitPortal.threshold;
    else if (fighting) goal = c.objectivePos;
    else goal = stage.path[Math.min(cursor, stage.path.length - 1)];

    for (let f = 0; f < 30; f++) {
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot];
        const i = blank();
        if (!p || !p.alive) return i;
        const dx = goal.x - p.position.x, dz = goal.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        // The camera is behind the body, so its yaw is the heading and the
        // stick's forward axis walks along it. Forward is +1 (`FrameInput`
        // says so: "-1..1 (forward+)"); -1 walks the party backwards away
        // from everything they are being steered at.
        p.cam.yaw = Math.atan2(dx, dz);
        i.moveY = 1;
        i.shootHeld = true;
        i.sprintHeld = d > 14;
        return i;
      });
      g.update(1 / 30, inputs);
      for (const zz of stage.zones) {
        if (zz.exitBarrier?.closed) out.sealed = true;
        if (zz.hatches.some((ht) => ht.gate.open_)) out.hatched = true;
      }
    }
    // Clear whatever the zone sent, the way `test-modes` does. This walk is
    // about the *level* — that the way on opens, that a wave arrives and from
    // where, that a stage hands over to the next one, that the run can be
    // finished. Whether a party steering in a straight line and holding the
    // trigger can also out-fight the board's own garrison is a different
    // question, and answering it here would only ever tell us the AI won.
    for (const e of g.enemies) if (e.alive) e.damage(9999999, e.position, 0);
    // Advance once the party is standing on this point — or, if a point can
    // not be reached at all, after long enough that the walker is clearly
    // wedged rather than slow. A walker that cannot get past a point is worth
    // knowing about, but it should not cost the rest of the run.
    const lead = g.players.find((p) => p.alive);
    if (lead && !atPortal && !fighting) {
      const at = stage.path[Math.min(cursor, stage.path.length - 1)];
      if (Math.hypot(at.x - lead.position.x, at.z - lead.position.z) < 7) {
        cursor++;
        stuck = 0;
      } else if (++stuck > 20) {
        out.wedged = (out.wedged ?? 0) + 1;
        cursor++;
        stuck = 0;
      }
    }
    for (const p of g.players) {
      if (p.alive && p.position.y < c.stage.floorY - 9) out.offPath++;
    }
  }
  out.done = c.done;
  out.stagesSeen = [...out.stagesSeen];
  out.state = g.state;
  return out;
});
check('the run walks through every stage of the territory',
  walk.stagesSeen.length === 3, JSON.stringify(walk.stagesSeen));
check('outdoor fights hold the party with a sealed way on', walk.sealed, JSON.stringify(walk));
check('a roofed hall lets its waves out of the wall hatches', walk.hatched, JSON.stringify(walk));
check('and the territory is liberated', walk.done && walk.state === 'victory',
  JSON.stringify({ done: walk.done, state: walk.state }));

// ---------------------------------------------------------------- transport doors

await startMode('campaign', 2, 'desert', ['din', 'armorer']);
const portal = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.campaign;
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const idle = [blank(), blank(), blank(), blank()];
  const out = {};
  // Walk the run to the end of stage 0 without playing it, then give the
  // level time to answer: the match's own intro has to finish, and a blast
  // door's leaves take three quarters of a second to travel, so a door asked
  // to open one frame ago is still shut and rightly so.
  c.idx = c.stage.zones.length;
  c.phase = 'travel';
  for (const e of g.enemies) e.removeMe = true;
  for (let i = 0; i < 120; i++) g.update(1 / 30, idle);
  const portal = c.stage.exitPortal;
  out.portalOpens = portal.open_;
  const oldBodies = new Set(g.enemies);
  // one player steps into the pocket: the whole party goes
  const before = c.stageIdx;
  const p = g.players[0];
  for (let i = 0; i < 240 && c.stageIdx === before; i++) {
    if (i % 30 === 0) p.position.copy(portal.threshold);
    g.update(1 / 30, idle);
  }
  out.forwardTook = c.stageIdx === before + 1;
  out.bothMoved = g.players.every((q) => Math.abs(q.position.y - c.stage.floorY) < 6);
  // Only bodies from the *old* map count: the new stage stands its own
  // garrison up as it is raised, and those are supposed to be there.
  out.enemiesCarried = g.enemies.filter((e) => e.alive && oldBodies.has(e)).length;
  out.hasBack = !!c.stage.backPortal;

  // the way back: one in the pocket is a wait, not a transit
  const back = c.stage.backPortal;
  if (!back) return { ...out, noBackPortal: true };
  const stageNow = c.stageIdx;
  for (let i = 0; i < 60; i++) {
    if (i % 20 === 0) g.players[0].position.copy(back.threshold);
    g.update(1 / 30, idle);
  }
  out.oneWaits = c.stageIdx === stageNow && c.exited.size === 1;
  out.noticeShown = !!g.exitNotice(g.players[1]);
  // cancelling walks them back out
  const cancel = [{ ...blank(), blockHeld: true }, blank(), blank(), blank()];
  for (let i = 0; i < 20; i++) g.update(1 / 30, cancel);
  out.cancelled = c.exited.size === 0;
  // everyone aboard, and it goes
  for (let i = 0; i < 240 && c.stageIdx === stageNow; i++) {
    if (i % 30 === 0) for (const q of g.players) q.position.copy(back.threshold);
    g.update(1 / 30, idle);
  }
  out.backTook = c.stageIdx === stageNow - 1;
  out.rememberedCleared = c.idx > 0;
  return out;
});
check('the way on to a stage opens once its zones are cleared', portal.portalOpens, JSON.stringify(portal));
check('one player boarding takes the whole party forward',
  portal.forwardTook && portal.bothMoved, JSON.stringify(portal));
check('nothing from the old map comes with them', portal.enemiesCarried === 0, String(portal.enemiesCarried));
check('one player in the way back is a wait, and the others are told',
  !portal.noBackPortal && portal.oneWaits && portal.noticeShown, JSON.stringify(portal));
check('and they can cancel back out of it', portal.cancelled, JSON.stringify(portal));
check('everyone aboard takes the party back', portal.backTook, JSON.stringify(portal));
check('to the stage as they left it, cleared', portal.rememberedCleared, JSON.stringify(portal));

// ------------------------------------------------------- the guidance, and death

// A sixty-metre column of light is a promise: walk into this and something
// happens. Playtest found it standing on the party's own spawn and, later,
// burning over an already-open door in the middle of the canyon — walked into,
// nothing happened, and the only lesson was that the lights lie. So the rule
// is that the column is lit only where it is telling you something, and goes
// out the moment you are on it.
await startMode('campaign', 1, 'desert', ['din'], OUTDOOR, true);
const guide = await page.evaluate(`(() => {
  const g = window.__game, c = g.campaign;
  window.__simUntil(() => g.state === 'fighting', 30);
  const spawn = { lit: c.beacon.visible, glyphs: c.glyphs.filter((gl) => gl.mesh.visible).length };
  for (const e of g.enemies) e.removeMe = true;
  const put = (x, z, y) => g.players[0].position.set(x, g.board.physics.groundHeight(x, z, y + 8) + 1, z);
  // past the trailhead, with a zone still to clear
  c.idx = 1; c.phase = 'fight';
  g.players[0].maxHp = 1e6; g.players[0].hp = 1e6;
  let o = c.objectivePos;
  put(o.x - 40, o.z, o.y);
  window.__sim(0.1);
  const far = { lit: c.beacon.visible, d: +g.players[0].position.distanceTo(c.objectivePos).toFixed(1) };
  // every zone cleared, the way on open: the column stands on the door
  c.idx = c.stage.zones.length; c.phase = 'travel';
  o = c.objectivePos.clone();
  put(o.x - 30, o.z, o.y);
  window.__sim(0.1);
  const door = { lit: c.beacon.visible, d: +g.players[0].position.distanceTo(c.objectivePos).toFixed(1) };
  put(o.x, o.z, o.y);
  window.__sim(0.1);
  // which way the chevron's tip points on the floor: its local +y, tilted flat
  // (rotation.x = -90°) and then yawed about the world's up (order YXZ)
  const tip = { x: -Math.sin(c.arrow.rotation.y), z: -Math.cos(c.arrow.rotation.y) };
  const fwd = c.stage.exitPortal ? c.stage.exitPortal.forward : { x: 0, z: 0 };
  const on = { lit: c.beacon.visible, d: +g.players[0].position.distanceTo(c.objectivePos).toFixed(1),
    arrow: c.arrow.visible, arrowAt: +Math.hypot(c.arrow.position.x - o.x, c.arrow.position.z - o.z).toFixed(1),
    order: c.arrow.rotation.order, along: +(tip.x * fwd.x + tip.z * fwd.z).toFixed(2) };
  c.done = true;
  window.__sim(0.1);
  const over = { lit: c.beacon.visible, glyphs: c.glyphs.filter((gl) => gl.mesh.visible).length };
  c.done = false;
  return { spawn, far, door, on, over };
})()`);
check('nothing is lit over the ground the party spawns on',
  !guide.spawn.lit && guide.spawn.glyphs === 0, JSON.stringify(guide.spawn));
check('the beacon lights once there is somewhere to be sent',
  guide.far.lit && guide.far.d > 20, JSON.stringify(guide.far));
check('and it stands on the way on once the zones are cleared',
  guide.door.lit && guide.door.d > 20, JSON.stringify(guide.door));
check('but goes out when you are standing on it',
  !guide.on.lit && guide.on.d < 4, JSON.stringify(guide.on));
check('and leaves a floor arrow where it stood, pointing on',
  guide.on.arrow && guide.on.arrowAt < 1, JSON.stringify(guide.on));
// The chevron used to be yawed *before* it was laid flat, which mirrored it
// across the x axis: right on an east-west lane and pointing back the way you
// came on any north-south one. The door here faces along the stage's last
// heading, so the tip has to agree with it.
check('and the arrow points the way it says it does',
  guide.on.order === 'YXZ' && guide.on.along > 0.9, JSON.stringify(guide.on));
check('and a finished run leaves nothing burning',
  !guide.over.lit && guide.over.glyphs === 0, JSON.stringify(guide.over));

// A kill zone is the one death in this game that cannot be read: full health
// one frame and the respawn card the next, on a board carrying a sarlacc, a
// lava river and a shock floor. It is a beat now — dragged in, pulled under,
// and dead at the end of it.
const taken = await page.evaluate(`(() => {
  const g = window.__game, p = g.players[0];
  const z = (g.board.hazards || []).find((h) => h.kind === 'kill');
  if (!z) return { none: true };
  const gy = g.board.physics.groundHeight(z.center.x, z.center.z, z.center.y + 6);
  p.position.set(z.center.x + z.radius * 0.6, gy + 1, z.center.z);
  p.maxHp = 100; p.hp = 100;
  const start = p.position.clone();
  let died = -1, aliveAfterAFrame = null;
  for (let i = 0; i < 120 && died < 0; i++) {
    window.__sim(1 / 30);
    if (i === 1) aliveAfterAFrame = p.alive;
    if (!p.alive) died = i;
  }
  return {
    took: died < 0 ? null : +(died / 30).toFixed(2),
    aliveAfterAFrame,
    pulledIn: +(start.distanceTo(z.center) - p.position.distanceTo(z.center)).toFixed(2),
    sank: +(start.y - p.position.y).toFixed(2),
  };
})()`);
check('a kill zone does not blink you out of existence',
  taken.none || (taken.aliveAfterAFrame && taken.took > 0.6), JSON.stringify(taken));
check('it hauls the body into it and pulls it under first',
  taken.none || (taken.pulledIn > 1 && taken.sank > 0.5), JSON.stringify(taken));
check('and it is over inside a second and a half',
  taken.none || (taken.took !== null && taken.took < 1.5), JSON.stringify(taken));

// ------------------------------------------------------------------ the riders

// The corral's rides are the Tuskens'. Alert the camp and some of them get on:
// a Tusken to its bantha, and it comes at the party. Drop the rider and the
// ride rolls to a stop with nobody on it, which is when it is yours.
await startMode('campaign', 1, 'desert', ['din'], OUTDOOR, true);
const riders = await page.evaluate(`(() => {
  const g = window.__game, c = g.campaign, p = g.players[0];
  window.__simUntil(() => g.state === 'fighting', 30);
  p.maxHp = 1e6; p.hp = 1e6;
  const corral = c.stage.zones[1];
  const squad = 9000 + corral.beat;
  const crew = () => g.enemies.filter((e) => e.alive && e.squad === squad);
  const before = {
    posted: crew().length,
    kinds: [...new Set(crew().map((e) => e.kind))].join(','),
    canRide: crew().filter((e) => g.vehicles.some((v) => e.canRide(v.spec.kind))).length,
    rides: g.vehicles.length,
    hostiles: g.vehicles.filter((v) => v.hostile).length,
  };
  // stand the party at the corral's mouth and let the camp see them
  c.idx = 1; c.phase = 'fight';
  p.position.set(corral.entry.x, corral.entry.y + 0.5, corral.entry.z);
  for (const e of crew()) e.alert(p.position, true);
  window.__sim(0.5);
  const claimed = g.vehicles.filter((v) => v.reserved || v.hostile).length;
  const running = crew().filter((e) => e.boarding).length;
  // give them the run to the saddle
  window.__simUntil(() => crew().some((e) => e.ride), 12);
  const mounted = crew().filter((e) => e.ride);
  if (!mounted.length) return { before, claimed, running, mounted: 0 };
  const rider = mounted[0], v = rider.ride;
  const onFoot = crew().filter((e) => !e.ride && !e.boarding).length;
  // A few seconds at the pedals: it moves, and it moves at the party.
  //
  // Stand the party at a known distance off the ride's nose first. Which of
  // the corral's five rides a Tusken reaches first depends on where the camp
  // posted him, so measuring from wherever he happened to start measures the
  // walk, not the charge — and the numbers moved the day the rides were
  // re-parked clear of the tents. Thirty metres dead ahead asks the question
  // the check is about: does the thing come at you.
  const ahead = 30;
  p.position.set(v.pos.x + Math.sin(v.yaw) * ahead, v.pos.y, v.pos.z + Math.cos(v.yaw) * ahead);
  const seat0 = rider.position.clone();
  // Wait for the charge to arrive; do not hand it four seconds and measure
  // where it got to. It covers the thirty metres in a second or two of the
  // fifteen allowed, but which of the corral's five rides the Tusken reaches
  // and what he has to steer round on the way move that by enough that a fixed
  // frame budget was a coin toss on the runs where he set off late — 10.2 m
  // against a limit of 8, on a charge that was going to arrive.
  let top = 0;
  const closed = window.__simUntil(() => {
    top = Math.max(top, Math.hypot(v.vel.x, v.vel.z));   // sampled every frame
    return v.pos.distanceTo(p.position) < 8;
  }, 15);
  const nearest = v.pos.distanceTo(p.position);
  const seated = rider.position.distanceTo(v.seatWorld(new (rider.position.constructor)())) < 0.05;

  // ---- shot out of the saddle, and the hull rolls on without him ----
  //
  // Staged, rather than taken where the charge happened to end. A rider shot
  // off at twenty-four metres a second with the party a metre off the nose is
  // a crash as often as a dismount: the hull grinds into what it was charging,
  // \`crashIntoWall\` writes it off, and a wreck keeps the velocity it died
  // carrying — so "has it rolled to a stop yet" was being asked of a burning
  // hull that was never going to answer, and answered differently run to run.
  //
  // What the check is named for is what the drag does with a hull nobody is
  // steering, and that is not a question about the fight. So: the hull on the
  // corral's own entry, which is on the golden path and clear by construction,
  // pointed down that path, the party eighty metres away, and a known speed in
  // it. \`dropHostile\` reads the speed at the moment the saddle empties, so the
  // speed goes in on the same frame as the kill, with nothing stepped between.
  const dx = corral.exit.x - corral.entry.x, dz = corral.exit.z - corral.entry.z;
  const len = Math.hypot(dx, dz) || 1;
  const DROP_SPEED = 12;
  v.pos.set(corral.entry.x, corral.entry.y + 0.5, corral.entry.z);
  v.yaw = Math.atan2(dx / len, dz / len);
  p.position.set(corral.entry.x + 80, corral.entry.y + 2, corral.entry.z + 80);
  v.vel.set((dx / len) * DROP_SPEED, 0, (dz / len) * DROP_SPEED);
  rider.damage(9999, p.position, 0);
  const dropped = { hostile: v.hostile, alive: rider.alive, rideAlive: v.alive, rideRef: rider.ride };
  // It rolls, and it stops. Waited for rather than timed: the drag is a rate,
  // and how long twelve metres a second takes to bleed off is that rate's
  // business, not a number this file should be holding a stopwatch to.
  const rolled = window.__simUntil(
    () => !v.coasting && Math.hypot(v.vel.x, v.vel.z) < 0.05, 20);
  const speedAfter = Math.hypot(v.vel.x, v.vel.z);
  const carried = corral.entry.distanceTo(v.pos);
  // and it is the party's for the taking: walk up, and the prompt is there
  p.position.set(v.pos.x + v.def.radius + 1.0, v.pos.y + 0.3, v.pos.z);
  const yours = p.findVehicle(g) === v;
  return {
    before, claimed, running, mounted: mounted.length, onFoot,
    kind: v.spec.kind, riderKind: rider.kind,
    moved: +(seat0.distanceTo(rider.position)).toFixed(1), top: +top.toFixed(1),
    closed, nearest: +nearest.toFixed(1), seated,
    dropped, rolled, dropSpeed: DROP_SPEED, carried: +carried.toFixed(1),
    speedAfter: +speedAfter.toFixed(2), yours,
  };
})()`);
check('the corral posts a squad that can ride what is parked there',
  riders.before.posted >= 3 && riders.before.canRide > 0 && riders.before.hostiles === 0,
  JSON.stringify(riders.before));
check('an alerted camp sends riders for its rides, and keeps half its feet',
  riders.claimed > 0 && riders.mounted > 0 && riders.onFoot > 0,
  `claimed ${riders.claimed} · running ${riders.running} · mounted ${riders.mounted} · on foot ${riders.onFoot}`);
check('the rider sits the seat and the ride comes at the party',
  riders.mounted > 0 && riders.seated && riders.top > 4 && riders.closed !== null,
  `${riders.riderKind} on a ${riders.kind}: seated ${riders.seated}, top ${riders.top} m/s,`
  + ` closed 30 m to 8 m in ${riders.closed === null ? 'never (' + riders.nearest + ' m)' : riders.closed + ' s'}`);
check('drop the rider and the saddle is empty, the ride whole',
  riders.mounted > 0 && !riders.dropped.hostile && !riders.dropped.alive && riders.dropped.rideAlive && !riders.dropped.rideRef,
  JSON.stringify(riders.dropped));
// The bargain `dropRider` documents, and which nothing checked: a hull with
// speed still in it does not stop dead the moment the saddle empties. It has
// to carry itself some real distance, or "rolls to a stop" below is satisfied
// by a ride that never rolled.
check('a hull with speed still in it rolls on rather than stopping dead',
  riders.mounted > 0 && riders.rolled !== null && riders.carried > 2,
  `parked ${riders.rolled} s and ${riders.carried} m on from ${riders.dropSpeed} m/s`);
check('and it rolls to a stop where the party can take it',
  riders.mounted > 0 && riders.speedAfter < 0.6 && riders.yours,
  `speed ${riders.speedAfter} · mountable ${riders.yours}`);

// ------------------------------------------------- checkpoints are optional

// A checkpoint marks the way; it does not unlock it. Playtest found the
// opposite: every hostile dead, the door still shut, and the cure a walk back
// to a flag they had run past. Clearing the ground clears the zone — except
// the last one before a transport door, which is a deliberate walk.
await startMode('campaign', 1, 'desert', ['din'], OUTDOOR, true);
const optional = await page.evaluate(`(() => {
  const g = window.__game, c = g.campaign, p = g.players[0];
  window.__simUntil(() => g.state === 'fighting', 30);
  p.maxHp = 1e6; p.hp = 1e6;
  const corral = c.stage.zones[1];
  // stand in the corral so it is the zone being fought, then kill its garrison
  // without ever going near its exit
  c.idx = 1; c.phase = 'travel';
  p.position.set(corral.center.x, corral.center.y + 0.5, corral.center.z);
  window.__sim(0.4);
  const entered = c.phase === 'fight' && c.idx === 1;
  const farFromExit = p.position.distanceTo(corral.exit);
  for (const e of g.enemies) if (e.alive) e.damage(9999, p.position, 0);
  window.__simUntil(() => c.idx > 1, 8);
  const advanced = c.idx > 1;
  // ...and the way on does NOT open on a body count alone: the last zone of
  // the stage still wants the walk to its exit
  c.idx = c.stage.zones.length - 1;
  c.phase = 'fight';
  const last = c.stage.zones[c.stage.zones.length - 1];
  p.position.set(last.center.x, last.center.y + 0.5, last.center.z);
  for (const e of g.enemies) if (e.alive) e.damage(9999, p.position, 0);
  window.__sim(3);
  const heldAtTheDoor = c.idx === c.stage.zones.length - 1;
  // ...and walking to it does open it. On a road that means *running* the
  // road: reaching the far mouth fires every mark you drove past, and the way
  // on waits for what they send, so this keeps putting them down as it walks
  // rather than clearing the field once and hoping.
  let openedOnTheWalk = false;
  for (let k = 0; k < 40 && !openedOnTheWalk; k++) {
    p.position.set(last.exit.x, last.exit.y + 0.5, last.exit.z);
    for (const e of g.enemies) if (e.alive) e.damage(9999, p.position, 0);
    window.__sim(0.5);
    openedOnTheWalk = c.idx >= c.stage.zones.length;
  }
  return { entered, farFromExit: +farFromExit.toFixed(1), advanced, heldAtTheDoor, openedOnTheWalk };
})()`);
check('a camp cleared of its garrison advances without the checkpoint',
  optional.entered && optional.advanced && optional.farFromExit > 8,
  JSON.stringify(optional));
check('but the last checkpoint before the door is still a walk',
  optional.heldAtTheDoor && optional.openedOnTheWalk, JSON.stringify(optional));

// ------------------------------------------------- a new kind arrives alone

// The rule, exercised where it lives: a wave that would bring a kind nobody
// has met yet brings *only* the new kinds, and the mixing starts once they are
// known. Playtest: *"we should have them be a wave themselves instead of
// mixing with the other waves, at least when first encountered."*
await startMode('campaign', 1, 'desert', ['din'], OUTDOOR, true);
const debut = await page.evaluate(`(() => {
  const g = window.__game, c = g.campaign;
  const zone = c.stage.zones.find((z) => z.spec.air) ?? c.stage.zones[1];
  // meet the board's earlier roster the way a run does — a camp's garrison is
  // drawn without the debut rule, and everyone in it counts as met
  c.seenKinds.clear();
  const early = c.squadFor(3, 10, zone);
  const known = [...c.seenKinds];
  // now the next step up the ramp, as a wave
  const wave = c.squadFor(4, 8, zone, { debut: true });
  const waveKinds = [...new Set(wave)];
  const newOnes = waveKinds.filter((k) => !known.includes(k));
  // where a step up the ramp brings several new kinds they queue: the next
  // wave is the next one of them, alone again
  const next = [...new Set(c.squadFor(4, 8, zone, { debut: true }))];
  // ...and once there is nothing new left, the mixing resumes
  let after = next;
  for (let i = 0; i < 6 && after.every((k) => !known.includes(k)); i++) {
    after = [...new Set(c.squadFor(4, 8, zone, { debut: true }))];
  }
  return {
    known: [...new Set(early)], waveKinds, newOnes, next,
    alone: waveKinds.length === 1 && newOnes.length === 1,
    nextAlone: next.length === 1,
    mixedAfter: after.some((k) => known.includes(k)),
  };
})()`);
check('a new kind arrives as a squadron of its own',
  debut.alone, `met ${JSON.stringify(debut.known)} then the wave was ${JSON.stringify(debut.waveKinds)}`);
check('and several new kinds queue up, a wave each',
  debut.nextAlone && debut.next[0] !== debut.waveKinds[0], JSON.stringify(debut.next));
check('and once they are all known the mixing resumes',
  debut.mixedAfter, JSON.stringify(debut));

// ---------------------------------------------------------------- every board

const boards = ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];
for (const board of boards) {
  // A fresh page per board. Nine territories raised back to back in one page
  // is nine boards' worth of geometry and art through one renderer, and this
  // box runs out of memory somewhere around the seventh — a crash that says
  // nothing about any of the levels. Reloading costs a few seconds and makes
  // the result mean what it says.
  await startMode('campaign', 1, board, ['din'], OUTDOOR, true);
  const audit = await page.evaluate(() => {
    const g = window.__game;
    const c = g.campaign;
    const spec = c.stage;
    const phys = g.board.physics;
    const bad = [];
    // every fight zone needs somewhere to put a wave
    for (const z of spec.zones) {
      const fight = z.spec.kind === 'assault' || z.spec.kind === 'camp';
      if (fight && z.spec.shell === 'hall' && z.hatches.length < 2) bad.push(`${z.spec.label}: hatches`);
      if (fight && z.spec.shell !== 'hall' && z.vents.length < 3) bad.push(`${z.spec.label}: vents`);
      if (!z.posts.length) bad.push(`${z.spec.label}: posts`);
    }
    // A ride stands on the ground, not on the furniture. It takes its hover
    // height from the physics — the highest surface under it — so one authored
    // a metre and a half from a Tusken tent settles onto the tent's roof and
    // sits there, which is where a playtest found a landspeeder. Checked in
    // the zone's own coordinates, where both were written, so it holds however
    // the stage is placed in the world.
    for (const zone of spec.zones) {
      for (const ride of zone.spec.rides ?? []) {
        for (const prop of zone.spec.props ?? []) {
          if (!prop.solid) continue;
          const d = Math.hypot(ride.u - prop.u, ride.v - prop.v);
          if (d < prop.solid.r + 3) {
            bad.push(`${zone.spec.label}: a ${ride.kind} is parked ${d.toFixed(1)} m from a ${prop.id} (needs ${(prop.solid.r + 3).toFixed(1)})`);
          }
        }
      }
    }

    // One barrier per way on, and no orphans. Two code paths used to build a
    // road's far mouth — the generic outdoor exit and the road's own
    // barricade — so a `chase` zone got two fences at one spot, the second
    // taking the variable and the first left holding a blocker nothing could
    // open: an invisible wall across the way on that survived clearing the
    // road. Counting the colliders that stand where a barrier stands catches
    // any repeat of that on any board.
    for (const zone of spec.zones) {
      for (const [which, bar] of [['exit', zone.exitBarrier], ['entry', zone.entryBarrier]]) {
        if (!bar) continue;
        // At body height, and in the gap itself. A doorway's own frame is
        // solid by design — posts either side, a lintel over the top — and
        // none of that is in the way of walking through. What an orphaned
        // blocker looks like is a second thing filling the opening.
        const y = bar.pos.y + 1;
        const n = phys.boxes.filter((b) =>
          bar.pos.x > b.min.x && bar.pos.x < b.max.x
          && bar.pos.z > b.min.z && bar.pos.z < b.max.z
          && y > b.min.y && y < b.max.y).length;
        if (n > 1) bad.push(`${zone.spec.label}: ${n} blockers fill its ${which} barrier's gap`);
      }
    }

    // and every parked ride has to be standing on the stage — in somebody's
    // camp. A ride with no owner standing in the middle of nowhere is the
    // thing the corrals exist to prevent: it is either in a held camp or in
    // a warlord's arena, and never on a trailhead or a road.
    for (const r of spec.rides) {
      if (!spec.contains(r.x, r.z)) bad.push(`ride ${r.kind} off the stage`);
      const owner = spec.zones.find((z) => r.x >= z.rect.minX && r.x <= z.rect.maxX
        && r.z >= z.rect.minZ && r.z <= z.rect.maxZ);
      const kind = owner?.spec.kind;
      if (kind !== 'camp' && kind !== 'warlord') bad.push(`ride ${r.kind} has no owner (${kind ?? 'no zone'})`);
      for (const q of spec.rides) {
        if (q === r) continue;
        if (Math.hypot(q.x - r.x, q.z - r.z) < 2.5) bad.push(`ride ${r.kind} is parked inside a ${q.kind}`);
      }
    }
    return {
      bad,
      ceiling: spec.ceilingY - spec.floorY,
      firstShell: spec.zones[0].spec.shell,
      firstKind: spec.zones[0].spec.kind,
      stages: window.__missionStages ?? 0,
    };
  });
  check(`${board}: every zone can post and receive a squad`, audit.bad.length === 0, audit.bad.join('; '));
  check(`${board}: begins outdoors`, audit.firstShell !== 'hall' && audit.firstKind === 'start',
    `${audit.firstShell}:${audit.firstKind}`);
  check(`${board}: the ceiling clears a jetpack burn`, audit.ceiling >= 33, `${audit.ceiling} m`);
}

// ---------------------------------------------------------------- the default

// The outdoor stage chain is what Missions runs with no flag at all as of
// 2026-09-06, so the plain URL is the case that matters most here. What is
// running is told by what it *has*, not by its class name: the bundle is
// minified, so `constructor.name` is two letters in a build. The room chain
// has `level.rooms`; the outdoor stages have `stage.zones`.
const chainOf = () => page.evaluate(() => {
  const c = window.__game.campaign;
  return {
    rooms: c.level?.rooms?.map((r) => r.spec.kind).join(','),
    hasStages: !!c.stage,
    zones: c.stage?.zones?.map((z) => `${z.spec.shell}:${z.spec.kind}`).join(','),
    ceiling: window.__game.ceilingY,
  };
});

await startMode('campaign', 1, 'desert', ['din'], '', true);
const plain = await chainOf();
check('with no flag Missions runs the outdoor stages',
  plain.hasStages && !plain.rooms, `stages=${plain.hasStages}: ${plain.zones}`);
check('and the stages run under a ceiling', typeof plain.ceiling === 'number', String(plain.ceiling));

// both spellings of "give me the old one" name the room chain
for (const flag of ['?missions=old', '?backup=missions']) {
  await startMode('campaign', 1, 'desert', ['din'], flag);
  const legacy = await chainOf();
  check(`${flag} names the room chain`,
    !legacy.hasStages && legacy.rooms?.startsWith('start') && legacy.rooms?.endsWith('warlord'),
    `stages=${legacy.hasStages}: ${legacy.rooms}`);
  check(`${flag} runs without a ceiling over it`, legacy.ceiling === null, String(legacy.ceiling));
}

// ---------------------------------------------------------------- what a hit is worth
//
// The bolt is 34 and a swing is 32. For most of the roster's life the mooks
// sat just over both — a Tusken at 80 was three bolts, which on the first
// board is a rifle that does not work.

await startMode('campaign', 1, 'desert', ['din']);

const lethality = await page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const hits = (kind) => {
    const e = g.addReinforcement(kind, p.position.clone(), 4242);
    if (!e) return null;
    let n = 0;
    while (e.alive && n < 20) { e.damage(p.profile.boltDamage, p.position, 0); n++; }
    e.removeMe = true;
    return n;
  };
  const out = { bolt: p.profile.boltDamage, swing: p.profile.meleeDamage, unarmored: {}, armored: {} };
  for (const k of ['tusken', 'pyke', 'pirate', 'nikto', 'alamite', 'krykna']) out.unarmored[k] = hits(k);
  for (const k of ['stormtrooper', 'deathtrooper', 'officer']) out.armored[k] = hits(k);
  return out;
});

const softest = Object.entries(lethality.unarmored).filter(([, n]) => n !== null && n > 1);
check('an unarmored hostile goes down to one bolt',
  softest.length === 0,
  softest.length ? softest.map(([k, n]) => `${k} ${n}`).join(', ')
    : Object.entries(lethality.unarmored).map(([k, n]) => `${k} ${n}`).join(' · '));
check('and armour is worth something',
  Object.values(lethality.armored).every((n) => n === null || n >= 2),
  Object.entries(lethality.armored).map(([k, n]) => `${k} ${n}`).join(' · '));

// ---------------------------------------------------------------- the worm
//
// A burrower is untouchable under the sand and a body out of it, and the line
// between those was drawn at the wrong place: `submerged` read which leg of
// the cycle it was on, so the whole of the 0.8 s sink was unhittable while the
// animal was still standing in front of you.

const worm = await page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const idle = [blank(), blank(), blank(), blank()];
  const w = g.addReinforcement('sandworm', p.position.clone().add(new g.players[0].position.constructor(12, 0, 0)), 777);
  if (!w) return null;
  window.__manual = true;
  const states = new Set();
  let outButUntouchable = 0;
  for (let i = 0; i < 900; i++) {
    g.update(1 / 30, idle);
    states.add(w.burrow);
    // more of it out of the sand than in, and yet not a thing you can hit
    if (w.burrowDepth < 0.5 && w.submerged) outButUntouchable++;
  }
  let meshes = 0, culled = 0;
  w.char.root.traverse((o) => { if (o.isMesh) { meshes++; if (o.frustumCulled) culled++; } });
  const parts = w.hitParts.length;
  w.removeMe = true;
  window.__manual = false;
  return { states: [...states], outButUntouchable, meshes, culled, parts };
});

if (worm) {
  check('a worm with more of it out than in is a body you can hit',
    worm.outButUntouchable === 0 && worm.states.includes('sinking'),
    `${worm.outButUntouchable} frame(s) out but untouchable · cycle ${worm.states.join(',')}`);
  check('and it is never culled out of the frame while it is on screen',
    worm.meshes > 0 && worm.culled === 0, `${worm.culled} of ${worm.meshes} meshes culled`);
  check('a blade reaches the body a bolt aims at',
    worm.parts > 0, `${worm.parts} hit volume(s) beyond the chest sphere`);
}

// ---------------------------------------------------------------- the shake
//
// A shake is the world lurching. Translating the camera says that about
// everything in frame — including the one body standing in front of the lens,
// which rattled along with the sand and read as a character glitching.

await startMode('campaign', 1, 'desert', ['din']);

const shake = await page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const idle = [blank(), blank(), blank(), blank()];
  window.__manual = true;
  p.maxHp = 1e6; p.hp = 1e6;
  // let the rig settle first: a camera still converging on its subject moves
  // the body in frame for reasons that have nothing to do with a shake
  for (let i = 0; i < 90; i++) g.update(1 / 30, idle);
  // where the body sits relative to the eye is what lands on screen
  const rest = p.char.root.position.clone().sub(p.cam.camera.position);
  window.__manual = true;
  p.cam.shake(0.45);
  const offs = [];
  let worstDrift = 0;
  for (let i = 0; i < 12; i++) {
    g.update(1 / 30, idle);
    const off = p.cam.shakeOffset.clone();
    offs.push(off.length());
    // `Game.render` carries this same offset onto this viewport's own body
    const rel = p.char.root.position.clone().add(off).sub(p.cam.camera.position);
    worstDrift = Math.max(worstDrift, rel.distanceTo(rest));
  }
  window.__manual = false;
  return { shook: Math.max(...offs), drift: worstDrift };
});

check('the camera really shakes', shake.shook > 0.02, `${shake.shook.toFixed(3)} m at its worst`);
check('and the body it is watching holds still in the frame',
  shake.shook > 0.02 && shake.drift < 0.02,
  `${(shake.drift * 100).toFixed(2)} cm of drift against the eye, under a ${(shake.shook * 100).toFixed(0)} cm shake`);

// ---------------------------------------------------------------- the beacon
//
// The guide column was lit whenever nobody was standing on it, so walking
// three paces off an objective brought it straight back up — which reads as a
// checkpoint respawning, and most often while the fight it belongs to is still
// running.

const column = await page.evaluate(() => {
  const g = window.__game;
  const c = g.campaign;
  const p = g.players[0];
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const idle = [blank(), blank(), blank(), blank()];
  let col = null;
  g.scene.traverse((o) => {
    if (!col && o.isMesh && o.geometry?.type === 'CylinderGeometry'
      && o.geometry.parameters?.height === 60) col = o;
  });
  if (!col) return null;
  window.__manual = true;
  p.maxHp = 1e6; p.hp = 1e6;
  let reaches = 0, wasReached = false, relit = 0, away = 0;
  for (let i = 0; i < 1200; i++) {
    // a minute of standing on the objective and walking well off it again
    const obj = c.objectivePos;
    const onIt = Math.floor(i / 60) % 2 === 0;
    if (onIt) p.position.set(obj.x, obj.y + 0.5, obj.z);
    else { p.position.set(obj.x + 26, obj.y + 0.5, obj.z + 26); away++; }
    g.update(1 / 30, idle);
    if (c.beaconReached && !wasReached) reaches++;
    wasReached = c.beaconReached;
    // lit again for an objective it has already been walked up to
    if (c.beaconReached && c.beaconDone.distanceTo(c.objectivePos) <= 7 && col.visible) relit++;
  }
  window.__manual = false;
  return { reaches, relit, away };
});

if (column) {
  check('a beacon that has been reached stays reached',
    column.reaches > 0 && column.relit === 0,
    `reached ${column.reaches}x, lit again ${column.relit}x over ${column.away} frames spent away from it`);
}

// ---------------------------------------------------------------- the door
//
// A transport door raises a whole level inside one frame, and whatever that
// stage asks for is asked for at that moment. The run holds behind the veil
// until it is dressed.

const door = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.campaign;
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const idle = [blank(), blank(), blank(), blank()];
  window.__manual = true;
  c.idx = c.stage.zones.length;
  c.phase = 'travel';
  for (const e of g.enemies) e.removeMe = true;
  for (let i = 0; i < 120; i++) g.update(1 / 30, idle);
  const was = c.stageIdx;
  const portal = c.stage.exitPortal;
  let held = 0, veil = false, frozenAt = null;
  for (let i = 0; i < 900; i++) {
    if (i % 20 === 0 && c.stageIdx === was) for (const p of g.players) p.position.copy(portal.threshold);
    g.update(1 / 30, idle);
    if (c.settlingStage) {
      veil = true;
      held++;
      // nothing runs behind the veil: the zone flow is frozen
      if (frozenAt === null) frozenAt = c.idx;
    }
    if (c.stageIdx !== was && veil && !c.settlingStage) break;
  }
  window.__manual = false;
  return { crossed: c.stageIdx !== was, veil, held, stage: c.stage.spec.label };
});

check('a transport door holds the run while the next stage is dressed',
  door.crossed && door.veil, `${door.held} frame(s) held, arrived at ${door.stage}`);
check('and lets it go once the stage is ready',
  door.crossed && door.held < 240, `${door.held} frame(s) — the cap is 240`);

// ---------------------------------------------------------------- the road
//
// Everything from here down moves the party about, empties zones and walks the
// stage chain, so it runs last and on a board of its own — an earlier version
// of these checks ran before `the walk` and left it looking at a campaign
// already standing on its final stage.
//
// A road's barricade lifts when its escort is down, and "the escort is down"
// was written as `zoneForce.every(e => !e.alive)` — which is true of an empty
// list. Before the first mark fired there was no escort, so the way on stood
// open from the moment the road began; a playtest walked up to an open door
// with the whole road still ahead of it.

await startMode('campaign', 1, 'desert', ['din']);

const road = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.campaign;
  const i = c.stage.zones.findIndex((z) => z.spec.kind === 'chase');
  if (i < 0) return null;
  const z = c.stage.zones[i];
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const idle = [blank(), blank(), blank(), blank()];
  window.__manual = true;
  c.idx = i;
  c.phase = 'travel';
  for (const p of g.players) if (p.alive) p.position.copy(z.entry);
  for (let k = 0; k < 90; k++) g.update(1 / 30, idle);
  const atEntry = { open: !!z.exitBarrier?.open_, fired: c.marksFired.filter(Boolean).length, marks: z.marks.length };
  // …and the road does end: ride it to the far mouth, put down whatever the
  // marks send (they arrive by transport, so this has to keep killing across
  // the flight rather than clearing the field once), and the zone clears.
  let ran = false;
  for (let k = 0; k < 900 && !ran; k++) {
    for (const p of g.players) if (p.alive) p.position.copy(z.exit);
    for (const e of g.enemies) if (e.alive) e.damage(99999, e.position, -1);
    g.update(1 / 30, idle);
    ran = c.idx > i || !!z.exitBarrier?.open_;
  }
  const atEnd = { ran, fired: c.marksFired.filter(Boolean).length };
  window.__manual = false;
  return { atEntry, atEnd };
});

if (road) {
  check('the road holds its barricade until the road has been run',
    !road.atEntry.open,
    `at the mouth: ${road.atEntry.open ? 'open' : 'shut'}, ${road.atEntry.fired}/${road.atEntry.marks} marks fired`);
  check('and opens the way on once every mark is down',
    road.atEnd.ran, `${road.atEnd.fired} marks fired, ${road.atEnd.ran ? 'through' : 'still held'}`);
}

// ---------------------------------------------------------------- cover
//
// Cover used to mean "a StaticBox and which side of it", which quietly meant
// only boxes were ever cover — and the boxes outdoors are the crates. Every
// boulder in the game is a cylinder, so a playtest found chest-high rock that
// sheltered nobody standing next to a crate that worked.

await startMode('campaign', 1, 'desert', ['din']);

const cover = await page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  const phys = g.board.physics;
  const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
    rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
  const idle = [blank(), blank(), blank(), blank()];
  window.__manual = true;
  /** stand beside a solid, press the cover button, and report what happened */
  const hug = (x, z, baseY) => {
    p.cover = null;
    p.velocity.set(0, 0, 0);
    // from the solid's own foot, not from wherever the body happened to be:
    // a mission stage stands ninety metres over the territory, so searching
    // for ground from the player's altitude found the floor under the *other*
    // one and reported forty-five metres of crate
    const y = phys.groundHeight(x, z, baseY + 1.5);
    p.position.set(x, isFinite(y) ? y : baseY, z);
    for (let k = 0; k < 4; k++) g.update(1 / 30, idle);
    g.update(1 / 30, [{ ...blank(), slamPressed: true }, blank(), blank(), blank()]);
    for (let k = 0; k < 8; k++) g.update(1 / 30, idle);
    return p.cover
      ? { took: true, over: p.cover.top - p.position.y, lower: p.char.animator?.playing('lower') }
      : { took: false };
  };
  const nearest = (list, dist) => list.map((o) => ({ o, d: dist(o) }))
    .filter((e) => isFinite(e.d)).sort((a, b) => a.d - b.d)[0]?.o ?? null;
  const out = { height: p.height };
  // a boulder: round, and taller than a body
  const floor = p.position.y;
  // Tall on purpose: this one has to stand a clear head over the body, or
  // "cover that stands over you is not ducked behind" passes without ever
  // testing the standing half of the rule.
  const rock = nearest(
    phys.cylinders.filter((c) => c.r >= 0.9 && c.maxY - c.minY < 6
      && c.maxY - c.minY > p.height + 0.8 && Math.abs(c.minY - floor) < 6),
    (c) => Math.hypot(c.x - p.position.x, c.z - p.position.z));
  if (rock) {
    const a = Math.atan2(p.position.x - rock.x, p.position.z - rock.z);
    out.rock = hug(rock.x + Math.sin(a) * (rock.r + 0.75), rock.z + Math.cos(a) * (rock.r + 0.75), rock.minY);
  }
  // a crate: square, and lower than a body
  const crate = nearest(
    phys.boxes.filter((b) => b.max.y - b.min.y > 1 && b.max.y - b.min.y < 2
      && b.max.x - b.min.x < 4 && b.max.z - b.min.z < 4 && Math.abs(b.min.y - floor) < 6),
    (b) => Math.hypot((b.min.x + b.max.x) / 2 - p.position.x, (b.min.z + b.max.z) / 2 - p.position.z));
  if (crate) out.crate = hug(crate.max.x + 0.75, (crate.min.z + crate.max.z) / 2, crate.min.y);
  p.cover = null;
  window.__manual = false;
  return out;
});

check('a boulder is cover, the same as a crate',
  !!cover.rock?.took, cover.rock ? JSON.stringify(cover.rock) : 'no boulder near the start');
check('cover no taller than the body is ducked behind',
  cover.crate?.took && cover.crate.over <= cover.height && cover.crate.lower === 'coverLower',
  cover.crate ? `${cover.crate.over?.toFixed(2)} m of cover over a ${cover.height.toFixed(2)} m body · ${cover.crate.lower}`
    : 'no crate near the start');
check('and cover that stands over you is not',
  !!cover.rock?.took && cover.rock.over >= cover.height + 0.25 && cover.rock.lower === 'idleLower',
  cover.rock ? `${cover.rock.over?.toFixed(2)} m over a ${cover.height.toFixed(2)} m body · ${cover.rock.lower}` : '—');

// ------------------------------------------------- ground somebody is holding
//
// A level is held by people standing in it, not by people arriving in it. A
// playtest walked the ravine and found a long stretch of nothing and then a
// wave at the end of it, which was two omissions compounding: corridors were
// only garrisoned where the builder happened to have put crates (and crates
// only go into roofed lanes), and an `assault` zone was populated by nothing
// at all until you crossed its line.

await startMode('campaign', 1, 'desert', ['din']);

const posted = await page.evaluate(async () => {
  const g = window.__game;
  const c = g.campaign;
  const out = [];
  for (let stage = 0; stage < 6; stage++) {
    const s = c.stage;
    const alive = g.enemies.filter((e) => e.alive);
    const inRect = (e, r) => e.position.x > r.minX && e.position.x < r.maxX
      && e.position.z > r.minZ && e.position.z < r.maxZ;
    out.push({
      label: s.spec.label,
      zones: s.zones.map((z) => ({
        kind: z.spec.kind, shell: z.spec.shell,
        held: alive.filter((e) => inRect(e, z.rect)).length,
      })),
      links: alive.filter((e) => !s.zones.some((z) => inRect(e, z.rect))).length,
    });
    // step to the next stage with the ground cleared behind us
    if (!s.exitPortal) break;
    const blank = () => ({ moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false, meleePressed: false,
      rocketPressed: false, zoomHeld: false, zoomDelta: 0, blockHeld: false, slamPressed: false,
      meleeSwapPressed: false, rangedSwapPressed: false, pausePressed: false });
    const idle = [blank(), blank(), blank(), blank()];
    window.__manual = true;
    c.idx = s.zones.length;
    c.phase = 'travel';
    for (const e of g.enemies) e.removeMe = true;
    for (let i = 0; i < 120; i++) g.update(1 / 30, idle);
    const was = c.stageIdx;
    const portal = s.exitPortal;
    for (let i = 0; i < 300 && c.stageIdx === was; i++) {
      if (i % 20 === 0) for (const p of g.players) p.position.copy(portal.threshold);
      g.update(1 / 30, idle);
    }
    window.__manual = false;
    if (c.stageIdx === was) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return out;
});

// Fights are found, not delivered: every assault zone holds somebody before
// anyone has walked into it.
const emptyFights = posted.flatMap((st) => st.zones
  .filter((z) => z.kind === 'assault' && z.held === 0)
  .map((z) => `${st.label}/${z.shell}:${z.kind}`));
check('an assault zone is held before you walk into it',
  emptyFights.length === 0,
  emptyFights.length ? emptyFights.join(', ')
    : posted.map((st) => st.zones.filter((z) => z.kind === 'assault')
      .map((z) => z.held).join('+')).join(' · '));

// And the walk between them is not a walk through nothing.
const lonelyLinks = posted.filter((st) => st.zones.length > 1 && st.links === 0).map((st) => st.label);
check('and the corridors between zones are picketed',
  lonelyLinks.length === 0,
  lonelyLinks.length ? `empty: ${lonelyLinks.join(', ')}`
    : posted.map((st) => `${st.links}`).join(' · '));

check('so every stage stands up populated end to end',
  posted.every((st) => st.zones.reduce((n, z) => n + z.held, 0) + st.links >= 5),
  posted.map((st) => st.zones.reduce((n, z) => n + z.held, 0) + st.links).join(' · '));

await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall good');
process.exit(failures.length ? 1 : 0);
