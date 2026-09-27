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
 * the old file still names the same points. The output is plain core glTF
 * (float attributes, no compression or quantisation) so any viewer opens it.
 *
 * The mirror plane is x = centreX (per model; override with MIRROR_CENTRE_X).
 *
 * Usage: node tools/mirror-lower-body.mjs <model> [cutY] [out.glb]
 */
import { writeFileSync } from 'node:fs';
import { readGlb, viewBytes, accessor, decoderReady } from './lib/glb.mjs';
import { planMirror } from './lib/mirror-core.mjs';
import { Matrix4, Quaternion, Vector3 } from 'three';

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
const out = outArg ?? `public/models/candidates/${model}_mirrored.glb`;

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
// ---- vertex data, written as plain floats in model space ----
// The delivered files are quantised (integer positions under a scaled mesh
// node, UVs rescaled by KHR_texture_transform). three.js reads that, but many
// desktop viewers do not, so the output is core glTF: float positions,
// normals and UVs, the node scale folded into the inverse bind matrices, and
// the texture transform folded into the UVs.
const total = n + newVerts.length;
const norm = (acc) => {
  if (!acc.acc.normalized) return (x) => x;
  const d = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.acc.componentType];
  return (x) => Math.max(x / d, -1);
};
const nN = norm(N), nUV = norm(UV);
const infos = [];
const mat = json.materials?.[prim.material] ?? {};
for (const info of [mat.pbrMetallicRoughness?.baseColorTexture, mat.pbrMetallicRoughness?.metallicRoughnessTexture,
  mat.normalTexture, mat.occlusionTexture, mat.emissiveTexture]) if (info) infos.push(info);
const tt = infos[0]?.extensions?.KHR_texture_transform;
for (const info of infos) {
  const x = info.extensions?.KHR_texture_transform;
  if (JSON.stringify(x) !== JSON.stringify(tt)) throw new Error('textures disagree on KHR_texture_transform');
  if (x?.rotation || x?.texCoord) throw new Error('rotated texture transform is not handled');
}
const uvOffset = tt?.offset ?? [0, 0], uvScale = tt?.scale ?? [1, 1];

const positions = new Float32Array(total * 3), normals = new Float32Array(total * 3), uvs = new Float32Array(total * 2);
const joints = new Uint8Array(total * 4), weights = new Uint8Array(total * 4);
if (J.data.BYTES_PER_ELEMENT !== 1 || W.acc.componentType !== 5121) throw new Error('expected 8-bit joints and weights');
const sourceOf = (d) => (d < n ? d : newVerts[d - n]);
for (let d = 0; d < total; d++) {
  const v = sourceOf(d), mirrored = d >= n;
  for (let a = 0; a < 3; a++) positions[d * 3 + a] = posOf(v, a);
  if (mirrored) positions[d * 3] = 2 * centreX - positions[d * 3];
  const nv = [0, 1, 2].map((a) => nN(N.data[v * 3 + a]));
  if (mirrored) nv[0] = -nv[0];
  const len = Math.hypot(...nv) || 1;
  for (let a = 0; a < 3; a++) normals[d * 3 + a] = nv[a] / len;
  for (let a = 0; a < 2; a++) uvs[d * 2 + a] = uvOffset[a] + uvScale[a] * nUV(UV.data[v * 2 + a]);
  for (let k = 0; k < 4; k++) {
    const w = W.data[v * 4 + k], j = J.data[v * 4 + k];
    weights[d * 4 + k] = w;
    // a slot with no weight keeps joint 0 (glTF asks unused slots to be zero)
    joints[d * 4 + k] = w === 0 ? 0 : mirrored ? mirrorJoint[j] : j;
  }
}
const indices = total > 65535 ? Uint32Array.from(plan.indices) : Uint16Array.from(plan.indices);

// the skinned mesh's node transform moves into the inverse bind matrices
const IBM = read(skin.inverseBindMatrices);
const nodeMatrix = new Matrix4().compose(new Vector3(...t), new Quaternion(), new Vector3(...s));
const unbake = nodeMatrix.clone().invert();
const ibms = new Float32Array(IBM.count * 16);
for (let i = 0; i < IBM.count; i++) {
  new Matrix4().fromArray(IBM.data, i * 16).multiply(unbake).toArray(ibms, i * 16);
}
delete node.translation;
delete node.scale;

// ---- rebuild the container with only the data still in use ----
const chunks = [];
let binLength = 0;
const views = [];
const addView = (bytes, extra = {}) => {
  const pad = (4 - (binLength % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); binLength += pad; }
  views.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength, ...extra });
  chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  binLength += bytes.byteLength;
  return views.length - 1;
};
const setAccessor = (i, arr, fields) => {
  const acc = json.accessors[i];
  delete acc.normalized; delete acc.min; delete acc.max; delete acc.byteOffset;
  Object.assign(acc, fields, { bufferView: addView(arr, fields.vertex ? { byteStride: fields.stride, target: 34962 } : fields.target ? { target: fields.target } : {}) });
  delete acc.vertex; delete acc.stride; delete acc.target;
};
const minMax = (arr) => [0, 1, 2].reduce((mm, a) => {
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < total; v++) { lo = Math.min(lo, arr[v * 3 + a]); hi = Math.max(hi, arr[v * 3 + a]); }
  mm.min.push(lo); mm.max.push(hi); return mm;
}, { min: [], max: [] });
setAccessor(prim.attributes.POSITION, positions, { componentType: 5126, count: total, type: 'VEC3', vertex: true, stride: 12, ...minMax(positions) });
setAccessor(prim.attributes.NORMAL, normals, { componentType: 5126, count: total, type: 'VEC3', vertex: true, stride: 12 });
setAccessor(prim.attributes.TEXCOORD_0, uvs, { componentType: 5126, count: total, type: 'VEC2', vertex: true, stride: 8 });
setAccessor(prim.attributes.JOINTS_0, joints, { componentType: 5121, count: total, type: 'VEC4', vertex: true, stride: 4 });
setAccessor(prim.attributes.WEIGHTS_0, weights, { componentType: 5121, count: total, type: 'VEC4', vertex: true, stride: 4, normalized: true });
setAccessor(prim.indices, indices, { componentType: indices instanceof Uint32Array ? 5125 : 5123, count: indices.length, type: 'SCALAR', target: 34963 });
setAccessor(skin.inverseBindMatrices, ibms, { componentType: 5126, count: IBM.count, type: 'MAT4' });
const rewritten = new Set([...Object.values(prim.attributes), prim.indices, skin.inverseBindMatrices]);
json.accessors.forEach((acc, i) => {
  if (rewritten.has(i) || acc.bufferView === undefined) return;
  throw new Error(`accessor ${i} is not handled`);
});
for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = addView(viewBytes(glb, img.bufferView));
json.bufferViews = views;
json.buffers = [{ byteLength: binLength }];
for (const info of infos) { delete info.extensions.KHR_texture_transform; if (!Object.keys(info.extensions).length) delete info.extensions; }
const strip = (list) => list?.filter((e) => !['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_transform'].includes(e));
json.extensionsUsed = strip(json.extensionsUsed);
json.extensionsRequired = strip(json.extensionsRequired);
for (const k of ['extensionsUsed', 'extensionsRequired']) if (!json[k]?.length) delete json[k];
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
