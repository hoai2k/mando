/**
 * Build audit for the outdoor mission stages (docs/MISSIONS_OUTDOOR.md §5.7).
 *
 * Raises every stage of every territory in a real browser and reports what it
 * got: zone shapes, borders against the ceiling, spawn geometry, rides, and
 * how long each stage took to raise. It is a *build* audit — it never plays a
 * run — so it is the fast way to find a level that cannot be built at all,
 * which is the failure a walkthrough only discovers after ten minutes of
 * walking.
 *
 * Run:  node tools/audit-mission-build.mjs [board]
 */
import { launch } from './harness.mjs';

const only = process.argv[2];
const BOARDS = ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];
const boards = only ? [only] : BOARDS;

const h = await launch({ url: `http://localhost:${process.env.HARNESS_PORT ?? '4173'}/` });
const { page } = h;
page.on('pageerror', (e) => console.log(`  PAGE ERROR: ${String(e).slice(0, 300)}`));

let bad = 0;

// The bundle does not expose the builder, so the audit drives the game the way
// a player does and reads back the stage the campaign raised.
for (const board of boards) {
  const t0 = Date.now();
  await page.evaluate(([b]) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('campaign', 1, b, ['din']);
  }, [board]);
  let ok = true;
  try {
    await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  } catch {
    ok = false;
  }
  if (!ok) {
    console.log(`FAIL ${board}: the level never finished loading`);
    bad++;
    continue;
  }
  await page.evaluate(() => { window.__manual = true; });
  // Every stage of the run, not just the one the match opened on: a stage
  // that cannot be built is a run that dead-ends in the middle, and a
  // walkthrough only finds that after ten minutes of walking.
  const stages = await page.evaluate(() => {
    const g = window.__game;
    const c = g.campaign;
    const blank = () => ({ moveX:0, moveY:0, lookX:0, lookY:0, jumpHeld:false, jumpPressed:false,
      dashPressed:false, sprintHeld:false, shootHeld:false, aimHeld:false, meleePressed:false,
      rocketPressed:false, zoomHeld:false, zoomDelta:0, blockHeld:false, slamPressed:false,
    meleeSwapPressed:false, rangedSwapPressed:false,
      pausePressed:false });
    const idle = [blank(), blank(), blank(), blank()];
    const look = () => {
      const s = c.stage;
      const issues = [];
      for (const z of s.zones) {
        const fight = z.spec.kind === 'assault' || z.spec.kind === 'camp';
        if (fight && z.spec.shell === 'hall' && z.hatches.length < 2) issues.push(`${z.spec.label}: hatches`);
        if (fight && z.spec.shell !== 'hall' && z.vents.length < 3) issues.push(`${z.spec.label}: ${z.vents.length} vents`);
        if (!z.posts.length) issues.push(`${z.spec.label}: no posts`);
      }
      for (const ride of s.rides) if (!s.contains(ride.x, ride.z)) issues.push(`ride ${ride.kind} off the stage`);

      // ---- the landmark rule (docs/MISSIONS_OUTDOOR.md §4.1) ----
      // Every zone's way on has to be *visible* from where the party walks
      // in. That is the whole of the outdoor guidance: a beacon reads through
      // fog and a marker reads off screen, but neither is any use if the
      // level itself hides the exit behind the rock it is built from.
      //
      // Two things this deliberately does not demand. A zone with no way on —
      // the warlord's arena at the end of a run — has nothing to be visible,
      // and the objective there is the boss standing in the middle of it. And
      // sight is judged from a few places across the entry rather than from
      // one point on the centre line, because a player can step aside: an
      // arena built as a ring around a reactor spire is a good arena, not a
      // level hiding its own exit behind a column.
      const eye = 1.6;
      for (let i = 0; i < s.zones.length; i++) {
        const zone = s.zones[i];
        const next = i + 1 < s.zones.length ? s.zones[i + 1].entry : (s.exitPortal?.pos ?? null);
        if (!next && !zone.exitBarrier) continue;      // nowhere to go on to
        const targets = [zone.exit, zone.landmark];
        if (next) targets.push(next);
        // across the travel axis, so the sample points spread along the mouth
        const ax = zone.exit.x - zone.entry.x, az = zone.exit.z - zone.entry.z;
        const alen = Math.hypot(ax, az) || 1;
        const px = -az / alen, pz = ax / alen;
        const spread = Math.min(zone.spec.w, 24) * 0.3;
        const from = zone.entry.clone();
        const dir = zone.entry.clone();
        let seen = false;
        for (const off of [0, spread, -spread]) {
          from.set(zone.entry.x + px * off, zone.entry.y + eye, zone.entry.z + pz * off);
          for (const t of targets) {
            dir.set(t.x - from.x, (t.y + eye) - from.y, t.z - from.z);
            const len = dir.length();
            if (len < 1) { seen = true; break; }
            dir.divideScalar(len);
            // stop short, so the thing being looked *at* is not what blocks it
            if (!g.board.physics.raycast(from, dir, len - 1.5)) { seen = true; break; }
          }
          if (seen) break;
        }
        if (!seen) issues.push(`${zone.spec.label}: nothing of the way on is visible from the entry`);
      }

      return {
        label: s.spec.label,
        zones: s.zones.map((z) => `${z.spec.shell}:${z.spec.kind}`).join(' '),
        boxes: g.board.physics.boxes.length,
        cylinders: g.board.physics.cylinders.length,
        rides: s.rides.length,
        issues,
      };
    };
    const out = { ceiling: Math.round(c.stage.ceilingY - c.stage.floorY), stages: [look()] };
    // walk the transport doors: clear the stage on paper, stand a player in
    // the pocket, and let the transit run
    for (let guard = 0; guard < 6 && c.stage.exitPortal; guard++) {
      c.idx = c.stage.zones.length;
      c.phase = 'travel';
      for (const e of g.enemies) e.removeMe = true;
      g.update(1 / 30, idle);
      const portal = c.stage.exitPortal;
      if (!portal) break;
      const was = c.stageIdx;
      // Give it room: the match's own intro has to finish, then the door's
      // leaves have to travel, then the transport beat runs — a transit that
      // is merely slower than the loop is not a transit that never took.
      for (let i = 0; i < 90; i++) g.update(1 / 30, idle);
      g.players[0].position.copy(portal.threshold);
      for (let i = 0; i < 240 && c.stageIdx === was; i++) {
        if (i % 30 === 0) g.players[0].position.copy(portal.threshold);
        g.update(1 / 30, idle);
      }
      if (c.stageIdx === was) { out.stages.push({ label: '(stuck)', zones: '', issues: ['the transport door never took'] }); break; }
      out.stages.push(look());
    }
    return out;
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const issues = stages.stages.flatMap((st) => st.issues);
  const last = stages.stages[stages.stages.length - 1];
  console.log(`${issues.length ? 'FAIL' : ' ok '} ${board.padEnd(10)} ceiling ${String(stages.ceiling).padStart(3)} m · ` +
    `${stages.stages.length} stage(s) · ${String(last.boxes ?? 0).padStart(4)} boxes · ` +
    `${String(last.cylinders ?? 0).padStart(3)} cyl · ${secs}s`);
  for (const st of stages.stages) {
    console.log(`       ${String(st.label).padEnd(22)} ${st.zones}${st.rides ? ` · ${st.rides} rides` : ''}`);
    for (const i of st.issues) console.log(`         - ${i}`);
  }
  if (issues.length) bad++;
}

await h.close();
console.log(bad ? `\n${bad} board(s) with problems` : '\nevery board builds clean');
process.exit(bad ? 1 : 0);
