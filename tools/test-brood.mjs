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
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
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
//
// She is held on her feet for the measurement. This is a PvP duel and the
// rival's squad is walking at her the whole time; once the audit pass sharpened
// the AI, a queen standing still for twenty-five seconds started dying at about
// second twenty-four, and `spawnAt` empties the clutch — so the check was
// reading a rack that had just been reset rather than one that had filled.
const rack = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  const hold = () => { p.hp = p.maxHp; };
  const read = () => {
    // the rack answering for itself: how full each sac looks and how brightly
    // it reads, whether the sculpt's own eggs are driving it or the stand-in's
    const shown = [];
    for (let i = 0; i < 6; i++) {
      const s = p.char.eggShown?.(i);
      if (s) shown.push({ fill: +s.fill.toFixed(3), shade: +s.shade.toFixed(3) });
    }
    return shown;
  };
  const start = read();
  for (let i = 0; i < 30 * 25; i++) { (${STEP})(1); hold(); }
  const full = read();
  return { name: p.profile.name, sacs: start.length, start, full, clutch: p.eggClutch };
})()`);
check('the rack shows one sac per egg the sculpt carries', rack.sacs === 6, `${rack.sacs} sacs`);
// Spent is the sculpt's own egg collapsed and darkened, not a bead laid over
// it: both halves of that have to be true, or a "spent" sac is a full pale egg
// wearing a dark coat — which is the bug this rack replaced.
check('an empty clutch collapses every sac',
  rack.start.every((v) => v.fill < 0.05), JSON.stringify(rack.start));
check('...and darkens it',
  rack.start.every((v) => v.shade < 0.25), JSON.stringify(rack.start));
check('a full clutch stands every egg back up',
  rack.clutch === 6 && rack.full.every((v) => v.fill > 0.9), `${rack.clutch} eggs, ${JSON.stringify(rack.full)}`);
check('...unmodified, which is the sculpt as delivered',
  rack.full.every((v) => v.shade > 0.9), JSON.stringify(rack.full));

// ---- the brood hunts ----
// She lays with Y (the rocket slot). The rival is parked far away, so a
// hatchling that closes the distance is hunting and one that does not is
// escorting her — which is exactly the bug.
const hunt = await page.evaluate(`(() => {
  const g = window.__game;
  const mum = g.players[0];
  const rival = g.players[1];
  // Stand them well apart, and take the rival's SQUAD off the board: a hunter
  // crosses to whatever is *nearest*, so with tuskens walking up to the queen
  // the spider correctly bites one of those and never leaves home — hunting
  // working, read as hunting failing. One distant rival is the only way this
  // check means what it says.
  rival.position.set(mum.position.x + 46, rival.position.y, mum.position.z);
  for (const e of g.enemies) {
    if (e.owner === rival) { e.alive = false; e.removeMe = true; }
  }
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
// A spent sac is the sculpt's own egg collapsed against her back; it stands
// back up as the next egg grows in it, and collapses again when that egg
// leaves. Self-contained and last, because it spends the whole clutch: it
// charges up from wherever the earlier sections left her. The growth has to be
// *gradual* — watching it fill is the point — so the check samples a sac while
// it charges and insists on real in-between sizes rather than a jump.
const swell = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  const rack = () => { const out = []; for (let i = 0; i < 6; i++) out.push(p.char.eggShown(i)); return out; };
  (${STEP})(30 * 22);                     // a full clutch to start from
  const full = rack().map((s) => +s.fill.toFixed(3));
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
  const empty = rack().map((s) => +s.fill.toFixed(3));
  const dark = rack().map((s) => +s.shade.toFixed(3));
  return { full, empty, dark, spent: p.eggClutch };
})()`);
const slack = swell.empty.filter((v) => v < 0.15);
check('a charged egg stands full', swell.full.every((v) => v > 0.95), JSON.stringify(swell.full));
check('a spent sac collapses in play',
  swell.spent <= 1 && slack.length >= 5,
  `${slack.length} slack, ${swell.spent} still charged: ${JSON.stringify(swell.empty)}`);

// And the mechanism itself, driven rather than waited on. The rack can never
// be caught perfectly empty in play — an egg goes on charging while the last
// ones are being laid, and one finishes during the beat it takes the sacs to
// collapse — so the shape of the swell is measured by pushing states through
// the readout directly and ticking the cosmetic clock that eases it.
const shape = await page.evaluate(`(() => {
  const p = window.__game.players[0];
  const rack = () => { const out = []; for (let i = 0; i < 6; i++) out.push(p.char.eggShown(i)); return out; };
  const settle = (states, ticks) => {
    for (let i = 0; i < ticks; i++) { p.char.setEggs(states); p.char.cosmetic(1 / 30, i / 30); }
  };
  settle([-1, -1, -1, -1, -1, -1], 60);
  const flat = rack().map((s) => ({ fill: +s.fill.toFixed(3), shade: +s.shade.toFixed(3) }));
  // walk one sac's charge from nothing to ready, sampling as it grows
  const track = [];
  for (let step = 0; step <= 20; step++) {
    settle([step / 20, -1, -1, -1, -1, -1], 3);
    track.push(+rack()[0].fill.toFixed(3));
  }
  settle([1, -1, -1, -1, -1, -1], 60);
  const ready = rack()[0];
  return { flat, track, ready: { fill: +ready.fill.toFixed(3), shade: +ready.shade.toFixed(3) } };
})()`);
const rising = shape.track.filter((v, i) => i > 0 && v > shape.track[i - 1] + 0.005).length;
const between = shape.track.filter((v) => v > 0.25 && v < 0.9).length;
check('an empty sac is collapsed and dark, both at once',
  shape.flat.every((s) => s.fill < 0.05 && s.shade < 0.25), JSON.stringify(shape.flat));
check('it swells gradually as its egg grows',
  rising >= 12 && between >= 4, `${rising} rising steps, ${between} in-between: ${JSON.stringify(shape.track)}`);
check('and a ready egg is the sculpt untouched — full size, full colour',
  shape.ready.fill > 0.98 && shape.ready.shade > 0.98, JSON.stringify(shape.ready));

// Her back is her own. The rack used to wind the sculpt's three egg-sac bones
// in to hide its clutch, and the abdomen is skinned to them too — which is
// what left her looking deflated with procedural beads stuck on top. Now that
// the game drives the sculpted eggs themselves, nothing touches those bones.
const sculpt = await page.evaluate(`(() => {
  const p = window.__game.players[0];
  const bones = [];
  p.char.root.traverse((o) => { if (/^sac\\d/i.test(o.name)) bones.push(+o.scale.x.toFixed(3)); });
  return bones;
})()`);
check('the sculpt keeps the back it was delivered with',
  sculpt.length > 0 && sculpt.every((v) => v > 0.9), JSON.stringify(sculpt));

// The egg leaves from the egg. `eggSpot` reports where the sac that is about
// to empty actually is on her back, and the delivered egg is born there — the
// whole reason the rack is driven on the sculpt's own geometry.
const born = await page.evaluate(`(() => {
  const g = window.__game;
  const p = g.players[0];
  (${STEP})(30 * 22);                     // a full clutch
  const v = new (p.position.constructor)();
  const spots = [];
  for (let i = 0; i < 6; i++) { v.set(0, 0, 0); p.char.eggSpot(i, v); spots.push(v.clone()); }
  const top = spots[p.eggClutch - 1];
  const before = new Set(g.enemies.filter((e) => e.alive));
  (${STEP})(4, 'rocketPressed');
  const laid = g.enemies.filter((e) => e.alive && e.def.egg && !before.has(e));
  const egg = laid[laid.length - 1];
  return {
    clutch: 6,
    spread: +Math.max(...spots.map((a) => Math.max(...spots.map((b) => a.distanceTo(b))))).toFixed(2),
    onHerBack: +Math.min(...spots.map((s) => s.distanceTo(p.position))).toFixed(2),
    fromTop: egg ? +egg.position.distanceTo(top).toFixed(2) : null,
  };
})()`);
check('every sac reports its own place on her back',
  born.spread > 0.8 && born.onHerBack < 6, JSON.stringify(born));
check('the laid egg is born at the sac that empties',
  born.fromTop !== null && born.fromTop < 0.6, `${born.fromTop} m from the sac`);

// ---- the same body as a wave boss ----
// She fights as an AI boss too, where nobody counts her eggs. The rack is a
// player's readout, so on her it must leave the sculpt exactly as delivered:
// a full clutch on an undeflated back, and no stand-in beads over it.
await page.evaluate(`(() => {
  const g = window.__game;
  const at = g.players[0].position.clone();
  at.x += 12;
  window.__boss = g.addReinforcement('broodmother', at);
  (${STEP})(30);
})()`);
// real time, not sim ticks: her sculpt arrives on a promise, and stepping the
// simulation sixty times in one turn never lets that promise resolve
await new Promise((r) => setTimeout(r, 4000));
const boss = await page.evaluate(`(() => {
  (${STEP})(30);
  const e = window.__boss;
  const beads = [];
  e.char.root.traverse((o) => { if (o.isMesh && o.userData.readout) beads.push(o.visible); });
  const shown = [];
  for (let i = 0; i < 6; i++) shown.push(e.char.eggShown(i));
  const sculpt = [];
  e.char.root.traverse((o) => { if (/^sac\\d/i.test(o.name)) sculpt.push(+o.scale.x.toFixed(3)); });
  return { beads: beads.length, lit: beads.filter(Boolean).length, shown, sculpt, model: sculpt.length > 0 };
})()`);
check('an AI broodmother wears no readout', boss.lit === 0, `${boss.lit}/${boss.beads} beads shown`);
check('her sculpt is on', boss.model === true, JSON.stringify(boss.sculpt));
check('...and it carries the full clutch it was delivered with',
  boss.shown.every((s) => s && s.fill > 0.98 && s.shade > 0.98), JSON.stringify(boss.shown));
check('...on the back it was delivered with',
  boss.sculpt.every((v) => v > 0.9), JSON.stringify(boss.sculpt));

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall brood checks passed');
process.exit(failures.length ? 1 : 0);
