/**
 * Regression test for the game modes (docs/MODES.md): the three-way title,
 * PvP rules (distinct teams, the playable-NPC adapter, squad followers,
 * last-one-standing), the campaign (shared screen, path with door-gated
 * corridors, boss arena, liberation), the wave game's boss wave, and — since
 * the modes became the default — that `?nomodes` still puts the original
 * one-button title back.
 *
 * The headless GPU renders this game at a crawl, so the checks drive the
 * *simulation* directly: `__manual` pauses the live loop and `game.update`
 * is stepped with blank inputs, which covers minutes of match in seconds.
 *
 * Run:  node tools/test-modes.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

// the modes are on by default now, so the plain URL is the mode-select case
const h = await launch({ url: 'http://localhost:4173/' });
const { page } = h;
const sleepFrames = async (n) => { for (let i = 0; i < n; i++) await page.evaluate(() => new Promise(requestAnimationFrame)); };

/** page-side simulation stepper: n fixed ticks with idle sticks */
const STEP = `(n) => {
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, switchPressed:false, pausePressed:false });
  const g = window.__game;
  const inputs = [blank(), blank(), blank(), blank()];
  for (let i = 0; i < n; i++) g.update(1/30, inputs);
}`;

const startMode = async (mode, players, board, chars) => {
  await page.evaluate(([m, n, b, c]) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode(m, n, b, c);
  }, [mode, players, board, chars]);
  await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  await page.evaluate(() => { window.__manual = true; });
};

// ---- the flag's title ----
await sleepFrames(6);
const labels = await page.$$eval('.menu-btn', (els) => els.map((e) => e.textContent).filter(Boolean));
check('the title offers the three modes',
  labels.includes('Wave Battle') && labels.includes('PvP') && labels.includes('Missions'), labels.slice(0, 3).join(','));

// ---- the VS splash (shown between the PvP select and the drop) ----
await page.evaluate(() => {
  const vs = window.__vs;
  const done = vs.onDone;
  vs.onDone = () => {};
  vs.show(['din', 'npc:enforcer']);
  window.__vsCounts = [document.querySelectorAll('.vs-panel').length, document.querySelectorAll('.vs-emblem').length];
  vs.hide();
  vs.onDone = done;
});
const vsCounts = await page.evaluate(() => window.__vsCounts);
check('pvp: the VS splash builds a panel per fighter and a seam emblem',
  vsCounts[0] === 2 && vsCounts[1] === 1, vsCounts.join(','));

// ---- PvP ----
await startMode('pvp', 2, 'desert', ['din', 'npc:tusken']);
let s = await page.evaluate(`(() => {
  const g = window.__game;
  (${STEP})(200);
  return {
    state: g.state, teams: g.players.map((p) => p.team),
    npc: g.players[1].profile.name,
    followers: g.enemies.filter((e) => e.owner).length,
    followerTeam: g.enemies.find((e) => e.owner)?.team,
    hostiles0: g.hostilesFor(g.players[0]).length,
    npcFly: g.players[1].profile.canFly,
  };
})()`);
check('pvp: match opens, every fighter its own team', s.state === 'fighting' && s.teams[0] === 2 && s.teams[1] === 3, JSON.stringify(s.teams));
check('pvp: the NPC adapter fields player two', s.npc === 'Tusken Raider');
check('pvp: a ground NPC does not fly', s.npcFly === false);
check('pvp: squad followers ride their leader\'s team', s.followers === 2 && s.followerTeam === 3, `${s.followers} @ team ${s.followerTeam}`);
check('pvp: rival and their squad are hostile to player one', s.hostiles0 === 3, String(s.hostiles0));
s = await page.evaluate(`(() => {
  const g = window.__game;
  const p2 = g.players[1];
  p2.lives = 0;
  p2.damage(9999, p2.position, 0);
  (${STEP})(200);
  return { state: g.state, winner: g.winnerSlot, p1kills: g.players[0].kills };
})()`);
check('pvp: last fighter standing takes the territory, with credit',
  s.state === 'victory' && s.winner === 0 && s.p1kills >= 1, JSON.stringify(s));

// ---- Campaign ----
await startMode('campaign', 2, 'desert', ['din', 'armorer']);
s = await page.evaluate(`(() => {
  const g = window.__game;
  (${STEP})(120);
  const c = g.campaign;
  return {
    shared: !!g.sharedCam, state: g.state,
    steps: c.steps.map((st) => st.kind).join(','),
    posted: g.enemies.filter((e) => e.alive).length,
    hint: g.hudTopLine(g.players[0]),
  };
})()`);
check('campaign: shared screen, fight open', s.shared && s.state === 'fighting');
check('campaign: path of nodes, two door-gated corridors, boss finale',
  (s.steps.match(/door/g) || []).length === 2 && s.steps.endsWith('boss'), s.steps);
check('campaign: squads posted along the path', s.posted > 10, String(s.posted));
check('campaign: the guide reads a bearing and a distance', / \d+ m$/.test(s.hint), s.hint);
const walk = await page.evaluate(`(() => {
  const g = window.__game;
  const c = g.campaign;
  const out = { corridor: false, phases: 0 };
  let guard = 0;
  while (!c.done && guard++ < 80) {
    const step = c.step;
    for (const p of g.players) {
      p.position.set(step.pos.x, step.pos.y + 0.2, step.pos.z);
      p.velocity.set(0, 0, 0);
      p.hp = p.maxHp; p.alive = true;
    }
    (${STEP})(20);
    if (g.players[0].position.y > 60) out.corridor = true;
    if (c.step.kind === 'boss' && g.boss) {
      // set hp rather than dealing it: this check is about the phase turns,
      // and a warlord can parry a single damage() call (by design)
      g.boss.hp = g.boss.maxHp * 0.6;
      (${STEP})(10);
      out.phases = g.enemies.filter((e) => e.squad >= 9900 && e.squad < 9910).length;
      g.boss.damage(9999999, g.boss.position, 0);   // lethal even through a parry
      (${STEP})(40);
    }
  }
  (${STEP})(10);
  return { ...out, done: c.done, state: g.state };
})()`);
check('campaign: the party goes through a corridor', walk.corridor);
check('campaign: the boss calls its retinue at the health marks', walk.phases > 3, String(walk.phases));
check('campaign: liberation', walk.done && walk.state === 'victory', JSON.stringify(walk));

// ---- Wave boss ----
await startMode('wave', 1, 'desert', ['din']);
const wv = await page.evaluate(`(() => {
  const g = window.__game;
  let guard = 0;
  const bosses = [];
  while (g.state !== 'victory' && guard++ < 80) {
    if (g.boss && g.boss.alive && !bosses.includes(g.boss.bossName)) bosses.push(g.boss.bossName);
    for (const e of g.enemies) if (e.alive) e.damage(999999, e.position, 0);
    g.players[0].hp = g.players[0].maxHp; g.players[0].alive = true;
    (${STEP})(200);
  }
  return { wave: g.wave, boss: g.boss?.bossName, bossHp: g.boss?.maxHp, bosses, state: g.state };
})()`);
// The Dune Sea has a monster, so its run is three battles, not two: the
// champion after wave 4, the warlord after wave 7, and then the thing the
// warlord was standing on top of (docs/BOSSES.md). A board without a monster
// still ends at the warlord — the ?nomodes pass below walks one of those.
check('wave: three boss battles on a monster board — champion, warlord, monster',
  wv.wave === 8 && wv.bosses.length === 3 && !!wv.boss, JSON.stringify(wv));
check('wave: the warlord is a promoted elite', (wv.bossHp ?? 0) > 1000, String(wv.bossHp));
check('wave: the monster is the last of them, at its own boss-scale health',
  wv.boss === 'The Old One of the Dune Sea' && wv.bossHp === 5200, JSON.stringify(wv));
check('wave: its death holds the territory', wv.state === 'victory');

// ---- the escape hatch: ?nomodes is the game as it always was ----
await page.evaluate(() => { window.__manual = false; });
await page.goto('http://localhost:4173/?nomodes');
await sleepFrames(8);
const plain = await page.$$eval('.menu-btn', (els) => els.map((e) => e.textContent).filter(Boolean));
check('?nomodes falls back to the single Press Start',
  plain.includes('Press Start') && !plain.includes('PvP') && !plain.includes('Missions'), plain.slice(0, 3).join(','));

// The final flag-off check navigates the page, which cancels any .glb texture
// still decoding and surfaces as a loader error about a revoked blob URL.
// That is the navigation's doing, not the game's — the same models load clean
// in every suite that stays on the page.
const errors = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
console.log('page errors:', errors.length ? errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\ngame modes: all checks passed');
