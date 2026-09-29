/**
 * Page half of `measure-lod.mjs`: loads every authored character, creature,
 * weapon and vehicle through the game's own loaders and measures the low-LOD
 * data the procedural stand-ins are built from (src/characters/lod.ts).
 *
 * Measured in exactly the frame the game shows each model in:
 *
 *  - characters through `loadAuthored` at their fitted height, posed at our
 *    rest by `retarget` (arms straight down), so every vertex is where the
 *    game draws it when the canonical rig is at rest;
 *  - creatures, weapons and vehicles through `loadProp` / the creature path,
 *    with the same size, axis and grounding the game asks for.
 *
 * Each surface point goes to the bone that drives it most (its dominant skin
 * weight), mapped to the canonical bone the retargeter drives it by. The
 * posed mesh is then voxelized as a solid (`solidify`) and every solid voxel
 * goes to the bone of the surface nearest it. Each bone's solid is cut into a
 * few clusters by greedy volume-reducing splits — in a frame along the
 * sculpt's own bone for the limbs — and each cluster becomes one box with the
 * cluster's centroid, proportions from its spread, and exactly its volume
 * (`solidBox`): the stand-in is as big as the model, not a hull around it.
 * Colours are the material colour times the base-colour texture, averaged
 * over the surface each box stands for.
 */
import * as THREE from 'three';
import { CREATURE_MODELS, ENEMY_MODELS, loadAuthored, loadProp, retarget } from '../../src/characters/authored';
import { BONES, buildRig, HUMAN, type BoneName, type Proportions } from '../../src/anim/skeleton';
import { MODEL_HEIGHT } from '../../src/characters/mandalorians';
import { WEAPON_PROPS } from '../../src/characters/weaponProps';
import { VEHICLE_DEFS } from '../../src/game/vehicles';
import { attachEggRack, BROOD_EGG_RACK } from '../../src/characters/eggrack';
import OLD_LOD from '../../src/characters/data/lod.json';
// @ts-expect-error plain JS (no types), shared with the geometric joint estimator
import { voxelize } from './geo-core.mjs';

const log = (s: string): void => {
  const el = document.getElementById('log')!;
  el.textContent += `\n${s}`;
  console.log(s);
};

// ---------------------------------------------------------------- colour
const _uv = new THREE.Vector2();
const texData = new Map<THREE.Texture, { w: number; h: number; data: Uint8ClampedArray } | null>();
function texel(tex: THREE.Texture, u: number, v: number, out: THREE.Color): boolean {
  let d = texData.get(tex);
  if (d === undefined) {
    d = null;
    const img = tex.image as { width?: number; height?: number } | undefined;
    if (img && img.width && img.height) {
      const w = Math.min(img.width, 256), h = Math.min(img.height, 256);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true })!;
      try {
        ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
        d = { w, h, data: ctx.getImageData(0, 0, w, h).data };
      } catch { d = null; }
    }
    texData.set(tex, d);
  }
  if (!d) return false;
  // the files are gltfpack'd: UVs are quantized and dequantized by a
  // KHR_texture_transform, which three carries as the texture's matrix
  if (tex.matrixAutoUpdate) tex.updateMatrix();
  _uv.set(u, v).applyMatrix3(tex.matrix);
  u = _uv.x; v = _uv.y;
  u -= Math.floor(u);
  v -= Math.floor(v);
  if (tex.flipY) v = 1 - v;
  const x = Math.min(d.w - 1, Math.floor(u * d.w));
  const y = Math.min(d.h - 1, Math.floor(v * d.h));
  const i = (y * d.w + x) * 4;
  out.setRGB(d.data[i] / 255, d.data[i + 1] / 255, d.data[i + 2] / 255, THREE.SRGBColorSpace);
  return true;
}

/** a flat cloud: xyz and linear rgb per point, plus one integer key */
class Cloud {
  xyz: number[] = [];
  rgb: number[] = [];
  key: number[] = [];
  get n(): number { return this.key.length; }
  push(p: THREE.Vector3, c: THREE.Color, key: number): void {
    this.xyz.push(p.x, p.y, p.z);
    this.rgb.push(c.r, c.g, c.b);
    this.key.push(key);
  }
}

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _t = new THREE.Color();

function visible(o: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false;
  return true;
}

/** a small seeded generator, so a re-measure of an unchanged model writes the same file */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

/**
 * Points over the drawn surface of `root`, skinned, in `frame`'s space, each
 * with its colour and the object that drives it most (a bone, or the mesh
 * itself when it is rigid), handed to `visit` along with the vertex it was
 * taken nearest.
 *
 * Sampled by area, not by vertex: a staff's shaft is a long cylinder with
 * vertices only at its ends, and a vertex cloud leaves the middle of it empty
 * — boxes fitted to that float apart with gaps between them — while a
 * detailed buckle carries a thousand vertices in a square centimetre.
 */
function eachVertex(
  root: THREE.Object3D, frame: THREE.Object3D,
  visit: (p: THREE.Vector3, c: THREE.Color, driver: THREE.Object3D, mesh: THREE.Mesh, i: number) => void,
  maxPoints = 40000,
  /** every drawn triangle, as nine coordinates in `frame`'s space (for the solid volume) */
  tris?: number[],
  /** triangles to leave out of `tris`, by their first vertex */
  skipTri?: (mesh: THREE.Mesh, i: number) => boolean,
): void {
  root.updateMatrixWorld(true);
  const toFrame = frame.matrixWorld.clone().invert();
  interface Prep { mesh: THREE.Mesh; P: Float32Array; tris_: Uint32Array; area: Float64Array; total: number }
  const preps: Prep[] = [];
  let total = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !visible(mesh)) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const m = new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld);
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      mesh.getVertexPosition(i, _v).applyMatrix4(m);
      P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z;
    }
    const index = geo.index;
    const n = index ? index.count : pos.count;
    const tris_ = new Uint32Array(n);
    for (let k = 0; k < n; k++) tris_[k] = index ? index.getX(k) : k;
    const area = new Float64Array(n / 3);
    let sum = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < n / 3; t++) {
      A.fromArray(P, tris_[t * 3] * 3); B.fromArray(P, tris_[t * 3 + 1] * 3); C.fromArray(P, tris_[t * 3 + 2] * 3);
      area[t] = B.sub(A).cross(C.sub(A)).length() / 2;
      sum += area[t];
    }
    preps.push({ mesh, P, tris_, area, total: sum });
    total += sum;
  });
  if (!(total > 0)) return;
  const rand = rng(0x5eed);
  const perArea = maxPoints / total;
  for (const { mesh, P, tris_, area } of preps) {
    const geo = mesh.geometry;
    const uv = geo.attributes.uv;
    const col = geo.attributes.color;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    const matOf = new Int16Array(geo.attributes.position.count);
    if (geo.groups.length && mats.length > 1) {
      for (const g of geo.groups) {
        const end = Math.min(g.start + g.count, tris_.length);
        for (let k = g.start; k < end; k++) matOf[tris_[k]] = g.materialIndex ?? 0;
      }
    }
    if (tris) {
      for (let t = 0; t < area.length; t++) {
        const i0 = tris_[t * 3];
        const mt = mats[matOf[i0]] ?? mats[0];
        if (!mt || mt.visible === false || skipTri?.(mesh, i0)) continue;
        for (let c = 0; c < 3; c++) { const i = tris_[t * 3 + c] * 3; tris.push(P[i], P[i + 1], P[i + 2]); }
      }
    }
    const skinned = mesh as THREE.SkinnedMesh;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const driverOf = (i: number): THREE.Object3D => {
      if (!skinned.isSkinnedMesh || !si || !sw) return mesh;
      let best = -1, wBest = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > wBest) { wBest = w; best = si.getComponent(i, k); }
      }
      return skinned.skeleton.bones[best] ?? mesh;
    };
    for (let t = 0; t < area.length; t++) {
      const want = area[t] * perArea;
      let k = Math.floor(want);
      if (rand() < want - k) k++;
      for (let j = 0; j < k; j++) {
        // uniform over the triangle
        let u = rand(), v = rand();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;
        const i0 = tris_[t * 3], i1 = tris_[t * 3 + 1], i2 = tris_[t * 3 + 2];
        _v.set(
          P[i0 * 3] * w + P[i1 * 3] * u + P[i2 * 3] * v,
          P[i0 * 3 + 1] * w + P[i1 * 3 + 1] * u + P[i2 * 3 + 1] * v,
          P[i0 * 3 + 2] * w + P[i1 * 3 + 2] * u + P[i2 * 3 + 2] * v);
        const near = w >= u && w >= v ? i0 : u >= v ? i1 : i2;
        const mt = mats[matOf[near]] ?? mats[0];
        if (!mt || mt.visible === false) continue;
        _c.copy(mt.color ?? _t.set(1, 1, 1));
        if (mt.map && uv) {
          const tu = uv.getX(i0) * w + uv.getX(i1) * u + uv.getX(i2) * v;
          const tv = uv.getY(i0) * w + uv.getY(i1) * u + uv.getY(i2) * v;
          if (texel(mt.map, tu, tv, _t)) _c.multiply(_t);
        }
        if (col && mt.vertexColors) _c.multiply(_t.setRGB(col.getX(near), col.getY(near), col.getZ(near)));
        visit(_v, _c, driverOf(near), mesh, near);
      }
    }
  }
}

// ---------------------------------------------------------------- box fitting
/**
 * A stand-in box: centre and size in the frame it was fitted in, its colour,
 * the turn it carries in that frame (null: square to it), and the volume of
 * the plain bounding box around what it stands for (to pick a frame by).
 */
interface Box { c: [number, number, number]; s: [number, number, number]; col: number; n: number; q: THREE.Quaternion | null; bound: number }

function bounds(cloud: Cloud, ids: number[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) for (let a = 0; a < 3; a++) {
    const x = cloud.xyz[i * 3 + a];
    if (x < min[a]) min[a] = x;
    if (x > max[a]) max[a] = x;
  }
  return { min, max };
}

function volume(min: number[], max: number[], eps: number): number {
  return (max[0] - min[0] + eps) * (max[1] - min[1] + eps) * (max[2] - min[2] + eps);
}

/**
 * Greedy split of a cloud into at most `budget` clusters: start with one box
 * around it, then keep cutting whichever box gains the most bounding volume
 * from being cut in two (or three), along any axis of the cloud's frame, at
 * the best cut, until the budget is spent or no cut is worth it. Only the
 * partition is kept: each cluster's box is sized afterwards (`solidBox`).
 */
function splitLeaves(cloud: Cloud, ids: number[], budget: number, opts: { accept?: number; minFrac?: number } = {}): number[][] {
  const accept = opts.accept ?? 0.85;
  const minFrac = opts.minFrac ?? 0.06;
  if (!ids.length) return [];
  const all = bounds(cloud, ids);
  const span = Math.max(all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]);
  const eps = span * 0.02 + 1e-6;
  const minPts = Math.max(8, Math.floor(ids.length * minFrac));
  interface Leaf { ids: number[]; vol: number; cut: { vol: number; parts: number[][] } | null }
  const bestCut = (set: number[]): Leaf['cut'] => {
    if (set.length < minPts * 2) return null;
    let best: Leaf['cut'] = null;
    for (let a = 0; a < 3; a++) {
      const order = set.slice().sort((p, q) => cloud.xyz[p * 3 + a] - cloud.xyz[q * 3 + a]);
      const n = order.length;
      // Two cuts at once, on a coarse grid of equal-count bins. One cut can
      // gain nothing on a shape that is wide at both ends — a staff between
      // two heads, a bone with a joint at each end — however it is placed:
      // whichever half it leaves keeps a wide end. Two cuts take both off.
      const B = Math.min(40, Math.floor(n / minPts));
      if (B >= 3) {
        const bin = (k: number): number => Math.floor((k * n) / B);
        const bnds: number[][] = [];
        for (let j = 0; j < B; j++) {
          const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (let k = bin(j); k < bin(j + 1); k++) {
            const q = order[k] * 3;
            for (let d = 0; d < 3; d++) {
              bb[d] = Math.min(bb[d], cloud.xyz[q + d]);
              bb[d + 3] = Math.max(bb[d + 3], cloud.xyz[q + d]);
            }
          }
          bnds.push(bb);
        }
        const range = (from: number, to: number): number => {
          const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (let j = from; j < to; j++) for (let d = 0; d < 3; d++) {
            bb[d] = Math.min(bb[d], bnds[j][d]);
            bb[d + 3] = Math.max(bb[d + 3], bnds[j][d + 3]);
          }
          return volume([bb[0], bb[1], bb[2]], [bb[3], bb[4], bb[5]], eps);
        };
        for (let i = 1; i < B - 1; i++) for (let j = i + 1; j < B; j++) {
          const v = range(0, i) + range(i, j) + range(j, B);
          // scored per box spent, against a single cut's one extra box
          const score = v + (range(0, B) - v) / 2;
          if (!best || score < best.vol) {
            best = { vol: score, parts: [order.slice(0, bin(i)), order.slice(bin(i), bin(j)), order.slice(bin(j))] };
          }
        }
      }
      // prefix and suffix bounds, so every cut position costs O(1)
      const pre = new Float64Array(n * 6), suf = new Float64Array(n * 6);
      const acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = 0; k < n; k++) {
        const b = order[k] * 3;
        for (let d = 0; d < 3; d++) {
          acc[d] = Math.min(acc[d], cloud.xyz[b + d]);
          acc[d + 3] = Math.max(acc[d + 3], cloud.xyz[b + d]);
        }
        pre.set(acc, k * 6);
      }
      acc.fill(Infinity, 0, 3); acc.fill(-Infinity, 3, 6);
      for (let k = n - 1; k >= 0; k--) {
        const b = order[k] * 3;
        for (let d = 0; d < 3; d++) {
          acc[d] = Math.min(acc[d], cloud.xyz[b + d]);
          acc[d + 3] = Math.max(acc[d + 3], cloud.xyz[b + d]);
        }
        suf.set(acc, k * 6);
      }
      for (let k = minPts; k <= n - minPts; k++) {
        const l = pre.subarray((k - 1) * 6, k * 6), r = suf.subarray(k * 6, k * 6 + 6);
        const v = volume([l[0], l[1], l[2]], [l[3], l[4], l[5]], eps) + volume([r[0], r[1], r[2]], [r[3], r[4], r[5]], eps);
        if (!best || v < best.vol) best = { vol: v, parts: [order.slice(0, k), order.slice(k)] };
      }
    }
    return best;
  };
  const leaf = (set: number[]): Leaf => {
    const b = bounds(cloud, set);
    return { ids: set, vol: volume(b.min, b.max, eps), cut: bestCut(set) };
  };
  const leaves = [leaf(ids)];
  while (leaves.length < budget) {
    let pick = -1, gain = 0;
    leaves.forEach((l, i) => {
      if (!l.cut || l.cut.vol > l.vol * accept) return;
      if (leaves.length + l.cut.parts.length - 1 > budget) return;
      const g = l.vol - l.cut.vol;
      if (g > gain) { gain = g; pick = i; }
    });
    if (pick < 0) break;
    const l = leaves[pick];
    leaves.splice(pick, 1, ...l.cut!.parts.map(leaf));
  }
  return leaves.map((l) => l.ids);
}

// ---------------------------------------------------------------- solid volume
/**
 * The solid a model encloses, as voxels, each handed to the bone (or node) of
 * the surface nearest it. Voxelized by `voxelize` (geo-core.mjs): the surface
 * rasterised and thickened by `close` voxels, the outside flood-filled from
 * the grid's border, everything the flood cannot reach is solid.
 *
 * Every surface sample stamps its key on the voxel it falls in; the keys then
 * spread through the solid, breadth first, so every inside voxel belongs to
 * the surface nearest it — the torso's core to the torso, a thigh's to the
 * thigh, however the two meet.
 *
 * A voxel the surface runs through counts as half a voxel of solid (`w`):
 * on average half of it is inside. Counted whole, the skin alone adds a
 * quarter to a body's volume at these voxel sizes, and a thin robe or cape
 * comes out a voxel thick either way.
 */
interface Solid { xyz: Float32Array; key: Int32Array; w: Float32Array; n: number; h: number; vol: number; surfFrac: number }
function solidify(tris: number[], samples: Cloud, h: number, close = 1): Solid {
  const T = Float32Array.from(tris);
  const { grid: g, solid, surf } = voxelize(T, h, 4, close) as {
    grid: { n: number[]; o: number[]; size: number; sz: number; idx(i: number, j: number, k: number): number; cell(x: number, y: number, z: number): number[] };
    solid: Uint8Array; surf: Uint8Array;
  };
  const [NX, NY, NZ] = g.n;
  const label = new Int32Array(g.size).fill(-1);
  const queue = new Int32Array(g.size);
  let qt = 0;
  // most samples per voxel wins, so one stray sample does not take a voxel
  const votes = new Map<number, Map<number, number>>();
  for (let i = 0; i < samples.n; i++) {
    const [a, b, c] = g.cell(samples.xyz[i * 3], samples.xyz[i * 3 + 1], samples.xyz[i * 3 + 2]);
    if (a < 0 || b < 0 || c < 0 || a >= NX || b >= NY || c >= NZ) continue;
    const v = g.idx(a, b, c);
    if (!solid[v]) continue;
    let m = votes.get(v);
    if (!m) votes.set(v, m = new Map());
    m.set(samples.key[i], (m.get(samples.key[i]) ?? 0) + 1);
  }
  for (const [v, m] of votes) {
    let best = -1, n = 0;
    for (const [k, c] of m) if (c > n) { n = c; best = k; }
    label[v] = best;
    queue[qt++] = v;
  }
  for (let qh = 0; qh < qt; qh++) {
    const v = queue[qh];
    const i = v % NX, r = (v - i) / NX, j = r % NY, k = (r - j) / NY;
    const nb = [i > 0 ? v - 1 : -1, i < NX - 1 ? v + 1 : -1, j > 0 ? v - NX : -1, j < NY - 1 ? v + NX : -1,
      k > 0 ? v - g.sz : -1, k < NZ - 1 ? v + g.sz : -1];
    for (const w of nb) if (w >= 0 && solid[w] && label[w] < 0) { label[w] = label[v]; queue[qt++] = w; }
  }
  let n = 0, nSurf = 0;
  for (let v = 0; v < g.size; v++) if (label[v] >= 0) { n++; if (surf[v]) nSurf++; }
  const xyz = new Float32Array(n * 3), key = new Int32Array(n), w = new Float32Array(n);
  let o = 0;
  for (let v = 0; v < g.size; v++) {
    if (label[v] < 0) continue;
    const i = v % NX, r = (v - i) / NX, j = r % NY, k = (r - j) / NY;
    xyz[o * 3] = g.o[0] + i * h; xyz[o * 3 + 1] = g.o[1] + j * h; xyz[o * 3 + 2] = g.o[2] + k * h;
    // the surface runs through a surface voxel, so on average half of it is inside
    w[o] = surf[v] ? 0.5 : 1;
    key[o++] = label[v];
  }
  return { xyz, key, w, n, h, vol: (n - nSurf / 2) * h ** 3, surfFrac: n ? nSurf / n : 0 };
}

/** a voxel size giving about `cells` cells across the triangles' bounds, and never coarser than `longest / across` */
function voxelSize(tris: number[], across = 160, cells = 1.5e6): number {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], tris[i]); mx[k] = Math.max(mx[k], tris[i]); }
  const e = [0, 1, 2].map((k) => Math.max(1e-6, mx[k] - mn[k]));
  return Math.max(Math.max(...e) / across, Math.cbrt((e[0] * e[1] * e[2]) / cells));
}

const SQRT12 = Math.sqrt(12);

/**
 * The box one cluster of solid voxels stands for: centred on the cluster's
 * centroid, its sides in proportion to the cluster's spread along each axis
 * (a solid box's side is √12 standard deviations), then scaled together so
 * the box holds exactly the cluster's volume. No side may pass the cluster's
 * own bounds — what one clamps, the others make up — so a box never reaches
 * further than the shape it stands for.
 */
function solidBox(vox: Cloud, ids: number[], cellVol: number): { c: number[]; s: number[]; bound: number } {
  const cell = Math.cbrt(cellVol);
  const n = ids.length;
  // a voxel cloud carries each voxel's share of solid in its red channel
  let filled = 0;
  for (const i of ids) filled += vox.rgb[i * 3];
  const mean = [0, 0, 0], sq = [0, 0, 0];
  const { min, max } = bounds(vox, ids);
  for (const i of ids) for (let a = 0; a < 3; a++) mean[a] += vox.xyz[i * 3 + a];
  for (let a = 0; a < 3; a++) mean[a] /= n;
  for (const i of ids) for (let a = 0; a < 3; a++) { const d = vox.xyz[i * 3 + a] - mean[a]; sq[a] += d * d; }
  const cap = [0, 1, 2].map((a) => max[a] - min[a] + cell);
  // each voxel is a cube, not a point: its own spread adds cell²/12
  const s = [0, 1, 2].map((a) => Math.min(cap[a], Math.max(cell, SQRT12 * Math.sqrt(sq[a] / n + (cell * cell) / 12))));
  const target = filled * cellVol;
  for (let iter = 0; iter < 4; iter++) {
    const free = [0, 1, 2].filter((a) => s[a] < cap[a] - 1e-9);
    const vol = s[0] * s[1] * s[2];
    if (!free.length || Math.abs(vol / target - 1) < 1e-4) break;
    const k = Math.pow(target / vol, 1 / free.length);
    for (const a of free) s[a] = Math.min(cap[a], s[a] * k);
  }
  // inside the cluster's bounds: a lopsided cluster's centroid sits off the middle
  const c = mean.map((m, a) => {
    const lo = min[a] - cell / 2 + s[a] / 2, hi = max[a] + cell / 2 - s[a] / 2;
    return Math.min(Math.max(m, Math.min(lo, hi)), Math.max(lo, hi));
  });
  return { c, s, bound: cap[0] * cap[1] * cap[2] };
}

/**
 * Boxes for one bone's (node's, prop's) solid: the voxels `vids` of `vox`,
 * cut into at most `budget` clusters in the frame `R` (its columns are the
 * box axes, in the cloud's frame; null = the cloud's own axes), a box per
 * cluster sized to its volume (`solidBox`). Colours come from the surface
 * samples `sids` of `samp`, each to the box nearest it.
 */
function fitSolid(vox: Cloud, vids: number[], samp: Cloud, sids: number[], budget: number, cellVol: number,
  R: THREE.Matrix3 | null, opts: { accept?: number; minFrac?: number } = {}): Box[] {
  if (!vids.length) return [];
  const Rt = R ? R.clone().transpose() : null;
  const turn = (src: Cloud, ids: number[]): Cloud => {
    const out = new Cloud();
    for (const i of ids) {
      _v.set(src.xyz[i * 3], src.xyz[i * 3 + 1], src.xyz[i * 3 + 2]);
      if (Rt) _v.applyMatrix3(Rt);
      out.push(_v, _c.setRGB(src.rgb[i * 3], src.rgb[i * 3 + 1], src.rgb[i * 3 + 2], THREE.LinearSRGBColorSpace), 0);
    }
    return out;
  };
  const v = turn(vox, vids), s = turn(samp, sids);
  const leaves = splitLeaves(v, v.key.map((_, i) => i), budget, opts);
  const boxes = leaves.map((ids) => solidBox(v, ids, cellVol));
  // colour: every surface sample to the box it is in, or nearest outside of
  const sum = boxes.map(() => [0, 0, 0, 0]);
  const all = [0, 0, 0, 0];
  for (let i = 0; i < s.n; i++) {
    let best = 0, bd = Infinity;
    boxes.forEach((b, k) => {
      let d = 0, dc = 0;
      for (let a = 0; a < 3; a++) {
        const o = Math.abs(s.xyz[i * 3 + a] - b.c[a]);
        d += Math.max(0, o - b.s[a] / 2) ** 2;
        dc += (o / b.s[a]) ** 2;
      }
      const score = d + dc * 1e-9;
      if (score < bd) { bd = score; best = k; }
    });
    for (let a = 0; a < 3; a++) { sum[best][a] += s.rgb[i * 3 + a]; all[a] += s.rgb[i * 3 + a]; }
    sum[best][3]++; all[3]++;
  }
  const q = R ? new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(R)) : null;
  return boxes.map((b, k) => {
    const w = sum[k][3] ? sum[k] : all[3] ? all : [0.5, 0.5, 0.5, 1];
    const col = new THREE.Color(w[0] / w[3], w[1] / w[3], w[2] / w[3]).getHex();
    const c = new THREE.Vector3(b.c[0], b.c[1], b.c[2]);
    if (R) c.applyMatrix3(R);
    return { c: c.toArray() as [number, number, number], s: b.s as [number, number, number], col, n: leaves[k].length, q, bound: b.bound };
  });
}

/**
 * `fitSolid` in whichever frame wraps the solid tighter: its own axes, or its
 * principal axes (a sculpt can lie at a slant in its file, a spine bone
 * carries a curved slab of back). Every box holds its cluster's volume either
 * way; the frame is picked by how tightly the clusters' bounds fit.
 */
function fitSolidOriented(vox: Cloud, vids: number[], samp: Cloud, sids: number[], budget: number, cellVol: number,
  opts: { accept?: number; minFrac?: number } = {}): Box[] {
  const bound = (bs: Box[]): number => bs.reduce((s, b) => s + b.bound, 0);
  const local = fitSolid(vox, vids, samp, sids, budget, cellVol, null, opts);
  if (vids.length < 8) return local;
  const oriented = fitSolid(vox, vids, samp, sids, budget, cellVol, principalAxes(vox, vids), opts);
  return bound(oriented) < bound(local) * 0.85 ? oriented : local;
}

/**
 * The cloud's principal axes, as the columns of a rotation: the eigenvectors
 * of its covariance, by Jacobi sweeps (3x3 symmetric, so a handful converge).
 */
function principalAxes(cloud: Cloud, ids: number[]): THREE.Matrix3 {
  const m = [0, 0, 0];
  for (const i of ids) for (let a = 0; a < 3; a++) m[a] += cloud.xyz[i * 3 + a];
  for (let a = 0; a < 3; a++) m[a] /= ids.length;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of ids) {
    const d = [cloud.xyz[i * 3] - m[0], cloud.xyz[i * 3 + 1] - m[1], cloud.xyz[i * 3 + 2] - m[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r][c] += d[r] * d[c];
  }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += A[p][q] * A[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-20) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const R = new THREE.Matrix3().set(V[0][0], V[0][1], V[0][2], V[1][0], V[1][1], V[1][2], V[2][0], V[2][1], V[2][2]);
  if (R.determinant() < 0) R.set(V[0][0], V[0][1], -V[0][2], V[1][0], V[1][1], -V[1][2], V[2][0], V[2][1], -V[2][2]);
  return R;
}

const mm = (x: number): number => Math.round(x * 1000) / 1000;
const sig = (x: number): number => (x === 0 ? 0 : Number(x.toPrecision(4)));

// ---------------------------------------------------------------- characters
/** how many boxes each canonical bone may spend */
const BONE_BUDGET: Partial<Record<BoneName, number>> = {
  hips: 3, spine: 2, chest: 4, neck: 1, head: 3,
  shoulderL: 1, shoulderR: 1, upperArmL: 2, upperArmR: 2, forearmL: 2, forearmR: 2,
  handL: 2, handR: 2, upperLegL: 2, upperLegR: 2, lowerLegL: 2, lowerLegR: 2, footL: 2, footR: 2,
};

/** the order `lod.json` stores a rig's proportions in (see src/characters/lod.ts) */
const PROPORTION_KEYS: (keyof Proportions)[] = ['hipHeight', 'spineLen', 'chestLen', 'neckLen', 'headSize', 'shoulderWidth',
  'upperArmLen', 'forearmLen', 'upperLegLen', 'lowerLegLen', 'hipWidth', 'shoulderRise', 'hipDrop'];

interface CharReport { id: string; height: number; p: Proportions; verts: Record<string, number>; empty: string[]; joints: JointAudit[]; raw: Record<string, number[]> }

// ---------------------------------------------------------------- joint audit
/**
 * Where each joint *should* be, read off the mesh, against where the skeleton
 * puts it. Run on the bind pose (before any retarget), since that is the pose
 * a fix would have to be written into.
 *
 *  - limb joints and the neck: the centroid of the vertices whose weights are
 *    split between the bones either side of the joint (both >= 0.2) — the
 *    seam the skinning bends about, which also sits mid cross-section. Where
 *    too few vertices are shared, the band of each side's vertices within
 *    2 cm of the other side stands in for it.
 *  - the spine chain (pelvis, spine, chest): the centroid of the torso's
 *    horizontal cross-section at the bone head; only the horizontal offset is
 *    meaningful there.
 *
 * Independently of the estimate, each joint's cross-section perpendicular to
 * its limb is taken at the *actual* joint, which says whether the joint is on
 * the limb's centre line (and inside the mesh at all).
 */
export interface JointAudit {
  joint: string;
  method: 'seam' | 'band' | 'slice' | 'none';
  n: number;
  /** actual - estimate, metres, in the model's frame (x = its left, y up, z forward) */
  d: [number, number, number];
  /** the joint as the skeleton has it, and as the mesh says it should be (model frame, metres at the fitted height) */
  at: [number, number, number];
  est?: [number, number, number];
  /** |d|, and its components along and across the limb */
  off: number; along: number; across: number;
  /** distance of the actual joint from the centre of the limb's cross-section there, and that section's mean radius */
  centre: number; radius: number;
}

type Side = BoneName[];
const JOINTS: Array<[string, Side, BoneName, BoneName | null]> = [
  // [name, bones on the parent side, the child bone whose head is the joint, the bone its axis runs to]
  ['pelvis', [], 'hips', 'spine'],
  ['spine', [], 'spine', 'chest'],
  ['chest', [], 'chest', 'neck'],
  ['neck', ['chest', 'spine'], 'neck', 'head'],
  ['head', ['neck'], 'head', null],
  ['shoulder.L', ['shoulderL', 'chest'], 'upperArmL', 'forearmL'],
  ['elbow.L', ['upperArmL'], 'forearmL', 'handL'],
  ['wrist.L', ['forearmL'], 'handL', null],
  ['shoulder.R', ['shoulderR', 'chest'], 'upperArmR', 'forearmR'],
  ['elbow.R', ['upperArmR'], 'forearmR', 'handR'],
  ['wrist.R', ['forearmR'], 'handR', null],
  ['hip.L', ['hips', 'spine'], 'upperLegL', 'lowerLegL'],
  ['knee.L', ['upperLegL'], 'lowerLegL', 'footL'],
  ['ankle.L', ['lowerLegL'], 'footL', null],
  ['hip.R', ['hips', 'spine'], 'upperLegR', 'lowerLegR'],
  ['knee.R', ['upperLegR'], 'lowerLegR', 'footR'],
  ['ankle.R', ['lowerLegR'], 'footR', null],
];
const TORSO = new Set<BoneName>(['hips', 'spine', 'chest', 'neck', 'head']);

function auditJoints(model: { root: THREE.Object3D; nodes: Array<{ obj: THREE.Object3D; canonical: BoneName | null }> },
  canon: Map<THREE.Object3D, BoneName | null>, frame: THREE.Object3D): JointAudit[] {
  // every vertex, bind pose, with its weight summed per canonical bone
  const P: number[] = [];
  const W: Array<Map<BoneName, number>> = [];
  const dom: BoneName[] = [];
  model.root.updateMatrixWorld(true);
  const toFrame = frame.matrixWorld.clone().invert();
  model.root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !visible(mesh)) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    const m = new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld);
    const stride = Math.max(1, Math.ceil(pos.count / 80000));
    for (let i = 0; i < pos.count; i += stride) {
      const w = new Map<BoneName, number>();
      for (let k = 0; k < 4; k++) {
        const wt = sw.getComponent(i, k);
        if (wt <= 0) continue;
        let b: BoneName | null = null;
        for (let a: THREE.Object3D | null = mesh.skeleton.bones[si.getComponent(i, k)]; a && !b; a = a.parent) b = canon.get(a) ?? null;
        if (b) w.set(b, (w.get(b) ?? 0) + wt);
      }
      if (!w.size) continue;
      mesh.getVertexPosition(i, _v).applyMatrix4(m);
      P.push(_v.x, _v.y, _v.z);
      W.push(w);
      let best: BoneName = 'hips', bw = -1;
      for (const [b, x] of w) if (x > bw) { bw = x; best = b; }
      dom.push(best);
    }
  });
  const n = W.length;
  const at = (b: BoneName): THREE.Vector3 | null => {
    const node = model.nodes.find((x) => x.canonical === b);
    return node ? node.obj.getWorldPosition(new THREE.Vector3()).applyMatrix4(toFrame) : null;
  };
  const pt = (i: number): THREE.Vector3 => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);

  /** centre and mean radius of the section through `j` square to `axis`, over vertices dominated by `bones` */
  // how far from a joint its seam and section may reach, scaled to the body
  let top = 0;
  for (let k = 1; k < P.length; k += 3) top = Math.max(top, P[k]);
  const reach = 0.2 * top / 1.8;
  const section = (j: THREE.Vector3, axis: THREE.Vector3, bones: Set<BoneName>, half = 0.015): { c: THREE.Vector3; r: number; n: number } | null => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      if (!bones.has(dom[i])) continue;
      const q = pt(i);
      // near the joint only: a plane through an elbow also cuts the far end
      // of anything else the same bones carry (a gauntlet, a pauldron, a cape)
      if (Math.abs(q.clone().sub(j).dot(axis)) <= half && q.distanceTo(j) < reach) pts.push(q);
    }
    if (pts.length < 6) return null;
    // the section's centre, held in the plane through the joint
    const c = pts.reduce((s, q) => s.add(q), new THREE.Vector3()).divideScalar(pts.length);
    c.addScaledVector(axis, -c.clone().sub(j).dot(axis));
    const r = pts.reduce((s, q) => {
      const d = q.clone().sub(c);
      return s + d.addScaledVector(axis, -d.dot(axis)).length();
    }, 0) / pts.length;
    return { c, r, n: pts.length };
  };

  const out: JointAudit[] = [];
  for (const [joint, parentSide, child, tipBone] of JOINTS) {
    const j = at(child);
    if (!j) continue;
    const tip = tipBone ? at(tipBone) : null;
    const parentAt = parentSide.length ? at(parentSide[0]) : null;
    // the limb's axis through the joint: toward the child's own tip, or else
    // on from the parent
    const axis = tip ? tip.clone().sub(j) : parentAt ? j.clone().sub(parentAt) : new THREE.Vector3(0, 1, 0);
    if (joint === 'pelvis' || joint === 'spine' || joint === 'chest') axis.set(0, 1, 0);
    axis.normalize();
    let est: THREE.Vector3 | null = null;
    let method: JointAudit['method'] = 'none';
    let count = 0;
    if (!parentSide.length) {
      const s = section(j, axis, TORSO, 0.02);
      if (s) { est = s.c; method = 'slice'; count = s.n; }
    } else {
      const parents = new Set(parentSide);
      const sum = new THREE.Vector3();
      let total = 0;
      for (let i = 0; i < n; i++) {
        let wp = 0;
        for (const b of parentSide) wp += W[i].get(b) ?? 0;
        const wc = W[i].get(child) ?? 0;
        if (wp >= 0.2 && wc >= 0.2 && pt(i).distanceTo(j) < reach * 1.5) {
          const k = Math.min(wp, wc);
          sum.addScaledVector(pt(i), k);
          total += k;
          count++;
        }
      }
      if (count >= 12) { est = sum.divideScalar(total); method = 'seam'; } else {
        // the band where the two sides meet: each side's vertices within 2 cm
        // of the other's, found through a 2 cm grid
        const cell = 0.02;
        const key = (q: THREE.Vector3): string => `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)},${Math.floor(q.z / cell)}`;
        const grid = new Map<string, number[]>();
        const side = (i: number): number => (parents.has(dom[i]) ? 1 : dom[i] === child ? 2 : 0);
        for (let i = 0; i < n; i++) {
          if (!side(i)) continue;
          const k = key(pt(i));
          let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
        }
        const band = new THREE.Vector3();
        count = 0;
        for (let i = 0; i < n; i++) {
          const s = side(i);
          if (!s) continue;
          const q = pt(i);
          const cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell), cz = Math.floor(q.z / cell);
          let near = false;
          for (let dx = -1; dx <= 1 && !near; dx++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dz = -1; dz <= 1 && !near; dz++) {
            for (const o of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (side(o) !== s && s !== 0 && pt(o).distanceToSquared(q) < cell * cell) { near = true; break; }
            }
          }
          if (near) { band.add(q); count++; }
        }
        if (count >= 6) { est = band.divideScalar(count); method = 'band'; }
      }
    }
    const limbParent = parentSide.length === 1 && !TORSO.has(parentSide[0]);
    const sectionBones = new Set<BoneName>(limbParent ? [parentSide[0], child] : [child]);
    const s = joint === 'pelvis' || joint === 'spine' || joint === 'chest'
      ? section(j, axis, TORSO, 0.02) : section(j, axis, sectionBones);
    const d = est ? j.clone().sub(est) : new THREE.Vector3();
    // along the limb only means something for a seam; a slice is horizontal by construction
    if (method === 'slice') d.y = 0;
    const along = d.dot(axis);
    const across = d.clone().addScaledVector(axis, -along).length();
    const centre = s ? j.clone().sub(s.c).addScaledVector(axis, -j.clone().sub(s.c).dot(axis)).length() : NaN;
    out.push({
      joint, method, n: count,
      at: [mm(j.x), mm(j.y), mm(j.z)],
      ...(est ? { est: [mm(est.x), mm(method === 'slice' ? j.y : est.y), mm(est.z)] as [number, number, number] } : {}),
      d: [mm(d.x), mm(d.y), mm(d.z)], off: mm(d.length()), along: mm(along), across: mm(across),
      centre: mm(centre), radius: mm(s?.r ?? NaN),
    });
  }
  return out;
}

async function measureChar(id: string, height: number): Promise<{ data: unknown; report: CharReport } | null> {
  const rig = buildRig(HUMAN);
  const model = await loadAuthored(id, height);
  if (!model) return null;
  rig.root.add(model.root);
  rig.root.updateMatrixWorld(true);

  // canonical bone for every authored node: its own, or the nearest mapped ancestor's
  const canon = new Map<THREE.Object3D, BoneName | null>();
  model.nodes.forEach((n) => canon.set(n.obj, n.canonical ?? (n.parent >= 0 ? canon.get(model.nodes[n.parent].obj) ?? null : null)));
  // the joints are audited in the bind pose, before our rest pose is put on
  const joints = auditJoints(model, canon, rig.root);
  retarget(rig, model, null);
  rig.root.updateMatrixWorld(true);
  const at = (b: BoneName): THREE.Vector3 | null => {
    const n = model.nodes.find((x) => x.canonical === b);
    return n ? n.obj.getWorldPosition(new THREE.Vector3()) : null;
  };
  const mapped = BONES.filter((b) => at(b)).map((b) => [b, at(b)!] as const);
  const nearest = (p: THREE.Vector3): BoneName => {
    let best: BoneName = 'hips', d = Infinity;
    for (const [b, q] of mapped) { const e = q.distanceToSquared(p); if (e < d) { d = e; best = b; } }
    return best;
  };
  const avg = (a: THREE.Vector3 | null, b: THREE.Vector3 | null): THREE.Vector3 =>
    a && b ? a.clone().add(b).multiplyScalar(0.5) : (a ?? b ?? new THREE.Vector3()).clone();

  // ---- the rig, measured off the authored skeleton ----
  const raw = Object.fromEntries(mapped.map(([b, q]) => [b, q.toArray().map(mm)]));
  const thighL = at('upperLegL'), thighR = at('upperLegR');
  const shinL = at('lowerLegL'), shinR = at('lowerLegR');
  const footL = at('footL'), footR = at('footR');
  const armL = at('upperArmL'), armR = at('upperArmR');
  const foreL = at('forearmL'), foreR = at('forearmR');
  const handL = at('handL'), handR = at('handR');
  const thigh = avg(thighL, thighR), arm = avg(armL, armR), foot = avg(footL, footR);
  // The joints as the sculpt has them — right or wrong (see the joint audit),
  // they are what the authored skin bends about, and the stand-in is meant to
  // move the way the sculpt does.
  const hipsY = at('hips')?.y ?? thigh.y + 0.02;
  const spineY = at('spine')?.y ?? hipsY + 0.1;
  const chestY = at('chest')?.y ?? spineY + 0.2;
  const neckY = at('neck')?.y ?? height * 0.82;
  const dist = (a: THREE.Vector3 | null, b: THREE.Vector3 | null): number | null => (a && b ? a.distanceTo(b) : null);
  const mean = (...xs: Array<number | null>): number => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0;
  };
  const upperLegLen = mean(dist(thighL, shinL), dist(thighR, shinR)) || HUMAN.upperLegLen;
  const p: Proportions = {
    hipHeight: hipsY,
    spineLen: Math.max(0.03, spineY - hipsY),
    chestLen: Math.max(0.03, chestY - spineY),
    neckLen: Math.max(0.03, neckY - chestY),
    headSize: Math.max(0.12, height - neckY),
    shoulderWidth: Math.max(0.08, (armL && armR ? Math.abs(armL.x - armR.x) / 2 : HUMAN.shoulderWidth + 0.06) - 0.06),
    upperArmLen: mean(dist(armL, foreL), dist(armR, foreR)) || HUMAN.upperArmLen,
    forearmLen: mean(dist(foreL, handL), dist(foreR, handR)) || HUMAN.forearmLen,
    upperLegLen,
    lowerLegLen: Math.max(0.15, thigh.y - foot.y - upperLegLen),
    hipWidth: thighL && thighR ? Math.abs(thighL.x - thighR.x) / 2 : HUMAN.hipWidth,
    shoulderRise: arm.y - chestY,
    hipDrop: hipsY - thigh.y,
  };
  for (const k of Object.keys(p) as (keyof Proportions)[]) p[k] = mm(p[k]!);

  // ---- where each part sits on that rig ----
  const lod = buildRig(p);
  lod.root.updateMatrixWorld(true);
  const lodAt = Object.fromEntries(BONES.map((b) => [b, lod.bones[b].getWorldPosition(new THREE.Vector3())])) as Record<BoneName, THREE.Vector3>;
  const cloud = new Cloud();     // surface samples, in their bone's frame
  const world = new Cloud();     // the same, in the model's frame
  const tris: number[] = [];
  const cx = arm.x;   // the sculpt's own centre line, not assumed to be x = 0
  const local = (pt: THREE.Vector3, b: BoneName): THREE.Vector3 => pt.clone().sub(lodAt[b]).setX(pt.x - cx - lodAt[b].x);
  eachVertex(model.root, rig.root, (pt, c, driver) => {
    let b = canon.get(driver) ?? null;
    if (!b) {
      // a rigid part, or a bone outside every mapped chain: the nearest bone
      for (let a: THREE.Object3D | null = driver; a && !b; a = a.parent) b = canon.get(a) ?? null;
      b ??= nearest(pt);
    }
    cloud.push(local(pt, b), c, BONES.indexOf(b));
    world.push(pt, c, BONES.indexOf(b));
  }, 40000, tris);

  // the solid, voxel by voxel, each voxel in the frame of the bone it goes to
  const h = height / 130;
  const solid = solidify(tris, world, h);
  const vox = new Cloud();
  const _p = new THREE.Vector3();
  for (let i = 0; i < solid.n; i++) {
    _p.set(solid.xyz[i * 3], solid.xyz[i * 3 + 1], solid.xyz[i * 3 + 2]);
    vox.push(local(_p, BONES[solid.key[i]]), _t.setRGB(solid.w[i], 0, 0), solid.key[i]);
  }

  const byKey = (c: Cloud): Map<number, number[]> => {
    const m = new Map<number, number[]>();
    c.key.forEach((k, i) => { let l = m.get(k); if (!l) m.set(k, l = []); l.push(i); });
    return m;
  };
  const byBone = byKey(cloud), voxByBone = byKey(vox);
  const parts: number[][] = [];
  const verts: Record<string, number> = {};
  const empty: string[] = [];
  BONES.forEach((b, bi) => {
    const ids = byBone.get(bi);
    if (!BONE_BUDGET[b]) return;
    const vids = voxByBone.get(bi);
    if (!ids?.length || !vids?.length) { empty.push(b); return; }
    verts[b] = ids.length;
    for (const box of fitSolid(vox, vids, cloud, ids, BONE_BUDGET[b]!, h * h * h, limbFrame(b, at))) {
      parts.push([bi, ...box.c.map(mm), ...box.s.map(mm), box.col, ...turnOf(box.q)]);
    }
  });

  // The crown: the box that reaches highest is the top of the head (or hat),
  // and a head is round where a box is not — held to the same volume its box
  // comes out a couple of centimetres short of the crown. Stretch it up to the
  // sculpt's own top and draw it in to keep its volume, so the stand-in
  // stands exactly as tall as the model.
  let top = -Infinity;
  for (let i = 1; i < tris.length; i += 3) top = Math.max(top, tris[i]);
  const crown = parts.filter((r) => r.length < 12).reduce<number[] | null>((best, r) =>
    (!best || lodAt[BONES[r[0]]].y + r[2] + r[5] / 2 > lodAt[BONES[best[0]]].y + best[2] + best[5] / 2 ? r : best), null);
  if (crown) {
    const y0 = lodAt[BONES[crown[0]]].y + crown[2] - crown[5] / 2;
    const sy = top - y0;
    if (sy > crown[5] && sy < crown[5] * 1.6) {
      const k = Math.sqrt(crown[5] / sy);
      crown[2] = mm(top - lodAt[BONES[crown[0]]].y - sy / 2);
      crown[5] = mm(sy);
      crown[4] = mm(crown[4] * k);
      crown[6] = mm(crown[6] * k);
    }
  }

  const standIn = (rows: number[][]): Reach => reach(rows.map((r) => ({
    m: new THREE.Matrix4().makeTranslation(lodAt[BONES[r[0]]]), c: r.slice(1, 4), s: r.slice(4, 7), q: r.length >= 12 ? r.slice(8, 12) : null,
  })));
  const old = (OLD_LOD as unknown as { chars: Record<string, { parts: number[][] }> }).chars[id];
  record(id, 'char', tris, solid, standIn(parts), old ? standIn(old.parts) : null);
  return { data: { h: height, p: PROPORTION_KEYS.map((k) => p[k] ?? 0), parts }, report: { id, height, p, verts, empty, joints, raw } };
}

/**
 * The frame a limb bone's boxes are fitted in: turned from straight down (the
 * way the stand-in's limbs hang at rest) onto the sculpt's own bone, so a
 * forearm held a little out from the body gets a box along it, not one as
 * wide as its slant. The torso, head, shoulders and feet stay square to the
 * body. `at` is where the posed sculpt has each bone.
 */
const LIMB_TIP: Partial<Record<BoneName, [BoneName, BoneName]>> = {
  upperArmL: ['upperArmL', 'forearmL'], forearmL: ['forearmL', 'handL'], handL: ['forearmL', 'handL'],
  upperArmR: ['upperArmR', 'forearmR'], forearmR: ['forearmR', 'handR'], handR: ['forearmR', 'handR'],
  upperLegL: ['upperLegL', 'lowerLegL'], lowerLegL: ['lowerLegL', 'footL'],
  upperLegR: ['upperLegR', 'lowerLegR'], lowerLegR: ['lowerLegR', 'footR'],
};
function limbFrame(b: BoneName, at: (b: BoneName) => THREE.Vector3 | null): THREE.Matrix3 | null {
  const ends = LIMB_TIP[b];
  if (!ends) return null;
  const from = at(ends[0]), to = at(ends[1]);
  if (!from || !to) return null;
  const d = to.clone().sub(from);
  if (d.lengthSq() < 1e-8) return null;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
  // a limb that hangs within a degree of straight down needs no turn
  if (2 * Math.acos(Math.min(1, Math.abs(q.w))) < Math.PI / 180) return null;
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
}

const turnOf = (q: THREE.Quaternion | null): number[] => (q ? q.toArray().map((x) => Math.round(x * 10000) / 10000) : []);

// ---------------------------------------------------------------- the check
/** how much the boxes hold, and how high and low they reach, in the measuring frame */
interface Reach { vol: number; top: number; bottom: number }
function reach(boxes: Array<{ m: THREE.Matrix4; c: number[]; s: number[]; q: number[] | null }>): Reach {
  let vol = 0, top = -Infinity, bottom = Infinity;
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const b of boxes) {
    vol += b.s[0] * b.s[1] * b.s[2] * Math.abs(b.m.determinant());
    if (b.q) q.set(b.q[0], b.q[1], b.q[2], b.q[3]); else q.identity();
    for (let k = 0; k < 8; k++) {
      p.set((k & 1 ? 0.5 : -0.5) * b.s[0], (k & 2 ? 0.5 : -0.5) * b.s[1], (k & 4 ? 0.5 : -0.5) * b.s[2])
        .applyQuaternion(q).add(_v.set(b.c[0], b.c[1], b.c[2])).applyMatrix4(b.m);
      top = Math.max(top, p.y); bottom = Math.min(bottom, p.y);
    }
  }
  return { vol, top, bottom };
}

/** per model: the solid it encloses against the stand-in's boxes, now and as the file had them */
export interface LodStat { id: string; kind: string; h: number; solid: number; surfFrac: number; top: number; bottom: number; now: Reach; was: Reach | null }
const stats: LodStat[] = [];
function record(id: string, kind: string, tris: number[], solid: Solid, now: Reach, was: Reach | null): void {
  let top = -Infinity, bottom = Infinity;
  for (let i = 1; i < tris.length; i += 3) { top = Math.max(top, tris[i]); bottom = Math.min(bottom, tris[i]); }
  const st: LodStat = { id, kind, h: solid.h, solid: solid.vol, surfFrac: solid.surfFrac, top, bottom, now, was };
  stats.push(st);
  log(`  ${id}: solid ${st.solid.toFixed(4)} m³ (surface ${(solid.surfFrac * 100).toFixed(0)}%), boxes ${(now.vol / st.solid).toFixed(2)}x${was ? ` (was ${(was.vol / st.solid).toFixed(2)}x)` : ''}, top ${top.toFixed(3)} → ${now.top.toFixed(3)}${was ? ` (was ${was.top.toFixed(3)})` : ''}`);
}

// ---------------------------------------------------------------- props
function loadHeld(id: string, size: number, opts: { axis?: 'x' | 'y' | 'z' | 'longest'; ground?: boolean }):
  Promise<{ holder: THREE.Group; root: THREE.Object3D } | null> {
  return new Promise((resolve) => {
    let done = false;
    const holder: THREE.Group = loadProp(id, size, {
      ...opts,
      onLoad: (root) => { if (!done) { done = true; resolve({ holder, root }); } },
      onSettle: () => setTimeout(() => { if (!done) { done = true; resolve(null); } }, 0),
    });
  });
}

async function measureRigid(id: string, size: number, opts: { axis?: 'x' | 'y' | 'z' | 'longest'; ground?: boolean }, budget: number,
  fit: { accept?: number; minFrac?: number } = { accept: 0.95, minFrac: 0.03 }): Promise<unknown> {
  const held = await loadHeld(id, size, opts);
  if (!held) return null;
  const cloud = new Cloud();
  const tris: number[] = [];
  eachVertex(held.root, held.holder, (pt, c) => cloud.push(pt, c, 0), 40000, tris);
  const h = voxelSize(tris);
  const solid = solidify(tris, cloud, h, PROP_CLOSE);
  const vox = new Cloud();
  for (let i = 0; i < solid.n; i++) vox.push(_v.fromArray(solid.xyz, i * 3), _t.setRGB(solid.w[i], 0, 0), 0);
  const boxes = fitSolidOriented(vox, vox.key.map((_, i) => i), cloud, cloud.key.map((_, i) => i), budget, h ** 3, fit);
  const parts = boxes.map((b) => [...b.c.map(mm), ...b.s.map(mm), b.col, ...turnOf(b.q)]);
  const I = new THREE.Matrix4();
  const standIn = (rows: number[][]): Reach => reach(rows.map((r) => ({ m: I, c: r.slice(0, 3), s: r.slice(3, 6), q: r.length >= 11 ? r.slice(7, 11) : null })));
  const old = (OLD_LOD as unknown as { props: Record<string, { parts: number[][] }> }).props[id];
  record(id, 'prop', tris, solid, standIn(parts), old ? standIn(old.parts) : null);
  return { parts };
}

/**
 * How many voxels a prop's or creature's surface is thickened by before the
 * outside is flooded: hard-surface sculpts are kit-bashed from open panels, and
 * a gap a couple of voxels wide would otherwise let the flood hollow them out.
 */
const PROP_CLOSE = 2;

/**
 * A creature: its skeleton as delivered (so the code-built gaits can be
 * generated on the stand-in exactly as on the sculpt) and boxes per bone.
 */
async function measureCreature(id: string, size: number, opts: { axis?: 'x' | 'y' | 'z' | 'longest'; ground?: boolean }): Promise<unknown> {
  const held = await loadHeld(id, size, opts);
  if (!held) return null;
  const { root, holder } = held;
  root.updateMatrixWorld(true);
  // the skeleton: every bone, and every node that has a bone somewhere under it
  const keep = new Set<THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone) for (let a: THREE.Object3D | null = o; a && a !== root; a = a.parent) keep.add(a); });
  const nodes: THREE.Object3D[] = [root];
  const index = new Map<THREE.Object3D, number>([[root, 0]]);
  const walk = (o: THREE.Object3D): void => {
    for (const c of o.children) {
      if (!keep.has(c)) continue;
      index.set(c, nodes.length);
      nodes.push(c);
      walk(c);
    }
  };
  walk(root);

  // the brood's clutch is driven on the sculpt's own eggs; the stand-in wears
  // spheres at the same spots, so its eggs stay out of the body boxes
  let eggs: number[][] | null = null;
  let eggOf: ((mesh: THREE.Mesh, i: number) => number) | null = null;
  if (id === 'krykna_brood') {
    const rack = attachEggRack(root);
    if (rack) {
      eggs = [];
      const o = new THREE.Vector3();
      for (let i = 0; i < BROOD_EGG_RACK; i++) if (rack.spot(i, o)) eggs.push([o.x, o.y, o.z, 0]);
      eggOf = (mesh, i) => { const a = mesh.geometry.getAttribute('aEggIdx'); return a ? Math.round(a.getX(i)) : -1; };
    }
  }

  const cloud = new Cloud();   // surface samples, each in its node's frame
  const flat = new Cloud();    // the same, in the holder's frame
  const tris: number[] = [];
  const inv = nodes.map((n) => n.matrixWorld.clone().invert());
  const holderInv = holder.matrixWorld.clone().invert();
  const eggPts: THREE.Vector3[][] = Array.from({ length: BROOD_EGG_RACK }, () => []);
  eachVertex(root, holder, (pt, c, driver, mesh, i) => {
    const egg = eggOf?.(mesh, i) ?? -1;
    if (egg >= 0) { eggPts[egg]?.push(pt.clone()); return; }
    let k = -1;
    for (let a: THREE.Object3D | null = driver; a && k < 0; a = a.parent) k = index.get(a) ?? -1;
    if (k < 0) k = 0;
    flat.push(pt, c, k);
    // into the node's own frame (pt is in the holder's frame)
    const w = pt.clone().applyMatrix4(holder.matrixWorld);
    cloud.push(w.applyMatrix4(inv[k]), c, k);
  }, 40000, tris, eggOf ? (mesh, i) => eggOf!(mesh, i) >= 0 : undefined);
  if (eggs) eggs.forEach((e, i) => {
    const pts = eggPts[i];
    if (!pts.length) return;
    const c = new THREE.Vector3(e[0], e[1], e[2]);
    e[3] = pts.reduce((s, q) => s + q.distanceTo(c), 0) / pts.length;
  });

  // small clusters fold into their parent node, children first
  const parent = nodes.map((n) => (n === root ? -1 : index.get(n.parent!) ?? 0));
  const count = new Array(nodes.length).fill(0);
  cloud.key.forEach((k) => count[k]++);
  const minCount = Math.max(25, Math.floor(cloud.n * 0.004));
  const owner = nodes.map((_, i) => i);
  for (let i = nodes.length - 1; i > 0; i--) {
    if (count[i] < minCount && parent[i] >= 0) { count[parent[i]] += count[i]; count[i] = 0; owner[i] = parent[i]; }
  }
  const resolve = (k: number): number => { while (owner[k] !== k) k = owner[k]; return k; };
  const groups = new Map<number, number[]>();
  // points move into an ancestor's frame along with their cluster
  const _w = new THREE.Vector3();
  cloud.key.forEach((k, i) => {
    const to = resolve(k);
    if (to !== k) {
      _w.set(cloud.xyz[i * 3], cloud.xyz[i * 3 + 1], cloud.xyz[i * 3 + 2]).applyMatrix4(nodes[k].matrixWorld).applyMatrix4(inv[to]);
      cloud.xyz[i * 3] = _w.x; cloud.xyz[i * 3 + 1] = _w.y; cloud.xyz[i * 3 + 2] = _w.z;
      cloud.key[i] = to;
    }
    let l = groups.get(to); if (!l) groups.set(to, l = []); l.push(i);
  });
  // the solid, each voxel in the frame of the node its surface went to
  const h = voxelSize(tris);
  const solid = solidify(tris, flat, h, PROP_CLOSE);
  const vox = new Cloud();
  const toNode = nodes.map((_, k) => inv[k].clone().multiply(holder.matrixWorld));
  const voxGroups = new Map<number, number[]>();
  for (let i = 0; i < solid.n; i++) {
    const to = resolve(solid.key[i]);
    vox.push(_v.fromArray(solid.xyz, i * 3).applyMatrix4(toNode[to]), _t.setRGB(solid.w[i], 0, 0), to);
    let l = voxGroups.get(to); if (!l) voxGroups.set(to, l = []); l.push(i);
  }
  const parts: number[][] = [];
  for (const [k, ids] of groups) {
    const vids = voxGroups.get(k);
    if (!vids?.length) continue;
    const budget = ids.length > cloud.n * 0.15 ? 5 : ids.length > cloud.n * 0.05 ? 3 : ids.length > cloud.n * 0.02 ? 2 : 1;
    // a voxel's volume in the node's own units (a node can carry a scale)
    const cellVol = h ** 3 * Math.abs(toNode[k].determinant());
    for (const b of fitSolidOriented(vox, vids, cloud, ids, budget, cellVol)) {
      parts.push([k, ...b.c.map(sig), ...b.s.map(sig), b.col, ...turnOf(b.q)]);
    }
  }
  const toHolder = nodes.map((n) => holderInv.clone().multiply(n.matrixWorld));
  const standIn = (rows: number[][]): Reach => reach(rows.map((r) => ({
    m: toHolder[r[0]], c: r.slice(1, 4), s: r.slice(4, 7), q: r.length >= 12 ? r.slice(8, 12) : null,
  })));
  const old = (OLD_LOD as unknown as { creatures: Record<string, { parts: number[][] }> }).creatures[id];
  record(id, 'creature', tris, solid, standIn(parts), old ? standIn(old.parts) : null);
  const t = (n: THREE.Object3D): number[] => [
    ...n.position.toArray().map(sig), ...n.quaternion.toArray().map((x) => Math.round(x * 10000) / 10000),
    sig(n.scale.x), sig(n.scale.y), sig(n.scale.z),
  ];
  return {
    nodes: nodes.map((n, i) => [n === root ? '' : n.name, parent[i], ...t(n)]),
    parts,
    ...(eggs ? { eggs: eggs.map((e) => e.map(mm)) } : {}),
  };
}

// ---------------------------------------------------------------- run
async function main(): Promise<void> {
  const only = new URLSearchParams(location.search).get('only')?.split(',') ?? null;
  const want = (id: string): boolean => !only || only.includes(id);
  const out: { chars: Record<string, unknown>; creatures: Record<string, unknown>; props: Record<string, unknown> } =
    { chars: {}, creatures: {}, props: {} };
  const reports: CharReport[] = [];

  // characters: the heroes by their fitted heights, then each distinct enemy sculpt
  const chars = new Map<string, number>(Object.entries(MODEL_HEIGHT));
  for (const e of Object.values(ENEMY_MODELS) as Array<{ model: string; height?: number }>) {
    if (e.height && !chars.has(e.model)) chars.set(e.model, e.height);
  }
  for (const [id, h] of chars) {
    if (!want(id)) continue;
    try {
      const r = await measureChar(id, h);
      if (r) { out.chars[id] = r.data; reports.push(r.report); log(`char ${id}: ${(r.data as { parts: unknown[] }).parts.length} parts`); } else log(`char ${id}: no model`);
    } catch (err) { log(`char ${id}: FAILED ${err}`); }
  }

  // creatures on their own rigs, sized as loadCreature sizes them
  for (const [id, h] of Object.entries(CREATURE_MODELS)) {
    if (!want(id)) continue;
    try {
      const r = await measureCreature(id, h, { axis: 'y', ground: true });
      if (r) { out.creatures[id] = r; log(`creature ${id}: ${(r as { nodes: unknown[] }).nodes.length} nodes, ${(r as { parts: unknown[] }).parts.length} parts`); }
    } catch (err) { log(`creature ${id}: FAILED ${err}`); }
  }
  if (want('sandworm')) {
    const r = await measureCreature('sandworm', 40, { axis: 'longest' });
    if (r) { out.creatures.sandworm = r; log(`creature sandworm: ${(r as { parts: unknown[] }).parts.length} parts`); }
  }

  // weapons at their hand-mount lengths
  for (const [id, spec] of Object.entries(WEAPON_PROPS)) {
    if (!want(id)) continue;
    const r = await measureRigid(id, spec.length, { axis: 'longest' }, spec.family === 'saber' ? 4 : 7);
    if (r) { out.props[id] = r; log(`prop ${id}: ${(r as { parts: unknown[] }).parts.length} parts`); }
  }
  // the rides, as vehicles.ts fits them
  for (const def of Object.values(VEHICLE_DEFS)) {
    if (!def.modelId || !want(def.modelId) || out.props[def.modelId]) continue;
    // A ride is big, and carries a rider whose seat is found by probing the
    // body's top (vehicles.ts `seatSurface`), so it gets the full budget: any
    // cut that trims a little volume is taken, down to small clusters. At a
    // weapon's settings the swoop came out as six boxes whose top stood a
    // hand over the real saddle.
    const r = await measureRigid(def.modelId, def.modelSize ?? def.length, { axis: def.modelAxis ?? 'longest', ground: def.modelGround }, 14,
      { accept: 0.99, minFrac: 0.01 });
    if (r) { out.props[def.modelId] = r; log(`vehicle ${def.modelId}: ${(r as { parts: unknown[] }).parts.length} parts`); }
  }

  (window as unknown as { __lod: unknown }).__lod = { data: out, reports, stats };
}

main().catch((err) => {
  log(`FAILED ${err?.stack ?? err}`);
  (window as unknown as { __lod: unknown }).__lod = { error: String(err) };
});
