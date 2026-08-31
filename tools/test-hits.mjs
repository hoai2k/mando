/**
 * Taking a hit has to be an event.
 *
 * The report was that a firing line kills you without you ever registering a
 * single hit: bolts arrive faster than the flash can decay, so twelve of them
 * read as one continuous nothing and then a death screen. Three things now
 * separate them — the body flashes, it gets shoved, and it cannot be hit again
 * for a moment — and a fresh body gets a longer version of that window so a
 * respawn is not a second death into the same guns.
 *
 * What must NOT get the window: fire and hazards. Standing in lava is supposed
 * to kill you.
 *
 * Run:  node tools/test-hits.mjs
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

await page.evaluate(() => {
  window.__manual = false;
  window.__quitToTitle?.();
  window.__startMode('wave', 1, 'desert', ['din']);
});
await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
await page.evaluate(() => { window.__manual = true; });

const PROBE = `() => {
  const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
    dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
    rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, throttleHeld:false,
    brakeHeld:false, slamPressed:false, meleeSwapPressed:false, rangedSwapPressed:false,
    pausePressed:false });
  const g = window.__game;
  const p = g.players[0];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) g.update(1/60, [blank(), blank(), blank(), blank()]);
  };
  step(30);
  for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
  // a spawn window is running from the match start; let it lapse
  step(150);
  p.hp = p.maxHp = 1000;

  // a shooter two metres in front, on the +Z side of the body
  const source = () => { const v = p.position.clone(); v.z += 2; v.y += 1; return v; };

  // ---- a burst arrives; only the first of each window lands
  const burst = () => {
    p.hp = 1000;
    let landed = 0;
    for (let i = 0; i < 8; i++) {
      const before = p.hp;
      p.damage(20, source(), -1);
      if (p.hp < before) landed++;
      step(1);   // ~16 ms apart, the way a squad's volley arrives
    }
    return landed;
  };
  const inBurst = burst();

  // ---- and the window lapses: spaced hits all land
  step(30);   // let the burst's last window run out first
  p.hp = 1000;
  let spaced = 0;
  for (let i = 0; i < 4; i++) {
    const before = p.hp;
    p.damage(20, source(), -1);
    if (p.hp < before) spaced++;
    step(30);   // half a second between shots
  }

  // ---- a hit moves you, away from whoever threw it
  step(60);
  p.hp = 1000;
  p.velocity.set(0, 0, 0);
  const wasZ = p.position.z;
  p.damage(20, source(), -1);
  const shove = +p.velocity.z.toFixed(2);
  step(10);
  const moved = +(p.position.z - wasZ).toFixed(2);

  // ---- fire and hazards ignore the window entirely
  p.hp = 1000;
  let burnTicks = 0;
  for (let i = 0; i < 8; i++) {
    const before = p.hp;
    p.damage(3, source(), -1, { dot: true });
    if (p.hp < before) burnTicks++;
    step(1);
  }

  // ---- a fresh body cannot be shot for a moment
  p.spawnAt(p.position.clone());
  const guardOnSpawn = p.invulnerable;
  step(150);  // two and a half seconds: re-form, stand up, window lapses
  const guardAfterAWhile = p.invulnerable;
  p.hp = 1000;
  const beforeLate = p.hp;
  p.damage(20, source(), -1);
  const lateHitLands = p.hp < beforeLate;

  return { inBurst, spaced, shove, moved, burnTicks, guardOnSpawn, guardAfterAWhile, lateHitLands };
}`;

const r = await page.evaluate(`(${PROBE})()`);
await page.evaluate(() => { window.__manual = false; });

check('a volley lands as countable hits, not all at once', r.inBurst > 0 && r.inBurst <= 2, { landed: r.inBurst, of: 8 });
check('hits spaced out all land', r.spaced === 4, r.spaced);
check('a hit shoves the body away from the shooter', r.shove < -1 && r.moved < -0.05, { shove: r.shove, moved: r.moved });
check('fire is not shrugged off by the hit window', r.burnTicks === 8, r.burnTicks);
check('a fresh body starts untouchable', r.guardOnSpawn === true, r.guardOnSpawn);
check('and stops being untouchable on its own', r.guardAfterAWhile === false, r.guardAfterAWhile);
check('after which shots land again', r.lateHitLands === true, r.lateHitLands);

await h.close();
console.log(failures.length ? `\nFAILED: ${failures.join(', ')}` : '\nall hit-feedback checks passed');
process.exit(failures.length ? 1 : 0);
