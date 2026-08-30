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

// ---- 5. everyone is armed both ways, blades-first fighters included ----
const armed = await page.evaluate(() => {
  const out = {};
  for (const def of window.__playables()) {
    out[def.id] = {
      ranged: def.profile.rangedOptions.length,
      melee: def.profile.meleeOptions.length,
    };
  }
  return out;
});
const unarmed = Object.entries(armed)
  .filter(([id, k]) => !k.melee || (!k.ranged && !id.startsWith('npc:')))
  .map(([id]) => id);
check('every playable fighter carries both a gun and a blade', unarmed.length === 0, unarmed);

if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall loadout checks passed');
process.exit(failures.length ? 1 : 0);
