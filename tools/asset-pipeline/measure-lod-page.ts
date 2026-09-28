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
 * Each vertex goes to the bone that drives it most (its dominant skin weight),
 * mapped to the canonical bone the retargeter drives it by, and each bone's
 * cloud is fitted with a few boxes by greedy volume-reducing splits. Colours
 * are the material colour times the base-colour texture, averaged per box.
 */
import * as THREE from 'three';
import { CREATURE_MODELS, ENEMY_MODELS, loadAuthored, loadProp, retarget } from '../../src/characters/authored';
import { BONES, buildRig, HUMAN, type BoneName, type Proportions } from '../../src/anim/skeleton';
import { MODEL_HEIGHT } from '../../src/characters/mandalorians';
import { WEAPON_PROPS } from '../../src/characters/weaponProps';
import { VEHICLE_DEFS } from '../../src/game/vehicles';
import { attachEggRack, BROOD_EGG_RACK } from '../../src/characters/eggrack';

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
): void {
  root.updateMatrixWorld(true);
  const toFrame = frame.matrixWorld.clone().invert();
  interface Prep { mesh: THREE.Mesh; P: Float32Array; tris: Uint32Array; area: Float64Array; total: number }
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
    const tris = new Uint32Array(n);
    for (let k = 0; k < n; k++) tris[k] = index ? index.getX(k) : k;
    const area = new Float64Array(n / 3);
    let sum = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < n / 3; t++) {
      A.fromArray(P, tris[t * 3] * 3); B.fromArray(P, tris[t * 3 + 1] * 3); C.fromArray(P, tris[t * 3 + 2] * 3);
      area[t] = B.sub(A).cross(C.sub(A)).length() / 2;
      sum += area[t];
    }
    preps.push({ mesh, P, tris, area, total: sum });
    total += sum;
  });
  if (!(total > 0)) return;
  const rand = rng(0x5eed);
  const perArea = maxPoints / total;
  for (const { mesh, P, tris, area } of preps) {
    const geo = mesh.geometry;
    const uv = geo.attributes.uv;
    const col = geo.attributes.color;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    const matOf = new Int16Array(geo.attributes.position.count);
    if (geo.groups.length && mats.length > 1) {
      for (const g of geo.groups) {
        const end = Math.min(g.start + g.count, tris.length);
        for (let k = g.start; k < end; k++) matOf[tris[k]] = g.materialIndex ?? 0;
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
        const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
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
interface Box { c: [number, number, number]; s: [number, number, number]; col: number; n: number }

function trimmedBounds(cloud: Cloud, ids: number[], trim: number): { min: number[]; max: number[] } {
  const min = [0, 0, 0], max = [0, 0, 0];
  const vals = new Float64Array(ids.length);
  for (let a = 0; a < 3; a++) {
    for (let k = 0; k < ids.length; k++) vals[k] = cloud.xyz[ids[k] * 3 + a];
    vals.sort();
    const lo = Math.floor(trim * (ids.length - 1));
    const hi = Math.ceil((1 - trim) * (ids.length - 1));
    min[a] = vals[lo];
    max[a] = vals[hi];
  }
  return { min, max };
}

function volume(min: number[], max: number[], eps: number): number {
  return (max[0] - min[0] + eps) * (max[1] - min[1] + eps) * (max[2] - min[2] + eps);
}

/**
 * Greedy box split: start with one box around the cloud, then keep cutting
 * whichever box gains the most volume from being cut in two (along any axis,
 * at the best cut), until the budget is spent or no cut is worth it.
 */
function fitBoxes(cloud: Cloud, ids: number[], budget: number, opts: { accept?: number; trim?: number; minFrac?: number } = {}): Box[] {
  const accept = opts.accept ?? 0.85;
  const trim = opts.trim ?? 0.01;
  const minFrac = opts.minFrac ?? 0.06;
  if (!ids.length) return [];
  const all = trimmedBounds(cloud, ids, 0);
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
        const bounds: number[][] = [];
        for (let j = 0; j < B; j++) {
          const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (let k = bin(j); k < bin(j + 1); k++) {
            const q = order[k] * 3;
            for (let d = 0; d < 3; d++) {
              bb[d] = Math.min(bb[d], cloud.xyz[q + d]);
              bb[d + 3] = Math.max(bb[d + 3], cloud.xyz[q + d]);
            }
          }
          bounds.push(bb);
        }
        const range = (from: number, to: number): number => {
          const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (let j = from; j < to; j++) for (let d = 0; d < 3; d++) {
            bb[d] = Math.min(bb[d], bounds[j][d]);
            bb[d + 3] = Math.max(bb[d + 3], bounds[j][d + 3]);
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
    const b = trimmedBounds(cloud, set, 0);
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
  return leaves.map((l) => {
    const b = trimmedBounds(cloud, l.ids, l.ids.length > 60 ? trim : 0);
    let r = 0, g = 0, bl = 0;
    for (const i of l.ids) { r += cloud.rgb[i * 3]; g += cloud.rgb[i * 3 + 1]; bl += cloud.rgb[i * 3 + 2]; }
    const n = l.ids.length;
    const col = new THREE.Color(r / n, g / n, bl / n).getHex();
    const floor = span * 0.015;
    return {
      c: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2],
      s: [Math.max(floor, b.max[0] - b.min[0]), Math.max(floor, b.max[1] - b.min[1]), Math.max(floor, b.max[2] - b.min[2])],
      col, n,
    };
  });
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
  const cloud = new Cloud();
  const cx = arm.x;   // the sculpt's own centre line, not assumed to be x = 0
  eachVertex(model.root, rig.root, (pt, c, driver) => {
    let b = canon.get(driver) ?? null;
    if (!b) {
      // a rigid part, or a bone outside every mapped chain: the nearest bone
      for (let a: THREE.Object3D | null = driver; a && !b; a = a.parent) b = canon.get(a) ?? null;
      b ??= nearest(pt);
    }
    cloud.push(pt.clone().sub(lodAt[b]).setX(pt.x - cx - lodAt[b].x), c, BONES.indexOf(b));
  });

  const byBone = new Map<number, number[]>();
  cloud.key.forEach((k, i) => { let l = byBone.get(k); if (!l) byBone.set(k, l = []); l.push(i); });
  const parts: number[][] = [];
  const verts: Record<string, number> = {};
  const empty: string[] = [];
  BONES.forEach((b, bi) => {
    const ids = byBone.get(bi);
    if (!BONE_BUDGET[b]) return;
    if (!ids?.length) { empty.push(b); return; }
    verts[b] = ids.length;
    for (const box of fitBoxes(cloud, ids, BONE_BUDGET[b]!)) {
      parts.push([bi, ...box.c.map(mm), ...box.s.map(mm), box.col]);
    }
  });
  return { data: { h: height, p: PROPORTION_KEYS.map((k) => p[k] ?? 0), parts }, report: { id, height, p, verts, empty, joints, raw } };
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
  fit: Parameters<typeof fitBoxes>[3] = { accept: 0.95, minFrac: 0.03, trim: 0.004 }): Promise<unknown> {
  const held = await loadHeld(id, size, opts);
  if (!held) return null;
  const cloud = new Cloud();
  eachVertex(held.root, held.holder, (pt, c) => cloud.push(pt, c, 0));
  const ids = cloud.key.map((_, i) => i);
  const { boxes, q } = fitOriented(cloud, ids, budget, fit);
  const turn = q ? q.toArray().map((x) => Math.round(x * 10000) / 10000) : [];
  return { parts: boxes.map((b) => [...b.c.map(mm), ...b.s.map(mm), b.col, ...turn]) };
}

/**
 * Boxes around a cloud in whichever frame wraps it tighter: its own axes, or
 * its principal axes (a sculpt can lie at a slant in its file, a spine bone
 * carries a curved slab of back). Centres come back in the cloud's own frame;
 * `q` is the turn of the boxes when they were fitted in the principal frame.
 */
function fitOriented(cloud: Cloud, ids: number[], budget: number, opts: Parameters<typeof fitBoxes>[3] = {}):
  { boxes: Box[]; q: THREE.Quaternion | null } {
  const volumeOf = (bs: Box[]): number => bs.reduce((s, b) => s + b.s[0] * b.s[1] * b.s[2], 0);
  const local = fitBoxes(cloud, ids, budget, opts);
  const R = principalAxes(cloud, ids);
  const Rt = R.clone().transpose();
  const turned = new Cloud();
  const p = new THREE.Vector3(), c = new THREE.Color();
  for (const i of ids) {
    p.set(cloud.xyz[i * 3], cloud.xyz[i * 3 + 1], cloud.xyz[i * 3 + 2]).applyMatrix3(Rt);
    turned.push(p, c.setRGB(cloud.rgb[i * 3], cloud.rgb[i * 3 + 1], cloud.rgb[i * 3 + 2], THREE.LinearSRGBColorSpace), 0);
  }
  const oriented = fitBoxes(turned, turned.key.map((_, i) => i), budget, opts);
  if (!(volumeOf(oriented) < volumeOf(local) * 0.85)) return { boxes: local, q: null };
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().setFromMatrix3(R));
  for (const b of oriented) b.c = new THREE.Vector3(...b.c).applyMatrix3(R).toArray() as [number, number, number];
  return { boxes: oriented, q };
}

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

  const cloud = new Cloud();
  const inv = nodes.map((n) => n.matrixWorld.clone().invert());
  const holderInv = holder.matrixWorld.clone().invert();
  const eggPts: THREE.Vector3[][] = Array.from({ length: BROOD_EGG_RACK }, () => []);
  eachVertex(root, holder, (pt, c, driver, mesh, i) => {
    const egg = eggOf?.(mesh, i) ?? -1;
    if (egg >= 0) { eggPts[egg]?.push(pt.clone()); return; }
    let k = -1;
    for (let a: THREE.Object3D | null = driver; a && k < 0; a = a.parent) k = index.get(a) ?? -1;
    if (k < 0) k = 0;
    // into the node's own frame (pt is in the holder's frame)
    const w = pt.clone().applyMatrix4(holder.matrixWorld);
    cloud.push(w.applyMatrix4(inv[k]), c, k);
  });
  void holderInv;
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
  const parts: number[][] = [];
  for (const [k, ids] of groups) {
    const budget = ids.length > cloud.n * 0.15 ? 5 : ids.length > cloud.n * 0.05 ? 3 : ids.length > cloud.n * 0.02 ? 2 : 1;
    const { boxes, q } = fitOriented(cloud, ids, budget);
    const turn = q ? q.toArray().map((x) => Math.round(x * 10000) / 10000) : [];
    for (const b of boxes) parts.push([k, ...b.c.map(sig), ...b.s.map(sig), b.col, ...turn]);
  }
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
      { accept: 0.99, minFrac: 0.01, trim: 0.004 });
    if (r) { out.props[def.modelId] = r; log(`vehicle ${def.modelId}: ${(r as { parts: unknown[] }).parts.length} parts`); }
  }

  (window as unknown as { __lod: unknown }).__lod = { data: out, reports };
}

main().catch((err) => {
  log(`FAILED ${err?.stack ?? err}`);
  (window as unknown as { __lod: unknown }).__lod = { error: String(err) };
});
