/**
 * Collision audit: does everything that looks solid actually stop you?
 *
 * Builds every board in a real browser (via the `__boards` debug handle),
 * walks its scene graph, and tests each mesh's world footprint against the
 * board's physics world — boxes, cylinders and the heightfield. Anything that
 * reads as a solid object but has no collider under it is reported, which is
 * exactly the "I ran straight through that" class of bug.
 *
 * It sweeps the **mission levels** too, and not as an afterthought: a board is
 * only half of what a player stands in. Missions raise their own level on top
 * of one — rooms, walls, doorways — and that half went unaudited for as long
 * as this file existed. It is where the blast doors' posts turned out to be
 * decoration you could shoot straight through, which is the exact bug this
 * tool was written to find and could not see.
 *
 * Decoration is filtered out rather than reported: particles and point clouds,
 * additive glow panes, thin decals and light strips, and the enormous meshes
 * (terrain, sea, sky domes) that are either the ground itself or scenery.
 *
 *   node tools/audit-collision.mjs            # all boards
 *   node tools/audit-collision.mjs nevarro    # one board
 *
 * Exits non-zero if anything is flagged, so it can gate a build.
 */
import { launch } from './harness.mjs';

// NB: the audit body is stringified into the page, so everything it uses has
// to live inside it — no closure over module scope.
function audit(mode) {
  /** anything thinner than this is a decal, not an object */
  const THIN = 0.3;
  /** meshes bigger than this are the world itself (terrain, sea, sky) */
  const HUGE = 150;
  /** ignore what barely stands off the floor — you step over it anyway */
  const MIN_STANDING = 0.45;
  const out = [];

  // Either every board raised from the registry, or the one level the running
  // campaign has already built — the mission's own group hangs off the board's,
  // so a single walk covers the board and the level standing on it.
  const scenes = [];
  if (mode === 'boards') {
    for (const info of window.__boards) {
      const b = info.build();
      b.group.updateMatrixWorld(true);
      scenes.push({ id: info.id, group: b.group, phys: b.physics });
    }
  } else {
    const g = window.__game;
    g.board.group.updateMatrixWorld(true);
    scenes.push({ id: mode, group: g.board.group, phys: g.board.physics });
  }

  for (const sc of scenes) {
    const phys = sc.phys;
    const findings = [];
    let meshes = 0;
    let skipped = 0;

    // transform a point by a column-major 4x4
    const xf = (e, x, y, z) => [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];

    /** world AABB of a geometry bbox under matrix `e` */
    const worldBox = (bb, e) => {
      let lo = [Infinity, Infinity, Infinity];
      let hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) {
        const p = xf(e,
          i & 1 ? bb.max.x : bb.min.x,
          i & 2 ? bb.max.y : bb.min.y,
          i & 4 ? bb.max.z : bb.min.z);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
      }
      return { lo, hi };
    };

    /** is (x,z) inside a collider whose vertical span overlaps [minY,maxY]? */
    const covered = (x, z, minY, maxY) => {
      const pad = 0.25;                 // a collider may be slightly inset
      const overlaps = (a, b) => b > minY + 0.15 && a < maxY - 0.15;
      for (const b of phys.boxes) {
        if (x < b.min.x - pad || x > b.max.x + pad) continue;
        if (z < b.min.z - pad || z > b.max.z + pad) continue;
        if (overlaps(b.min.y, b.max.y)) return true;
      }
      for (const c of phys.cylinders) {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz > (c.r + pad) * (c.r + pad)) continue;
        if (overlaps(c.minY, c.maxY)) return true;
      }
      return false;
    };

    /** every mesh's world box, for the invisible-wall pass below */
    const seen = [];

    const consider = (obj, e, label) => {
      const geo = obj.geometry;
      if (!geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const { lo, hi } = worldBox(geo.boundingBox, e);
      const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
      meshes++;
      seen.push({ lo, hi });

      // ---- filters: things that are meant to be walked through ----
      // `userData.decor` is the board author saying so out loud — kelp you
      // swim through, coral, writhing tentacles. Everything else has to earn
      // its exemption by being a decal, a glow, or the world itself.
      // The flag is inherited: a decorative prop built as a group of parts
      // says so once, on the group, rather than on each piece of it.
      let decor = false;
      for (let n = obj; n; n = n.parent) if (n.userData && n.userData.decor) { decor = true; break; }
      if (decor) { skipped++; return; }
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const m = mats[0] || {};
      if (m.isShaderMaterial) { skipped++; return; }                    // sky domes
      if (m.isMeshBasicMaterial && m.transparent) { skipped++; return; } // glows, panes, rings
      if (Math.min(...size) < THIN) { skipped++; return; }               // decals, strips, signs
      if (Math.max(size[0], size[2]) > HUGE) { skipped++; return; }      // terrain, sea, lava sheet
      if (size[1] < MIN_STANDING) { skipped++; return; }                 // ankle-high trim

      // ---- coverage ----
      // Sample a grid across the object's OWN footprint and transform each
      // point out to the world, rather than probing its world AABB: a rotated
      // slab (a dome wall, a wrecked hull) fills barely a third of its AABB,
      // so AABB probes land in the empty corners and report holes that are
      // only ever air.
      // A round or tapered shape fills only part of its box — a cone is down
      // to half its base radius by mid-height — so probing the box corners
      // tests air and calls it a hole. Take the real footprint from the
      // geometry's own parameters where there is one.
      const bb = geo.boundingBox;
      const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
      const par = geo.parameters || {};
      const ly = (bb.min.y + bb.max.y) / 2;
      let radius = null;
      if (geo.type === 'ConeGeometry' && par.radius && par.height) {
        radius = par.radius * (1 - (ly + par.height / 2) / par.height);
      } else if (geo.type === 'CylinderGeometry' && par.height) {
        const t = (ly + par.height / 2) / par.height;
        radius = par.radiusBottom + (par.radiusTop - par.radiusBottom) * t;
      } else if ((geo.type === 'SphereGeometry' || geo.type === 'DodecahedronGeometry') && par.radius) {
        radius = Math.sqrt(Math.max(0, par.radius * par.radius - ly * ly));
      }

      const pts = [];
      const push = (lx, lz) => { const p = xf(e, lx, ly, lz); pts.push([p[0], p[2]]); };
      if (radius !== null) {
        push(0, 0);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          push(Math.cos(a) * radius * 0.7, Math.sin(a) * radius * 0.7);
        }
      } else {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            push(bb.min.x + (bb.max.x - bb.min.x) * ((i + 0.5) / 3),
              bb.min.z + (bb.max.z - bb.min.z) * ((j + 0.5) / 3));
          }
        }
      }
      let hits = 0;
      for (const [px, pz] of pts) if (covered(px, pz, lo[1], hi[1])) hits++;
      if (hits === pts.length) return;                                   // fully backed

      // a mesh sunk into the terrain isn't standing in the way of anything
      if (phys.heightAt) {
        const ground = phys.heightAt(cx, cz);
        if (hi[1] - ground < MIN_STANDING) return;
      }

      findings.push({
        label,
        type: geo.type,
        centre: [+cx.toFixed(1), +((lo[1] + hi[1]) / 2).toFixed(1), +cz.toFixed(1)],
        size: size.map((s) => +s.toFixed(1)),
        top: +hi[1].toFixed(1),
        coverage: `${hits}/${pts.length}`,
        volume: size[0] * size[1] * size[2],
      });
    };

    sc.group.traverse((obj) => {
      if (obj.isPoints || obj.isLine || obj.isSprite) return;
      if (!obj.isMesh) return;
      if (obj.isInstancedMesh) {
        // each instance is its own object in the world
        const arr = obj.instanceMatrix.array;
        const e0 = obj.matrixWorld.elements;
        for (let i = 0; i < obj.count; i++) {
          const im = arr.slice(i * 16, i * 16 + 16);
          // world = matrixWorld * instanceMatrix (column-major multiply)
          const e = new Array(16).fill(0);
          for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
              let s = 0;
              for (let k = 0; k < 4; k++) s += e0[k * 4 + r] * im[c * 4 + k];
              e[c * 4 + r] = s;
            }
          }
          consider(obj, e, `instance ${i}`);
        }
        return;
      }
      consider(obj, obj.matrixWorld.elements, 'mesh');
    });

    // ---- the other half of the question: solid where nothing looks solid ----
    // A collider with no geometry anywhere inside it is an invisible wall,
    // which is the same bug wearing a different coat. Mesh boxes are loose for
    // rotated shapes, so this errs towards silence rather than noise.
    const inAnyMesh = (x, y, z) => seen.some((s) =>
      x > s.lo[0] - 0.4 && x < s.hi[0] + 0.4 &&
      y > s.lo[1] - 0.4 && y < s.hi[1] + 0.4 &&
      z > s.lo[2] - 0.4 && z < s.hi[2] + 0.4);
    const phantoms = [];
    const probe = (label, cx, cy, cz, sx, sy, sz) => {
      const pts = [[cx, cy, cz]];
      for (const dx of [-0.4, 0.4]) for (const dz of [-0.4, 0.4]) {
        pts.push([cx + sx * dx, cy, cz + sz * dz]);
      }
      pts.push([cx, cy + sy * 0.4, cz], [cx, cy - sy * 0.4, cz]);
      if (pts.some(([x, y, z]) => inAnyMesh(x, y, z))) return;
      phantoms.push({ label, centre: [+cx.toFixed(1), +cy.toFixed(1), +cz.toFixed(1)], size: [+sx.toFixed(1), +sy.toFixed(1), +sz.toFixed(1)] });
    };
    for (const b of phys.boxes) {
      probe('box', (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2,
        b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    }
    for (const c of phys.cylinders) {
      probe('cylinder', c.x, (c.minY + c.maxY) / 2, c.z, c.r * 2, c.maxY - c.minY, c.r * 2);
    }

    findings.sort((a, b) => b.volume - a.volume);
    out.push({
      board: sc.id,
      meshes,
      skipped,
      boxes: phys.boxes.length,
      cylinders: phys.cylinders.length,
      findings,
      phantoms,
    });
  }
  return out;
}

const only = process.argv[2];
const h = await launch();
await h.waitForText(/PRESS START|WAVE BATTLE/i);
const results = await h.page.evaluate(`(${audit.toString()})('boards')`);

// ---- and again, on the level a mission raises over each board ----
// The campaign is driven the way a player drives it and the level it built is
// read back, which is the only handle on it from out here — the bundle does
// not export the builder (audit-mission-build.mjs takes the same route).
const BOARDS = results.map((r) => r.board);
for (const board of (only ? [only] : BOARDS)) {
  await h.page.evaluate(([b]) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('campaign', 1, b, ['din']);
  }, [board]);
  try {
    await h.page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  } catch {
    console.log(`\n=== ${board} (mission) — did not reach play, skipped`);
    continue;
  }
  results.push(...await h.page.evaluate(`(${audit.toString()})(${JSON.stringify(`${board} (mission)`)})`));
}
if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();

let total = 0;
let ghosts = 0;
for (const r of results) {
  if (only && r.board !== only && r.board !== `${only} (mission)`) continue;
  const n = r.findings.length;
  total += n;
  ghosts += r.phantoms.length;
  console.log(`\n=== ${r.board} — ${r.meshes} meshes (${r.skipped} decorative), ` +
    `${r.boxes} boxes + ${r.cylinders} cylinders — ${n ? `${n} UNBACKED` : 'all backed'}` +
    `${r.phantoms.length ? `, ${r.phantoms.length} INVISIBLE WALL(S)` : ''}`);
  for (const f of r.findings) {
    console.log(`   ${f.type.padEnd(18)} at ${JSON.stringify(f.centre).padEnd(22)} ` +
      `size ${JSON.stringify(f.size).padEnd(20)} top ${String(f.top).padStart(6)}  cover ${f.coverage}`);
  }
  for (const p of r.phantoms) {
    console.log(`   invisible ${p.label.padEnd(9)} at ${JSON.stringify(p.centre).padEnd(22)} size ${JSON.stringify(p.size)}`);
  }
}
console.log(total || ghosts
  ? `\n${total} unbacked mesh(es), ${ghosts} invisible wall(s)`
  : '\nevery solid-looking mesh is backed, and every collider has something on it');
process.exit(total || ghosts ? 1 : 0);
