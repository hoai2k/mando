/**
 * One Way Out's own checks (src/sections/one-way-out.ts), past what
 * test-sections covers:
 *
 * - two players stepping into the stair core on the same frame end it once,
 *   with one score banner;
 * - the ten-or-more reward reaches the next stage: a waived lieutenant's
 *   phase turn calls no backup and says the section's line instead, and the
 *   waiver is for its own stage only (an unwaived turn still brings them).
 *
 * Run:  node tools/test-section-one-way-out.mjs     (HARNESS_PORT, CHROMIUM_PATH as usual)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${PORT}/?section=one-way-out`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 2, 'narkina', ['din', 'maul']);

// ---- the finish, once ----
const finish = await page.evaluate(async (blank) => {
  const g = window.__game, c = g.campaign, s = c.section;
  const Y0 = s.floorY;
  const said = [];
  const announce = g.announce.bind(g);
  g.announce = (t, sub) => { said.push(String(t)); return announce(t, sub); };
  // drive the autopilot until the stairs are open and their squad is down
  for (let f = 0; f < 240 * 30; f++) {
    const d = s.debug();
    const held = g.enemies.some((e) => e.alive && e.team === 1 && e.position.z > 18);
    if (d.stairOpen && !held) break;
    const inputs = [0, 1, 2, 3].map((slot) => {
      const p = g.players[slot]; if (!p) return blank;
      const a = s.autopilot(slot) || {};
      if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
      const { yaw, ...r } = a; return { ...blank, ...r };
    });
    g.update(1 / 30, inputs);
    if (f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  for (let f = 0; f < 4; f++) {
    for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    g.update(1 / 30, [blank, blank]);
  }
  const open = s.debug().stairOpen;
  // both players into the core on the same frame
  g.players.forEach((p, i) => { p.position.set(i ? 1 : -1, Y0 + 0.1, 23.5); p.velocity.set(0, 0, 0); });
  const before = said.length;
  g.update(1 / 30, [blank, blank]);
  g.update(1 / 30, [blank, blank]);
  const scores = said.slice(before).filter((t) => /brought out/.test(t));
  return { open, complete: s.complete, scores };
}, blankInput());
check('the stair core opened', finish.open);
check('two players in the core on one frame: it ends', finish.complete);
check('with one score banner, not one per player', finish.scores.length === 1, finish.scores);

// ---- the reward reaching the next stage ----
await page.goto(`http://localhost:${PORT}/?section=one-way-out`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 1, 'narkina', ['din']);
const reward = await page.evaluate((blank) => {
  const g = window.__game, c = g.campaign;
  const out = {};
  // boss phases only run once the match is fighting
  for (let f = 0; f < 30 * 30 && g.state !== 'fighting'; f++) g.update(1 / 30, [blank]);
  out.state = g.state;
  const banners = [];
  const banner = g.events.banner;
  g.events.banner = (t, sub) => { banners.push(String(sub)); return banner?.call(g.events, t, sub); };
  // a waiver for a later stage does nothing here
  c.waiveRetinue(c.stageIdx + 1, 'held');
  out.laterStage = c.retinueWaived();
  // for this stage it answers with its line
  c.waiveRetinue(c.stageIdx, 'held');
  out.thisStage = c.retinueWaived();
  // the lieutenant's first phase turn under the waiver: no backup
  const p = g.players[0];
  const boss = g.spawnBoss(p.position.clone().add(p.position.clone().set(0, 0, 8)), 'mid');
  g.bossIntroT = 0;
  const count = () => g.enemies.filter((e) => e.alive && e.team === 1 && e !== boss).length;
  const n0 = count();
  boss.hp = boss.maxHp * 0.6;
  g.update(1 / 30, [blank]);
  out.addedWaived = count() - n0;
  out.bannerWaived = banners[banners.length - 1];
  // lift the waiver (it names another stage now) and take him through the second turn
  c.waiveRetinue(c.stageIdx + 5, 'held');
  const n1 = count();
  boss.hp = boss.maxHp * 0.3;
  g.update(1 / 30, [blank]);
  out.addedUnwaived = count() - n1;
  return out;
}, blankInput());
check('the match is fighting', reward.state === 'fighting', reward.state);
check('a waiver for the next stage is not this stage\'s', reward.laterStage === null, reward.laterStage);
check('a waiver for this stage answers with its line', reward.thisStage === 'held', reward.thisStage);
check('the waived lieutenant\'s phase turn brings no backup', reward.addedWaived === 0, reward.addedWaived);
check('and says the section\'s line instead', reward.bannerWaived === 'held', reward.bannerWaived);
check('an unwaived phase turn still brings the retinue', reward.addedUnwaived >= 3, reward.addedUnwaived);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('one-way-out');
