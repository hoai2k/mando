import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterInstance } from '../characters/builder';
import { loadOptionalTexture } from '../core/assets';
import { findPose, POSES, posesFor, type Pose, type PoseCapabilities } from './poses';
import { PoseEditor, type GizmoSpace } from './poseEdit';
import { eulerOf, eulerSub, PoseEdits, type EditEntry, type Euler3 } from './poseEdits';
import { findSubject, GROUPS, type Subject } from './roster';
import { modelUrl, shoulderSpacingFor, setWorkbenchShoulderSpacing, type ShoulderSpacing } from '../characters/authored';
import { tracked } from '../core/warm';
import { BONES } from '../anim/skeleton';
import './workbench.css';
import { setClipCaching } from '../anim/clips';
import { SkinPanel } from './skinPanel';
import { ATTACK_ALTERNATES, combatStudyClips, combatStyle, type Alternate } from './combatStudies';
import { counterweightVariant, hasCounterweight } from '../anim/counterweight';
import { MANDO_ROSTER, meleeKinds, type MandoId, type MeleeKind } from '../characters/mandalorians';
import { PositionEditor } from './positionEdit';
import { WeaponAnchorEditor } from './weaponAnchorEdit';

// The pose editor rewrites clip tracks in place, so each figure on the
// turntable needs its own set — the game's shared-by-species cache would let an
// edit to one character leak into every other character of that species.
setClipCaching(false);

/**
 * Model workbench — /workbench/?edit=models
 *
 * A turntable for the cast: pick a character, run any clip the game plays on
 * them, and stand the authored model next to the procedural build it replaces.
 * It shares the game's rig, clips and animator. Attack alternates and unarmed
 * motions are isolated workbench studies; None shows the exact game attack.
 */

type Mode = 'authored' | 'procedural' | 'both';

interface Figure {
  inst: CharacterInstance;
  /** the rig as built, before any clip touched it — see `applyPose` */
  rest: Array<{ bone: THREE.Object3D; quaternion: THREE.Quaternion; position: THREE.Vector3 }>;
  /**
   * The .glb this figure is *supposed* to be, for the slots that stand for the
   * authored model. Until that file lands the figure is hidden behind a
   * progress card rather than shown as its procedural stand-in — see
   * `updateLoading`. Null on the procedural slot, which is never waiting.
   */
  waitingFor: string | null;
  /** the card over this figure's place on the stage while it loads */
  card: HTMLDivElement | null;
  /** the character factory hands back extras on the Mandalorians */
  extras: {
    setThrust?: (t: number) => void;
    setWeapon?: (w: 'blaster' | 'gaffi' | 'none') => void;
    setMeleeKind?: (kind: MeleeKind) => void;
    gaffi?: THREE.Group;
    setBlock?: (t: number) => void;
    /** creatures on their own rig cross-fade idle against a run by speed */
    setGait?: (speed: number) => void;
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

const initialParams = new URLSearchParams(location.search);
let subject: Subject = findSubject(initialParams.get('character') ?? 'din');
let pose: Pose = findPose(initialParams.get('pose') ?? 'idle');
let mode: Mode = initialParams.get('mode') === 'authored' || initialParams.get('mode') === 'procedural'
  ? initialParams.get('mode') as Mode : 'both';
let spin = false;
/** mesh count the camera framing was computed for; authored skins arrive late */
let framedAt = -1;
let showSkeleton = false;
let showGrid = true;
let editing = false;
let editKind: 'rotate' | 'position' | 'weapon' = 'rotate';
let positionAwaiting = false;
let weaponAwaiting = false;
let weaponSample = 0;
let animationSpeed = 1;
let paused = false;
let animationTime = 0;
let offhandStrength = 0.5;
let alternateChoice = initialParams.get('alternate') ?? 'none';
function alternatesFor(p: Pose): Alternate[] {
  const dinSingleSaber: Record<string, Alternate[]> = {
    saber2: [{ id: 'staffRise', name: 'Rising cut', lower: 'staffRiseLower', upper: 'staffRiseUpper', reference: 'staff' }],
    saber3: [{ id: 'staffDiagonal', name: 'Diagonal finish', lower: 'staffDiagonalLower', upper: 'staffDiagonalUpper', reference: 'staff' }],
  };
  const choices = subject.id === 'din' && dinSingleSaber[p.id] ? dinSingleSaber[p.id] : ATTACK_ALTERNATES[p.id] ?? [];
  return choices.filter((alt) => figures.length > 0
    && figures.every((f) => !!f.inst.animator?.clips[alt.lower] && !!f.inst.animator?.clips[alt.upper]));
}
function activeClips(): { lower: string | null; upper: string | null } {
  const selected = alternatesFor(pose).find((alt) => alt.id === alternateChoice) ?? pose;
  let upper = selected.upper;
  if (subject.id === 'duelist' && upper === 'aimUpper') upper = 'dualPistolAimUpper';
  if (alternateChoice === 'none' && (subject.id === 'din' || subject.id === 'maris' || subject.id === 'maul')) {
    const weaponClips: Record<string, string> = subject.id === 'din' ? {
      saber1: 'darksaber1', saber2: 'darksaber2', saber3: 'darksaber3',
    } : subject.id === 'maris' ? {
      saberIdleUpper: 'tonfaIdleUpper', saberRunUpper: 'tonfaRunUpper',
      saber1: 'tonfa1', saber2: 'tonfa2', saber3: 'tonfa3',
      saberFlourish: 'tonfaFlourish',
    } : {
      saberIdleUpper: 'staffIdleUpper', saberRunUpper: 'staffRunUpper',
      saber1: 'staff1', saber2: 'staff2', saber3: 'staff3',
      saberFlourish: 'staffFlourish',
    };
    upper = upper ? (weaponClips[upper] ?? upper) : null;
  }
  if (hasCounterweight(upper)) {
    const variant = `${upper}Offhand${Math.round(offhandStrength * 100)}`;
    if (figures.every((f) => !!f.inst.animator?.clips[variant])) upper = variant;
  }
  return { lower: selected.lower, upper };
}

/**
 * Edits live here, not on the bones: the ledger holds a delta per clip and bone,
 * writes it into the live clips, and can undo it. That is what lets an edit
 * outlive edit mode — leave it and the animation plays back adjusted — and it
 * is what the single combined export describes.
 */
const edits = new PoseEdits();
const editor = new PoseEditor(scene, camera, controls, renderer.domElement, onEditorChange, commitBone);
const positionEditor = new PositionEditor(scene, camera, controls, renderer.domElement, onEditorChange);
const weaponEditor = new WeaponAnchorEditor(scene, camera, controls, renderer.domElement, onEditorChange);
/** the skinning review: fix toggles, weight paint, and the pose that exercises every chain */
const skinHost = document.createElement('div');
const skin = new SkinPanel(skinHost, () => { if (skin.holding) { spin = false; turntable.rotation.y = 0; } });

function disposeFigures(): void {
  positionEditor.restore();
  positionEditor.setPose('', '', null);
  weaponEditor.setPose('', '', null);
  for (const f of figures) turntable.remove(f.inst.root);
  for (const s of skeletons) scene.remove(s);
  for (const f of figures) f.card?.remove();
  figures = [];
  skeletons = [];
}

/**
 * A subject whose model nothing on our rig drives — a weapon, the swoop bike,
 * the unrigged massiff. Its factory ignores the `authored` flag because there
 * is no procedural version to compare against, so putting it on the turntable
 * twice would stand the same sculpt beside itself under two different labels.
 */
const isProp = (s: Subject): boolean => s.build.length === 0;

function spawn(): void {
  disposeFigures();
  const wants: Array<[boolean, string]> = isProp(subject)
    ? [[true, 'Authored model']]
    : subject.hasModel && mode === 'both'
      ? [[true, 'Authored model'], [false, 'Procedural']]
      : [[mode !== 'procedural' && subject.hasModel, mode === 'procedural' || !subject.hasModel ? 'Procedural' : 'Authored model']];

  const sides = wants.length > 1 ? ['Left', 'Right'] : [''];
  figures = wants.map(([authored, label], i) => {
    const inst = subject.build(authored) as CharacterInstance & Figure['extras'];
    if (inst.animator && inst.rig) {
      const mando = subject.id in MANDO_ROSTER ? meleeKinds(subject.id as MandoId) : [];
      const staff = mando.includes('gaffi') || ['tusken', 'pirateMelee', 'alamite', 'officer'].includes(subject.id);
      Object.assign(inst.animator.clips, combatStudyClips(inst.rig.proportions, subject.id, {
        staff, sabers: mando.includes('sabers'),
      }));
      for (const clip of Object.values(inst.animator.clips)) {
        if (!hasCounterweight(clip.name)) continue;
        for (const strength of [0, 0.25, 0.5, 0.75, 1, 1.25]) {
          const variant = counterweightVariant(clip, strength);
          if (variant) inst.animator.clips[variant.name] = variant;
        }
      }
    }
    inst.root.position.x = wants.length > 1 ? (i === 0 ? -0.75 : 0.75) : 0;
    inst.root.traverse((o) => { o.castShadow ||= (o as THREE.Mesh).isMesh; });
    turntable.add(inst.root);
    // Snapshot the rig before anything animates it: a clip only writes the
    // bones it has tracks for, so without a rest to fall back to, a bone left
    // behind by an edit (or by a change of pose) keeps its last rotation for
    // the rest of the session.
    const rest = Object.values(inst.rig?.bones ?? {}).map((bone) => ({
      bone, quaternion: bone.quaternion.clone(), position: bone.position.clone(),
    }));
    return {
      inst, extras: inst, rest,
      waitingFor: authored ? modelUrl(subject.modelFile ?? subject.id) : null,
      card: null,
      label: sides[i] ? `${sides[i]} — ${label}` : label,
    };
  });
  showLoading();

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
  }
  // What the new subject can do decides what the picker offers, so the panel is
  // rebuilt here rather than by whoever called us — at first paint there were
  // no figures yet to ask, and the picker came up holding only the rest pose.
  available();
  renderPanel();
  applyPose();
  editor.setTargets(figures
    .filter((f) => f.inst.rig)
    .map((f) => ({ label: f.label, bones: f.inst.rig!.bones as Record<string, THREE.Object3D> })));
  if (editing && editKind === 'position') refreshPositionPose();
  if (editing && editKind === 'weapon') refreshWeaponPose();
  skin.setSubject(
    subject.hasModel && !isProp(subject) && mode !== 'procedural' ? (subject.modelFile ?? subject.id) : null,
    figures.filter((f) => f.waitingFor).map((f) => ({
      root: f.inst.root, bones: (f.inst.rig?.bones as Record<string, THREE.Object3D> | undefined) ?? null, rest: f.rest,
    })),
  );
  if (editing) enterEdit();
  renderLegend();
  frameSubject();
  (window as unknown as { __wb?: unknown }).__wb = { figures, subject, pose, camera, controls };  // debug/testing handle
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
    if (subject.id === 'boba_fett') {
      // The imported FBX mesh boxes are in bind space. Frame its evaluated
      // standing dimensions rather than sending the camera toward those boxes.
      box.expandByPoint(f.inst.root.localToWorld(new THREE.Vector3(-0.65, 0, -0.65)));
      box.expandByPoint(f.inst.root.localToWorld(new THREE.Vector3(0.65, f.inst.height, 0.65)));
      continue;
    }
    // `visible` is read per mesh, not inherited, so a figure hidden behind its
    // loading card still measures here — which is what holds its place in the
    // frame, so the camera does not swing when the model finally lands in it.
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

/** What each figure on the turntable can be asked to do — see `posesFor`. */
function capabilities(): PoseCapabilities[] {
  return figures.map((f) => ({
    clips: new Set(Object.keys(f.inst.animator?.clips ?? {})),
    gait: !!f.extras.setGait,
    strike: !!f.inst.attack,
  }));
}

/** The poses this turntable can actually play, with the current pick kept valid. */
function available(): Pose[] {
  const kinds = subject.id in MANDO_ROSTER ? meleeKinds(subject.id as MandoId) : [];
  const playerAttack = new Set(['melee1', 'melee2', 'melee3']);
  const saberAttack = new Set(['saber1', 'saber2', 'saber3', 'saberIdle', 'saberRun', 'flourish']);
  const list = posesFor(capabilities()).filter((p) => {
    if (playerAttack.has(p.id)) return kinds.includes('gaffi');
    if (saberAttack.has(p.id)) return kinds.includes('sabers');
    if (p.id === 'enemySwing') return kinds.length === 0 && !!figures[0]?.inst.animator;
    return true;
  });
  if (!list.some((p) => p.id === pose.id)) pose = list.find((p) => p.id === 'idle') ?? list[0];
  return list;
}

function applyPose(): void {
  strikeAt = 0;
  animationTime = 0;
  weaponEditor.restore();
  for (const f of figures) {
    // A creature with its own gait has no channels to play, but it does take a
    // speed — so the creature poses hand it one and it picks its own gait.
    // This runs before the animator check: creatures have no animator at all.
    f.extras.setGait?.(pose.gait ?? 0);
    const anim = f.inst.animator;
    if (!anim) continue;
    anim.releaseAll();
    // Back to rest first, so bones the new pose has no track for read as
    // untouched rather than keeping the last pose's — or the last edit's —
    // rotation. Undoing an edit to a bone the clip never animated has nothing
    // else to put it back: dropping the edit drops the track with it.
    for (const r of f.rest) { r.bone.quaternion.copy(r.quaternion); r.bone.position.copy(r.position); }
    const clips = activeClips();
    if (clips.lower) anim.play('lower', clips.lower, 0, pose.rate ?? 1);
    if (clips.upper) anim.play('upper', clips.upper, 0, pose.rate ?? 1);
    // Write the first frame now. The mixer restores every bone it owns to its
    // bind pose as the old actions stop, and without this the figure stands in
    // that neutral pose until the next animation frame lands on it.
    // Sample the selected clips at their first frame immediately. A zero-dt
    // mixer update can leave the old authored skin at its last pose while
    // paused, even though the procedural bones and weapon visibility changed.
    anim.poseAt(0);
    f.extras.setThrust?.(pose.thrust ?? 0);
    if (pose.melee && f.extras.setMeleeKind) {
      f.extras.setMeleeKind(pose.id.startsWith('saber') || pose.id === 'flourish' ? 'sabers' : 'gaffi');
    }
    const armorerIdle = subject.id === 'armorer' && pose.id === 'idle';
    f.extras.setWeapon?.(pose.unarmed ? 'none' : (pose.melee || armorerIdle) ? 'gaffi' : 'blaster');
    setWeaponVisibility(f, !pose.unarmed);
    f.extras.setBlock?.(pose.block ? 1 : 0);
    f.inst.cosmetic?.(0, time);
  }
}

/** Seconds in the longest active channel; both channels scrub together. */
function animationDuration(): number {
  const anim = figures.find((f) => f.inst.animator)?.inst.animator;
  if (!anim) return 0;
  const clips = activeClips();
  return Math.max(0, ...[clips.lower, clips.upper].map((name) => name ? anim.clips[name]?.duration ?? 0 : 0));
}

function currentAnimationTime(): number {
  const anim = figures.find((f) => f.inst.animator)?.inst.animator;
  if (!anim) return 0;
  const clips = activeClips();
  const name = clips.upper ?? clips.lower;
  return name ? anim.clipProgress(clips.upper ? 'upper' : 'lower') * (anim.clips[name]?.duration ?? 0) : 0;
}

function seekAnimation(seconds: number): void {
  // Sampling the exact clip duration wraps looping channels back to frame 0.
  animationTime = Math.max(0, Math.min(Math.max(0, animationDuration() - 1e-4), seconds));
  for (const f of figures) {
    const anim = f.inst.animator;
    if (!anim) continue;
    anim.poseAt(animationTime);
    f.inst.cosmetic?.(0, time);
  }
}

/** Enemy props are mounted on weapon bones or the retargeted hand mounts. */
function setWeaponVisibility(f: Figure, visible: boolean): void {
  f.inst.root.traverse((o) => {
    if (o.name === 'weaponR' || o.name === 'weaponL' || o.name === 'weaponMount' || o.name === 'weaponMountL') {
      o.visible = visible;
    }
  });
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
    const clips = activeClips();
    for (const name of [clips.lower, clips.upper]) {
      if (!name) continue;
      const clip = anim.clips[name];
      const action = clip && anim.mixer.existingAction(clip);
      if (action) action.time = 0;
    }
    anim.update(0);
  }
}

function sampleWeaponPose(): void {
  if (pose.id === 'rest') weaponSample = 0;
  weaponEditor.setSampleFraction(weaponSample);
  for (const f of figures) {
    const anim = f.inst.animator;
    if (!anim) continue;
    const clips = activeClips();
    for (const name of [clips.lower, clips.upper]) {
      if (!name) continue;
      const clip = anim.clips[name];
      const action = clip && anim.mixer.existingAction(clip);
      if (action) action.time = Math.min(clip.duration * weaponSample, Math.max(0, clip.duration - 0.001));
    }
    anim.update(0);
    f.inst.cosmetic?.(0, time);
  }
}

function enterEdit(): void {
  editing = true;
  spin = false;
  turntable.rotation.y = 0;
  freezePose();
  editor.setEnabled(editKind === 'rotate');
  positionEditor.setEnabled(editKind === 'position');
  weaponEditor.setEnabled(editKind === 'weapon');
  if (editKind === 'position') refreshPositionPose();
  if (editKind === 'weapon') { sampleWeaponPose(); refreshWeaponPose(); }
}

function leaveEdit(): void {
  editing = false;
  editor.setEnabled(false);
  positionEditor.restore();
  positionEditor.setEnabled(false);
  weaponEditor.restore();
  weaponEditor.setEnabled(false);
  // the edits are in the clips now, so the animation runs with them
  applyPose();
}

/** Capture model bone positions after retargeting the selected frozen frame. */
function refreshPositionPose(): void {
  if (!editing || editKind !== 'position') return;
  positionEditor.restore();
  const poseKey = alternateChoice === 'none' ? pose.id : `${pose.id}:${alternateChoice}`;
  const figure = figures.find((f) => f.waitingFor && ready(f));
  if (!figure) {
    positionAwaiting = !!figures.find((f) => f.waitingFor);
    positionEditor.setPose(subject.id, poseKey, null);
    return;
  }
  positionAwaiting = false;
  figure.inst.cosmetic?.(0, time);
  positionEditor.setPose(subject.id, poseKey, figure.inst.root);
}

function refreshWeaponPose(): void {
  if (!editing || editKind !== 'weapon') return;
  const poseKey = alternateChoice === 'none' ? pose.id : `${pose.id}:${alternateChoice}`;
  const figure = figures.find((f) => f.waitingFor && ready(f));
  if (!figure) {
    weaponAwaiting = !!figures.find((f) => f.waitingFor);
    weaponEditor.setPose(subject.id, poseKey, null);
    return;
  }
  weaponAwaiting = false;
  figure.inst.cosmetic?.(0, time);
  weaponEditor.setPose(subject.id, poseKey, figure.inst.root);
}

/** bones the lower channel drives; everything else belongs to the upper clip */
const LOWER_BONES = new Set([
  'hips', 'spine', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR',
]);

/** Which of the pose's two clips owns a bone — where an edit to it is stored. */
function clipFor(bone: string): string | null {
  const clips = activeClips();
  const own = LOWER_BONES.has(bone) ? clips.lower : clips.upper;
  const other = LOWER_BONES.has(bone) ? clips.upper : clips.lower;
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

/**
 * Push the ledger into the clips and put the figures back in the frozen pose.
 *
 * `apply` rewrites sample values in place, which a playing action picks up on
 * its own; only adding or dropping a whole track needs the mixer's bindings
 * rebuilt, and that is worth avoiding — `invalidate` resets every bone to its
 * bind pose on the way through, so doing it on every drag made the figure
 * flicker through a neutral stance between edits.
 */
function refreshEdits(): void {
  for (const f of figures) {
    if (!f.inst.animator) continue;
    if (edits.apply(f.inst.animator.clips)) f.inst.animator.invalidate();
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

/** Keep view selection in the URL; clip edits remain session-only. */
function syncSelectionUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('character', subject.id);
  url.searchParams.set('pose', pose.id);
  url.searchParams.set('mode', mode);
  if (alternateChoice === 'none') url.searchParams.delete('alternate');
  else url.searchParams.set('alternate', alternateChoice);
  history.replaceState(null, '', url);
}

function renderPanel(): void {
  const shoulderAsset = subject.modelFile ?? subject.id;
  const shoulderSpacing = shoulderSpacingFor(shoulderAsset);
  const characterOptions = GROUPS
    .map((g) => `<optgroup label="${g.label}">`
      + g.subjects.map((s) => option(s.id, s.name, s.id === subject.id)).join('')
      + '</optgroup>')
    .join('');
  const list = available();
  const rest = list.find((p) => p.id === 'rest');
  const dinSaberLabels: Record<string, string> = {
    saberIdle: 'Darksaber stance — idle', saberRun: 'Darksaber stance — run',
    flourish: 'Darksaber flourish', saber1: 'Darksaber 1 — right cut',
    saber2: 'Darksaber 2 — backswing', saber3: 'Darksaber 3 — overhead',
  };
  const gameOptions = list.filter((p) => !p.previewOnly).map((p) =>
    option(p.id, `${subject.id === 'din' ? (dinSaberLabels[p.id] ?? p.name) : p.name}${alternatesFor(p).length ? ' •' : ''}`, p.id === pose.id)).join('');
  const previewOptions = list.filter((p) => p.previewOnly && p.id !== 'rest').map((p) =>
    option(p.id, `${p.name} ◆`, p.id === pose.id)).join('');
  const choices = alternatesFor(pose);
  const selectedUpper = (choices.find((alt) => alt.id === alternateChoice) ?? pose).upper;
  const counterweightAvailable = hasCounterweight(selectedUpper)
    || ((subject.id === 'maul' || subject.id === 'din') && alternateChoice === 'none' && ['saber1', 'saber2', 'saber3'].includes(selectedUpper ?? ''));
  if (alternateChoice !== 'none' && !choices.some((alt) => alt.id === alternateChoice)) alternateChoice = 'none';
  syncSelectionUrl();

  panel.innerHTML = `
    <h1>Model workbench</h1>
    <p class="sub">Game rig and clips, with workbench attack studies.</p>

    <div class="field">
      <label for="character">Character</label>
      <select id="character">${characterOptions}</select>
    </div>

    <div class="field">
      <label for="pose">Animation</label>
      <select id="pose">${rest ? option(rest.id, `${rest.name} ◆`, rest.id === pose.id) : ''}
        <optgroup label="In game">${gameOptions}</optgroup>
        ${previewOptions ? `<optgroup label="──────── Not in game · preview ────────">${previewOptions}</optgroup>` : ''}
      </select>
      <p class="picker-key">• alternates available &nbsp; ◆ not in game</p>
    </div>

    ${choices.length ? `
    <div class="field">
      <label for="attackAlternate">Alternates</label>
      <select id="attackAlternate">
        ${option('none', 'None — original attack', alternateChoice === 'none')}
        ${choices.map((alt) => option(alt.id, alt.name, alternateChoice === alt.id)).join('')}
      </select>
    </div>` : ''}
    ${pose.unarmed ? `<p class="study-note">${combatStyle(subject.id)} unarmed study · weapons hidden · not used in combat yet.</p>` : ''}
    ${subject.id === 'din' && ['melee1', 'melee2', 'melee3'].includes(pose.id)
      ? `<p class="study-note">In game, this combo hit occasionally uses ${pose.id === 'melee1' ? 'Long lunge thrust' : pose.id === 'melee2' ? 'Low rising sweep' : 'Diagonal step and strike'} instead of the original (25% chance).</p>` : ''}
    ${counterweightAvailable ? `<div class="field playback">
      <label for="offhandStrength">Free arm counterweight <output id="offhandValue">${Math.round(offhandStrength * 100)}%</output></label>
      <input id="offhandStrength" type="range" min="0" max="1.25" step="0.25" value="${offhandStrength}" aria-label="Free arm counterweight">
      <p class="hint">Adjust how far the free arm reaches during the windup.</p>
    </div>` : ''}

    <div class="field playback">
      <label for="animationSpeed">Animation speed <output id="speedValue">${animationSpeed.toFixed(2)}×</output></label>
      <div class="playback-row">
        <input id="animationSpeed" type="range" min="0.1" max="2" step="0.05" value="${animationSpeed}" aria-label="Animation speed">
        <button id="pauseAnimation" type="button" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'}</button>
      </div>
    </div>
    ${paused ? `<div class="field playback">
      <label for="animationTime">Animation time <output id="animationTimeValue">${animationTime.toFixed(2)} / ${animationDuration().toFixed(2)} s</output></label>
      <input id="animationTime" type="range" min="0" max="${Math.max(1, Math.ceil(animationDuration() * 60) - 1)}" step="1"
        value="${Math.round(animationTime * 60)}" ${editing || animationDuration() === 0 ? 'disabled' : ''} aria-label="Animation time in 60 fps frames">
      ${editing ? '<p class="hint">Leave edit mode to scrub playback; Weapon grips has its own animation-frame slider.</p>' : ''}
    </div>` : ''}

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
    ${subject.hasModel && !isProp(subject) ? `
    <div class="field playback shoulder-tuning">
      <label for="restShoulders">Rest shoulder width <output id="restShouldersValue">${Math.round(shoulderSpacing.rest * 100)}%</output></label>
      <input id="restShoulders" type="range" min="0" max="2" step="0.05" value="${shoulderSpacing.rest}"
        ${editing && editKind === 'position' ? 'disabled' : ''} aria-label="Rest shoulder width">
    </div>
    <div class="field playback shoulder-tuning">
      <label for="aPoseShoulders">A-pose shoulder width <output id="aPoseShouldersValue">${Math.round(shoulderSpacing.aPose * 100)}%</output></label>
      <input id="aPoseShoulders" type="range" min="0" max="2" step="0.05" value="${shoulderSpacing.aPose}"
        ${editing && editKind === 'position' ? 'disabled' : ''} aria-label="A-pose shoulder width">
      <p class="hint">100% rest matches the measured Din spacing. Ventress and Bossk start at 50%; A-pose starts at 0%.</p>
      <button id="resetShoulders" type="button" ${editing && editKind === 'position' ? 'disabled' : ''}>Reset shoulder widths</button>
    </div>` : ''}

    <button id="editToggle" class="toggle" aria-pressed="${editing}">
      ${editing ? 'Leave edit mode' : 'Edit mode'}
    </button>
    <div id="edit"></div>
    <div id="skin"></div>

    <p class="note">
      ${!subject.hasModel
        ? 'No authored model for this character yet — procedural build only.'
        : isProp(subject)
          ? `<code>public/models/${subject.modelFile ?? subject.id}.glb</code> — a prop, on no rig
             we drive. Nothing animates it, so the animation picker does nothing here.`
          : `Authored skin from <code>public/models/${subject.modelFile ?? subject.id}.glb</code>, driven by the
             procedural rig through the retargeter. Compare puts the two side by side.`}
      <br><br>Drag to orbit, scroll to zoom. Posts are 0.5&nbsp;m each.
      <br><br><b>Edit mode</b> freezes the pose at its first keyframe, draws the rig
      on the figure and gives the joint you click a rotation gizmo. Edits are written
      into the clips, so leaving edit mode plays the animation back with them, and they
      survive a change of pose or character. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and
      redo; Export hands you every change in one JSON, in <code>clips.ts</code> units.
      <br><br><b>Position mode</b> moves the authored model's joints with 3D handles.
      Export position JSON to share the exact shoulder offsets for each pose.
      <br><br><b>Weapon grips</b> moves, rotates and uniformly scales held weapons against
      authored hands, or stowed hilts against authored hips in rest and idle.
      Export the local transforms and scale multipliers as JSON.
      <br><br><b>Shoulder width</b> uses the averaged spacing from your JSON on
      authored models in the workbench and game. Each slider controls its own arm
      angle; leave Position mode before adjusting it so manual joint offsets do not cover the result.
    </p>`;

  panel.querySelector<HTMLSelectElement>('#character')!.onchange = (e) => {
    subject = findSubject((e.target as HTMLSelectElement).value);
    alternateChoice = 'none';
    spawn();
    renderPanel();
  };
  panel.querySelector<HTMLSelectElement>('#pose')!.onchange = (e) => {
    pose = findPose((e.target as HTMLSelectElement).value);
    alternateChoice = 'none';
    applyPose();
    if (editing) freezePose();
    if (editing && editKind === 'position') refreshPositionPose();
    if (editing && editKind === 'weapon') { sampleWeaponPose(); refreshWeaponPose(); }
    renderPanel();
  };
  const alternateSelect = panel.querySelector<HTMLSelectElement>('#attackAlternate');
  if (alternateSelect) alternateSelect.onchange = (e) => {
    alternateChoice = (e.target as HTMLSelectElement).value;
    syncSelectionUrl();
    applyPose();
    if (editing) freezePose();
    if (editing && editKind === 'position') refreshPositionPose();
    if (editing && editKind === 'weapon') { sampleWeaponPose(); refreshWeaponPose(); }
    renderEditPanel();
  };
  panel.querySelector<HTMLInputElement>('#animationSpeed')!.oninput = (e) => {
    animationSpeed = Number((e.target as HTMLInputElement).value);
    panel.querySelector<HTMLOutputElement>('#speedValue')!.value = `${animationSpeed.toFixed(2)}×`;
  };
  const offhandSlider = panel.querySelector<HTMLInputElement>('#offhandStrength');
  if (offhandSlider) offhandSlider.oninput = (e) => {
    offhandStrength = Number((e.target as HTMLInputElement).value);
    panel.querySelector<HTMLOutputElement>('#offhandValue')!.value = `${Math.round(offhandStrength * 100)}%`;
    applyPose();
    if (editing) freezePose();
  };
  panel.querySelector<HTMLButtonElement>('#pauseAnimation')!.onclick = (e) => {
    if (!paused) animationTime = currentAnimationTime();
    paused = !paused;
    renderPanel();
  };
  const timeSlider = panel.querySelector<HTMLInputElement>('#animationTime');
  if (timeSlider) timeSlider.oninput = () => {
    seekAnimation(Number(timeSlider.value) / 60);
    panel.querySelector<HTMLOutputElement>('#animationTimeValue')!.value =
      `${animationTime.toFixed(2)} / ${animationDuration().toFixed(2)} s`;
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
  const adjustShoulders = (part: keyof ShoulderSpacing, input: HTMLInputElement): void => {
    const value = Number(input.value);
    setWorkbenchShoulderSpacing(shoulderAsset, { ...shoulderSpacingFor(shoulderAsset), [part]: value });
    panel.querySelector<HTMLOutputElement>(`#${input.id}Value`)!.value = `${Math.round(value * 100)}%`;
    for (const f of figures) f.inst.cosmetic?.(0, time);
  };
  for (const [id, part] of [['restShoulders', 'rest'], ['aPoseShoulders', 'aPose']] as const) {
    const input = panel.querySelector<HTMLInputElement>(`#${id}`);
    if (input) input.oninput = () => adjustShoulders(part, input);
  }
  panel.querySelector<HTMLButtonElement>('#resetShoulders')?.addEventListener('click', () => {
    setWorkbenchShoulderSpacing(shoulderAsset, null);
    for (const f of figures) f.inst.cosmetic?.(0, time);
    renderPanel();
  });
  panel.querySelector<HTMLButtonElement>('#editToggle')!.onclick = () => {
    if (editing) leaveEdit(); else enterEdit();
    renderPanel();
  };
  // the skinning review keeps its own subtree, so a re-render here never loses it
  panel.querySelector('#skin')!.replaceWith(skinHost);
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
  if (editing && editKind === 'position') { renderPositionPanel(host); return; }
  if (editing && editKind === 'weapon') { renderWeaponPanel(host); return; }
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
    ${editing ? editModeButtons() : ''}
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

  bindEditModeButtons(host);
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

function editModeButtons(): string {
  return `<div class="field edit-modes"><label>Edit</label><div class="seg">
    <button data-edit-kind="rotate" aria-pressed="${editKind === 'rotate'}">Rotate</button>
    <button data-edit-kind="position" aria-pressed="${editKind === 'position'}">Position</button>
    <button data-edit-kind="weapon" aria-pressed="${editKind === 'weapon'}">Weapon grips</button>
  </div></div>`;
}

function bindEditModeButtons(host: HTMLElement): void {
  host.querySelectorAll<HTMLButtonElement>('[data-edit-kind]').forEach((button) => {
    button.onclick = () => {
      const next = button.dataset.editKind as 'rotate' | 'position' | 'weapon';
      if (next === editKind) return;
      if (editKind === 'position') positionEditor.restore();
      if (editKind === 'weapon') weaponEditor.restore();
      editKind = next;
      editor.setEnabled(next === 'rotate');
      positionEditor.setEnabled(next === 'position');
      weaponEditor.setEnabled(next === 'weapon');
      for (const id of ['restShoulders', 'aPoseShoulders', 'resetShoulders']) {
        const control = panel.querySelector<HTMLInputElement | HTMLButtonElement>(`#${id}`);
        if (control) control.disabled = next === 'position';
      }
      if (next === 'position') refreshPositionPose();
      else if (next === 'weapon') { sampleWeaponPose(); refreshWeaponPose(); }
      else for (const f of figures) f.inst.cosmetic?.(0, time);
      renderEditPanel();
    };
  });
}

function renderWeaponPanel(host: HTMLDivElement): void {
  const names = weaponEditor.names();
  const selected = weaponEditor.selected;
  const current = weaponEditor.current();
  const degrees = weaponEditor.currentDegrees();
  const scale = weaponEditor.currentScale();
  const entries = weaponEditor.entriesAll();
  const scales = weaponEditor.scalesAll();
  host.innerHTML = `${editModeButtons()}
    <div class="editbox">
      <div class="field"><label for="weaponSample">Animation frame: ${Math.round(weaponSample * 100)}%</label>
        <input id="weaponSample" type="range" min="0" max="100" step="1" value="${Math.round(weaponSample * 100)}" ${pose.id === 'rest' ? 'disabled' : ''}>
      </div>
      <div class="field"><label for="weaponTarget">Weapon on authored hand or hip</label>
        <select id="weaponTarget"><option value="">— select weapon —</option>
          ${names.map((name) => option(name, name, name === selected)).join('')}
        </select></div>
      <div class="field"><label>3D handle</label><div class="seg">
        <button data-weapon-mode="translate" aria-pressed="${weaponEditor.mode === 'translate'}">Move weapon</button>
        <button data-weapon-mode="rotate" aria-pressed="${weaponEditor.mode === 'rotate'}">Rotate weapon</button>
      </div></div>
      ${current && degrees ? `<div class="field"><label>Position in ${current.parent} coordinates</label>
        <div class="xyz">${current.editedPosition.map((v, i) => `<input data-weapon-position="${i}" type="number" step="0.001" value="${v}">`).join('')}</div>
      </div><div class="field"><label>Rotation in degrees, XYZ</label>
        <div class="xyz">${degrees.map((v, i) => `<input data-weapon-rotation="${i}" type="number" step="1" value="${v.toFixed(2)}">`).join('')}</div>
      </div><div class="field"><label for="weaponScale">Uniform weapon scale ×</label>
        <div class="weapon-scale-row">
          <input id="weaponScale" type="range" min="0.1" max="4" step="0.01" value="${scale ?? 1}" aria-label="Weapon scale slider">
          <input id="weaponScaleNumber" type="number" min="0.1" max="4" step="0.01" value="${(scale ?? 1).toFixed(2)}" aria-label="Weapon scale multiplier">
        </div>
      </div><div class="row"><button id="weaponReset">Reset selected weapon</button></div>`
    : `<p class="hint">${weaponAwaiting ? 'Waiting for the authored model.' : names.length ? 'Select an orange weapon point on the model.' : 'No held weapon or stowed hilt is visible in this pose.'}</p>`}
      <div class="row"><button id="weaponExport" class="primary" ${entries.length || scales.length ? '' : 'disabled'}>Export weapon grips JSON</button></div>
      <p class="hint">Move or rotate with the 3D handle. Scale uses the hand or hip anchor as its centre and applies to this weapon in every pose. Hip placement carries between rest and idle. Export JSON when aligned; changes reset on reload.</p>
      ${entries.length || scales.length ? `<div class="ledger">${entries.map((e) => `<div class="edit"><span>${e.character} · ${e.pose}</span><code>${e.weapon} grip</code></div>`).join('')}${scales.map((e) => `<div class="edit"><span>${e.character} · all poses</span><code>${e.weapon} · ${e.scaleMultiplier.toFixed(2)}×</code></div>`).join('')}</div>` : ''}
    </div>`;
  bindEditModeButtons(host);
  host.querySelector<HTMLInputElement>('#weaponSample')!.oninput = (event) => {
    weaponSample = Number((event.target as HTMLInputElement).value) / 100;
    sampleWeaponPose();
    host.querySelector<HTMLLabelElement>('label[for="weaponSample"]')!.textContent = `Animation frame: ${Math.round(weaponSample * 100)}%`;
  };
  host.querySelector<HTMLSelectElement>('#weaponTarget')!.onchange = (event) =>
    weaponEditor.select((event.target as HTMLSelectElement).value || null);
  host.querySelectorAll<HTMLButtonElement>('[data-weapon-mode]').forEach((button) => {
    button.onclick = () => weaponEditor.setMode(button.dataset.weaponMode as 'translate' | 'rotate');
  });
  for (const attribute of ['data-weapon-position', 'data-weapon-rotation'] as const) {
    const inputs = [...host.querySelectorAll<HTMLInputElement>(`[${attribute}]`)];
    for (const input of inputs) {
      input.onchange = () => {
        if (inputs.some((field) => !field.value.trim())) return;
        const values = inputs.map((field) => Number(field.value)) as [number, number, number];
        if (attribute === 'data-weapon-position') weaponEditor.setPosition(values);
        else weaponEditor.setRotation(values);
      };
    }
  }
  for (const id of ['weaponScale', 'weaponScaleNumber'] as const) {
    const input = host.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) continue;
    input.oninput = () => {
      if (!input.value.trim()) return;
      weaponEditor.setScale(Number(input.value));
    };
    input.onchange = () => renderWeaponPanel(host);
  }
  host.querySelector<HTMLButtonElement>('#weaponReset')?.addEventListener('click', () => weaponEditor.resetSelected());
  host.querySelector<HTMLButtonElement>('#weaponExport')!.onclick = () => {
    const payload = {
      format: 'mando-authored-weapon-grips/3', exportedAt: new Date().toISOString(),
      units: 'grip position and quaternion are local to the named authored hand or hip mount; weaponScales are uniform multipliers about that attachment origin, shared across poses',
      note: 'attachment distinguishes held weapons from stowed hip hilts. Placement uses the authored model, not the procedural body. Armorer idle uses the choice-screen axe presentation as its base grip.',
      entries: weaponEditor.entriesAll(),
      weaponScales: weaponEditor.scalesAll(),
    };
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    anchor.download = 'authored-weapon-grips.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  };
}

function renderPositionPanel(host: HTMLDivElement): void {
  const names = positionEditor.names();
  const selected = positionEditor.selected;
  const current = positionEditor.current();
  const entries = positionEditor.entriesAll();
  editSignature = signature();
  host.innerHTML = `${editModeButtons()}
    <div class="editbox">
      <div class="field"><label for="positionBone">Model joint</label>
        <select id="positionBone"><option value="">— click a joint in the viewport —</option>
          ${names.map((name) => option(name, name, name === selected)).join('')}
        </select></div>
      ${current ? `<div class="field"><label>Local position — model units, XYZ</label>
        <div class="xyz">
          ${current.editedLocal.map((value, i) => `<input type="number" data-position-axis="${i}" step="0.001" value="${value}">`).join('')}
        </div></div>
        <p class="hint position-offset">World offset: ${current.deltaWorldMetres.map((v) => v.toFixed(3)).join(', ')} m</p>
        <div class="row"><button id="positionReset">Reset selected joint</button></div>`
        : `<p class="hint">${names.length ? 'Click a blue joint, then drag the red, green or blue axis handle.' : 'Waiting for an authored model with editable joints.'}</p>`}
      <div class="row"><button id="positionExport" class="primary"${entries.length ? '' : ' disabled'}>Export positions JSON</button></div>
      <p class="hint">Moving a shoulder also moves its upper arm by the same amount. Export includes each pose, joint, starting position and offset.</p>
      ${entries.length ? `<div class="ledger">${entries.map((entry) => `<div class="edit"><span>${entry.pose}</span><code>${entry.bone}: ${entry.deltaWorldMetres.map((n) => n.toFixed(3)).join(', ')} m</code></div>`).join('')}</div>` : ''}
    </div>`;
  bindEditModeButtons(host);
  host.querySelector<HTMLSelectElement>('#positionBone')!.onchange = (event) =>
    positionEditor.select((event.target as HTMLSelectElement).value || null);
  const inputs = [...host.querySelectorAll<HTMLInputElement>('[data-position-axis]')];
  for (const input of inputs) {
    input.oninput = () => {
      if (inputs.some((field) => !field.value.trim())) return;
      positionEditor.setLocal(inputs.map((field) => Number(field.value)) as [number, number, number]);
    };
    input.onblur = () => renderPositionPanel(host);
  }
  host.querySelector<HTMLButtonElement>('#positionReset')?.addEventListener('click', () => positionEditor.resetSelected());
  host.querySelector<HTMLButtonElement>('#positionExport')!.onclick = exportPositions;
}

function exportPositions(): void {
  const entries = positionEditor.entriesAll();
  if (!entries.length) return;
  const payload = {
    format: 'mando-model-joint-positions/1', exportedAt: new Date().toISOString(),
    units: { local: 'GLB bone parent space (model units)', worldDelta: 'metres in workbench world axes' },
    note: 'Each entry is the measured translation from the delivered, retargeted model pose. Rotations and skin weights are unchanged.',
    entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = 'model-joint-positions.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
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
  if (editing && editKind === 'weapon') {
    const host = panel.querySelector<HTMLDivElement>('#edit');
    if (host) {
      const active = document.activeElement as HTMLInputElement | null;
      if (active?.id === 'weaponScale' || active?.id === 'weaponScaleNumber') {
        const value = weaponEditor.currentScale();
        if (value !== null) {
          const other = host.querySelector<HTMLInputElement>(
            active.id === 'weaponScale' ? '#weaponScaleNumber' : '#weaponScale');
          if (other) other.value = active.id === 'weaponScale' ? value.toFixed(2) : String(value);
        }
        const exportButton = host.querySelector<HTMLButtonElement>('#weaponExport');
        if (exportButton) exportButton.disabled = weaponEditor.entriesAll().length + weaponEditor.scalesAll().length === 0;
      } else renderWeaponPanel(host);
    }
    return;
  }
  if (editing && editKind === 'position') {
    const host = panel.querySelector<HTMLDivElement>('#edit');
    if (host) {
      if (document.activeElement?.hasAttribute('data-position-axis')) {
        const current = positionEditor.current();
        const offset = host.querySelector<HTMLElement>('.position-offset');
        if (offset && current) offset.textContent = `World offset: ${current.deltaWorldMetres.map((v) => v.toFixed(3)).join(', ')} m`;
        const exportButton = host.querySelector<HTMLButtonElement>('#positionExport');
        if (exportButton) exportButton.disabled = positionEditor.entriesAll().length === 0;
      } else renderPositionPanel(host);
    }
    return;
  }
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
    [
      ...POSES.filter((p) => p.lower === clip || p.upper === clip).map((p) => p.name),
      ...Object.values(ATTACK_ALTERNATES).flat()
        .filter((a) => a.lower === clip || a.upper === clip).map((a) => a.name),
    ];

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

// ---------- loading ----------
/**
 * The authored slot shows the model or it shows nothing.
 *
 * A character is built on its procedural body and the .glb hides it when it
 * lands, so for the second or so before that a compare view is two identical
 * procedural figures — which reads as the answer ("they look the same") rather
 * than as a file still in the air. So the authored figure starts hidden behind
 * a progress card and appears when its own model does. The card reads the
 * asset tracker every model load in the game reports to, so the bar is the
 * real byte count, not a guess at how long a load takes.
 */
function showLoading(): void {
  for (const f of figures) {
    if (!f.waitingFor || ready(f)) continue;
    f.inst.root.visible = false;
    const card = document.createElement('div');
    card.className = 'loading';
    card.innerHTML = `<span class="what"></span><span class="bar"><i></i></span><span class="pct"></span>`;
    stage.appendChild(card);
    f.card = card;
  }
}

/**
 * Is this figure the thing it claims to be yet?
 *
 * `modelReady` is the character's own answer, and it is the one to ask: the
 * tracker calls a file done the moment its bytes land, which is a beat before
 * the retargeter has rebuilt the skeleton and hidden the body underneath — so
 * revealing on the tracker would flash the procedural stand-in, which is the
 * whole thing this card exists to prevent. It also covers "no file exists",
 * so a character without a sculpt is never left waiting on one.
 */
const ready = (f: Figure): boolean => f.inst.modelReady?.() ?? true;

const _at = new THREE.Vector3();

/**
 * Move each card over the gap its figure will fill, and step its bar. A model
 * that fails outright is the one case where the stand-in is the answer: the
 * card says so, the procedural body appears under it, and the legend renames
 * the slot so nobody reads it as the sculpt.
 */
function updateLoading(): void {
  for (const f of figures) {
    if (!f.card || !f.waitingFor) continue;
    const key = f.waitingFor;
    const { ratio } = tracked.progress([key]);
    if (ready(f)) {
      const failed = tracked.failed(key) || !tracked.seen(key);
      f.inst.root.visible = true;
      f.card.remove();
      f.card = null;
      if (failed) {
        f.label = `${f.label.replace(/Authored model$/, 'No model — procedural stand-in')}`;
        renderLegend();
      }
      frameSubject();
      continue;
    }
    // hang it where the figure's chest will be, so it reads as that figure's
    _at.set(f.inst.root.position.x, f.inst.height * 0.6, 0).applyMatrix4(turntable.matrixWorld).project(camera);
    f.card.style.left = `${((_at.x + 1) / 2) * stage.clientWidth}px`;
    f.card.style.top = `${((1 - _at.y) / 2) * stage.clientHeight}px`;
    f.card.querySelector('.what')!.textContent = `Loading ${key.split('/').pop()}`;
    (f.card.querySelector('.bar i') as HTMLElement).style.width = `${(ratio * 100).toFixed(0)}%`;
    f.card.querySelector('.pct')!.textContent = `${Math.round(ratio * 100)}%`;
  }
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
/** when the looping creature-attack pose may strike again */
let strikeAt = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const animationDt = paused ? 0 : dt * animationSpeed;
  time += animationDt;
  if (spin) turntable.rotation.y += dt * 0.4;
  // an authored .glb lands a beat after the figure does — re-frame when it shows up
  if (figures.length && visibleMeshCount() !== framedAt) frameSubject();
  // a creature's attack is a one-shot method, not a clip we can loop: replay it
  // with a beat between strikes so it can be watched rather than glimpsed
  if (pose.strike && !editing && !paused && time >= strikeAt) {
    let next = 1;
    for (const f of figures) next = Math.max(next, f.inst.attack?.() ?? 0);
    strikeAt = time + next + 0.4;
  }
  for (const f of figures) {
    // edit mode (and the skin-test pose) own the bones; the mixer would write over them every frame
    if (!editing && !skin.holding && !paused) f.inst.animator?.update(animationDt);
    if (pose.unarmed) setWeaponVisibility(f, false);
  }
  skin.frame();
  if (positionAwaiting && editing && editKind === 'position'
    && figures.some((f) => f.waitingFor && ready(f))) refreshPositionPose();
  if (weaponAwaiting && editing && editKind === 'weapon'
    && figures.some((f) => f.waitingFor && ready(f))) refreshWeaponPose();
  if (!paused && !(editing && editKind === 'position'))
    for (const f of figures) f.inst.cosmetic?.(animationDt, time);
  editor.update();
  positionEditor.update(camera);
  weaponEditor.update(camera);
  updateLoading();
  controls.update();
  renderer.render(scene, camera);
}

// `spawn` renders the panel itself, once there are figures to ask what they can
// play. Rendering it before that asked an empty turntable, which can only offer
// the rest pose — and `available` then quietly moved the pick to it, so the
// workbench opened standing in no clip at all whatever it was asked for.
spawn();
resize();
requestAnimationFrame(frame);
