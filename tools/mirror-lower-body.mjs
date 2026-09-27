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
 * The mirror plane is x = centreX (per model; override with MIRROR_CENTRE_X).
 *
 * Usage: node tools/mirror-lower-body.mjs <model> [cutY] [out.glb]
 */
import { writeFileSync } from 'node:fs';
import { readGlb, viewBytes, accessor, decoderReady } from './lib/glb.mjs';
import { planMirror } from './lib/mirror-core.mjs';

const PRESETS = {
  // cutY is in the model's own units (the sculpts are 1 unit tall, centred)
  // the fuel hoses run down the back from the regulator (y ~0.2), and the
  // right one takes its own path to the projector, so the back half is cut
  // higher to mirror the left hose from its top
  flametrooper: { cutY: 0.13, armX: 0.19, back: { z: -0.08, x: 0.11, cutY: 0.2 } },
  // this sculpt's body is centred 1.6 cm (model units) to its right of x = 0,
  // measured from the feet, torso and head: mirror about that, not about 0
  ring_enforcer: { cutY: 0.13, armX: 0.19, centreX: -0.016 },
};
const [model, cutArg, outArg] = process.argv.slice(2);
if (!model) throw new Error('usage: node tools/mirror-lower-body.mjs <model> [cutY] [out.glb]');
const preset = { cutY: 0.13, armX: 0.19, centreX: 0, ...PRESETS[model] };
const cutY = cutArg !== undefined ? Number(cutArg) : preset.cutY;
const armX = preset.armX;
const centreX = Number(process.env.MIRROR_CENTRE_X ?? preset.centreX);
const back = preset.back ?? null;
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

// ---- which triangles to drop and which to mirror (shared with the viewer) ----
const skin = json.skins[node.skin];
const jointNames = skin.joints.map((j) => (json.nodes[j].name ?? '').replace(/^DEF-/, ''));
const modelPositions = Float32Array.from({ length: n * 3 }, (_, i) => posOf(Math.floor(i / 3), i % 3));
const plan = planMirror({
  positions: modelPositions, joints: J.data, indices: I.data, jointNames,
  weights: Float32Array.from(W.data, (w) => w / wScale),
}, { centreX, cutY, armX, back });
const { mirrorJoint } = plan;
const newVerts = plan.sources;
if (plan.loose) console.log(`  dropped ${plan.loose} loose island(s) left beside the hand`);
// mirror plane in the file's own quantised units
const qCentre = (centreX - t[0]) / s[0];
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
const indices = total > 65535 ? Uint32Array.from(plan.indices) : Uint16Array.from(plan.indices);

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
json.asset = { ...json.asset, extras: { ...(json.asset.extras ?? {}), mirroredLowerBody: { from: `${model}.glb`, cutY, armX, centreX, back } } };

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
console.log(`${model}: mirror x=${centreX}, cut y<${cutY}, dropped ${plan.dropped} right-side triangles, mirrored ${plan.mirrored} left-side triangles (+${newVerts.length} vertices) -> ${out}`);
