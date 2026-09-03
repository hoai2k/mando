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

// ---- 1. every delivered monster sculpt loads, at its designed size, animated ----
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
  // idle + move + attack (anim/quadruped.ts builds all three per rig)
  check(`${kind}: the sculpt arrives and is driven`,
    m !== 'no sculpt' && m.clips === 3 && (m.standsOnGround || BURIED.has(kind)), m);
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
// ---- 2b. the quake is in the ground, so it reaches what is standing on it ----
//
// The beat between the warlord falling and the monster coming up is the ground
// itself opening. It used to go straight to every player's camera, which
// rattled a Mandalorian hovering forty metres up on the jetpack exactly as
// hard as one standing in the dust — and with nothing under your feet a
// rumble stops reading as the world moving and starts reading as the view
// being broken.
const rumble = await h.page.evaluate(`(() => {
  window.__manual = true;
  const blank = () => ({
    moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
    dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
    meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
    zoomDelta: 0, blockHeld: false, pausePressed: false,
    meleeSwapPressed: false, rangedSwapPressed: false,
    throttleHeld: false, brakeHeld: false,
  });
  const inputs = [blank(), blank(), blank(), blank()];
  const DT = 1 / 30;
  const g = window.__game;
  const p = g.players[0];
  const home = p.position.clone();
  // out from under the monster's introduction first: it runs the simulation at
  // a fraction of real time, which would stretch every clock this measures
  for (let i = 0; i < 400 && g.bossIntroT > 0; i++) g.update(DT, inputs);
  // nothing else is allowed to shake the camera while this is measured
  const park = () => { for (const e of g.enemies) e.position.set(home.x + 500, home.y, home.z); };
  const beat = (fly) => {
    p.position.copy(home);
    if (fly) p.position.y += 25;
    p.velocity.set(0, 0, 0);
    g.monsterQuake = 6;
    // Settle into the state first, and give it time: the jolt fades out with
    // the last of the ground contact, so a player who was standing a moment
    // ago still feels it — which is the point, and not what is being measured.
    for (let i = 0; i < 40; i++) {
      park();
      if (fly) { p.position.set(home.x, home.y + 25, home.z); p.velocity.set(0, 0, 0); }
      g.update(DT, inputs);
    }
    p.cam.shakeAmt = 0;
    let peak = 0;
    for (let i = 0; i < 10; i++) {
      park();
      if (fly) { p.position.set(home.x, home.y + 25, home.z); p.velocity.set(0, 0, 0); }
      g.update(DT, inputs);
      peak = Math.max(peak, p.cam.shakeAmt);
    }
    g.monsterQuake = 0;
    return { peak: +peak.toFixed(3), grounded: p.grounded, y: +p.position.y.toFixed(1) };
  };
  const onFoot = beat(false);
  const flying = beat(true);
  p.position.copy(home);
  window.__manual = false;
  return { onFoot, flying };
})()`);
check('the quake shakes a player standing in it',
  rumble.onFoot.grounded === true && rumble.onFoot.peak > 0.05, rumble);
check('...and leaves one in the air alone',
  rumble.flying.grounded === false && rumble.flying.peak < 0.01, rumble);

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

// ---- 3. the second batch stands in until its sculpts land ----
// Four more monsters (docs/BOSSES.md §2.7–2.10) with no .glb yet: each has to
// come up as a visible procedural body at its Def's numbers, so a boss you
// cannot see never happens on the three boards that just gained one.
await h.page.evaluate(() => window.__quitToTitle());
await sleep(1500);
await h.page.evaluate(() => window.__startCoop(1, 'desert'));
await sleep(10000);
const standIns = await h.page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  const out = {};
  for (const kind of ['sandworm', 'zillo', 'nexu', 'kwazelMaw']) {
    const spot = p.position.clone();
    spot.x += 30;
    const e = g.addReinforcement(kind, spot);
    await new Promise((r) => setTimeout(r, 1500));
    let meshes = 0, skinned = 0;
    e.char.root.traverse((o) => { if (o.isMesh && o.visible) meshes++; if (o.isSkinnedMesh) skinned++; });
    out[kind] = { meshes, skinned, hp: e.hp, settled: e.char.modelReady?.() ?? null };
    e.removeMe = true;
  }
  return out;
});
for (const [kind, m] of Object.entries(standIns)) {
  check(`${kind}: a visible stand-in at its own numbers`, m.meshes > 3 && m.hp > 1500, m);
}

// ---- 4. every territory's warlord now opens onto a monster ----
for (const [board, want] of [
  ['refinery', { kind: 'zillo', name: 'The Specimen', hp: 4200 }],
  ['ringworld', { kind: 'nexu', name: 'The Night-Side Stalker', hp: 2800 }],
  ['narkina', { kind: 'kwazelMaw', name: 'The Thing in the Moon Pool', hp: 3800 }],
]) {
  await h.page.evaluate(() => window.__quitToTitle());
  await sleep(1500);
  await h.page.evaluate((b) => window.__startCoop(1, b), board);
  await sleep(10000);
  const st = await h.page.evaluate(async () => {
    const g = window.__game;
    const p = g.players[0];
    g.state = 'fighting';
    for (const e of g.enemies) e.removeMe = true;
    g.wave = 7;
    g.nextWave();
    const warlord = g.boss;
    await new Promise((r) => setTimeout(r, 500));
    warlord.damage(99999, p.position, 0);
    let monster = null;
    for (let i = 0; i < 200; i++) {
      if (g.boss && g.boss.alive && g.boss !== warlord) { monster = g.boss; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    return monster ? { kind: monster.kind, name: monster.bossName, hp: monster.hp } : null;
  });
  check(`${board}: the warlord falls and its monster comes up`,
    st?.kind === want.kind && st?.name === want.name && st?.hp === want.hp, st);
}

// ---- 5. the worm's cycle: under, up, under again — and only hurt while up ----
await h.page.evaluate(() => window.__quitToTitle());
await sleep(1500);
await h.page.evaluate(() => window.__startCoop(1, 'desert'));
await sleep(10000);
const worm = await h.page.evaluate(async () => {
  const g = window.__game;
  const p = g.players[0];
  for (const e of g.enemies) e.removeMe = true;
  const spot = p.position.clone();
  spot.x += 26;
  const e = g.addReinforcement('sandworm', spot);
  e.alert(p.position, true);
  const seen = new Set();
  let underIgnored = null, upLanded = null, sunkDepth = null, raisedDepth = null;
  // The body has no single node to watch any more — it is a spine chain solved
  // onto the head's path — so the question "is it under the sand" is asked of
  // the head itself, against the ground the animal is standing on.
  const headOf = () => {
    let h = null;
    e.char.root.traverse((o) => { if (!h && o.name === 'head') h = o; });
    return h;
  };
  let head = null;
  for (let i = 0; i < 80 && !head; i++) { head = headOf(); if (!head) await new Promise((r) => setTimeout(r, 250)); }
  const headY = () => {
    if (!head) return null;
    const v = new e.position.constructor();
    head.getWorldPosition(v);
    return v.y - e.position.y;
  };
  for (let i = 0; i < 240 && e.alive; i++) {
    seen.add(e.burrow);
    p.hp = p.maxHp; p.alive = true;   // keep the prey standing through the eruptions
    if (e.burrow === 'under') {
      const y = headY();
      if (y !== null) sunkDepth = Math.min(sunkDepth ?? 0, y);
      if (underIgnored === null) { const before = e.hp; e.damage(100, p.position, 0); underIgnored = e.hp === before; }
    }
    if (e.burrow === 'up') {
      const y = headY();
      if (y !== null) raisedDepth = Math.max(raisedDepth ?? -99, y);
      if (upLanded === null) { const before = e.hp; e.damage(100, p.position, 0); upLanded = e.hp === before - 100; }
    }
    if (seen.size === 4 && underIgnored !== null && upLanded !== null && e.eruptions >= 1 && e.burrow === 'under' && seen.has('sinking')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const out = { stages: [...seen], eruptions: e.eruptions, underIgnored, upLanded, sunkDepth, raisedDepth,
                foundHead: !!head, alive: e.alive };
  e.removeMe = true;
  return out;
});
check('the worm runs its whole cycle', ['under', 'rising', 'up', 'sinking'].every((s) => worm.stages.includes(s)), worm);
check('it erupts under its prey', worm.eruptions >= 1, worm);
check('under the sand it cannot be hurt', worm.underIgnored === true, worm);
check('on the surface it can', worm.upLanded === true, worm);
// The whole read of the creature: hunting, the head is metres under the sand;
// surfaced, it is clear of it. Measured on the head bone against the ground the
// animal is standing on, so it holds however the body is built.
check('and the head actually goes under the sand and comes back out of it',
  worm.foundHead && worm.sunkDepth < -3 && worm.raisedDepth > 0, worm);

// ---- 6. the massiff's jaw, added at load rather than sculpted in ----
// The bone does not exist in the .glb: `jawrig.ts` inserts it, rebinds the skin
// and moves the weights over. Two ways that fails silently — a pivot in the
// wrong space, or a bind matrix taken from a rest pose that is not the bind
// pose — both leave the model looking fine until the bone turns, and then fling
// the weighted vertices to the horizon. So this measures the travel.
await h.page.evaluate(() => window.__quitToTitle());
await sleep(1500);
await h.page.evaluate(() => window.__startCoop(1, 'desert'));
await sleep(10000);
const jawRig = await h.page.evaluate(async () => {
  const g = window.__game, p = g.players[0];
  for (const e of g.enemies) e.removeMe = true;
  await new Promise((r) => setTimeout(r, 400));
  const spot = p.position.clone(); spot.z += 12;
  const e = g.addReinforcement('massiff', spot);
  let mesh = null;
  for (let i = 0; i < 120 && !mesh; i++) {
    e.char.root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    if (!mesh) await new Promise((r) => setTimeout(r, 250));
  }
  if (!mesh) return { error: 'no skinned mesh' };
  e.update = () => {};
  const jaw = mesh.skeleton.bones.find((b) => b.name === 'jaw');
  if (!jaw) return { error: 'no jaw bone was added' };
  const ji = mesh.skeleton.bones.indexOf(jaw);
  const geo = mesh.geometry;
  const idxA = geo.attributes.skinIndex, wA = geo.attributes.skinWeight;
  const picks = [];
  for (let v = 0; v < geo.attributes.position.count && picks.length < 300; v += 13) {
    let jw = 0;
    for (const c of ['X', 'Y', 'Z', 'W']) if (idxA['get' + c](v) === ji) jw += wA['get' + c](v);
    if (jw > 0.7) picks.push(v);
  }
  const sample = () => {
    mesh.updateMatrixWorld(true);
    mesh.skeleton.update();
    return picks.map((v) => {
      const t = new mesh.position.constructor();
      t.fromBufferAttribute(geo.attributes.position, v);
      mesh.applyBoneTransform(v, t);
      return [t.x, t.y, t.z];
    });
  };
  jaw.rotation.x = 0; jaw.updateMatrixWorld(true);
  const shut = sample();
  jaw.rotation.x = -0.7; jaw.updateMatrixWorld(true);   // ~40 degrees
  const open = sample();
  jaw.rotation.x = 0; jaw.updateMatrixWorld(true);
  let travel = 0;
  for (let i = 0; i < shut.length; i++) {
    travel = Math.max(travel, Math.hypot(
      open[i][0] - shut[i][0], open[i][1] - shut[i][1], open[i][2] - shut[i][2]));
  }
  if (!geo.boundingBox) geo.computeBoundingBox();
  const height = geo.boundingBox.max.y - geo.boundingBox.min.y;
  e.removeMe = true;
  // as a fraction of the animal, so the quantised model units cancel out
  return { jawVerts: picks.length, travelFrac: +(travel / height).toFixed(4) };
});
check('the massiff is given a jaw it was not sculpted with', !jawRig.error && jawRig.jawVerts > 20, jawRig);
// A jaw tip on a 2 m animal swings tens of centimetres, not tens of metres: a
// tenth of the animal's own height is a jaw, ten times it is a broken bind pose.
check('...and opening it moves the jaw, not the horizon',
  jawRig.travelFrac > 0.03 && jawRig.travelFrac < 0.4, jawRig);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nmonster bosses: all checks passed');
