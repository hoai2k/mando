/**
 * Skinning audit: find skin weights that leak across limb chains, and write
 * the fixes the game applies at load.
 *
 * Every humanoid .glb is a Rigify export skinned with automatic weights, and
 * automatic weights only know distance: a skirt panel hanging beside a
 * resting hand picks up hand weight, a helmet cheek picks up shoulder weight,
 * a gauntlet resting against a thigh picks up thigh weight. None of it shows
 * in the rest pose — every bone is at bind, so nothing moves — and all of it
 * shows the moment a clip swings the limb: the skirt lifts with the arm.
 *
 * Method, per model:
 *   1. Weld the mesh by position and build its edge graph.
 *   2. Label every vertex with the *region* it belongs to — lower body, left
 *      arm, right arm, torso, head — by geodesic distance over the mesh from
 *      the vertices that are unambiguously in each region (≥ 90 % of their
 *      weight there). Geodesic, not Euclidean: the skirt hem is a hand's
 *      breadth from the hand in space, but half a body away along the mesh.
 *   3. Any weight on a bone outside the vertex's region is a leak, unless the
 *      pairing is a normal blend (abdomen ↔ chest, neck ↔ chest). Its cost is
 *      how far the vertex would be dragged by a one-radian swing of the
 *      offending chain — weight × lever from the chain's pivot — in cm.
 *   4. Leaks above the visibility floor are grouped into fixes: "the left arm
 *      drives lower-body vertices", and so on. A fix zeroes the foreign
 *      weights and renormalises what is left; a vertex left with nothing
 *      borrows the weights of its nearest region-certain neighbour.
 *
 * Fixes in the classes that are always wrong (arm ↔ lower body, arm ↔ head,
 * arm ↔ other arm) on vertices whose region is unambiguous ship as `applied`;
 * everything else — chest plates driven by an arm, cowls driven by the neck,
 * ambiguous vertices, borrowed weights — ships `pending` for review in the
 * workbench (`/workbench/?skin=1`).
 *
 * Usage: node tools/skin-audit.mjs [id ...]        (default: every humanoid)
 *        writes public/models/skinfix/<id>.json and skinfix/index.json,
 *        keeping any approve / discard decision already recorded in them.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readGlb } from './lib/glb.mjs';

const MODELS = 'public/models';
const OUT = `${MODELS}/skinfix`;

/** metres each model stands at in game (MODEL_HEIGHT / AUTHORED_ENEMY) */
const HEIGHT = {
  din: 1.85, paz: 1.67, bokatan: 1.75, armorer: 1.78, ventress: 1.79, embo: 1.78,
  bossk: 1.9, ig11: 2.2, duelist: 1.9, droid: 2.1, deathtrooper: 2.0, darktrooper: 2.2,
  pirate: 1.9, pirate_melee: 1.9, marshal: 1.85, fennec: 1.8, imperial_officer: 1.88,
  tusken: 1.8, pyke: 2.0, stormtrooper: 1.9, pyke_capo: 2.05, wookiee_enforcer: 2.6,
  nikto: 1.76, flametrooper: 1.9, quarren: 1.9, alamite: 1.85, ring_enforcer: 2.1,
};

// ---------- bone classification ----------
const strip = (n) => n.replace(/^DEF-/, '');
export function groupOf(name) {
  const n = strip(name);
  if (/^(upper_arm|forearm|hand)\.L/.test(n)) return 'armL';
  if (/^(upper_arm|forearm|hand)\.R/.test(n)) return 'armR';
  if (/^shoulder\.L/.test(n)) return 'shoulderL';
  if (/^shoulder\.R/.test(n)) return 'shoulderR';
  if (/^(thigh|shin|foot|toe)\.L/.test(n)) return 'legL';
  if (/^(thigh|shin|foot|toe)\.R/.test(n)) return 'legR';
  if (/^pelvis/.test(n)) return 'pelvis';
  if (n === 'spine') return 'hips';
  if (/^spine\.00[12]$/.test(n)) return 'abdomen';
  if (/^spine\.00[34]$/.test(n)) return 'chest';
  if (n === 'spine.005') return 'neck';
  if (n === 'spine.006') return 'head';
  return 'other';
}
const REGION_OF_GROUP = {
  armL: 'armL', armR: 'armR', legL: 'lower', legR: 'lower', pelvis: 'lower', hips: 'lower',
  abdomen: 'lower', chest: 'torso', shoulderL: 'torso', shoulderR: 'torso', neck: 'head', head: 'head',
  other: 'other',
};
export const regionOf = (name) => REGION_OF_GROUP[groupOf(name)];
const REGIONS = ['lower', 'armL', 'armR', 'torso', 'head'];

/** the joint a chain pivots on, per group: what a leak's lever is measured from */
const PIVOT_BONE = {
  armL: 'upper_arm.L', armR: 'upper_arm.R', legL: 'thigh.L', legR: 'thigh.R',
  hips: 'spine', abdomen: 'spine', chest: 'spine.003', neck: 'spine.005', head: 'spine.005',
  shoulderL: 'shoulder.L', shoulderR: 'shoulder.R',
};
/** radians of swing a group sees in ordinary play, scaling the lever */
const SWING = {
  armL: 1, armR: 1, legL: 1, legR: 1, pelvis: 0.4, hips: 0.4, abdomen: 0.4, chest: 0.4,
  shoulderL: 0.2, shoulderR: 0.2, neck: 0.8, head: 0.8,
};

/**
 * Leak classes: what the vertex's own region is, what is driving it, and
 * whether that is always wrong (`high`) or sometimes a deliberate blend
 * (`review`). Pairs not listed are normal blends and left alone.
 */
const CLASSES = {
  'lower<armL': { kind: 'arm-drives-lower', confidence: 'high' },
  'lower<armR': { kind: 'arm-drives-lower', confidence: 'high' },
  'armL<lower': { kind: 'lower-drives-arm', confidence: 'high' },
  'armR<lower': { kind: 'lower-drives-arm', confidence: 'high' },
  'head<armL': { kind: 'arm-drives-head', confidence: 'high' },
  'head<armR': { kind: 'arm-drives-head', confidence: 'high' },
  'armL<armR': { kind: 'arm-drives-other-arm', confidence: 'high' },
  'armR<armL': { kind: 'arm-drives-other-arm', confidence: 'high' },
  'lower<head': { kind: 'head-drives-lower', confidence: 'high' },
  'head<lower': { kind: 'lower-drives-head', confidence: 'high' },
  'torso<armL': { kind: 'arm-drives-torso', confidence: 'review' },
  'torso<armR': { kind: 'arm-drives-torso', confidence: 'review' },
  'armL<torso': { kind: 'torso-drives-arm', confidence: 'review' },
  'armR<torso': { kind: 'torso-drives-arm', confidence: 'review' },
  'torso<head': { kind: 'head-drives-torso', confidence: 'review' },
  'head<torso': { kind: 'torso-drives-head', confidence: 'review' },
};
const TITLES = {
  'arm-drives-lower': 'Lower body follows the {side} arm',
  'lower-drives-arm': '{side} arm follows the legs / hips',
  'arm-drives-head': 'Head follows the {side} arm',
  'arm-drives-other-arm': '{side} arm follows the other arm',
  'head-drives-lower': 'Lower body follows the head',
  'lower-drives-head': 'Head follows the legs / hips',
  'arm-drives-torso': 'Torso follows the {side} arm',
  'torso-drives-arm': '{side} arm follows the torso',
  'head-drives-torso': 'Torso follows the head / neck',
  'torso-drives-head': 'Head follows the chest',
};

/** below this drag (cm at one radian of swing) a leak is invisible in play */
const FLOOR_CM = 1.5;
/** geodesic distance ratio under which a vertex's region is called ambiguous */
const AMBIGUOUS = 1.6;

// ---------- geometry helpers ----------
class Heap {
  constructor() { this.a = []; }
  push(d, i) {
    const a = this.a; a.push([d, i]);
    let k = a.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (a[p][0] <= a[k][0]) break; [a[p], a[k]] = [a[k], a[p]]; k = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; k = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

function weld(prim) {
  const key = new Map();
  const point = new Int32Array(prim.count);
  const px = [], py = [], pz = [];
  for (let i = 0; i < prim.count; i++) {
    const x = prim.positions[i * 3], y = prim.positions[i * 3 + 1], z = prim.positions[i * 3 + 2];
    const k = `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
    let p = key.get(k);
    if (p === undefined) { p = px.length; key.set(k, p); px.push(x); py.push(y); pz.push(z); }
    point[i] = p;
  }
  const n = px.length;
  const adj = Array.from({ length: n }, () => []);
  const seen = new Set();
  const idx = prim.indices ?? Array.from({ length: prim.count }, (_, i) => i);
  const link = (a, b) => {
    if (a === b) return;
    const k = a < b ? a * n + b : b * n + a;
    if (seen.has(k)) return;
    seen.add(k);
    const d = Math.hypot(px[a] - px[b], py[a] - py[b], pz[a] - pz[b]);
    adj[a].push(b, d); adj[b].push(a, d);
  };
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = point[idx[t]], b = point[idx[t + 1]], c = point[idx[t + 2]];
    link(a, b); link(b, c); link(c, a);
  }
  return { point, n, adj, px, py, pz };
}

/** multi-source Dijkstra: distance from the nearest seed, and which seed */
function geodesic(mesh, seeds) {
  const dist = new Float64Array(mesh.n).fill(Infinity);
  const from = new Int32Array(mesh.n).fill(-1);
  const heap = new Heap();
  for (const s of seeds) { dist[s] = 0; from[s] = s; heap.push(0, s); }
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const a = mesh.adj[i];
    for (let k = 0; k < a.length; k += 2) {
      const j = a[k], nd = d + a[k + 1];
      if (nd < dist[j]) { dist[j] = nd; from[j] = from[i]; heap.push(nd, j); }
    }
  }
  return { dist, from };
}

// ---------- the audit ----------
export async function auditModel(id) {
  const glb = await readGlb(`${MODELS}/${id}.glb`);
  const { primitives, world } = glb.skinnedPrimitives();
  const humanoid = primitives.filter((p) => p.jointNames.some((n) => /hand\.L/.test(n)) && p.jointNames.some((n) => /thigh\.L/.test(n)));
  if (!humanoid.length) return null;
  const height = HEIGHT[id] ?? 1.85;
  const fixes = [];
  const summary = { id, verts: 0, leaks: {} };

  for (const prim of humanoid) {
    summary.verts += prim.count;
    const J = prim.jointNames.map(strip);
    const jointGroup = J.map(groupOf);
    const jointRegion = jointGroup.map((g) => REGION_OF_GROUP[g]);
    // pivot position of each joint's chain, in model units
    const headOf = (name) => {
      const k = J.indexOf(name);
      if (k < 0) return null;
      const e = world[prim.skinJoints[k]].elements;
      return [e[12], e[13], e[14]];
    };
    const pivot = jointGroup.map((g, k) => headOf(PIVOT_BONE[g] ?? J[k]) ?? headOf(J[k]));
    // model units -> metres: the sculpt is fitted to `height` by its Y extent
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < prim.count; i++) { const y = prim.positions[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const metres = height / (maxY - minY);

    const mesh = weld(prim);
    // region weight sums per welded point (first vertex of the point speaks for it)
    const regionSum = (i) => {
      const s = { lower: 0, armL: 0, armR: 0, torso: 0, head: 0, other: 0 };
      for (let k = 0; k < 4; k++) {
        const w = prim.weights[i * 4 + k];
        if (w > 0) s[jointRegion[prim.joints[i * 4 + k]]] += w;
      }
      return s;
    };
    const seeds = Object.fromEntries(REGIONS.map((r) => [r, []]));
    const pointSeen = new Uint8Array(mesh.n);
    for (let i = 0; i < prim.count; i++) {
      const p = mesh.point[i];
      if (pointSeen[p]) continue;
      pointSeen[p] = 1;
      const s = regionSum(i);
      for (const r of REGIONS) if (s[r] >= 0.9) seeds[r].push(p);
    }
    const geo = Object.fromEntries(REGIONS.map((r) => [r, geodesic(mesh, seeds[r])]));

    // a representative vertex index for each welded point, for donor weights
    const pointVertex = new Int32Array(mesh.n).fill(-1);
    for (let i = 0; i < prim.count; i++) if (pointVertex[mesh.point[i]] < 0) pointVertex[mesh.point[i]] = i;

    /** per (label<foreign) class: vertices and their details */
    const buckets = new Map();
    for (let i = 0; i < prim.count; i++) {
      const p = mesh.point[i];
      // label by geodesic distance; fall back to the dominant region on an
      // unreachable shell (a detached prop with no certain vertex of its own)
      let best = null, d1 = Infinity, d2 = Infinity;
      for (const r of REGIONS) {
        const d = geo[r].dist[p];
        if (d < d1) { d2 = d1; d1 = d; best = r; } else if (d < d2) d2 = d;
      }
      let ambiguous = false;
      if (!best || d1 === Infinity) {
        const s = regionSum(i);
        best = REGIONS.reduce((a, r) => (s[r] > s[a] ? r : a), 'lower');
        ambiguous = true;
      } else if (d2 < d1 * AMBIGUOUS) ambiguous = true;

      // foreign weight per region, with the drag it would cause
      const foreign = {};
      for (let k = 0; k < 4; k++) {
        const w = prim.weights[i * 4 + k];
        if (w <= 0) continue;
        const j = prim.joints[i * 4 + k];
        const r = jointRegion[j];
        if (r === best || r === 'other') continue;
        const cls = CLASSES[`${best}<${r}`];
        if (!cls) continue;
        const pv = pivot[j];
        const lever = Math.hypot(prim.positions[i * 3] - pv[0], prim.positions[i * 3 + 1] - pv[1], prim.positions[i * 3 + 2] - pv[2]);
        const f = (foreign[r] ??= { weight: 0, dragCm: 0, joints: new Set() });
        f.weight += w;
        f.dragCm += w * lever * metres * 100 * (SWING[jointGroup[j]] ?? 1);
        f.joints.add(J[j]);
      }
      for (const [r, f] of Object.entries(foreign)) {
        if (f.dragCm < FLOOR_CM) continue;
        const cls = CLASSES[`${best}<${r}`];
        // what is left once the foreign weights go — nothing means a donor
        let remaining = 0;
        for (let k = 0; k < 4; k++) {
          const w = prim.weights[i * 4 + k];
          if (w > 0 && jointRegion[prim.joints[i * 4 + k]] !== r) remaining += w;
        }
        let donor = null;
        if (remaining < 0.02) {
          const src = geo[best].from[p];
          const dv = src >= 0 ? pointVertex[src] : -1;
          if (dv >= 0) {
            donor = { joints: [], weights: [] };
            for (let k = 0; k < 4; k++) {
              const w = prim.weights[dv * 4 + k];
              if (w > 0) { donor.joints.push(prim.joints[dv * 4 + k]); donor.weights.push(w); }
            }
          }
        }
        const review = cls.confidence === 'review' || ambiguous || !!donor || remaining < 0.02;
        const key = `${cls.kind}|${r}|${best}|${review ? 'review' : 'high'}`;
        const b = buckets.get(key) ?? { kind: cls.kind, foreign: r, label: best, review, verts: [], joints: new Set(), maxDrag: 0, sumDrag: 0, sumWeight: 0, donors: {} };
        b.verts.push(i);
        for (const jn of f.joints) b.joints.add(jn);
        b.maxDrag = Math.max(b.maxDrag, f.dragCm);
        b.sumDrag += f.dragCm;
        b.sumWeight += f.weight;
        if (donor) b.donors[i] = donor;
        buckets.set(key, b);
      }
    }

    for (const b of buckets.values()) {
      const side = b.foreign === 'armL' ? 'Left' : b.foreign === 'armR' ? 'Right' : b.label === 'armL' ? 'Left' : b.label === 'armR' ? 'Right' : '';
      // where on the body the affected vertices sit, as fractions of height
      let lo = Infinity, hi = -Infinity;
      for (const i of b.verts) { const y = (prim.positions[i * 3 + 1] - minY) / (maxY - minY); if (y < lo) lo = y; if (y > hi) hi = y; }
      const title = TITLES[b.kind].replace('{side}', side).replace(/^\s/, '');
      const fixId = `${id}/${b.kind}${side ? '/' + side.toLowerCase() : ''}${b.review ? '/review' : ''}`;
      fixes.push({
        id: fixId,
        kind: b.kind,
        title: title.charAt(0).toUpperCase() + title.slice(1),
        confidence: b.review ? 'review' : 'high',
        status: b.review ? 'pending' : 'applied',
        region: b.label,
        foreign: b.foreign,
        stats: {
          vertices: b.verts.length,
          maxDragCm: +b.maxDrag.toFixed(1),
          meanDragCm: +(b.sumDrag / b.verts.length).toFixed(1),
          meanForeignWeight: +(b.sumWeight / b.verts.length).toFixed(2),
          heightBand: [+lo.toFixed(2), +hi.toFixed(2)],
          donors: Object.keys(b.donors).length,
        },
        removeBones: [...b.joints].sort(),
        mesh: { node: prim.nodeIndex, primitive: prim.primIndex, vertexCount: prim.count },
        vertices: b.verts,
        donors: b.donors,
      });
      summary.leaks[fixId] = b.verts.length;
    }
  }
  fixes.sort((a, b) => b.stats.vertices - a.stats.vertices);
  return { id, height, fixes, summary };
}

// ---------- main ----------
const humanoidIds = () => readdirSync(MODELS)
  .filter((f) => f.endsWith('.glb'))
  .map((f) => f.slice(0, -4));

if (process.argv[1] && /skin-audit\.mjs$/.test(process.argv[1])) {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : humanoidIds();
  mkdirSync(OUT, { recursive: true });
  const index = [];
  const rows = [];
  for (const id of ids) {
    const result = await auditModel(id);
    if (!result) continue;
    const path = `${OUT}/${id}.json`;
    // a decision already taken in the workbench survives a re-run
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
    const decided = new Map((previous?.fixes ?? []).filter((f) => f.decision).map((f) => [f.id, f]));
    for (const f of result.fixes) {
      const d = decided.get(f.id);
      if (d) { f.decision = d.decision; f.status = d.decision === 'approve' ? 'applied' : 'discarded'; }
    }
    const doc = {
      format: 'mando-skinfix/1',
      model: id,
      heightM: result.height,
      generatedAt: new Date().toISOString(),
      howToRead: [
        'Each fix names the vertices of one skinned primitive whose weights leak across limb chains.',
        'Applying it drops the weight on `removeBones` from those vertices and renormalises the rest;',
        'a vertex in `donors` had nothing left, and takes the weights listed for it instead.',
        'status: applied = the game uses it; pending = shown in the workbench for review; discarded = never used.',
      ],
      fixes: result.fixes,
    };
    writeFileSync(path, JSON.stringify(doc));
    if (result.fixes.length) index.push(id);
    for (const f of result.fixes) rows.push([id, f.kind, f.foreign, f.confidence, f.status, f.stats.vertices, f.stats.maxDragCm, f.stats.meanDragCm, f.stats.donors]);
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify({ format: 'mando-skinfix-index/1', models: index }));
  console.log('| model | leak | driver | confidence | status | verts | max drag cm | mean drag cm | donors |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
}
