/**
 * Regression test for the game modes (docs/MODES.md): the three-way title,
 * PvP rules (distinct teams, the playable-NPC adapter, squad followers,
 * last-one-standing), the campaign (per-player cameras, the mission level's
 * room chain with sealed assault waves, boss arenas, liberation), the wave
 * game's boss wave, and — since the modes became the default — that
 * `?nomodes` still puts the original one-button title back.
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
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
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
    npcFlight: g.players[1].profile.flight,
    mandoFlight: g.players[0].profile.flight,
  };
})()`);
check('pvp: match opens, every fighter its own team', s.state === 'fighting' && s.teams[0] === 2 && s.teams[1] === 3, JSON.stringify(s.teams));
check('pvp: the NPC adapter fields player two', s.npc === 'Tusken Raider');
check('pvp: an NPC super-jumps, never a jetpack; the Mandalorian keeps his',
  s.npcFlight === 'superjump' && s.mandoFlight === 'jetpack', `${s.npcFlight}/${s.mandoFlight}`);
check('pvp: squad followers ride their leader\'s team', s.followers === 2 && s.followerTeam === 3, `${s.followers} @ team ${s.followerTeam}`);
check('pvp: rival and their squad are hostile to player one', s.hostiles0 === 3, String(s.hostiles0));
// the squad carries its leader: a downed leader with a follower still up
// takes over the survivor's body instead of spending a stand
s = await page.evaluate(`(() => {
  const g = window.__game;
  const p2 = g.players[1];
  const before = g.enemies.filter((e) => e.owner === p2 && e.alive).length;
  p2.lives = 0;
  p2.damage(9999, p2.position, 0);
  (${STEP})(30);
  return {
    state: g.state, alive: p2.alive, before,
    followers: g.enemies.filter((e) => e.owner === p2 && e.alive).length,
  };
})()`);
check('pvp: a downed leader carries on in a surviving follower',
  s.state === 'fighting' && s.alive === true && s.before === 2 && s.followers === 1, JSON.stringify(s));
// a death with a stand left plays the full cycle: dissolve, then re-form at
// a far spawn — the wait is the performance, not a countdown
s = await page.evaluate(`(() => {
  const g = window.__game;
  const p2 = g.players[1];
  p2.lives = 1;
  for (const e of g.enemies) if (e.owner === p2 && e.alive) e.damage(9999, e.position, 0);
  p2.damage(9999, p2.position, 0);
  let dissolved = false, formed = false;
  for (let i = 0; i < 200; i++) {
    (${STEP})(1);
    if (p2.dissolving) dissolved = true;
    if (p2.alive && p2.formT > 0) formed = true;
    if (p2.alive && p2.formT <= 0 && formed) break;
  }
  return { state: g.state, alive: p2.alive, dissolved, formed, lives: p2.lives };
})()`);
check('pvp: a death with a stand left dissolves, then re-forms at the new spawn',
  s.state === 'fighting' && s.alive === true && s.dissolved && s.formed && s.lives === 0,
  JSON.stringify(s));
// ...and the last stand is still the last: squad wiped, lives spent → the
// duel ends, with credit, and the end screen holds the champion's portrait
s = await page.evaluate(`(() => {
  const g = window.__game;
  const p2 = g.players[1];
  for (const e of g.enemies) if (e.owner === p2 && e.alive) e.damage(9999, e.position, 0);
  p2.damage(9999, p2.position, 0);
  (${STEP})(200);
  return { state: g.state, winner: g.winnerSlot, p1kills: g.players[0].kills };
})()`);
check('pvp: last fighter standing takes the territory, with credit',
  s.state === 'victory' && s.winner === 0 && s.p1kills >= 1, JSON.stringify(s));
// the celebration: the end-screen transition lives in the real frame loop
// (endTimer runs 3 s on the wall clock), so un-pause it and give it its beat —
// then the hero block holds the winner's face art
await page.evaluate(() => { window.__manual = false; });
await sleepFrames(280);
const hero = await page.evaluate(() => {
  const el = document.querySelector('.end-hero');
  return {
    shown: !!el && el.style.display !== 'none',
    face: !!el?.querySelector('.end-face svg'),
    tag: el?.querySelector('.end-tag')?.textContent ?? '',
  };
});
check('pvp: the end screen celebrates the champion with their portrait',
  hero.shown && hero.face && /Champion/.test(hero.tag), JSON.stringify(hero));

// ---- the brood-queen loop (docs/MODES.md §3) ----
// Y lays an egg; 5 s hatches it into a hatchling escort (destroyable in the
// shell); the fallen queen carries on in the hatchling's body; ten survived
// seconds grow her back.
await startMode('pvp', 2, 'desert', ['din', 'npc:broodmother']);
s = await page.evaluate(`(() => {
  const g = window.__game;
  const blankIn = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, switchPressed:false, pausePressed:false });
  const stepWith = (n, mut) => {
    for (let i = 0; i < n; i++) {
      const inputs = [blankIn(), blankIn(), blankIn(), blankIn()];
      if (mut) mut(inputs);
      g.update(1/30, inputs);
    }
  };
  const p2 = g.players[1];
  stepWith(200);
  const out = {};
  // ~6.7 s in: two sacs have charged (one every 3 s), the rack is live
  out.clutch = p2.eggClutch;
  out.rack = typeof p2.char.setEggs === 'function';
  stepWith(1, (ins) => { ins[1].rocketPressed = true; });
  const egg = g.enemies.find((e) => e.kind === 'spiderEgg');
  out.eggLaid = !!egg && egg.owner === p2 && egg.team === p2.team && egg.alive;
  out.clutchSpent = p2.eggClutch === out.clutch - 1;
  // it leaves from the sac on her back — born up high beside her, not on the dirt
  out.fromBack = !!egg && egg.position.y - p2.position.y > 0.7
    && Math.hypot(egg.position.x - p2.position.x, egg.position.z - p2.position.z) < 3;
  stepWith(170);
  out.eggGone = !g.enemies.some((e) => e.kind === 'spiderEgg' && e.alive);
  const kid = g.enemies.find((e) => e.kind === 'spiderling' && e.alive);
  out.hatched = !!kid && kid.owner === p2 && kid.team === p2.team;
  // RT lobs an egg: it flies, and the first body it meets is shoved, unhurt
  stepWith(1, (ins) => { ins[1].shootHeld = true; });
  const thrown = g.enemies.find((e) => e.kind === 'spiderEgg' && e.alive);
  out.thrown = !!thrown && thrown.eggThrown === true
    && Math.hypot(thrown.velocity.x, thrown.velocity.z) > 6;
  if (thrown) {
    const p1 = g.players[0];
    thrown.position.set(p1.position.x + 1.0, p1.position.y + 0.6, p1.position.z);
    thrown.velocity.set(-10, 0.5, 0);
    const hpBefore = p1.hp;
    stepWith(2);
    out.knocked = Math.hypot(p1.velocity.x, p1.velocity.z) > 3 && p1.hp === hpBefore;
    thrown.damage(999, thrown.position, 0);
  }
  // an empty clutch lays nothing — the 3 s charge is the real clock
  p2.eggsReady = 0; p2.eggCharge = 0;
  stepWith(20);
  const eggsBefore = g.enemies.filter((e) => e.kind === 'spiderEgg' && e.alive).length;
  stepWith(1, (ins) => { ins[1].rocketPressed = true; });
  out.emptyLay = g.enemies.filter((e) => e.kind === 'spiderEgg' && e.alive).length === eggsBefore;
  // a destroyed egg hatches nothing
  p2.eggsReady = 1;
  stepWith(20, undefined);
  stepWith(1, (ins) => { ins[1].rocketPressed = true; });
  const egg2 = g.enemies.find((e) => e.kind === 'spiderEgg' && e.alive);
  out.egg2 = !!egg2;
  if (egg2) egg2.damage(999, egg2.position, 0);
  stepWith(170);
  out.spiderlings = g.enemies.filter((e) => e.kind === 'spiderling' && e.alive).length;
  p2.damage(9999, p2.position, 0);
  stepWith(30);
  out.tookOver = p2.alive && p2.characterId === 'npc:spiderling';
  out.smallHp = p2.maxHp;
  stepWith(330);
  out.grew = p2.alive && p2.characterId === 'npc:broodmother';
  out.state = g.state;
  return out;
})()`);
check('pvp: the clutch charges an egg every 3 s onto a live rack',
  s.clutch === 2 && s.rack, JSON.stringify(s));
check('pvp: the broodmother lays an egg on Y, spending the clutch',
  s.eggLaid && s.clutchSpent, JSON.stringify(s));
check('pvp: the delivered egg leaves from the sac on her back', s.fromBack, JSON.stringify(s));
check('pvp: the egg hatches into a hatchling escort after 5 s', s.eggGone && s.hatched, JSON.stringify(s));
check('pvp: RT lobs an egg that shoves its target without hurting them',
  s.thrown && s.knocked, JSON.stringify(s));
check('pvp: an empty clutch lays nothing', s.emptyLay, JSON.stringify(s));
check('pvp: a destroyed egg hatches nothing', s.egg2 && s.spiderlings === 1, JSON.stringify(s));
check('pvp: the fallen queen carries on as her hatchling', s.tookOver && s.smallHp === 40, JSON.stringify(s));
check('pvp: ten survived seconds grow her back', s.grew && s.state === 'fighting', JSON.stringify(s));

// ---- PvP: the roster is not one species ----
// The chase rig is tuned around a 1.8 m Mandalorian, and PvP fields a war
// massiff four metres from nose to tail. Framed as a Mandalorian it put the
// camera *inside* the animal: a wall of hide across the whole screen and no
// view of the world. The collider does not catch it — the roster clamps a
// playable NPC's capsule to 0.6 × 2.1 so a beast still fits the cover and
// doorways the boards were built around — so this measures the body.
await startMode('pvp', 2, 'desert', ['npc:massiff', 'npc:stormtrooper']);
const framing = await page.evaluate(`(() => {
  const g = window.__game;
  (${STEP})(60);
  // world bounds of the geometry actually on screen, pruning hidden subtrees
  // (a character wears its procedural stand-in under the model that replaced it)
  const bodyOf = (root) => {
    const V3 = root.position.constructor;
    const v = new V3();
    let mnx = Infinity, mny = Infinity, mnz = Infinity;
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    root.updateWorldMatrix(true, true);
    const walk = (o, isRoot) => {
      if (!isRoot && !o.visible) return;
      const geo = o.geometry;
      if (geo && geo.attributes && geo.attributes.position) {
        const pos = geo.attributes.position;
        const stride = Math.max(1, Math.floor(pos.count / 200));
        for (let i = 0; i < pos.count; i += stride) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          mnx = Math.min(mnx, v.x); mny = Math.min(mny, v.y); mnz = Math.min(mnz, v.z);
          mxx = Math.max(mxx, v.x); mxy = Math.max(mxy, v.y); mxz = Math.max(mxz, v.z);
        }
      }
      for (const c of o.children) walk(c, false);
    };
    walk(root, true);
    return { mnx, mny, mnz, mxx, mxy, mxz };
  };
  return g.players.slice(0, 2).map((p) => {
    const b = bodyOf(p.char.root);
    const c = p.cam.camera.position;
    return {
      id: p.characterId,
      span: +Math.max(b.mxx - b.mnx, b.mxz - b.mnz).toFixed(2),
      inside: c.x > b.mnx && c.x < b.mxx && c.y > b.mny && c.y < b.mxy && c.z > b.mnz && c.z < b.mxz,
      dist: +Math.hypot(c.x - p.position.x, c.y - p.position.y, c.z - p.position.z).toFixed(2),
    };
  });
})()`);
const beast = framing[0];
const human = framing[1];
check('pvp: the camera stays outside the body it follows, however big it is',
  !beast.inside && !human.inside, JSON.stringify(framing));
check('pvp: a four-metre fighter is framed further out than a trooper',
  beast.span > 3 && beast.dist > human.dist + 1, JSON.stringify(framing));
// ...and the same body is scaled down to fit its plinth on the select, where
// at its own size it swallowed whoever was standing next to it
const fitted = await page.evaluate(async () => {
  window.__quitToTitle();
  await new Promise((r) => requestAnimationFrame(r));
  const cs = window.__charsel;
  cs.configure({ roster: window.__pvpRoster, title: 'Choose Your Fighter', minPlayers: 2 });
  cs.show();
  const slot = cs.slots[0];
  const scaleOf = (id) => {
    const i = cs.roster.indexOf(id);
    if (i < 0) return null;
    slot.choice = i;
    slot.phase = 'browsing';
    cs.update(1 / 60);
    const c = slot.chars.get(id);
    return c ? +c.root.scale.x.toFixed(3) : null;
  };
  return { massiff: scaleOf('npc:massiff'), trooper: scaleOf('npc:stormtrooper') };
});
check('select: a giant fighter is scaled onto its plinth, a humanoid is left alone',
  fitted.massiff !== null && fitted.massiff < 0.6 && fitted.trooper === 1, JSON.stringify(fitted));

// ---- Campaign ----
await startMode('campaign', 2, 'desert', ['din', 'armorer']);
s = await page.evaluate(`(() => {
  const g = window.__game;
  (${STEP})(120);
  const c = g.campaign;
  return {
    shared: !!g.sharedCam, state: g.state,
    camsApart: g.players[0].cam !== g.players[1].cam,
    rooms: c.level.rooms.map((r) => r.spec.kind).join(','),
    elevated: g.players.every((p) => p.position.y > 60),
    posted: g.enemies.filter((e) => e.alive).length,
    hint: g.hudTopLine(g.players[0]),
  };
})()`);
check('campaign: every player their own camera, no shared rig',
  !s.shared && s.camsApart && s.state === 'fighting');
check('campaign: the mission level is a room chain — start to warlord, champion mid-run',
  s.rooms.startsWith('start') && s.rooms.endsWith('warlord')
  && s.rooms.includes('champion') && s.rooms.includes('assault') && s.rooms.includes('camp'), s.rooms);
check('campaign: the party stands on the mission level, garrison posted',
  s.elevated && s.posted > 6, `elevated ${s.elevated} · posted ${s.posted}`);
check('campaign: the guide reads a bearing and a distance', / \d+ m$/.test(s.hint), s.hint);
const walk = await page.evaluate(`(() => {
  const g = window.__game;
  const c = g.campaign;
  const out = { sealed: false, assaultWave: false, phases: 0 };
  let guard = 0;
  while (!c.done && guard++ < 300) {
    const obj = c.objectivePos;
    for (const p of g.players) {
      p.position.set(obj.x, obj.y + 0.2, obj.z);
      p.velocity.set(0, 0, 0);
      p.hp = p.maxHp; p.alive = true;
    }
    (${STEP})(20);
    for (const room of c.level.rooms) {
      if (room.entryGate?.closed || room.exitGate?.closed) out.sealed = true;
    }
    if (g.enemies.some((e) => e.alive && e.squad >= 9500 && e.squad < 9900)) out.assaultWave = true;
    if (g.boss && g.boss.alive && out.phases === 0) {
      // set hp rather than dealing it: this check is about the phase turns,
      // and a warlord can parry a single damage() call (by design)
      g.boss.hp = g.boss.maxHp * 0.6;
      (${STEP})(10);
      out.phases = g.enemies.filter((e) => e.squad >= 9900 && e.squad < 9910).length;
    }
    for (const e of g.enemies) if (e.alive) e.damage(9999999, e.position, 0);   // lethal even through a parry
    (${STEP})(20);
  }
  (${STEP})(20);
  return { ...out, done: c.done, state: g.state };
})()`);
check('campaign: assault rooms seal their gates and run waves', walk.sealed && walk.assaultWave, JSON.stringify(walk));
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

// ---- boss super jump ----
// A promoted boss with a target holding mid-range closes the gap in a
// committed ballistic leap and lands a slam (enemy.ts trySuperJump). Post the
// warlord 20 m out on open desert, wake it, and watch it go airborne.
await startMode('wave', 1, 'desert', ['din']);
const sj = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  const at = p.position.clone(); at.x += 20;
  const boss = g.spawnBoss(at, 'final');
  boss.alert(p.position, true);
  let airborne = 0, jumps = 0, minDist = 1e9;
  for (let i = 0; i < 500; i++) {
    (${STEP})(1);
    p.hp = p.maxHp; p.alive = true;         // the leap, not the loss, is under test
    if (!boss.alive) break;
    if (boss.velocity.y > 4) airborne++;
    jumps = boss.superJumps;
    minDist = Math.min(minDist, boss.position.distanceTo(p.position));
    if (jumps > 0 && airborne > 3 && minDist < 12) break;
  }
  return { jumps, airborne, minDist: +minDist.toFixed(1), boss: boss.bossName };
})()`);
check('wave: the warlord super jumps to close the gap',
  sj.jumps > 0 && sj.airborne > 3, JSON.stringify(sj));
check('wave: the leap actually carries it to the player', sj.minDist < 12, JSON.stringify(sj));

// ---- death is a performance: dissolve, then re-form (infinite lives) ----
// The fall plays, the pose freezes and the body burns away into motes; the
// respawn re-forms it at the landing spot. Solo wave death used to be the
// defeat screen — with INFINITE_LIVES it is a walk back instead.
await startMode('wave', 1, 'desert', ['din']);
const dz = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  (${STEP})(150);
  p.damage(9999, p.position);
  let dissolved = false, hidden = false, formed = false, visibleAgain = false;
  for (let i = 0; i < 240; i++) {
    (${STEP})(1);
    if (p.dissolving) dissolved = true;
    if (!p.alive && !p.char.root.visible) hidden = true;
    if (p.alive && p.formT > 0) formed = true;
    if (p.alive && formed && p.formT <= 0) { visibleAgain = p.char.root.visible; break; }
  }
  return { dissolved, hidden, formed, visibleAgain, alive: p.alive, state: g.state };
})()`);
check('wave: a death dissolves the body, then re-forms it — no defeat',
  dz.dissolved && dz.hidden && dz.formed && dz.visibleAgain && dz.alive && dz.state === 'fighting',
  JSON.stringify(dz));

// ---- ?waves=boss: a single wave before each boss battle ----
await page.evaluate(() => { window.__manual = false; });
await page.goto('http://localhost:4173/?waves=boss');
await sleepFrames(8);
await startMode('wave', 1, 'desert', ['din']);
const br = await page.evaluate(`(() => {
  const g = window.__game;
  let guard = 0;
  const bosses = [];
  while (g.state !== 'victory' && guard++ < 40) {
    if (g.boss && g.boss.alive && !bosses.includes(g.boss.bossName)) bosses.push(g.boss.bossName);
    for (const e of g.enemies) if (e.alive) e.damage(999999, e.position, 0);
    g.players[0].hp = g.players[0].maxHp; g.players[0].alive = true;
    (${STEP})(200);
  }
  return { wave: g.wave, bosses, state: g.state };
})()`);
check('?waves=boss: one wave to the champion, one more to the warlord and its monster',
  br.state === 'victory' && br.wave === 3 && br.bosses.length === 3, JSON.stringify(br));

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
