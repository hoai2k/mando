/**
 * The borders audit: does every mission area have an edge you can believe?
 *
 * `audit-trail.mjs` walks the line a player is *sent* along. This asks the
 * question of the whole room: standing in each zone and turning on the spot,
 * where does the world stop you, and does what you see agree with it?
 *
 * Two things are reported.
 *
 *   1. **Edges that lie.** For every bearing out of every zone, the distance
 *      at which a body is stopped (the physics) against the distance at which
 *      something is drawn (the geometry). They should be the same wall. Rock
 *      nearer than its collider is a wall you walk into and through; a
 *      collider nearer than any rock is a wall that is not there. Both are the
 *      class of bug this level design kept producing.
 *
 *   2. **What each area feels like.** How far the edge is, all round, is what
 *      makes a place read as open ground or as a corridor — and a design is
 *      only clear if that matches what the zone says it is. An `open` zone
 *      wants its walls far off or absent; a `hall` wants them close; a
 *      `canyon` wants them close across and far along. The table prints the
 *      near, median and far edge of every zone so the shape of the run can be
 *      read at a glance, and flags a zone whose walls contradict its shell.
 *
 * A `deck` is exempt from the second: its edge is the void, and stepping off
 * is the boundary. Water is the same kind of edge and is skipped likewise.
 *
 *   node tools/audit-borders.mjs            # every board
 *   node tools/audit-borders.mjs desert     # one
 *
 * Exits non-zero on an edge that lies. The shape report is information, not a
 * failure: it is there to be read.
 */
import { launch } from './harness.mjs';

function audit(stageName) {
  const g = window.__game;
  const st = g.campaign.stage;
  const phys = g.board.physics;
  g.board.group.updateMatrixWorld(true);

  const RAYS = 24;
  const MAX = 140;
  /** how far apart the two answers may be before the edge is lying */
  const TOL = 2.5;
  const EYE = 1.2;

  const xf = (e, x, y, z) => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];

  // ---- what is drawn, as world triangles ----
  //
  // The board's own group *and* every parked ride. A ride registers a solid
  // box with the physics but hangs its model off its own group, so walking
  // only the board reported each one as a collider with nothing drawn on it —
  // eight of those in the Tusken corral alone, which is a motor pool doing
  // exactly what it should.
  const solids = [];
  const roots = [g.board.group, ...g.vehicles.map((v) => v.group)];
  for (const root of roots) root.updateMatrixWorld(true);
  const collect = (o) => {
    if (!o.isMesh || o.isPoints || o.isLine || o.isSprite) return;
    for (let n = o; n; n = n.parent) {
      if (!n.visible) return;
      if (n.userData && n.userData.decor) return;
      if (n.userData && n.userData.gateShut === false) return;
    }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.isShaderMaterial) return;
    if (m.isMeshBasicMaterial && m.transparent) return;
    const geo = o.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return;
    if (geo.type === 'PlaneGeometry') return;          // the ground, not a wall
    const pos = geo.attributes.position;
    const idx = geo.index;
    const count = idx ? idx.count : pos.count;
    // A cap only to keep one pathological mesh from stalling the audit. It
    // used to be low enough to drop the territory's own mesas, which are
    // drawn and solid and exactly the kind of edge this is about — they came
    // back as "stopped at eighty metres, nothing drawn".
    if (count > 1200000) return;
    const e = o.matrixWorld.elements;
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
    solids.push({ tris, lo, hi });
  };
  for (const root of roots) root.traverse(collect);

  /** nearest drawn surface along a ray (Möller–Trumbore), or Infinity */
  const meshDist = (ox, oy, oz, dx, dy, dz, max) => {
    let best = max;
    for (const s of solids) {
      // slab test against the mesh's box first
      let t0 = 0, t1 = best;
      for (let k = 0; k < 3; k++) {
        const o = [ox, oy, oz][k], d = [dx, dy, dz][k];
        if (Math.abs(d) < 1e-9) { if (o < s.lo[k] || o > s.hi[k]) { t0 = 1; t1 = 0; break; } continue; }
        let a = (s.lo[k] - o) / d, b = (s.hi[k] - o) / d;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
      }
      if (t0 > t1) continue;
      const t = s.tris;
      for (let i = 0; i < t.length; i += 9) {
        const ax = t[i], ay = t[i + 1], az = t[i + 2];
        const e1x = t[i + 3] - ax, e1y = t[i + 4] - ay, e1z = t[i + 5] - az;
        const e2x = t[i + 6] - ax, e2y = t[i + 7] - ay, e2z = t[i + 8] - az;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-10) continue;
        const inv = 1 / det;
        const tx = ox - ax, ty = oy - ay, tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (hit > 0.05 && hit < best) best = hit;
      }
    }
    return best;
  };

  // `PhysicsWorld.raycast` clones its arguments, so it wants real vectors.
  // THREE is not a global in the built bundle; borrow two from something that
  // already has them and re-set them each cast.
  const _o = g.players[0].position.clone();
  const _d = g.players[0].position.clone();

  const zones = [];
  const lies = [];
  for (const zn of st.zones) {
    const floor = phys.groundHeight(zn.center.x, zn.center.z, st.groundAt(zn.center.x, zn.center.z) + 0.7);
    if (!isFinite(floor)) continue;
    const oy = floor + EYE;
    const edges = [];
    let openDirs = 0;
    for (let i = 0; i < RAYS; i++) {
      const th = (i / RAYS) * Math.PI * 2;
      const dx = Math.sin(th), dz = Math.cos(th);
      _o.set(zn.center.x, oy, zn.center.z);
      _d.set(dx, 0, dz);
      // Boxes and cylinders only. `raycast` also marches the heightfield, and
      // the territory's own terrain is drawn as a ground plane this audit
      // skips — so every dune came back as "a collider with no rock on it",
      // which is the terrain being terrain. Excluding it from both sides keeps
      // the two answers measuring the same things.
      const solid = phys.raycastSolids ? phys.raycastSolids(_o, _d, MAX) : null;
      const dPhys = solid ? solid.dist : Infinity;
      const dMesh = meshDist(zn.center.x, oy, zn.center.z, dx, 0, dz, MAX);
      const edge = Math.min(dPhys, dMesh);
      if (edge >= MAX) { openDirs++; continue; }
      edges.push(edge);
      if (Math.abs(dPhys - dMesh) > TOL) {
        lies.push({
          zone: zn.spec.label, shell: zn.spec.shell,
          bearing: Math.round((th * 180) / Math.PI),
          stopped: dPhys >= MAX ? null : +dPhys.toFixed(1),
          drawn: dMesh >= MAX ? null : +dMesh.toFixed(1),
          kind: dMesh < dPhys ? 'rock before its collider' : 'a collider before any rock',
        });
      }
    }
    edges.sort((a, b) => a - b);
    const med = edges.length ? edges[edges.length >> 1] : Infinity;
    zones.push({
      label: zn.spec.label, shell: zn.spec.shell, kind: zn.spec.kind,
      w: zn.spec.w, l: zn.spec.l,
      near: edges.length ? +edges[0].toFixed(1) : null,
      median: isFinite(med) ? +med.toFixed(1) : null,
      far: edges.length ? +edges[edges.length - 1].toFixed(1) : null,
      openDirs,
    });
  }
  return { stage: stageName, label: st.spec.label, solids: solids.length, zones, lies };
}

const BOARDS = ['desert', 'station', 'nevarro', 'crevasse', 'trask', 'refinery', 'forge', 'ringworld', 'narkina'];
const only = process.argv[2];
const h = await launch();
const { page } = h;
page.on('pageerror', (e) => console.log(`  PAGE ERROR: ${String(e).slice(0, 200)}`));
await h.waitForText(/PRESS START|WAVE BATTLE/i);

const OPEN_STAGE = () => {
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
};

const results = [];
for (const board of (only ? [only] : BOARDS)) {
  await page.evaluate(([b]) => {
    window.__manual = false;
    window.__quitToTitle?.();
    window.__startMode('campaign', 1, b, ['din']);
  }, [board]);
  try {
    await page.waitForFunction(() => window.__state === 'playing', null, { timeout: 120000 });
  } catch { console.log(`\n=== ${board} — did not reach play`); continue; }
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
    await page.evaluate(OPEN_STAGE);
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
      const was = c.stageIdx, portal = c.stage.exitPortal;
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

/** what a shell says the space should feel like, in metres to the nearest wall */
const WANT = {
  hall: { max: 22, note: 'a room' },
  canyon: { max: 30, note: 'a lane' },
  // a road is a lane you ride down, not a corridor: its sides can be far off
  road: { max: 60, note: 'a lane' },
  open: { min: 18, note: 'open ground' },
  deck: null,
};

let lies = 0;
let muddled = 0;
for (const r of results) {
  console.log(`\n=== ${r.stage} — ${r.label} · ${r.solids} solids`);
  for (const z of r.zones) {
    const want = WANT[z.shell];
    let verdict = '';
    if (want) {
      if (want.max !== undefined && z.median !== null && z.median > want.max) {
        verdict = `  ← reads open, but it is a ${z.shell}`;
        muddled++;
      } else if (want.min !== undefined && z.median !== null && z.median < want.min && z.openDirs === 0) {
        verdict = `  ← reads closed in, but it is ${want.note}`;
        muddled++;
      }
    }
    console.log(`   ${String(z.shell).padEnd(7)} ${String(z.kind).padEnd(11)} ${z.label.padEnd(24)} ` +
      `${String(z.w).padStart(3)}x${String(z.l).padStart(3)} m · edge near ${String(z.near ?? '—').padStart(6)} ` +
      `median ${String(z.median ?? '—').padStart(6)} far ${String(z.far ?? '—').padStart(6)} ` +
      `· ${String(z.openDirs).padStart(2)}/24 open${verdict}`);
  }
  for (const l of r.lies) {
    lies++;
    console.log(`   EDGE LIES  ${l.zone} (${l.shell}) at ${String(l.bearing).padStart(3)}° — ` +
      `stopped at ${l.stopped ?? 'never'}, drawn at ${l.drawn ?? 'nothing'} · ${l.kind}`);
  }
}
console.log(lies
  ? `\n${lies} edge(s) where what stops you and what you see disagree`
  : '\nevery edge stops you where it looks like it should');
if (muddled) console.log(`${muddled} zone(s) whose walls read differently from the shell they declare`);
process.exit(lies ? 1 : 0);
