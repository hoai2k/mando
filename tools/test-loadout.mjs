/**
 * Loadout regression test: the fighter never has to arrange their own hands.
 *
 * The rule the controls now follow is that the button which *uses* a weapon is
 * the button that draws it. X swings, and the blade comes out to do it; RT
 * fires, and the gun comes back up to do that — even straight out of a combo,
 * which used to leave the trigger dead until you found the swap button. The
 * D-pad is left to choose *which* blade or which gun, for a fighter carrying
 * more than one.
 *
 * Run:  node tools/test-loadout.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
};

const h = await launch();
const { page } = h;
await h.waitForText(/WAVE BATTLE|PRESS START/i);

/**
 * Step the game by hand with a chosen input, so a press is exactly one press.
 * The fields match `FrameInput` in src/core/input.ts.
 */
const STEP = `(spec) => {
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const g = window.__game;
  const p = g.players[0];
  for (let i = 0; i < spec.frames; i++) {
    const inputs = [blank(), blank(), blank(), blank()];
    // an edge is one frame, a hold is every frame
    if (i === 0) for (const k of spec.press || []) inputs[0][k] = true;
    for (const k of spec.hold || []) inputs[0][k] = true;
    g.update(1/30, inputs);
  }
  return {
    weapon: p.weapon,
    label: p.weaponLabel(),
    melee: p.meleeKind,
    ranged: p.rangedKind,
    fireCd: +p.fireCd.toFixed(2),
  };
}`;

// Din carries the staff and the blade, so he exercises the D-pad as well
await page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('wave', 1, 'desert', ['din']);
});
await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
await page.evaluate(() => { window.__manual = true; });

const step = (spec) => page.evaluate(`(${STEP})(${JSON.stringify(spec)})`);

// ---- 1. a fighter starts with a gun in hand ----
let s = await step({ frames: 4 });
check('starts holding the gun', s.weapon === 'blaster', s);

// ---- 2. X swings, and the swing draws the blade ----
s = await step({ frames: 6, press: ['meleePressed'] });
check('X draws the melee weapon', s.weapon === 'gaffi', s);

// ---- 3. RT out of the swing fires without a swap ----
// This is the whole complaint: the trigger used to do nothing at all until the
// player pressed the swap button first.
s = await step({ frames: 30, hold: ['shootHeld'] });
check('RT draws the gun straight out of a melee combo', s.weapon === 'blaster', s);
check('and the shot actually goes off', s.fireCd > 0, { fireCd: s.fireCd });

// ---- 4. the D-pad picks within a slot, never between them ----
const before = s.melee;
s = await step({ frames: 4, press: ['meleeSwapPressed'] });
check('D-pad left picks the next blade and draws it',
  s.weapon === 'gaffi' && s.melee !== before, { was: before, now: s.melee, weapon: s.weapon });
const cycled = s.melee;
s = await step({ frames: 4, press: ['meleeSwapPressed'] });
check('and cycles back round the loadout', s.melee !== cycled, { was: cycled, now: s.melee });

s = await step({ frames: 4, press: ['rangedSwapPressed'] });
check('D-pad right picks a gun and draws it', s.weapon === 'blaster' && !!s.ranged, s);

// ---- 5. everyone is armed at both ranges, without a swap ----
// A gun is the usual answer at range, but not the only one: Ventress throws a
// saber off the same trigger, and the playable war beasts fight with teeth.
// What has to hold is that nobody is left with a slot they cannot use.
const armed = await page.evaluate(() => {
  const out = {};
  for (const def of window.__playables()) {
    out[def.id] = {
      ranged: def.profile.rangedOptions.length,
      melee: def.profile.meleeOptions.length,
      throws: def.profile.meleeOptions[0] === 'sabers' && !def.profile.rangedOptions.length,
      beast: def.id.startsWith('npc:'),
    };
  }
  return out;
});
const unarmed = Object.entries(armed)
  .filter(([, k]) => !k.melee || (!k.ranged && !k.throws && !k.beast))
  .map(([id]) => id);
check('every playable fighter is armed in both hands', unarmed.length === 0, unarmed);
const ventress = armed.ventress;
check('and the one who carries no gun throws a blade instead',
  !!ventress && ventress.ranged === 0 && ventress.throws, ventress);

// ---- the throw itself: tap swings, hold throws, release brings it home ----
await h.page.evaluate(() => window.__startMode('wave', 1, 'desert', ['ventress']));
for (let i = 0; i < 400; i++) {
  const there = await h.page.evaluate(() =>
    window.__game?.board.kind === 'desert' && window.__state === 'playing');
  if (there) break;
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 9000));
const rt = await h.page.evaluate(() => {
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
  const DT = 1 / 60, g = window.__game, p = g.players[0];
  const step = (secs, rtHeld) => {
    inputs[0].shootHeld = !!rtHeld;
    for (let t = 0; t < secs; t += DT) g.update(DT, inputs);
    inputs[0].shootHeld = false;
  };
  // any ribbon geometry still drawn in the throw's own container
  const ribbon = () => {
    let on = false;
    p.throwFx?.traverse((o) => { if (o.isMesh && o.visible && o.geometry?.attributes?.color) on = true; });
    return on;
  };
  const out = {};
  step(0.10, true); step(0.4, false);
  out.tapKeptBlades = p.sabersHeld;
  out.tapSwung = p.meleeComboWindow > 0 || p.meleeTimer > 0;
  step(1.2, false);
  step(0.5, true);
  out.holdThrew = p.sabersHeld;
  step(1.0, true);
  out.stayedOut = p.sabersHeld;
  step(2.5, false);
  out.cameHome = p.sabersHeld;
  step(3.0, false);
  out.ribbonAfter = ribbon();
  window.__manual = false;
  return out;
});
// A pull is her attack button first: throwing on every press left her unable
// to swing with RT at all without disarming herself.
check('a quick pull swings and keeps both blades', rt.tapKeptBlades === 2 && rt.tapSwung, rt);
check('holding sends one out, and it stays out', rt.holdThrew === 1 && rt.stayedOut === 1, rt);
check('releasing brings it back to her hand', rt.cameHome === 2, rt);
// The blade's trail stopped being ticked once it was home, so its last samples
// never aged out and the mesh stayed visible — a sweep hanging in the air for
// the rest of the match.
check('and leaves no ribbon hanging in the air', rt.ribbonAfter === false, rt);

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall loadout checks passed');
process.exit(failures.length ? 1 : 0);
