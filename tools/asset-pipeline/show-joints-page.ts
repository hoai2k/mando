/**
 * Page half of `show-joints.mjs`: the joint audit drawn over the model in its
 * bind pose. Red = the skeleton's joint, green = the mesh's estimate.
 */
import * as THREE from 'three';
import { loadAuthored } from '../../src/characters/authored';

(async () => {
  const id = new URLSearchParams(location.search).get('id')!;
  const audit = await (await fetch('/docs/audits/rig-joints.json')).json();
  const entry = audit.models[id];
  if (!entry) throw new Error(`${id} is not in the audit`);
  const W = 1200, H = 900;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.autoClear = false;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.5));
  const model = await loadAuthored(id, entry.height);
  if (!model) throw new Error(`${id}.glb did not load`);
  scene.add(model.root);
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    const clear = mats.map((mt) => { const c = mt.clone(); c.transparent = true; c.opacity = 0.35; c.depthWrite = false; return c; });
    m.material = clear.length === 1 ? clear[0] : clear;
    m.frustumCulled = false;
  });
  const dot = (p: number[], color: number, r: number): void => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.fromArray(p);
    m.renderOrder = 10;
    scene.add(m);
  };
  for (const j of Object.values(entry.joints) as Array<{ at: number[]; est: number[] | null }>) {
    dot(j.at, 0xff3030, 0.012);
    if (!j.est) continue;
    dot(j.est, 0x30ff60, 0.01);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3().fromArray(j.at), new THREE.Vector3().fromArray(j.est)]),
      new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false }));
    line.renderOrder = 11;
    scene.add(line);
  }
  const h = entry.height;
  renderer.setClearColor(0x202428);
  renderer.clear();
  for (const [x, eye] of [[0, new THREE.Vector3(0, h / 2, 10)], [W / 2, new THREE.Vector3(10, h / 2, 0)]] as const) {
    const cam = new THREE.OrthographicCamera(-h * 0.45, h * 0.45, h * 0.6, -h * 0.6, 0.1, 50);
    cam.position.copy(eye);
    cam.lookAt(0, h / 2, 0);
    renderer.setViewport(x, 0, W / 2, H);
    renderer.render(scene, cam);
  }
  (window as unknown as { __joints: string }).__joints = renderer.domElement.toDataURL('image/png');
})().catch((err) => { (window as unknown as { __joints: string }).__joints = String(err); });
