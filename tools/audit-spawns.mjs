/**
 * Spawn audit: does every hostile a wave posts have room to stand?
 *
 * Builds every board in a real browser (via the `__boards` handle), plans
 * every wave on it (via `__planWave`, which runs the real spawner without
 * building any characters) and tests each planned body's capsule against that
 * board's colliders. Anything overlapping is a hostile spawned inside the
 * scenery — the physics ejects it through the nearest face on its first frame,
 * which puts it somewhere nobody chose and, on a walled board like the
 * refinery, can put it behind the wall.
 *
 * Placement is randomised (squad sizes, per-body jitter), so each wave is
 * planned several times and from a few player positions rather than once.
 *
 *   node tools/audit-spawns.mjs             # all boards
 *   node tools/audit-spawns.mjs refinery    # one board
 *
 * Exits non-zero if anything is flagged, so it can gate a build.
 */
import { launch } from './harness.mjs';

// NB: the audit body is stringified into the page, so everything it uses has
// to live inside it — no closure over module scope.
function audit() {
  const WAVES = 7;
  /** how many times each wave is planned, since jitter and squad sizes are random */
  const TRIALS = 12;
  /** where the players are standing — posts are placed relative to them */
  const VIEWPOINTS = [[0, 0, 0], [40, 0, 40], [-40, 0, -40]];

  const boards = window.__boards;
  const out = [];

  for (const info of boards) {
    const board = info.build();
    const phys = board.physics;
    const findings = [];
    let planned = 0;

    /** the mover's own test: a capsule against every box and cylinder */
    const overlap = (x, feetY, z, radius, height) => {
      const head = feetY + height;
      for (const b of phys.boxes) {
        if (head <= b.min.y || feetY >= b.max.y) continue;
        if (x <= b.min.x - radius || x >= b.max.x + radius) continue;
        if (z <= b.min.z - radius || z >= b.max.z + radius) continue;
        return 'box';
      }
      for (const c of phys.cylinders) {
        if (head <= c.minY || feetY >= c.maxY) continue;
        const dx = x - c.x, dz = z - c.z;
        const r = c.r + radius;
        if (dx * dx + dz * dz < r * r) return 'cylinder';
      }
      return null;
    };

    // The authored posts themselves, before any jitter or search ring: a post
    // inside a prop is silently rescued by the spawner's ring search, so the
    // wave audit below never sees it — but it costs several rings per body
    // and puts the squad wherever the ring found room, not where the level
    // designer put it (audit L3). The board's own ground has to be standable.
    const authored = [];
    for (let i = 0; i < board.groundSpawns.length; i++) {
      const s = board.groundSpawns[i];
      const hit = overlap(s.x, s.y, s.z, 0.6, 2.1);
      let why = hit ? `inside a ${hit}` : null;
      if (!why) {
        const g = phys.groundHeight(s.x, s.z, s.y + 0.4);
        if (!isFinite(g) || s.y - g > 3) why = 'has no ground under it';
      }
      if (!why && board.hazards) {
        for (const h of board.hazards) {
          const yMax = h.yMax ?? h.center.y + 3;
          if (s.y > yMax) continue;
          if (Math.hypot(s.x - h.center.x, s.z - h.center.z) <= h.radius) why = `in a ${h.kind} zone`;
        }
      }
      if (!why && board.burnAt && board.burnAt(s.x, s.z, s.y) > 0) why = 'on burning ground';
      if (!why && board.waterY !== undefined && s.y < board.waterY + 0.3) why = 'under water';
      if (why) authored.push({ index: i, at: [+s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1)], why });
    }

    for (const [px, py, pz] of VIEWPOINTS) {
      for (let wave = 1; wave <= WAVES; wave++) {
        for (let trial = 0; trial < TRIALS; trial++) {
          for (const p of window.__planWave(board, wave, 2, px, py, pz)) {
            planned++;
            const [x, y, z] = p.pos;
            const hit = overlap(x, y, z, p.body.radius, p.body.height);
            if (!hit) continue;
            findings.push({
              kind: p.kind,
              wave,
              inside: hit,
              at: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)],
            });
          }
        }
      }
    }

    // one line per distinct kind-and-place, however many trials found it
    const seen = new Set();
    const unique = findings.filter((f) => {
      const key = `${f.kind}@${f.at.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    out.push({
      board: info.id, planned, count: findings.length, findings: unique.slice(0, 20),
      posts: board.groundSpawns.length, authored,
    });
  }
  return out;
}

const only = process.argv[2];
const h = await launch();
await h.waitForText(/PRESS START|WAVE BATTLE/i);
const results = await h.page.evaluate(`(${audit.toString()})()`);
if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();

let total = 0;
for (const r of results) {
  if (only && r.board !== only) continue;
  total += r.count + r.authored.length;
  console.log(`\n=== ${r.board} — ${r.planned} bodies planned — ` +
    (r.count ? `${r.count} INSIDE GEOMETRY` : 'all have room to stand'));
  for (const f of r.findings) {
    console.log(`   wave ${String(f.wave).padStart(2)}  ${f.kind.padEnd(13)} in a ${f.inside.padEnd(9)} at ${JSON.stringify(f.at)}`);
  }
  console.log(`   authored spawn points: ${r.posts}, ` +
    (r.authored.length ? `${r.authored.length} NOT STANDABLE` : 'every one standable as authored'));
  for (const a of r.authored) {
    console.log(`   post ${String(a.index).padStart(2)} at ${JSON.stringify(a.at)} ${a.why}`);
  }
}
console.log(total
  ? `\n${total} spawn(s) inside geometry`
  : '\nevery planned spawn, on every board and every wave, has room to stand');
process.exit(total ? 1 : 0);
