/**
 * Decimate a shipped model to a triangle budget, keeping its full-resolution
 * original, and carry every per-vertex fix the game applies to it across.
 *
 *   node tools/asset-pipeline/decimate.mjs <id> <triangles> [--dry]
 *
 * The generalisation of `decimate-boba-fett.mjs`, for sculpts that were
 * integrated straight from the generator at 60-120k triangles when
 * docs/ASSETS_MODELS.md budgets a playable at 15k and a grunt at 8k. Twenty of
 * the humanoids came in that way and each is drawn two to four times a frame
 * (every view, every shadow pass), which is most of what split-screen costs.
 *
 * What it does, in order:
 *
 *  1. **Keeps the original.** The first run copies `public/models/<id>.glb`,
 *     and the model's skinfix / strays / jawrig documents, byte for byte to
 *     `public/models/full/`, and every later run reads from there — so a
 *     re-run never decimates an already-decimated file, and putting the
 *     original back is copying those files over the shipped ones. The build
 *     leaves `full/` out of `dist` (vite.config.ts); the workbench can show it
 *     with `?res=full` for a side-by-side check.
 *  2. **Drops the strays first.** Lumps welded to nothing that
 *     `strays/<id>.json` names are removed from the index before
 *     simplification, rather than remapped: their triangle runs would not
 *     survive it. The shipped model then has no strays document at all.
 *  3. **Simplifies each primitive** with meshoptimizer's attribute-aware
 *     simplifier: normals, texture coordinates and skin weights all count
 *     towards the error, so a UV seam, a crease or the boundary between two
 *     bones' territories is kept rather than collapsed across. The error
 *     limit is raised in steps only as far as the budget needs.
 *  4. **Remaps the fixes.** The simplifier only ever keeps a subset of the
 *     original vertices, so every vertex-numbered fix — skinfix `vertices`,
 *     `donors` and `replacements`, jawrig `vertices` — is carried to the new
 *     numbering and loses only the vertices that no longer exist. Each
 *     document's `vertexCount` is updated, which is what the loader matches a
 *     fix to its mesh by.
 *  5. **Writes a clean file**: only what is still referenced, uncompressed
 *     (a budget-sized mesh is small enough that the decoder is not worth it),
 *     with the vertex layout the original used — quantised attributes stay
 *     quantised, padded to glTF's four-byte vertex alignment.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';
import { accessor, decoderReady, readGlb, viewBytes } from '../lib/glb.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODELS = join(ROOT, 'public/models');
const FULL = join(MODELS, 'full');

const [id, budgetArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry');
const budget = Number(budgetArg);
if (!id || !(budget > 0)) {
  console.error('usage: node tools/asset-pipeline/decimate.mjs <id> <triangles> [--dry]');
  process.exit(2);
}

/** the per-model documents that number vertices or triangles */
const SIDECARS = ['skinfix', 'strays', 'jawrig'];

// ---------- 1. the original, kept ----------
const shippedGlb = join(MODELS, `${id}.glb`);
const fullGlb = join(FULL, `${id}.glb`);
if (!existsSync(fullGlb)) {
  if (!dry) {
    mkdirSync(FULL, { recursive: true });
    copyFileSync(shippedGlb, fullGlb);
    for (const kind of SIDECARS) {
      const doc = join(MODELS, kind, `${id}.json`);
      if (!existsSync(doc)) continue;
      mkdirSync(join(FULL, kind), { recursive: true });
      copyFileSync(doc, join(FULL, kind, `${id}.json`));
    }
  }
}
const source = existsSync(fullGlb) ? fullGlb : shippedGlb;
const readDoc = (kind) => {
  for (const p of [join(FULL, kind, `${id}.json`), join(MODELS, kind, `${id}.json`)]) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  }
  return null;
};

await decoderReady;
await MeshoptSimplifier.ready;
const glb = readGlb(source);
const { json } = glb;

// ---------- reading attributes as floats, for the simplifier ----------
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function floats(a) {
  const div = a.acc.normalized ? NORM[a.acc.componentType] : 1;
  const out = new Float32Array(a.data.length);
  for (let i = 0; i < out.length; i++) out[i] = a.data[i] / div;
  return out;
}

// ---------- 2-3. strays out, then simplify ----------
const strays = readDoc('strays');
const skinfix = readDoc('skinfix');
const jawrig = readDoc('jawrig');

const prims = [];
json.meshes.forEach((mesh, mi) => mesh.primitives.forEach((spec, pi) => {
  if ((spec.mode ?? 4) !== 4 || spec.indices === undefined) return;
  if (spec.targets?.length) throw new Error(`${id} mesh ${mi}/${pi}: morph targets would need remapping too`);
  prims.push({ mi, pi, spec, indices: Uint32Array.from(accessor(glb, spec.indices).data) });
}));

for (const s of strays?.strays ?? []) {
  const p = prims.find((q) => q.mi === s.mesh && q.pi === s.primitive);
  if (!p) throw new Error(`${id}: stray names mesh ${s.mesh}/${s.primitive}, which is not in the file`);
  const drop = new Uint8Array(p.indices.length / 3);
  for (const [a, b] of s.runs) drop.fill(1, a, b + 1);
  const kept = [];
  for (let t = 0; t < drop.length; t++) if (!drop[t]) kept.push(p.indices[t * 3], p.indices[t * 3 + 1], p.indices[t * 3 + 2]);
  p.strayTriangles = (p.strayTriangles ?? 0) + (p.indices.length - kept.length) / 3;
  p.indices = Uint32Array.from(kept);
}

const total = prims.reduce((n, p) => n + p.indices.length / 3, 0);
const report = { id, source: source.replace(ROOT + '/', ''), budget, trianglesFrom: total, primitives: [] };
if (total <= budget) {
  console.log(JSON.stringify({ ...report, note: 'already inside the budget; nothing written' }, null, 2));
  process.exit(0);
}

for (const p of prims) {
  const pos = accessor(glb, p.spec.attributes.POSITION);
  const positions = floats(pos);
  const vertices = pos.count;
  // the attributes that should not be collapsed across, and how much each counts
  const parts = [];
  if (p.spec.attributes.NORMAL !== undefined) parts.push([floats(accessor(glb, p.spec.attributes.NORMAL)), 3, 0.5]);
  if (p.spec.attributes.TEXCOORD_0 !== undefined) parts.push([floats(accessor(glb, p.spec.attributes.TEXCOORD_0)), 2, 1]);
  if (p.spec.attributes.WEIGHTS_0 !== undefined) parts.push([floats(accessor(glb, p.spec.attributes.WEIGHTS_0)), 4, 0.5]);
  const stride = parts.reduce((n, [, k]) => n + k, 0);
  const attrs = new Float32Array(vertices * Math.max(1, stride));
  const weights = [];
  let at = 0;
  for (const [data, k, w] of parts) {
    for (let v = 0; v < vertices; v++) for (let c = 0; c < k; c++) attrs[v * stride + at + c] = data[v * k + c];
    for (let c = 0; c < k; c++) weights.push(w);
    at += k;
  }
  const goal = Math.max(3, Math.floor((p.indices.length / 3) * (budget / total)) * 3);
  let reduced = p.indices;
  let error = 0;
  // the error limit is relative to the mesh's size; raise it only as far as the budget needs
  for (const limit of [0.01, 0.02, 0.04, 0.08, 0.15, 0.3]) {
    [reduced, error] = stride
      ? MeshoptSimplifier.simplifyWithAttributes(p.indices, positions, 3, attrs, stride, weights, null, goal, limit, ['RegularizeLight'])
      : MeshoptSimplifier.simplify(p.indices, positions, 3, goal, limit, ['RegularizeLight']);
    if (reduced.length <= goal * 1.05) break;
  }
  if (!reduced.length || reduced.length % 3) throw new Error(`${id} mesh ${p.mi}/${p.pi}: the simplifier returned no usable index`);
  const compact = Uint32Array.from(reduced);
  const [remap, unique] = MeshoptSimplifier.compactMesh(compact);
  p.remap = remap;
  p.unique = unique;
  p.newIndices = compact;
  report.primitives.push({ mesh: p.mi, primitive: p.pi, strayTriangles: p.strayTriangles ?? 0,
    trianglesFrom: p.indices.length / 3, trianglesTo: compact.length / 3,
    verticesFrom: vertices, verticesTo: unique, error: +error.toFixed(5) });
}
report.trianglesTo = prims.reduce((n, p) => n + p.newIndices.length / 3, 0);

// ---------- 4. the fixes, renumbered ----------
const primFor = (mesh) => prims.find((q) => q.mi === (mesh?.mesh ?? 0) && q.pi === (mesh?.primitive ?? 0)) ?? prims[0];
const renumber = (p, i) => { const n = p.remap[i]; return n === undefined || n === 0xffffffff ? -1 : n; };
const remapKeys = (p, obj) => obj && Object.fromEntries(Object.entries(obj)
  .map(([k, v]) => [renumber(p, Number(k)), v]).filter(([k]) => k >= 0).map(([k, v]) => [String(k), v]));
const fixReport = [];
if (skinfix) {
  for (const f of skinfix.fixes ?? []) {
    const p = primFor(f.mesh);
    const before = f.vertices?.length ?? 0;
    if (f.vertices) f.vertices = f.vertices.map((i) => renumber(p, i)).filter((i) => i >= 0);
    if (f.donors) f.donors = remapKeys(p, f.donors);
    if (f.replacements) f.replacements = remapKeys(p, f.replacements);
    if (f.mesh) f.mesh.vertexCount = p.unique;
    if (f.stats) f.stats.vertices = f.vertices?.length ?? f.stats.vertices;
    fixReport.push({ fix: f.id, status: f.status, vertices: `${before} -> ${f.vertices?.length ?? 0}` });
  }
  skinfix.note = `${skinfix.note ? `${skinfix.note} ` : ''}Renumbered for the ${report.trianglesTo}-triangle model by tools/asset-pipeline/decimate.mjs; the full-resolution original and its fixes are in public/models/full/.`;
}
if (jawrig) {
  const p = primFor(null);
  const before = jawrig.vertices.length;
  jawrig.vertices = jawrig.vertices.map(([i, w]) => [renumber(p, i), w]).filter(([i]) => i >= 0);
  jawrig.mesh.vertexCount = p.unique;
  fixReport.push({ fix: 'jawrig', vertices: `${before} -> ${jawrig.vertices.length}` });
}
report.fixes = fixReport;

if (dry) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// ---------- 5. a clean file ----------
const out = { views: [], chunks: [], length: 0 };
const addView = (bytes, extra = {}) => {
  const pad = (4 - (out.length % 4)) % 4;
  if (pad) { out.chunks.push(Buffer.alloc(pad)); out.length += pad; }
  out.views.push({ buffer: 0, byteOffset: out.length, byteLength: bytes.byteLength, ...extra });
  out.chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  out.length += bytes.byteLength;
  return out.views.length - 1;
};
const newAccessors = [];
const oldViewToNew = new Map();
/** carry an untouched accessor across: its view decoded and copied once */
const carry = (oldIndex) => {
  const acc = { ...json.accessors[oldIndex] };
  if (acc.bufferView !== undefined) {
    if (!oldViewToNew.has(acc.bufferView)) {
      const v = json.bufferViews[acc.bufferView];
      const extra = {};
      if (v.byteStride) extra.byteStride = v.byteStride;
      if (v.target) extra.target = v.target;
      oldViewToNew.set(acc.bufferView, addView(viewBytes(glb, acc.bufferView), extra));
    }
    acc.bufferView = oldViewToNew.get(acc.bufferView);
  }
  return newAccessors.push(acc) - 1;
};
const carried = new Map();
const carryOnce = (i) => { if (!carried.has(i)) carried.set(i, carry(i)); return carried.get(i); };

for (const p of prims) {
  // indices
  const small = p.unique <= 65535;
  const idx = small ? Uint16Array.from(p.newIndices) : p.newIndices;
  p.spec.indices = newAccessors.push({ bufferView: addView(idx, { target: 34963 }),
    componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR' }) - 1;
  // every vertex attribute, in its own type, for the surviving vertices only
  for (const [semantic, oldIndex] of Object.entries(p.spec.attributes)) {
    const a = accessor(glb, oldIndex);
    const packed = a.comp.size * a.items;
    const stride = Math.ceil(packed / 4) * 4;
    const bytes = new Uint8Array(p.unique * stride);
    const row = new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength);
    for (let v = 0; v < p.remap.length; v++) {
      const n = p.remap[v];
      if (n === 0xffffffff) continue;
      bytes.set(row.subarray(v * packed, v * packed + packed), n * stride);
    }
    const acc = { bufferView: addView(bytes, { byteStride: stride, target: 34962 }),
      componentType: a.acc.componentType, count: p.unique, type: a.acc.type };
    if (a.acc.normalized) acc.normalized = true;
    if (semantic === 'POSITION') {
      acc.min = [Infinity, Infinity, Infinity];
      acc.max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < a.count; v++) {
        if (p.remap[v] === 0xffffffff) continue;
        for (let k = 0; k < 3; k++) {
          acc.min[k] = Math.min(acc.min[k], a.data[v * 3 + k]);
          acc.max[k] = Math.max(acc.max[k], a.data[v * 3 + k]);
        }
      }
    }
    p.spec.attributes[semantic] = newAccessors.push(acc) - 1;
  }
}
// everything else that reads an accessor, carried as it was
for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = carryOnce(skin.inverseBindMatrices);
for (const anim of json.animations ?? []) for (const s of anim.samplers) { s.input = carryOnce(s.input); s.output = carryOnce(s.output); }
for (const mesh of json.meshes) for (const spec of mesh.primitives) {
  if (prims.some((p) => p.spec === spec)) continue;
  if (spec.indices !== undefined) spec.indices = carryOnce(spec.indices);
  for (const k of Object.keys(spec.attributes)) spec.attributes[k] = carryOnce(spec.attributes[k]);
}
for (const img of json.images ?? []) {
  if (img.bufferView === undefined) continue;
  if (!oldViewToNew.has(img.bufferView)) oldViewToNew.set(img.bufferView, addView(viewBytes(glb, img.bufferView)));
  img.bufferView = oldViewToNew.get(img.bufferView);
}
json.accessors = newAccessors;
json.bufferViews = out.views;
json.buffers = [{ byteLength: out.length }];
const drop = (list) => list?.filter((e) => e !== 'EXT_meshopt_compression');
json.extensionsUsed = drop(json.extensionsUsed);
json.extensionsRequired = drop(json.extensionsRequired);
if (!json.extensionsUsed?.length) delete json.extensionsUsed;
if (!json.extensionsRequired?.length) delete json.extensionsRequired;
json.asset = { ...json.asset, extras: { ...(json.asset?.extras ?? {}),
  decimated: { tool: 'tools/asset-pipeline/decimate.mjs', from: report.trianglesFrom, to: report.trianglesTo } } };

const bin = Buffer.concat(out.chunks);
const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.write('glTF'); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonChunk.length); jh.write('JSON', 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(binChunk.length); bh.write('BIN\0', 4);
writeFileSync(shippedGlb, Buffer.concat([header, jh, jsonChunk, bh, binChunk]));

// the renumbered fixes ship; the stray lumps are already gone from the file
if (skinfix) writeFileSync(join(MODELS, 'skinfix', `${id}.json`), `${JSON.stringify(skinfix)}\n`);
if (jawrig) writeFileSync(join(MODELS, 'jawrig', `${id}.json`), `${JSON.stringify(jawrig)}\n`);
if (strays) {
  const indexPath = join(MODELS, 'strays', 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.models = index.models.filter((m) => m !== id);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  const shippedStrays = join(MODELS, 'strays', `${id}.json`);
  if (existsSync(shippedStrays)) unlinkSync(shippedStrays);
  report.strays = 'baked out; dropped from strays/index.json (the original document is in full/strays/)';
}
// the workbench's list of what has a full-resolution original to show
const listPath = join(ROOT, 'src/characters/data/fullResolution.json');
const list = JSON.parse(readFileSync(listPath, 'utf8'));
list.models[id] = { triangles: report.trianglesFrom, shipped: report.trianglesTo,
  docs: SIDECARS.filter((kind) => existsSync(join(FULL, kind, `${id}.json`))) };
list.models = Object.fromEntries(Object.entries(list.models).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(listPath, `${JSON.stringify(list, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
