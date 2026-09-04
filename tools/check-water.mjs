/**
 * Water, on a board that has some.
 *
 * Three things to hold. A fighter with no jetpack has to be able to get out
 * of the water and back onto a deck — the breach arms the held climb, so
 * keeping the button down carries them well above the surface rather than
 * dropping them straight back in. The swim has to look like swimming, not
 * like a jetpack hover. And a body built for water — Bossk — has to be
 * meaningfully quicker through it than one that is not.
 */
import { launch, BTN } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = await launch();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; };

/** start a Wave Battle on the Prison Rig as the named fighter */
async function startAs(name) {
  await h.waitForText(/PRESS START|WAVE BATTLE/i);
  await h.pad.tap(BTN.START);
  await h.waitForText(/CHOOSE|TERRITORY|DUNE SEA/i);
  // by name, not by counting presses: the territory grid moves focus by where
  // cards sit on screen, so a run of DRIGHTs does not land on a known board
  await h.clickText('The Prison Rig');
  await h.waitForText(/CHOOSE YOUR|DIN DJARIN/i);
  for (let i = 0; i < 14; i++) {
    if (new RegExp(name, 'i').test(await h.text())) break;
    await h.pad.tap(BTN.DRIGHT);
  }
  await h.tapUntil(BTN.A, async () => /READY/i.test(await h.text()));
  await h.pad.tap(BTN.A);
  await h.tapUntil(BTN.A, () => h.page.evaluate(() => !!window.__game), { timeoutMs: 25000 });
  await h.waitForPlaying();
}

/**
 * Drop the player in the water, then swim: hold forward for `swimFrames` and
 * report how far they got, then press and hold jump to breach and report the
 * height reached above the surface.
 */
async function swimAndBreach(swimFrames) {
  return h.page.evaluate(async (frames) => {
    const g = window.__game;
    const p = g.players[0];
    const anim = p.char.animator;
    const dt = 1 / 60;
    const base = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
      dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
      meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
      zoomDelta: 0, blockHeld: false, switchPressed: false, pausePressed: false,
      throttleHeld: false, brakeHeld: false,
    };
    const pad = (over) => [{ ...base, ...over }, { ...base }, { ...base }, { ...base }];
    const waterY = g.board.waterY;

    // put them well under the surface, away from the deck they fell off
    p.position.y = waterY - 3;
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    // look level so "forward" is along the surface, not into the floor
    p.cam.pitch = 0;
    for (let i = 0; i < 20; i++) g.update(dt, pad({}));

    // How fast they get through the water, not how far they get: the rig has
    // walls and decks in it, and a swimmer who runs into one has been measured
    // against the building rather than against their own body.
    const from = p.position.clone();
    const clips = new Set();
    let fastest = 0;
    for (let i = 0; i < frames; i++) {
      g.update(dt, pad({ moveY: 1 }));
      fastest = Math.max(fastest, Math.hypot(p.velocity.x, p.velocity.z));
      if (anim.current?.lower) clips.add(anim.current.lower);
    }
    const swam = Math.hypot(p.position.x - from.x, p.position.z - from.z);
    const swimming = p.swimming;

    // surface, then breach with the button held down
    for (let i = 0; i < 240 && p.position.y + 1.7 < waterY; i++) g.update(dt, pad({ jumpHeld: true }));
    let peak = p.position.y;
    let breachVel = 0;
    // `superRising` out of the water is the mechanism itself: the held climb a
    // standing leap gives, armed by the breach. Height alone would be a
    // measure of whatever happens to be over this patch of water — the rig has
    // overhangs, and a climb that ends against one has still worked.
    let rising = false;
    for (let i = 0; i < 200; i++) {
      g.update(dt, pad({ jumpHeld: true, jumpPressed: i === 0 }));
      if (i === 0) breachVel = p.velocity.y;
      peak = Math.max(peak, p.position.y);
      if (!p.swimming && p.superRising) rising = true;
      if (p.grounded) break;
    }
    return {
      board: g.board.kind,
      waterY,
      name: p.profile.name,
      amphibious: p.profile.amphibious,
      flight: p.profile.flight,
      swam, fastest, breachVel, swimming, clips: [...clips],
      rising,
      above: peak - waterY,
    };
  }, swimFrames);
}

// ---- a fighter with no jetpack, and no gift for water ----
await startAs('embo');
const dry = await swimAndBreach(180);
console.log(`  board: ${dry.board}, water at y=${dry.waterY}`);
console.log(`  ${dry.name} (${dry.flight}): up to ${dry.fastest.toFixed(1)} m/s through the water, legs ran ${dry.clips.join(',')}, breached at ${dry.breachVel.toFixed(1)} m/s and reached ${dry.above.toFixed(1)} m above the surface`);
check(dry.swimming === true, 'a fighter out of their depth is swimming');
check(dry.clips.includes('swimLower'), '...and swims rather than hovering on a jetpack pose');
check(dry.fastest > 3, 'and gets moving — the spot measured is open water, not a wall');
check(dry.above > 3, 'holding jump out of the water carries a super jumper clear of the surface');
check(dry.rising === true, '...on the same held climb a standing leap gives, which is what reaches a deck');

// ---- and one that is built for it ----
await h.page.reload({ waitUntil: 'networkidle' });
await startAs('bossk');
const wet = await swimAndBreach(180);
console.log(`  ${wet.name} (amphibious=${wet.amphibious}): up to ${wet.fastest.toFixed(1)} m/s, breached at ${wet.breachVel.toFixed(1)} m/s`);
check(wet.amphibious === true, 'Bossk is flagged as amphibious');
check(wet.fastest > dry.fastest * 1.25, 'and swims meaningfully faster than a fighter who is not');
check(wet.breachVel > dry.breachVel * 1.25, '...and comes out of the water harder');

await h.close();
console.log(failures ? `\n${failures} failure(s)` : '\nthe water reads right from both sides of it');
process.exit(failures ? 1 : 0);
