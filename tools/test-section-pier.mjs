/**
 * Run the Pier's own mechanics (docs/LEVEL_SECTIONS.md §2.10; src/sections/run-the-pier.ts).
 *
 *  - the rail camera is reversed: one shared view, ahead of the party, looking back;
 *  - the front runs between the slowest hunter's run and sprint;
 *  - a hunter behind the front is caught, and re-forms at the party's leading
 *    edge a few seconds later, short of hit points;
 *  - firing into the mouth staggers it back ten metres;
 *  - a hunter who has just reached a gate is not caught for two seconds;
 *  - everyone caught resets the pier to the last gate, the front behind it.
 *
 * Run:  node tools/test-section-pier.mjs   (HARNESS_PORT, CHROMIUM_PATH as usual)
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
await page.goto(`http://localhost:${PORT}/?section=run-the-pier`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', 2, 'trask', ['din', 'maul']);

const BLANK = blankInput();
const step = (sec) => page.evaluate(async ([blank, n]) => {
  const g = window.__game;
  for (let f = 0; f < n; f++) {
    g.update(1 / 30, [blank, blank, blank, blank]);
    if (f % 15 === 0) for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(1e7, e.position, -1);
    if (f % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}, [BLANK, Math.round(sec * 30)]);
const state = () => page.evaluate(() => {
  const g = window.__game;
  const s = g.campaign.section;
  const cam = g.sharedView?.camera;
  const dir = cam ? cam.getWorldDirection(cam.position.clone()) : null;
  return {
    Y0: g.campaign.stage.floorY,
    debug: s?.debug?.() ?? null,
    shared: !!g.sharedView,
    cam: cam ? { z: cam.position.z, dirZ: dir.z } : null,
    players: g.players.map((p) => ({ x: p.position.x, y: p.position.y, z: p.position.z, hp: p.hp, max: p.maxHp, alive: p.alive, run: p.profile.runSpeed, sprint: p.profile.sprintSpeed })),
  };
});
const put = (i, x, z) => page.evaluate(([i, x, z]) => {
  const g = window.__game;
  const p = g.players[i];
  p.position.set(x, g.campaign.stage.floorY + 0.05, z);
  p.velocity.set(0, 0, 0);
}, [i, x, z]);
const force = (name, ...args) => page.evaluate(([name, args]) => window.__game.campaign.section.force[name](...args), [name, args]);

for (let i = 0; i < 20 && (await page.evaluate(() => window.__game.state)) !== 'fighting'; i++) await step(0.5);
await step(1);
let st = await state();
check('Run the Pier is standing', !!st.debug, JSON.stringify(st.debug));

// ---- the camera ----
const cz = (st.players[0].z + st.players[1].z) / 2;
check('camera: one shared view', st.shared);
check('camera: reversed — ahead of the party, looking back at it', !!st.cam && st.cam.z > cz && st.cam.dirZ < -0.2,
  JSON.stringify({ cam: st.cam, party: cz.toFixed(1) }));

// ---- the front's pace ----
const runMin = Math.min(...st.players.map((p) => p.run)), sprintMin = Math.min(...st.players.map((p) => p.sprint));
check('front: faster than the slowest run, slower than its sprint', st.debug.speed > runMin && st.debug.speed < sprintMin,
  `${st.debug.speed} (run ${runMin}, sprint ${sprintMin})`);

// ---- caught, and back at the leading edge ----
await force('hold', 999);
await put(0, -1.6, 60);
await put(1, 1.6, 30);
await force('snap', 45);
await force('front', 34);
await step(0.3);
st = await state();
check('caught: a hunter behind the front is taken', !st.players[1].alive && st.debug.caught === 1, JSON.stringify({ alive: st.players[1].alive, caught: st.debug.caught }));
let back = null;
for (let i = 0; i < 16 && !back; i++) {
  await step(0.5);
  st = await state();
  if (st.players[1].alive && st.players[1].y > st.Y0 - 1) back = { t: (i + 1) * 0.5, ...st.players[1] };
}
check('caught: back within about three seconds', !!back && back.t <= 4.5, back ? `${back.t} s` : 'never');
check('caught: at the leading edge, not at the front', !!back && back.z > 50 && back.z < 70, back ? `z ${back.z.toFixed(1)} (leader 60)` : '');
await step(2);
const whole = (await state()).players[1];
check('caught: short of hit points once re-formed', whole.alive && whole.hp <= whole.max * 0.65, `${whole.hp.toFixed(0)}/${whole.max}`);

// ---- the stagger ----
await force('front', 40);
st = await state();
const before = st.debug.front;
await force('stagger', 2000);
await step(0.2);
st = await state();
check('stagger: fire into the mouth knocks the front back ten metres', st.debug.staggers === 1 && before - st.debug.front >= 9.5,
  `${before} -> ${st.debug.front}, staggers ${st.debug.staggers}`);

// ---- a gate is breathing room ----
await put(0, -1.6, 205.5);           // just past gate 2 (z 203): grace starts
await put(1, 1.6, 207);
await force('snap', 206);
await step(0.1);
await force('front', 206);
await step(1.2);
st = await state();
check('gate: a hunter who has just reached a gate is not caught for two seconds', st.players[0].alive, JSON.stringify(st.debug));
await step(1.5);
st = await state();
check('gate: but the grace runs out', !st.players[0].alive || st.debug.caught >= 2, JSON.stringify({ alive: st.players[0].alive, caught: st.debug.caught }));

// ---- everyone caught ----
await step(4);
await put(0, -1.6, 230);
await put(1, 1.6, 231);
await force('snap', 230);
await step(0.2);
const resetsBefore = (await state()).debug.resets;
await force('front', 240);
await step(0.4);
st = await state();
check('everyone caught: the pier resets', st.debug.resets === resetsBefore + 1, JSON.stringify(st.debug));
check('everyone caught: the front drops back behind the last gate', st.debug.front < 203, String(st.debug.front));
let up = null;
for (let i = 0; i < 16 && !up; i++) {
  await step(0.5);
  st = await state();
  if (st.players.every((p) => p.alive)) up = st.players;
}
check('everyone caught: the party re-forms at the last gate', !!up && up.every((p) => Math.abs(p.z - 204.5) < 4 && p.y > st.Y0 - 1),
  up ? JSON.stringify(up.map((p) => [p.z.toFixed(1), (p.y - st.Y0).toFixed(1)])) : 'never');

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
