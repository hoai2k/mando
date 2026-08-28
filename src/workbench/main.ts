import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterInstance } from '../characters/builder';
import { loadOptionalTexture } from '../core/assets';
import { findPose, POSES, type Pose } from './poses';
import { PoseEditor, type GizmoSpace } from './poseEdit';
import { findSubject, GROUPS, type Subject } from './roster';
import { BONES } from '../anim/skeleton';
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
  extras: { setThrust?: (t: number) => void; setWeapon?: (w: 'blaster' | 'gaffi') => void };
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
let editing = false;

const editor = new PoseEditor(scene, camera, controls, renderer.domElement, onEditorChange);

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
  editor.setTargets(figures
    .filter((f) => f.inst.rig)
    .map((f) => ({ label: f.label, bones: f.inst.rig!.bones as Record<string, THREE.Object3D> })));
  if (editing) enterEdit();
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
  }
}

/**
 * Hold the pose still so it can be edited: rewind both channels to their first
 * keyframe, write that frame onto the bones, then stop advancing the mixer (the
 * frame loop skips `animator.update` while editing). Frame 0 is the honest
 * thing to edit against — a clip sampled mid-cycle would export numbers that
 * match no keyframe in `clips.ts`.
 */
function freezePose(): void {
  for (const f of figures) {
    const anim = f.inst.animator;
    if (!anim) continue;
    for (const name of [pose.lower, pose.upper]) {
      if (!name) continue;
      const clip = anim.clips[name];
      const action = clip && anim.mixer.existingAction(clip);
      if (action) action.time = 0;
    }
    anim.update(0);
  }
}

function enterEdit(): void {
  editing = true;
  spin = false;
  turntable.rotation.y = 0;
  freezePose();
  editor.setEnabled(true);
}

function leaveEdit(): void {
  editing = false;
  editor.restoreBaseline();
  editor.setEnabled(false);
  applyPose();
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

    <label class="check"><input type="checkbox" id="spin" ${spin ? 'checked' : ''} ${editing ? 'disabled' : ''}> Turntable</label>
    <label class="check"><input type="checkbox" id="skeleton" ${showSkeleton ? 'checked' : ''}> Skeleton overlay</label>
    <label class="check"><input type="checkbox" id="grid" ${showGrid ? 'checked' : ''}> Grid &amp; scale post</label>

    <button id="editToggle" class="toggle" aria-pressed="${editing}">
      ${editing ? 'Leave edit mode' : 'Edit mode'}
    </button>
    <div id="edit"></div>

    <p class="note">
      ${subject.hasModel
        ? `Authored skin from <code>public/models/${subject.id}.glb</code>, driven by the
           procedural rig through the retargeter. Compare puts the two side by side.`
        : 'No authored model for this character yet — procedural build only.'}
      <br><br>Drag to orbit, scroll to zoom. Posts are 0.5&nbsp;m each.
      <br><br><b>Edit mode</b> freezes the pose at its first keyframe, draws the rig
      on the figure and gives the joint you click a rotation gizmo. Export hands
      you a JSON of the changed bones in <code>clips.ts</code> units.
    </p>`;

  panel.querySelector<HTMLSelectElement>('#character')!.onchange = (e) => {
    subject = findSubject((e.target as HTMLSelectElement).value);
    spawn();
    renderPanel();
  };
  panel.querySelector<HTMLSelectElement>('#pose')!.onchange = (e) => {
    pose = findPose((e.target as HTMLSelectElement).value);
    // a pose switch mid-edit drops the edits: they belonged to the old clip
    if (editing) editor.restoreBaseline();
    applyPose();
    if (editing) { freezePose(); editor.captureBaseline(); }
    renderEditPanel();
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
  panel.querySelector<HTMLButtonElement>('#editToggle')!.onclick = () => {
    if (editing) leaveEdit(); else enterEdit();
    renderPanel();
  };
  renderEditPanel();
}

// ---------- edit panel ----------
/**
 * The edit-mode controls live in their own subtree so a drag can refresh the
 * numbers 60 times a second without tearing down the pickers (or stealing
 * focus from a field being typed into).
 */
const EDITABLE_BONES = BONES.filter((b) => b !== 'weaponL' && b !== 'weaponR');
let editSignature = '';

function renderEditPanel(): void {
  const host = panel.querySelector<HTMLDivElement>('#edit');
  if (!host) return;
  if (!editing) {
    host.innerHTML = '';
    editSignature = '';
    return;
  }

  const sel = editor.selected;
  const changed = editor.editedBones();
  editSignature = `${sel}|${editor.space}|${changed.join(',')}`;
  const deg = editor.selectedEuler();

  host.innerHTML = `
    <div class="editbox">
      <div class="field">
        <label>Rotate about</label>
        <div class="seg" id="space">
          <button data-space="camera" aria-pressed="${editor.space === 'camera'}">Camera</button>
          <button data-space="local" aria-pressed="${editor.space === 'local'}">Local</button>
          <button data-space="world" aria-pressed="${editor.space === 'world'}">World</button>
        </div>
      </div>

      <div class="field">
        <label for="bone">Joint</label>
        <select id="bone">
          <option value=""${sel ? '' : ' selected'}>— click a joint in the viewport —</option>
          ${EDITABLE_BONES.map((b) => option(b, b, b === sel)).join('')}
        </select>
      </div>

      ${sel && deg ? `
        <div class="field">
          <label>Local rotation — degrees, XYZ</label>
          <div class="xyz">
            <input type="number" id="rx" step="1" value="${deg[0].toFixed(1)}">
            <input type="number" id="ry" step="1" value="${deg[1].toFixed(1)}">
            <input type="number" id="rz" step="1" value="${deg[2].toFixed(1)}">
          </div>
        </div>
        <div class="row">
          <button id="resetBone">Reset ${sel}</button>
        </div>
        <p class="hint" id="drag">${editor.dragAxis
          ? `${editor.dragAxis.toUpperCase()} ring · ${editor.dragAngle.toFixed(1)}°`
          : 'Drag a ring to rotate; hold Shift to snap to 5°.'}</p>
        <p class="hint keys">
          <b style="color:#ff6b6b">X</b> · <b style="color:#86e07a">Y</b> ·
          <b style="color:#6aa8ff">Z</b> of the chosen space${editor.space === 'camera'
            ? ' — screen right, screen up, and roll in the screen plane.'
            : `, plus the outer <b style="color:#ffd479">gold</b> ring: roll about the view direction.`}
        </p>
      ` : '<p class="hint">Pick a joint — its shoulder/elbow rings appear on the figure.</p>'}

      <div class="row">
        <button id="resetAll"${changed.length ? '' : ' disabled'}>Reset all</button>
        <button id="export" class="primary"${changed.length ? '' : ' disabled'}>Export changes</button>
      </div>
      <p class="note edited">${changed.length
        ? `<b>Edited:</b> ${changed.join(', ')}`
        : 'No edits yet. Rotations apply to every figure on the turntable at once.'}</p>
    </div>`;

  host.querySelector('#space')!.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => { editor.setSpace(btn.dataset.space as GizmoSpace); renderEditPanel(); };
  });
  host.querySelector<HTMLSelectElement>('#bone')!.onchange = (e) => {
    editor.select((e.target as HTMLSelectElement).value || null);
  };
  const fields = ['#rx', '#ry', '#rz'].map((id) => host.querySelector<HTMLInputElement>(id));
  if (fields[0]) {
    for (const f of fields) {
      f!.oninput = () => {
        editor.setSelectedEuler(fields.map((x) => Number(x!.value) || 0) as [number, number, number]);
      };
    }
  }
  host.querySelector<HTMLButtonElement>('#resetBone')?.addEventListener('click', () => {
    if (editor.selected) editor.resetBone(editor.selected);
  });
  host.querySelector<HTMLButtonElement>('#resetAll')!.onclick = () => editor.resetAll();
  host.querySelector<HTMLButtonElement>('#export')!.onclick = exportChanges;
}

/** Cheap refresh: numbers only, leaving the DOM (and focus) where it is. */
function syncEditValues(): void {
  const host = panel.querySelector<HTMLDivElement>('#edit');
  if (!host) return;
  const deg = editor.selectedEuler();
  if (deg) {
    (['#rx', '#ry', '#rz'] as const).forEach((id, i) => {
      const input = host.querySelector<HTMLInputElement>(id);
      if (input && document.activeElement !== input) input.value = deg[i].toFixed(1);
    });
  }
  const drag = host.querySelector<HTMLParagraphElement>('#drag');
  if (drag) {
    drag.textContent = editor.dragAxis
      ? `${editor.dragAxis.toUpperCase()} ring · ${editor.dragAngle.toFixed(1)}°`
      : 'Drag a ring to rotate. Hold Shift to snap to 5°.';
  }
}

function onEditorChange(): void {
  if (!editing) return;
  const sig = `${editor.selected}|${editor.space}|${editor.editedBones().join(',')}`;
  if (sig !== editSignature) renderEditPanel();
  else syncEditValues();
}

// ---------- export ----------
/**
 * Hand the edits back as JSON: absolute local eulers in degrees, XYZ order —
 * the same units and order `qt()` in `src/anim/clips.ts` takes — plus the
 * keyframes each edited bone currently has in the clip, so a bone that is
 * animated across several keys can be corrected by its delta rather than
 * flattened to one frame.
 */
function clipKeys(clip: THREE.AnimationClip | undefined, bone: string): Array<{ t: number; deg: number[] }> | null {
  const track = clip?.tracks.find((t) => t.name === `${bone}.quaternion`);
  if (!track) return null;
  const q = new THREE.Quaternion();
  const v = track.values;
  const out: Array<{ t: number; deg: number[] }> = [];
  for (let i = 0; i < track.times.length; i++) {
    q.set(v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    out.push({
      t: Math.round(track.times[i] * 1000) / 1000,
      deg: [e.x, e.y, e.z].map((v) => Math.round((v * 180) / Math.PI * 100) / 100),
    });
  }
  return out;
}

function exportChanges(): void {
  const changes = editor.changes();
  const clips = figures.find((f) => f.inst.animator)?.inst.animator?.clips;

  const bones: Record<string, unknown> = {};
  for (const [name, change] of Object.entries(changes)) {
    const upper = pose.upper ? clipKeys(clips?.[pose.upper], name) : null;
    const lower = pose.lower ? clipKeys(clips?.[pose.lower], name) : null;
    const channel = upper ? 'upper' : lower ? 'lower' : null;
    const keys = upper ?? lower;
    bones[name] = {
      ...change,
      channel,
      clip: channel === 'upper' ? pose.upper : channel === 'lower' ? pose.lower : null,
      // null when the clip has no track for this bone yet — a new track is needed
      currentKeys: keys,
    };
  }

  const doc = {
    format: 'mando-pose-edit/1',
    exportedAt: new Date().toISOString(),
    character: { id: subject.id, name: subject.name },
    pose: { id: pose.id, name: pose.name, lower: pose.lower, upper: pose.upper },
    frozenAt: 'first keyframe (clip time 0)',
    gizmoSpace: editor.space,
    units: 'local-space Euler XYZ in degrees — the argument order of qt() in src/anim/clips.ts',
    howToApply: [
      'Each entry is one bone of the canonical rig (src/anim/skeleton.ts).',
      '`edited` is the new absolute rotation; use it directly for a clip whose bone holds one value across all keys.',
      '`delta` is edited - base; add it to every key of a bone that moves during the clip.',
      '`currentKeys` is what the clip holds for that bone today (null = no track yet, so add one).',
      'Remember the splay sign convention documented at the top of clips.ts.',
    ],
    bones,
  };

  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pose-${subject.id}-${pose.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
    // edit mode owns the bones; the mixer would write over them every frame
    if (!editing) f.inst.animator?.update(dt);
    f.inst.cosmetic?.(dt, time);
  }
  editor.update();
  controls.update();
  renderer.render(scene, camera);
}

renderPanel();
spawn();
resize();
requestAnimationFrame(frame);
