/**
 * K3 — mounted weapons (docs/SECTIONS_IMPLEMENTATION.md §3), end to end in
 * the real build.
 *
 *  1. The **turret**, on an open board: mount it with Y, the look aims it
 *     inside its arc and no further, the gunner sees down the barrels, RT
 *     fires, a held trigger overheats it and it vents, Y steps off and it is
 *     still solid, and an empty one fights for its side at half rate. This is
 *     what the Barge Run and Guns of the Frigate build on.
 *  2. The **lane**, the **cannon**, the **side swing** and the **pillion**, on
 *     the Magma Run's river: the bike is carried along the lane and never
 *     stops, the stick leans it, RT fires its nose cannons, X swings at a
 *     rider alongside and knocks him out of the saddle (his bike runs on and
 *     goes under), and a second player takes the pillion, works the weapons,
 *     and slides onto the bars when the driver steps off.
 *
 *   node tools/test-section-mounts.mjs      (HARNESS_PORT as the other suites)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const PORT = process.env.HARNESS_PORT ?? '4173';
const check = makeCheck();

// ---------------------------------------------------------------- 1. turret
{
  const h = await launch({ url: `http://localhost:${PORT}/` });
  const { page } = h;
  await h.startCoop(1, 'desert');
  await page.evaluate(() => { window.__manual = true; });

  const setup = await page.evaluate(() => {
    const g = window.__game;
    const p = g.players[0];
    const V = g.vehicles[0].constructor;
    // stood on the ground a few metres in front of the player, facing +z
    const x = p.position.x + 4, z = p.position.z;
    const t = new V({ kind: 'turret', x, z, yaw: 0 }, g.board);
    g.scene.add(t.group);
    g.vehicles.push(t);
    window.__turret = t;
    p.position.set(x, t.pos.y + 0.1, z - 2.2);
    p.velocity.set(0, 0, 0);
    // quiet the board: nothing else should shoot or be shot in this test
    for (const e of g.enemies) e.damage(9999999, e.position, 0);
    return { solid: g.board.physics.boxes.some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z),
      arc: t.def.turret.yawArc, rate: t.def.gun.rate };
  });
  check('a turret stands solid on its ring', setup.solid);

  const step = (secs, over = {}, fn = null) => page.evaluate(([secs, over, BLANK, fn]) => {
    const g = window.__game;
    const f = fn ? new Function('g', 't', fn) : null;
    for (let i = 0; i < Math.round(secs * 60); i++) {
      if (f) f(g, window.__turret);
      g.update(1 / 60, [{ ...BLANK, ...over }, BLANK, BLANK, BLANK]);
    }
  }, [secs, over, blankInput(), fn]);

  await step(0.2);
  const near = await page.evaluate(() => window.__game.players[0].nearVehicle === window.__turret);
  check('its mount prompt shows in reach', near);
  await step(1 / 60, { slamPressed: true });
  await step(0.1);
  const on = await page.evaluate(() => {
    const g = window.__game, p = g.players[0], t = window.__turret;
    return { on: p.vehicle === t && t.rider === p, still: t.pos.distanceTo(new t.pos.constructor(t.spec.x, t.pos.y, t.spec.z)) < 0.01 };
  });
  check('Y mounts it', on.on);
  check('and it does not move', on.still);

  // aim inside the arc, then try to turn it past the arc
  await step(1.2, {}, 'g.players[0].cam.yaw = 0.8; g.players[0].cam.pitch = 0.2;');
  const aimed = await page.evaluate(() => {
    const g = window.__game, p = g.players[0], t = window.__turret;
    const eye = t.sightWorld(new p.cam.camera.position.constructor());
    return { yaw: t.yaw, pitch: t.aimPitch, sight: p.cam.camera.position.distanceTo(eye), aiming: p.aiming };
  });
  check('the look turns the gun', Math.abs(aimed.yaw - 0.8) < 0.03 && Math.abs(aimed.pitch - 0.2) < 0.03,
    { yaw: aimed.yaw.toFixed(2), pitch: aimed.pitch.toFixed(2) });
  check('the gunner sees down the barrels', aimed.sight < 0.05 && aimed.aiming, { sight: aimed.sight.toFixed(3) });
  await step(3, {}, 'g.players[0].cam.yaw = 3.0;');
  const held = await page.evaluate(() => window.__turret.yaw);
  check('it stops at the edge of its arc', Math.abs(held - setup.arc) < 0.03 || Math.abs(held - 3 * Math.PI / 4) < 0.03,
    held.toFixed(2));

  // fire: bolts leave, heat rises; hold it and it locks up; let go and it vents
  const fired = await page.evaluate(([BLANK]) => {
    const g = window.__game, t = window.__turret;
    const count = () => g.projectiles.bolts?.filter?.((b) => b.alive !== false).length ?? 0;
    let shots = 0; let lastHeat = t.heat; let lockedAt = -1;
    for (let i = 0; i < 60 * 8; i++) {
      g.players[0].cam.yaw = 0.2;
      g.update(1 / 60, [{ ...BLANK, shootHeld: true }, BLANK, BLANK, BLANK]);
      if (t.heat > lastHeat + 1e-6) shots++;
      lastHeat = t.heat;
      if (t.overheated && lockedAt < 0) lockedAt = i / 60;
    }
    const hot = t.overheated;
    let ventedAt = -1;
    for (let i = 0; i < 60 * 6; i++) {
      g.update(1 / 60, [BLANK, BLANK, BLANK, BLANK]);
      if (!t.overheated && ventedAt < 0) ventedAt = i / 60;
    }
    return { shots, lockedAt, hot, ventedAt, heat: t.heat, bolts: count() };
  }, [blankInput()]);
  check('RT fires it', fired.shots > 10, fired);
  check('a held trigger overheats it', fired.lockedAt > 1 && fired.lockedAt < 7, fired.lockedAt);
  check('and it vents and comes back', fired.ventedAt >= 0, fired.ventedAt);

  await step(1 / 60, { slamPressed: true });
  await step(0.3);
  const off = await page.evaluate(() => {
    const g = window.__game, p = g.players[0], t = window.__turret;
    const x = t.pos.x, z = t.pos.z;
    return { off: !p.vehicle && !t.rider, solid: g.board.physics.boxes.some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) };
  });
  check('Y steps off', off.off);
  check('and the turret is still solid', off.solid);

  // an empty gun fights for its side at half rate: make it the other side's
  // and stand the player in front of it
  const auto = await page.evaluate(([BLANK]) => {
    const g = window.__game, p = g.players[0], t = window.__turret;
    t.team = 1;
    p.position.set(t.pos.x, t.pos.y, t.pos.z + 22);
    p.hp = p.maxHp = 100000;
    let shots = 0; let last = t.heat; let gunnerShots = 0;
    for (let i = 0; i < 60 * 6; i++) {
      p.position.set(t.pos.x, t.pos.y, t.pos.z + 22);
      g.update(1 / 60, [BLANK, BLANK, BLANK, BLANK]);
      if (t.heat > last + 1e-6) shots++;
      last = t.heat;
    }
    gunnerShots = t.def.gun.rate * 6;
    return { shots, full: gunnerShots, yaw: t.yaw };
  }, [blankInput()]);
  check('an empty turret turns onto the other side and fires', auto.shots > 4, auto);
  check('at no more than half the rate a gunner gets', auto.shots <= auto.full * 0.5 + 1, auto);
  const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
  check('no page errors (turret)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await h.close();
}

// ------------------------------------------- 2. lane, cannon, swing, pillion
{
  const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
  const { page } = h;
  await page.goto(`http://localhost:${PORT}/?section=magma-run`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', 2, 'nevarro', ['din', 'maul']);

  // player 0 rides out on the autopilot; the camp is put down so nothing else interferes
  const out = await page.evaluate(async ([BLANK]) => {
    const g = window.__game, s = g.campaign.section;
    for (let f = 0; f < 30 * 20 && !g.players[0].vehicle; f++) {
      const a = s.autopilot(0) || {};
      if (typeof a.yaw === 'number') g.players[0].cam.yaw = a.yaw;
      const { yaw, ...r } = a;
      g.update(1 / 30, [{ ...BLANK, ...r }, BLANK, BLANK, BLANK]);
      if (f % 15 === 0) for (const e of g.enemies) if (e.alive) e.damage(9999999, e.position, 0);
      if (f % 60 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    const v = g.players[0].vehicle;
    return { on: !!v, lane: !!v?.lane, gun: !!v?.def.gun, swing: !!v?.def.sideSwing };
  }, [blankInput()]);
  check('the Magma Run bike is lane-guided, gunned and swinging', out.on && out.lane && out.gun && out.swing, out);

  // pillion: player 1 walks up to the bike and takes the seat behind
  const pil = await page.evaluate(async ([BLANK]) => {
    const g = window.__game;
    const [p0, p1] = g.players;
    const v = p0.vehicle;
    // hold the driver still at the quay for the boarding (brake is the band's floor, so pin it)
    const seat = v.pos.clone();
    let tries = 0;
    for (; tries < 60 && p1.vehicle !== v; tries++) {
      v.pos.copy(seat); v.vel.set(0, 0, 0);
      p1.position.set(v.pos.x + 1.4, v.pos.y + 0.4, v.pos.z - 0.6);
      p1.velocity.set(0, 0, 0);
      g.update(1 / 30, [BLANK, { ...BLANK, slamPressed: tries % 2 === 0 }, BLANK, BLANK]);
    }
    const seated = p1.vehicle === v && v.pillion === p1 && v.rider === p0;
    // the pillion's trigger works the cannon; the driver's does not while they are aboard
    const h0 = v.heat;
    for (let i = 0; i < 20; i++) g.update(1 / 30, [{ ...BLANK, shootHeld: true }, BLANK, BLANK, BLANK]);
    const driverFired = v.heat > h0 + 1e-6;
    const h1 = v.heat;
    for (let i = 0; i < 20; i++) g.update(1 / 30, [BLANK, { ...BLANK, shootHeld: true }, BLANK, BLANK]);
    const pillionFired = v.heat > h1 + 1e-6;
    const behind = p1.position.distanceTo(p0.position);
    // the driver steps off: the pillion slides forward onto the bars
    g.update(1 / 30, [{ ...BLANK, slamPressed: true }, BLANK, BLANK, BLANK]);
    for (let i = 0; i < 5; i++) g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]);
    const promoted = v.rider === p1 && !v.pillion && !p0.vehicle;
    return { tries, seated, driverFired, pillionFired, behind: +behind.toFixed(2), promoted };
  }, [blankInput()]);
  check('Y at a teammate\'s bike takes the pillion', pil.seated, pil);
  check('the pillion sits behind the driver', pil.behind > 0.3 && pil.behind < 1.6, pil.behind);
  check('the pillion works the cannon', pil.pillionFired, pil);
  check('and the driver only drives', !pil.driverFired, pil);
  check('when the driver steps off, the pillion takes the bars', pil.promoted, pil);

  // the lane: carried along it, never stopping, leaning across it
  const lane = await page.evaluate(async ([BLANK]) => {
    const g = window.__game;
    const p = g.players[1];
    const v = p.vehicle;
    const s0 = v.laneS;
    let minSpeed = Infinity;
    for (let i = 0; i < 30 * 4; i++) {
      g.update(1 / 30, [BLANK, { ...BLANK, moveY: -1 }, BLANK, BLANK]);
      if (i > 30 * 2) minSpeed = Math.min(minSpeed, Math.hypot(v.vel.x, v.vel.z));
      for (const e of g.enemies) if (e.alive && !e.ride) e.damage(9999999, e.position, 0);
    }
    const s1 = v.laneS;
    for (let i = 0; i < 30 * 2; i++) g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]);
    const cruise = Math.hypot(v.vel.x, v.vel.z);
    const lat0 = v.laneLat;
    for (let i = 0; i < 30 * 1; i++) g.update(1 / 30, [BLANK, { ...BLANK, moveX: 1 }, BLANK, BLANK]);
    const lat1 = v.laneLat;
    return { s0, s1, minSpeed, cruise, lat0, lat1 };
  }, [blankInput()]);
  check('the lane carries the bike down the river', lane.s1 > lane.s0 + 40, lane);
  check('pulled back, it never stops', lane.minSpeed > 14, lane.minSpeed);
  check('stick centred, it holds cruise', Math.abs(lane.cruise - 22) < 2, lane.cruise);
  check('the stick leans it right', lane.lat1 > lane.lat0 + 3, lane);

  // the side swing: a pirate brought up alongside on a lane bike, and X
  const swing = await page.evaluate(async ([BLANK]) => {
    const g = window.__game;
    const p = g.players[1];
    const v = p.vehicle;
    for (const e of g.enemies) if (e.alive) e.damage(9999999, e.position, 0);
    for (let i = 0; i < 10; i++) g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]);
    const E = g.enemies[0]?.constructor ?? null;
    if (!E) return { error: 'no enemy class to build a rider from' };
    const V = v.constructor;
    // alongside, three metres to the right, at the same speed
    const at = v.lane.point(v.laneS + 1, v.laneLat - 3, new v.pos.constructor());
    const bike = new V({ kind: 'speederBike', x: at.x, z: at.z, y: at.y, yaw: v.yaw }, g.board,
      { lane: v.lane, sideSwing: true, respawns: false });
    g.scene.add(bike.group);
    g.vehicles.push(bike);
    const e = new E('pirateMelee', at.clone().setY(at.y + 1), 1, { silent: true });
    g.addEnemy(e);
    bike.mountHostile(e);
    e.ride = bike;
    bike.vel.copy(v.vel);
    // hold it there: the brain keeps station off the player's right
    bike.laneBrain = (b) => ({ lat: v.laneLat - 3, speed: Math.hypot(v.vel.x, v.vel.z) + (v.laneS - b.laneS) * 2 });
    for (let i = 0; i < 20; i++) g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]);
    const before = { off: v.laneLat - bike.laneLat, along: bike.laneS - v.laneS, riding: !!e.ride };
    // X, leaning nowhere: the swing goes to the flank the rider is on
    g.update(1 / 30, [BLANK, { ...BLANK, meleePressed: true }, BLANK, BLANK]);
    let unseated = -1, runsOn = -1;
    const swungWith = p.weapon;
    for (let i = 0; i < 30 * 2; i++) {
      g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]);
      if (!e.ride && unseated < 0) unseated = i / 30;
      // half a second on, the empty bike is still going
      if (unseated >= 0 && runsOn < 0 && i / 30 >= unseated + 0.5) runsOn = bike.alive ? Math.hypot(bike.vel.x, bike.vel.z) : 0;
    }
    let sankAt = -1;
    for (let i = 0; i < 30 * 5 && sankAt < 0; i++) {
      g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]);
      if (!bike.alive) sankAt = i / 30;
    }
    return { before, unseated, dead: !e.alive, runsOn, sankAt, swungWith, weapon: p.weapon };
  }, [blankInput()]);
  check('a rider is alongside', !swing.error && swing.before.riding, swing);
  check('X swings at him and knocks him out of the saddle', swing.unseated >= 0 && swing.unseated < 1, swing);
  check('over lava that is the end of him', swing.dead, swing);
  check('his bike runs on without him', swing.runsOn > 5, swing);
  check('and goes under', swing.sankAt >= 0, swing);
  check('the rider\'s own blade comes out for the swing and goes away after', swing.swungWith === 'gaffi' && swing.weapon !== 'gaffi', swing);

  const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
  check('no page errors (river)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await h.close();
}

check.done('K3 mounts');
