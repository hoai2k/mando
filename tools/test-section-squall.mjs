/**
 * The Squall's own mechanics (docs/LEVEL_SECTIONS.md §2.9; src/sections/squall.ts).
 *
 * The section suite (test-sections.mjs) proves the Squall can be finished;
 * this one proves its pieces do what they say:
 *
 *  - K7 deck tilt: a body drifts toward the low side, more in the air than on
 *    its feet, and is drawn carried with the rolling hull;
 *  - the loose barrels slide with the roll;
 *  - a rogue wave carries an unbraced body over the far rail (the harbour
 *    takes it and it re-forms on the deckhouse roof), holds a braced one, and
 *    takes a hostile over the side for good;
 *  - lightning hits whoever is on the deckhouse roof, and nobody on the deck;
 *  - the loose boom knocks down whoever stands in its arc;
 *  - a wipe sends the wave in progress back to a breather, to be fought again.
 *
 * Run:  node tools/test-section-squall.mjs   (HARNESS_PORT, CHROMIUM_PATH as usual)
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
await page.goto(`http://localhost:${PORT}/?section=squall`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 2, 'trask', ['din', 'maul']);

const BLANK = blankInput();
/** step the match `sec` seconds; `inputs(f)` may give per-slot inputs for frame f */
const step = (sec, inputs = null) => page.evaluate(async ([blank, n, fn]) => {
  const g = window.__game;
  const make = fn ? new Function('f', 'g', fn) : null;
  for (let f = 0; f < n; f++) {
    const extra = make ? make(f, g) : null;
    g.update(1 / 30, [0, 1, 2, 3].map((i) => ({ ...blank, ...(extra?.[i] ?? {}) })));
    if (f % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}, [BLANK, Math.round(sec * 30), inputs]);
const state = () => page.evaluate(() => {
  const g = window.__game;
  const s = g.campaign.section;
  return {
    Y0: g.campaign.stage.floorY,
    debug: s?.debug?.() ?? null,
    players: g.players.map((p) => ({
      x: p.position.x, y: p.position.y, z: p.position.z, hp: p.hp, alive: p.alive,
      cover: !!p.cover, grounded: p.grounded, rootY: p.char.root.position.y,
    })),
    hostiles: g.enemies.filter((e) => e.alive && e.team === 1).length,
  };
});
/** stand player `i` at deck-local x, y-above-deck, z, still */
const put = (i, x, dy, z) => page.evaluate(([i, x, dy, z]) => {
  const g = window.__game;
  const p = g.players[i];
  p.position.set(x, g.campaign.stage.floorY + dy, z);
  p.velocity.set(0, 0, 0);
  p.cover = null;
  p.hp = p.maxHp;
}, [i, x, dy, z]);
const force = (name, ...args) => page.evaluate(([name, args]) => window.__game.campaign.section.force[name](...args), [name, args]);
const cull = () => page.evaluate(() => {
  for (const e of window.__game.enemies) if (e.alive && e.team === 1) e.damage(1e7, e.position, -1);
});

// quiet decks: no boarders, no waves until asked for
await force('quiet', 1);
await force('noRogue');
// the section only ticks once the match is fighting (after the drop's intro)
for (let i = 0; i < 20 && (await page.evaluate(() => window.__game.state)) !== 'fighting'; i++) await step(0.5);
await step(0.5);
await cull();
let st = await state();
check('the Squall is standing', !!st.debug, JSON.stringify(st.debug));
const Y0 = st.Y0;

// ---- K7: the drift ----
await force('roll', 10);
await put(0, 0, 0, 6.2);
await put(1, -1.5, 9, 6.2);
await step(0.1);
let a = await state();
await step(0.8);
let b = await state();
const groundDx = b.players[0].x - a.players[0].x;
const airDx = b.players[1].x - a.players[1].x;
check('tilt: a body on the deck drifts toward the low side', groundDx > 0.08, groundDx.toFixed(3));
check('tilt: and further in the air than on its feet', airDx > groundDx * 1.5, `air ${airDx.toFixed(3)} vs ground ${groundDx.toFixed(3)}`);
await force('roll', -10);
await put(0, 0, 0, 6.2);
await step(0.1);
a = await state();
await step(0.8);
b = await state();
check('tilt: the other way when the deck rolls back', b.players[0].x - a.players[0].x < -0.08, (b.players[0].x - a.players[0].x).toFixed(3));

// the picture: a body at the rail is drawn with the hull (a +10° roll drops +x)
await force('roll', 10);
await put(0, 5, 0, 6.2);
await step(0.05);
st = await state();
const drawn = st.players[0].rootY - st.players[0].y;
check('tilt: a body by the low rail is drawn lower with the rolled hull', drawn < -0.6 && drawn > -1.2, drawn.toFixed(3));

// the barrels slide
const b0 = (await state()).debug.barrels;
await force('roll', 12);
await step(2.5);
const b1 = (await state()).debug.barrels;
const slid = b0.map((x, i) => (x === null || b1[i] === null ? 0 : b1[i] - x));
check('tilt: the loose barrels slide toward the low side', slid.some((d) => d > 0.5) && slid.every((d) => d > -0.05), JSON.stringify(slid.map((d) => +d.toFixed(2))));
await force('roll');

// ---- the rogue wave ----
await put(0, 2.5, 0, -14);         // the open after deck, nothing to hold
await put(1, 5.85, 0, -8);          // against the starboard rail
await force('enemy', -2.5, -15.5);
await step(0.3);
// brace: one press of the cover button at the rail
await step(0.1, 'return f === 0 ? [null, { slamPressed: true }] : null;');
st = await state();
check('rogue wave: a player at the rail can brace', st.players[1].cover, JSON.stringify(st.players[1]));
const braceAt = { x: st.players[1].x, z: st.players[1].z };
const hostilesBefore = st.hostiles;
await force('rogue', 1);                 // from starboard: washes to port
let seenRoof = false;
for (let i = 0; i < 20; i++) {
  await step(0.5);
  st = await state();
  if (st.players[0].y > Y0 + 2.5) seenRoof = true;
}
check('rogue wave: it ran its course', st.debug.rogue === 'idle', st.debug.rogue);
check('rogue wave: the unbraced player went over the side', st.debug.overboard >= 1, String(st.debug.overboard));
check('rogue wave: and re-formed on the deckhouse roof', seenRoof, `y ${st.players[0].y.toFixed(2)} (deck ${Y0})`);
check('rogue wave: the braced player held', Math.hypot(st.players[1].x - braceAt.x, st.players[1].z - braceAt.z) < 0.8 && st.debug.overboard === 1,
  `moved ${Math.hypot(st.players[1].x - braceAt.x, st.players[1].z - braceAt.z).toFixed(2)} m, overboard ${st.debug.overboard}`);
check('rogue wave: a hostile on the open deck went over and did not come back', hostilesBefore >= 1 && st.hostiles === 0, `${hostilesBefore} -> ${st.hostiles}`);

// ---- lightning ----
await put(0, -1, 3, -2.5);          // the deckhouse roof
await put(1, -4, 0, 6);             // the foredeck
await step(0.2);
const before = await state();
await force('lightning');
await step(3);
st = await state();
check('lightning: it struck', st.debug.strikes === 1, String(st.debug.strikes));
check('lightning: whoever was on the roof took it', before.players[0].hp - st.players[0].hp >= 30,
  `${before.players[0].hp.toFixed(0)} -> ${st.players[0].hp.toFixed(0)}`);
check('lightning: nobody on the deck did', st.players[1].hp >= before.players[1].hp - 1,
  `${before.players[1].hp.toFixed(0)} -> ${st.players[1].hp.toFixed(0)}`);

// ---- the boom ----
await force('boom');
await put(0, -1, 3, -2.5);
await put(1, 3.5, 0, -10.5);        // in the arc, abaft the king post
const hp0 = (await state()).players[1].hp;
let hits = 0;
for (let i = 0; i < 16 && !hits; i++) {
  await step(1, 'return [null, null];');
  st = await state();
  hits = st.debug.boomHits;
  if (!hits) await put(1, 3.5, 0, -10.5);
}
check('boom: loose, it swings through its arc and knocks down whoever is in it', hits >= 1 && st.players[1].hp < hp0,
  `hits ${hits}, hp ${hp0.toFixed(0)} -> ${st.players[1].hp.toFixed(0)}`);

// ---- a wipe ----
await force('quiet', 0);
await force('wave', 1);
await step(3);
await page.evaluate(() => { for (const p of window.__game.players) p.damage(1e6, p.position, -1); });
await step(0.2);
st = await state();
check('wipe: the wave in progress goes back to a breather', st.debug.phase === 'breather', JSON.stringify(st.debug));
await cull();
await step(12);
st = await state();
check('wipe: the party comes back, and the wave is fought again', st.players.some((p) => p.alive) && st.debug.phase === 'wave' && st.debug.wave === 2,
  JSON.stringify({ phase: st.debug.phase, wave: st.debug.wave, alive: st.players.map((p) => p.alive) }));
const roofed = st.players.filter((p) => p.alive && p.y > Y0 + 2.5 && Math.abs(p.x) < 3.5).length;
check('wipe: re-formed on the deckhouse roof', roofed >= 1, JSON.stringify(st.players.map((p) => [p.x.toFixed(1), (p.y - Y0).toFixed(1), p.z.toFixed(1)])));

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
