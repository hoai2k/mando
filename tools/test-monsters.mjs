/**
 * Monster boss regression test (docs/BOSSES.md).
 *
 * Two things are worth holding down. **The sculpts have to arrive at the size
 * the design asked for** — these are the largest models in the game and they
 * are fitted by height, so a wrong figure is a mudhorn the size of a bantha or
 * a mamacore that fills the harbour. And **the second stage has to actually
 * fire**: the warlord falling is not the end of the fight on a monster board,
 * which means the wave game's victory check has to hold its tongue through the
 * quake and the monster has to come up on the other side of it.
 *
 * Run:  node tools/test-monsters.mjs
 */
import { launch } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

const h = await launch();
await h.waitForText(/WAVE BATTLE|PRESS START/i);

// ---- 1. every monster sculpt loads, at its designed size, animated ----
await h.page.evaluate(() => window.__startCoop(1, 'desert'));
await sleep(10000);
const sizes = await h.page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  const out = {};
  for (const kind of ['mudhorn', 'ravinak', 'mamacore', 'rancor', 'kraytDragon', 'mythosaur']) {
    const spot = p.position.clone();
    spot.x += 30;
    const e = g.addReinforcement(kind, spot);
    let sculpt = null;
    for (let i = 0; i < 160; i++) {
      e.char.root.traverse((o) => { if (o.isSkinnedMesh) sculpt = o; });
      if (sculpt) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!sculpt) { out[kind] = 'no sculpt'; e.removeMe = true; continue; }
    if (!sculpt.geometry.boundingBox) sculpt.geometry.computeBoundingBox();
    const bb = sculpt.geometry.boundingBox;
    sculpt.updateWorldMatrix(true, false);
    const el = sculpt.matrixWorld.elements;
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const w = [
        el[0] * x + el[4] * y + el[8] * z + el[12],
        el[1] * x + el[5] * y + el[9] * z + el[13],
        el[2] * x + el[6] * y + el[10] * z + el[14],
      ];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], w[i]); max[i] = Math.max(max[i], w[i]); }
    }
    let clips = 0;
    e.char.root.traverse((o) => { if (o.userData?.clips?.length) clips = o.userData.clips.length; });
    out[kind] = {
      height: +(max[1] - min[1]).toFixed(1),
      longest: +Math.max(max[0] - min[0], max[2] - min[2]).toFixed(1),
      standsOnGround: Math.abs(min[1] - e.position.y) < 0.35,
      // how much of the sculpt is under the ground it stands on, and how much
      // clears it — the half-buried pair live entirely on these two
      buried: +(e.position.y - min[1]).toFixed(1),
      above: +(max[1] - e.position.y).toFixed(1),
      clips,
      hp: e.hp,
    };
    e.removeMe = true;
  }
  return out;
});
/** the two colossi are meant to be half under the surface, not standing on it */
const BURIED = new Set(['kraytDragon', 'mythosaur']);
for (const [kind, m] of Object.entries(sizes)) {
  check(`${kind}: the sculpt arrives and is driven`,
    m !== 'no sculpt' && m.clips === 2 && (m.standsOnGround || BURIED.has(kind)), m);
}
// the design's figures: a mudhorn stands about as tall as two people, a
// mamacore is the length of the trawler it swims under
check('mudhorn is bull-sized', sizes.mudhorn?.height > 2.4 && sizes.mudhorn?.height < 3.6, sizes.mudhorn?.height);
check('ravinak is a leviathan', sizes.ravinak?.longest > 6 && sizes.ravinak?.longest < 11, sizes.ravinak?.longest);
check('mamacore is the biggest of them', sizes.mamacore?.longest > 9 && sizes.mamacore?.longest < 16, sizes.mamacore?.longest);
check('rancor towers', sizes.rancor?.height > 4 && sizes.rancor?.height < 6.5, sizes.rancor?.height);

// Half of each colossus belongs under the ground, with the head, neck and
// forelimbs clear above it — the whole read of those two fights.
for (const kind of [...BURIED]) {
  const m = sizes[kind];
  check(`${kind} is half in the ground`, m.buried > 1.5 && m.buried < m.height * 0.8, m);
  check(`${kind}'s head clears it`, m.above > 2.5, m);
}

// ---- 2. the warlord falling opens the second stage, and only then ends ----
await h.page.evaluate(() => window.__quitToTitle());
await sleep(1500);
await h.page.evaluate(() => window.__startCoop(1, 'station'));
await sleep(10000);
const stage = await h.page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  g.state = 'fighting';
  for (const e of g.enemies) e.removeMe = true;
  // the real path: clearing the final wave is what rings the warlord in
  g.wave = 7;                                    // FINAL_WAVE
  g.nextWave();
  const warlord = g.boss;
  const warlordName = warlord.bossName;
  await new Promise((r) => setTimeout(r, 500));
  // drop the warlord and watch what the game does next
  warlord.damage(99999, p.position, 0);
  const seen = { staging: false, victoryDuringQuake: false };
  let monster = null;
  for (let i = 0; i < 200; i++) {
    if (g.monsterStaging) seen.staging = true;
    if (g.state === 'victory' && !monster) seen.victoryDuringQuake = true;
    if (g.boss && g.boss.alive && g.boss !== warlord) { monster = g.boss; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    warlordName,
    quakeSeen: seen.staging,
    victoryDuringQuake: seen.victoryDuringQuake,
    monster: monster ? { kind: monster.kind, name: monster.bossName, hp: monster.hp, boss: !!monster.boss } : null,
    state: g.state,
  };
});
check('the warlord falls and the ground shakes', stage.quakeSeen, stage);
check('victory is not called into the quake', !stage.victoryDuringQuake, stage);
// and the match must actually be able to end: a stage that never clears its
// own flag would leave a board nobody can finish
const ending = await h.page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  // clear the field, monster and retinue alike — victory is "everything the
  // wave put up is down", which is what the two-stage flow must not strand
  for (let i = 0; i < 200; i++) {
    for (const e of g.enemies) if (e.alive) e.damage(99999, p.position, 0);
    if (g.state === 'victory') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { state: g.state, staging: g.monsterStaging };
});
check('the monster comes up, with its own name and bar',
  stage.monster?.kind === 'mudhorn' && stage.monster?.name === "The Smugglers' Prize" && stage.monster?.hp === 2600,
  stage.monster);
check('and the territory is held when it falls', ending.state === 'victory' && !ending.staging, ending);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nmonster bosses: all checks passed');
