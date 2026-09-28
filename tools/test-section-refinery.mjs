/**
 * The Refinery's sections, mechanic by mechanic (docs/sections-notes/refinery.md):
 * K6 detection (light cones, masks, noise, thresholds), the silent takedown,
 * the radio, the alarm and its reset, and the booth in Lights Out; the belts,
 * the presses, the brake switches and the welding arms in The Line.
 *
 * Drives the simulation stepped at 1/30 s, as test-sections does, and puts
 * bodies exactly where each check needs them rather than walking there.
 *
 * Run:  node tools/test-section-refinery.mjs        (HARNESS_PORT, CHROMIUM_PATH)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;

async function boot(id, chars = ['din']) {
  await page.goto(`http://localhost:${PORT}/?section=${id}`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', chars.length, 'refinery', chars);
  // one frame so the section spawns what it spawns on its first update
  await page.evaluate((b) => window.__game.update(1 / 30, [b, b, b, b]), blankInput());
}

/** step `n` frames with `input` for player 0 (others idle), running `each` per frame first */
const stepFn = `
  window.__step = (n, input, each) => {
    const g = window.__game;
    for (let f = 0; f < n; f++) {
      if (each) each(g, f);
      g.update(1 / 30, [0, 1, 2, 3].map((s) => (s === 0 && input) ? input : window.__blank));
    }
  };`;

// ------------------------------------------------------------ Lights Out
await boot('lights-out');
await page.evaluate(([b, fn]) => { window.__blank = b; (0, eval)(fn); }, [blankInput(), stepFn]);
// let the party finish forming at the airlock
await page.evaluate(() => window.__step(90, null));
// the reset procedure, shared by the checks that trip the alarm
await page.evaluate(() => {
  window.__alive = () => {
    const p = window.__game.players[0];
    for (let n = 0; n < 600 && !p.alive; n++) window.__step(1, null);
    window.__step(40, null, () => { p.hp = 100; });
    return p.alive;
  };
  window.__resetAlarm = () => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    for (let k = 0; k < 40 && !t.dropCleared; k++) {
      window.__step(30, null, () => { p.position.set(-36, Y0, 6); p.velocity.set(0, 0, 0); p.hp = 100; });
      for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    }
    const cleared = t.dropCleared;
    const c = t.consoles[0].spec.pos;
    window.__step(150, { ...window.__blank, interactHeld: true }, () => {
      p.position.set(c.x, c.y, c.z); p.velocity.set(0, 0, 0); p.hp = 100;
      for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    });
    return { cleared, reset: !t.alarm, meter: t.field.level(0) };
  };
});

{
  // a silent takedown: melee from behind on an unaware guard kills in one blow
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test;
    const p = g.players[0];
    t.field.reset();
    const gd = t.guards.find((x) => x.e.alive && x.e.awareness === 'idle');
    if (!gd) return { none: true };
    const e = gd.e;
    gd.swing = 0;
    const fx = Math.sin(gd.yaw), fz = Math.cos(gd.yaw);
    // come up to within a lunge of him from behind, and swing
    const place = () => {
      p.position.set(e.position.x - fx * 2.8, e.position.y, e.position.z - fz * 2.8);
      p.velocity.set(0, 0, 0);
      p.facingYaw = Math.atan2(fx, fz); p.cam.yaw = p.facingYaw;
    };
    window.__step(3, null, place);
    const aware = e.awareness;
    window.__step(1, { ...window.__blank, meleePressed: true }, place);
    window.__step(40, null);
    return { aware, alive: e.alive, takedowns: t.takedowns, alarm: t.alarm };
  });
  check('lights-out: a guard is unaware of someone right behind him', r.aware === 'idle', r);
  check('lights-out: melee from behind is a one-hit silent takedown', !r.alive && r.takedowns >= 1 && !r.alarm, r);
}

{
  // noise only fills the meter when a hostile who is not fighting is near enough to hear it
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, f = t.field;
    const p = g.players[0];
    const e = g.enemies.find((x) => x.alive && x.team === 1 && x.awareness === 'idle');
    if (!e) return { none: true };
    const fx = Math.sin(e.facingYaw), fz = Math.cos(e.facingYaw);
    p.position.set(e.position.x - fx * 10, e.position.y, e.position.z - fz * 10);
    f.reset(); f.noise(0, 0.3);
    const near = f.level(0);
    p.position.set(e.position.x - fx * 60, e.position.y, e.position.z - fz * 60);
    let clear = true;
    for (const o of g.enemies) if (o.alive && o.position.distanceTo(p.position) < 25) clear = false;
    f.reset(); f.noise(0, 0.3);
    const far = f.level(0);
    f.reset();
    return { near, far, clear };
  });
  check('lights-out: noise near an unaware trooper fills the meter', r.near > 0.25, r);
  check('lights-out: ...and noise nobody is near enough to hear does not', !r.clear || r.far === 0, r);
}

{
  // an engaged trooper who lives three seconds calls it in
  const r = await page.evaluate(() => {
    window.__alive();
    const g = window.__game, s = g.campaign.section, t = s.test;
    const p = g.players[0];
    const pt = t.patrols.find((x) => x.e.alive);
    if (!pt) return { none: true };
    const e = pt.e;
    // just him, calm again: nobody else already on the radio
    for (const o of g.enemies) if (o !== e) o.removeMe = true;
    // on open ground, facing up the yard, holding still
    const Y0 = s.floorY;
    const spot = e.position.clone().set(-12, Y0, 20);
    pt.route = [spot.clone()]; pt.i = 0; pt.step = 1;
    window.__step(3, null, () => {
      e.position.copy(spot); e.velocity.set(0, 0, 0); e.facingYaw = 0; e.awareness = 'idle';
      p.position.set(-12, Y0, 60);
    });
    let tripped = -1, spotted = -1;
    window.__step(150, null, (gg, f) => {
      if (spotted < 0 && e.awareness === 'engaged') spotted = f;
      const fx = Math.sin(e.facingYaw), fz = Math.cos(e.facingYaw);
      p.position.set(e.position.x + fx * 5, e.position.y, e.position.z + fz * 5);
      p.velocity.set(0, 0, 0);
      p.hp = 100;
      if (tripped < 0 && t.alarm) tripped = f;
    });
    return { engaged: e.awareness, spotted, tripped, reason: s.debug().tripReason };
  });
  check('lights-out: a trooper who sees you radios it in after about three seconds',
    r.reason === 'radio' && r.spotted >= 0 && r.tripped - r.spotted > 80 && r.tripped - r.spotted < 100, r);
}

{
  const r = await page.evaluate(() => window.__resetAlarm());
  check('lights-out: the alarm drop lands and can be killed', r.cleared, r);
  check('lights-out: holding a console resets the alarm, meters empty', r.reset && r.meter === 0, r);
}

{
  // a searchlight turned on a player standing in the open fills the meter and trips the alarm
  const r = await page.evaluate(() => {
    window.__alive();
    const g = window.__game, s = g.campaign.section, t = s.test;
    for (const e of g.enemies) e.removeMe = true;
    const p = g.players[0], Y0 = s.floorY;
    t.field.reset();
    const at = { x: -12, z: 12 };
    let first = -1;
    window.__step(60, null, (gg, f) => {
      p.position.set(at.x, Y0, at.z); p.velocity.set(0, 0, 0);
      for (const sl of t.searchlights) { sl.aim.set(at.x, Y0, at.z); sl.path = [sl.aim.clone()]; }
      if (first < 0 && t.alarm) first = f;
    });
    return { alarm: t.alarm, first, reason: s.debug().tripReason, alive: p.alive };
  });
  check('lights-out: a searchlight on you fills the meter and trips the alarm', r.alarm && r.reason === 'seen', r);
  check('lights-out: ...in about the design\'s 0.6 s (well under 1.5 s)', r.first > 0 && r.first < 45, `${r.first} frames`);
  const r2 = await page.evaluate(() => window.__resetAlarm());
  check('lights-out: and it resets again', r2.reset, r2);
}

{
  // steam: a searchlight cannot see through a blowing vent
  const r = await page.evaluate(() => {
    window.__alive();
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    const v = t.vents[0];
    t.field.reset();
    // from the start of a puff: wait for it to stop, then to start
    let n = 0;
    while (v.mask.on && n++ < 400) window.__step(1, null, () => { p.position.set(-36, Y0, 6); });
    while (!v.mask.on && n++ < 800) window.__step(1, null, () => { p.position.set(-36, Y0, 6); });
    let frames = 0;
    window.__step(40, null, () => {
      if (!v.mask.on) return;
      frames++;
      p.position.set(v.pos.x, Y0, v.pos.z); p.velocity.set(0, 0, 0);
      for (const sl of t.searchlights) { sl.aim.set(v.pos.x, Y0, v.pos.z); sl.path = [sl.aim.clone()]; }
    });
    return { frames, meter: t.field.level(0), alarm: t.alarm };
  });
  check('lights-out: steam from a vent blocks the searchlight', r.frames > 10 && r.meter < 0.2 && !r.alarm, r);
}

{
  // the booth kills every searchlight for ten seconds
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    window.__step(40, { ...window.__blank, interactHeld: true }, () => { p.position.set(10.2, Y0 + 3, 3.5); p.velocity.set(0, 0, 0); });
    const off = t.lightsOff;
    const conesOff = t.searchlights.every((sl) => !sl.cone.on);
    window.__step(330, null, () => { p.position.set(10.2, Y0 + 3, 3.5); p.velocity.set(0, 0, 0); });
    const back = t.searchlights.every((sl) => sl.cone.on);
    return { off, conesOff, back };
  });
  check('lights-out: the booth kills the searchlights', r.off > 8 && r.conesOff, r);
  check('lights-out: ...and they come back after ten seconds', r.back, r);
}

// ------------------------------------------------------------ The Line
await boot('the-line');
await page.evaluate(([b, fn]) => { window.__blank = b; (0, eval)(fn); }, [blankInput(), stepFn]);
await page.evaluate(() => window.__step(90, null));

{
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    for (const e of g.enemies) e.removeMe = true;
    const p = g.players[0];
    // stand on belt 3 (the fastest) in the first bay, in a gap between crates
    const x = t.BELT_X[3];
    for (const c of t.crates) if (c.belt === 3) c.z = 80;
    p.position.set(x, Y0 + t.BELT_TOP + 0.05, 8); p.velocity.set(0, 0, 0);
    window.__step(10, null);
    const z0 = p.position.z;
    window.__step(30, null);
    const carried = p.position.z - z0;
    return { carried, speed: t.beltSpeed(3) };
  });
  check('the-line: a belt carries whoever stands on it', r.carried > r.speed * 0.8 && r.carried < r.speed * 1.3, r);
}

{
  // a press slamming on you hurts and throws you back out upstream
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    const pr = t.presses.find((q) => q.frame === 0 && q.belt === 0);
    const fz = t.FRAMES[0] + t.FRAME_D / 2;
    // wait for its warning, then stand under it
    let n = 0;
    while (pr.phase !== 'warn' && n++ < 400) window.__step(1, null, () => { p.position.set(-11, Y0, 0); p.hp = 100; });
    const hp0 = p.hp;
    let hit = false, hp = 100, z = 0;
    window.__step(60, null, () => {
      if (!hit && p.hp < hp0) { hit = true; hp = p.hp; z = p.position.z; }
      if (!hit) { p.position.set(t.BELT_X[0], Y0 + t.BELT_TOP + 0.05, fz); p.velocity.set(0, 0, 0); }
    });
    return { hit, hp, z, fz };
  });
  check('the-line: a press coming down on you hurts', r.hit && r.hp < 90, r);
  check('the-line: ...and spits you out upstream, not through', r.z < r.fz - 1, r);
}

{
  // the brake: a switch on the catwalk holds the press row ahead open
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    const sw = t.switches[0];
    window.__step(60, { ...window.__blank, interactHeld: true }, () => { p.position.copy(sw.at); p.velocity.set(0, 0, 0); p.hp = 100; });
    const held = t.holdLeft.press0;
    let allOpen = true;
    window.__step(200, null, () => {
      p.position.copy(sw.at); p.velocity.set(0, 0, 0);
      for (const q of t.presses) if (q.frame === 0 && q.bottom < 2) allOpen = false;
    });
    return { held, allOpen };
  });
  check('the-line: a brake switch holds its press row open', r.held > 10 && r.allOpen, r);
}

{
  // a welding arm knocks a belt rider about; the floor lanes pass under it
  const r = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, t = s.test, Y0 = s.floorY;
    const p = g.players[0];
    t.holdLeft.arms = 0;
    const a = t.arms[0];
    // the point on belt 2 the arm's boom crosses at the middle of its swing
    const x = t.BELT_X[2];
    const z = a.z;
    let beltHit = false, floorHit = false;
    let hp = 100;
    window.__step(120, null, () => {
      p.hp = Math.min(p.hp, 100);
      if (p.hp < hp - 5) beltHit = true;
      hp = 100; p.hp = 100;
      p.position.set(x, Y0 + t.BELT_TOP + 0.02, z); p.velocity.set(0, 0, 0);
    });
    hp = 100; p.hp = 100;
    let at = null;
    window.__step(120, null, () => {
      if (p.hp < hp - 5 && !floorHit) { floorHit = true; at = [p.position.x, p.position.y - Y0, p.position.z]; }
      hp = 100; p.hp = 100;
      p.position.set(4.8, Y0, z); p.velocity.set(0, 0, 0);
    });
    return { beltHit, floorHit, at };
  });
  check('the-line: a welding arm hits whoever rides the belt at waist height', r.beltHit, r);
  check('the-line: ...and passes over whoever is on the floor lane', !r.floorHit, r);
}

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('refinery sections');
