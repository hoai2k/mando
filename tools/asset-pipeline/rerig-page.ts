/**
 * Re-rig a character .glb: move its limb joints to where the mesh bends
 * (the skin-seam audit's estimates, docs/audits/rig-joints.md, or the
 * geometric ones, docs/audits/geo-joints.md), and write a copy
 * with the skin left exactly as it was.
 *
 * Nothing about the mesh changes — not a vertex, not a weight. What changes is
 * where each joint *is*: the bone's head moves to the estimated pivot, the
 * bone turns (about its own roll) to point at its moved child, the twist
 * bones stay at mid-segment, and every other bone keeps its world transform.
 * The inverse bind matrices are recomputed from the moved bones, so the bind
 * pose still reproduces the sculpt exactly; only the pivots the skin bends
 * about have moved. Only node transforms and the inverse-bind accessor are
 * rewritten in the file — textures, compression and everything else are the
 * original bytes.
 *
 * Driven by tools/asset-pipeline/rerig.mjs through `window.__rerig`.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type V3 = [number, number, number];
interface AuditJoint { at: V3; est?: V3 }

/** audit joint → the bone whose head it is, per side */
const HEADS: Record<string, string> = {
  hip: 'DEF-thigh', knee: 'DEF-shin', ankle: 'DEF-foot',
  shoulder: 'DEF-upper_arm', elbow: 'DEF-forearm', wrist: 'DEF-hand',
};
/** each limb chain, root to tip: [bone, the joint its head is at (or 'mid' between the neighbours)] */
const CHAINS: Array<Array<[string, string]>> = [
  [['DEF-thigh', 'hip'], ['DEF-thigh.001', 'mid'], ['DEF-shin', 'knee'], ['DEF-shin.001', 'mid'], ['DEF-foot', 'ankle'], ['DEF-toe', 'keep']],
  [['DEF-upper_arm', 'shoulder'], ['DEF-upper_arm.001', 'mid'], ['DEF-forearm', 'elbow'], ['DEF-forearm.001', 'mid'], ['DEF-hand', 'wrist']],
];

const sideName = (bone: string, side: 'L' | 'R'): string =>
  bone.includes('.001') ? bone.replace('.001', `.${side}.001`) : `${bone}.${side}`;

function readGlb(buf: ArrayBuffer): { json: any; bin: Uint8Array; binOffset: number } {
  const dv = new DataView(buf);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen;
  const binLen = dv.getUint32(binStart, true);
  return { json, bin: new Uint8Array(buf, binStart + 8, binLen).slice(), binOffset: binStart + 8 };
}

function writeGlb(json: any, bin: Uint8Array): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const pad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length + pad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const b = 20 + jsonBytes.length;
  dv.setUint32(b, bin.length + pad, true); dv.setUint32(b + 4, 0x004e4942, true);
  out.set(bin, b + 8);
  return out;
}

/**
 * @param url      the .glb to re-rig
 * @param joints   the audit's joints for this model (at / est, audit frame)
 * @param move     which audit joints to move (e.g. ['elbow','wrist','knee','ankle'])
 * @param source   where the estimates came from ('seam' = rig-joints.json, 'geo' = geo-joints.json); recorded in the file
 */
async function rerig(url: string, joints: Record<string, AuditJoint>, move: string[], source = 'seam'): Promise<{ glb: string; report: unknown }> {
  const buf = await (await fetch(url)).arrayBuffer();
  const { json, bin } = readGlb(buf);
  const gltf = await new GLTFLoader().parseAsync(buf.slice(0), '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  // glTF node index → three object (the loader keeps the association)
  const nodeOf = new Map<number, THREE.Object3D>();
  for (let i = 0; i < json.nodes.length; i++) {
    const o = await gltf.parser.getDependency('node', i) as THREE.Object3D;
    nodeOf.set(i, o);
  }
  const indexOf = new Map<THREE.Object3D, number>([...nodeOf].map(([i, o]) => [o, i]));
  const byName = new Map<string, THREE.Object3D>();
  scene.traverse((o) => { if (o.name) byName.set(o.name, o); });
  const bone = (n: string): THREE.Object3D => {
    const o = byName.get(n) ?? byName.get(n.replace(/\./g, ''));
    if (!o) throw new Error(`no bone ${n}`);
    return o;
  };
  const worldPos = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());

  // ---- the audit frame → the file's frame: scale, a quarter-turn about Y, translation ----
  const pairs: Array<[THREE.Vector3, THREE.Vector3]> = [];
  for (const [j, b] of Object.entries(HEADS)) {
    for (const side of ['L', 'R'] as const) {
      const a = joints[`${j}.${side}`];
      if (a) pairs.push([new THREE.Vector3(...a.at), worldPos(bone(sideName(b, side)))]);
    }
  }
  let best = { err: Infinity, s: 1, yaw: 0, t: new THREE.Vector3() };
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const ra = pairs.map(([a]) => a.clone().applyQuaternion(q));
    const ca = ra.reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(ra.length);
    const cb = pairs.reduce((s, [, b]) => s.add(b), new THREE.Vector3()).divideScalar(pairs.length);
    let num = 0, den = 0;
    ra.forEach((a, i) => { num += a.clone().sub(ca).dot(pairs[i][1].clone().sub(cb)); den += a.clone().sub(ca).lengthSq(); });
    const s = num / den;
    const t = cb.clone().sub(ca.clone().multiplyScalar(s));
    let err = 0;
    ra.forEach((a, i) => { err += a.clone().multiplyScalar(s).add(t).distanceToSquared(pairs[i][1]); });
    if (err < best.err) best = { err, s, yaw, t };
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), best.yaw);
  const toFile = (v: V3): THREE.Vector3 => new THREE.Vector3(...v).applyQuaternion(q).multiplyScalar(best.s).add(best.t);
  const fitRms = Math.sqrt(best.err / pairs.length) / best.s;

  // ---- target heads: the estimate, mirrored across the body's centre so both sides agree ----
  const target = new Map<string, THREE.Vector3>();
  const moved: Record<string, { from: V3; to: V3; cm: number }> = {};
  for (const j of move) {
    const L = joints[`${j}.L`], R = joints[`${j}.R`];
    if (!L?.est || !R?.est) continue;
    const e: V3 = [(L.est[0] - R.est[0]) / 2, (L.est[1] + R.est[1]) / 2, (L.est[2] + R.est[2]) / 2];
    for (const side of ['L', 'R'] as const) {
      const est: V3 = [side === 'L' ? e[0] : -e[0], e[1], e[2]];
      const at = (side === 'L' ? L : R).at;
      target.set(sideName(HEADS[j], side), toFile(est));
      moved[`${j}.${side}`] = { from: at, to: est.map((n) => +n.toFixed(4)) as V3,
        cm: +(new THREE.Vector3(...at).distanceTo(new THREE.Vector3(...est)) * 100).toFixed(1) };
    }
  }

  // ---- new world matrices for every chain bone ----
  const oldWorld = new Map<THREE.Object3D, THREE.Matrix4>();
  scene.traverse((o) => oldWorld.set(o, o.matrixWorld.clone()));
  const newWorld = new Map<THREE.Object3D, THREE.Matrix4>();
  for (const chain of CHAINS) {
    for (const side of ['L', 'R'] as const) {
      const names = chain.map(([b]) => sideName(b, side));
      const objs = names.map(bone);
      const oldHead = objs.map(worldPos);
      const head = oldHead.map((p, i) => target.get(names[i])?.clone() ?? p.clone());
      // twist bones stay at the middle of their segment
      chain.forEach(([, role], i) => {
        if (role === 'mid') head[i] = head[i - 1].clone().lerp(head[i + 1], 0.5);
      });
      objs.forEach((o, i) => {
        const m = oldWorld.get(o)!;
        const pos = new THREE.Vector3(), rot = new THREE.Quaternion(), scl = new THREE.Vector3();
        m.decompose(pos, rot, scl);
        // turn the bone (keeping its roll) so it points from its new head to its child's new head
        if (i + 1 < objs.length) {
          const from = oldHead[i + 1].clone().sub(oldHead[i]).normalize();
          const to = head[i + 1].clone().sub(head[i]).normalize();
          rot.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
        }
        newWorld.set(o, new THREE.Matrix4().compose(head[i], rot, scl));
      });
    }
  }

  // ---- write locals: parents first; anything not re-aimed keeps its world transform ----
  const finalWorld = new Map<THREE.Object3D, THREE.Matrix4>();
  const changed: number[] = [];
  const visit = (o: THREE.Object3D, parentWorld: THREE.Matrix4): void => {
    const w = newWorld.get(o) ?? oldWorld.get(o)!;
    finalWorld.set(o, w);
    const idx = indexOf.get(o);
    const local = parentWorld.clone().invert().multiply(w);
    const oldLocal = oldWorld.get(o.parent!) ? oldWorld.get(o.parent!)!.clone().invert().multiply(oldWorld.get(o)!) : null;
    if (idx !== undefined && oldLocal && !local.equals(oldLocal)) {
      const p = new THREE.Vector3(), r = new THREE.Quaternion(), s = new THREE.Vector3();
      local.decompose(p, r, s);
      const n = json.nodes[idx];
      if (p.distanceTo(new THREE.Vector3(...(n.translation ?? [0, 0, 0]))) > 1e-7
        || Math.abs(r.dot(new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])))) < 1 - 1e-9) {
        delete n.matrix;
        n.translation = p.toArray();
        n.rotation = r.toArray();
        n.scale = s.toArray();
        changed.push(idx);
      }
    }
    for (const c of o.children) visit(c, w);
  };
  for (const c of scene.children) visit(c, scene.matrixWorld);

  // ---- inverse bind matrices: IBM' = W'^-1 · W · IBM keeps the bind pose exact ----
  for (const skin of json.skins ?? []) {
    const acc = json.accessors[skin.inverseBindMatrices];
    const bv = json.bufferViews[acc.bufferView];
    if (bv.extensions?.EXT_meshopt_compression) throw new Error('compressed inverse bind matrices: use the shipped (uncompressed) file');
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const f = new Float32Array(bin.buffer, bin.byteOffset + base, skin.joints.length * 16);
    skin.joints.forEach((ni: number, k: number) => {
      const o = nodeOf.get(ni)!;
      const ibm = new THREE.Matrix4().fromArray(f, k * 16);
      const next = finalWorld.get(o)!.clone().invert().multiply(oldWorld.get(o)!).multiply(ibm);
      next.toArray(f, k * 16);
    });
  }
  json.asset = { ...json.asset, extras: { ...(json.asset?.extras ?? {}), rerig: { from: url, source, moved: Object.keys(moved) } } };
  const out = writeGlb(json, bin);
  let s = '';
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return { glb: btoa(s), report: { fitRmsCm: +(fitRms * 100).toFixed(2), yawDeg: +THREE.MathUtils.radToDeg(best.yaw).toFixed(0), scale: best.s, moved, changedNodes: changed.length } };
}

(window as unknown as { __rerig: typeof rerig }).__rerig = rerig;
