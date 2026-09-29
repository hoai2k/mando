/**
 * Geometric joint estimation: where a character's joints are, from its
 * volume alone — no bones, no skin weights. See geo-joints.mjs for the
 * method as a whole; this module is the arithmetic, on a bind-pose triangle
 * soup in the game frame (metres, x = the character's left, y up, z forward,
 * feet on y = 0).
 */
import { voxelize, depth, open, components, geodesic } from './geo-core.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r4 = (a) => a.map((x) => Math.round(x * 1e4) / 1e4);
export const vec = { sub, add, mul, dot, len, norm, cross, lerp };

// ------------------------------------------------------------------ slices
/** 2-D components (8-connected) of horizontal slice j of a mask */
function sliceComponents(g, mask, j) {
  const [NX, , NZ] = g.n;
  const lab = new Int32Array(NX * NZ);
  const comps = [];
  const st = [];
  for (let k0 = 0; k0 < NZ; k0++) for (let i0 = 0; i0 < NX; i0++) {
    if (!mask[g.idx(i0, j, k0)] || lab[i0 + k0 * NX]) continue;
    const c = { id: comps.length + 1, n: 0, sx: 0, sz: 0, minx: Infinity, maxx: -Infinity, cells: [] };
    lab[i0 + k0 * NX] = c.id; st.push(i0 + k0 * NX);
    while (st.length) {
      const q = st.pop();
      const i = q % NX, k = (q - i) / NX;
      c.n++; c.cells.push(q);
      const x = g.o[0] + i * g.h;
      c.sx += x; c.sz += g.o[2] + k * g.h; c.minx = Math.min(c.minx, x); c.maxx = Math.max(c.maxx, x);
      for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = k + dk;
        if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
        const w = a + b * NX;
        if (!lab[w] && mask[g.idx(a, j, b)]) { lab[w] = c.id; st.push(w); }
      }
    }
    c.cx = c.sx / c.n; c.cz = c.sz / c.n; c.area = c.n * g.h * g.h;
    comps.push(c);
  }
  return { lab, comps };
}

/** the component of a slice that most overlaps the given cells (from the neighbouring slice) */
function follow(sl, cells) {
  const votes = new Map();
  for (const q of cells) { const l = sl.lab[q]; if (l) votes.set(l, (votes.get(l) ?? 0) + 1); }
  let id = 0, n = 0;
  for (const [l, c] of votes) if (c > n) { n = c; id = l; }
  return id ? sl.comps[id - 1] : null;
}

/**
 * The crotch: going up from shin height, follow the two legs' slice
 * components until they join into one.
 */
function findCrotch(g, mask, H) {
  const jTop = Math.round((0.7 * H - g.o[1]) / g.h);
  // start at shin height; under a closed coat or robe the legs only part below its hem, so look lower
  let j0 = -1, L = null, R = null;
  for (const f of [0.2, 0.16, 0.12, 0.09, 0.06]) {
    j0 = Math.round((f * H - g.o[1]) / g.h);
    const big = sliceComponents(g, mask, j0).comps.filter((c) => c.area > 0.002);
    L = big.filter((c) => c.cx > 0 && c.minx > -0.01).sort((a, b) => b.n - a.n)[0];
    R = big.filter((c) => c.cx < 0 && c.maxx < 0.01).sort((a, b) => b.n - a.n)[0];
    if (L && R) break;
  }
  if (!L || !R) return null;
  let pL = L.cells, pR = R.cells;
  for (let j = j0 + 1; j <= jTop; j++) {
    const sl = sliceComponents(g, mask, j);
    const nL = follow(sl, pL), nR = follow(sl, pR);
    if (!nL || !nR) return null;
    // joined below 0.4 H: that is a closed coat's or robe's hem, not the crotch
    if (nL === nR) return { y: g.o[1] + j * g.h, j, j0, L, R, hem: g.o[1] + j * g.h < 0.4 * H };
    pL = nL.cells; pR = nR.cells;
  }
  return null;
}

/**
 * The arms, by horizontal slices: find a height where each arm is its own
 * slice component beside the torso, then follow it up until it joins the
 * torso (the armpit) and down to the end of the hand. Above the armpit the
 * arm is cut from the torso by the vertical plane through the arm's inner
 * edge at the armpit. Returns per-side voxel masks and the armpit.
 */
function findArms(g, O, solid, crotch, H, legMask) {
  const out = {};
  // (above a closed coat's hem, not from the hem itself)
  const jc = Math.max(crotch.j, Math.round((0.44 * H - g.o[1]) / g.h));
  const jMax = Math.round((0.8 * H - g.o[1]) / g.h);
  let start = null;
  for (let j = jc + 2; j < jMax && !start; j++) {
    const sl = sliceComponents(g, O, j);
    const torso = sl.comps.filter((c) => c.minx < 0 && c.maxx > 0).sort((a, b) => b.n - a.n)[0];
    if (!torso) continue;
    const L = sl.comps.filter((c) => c.minx > torso.maxx && c.area > 0.0015).sort((a, b) => b.n - a.n)[0];
    const R = sl.comps.filter((c) => c.maxx < torso.minx && c.area > 0.0015).sort((a, b) => b.n - a.n)[0];
    if (L && R) start = { j, L, R };
  }
  if (!start) return null;
  const [NX] = g.n;
  for (const [side, comp] of [[1, start.L], [-1, start.R]]) {
    const key = side > 0 ? 'L' : 'R';
    const mask = new Uint8Array(g.size);
    const put = (j, cells) => { for (const q of cells) { const i = q % NX, k = (q - i) / NX; mask[g.idx(i, j, k)] = 1; } };
    put(start.j, comp.cells);
    // up to the armpit
    let prev = comp.cells, ja = start.j, inner = side > 0 ? comp.minx : comp.maxx;
    for (let j = start.j + 1; j < g.n[1]; j++) {
      const sl = sliceComponents(g, O, j);
      const c = follow(sl, prev);
      if (!c) break;
      if (c.minx < 0 && c.maxx > 0) { ja = j; break; }
      put(j, c.cells); prev = c.cells; ja = j + 1;
      inner = side > 0 ? c.minx : c.maxx;
    }
    // down to the hand's end (stopping if it meets a leg)
    prev = comp.cells;
    let jEnd = start.j;
    for (let j = start.j - 1; j > 0; j--) {
      const sl = sliceComponents(g, O, j);
      const c = follow(sl, prev);
      if (!c) break;
      let leg = 0;
      for (const q of c.cells) { const i = q % NX, k = (q - i) / NX; if (legMask[g.idx(i, j, k)]) leg++; }
      if (leg > c.n * 0.2 || (c.minx < 0 && c.maxx > 0)) break;
      put(j, c.cells); prev = c.cells; jEnd = j;
    }
    // the opening took the fingers off: follow the full solid on down to the fingertips
    let tip = null;
    {
      let p2 = prev, area = Infinity;
      for (let j = jEnd - 1; j > 0; j--) {
        const sl = sliceComponents(g, solid, j);
        const c = follow(sl, p2);
        if (!c || c.area > area * 1.8 || (c.minx < 0 && c.maxx > 0)) break;
        let leg = 0;
        for (const q of c.cells) { const i = q % NX, k = (q - i) / NX; if (legMask[g.idx(i, j, k)]) leg++; }
        if (leg > c.n * 0.2) break;
        tip = [c.cx, g.o[1] + j * g.h, c.cz];
        area = Math.max(c.area, 0.0004); p2 = c.cells;
      }
    }
    // above the armpit: everything outboard of the arm's inner edge there
    const xCut = inner + side * g.h;
    let jTop = ja;
    for (let j = ja; j < g.n[1]; j++) {
      let any = false;
      for (let k = 0; k < g.n[2]; k++) for (let i = 0; i < NX; i++) {
        const v = g.idx(i, j, k);
        if (!O[v]) continue;
        const x = g.o[0] + i * g.h;
        if (side * (x - xCut) > 0) { mask[v] = 1; any = true; }
      }
      if (!any) break;
      jTop = j;
    }
    // keep the part connected to the arm proper
    const { lab, sizes } = components(g, mask);
    let bestL = 0;
    const seedV = g.idx(...(() => { const q = comp.cells[0]; const i = q % NX; return [i, start.j, (q - i) / NX]; })());
    bestL = lab[seedV];
    for (let v = 0; v < g.size; v++) if (mask[v] && lab[v] !== bestL) mask[v] = 0;
    out[key] = { mask, armpitY: g.o[1] + ja * g.h, xCut, endY: g.o[1] + jEnd * g.h, tip, topY: g.o[1] + jTop * g.h, startJ: start.j, n: sizes[bestL] };
  }
  return out;
}

// ------------------------------------------------------------------ profiles
/**
 * A limb's centre line and volume profile. The limb's voxels are ordered by
 * geodesic distance from `seeds`; each 1-voxel band gives a first centre
 * point, the line is smoothed, and then the limb is cut square to that line
 * at every station: the cut's centroid is the centre line proper, and its
 * area, principal widths and extents are the profile.
 */
function limbProfile(g, mask, seeds, dep) {
  const dist = geodesic(g, mask, seeds);
  const members = [];
  const sums = [];
  for (let v = 0; v < g.size; v++) {
    const d = dist[v];
    if (!Number.isFinite(d)) continue;
    const b = Math.floor(d);
    if (!members[b]) { members[b] = []; sums[b] = [0, 0, 0]; }
    members[b].push(v); sums[b] = add(sums[b], g.pos(v));
  }
  const raw = [];
  for (let b = 0; b < members.length; b++) raw.push(members[b]?.length >= 2 ? mul(sums[b], 1 / members[b].length) : null);
  for (let b = 0; b < raw.length; b++) if (!raw[b]) raw[b] = raw[b - 1] ?? raw.find(Boolean);
  const sm = raw.map((_, b) => {
    let s = [0, 0, 0], n = 0;
    for (let k = Math.max(0, b - 3); k <= Math.min(raw.length - 1, b + 3); k++) { s = add(s, raw[k]); n++; }
    return mul(s, 1 / n);
  });
  const stations = [];
  for (let b = 0; b < sm.length; b++) {
    const t = norm(sub(sm[Math.min(sm.length - 1, b + 3)], sm[Math.max(0, b - 3)]));
    const c0 = sm[b];
    const pts = [], dd = [];
    for (let k = Math.max(0, b - 10); k <= Math.min(members.length - 1, b + 10); k++) {
      for (const v of members[k] ?? []) {
        const p = g.pos(v);
        if (Math.abs(dot(sub(p, c0), t)) <= g.h / 2) { pts.push(p); dd.push(dep ? dep[v] : 1); }
      }
    }
    stations.push(section(pts, c0, t, g.h, dd));
  }
  let s = 0;
  stations.forEach((st, i) => { if (i) s += len(sub(st.c, stations[i - 1].c)); st.s = s; });
  return { stations, dist };
}

/** a cut's centroid, area and widths; u = world forward made square to t, w = t × u */
function section(pts, c0, t, h, dd) {
  if (pts.length < 3) return { c: c0, cc: c0, t, n: 0, area: 0, rin: 0, major: 0, minor: 0, du: 0, dw: 0, umin: 0, umax: 0 };
  let c = [0, 0, 0];
  for (const p of pts) c = add(c, p);
  c = mul(c, 1 / pts.length);
  // the core: weighted by depth below the surface, so a flap of robe or a strap lying on the limb barely counts
  let cc = [0, 0, 0], wsum = 0, rin = 0;
  pts.forEach((p, k) => { const w = Math.max(0, dd[k] - 1) ** 2; cc = add(cc, mul(p, w)); wsum += w; rin = Math.max(rin, dd[k]); });
  cc = wsum > 0 ? mul(cc, 1 / wsum) : c;
  let u = sub([0, 0, 1], mul(t, t[2]));
  if (len(u) < 0.3) u = sub([1, 0, 0], mul(t, t[0]));
  u = norm(u);
  const w = cross(t, u);
  let umin = Infinity, umax = -Infinity, wmin = Infinity, wmax = -Infinity, suu = 0, sww = 0, suw = 0;
  for (const p of pts) {
    const d = sub(p, c);
    const a = dot(d, u), e = dot(d, w);
    umin = Math.min(umin, a); umax = Math.max(umax, a); wmin = Math.min(wmin, e); wmax = Math.max(wmax, e);
    suu += a * a; sww += e * e; suw += a * e;
  }
  suu /= pts.length; sww /= pts.length; suw /= pts.length;
  const tr = suu + sww, det = suu * sww - suw * suw, q = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  return {
    c, cc, t, n: pts.length, area: pts.length * h * h, rin: rin * h,
    du: umax - umin + h, dw: wmax - wmin + h, umin, umax,
    major: 4 * Math.sqrt(Math.max(0, tr / 2 + q)), minor: 4 * Math.sqrt(Math.max(0, tr / 2 - q)),
  };
}

function smooth(a, w) {
  return a.map((_, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) if (Number.isFinite(a[k])) { s += a[k]; n++; }
    return n ? s / n : NaN;
  });
}

/** least-squares 3-D line through points: centroid and direction */
function fitLine(pts) {
  let c = [0, 0, 0];
  for (const p of pts) c = add(c, p);
  c = mul(c, 1 / pts.length);
  // power iteration on the scatter matrix
  const S = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) { const d = sub(p, c); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a * 3 + b] += d[a] * d[b]; }
  let v = norm(sub(pts[pts.length - 1], pts[0]));
  for (let it = 0; it < 30; it++) v = norm([S[0] * v[0] + S[1] * v[1] + S[2] * v[2], S[3] * v[0] + S[4] * v[1] + S[5] * v[2], S[6] * v[0] + S[7] * v[1] + S[8] * v[2]]);
  if (dot(v, sub(pts[pts.length - 1], pts[0])) < 0) v = mul(v, -1);
  let sse = 0;
  for (const p of pts) { const d = sub(p, c); const a = dot(d, v); sse += dot(d, d) - a * a; }
  return { c, v, sse };
}

/**
 * The bend in a centre line: for each candidate station i in [lo, hi], fit
 * one line to the `a` stations before it and one to the `b` after, and keep
 * the split that fits best. Returns the station, the angle between the two
 * lines, and how much better two lines fit than one.
 */
function bend(st, lo, hi, a, b, first = 0) {
  let best = null;
  for (let i = Math.max(lo, 2); i <= Math.min(hi, st.length - 3); i++) {
    const A = st.slice(Math.max(first, i - a), i + 1).map((s) => s.c);
    const B = st.slice(i, Math.min(st.length, i + b + 1)).map((s) => s.c);
    if (A.length < 4 || B.length < 4) continue;
    const fa = fitLine(A), fb = fitLine(B);
    const sse = fa.sse + fb.sse;
    if (!best || sse < best.sse) {
      const one = fitLine(st.slice(Math.max(first, i - a), Math.min(st.length, i + b + 1)).map((s) => s.c));
      const ang = Math.acos(clamp(dot(fa.v, fb.v), -1, 1)) * 180 / Math.PI;
      best = { i, sse, ang, gain: one.sse > 0 ? 1 - sse / one.sse : 0, fa, fb };
    }
  }
  return best;
}

/**
 * Two straight bones: split the centre line between stations `first` and
 * `last` into two lines, at the split in [lo, hi] that fits best overall.
 */
function twoBones(st, first, last, lo, hi) {
  let best = null;
  const all = fitLine(st.slice(first, last + 1).map((q) => q.c));
  for (let i = Math.max(lo, first + 4); i <= Math.min(hi, last - 4); i++) {
    const fa = fitLine(st.slice(first, i + 1).map((q) => q.c)), fb = fitLine(st.slice(i, last + 1).map((q) => q.c));
    const sse = fa.sse + fb.sse;
    if (!best || sse < best.sse) best = { i, sse, fa, fb };
  }
  if (!best) return null;
  best.ang = Math.acos(clamp(dot(best.fa.v, best.fb.v), -1, 1)) * 180 / Math.PI;
  best.gain = all.sse > 0 ? 1 - best.sse / all.sse : 0;
  return best;
}

/** the deepest local minimum of v over [lo, hi], with its prominence against the maxima within `reach` either side */
function constriction(v, lo, hi, reach) {
  let best = null;
  for (let i = Math.max(1, lo); i <= Math.min(hi, v.length - 2); i++) {
    if (!(v[i] <= v[i - 1] && v[i] <= v[i + 1])) continue;
    let up = 0, dn = 0;
    for (let k = Math.max(0, i - reach); k < i; k++) up = Math.max(up, v[k]);
    for (let k = i + 1; k <= Math.min(v.length - 1, i + reach); k++) dn = Math.max(dn, v[k]);
    const prom = Math.min(up, dn) / v[i] - 1;
    if (!best || prom > best.prom) best = { i, prom, up, dn };
  }
  return best;
}

/**
 * Combine cue positions (station indices) into one estimate. Each cue is
 * weighed by its own strength and by how plausible the anthropometric prior
 * finds it; the cues that agree best (within 4 cm) form the answer, and the
 * weight of any cue that disagrees counts against the confidence.
 */
function combine(cues, prior, sigma, cmPerStation) {
  const fired = cues.filter((c) => c.w > 0 && Number.isFinite(c.i));
  const w = fired.map((c) => c.w * Math.exp(-0.5 * ((c.i - prior) / sigma) ** 2));
  const W = w.reduce((a, b) => a + b, 0);
  if (!(W > 0.05)) return { i: prior, conf: 0.1, spread: NaN, used: [] };
  const near = (a, b) => Math.abs(a - b) * cmPerStation <= 4;
  let best = -1, bestScore = -1;
  fired.forEach((c, k) => {
    const score = fired.reduce((s, d, m) => s + w[m] * Math.exp(-(((d.i - c.i) * cmPerStation / 3) ** 2)), 0);
    if (score > bestScore) { bestScore = score; best = k; }
  });
  const inC = fired.map((c) => near(c.i, fired[best].i));
  const Wc = w.reduce((s, x, k) => s + (inC[k] ? x : 0), 0);
  const i = fired.reduce((s, c, k) => s + (inC[k] ? c.i * w[k] : 0), 0) / Wc;
  const spread = Math.sqrt(fired.reduce((s, c, k) => s + (inC[k] ? w[k] * (c.i - i) ** 2 : 0), 0) / Wc) * cmPerStation;
  const support = Wc / (Wc + 0.6);
  const conflict = (W - Wc) / W;
  const nAgree = inC.filter(Boolean).length;
  return { i, conf: clamp(support * (1 - 0.7 * conflict) * (nAgree > 1 ? 1 : 0.7), 0, 1), spread, used: fired.filter((_, k) => inC[k]).map((c) => c.name) };
}

// ------------------------------------------------------------------ main
/**
 * @param T flat triangle soup (9 floats per triangle), game frame
 * @param H the character's fitted height (m)
 *
 * Joints are found per *pair*: each side's cues are measured on its own limb,
 * then pooled (knee and ankle by height above the floor, elbow and wrist by
 * distance from the fingertip along the centre line), so a feature both
 * limbs show reinforces itself and one only one side shows counts half. The
 * pooled answer is then placed on each side's own centre line.
 */
export function analyse(T, H, opts = {}) {
  const h = opts.voxel ?? 0.01;
  const { grid: g, solid } = voxelize(T, h);
  const dep = depth(g, solid);
  // thin shells — coats, capes, robes, fingers — gone; limbs and torso keep their shape
  const O = open(g, solid, opts.openR ?? 2, dep);
  const depO = depth(g, O);
  const crotch = findCrotch(g, O, H);
  if (!crotch) throw new Error('no crotch: the legs never separate');
  const cm = (x) => Math.round(x * 1000) / 10;
  const [NX] = g.n;

  // ---- legs: the two blobs of the opened solid below the crotch ----
  const low = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) if (O[v] && g.o[1] + g.ijk(v)[1] * h < crotch.y) low[v] = 1;
  const lc = components(g, low);
  const labelOf = (comp, j) => { const q = comp.cells[0]; const i = q % NX; return lc.lab[g.idx(i, j, (q - i) / NX)]; };
  const legLab = { L: labelOf(crotch.L, crotch.j0), R: labelOf(crotch.R, crotch.j0) };
  const legMask = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) if (lc.lab[v] && (lc.lab[v] === legLab.L || lc.lab[v] === legLab.R)) legMask[v] = 1;
  const arms = findArms(g, O, solid, crotch, H, legMask);
  if (!arms) throw new Error('no arms: they never stand clear of the torso');

  // ================================================================ per-side measurements
  const S = {};
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const mask = new Uint8Array(g.size);
    const seeds = [];
    for (let v = 0; v < g.size; v++) if (lc.lab[v] === legLab[side]) {
      mask[v] = 1;
      if (g.o[1] + g.ijk(v)[1] * h >= crotch.y - 1.5 * h) seeds.push(v);
    }
    const { stations: legSt } = limbProfile(g, mask, seeds, depO);
    // horizontal slices of the leg, floor to crotch
    const hs = [];
    for (let j = 0; j < crotch.j; j++) {
      let n = 0, sxs = 0, sz = 0, zmin = Infinity, zmax = -Infinity;
      for (let k = 0; k < g.n[2]; k++) for (let i = 0; i < NX; i++) {
        if (!mask[g.idx(i, j, k)]) continue;
        const x = g.o[0] + i * h, z = g.o[2] + k * h;
        n++; sxs += x; sz += z; zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
      }
      if (n) hs.push({ y: g.o[1] + j * h, n, c: [sxs / n, g.o[1] + j * h, sz / n], zmin, zmax, depth: zmax - zmin + h, area: n * h * h });
    }
    const floorY = hs[0]?.y ?? 0;

    const arm = arms[side];
    let yMin = Infinity;
    for (let v = 0; v < g.size; v++) if (arm.mask[v]) yMin = Math.min(yMin, g.pos(v)[1]);
    const tipSeeds = [];
    for (let v = 0; v < g.size; v++) if (arm.mask[v] && g.pos(v)[1] < yMin + 1.5 * h) tipSeeds.push(v);
    const armSt = limbProfile(g, arm.mask, tipSeeds, depO).stations.reverse();   // shoulder cap → hand
    let s = 0;
    armSt.forEach((st, i) => { if (i) s += len(sub(st.c, armSt[i - 1].c)); st.s = s; });
    const fingerTip = arm.tip ?? armSt[armSt.length - 1].c;
    const sEnd = armSt[armSt.length - 1].s + len(sub(fingerTip, armSt[armSt.length - 1].c));
    const armpitI = Math.max(0, armSt.findIndex((q) => q.c[1] < arm.armpitY));
    S[side] = {
      sx, mask, legSt, hs, floorY, arm, armSt, fingerTip, sEnd, armpitI,
      legArea: smooth(legSt.map((q) => q.area), 2),
      armArea: smooth(armSt.map((q) => q.area), 1),
      ratio: smooth(armSt.map((q) => (q.minor > 0 ? q.major / q.minor : 1)), 1),
      legI: (y) => legSt.reduce((b, q, i) => (Math.abs(q.c[1] - y) < Math.abs(legSt[b].c[1] - y) ? i : b), 0),
      hsAt: (y) => hs.reduce((b, q) => (Math.abs(q.y - y) < Math.abs(b.y - y) ? q : b), hs[0]),
      // arm stations by distance from the fingertip along the centre line
      armI: (d) => armSt.reduce((b, q, i) => (Math.abs(sEnd - q.s - d) < Math.abs(sEnd - armSt[b].s - d) ? i : b), 0),
      armD: (i) => sEnd - armSt[i].s,
    };
  }
  const floorY = Math.min(S.L.floorY, S.R.floorY);
  const joints = {};
  const pooled = (name, cues, prior, sigma) => {
    const r = combine(cues.map((c) => ({ ...c, i: c.x })), prior, sigma, 100);
    return { ...r, cues, prior };
  };
  const cueOut = (c, unit) => ({ side: c.side, name: c.name, [unit]: +c.x.toFixed(3), w: +c.w.toFixed(2), ...(c.extra ?? {}) });
  const put = (name, side, p, r, unit, extra = {}) => {
    joints[`${name}.${side}`] = {
      p: r4(p), conf: +r.conf.toFixed(2), spreadCm: Number.isFinite(r.spread) ? +r.spread.toFixed(1) : null,
      [unit]: +r.i.toFixed(3), prior: +r.prior.toFixed(3), used: [...new Set(r.used)],
      cues: r.cues.filter((c) => c.side === side).map((c) => cueOut(c, unit)), ...extra,
    };
  };
  const onLine = (L, y) => (L && Math.abs(L.v[1]) > 0.3 ? add(L.c, mul(L.v, (y - L.c[1]) / L.v[1])) : null);

  // ================================================================ ankle (by height)
  {
    const cues = [];
    for (const side of ['L', 'R']) {
      const { hs } = S[side];
      const fy = S[side].floorY;
      // (1) the instep crease: a two-segment fit of the front surface z(y) over the lowest
      // 0.2 H — near-vertical shin above, the sloping top of the foot below
      const fitSeg = (arr) => {
        const n = arr.length; let sy = 0, sd = 0, syy = 0, syd = 0;
        for (const q of arr) { sy += q.y; sd += q.zmax; syy += q.y * q.y; syd += q.y * q.zmax; }
        const k = (n * syd - sy * sd) / (n * syy - sy * sy || 1), c = (sd - k * sy) / n;
        let e = 0; for (const q of arr) e += (q.zmax - (k * q.y + c)) ** 2;
        return { k, e };
      };
      const foot = hs.filter((q) => q.y <= fy + 0.2 * H && q.y >= fy + 0.03 * H);
      let crease = null;
      for (let b = 3; b < foot.length - 4; b++) {
        const A = fitSeg(foot.slice(0, b + 1)), B = fitSeg(foot.slice(b));
        if (!(A.k < B.k - 0.5 && A.k < -0.4)) continue;
        if (!crease || A.e + B.e < crease.e) crease = { y: foot[b].y, e: A.e + B.e, kFoot: A.k, kShin: B.k };
      }
      if (crease) cues.push({ side, name: 'instep crease (front of the shin turns forward)', x: crease.y, w: clamp((crease.kShin - crease.kFoot) / 1.5, 0.3, 1) });
      // (2) the top of the foot's flare: the highest slice below 0.14 H still 12% deeper than the shin
      const sd = hs.filter((q) => q.y >= fy + 0.12 * H && q.y <= fy + 0.2 * H).map((q) => q.depth).sort((a, b) => a - b);
      const shinDepth = sd[Math.floor(sd.length / 2)];
      let flareTop = null;
      for (const q of hs) if (q.y <= fy + 0.14 * H && q.depth > shinDepth * 1.12 + h) flareTop = q.y;
      if (flareTop !== null) cues.push({ side, name: 'top of the foot flare (section lengthens forward)', x: flareTop, w: 0.6 });
      // (3) the narrowest slice above the foot (a boot top, or the real ankle's taper) — weak
      const lower = hs.filter((q) => q.y > fy + 0.03 * H && q.y < fy + 0.16 * H);
      if (lower.length > 4) {
        const cn = constriction(smooth(lower.map((q) => q.area), 1), 1, lower.length - 2, 8);
        if (cn && cn.prom > 0.05) cues.push({ side, name: 'constriction above the foot', x: lower[cn.i].y, w: clamp(cn.prom, 0, 0.4), extra: { prominence: +cn.prom.toFixed(2) } });
      }
    }
    const r = pooled('ankle', cues, floorY + 0.05 * H, 0.035 * H);
    for (const side of ['L', 'R']) {
      const { hs } = S[side];
      const y = r.i;
      // on the shin's centre line, carried down from the slices above
      const pts = hs.filter((q) => q.y >= y + 0.02 && q.y <= y + 0.14).map((q) => q.c);
      const p = onLine(pts.length >= 4 ? fitLine(pts) : null, y) ?? [S[side].hsAt(y + 0.03).c[0], y, S[side].hsAt(y + 0.03).c[2]];
      put('ankle', side, p, r, 'y');
    }
  }

  // ================================================================ knee (by height)
  {
    const cues = [];
    for (const side of ['L', 'R']) {
      const { legSt, legArea, legI } = S[side];
      const fy = S[side].floorY;
      const lo = legI(Math.min(fy + 0.40 * H, crotch.hem ? crotch.y - 0.03 * H : Infinity)), hi = legI(fy + 0.22 * H);
      // under a closed coat the knee is hidden: nothing to measure
      if (crotch.hem && crotch.y - 0.03 * H < fy + 0.22 * H) continue;
      // the section's area — but only where the cut is limb-shaped: a robe flap or coat tail
      // fused to the thigh makes it wide and flat, and its hem then reads as a constriction
      const kc = constriction(legArea, lo, hi, Math.round(0.08 * H / h));
      const round = (i) => legSt.slice(Math.max(0, i - 3), i + 4).every((q) => q.minor > 0 && q.major / q.minor < 1.5);
      if (kc && kc.prom > 0.04 && round(kc.i)) cues.push({ side, name: 'constriction between thigh and calf', x: legSt[kc.i].c[1], w: clamp(kc.prom * 4, 0.1, 1), extra: { prominence: +kc.prom.toFixed(2) } });
      // the core's thickness (largest inscribed radius), which a flap lying on the limb cannot thicken
      const rin = smooth(legSt.map((q) => q.rin), 2);
      const kr = constriction(rin, lo, hi, Math.round(0.08 * H / h));
      if (kr && kr.prom > 0.03) cues.push({ side, name: 'thinnest core between thigh and calf', x: legSt[kr.i].c[1], w: clamp(kr.prom * 5, 0.1, 0.8), extra: { prominence: +kr.prom.toFixed(2) } });
      const kb = bend(legSt, lo, hi, Math.round(0.12 * H / h), Math.round(0.12 * H / h));
      // standing legs are nearly straight: a bend has to be clear to count
      if (kb && kb.ang > 5 && kb.gain > 0.4) cues.push({ side, name: 'bend in the centre line', x: legSt[kb.i].c[1], w: clamp((kb.ang - 5) / 10, 0.1, 0.8) * kb.gain, extra: { angleDeg: +kb.ang.toFixed(1) } });
    }
    const r = pooled('knee', cues, floorY + 0.29 * H, 0.04 * H);
    for (const side of ['L', 'R']) {
      const { legSt } = S[side];
      // above the top of the measured leg (inside a closed coat): carry the shin's line up to it
      const top = legSt[0].cc[1];
      const p = r.i > top - 0.01 && legSt.length > 8
        ? onLine(fitLine(legSt.slice(0, Math.min(legSt.length, Math.round(0.12 * H / h))).map((q) => q.cc)), r.i) ?? legSt[0].cc
        : legSt[S[side].legI(r.i)].cc;
      put('knee', side, p, r, 'y');
    }
  }

  // ================================================================ wrist (by distance from the fingertip)
  {
    const cues = [];
    for (const side of ['L', 'R']) {
      const { armSt, armArea, ratio, armI, armD } = S[side];
      const N = armSt.length;
      const lo = armI(0.18 * H), hi = armI(0.05 * H);
      // the hand: the first station, going down the forearm, where the section's aspect
      // ratio stays 0.25 above the mid-forearm's — a hand is flat, a forearm round
      const fore = ratio.slice(armI(0.30 * H), armI(0.20 * H) + 1).filter(Number.isFinite);
      const base = fore.length ? fore.reduce((x, y) => x + y, 0) / fore.length : 1.15;
      let onset = null;
      for (let i = lo; i <= Math.min(N - 3, hi); i++) {
        if (ratio[i] > base + 0.25 && ratio[i + 1] > base + 0.25 && ratio[i + 2] > base + 0.25) { onset = i; break; }
      }
      if (onset !== null) cues.push({ side, name: 'section flattens into the hand', x: armD(Math.max(0, onset - 1)), w: 0.6 });
      // the wrist's constriction: the thinnest cut just above the hand (within 0.035 H of it),
      // measured against the forearm above and the hand below
      const reach = Math.round(0.05 * H / h);
      let wc = null;
      if (onset !== null) {
        let m = onset;
        for (let i = Math.max(0, onset - Math.round(0.035 * H / h)); i <= onset + 1; i++) if (armArea[i] < armArea[m]) m = i;
        let up = 0, dn = 0;
        for (let k = Math.max(0, m - reach); k < m; k++) up = Math.max(up, armArea[k]);
        for (let k = m + 1; k <= Math.min(N - 1, m + reach); k++) dn = Math.max(dn, armArea[k]);
        wc = { i: m, prom: Math.min(up, dn) / armArea[m] - 1 };
      } else {
        wc = constriction(armArea, lo, hi, Math.round(0.04 * H / h));
        if (wc) wc.prom *= 0.6;
      }
      if (wc && wc.prom > 0.05) cues.push({ side, name: 'constriction above the hand', x: armD(wc.i), w: clamp(wc.prom * 3, 0.2, 1), extra: { prominence: +wc.prom.toFixed(2) } });
    }
    const r = pooled('wrist', cues, 0.108 * H, 0.04 * H);
    for (const side of ['L', 'R']) put('wrist', side, S[side].armSt[S[side].armI(r.i)].cc, r, 'fromFingertip');
  }

  // ================================================================ elbow (by distance from the fingertip)
  {
    const dW = joints['wrist.L'].fromFingertip;
    const cues = [];
    for (const side of ['L', 'R']) {
      const { armSt, armArea, armI, armD, armpitI } = S[side];
      const wI = armI(dW);
      // above the armpit the arm is only a cut from the torso, and its centre line is not to be trusted
      const lo = armpitI + 2, hi = wI - Math.round(0.07 * H / h);
      // the arm as two straight bones, from just above the armpit to the wrist
      const eb = twoBones(armSt, Math.max(0, armpitI - 3), wI, lo, hi);
      if (eb && eb.ang > 4 && eb.gain > 0.3) cues.push({ side, name: 'bend in the centre line', x: armD(eb.i), w: clamp((eb.ang - 3) / 6, 0.2, 1) * Math.sqrt(eb.gain), extra: { angleDeg: +eb.ang.toFixed(1) } });
      // a constriction here is often a gap between armour pieces, so it counts for less than a bend
      const ec = constriction(armArea, lo, hi, Math.round(0.05 * H / h));
      if (ec && ec.prom > 0.06) cues.push({ side, name: 'constriction between upper arm and forearm', x: armD(ec.i), w: clamp(ec.prom * 2, 0.1, 0.6), extra: { prominence: +ec.prom.toFixed(2) } });
    }
    // forearm ≈ 1.35 hands (0.146 H against 0.108 H), measured up from the wrist the geometry found
    const r = pooled('elbow', cues, dW + 1.35 * Math.max(dW, 0.08 * H), 0.035 * H);
    for (const side of ['L', 'R']) put('elbow', side, S[side].armSt[S[side].armI(r.i)].cc, r, 'fromFingertip');
  }

  // ================================================================ hips and shoulders (weak)
  for (const side of ['L', 'R']) {
    const { sx, legSt, armSt, arm, armpitI } = S[side];
    // hip: the thigh's axis carried up to hip height, 0.04 H above the crotch or at the pelvis's widest (the trochanters)
    const kneeI = S[side].legI(joints[`knee.${side}`].y);
    const thigh = legSt.filter((q, i) => i > 2 && i < kneeI - Math.round(0.06 * H / h)).map((q) => q.c);
    const thighLine = thigh.length >= 5 ? fitLine(thigh) : null;
    const hipCues = [{ side, name: 'prior: 0.04 H above the crotch', x: crotch.y + 0.04 * H, w: 0.3 }];
    let bestW = 0, bestY = null;
    for (let j = crotch.j; j <= crotch.j + Math.round(0.1 * H / h); j++) {
      let mx = -Infinity;
      for (let k = 0; k < g.n[2]; k++) for (let i = 0; i < NX; i++) {
        const v = g.idx(i, j, k);
        if (!O[v] || arm.mask[v]) continue;
        mx = Math.max(mx, sx * (g.o[0] + i * h));
      }
      if (mx > bestW + 0.002) { bestW = mx; bestY = g.o[1] + j * h; }
    }
    if (bestY !== null && bestY > crotch.y + 0.01 && bestY < crotch.y + 0.1 * H - 0.01) hipCues.push({ side, name: 'widest point of the pelvis (trochanter)', x: bestY, w: 0.4 });
    if (crotch.hem) hipCues.splice(0, hipCues.length, { side, name: 'prior only: 0.52 H (the legs are inside a closed coat)', x: 0.52 * H, w: 0.3 });
    const hipY = hipCues.reduce((a, c) => a + c.x * c.w, 0) / hipCues.reduce((a, c) => a + c.w, 0);
    joints[`hip.${side}`] = { p: r4((crotch.hem ? null : onLine(thighLine, hipY)) ?? [sx * 0.055 * H, hipY, legSt[0].cc[2]]), conf: crotch.hem ? 0.1 : 0.25, y: +hipY.toFixed(3),
      cues: hipCues.map((c) => cueOut(c, 'y')), note: 'the thigh axis carried up into the pelvis, which hides the joint' };

    // shoulder: the upper arm's axis carried up until it leaves the solid, less one arm radius,
    // pulled a third of the way toward the centroid of the shoulder cap above the armpit
    const elbowI = S[side].armI(joints[`elbow.${side}`].fromFingertip);
    const upper = armSt.slice(Math.max(0, armpitI - 3), Math.max(armpitI + 2, elbowI - 3)).map((q) => q.c);
    let p = armSt[0].c;
    const cues = [];
    if (upper.length >= 4) {
      const L = fitLine(upper);
      const up = mul(L.v, -1);
      const rArm = Math.sqrt(armSt.slice(armpitI, Math.max(armpitI + 1, elbowI)).reduce((a, q) => a + q.area, 0) / Math.max(1, elbowI - armpitI) / Math.PI);
      let q = upper[0], exit = null;
      for (let k = 0; k < 0.3 * H / (h / 2); k++) {
        q = add(q, mul(up, h / 2));
        const [i, j, kk] = g.cell(...q);
        if (i < 0 || j < 0 || kk < 0 || i >= NX || j >= g.n[1] || kk >= g.n[2]) break;
        if (!O[g.idx(i, j, kk)]) { exit = q; break; }
      }
      if (exit) { p = sub(exit, mul(up, rArm)); cues.push({ side, name: 'upper-arm axis meets the top of the shoulder, less one arm radius', x: p[1], w: 0.5 }); }
      let cap = [0, 0, 0], nc = 0;
      for (let v = 0; v < g.size; v++) if (arm.mask[v]) { const c = g.pos(v); if (c[1] >= arm.armpitY) { cap = add(cap, c); nc++; } }
      if (nc > 20) {
        cap = mul(cap, 1 / nc);
        cues.push({ side, name: 'centroid of the shoulder cap above the armpit', x: cap[1], w: 0.3 });
        p = exit ? lerp(p, cap, 0.35) : cap;
      }
    }
    joints[`shoulder.${side}`] = { p: r4(p), conf: cues.length > 1 ? 0.3 : 0.15, y: +p[1].toFixed(3), cues: cues.map((c) => cueOut(c, 'y')), note: 'the torso and any pauldron hide the joint' };
  }

  // ---- left/right agreement of the final points (heights are pooled; this checks the across-limb placement) ----
  for (const j of ['elbow', 'wrist', 'knee', 'ankle', 'hip', 'shoulder']) {
    const L = joints[`${j}.L`], R = joints[`${j}.R`];
    const d = len(sub(L.p, [-R.p[0], R.p[1], R.p[2]]));
    L.mirrorCm = R.mirrorCm = +(d * 100).toFixed(1);
    const f = Math.exp(-Math.max(0, d - 0.03) / 0.04);
    L.conf = +(L.conf * f).toFixed(2); R.conf = +(R.conf * f).toFixed(2);
  }

  // ================================================================ the geometric stand-in
  const standIn = [];
  const limbs = {};
  const rOf = (arr) => Math.sqrt(Math.max(1e-4, arr.reduce((a, q) => a + q.area, 0) / Math.max(1, arr.length)) / Math.PI);
  for (const side of ['L', 'R']) {
    const { legSt, armSt, mask, fingerTip, armpitI } = S[side];
    const P = (j) => joints[`${j}.${side}`].p;
    const kneeI = S[side].legI(joints[`knee.${side}`].y), ankI = S[side].legI(joints[`ankle.${side}`].y + 0.02);
    standIn.push({ part: `thigh.${side}`, a: P('hip'), b: P('knee'), r0: +rOf(legSt.slice(2, 10)).toFixed(3), r1: +rOf(legSt.slice(Math.max(0, kneeI - 4), kneeI + 1)).toFixed(3) });
    const shin = legSt.slice(kneeI, Math.max(kneeI + 1, ankI));
    standIn.push({ part: `shin.${side}`, a: P('knee'), b: P('ankle'), r0: +rOf(shin.slice(0, Math.max(1, Math.round(shin.length / 3)))).toFixed(3), r1: +rOf(shin.slice(-5)).toFixed(3) });
    const ay = joints[`ankle.${side}`].y;
    let toe = null;
    for (let v = 0; v < g.size; v++) if (mask[v]) { const q = g.pos(v); if (q[1] < ay && (!toe || q[2] > toe[2])) toe = q; }
    if (toe) {
      const fr = Math.max(0.02, (ay - floorY) * 0.55);
      const a = P('ankle');
      standIn.push({ part: `foot.${side}`, a: r4([a[0], floorY + fr, a[2] - 0.01]), b: r4([toe[0], floorY + fr * 0.7, toe[2] - fr * 0.7]), r0: +fr.toFixed(3), r1: +(fr * 0.75).toFixed(3) });
    }
    const eI = S[side].armI(joints[`elbow.${side}`].fromFingertip), wI = S[side].armI(joints[`wrist.${side}`].fromFingertip);
    standIn.push({ part: `upperArm.${side}`, a: P('shoulder'), b: P('elbow'), r0: +rOf(armSt.slice(armpitI, armpitI + 5)).toFixed(3), r1: +rOf(armSt.slice(Math.max(0, eI - 3), eI + 1)).toFixed(3) });
    standIn.push({ part: `forearm.${side}`, a: P('elbow'), b: P('wrist'), r0: +rOf(armSt.slice(eI, eI + 5)).toFixed(3), r1: +rOf(armSt.slice(Math.max(0, wI - 3), wI + 1)).toFixed(3) });
    const hr = Math.max(0.015, rOf(armSt.slice(wI)) * 0.8);
    standIn.push({ part: `hand.${side}`, a: P('wrist'), b: r4(sub(fingerTip, mul(norm(sub(fingerTip, P('wrist'))), hr))), r0: +hr.toFixed(3), r1: +(hr * 0.8).toFixed(3) });
    limbs[`leg.${side}`] = { stations: legSt.map((q) => ({ c: r4(q.c), cc: r4(q.cc), rin: cm(q.rin), area: +(q.area * 1e4).toFixed(1), major: cm(q.major), minor: cm(q.minor) })) };
    limbs[`arm.${side}`] = { armpitY: +S[side].arm.armpitY.toFixed(3), fingerTip: r4(fingerTip),
      stations: armSt.map((q) => ({ c: r4(q.c), cc: r4(q.cc), rin: cm(q.rin), fromFingertip: +(S[side].sEnd - q.s).toFixed(3), area: +(q.area * 1e4).toFixed(1), major: cm(q.major), minor: cm(q.minor) })) };
  }
  // torso and head: horizontal slices of what is neither arm nor leg, stacked as elliptic frustums
  const body = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) if (O[v] && !legMask[v] && !arms.L.mask[v] && !arms.R.mask[v]) body[v] = 1;
  const torsoSlices = [];
  for (let j = Math.max(0, crotch.j - Math.round(0.04 * H / h)); j < g.n[1]; j++) {
    const sl = sliceComponents(g, body, j);
    const c = sl.comps.filter((q) => q.minx < 0.02 && q.maxx > -0.02).sort((a, b) => b.n - a.n)[0];
    if (!c || c.n < 4) continue;
    let sxx = 0, szz = 0;
    for (const q of c.cells) { const i = q % NX, k = (q - i) / NX; const x = g.o[0] + i * h - c.cx, z = g.o[2] + k * h - c.cz; sxx += x * x; szz += z * z; }
    torsoSlices.push({ c: [c.cx, g.o[1] + j * h, c.cz], rx: 2 * Math.sqrt(sxx / c.n), rz: 2 * Math.sqrt(szz / c.n) });
  }
  const step = Math.max(1, Math.round(0.04 * H / h));
  for (let k = 0; k + 1 < torsoSlices.length; k += step) {
    const a = torsoSlices[k], b = torsoSlices[Math.min(torsoSlices.length - 1, k + step)];
    standIn.push({ part: 'torso', a: r4(a.c), b: r4(b.c), r0: +a.rx.toFixed(3), r1: +b.rx.toFixed(3), e0: +(a.rz / a.rx).toFixed(3), e1: +(b.rz / b.rx).toFixed(3), flat: true });
  }

  return {
    height: H, voxel: h, crotchY: +crotch.y.toFixed(3), ...(crotch.hem ? { closedCoatHemY: +crotch.y.toFixed(3) } : {}),
    armpitY: { L: +arms.L.armpitY.toFixed(3), R: +arms.R.armpitY.toFixed(3) },
    joints, limbs, standIn,
    debug: { grid: g, solid, O, legMask, arms, S },
  };
}

export { findCrotch, limbProfile, sliceComponents, smooth, fitLine, bend, constriction };
