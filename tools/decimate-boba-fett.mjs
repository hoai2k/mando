/** Reduce Boba Fett's triangles and compact every surviving weighted attribute. */
import { writeFileSync } from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';
import { accessor, readGlb, primitives } from './lib/glb.mjs';

const source = process.argv[2] ?? 'model-work/source/boba_fett_orig.glb';
const output = process.argv[3] ?? 'model-work/intermediary/boba_fett_game_lod0.glb';
// Small independent mesh parts resist simplification, so request slightly
// under 15k to keep their sum inside the project's playable budget.
const target = Number(process.argv[4] ?? 14780);
const glb = readGlb(source);
await MeshoptSimplifier.ready;

const sourcePrimitives = primitives(glb);
const originalTriangles = sourcePrimitives.reduce((n, p) => n + p.indices.length / 3, 0);
const ratio = Math.min(1, target / originalTriangles);
const parts = [];
const extra = [];
let offset = glb.bin.length;
const addBytes = (bytes) => {
  const aligned = (offset + 3) & ~3;
  extra.push(Buffer.alloc(aligned - offset), bytes);
  const view = glb.json.bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: bytes.length }) - 1;
  offset = aligned + bytes.length;
  return view;
};

for (const p of sourcePrimitives) {
  const input = Uint32Array.from(p.indices);
  const positions = Float32Array.from(p.pos.data);
  const goal = Math.max(4, Math.floor(input.length / 3 * ratio));
  const [reduced, error] = MeshoptSimplifier.simplify(input, positions, 3,
    goal * 3, 0.02);
  if (reduced.length === 0 || reduced.length % 3) throw new Error(`${p.name}: invalid reduction`);
  const compactIndices = Uint32Array.from(reduced);
  const [remap, unique] = MeshoptSimplifier.compactMesh(compactIndices);
  if (unique > 65535) throw new Error(`${p.name}: too many vertices for 16-bit indices`);
  const compact = Uint16Array.from(compactIndices);
  const indexView = addBytes(Buffer.from(compact.buffer));
  const indexAccessor = glb.json.accessors.push({ bufferView: indexView, componentType: 5123,
    count: compact.length, type: 'SCALAR', min: [0], max: [unique - 1] }) - 1;
  const spec = glb.json.meshes[p.mesh].primitives[p.prim];
  if (spec.targets?.length) throw new Error(`${p.name}: morph targets need remapping`);
  spec.indices = indexAccessor;
  for (const [semantic, oldIndex] of Object.entries(spec.attributes)) {
    const old = accessor(glb, oldIndex);
    const out = new old.data.constructor(unique * old.items);
    for (let oldVertex = 0; oldVertex < remap.length; oldVertex++) {
      const newVertex = remap[oldVertex];
      if (newVertex === 0xffffffff) continue;
      for (let k = 0; k < old.items; k++)
        out[newVertex * old.items + k] = old.data[oldVertex * old.items + k];
    }
    const view = addBytes(Buffer.from(out.buffer));
    const oldSpec = glb.json.accessors[oldIndex];
    const next = { bufferView: view, componentType: oldSpec.componentType,
      count: unique, type: oldSpec.type };
    if (oldSpec.normalized) next.normalized = true;
    if (semantic === 'POSITION') {
      next.min = [Infinity, Infinity, Infinity];
      next.max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < unique; v++) for (let k = 0; k < 3; k++) {
        const value = out[v * old.items + k];
        next.min[k] = Math.min(next.min[k], value);
        next.max[k] = Math.max(next.max[k], value);
      }
    }
    spec.attributes[semantic] = glb.json.accessors.push(next) - 1;
  }
  parts.push({ mesh: p.name, trianglesFrom: input.length / 3, trianglesTo: reduced.length / 3,
    verticesFrom: p.pos.count, verticesTo: unique, error });
}

const binary = Buffer.concat([glb.bin, ...extra]);
glb.json.buffers[0].byteLength = binary.length;
const json = Buffer.from(JSON.stringify(glb.json));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
const paddedBin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
const header = Buffer.alloc(12); header.write('glTF'); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + paddedBin.length, 8);
const jc = Buffer.alloc(8); jc.writeUInt32LE(paddedJson.length); jc.write('JSON', 4);
const bc = Buffer.alloc(8); bc.writeUInt32LE(paddedBin.length); bc.write('BIN\0', 4);
writeFileSync(output, Buffer.concat([header, jc, paddedJson, bc, paddedBin]));
console.log(JSON.stringify({ source, output, target, originalTriangles,
  triangles: parts.reduce((n, p) => n + p.trianglesTo, 0),
  vertices: parts.reduce((n, p) => n + p.verticesTo, 0), parts }, null, 2));
