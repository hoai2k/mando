import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterInstance } from '../characters/builder';
import { loadOptionalTexture } from '../core/assets';
import { findPose, POSES, type Pose } from './poses';
import { findSubject, GROUPS, type Subject } from './roster';
import './workbench.css';

/**
 * Model workbench — /workbench/?edit=models
 *
 * A turntable for the cast: pick a character, run any clip the game plays on
 * them, and stand the authored model next to the procedural build it replaces.
 * It shares the game's rig, clips and animator wholesale, so what it shows is
 * what the game does; there is no second animation path to drift out of sync.
 */

type Mode = 'authored' | 'procedural' | 'both';

interface Figure {
  inst: CharacterInstance;
  /** the character factory hands back extras on the Mandalorians */
  extras: {
    setThrust?: (t: number) => void;
    setWeapon?: (w: 'blaster' | 'gaffi') => void;
    setBlock?: (t: number) => void;
  };
  label: string;
}

// ---------- scene ----------
const stage = document.getElementById('stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
camera.position.set(2.4, 1.6, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;
controls.minDistance = 0.8;
controls.maxDistance = 14;

// Lighting mirrors the desert board closely enough that a character judged
// here looks the same in play: one warm key with shadows, a cool bounce, and
// a reflection probe so the authored models' metal has something to catch.
const key = new THREE.DirectionalLight(0xffe8c0, 2.4);
key.position.set(3.5, 6, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1;
key.shadow.camera.far = 20;
for (const side of ['left', 'right', 'top', 'bottom'] as const) {
  key.shadow.camera[side] = side === 'left' || side === 'bottom' ? -4 : 4;
}
scene.add(key);
scene.add(new THREE.HemisphereLight(0xcfe0f0, 0x40352a, 0.9));
const rim = new THREE.DirectionalLight(0x9fc4ff, 0.8);
rim.position.set(-4, 3, -5);
scene.add(rim);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
// swap in the real sky once it loads, so metal reflects the game's world
loadOptionalTexture('sky_desert', (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment?.dispose();
  scene.environment = pmrem.fromEquirectangular(tex).texture;
});

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.95 }),
);
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(12, 24, 0x4a5160, 0x2a2f38);
grid.position.y = 0.002;
scene.add(grid);

/** a 2 m scale post, so silhouette height is judged against something */
const ruler = new THREE.Group();
for (let m = 0; m < 4; m++) {
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.5, 0.05),
    new THREE.MeshStandardMaterial({ color: m % 2 ? 0xd8dde6 : 0x4a5160, roughness: 0.8 }),
  );
  bar.position.set(-1.6, 0.25 + m * 0.5, -0.9);
  ruler.add(bar);
}
scene.add(ruler);

// ---------- figures ----------
const turntable = new THREE.Group();
scene.add(turntable);
let figures: Figure[] = [];
let skeletons: THREE.SkeletonHelper[] = [];

let subject: Subject = findSubject(new URLSearchParams(location.search).get('character') ?? 'din');
let pose: Pose = findPose('idle');
let mode: Mode = 'both';
let spin = false;
/** mesh count the camera framing was computed for; authored skins arrive late */
let framedAt = -1;
let showSkeleton = false;
let showGrid = true;

function disposeFigures(): void {
  for (const f of figures) turntable.remove(f.inst.root);
  for (const s of skeletons) scene.remove(s);
  figures = [];
  skeletons = [];
}

function spawn(): void {
  disposeFigures();
  const wants: Array<[boolean, string]> = subject.hasModel && mode === 'both'
    ? [[true, 'Authored model'], [false, 'Procedural']]
    : [[mode !== 'procedural' && subject.hasModel, mode === 'procedural' || !subject.hasModel ? 'Procedural' : 'Authored model']];

  const sides = wants.length > 1 ? ['Left', 'Right'] : [''];
  figures = wants.map(([authored, label], i) => {
    const inst = subject.build(authored) as CharacterInstance & Figure['extras'];
    inst.root.position.x = wants.length > 1 ? (i === 0 ? -0.75 : 0.75) : 0;
    inst.root.traverse((o) => { o.castShadow ||= (o as THREE.Mesh).isMesh; });
    turntable.add(inst.root);
    return { inst, extras: inst, label: sides[i] ? `${sides[i]} — ${label}` : label };
  });

  for (const f of figures) {
    const helper = new THREE.SkeletonHelper(f.inst.root);
    helper.visible = showSkeleton;
    skeletons.push(helper);
    scene.add(helper);
  }
  applyPose();
  renderLegend();
  frameSubject();
}

/**
 * Point the camera at whatever is on the turntable now, keeping the direction
 * the user was already looking from. Characters range from a crouched Nikto to
 * a two-metre Dark Trooper, and a fixed camera either crops or strands them.
 */
function visibleMeshCount(): number {
  let n = 0;
  for (const f of figures) f.inst.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) n++; });
  return n;
}

function frameSubject(): void {
  framedAt = visibleMeshCount();
  const box = new THREE.Box3();
  for (const f of figures) {
    f.inst.root.updateWorldMatrix(true, true);
    f.inst.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || !mesh.visible) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
    });
  }
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const extent = Math.max(size.x / camera.aspect, size.y);
  const dist = (extent / 2) / Math.tan((camera.fov * Math.PI) / 360) * 1.5;
  const dir = camera.position.clone().sub(controls.target).normalize();
  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(dir, dist);
  controls.update();
}

function applyPose(): void {
  for (const f of figures) {
    const anim = f.inst.animator;
    if (!anim) continue;
    anim.releaseAll();
    if (pose.lower) anim.play('lower', pose.lower, 0, pose.rate ?? 1);
    if (pose.upper) anim.play('upper', pose.upper, 0, pose.rate ?? 1);
    f.extras.setThrust?.(pose.thrust ?? 0);
    f.extras.setWeapon?.(pose.melee ? 'gaffi' : 'blaster');
    f.extras.setBlock?.(pose.block ? 1 : 0);
  }
}

// ---------- panel ----------
const panel = document.getElementById('panel')!;

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
}

function renderPanel(): void {
  const characterOptions = GROUPS
    .map((g) => `<optgroup label="${g.label}">`
      + g.subjects.map((s) => option(s.id, s.name, s.id === subject.id)).join('')
      + '</optgroup>')
    .join('');

  panel.innerHTML = `
    <h1>Model workbench</h1>
    <p class="sub">Game rig, game clips — nothing simulated twice.</p>

    <div class="field">
      <label for="character">Character</label>
      <select id="character">${characterOptions}</select>
    </div>

    <div class="field">
      <label for="pose">Animation</label>
      <select id="pose">${POSES.map((p) => option(p.id, p.name, p.id === pose.id)).join('')}</select>
    </div>

    <div class="field">
      <label>Show</label>
      <div class="seg" id="mode">
        <button data-mode="authored" aria-pressed="${mode === 'authored'}">Model</button>
        <button data-mode="procedural" aria-pressed="${mode === 'procedural'}">Procedural</button>
        <button data-mode="both" aria-pressed="${mode === 'both'}">Compare</button>
      </div>
    </div>

    <label class="check"><input type="checkbox" id="spin" ${spin ? 'checked' : ''}> Turntable</label>
    <label class="check"><input type="checkbox" id="skeleton" ${showSkeleton ? 'checked' : ''}> Skeleton overlay</label>
    <label class="check"><input type="checkbox" id="grid" ${showGrid ? 'checked' : ''}> Grid &amp; scale post</label>

    <p class="note">
      ${subject.hasModel
        ? `Authored skin from <code>public/models/${subject.id}.glb</code>, driven by the
           procedural rig through the retargeter. Compare puts the two side by side.`
        : 'No authored model for this character yet — procedural build only.'}
      <br><br>Drag to orbit, scroll to zoom. Posts are 0.5&nbsp;m each.
    </p>`;

  panel.querySelector<HTMLSelectElement>('#character')!.onchange = (e) => {
    subject = findSubject((e.target as HTMLSelectElement).value);
    spawn();
    renderPanel();
  };
  panel.querySelector<HTMLSelectElement>('#pose')!.onchange = (e) => {
    pose = findPose((e.target as HTMLSelectElement).value);
    applyPose();
  };
  panel.querySelector('#mode')!.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => { mode = btn.dataset.mode as Mode; spawn(); renderPanel(); };
  });
  panel.querySelector<HTMLInputElement>('#spin')!.onchange = (e) => {
    spin = (e.target as HTMLInputElement).checked;
    if (!spin) turntable.rotation.y = 0;
  };
  panel.querySelector<HTMLInputElement>('#skeleton')!.onchange = (e) => {
    showSkeleton = (e.target as HTMLInputElement).checked;
    for (const s of skeletons) s.visible = showSkeleton;
  };
  panel.querySelector<HTMLInputElement>('#grid')!.onchange = (e) => {
    showGrid = (e.target as HTMLInputElement).checked;
    grid.visible = ruler.visible = showGrid;
  };
}

const legend = document.createElement('div');
legend.className = 'legend';
stage.appendChild(legend);
function renderLegend(): void {
  legend.innerHTML = figures.map((f) => `<span><b>${f.label}</b></span>`).join('');
}

// ---------- loop ----------
function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

let last = performance.now();
let time = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;
  if (spin) turntable.rotation.y += dt * 0.4;
  // an authored .glb lands a beat after the figure does — re-frame when it shows up
  if (figures.length && visibleMeshCount() !== framedAt) frameSubject();
  for (const f of figures) {
    f.inst.animator?.update(dt);
    f.inst.cosmetic?.(dt, time);
  }
  controls.update();
  renderer.render(scene, camera);
}

renderPanel();
spawn();
resize();
requestAnimationFrame(frame);
