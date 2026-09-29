/**
 * Volume tools for the geometric joint estimator (geo-joints.mjs): a solid
 * voxel model of a triangle soup, exact Euclidean distance transforms,
 * morphological opening, connected components and geodesic distance. Plain
 * JS on typed arrays; nothing here knows about bones or skin weights.
 */

/** A voxel grid: `n` = [nx, ny, nz], `o` = world position of voxel (0,0,0)'s centre, `h` = voxel size. */
export class Grid {
  constructor(n, o, h) {
    this.n = n; this.o = o; this.h = h;
    this.size = n[0] * n[1] * n[2];
    this.sx = 1; this.sy = n[0]; this.sz = n[0] * n[1];
  }
  idx(i, j, k) { return i + j * this.sy + k * this.sz; }
  ijk(v) { const i = v % this.n[0]; const r = (v - i) / this.n[0]; const j = r % this.n[1]; return [i, j, (r - j) / this.n[1]]; }
  pos(v) { const [i, j, k] = this.ijk(v); return [this.o[0] + i * this.h, this.o[1] + j * this.h, this.o[2] + k * this.h]; }
  cell(x, y, z) {
    return [Math.round((x - this.o[0]) / this.h), Math.round((y - this.o[1]) / this.h), Math.round((z - this.o[2]) / this.h)];
  }
}

/**
 * The solid the triangles enclose, as a voxel mask. The surface is rasterised
 * densely (samples at a third of a voxel), thickened by one voxel so small
 * holes and slivers cannot leak, the outside is flood-filled from the grid's
 * border, and whatever the fill cannot reach is solid; the thickening is then
 * taken back off. Works on meshes with small holes; a mesh open along a big
 * edge (a coat's hem) simply has no inside there, which is what we want.
 * `close` is how many voxels the surface is thickened by: holes up to about
 * twice that wide are sealed.
 */
export function voxelize(T, h, margin = 4, close = 1) {
  margin = Math.max(margin, close + 2);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < T.length; i++) { const k = i % 3; if (T[i] < mn[k]) mn[k] = T[i]; if (T[i] > mx[k]) mx[k] = T[i]; }
  const n = [0, 1, 2].map((k) => Math.ceil((mx[k] - mn[k]) / h) + 1 + margin * 2);
  const g = new Grid(n, mn.map((m) => m - margin * h), h);
  const surf = new Uint8Array(g.size);
  const nt = T.length / 9;
  for (let t = 0; t < nt; t++) {
    const b = t * 9;
    const ax = T[b], ay = T[b + 1], az = T[b + 2];
    const ux = T[b + 3] - ax, uy = T[b + 4] - ay, uz = T[b + 5] - az;
    const vx = T[b + 6] - ax, vy = T[b + 7] - ay, vz = T[b + 8] - az;
    const len = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(ux - vx, uy - vy, uz - vz));
    const m = Math.max(1, Math.ceil(len / (h / 3)));
    for (let i = 0; i <= m; i++) {
      for (let j = 0; i + j <= m; j++) {
        const a = i / m, c = j / m;
        const [ci, cj, ck] = g.cell(ax + ux * a + vx * c, ay + uy * a + vy * c, az + uz * a + vz * c);
        surf[g.idx(ci, cj, ck)] = 1;
      }
    }
  }
  const thick = dilate6(g, surf, close);
  // flood the outside through everything the thickened surface leaves open
  const out = new Uint8Array(g.size);
  const stack = new Int32Array(g.size);
  let sp = 0;
  out[0] = 1; stack[sp++] = 0;
  const [NX, NY, NZ] = n;
  while (sp) {
    const v = stack[--sp];
    const i = v % NX, r = (v - i) / NX, j = r % NY, k = (r - j) / NY;
    const nb = [i > 0 ? v - 1 : -1, i < NX - 1 ? v + 1 : -1, j > 0 ? v - NX : -1, j < NY - 1 ? v + NX : -1,
      k > 0 ? v - g.sz : -1, k < NZ - 1 ? v + g.sz : -1];
    for (const w of nb) if (w >= 0 && !out[w] && !thick[w]) { out[w] = 1; stack[sp++] = w; }
  }
  // solid = not outside, less the one voxel of thickening
  const notOut = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) notOut[v] = out[v] ? 0 : 1;
  const solid = erode6(g, notOut, close);
  for (let v = 0; v < g.size; v++) if (surf[v] && notOut[v]) solid[v] = 1;
  return { grid: g, solid, surf };
}

function dilate6(g, m, r) {
  let cur = m;
  for (let s = 0; s < r; s++) {
    const nx = cur.slice();
    for (let v = 0; v < g.size; v++) {
      if (!cur[v]) continue;
      const [i, j, k] = g.ijk(v);
      if (i > 0) nx[v - 1] = 1; if (i < g.n[0] - 1) nx[v + 1] = 1;
      if (j > 0) nx[v - g.sy] = 1; if (j < g.n[1] - 1) nx[v + g.sy] = 1;
      if (k > 0) nx[v - g.sz] = 1; if (k < g.n[2] - 1) nx[v + g.sz] = 1;
    }
    cur = nx;
  }
  return cur;
}
function erode6(g, m, r) {
  let cur = m;
  for (let s = 0; s < r; s++) {
    const nx = cur.slice();
    for (let v = 0; v < g.size; v++) {
      if (!cur[v]) continue;
      const [i, j, k] = g.ijk(v);
      if (i === 0 || i === g.n[0] - 1 || j === 0 || j === g.n[1] - 1 || k === 0 || k === g.n[2] - 1
        || !cur[v - 1] || !cur[v + 1] || !cur[v - g.sy] || !cur[v + g.sy] || !cur[v - g.sz] || !cur[v + g.sz]) nx[v] = 0;
    }
    cur = nx;
  }
  return cur;
}

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher) over f, in place into d */
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    if (f[q] === Infinity) continue;
    if (f[v[k]] === Infinity) { v[k] = q; continue; }
    let s;
    for (;;) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s <= z[k] && k > 0) { k--; continue; }
      break;
    }
    if (s <= z[k]) { v[k] = q; z[k + 1] = Infinity; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  if (f[v[0]] === Infinity) { for (let q = 0; q < n; q++) d[q] = Infinity; return; }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Exact Euclidean distance (in voxels) from every voxel to the nearest voxel
 * where `seed` is set (0 on the seeds themselves).
 */
export function edt(g, seed) {
  const D = new Float64Array(g.size);
  for (let v = 0; v < g.size; v++) D[v] = seed[v] ? 0 : Infinity;
  const m = Math.max(...g.n);
  const f = new Float64Array(m), d = new Float64Array(m), vv = new Int32Array(m), z = new Float64Array(m + 1);
  const pass = (len, stride, starts) => {
    for (const s0 of starts) {
      for (let q = 0; q < len; q++) f[q] = D[s0 + q * stride];
      edt1(f, len, d, vv, z);
      for (let q = 0; q < len; q++) D[s0 + q * stride] = d[q];
    }
  };
  const [NX, NY, NZ] = g.n;
  const sx = [], sy = [], sz = [];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) sx.push(j * g.sy + k * g.sz);
  for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) sy.push(i + k * g.sz);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) sz.push(i + j * g.sy);
  pass(NX, 1, sx); pass(NY, g.sy, sy); pass(NZ, g.sz, sz);
  for (let v = 0; v < g.size; v++) D[v] = Math.sqrt(D[v]);
  return D;
}

/** depth of each solid voxel: distance (voxels) to the nearest non-solid voxel */
export function depth(g, solid) {
  const out = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) out[v] = solid[v] ? 0 : 1;
  return edt(g, out);
}

/** morphological opening by a ball of radius r voxels: removes anything thinner than 2r, keeps the rest's shape */
export function open(g, solid, r, dep = depth(g, solid)) {
  const core = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) core[v] = solid[v] && dep[v] > r ? 1 : 0;
  const dc = edt(g, core);
  const out = new Uint8Array(g.size);
  for (let v = 0; v < g.size; v++) out[v] = solid[v] && dc[v] <= r + 0.5 ? 1 : 0;
  return out;
}

/** 26-connected components of `mask`; returns labels (0 = none) and sizes (index = label) */
export function components(g, mask) {
  const lab = new Int32Array(g.size);
  const sizes = [0];
  const stack = new Int32Array(g.size);
  for (let v0 = 0; v0 < g.size; v0++) {
    if (!mask[v0] || lab[v0]) continue;
    const L = sizes.length;
    let sp = 0, cnt = 0;
    lab[v0] = L; stack[sp++] = v0;
    while (sp) {
      const v = stack[--sp]; cnt++;
      const [i, j, k] = g.ijk(v);
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj, c = k + dk;
        if (a < 0 || b < 0 || c < 0 || a >= g.n[0] || b >= g.n[1] || c >= g.n[2]) continue;
        const w = g.idx(a, b, c);
        if (mask[w] && !lab[w]) { lab[w] = L; stack[sp++] = w; }
      }
    }
    sizes.push(cnt);
  }
  return { lab, sizes };
}

const NB26 = [];
for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
  if (di || dj || dk) NB26.push([di, dj, dk, Math.hypot(di, dj, dk)]);
}

/** geodesic distance (voxels) inside `mask` from the seed voxels, 26-neighbour Dijkstra */
export function geodesic(g, mask, seeds) {
  const dist = new Float64Array(g.size).fill(Infinity);
  // binary heap of [dist, v]
  const hv = [], hd = [];
  const push = (d, v) => {
    hv.push(v); hd.push(d);
    let i = hv.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= hd[i]) break; [hv[p], hv[i]] = [hv[i], hv[p]]; [hd[p], hd[i]] = [hd[i], hd[p]]; i = p; }
  };
  const pop = () => {
    const v = hv[0], d = hd[0];
    const lv = hv.pop(), ld = hd.pop();
    if (hv.length) {
      hv[0] = lv; hd[0] = ld;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < hv.length && hd[l] < hd[m]) m = l;
        if (r < hv.length && hd[r] < hd[m]) m = r;
        if (m === i) break;
        [hv[m], hv[i]] = [hv[i], hv[m]]; [hd[m], hd[i]] = [hd[i], hd[m]]; i = m;
      }
    }
    return [d, v];
  };
  for (const s of seeds) { dist[s] = 0; push(0, s); }
  while (hv.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    const [i, j, k] = g.ijk(v);
    for (const [di, dj, dk, w] of NB26) {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= g.n[0] || b >= g.n[1] || c >= g.n[2]) continue;
      const u = g.idx(a, b, c);
      if (!mask[u]) continue;
      const nd = d + w;
      if (nd < dist[u]) { dist[u] = nd; push(nd, u); }
    }
  }
  return dist;
}
