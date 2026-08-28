import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterInstance } from '../characters/builder';
import { loadOptionalTexture } from '../core/assets';
import { findPose, POSES, type Pose } from './poses';
import { PoseEditor, type GizmoSpace } from './poseEdit';
import { eulerOf, eulerSub, PoseEdits, type EditEntry, type Euler3 } from './poseEdits';
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
let editing = false;

/**
 * Edits live here, not on the bones: the ledger holds a delta per clip and bone,
 * writes it into the live clips, and can undo it. That is what lets an edit
 * outlive edit mode — leave it and the animation plays back adjusted — and it
 * is what the single combined export describes.
 */
const edits = new PoseEdits();
const editor = new PoseEditor(scene, camera, controls, renderer.domElement, onEditorChange, commitBone);

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
  // a fresh character arrives with pristine clips: record them, then put the
  // session's edits back so what is on the turntable never loses them
  for (const f of figures) {
    if (!f.inst.animator) continue;
    edits.capture(f.inst.animator.clips);
    edits.apply(f.inst.animator.clips);
    f.inst.animator.invalidate();
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
    f.extras.setBlock?.(pose.block ? 1 : 0);
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
  editor.setEnabled(false);
  // the edits are in the clips now, so the animation runs with them
  applyPose();
}

/** bones the lower channel drives; everything else belongs to the upper clip */
const LOWER_BONES = new Set([
  'hips', 'spine', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR',
]);

/** Which of the pose's two clips owns a bone — where an edit to it is stored. */
function clipFor(bone: string): string | null {
  const own = LOWER_BONES.has(bone) ? pose.lower : pose.upper;
  const other = LOWER_BONES.has(bone) ? pose.upper : pose.lower;
  const has = (clip: string | null): boolean => {
    if (!clip) return false;
    const set = figures.find((f) => f.inst.animator)?.inst.animator?.clips;
    return !!set?.[clip]?.tracks.some((t) => t.name === `${bone}.quaternion`);
  };
  // an existing track wins over the channel the bone nominally belongs to
  return has(own) ? own : has(other) ? other : own ?? other;
}

/**
 * Record the rotation the editor just made: the difference between the bone now
 * and the clip's original first key, stored against that clip.
 */
function commitBone(bone: string): void {
  const clip = clipFor(bone);
  const rig = figures.find((f) => f.inst.rig)?.inst.rig;
  const joint = rig?.bones[bone as keyof typeof rig.bones];
  if (!clip || !joint) { renderEditPanel(); return; }
  edits.set(clip, bone, eulerSub(eulerOf(joint.quaternion), edits.baseOf(clip, bone)) as Euler3);
  refreshEdits();
}

/** Push the ledger into the clips and put the figures back in the frozen pose. */
function refreshEdits(): void {
  for (const f of figures) {
    if (!f.inst.animator) continue;
    edits.apply(f.inst.animator.clips);
    f.inst.animator.invalidate();
  }
  applyPose();
  if (editing) freezePose();
  renderEditPanel();
}

function undoEdit(): void { if (edits.undo()) refreshEdits(); }
function redoEdit(): void { if (edits.redo()) refreshEdits(); }

addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoEdit(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redoEdit(); }
});

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
      on the figure and gives the joint you click a rotation gizmo. Edits are written
      into the clips, so leaving edit mode plays the animation back with them, and they
      survive a change of pose or character. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and
      redo; Export hands you every change in one JSON, in <code>clips.ts</code> units.
    </p>`;

  panel.querySelector<HTMLSelectElement>('#character')!.onchange = (e) => {
    subject = findSubject((e.target as HTMLSelectElement).value);
    spawn();
    renderPanel();
  };
  panel.querySelector<HTMLSelectElement>('#pose')!.onchange = (e) => {
    pose = findPose((e.target as HTMLSelectElement).value);
    applyPose();
    if (editing) freezePose();
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
  if (!editing && !edits.size) {
    host.innerHTML = '';
    editSignature = '';
    return;
  }

  const sel = editing ? editor.selected : null;
  const list = edits.entries();
  const selClip = sel ? clipFor(sel) : null;
  const selEdited = !!(sel && selClip && edits.deltaOf(selClip, sel));
  editSignature = signature();
  const deg = editing ? editor.selectedEuler() : null;

  const editBox = !editing ? '' : `
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
          <label>Local rotation — degrees, XYZ${selClip ? ` · <span class="clip">${selClip}</span>` : ''}</label>
          <div class="xyz">
            <input type="number" id="rx" step="1" value="${deg[0].toFixed(1)}">
            <input type="number" id="ry" step="1" value="${deg[1].toFixed(1)}">
            <input type="number" id="rz" step="1" value="${deg[2].toFixed(1)}">
          </div>
        </div>
        <div class="row">
          <button id="resetBone"${selEdited ? '' : ' disabled'}>Reset ${sel}</button>
        </div>
        <p class="hint" id="drag">${dragHint()}</p>
        <p class="hint keys">
          <b style="color:#ff6b6b">X</b> · <b style="color:#86e07a">Y</b> ·
          <b style="color:#6aa8ff">Z</b> of the chosen space${editor.space === 'camera'
            ? ' — screen right, screen up, and roll in the screen plane.'
            : ', plus the outer <b style="color:#ffd479">gold</b> ring: roll about the view direction.'}
        </p>
      ` : '<p class="hint">Pick a joint — its rotation rings appear on the figure.</p>'}`;

  host.innerHTML = `
    <div class="editbox">
      ${editBox}
      <div class="row">
        <button id="undo"${edits.canUndo ? '' : ' disabled'} title="Ctrl/Cmd+Z">↶ Undo</button>
        <button id="redo"${edits.canRedo ? '' : ' disabled'} title="Ctrl/Cmd+Shift+Z">↷ Redo</button>
      </div>
      <div class="row">
        <button id="resetAll"${list.length ? '' : ' disabled'}>Reset all</button>
        <button id="export" class="primary"${list.length ? '' : ' disabled'}>Export changes</button>
      </div>
      ${list.length ? `<div class="ledger">${renderLedger(list)}</div>` : ''}
      <p class="note edited">${list.length
        ? `<b>${list.length} edit${list.length > 1 ? 's' : ''}</b> across ${new Set(list.map((e) => e.clip)).size}
           clip${new Set(list.map((e) => e.clip)).size > 1 ? 's' : ''}, written into the clips —
           leave edit mode and the animation plays them back. Export sends them all in one file.`
        : 'No edits yet. Rotations apply to every figure on the turntable at once.'}</p>
    </div>`;

  host.querySelector('#space')?.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => { editor.setSpace(btn.dataset.space as GizmoSpace); renderEditPanel(); };
  });
  const bonePicker = host.querySelector<HTMLSelectElement>('#bone');
  if (bonePicker) bonePicker.onchange = (e) => editor.select((e.target as HTMLSelectElement).value || null);
  const fields = ['#rx', '#ry', '#rz'].map((id) => host.querySelector<HTMLInputElement>(id));
  if (fields[0]) {
    for (const f of fields) {
      f!.oninput = () => {
        editor.setSelectedEuler(fields.map((x) => Number(x!.value) || 0) as [number, number, number]);
      };
    }
  }
  host.querySelector<HTMLButtonElement>('#resetBone')?.addEventListener('click', () => {
    if (sel && selClip) { edits.clear(selClip, sel); refreshEdits(); }
  });
  host.querySelector<HTMLButtonElement>('#undo')!.onclick = undoEdit;
  host.querySelector<HTMLButtonElement>('#redo')!.onclick = redoEdit;
  host.querySelector<HTMLButtonElement>('#resetAll')!.onclick = () => { edits.clearAll(); refreshEdits(); };
  host.querySelector<HTMLButtonElement>('#export')!.onclick = exportChanges;
  for (const row of host.querySelectorAll<HTMLButtonElement>('.ledger button')) {
    row.onclick = () => {
      edits.clear(row.dataset.clip!, row.dataset.bone!);
      refreshEdits();
    };
  }
}

/** The running list of edits, grouped by the clip they will be pasted into. */
function renderLedger(list: EditEntry[]): string {
  const byClip = new Map<string, EditEntry[]>();
  for (const e of list) byClip.set(e.clip, [...(byClip.get(e.clip) ?? []), e]);
  return [...byClip].map(([clip, entries]) => `
    <div class="clip">${clip}</div>
    ${entries.map((e) => `
      <div class="edit">
        <span>${e.bone}</span>
        <code>${e.delta.map((d) => (d > 0 ? '+' : '') + d).join(' ')}</code>
        <button data-clip="${e.clip}" data-bone="${e.bone}" title="drop this edit">×</button>
      </div>`).join('')}`).join('');
}

const dragHint = (): string => (editor.dragAxis
  ? `${editor.dragAxis.toUpperCase()} ring · ${editor.dragAngle.toFixed(1)}°`
  : 'Drag a ring to rotate; hold Shift to snap to 5°.');

const signature = (): string =>
  `${editing}|${editor.selected}|${editor.space}|${edits.canUndo}|${edits.canRedo}|`
  + edits.entries().map((e) => `${e.clip}.${e.bone}:${e.delta}`).join(',');

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
  if (drag) drag.textContent = dragHint();
}

function onEditorChange(): void {
  if (signature() !== editSignature) renderEditPanel();
  else syncEditValues();
}

// ---------- export ----------
/**
 * One file for the whole session: every clip and bone touched, as absolute
 * local eulers in degrees, XYZ order — the units and argument order of `qt()`
 * in `src/anim/clips.ts` — with the delta and both the original and the
 * resulting keyframes, so a bone that moves through several keys can be
 * corrected without flattening it to one frame.
 */
function exportChanges(): void {
  const list = edits.entries();
  const posesOf = (clip: string): string[] =>
    POSES.filter((p) => p.lower === clip || p.upper === clip).map((p) => p.name);

  const clips: Record<string, unknown> = {};
  for (const entry of list) {
    const bones = (clips[entry.clip] ??= { playedBy: posesOf(entry.clip), bones: {} }) as
      { playedBy: string[]; bones: Record<string, unknown> };
    bones.bones[entry.bone] = {
      base: entry.base,
      edited: entry.edited,
      delta: entry.delta,
      currentKeys: entry.keys,
      newKeys: entry.newKeys,
    };
  }

  const doc = {
    format: 'mando-pose-edit/2',
    exportedAt: new Date().toISOString(),
    editedOn: { character: subject.id, lastPose: pose.id },
    units: 'local-space Euler XYZ in degrees — the argument order of qt() in src/anim/clips.ts',
    howToApply: [
      'Each entry is one bone of the canonical rig (src/anim/skeleton.ts) in one clip.',
      '`newKeys` is the finished track: paste those values into that clip’s qt() call.',
      '`delta` is what was added to every key; `currentKeys` is what the clip holds today.',
      '`currentKeys: null` means the clip had no track for that bone — add one (constant over the clip).',
      'Bones were edited against the clip’s first keyframe; the delta carries to the rest.',
      'Remember the splay sign convention documented at the top of clips.ts.',
    ],
    clips,
  };

  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pose-edits.json';
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
