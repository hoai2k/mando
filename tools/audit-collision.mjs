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
    scenes.push({ id: mode, group: g.board.group, phys: g.board.physics,
      start: g.campaign?.stage?.starts?.[0] ?? g.players[0]?.position });
  }

  /**
   * Where a body can actually get to, flooded out from the party's own start
   * with the mover's own two tests: the highest surface at or below feet plus
   * a step (`groundHeight`), then room to stand there (`capsuleFree`). One
   * pass per scene, reused by every mesh.
   *
   * This is the difference between "unbacked" and "a hole". A mission's border
   * is one merged mesh of rock standing OUTSIDE the slab that colliders it
   * (`ridge()` in world/mission.ts: the face of the cliff lands on the face of
   * the wall, so nothing is proud of its collider), and a stage's floor plate
   * runs out past that slab — so probing "is there standable ground beside
   * this vertex" says yes on the dead side of a wall no player is ever on. A
   * hundred metres of border came back as findings that way and buried two
   * real ones on the Dune Sea. Asking where a body can *walk* answers it: the
   * far side of a wall is not in the fill, a crate in the middle of a fight is.
   */
  const reachOf = (sc) => {
    const phys = sc.phys, start = sc.start;
    if (!start || !phys.groundHeight || !phys.capsuleFree) return null;
    const CELL = 1, R = 0.6, H = 1.7, STEP = 0.55, CAP = 400000;
    const stands = (x, z, fromY) => {
      const y = phys.groundHeight(x, z, fromY + STEP);
      if (!isFinite(y) || Math.abs(y - fromY) > STEP) return null;
      return phys.capsuleFree(x, y + 0.05, z, R, H) ? y : null;
    };
    const key = (i, j) => i + ',' + j;
    const seen = new Map();
    const i0 = Math.round(start.x / CELL), j0 = Math.round(start.z / CELL);
    const y0 = phys.groundHeight(start.x, start.z, start.y + STEP);
    seen.set(key(i0, j0), y0);
    const q = [[i0, j0, y0]];
    let n = 0;
    while (q.length && n < CAP) {
      const [i, j, y] = q.pop(); n++;
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + d[0], nj = j + d[1], k = key(ni, nj);
        if (seen.has(k)) continue;
        const nx = ni * CELL, nz = nj * CELL;
        if (Math.abs(nx) > 600 || Math.abs(nz) > 600) continue;
        const ny = stands(nx, nz, y);
        if (ny === null) continue;
        seen.set(k, ny);
        q.push([ni, nj, ny]);
      }
    }
    // A fill that hit the cap is not a map of anywhere; better to fall back to
    // reporting everything than to call the unvisited half of a level solid.
    return n >= CAP ? null : { seen, key, CELL };
  };

  for (const sc of scenes) {
    const phys = sc.phys;
    const reach = reachOf(sc);
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
      // Nothing you cannot see can be decoration you shoot through, and the
      // rule this tool enforces is "if it is *visible* it is solid". A prop
      // that has been replaced by an authored sculpt is the case that matters:
      // authoredProp (world/props.ts) hides the procedural stand-in the moment
      // the model lands, and fitColliders replaces the hand-placed colliders
      // that stood around it with ones fitted to the sculpt. The stand-in is
      // then invisible AND deliberately unbacked -- which is the finished,
      // correct state, and which this pass read as a bug. All 22 findings in
      // nightly run 227 were that: hidden stand-ins, the three "zero of nine"
      // station crates among them. Checked up the parent chain, since a prop
      // is hidden by the group as often as by the mesh.
      for (let n = obj; n; n = n.parent) if (!n.visible) { skipped++; return; }
      // `userData.decor` is the board author saying so out loud — kelp you
      // swim through, coral, writhing tentacles. Everything else has to earn
      // its exemption by being a decal, a glow, or the world itself.
      // The flag is inherited: a decorative prop built as a group of parts
      // says so once, on the group, rather than on each piece of it.
      let decor = false;
      for (let n = obj; n; n = n.parent) if (n.userData && n.userData.decor) { decor = true; break; }
      if (decor) { skipped++; return; }
      // A retracted door leaf has slid into the wall and its blocker is gone,
      // which is the correct state of an open door and looks exactly like a
      // wall you can walk through. `Gate.block` writes this on every leaf.
      for (let n = obj; n; n = n.parent) {
        if (n.userData && n.userData.gateShut === false) { skipped++; return; }
      }
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
      } else if (!par.width && !par.radius && geo.attributes && geo.attributes.position) {
        // An authored sculpt is a BufferGeometry with no `parameters`, so the
        // round-shape shortcut above cannot fire and the box grid below samples
        // its bounding-box corners -- which for a crane, a freighter hull, a
        // mythosaur skull or a reactor column is air. That is what every one of
        // the nine remaining findings was: the procedural twin gets the radius
        // treatment, the model that replaced it does not, so a sculpt is asked
        // to be solid out to the corners of a box it never filled.
        //
        // Sample its own vertices instead. A vertex is on the surface by
        // definition, so this asks the question the tool means to ask -- is
        // what is drawn backed -- rather than whether a box around it is. It is
        // strictly more honest than the grid, not a loosening: the grid could
        // miss a real hole between its nine points, and the surface cannot.
        // Take a horizontal slice at the height being probed, not the whole
        // surface. Coverage is tested at one height (`ly`), so a vertex from
        // the bottom of the model answers a question about the middle of it --
        // and gets it wrong wherever the shape is not a column. The mythosaur
        // skull is the case: it is fitted with `skirt: 0.9`, which drops its
        // buried jaw from the fit on purpose, and sampling that jaw reported
        // the crown above it as unbacked.
        const pos = geo.attributes.position;
        const band = Math.max(0.5, (bb.max.y - bb.min.y) * 0.25);
        const near = [];
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(pos.getY(i) - ly) <= band) near.push(i);
        }
        const src = near.length >= 8 ? near : null;
        if (src) {
          const step = Math.max(1, Math.floor(src.length / 24));
          for (let i = 0; i < src.length; i += step) push(pos.getX(src[i]), pos.getZ(src[i]));
        } else {
          const step = Math.max(1, Math.floor(pos.count / 24));
          for (let i = 0; i < pos.count; i += step) push(pos.getX(i), pos.getZ(i));
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
      const bare = [];
      for (const [px, pz] of pts) {
        if (covered(px, pz, lo[1], hi[1])) hits++;
        else bare.push([px, pz]);
      }
      if (hits === pts.length) return;                                   // fully backed

      // ---- and the question behind the question: can anyone get to it? ----
      // The rule is "if it is visible it is solid", but the *report* this tool
      // exists to serve is "I walked straight through that", and you cannot
      // walk through what you cannot walk up to. So each unbacked point is
      // asked whether a body could ever be standing beside it — against the
      // fill above, not against a local probe, because the far side of a wall
      // has perfectly good standable floor on it and nobody is ever there.
      // This is narrower than it sounds: a crate, a tent, a pillar or a crane
      // in the middle of a fight passes trivially, so everything this tool
      // used to catch it still catches.
      if (reach) {
        const near = (px, pz) => {
          const i0 = Math.round(px / reach.CELL), j0 = Math.round(pz / reach.CELL);
          for (let i = i0 - 1; i <= i0 + 1; i++) {
            for (let j = j0 - 1; j <= j0 + 1; j++) {
              const y = reach.seen.get(reach.key(i, j));
              // and at this height: a walkway forty metres below is not "beside"
              if (y !== undefined && y > lo[1] - 2.5 && y < hi[1] + 0.5) return true;
            }
          }
          return false;
        };
        if (!bare.some(([px, pz]) => near(px, pz))) { skipped++; return; }
      }

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
// This sweep used to run on a page that had not asked for the outdoor stages,
// back when Missions ran the walled room chain unless it was told otherwise —
// so for as long as it existed it audited `mission-legacy.ts` and reported it
// as "the mission level". The design actually shipped had never been swept at
// all, which is how a run came to have rock walls you could walk through in
// it. The stage chain is the default now, so the plain page is the right one;
// what had to change is that the sweep walks *every* stage of a run.
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
  // `playing` is not `built`. A sculpt's colliders are fitted in loadProp's
  // onLoad (world/props.ts authoredProp), so they land whole frames after the
  // board does -- and later here than anywhere else, because the match before
  // this one ended in releaseModels() and gave that territory's sculpts back.
  // Measured on desert straight after a wave sweep: 215 collider boxes with the
  // butte at [45,65] carrying none of its own, then 299 and all six of them at
  // about ten seconds. Sweeping on `playing` measures a board that is up but
  // not yet solid.
  //
  // Wait for THIS BOARD'S sculpts, named from the holders standing in the scene
  // (authoredProp writes userData.prop). Waiting for the tracker's in-flight
  // list to empty does not work: the warm queue is always pulling something in
  // the background -- droid.glb, then fennec.glb, then a portrait -- so the
  // list never empties and the wait just burns its timeout. Waiting for the
  // collider count to stop changing does not work either: it sits flat for the
  // six seconds before the first model lands, so "unchanged twice" is true
  // before anything has arrived.
  try {
    await h.page.waitForFunction(() => {
      const want = new Set();
      window.__game?.board.group.traverse((o) => {
        if (o.userData && o.userData.prop) want.add(`models/${o.userData.prop}.glb`);
      });
      return !(window.__loading?.() ?? []).some((k) => want.has(k));
    }, null, { timeout: 60000, polling: 500 });
  } catch {
    console.log(`\n=== ${board} (mission) — sculpts still in flight, measuring anyway`);
  }
  // Every stage of the run, not just the one the match opens on. A run is a
  // chain of maps behind transport doors and only the first was ever measured;
  // the ravine and the far side of the Dune Sea had never been looked at.
  for (let stage = 0; stage < 6; stage++) {
    // Open the stage before measuring it. Coverage is now judged against where
    // a body can walk (see `reachOf`), and on a stage still being fought that
    // is one zone: every gate past it is sealed, so a hole in the second half
    // of the level would be filtered out as unreachable — the exact opposite
    // of what this tool is for. Clearing the zones is what the crossing code
    // below already does to reach the next stage; it just has to happen first.
    await h.page.evaluate(() => {
      const g = window.__game, c = g.campaign;
      if (!c || !c.stage) return;
      const blank = {
        moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
        dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
        meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
        zoomDelta: 0, blockHeld: false, pausePressed: false, meleeSwapPressed: false,
        rangedSwapPressed: false, throttleHeld: false, brakeHeld: false,
      };
      const idle = [blank, { ...blank }, { ...blank }, { ...blank }];
      window.__manual = true;
      c.idx = c.stage.zones.length;
      c.phase = 'travel';
      for (const e of g.enemies) e.removeMe = true;
      for (let i = 0; i < 120; i++) g.update(1 / 30, idle);
      window.__manual = false;
    });
    results.push(...await h.page.evaluate(
      `(${audit.toString()})(${JSON.stringify(`${board} (mission ${stage + 1})`)})`));
    const crossed = await h.page.evaluate(() => {
      const g = window.__game;
      const c = g.campaign;
      if (!c || !c.stage || !c.stage.exitPortal) return false;
      const blank = {
        moveX: 0, moveY: 0, lookX: 0, lookY: 0, jumpHeld: false, jumpPressed: false,
        dashPressed: false, sprintHeld: false, shootHeld: false, aimHeld: false,
        meleePressed: false, rocketPressed: false, slamPressed: false, zoomHeld: false,
        zoomDelta: 0, blockHeld: false, pausePressed: false, meleeSwapPressed: false,
        rangedSwapPressed: false, throttleHeld: false, brakeHeld: false,
      };
      const idle = [blank, { ...blank }, { ...blank }, { ...blank }];
      window.__manual = true;
      c.idx = c.stage.zones.length;
      c.phase = 'travel';
      for (const e of g.enemies) e.removeMe = true;
      const was = c.stageIdx;
      for (let i = 0; i < 120; i++) g.update(1 / 30, idle);
      const portal = c.stage.exitPortal;
      if (!portal) { window.__manual = false; return false; }
      for (let i = 0; i < 300 && c.stageIdx === was; i++) {
        if (i % 20 === 0) g.players[0].position.copy(portal.threshold);
        g.update(1 / 30, idle);
      }
      window.__manual = false;
      return c.stageIdx !== was;
    });
    if (!crossed) break;
    // the next stage's sculpts have to land before it is worth measuring
    await new Promise((r) => setTimeout(r, 4000));
  }
}
if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();

let total = 0;
let ghosts = 0;
for (const r of results) {
  if (only && r.board !== only && !r.board.startsWith(`${only} (mission`)) continue;
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
