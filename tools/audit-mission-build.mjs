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
  const r = await page.evaluate(() => {
    const g = window.__game;
    const c = g.campaign;
    const s = c.stage;
    const issues = [];
    for (const z of s.zones) {
      const fight = z.spec.kind === 'assault' || z.spec.kind === 'camp';
      if (fight && z.spec.shell === 'hall' && z.hatches.length < 2) issues.push(`${z.spec.label}: hatches`);
      if (fight && z.spec.shell !== 'hall' && z.vents.length < 3) issues.push(`${z.spec.label}: ${z.vents.length} vents`);
      if (!z.posts.length) issues.push(`${z.spec.label}: no posts`);
    }
    for (const ride of s.rides) if (!s.contains(ride.x, ride.z)) issues.push(`ride ${ride.kind} off the stage`);
    const walls = g.board.physics.boxes.filter((b) => b.max.y - b.min.y > (s.ceilingY - s.floorY) * 0.8);
    if (walls.some((b) => b.max.y < s.ceilingY)) issues.push('a border does not clear the ceiling');
    return {
      zones: s.zones.map((z) => `${z.spec.shell}:${z.spec.kind}`).join(' '),
      ceiling: s.ceilingY - s.floorY,
      boxes: g.board.physics.boxes.length,
      cylinders: g.board.physics.cylinders.length,
      rides: s.rides.length,
      issues,
    };
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${r.issues.length ? 'FAIL' : ' ok '} ${board.padEnd(10)} ceiling ${String(r.ceiling).padStart(3)} m · ` +
    `${String(r.boxes).padStart(4)} boxes · ${String(r.cylinders).padStart(3)} cyl · ${r.rides} rides · ${secs}s`);
  console.log(`       ${r.zones}`);
  for (const i of r.issues) console.log(`       - ${i}`);
  if (r.issues.length) bad++;
}

await h.close();
console.log(bad ? `\n${bad} board(s) with problems` : '\nevery board builds clean');
process.exit(bad ? 1 : 0);
