/**
 * The chase camera keeps the character in the frame (src/core/camera.ts,
 * tuned in src/core/data/cameraTuning.json):
 *
 *   - backed up against a wall, the wall pulls the camera in, and the fixed
 *     over-the-shoulder step must not then put the lens beside the body with
 *     the body out of shot — hip-fire and aiming alike, at every bearing
 *     round the wall;
 *   - out in the open nothing changes: the shoulder step is the tuned one.
 *
 * "In the frame" is measured, not eyeballed: points on the body (feet, knees,
 * hips, chest, shoulders, head) are projected through the player's own camera
 * and counted inside the screen.
 *
 * Run:  node tools/test-camera-framing.mjs     (env HARNESS_PORT, CHROMIUM_PATH)
 */
import { launch, blankInput, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const { page } = h;
await h.startStepped('wave', 1, 'desert', ['din']);

const r = await page.evaluate((BLANK) => {
  const g = window.__game;
  const p = g.players[0];
  const cam = p.cam;
  const phys = g.board.physics;
  p.hp = p.maxHp = 1e6;
  const clear = () => { for (const e of g.enemies) { e.alive = false; e.removeMe = true; } };
  const step = (n, over = {}) => {
    for (let i = 0; i < n; i++) {
      if (i % 20 === 0) clear();
      // a boss wave's introduction runs the world (and the camera) in slow
      // motion and swings every camera onto the boss: not what is under test
      g.bossIntroT = 0;
      g.update(1 / 60, [{ ...BLANK, ...over }, BLANK, BLANK, BLANK]);
    }
  };
  step(30);
  const ground = (x, z) => (phys.heightAt ? phys.heightAt(x, z) : 0);
  const V = () => cam.camera.position.clone().set(0, 0, 0);

  // ---- the body, projected through the player's camera ----
  const frame = () => {
    const c = cam.camera;
    c.updateMatrixWorld(true);
    const f = p.position;
    const rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);   // camera right (yawBasis)
    const pts = [
      [0, 0.08, 0], [0, 0.5, 0], [0, 0.95, 0], [0, 1.3, 0], [0, 1.68, 0],
      [0.22, 1.45, 0], [-0.22, 1.45, 0],
    ];
    let seen = 0;
    let cx = 0, cy = 0;
    for (const [s, y] of pts) {
      const v = V().set(f.x + rx * s, f.y + y, f.z + rz * s).project(c);
      const ok = v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
      if (ok) seen++;
    }
    const mid = V().set(f.x, f.y + 1.3, f.z).project(c);   // the chest
    cx = mid.x; cy = mid.y;
    const behind = mid.z >= 1 || mid.z <= -1;
    // the lens is never inside a collider
    const e = c.position;
    const inside = phys.boxes.some((b) => e.x > b.min.x && e.x < b.max.x && e.y > b.min.y && e.y < b.max.y && e.z > b.min.z && e.z < b.max.z);
    // lens offset from the body axis, in the camera's right direction
    const d = V().copy(c.position).sub(V().set(f.x, f.y, f.z));
    return {
      frac: +(seen / pts.length).toFixed(3), inWall: inside,
      centre: [+cx.toFixed(2), +cy.toFixed(2)], behind,
      lateral: +(d.x * rx + d.z * rz).toFixed(2),
      back: +Math.hypot(d.x, d.z).toFixed(2),
      k: +cam.frameK.toFixed(2), lift: +cam.frameH.toFixed(2), room: [+Math.min(cam.roomRight, 9).toFixed(2), +Math.min(cam.roomLeft, 9).toFixed(2)],
    };
  };

  // ---- a real wall on the board: the tallest box with a long face ----
  const walls = [];
  for (const b of phys.boxes) {
    const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    // four faces: [normal x, normal z, face centre x, z, face width]
    const faces = [[1, 0, b.max.x, cz, sz], [-1, 0, b.min.x, cz, sz], [0, 1, cx, b.max.z, sx], [0, -1, cx, b.min.z, sx]];
    for (const [nx, nz, fx, fz, w] of faces) {
      if (w < 3) continue;
      const px = fx + nx * 0.5, pz = fz + nz * 0.5;
      const gy = ground(px, pz);
      if (b.min.y > gy + 0.3 || b.max.y < gy + 3) continue;          // floor-standing and tall
      if (Math.abs(gy - ground(px + nx * 3, pz + nz * 3)) > 0.6) continue; // flat in front
      walls.push({ nx, nz, fx, fz, w, h: b.max.y - gy });
    }
  }
  walls.sort((a, b) => b.w - a.w);
  // the spot `gap` metres out from the middle of a wall's face
  const spotAt = (wl, gap) => {
    const px = wl.fx + wl.nx * gap, pz = wl.fz + wl.nz * gap;
    return { px, pz, gy: ground(px, pz), nx: wl.nx, nz: wl.nz };
  };

  // Hold the body on a spot with the camera at a fixed bearing for 1.5 s and
  // report the worst settled frame. `yawOff` turns the view off straight out
  // from the wall; `aiming` holds the aim.
  const at = (spot, yawOff, aiming, frames = 90) => {
    p.position.set(spot.px, spot.gy, spot.pz);
    p.velocity.set(0, 0, 0);
    const yaw = Math.atan2(spot.nx, spot.nz) + yawOff;   // look away from the wall
    let worst = null;
    let drift = 0;
    for (let i = 0; i < frames; i++) {
      p.position.set(spot.px, p.position.y, spot.pz);
      p.velocity.x = p.velocity.z = 0;
      cam.yaw = yaw; cam.pitch = -0.12;
      step(1, { aimHeld: aiming });
      drift = Math.max(drift, Math.hypot(p.position.x - spot.px, p.position.z - spot.pz));
      if (i >= frames - 30) {                  // settled: keep the worst frame
        const fr = frame();
        if (!worst || fr.frac < worst.frac) worst = fr;
      }
    }
    return { ...worst, drift: +drift.toFixed(2) };
  };

  // a wall the body can actually stand against: nothing else shoves it off the spot
  const wall = walls.find((wl) => at(spotAt(wl, 0.5), 0, false, 20).drift < 0.15);
  const offs = [-75, -50, -25, 0, 25, 50, 75];
  const runs = [];
  if (wall) {
    for (const gap of [0.5, 1.2]) {
      for (const aiming of [false, true]) {
        for (const d of offs) runs.push({ gap, aiming, off: d, ...at(spotAt(wall, gap), d * Math.PI / 180, aiming) });
      }
    }
  }

  // easing: walking backward into the wall, the shoulder slides in over
  // several frames rather than in one
  const slide = [];
  if (wall) {
    at(spotAt(wall, 3), 0, false);
    const yaw = Math.atan2(wall.nx, wall.nz);
    const s0 = spotAt(wall, 3), s1 = spotAt(wall, 0.5);
    for (let i = 0; i <= 70; i++) {
      const t = Math.min(i / 25, 1);
      p.position.set(s0.px + (s1.px - s0.px) * t, p.position.y, s0.pz + (s1.pz - s0.pz) * t);
      p.velocity.x = p.velocity.z = 0;
      cam.yaw = yaw; cam.pitch = -0.12;
      step(1);
      slide.push(frame().lateral);
    }
  }

  // ---- open ground: the spot with the most clear air round it ----
  let open = null;
  const dir = V();
  for (let tries = 0; tries < 400 && !open; tries++) {
    const x = (Math.random() - 0.5) * 80, z = (Math.random() - 0.5) * 80;
    const y = ground(x, z);
    let ok = true;
    for (let k = 0; k < 16 && ok; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (phys.raycast(V().set(x, y + 1.6, z), dir.set(Math.sin(a), 0.15, Math.cos(a)).normalize(), 6)) ok = false;
    }
    if (ok && Math.abs(ground(x + 3, z) - y) < 0.3 && Math.abs(ground(x, z + 3) - y) < 0.3) open = { px: x, pz: z, gy: y, nx: 0, nz: 1 };
  }
  // long enough for the slow ease back out to the tuned shoulder to finish
  const openHip = open ? at(open, 0, false, 300) : null;
  const openAim = open ? at(open, 0, true, 300) : null;
  return { wall, nWalls: walls.length, runs, slide, open, openHip, openAim };
}, blankInput());

console.log(JSON.stringify({ wall: r.wall, nWalls: r.nWalls, open: r.open }));
for (const s of r.runs) {
  console.log(`  ${s.aiming ? 'aim' : 'hip'} gap ${s.gap} ${String(s.off).padStart(4)}°`, JSON.stringify(s));
}
console.log('  slide', JSON.stringify(r.slide));
console.log('  open hip', JSON.stringify(r.openHip));
console.log('  open aim', JSON.stringify(r.openAim));

check('found a tall wall on the board', !!r.wall, r.nWalls);
const pick = (gap, aiming, f = () => true) => r.runs.filter((s) => s.gap === gap && s.aiming === aiming && f(s));
const brief = (xs) => xs.map((s) => `${s.aiming ? 'aim' : 'hip'} ${s.gap}m ${s.off}°: ${s.frac}`).join(', ');
const centred = (s) => !s.behind && Math.abs(s.centre[0]) <= 0.85 && Math.abs(s.centre[1]) <= 0.85;
if (r.wall) {
  // Backed onto the wall (0.5 m) and looking out at a slant, there is room to
  // frame the body properly, on one shoulder or the other. (Straight out, the
  // lens has 30 cm behind the back plate and no framing that looks forward can
  // fit a body into that; those only have to keep some of it in shot, below.)
  const slantHip = pick(0.5, false, (s) => Math.abs(s.off) >= 50);
  check('back to the wall, slanted: hip-fire frames most of the body, chest near the middle',
    slantHip.every((s) => s.frac >= 0.7 && centred(s)), brief(slantHip));
  const slantAim = pick(0.5, true, (s) => Math.abs(s.off) >= 50);
  check('back to the wall, slanted: aiming keeps the upper body in frame',
    slantAim.every((s) => s.frac >= 0.5), brief(slantAim));
  const hip05 = pick(0.5, false);
  const mean = hip05.reduce((n, s) => n + s.frac, 0) / Math.max(hip05.length, 1);
  check('back to the wall: on average over half the body in frame at hip-fire (was 0.37)', mean >= 0.5, mean.toFixed(2));
  const none = r.runs.filter((s) => s.frac === 0);
  check('never none of the body in frame (aiming backed onto a wall used to show none of it)', none.length === 0, brief(none));
  const near = pick(1.2, false).concat(pick(1.2, true));
  check('a step off the wall (1.2 m): hip-fire ≥ 4/7 of the body, aiming ≥ 3/7',
    near.every((s) => s.frac >= (s.aiming ? 0.42 : 0.57)), brief(near));
  const crowded = r.runs.filter((s) => s.aiming && Math.abs(s.lateral) < 0.18);
  check('aiming keeps the helmet off the crosshair (shoulder step ≥ 0.2 m)', crowded.length === 0,
    crowded.map((s) => [s.gap, s.off, s.lateral]));
  const walled = r.runs.filter((s) => s.inWall);
  check('the lens is never inside a collider', walled.length === 0, brief(walled));
  // walking back into the wall: the shoulder eases in, it does not cut
  const jumps = r.slide.slice(1).map((v, i) => Math.abs(v - r.slide[i]));
  check('backing into the wall, the shoulder eases in over several frames, never a cut',
    Math.max(...jumps) <= 0.06 && Math.min(...r.slide) <= 0.3, { maxStep: Math.max(...jumps), end: r.slide.at(-1) });
}
check('found open ground', !!r.open);
if (r.openHip) {
  check('open ground: hip-fire shoulder step unchanged (0.55 m)', Math.abs(r.openHip.lateral - 0.55) < 0.02 && r.openHip.k === 1, r.openHip);
  check('open ground: aiming shoulder step unchanged (0.8 m)', Math.abs(r.openAim.lateral - 0.8) < 0.02 && r.openAim.k === 1, r.openAim);
  check('open ground: framing as before (6/7 hip, 4/7 aiming)', r.openHip.frac >= 0.85 && r.openAim.frac >= 0.57, [r.openHip.frac, r.openAim.frac]);
}
check('no page errors', h.errors.length === 0, h.errors.slice(0, 3));
check.done('camera framing');
await h.close();
