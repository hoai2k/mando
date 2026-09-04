/**
 * The acrobat's air somersault.
 *
 * Three things to hold: a second jump in the air rolls Ventress into the tuck
 * and keeps her turning while the button is down; letting go does not leave
 * her falling head-down but carries the turn round to upright and unfolds her
 * into a normal fall; and a fighter without `airFlip` — Din, who has a
 * jetpack to hold instead — never rolls at all.
 */
import { launch, BTN } from './harness.mjs';

const h = await launch();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`); if (!ok) failures++; };

/** start a match as the named fighter, whatever their place in the roster is */
async function startAs(name) {
  await h.waitForText(/PRESS START|WAVE BATTLE/i);
  await h.pad.tap(BTN.START);
  await h.waitForText(/CHOOSE|TERRITORY|DUNE SEA/i);
  await h.pad.tap(BTN.A);
  await h.waitForText(/CHOOSE YOUR|DIN DJARIN/i);
  for (let i = 0; i < 14; i++) {
    if (new RegExp(name, 'i').test(await h.text())) break;
    await h.pad.tap(BTN.DRIGHT);
  }
  await h.tapUntil(BTN.A, async () => /READY/i.test(await h.text()));
  await h.pad.tap(BTN.A);
  await h.tapUntil(BTN.A, () => h.page.evaluate(() => !!window.__game), { timeoutMs: 20000 });
  await h.waitForPlaying();
}

/**
 * Lift the player off the ground, then hold jump for `holdFrames` and let go,
 * sampling the body's pitch and which clip its legs are playing throughout.
 */
async function tumble(holdFrames) {
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
    };
    const pad = (over) => [{ ...base, ...over }, { ...base }, { ...base }, { ...base }];
    // well clear of the ground, falling gently, with no jump left to spend
    p.position.y += 24;
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    g.update(dt, pad({}));

    const out = { held: [], settle: [], clipsHeld: new Set(), clipsAfter: new Set() };
    for (let i = 0; i < frames; i++) {
      g.update(dt, pad({ jumpHeld: true, jumpPressed: i === 0 }));
      out.held.push(p.char.root.rotation.x);
      if (anim.current?.lower) out.clipsHeld.add(anim.current.lower);
    }
    for (let i = 0; i < 180 && !p.grounded; i++) {
      g.update(dt, pad({}));
      out.settle.push(p.char.root.rotation.x);
      if (anim.current?.lower) out.clipsAfter.add(anim.current.lower);
    }
    return {
      name: p.profile.name,
      airFlip: p.profile.airFlip,
      held: out.held,
      settle: out.settle,
      clipsHeld: [...out.clipsHeld],
      clipsAfter: [...out.clipsAfter],
      grounded: p.grounded,
    };
  }, holdFrames);
}

// ---- the acrobat ----
await startAs('ventress');
const v = await tumble(45);
const turned = Math.max(...v.held) - Math.min(...v.held);
console.log(`  ${v.name}: airFlip=${v.airFlip}, pitch swept ${turned.toFixed(2)} rad while held, legs ran ${v.clipsHeld.join(',')}`);
check(v.airFlip === true, 'Ventress is flagged as an acrobat');
check(turned > 5, 'holding jump in the air turns her most of a revolution or more');
check(v.clipsHeld.includes('tuckLower'), '...in the tuck-roll pose');

const last = v.settle[v.settle.length - 1];
const upright = Math.abs(Math.atan2(Math.sin(last), Math.cos(last)));
console.log(`  after release: settled at ${last.toFixed(3)} rad (${upright.toFixed(3)} from upright), legs ran ${v.clipsAfter.join(',')}`);
check(upright < 0.25, 'letting go leaves her upright, not head-down');
check(v.clipsAfter.includes('airLower'), '...and unfolds back to the falling stance');
// the turn must carry on past the release rather than stopping dead
const afterRelease = Math.abs(v.settle[6] - v.settle[0]);
check(afterRelease > 0.05, 'the roll carries on turning after the button comes up');

// ---- and a fighter who is not one ----
await h.page.reload({ waitUntil: 'networkidle' });
await startAs('din djarin');
const d = await tumble(45);
const dinTurn = Math.max(...d.held) - Math.min(...d.held);
console.log(`  ${d.name}: airFlip=${d.airFlip}, pitch swept ${dinTurn.toFixed(2)} rad, legs ran ${d.clipsHeld.join(',')}`);
check(d.airFlip === false, 'Din is not an acrobat');
check(dinTurn < 1, 'and holding jump in the air does not roll him');
check(!d.clipsHeld.includes('tuckLower'), '...nor put him in a tuck');

await h.close();
console.log(failures ? `\n${failures} failure(s)` : '\nthe somersault rolls and lands upright');
process.exit(failures ? 1 : 0);
