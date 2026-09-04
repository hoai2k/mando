/**
 * Blaster overheat regression test, for players and for hostiles.
 *
 * The mechanic is a rhythm rather than a number: hold the trigger and the
 * barrel fills, keep holding and it locks out, let go for a moment and it
 * comes back. That is only worth anything if sustained fire actually reaches
 * the lockout and a normal firefight does not, so both ends are asserted here.
 *
 * The simulation is stepped directly rather than through the render loop:
 * software rendering runs at a frame a second or two, and four seconds of
 * trigger time would otherwise take minutes of wall clock.
 *
 * Run:  node tools/test-overheat.mjs
 */
import { launch } from './harness.mjs';

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}: ${JSON.stringify(detail)}`);
  if (!ok) failures.push(name);
}

const h = await launch();
await h.waitForText(/PRESS START|WAVE BATTLE/i);
await h.startCoop(1, 'desert');

// ---- 1. a player holding the trigger overheats, then recovers ----
const player = await h.page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  const base = window.__input.read(0, 0.05);
  const step = (shootHeld, n) => {
    let firstLock = -1;
    for (let i = 0; i < n; i++) {
      p.update(0.05, { ...base, shootHeld }, g);
      if (shootHeld && p.overheated && firstLock < 0) firstLock = i;
    }
    return firstLock;
  };
  const lockedAt = step(true, 200);              // 10 s of held trigger
  const heatAtLock = p.heat;
  const lockedStill = p.overheated;
  step(false, 60);                               // 3 s off the trigger
  return {
    lockedAfterSeconds: lockedAt < 0 ? null : +(lockedAt * 0.05).toFixed(1),
    heatAtLock: +heatAtLock.toFixed(2), lockedStill,
    recovered: !p.overheated, heatAfterCooling: +p.heat.toFixed(2),
  };
});
check('holding the trigger overheats the blaster',
  player.lockedAfterSeconds !== null && player.lockedAfterSeconds > 2 && player.lockedAfterSeconds < 8, player);
check('...and it comes back after letting go', player.recovered && player.heatAfterCooling === 0, player);

// ---- 2. tapping in bursts never overheats ----
const bursts = await h.page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  p.heat = 0; p.overheated = false;
  const base = window.__input.read(0, 0.05);
  let peak = 0;
  // six shots, then a breath — the tempo of an actual firefight
  for (let round = 0; round < 14; round++) {
    for (let i = 0; i < 9; i++) { p.update(0.05, { ...base, shootHeld: true }, g); peak = Math.max(peak, p.heat); }
    for (let i = 0; i < 20; i++) { p.update(0.05, { ...base, shootHeld: false }, g); }
  }
  return { peak: +peak.toFixed(2), overheated: p.overheated };
});
check('firing in bursts never locks the weapon out', !bursts.overheated && bursts.peak < 1, bursts);

// ---- 3. a rapid-fire hostile leaning on a firefight vents ----
const enemy = await h.page.evaluate(() => {
  const g = window.__game;
  const p = g.players[0];
  // a hostile with a fast cycle, planted in the open with a clear shot
  const spot = p.position.clone();
  spot.x += 12;
  const e = g.addReinforcement('stormtrooper', spot);
  e.alert(p.position, true);
  let vented = 0;
  let peak = 0;
  let shots = 0;
  const fire = g.projectiles.fire.bind(g.projectiles);
  g.projectiles.fire = (...a) => { shots++; return fire(...a); };
  let wasVenting = false;
  for (let i = 0; i < 1200; i++) {          // a minute of held contact
    e.position.set(p.position.x + 12, p.position.y, p.position.z);
    e.update(0.05, g);
    peak = Math.max(peak, e.heat);
    if (e.venting > 0 && !wasVenting) vented++;
    wasVenting = e.venting > 0;
  }
  g.projectiles.fire = fire;
  return { vents: vented, peakHeat: +peak.toFixed(2), shots };
});
// A minute of unbroken contact should cost a stormtrooper a handful of vents,
// not put it in a permanent stall: the pause is an opening, not the norm.
check('a hostile in a long firefight has to vent', enemy.vents >= 1 && enemy.vents <= 6, enemy);
check('...and still gets most of its fire off', enemy.shots > 60, enemy);

console.log('page errors:', h.errors.length ? h.errors.slice(0, 3) : 'none');
await h.close();
if (failures.length || h.errors.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\noverheat: all checks passed');
