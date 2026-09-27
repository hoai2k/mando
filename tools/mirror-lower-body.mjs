/**
 * Replace one side of a sculpt's lower body with a mirror of the other side.
 *
 * `flametrooper` and `ring_enforcer` arrived with their weapon fused into the
 * body mesh at the right hip (a flame projector and hose; a holstered pistol).
 * The meshes are a single connected shell, so the weapon cannot be split off
 * as its own piece. The left half of the lower body is clean, though, so this
 * deletes every right-side triangle below a cut height and puts a mirrored
 * copy of the left-side triangles in their place — same UVs, normals flipped
 * across x, and skinned to the matching `.R` bones.
 *
 * Arms and hands are left alone: a triangle stays as it is when it sits out
 * past the legs (|x| > armX) and is mostly skinned to the arm chain, so the
 * hands hanging beside the hips keep their own left/right shapes, and only
 * body-skinned triangles are ever copied across. Everything above the cut
 * (torso, arms, head) is untouched.
 *
 * Original vertices keep their indices (the dropped ones become unreferenced)
 * and the mirrored copies are appended, so vertex-index data written against
 * the old file still names the same points. The output is written without
 * meshopt compression; quantisation is kept.
 *
 * Usage: node tools/mirror-lower-body.mjs <model> [cutY] [out.glb]
 */
import { writeFileSync } from 'node:fs';
import { readGlb, viewBytes, accessor, decoderReady } from './lib/glb.mjs';

const PRESETS = {
  // cutY is in the model's own units (the sculpts are 1 unit tall, centred)
  // the fuel hoses run down the back from the regulator (y ~0.2), and the
  // right one takes its own path to the projector, so the back half is cut
  // higher to mirror the left hose from its top
  flametrooper: { cutY: 0.13, armX: 0.19, back: { z: -0.08, x: 0.11, cutY: 0.2 } },
  ring_enforcer: { cutY: 0.13, armX: 0.19 },
};
const [model, cutArg, outArg] = process.argv.slice(2);
if (!model) throw new Error('usage: node tools/mirror-lower-body.mjs <model> [cutY] [out.glb]');
const preset = { cutY: 0.13, armX: 0.19, ...PRESETS[model] };
const cutY = cutArg !== undefined ? Number(cutArg) : preset.cutY;
const armX = preset.armX;
const back = preset.back;
// the cut height at a point: optionally higher behind the body
// `grow` widens the back region (for what is mirrored) or narrows it (for what
// is dropped), so the two overlap at its edges instead of leaving a gap where
// the left and right surfaces differ
const cutAt = (x, z, grow = 0) => (back && z < back.z + grow && Math.abs(x) < back.x + grow ? back.cutY : cutY);
const MARGIN = 0.02;
const out = outArg ?? `candidates/${model}_mirrored.glb`;

const glb = readGlb(`public/models/${model}.glb`);
await decoderReady;
const { json } = glb;
const nodeIndex = json.nodes.findIndex((n) => n.mesh !== undefined && n.skin !== undefined);
const node = json.nodes[nodeIndex];
if (json.meshes[node.mesh].primitives.length !== 1) throw new Error('expected one primitive');
const prim = json.meshes[node.mesh].primitives[0];
const t = node.translation ?? [0, 0, 0];
const s = node.scale ?? [1, 1, 1];
if (node.rotation || node.matrix) throw new Error('mesh node with rotation is not handled');

const read = (i) => accessor(glb, i);
const P = read(prim.attributes.POSITION);
const N = read(prim.attributes.NORMAL);
const UV = read(prim.attributes.TEXCOORD_0);
const J = read(prim.attributes.JOINTS_0);
const W = read(prim.attributes.WEIGHTS_0);
const I = read(prim.indices);
const n = P.count;
const posOf = (v, a) => t[a] + s[a] * P.data[v * 3 + a];
const wScale = W.acc.normalized ? (W.acc.componentType === 5121 ? 255 : 65535) : 1;

// ---- bones: which joints are arms, and each joint's mirror partner ----
const skin = json.skins[node.skin];
const jointName = skin.joints.map((j) => (json.nodes[j].name ?? '').replace(/^DEF-/, ''));
const isArm = jointName.map((nm) => /^(shoulder|upper_arm|forearm|hand)\./.test(nm));
const swapSide = (nm) => nm.replace(/\.L(?=$|\.)/, '.__').replace(/\.R(?=$|\.)/, '.L').replace(/\.__/, '.R');
const mirrorJoint = jointName.map((nm) => {
  const k = jointName.indexOf(swapSide(nm));
  if (k < 0) throw new Error(`no mirror bone for ${nm}`);
  return k;
});
const armWeight = (v) => {
  let sum = 0;
  for (let k = 0; k < 4; k++) if (isArm[J.data[v * 4 + k]]) sum += W.data[v * 4 + k] / wScale;
  return sum;
};

// ---- triangles: drop the right-side lower body, mirror the left-side one ----
const triCount = I.count / 3;
const triVerts = (tri) => [I.data[tri * 3], I.data[tri * 3 + 1], I.data[tri * 3 + 2]];
const isArmy = (vs) => (armWeight(vs[0]) + armWeight(vs[1]) + armWeight(vs[2])) / 3 >= 0.5;
// Arm-skinned triangles that join up with the arm above the cut are arm, even
// inside armX (the inner face of a forearm hanging by the hip). Found by
// walking arm-skinned triangles across shared (welded) corners.
const weldKey = new Int32Array(n);
{
  const seen = new Map();
  for (let v = 0; v < n; v++) {
    const k = `${P.data[v * 3]},${P.data[v * 3 + 1]},${P.data[v * 3 + 2]}`;
    if (!seen.has(k)) seen.set(k, seen.size);
    weldKey[v] = seen.get(k);
  }
}
const armReach = new Set();
{
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const byWeld = new Map();
  const rootOf = (v) => { const w = weldKey[v]; if (!byWeld.has(w)) byWeld.set(w, v); return find(byWeld.get(w)); };
  const armyTris = [];
  for (let tri = 0; tri < triCount; tri++) {
    const vs = triVerts(tri);
    if (!isArmy(vs)) continue;
    armyTris.push(vs);
    const a = rootOf(vs[0]), b = rootOf(vs[1]), c = rootOf(vs[2]);
    parent[b] = a; parent[find(c)] = a;
  }
  const high = new Set();
  for (const vs of armyTris) if (Math.min(...vs.map((v) => posOf(v, 1))) >= cutY) high.add(rootOf(vs[0]));
  for (const vs of armyTris) if (high.has(rootOf(vs[0]))) armReach.add(vs.join());
}
const keep = [];
const mirrorTris = [];
let dropped = 0;
// Seams are made to overlap rather than meet: a right-side triangle is only
// dropped when all three corners are right of centre and below the cut, and a
// left-side one is mirrored when any corner is. Anything straddling a seam is
// kept as it was and also covered by the mirror, so no gap can open.
for (let tri = 0; tri < triCount; tri++) {
  const vs = triVerts(tri);
  const xs = vs.map((v) => posOf(v, 0));
  // heights relative to the cut, for dropping (narrow) and mirroring (wide)
  const rel = (grow) => vs.map((v) => posOf(v, 1) - cutAt(posOf(v, 0), posOf(v, 2), grow));
  const dropYs = rel(-MARGIN), mirrorYs = rel(MARGIN);
  const cx = (xs[0] + xs[1] + xs[2]) / 3;
  const army = isArmy(vs);
  // a hand or forearm: skinned to the arm, and out past the legs or joined
  // up with the rest of the arm
  const arm = army && (Math.abs(cx) > armX || armReach.has(vs.join()));
  if (!arm && Math.max(...xs) < 0 && Math.max(...dropYs) < 0) { dropped++; continue; }
  keep.push(...vs);
  // only body-skinned triangles are copied: an arm-skinned one inside armX is
  // a held prop or shield edge in front of the thigh, not part of the body
  if (!army && Math.max(...xs) > 0 && Math.min(...mirrorYs) < 0) mirrorTris.push(vs);
}

// Whatever of the weapon was skinned to the hand survives the cut as loose
// slivers beside it, cut off from everything once the body round them is gone.
// Drop any small island of the kept original triangles that lies wholly on
// the replaced side, below the cut.
{
  const weld = new Map();
  const pt = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const k = `${P.data[v * 3]},${P.data[v * 3 + 1]},${P.data[v * 3 + 2]}`;
    if (!weld.has(k)) weld.set(k, weld.size);
    pt[v] = weld.get(k);
  }
  const parent = Int32Array.from({ length: weld.size }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let i = 0; i < keep.length; i += 3) {
    const a = find(pt[keep[i]]), b = find(pt[keep[i + 1]]), c = find(pt[keep[i + 2]]);
    parent[b] = a; parent[find(c)] = a;
  }
  const islands = new Map();
  for (let i = 0; i < keep.length; i += 3) {
    const r = find(pt[keep[i]]);
    const g = islands.get(r) ?? { tris: 0, inside: true };
    g.tris++;
    for (let k = 0; k < 3; k++) if (posOf(keep[i + k], 0) >= 0 || posOf(keep[i + k], 1) >= cutAt(posOf(keep[i + k], 0), posOf(keep[i + k], 2), -MARGIN)) g.inside = false;
    islands.set(r, g);
  }
  const small = keep.length / 3 * 0.02;
  const loose = new Set([...islands].filter(([, g]) => g.inside && g.tris < small).map(([r]) => r));
  const kept = [];
  for (let i = 0; i < keep.length; i += 3) {
    if (loose.has(find(pt[keep[i]]))) { dropped++; continue; }
    kept.push(keep[i], keep[i + 1], keep[i + 2]);
  }
  keep.length = 0;
  keep.push(...kept);
  if (loose.size) console.log(`  dropped ${loose.size} loose island(s) left beside the hand`);
}

// mirrored vertices are appended; each left-side vertex is copied once
const qCentre = -t[0] / s[0];
const copyOf = new Map();
const newVerts = [];
for (const vs of mirrorTris) for (const v of vs) if (!copyOf.has(v)) { copyOf.set(v, n + newVerts.length); newVerts.push(v); }
for (const vs of mirrorTris) keep.push(copyOf.get(vs[0]), copyOf.get(vs[2]), copyOf.get(vs[1])); // reversed winding
const total = n + newVerts.length;

const grow = (acc, items, map) => {
  const arr = new acc.data.constructor(total * items);
  arr.set(acc.data.subarray(0, n * items));
  newVerts.forEach((v, i) => {
    const row = Array.from(acc.data.subarray(v * items, v * items + items));
    arr.set(map(row), (n + i) * items);
  });
  return arr;
};
const positions = grow(P, 3, ([x, y, z]) => {
  const mx = Math.round(2 * qCentre - x);
  if (mx < 0 || mx > 65535) throw new Error('mirrored position out of range');
  return [mx, y, z];
});
const normals = grow(N, 3, ([x, y, z]) => [x === -128 ? 127 : -x, y, z]);
const uvs = grow(UV, 2, (r) => r);
const joints = grow(J, 4, (r) => r.map((j) => mirrorJoint[j]));
const weights = grow(W, 4, (r) => r);
const indices = total > 65535 ? Uint32Array.from(keep) : Uint16Array.from(keep);

// ---- rebuild the container: decompressed views, the primitive's views replaced ----
const chunks = [];
let binLength = 0;
const addView = (bytes, extra = {}) => {
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); binLength += pad; }
  const view = { buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, ...extra };
  chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  binLength += bytes.byteLength;
  return view;
};
const views = json.bufferViews.map((v, i) => {
  const bytes = viewBytes(glb, i);
  const extra = {};
  const stride = v.extensions?.EXT_meshopt_compression?.byteStride ?? v.byteStride;
  if (v.byteStride || (v.target === 34962)) extra.byteStride = stride;
  if (v.target) extra.target = v.target;
  return addView(bytes, extra);
});
// padded rows so every vertex stride is a multiple of four
const strided = (arr, items, stride) => {
  const size = arr.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(total * stride);
  const src = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  for (let v = 0; v < total; v++) bytes.set(src.subarray(v * items * size, (v + 1) * items * size), v * stride);
  return bytes;
};
const replaceAttr = (accIndex, arr, items) => {
  const acc = json.accessors[accIndex];
  const packed = arr.BYTES_PER_ELEMENT * items;
  const stride = Math.ceil(packed / 4) * 4;
  views.push(addView(strided(arr, items, stride), { byteStride: stride, target: 34962 }));
  acc.bufferView = views.length - 1;
  acc.byteOffset = 0;
  acc.count = total;
};
replaceAttr(prim.attributes.POSITION, positions, 3);
replaceAttr(prim.attributes.NORMAL, normals, 3);
replaceAttr(prim.attributes.TEXCOORD_0, uvs, 2);
replaceAttr(prim.attributes.JOINTS_0, joints, 4);
replaceAttr(prim.attributes.WEIGHTS_0, weights, 4);
const posAcc = json.accessors[prim.attributes.POSITION];
posAcc.min = [0, 1, 2].map((a) => { let m = Infinity; for (let v = 0; v < total; v++) m = Math.min(m, positions[v * 3 + a]); return m; });
posAcc.max = [0, 1, 2].map((a) => { let m = -Infinity; for (let v = 0; v < total; v++) m = Math.max(m, positions[v * 3 + a]); return m; });
views.push(addView(indices, { target: 34963 }));
Object.assign(json.accessors[prim.indices], {
  bufferView: views.length - 1, byteOffset: 0, count: indices.length,
  componentType: indices instanceof Uint32Array ? 5125 : 5123,
});
json.bufferViews = views;
json.buffers = [{ byteLength: binLength }];
const strip = (list) => list?.filter((e) => e !== 'EXT_meshopt_compression');
json.extensionsUsed = strip(json.extensionsUsed);
if (json.extensionsRequired) json.extensionsRequired = strip(json.extensionsRequired);
json.asset = { ...json.asset, extras: { ...(json.asset.extras ?? {}), mirroredLowerBody: { from: `${model}.glb`, cutY, armX, back } } };

// ---- write ----
const bin = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binPadded.length, 8);
const chunkHead = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(out, Buffer.concat([header, chunkHead(jsonBuf.length, 0x4e4f534a), jsonBuf, chunkHead(binPadded.length, 0x004e4942), binPadded]));
console.log(`${model}: cut y<${cutY}, dropped ${dropped} right-side triangles, mirrored ${mirrorTris.length} left-side triangles (+${newVerts.length} vertices) -> ${out}`);
