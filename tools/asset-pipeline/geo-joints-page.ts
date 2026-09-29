/**
 * Page half of `geo-joints.mjs`: loads a character through the game's own
 * loader (so it is in exactly the frame and size the game fits it to: metres,
 * x = the character's left, y up, z forward, feet on y = 0) and hands back its
 * bind-pose triangles and, separately, where its skeleton puts each joint.
 *
 * The triangles are all the estimator sees — the joints are returned only so
 * the report can compare against them. Also draws results (`__geoShot`): the
 * model and/or its geometric stand-in, with joint markers.
 */
import * as THREE from 'three';
import { loadAuthored } from '../../src/characters/authored';
import type { BoneName } from '../../src/anim/skeleton';

type V3 = [number, number, number];

const JOINT_BONES: Array<[string, BoneName]> = [
  ['pelvis', 'hips'], ['neck', 'neck'], ['head', 'head'],
  ['shoulder.L', 'upperArmL'], ['elbow.L', 'forearmL'], ['wrist.L', 'handL'],
  ['shoulder.R', 'upperArmR'], ['elbow.R', 'forearmR'], ['wrist.R', 'handR'],
  ['hip.L', 'upperLegL'], ['knee.L', 'lowerLegL'], ['ankle.L', 'footL'],
  ['hip.R', 'upperLegR'], ['knee.R', 'lowerLegR'], ['ankle.R', 'footR'],
];

function visible(o: THREE.Object3D): boolean {
  for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false;
  return true;
}

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;

async function dump(id: string, height: number): Promise<{ tris: string; count: number; joints: Record<string, V3>; bones: Array<{ name: string; at: V3; parent: number }> }> {
  const model = await loadAuthored(id, height);
  if (!model) throw new Error(`${id}.glb did not load`);
  const frame = new THREE.Group();
  frame.add(model.root);
  frame.updateMatrixWorld(true);
  const toFrame = frame.matrixWorld.clone().invert();
  const out: number[] = [];
  const v = new THREE.Vector3();
  model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !visible(mesh)) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
    const m = new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld);
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // bind pose: skinning here reproduces the sculpt
      mesh.getVertexPosition(i, v).applyMatrix4(m);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    const index = geo.index;
    const n = index ? index.count : pos.count;
    const matOf = (k: number): THREE.Material | undefined => {
      if (!geo.groups.length || mats.length < 2) return mats[0];
      const g = geo.groups.find((gr) => k >= gr.start && k < gr.start + gr.count);
      return g ? mats[g.materialIndex ?? 0] : mats[0];
    };
    for (let k = 0; k + 2 < n; k += 3) {
      const mt = matOf(k);
      if (!mt || mt.visible === false) continue;
      for (let c = 0; c < 3; c++) {
        const i = index ? index.getX(k + c) : k + c;
        out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      }
    }
  });
  const f = new Float32Array(out);
  const bytes = new Uint8Array(f.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const at = (o: THREE.Object3D): V3 => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(toFrame).toArray().map(r4) as V3;
  const joints: Record<string, V3> = {};
  for (const [j, b] of JOINT_BONES) {
    const node = model.nodes.find((x) => x.canonical === b);
    if (node) joints[j] = at(node.obj);
  }
  const bones = model.nodes.map((nd) => ({ name: nd.obj.name, at: at(nd.obj), parent: nd.parent }));
  return { tris: btoa(s), count: f.length / 9, joints, bones };
}

// ------------------------------------------------------------------ drawing
interface Seg { a: V3; b: V3; r0: number; r1: number; e0?: number; e1?: number; flat?: boolean }
interface ShotSpec {
  id: string; height: number;
  markers: Array<{ color: number; r: number; pts: V3[] }>;
  links?: Array<{ color: number; a: V3; b: V3 }>;
  standIn: Seg[];
  /** 'model' (model + markers), 'standin' (stand-in + markers), 'both' */
  mode: 'model' | 'standin' | 'both';
  views?: Array<'front' | 'side' | 'back' | 'threeq'>;
  zoom?: { centre: V3; half: number };
  opacity?: number;
}

async function shot(spec: ShotSpec): Promise<string> {
  const views = spec.views ?? ['front', 'side'];
  const W = 600 * views.length, H = 900;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.autoClear = false;
  document.body.innerHTML = '';
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  if (spec.mode !== 'standin') {
    const model = await loadAuthored(spec.id, spec.height);
    if (!model) throw new Error(`${spec.id}.glb did not load`);
    scene.add(model.root);
    const op = spec.opacity ?? (spec.mode === 'both' ? 0.25 : 0.4);
    model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      if (op >= 1) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      const clear = mats.map((mt) => { const c = mt.clone(); c.transparent = true; c.opacity = op; c.depthWrite = false; return c; });
      m.material = clear.length === 1 ? clear[0] : clear;
    });
  }
  if (spec.mode !== 'model') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.8, transparent: spec.mode === 'both', opacity: spec.mode === 'both' ? 0.55 : 1 });
    for (const s of spec.standIn) {
      const a = new THREE.Vector3(...s.a), b = new THREE.Vector3(...s.b);
      const len = a.distanceTo(b);
      if (s.flat) {
        // a torso slab: an elliptic frustum, no end caps
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(s.r1, s.r0, Math.max(len, 1e-3), 20, 1, false), mat);
        mesh.position.copy(a).lerp(b, 0.5);
        mesh.scale.set(1, 1, ((s.e0 ?? 1) + (s.e1 ?? 1)) / 2);
        scene.add(mesh);
        continue;
      }
      if (len > 1e-4) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(s.r1, s.r0, len, 16, 1, false), mat);
        mesh.position.copy(a).lerp(b, 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        scene.add(mesh);
      }
      for (const [p, r] of [[a, s.r0], [b, s.r1]] as const) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
        cap.position.copy(p);
        scene.add(cap);
      }
    }
  }
  for (const set of spec.markers) {
    const g = new THREE.SphereGeometry(set.r, 12, 8);
    const mt = new THREE.MeshBasicMaterial({ color: set.color, depthTest: false });
    for (const p of set.pts) {
      const m = new THREE.Mesh(g, mt);
      m.position.fromArray(p);
      m.renderOrder = 10;
      scene.add(m);
    }
  }
  for (const l of spec.links ?? []) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...l.a), new THREE.Vector3(...l.b)]),
      new THREE.LineBasicMaterial({ color: l.color, depthTest: false }));
    line.renderOrder = 11;
    scene.add(line);
  }
  const h = spec.height;
  renderer.setClearColor(0x202428);
  renderer.clear();
  const c = spec.zoom ? new THREE.Vector3(...spec.zoom.centre) : new THREE.Vector3(0, h / 2, 0);
  const half = spec.zoom?.half ?? h * 0.55;
  const dirs: Record<string, THREE.Vector3> = {
    front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, -1),
    threeq: new THREE.Vector3(0.7, 0.25, 0.7).normalize(),
  };
  views.forEach((vw, i) => {
    const cam = new THREE.OrthographicCamera(-half * 600 / 900, half * 600 / 900, half, -half, 0.1, 50);
    cam.position.copy(c).addScaledVector(dirs[vw], 10);
    cam.lookAt(c);
    renderer.setViewport(i * 600, 0, 600, H);
    renderer.render(scene, cam);
  });
  const url = renderer.domElement.toDataURL('image/png');
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mt of (Array.isArray(m.material) ? m.material : [m.material])) mt.dispose();
  });
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}

Object.assign(window as unknown as Record<string, unknown>, { __geoDump: dump, __geoShot: shot, __geoReady: true });
