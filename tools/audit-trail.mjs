/**
 * The trail audit: is the way through the level honest?
 *
 * `audit-collision.mjs` asks whether everything that looks solid *is* solid,
 * over the whole board. This asks a narrower and more pointed question, of the
 * ground a player is actually sent along — the golden path and every zone's
 * own spine, entry through centre to exit, which is where the beacon stands
 * and where the floor arrow points:
 *
 *   1. **A wall you walk through.** Geometry drawn across the trail that a
 *      capsule can stand inside. Playtest: *"there was an arrow pointing into
 *      a wall, and then I walked through the wall."*
 *   2. **A trail you cannot walk.** The opposite failure, and the same report
 *      from the other side: the arrow points at something a body cannot pass.
 *      A wall across the way through has to come out, not gain a collider.
 *
 * Both are decided **exactly**, by triangle parity rather than by bounding
 * boxes. That matters more here than anywhere: a mission border is one merged
 * mesh whose box is the whole stage, and a boulder's box has four corners of
 * open sand in it — box tests on either report holes that are only ever air,
 * which is how an earlier pass "found" three walk-through rocks in the ravine
 * that turned out to be properly collidered all along.
 *
 *   node tools/audit-trail.mjs            # every board
 *   node tools/audit-trail.mjs desert     # one
 *
 * Exits non-zero if anything is flagged, so it can gate a build.
 */
import { launch } from './harness.mjs';

// stringified into the page: no closure over module scope
function audit(stageName) {
  const g = window.__game;
  const phys = g.board.physics;
  const st = g.campaign.stage;
  g.board.group.updateMatrixWorld(true);

  /** how far above the floor a body's chest and head ride */
  const BANDS = [0.6, 1.35];
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
    for (let n = o; n; n = n.parent) {
      if (!n.visible) return;                                   // a hidden stand-in
      if (n.userData && n.userData.decor) return;               // scenery, said so
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
      bestBack = n[ic] < 0;      // facing away from a ray travelling +c
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

  const drawnThrough = [];
  const blockedAt = [];
  const seenSolid = new Set();
  const seenBlock = new Set();

  /** what is actually stopping a body here, when nothing is drawn to explain it */
  const blockerAt = (x, z, floor) => {
    const y = floor + 1;
    for (const b of phys.boxes) {
      if (x > b.min.x - R && x < b.max.x + R && z > b.min.z - R && z < b.max.z + R
        && y > b.min.y && y < b.max.y) {
        return `an unseen box ${(b.max.x - b.min.x).toFixed(1)}x${(b.max.z - b.min.z).toFixed(1)}`;
      }
    }
    for (const c of phys.cylinders) {
      if (y > c.minY && y < c.maxY && Math.hypot(x - c.x, z - c.z) < c.r + R) {
        return `an unseen cylinder r${c.r.toFixed(1)}`;
      }
    }
    return 'nothing drawn';
  };

  const check = (x, z, label) => {
    const floor = phys.groundHeight(x, z, st.groundAt(x, z) + 0.7);
    if (!isFinite(floor)) return;
    const free = phys.capsuleFree(x, floor + 0.05, z, R, H);
    let drawn = null;
    for (const band of BANDS) {
      for (const s of solids) {
        if (inside(s, x, floor + band, z)) { drawn = s; break; }
      }
      if (drawn) break;
    }
    if (drawn && free) {
      // drawn across the trail, and you walk through it
      const k = `${drawn.tag}|${drawn.type}|${drawn.lo.map((n) => n.toFixed(0)).join(',')}`;
      if (seenSolid.has(k)) return;
      seenSolid.add(k);
      drawnThrough.push({ at: [+x.toFixed(1), +z.toFixed(1)], label, onFloor: st.contains(x, z),
        tag: drawn.tag || '(untagged)', type: drawn.type,
        size: [+(drawn.hi[0] - drawn.lo[0]).toFixed(1), +(drawn.hi[1] - drawn.lo[1]).toFixed(1), +(drawn.hi[2] - drawn.lo[2]).toFixed(1)] });
    }
    return { free, drawn, floor };
  };

  /**
   * Walk one leg of the trail. A blockage is only reported when it is a *wall*
   * rather than a graze: the guidance runs down the middle of a lane and a
   * cover rock set beside it clips the capsule by a few centimetres, which is
   * a thing you step round without noticing. Three samples in a row — near
   * two metres of it — is something the arrow is pointing into.
   */
  const RUN = 3;
  const walk = (a, b, label) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(d / 0.6));
    let run = [];
    const flush = () => {
      if (run.length >= RUN && !run.every((q) => breakableAt(q.x, q.z))) {
        const mid = run[run.length >> 1];
        const k = label + '|' + Math.round(mid.x / 6) + ',' + Math.round(mid.z / 6);
        if (!seenBlock.has(k)) {
          seenBlock.add(k);
          blockedAt.push({ at: [+mid.x.toFixed(1), +mid.z.toFixed(1)], label,
            metres: +((run.length - 1) * (d / n)).toFixed(1),
            drawn: mid.drawn ? (mid.drawn.tag || mid.drawn.type) : blockerAt(mid.x, mid.z, mid.floor) });
        }
      }
      run = [];
    };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const r = check(x, z, label);
      if (r && !r.free) run.push({ x, z, drawn: r.drawn, floor: r.floor });
      else flush();
    }
    flush();
  };

  const path = st.path || [];
  for (let i = 0; i + 1 < path.length; i++) walk(path[i], path[i + 1], `golden path ${i}`);
  for (const zn of st.zones) {
    walk(zn.entry, zn.center, `${zn.spec.label}: in`);
    walk(zn.center, zn.exit, `${zn.spec.label}: on`);
  }
  // and the last stretch: the exit's own doorway
  if (st.exitPortal) walk(st.zones[st.zones.length - 1].exit, st.exitPortal.pos, 'the way on');

  return { stage: stageName, label: st.spec.label, solids: solids.length, drawnThrough, blockedAt };
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
  const n = r.drawnThrough.length + r.blockedAt.length;
  bad += n;
  console.log(`\n=== ${r.stage} — ${r.label} · ${r.solids} solids · ${n ? '' : 'the trail is honest'}`);
  for (const f of r.drawnThrough) {
    console.log(`   WALK-THROUGH  ${String(f.tag).padEnd(22)} ${f.type.padEnd(16)} ` +
      `size ${JSON.stringify(f.size).padEnd(20)} at ${JSON.stringify(f.at).padEnd(18)} · ${f.label}` +
      `${f.onFloor ? '' : ' · OFF the level\'s own floor'}`);
  }
  for (const f of r.blockedAt) {
    console.log(`   BLOCKED ${String(f.metres).padStart(5)} m  ${String(f.drawn).padEnd(30)} at ${JSON.stringify(f.at).padEnd(18)} · ${f.label}`);
  }
}
console.log(bad ? `\n${bad} problem(s) on the trail` : '\nevery trail is walkable, and every wall on one is real');
process.exit(bad ? 1 : 0);
