/**
 * The Glacier Chute's slide, as the body rides it:
 *
 *   A. Melee works from the slide. The fighter's own swing (a staff, a pair of
 *      sabers, the melee-only heavy) plays on the arms while the legs keep the
 *      slide, the speed is not traded for a lunge, and the swing lands on
 *      what is in the lane — a saber user has an attack on the ice.
 *   B. The stance is feet first with the weight back: the torso reclines well
 *      past the slope's normal, and the boots sit on the ice, not in it — on
 *      the authored sculpts too, whose legs are not the canonical rig's.
 *   C. The stick is a force across the channel on slippery ice: a turn drifts
 *      on after the stick lets go, and edging out (with the sideways
 *      momentum) bites harder than digging back in against it. The walls
 *      still hold and the run is still one the autopilot finishes.
 *
 * Run:  node tools/test-glacier-slide.mjs
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;

/** into the chute with `char`, through the floor going, the avalanche parked */
async function boot(char) {
  await page.goto(`http://localhost:${PORT}/?section=glacier-chute`);
  await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
  await h.startStepped('campaign', 1, 'crevasse', [char]);
  await page.evaluate(async (blank) => {
    const g = window.__game;
    for (let f = 0; f < 150; f++) g.update(1 / 30, [blank]);
    const s = g.campaign.section, p = g.players[0];
    p.cam.yaw = 0;
    for (let i = 0; i < 300 && !s.debug().collapsed; i++) g.update(1 / 30, [{ ...blank, moveY: 1 }]);
    s.kit.front.resetTo(-400, 999);
    // the sculpt has to be on for the feet to be its feet
    for (let i = 0; i < 400 && !p.char.modelReady?.(); i++) await new Promise((r) => setTimeout(r, 50));
  }, blankInput());
}

/** helpers installed in the page once per boot */
async function tools() {
  await page.evaluate((blank) => {
    const g = window.__game, s = g.campaign.section, kit = s.kit, p = g.players[0];
    const T = window.__T = {};
    T.step = (n, inp = {}) => { for (let i = 0; i < n; i++) g.update(1 / 30, [{ ...blank, ...inp }]); };
    T.speed = () => Math.hypot(p.velocity.x, p.velocity.z);
    /** the lane's axis and its right at the body (right of an axis is (-az, ax)) */
    T.frame = () => {
      const at = kit.laneAt(p.position.x, p.position.z);
      const ax = at.s.tan * at.s.cos, az = at.s.cos;
      return { ax, az, rx: -az, rz: ax, side: at.side, half: at.s.half };
    };
    T.across = () => { const f = T.frame(); return p.velocity.x * f.rx + p.velocity.z * f.rz; };
    /** on the centre line at `z`, going `along` m/s down the lane and `across` m/s to its right */
    T.put = (z, along = 0, across = 0) => {
      p.position.set(0, kit.surface(0, z) + 0.05, z);
      p.velocity.set(0, 0, 0);
      const at = kit.laneAt(0, z);
      const x = at.side / at.s.cos;       // onto the centre line (side is + to the right, which is −x)
      p.position.set(x, kit.surface(x, z) + 0.05, z);
      const f = T.frame();
      p.velocity.set(f.ax * along + f.rx * across, 0, f.az * along + f.rz * across);
      p.cam.yaw = Math.atan2(f.ax, f.az);
    };
    T.clearFoes = () => { for (const e of g.enemies) { e.alive = false; e.removeMe = true; } g.update(1 / 30, [blank]); };
    /** the stance: sole clearance, the torso's recline from plumb and from the ice's normal */
    T.stance = () => {
      const b = p.char.rig.bones;
      const hp = b.hips.getWorldPosition(p.position.clone()), nk = b.neck.getWorldPosition(p.position.clone());
      const v = nk.sub(hp);
      const fx = Math.sin(p.facingYaw), fz = Math.cos(p.facingYaw);
      const n = g.board.physics.groundNormal(p.position.x, p.position.z);
      const back = -(v.x * fx + v.z * fz);
      const plumb = Math.atan2(back, v.y) * 180 / Math.PI;
      const slope = Math.atan2(n.x * fx + n.z * fz, n.y) * 180 / Math.PI;
      return {
        clear: p.soleClearance(g), lift: p.slideGround, plumb, slope, fromNormal: plumb + slope,
        legs: p.char.animator.playing('lower'), feet: p.char.feet().map((f) => +f.ankle.toFixed(3)),
      };
    };
  }, blankInput());
}

const results = {};
for (const char of ['din', 'jedi']) {
  console.log(`\n-- ${char}`);
  await boot(char);
  await tools();

  // ---------------------------------------------------------------- A. melee from the slide
  const melee = await page.evaluate(() => {
    const g = window.__game, s = g.campaign.section, kit = s.kit, p = g.players[0];
    const T = window.__T;
    const out = {};
    // a fresh spider a few metres down the lane, a little to one side so the
    // body slides past it rather than into it (that is the crash, not a swing)
    const spider = () => {
      const e = g.enemies.find((q) => q.alive && q.kind === 'krykna');
      return e ?? null;
    };
    T.put(170, 14);
    T.step(10);
    const e = spider();
    out.hadSpider = !!e;
    if (!e) return out;
    for (const q of g.enemies) if (q !== e) { q.alive = false; q.removeMe = true; }
    const place = (q, ahead, side) => {
      const f = T.frame();     // the lane where the body is now
      const x = p.position.x + f.ax * ahead + f.rx * side, z = p.position.z + f.az * ahead + f.rz * side;
      q.position.set(x, kit.surface(x, z), z);
      q.velocity.set(0, 0, 0);
      q.hp = q.maxHp ?? q.hp;
      q.downed = false;
    };
    place(e, 4.5, 1.1);
    const hp0 = e.hp;
    const v0 = T.speed();
    s.kit.slide.state[0].kicked = 99;
    out.upperBefore = p.char.animator.playing('upper');
    T.step(1, { meleePressed: true });
    out.swinging = p.meleeTimer > 0;
    out.upper = p.char.animator.playing('upper');
    out.lower = p.char.animator.playing('lower');
    T.step(2);
    out.lowerMid = p.char.animator.playing('lower');
    out.speedMid = T.speed();
    T.step(14);
    out.v0 = v0;
    out.hurt = hp0 - e.hp;
    out.down = !e.alive || !!e.downed;
    out.byTheSwing = s.kit.slide.state[0].kicked < 1;
    out.crashed = s.kit.slide.state[0].crashed < 1;
    out.weapon = p.weapon;
    // the melee-only heavy (Y) from the slide: a strike, but no leap off the ice
    if (p.meleeOnly) {
      T.step(20);
      p.rocketCd = 0;
      // the same spider, up again (the swing above most likely killed it)
      const e2 = e;
      e2.alive = true;
      e2.removeMe = false;
      place(e2, 4.5, -1.1);
      const hp2 = e2?.hp ?? 0;
      s.kit.slide.state[0].kicked = 99;
      const before = T.speed();
      T.step(1, { rocketPressed: true });
      out.heavySwing = p.meleeTimer > 0;
      out.heavyGrounded = p.grounded;
      out.heavyVy = p.velocity.y;
      T.step(16);
      out.heavySpeed = [before, T.speed()];
      out.heavyHurt = e2 ? hp2 - e2.hp : 0;
      out.heavyLanded = s.kit.slide.state[0].kicked < 1;
    }
    return out;
  });
  check(`${char}: there is a spider to swing at`, melee.hadSpider);
  if (melee.hadSpider) {
    check(`${char}: a melee press on the slide starts a swing on the arms`, melee.swinging && melee.upper !== melee.upperBefore,
      `${melee.upperBefore} -> ${melee.upper}, swinging ${melee.swinging}`);
    check(`${char}: ...while the legs keep the slide`, melee.lower === 'slideLower' && melee.lowerMid === 'slideLower', `${melee.lower} / ${melee.lowerMid}`);
    check(`${char}: ...and the speed is the slide's, not a lunge's`, melee.speedMid > melee.v0 * 0.9, `${melee.v0.toFixed(1)} -> ${melee.speedMid.toFixed(1)} m/s`);
    check(`${char}: the swing lands on the spider in the lane and puts it down`, melee.hurt > 10 && melee.down && melee.byTheSwing && !melee.crashed,
      `-${melee.hurt} hp, down ${melee.down}, by the swing ${melee.byTheSwing}, crash ${melee.crashed}`);
    if (melee.heavySwing !== undefined) {
      check(`${char}: the heavy (Y) strikes from the slide without leaping off it`, melee.heavySwing && melee.heavyVy < 3,
        `swing ${melee.heavySwing}, vy ${melee.heavyVy.toFixed(1)}`);
      check(`${char}: ...keeps the slide's speed, and lands`, melee.heavySpeed[1] > melee.heavySpeed[0] * 0.85 && melee.heavyHurt > 10 && melee.heavyLanded,
        `${melee.heavySpeed.map((v) => v.toFixed(1)).join(' -> ')} m/s, -${melee.heavyHurt} hp`);
    }
  }
  // ---------------------------------------------------------------- B. the stance
  const stance = await page.evaluate(() => {
    const T = window.__T;
    T.clearFoes();
    const out = {};
    // the first pitch (steep) and further down the run (the gentler average)
    for (const [k, z] of [['steep', 60], ['gentle', 300]]) {
      T.put(z, 16);
      T.step(30);
      out[k] = T.stance();
    }
    return out;
  });
  for (const k of ['steep', 'gentle']) {
    const s = stance[k];
    check(`${char}, ${k} ice (${s.slope.toFixed(0)}°): the legs hold the slide stance`, s.legs === 'slideLower', s.legs);
    check(`${char}, ${k}: the boots are on the ice, not in it`, s.clear > -0.02 && s.clear < 0.06,
      `lowest sole ${(s.clear * 100).toFixed(1)} cm, body lifted ${(s.lift * 100).toFixed(1)} cm, ankles ${s.feet}`);
    check(`${char}, ${k}: the torso reclines well back of the ice's normal`, s.fromNormal > 25,
      `${s.fromNormal.toFixed(0)}° from the normal, ${s.plumb.toFixed(0)}° from plumb`);
    check(`${char}, ${k}: ...and back of plumb`, s.plumb > 8, `${s.plumb.toFixed(0)}°`);
  }

  results[char] = { stance, melee };
}

// ---------------------------------------------------------------- C. steering
console.log('\n-- steering');
const steer = await page.evaluate(() => {
  const T = window.__T;
  T.clearFoes();
  // On the first pitch (straight), at 18 m/s down the lane and `w0` across it:
  // the sideways momentum after `frames` of `stick` then `rest` hands-off,
  // less what the same start does with no stick at all — so the bank's own
  // pull and the lane's line cancel out and what is left is the stick's.
  const across = (w0, stick, frames, rest = 0) => {
    T.put(80, 18, w0);
    T.step(1);
    T.step(frames, { moveX: stick });
    T.step(rest);
    return T.across();
  };
  const by = (w0, stick, frames, rest = 0) => across(w0, stick, frames, rest) - across(w0, 0, frames, rest);
  const out = {};
  // already drifting right at 3 m/s: the same third of a second of stick, out (right) or in (left)
  out.out = by(3, 1, 10);
  out.inn = by(3, -1, 10);
  // from no sideways momentum at all, either way is the same
  out.zeroR = by(0, 1, 10);
  out.zeroL = by(0, -1, 10);
  // the drift: half a second of stick, then hands off — the momentum carries on
  out.built = by(0, 1, 15);
  out.kept = by(0, 1, 15, 15);
  return out;
});
check('a third of a second of stick builds sideways momentum', Math.abs(steer.zeroR) > 3, `${steer.zeroR.toFixed(2)} m/s`);
check('with none to begin with, left and right are even', Math.abs(Math.abs(steer.zeroR) - Math.abs(steer.zeroL)) < 0.3,
  `${steer.zeroR.toFixed(2)} / ${steer.zeroL.toFixed(2)}`);
check('edging out (with the drift) bites harder than digging back in against it', steer.out > 0 && steer.inn < 0 && steer.out > -steer.inn * 1.5,
  `out +${steer.out.toFixed(2)} m/s, in ${steer.inn.toFixed(2)} m/s`);
check('the ice keeps a turn going after the stick lets go', steer.kept > steer.built * 0.75 && steer.built !== 0,
  `${steer.built.toFixed(2)} -> ${steer.kept.toFixed(2)} m/s across after 0.5 s hands off`);

// ---------------------------------------------------------------- the whole run
const run = await page.evaluate(async (blank) => {
  // a fresh party at the top: the autopilot rides it all the way down
  const g = window.__game, c = g.campaign, s = c.section;
  const out = { completed: false, seconds: 0, outside: 0 };
  const p = g.players[0];
  s.kit.front.resetTo(-400, 999);
  window.__T.put(8, 4);
  for (let f = 0; f < 240 * 30; f++) {
    if (s.complete) { out.completed = true; break; }
    let a = {};
    a = s.autopilot(0) ?? {};
    if (typeof a.yaw === 'number') p.cam.yaw = a.yaw;
    const { yaw, ...rest } = a;
    void yaw;
    g.update(1 / 30, [{ ...blank, ...rest }]);
    if (f % 30 === 0 && p.alive && !s.contains(p.position.x, p.position.z)) out.outside++;
    if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
    out.seconds = f / 30;
  }
  out.debug = s.debug();
  return out;
}, blankInput());
check('the autopilot still rides the run to the snowbank', run.completed, JSON.stringify({ s: run.seconds.toFixed(0), debug: run.debug }));
check('...and never leaves the channel', run.outside === 0, String(run.outside));

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('glacier slide');
