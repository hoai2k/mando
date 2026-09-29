/**
 * The Mark Runs' own mechanics (docs/LEVEL_SECTIONS.md §2.16) and the K8
 * pursuit kit it is built on (src/sections/kit/pursuit.ts).
 *
 *   - he gets away past the escape distance for the escape time (60 m / 8 s,
 *     75 m / 10 s alone), and the chase restarts from the checkpoint roof
 *   - at a fork he takes the way with the fewest hunters nearest it
 *   - a blaster hit staggers him and costs bounty value; a hand on him
 *     staggers him for free; a scripted removal-sized hit does nothing
 *   - a net stops him in the chase; on the pad a net takes him only once he
 *     is under half; taken, he is out of the fight and the stair ends it
 *   - shot dead on the pad is still a clear
 *   - a fall re-forms you on a roof
 *
 * Run:  HARNESS_PORT=4217 node tools/test-section-mark-runs.mjs
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
  await page.goto(`http://localhost:${PORT}/?section=mark-runs`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', chars.length, 'ringworld', chars);
  // until the match is fighting and the section has stood up its mark
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => !!window.__game.campaign.section?.testKit?.runner)) return;
    await step(15);
  }
  throw new Error('the section never stood up its mark');
}

/** step the game `frames` at 1/30 s with no input (or the autopilot) */
async function step(frames, { auto = false, cull = true } = {}) {
  return page.evaluate(async ([blank, frames, auto, cull]) => {
    const g = window.__game, c = g.campaign;
    for (let f = 0; f < frames; f++) {
      const s = c.section;
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot];
        if (!p || !s || !auto) return blank;
        const a = s.autopilot(slot) || {};
        if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
        const { yaw, ...rest } = a; void yaw;
        return { ...blank, ...rest };
      });
      g.update(1 / 30, inputs);
      if (cull && f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1 && e !== s?.testKit?.mark) e.damage(9999999, e.position, 0);
      if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }, [blank, frames, auto, cull]);
}

const kit = (fn, arg) => page.evaluate(([src, arg]) => {
  const k = window.__game.campaign.section.testKit;
  // eslint-disable-next-line no-new-func
  return new Function('k', 'g', 'arg', src)(k, window.__game, arg);
}, [fn, arg]);

// ---------------------------------------------------------------- escape
for (const chars of [['din'], ['din', 'maul']]) {
  await boot(chars);
  const solo = chars.length === 1;
  // stand still and let him go
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit;
    let firstPast = -1, restartAt = -1, farthest = 0, dist = k.runner.opts.escape.dist;
    for (let f = 0; f < 30 * 90; f++) {
      g.update(1 / 30, [blank, blank, blank, blank]);
      const run = k.runner;
      if (run.gap > dist && firstPast < 0) firstPast = f / 30;
      if (run.gap <= dist && firstPast >= 0 && run.escapeT === 0 && restartAt < 0) firstPast = -1;
      farthest = Math.max(farthest, run.from);
      if (restartAt < 0 && run.state === 'hold' && run.from === 0 && farthest > 2) { restartAt = f / 30; break; }
    }
    const p = g.players[0];
    return { firstPast, restartAt, dist, secs: k.runner.opts.escape.secs, phase: k.phase,
      roof: k.roofAt(p.position.x, p.position.z, p.position.y), checkpoint: k.checkpoint };
  }, [blank]);
  const held = r.restartAt - r.firstPast;
  check(`escape (${chars.length}p): the distance and time are ${solo ? '75 m / 10 s' : '60 m / 8 s'}`,
    r.dist === (solo ? 75 : 60) && r.secs === (solo ? 10 : 8), JSON.stringify(r));
  check(`escape (${chars.length}p): he gets away only after the full clock past the line`,
    r.restartAt > 0 && held >= r.secs - 0.1, `past the line at ${r.firstPast.toFixed(1)} s, restart at ${r.restartAt.toFixed(1)} s`);
  check(`escape (${chars.length}p): the chase restarts on the checkpoint roof`,
    r.roof === 0 && r.phase === 'chase', JSON.stringify(r));
  await step(30 * 3);
  const going = await kit('return k.runner.state');
  check(`escape (${chars.length}p): and he runs again after a breath`, going !== 'hold', going);
}

// ---------------------------------------------------------------- forks
await boot(['din', 'maul']);
for (const [crowd, want] of [[7, 4], [4, 7]]) {
  const r = await page.evaluate(async ([blank, crowd]) => {
    const g = window.__game, k = g.campaign.section.testKit;
    // both hunters stand at the landing of one way on; he is set running on the roof before the fork
    const at = k.nodes[crowd].at;
    g.players.forEach((p, i) => { p.position.set(at.x + 1.5 * i, at.y + 0.1, at.z + 2); p.velocity.set(0, 0, 0); });
    k.runner.placeAt(2, false);
    let to = -1;
    for (let f = 0; f < 30 * 12 && to < 0; f++) {
      g.update(1 / 30, [blank, blank, blank, blank]);
      g.players.forEach((p, i) => { p.position.set(at.x + 1.5 * i, at.y + 0.1, at.z + 2); p.velocity.set(0, 0, 0); });
      if (k.runner.from === 3 && k.runner.to !== 3) to = k.runner.to;
    }
    return to;
  }, [blank, crowd]);
  check(`fork: with the hunters on the ${crowd === 7 ? 'low' : 'high'} roof he takes the ${want === 4 ? 'high' : 'low'} one`, r === want, `took node ${r}`);
}

// ---------------------------------------------------------------- hits
await boot(['din', 'maul']);
await step(30 * 4);
{
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit, m = k.mark, run = k.runner;
    const out = {};
    // make sure he is running, and the shooter is well back
    for (let f = 0; f < 90 && run.state !== 'run'; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    const far = g.players[0];
    far.position.set(m.position.x - 25, m.position.y + 0.1, m.position.z);
    out.v0 = k.value;
    m.damage(34, m.position.clone().setX(m.position.x - 1), 0);
    out.boltState = run.state; out.v1 = k.value; out.alive = m.alive;
    // the guard, then a hand on him
    for (let f = 0; f < 30 * 3.5; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    const near = g.players[1];
    near.position.set(m.position.x - 1.5, m.position.y + 0.1, m.position.z);
    const guardOk = run.state === 'run' || run.state === 'leap';
    // a melee blow: the player's melee pipeline asks the section first, then lands
    const dmg = near.sectionMove.meleeHit(near, m, 32, g);
    m.damage(dmg, near.position.clone(), 1);
    out.handState = guardOk ? run.state : `not running (${run.state})`; out.v2 = k.value;
    // point-blank blaster fire is still gunfire: it costs
    for (let f = 0; f < 30 * 3.5; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    near.position.set(m.position.x - 1.5, m.position.y + 0.1, m.position.z);
    m.damage(34, near.position.clone(), 1);
    out.vPointBlank = k.value;
    // a removal-sized hit is not a hit
    for (let f = 0; f < 30 * 3.5; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    const before = run.state;
    m.damage(9999999, m.position, 0);
    out.cullState = [before, run.state]; out.v3 = k.value; out.alive2 = m.alive; out.hp = m.hp;
    return out;
  }, [blank]);
  check('a blaster hit staggers him and costs bounty', r.boltState === 'stagger' && r.v1 < r.v0 && r.alive, JSON.stringify(r));
  check('a melee blow on him staggers him for free', r.handState === 'stagger' && r.v2 === r.v1, JSON.stringify(r));
  check('point-blank blaster fire still costs bounty', r.vPointBlank < r.v2, JSON.stringify(r));
  check('a removal-sized hit does nothing to him', r.alive2 && r.v3 === r.vPointBlank && r.cullState[0] === r.cullState[1], JSON.stringify(r));
}

// ---------------------------------------------------------------- the net, in the chase
{
  await step(30 * 3);
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit, m = k.mark, run = k.runner;
    for (let f = 0; f < 120 && run.state !== 'run'; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    k.arm(0);
    const p = g.players[0];
    // ten metres behind him, looking at him
    const dx = run.legTo.x - run.legFrom.x, dz = run.legTo.z - run.legFrom.z, l = Math.hypot(dx, dz) || 1;
    p.position.set(m.position.x - dx / l * 10, m.position.y + 0.1, m.position.z - dz / l * 10);
    p.velocity.set(0, 0, 0);
    p.cam.yaw = Math.atan2(m.position.x - p.position.x, m.position.z - p.position.z);
    const n0 = k.nets()[0];
    k.fireNet(0);
    let snared = false;
    for (let f = 0; f < 45 && !snared; f++) {
      g.update(1 / 30, [blank, blank, blank, blank]);
      if (run.state === 'snared') snared = true;
    }
    return { snared, n0, n1: k.nets()[0], state: run.state };
  }, [blank]);
  check('a net stops him in the chase, and uses one net', r.snared && r.n1 === r.n0 - 1, JSON.stringify(r));
}

// ---------------------------------------------------------------- the pad
async function toThePad() {
  return page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit, run = k.runner;
    const pad = k.nodes[28].at;
    run.placeAt(26, false);
    for (let f = 0; f < 30 * 15 && k.phase !== 'duel'; f++) {
      // the party waits on the pad, so he never gets away
      g.players.forEach((p, i) => { p.position.set(pad.x - 8, pad.y + 0.1, pad.z - 6 + i * 3); p.velocity.set(0, 0, 0); });
      g.update(1 / 30, [blank, blank, blank, blank]);
    }
    return { phase: k.phase, hp: k.mark.hp, maxHp: k.mark.maxHp, sign: k.signState() };
  }, [blank]);
}
await boot(['din', 'maul']);
{
  const d = await toThePad();
  check('at the end of his route he turns and fights on the pad', d.phase === 'duel' && d.maxHp >= 700, JSON.stringify(d));
  await step(30 * 2);
  const sign = await kit('return k.signState()');
  check('the sign over the last gap drops as he lands', sign === 'down' || sign === 'falling', sign);
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit, m = k.mark;
    const out = {};
    k.netHit(0);
    out.fullNet = k.phase;
    for (let f = 0; f < 30 * 3; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    m.hp = m.maxHp * 0.4;
    const v = k.value;
    k.netHit(0);
    out.weakNet = k.phase; out.team = m.team; out.alive = m.alive; out.valueKept = k.value === v;
    m.damage(9999, m.position, 0);
    out.after = m.alive;
    return out;
  }, [blank]);
  check('on the pad a net at full strength only holds him', r.fullNet === 'duel', JSON.stringify(r));
  check('under half, a net takes him alive, out of the fight', r.weakNet === 'taken' && r.team === 0 && r.alive && r.after && r.valueKept, JSON.stringify(r));
  const done = await page.evaluate(async ([blank]) => {
    const g = window.__game, c = g.campaign, from = c.stageIdx;
    for (let f = 0; f < 30 * 30; f++) {
      const s = c.section;
      if (c.stageIdx !== from && !c.section) return { advanced: true };
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot];
        if (!p || !s) return blank;
        const a = s.autopilot(slot) || {};
        if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
        const { yaw, ...rest } = a; void yaw;
        return { ...blank, ...rest };
      });
      g.update(1 / 30, inputs);
    }
    return { advanced: false, obj: c.section?.objective().label };
  }, [blank]);
  check('taken, the pad\'s stair down carries the run on', done.advanced, JSON.stringify(done));
}

await boot(['din', 'maul']);
{
  await toThePad();
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit, m = k.mark;
    const p = g.players[0];
    const v0 = k.value;
    for (let i = 0; i < 60 && m.alive; i++) {
      p.position.set(m.position.x - 20, m.position.y + 0.1, m.position.z);
      m.damage(200, m.position.clone().setX(m.position.x - 1), 0);
      g.update(1 / 30, [blank, blank, blank, blank]);
    }
    for (let f = 0; f < 10; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    return { phase: k.phase, alive: m.alive, v0, v1: k.value, obj: g.campaign.section.objective().label };
  }, [blank]);
  check('shot dead on the pad is still a clear, and blaster fire cost bounty', r.phase === 'dead' && !r.alive && r.v1 < r.v0 && r.obj === 'the stair down', JSON.stringify(r));
}

// ---------------------------------------------------------------- the whole run, by the autopilot
await boot(['din', 'maul']);
{
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, c = g.campaign;
    for (let f = 0; f < 30 * 200; f++) {
      const s = c.section;
      const k = s?.testKit;
      if (!k) return { gone: true };
      if (k.phase === 'taken' || k.phase === 'dead') return { phase: k.phase, value: k.value, t: f / 30 };
      const inputs = [0, 1, 2, 3].map((slot) => {
        const p = g.players[slot];
        if (!p) return blank;
        const a = s.autopilot(slot) || {};
        if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
        const { yaw, ...rest } = a; void yaw;
        return { ...blank, ...rest };
      });
      g.update(1 / 30, inputs);
      if (f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1 && e !== k.mark) e.damage(9999999, e.position, 0);
      if (f % 300 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    return { timeout: true };
  }, [blank]);
  check('the autopilot takes him alive at the full bounty (hands and nets, no gunfire)',
    r.phase === 'taken' && r.value >= 0.85, JSON.stringify(r));
}

// ---------------------------------------------------------------- falling
await boot(['din', 'maul']);
{
  await step(30 * 3);
  const r = await page.evaluate(async ([blank]) => {
    const g = window.__game, k = g.campaign.section.testKit;
    const p = g.players[1];
    p.position.y -= 30;
    for (let f = 0; f < 3; f++) g.update(1 / 30, [blank, blank, blank, blank]);
    return { roof: k.roofAt(p.position.x, p.position.z, p.position.y), alive: p.alive, y: p.position.y };
  }, [blank]);
  check('a fall off the roofs re-forms you on a roof', r.roof >= 0, JSON.stringify(r));
}

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
