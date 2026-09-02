/**
 * The playable broodmother's clutch and her brood (docs/MODES.md §3).
 *
 * Three things have to hold, and all three were reported from play.
 *
 * 1. **The rack on her back is the ammunition readout.** The sculpt carries
 *    six eggs; the game drives six, black while spent and white once charged,
 *    so a player can see what she has without looking at the HUD.
 * 2. **The brood hunts.** A hatchling used to be a squad *follower*, which
 *    pinned it to the mother — the escort AI anchors to its leader and only
 *    engages what strays near her — so laid spiders trotted at her heels.
 *    They now cross the board to whatever is hostile and bite it.
 * 3. **Nothing caps the swarm but her laying rate.** The old head count
 *    stopped at eight, and the ninth egg silently did nothing.
 *
 * The headless GPU renders at a crawl, so the checks step the simulation
 * directly rather than waiting on frames.
 *
 * Run:  node tools/test-brood.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const h = await launch({ url: `http://localhost:${process.env.HARNESS_PORT ?? '4173'}/` });
const { page } = h;

/** page-side stepper: n fixed ticks, with one player optionally holding a key */
const STEP = `(n, press) => {
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const g = window.__game;
  for (let i = 0; i < n; i++) {
    const inputs = [blank(), blank(), blank(), blank()];
    if (press) inputs[0][press] = true;
    g.update(1/30, inputs);
  }
}`;

await page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('pvp', 2, 'desert', ['npc:broodmother', 'npc:tusken']);
});
await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
await page.evaluate(() => { window.__manual = true; });

// ---- the rack ----
// Six sacs, and they start spent. One charges every three seconds, so after
// twenty the whole clutch is up: the readout is the point, not the timing.
const rack = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  const read = () => {
    const shades = [];
    for (const c of p.char.root.children) {
      if (c.isMesh && c.geometry?.type === 'SphereGeometry' && c.material?.color) {
        const m = c.material;
        shades.push(+(0.2126*m.color.r + 0.7152*m.color.g + 0.0722*m.color.b).toFixed(3));
      }
    }
    return shades;
  };
  const start = read();
  (${STEP})(30 * 25);
  const full = read();
  return { name: p.profile.name, sacs: start.length, start, full, clutch: p.eggClutch };
})()`);
check('the rack shows one sac per egg the sculpt carries', rack.sacs === 6, `${rack.sacs} sacs`);
check('an empty clutch reads black on every sac',
  rack.start.every((v) => v < 0.05), JSON.stringify(rack.start));
check('a full clutch lights every sac pale',
  rack.clutch === 6 && rack.full.every((v) => v > 0.5), `${rack.clutch} eggs, ${JSON.stringify(rack.full)}`);

// ---- the brood hunts ----
// She lays with Y (the rocket slot). The rival is parked far away, so a
// hatchling that closes the distance is hunting and one that does not is
// escorting her — which is exactly the bug.
const hunt = await page.evaluate(`(() => {
  const g = window.__game;
  const mum = g.players[0];
  const rival = g.players[1];
  // stand them well apart, and hold the rival still so the gap is the test
  rival.position.set(mum.position.x + 46, rival.position.y, mum.position.z);
  (${STEP})(6, 'rocketPressed');
  (${STEP})(30 * 6);          // the egg incubates for five seconds
  const brood = g.enemies.filter((e) => e.owner === mum && e.alive && !e.def.egg);
  if (!brood.length) return { hatched: 0 };
  const spider = brood[0];
  const gapBefore = spider.position.distanceTo(rival.position);
  const homeBefore = spider.position.distanceTo(mum.position);
  (${STEP})(30 * 8);
  return {
    hatched: brood.length,
    kind: spider.kind,
    hunts: spider.hunts,
    owned: spider.owner === mum,
    team: spider.team === mum.team,
    gapBefore: +gapBefore.toFixed(1),
    gapAfter: +spider.position.distanceTo(rival.position).toFixed(1),
    homeBefore: +homeBefore.toFixed(1),
    homeAfter: +spider.position.distanceTo(mum.position).toFixed(1),
  };
})()`);
check('an egg hatches into a spiderling', hunt.hatched > 0 && hunt.kind === 'spiderling', JSON.stringify(hunt));
check('the hatchling fights on her team, to her credit',
  hunt.owned === true && hunt.team === true, `owned ${hunt.owned}, team ${hunt.team}`);
check('...and it hunts rather than escorting', hunt.hunts === true, String(hunt.hunts));
check('it closes on the enemy across the board',
  hunt.gapAfter < hunt.gapBefore - 8, `${hunt.gapBefore} m -> ${hunt.gapAfter} m`);
check('...which means leaving its mother',
  hunt.homeAfter > hunt.homeBefore + 4, `${hunt.homeBefore} m -> ${hunt.homeAfter} m`);

// ---- no ceiling but the laying rate ----
// Y is pressed on a long clock: every press that has a charged egg has to
// produce one, however many are already out. Eight was the old cap.
const swarm = await page.evaluate(`(() => {
  const g = window.__game;
  const mum = g.players[0];
  let laid = 0;
  let peak = 0;
  for (let round = 0; round < 26; round++) {
    const before = g.enemies.filter((e) => e.owner === mum && e.alive).length;
    (${STEP})(4, 'rocketPressed');
    (${STEP})(30 * 3.2);       // long enough to charge the next egg
    const after = g.enemies.filter((e) => e.owner === mum && e.alive).length;
    if (after > before) laid++;
    peak = Math.max(peak, after);
  }
  (${STEP})(30 * 7);           // let the last eggs hatch
  const brood = g.enemies.filter((e) => e.owner === mum && e.alive);
  return { laid, peak, brood: brood.length, hunting: brood.filter((e) => e.hunts).length };
})()`);
check('the swarm grows past the old cap of eight', swarm.peak > 8, `peak ${swarm.peak}`);
check('every charged egg she lays becomes brood', swarm.laid >= 12, `${swarm.laid} laid`);
check('and the whole swarm hunts',
  swarm.brood > 0 && swarm.hunting === swarm.brood, `${swarm.hunting}/${swarm.brood}`);

// ---- the sacs inflate and deflate ----
// A spent sac is a slack shell; it swells as the egg inside it grows, and
// collapses again when that egg leaves her back. Self-contained and last,
// because it spends the whole clutch: it charges up from wherever the earlier
// sections left her. The growth has to be *gradual* — watching it fill is the
// point — so the check samples a sac while it charges and insists on real
// in-between sizes rather than a jump.
const swell = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  const sacs = () => p.char.root.children.filter((c) => c.isMesh && c.geometry?.type === 'SphereGeometry');
  (${STEP})(30 * 22);                     // a full clutch to start from
  const full = sacs().map((m) => +m.scale.x.toFixed(3));
  // Spend the lot. Each press is throttled at half a second and an egg grows
  // back every three, so this has to keep pressing until the rack is actually
  // empty rather than press six times and assume.
  for (let i = 0; i < 40 && p.eggClutch > 0; i++) {
    (${STEP})(4, 'rocketPressed');
    (${STEP})(14);
  }
  // The loop stops the moment the count hits zero, which can be with the next
  // egg most of the way charged — a second later it is back and the rack is
  // not empty at all. One more press clears whatever finished on the way out.
  (${STEP})(16);                          // clear the half-second throttle
  (${STEP})(4, 'rocketPressed');
  (${STEP})(10);                          // long enough for a sac to collapse
  const empty = sacs().map((m) => +m.scale.x.toFixed(3));
  const emptyY = sacs().map((m) => +m.scale.y.toFixed(3));
  // Whichever sac is growing the next egg — which is the one at the clutch's
  // own count. Not always sac zero: the rack can never be caught perfectly
  // empty, because an egg goes on charging while the last ones are being laid
  // and one finishes during the beat it takes the sacs to collapse.
  const idx = Math.min(p.eggClutch, 5);
  const track = [];
  for (let i = 0; i < 14; i++) { (${STEP})(7); track.push(+sacs()[idx].scale.x.toFixed(3)); }
  return { full, empty, emptyY, track, idx, spent: p.eggClutch };
})()`);
const slack = swell.empty.filter((v) => v < 0.45);
check('a charged sac stands full', swell.full.every((v) => v > 0.98), JSON.stringify(swell.full));
check('a spent sac deflates in play',
  swell.spent <= 1 && slack.length >= 5,
  `${slack.length} slack, ${swell.spent} still charged: ${JSON.stringify(swell.empty)}`);

// And the mechanism itself, driven rather than waited on. The rack can never
// be caught perfectly empty in play — an egg goes on charging while the last
// ones are being laid, and one finishes during the beat it takes the sacs to
// collapse — so the shape of the swell is measured by pushing states through
// the readout directly and ticking the cosmetic clock that eases it.
const shape = await page.evaluate(`(() => {
  const p = window.__game.players[0];
  const sacs = () => p.char.root.children.filter((c) => c.isMesh && c.geometry?.type === 'SphereGeometry');
  const settle = (states, ticks) => {
    for (let i = 0; i < ticks; i++) { p.char.setEggs(states); p.char.cosmetic(1 / 30, i / 30); }
  };
  settle([-1, -1, -1, -1, -1, -1], 60);
  const flat = sacs().map((m) => ({ x: +m.scale.x.toFixed(3), y: +m.scale.y.toFixed(3) }));
  // walk one sac's charge from nothing to ready, sampling as it grows
  const track = [];
  for (let step = 0; step <= 20; step++) {
    settle([step / 20, -1, -1, -1, -1, -1], 3);
    track.push(+sacs()[0].scale.x.toFixed(3));
  }
  settle([1, -1, -1, -1, -1, -1], 60);
  const ready = +sacs()[0].scale.x.toFixed(3);
  return { flat, track, ready };
})()`);
const rising = shape.track.filter((v, i) => i > 0 && v > shape.track[i - 1] + 0.005).length;
const between = shape.track.filter((v) => v > 0.45 && v < 0.95).length;
check('an empty sac is a flat shell, not a small ball',
  shape.flat.every((s) => s.x < 0.45 && s.y < s.x * 0.8), JSON.stringify(shape.flat));
check('it swells gradually as its egg grows',
  rising >= 12 && between >= 4, `${rising} rising steps, ${between} in-between: ${JSON.stringify(shape.track)}`);
check('and stands full once the egg is ready', shape.ready > 0.98, String(shape.ready));

// The sculpt carries its own six eggs, and they are wound out of the way once
// the game drives the rack — otherwise a deflating sac would shrink down to
// reveal a bright sculpted egg sitting in the socket the game calls empty.
const sculpt = await page.evaluate(`(() => {
  const p = window.__game.players[0];
  const bones = [];
  p.char.root.traverse((o) => { if (/^sac\\d/i.test(o.name)) bones.push(+o.scale.x.toFixed(3)); });
  return bones;
})()`);
check("the sculpt's own clutch is wound away for a driven rack",
  sculpt.length > 0 && sculpt.every((v) => v < 0.1), JSON.stringify(sculpt));

// ---- the same body as a wave boss ----
// She fights as an AI boss too, where nobody counts her eggs. The rack is a
// player's readout, so on her it must stay off the sculpt's own pale clutch
// rather than covering it with six black balls.
const boss = await page.evaluate(`(() => {
  const g = window.__game;
  const at = g.players[0].position.clone();
  at.x += 12;
  const e = g.addReinforcement('broodmother', at);
  (${STEP})(60);
  const sacs = e.char.root.children.filter((c) => c.isMesh && c.geometry?.type === 'SphereGeometry');
  const sculpt = [];
  e.char.root.traverse((o) => { if (/^sac\\d/i.test(o.name)) sculpt.push(+o.scale.x.toFixed(3)); });
  return { sacs: sacs.length, shown: sacs.filter((s) => s.visible).length, sculpt };
})()`);
check('an AI broodmother wears no readout', boss.sacs === 6 && boss.shown === 0,
  `${boss.shown}/${boss.sacs} shown`);
check('...and keeps the clutch the sculpt gave her',
  boss.sculpt.length === 0 || boss.sculpt.every((v) => v > 0.9), JSON.stringify(boss.sculpt));

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall brood checks passed');
process.exit(failures.length ? 1 : 0);
