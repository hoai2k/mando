/**
 * The floor audit: is every square metre a player can stand on honest?
 *
 * `audit-trail.mjs` walks the line a player is *sent* along, and
 * `audit-borders.mjs` looks out from each zone's centre. Both skip anything
 * tagged `decor` on the grounds that scenery is never in the way — and that
 * is exactly the assumption a playtest broke: a backdrop boulder laid for the
 * horizon that ended up standing on a lane is a wall you walk through, and
 * neither audit could see it.
 *
 * This one samples a grid over the whole walkable footprint of every stage
 * (`stage.contains`) at body height and asks two things of each point: is
 * something drawn here, scenery included, and can a body stand here anyway?
 * Both true is a walk-through wall, reported with the mesh that drew it.
 *
 *   node tools/audit-floor.mjs            # every board
 *   node tools/audit-floor.mjs desert     # one
 *
 * Exits non-zero if anything is flagged.
 */
import { launch } from './harness.mjs';

function audit(stageName) {
  const g = window.__game;
  const phys = g.board.physics;
  const st = g.campaign.stage;
  g.board.group.updateMatrixWorld(true);

  /** how far above the floor a body's chest and head ride */
  const BANDS = [0.6, 1.35];
  const STEP = 1.5;
  const R = 0.6, H = 1.7;

  const xf = (e, x, y, z) => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];

  // ---- the solids: every mesh that claims to be in the way ----
  const solids = [];
  g.board.group.traverse((o) => {
    if (!o.isMesh || o.isPoints || o.isLine || o.isSprite) return;
    let decor = false;
    for (let n = o; n; n = n.parent) {
      // A sculpt that has fitted its own colliders is collidered where it is
      // drawn by construction (`world/collide.ts` voxelises its triangles).
      // What a parity test finds *inside* one is its interior — a shed you
      // walk into, an open-ended tram — walled in single-sided quads that
      // read as solid from within. That is the sculpt's business, not the
      // level's, and `audit-props.mjs` is the audit that judges the fit.
      if (n.userData && n.userData.fitted) return;
      if (!n.visible) return;                                   // a hidden stand-in
      if (n.userData && n.userData.decor) { decor = true; }      // scenery: still a wall if you can walk through it
      if (n.userData && n.userData.gateShut === false) return;  // an open door
    }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.isShaderMaterial) return;                       // sky
    if (m.isMeshBasicMaterial && m.transparent) return;         // glows, markers
    const geo = o.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return;
    // An open surface has no inside for a parity test to find: a ray from any
    // point above a ground plane crosses it an odd number of times going down
    // and an even number going along, so "inside" means whichever way the ray
    // happened to point. The territory's own terrain is one of these, and it
    // is the floor, not a wall.
    if (geo.type === 'PlaneGeometry') return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!isFinite(bb.min.x)) return;
    const e = o.matrixWorld.elements;
    // world triangles, once
    const pos = geo.attributes.position;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    if (count > 240000) return;               // a territory's own terrain
    const tris = new Float64Array(count * 3);
    for (let i = 0; i < count; i++) {
      const k = idx ? idx.getX(i) : i;
      const p = xf(e, pos.getX(k), pos.getY(k), pos.getZ(k));
      tris[i * 3] = p[0]; tris[i * 3 + 1] = p[1]; tris[i * 3 + 2] = p[2];
    }
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < tris.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (tris[i + k] < lo[k]) lo[k] = tris[i + k];
        if (tris[i + k] > hi[k]) hi[k] = tris[i + k];
      }
    }
    // the world itself is not a wall on the trail
    if (Math.max(hi[0] - lo[0], hi[2] - lo[2]) > 900) return;
    let tag = '';
    for (let n = o; n; n = n.parent) {
      if (n.userData && n.userData.prop) { tag = `prop:${n.userData.prop}`; break; }
      if (n.userData && n.userData.facing) tag = tag || 'border';
    }
    if (decor) tag = 'scenery:' + (tag || 'untagged');
    solids.push({ tris, lo, hi, tag, type: geo.type });
  });

  /**
   * Is `(x, y, z)` inside this mesh's own surface?
   *
   * Parity along a ray: count the triangles it crosses, odd is inside.
   * Triangles are rejected first on the two cheap axes, so a merged border of
   * twenty-five thousand faces costs a handful of them per question.
   *
   * **Three rays, and a majority.** A mission border is a union of forty
   * overlapping boulders, and parity is only exact for a single closed
   * surface: a ray that grazes where two shells meet can come back odd from
   * open sand. One ray put a wall in the ravine six metres from the nearest
   * rock. Three along different axes disagree there and agree inside real
   * rock, which is the whole difference between a finding and a wild goose.
   */
  const parity = (s, x, y, z, axis) => {
    const t = s.tris;
    // (a, b) are the two axes the ray does NOT travel along; c is the ray's
    const [ia, ib, ic] = axis === 0 ? [1, 2, 0] : axis === 1 ? [0, 2, 1] : [0, 1, 2];
    const pa = [x, y, z][ia], pb = [x, y, z][ib], pc = [x, y, z][ic];
    // The nearest surface along the ray, and which way it faces. Counting
    // crossings — plain parity — is only exact for a single closed surface,
    // and a mission border is a union of forty overlapping boulders whose
    // interior faces are all still in the mesh. A ray through that can come
    // back odd from open ground: it put a wall in the middle of a Crevasse
    // lane with the nearest rock seven and a half metres away on either side,
    // and survived three goes at the level trying to satisfy it.
    //
    // Orientation does not have that problem. Leaving a solid you cross a
    // back face; entering one you cross a front face — true of a union as
    // much as of one shape. So: inside iff the first thing the ray meets is
    // facing away from it.
    let bestT = Infinity, bestBack = false;
    for (let i = 0; i < t.length; i += 9) {
      const aa = t[i + ia], ba = t[i + 3 + ia], ca = t[i + 6 + ia];
      if ((aa < pa && ba < pa && ca < pa) || (aa > pa && ba > pa && ca > pa)) continue;
      const ab = t[i + ib], bb = t[i + 3 + ib], cb = t[i + 6 + ib];
      if ((ab < pb && bb < pb && cb < pb) || (ab > pb && bb > pb && cb > pb)) continue;
      const ac = t[i + ic], bc = t[i + 3 + ic], cc = t[i + 6 + ic];
      if (ac < pc && bc < pc && cc < pc) continue;
      const d = (ba - ca) * (ab - cb) + (cb - bb) * (aa - ca);
      if (Math.abs(d) < 1e-12) continue;
      const l1 = ((ba - ca) * (pb - cb) + (cb - bb) * (pa - ca)) / d;
      const l2 = ((ca - aa) * (pb - cb) + (ab - cb) * (pa - ca)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const hit = l1 * ac + l2 * bc + l3 * cc;
      const dist = hit - pc;
      if (dist <= 0 || dist >= bestT) continue;
      // the triangle's own normal, along the ray's axis
      const e1 = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]];
      const e2 = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      bestT = dist;
      // Inside a solid, the first surface a ray travelling +c meets is the
      // boundary on its far side, whose outward normal points the same way
      // the ray does. Outside, the first thing met is a face turned back
      // toward the ray. So: inside iff that normal agrees with the direction
      // of travel.
      bestBack = n[ic] > 0;
    }
    return bestT < Infinity && bestBack;
  };

  /**
   * Inside this mesh's own surface? Three rays and a majority. The
   * orientation test above is exact for a well-formed solid, so the vote is
   * only there for the degenerate cases — a ray that leaves along an edge or
   * exactly through a shared vertex — which a border of forty merged,
   * noised cylinders has plenty of.
   */
  const inside = (s, x, y, z) => {
    if (x < s.lo[0] || x > s.hi[0] || y < s.lo[1] || y > s.hi[1] || z < s.lo[2] || z > s.hi[2]) return false;
    let votes = 0;
    for (const axis of [0, 1, 2]) if (parity(s, x, y, z, axis)) votes++;
    return votes >= 2;
  };

  // Cover you can shoot out of the way is not a blocked trail. A road's crate
  // barricade stands across the lane on purpose and comes apart when it is
  // rammed or shot, which is the beat it exists for.
  const breakables = (g.board.breakables ?? []).filter((b) => !b.broken).map((b) => b.box);
  const breakableAt = (x, z) => breakables.some((b) =>
    x > b.min.x - 1 && x < b.max.x + 1 && z > b.min.z - 1 && z < b.max.z + 1);


  const found = [];
  const seen = new Map();
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  const grow = (p) => { lo[0] = Math.min(lo[0], p.x); lo[1] = Math.min(lo[1], p.z); hi[0] = Math.max(hi[0], p.x); hi[1] = Math.max(hi[1], p.z); };
  for (const zn of st.zones) {
    grow({ x: zn.rect.minX, z: zn.rect.minZ }); grow({ x: zn.rect.maxX, z: zn.rect.maxZ });
  }
  for (const p of st.path || []) grow(p);
  if (st.exitPortal) grow(st.exitPortal.threshold);
  if (st.backPortal) grow(st.backPortal.pocket);
  let sampled = 0;
  for (let x = lo[0] - 6; x <= hi[0] + 6; x += STEP) {
    for (let z = lo[1] - 6; z <= hi[1] + 6; z += STEP) {
      if (!st.contains(x, z)) continue;
      const floor = phys.groundHeight(x, z, st.groundAt(x, z) + 0.7);
      if (!isFinite(floor)) continue;
      sampled++;
      const free = phys.capsuleFree(x, floor + 0.05, z, R, H);
      if (!free) continue;
      let drawn = null;
      for (const band of BANDS) {
        for (const s of solids) {
          if (inside(s, x, floor + band, z)) { drawn = s; break; }
        }
        if (drawn) break;
      }
      if (!drawn) continue;
      const k = `${drawn.tag}|${drawn.type}|${drawn.lo.map((n) => n.toFixed(0)).join(',')}`;
      const zone = st.zones.find((zn) => x >= zn.rect.minX && x <= zn.rect.maxX && z >= zn.rect.minZ && z <= zn.rect.maxZ);
      const where = zone ? zone.spec.label : 'a lane';
      const e = seen.get(k);
      if (e) { e.points++; e.places.add(where); if (e.sample.length < 12) e.sample.push([+x.toFixed(1), +z.toFixed(1)]); continue; }
      const rec = { tag: drawn.tag || '(untagged)', type: drawn.type, points: 1, places: new Set([where]),
        at: [+x.toFixed(1), +z.toFixed(1)], sample: [[+x.toFixed(1), +z.toFixed(1)]],
        size: [+(drawn.hi[0] - drawn.lo[0]).toFixed(1), +(drawn.hi[1] - drawn.lo[1]).toFixed(1), +(drawn.hi[2] - drawn.lo[2]).toFixed(1)] };
      seen.set(k, rec);
      found.push(rec);
    }
  }
  for (const f of found) f.places = [...f.places];
  return { stage: stageName, label: st.spec.label, solids: solids.length, sampled, found };
}
const BOARDS = ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];
const only = process.argv[2];
const h = await launch();
const { page } = h;
page.on('pageerror', (e) => console.log(`  PAGE ERROR: ${String(e).slice(0, 200)}`));
await h.waitForText(/PRESS START|WAVE BATTLE/i);

const results = [];
for (const board of (only ? [only] : BOARDS)) {
  await page.evaluate(([b]) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('campaign', 1, b, ['din']);
  }, [board]);
  try {
    await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  } catch {
    console.log(`\n=== ${board} — did not reach play, skipped`);
    continue;
  }
  // a sculpt's colliders are fitted when its file lands, so wait for this
  // board's own models before deciding anything is unbacked
  try {
    await page.waitForFunction(() => {
      const want = new Set();
      window.__game?.board.group.traverse((o) => {
        if (o.userData && o.userData.prop) want.add(`models/${o.userData.prop}.glb`);
      });
      return !(window.__loading?.() ?? []).some((k) => want.has(k));
    }, null, { timeout: 60000, polling: 500 });
  } catch { /* measure anyway */ }

  for (let stage = 0; stage < 6; stage++) {
    // Open the level before walking its trail. A zone's exit barrier is shut
    // until the zone is cleared, and a shut door across the way on is the
    // level working — reported as "the trail is blocked" it would bury the
    // real finding under one per sealed zone on every board.
    await page.evaluate(() => {
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
    results.push(await page.evaluate(`(${audit.toString()})(${JSON.stringify(`${board} stage ${stage + 1}`)})`));
    const crossed = await page.evaluate(() => {
      const g = window.__game, c = g.campaign;
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
      for (let i = 0; i < 300 && c.stageIdx === was; i++) {
        if (i % 20 === 0) g.players[0].position.copy(portal.threshold);
        g.update(1 / 30, idle);
      }
      window.__manual = false;
      return c.stageIdx !== was;
    });
    if (!crossed) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
if (h.errors.length) console.log('page errors:', h.errors.slice(0, 4));
await h.close();

let bad = 0;
for (const r of results) {
  const n = r.found.reduce((t, f) => t + f.points, 0);
  bad += n;
  console.log(`\n=== ${r.stage} — ${r.label} · ${r.solids} solids · ${r.sampled} points · ${n ? `${n} walk-through point(s)` : 'the floor is honest'}`);
  for (const f of r.found) {
    console.log(`   WALK-THROUGH  ${String(f.tag).padEnd(24)} ${f.type.padEnd(16)} size ${JSON.stringify(f.size).padEnd(20)} ` +
      `${String(f.points).padStart(3)} pts · first at ${JSON.stringify(f.at)} · in ${f.places.join(', ')}`);
    console.log(`                 points: ${JSON.stringify(f.sample)}`);
  }
}
console.log(bad ? `\n${bad} walk-through point(s) on the floor` : '\nevery wall on the floor is real');
process.exit(bad ? 1 : 0);
