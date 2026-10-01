/**
 * The charged melee strike (src/game/chargeAttack.ts):
 *
 *  - a tap of melee still throws the ordinary combo swing, for the ordinary
 *    damage, and never shows the ready pose;
 *  - holding it past the threshold settles the upper body into the weapon's
 *    ready pose (its own clip on the upper channel) while the legs keep
 *    running, at the attack pace (ATTACK_MOVE_FACTOR), not a standstill;
 *  - letting go throws the heavy swing: a partial charge lands harder than a
 *    tap, and a full charge harder than a partial one;
 *  - for a staff/spear (Din), a saber wielder (Ventress), the double blade
 *    (Maul) and a brawler's fists (Paz);
 *  - and a full charge breaks a parry that a partial one is stopped by
 *    (Din's beskar spear into a saber rival's swing, src/game/melee.ts).
 *
 * Enemies are marked dead between frames rather than stepped away with blank
 * input, so a held button is never let go by accident.
 *
 *   node tools/test-charge-attack.mjs
 */
import { blankInput, launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;

const FIGHTERS = [
  { id: 'din', ready: 'meleeReadyUpper' },
  { id: 'ventress', ready: 'saberReadyUpper' },
  { id: 'maul', ready: 'staffReadyUpper' },
  { id: 'paz', ready: 'fistReadyUpper' },
];

try {
  for (const f of FIGHTERS) {
    await h.startStepped('wave', 1, 'desert', [f.id]);
    await page.waitForFunction(() => window.__game?.players?.[0]?.char.modelReady?.(), undefined, { timeout: 180000 });

    // an Enemy class to place targets with: step until the wave posts one
    await page.evaluate((BLANK) => {
      const g = window.__game, p = g.players[0];
      p.hp = p.maxHp = 1e6;
      let n = 0;
      while (!g.enemies.length && n++ < 3000) g.update(1 / 60, [BLANK, BLANK, BLANK, BLANK]);
      window.__Enemy = g.enemies[0]?.constructor;
      for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
      for (let i = 0; i < 10; i++) g.update(1 / 60, [BLANK, BLANK, BLANK, BLANK]);
      p.velocity.set(0, 0, 0);
      p.cam.yaw = p.facingYaw = 0;
      window.__home = p.position.clone();
    }, blankInput());

    /**
     * One strike: hold melee for `hold` frames (0: a press with nothing held
     * behind it) against a placed target of `kind`; `parry` winds the target
     * up at the player on the release frame, so the strike meets its swing.
     */
    const strike = async (hold, kind = 'tusken', parry = false) => {
      await page.evaluate((kind) => {
        const g = window.__game, p = g.players[0];
        for (const e of g.enemies) { e.alive = false; e.removeMe = true; }
        p.position.copy(window.__home); p.velocity.set(0, 0, 0);
        p.cam.yaw = p.facingYaw = 0;
        const pos = p.position.clone(); pos.z += 1.7;
        const e = g.addEnemy(new window.__Enemy(kind, pos));
        e.hp = 1e5;
        window.__target = { e, pos };
      }, kind);
      // let the target's sculpt settle in (real time: model loads are async)
      await new Promise((r) => setTimeout(r, 1500));
      return page.evaluate(([hold, BLANK, ready, parry]) => {
        const g = window.__game, p = g.players[0], { e, pos } = window.__target;
        // record the duel events instead of guessing at them
        const clashes = [];
        if (!g.__chargeWrapped) {
          g.__chargeWrapped = true;
          const clash = g.meleeClash.bind(g);
          g.meleeClash = (...a) => { window.__clashes?.push('parry'); clash(...a); };
        }
        window.__clashes = clashes;
        const pin = () => {
          // the target stands still and never swings back
          for (const o of g.enemies) if (o !== e) { o.alive = false; o.removeMe = true; }
          if (e.alive && !(parry && e.windupTarget)) {
            e.attackCd = 5; e.windup = 0; e.committed = false;
            if (!e.stagger && !e.knockedDown) { e.velocity.set(0, 0, 0); }
          }
        };
        const windUp = () => {
          e.position.copy(pos); e.velocity.set(0, 0, 0);
          e.facingYaw = Math.atan2(p.position.x - e.position.x, p.position.z - e.position.z);
          e.windup = e.windupTotal = 0.55;
          e.windupTarget = p;
          e.windupStartedAt = g.time;
          e.char.animator?.playOnce('upper', 'enemySwing', 0.06);
        };
        e.position.copy(pos); e.velocity.set(0, 0, 0);
        p.position.copy(window.__home); p.velocity.set(0, 0, 0);
        p.cam.yaw = p.facingYaw = 0;
        const hp0 = e.hp;
        let sawReady = false, charge = -1, step = 0;
        const total = Math.max(hold, 1) + 60;
        for (let i = 0; i < total; i++) {
          pin();
          if (parry && i === hold) windUp();
          const input = { ...BLANK };
          if (hold === 0) input.meleePressed = i === 0;
          else { input.meleePressed = i === 0; input.meleeHeld = i < hold; }
          g.update(1 / 60, [input, BLANK, BLANK, BLANK]);
          if (p.char.animator?.playing('upper') === ready) sawReady = true;
          if (i < hold) charge = Math.max(charge, p.meleeCharge);
          if (i === 0) step = p.meleeTimer;
        }
        const out = { hurt: +(hp0 - e.hp).toFixed(1), sawReady, charge: +charge.toFixed(2), clashes,
          swungAtOnce: step > 0, tap: p.profile.meleeDamage, finisher: p.profile.meleeFinisher };
        e.alive = false; e.removeMe = true;
        return out;
      }, [hold, blankInput(), f.ready, parry]);
    };

    const tap = await strike(6);          // ~0.1 s: a tap
    check(`${f.id}: a tap swings the combo for the ordinary damage`,
      tap.hurt > 0 && Math.abs(tap.hurt - tap.tap) < 1 && !tap.sawReady, tap);
    const bot = await strike(0);          // a press with no hold reported (bots, scripts)
    check(`${f.id}: a press with nothing held swings on the frame`, bot.swungAtOnce && bot.hurt > 0, bot);
    const partial = await strike(13 + 30); // threshold + 0.5 s
    check(`${f.id}: holding shows the ready pose`, partial.sawReady, partial);
    check(`${f.id}: a partial charge lands harder than a tap`,
      partial.charge > 0.2 && partial.charge < 0.8 && partial.hurt > tap.hurt * 1.2, { partial, tap: tap.hurt });
    const full = await strike(13 + 90);   // threshold + 1.5 s: full
    check(`${f.id}: a full charge lands harder than a partial one`,
      full.charge >= 1 && full.hurt > partial.hurt * 1.2, { full, partial: partial.hurt });

    if (f.id === 'din') {
      // beskar meets a saber and parries (test-parry); a full charge breaks it
      const held = await strike(13 + 30, 'rivalMaul', true);
      check('din: a partial charge into a saber rival\'s swing is parried',
        held.clashes.includes('parry') && held.hurt === 0, held);
      const broke = await strike(13 + 90, 'rivalMaul', true);
      check('din: a full charge breaks the parry and lands',
        !broke.clashes.includes('parry') && broke.hurt > 0, broke);
    }

    // holding on the run: the ready pose rides the run, at the attack pace
    const run = await page.evaluate(([BLANK, ready]) => {
      const g = window.__game, p = g.players[0];
      p.position.copy(window.__home); p.velocity.set(0, 0, 0);
      p.cam.yaw = p.facingYaw = 0;
      const clear = () => { for (const e of g.enemies) { e.alive = false; e.removeMe = true; } };
      const speed = () => Math.hypot(p.velocity.x, p.velocity.z);
      let runSpeed = 0;
      const speeds = [], uppers = new Set(), lowers = new Set();
      const lead = 45, hold = 50;
      for (let i = 0; i < lead + hold; i++) {
        clear();
        p.cam.yaw = 0;
        const k = i - lead;
        const input = { ...BLANK, moveY: 1, meleePressed: k === 0, meleeHeld: k >= 0 };
        g.update(1 / 30, [input, BLANK, BLANK, BLANK]);
        if (k === -1) runSpeed = speed();
        if (k >= 12) {
          speeds.push(speed());
          uppers.add(p.char.animator?.playing('upper'));
          lowers.add(p.char.animator?.playing('lower'));
        }
      }
      // let go somewhere empty, so the next fighter starts clean
      for (let i = 0; i < 40; i++) { clear(); g.update(1 / 30, [BLANK, BLANK, BLANK, BLANK]); }
      return {
        runSpeed: +runSpeed.toFixed(2), min: +Math.min(...speeds).toFixed(2), max: +Math.max(...speeds).toFixed(2),
        uppers: [...uppers].join(','), lowers: [...lowers].join(','), ready,
      };
    }, [blankInput(), f.ready]);
    check(`${f.id}: charging on the run holds the ready pose over running legs`,
      run.uppers === f.ready && run.lowers.split(',').every((c) => /^(run|walk)Lower$/.test(c)), run);
    check(`${f.id}: ...at the attack pace (about 70% of the run)`,
      run.runSpeed > 5 && run.min >= 0.5 * run.runSpeed && run.max <= 0.8 * run.runSpeed, run);
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Charged melee strike');
