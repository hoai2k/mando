/**
 * A very small GLB reader, for looking inside the delivered sculpts.
 *
 * The models in `public/models` arrive from a generator and are occasionally
 * wrong in ways no amount of code around them can see — a lump of geometry
 * floating off a shoulder, welded to nothing, inside the same skinned mesh as
 * the body. Finding that means reading the container, which is what this is
 * for: the two chunks a .glb is, the accessors inside them (decompressed and
 * de-interleaved, since these files are meshopt-compressed and quantised), and
 * the connected pieces a primitive's triangles fall into.
 *
 * Read-only on purpose. Nothing here writes a model back: the files on disk
 * stay exactly as delivered and the fixes are applied at load
 * (`src/characters/strays.ts`), so a redelivery costs a re-run of a tool
 * rather than an edit somebody has to remember to make again.
 */
import { readFileSync } from 'node:fs';
import { MeshoptDecoder } from '../../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';

const MAGIC = 0x46546c67;      // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const BIN_CHUNK = 0x004e4942;  // 'BIN\0'

const COMPONENT = {
  5120: { array: Int8Array, size: 1 },
  5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 },
  5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 },
  5126: { array: Float32Array, size: 4 },
};
const ITEMS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path) {
  const buf = readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC) throw new Error(`${path}: not a .glb`);
  const version = buf.readUInt32LE(4);
  let at = 12;
  let json = null;
  let bin = null;
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === JSON_CHUNK) json = JSON.parse(body.toString('utf8'));
    else if (type === BIN_CHUNK) bin = Buffer.from(body);
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json || !bin) throw new Error(`${path}: expected a JSON chunk and a BIN chunk`);
  return { version, json, bin };
}

/**
 * One buffer view's bytes, decompressed where the file says they are.
 *
 * These sculpts ship under `EXT_meshopt_compression`, so the bytes in the file
 * are not the bytes an accessor reads: the extension names a compressed blob
 * and the shape to expand it into. Decoded views are cached per file, since a
 * primitive asks for the same one several times over.
 */
export function viewBytes(glb, i) {
  glb._views ??= new Map();
  const had = glb._views.get(i);
  if (had) return had;
  const v = glb.json.bufferViews[i];
  const ext = v.extensions?.EXT_meshopt_compression;
  let out;
  if (!ext) {
    const at = v.byteOffset ?? 0;
    out = new Uint8Array(glb.bin.subarray(at, at + v.byteLength));
  } else {
    out = new Uint8Array(ext.count * ext.byteStride);
    const at = ext.byteOffset ?? 0;
    const src = new Uint8Array(glb.bin.subarray(at, at + ext.byteLength));
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter);
  }
  glb._views.set(i, out);
  return out;
}

/** the decoder has to be up before any compressed view is read */
export const decoderReady = MeshoptDecoder.ready;

/**
 * A typed view onto accessor `i`, de-interleaved if it needs to be.
 *
 * Quantised attributes (`KHR_mesh_quantization`) are padded to a stride wider
 * than the values themselves — a three-short position inside eight bytes —
 * so an accessor is not always a tightly packed array and has to be gathered
 * element by element when it is not.
 */
export function accessor(glb, i) {
  const acc = glb.json.accessors[i];
  const comp = COMPONENT[acc.componentType];
  const items = ITEMS[acc.type];
  if (!comp || !items) throw new Error(`accessor ${i}: unsupported ${acc.componentType}/${acc.type}`);
  const view = glb.json.bufferViews[acc.bufferView];
  const bytes = viewBytes(glb, acc.bufferView);
  const start = acc.byteOffset ?? 0;
  const packed = comp.size * items;
  const stride = view.byteStride || packed;
  let data;
  if (stride === packed) {
    data = new comp.array(bytes.buffer, bytes.byteOffset + start, acc.count * items);
  } else {
    data = new comp.array(acc.count * items);
    for (let e = 0; e < acc.count; e++) {
      const row = new comp.array(bytes.buffer, bytes.byteOffset + start + e * stride, items);
      for (let k = 0; k < items; k++) data[e * items + k] = row[k];
    }
  }
  return { data, count: acc.count, items, acc, view, comp };
}

/**
 * Every primitive in the file, with its positions and indices already read.
 * A mesh with no indices is given the implied 0,1,2,… so callers have one
 * shape to work with.
 */
export function primitives(glb) {
  const out = [];
  (glb.json.meshes ?? []).forEach((mesh, mi) => {
    (mesh.primitives ?? []).forEach((prim, pi) => {
      if (prim.attributes?.POSITION === undefined) return;
      const pos = accessor(glb, prim.attributes.POSITION);
      const idx = prim.indices !== undefined ? accessor(glb, prim.indices) : null;
      const indices = idx ? idx.data : Uint32Array.from({ length: pos.count }, (_, k) => k);
      out.push({ mesh: mi, prim: pi, name: mesh.name ?? `mesh ${mi}`, spec: prim, pos, idx, indices });
    });
  });
  return out;
}

/**
 * The connected pieces of one primitive.
 *
 * Vertices are welded by position first: a sculpt splits vertices at every UV
 * and normal seam, so triangles that plainly share an edge do not share an
 * index, and a body would otherwise come back as a hundred "pieces". Welding
 * to a tenth of a millimetre puts it back together, and what is left apart is
 * genuinely apart — which is what a lump floating off a shoulder is.
 */
export function components(prim, weld = 1e-4) {
  const { data } = prim.pos;
  const n = prim.pos.count;
  const key = new Map();
  const weldOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(data[i * 3] / weld)},${Math.round(data[i * 3 + 1] / weld)},${Math.round(data[i * 3 + 2] / weld)}`;
    let id = key.get(k);
    if (id === undefined) { id = key.size; key.set(k, id); }
    weldOf[i] = id;
  }
  const parent = new Int32Array(key.size).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const tris = prim.indices.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = weldOf[prim.indices[t * 3]], b = weldOf[prim.indices[t * 3 + 1]], c = weldOf[prim.indices[t * 3 + 2]];
    union(a, b); union(b, c);
  }
  const byRoot = new Map();
  for (let t = 0; t < tris; t++) {
    const root = find(weldOf[prim.indices[t * 3]]);
    let g = byRoot.get(root);
    if (!g) {
      g = { tris: [], verts: new Set(), min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      byRoot.set(root, g);
    }
    g.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const v = prim.indices[t * 3 + k];
      g.verts.add(v);
      for (let ax = 0; ax < 3; ax++) {
        const c = data[v * 3 + ax];
        if (c < g.min[ax]) g.min[ax] = c;
        if (c > g.max[ax]) g.max[ax] = c;
      }
    }
  }
  return [...byRoot.values()]
    .map((g) => ({
      tris: g.tris,
      triCount: g.tris.length,
      vertCount: g.verts.size,
      min: g.min,
      max: g.max,
      size: [g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2]],
      centre: [(g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2, (g.min[2] + g.max[2]) / 2],
    }))
    .sort((a, b) => b.triCount - a.triCount);
}
