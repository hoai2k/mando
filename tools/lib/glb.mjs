/**
 * Minimal Node-side glTF binary reader for the authored models: JSON + BIN
 * chunks, EXT_meshopt_compression on the buffer views (decoded through the
 * same WASM decoder the game uses), KHR_mesh_quantization on the attributes.
 *
 * Enough to get at what the skin audits need — node hierarchy and rest-pose
 * world matrices, and each skinned primitive's positions, joints and weights
 * in world space — without a DOM or a renderer.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const require_ = createRequire(import.meta.url);
const THREE = require_('three');

const COMPONENT = {
  5120: { array: Int8Array, size: 1 }, 5121: { array: Uint8Array, size: 1 },
  5122: { array: Int16Array, size: 2 }, 5123: { array: Uint16Array, size: 2 },
  5125: { array: Uint32Array, size: 4 }, 5126: { array: Float32Array, size: 4 },
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export async function readGlb(path) {
  await MeshoptDecoder.ready;
  const file = readFileSync(path);
  if (file.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a .glb`);
  const chunks = [];
  let off = 12;
  while (off < file.length) {
    const len = file.readUInt32LE(off);
    const type = file.readUInt32LE(off + 4);
    chunks.push({ type, data: file.subarray(off + 8, off + 8 + len) });
    off += 8 + len;
  }
  const json = JSON.parse(chunks.find((c) => c.type === 0x4e4f534a).data.toString());
  const bin = chunks.find((c) => c.type === 0x004e4942)?.data;
  return new Glb(json, bin);
}

export class Glb {
  constructor(json, bin) {
    this.json = json;
    this.bin = bin;
    this.viewCache = new Map();
  }

  /** decoded bytes of a buffer view, meshopt-expanded when it is compressed */
  bufferView(index) {
    let out = this.viewCache.get(index);
    if (out) return out;
    const bv = this.json.bufferViews[index];
    const ext = bv.extensions?.EXT_meshopt_compression;
    if (ext) {
      const src = new Uint8Array(this.bin.buffer, this.bin.byteOffset + (ext.byteOffset ?? 0), ext.byteLength);
      out = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src,
        ext.mode, ext.filter ?? 'NONE');
      out = { data: out, stride: ext.byteStride };
    } else {
      const data = new Uint8Array(this.bin.buffer, this.bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength);
      out = { data, stride: bv.byteStride ?? 0 };
    }
    this.viewCache.set(index, out);
    return out;
  }

  /** accessor -> { array: flat Float64Array (normalised applied), count, size } */
  accessor(index) {
    const acc = this.json.accessors[index];
    const comp = COMPONENT[acc.componentType];
    const n = TYPE_SIZE[acc.type];
    const out = new Float64Array(acc.count * n);
    if (acc.bufferView === undefined) return { array: out, count: acc.count, size: n, raw: null };
    const { data, stride } = this.bufferView(acc.bufferView);
    const step = stride || comp.size * n;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const base = acc.byteOffset ?? 0;
    const read = {
      5120: (o) => view.getInt8(o), 5121: (o) => view.getUint8(o),
      5122: (o) => view.getInt16(o, true), 5123: (o) => view.getUint16(o, true),
      5125: (o) => view.getUint32(o, true), 5126: (o) => view.getFloat32(o, true),
    }[acc.componentType];
    const norm = acc.normalized ? {
      5120: (v) => Math.max(v / 127, -1), 5121: (v) => v / 255,
      5122: (v) => Math.max(v / 32767, -1), 5123: (v) => v / 65535,
    }[acc.componentType] : null;
    const raw = new comp.array(acc.count * n);
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < n; k++) {
        const v = read(base + i * step + k * comp.size);
        raw[i * n + k] = v;
        out[i * n + k] = norm ? norm(v) : v;
      }
    }
    return { array: out, count: acc.count, size: n, raw, accessor: acc };
  }

  /** local and world matrices of every node in the default scene's rest pose */
  nodeMatrices() {
    const nodes = this.json.nodes;
    const local = nodes.map((nd) => {
      const m = new THREE.Matrix4();
      if (nd.matrix) return m.fromArray(nd.matrix);
      const t = new THREE.Vector3(...(nd.translation ?? [0, 0, 0]));
      const r = new THREE.Quaternion(...(nd.rotation ?? [0, 0, 0, 1]));
      const s = new THREE.Vector3(...(nd.scale ?? [1, 1, 1]));
      return m.compose(t, r, s);
    });
    const world = nodes.map(() => null);
    const parent = nodes.map(() => -1);
    nodes.forEach((nd, i) => (nd.children ?? []).forEach((c) => { parent[c] = i; }));
    const visit = (i) => {
      if (world[i]) return world[i];
      const p = parent[i];
      world[i] = p < 0 ? local[i].clone() : visit(p).clone().multiply(local[i]);
      return world[i];
    };
    nodes.forEach((_, i) => visit(i));
    return { local, world, parent };
  }

  /**
   * Every skinned primitive, with world-space rest positions and the joints /
   * weights per vertex, plus the skin's joints as node indices.
   */
  skinnedPrimitives() {
    const { world, parent } = this.nodeMatrices();
    const out = [];
    this.json.nodes.forEach((nd, nodeIndex) => {
      if (nd.mesh === undefined || nd.skin === undefined) return;
      const skin = this.json.skins[nd.skin];
      const mesh = this.json.meshes[nd.mesh];
      mesh.primitives.forEach((prim, primIndex) => {
        const a = prim.attributes;
        if (a.JOINTS_0 === undefined || a.WEIGHTS_0 === undefined) return;
        const pos = this.accessor(a.POSITION);
        const joints = this.accessor(a.JOINTS_0);
        const weights = this.accessor(a.WEIGHTS_0);
        const indices = prim.indices !== undefined ? this.accessor(prim.indices) : null;
        const m = world[nodeIndex];
        const positions = new Float64Array(pos.count * 3);
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          v.set(pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]).applyMatrix4(m);
          positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
        }
        out.push({
          nodeIndex, meshIndex: nd.mesh, primIndex, skinIndex: nd.skin,
          count: pos.count, positions,
          joints: joints.array, weights: weights.array, weightsRaw: weights,
          indices: indices ? indices.array : null,
          skinJoints: skin.joints,
          jointNames: skin.joints.map((j) => this.json.nodes[j].name ?? `node${j}`),
        });
      });
    });
    return { primitives: out, world, parent };
  }
}
