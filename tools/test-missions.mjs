/**
 * Regression test for the outdoor Missions levels (docs/MISSIONS_OUTDOOR.md).
 *
 * `test-modes.mjs` covers the mode itself — three-way title, per-player
 * cameras, sealed fights, bosses, liberation. This is about the level design
 * that replaced the room chain: the shells and their borders, the flight
 * ceiling and the sky it cuts in two, the stages and their transport doors,
 * the guidance, and the rides. It also checks that `?backup=missions` still
 * puts the old room chain back, since that is the whole point of keeping it.
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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const inputs = [0,1,2,3].map(() => ({ ...blank(), ...(over ?? {}) }));
  for (let i = 0; i < n; i++) g.update(1/30, inputs);
}`;

const step = (n, over = null) => page.evaluate(STEP, [n, over]);

const startMode = async (mode, players, board, chars, query = '') => {
  if (query) {
    await page.goto(`http://localhost:${PORT}/${query}`);
    await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
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
  return {
    walls: walls.length, over: over.length, bigMeshes, rockVerts,
    ceiling: s.ceilingY - s.floorY,
  };
});
check('the borders hold the level in', rim.walls > 8, `${rim.walls} wall runs`);
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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const idle = [blank(), blank(), blank(), blank()];
  // count the shots it actually takes, and where it was standing to take them
  let firedHigh = 0;
  let firedLow = 0;
  const realFire = g.projectiles.fire.bind(g.projectiles);
  g.projectiles.fire = (...a) => {
    if (e.alive) {
      if (e.position.y + e.height > s.ceilingY + 0.5) firedHigh++; else firedLow++;
    }
    return realFire(...a);
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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });

  // Walk the level's own golden path rather than steering at the objective.
  // The crow's line into a bend is a cliff, and that is the point of the path:
  // it is the route the level was authored around, and every zone says where
  // in it that zone begins (`pathFrom`), so the walker can never fall behind
  // the run it is driving.
  let cursor = 0;
  for (let turn = 0; turn < 1200 && !c.done; turn++) {
    out.turns = turn;
    out.stagesSeen.add(c.stageIdx);
    const stage = c.stage;
    const zone = stage.zones[Math.min(c.idx, stage.zones.length - 1)];
    if (c.idx < stage.zones.length) cursor = Math.max(cursor, zone.pathFrom);
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
        // the camera is behind the body, so its yaw is the heading
        p.cam.yaw = Math.atan2(dx, dz);
        i.moveY = -1;
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
    // advance along the path once the party is standing on this point
    const lead = g.players.find((p) => p.alive);
    if (lead && !atPortal && !fighting) {
      const at = stage.path[Math.min(cursor, stage.path.length - 1)];
      if (Math.hypot(at.x - lead.position.x, at.z - lead.position.z) < 7) cursor++;
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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const idle = [blank(), blank(), blank(), blank()];
  const out = {};
  // walk the run to the end of stage 0 without playing it
  c.idx = c.stage.zones.length;
  c.phase = 'travel';
  for (const e of g.enemies) e.removeMe = true;
  g.update(1 / 30, idle);
  const portal = c.stage.exitPortal;
  out.portalOpens = portal.open_ || !portal.closed;
  // one player steps into the pocket: the whole party goes
  const before = c.stageIdx;
  const p = g.players[0];
  p.position.copy(portal.threshold);
  for (let i = 0; i < 90; i++) g.update(1 / 30, idle);
  out.forwardTook = c.stageIdx === before + 1;
  out.bothMoved = g.players.every((q) => Math.abs(q.position.y - c.stage.floorY) < 6);
  out.enemiesCarried = g.enemies.filter((e) => e.alive).length;
  out.hasBack = !!c.stage.backPortal;

  // the way back: one in the pocket is a wait, not a transit
  const back = c.stage.backPortal;
  if (!back) return { ...out, noBackPortal: true };
  const stageNow = c.stageIdx;
  g.players[0].position.copy(back.threshold);
  for (let i = 0; i < 60; i++) g.update(1 / 30, idle);
  out.oneWaits = c.stageIdx === stageNow && c.exited.size === 1;
  out.noticeShown = !!g.exitNotice(g.players[1]);
  // cancelling walks them back out
  const cancel = [{ ...blank(), blockHeld: true }, blank(), blank(), blank()];
  for (let i = 0; i < 20; i++) g.update(1 / 30, cancel);
  out.cancelled = c.exited.size === 0;
  // everyone aboard, and it goes
  for (const q of g.players) q.position.copy(back.threshold);
  for (let i = 0; i < 120; i++) g.update(1 / 30, idle);
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

// ---------------------------------------------------------------- every board

const boards = ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];
for (const board of boards) {
  await startMode('campaign', 1, board, ['din']);
  const audit = await page.evaluate(() => {
    const g = window.__game;
    const c = g.campaign;
    const spec = c.stage;
    const bad = [];
    // every fight zone needs somewhere to put a wave
    for (const z of spec.zones) {
      const fight = z.spec.kind === 'assault' || z.spec.kind === 'camp';
      if (fight && z.spec.shell === 'hall' && z.hatches.length < 2) bad.push(`${z.spec.label}: hatches`);
      if (fight && z.spec.shell !== 'hall' && z.vents.length < 3) bad.push(`${z.spec.label}: vents`);
      if (!z.posts.length) bad.push(`${z.spec.label}: posts`);
    }
    // and every parked ride has to be standing on the stage
    for (const r of spec.rides) {
      if (!spec.contains(r.x, r.z)) bad.push(`ride ${r.kind} off the stage`);
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

// ---------------------------------------------------------------- the way back

await startMode('campaign', 1, 'desert', ['din'], '?backup=missions');
const legacy = await page.evaluate(() => {
  const c = window.__game.campaign;
  return {
    kind: c.constructor.name,
    rooms: c.level?.rooms?.map((r) => r.spec.kind).join(','),
    ceiling: window.__game.ceilingY,
  };
});
check('?backup=missions puts the old room chain back',
  legacy.kind === 'LegacyCampaign' && legacy.rooms?.startsWith('start') && legacy.rooms?.endsWith('warlord'),
  `${legacy.kind}: ${legacy.rooms}`);
check('and the room chain runs without a ceiling over it', legacy.ceiling === null, String(legacy.ceiling));

await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall good');
process.exit(failures.length ? 1 : 0);
