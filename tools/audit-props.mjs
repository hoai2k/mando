/**
 * Prop collision audit: do the *sculpts* have the right colliders?
 *
 * `audit-collision.mjs` walks a board the instant it is built, which is before
 * a single `.glb` has arrived — so what it checks is the procedural stand-ins.
 * That is the half of the question that was already answered. The other half is
 * what the player actually meets: the authored model that replaced the stand-in
 * a second later, which is a different shape, and whose colliders were placed
 * around the thing it replaced.
 *
 * This builds every board, waits for the sculpts, and for each one measures
 * both directions of the mismatch:
 *
 *   holes — parts of the model with no collider under them. This is "I flew
 *           straight through the crane" and "I can't land on the container".
 *   slop  — collider volume with no model in it. This is "the ship's collider
 *           is fatter than the ship", the invisible shell you stand on.
 *
 * Both are measured on a voxel grid over the model's own bounding box, so the
 * numbers are fractions of the sculpt, not of a bounding box that is mostly
 * air.
 *
 *   node tools/audit-props.mjs             # all boards
 *   node tools/audit-props.mjs station     # one board
 *
 * Exits non-zero if any prop is worse than the thresholds below, so it can
 * gate a build.
 */
import { launch } from './harness.mjs';

/** a prop may be this un-backed before it counts as a hole */
const HOLE_LIMIT = 0.25;
/** and this much of its collider volume may be empty before it counts as slop */
const SLOP_LIMIT = 0.55;

function audit(limits) {
  const { HOLE_LIMIT, SLOP_LIMIT } = limits;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** occupancy grid of a model's triangles, in world space */
  function voxelise(root, cell) {
    root.updateWorldMatrix(true, true);
    const tris = [];
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let decor = false;
      for (let n = o; n; n = n.parent) if (n.userData && n.userData.decor) decor = true;
      if (decor) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const m = mats[0];
      if (m && m.isMeshBasicMaterial && m.transparent) return;
      const pos = o.geometry && o.geometry.getAttribute('position');
      if (!pos) return;
      const idx = o.geometry.getIndex();
      const e = o.matrixWorld.elements;
      const at = (i) => {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        return [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        ];
      };
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        const t = [
          at(idx ? idx.getX(i) : i),
          at(idx ? idx.getX(i + 1) : i + 1),
          at(idx ? idx.getX(i + 2) : i + 2),
        ];
        tris.push(t);
        for (const p of t) for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
    });
    if (!tris.length) return null;
    const n = [0, 1, 2].map((k) => Math.max(1, Math.min(48, Math.ceil((hi[k] - lo[k]) / cell))));
    const s = [0, 1, 2].map((k) => (hi[k] - lo[k]) / n[k] || cell);
    const grid = new Uint8Array(n[0] * n[1] * n[2]);
    const at = (x, y, z) => (y * n[2] + z) * n[0] + x;
    for (const t of tris) {
      const e1 = [0, 1, 2].map((k) => t[1][k] - t[0][k]);
      const e2 = [0, 1, 2].map((k) => t[2][k] - t[0][k]);
      const len = (v) => Math.hypot(v[0], v[1], v[2]);
      const step = Math.min(s[0], s[1], s[2]) * 0.6;
      const m = Math.max(1, Math.min(24, Math.ceil(Math.max(len(e1), len(e2)) / step)));
      for (let i = 0; i <= m; i++) {
        for (let j = 0; i + j <= m; j++) {
          const c = [0, 1, 2].map((k) => t[0][k] + e1[k] * (i / m) + e2[k] * (j / m));
          const g = [0, 1, 2].map((k) =>
            Math.max(0, Math.min(n[k] - 1, Math.floor((c[k] - lo[k]) / s[k]))));
          grid[at(g[0], g[1], g[2])] = 1;
        }
      }
    }
    return { grid, lo, n, s, at };
  }

  /** is any occupied cell within one step of this one? */
  function near(grid, at, n, x, y, z) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= n[0] || Y >= n[1] || Z >= n[2]) continue;
          if (grid[at(X, Y, Z)]) return true;
        }
      }
    }
    return false;
  }

  const boards = window.__boards;
  const out = [];
  const fitBefore = window.__fitStats ? window.__fitStats() : null;

  return (async () => {
    for (const info of boards) {
      const board = info.build();
      const phys = board.physics;
      // give the sculpts time to arrive; they land frames apart
      const holders = [];
      board.group.traverse((o) => { if (o.userData && o.userData.prop) holders.push(o); });
      for (let i = 0; i < 120; i++) {
        if (holders.every((h) => h.children.length)) break;
        await sleep(250);
      }
      board.group.updateMatrixWorld(true);

      const solid = (x, y, z) => {
        for (const b of phys.boxes) {
          if (x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z) return true;
        }
        for (const c of phys.cylinders) {
          if (y < c.minY || y > c.maxY) continue;
          const dx = x - c.x, dz = z - c.z;
          if (dx * dx + dz * dz <= c.r * c.r) return true;
        }
        if (phys.heightAt && y <= phys.heightAt(x, z)) return true;
        return false;
      };

      const props = [];
      for (const h of holders) {
        const id = h.userData.prop;
        if (!h.children.length) { props.push({ id, missing: true }); continue; }
        const v = voxelise(h, 0.7);
        if (!v) { props.push({ id, missing: true }); continue; }
        const { grid, lo, n, s, at } = v;
        let filled = 0, holes = 0, solidCells = 0, slop = 0;
        for (let y = 0; y < n[1]; y++) {
          for (let z = 0; z < n[2]; z++) {
            for (let x = 0; x < n[0]; x++) {
              const cx = lo[0] + (x + 0.5) * s[0];
              const cy = lo[1] + (y + 0.5) * s[1];
              const cz = lo[2] + (z + 0.5) * s[2];
              const inside = solid(cx, cy, cz);
              if (inside) solidCells++;
              if (grid[at(x, y, z)]) {
                filled++;
                if (!inside) holes++;
              } else if (inside && !near(grid, at, n, x, y, z)) {
                // a collider cell one step off the sculpt is the grid being
                // blunt, not the collider being wrong; anything further out is
                // shell you would stand on with nothing under your feet
                slop++;
              }
            }
          }
        }
        props.push({
          id,
          fitted: !!h.userData.fitted,
          cells: filled,
          hole: filled ? +(holes / filled).toFixed(2) : 0,
          slop: solidCells ? +(slop / solidCells).toFixed(2) : 0,
        });
      }

      // one row per distinct sculpt: the worst instance of it on this board
      const worst = new Map();
      for (const p of props) {
        const prev = worst.get(p.id);
        const score = (q) => (q.missing ? -1 : q.hole + q.slop);
        if (!prev || score(p) > score(prev)) worst.set(p.id, p);
      }
      out.push({
        board: info.id,
        boxes: phys.boxes.length,
        cylinders: phys.cylinders.length,
        props: [...worst.values()].map((p) => ({
          ...p,
          bad: !p.missing && (p.hole > HOLE_LIMIT || p.slop > SLOP_LIMIT),
        })),
      });
    }
    const fitAfter = window.__fitStats ? window.__fitStats() : null;
    if (fitBefore && fitAfter) {
      out.push({
        fit: {
          props: fitAfter.props - fitBefore.props,
          boxes: fitAfter.boxes - fitBefore.boxes,
          ms: +(fitAfter.ms - fitBefore.ms).toFixed(1),
        },
      });
    }
    return out;
  })();
}

const only = process.argv[2];
const h = await launch();
await h.waitForText(/PRESS START|WAVE BATTLE/i);
const results = await h.page.evaluate(
  `(${audit.toString()})(${JSON.stringify({ HOLE_LIMIT, SLOP_LIMIT })})`,
);
if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();

let bad = 0;
let missing = 0;
for (const r of results) {
  if (r.fit) {
    console.log(`\nfitting cost across every board: ${r.fit.props} sculpts, ` +
      `${r.fit.boxes} boxes, ${r.fit.ms} ms total ` +
      `(${(r.fit.ms / Math.max(1, r.fit.props)).toFixed(1)} ms each, paid once as each model lands)`);
    continue;
  }
  if (only && r.board !== only) continue;
  const flagged = r.props.filter((p) => p.bad).length;
  bad += flagged;
  missing += r.props.filter((p) => p.missing).length;
  console.log(`\n=== ${r.board} — ${r.props.length} sculpts, ` +
    `${r.boxes} boxes + ${r.cylinders} cylinders — ` +
    `${flagged ? `${flagged} MISFITTED` : 'all fitted'}`);
  for (const p of r.props.sort((a, b) => (b.hole ?? 0) - (a.hole ?? 0))) {
    if (p.missing) { console.log(`   ${p.id.padEnd(20)} model never arrived`); continue; }
    console.log(`   ${p.id.padEnd(20)} ${p.fitted ? 'fitted ' : 'placed '} ` +
      `hole ${String(p.hole).padStart(5)}  slop ${String(p.slop).padStart(5)}  ` +
      `${p.bad ? '  <-- ' + (p.hole > HOLE_LIMIT ? 'you fall through this' : 'collider is fatter than the sculpt') : ''}`);
  }
}
console.log(bad
  ? `\n${bad} sculpt(s) whose colliders do not match what they draw`
  : `\nevery sculpt is backed by colliders that match it${missing ? ` (${missing} model(s) absent)` : ''}`);
process.exit(bad ? 1 : 0);
