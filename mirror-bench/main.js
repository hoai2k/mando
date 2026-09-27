/**
 * Leg Mirror Bench (/mirror-bench/): compares each delivered sculpt
 * (models/sources/) with the weapon-free model the game loads, and previews
 * tools/mirror-lower-body.mjs live on the delivered file with an adjustable
 * mirror plane and cut height.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { planMirror } from '../tools/lib/mirror-core.mjs';

// values the game's models were built with (tools/mirror-lower-body.mjs)
const MODELS = {
  ring_enforcer: {
    name: 'Ringworld Enforcer', heightM: 2.1,
    params: { centreX: -0.016, cutY: 0.13, armX: 0.19, back: null },
    text: 'The holstered pistol on the right hip is gone. The sculpt\u2019s body sits 0.016 model units (about 3.4 cm in game) toward its right of zero, so the mirror plane sits there and the new hip lines up with the torso.',
  },
  flametrooper: {
    name: 'Incinerator Trooper', heightM: 1.9,
    params: { centreX: 0, cutY: 0.13, armX: 0.19, back: { z: -0.08, x: 0.11, cutY: 0.2 } },
    text: 'The flame projector and its hose are gone from the right hip. Down the middle of the back the mirror starts just under the regulator, so both fuel hoses match.',
  },
};

const originalUrl = (m) => `../models/sources/${m}.glb`;
const gameUrl = (m) => `../models/${m}.glb`;
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const state = { model: 'ring_enforcer', mode: 'compare', params: {}, ghost: false, guides: true };

// ---------- renderer: one canvas, one camera, one or two scenes ----------
const canvas = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.05, 0);
camera.position.set(0, 0.1, 3.2);

function makeScene() {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x3a3f46, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1.5, 2.5, 3); s.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-2, 1, -3); s.add(rim);
  return s;
}
const sceneA = makeScene(), sceneB = makeScene();

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
function load(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
}
const setStatus = (t) => { $('status').textContent = t; };

function skinnedOf(root) { let m = null; root.traverse((o) => { if (o.isSkinnedMesh && !m) m = o; }); return m; }
function place(scene, obj) {
  for (const c of [...scene.children]) if (c.userData.slot) scene.remove(c);
  obj.userData.slot = true;
  scene.add(obj);
}

// ---------- the live mirror (tool mode) ----------
let toolRoot = null, toolMesh = null, toolSource = null, ghostMesh = null, guides = null;

async function prepareTool(model) {
  const gltf = await load(originalUrl(model));
  // a private copy of the original skinned model to rebuild in place
  toolRoot = clone(gltf.scene);
  toolMesh = skinnedOf(toolRoot);
  toolMesh.frustumCulled = false;
  toolMesh.userData.origGeo = toolMesh.geometry; // shared with the cached model: never dispose
  const geo = toolMesh.geometry;
  const json = gltf.parser.json;
  const skin = json.skins[0];
  const jointNames = skin.joints.map((j) => (json.nodes[j].name ?? '').replace(/^DEF-/, ''));
  const t = toolMesh.position.toArray(), s = toolMesh.scale.toArray();
  const P = geo.attributes.position, N = geo.attributes.normal, UV = geo.attributes.uv;
  const J = geo.attributes.skinIndex, W = geo.attributes.skinWeight;
  const n = P.count;
  const local = new Float32Array(n * 3), model3 = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) {
    const q = P.getComponent(v, a);
    local[v * 3 + a] = q;
    model3[v * 3 + a] = t[a] + s[a] * q;
  }
  const joints = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) { joints[v * 4 + k] = J.getComponent(v, k); weights[v * 4 + k] = W.getComponent(v, k); }
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) for (let a = 0; a < 3; a++) normals[v * 3 + a] = N.getComponent(v, a);
  const uvs = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) { uvs[v * 2] = UV.getX(v); uvs[v * 2 + 1] = UV.getY(v); }
  toolSource = { t, s, n, local, model: model3, joints, weights, normals, uvs, indices: Array.from(geo.index.array), jointNames };

  const ghostMat = new THREE.MeshBasicMaterial({ color: css('--plane'), wireframe: true, transparent: true, opacity: 0.18, depthWrite: false });
  const gClone = clone(gltf.scene);
  ghostMesh = skinnedOf(gClone);
  ghostMesh.material = ghostMat;
  ghostMesh.frustumCulled = false;
  gClone.visible = state.ghost;
  toolRoot.add(gClone);
  toolRoot.userData.ghost = gClone;
}

function rebuildTool() {
  if (!toolSource) return;
  const src = toolSource, p = state.params;
  const t0 = performance.now();
  const plan = planMirror({ positions: src.model, joints: src.joints, weights: src.weights, indices: src.indices, jointNames: src.jointNames }, p);
  const total = src.n + plan.sources.length;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const ji = new Uint16Array(total * 4), wt = new Float32Array(total * 4);
  pos.set(src.local); nor.set(src.normals); uv.set(src.uvs); ji.set(src.joints); wt.set(src.weights);
  const qCentre = (p.centreX - src.t[0]) / src.s[0];
  plan.sources.forEach((v, i) => {
    const d = src.n + i;
    pos[d * 3] = 2 * qCentre - src.local[v * 3]; pos[d * 3 + 1] = src.local[v * 3 + 1]; pos[d * 3 + 2] = src.local[v * 3 + 2];
    nor[d * 3] = -src.normals[v * 3]; nor[d * 3 + 1] = src.normals[v * 3 + 1]; nor[d * 3 + 2] = src.normals[v * 3 + 2];
    uv[d * 2] = src.uvs[v * 2]; uv[d * 2 + 1] = src.uvs[v * 2 + 1];
    for (let k = 0; k < 4; k++) { ji[d * 4 + k] = plan.mirrorJoint[src.joints[v * 4 + k]]; wt[d * 4 + k] = src.weights[v * 4 + k]; }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(wt, 4));
  g.setIndex(plan.indices);
  const old = toolMesh.geometry;
  toolMesh.geometry = g;
  if (old !== toolMesh.userData.origGeo) old.dispose();
  setStatus(`${plan.dropped} dropped · ${plan.mirrored} mirrored · ${Math.round(performance.now() - t0)} ms`);
  drawGuides();
}

function drawGuides() {
  if (guides) sceneA.remove(guides);
  guides = new THREE.Group();
  guides.visible = state.guides;
  const p = state.params;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.08),
    new THREE.MeshBasicMaterial({ color: css('--plane'), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  plane.rotation.y = Math.PI / 2; plane.position.set(p.centreX, 0, 0);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color: css('--plane') }));
  edge.rotation.copy(plane.rotation); edge.position.copy(plane.position);
  const cutRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => {
      const a = i / 64 * Math.PI * 2; return new THREE.Vector3(p.centreX + Math.cos(a) * 0.22, p.cutY, Math.sin(a) * 0.16);
    })),
    new THREE.LineBasicMaterial({ color: css('--cut') }));
  guides.add(plane, edge, cutRing);
  sceneA.add(guides);
}

// ---------- modes ----------
async function show() {
  try { await showModel(); } catch (err) { setStatus(`Could not load the model: ${err.message}`); }
}
async function showModel() {
  const m = MODELS[state.model];
  setStatus('Loading…');
  if (state.mode === 'compare') {
    const [a, b] = await Promise.all([load(originalUrl(state.model)), load(gameUrl(state.model))]);
    if (guides) { sceneA.remove(guides); guides = null; }
    place(sceneA, a.scene); place(sceneB, b.scene);
    a.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    b.scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    $('compare-text').textContent = m.text;
    const c = m.params;
    $('compare-facts').innerHTML = '';
    for (const [k, v] of [['Height in game', `${m.heightM} m`], ['Mirror centre', `x = ${c.centreX}`], ['Cut height', `y = ${c.cutY}`], ['Back cut', c.back ? `y = ${c.back.cutY}` : 'none']]) {
      const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v;
      $('compare-facts').append(dt, dd);
    }
    setStatus(m.name);
  } else {
    toolSource = null;
    await prepareTool(state.model);
    place(sceneA, toolRoot);
    rebuildTool();
  }
  layoutTags();
}

function syncControls() {
  const p = state.params, m = MODELS[state.model];
  const cm = (u) => (u * m.heightM * 100).toFixed(1);
  $('cx').value = p.centreX; $('cx-num').value = p.centreX.toFixed(3);
  $('cx-val').innerHTML = `${p.centreX.toFixed(3)} <small>(${cm(p.centreX)} cm)</small>`;
  $('cy').value = p.cutY;
  $('cy-val').innerHTML = `${p.cutY.toFixed(3)} <small>(${cm(p.cutY + 0.5)} cm up)</small>`;
  $('json').textContent = JSON.stringify(settingsJson(), null, 2);
}
function settingsJson() {
  const p = state.params;
  return { model: state.model, centreX: +p.centreX.toFixed(4), cutY: +p.cutY.toFixed(4), armX: p.armX, back: p.back };
}
function resetParams() { state.params = structuredClone(MODELS[state.model].params); syncControls(); }

let pending = 0;
function scheduleRebuild() {
  syncControls();
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(rebuildTool);
}
function setCentre(v) { state.params.centreX = Math.max(-0.1, Math.min(0.1, Math.round(v * 1000) / 1000)); scheduleRebuild(); }

$('cx').addEventListener('input', (e) => setCentre(+e.target.value));
$('cx-num').addEventListener('change', (e) => { if (Number.isFinite(+e.target.value)) setCentre(+e.target.value); });
$('cx-dn').addEventListener('click', () => setCentre(state.params.centreX - 0.001));
$('cx-up').addEventListener('click', () => setCentre(state.params.centreX + 0.001));
$('cy').addEventListener('input', (e) => { state.params.cutY = +e.target.value; scheduleRebuild(); });
$('ghost').addEventListener('change', (e) => { state.ghost = e.target.checked; if (toolRoot?.userData.ghost) toolRoot.userData.ghost.visible = state.ghost; });
$('guides').addEventListener('change', (e) => { state.guides = e.target.checked; if (guides) guides.visible = state.guides; });
$('reset').addEventListener('click', () => { resetParams(); scheduleRebuild(); note('Back to the in-game values.', 'ok'); });

function note(text, kind = '') { const el = $('note'); el.textContent = text; el.className = `note ${kind}`; }

// ---------- saving: copy or download the settings JSON ----------
$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(settingsJson(), null, 2);
  try { await navigator.clipboard.writeText(text); note('JSON copied. Paste it to Claude.', 'ok'); }
  catch {
    const r = document.createRange(); r.selectNodeContents($('json'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    note('Copy was blocked, so the JSON is selected. Copy it from there.', 'warn');
  }
});
$('dl').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(settingsJson(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.model}-mirror.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  note('JSON downloaded.', 'ok');
});

// ---------- tabs ----------
function press(group, attr, value) {
  document.querySelectorAll(`[${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value)));
}
document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => {
  if (state.model === b.dataset.model) return;
  state.model = b.dataset.model; press('m', 'data-model', state.model); resetParams(); note(''); show();
}));
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  if (state.mode === b.dataset.mode) return;
  state.mode = b.dataset.mode; press('v', 'data-mode', state.mode);
  $('panel-compare').hidden = state.mode !== 'compare'; $('panel-tool').hidden = state.mode !== 'tool';
  show();
}));
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
  const a = +b.dataset.view * Math.PI / 180, d = camera.position.distanceTo(controls.target);
  camera.position.set(controls.target.x + Math.sin(a) * d, controls.target.y + 0.05, controls.target.z + Math.cos(a) * d);
}));

// ---------- layout + loop ----------
const stage = $('stage');
function split() { return stage.clientWidth >= stage.clientHeight * 0.9 ? 'row' : 'col'; }
function layoutTags() {
  const two = state.mode === 'compare';
  $('tags').hidden = !two;
  $('tags').classList.toggle('stack', split() === 'col');
}
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  layoutTags();
}
new ResizeObserver(resize).observe(stage);

function frame() {
  controls.update();
  const w = stage.clientWidth, h = stage.clientHeight;
  const bg = new THREE.Color(css('--stage'));
  renderer.setScissorTest(true);
  if (state.mode === 'compare') {
    const row = split() === 'row';
    const vw = row ? Math.floor(w / 2) : w, vh = row ? h : Math.floor(h / 2);
    camera.aspect = vw / vh; camera.updateProjectionMatrix();
    for (const [i, sc] of [[0, sceneA], [1, sceneB]]) {
      const x = row ? i * vw : 0, y = row ? 0 : (1 - i) * vh;
      renderer.setViewport(x, y, vw, vh); renderer.setScissor(x, y, vw, vh);
      sc.background = bg;
      renderer.render(sc, camera);
    }
  } else {
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
    sceneA.background = bg;
    renderer.render(sceneA, camera);
  }
  requestAnimationFrame(frame);
}

resetParams();
resize();
show().catch((err) => setStatus(`Could not load the model: ${err.message}`));
window.addEventListener('unhandledrejection', (e) => setStatus(`Error: ${e.reason?.message ?? e.reason}`));
frame();
