/**
 * Tram Top's own mechanics (docs/LEVEL_SECTIONS.md §2.15), on K1 and K2.
 *
 *   - the tram does not leave the stop until every hunter is aboard
 *   - the sticks follow the screen: right is along the train
 *   - a gantry sweeps a standing hunter off the roof, passes over a ducking
 *     one, and sweeps a hostile standing on the roof
 *   - the station: the tram stops dead at the platform, the doors open, and it
 *     leaves 30 s later with them shut
 *   - the tunnel: nobody stays on the roof under it; the fallen re-form inside
 *     the rear car while it is over them, on the rear roof otherwise
 *   - the rival: shooting out its coupling cuts it loose; anyone still on it
 *     is put back aboard as it peels off
 *   - the terminus: the tram stops at its platform and the gate carries the
 *     run on
 *
 * Run:  HARNESS_PORT=4217 node tools/test-section-tram-top.mjs
 */
import { launch, blankInput } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
const blank = blankInput();

async function boot(chars) {
  await page.goto(`http://localhost:${PORT}/?section=tram-top`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', chars.length, 'ringworld', chars);
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(([blank]) => {
      const g = window.__game;
      g.update(1 / 30, [blank, blank, blank, blank]);
      return !!g.campaign.section?.testKit && g.campaign.section.debug().blend > 0;
    }, [blank]);
    if (ok) return;
    await page.evaluate(([blank]) => { for (let f = 0; f < 15; f++) window.__game.update(1 / 30, [blank, blank, blank, blank]); }, [blank]);
  }
  throw new Error('the section never stood up');
}

/** run the page-side body `src` with (g, k, blank, arg) */
const run = (src, arg) => page.evaluate(async ([src, blank, arg]) => {
  const g = window.__game, k = g.campaign.section.testKit;
  // eslint-disable-next-line no-new-func
  return await new Function('g', 'k', 'blank', 'arg', `return (async () => { ${src} })()`)(g, k, blank, arg);
}, [src, blank, arg]);

// helpers, defined page-side each call
const H = `
  const step = (n, fn) => { for (let f = 0; f < n; f++) { fn?.(f); g.update(1 / 30, [blank, blank, blank, blank]); } };
  const cull = () => { for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0); };
  const toRoof = (p, x, z = 0) => { p.position.set(x, k.roofY + 0.05, z); p.velocity.set(0, 0, 0); };
  const hold = (x, z = 0) => g.players.forEach((p, i) => toRoof(p, x + i * 1.5, z));
  const ff = (to, speed = 60) => {
    // fast-forward the line to odometer \`to\`, the party held on the middle car
    k.mill.setSpeed(speed, 0);
    for (let f = 0; f < 30 * 120 && k.mill.travelled < to - speed / 30; f++) { hold(-2); g.update(1 / 30, [blank, blank, blank, blank]); if (f % 30 === 0) cull(); }
    k.mill.setSpeed(10, 0);
  };
`;

// ---------------------------------------------------------------- boarding
await boot(['din', 'maul']);
{
  const r = await run(`${H}
    const out = {};
    // one aboard, one left on the platform: the tram waits
    toRoof(g.players[0], 0);
    const plat = g.players[1];
    step(90, () => { toRoof(g.players[0], 0); plat.position.set(3, k.floorY + 0.05, -6.5); plat.velocity.set(0, 0, 0); });
    out.waiting = k.phase; out.speed0 = k.mill.speed;
    // now both: it pulls out
    step(150, () => { hold(0); });
    out.after = k.phase; out.speed1 = k.mill.speed;
    out.moveYaw = g.players[0].moveYaw;
    // keep the Enemy class for posting a hostile of our own later
    const any = g.enemies.find((e) => e.team === 1);
    window.__EnemyCtor = any?.constructor ?? null;
    out.ctor = !!window.__EnemyCtor;
    return out;
  `);
  check('the tram waits at the stop until every hunter is aboard', r.waiting === 'board' && r.speed0 === 0, JSON.stringify(r));
  check('and pulls out once they are', r.after === 'run' && r.speed1 > 1, JSON.stringify(r));
  check('the sticks follow the screen: stick right runs along the train', -Math.cos(r.moveYaw) > 0.9, String(r.moveYaw));
}

// ---------------------------------------------------------------- gantries
{
  const r = await run(`${H}
    const out = {};
    ff(${420 - 60});
    // a hostile on the rear car's roof, and one hunter standing, one ducking, both on the front car
    const e = g.campaign.section.testKit && g.enemies.find(() => false);
    void e;
    const stand = g.players[0], duck = g.players[1];
    const hp0 = [stand.hp, duck.hp];
    let foe = null;
    if (window.__EnemyCtor) {
      foe = new window.__EnemyCtor('pirate', g.players[0].position.clone().set(-16, k.roofY + 0.2, 0), 1, { silent: true });
      foe.position.set(-16, k.roofY + 0.2, 0);
      g.addEnemy(foe);
    }
    for (let f = 0; f < 30 * 16; f++) {
      toRoof(duck, 14, -0.9);
      if (f < 30 * 4) toRoof(stand, 14, 0.9);
      const inputs = [blank, { ...blank, interactHeld: true }, blank, blank];
      g.update(1 / 30, inputs);
      if (k.gantryX(0) < -30) break;
    }
    out.stand = { hp: stand.hp, hp0: hp0[0], roof: k.onRoof(0), swept: k.swept()[0] };
    out.duck = { hp: duck.hp, hp0: hp0[1], roof: k.onRoof(1), ducking: k.ducking()[1], swept: k.swept()[1] };
    out.passed = k.gantryX(0);
    out.foe = foe ? { alive: foe.alive } : null;
    return out;
  `);
  check('a gantry sweeps a standing hunter off the roof', r.stand.swept > 0 && !r.stand.roof, JSON.stringify(r.stand));
  check('and passes over a ducking one', r.duck.swept === 0 && r.duck.roof && r.duck.ducking, JSON.stringify(r.duck));
  check('and sweeps a hostile standing on the roof', r.foe && !r.foe.alive, JSON.stringify(r.foe));
}
// ---------------------------------------------------------------- the station
{
  const r = await run(`${H}
    const out = {};
    ff(1100);
    let stopped = -1;
    for (let f = 0; f < 30 * 40; f++) {
      hold(-2);
      g.update(1 / 30, [blank, blank, blank, blank]);
      if (f % 30 === 0) cull();
      if (k.phase === 'station' && stopped < 0) { stopped = f / 30; out.at = k.mill.travelled; out.doors = k.doors.every((d) => !d.box); }
      if (stopped >= 0) break;
    }
    const t0 = stopped;
    let left = -1;
    for (let f = 0; f < 30 * 40; f++) {
      hold(-2);
      g.update(1 / 30, [blank, blank, blank, blank]);
      if (f % 30 === 0) cull();
      if (k.phase !== 'station') { left = f / 30; break; }
    }
    step(60, () => hold(-2));
    out.left = left; out.shut = k.doors.every((d) => !!d.box); out.speed = k.mill.speed;
    return out;
  `);
  check('the tram stops dead at the station, doors open', Math.abs(r.at - 1200) < 0.05 && r.doors, JSON.stringify(r));
  check('and leaves 30 s later with the doors shut', Math.abs(r.left - 30) < 0.5 && r.shut && r.speed > 1, JSON.stringify(r));
}

// ---------------------------------------------------------------- the tunnel
{
  const r = await run(`${H}
    const out = {};
    ff(1400);
    // stay on the roof, whatever the horn says
    let inside = null;
    for (let f = 0; f < 30 * 30; f++) {
      g.update(1 / 30, [blank, blank, blank, blank]);
      if (f % 30 === 0) cull();
      if (k.tunnelMouth() < -30 && inside === null) {
        inside = [0, 1].map((i) => k.insideCar(i));
        out.onRoofUnder = [0, 1].some((i) => k.onRoof(i));
        // and the fallen re-form inside the rear car while the tunnel is over it
        const spot = g.campaign.section.respawnSpot(1);
        out.respawnY = spot.y - k.floorY;
        break;
      }
    }
    out.inside = inside;
    return out;
  `);
  check('under the tunnel nobody is left on the roof: the portal drops them inside', r.inside?.every(Boolean) && !r.onRoofUnder, JSON.stringify(r));
  check('while the tunnel is over the rear car, the fallen re-form inside it', r.respawnY < 1, JSON.stringify(r));
}

// ---------------------------------------------------------------- the rival
{
  const r = await run(`${H}
    const out = {};
    // out of the tunnel and on to the rival
    for (let f = 0; f < 30 * 90 && k.rival.state !== 'alongside'; f++) {
      hold(-2);
      g.update(1 / 30, [blank, blank, blank, blank]);
    }
    out.state0 = k.rival.state;
    // one hunter across on its roof; the other shoots out the coupling
    const across = g.players[1];
    across.position.set(k.rival.x + 6, k.roofY + 0.1, k.rival.z);
    across.velocity.set(0, 0, 0);
    step(10, () => toRoof(g.players[0], -2));
    out.onRival = k.onRival(1);
    g.hurtBreakable(k.coupling, 1e6);
    out.state1 = k.rival.state;
    for (let f = 0; f < 30 * 8; f++) { toRoof(g.players[0], -2); g.update(1 / 30, [blank, blank, blank, blank]); }
    out.back = k.onRoof(1) || k.insideCar(1);
    out.state2 = k.rival.state;
    return out;
  `);
  check('the pirate tram pulls alongside', r.state0 === 'alongside', JSON.stringify(r));
  check('a hunter can stand on it', r.onRival, JSON.stringify(r));
  check('shooting out its coupling cuts it loose', r.state1 === 'peeling', JSON.stringify(r));
  check('anyone still on it is put back aboard as it peels off', r.back && (r.state2 === 'gone' || r.state2 === 'peeling'), JSON.stringify(r));
}

// ---------------------------------------------------------------- the terminus
{
  const r = await run(`${H}
    const out = {};
    for (let f = 0; f < 30 * 60 && k.phase !== 'terminus'; f++) { hold(-2); g.update(1 / 30, [blank, blank, blank, blank]); }
    out.phase = k.phase; out.at = k.mill.travelled; out.mark = k.terminusMark;
    const gate = k.terminusGate;
    out.gate = !!gate;
    const c = g.campaign, from = c.stageIdx;
    for (let f = 0; f < 30 * 10; f++) {
      g.players.forEach((p, i) => { p.position.set(gate.x + i * 0.4, k.floorY + 0.05, gate.z + 0.3); p.velocity.set(0, 0, 0); });
      g.update(1 / 30, [blank, blank, blank, blank]);
      if (c.stageIdx !== from && !c.section) { out.advanced = true; break; }
    }
    return out;
  `);
  check('the tram stops at the terminus platform', r.phase === 'terminus' && Math.abs(r.at - r.mark) < 0.05 && r.gate, JSON.stringify(r));
  check('and the terminus gate carries the run on', r.advanced, JSON.stringify(r));
}

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
