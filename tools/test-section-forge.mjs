/**
 * The Great Forge's sections, mechanic by mechanic (docs/SECTIONS_IMPLEMENTATION.md
 * §4 "Great Forge"): K5 (the defended Armorer and the forging bar) in Hold the
 * Forge, and K7 flight in Covert Sky.
 *
 * tools/test-sections.mjs proves the two can be finished; this proves the rules
 * that make them play the way they are written:
 *
 * Hold the Forge
 *  - hostiles prefer the Armorer to a nearer hunter (the target weight)
 *  - the forging stalls while a hostile is within 6 m of her
 *  - a hostile at a bellows breaks it, the forging runs at half speed, and a
 *    held Y mends it
 *  - three shields at most: a fourth folds the oldest
 *  - if she falls the forging drops to its last quarter mark, and she stands
 *    again at her anvil
 *  - finishing gives every hunter +25 max health, which survives a death, the
 *    stage change into Covert Sky, and a respawn there
 *
 * Covert Sky
 *  - the jetpack burns without spending fuel, and flies faster than it runs
 *  - a super-jumper relights the rise in mid-air (the boosters)
 *  - LB boosts, Y dives
 *  - sinking below the rooftops is caught by the updraft: back to the last
 *    ring, in the air, with the banner
 *  - a live gun's flak screen throws you back
 *  - a charge planted on the roof silences a gun; two rockets into the breech
 *    do too, and bolts do not
 *
 * Run:  node tools/test-section-forge.mjs   (HARNESS_PORT, CHROMIUM_PATH as usual)
 */
import { launch, blankInput } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  if (!ok) failures.push(name);
};

const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
const BLANK = blankInput();

async function boot(id, chars) {
  await page.goto(`http://localhost:${PORT}/?section=${id}`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', chars.length, 'forge', chars);
  await page.evaluate((blank) => {
    // step n frames; `input(slot)` gives each player's input
    window.__step = (n, input) => {
      const g = window.__game;
      for (let f = 0; f < n; f++) {
        g.update(1 / 30, [0, 1, 2, 3].map((slot) => ({ ...blank, ...(input ? input(slot, f) ?? {} : {}) })));
      }
    };
    // every banner the match puts up, so a test can ask what was said
    window.__banners = [];
    const g = window.__game;
    const say = g.announce.bind(g);
    g.announce = (t, sub) => { window.__banners.push(`${t} · ${sub ?? ''}`); say(t, sub); };
    window.__banner = () => window.__banners.slice(-4).join(' | ');
  }, BLANK);
}

// ------------------------------------------------------------ Hold the Forge
console.log('\n-- hold-the-forge');
await boot('hold-the-forge', ['din', 'maul']);

// run out the breath before the forging, standing still
const prep = await page.evaluate(() => {
  const s = window.__game.campaign.section;
  window.__forgeStage = window.__game.campaign.stageIdx;
  // the match's own intro comes first; the breath is ~12 s after it
  for (let i = 0; i < 40 && s.probe.phase() === 'prep'; i++) window.__step(30);
  window.__step(30);
  return { phase: s.probe.phase(), progress: s.probe.progress.value };
});
check('the forging starts after the breath to raise shields', prep.phase === 'forging' && prep.progress > 0, prep);

const weight = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  for (const e of g.enemies) if (e.team === 1) e.damage(1e7, e.position, 0);
  const her = P.armorer.body;
  return { weight: her.targetWeight, team: her.team, alive: her.alive, hp: her.hp };
});
check('the Armorer is a team-0 body carrying a target weight', weight.weight > 1 && weight.team === 0 && weight.alive, weight);

const prefer = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const her = P.armorer.body;
  const V = her.position.constructor;
  // a hunter 7 m from the hostile, the Armorer 12 m from it
  const spot = her.position.clone().add(new V(0, 0, 12));
  const p = g.players[0];
  p.position.copy(spot.clone().add(new V(7, 0, 0)));
  g.players[1].position.copy(spot.clone().add(new V(-30, 0, 0)));
  const Enemy = her.constructor;
  let foe = null;
  if (Enemy) {
    const e = new Enemy('alamite', spot, 1, { silent: true });
    g.addEnemy(e);
    foe = e.nearestFoe(g);
    e.damage(1e7, e.position, 0);
  }
  return { picked: foe === her ? 'armorer' : foe === p ? 'hunter' : String(foe && foe.kind) };
});
check('a hostile picks the Armorer over a nearer hunter', prefer.picked === 'armorer', prefer);

const stall = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const her = P.armorer.body;
  const V = her.position.constructor;
  const Enemy = her.constructor;
  window.__step(30);
  const v0 = P.progress.value;
  window.__step(60);
  const running = P.progress.value - v0;
  // a hostile at her side, held there
  const e = new Enemy('alamite', her.position.clone().add(new V(0, 0, 3)), 1, { silent: true });
  e.hp = e.maxHp = 1e9;
  g.addEnemy(e);
  const v1 = P.progress.value;
  window.__step(60, () => { e.position.copy(her.position).add(new V(0, 0, 3)); return {}; });
  const stalled = P.progress.value - v1;
  const flag = P.progress.stalled;
  e.hp = 1; e.damage(1e7, e.position, 0);
  window.__step(10);
  return { running, stalled, flag };
});
check('the forging climbs while the dais is clear', stall.running > 0, stall);
check('and stalls while a hostile is within 6 m of her', stall.stalled === 0 && stall.flag, stall);

const bellows = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const b = P.bellows[0];
  const V = b.at.constructor;
  const Enemy = P.armorer.body.constructor;
  // keep the Armorer clear, so only the bellows slows the forge
  const e = new Enemy('alamite', b.at.clone().add(new V(-1.2, 0, 0)), 1, { silent: true });
  e.hp = e.maxHp = 1e9;
  g.addEnemy(e);
  let steps = 0;
  while (!b.broken && steps < 30 * 30) {
    window.__step(1, () => { e.position.copy(b.at).add(new V(-1.4, 0, 0)); return {}; });
    steps++;
  }
  const broke = b.broken, secs = steps / 30;
  e.hp = 1; e.damage(1e7, e.position, 0);
  window.__step(40);
  const scale = P.progress.scale;
  // mend it: stand at it and hold Y
  const p = g.players[0];
  let hold = 0;
  while (b.broken && hold < 30 * 8) {
    p.position.set(b.at.x - 1.5, b.at.y, b.at.z);
    p.velocity.set(0, 0, 0);
    window.__step(1, (slot) => (slot === 0 ? { interactHeld: true } : {}));
    hold++;
  }
  window.__step(2);
  return { broke, secs, scale, mended: !b.broken, holdSecs: hold / 30, after: P.progress.scale };
});
check('a hostile working at a bellows breaks it', bellows.broke, bellows);
check('with a bellows broken the forging runs at half speed', bellows.scale === 0.5, bellows);
check('holding Y at it mends it, and the forge runs full speed again', bellows.mended && bellows.after === 1, bellows);

const shields = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const boxes0 = g.board.physics.boxes.length;
  for (const i of [0, 1, 2]) P.raise(i);
  const three = P.raised.length;
  const boxes3 = g.board.physics.boxes.length;
  const first = P.sockets[0];
  P.raise(3);
  // a hunter behind a raised shield can put their back to it (the socket's
  // plinth lifts the 0.9 m plate to a face the cover system takes)
  const so = P.sockets[1];
  const V = so.at.constructor;
  const p = g.players[0];
  p.position.copy(so.at).addScaledVector(new V(-Math.sin(so.theta), 0, -Math.cos(so.theta)), 1.4);
  p.velocity.set(0, 0, 0);
  window.__step(6, (slot, f) => (slot === 0 ? { slamPressed: f === 2 } : {}));
  const cover = !!p.cover, face = p.cover ? p.cover.top - p.position.y : 0;
  window.__step(2, (slot, f) => (slot === 0 ? { slamPressed: f === 0 } : {}));
  return { three, four: P.raised.length, firstFolded: !first.up, solid: boxes3 > boxes0, cover, face };
});
check('raised shields are solid', shields.solid, shields);
check('three shields at most: a fourth folds the oldest', shields.three === 3 && shields.four === 3 && shields.firstFolded, shields);
check('a raised shield is cover, over a crouched hunter\'s chest', shields.cover && shields.face >= 1.0, shields);

const fall = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  P.progress.value = 0.6;
  const her = P.armorer.body;
  her.damage(1e9, her.position, -1);
  window.__step(2);
  const back = P.progress.value;
  const down = P.armorer.down;
  window.__step(30 * 11);
  const again = P.armorer.body;
  return { back, down, up: !P.armorer.down && again.alive, fresh: again !== her,
    atPost: again.position.distanceTo(P.armorer.spec.post) < 3 };
});
check('if the Armorer falls the forging drops to its last quarter mark', fall.down && Math.abs(fall.back - 0.5) < 1e-6, fall);
check('and she stands again at her anvil', fall.up && fall.fresh && fall.atPost, fall);

const reward = await page.evaluate(() => {
  const g = window.__game, c = g.campaign, s = c.section, P = s.probe;
  const before = g.players.map((p) => p.maxHp);
  for (const e of g.enemies) if (e.team === 1) e.damage(1e7, e.position, 0);
  P.skipTo(0.999);
  window.__step(30);
  const after = g.players.map((p) => p.maxHp);
  const full = g.players.map((p) => Math.round(p.hp));
  // a death and a respawn inside the section
  const p = g.players[1];
  p.damage(1e6, p.position, -1);
  window.__step(30 * 8);
  return { before, after, full, respawned: p.alive, afterRespawn: p.maxHp, phase: P.phase(), stage: c.stageIdx };
});
check('finishing the forging gives every hunter +25 max health', reward.after.every((m, i) => m === reward.before[i] + 25)
  && reward.full.every((h, i) => h === reward.after[i]), reward);
check('which a respawn keeps', reward.respawned && reward.afterRespawn === reward.after[1], reward);

const carry = await page.evaluate(() => {
  const g = window.__game, c = g.campaign;
  const from = window.__forgeStage;
  // the party gathers on the dais and the stage carries on into the sky
  for (let f = 0; f < 30 * 40 && c.stageIdx === from; f++) {
    const s = c.section;
    window.__step(1, (slot) => {
      const a = s?.autopilot?.(slot) ?? {};
      const p = g.players[slot];
      if (p && typeof a.yaw === 'number') p.cam.yaw = a.yaw;
      const { yaw, ...r } = a; void yaw; return r;
    });
  }
  return { from, to: c.stageIdx, section: c.stage.spec.section, maxHp: g.players.map((p) => p.maxHp) };
});
check('the forge ends by carrying the party into Covert Sky', carry.to === carry.from + 1 && carry.section === 'covert-sky', carry);
check('and the beskar goes with them', carry.maxHp.every((m, i) => m === reward.after[i]), carry);

// --------------------------------------------------------------- Covert Sky
console.log('\n-- covert-sky (still carrying the forge\'s beskar)');
const sky0 = await page.evaluate(() => {
  const g = window.__game;
  window.__step(30 * 3);
  const p = g.players[1];
  p.damage(1e6, p.position, -1);
  window.__step(30 * 8);
  return { alive: p.alive, maxHp: p.maxHp };
});
check('a respawn in the next stage still has the beskar', sky0.alive && sky0.maxHp === reward.after[1], sky0);

const jet = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const p = g.players[0];   // din: a jetpack
  const V = p.position.constructor;
  p.position.copy(P.rings[1].pos).add(new V(0, 0, -30));
  p.velocity.set(0, 0, 0);
  p.cam.yaw = 0;
  let minFuel = 1, maxFlat = 0;
  window.__step(30 * 4, (slot) => {
    if (slot !== 0) return {};
    minFuel = Math.min(minFuel, p.fuel);
    maxFlat = Math.max(maxFlat, Math.hypot(p.velocity.x, p.velocity.z));
    return { jumpHeld: true, moveY: 1 };
  });
  return { minFuel, maxFlat, run: p.profile.runSpeed, rose: p.position.y };
});
check('the jetpack burns without spending fuel', jet.minFuel >= 0.99, jet);
check('and flies faster than it runs', jet.maxFlat > jet.run * 1.8, jet);

const sj = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const p = g.players[1];   // maul: a super-jumper
  const V = p.position.constructor;
  p.position.copy(P.rings[2].pos).add(new V(0, 0, -25));
  p.velocity.set(0, 0, 0);
  // fall for a second with A up, then hold it: the rise has to relight in mid-air
  window.__step(30, () => ({}));
  const y0 = p.position.y;
  let peakVy = -99;
  window.__step(40, (slot) => {
    if (slot !== 1) return {};
    peakVy = Math.max(peakVy, p.velocity.y);
    return { jumpHeld: true };
  });
  return { flight: p.profile.flight, y0, y1: p.position.y, peakVy, grounded: p.grounded };
});
check('a super-jumper relights the rise in mid-air', sj.flight === 'superjump' && sj.y1 > sj.y0 + 3 && sj.peakVy > 3, sj);

const boostDive = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const p = g.players[0];
  const V = p.position.constructor;
  p.position.copy(P.rings[2].pos).add(new V(0, 5, -60));
  p.velocity.set(0, 0, 0);
  p.cam.yaw = 0; p.cam.pitch = 0;
  window.__step(20, () => ({}));
  let peak = 0;
  window.__step(12, (slot, f) => {
    if (slot !== 0) return {};
    peak = Math.max(peak, p.velocity.length());
    return { dashPressed: f === 0, moveY: 1 };
  });
  window.__step(30, () => ({}));
  const glideVy = p.velocity.y;
  let diveVy = 0;
  window.__step(10, (slot, f) => {
    if (slot !== 0) return {};
    diveVy = Math.min(diveVy, p.velocity.y);
    return { slamPressed: f === 0 };
  });
  return { peak, glideVy, diveVy };
});
check('LB boosts', boostDive.peak > 28, boostDive);
check('letting go glides rather than drops', boostDive.glideVy > -8, boostDive);
check('Y dives', boostDive.diveVy < -20, boostDive);

const updraft = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const p = g.players[0];
  const V = p.position.constructor;
  const r = P.reached();
  p.position.set(40, P.G + 3, P.rings[Math.max(0, r)].pos.z + 20);
  p.velocity.set(0, -10, 0);
  window.__step(2);
  const spot = P.airSpot(Math.max(0, r), 0);
  return { back: p.position.distanceTo(spot) < 3, up: p.velocity.y > 0, y: p.position.y, G: P.G,
    banner: /updraft/i.test(window.__banner()), said: window.__banner(), alive: p.alive };
});
check('sinking below the rooftops is caught by the updraft, back at the last ring', updraft.back && updraft.alive && updraft.y > updraft.G + 20, updraft);
check('and a banner says so', updraft.banner, updraft);

const screen = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const p = g.players[0];
  const f = P.flaks.find((x) => x.alive);
  p.position.set(0, P.G + 50, f.screenZ + 2);
  p.velocity.set(0, 0, 10);
  window.__step(2);
  return { behind: p.position.z < f.screenZ, alive: f.alive };
});
check('a live gun\'s flak screen throws you back', screen.behind && screen.alive, screen);

const kill = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  for (const e of g.enemies) if (e.team === 1) e.damage(1e7, e.position, 0);
  const f = P.flaks.find((x) => x.alive);
  const p = g.players[0];
  p.position.copy(f.socket);
  p.velocity.set(0, 0, 0);
  window.__step(20, () => ({}));
  let frames = 0;
  while (!f.charged && frames < 30 * 6) {
    window.__step(1, (slot) => (slot === 0 ? { interactHeld: true } : {}));
    frames++;
  }
  const charged = f.charged, secs = frames / 30;
  window.__step(30 * 3.2, () => ({}));
  return { charged, secs, dead: !f.alive };
});
check('holding Y on the roof plants the charge', kill.charged && kill.secs > 2.5, kill);
check('and the charge silences the gun', kill.dead, kill);

const rockets = await page.evaluate(() => {
  const g = window.__game, s = g.campaign.section, P = s.probe;
  const f = P.flaks.find((x) => x.alive);
  // bolts: many small hits do nothing
  for (let i = 0; i < 30; i++) { f.breech.hp -= 15; window.__step(1); }
  const afterBolts = f.alive;
  // rockets: two big hits
  f.breech.hp -= 90; window.__step(1);
  const one = f.alive;
  f.breech.hp -= 90; window.__step(1);
  return { afterBolts, one, dead: !f.alive };
});
check('bolts do not dent a flak gun', rockets.afterBolts, rockets);
check('two rockets into the breech silence it', rockets.one && rockets.dead, rockets);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
