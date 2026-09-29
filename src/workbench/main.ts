import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CharacterInstance } from '../characters/builder';
import { loadOptionalTexture, showFullResolution } from '../core/assets';
import { findPose, POSES, posesFor, type Pose, type PoseCapabilities } from './poses';
import { PoseEditor, type GizmoSpace } from './poseEdit';
import { eulerOf, eulerSub, PoseEdits, type EditEntry, type Euler3 } from './poseEdits';
import { findSubject, GROUPS, type Subject } from './roster';
import { modelUrl, shoulderSpacingFor, setWorkbenchShoulderSpacing, type ShoulderSpacing } from '../characters/authored';
import { tracked } from '../core/warm';
import { BONES } from '../anim/skeleton';
import './workbench.css';
import { setClipCaching } from '../anim/clips';
import { ATTACK_ALTERNATES, combatStudyClips, combatStyle, type Alternate } from './combatStudies';
import { styleStudyAlternates, styleStudyClips } from './styleStudies';
import { styleMoves } from '../characters/styleClips';
import { counterweightVariant, hasCounterweight } from '../anim/counterweight';
import { LAND_DEPTH, landingClips } from '../anim/clips';
import { MANDO_ROSTER, meleeKinds, saberClipsFor, type MandoId, type MeleeKind } from '../characters/mandalorians';
import { FIST_ENEMIES } from '../characters/combatStyle';
import { clench } from '../characters/fistRig';
import { fistsInPlay, fistTargets } from '../characters/fists';
import type { VehicleRig } from './vehicleFigure';
import { PositionEditor } from './positionEdit';
import { WeaponAnchorEditor } from './weaponAnchorEdit';
import { VehicleAnchorEditor } from './vehicleAnchorEdit';
import { expose } from '../debug';
import { FigureWeapons, findWeaponOption, loadoutFor, poseWeapon, WEAPON_OPTIONS, WeaponChoices, type Loadout, type WeaponSlot } from './weaponChoice';

// The pose editor rewrites clip tracks in place, so each figure on the
// turntable needs its own set — the game's shared-by-species cache would let an
// edit to one character leak into every other character of that species.
setClipCaching(false);

/**
 * Model workbench — /workbench/?edit=models
 *
 * A turntable for the cast: pick a character, run any clip the game plays on
 * them, and stand the authored model next to the procedural build it replaces.
 * It shares the game's rig, clips and animator. Attack and run alternates are
 * workbench studies until approved (the unarmed moves are in play for the
 * fighters who fight bare-handed); None shows the exact game attack.
 */

type Mode = 'authored' | 'procedural' | 'both';

export interface Figure {
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
  /** the weapon-choice swap on this figure; null when it holds nothing on offer */
  weapons: FigureWeapons | null;
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

const initialParams = new URLSearchParams(location.search);
// before anything is built: which files a character is read from
if (initialParams.get('res') === 'full') showFullResolution();
let subject: Subject = findSubject(initialParams.get('character') ?? 'din');
let pose: Pose = findPose(initialParams.get('pose') ?? 'idle');
let mode: Mode = initialParams.get('mode') === 'authored' || initialParams.get('mode') === 'procedural'
  ? initialParams.get('mode') as Mode : 'both';
/** mesh count the camera framing was computed for; authored skins arrive late */
let framedAt = -1;
/** whether the folded panel sections are open — both start closed */
const folds = { shoulders: false, details: false };
let showGrid = true;
/** close every figure's hands into fists (`fistRig.ts`), to see how a pose reads with them */
let fists = initialParams.get('fists') === '1';
const FISTS_FREE_TITLE = 'Curls the model\'s fingers into a fist on any pose, to see how it reads with them.';
const FISTS_SET_TITLE = 'The game closes this character\'s hands on this pose (gun hand, ride grips, a bare-handed fight, walking and running), so this shows them as it does.';
let editing = false;
let editKind: 'rotate' | 'position' | 'weapon' = 'rotate';
/**
 * What a rotation edit changes: the whole clip, as one offset measured at its
 * first key, or one moment of it — a key at the scrubbed time, which the clip
 * eases into from the key before and out of to the key after.
 */
let editAt: 'clip' | 'moment' = 'clip';
/** moments are scrubbed to while editing, so the slider stays live for them */
const scrubbingEdits = (): boolean => editing && editKind === 'rotate' && editAt === 'moment';

/**
 * The times the pose's clips hold a key, where a moment is edited: the slider
 * runs freely while it is dragged and settles on the nearest of these when it
 * is let go, so an edit always changes a key the clip already has.
 */
function keyTimes(): number[] {
  const anim = figures.find((f) => f.inst.animator)?.inst.animator;
  const clips = activeClips();
  const times = new Set<number>();
  for (const name of [clips.lower, clips.upper]) {
    const clip = name ? anim?.clips[name] : undefined;
    for (const track of clip?.tracks ?? []) for (const t of track.times) times.add(Math.round(t * 1000) / 1000);
  }
  const sorted = [...times].sort((a, b) => a - b);
  // the last key is the loop's wrap back to the first: nothing to edit there
  const end = animationDuration();
  return sorted.length > 1 && Math.abs(sorted[sorted.length - 1] - end) < 1e-3 ? sorted.slice(0, -1) : sorted;
}
/** the key nearest the current time, by index */
function keyIndex(keys: number[]): number {
  let best = 0;
  keys.forEach((t, i) => { if (Math.abs(t - animationTime) < Math.abs(keys[best] - animationTime)) best = i; });
  return best;
}
const timeLabel = (): string => {
  const plain = `${animationTime.toFixed(2)} / ${animationDuration().toFixed(2)} s`;
  if (!scrubbingEdits()) return plain;
  const keys = keyTimes();
  const i = keyIndex(keys);
  return Math.abs(keys[i] - animationTime) < 1e-3 ? `key ${i + 1} of ${keys.length} · ${plain}` : plain;
};
let positionAwaiting = false;
let weaponAwaiting = false;
let weaponSample = 0;
let animationSpeed = 1;
let paused = false;
let animationTime = 0;
let offhandStrength = 0.5;
/**
 * How deep each landing folds, metres of hip drop — the slider on the two
 * landing poses rebuilds the clip at this depth (feet stay planted at any of
 * them), so a depth can be tried here before it is baked into LAND_DEPTH.
 */
const landDepth = { ...LAND_DEPTH };
let alternateChoice = initialParams.get('alternate') ?? 'none';
/** weapon picks per character and slot — see `weaponChoice.ts` */
const weaponChoices = new WeaponChoices();
/** which slot an either-pose shows, per character, once the user has said */
const weaponHand = new Map<string, WeaponSlot>();
function alternatesFor(p: Pose): Alternate[] {
  const dinSingleSaber: Record<string, Alternate[]> = {
    saber2: [{ id: 'staffRise', name: 'Rising cut', lower: 'staffRiseLower', upper: 'staffRiseUpper', reference: 'staff' }],
    saber3: [{ id: 'staffDiagonal', name: 'Diagonal finish', lower: 'staffDiagonalLower', upper: 'staffDiagonalUpper', reference: 'staff' }],
  };
  // A fighter with approved moves of their own no longer carries the generic
  // saber studies; their approved moves are offered in their place.
  const own = styleMoves(cid());
  const generic = cid() === 'din' && dinSingleSaber[p.id] ? dinSingleSaber[p.id]
    : own.length && cid() !== 'ventress' && p.id.startsWith('saber') ? [] : ATTACK_ALTERNATES[p.id] ?? [];
  const approved: Alternate[] = own
    .filter((m) => (m.slot === 'flourish' ? 'flourish' : m.slot === 'idle' ? 'saberIdle' : `saber${m.slot}`) === p.id)
    .map((m) => ({ id: m.id, name: m.name, lower: m.lower, upper: m.upper, reference: 'saber' }));
  const choices = [...generic, ...approved, ...styleStudyAlternates(cid(), p.id)];
  return choices.filter((alt) => figures.length > 0
    && figures.every((f) => !!f.inst.animator?.clips[alt.lower] && !!f.inst.animator?.clips[alt.upper]));
}
function activeClips(): { lower: string | null; upper: string | null } {
  const selected = alternatesFor(pose).find((alt) => alt.id === alternateChoice) ?? pose;
  let upper = selected.upper;
  if (cid() === 'duelist' && upper === 'aimUpper') upper = 'dualPistolAimUpper';
  // the saber poses are the generic saber's; a fighter whose blade has clips
  // of its own (the Darksaber, the tonfas, the double saber) plays those
  const { attack, stance } = saberClipsFor(cid());
  if (alternateChoice === 'none' && (attack !== 'saber' || stance !== 'saber')) {
    const weaponClips: Record<string, string> = {
      saber1: `${attack}1`, saber2: `${attack}2`, saber3: `${attack}3`,
      saberIdleUpper: `${stance}IdleUpper`, saberRunUpper: `${stance}RunUpper`,
      saberFlourish: `${stance}Flourish`,
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
/** seat and hand anchors on the rides, and the Nikto's seat on his swoop — see vehicleAnchorEdit.ts */
const vehicleEditor = new VehicleAnchorEditor(scene, camera, controls, renderer.domElement, onEditorChange);

function disposeFigures(): void {
  positionEditor.restore();
  positionEditor.setPose('', '', null);
  weaponEditor.setPose('', '', null);
  vehicleEditor.setTarget(null);
  for (const f of figures) f.weapons?.release();
  for (const f of figures) turntable.remove(f.inst.root);
  for (const f of figures) f.card?.remove();
  figures = [];
}

/**
 * A subject whose model nothing on our rig drives — a weapon, the swoop bike,
 * the unrigged massiff. Its factory ignores the `authored` flag because there
 * is no procedural version to compare against, so putting it on the turntable
 * twice would stand the same sculpt beside itself under two different labels.
 */
const isProp = (s: Subject): boolean => s.build.length === 0;
/** the character the subject plays as — itself, or the one a variant file stands in for */
const cid = (): string => subject.character ?? subject.id;

function spawn(): void {
  disposeFigures();
  // A variant (the re-rigged Din) compares against the character it stands in
  // for — the original file on the left — rather than against the procedural body.
  const original = subject.character ? findSubject(subject.character) : null;
  const wants: Array<[boolean, string, Subject?]> = isProp(subject)
    ? [[true, 'Authored model']]
    : original && mode === 'both'
      ? [[true, 'Original rig', original], [true, 'Re-rigged']]
      : subject.hasModel && mode === 'both'
        ? [[true, 'Authored model'], [false, 'Procedural']]
        : [[mode !== 'procedural' && subject.hasModel, mode === 'procedural' || !subject.hasModel ? 'Procedural' : 'Authored model']];

  const sides = wants.length > 1 ? ['Left', 'Right'] : [''];
  figures = wants.map(([authored, label, from], i) => {
    const inst = (from ?? subject).build(authored) as CharacterInstance & Figure['extras'];
    // anchors placed this session go on a ride (or the Nikto) the moment it is built
    vehicleEditor.restore(inst.root);
    if (inst.animator && inst.rig) {
      const mando = cid() in MANDO_ROSTER ? meleeKinds(cid() as MandoId) : [];
      const staff = mando.includes('gaffi') || ['tusken', 'pirateMelee', 'alamite', 'officer'].includes(cid());
      Object.assign(inst.animator.clips, combatStudyClips(inst.rig.proportions, cid(), {
        staff, sabers: mando.includes('sabers'),
      }));
      Object.assign(inst.animator.clips, styleStudyClips(cid(), inst.rig.proportions));
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
    const loadout = isProp(subject) ? null : loadoutFor(cid(), inst);
    return {
      inst, extras: inst, rest,
      weapons: loadout && inst.rig ? new FigureWeapons(inst.root, inst.rig.bones, loadout) : null,
      waitingFor: authored ? modelUrl((from ?? subject).modelFile ?? (from ?? subject).id) : null,
      card: null,
      label: sides[i] ? `${sides[i]} — ${label}` : label,
    };
  });
  showLoading();

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
  // a new figure gets the game's landings: carry over a depth being tried
  if (landDepth.soft !== LAND_DEPTH.soft || landDepth.hard !== LAND_DEPTH.hard) rebuildLandings();
  editor.setTargets(figures
    .filter((f) => f.inst.rig)
    .map((f) => ({ label: f.label, bones: f.inst.rig!.bones as Record<string, THREE.Object3D> })));
  if (editing && editKind === 'position') refreshPositionPose();
  if (editing && editKind === 'weapon') refreshWeaponPose();
  if (editing) enterEdit();
  renderLegend();
  frameSubject();
  expose({ __wb: { figures, subject, pose, camera, controls } });  // debug/testing handle
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
    if (cid() === 'boba_fett') {
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

/** fighters with a blade in each hand (mandalorians.ts builds the off-hand saber for these) */
const TWIN_BLADES: ReadonlySet<string> = new Set(['ventress', 'jedi', 'maris']);

/** The poses this turntable can actually play, with the current pick kept valid. */
function available(): Pose[] {
  const kinds = cid() in MANDO_ROSTER ? meleeKinds(cid() as MandoId) : [];
  const playerAttack = new Set(['melee1', 'melee2', 'melee3']);
  const saberAttack = new Set(['saber1', 'saber2', 'saber3', 'saberIdle', 'saberRun', 'flourish']);
  const list = posesFor(capabilities()).filter((p) => {
    if (playerAttack.has(p.id)) return kinds.includes('gaffi');
    if (saberAttack.has(p.id)) return kinds.includes('sabers');
    // Only the twin-blade fighters parry with the off hand (player.ts
    // PARRY_CLIPS), and only they have a left-hand blade to throw and catch.
    if (p.id === 'parry') return cid() === 'ventress' || cid() === 'jedi';
    if (p.id === 'throwL' || p.id === 'catchL') return TWIN_BLADES.has(cid());
    if (p.id === 'throwR' || p.id === 'catchR') return kinds.includes('sabers');
    if (p.id === 'enemySwing') return kinds.length === 0 && !!figures[0]?.inst.animator;
    return true;
  });
  if (!list.some((p) => p.id === pose.id)) pose = list.find((p) => p.id === 'idle') ?? list[0];
  return list;
}

/** which landing depth the current pose previews, if it is a landing */
function landSlot(): 'soft' | 'hard' | null {
  return pose.id === 'land' ? 'soft' : pose.id === 'landHard' ? 'hard' : null;
}

/** rebuild every figure's landings at the slider's depths */
function rebuildLandings(): void {
  for (const f of figures) {
    const anim = f.inst.animator;
    if (!anim || !f.inst.rig) continue;
    Object.assign(anim.clips, landingClips(f.inst.rig.proportions, landDepth));
    anim.invalidate();
  }
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
    const armorerIdle = cid() === 'armorer' && pose.id === 'idle';
    f.extras.setWeapon?.(pose.unarmed ? 'none' : (pose.melee || armorerIdle) ? 'gaffi' : 'blaster');
    setWeaponVisibility(f, !pose.unarmed);
    f.extras.setBlock?.(pose.block ? 1 : 0);
    // An either-pose the user asked to show the other slot in: draw it the
    // way the game would, then put the slot's pick (if any) in that hand.
    const held = heldWeapon();
    if (held.hand && held.hand !== held.gameHand) f.extras.setWeapon?.(held.hand === 'melee' ? 'gaffi' : 'blaster');
    f.weapons?.show(held.hand, held.hand ? weaponChoices.get(cid(), held.hand) : null);
    f.inst.cosmetic?.(0, time);
    f.weapons?.frame(time);
  }
}

/**
 * The weapon slots the current pose offers, and which one is in the hand.
 * A melee attack offers the melee slot, an aim the gun slot, and a pose that
 * could carry either offers both, with the game's own choice in hand until
 * the user picks the other.
 */
function heldWeapon(): { loadout: Loadout | null; slots: WeaponSlot[]; hand: WeaponSlot | null; gameHand: WeaponSlot | null } {
  const loadout = figures.find((f) => f.weapons)?.weapons?.loadout ?? null;
  const kind = poseWeapon(pose);
  if (!loadout || kind === 'none') return { loadout, slots: [], hand: null, gameHand: null };
  const wanted: WeaponSlot[] = kind === 'either' ? ['melee', 'gun'] : [kind];
  const slots = wanted.filter((s) => loadout[s]);
  if (!slots.length) return { loadout, slots, hand: null, gameHand: null };
  // the Armorer shows her axe at idle, as the character-select screen does
  const gameHand: WeaponSlot = kind !== 'either' ? kind
    : cid() === 'armorer' && pose.id === 'idle' ? 'melee' : loadout.hand;
  const asked = weaponHand.get(cid());
  const hand = kind === 'either' && asked && slots.includes(asked) ? asked
    : slots.includes(gameHand) ? gameHand : slots[0];
  return { loadout, slots, hand, gameHand };
}

/**
 * How the game itself closes a figure's hands on this pose (`fists.ts`), or
 * null where it leaves them as sculpted and the toggle is free to preview.
 * An NPC's rule counts: the workbench shows a fighter as the game can field it.
 */
function officialFists(f: Figure): [number, number] | null {
  const root = f.inst.root;
  if (!fistsInPlay(root, true)) return null;
  const ride = root.userData.vehicleRig as VehicleRig | undefined;
  if (ride) return ride.gripped ? [1, 1] : null;
  // the swoop's rider holds its bars, and closes on them
  if (root.userData.niktoRider) return [1, 1];
  const [r, l] = fistTargets(f.inst.animator, { gun: heldWeapon().hand === 'gun' });
  return r || l ? [r, l] : null;
}

/** each figure's hands: the game's own fists where it sets them, the toggle's everywhere else */
function syncFists(): void {
  let set = false;
  for (const f of figures) {
    const official = officialFists(f);
    set ||= !!official;
    if (official) clench(f.inst.root, official[0], official[1]);
    else clench(f.inst.root, fists ? 1 : 0);
  }
  const box = panel.querySelector<HTMLInputElement>('#fists');
  if (box && box.disabled !== set) {
    box.disabled = set;
    box.parentElement!.title = set ? FISTS_SET_TITLE : FISTS_FREE_TITLE;
    box.parentElement!.classList.toggle('official', set);
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
 * thing to edit the whole clip against — a clip sampled mid-cycle would export
 * numbers that match no keyframe in `clips.ts`. A moment is edited where it
 * is, at the scrubbed time.
 */
function freezePose(): void {
  const at = scrubbingEdits() ? animationTime : 0;
  for (const f of figures) {
    const anim = f.inst.animator;
    if (!anim) continue;
    const clips = activeClips();
    for (const name of [clips.lower, clips.upper]) {
      if (!name) continue;
      const clip = anim.clips[name];
      const action = clip && anim.mixer.existingAction(clip);
      if (action) action.time = Math.min(at, Math.max(0, clip.duration - 1e-4));
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
  // a pose scrubbed to while paused is where a moment gets edited
  if (!paused) animationTime = 0;
  editing = true;
  freezePose();
  editor.setEnabled(editKind === 'rotate');
  positionEditor.setEnabled(editKind === 'position');
  weaponEditor.setEnabled(editKind === 'weapon');
  vehicleEditor.setEnabled(editKind === 'weapon');
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
  vehicleEditor.setEnabled(false);
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
    vehicleEditor.setTarget(null);
    return;
  }
  weaponAwaiting = false;
  figure.inst.cosmetic?.(0, time);
  figure.weapons?.frame(time);
  weaponEditor.setPose(subject.id, poseKey, figure.inst.root);
  vehicleEditor.setTarget(VehicleAnchorEditor.handles(figure.inst.root) ? figure.inst.root : null);
  vehicleEditor.setEnabled(true);
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
 * and the clip's original first key, stored against that clip — or, editing a
 * moment, the difference from what the clip plays at the scrubbed time.
 */
function commitBone(bone: string): void {
  const clip = clipFor(bone);
  const rig = figures.find((f) => f.inst.rig)?.inst.rig;
  const joint = rig?.bones[bone as keyof typeof rig.bones];
  if (!clip || !joint) { renderEditPanel(); return; }
  if (scrubbingEdits()) {
    // onto the clip's own key when the scrub sits within half a frame of one,
    // and the pose held there, so the frame shown is the frame changed
    const at = edits.snap(clip, bone, momentTime());
    animationTime = at;
    edits.set(clip, bone, eulerSub(eulerOf(joint.quaternion), edits.baseAt(clip, bone, at)) as Euler3, at);
  } else {
    edits.set(clip, bone, eulerSub(eulerOf(joint.quaternion), edits.baseOf(clip, bone)) as Euler3);
  }
  refreshEdits();
}

/** the scrubbed time a moment is keyed at: whole milliseconds, as the ledger stores it */
const momentTime = (): number => Math.round(animationTime * 1000) / 1000;

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
    else f.inst.animator.noteClipEdit();
  }
  // `applyPose` rewinds the clock; a moment being edited is held where it is
  const at = animationTime;
  applyPose();
  if (scrubbingEdits()) animationTime = at;
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

function option(value: string, label: string, selected: boolean, dim = false): string {
  return `<option value="${value}"${selected ? ' selected' : ''}${dim ? ' class="not-in-game"' : ''}>${label}</option>`;
}

/**
 * The alternates real combat can roll: Din's three gaderffii variants (one in
 * four hits on that combo step, `DIN_STAFF_VARIANTS` in player.ts) and every
 * approved style move (`styleClips.ts`). Anything else here is a workbench
 * study nothing in play will show.
 */
const DIN_LIVE_ALTERNATE: Record<string, string> = { melee1: 'spearTest2', melee2: 'staffRise', melee3: 'staffDiagonal' };
function altUsedInGame(alt: Alternate, poseId: string): boolean {
  return (cid() === 'din' && DIN_LIVE_ALTERNATE[poseId] === alt.id)
    || styleMoves(cid()).some((m) => m.id === alt.id)
    || (alt.reference === 'unarmed' && fightsUnarmed(cid()));
}
/** this fighter throws the unarmed moves in play: a hero with fists, or a bare-handed hostile */
const fightsUnarmed = (id: string): boolean =>
  (id in MANDO_ROSTER && meleeKinds(id as MandoId).includes('fists')) || FIST_ENEMIES.has(id);
/** a pose the game plays on this fighter, rather than one only previewed here */
const inGame = (p: Pose): boolean => !p.previewOnly || (!!p.unarmed && fightsUnarmed(cid()));
/** a pose still has alternates waiting on a decision */
const hasOpenAlternates = (p: Pose): boolean => alternatesFor(p).some((alt) => !altUsedInGame(alt, p.id));

/** Keep view selection in the URL; clip edits remain session-only. */
function syncSelectionUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('character', subject.id);
  url.searchParams.set('pose', pose.id);
  url.searchParams.set('mode', mode);
  if (alternateChoice === 'none') url.searchParams.delete('alternate');
  else url.searchParams.set('alternate', alternateChoice);
  if (fists) url.searchParams.set('fists', '1'); else url.searchParams.delete('fists');
  history.replaceState(null, '', url);
}

function renderPanel(): void {
  const shoulderAsset = subject.character ?? subject.modelFile ?? subject.id;
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
  // a ride's "gait" is its speed, and the swoop rider's attack is a ram
  const rideLabels: Record<string, string> | null = subject.id === 'nikto'
    ? { creatureIdle: 'Hover', creatureWalk: 'Cruise — slow', creatureRun: 'Cruise — full speed', creatureAttack: 'Ram' }
    : subject.id.startsWith('vehicle:')
      ? { creatureIdle: 'Parked — rider seated', creatureWalk: 'Moving — slow', creatureRun: 'Moving — full speed' }
      : null;
  const gameOptions = list.filter(inGame).map((p) =>
    option(p.id, `${cid() === 'din' ? (dinSaberLabels[p.id] ?? p.name) : rideLabels?.[p.id] ?? p.name}${hasOpenAlternates(p) ? ' •' : ''}`, p.id === pose.id)).join('');
  const previewOptions = list.filter((p) => !inGame(p) && p.id !== 'rest').map((p) =>
    option(p.id, `${p.name} ◆`, p.id === pose.id)).join('');
  const choices = alternatesFor(pose);
  const selectedUpper = (choices.find((alt) => alt.id === alternateChoice) ?? pose).upper;
  const counterweightAvailable = hasCounterweight(selectedUpper)
    || ((cid() === 'maul' || cid() === 'din') && alternateChoice === 'none' && ['saber1', 'saber2', 'saber3'].includes(selectedUpper ?? ''));
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
      <p class="picker-key">• alternates awaiting a decision &nbsp; ◆ not in game</p>
    </div>

    ${choices.length ? `
    <div class="field">
      <label for="attackAlternate">Alternates</label>
      <select id="attackAlternate">
        ${option('none', 'None — original attack', alternateChoice === 'none')}
        ${choices.map((alt) => {
          const live = altUsedInGame(alt, pose.id);
          return option(alt.id, `${alt.name}${live ? '' : ' ◆'}`, alternateChoice === alt.id, !live);
        }).join('')}
      </select>
      ${choices.some((alt) => !altUsedInGame(alt, pose.id))
        ? '<p class="picker-key">◆ workbench study only — not rolled in game</p>' : ''}
    </div>` : ''}
    ${pose.unarmed ? `<p class="study-note">${combatStyle(cid())} unarmed · weapons hidden · ${fightsUnarmed(cid())
      ? 'thrown in combat: each hit draws one of this step’s moves at random.' : 'not this fighter’s in combat.'}</p>` : ''}
    ${cid() === 'din' && ['melee1', 'melee2', 'melee3'].includes(pose.id)
      ? `<p class="study-note">In game, this combo hit occasionally uses ${pose.id === 'melee1' ? 'Long lunge thrust' : pose.id === 'melee2' ? 'Low rising sweep' : 'Diagonal step and strike'} instead of the original (25% chance).</p>` : ''}
    ${counterweightAvailable ? `<div class="field playback">
      <label for="offhandStrength">Free arm counterweight <output id="offhandValue">${Math.round(offhandStrength * 100)}%</output></label>
      <input id="offhandStrength" type="range" min="0" max="1.25" step="0.25" value="${offhandStrength}" aria-label="Free arm counterweight">
      <p class="hint">Adjust how far the free arm reaches during the windup.</p>
    </div>` : ''}
    ${landSlot() ? `<div class="field playback">
      <label for="landDepth">Crouch depth <output id="landDepthValue">${landDepth[landSlot()!].toFixed(2)} m</output></label>
      <input id="landDepth" type="range" min="0.08" max="0.65" step="0.01" value="${landDepth[landSlot()!]}" aria-label="Crouch depth">
      <p class="hint">How far the hips drop at the bottom of the ${landSlot() === 'hard' ? 'fast-fall' : 'hop'} landing. The game uses ${LAND_DEPTH[landSlot()!].toFixed(2)} m; the feet stay planted at any depth.</p>
    </div>` : ''}
    ${weaponChoiceHtml()}

    <div class="field playback">
      <label for="animationSpeed">Animation speed <output id="speedValue">${animationSpeed.toFixed(2)}×</output></label>
      <div class="playback-row">
        <input id="animationSpeed" type="range" min="0.1" max="2" step="0.05" value="${animationSpeed}" aria-label="Animation speed">
        <button id="pauseAnimation" type="button" aria-pressed="${paused}">${paused ? 'Play' : 'Pause'}</button>
      </div>
    </div>
    ${paused || scrubbingEdits() ? `<div class="field playback">
      <label for="animationTime">Animation time <output id="animationTimeValue">${timeLabel()}</output></label>
      <input id="animationTime" type="range" min="0" max="${Math.max(1, Math.ceil(animationDuration() * 60) - 1)}" step="1"
        value="${Math.round(animationTime * 60)}" ${(editing && !scrubbingEdits()) || animationDuration() === 0 ? 'disabled' : ''} aria-label="Animation time in 60 fps frames">
      ${scrubbingEdits() ? '<p class="hint">Drag through the animation; let go and it settles on the nearest keyframe, which the joint you turn then changes.</p>'
        : editing ? '<p class="hint">Leave edit mode to scrub playback, or edit a moment; Weapon grips has its own animation-frame slider.</p>' : ''}
    </div>` : ''}

    <div class="field">
      <label>Show</label>
      <div class="seg" id="mode">
        <button data-mode="authored" aria-pressed="${mode === 'authored'}">Model</button>
        <button data-mode="procedural" aria-pressed="${mode === 'procedural'}">Procedural</button>
        <button data-mode="both" aria-pressed="${mode === 'both'}">Compare</button>
      </div>
    </div>

    <label class="check" title="Show a decimated character's full-resolution original (public/models/full/) instead of the budget-sized model the game ships"><input type="checkbox" id="fullRes" ${initialParams.get('res') === 'full' ? 'checked' : ''}> Full-resolution original</label>
    <label class="check"><input type="checkbox" id="grid" ${showGrid ? 'checked' : ''}> Grid &amp; scale post</label>
    <label class="check" title="${FISTS_FREE_TITLE}"><input type="checkbox" id="fists" ${fists ? 'checked' : ''}> Clench fists <span class="fists-note">— set by the game here</span></label>
    ${subject.hasModel && !isProp(subject) ? `
    <details class="fold" data-fold="shoulders" ${folds.shoulders ? 'open' : ''}><summary>Shoulder width</summary>
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
    </div>
    </details>` : ''}

    <button id="editToggle" class="toggle" aria-pressed="${editing}">
      ${editing ? 'Leave edit mode' : 'Edit mode'}
    </button>
    <div id="edit"></div>

    <details class="fold" data-fold="details" ${folds.details ? 'open' : ''}><summary>Details</summary>
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
      <br><br><b>Weapon choice</b> swaps the held prop for another from the same class:
      melee weapons in attacks, guns in aims, both where a pose could carry either.
      Sabers and the beskar spear belong to their owners and are never offered.
      The weapon grip editor works on whichever weapon is showing.
      <br><br><b>Shoulder width</b> uses the averaged spacing from your JSON on
      authored models in the workbench and game. Each slider controls its own arm
      angle; leave Position mode before adjusting it so manual joint offsets do not cover the result.
    </p>
    </details>`;

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
  bindWeaponChoice();
  panel.querySelector<HTMLInputElement>('#animationSpeed')!.oninput = (e) => {
    animationSpeed = Number((e.target as HTMLInputElement).value);
    panel.querySelector<HTMLOutputElement>('#speedValue')!.value = `${animationSpeed.toFixed(2)}×`;
  };
  const depthSlider = panel.querySelector<HTMLInputElement>('#landDepth');
  if (depthSlider) depthSlider.oninput = () => {
    landDepth[landSlot()!] = Number(depthSlider.value);
    panel.querySelector<HTMLOutputElement>('#landDepthValue')!.value = `${landDepth[landSlot()!].toFixed(2)} m`;
    rebuildLandings();
    applyPose();
    if (editing) freezePose();
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
    panel.querySelector<HTMLOutputElement>('#animationTimeValue')!.value = timeLabel();
  };
  // editing a moment: let go, and the pose settles on the nearest keyframe
  if (timeSlider) timeSlider.onchange = () => {
    if (!scrubbingEdits()) return;
    const keys = keyTimes();
    const t = keys[keyIndex(keys)] ?? 0;
    seekAnimation(t);
    timeSlider.value = String(Math.round(t * 60));
    panel.querySelector<HTMLOutputElement>('#animationTimeValue')!.value = timeLabel();
    renderEditPanel();
  };
  panel.querySelector('#mode')!.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => { mode = btn.dataset.mode as Mode; spawn(); renderPanel(); };
  // A loaded model is cached by its file, so switching resolution is a reload
  // of the page on the other set of files, keeping everything else in the URL.
  const fullRes = panel.querySelector<HTMLInputElement>('#fullRes');
  if (fullRes) fullRes.onchange = () => {
    const url = new URL(location.href);
    if (fullRes.checked) url.searchParams.set('res', 'full'); else url.searchParams.delete('res');
    location.href = url.toString();
  };
  });
  // the two folded sections remember being opened across the panel's re-renders
  panel.querySelectorAll<HTMLDetailsElement>('details[data-fold]').forEach((d) => {
    d.ontoggle = () => { folds[d.dataset.fold as keyof typeof folds] = d.open; };
  });
  panel.querySelector<HTMLInputElement>('#fists')!.onchange = (e) => {
    fists = (e.target as HTMLInputElement).checked;
    syncSelectionUrl();
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
  renderEditPanel();
}

// ---------- weapon choice ----------
const SLOT_LABEL: Record<WeaponSlot, string> = { melee: 'Melee weapon', gun: 'Gun' };

/**
 * The weapon pickers for this character in this pose: one per slot the pose
 * offers, each opening on the weapon the game uses today. A pick that differs
 * from it is tagged here and listed in the ledger underneath, across every
 * character, so the session's picks can be exported together.
 */
function weaponChoiceHtml(): string {
  const { loadout, slots, hand } = heldWeapon();
  const picks = weaponChoices.entries();
  if (!slots.length && !picks.length) return '';
  const pickers = slots.map((slot) => {
    const def = loadout![slot]!;
    const chosen = weaponChoices.get(cid(), slot);
    const offered = WEAPON_OPTIONS.filter((o) => o.slot === slot && o.id !== def.id);
    return `<div class="field weapon-choice${chosen ? ' changed' : ''}">
      <label for="weaponChoice-${slot}">${SLOT_LABEL[slot]}${chosen ? ' <span class="changed-tag">changed</span>' : ''}</label>
      <select id="weaponChoice-${slot}" data-weapon-slot="${slot}">
        ${option('', `Default — ${def.name}`, !chosen)}
        ${offered.map((o) => option(o.id, o.name, o.id === chosen)).join('')}
      </select>
    </div>`;
  }).join('');
  const handSeg = slots.length > 1 ? `<div class="field"><label>In hand</label><div class="seg" id="weaponHand">
      ${slots.map((slot) => `<button data-hand="${slot}" aria-pressed="${hand === slot}">${slot === 'melee' ? 'Melee' : 'Gun'}</button>`).join('')}
    </div></div>` : '';
  const why = slots.length ? '' : `<p class="hint">${!loadout
    ? 'Nothing on offer here — this character keeps its own weapon.'
    : 'No weapon in hand in this pose.'}</p>`;
  return `<div class="weapon-choices">
    <div class="field"><label>Weapon choice</label>${why}</div>
    ${pickers}${handSeg}
    <div class="row"><button id="weaponChoiceExport" class="primary"${picks.length ? '' : ' disabled'}>Export weapon choices JSON</button></div>
    ${picks.length ? `<div class="ledger">${picks.map((e) => `<div class="edit"><span>${e.characterName}</span>
      <code>${e.slot}: ${findWeaponOption(e.choice)?.name ?? e.choice}</code>
      <button data-choice-character="${e.character}" data-choice-slot="${e.slot}" title="back to ${e.defaultName}">×</button></div>`).join('')}</div>` : ''}
    <p class="hint">Workbench only — the game keeps its defaults. Picks stay with each character across poses.</p>
  </div>`;
}

function bindWeaponChoice(): void {
  const refresh = (): void => {
    applyPose();
    if (editing) freezePose();
    if (editing && editKind === 'weapon') { sampleWeaponPose(); refreshWeaponPose(); }
    renderPanel();
  };
  const { loadout } = heldWeapon();
  panel.querySelectorAll<HTMLSelectElement>('[data-weapon-slot]').forEach((select) => {
    select.onchange = () => {
      const slot = select.dataset.weaponSlot as WeaponSlot;
      weaponChoices.set(cid(), subject.name, slot, loadout![slot]!, select.value || null);
      // picking for a slot is asking to see it
      if (poseWeapon(pose) === 'either') weaponHand.set(cid(), slot);
      refresh();
    };
  });
  panel.querySelectorAll<HTMLButtonElement>('#weaponHand [data-hand]').forEach((button) => {
    button.onclick = () => { weaponHand.set(cid(), button.dataset.hand as WeaponSlot); refresh(); };
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-choice-character]').forEach((button) => {
    button.onclick = () => {
      const entry = weaponChoices.entries().find((e) =>
        e.character === button.dataset.choiceCharacter && e.slot === button.dataset.choiceSlot);
      if (entry) weaponChoices.set(entry.character, entry.characterName, entry.slot, { id: entry.defaultId, name: entry.defaultName, held: null }, null);
      refresh();
    };
  });
  const exportButton = panel.querySelector<HTMLButtonElement>('#weaponChoiceExport');
  if (exportButton) exportButton.onclick = exportWeaponChoices;
}

function exportWeaponChoices(): void {
  const entries = weaponChoices.entries();
  if (!entries.length) return;
  const payload = {
    format: 'mando-workbench-weapon-choices/1', exportedAt: new Date().toISOString(),
    note: 'Held-weapon picks made in the model workbench. The game is unchanged: each entry names the weapon a character uses today and the one picked to replace it in that slot. Ids are prop models in public/models/<id>.glb.',
    entries: entries.map((e) => ({
      character: e.character, characterName: e.characterName, slot: e.slot,
      default: { id: e.defaultId, name: e.defaultName },
      chosen: { id: e.choice, name: findWeaponOption(e.choice)?.name ?? e.choice, model: `public/models/${e.choice === 'pistols' ? 'pistol' : e.choice}.glb` },
    })),
  };
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  anchor.download = 'weapon-choices.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
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
  const selAt = scrubbingEdits() ? momentTime() : undefined;
  const selEdited = !!(sel && selClip && edits.deltaOf(selClip, sel, selAt));
  editSignature = signature();
  const deg = editing ? editor.selectedEuler() : null;

  const editBox = !editing ? '' : `
      <div class="field">
        <label>Edits change</label>
        <div class="seg" id="editAt">
          <button data-edit-at="clip" aria-pressed="${editAt === 'clip'}">Whole clip</button>
          <button data-edit-at="moment" aria-pressed="${editAt === 'moment'}">This moment${editAt === 'moment' ? ` · ${momentTime().toFixed(2)} s` : ''}</button>
        </div>
      </div>
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
          <button id="resetBone"${selEdited ? '' : ' disabled'}>Reset ${sel}${selAt === undefined ? '' : ` at ${selAt.toFixed(2)} s`}</button>
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
  host.querySelector('#editAt')?.querySelectorAll<HTMLButtonElement>('button').forEach((btn) => {
    btn.onclick = () => {
      const next = btn.dataset.editAt as 'clip' | 'moment';
      if (next === editAt) return;
      editAt = next;
      // the whole clip is edited at its first key; a moment on the key nearest
      // where it was scrubbed
      if (next === 'moment') {
        paused = true;
        const keys = keyTimes();
        animationTime = keys[keyIndex(keys)] ?? 0;
      }
      freezePose();
      renderPanel();
    };
  });
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
    if (sel && selClip) { edits.clear(selClip, sel, selAt); refreshEdits(); }
  });
  host.querySelector<HTMLButtonElement>('#undo')!.onclick = undoEdit;
  host.querySelector<HTMLButtonElement>('#redo')!.onclick = redoEdit;
  host.querySelector<HTMLButtonElement>('#resetAll')!.onclick = () => { edits.clearAll(); refreshEdits(); };
  host.querySelector<HTMLButtonElement>('#export')!.onclick = exportChanges;
  for (const row of host.querySelectorAll<HTMLButtonElement>('.ledger button')) {
    row.onclick = () => {
      edits.clear(row.dataset.clip!, row.dataset.bone!, row.dataset.at ? Number(row.dataset.at) : undefined);
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
      vehicleEditor.setEnabled(next === 'weapon');
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
  if (vehicleEditor.kind) { renderVehiclePanel(host); return; }
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

/** what turning each ride anchor does — and, where it does nothing yet, a warning that says so */
const ROTATION_NOTE: Partial<Record<string, { text: string; warn?: boolean }>> = {
  seat: { text: 'Y turns the rider on the seat, in the game too. X and Z tilt him here only — the game does not tilt a rider yet, so they are a note of how the ride should sit under him.', warn: true },
  grip: { text: 'No bearing on anything yet: the hand keeps the pose\'s own wrist. Exported as a note of how the bars lie.', warn: true },
  foot: { text: 'How the sole lies on the rest, in the ride\'s frame: 0, 0, 0 is flat with the toes forward. The right foot mirrors it.' },
};

/**
 * The rides' anchors: the seat and the left hand's grip on a vehicle, or the
 * Nikto's own seat on his swoop. Exported as the game's data file itself.
 */
function renderVehiclePanel(host: HTMLDivElement): void {
  const ed = vehicleEditor;
  // typing into a field re-renders nothing: the gizmo follows, the field keeps focus
  if ((document.activeElement as HTMLElement | null)?.dataset?.anchorAxis && host.querySelector('[data-anchor-axis]')) return;
  // ...and a spread being dragged or typed keeps its control until let go
  if (['legSpread', 'legSpreadNumber'].includes(document.activeElement?.id ?? '') && host.querySelector('#legSpread')) return;
  const cur = ed.current();
  const nikto = ed.kind === 'nikto';
  const label: Record<string, string> = {
    seat: 'Seat — where the rider sits', grip: 'Hand — left grip (bars, yoke or reins)',
    foot: 'Foot — left footrest (the right mirrors it)', rider: 'Rider — on the swoop',
  };
  const edited = ed.edited();
  host.innerHTML = `${editModeButtons()}
    <div class="editbox">
      <div class="field"><label for="anchorTarget">${nikto ? 'Nikto on his swoop' : `${ed.subjectName} anchors`}</label>
        <select id="anchorTarget">${ed.names().map((n) => option(n, label[n], n === ed.selected)).join('')}</select></div>
      <div class="field"><label>3D handle</label><div class="seg">
        <button data-anchor-mode="translate" aria-pressed="${ed.mode === 'translate'}">Move${nikto ? ' rider' : ''}</button>
        <button data-anchor-mode="rotate" aria-pressed="${ed.mode === 'rotate'}">Rotate${nikto ? ' rider' : ''}</button>
      </div></div>
      ${cur ? `<div class="field"><label>Position in the ${nikto ? 'bike' : 'ride'}'s frame (m, +Z forward, +X the rider's left)</label>
        <div class="xyz">${cur.position.map((v, i) => `<input data-anchor-axis="p${i}" type="number" step="0.005" value="${v}">`).join('')}</div></div>
      <div class="field"><label>Rotation in degrees, XYZ (Y first)</label>
        <div class="xyz">${cur.rotation.map((v, i) => `<input data-anchor-axis="r${i}" type="number" step="1" value="${v}">`).join('')}</div>
        ${ed.selected && ROTATION_NOTE[ed.selected] ? `<p class="hint${ROTATION_NOTE[ed.selected]!.warn ? ' warn' : ''}">${ROTATION_NOTE[ed.selected]!.text}</p>` : ''}</div>
      <div class="row"><button id="anchorReset">Reset to the game's</button></div>`
    : `<p class="hint">${weaponAwaiting ? 'Waiting for the authored model.' : 'Select an anchor.'}</p>`}
      ${ed.turns ? `<div class="field"><label>Model on its keel, degrees about the vertical</label>
        <div class="weapon-scale-row"><input id="modelYaw" type="number" step="0.5" value="${ed.turns.modelYaw}"></div>
        <p class="hint">Turn the ride's model to line up with the way it drives (then re-place its anchors). The rider turns with the seat's rotation (its Y).</p>
      </div>` : ''}
      <div class="field weapon-scale"><label for="legSpread">Leg spread — each knee from the centre line
        <output id="legSpreadValue">${ed.legSpread === null ? 'the pose’s own' : `${Math.round(ed.legSpread * 100)} cm`}</output></label>
        <div class="weapon-scale-row">
          <input id="legSpread" type="range" min="0.08" max="0.5" step="0.005" value="${ed.legSpread ?? ed.kneeWidth()}">
          <input id="legSpreadNumber" type="number" min="0" max="0.8" step="0.005" value="${ed.legSpread ?? ed.kneeWidth()}">
        </div>
        <div class="row"><button id="legSpreadClear" ${ed.legSpread === null ? 'disabled' : ''}>Use the pose's own legs</button></div>
        <p class="hint">In metres, so it carries to every rider: each body's own hips and thighs open to put the knees there.</p>
      </div>
      <div class="row"><button id="anchorExport" class="primary" ${edited.length ? '' : 'disabled'}>Export vehicle anchors JSON</button></div>
      <p class="hint">${nikto
        ? 'Move and turn the rider to sit him on the bike; his hands follow the bars. '
        : 'Blue is the seat: the rider\'s hips sit on it, at each character\'s own hip height. Orange is the left hand, the one that never holds the gun; on a machine the right hand mirrors it. Green is the left footrest: once moved, both feet reach for it (the right mirrored), the knees bowed out to the leg spread. '}
        The export is the game's own <code>src/game/data/vehicleAnchors.json</code>, with these edits over what is already in it.</p>
      ${edited.length ? `<div class="ledger">${edited.map((e) => `<div class="edit"><span>${e.name}</span><code>${
        'seat' in e.anchor ? `seat ${e.anchor.seat.join(', ')} · grip ${e.anchor.grip.join(', ')}` : `at ${e.anchor.position.join(', ')}`}${
        e.anchor.legSpread !== undefined ? ` · knees ${e.anchor.legSpread}` : ''}${
        'foot' in e.anchor && e.anchor.foot ? ` · foot ${e.anchor.foot.join(', ')}` : ''}${
        'yaw' in e.anchor && e.anchor.yaw ? ` · rider ${e.anchor.yaw}°` : ''}${
        'modelYaw' in e.anchor && e.anchor.modelYaw ? ` · model ${e.anchor.modelYaw}°` : ''}${
        'seatRotation' in e.anchor && e.anchor.seatRotation ? ` · seat ${e.anchor.seatRotation.join('/')}°` : ''}${
        'gripRotation' in e.anchor && e.anchor.gripRotation ? ` · grip ${e.anchor.gripRotation.join('/')}°` : ''}${
        'footRotation' in e.anchor && e.anchor.footRotation ? ` · sole ${e.anchor.footRotation.join('/')}°` : ''}</code></div>`).join('')}</div>` : ''}
    </div>`;
  bindEditModeButtons(host);
  host.querySelector<HTMLSelectElement>('#anchorTarget')!.onchange = (event) =>
    ed.select((event.target as HTMLSelectElement).value as 'seat' | 'grip' | 'foot' | 'rider');
  const modelYaw = host.querySelector<HTMLInputElement>('#modelYaw');
  if (modelYaw) modelYaw.onchange = () => { ed.setTurn('modelYaw', Number(modelYaw.value)); modelYaw.blur(); renderVehiclePanel(host); };
  host.querySelectorAll<HTMLButtonElement>('[data-anchor-mode]').forEach((button) => {
    button.onclick = () => ed.setMode(button.dataset.anchorMode as 'translate' | 'rotate');
  });
  host.querySelectorAll<HTMLInputElement>('[data-anchor-axis]').forEach((input) => {
    input.onchange = () => {
      const read = (kind: 'p' | 'r'): [number, number, number] => [0, 1, 2].map((i) =>
        Number(host.querySelector<HTMLInputElement>(`[data-anchor-axis="${kind}${i}"]`)?.value)) as [number, number, number];
      if (input.dataset.anchorAxis!.startsWith('p')) ed.setPosition(read('p'));
      else ed.setRotation(read('r'));
      input.blur();
      renderVehiclePanel(host);
    };
  });
  host.querySelector<HTMLButtonElement>('#anchorReset')?.addEventListener('click', () => ed.resetSelected());
  const spread = host.querySelector<HTMLInputElement>('#legSpread')!;
  const spreadNumber = host.querySelector<HTMLInputElement>('#legSpreadNumber')!;
  // dragging updates in place, so the slider keeps the pointer; letting go redraws
  spread.oninput = () => {
    ed.setLegSpread(Number(spread.value));
    spreadNumber.value = spread.value;
    host.querySelector<HTMLOutputElement>('#legSpreadValue')!.value = `${Math.round(Number(spread.value) * 100)} cm`;
  };
  spread.onchange = () => { spread.blur(); renderVehiclePanel(host); };
  spreadNumber.onchange = () => { ed.setLegSpread(Number(spreadNumber.value)); spreadNumber.blur(); renderVehiclePanel(host); };
  host.querySelector<HTMLButtonElement>('#legSpreadClear')!.onclick = () => { ed.setLegSpread(null); renderVehiclePanel(host); };
  host.querySelector<HTMLButtonElement>('#anchorExport')!.onclick = () => {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([ed.exportJson()], { type: 'application/json' }));
    anchor.download = 'vehicleAnchors.json';
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
        <span>${e.bone}${e.at === undefined ? '' : ` @${e.at.toFixed(2)}s`}</span>
        <code>${e.delta.map((d) => (d > 0 ? '+' : '') + d).join(' ')}</code>
        <button data-clip="${e.clip}" data-bone="${e.bone}"${e.at === undefined ? '' : ` data-at="${e.at}"`} title="drop this edit">×</button>
      </div>`).join('')}`).join('');
}

const dragHint = (): string => (editor.dragAxis
  ? `${editor.dragAxis.toUpperCase()} ring · ${editor.dragAngle.toFixed(1)}°`
  : 'Drag a ring to rotate; hold Shift to snap to 5°.');

const signature = (): string =>
  `${editing}|${editAt}|${momentTime()}|${editor.selected}|${editor.space}|${edits.canUndo}|${edits.canRedo}|`
  + edits.entries().map((e) => `${e.clip}.${e.bone}@${e.at}:${e.delta}`).join(',');

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

  interface BoneDoc {
    wholeClip?: { base: Euler3; edited: Euler3; delta: Euler3 };
    moments?: Array<{ at: number; share: number; base: Euler3; edited: Euler3; delta: Euler3 }>;
    currentKeys: EditEntry['keys'];
    newKeys: EditEntry['newKeys'];
  }
  const clips: Record<string, { playedBy: string[]; duration: number; bones: Record<string, BoneDoc> }> = {};
  const anim = figures.find((f) => f.inst.animator)?.inst.animator;
  for (const entry of list) {
    const duration = anim?.clips[entry.clip]?.duration ?? 0;
    const doc = (clips[entry.clip] ??= { playedBy: posesOf(entry.clip), duration: +duration.toFixed(3), bones: {} });
    const bone = (doc.bones[entry.bone] ??= { currentKeys: entry.keys, newKeys: entry.newKeys });
    const change = { base: entry.base, edited: entry.edited, delta: entry.delta };
    if (entry.at === undefined) bone.wholeClip = change;
    else (bone.moments ??= []).push({ at: entry.at, share: duration ? +(entry.at / duration).toFixed(3) : 0, ...change });
  }

  const doc = {
    format: 'mando-pose-edit/3',
    exportedAt: new Date().toISOString(),
    editedOn: { character: subject.id, lastPose: pose.id },
    units: 'local-space Euler XYZ in degrees — the argument order of qt() in src/anim/clips.ts',
    howToApply: [
      'Each entry is one bone of the canonical rig (src/anim/skeleton.ts) in one clip.',
      '`newKeys` is the finished track: paste those values into that clip’s qt() call.',
      '`wholeClip.delta` was added to every key, measured against the clip’s first keyframe.',
      '`moments` are keys at one time (`at` seconds, `share` of the clip): the key already there, or a new one, set to `edited`; the clip eases in and out of it from its neighbours.',
      '`currentKeys` is what the clip holds today; `currentKeys: null` means it had no track for that bone.',
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
    // edit mode owns the bones; the mixer would write over them every frame
    if (!editing && !paused) f.inst.animator?.update(animationDt);
    if (pose.unarmed) setWeaponVisibility(f, false);
  }
  if (positionAwaiting && editing && editKind === 'position'
    && figures.some((f) => f.waitingFor && ready(f))) refreshPositionPose();
  if (weaponAwaiting && editing && editKind === 'weapon'
    && figures.some((f) => f.waitingFor && ready(f))) refreshWeaponPose();
  if (!paused && !(editing && editKind === 'position'))
    for (const f of figures) f.inst.cosmetic?.(animationDt, time);
  for (const f of figures) f.weapons?.frame(time);
  syncFists();
  editor.update();
  positionEditor.update(camera);
  weaponEditor.update(camera);
  vehicleEditor.update(camera);
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
