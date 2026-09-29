/**
 * K1 — the rail camera (src/sections/kit/railcam.ts), tested on its own terms.
 *
 * The section suite proves the Ring Walk can be finished; this proves the kit
 * the Storm Docks (Run the Pier) and the Ringworld (Tram Top) will build on:
 *
 *   1. The blend: the split flies into one screen over ~0.6 s, the HUD's rules
 *      fade with it, and the strip only stands (one cell per player, faces in
 *      it, crosshairs gone) once the picture is whole.
 *   2. Stick "up" is along the rail: every player's `moveYaw` is the lane's
 *      direction of travel at their own point on it.
 *   3. Twin-stick aim: the right stick points the gun in the ground plane on
 *      the rail's basis, the soft-lock cone is widened, and the mouse walks a
 *      reticle instead.
 *   4. The leash: a straggler behind the rear edge is carried forward, a
 *      runner past the front edge is held back, and a lock pins the front edge
 *      at its arena until it is cleared.
 *   5. Reversed (Run the Pier): the kit on a lane of the test's own, camera
 *      ahead of the party looking back, "up" away from the lens.
 *   6. The exit: `release()` blends back to the split, clears the shared view,
 *      and hands the sticks back to each player's own camera.
 *
 * Run:  node tools/test-section-railcam.mjs     (env HARNESS_PORT, CHROMIUM_PATH, PLAYERS)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const PORT = process.env.HARNESS_PORT ?? '4173';
const PLAYERS = Number(process.env.PLAYERS ?? 2);
const h = await launch({ url: `http://localhost:${PORT}/`, sections: true });
const { page } = h;
await page.goto(`http://localhost:${PORT}/?section=ring-walk`);
await page.waitForFunction(() => !!window.__startMode, null, { timeout: 60000 });
await h.startStepped('campaign', PLAYERS, 'station', ['din', 'maul', 'armorer', 'jedi'].slice(0, PLAYERS));
const blank = blankInput();

// ---- 1. the blend in ----
const blendIn = await page.evaluate(async (blank) => {
  const g = window.__game;
  const out = { split: g.humans, seen: [], merged: [], sharedAt: -1, wholeAt: -1 };
  for (let f = 0; f < 30 * 12; f++) {
    window.__stepFrame(1 / 30);
    const sv = g.sharedView;
    if (sv && out.sharedAt < 0) out.sharedAt = f;
    if (sv && out.sharedAt >= 0 && out.seen.length < 40) {
      const m = document.querySelectorAll('.hud-viewport.merged').length;
      const div = [...document.querySelectorAll('.hud-divider, .hud-divider-v')].map((d) => +d.style.opacity);
      out.seen.push({ f, blend: sv.blend, merged: m, divider: div.length ? Math.max(...div) : null });
    }
    if (sv && sv.blend >= 1 && out.wholeAt < 0) out.wholeAt = f;
    if (out.wholeAt >= 0 && f > out.wholeAt + 3) break;
  }
  out.cells = document.querySelectorAll('.hud-viewport.merged').length;
  out.faces = [...document.querySelectorAll('.hud-viewport.merged .hud-portrait')]
    .filter((e) => getComputedStyle(e).display !== 'none').length;
  out.crosshairs = [...document.querySelectorAll('.hud-viewport.merged .crosshair')]
    .filter((e) => getComputedStyle(e).display !== 'none').length;
  out.mergedLayer = !!document.querySelector('.hud-merged.show');
  return out;
}, blank);
const blendFrames = blendIn.wholeAt - blendIn.sharedAt;
check('the rail section takes one shared view', blendIn.sharedAt >= 0, blendIn);
check('the split blends into it over about 0.6 s', blendFrames >= 15 && blendFrames <= 22, `${blendFrames} frames`);
const midway = blendIn.seen.filter((s) => s.blend > 0.2 && s.blend < 0.8);
check('mid-blend the split is still drawn and the HUD is not yet merged',
  midway.length > 0 && midway.every((s) => s.merged === 0), midway.slice(0, 2));
if (PLAYERS > 1) {
  check('the split rules fade with the blend', midway.every((s) => s.divider !== null && s.divider < 1 && s.divider > 0),
    midway.map((s) => s.divider).slice(0, 4));
}
check('once whole, the HUD is one strip: a cell and a face per player, no crosshairs',
  blendIn.cells === PLAYERS && blendIn.faces === PLAYERS && blendIn.crosshairs === 0 && blendIn.mergedLayer,
  { cells: blendIn.cells, faces: blendIn.faces, crosshairs: blendIn.crosshairs });

// ---- 2 & 3. stick basis and twin-stick aim ----
const aim = await page.evaluate((blank) => {
  const g = window.__game;
  const s = g.campaign.section;
  // let the outer door cycle and walk everyone onto the hull
  for (let f = 0; f < 30 * 4; f++) {
    g.update(1 / 30, [0, 1, 2, 3].map(() => ({ ...blank, moveY: 1 })));
  }
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const p = g.players[0];
  const one = (i) => [i, blank, blank, blank];
  // the lane's direction of travel at the player: the ring's tangent (R = 190, centre (0, _, 190))
  const tangentYaw = (q) => {
    const th = Math.atan2(q.position.x, 190 - q.position.z);
    return Math.atan2(Math.cos(th), Math.sin(th));
  };
  const basis = g.players.map((q) => Math.abs(wrap((q.moveYaw ?? 99) - tangentYaw(q))));
  // right stick hard right: the gun points to the rail's right
  g.update(1 / 30, one({ ...blank, aimStickX: 1, aimStickY: 0 }));
  const right = wrap(p.cam.yaw - (p.moveYaw - Math.PI / 2));
  g.update(1 / 30, one({ ...blank, aimStickX: 0, aimStickY: 1 }));
  const up = wrap(p.cam.yaw - p.moveYaw);
  const cone = p.aimCone;
  // the mouse: look deltas walk a reticle; it steers the aim and shows
  g.update(1 / 30, one({ ...blank, lookX: -0.3, lookY: 0 }));
  const mouseYaw = wrap(p.cam.yaw - p.moveYaw);
  const reticle = !!s.rail.reticle(0);
  return { basis, right, up, cone, mouseYaw, reticle, debug: s.debug() };
}, blank);
check('stick "up" is along the rail, for every player', aim.basis.every((d) => d < 0.08), aim.basis);
check('the right stick points the gun, on the rail\'s basis', Math.abs(aim.right) < 0.05 && Math.abs(aim.up) < 0.05, aim);
check('the soft-lock cone is widened for twin-stick aim', aim.cone !== null && aim.cone < 0.95, String(aim.cone));
check('the mouse walks a reticle that steers the aim', aim.mouseYaw < -0.1 && aim.reticle, { yaw: aim.mouseYaw, reticle: aim.reticle });

// ---- 4. the leash ----
const leash = await page.evaluate((blank) => {
  const g = window.__game;
  const s = g.campaign.section;
  const lane = (q) => Math.atan2(q.position.x, 190 - q.position.z) * 190;
  const at = (sm, lat = 0) => {
    const th = sm / 190, r = 190 - lat;
    return [r * Math.sin(th), r * Math.cos(th)];
  };
  const put = (q, sm, lat) => {
    const [x, c] = at(sm, lat);
    q.position.set(x, q.position.y, 190 - c);
    q.velocity.set(0, 0, 0);
  };
  const out = {};
  const d0 = s.debug();
  // everyone to the middle of the window, the first player well behind its rear edge
  const mid = (d0.rear + d0.front) / 2;
  for (const q of g.players) put(q, mid, q.slot % 2 ? 3 : -3);
  if (g.players.length > 1) {
    const straggler = g.players[g.players.length - 1];
    put(straggler, d0.rear - 3, 3);
    const before = lane(straggler);
    for (let f = 0; f < 30; f++) g.update(1 / 30, [0, 1, 2, 3].map(() => blank));
    out.carried = lane(straggler) - before;
    out.rearAfter = s.debug().rear;
    out.stragglerAfter = lane(straggler);
  }
  // one runs for the front edge and keeps running
  const runner = g.players[0];
  for (let f = 0; f < 30 * 6; f++) {
    g.update(1 / 30, [0, 1, 2, 3].map((i) => (i === 0 ? { ...blank, moveY: 1, sprintHeld: true } : blank)));
  }
  const d1 = s.debug();
  out.runner = lane(runner);
  out.front = d1.front;
  // a lock: carry the window to the dropship arena (lock 1 springs at 140, holds
  // 130..164) and stand the party in it
  s.rail.snap(142 - s.railOffset);
  for (const q of g.players) put(q, 142 + q.slot, q.slot % 2 ? 3 : -3);
  for (let f = 0; f < 30 * 3; f++) g.update(1 / 30, [0, 1, 2, 3].map(() => blank));
  const d2 = s.debug();
  out.lock = d2.lock;
  for (let f = 0; f < 30 * 4; f++) {
    g.update(1 / 30, [0, 1, 2, 3].map((i) => (i === 0 ? { ...blank, moveY: 1, sprintHeld: true } : blank)));
  }
  out.lockFront = s.debug().front;
  out.lockRunner = lane(runner);
  return out;
}, blank);
if (PLAYERS > 1) {
  check('a straggler behind the rear edge is carried forward', leash.carried > 2, leash);
}
check('nobody outruns the front edge', leash.runner <= leash.front + 0.6, leash);
check('a lock holds the window at its arena', leash.lock === 0 && Math.abs(leash.lockFront - 164) < 0.6, leash);
check('...and its far edge is a wall', leash.lockRunner <= 164.6, String(leash.lockRunner));

// ---- 5. reversed, on a lane of the test's own ----
const rev = await page.evaluate((blank) => {
  const g = window.__game;
  const RC = window.__RailCamera;
  const V = g.players[0].position.constructor;
  const y = g.players[0].position.y;
  const p0 = g.players[0].position.clone();
  // a straight lane through the first player, running +x
  const lane = [];
  for (let i = -40; i <= 40; i++) lane.push(new V(p0.x + i, y, p0.z));
  // take over from the section's own rail for a moment
  const saved = { sv: g.sharedView, moves: g.players.map((q) => q.sectionMove) };
  const rc = new RC({ lane, reverse: true, eye: { back: 8, side: -6, up: 6, lookAhead: 6 }, gates: [0, 40, 80] });
  rc.engage(g);
  for (let f = 0; f < 30; f++) { rc.update(1 / 30); }
  const cam = rc.camera.position;
  const look = new V(); rc.camera.getWorldDirection(look);
  const out = {
    camAhead: cam.x - rc.pointAt(rc.focus).x,        // the camera stands ahead (+x) of the party's focus
    looksBack: look.x,                                // ...and looks back (-x)
    moveYaw: Math.atan2(Math.sin(g.players[0].moveYaw), Math.cos(g.players[0].moveYaw)),  // "up" is away from the lens: -x, yaw -π/2
    shared: g.sharedView?.camera === rc.camera,
  };
  rc.release();
  for (let f = 0; f < 30; f++) rc.update(1 / 30);
  out.out = rc.out;
  out.clearedView = g.sharedView === null;
  rc.dispose();
  g.sharedView = saved.sv;
  g.players.forEach((q, i) => { q.sectionMove = saved.moves[i]; });
  return out;
}, blank);
check('reversed: the camera stands ahead of the party', rev.camAhead > 3, rev);
check('reversed: it looks back at them', rev.looksBack < -0.3, rev);
check('reversed: stick "up" is away from the lens', Math.abs(Math.abs(rev.moveYaw) - Math.PI / 2) < 0.05 && rev.moveYaw < 0, String(rev.moveYaw));
check('a released rail blends out and gives the view back', rev.out && rev.clearedView, rev);

// ---- 6. the section's own exit: walk it to the airlock ----
const exit = await page.evaluate(async (blank) => {
  const g = window.__game;
  const c = g.campaign;
  const out = { releasedAt: -1, frames: [], after: null };
  for (let f = 0; f < 30 * 400; f++) {
    const s = c.section;
    if (!s) break;
    const inputs = [0, 1, 2, 3].map((slot) => {
      const p = g.players[slot];
      if (!p) return blank;
      const { yaw, ...r } = s.autopilot(slot) || {};
      void yaw;
      return { ...blank, ...r };
    });
    g.update(1 / 30, inputs);
    if (f % 30 === 0) for (const e of g.enemies) if (e.alive && e.team === 1) e.damage(9999999, e.position, 0);
    const d = s.debug();
    if (d.releasing && out.releasedAt < 0) out.releasedAt = f;
    if (out.releasedAt >= 0 && out.frames.length < 30) {
      out.frames.push({ blend: g.sharedView?.blend ?? null, moveYaw: g.players[0].moveYaw, cone: g.players[0].aimCone });
    }
    if (f % 300 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  window.__stepFrame(1 / 30);
  out.after = {
    stage: c.stageIdx, section: !!c.section, shared: g.sharedView,
    merged: document.querySelectorAll('.hud-viewport.merged').length,
    moveYaw: g.players.map((p) => p.moveYaw), cone: g.players.map((p) => p.aimCone),
    move: g.players.map((p) => !!p.sectionMove),
  };
  return out;
}, blank);
const falling = exit.frames.filter((f) => f.blend !== null).map((f) => f.blend);
check('at the airlock the rail lets go', exit.releasedAt >= 0, exit.after);
check('the one screen blends back out to the split', falling.length >= 10 && falling[0] > falling[falling.length - 1],
  falling.slice(0, 6).map((b) => b.toFixed(2)).join(' '));
check('the sticks go back to the players\' own cameras', exit.frames.length > 0 && exit.frames[0].moveYaw === null && exit.frames[0].cone === null);
check('the next stage stands with the split screen and its HUD back',
  !exit.after.section && exit.after.shared === null && exit.after.merged === 0
    && exit.after.moveYaw.every((y) => y === null) && exit.after.cone.every((y) => y === null)
    && exit.after.move.every((m) => !m), exit.after);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
await h.close();
check.done('railcam');
