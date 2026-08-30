import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BONES, type BoneName, type Rig } from '../anim/skeleton';
import {
  droneClips, kryknaClips, massiffClips,
  kraytClips, mamacoreClips, mudhornClips, mythosaurClips, rancorClips, ravinakClips,
} from '../anim/quadruped';
import { ASSET_ROOT } from '../core/assets';
import { tracked, warmQueue, type WarmPriority } from '../core/warm';
import { markSharedTree } from '../core/dispose';

/**
 * Authored glTF characters.
 *
 * The supplied models are Blender Rigify exports: `DEF-*` bone names, no
 * animation clips, and — importantly — a *flat* skeleton where each limb chain
 * root and the spine chain are all direct children of the armature. Left
 * as-is, rotating the hips or chest would move nothing but itself.
 *
 * The procedural rig stays the animation source of truth and is simply hidden;
 * nothing in the clips, animator, controller or combat code changes. Loading
 * does the structural work, and `retarget` copies one frame of pose across.
 */

/** canonical bone -> Rigify bone in the supplied models */
const BONE_MAP: Partial<Record<BoneName, string>> = {
  hips: 'DEF-spine',
  spine: 'DEF-spine.001',
  chest: 'DEF-spine.003',
  neck: 'DEF-spine.005',
  head: 'DEF-spine.006',
  shoulderL: 'DEF-shoulder.L', shoulderR: 'DEF-shoulder.R',
  upperArmL: 'DEF-upper_arm.L', upperArmR: 'DEF-upper_arm.R',
  forearmL: 'DEF-forearm.L', forearmR: 'DEF-forearm.R',
  handL: 'DEF-hand.L', handR: 'DEF-hand.R',
  upperLegL: 'DEF-thigh.L', upperLegR: 'DEF-thigh.R',
  lowerLegL: 'DEF-shin.L', lowerLegR: 'DEF-shin.R',
  footL: 'DEF-foot.L', footR: 'DEF-foot.R',
};

/**
 * Who each flat-rig chain root should hang from. Arms and shoulders go on
 * spine.004 rather than our `chest` (spine.003) because that is where the
 * shoulders actually sit in these models; it is still a descendant of
 * spine.003, so chest rotation carries the arms as our clips expect.
 */
const REPARENT: Array<[string, string]> = [
  ['DEF-thigh.L', 'DEF-spine'], ['DEF-thigh.R', 'DEF-spine'],
  ['DEF-pelvis.L', 'DEF-spine'], ['DEF-pelvis.R', 'DEF-spine'],
  ['DEF-shoulder.L', 'DEF-spine.004'], ['DEF-shoulder.R', 'DEF-spine.004'],
  ['DEF-upper_arm.L', 'DEF-spine.004'], ['DEF-upper_arm.R', 'DEF-spine.004'],
];

/** parent of each canonical bone, for accumulating the source pose top-down */
const CANON_PARENT: Partial<Record<BoneName, BoneName>> = {
  spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  shoulderL: 'chest', upperArmL: 'shoulderL', forearmL: 'upperArmL', handL: 'forearmL',
  shoulderR: 'chest', upperArmR: 'shoulderR', forearmR: 'upperArmR', handR: 'forearmR',
  upperLegL: 'hips', lowerLegL: 'upperLegL', footL: 'lowerLegL',
  upperLegR: 'hips', lowerLegR: 'upperLegR', footR: 'lowerLegR',
};
/** canonical bones parents-first, so a single pass accumulates world rotations */
const CANON_ORDER = BONES.filter((b) => b === 'hips' || CANON_PARENT[b]) as BoneName[];

/**
 * Where each canonical bone points at rest. Our rig rests with every rotation
 * at identity, so this is just the offset direction of the bone's child.
 *
 * Bones listed here are pulled onto our rest pose (see `restOf`); the ones left
 * out — hands, feet, head — keep the authored rest, because their authored
 * orientation is already the one the mesh was modelled around and ours carries
 * no better information.
 */
const CANON_DIR: Partial<Record<BoneName, THREE.Vector3>> = {
  hips: new THREE.Vector3(0, 1, 0), spine: new THREE.Vector3(0, 1, 0),
  chest: new THREE.Vector3(0, 1, 0), neck: new THREE.Vector3(0, 1, 0),
  shoulderL: new THREE.Vector3(-1, 0, 0), shoulderR: new THREE.Vector3(1, 0, 0),
  upperArmL: new THREE.Vector3(0, -1, 0), upperArmR: new THREE.Vector3(0, -1, 0),
  forearmL: new THREE.Vector3(0, -1, 0), forearmR: new THREE.Vector3(0, -1, 0),
  upperLegL: new THREE.Vector3(0, -1, 0), upperLegR: new THREE.Vector3(0, -1, 0),
  lowerLegL: new THREE.Vector3(0, -1, 0), lowerLegR: new THREE.Vector3(0, -1, 0),
};

/**
 * Our canonical rig labels its `L` bones on +X. For a character facing +Z that
 * is the *right* side (right = forward x up = -X), so the rig's side labels are
 * anatomically flipped, while the authored Rigify skeletons are not: DEF-*.L
 * really is the model's left. Rather than reverse the map — which would drive
 * each authored arm with a pose authored for the opposite side — the source
 * pose is mirrored through the X=0 plane, which is exactly the conjugation
 * `q -> (x, -y, -z, w)`. Sides then line up and the blaster ends up in the
 * model's right hand.
 */
function mirrorX(q: THREE.Quaternion): THREE.Quaternion {
  return q.set(q.x, -q.y, -q.z, q.w);
}

/**
 * Three's GLTFLoader runs node names through PropertyBinding.sanitizeNodeName,
 * which strips characters reserved by animation property paths — notably the
 * dots in Rigify names, so `DEF-thigh.L` arrives as `DEF-thighL`. Compare
 * names with dots removed so the map works either way.
 */
const norm = (n: string): string => n.replace(/[.\s:[\]]/g, '');

/** one bone of the authored skeleton, flattened parents-first for retargeting */
interface AuthoredNode {
  obj: THREE.Object3D;
  parent: number;              // index into the same array, -1 at the top
  canonical: BoneName | null;  // set when our rig drives this bone
  rest: THREE.Quaternion;      // world rotation to hold when the source is at rest
}

export interface AuthoredModel {
  /** scene root, already scaled and sitting on its feet */
  root: THREE.Object3D;
  /** skeleton flattened parents-first */
  nodes: AuthoredNode[];
  /** hand-space mount whose world transform matches our canonical `weaponR` */
  weaponMount: THREE.Object3D | null;
  /** the same, in the left hand, for a character who carries a pair */
  weaponMountL: THREE.Object3D | null;
  /** hips bone, driven positionally as well as rotationally */
  hips: THREE.Object3D | null;
  /** metres per model unit, for anything measured in world space */
  scale: number;
  /** scratch, reused every frame */
  scratch: { world: THREE.Quaternion[]; src: Map<BoneName, THREE.Quaternion>; tmp: THREE.Quaternion };
}

const cache = new Map<string, Promise<THREE.Group | null>>();
/** ids whose .glb has actually arrived and parsed, for synchronous callers */
const cachedIds = new Set<string>();

/**
 * Is this model already in hand, right now?
 *
 * Most intake is asynchronous and does not care, but a caller that must
 * commit to a look *before* the load can resolve — the troop carrier pass,
 * which flies as a jet blur without a hull model and as a slower flyby with
 * one — needs a synchronous answer about the present, not a promise about
 * the future.
 */
export function authoredCached(id: string): boolean { return cachedIds.has(id); }

function loader(): GLTFLoader {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder); // EXT_meshopt_compression is required by these files
  return l;
}

/** Where a character or creature model lives, and what the tracker calls it. */
export function modelUrl(id: string): string { return `${ASSET_ROOT}models/${id}.glb`; }

/** Load and cache a .glb, resolving null when it isn't present. */
function loadRaw(id: string): Promise<THREE.Group | null> {
  let p = cache.get(id);
  if (!p) {
    const url = modelUrl(id);
    // report to the tracker, so a loading screen can wait on this file and
    // show how much of it has arrived without knowing anything about models
    const handle = tracked.start(url);
    p = new Promise<THREE.Group | null>((resolve) => {
      loader().load(
        url,
        (gltf) => {
          handle.finish(true);
          // Stash the file's own clips on the scene. Characters on our rig are
          // driven by our clips and ignore these, but a creature with a rig of
          // its own (the quadruped massiff) has nothing else to animate it.
          (gltf.scene as THREE.Group).userData.clips = gltf.animations ?? [];
          // every instance is a clone sharing these buffers and materials, and
          // the file is cached for the session — teardown must not free them
          markSharedTree(gltf.scene as THREE.Group);
          cachedIds.add(id);
          resolve(gltf.scene as THREE.Group);
        },
        (ev) => handle.progress(ev.loaded, ev.total),
        (err) => {
          handle.finish(false);
          // absent is normal (procedural fallback); anything else is worth saying
          console.warn(`[authored] ${id}.glb failed to load:`, err);
          // Drop the rejection from the cache. Keeping it meant one dropped
          // request downgraded that character to procedural for the rest of
          // the session, with no way back short of a reload.
          cache.delete(id);
          resolve(null);
        },
      );
    });
    cache.set(id, p);
  }
  return p;
}

/**
 * Free cached models the game no longer has a use for.
 *
 * The cache is what makes a model cheap to reuse: one download, one parse, and
 * every instance is a clone sharing its geometries, materials and textures —
 * which is also why `markSharedTree` puts them beyond the reach of a match's
 * teardown. That was right when the cache held a couple of dozen characters
 * that recur in every match. It stopped being right once boards started
 * carrying a dozen environment sculpts apiece: those are wanted on exactly one
 * territory, and nothing ever gave them back. Measured across five boards in a
 * row the renderer's live texture count climbed 28 → 45 → 58 → 61 → 74 and
 * never fell, and a sixth board took the tab down with it.
 *
 * So the cache is emptied of everything outside `keep` whenever a match ends.
 * The clones are gone with the scene by then, so nothing on screen is holding
 * these; the bytes stay in the browser's HTTP cache, which makes coming back
 * to a board a re-parse rather than a re-download.
 */
export function releaseModels(keep: Iterable<string>): number {
  const spare = new Set(keep);
  let freed = 0;
  for (const [id, entry] of [...cache]) {
    if (spare.has(id)) continue;
    cache.delete(id);
    freed++;
    // the entry is a promise: whatever it settles to is what has to be freed,
    // including a load still in flight when the match ended
    void entry.then((root) => { if (root) disposeAuthoredTree(root); }).catch(() => {});
  }
  return freed;
}

/**
 * Dispose one cached .glb's GPU resources, shared flag and all — this is the
 * one place allowed to, because it is the owner giving them up rather than a
 * match tearing down around them.
 */
function disposeAuthoredTree(root: THREE.Group): void {
  const done = new Set<unknown>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const skinned = o as unknown as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton && !done.has(skinned.skeleton)) {
      done.add(skinned.skeleton);
      skinned.skeleton.dispose();
    }
    if (!mesh.isMesh && !skinned.isSkinnedMesh) return;
    if (mesh.geometry && !done.has(mesh.geometry)) {
      done.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      if (done.has(m)) continue;
      done.add(m);
      for (const value of Object.values(m as unknown as Record<string, unknown>)) {
        const tex = value as THREE.Texture;
        if (tex && tex.isTexture && !done.has(tex)) { done.add(tex); tex.dispose(); }
      }
      m.dispose();
    }
  });
}

/**
 * Queue a model to be fetched *and parsed* when there is time for it.
 *
 * Everything that wants a model ahead of time comes through here, urgency and
 * all: the queue keeps a couple in flight at a time and, below `now`, waits for
 * the browser to be idle first. That cap is the point — a screen that flicked
 * through a roster used to open a download per character and leave the one on
 * screen queued behind them.
 */
export function warmAuthored(id: string, priority: WarmPriority = 'idle'): void {
  warmQueue.want(modelUrl(id), priority, () => loadRaw(id));
}

/**
 * .glb backing each enemy kind, so a wave's models can be warmed before it
 * lands. Loading on first spawn meant a 3-4 MB parse on the main thread at the
 * worst possible moment — the frame a new enemy type joins the fight.
 */
export const ENEMY_MODEL_ID: Record<string, string> = {
  tusken: 'tusken', pyke: 'pyke', pirate: 'pirate', pirateMelee: 'pirate_melee',
  jetpirate: 'pirate', droid: 'droid', nikto: 'nikto', massiff: 'massiff',
  stormtrooper: 'stormtrooper', deathtrooper: 'deathtrooper', darktrooper: 'darktrooper',
  duelist: 'duelist', officer: 'imperial_officer', capo: 'pyke_capo',
  enforcer: 'wookiee_enforcer', marshal: 'marshal', fennec: 'fennec', ig11: 'ig11',
  flametrooper: 'flametrooper', quarren: 'quarren', alamite: 'alamite',
  ringEnforcer: 'ring_enforcer',
  // the three creatures come through loadCreature, but the file is the same
  // download, so warming it here is what stops a first-spawn hitch
  krykna: 'krykna', broodmother: 'krykna_brood', drone: 'interceptor_drone',
  // the monster bosses, same path
  mudhorn: 'mudhorn', ravinak: 'ravinak', mamacore: 'mamacore', rancor: 'rancor',
  kraytDragon: 'krayt_dragon', mythosaur: 'mythosaur',
};

/**
 * Widen a skinned mesh's bounding sphere so animation cannot take it outside
 * its own bounds, and leave frustum culling on. A rest-pose sphere is measured
 * with the arms down; a flight pose, a swing or a ragdoll all reach further.
 */
function padBounds(mesh: THREE.SkinnedMesh): void {
  const geo = mesh.geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  // every clone of a model shares this geometry, so pad it exactly once —
  // widening per instance would compound to a sphere that culls nothing
  if (geo.boundingSphere && !geo.userData.boundsPadded) {
    geo.userData.boundsPadded = true;
    geo.boundingSphere.radius *= 2.2;
  }
  mesh.frustumCulled = true;
}

/**
 * Re-parent `child` under `parent` without moving it in the world. The skin's
 * bind matrices were captured from the original world rest pose, so that pose
 * has to survive the surgery exactly.
 */
function reparentKeepingWorld(child: THREE.Object3D, parent: THREE.Object3D): void {
  child.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  const world = child.matrixWorld.clone();
  parent.add(child);
  const local = new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(world);
  local.decompose(child.position, child.quaternion, child.scale);
}

/**
 * Prepare an authored model for a character: clone it, rebuild the hierarchy,
 * normalise scale so it stands on the ground at `targetHeight`, and flatten the
 * skeleton for retargeting. Resolves null when the model file isn't there.
 */
export async function loadAuthored(id: string, targetHeight: number): Promise<AuthoredModel | null> {
  const raw = await loadRaw(id);
  if (!raw) return null;

  // SkeletonUtils-free clone: these models are one skinned mesh, and cloning
  // the scene graph plus rebinding the skeleton is enough for our use.
  const root = raw.clone(true);

  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if (o.name) byName.set(norm(o.name), o); });
  const find = (n: string) => byName.get(norm(n));

  // rebind skinned meshes onto the cloned bones
  root.traverse((o) => {
    const skinned = o as THREE.SkinnedMesh;
    if (!skinned.isSkinnedMesh) return;
    const bones = skinned.skeleton.bones.map((b) => (byName.get(norm(b.name)) as THREE.Bone) ?? b);
    skinned.bind(new THREE.Skeleton(bones, skinned.skeleton.boneInverses), skinned.bindMatrix);
    // The bind pose's bounds understate an animated one, but switching culling
    // off entirely meant no authored character was ever culled — every enemy on
    // the board skinned and drew in the main and shadow passes even when it was
    // behind the camera. Pad the sphere instead and keep the cull.
    padBounds(skinned);
    skinned.castShadow = true;
    skinned.receiveShadow = true;
  });

  // 1. flat rig -> canonical hierarchy
  for (const [childName, parentName] of REPARENT) {
    const child = find(childName);
    const parent = find(parentName);
    if (child && parent && child.parent !== parent) reparentKeepingWorld(child, parent);
  }

  // 2. stand it on the ground at the right size. Box3.setFromObject reads the
  //    skinned bounding box, which these files leave empty, so union the
  //    geometry boxes by hand.
  root.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
  });
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 1e-4)) throw new Error(`could not measure ${id}.glb bounds`);
  const scale = targetHeight / size.y;
  const wrapper = new THREE.Group();
  root.scale.setScalar(scale);
  root.position.y = -box.min.y * scale;
  wrapper.add(root);
  root.updateWorldMatrix(true, true);

  // 3. flatten the skeleton, parents first, with each bone's rest pose
  const canonicalOf = new Map<THREE.Object3D, BoneName>();
  for (const [canonical, authored] of Object.entries(BONE_MAP)) {
    const bone = find(authored);
    if (bone) canonicalOf.set(bone, canonical as BoneName);
  }
  const nodes: AuthoredNode[] = [];
  const index = new Map<THREE.Object3D, number>();
  const collect = (obj: THREE.Object3D, parent: number): void => {
    let self = parent;
    if ((obj as THREE.Bone).isBone) {
      self = nodes.length;
      index.set(obj, self);
      nodes.push({
        obj,
        parent,
        canonical: canonicalOf.get(obj) ?? null,
        rest: obj.getWorldQuaternion(new THREE.Quaternion()),
      });
    }
    for (const child of obj.children) collect(child, self);
  };
  collect(root, -1);

  // Pull the mapped bones onto our rest pose, so a clip that means "arms down"
  // reads the same on a model authored in an A-pose. Only the bone direction is
  // corrected; the twist around it stays as authored.
  const bone = new THREE.Vector3();
  for (const node of nodes) {
    const want = node.canonical && CANON_DIR[node.canonical];
    if (!want) continue;
    bone.set(0, 1, 0).applyQuaternion(node.rest);  // Blender bones run along local +Y
    const target = want.clone().setX(-want.x);     // ...into the mirrored source frame
    node.rest.premultiply(new THREE.Quaternion().setFromUnitVectors(bone, target));
  }

  // 4. a weapon mount inside each hand that reproduces our canonical `weaponR`
  //    / `weaponL` frame: undo the hand's rest rotation and the model's scale,
  //    so a weapon arrives at the size and orientation the procedural rig gave
  //    it. Both hands get one — a gunslinger carries a pistol in each, and an
  //    off-hand left on our own bone would hang beside the authored body
  //    rather than in its hand.
  const handMount = (canonical: BoneName, name: string): THREE.Object3D | null => {
    const hand = nodes.find((n) => n.canonical === canonical);
    if (!hand) return null;
    const handScale = new THREE.Vector3().setFromMatrixScale(hand.obj.matrixWorld).x || 1;
    const mount = new THREE.Group();
    mount.name = name;
    mount.quaternion.copy(hand.rest).invert();
    mount.scale.setScalar(1 / handScale);
    mount.position.set(0, -0.05, 0.02).applyQuaternion(mount.quaternion).divideScalar(handScale);
    hand.obj.add(mount);
    return mount;
  };
  const weaponMount = handMount('handR', 'weaponMount');
  const weaponMountL = handMount('handL', 'weaponMountL');

  return {
    root: wrapper,
    nodes,
    weaponMount,
    weaponMountL,
    hips: nodes.find((n) => n.canonical === 'hips')?.obj ?? null,
    scale,
    scratch: {
      world: nodes.map(() => new THREE.Quaternion()),
      src: new Map(CANON_ORDER.map((b) => [b, new THREE.Quaternion()])),
      tmp: new THREE.Quaternion(),
    },
  };
}

/**
 * Copy one frame of the procedural rig's pose onto an authored rig.
 *
 * Our clips are authored against an all-identity rest pose, so a bone's
 * accumulated local rotations *are* its world rotation — a ready-made
 * world-space delta. Each authored bone then wants
 * `world = delta * restWorld`, converted back to a local rotation against
 * whatever its own parent ended up at. Doing it in world space is what lets
 * the two skeletons disagree about hierarchy (our shoulders parent the arms;
 * theirs hang both off the spine) and about rest pose.
 */
export function retarget(source: Rig, model: AuthoredModel): void {
  const { world, src, tmp } = model.scratch;

  // accumulate the source pose, parents first, and mirror it into model space
  for (const name of CANON_ORDER) {
    const q = src.get(name)!;
    const bone = source.bones[name];
    const parent = CANON_PARENT[name];
    if (parent) q.copy(src.get(parent)!); else q.identity();
    if (bone) q.multiply(bone.quaternion);
  }
  for (const q of src.values()) mirrorX(q);

  for (let i = 0; i < model.nodes.length; i++) {
    const node = model.nodes[i];
    const parent = node.parent >= 0 ? world[node.parent] : null;
    const delta = node.canonical ? src.get(node.canonical) : null;
    if (delta) {
      world[i].copy(delta).multiply(node.rest);
      node.obj.quaternion.copy(parent ? tmp.copy(parent).invert().multiply(world[i]) : world[i]);
    } else {
      // unmapped bone (twist segments, toes, spine fillers): hold its rest local
      world[i].copy(parent ?? tmp.identity()).multiply(node.obj.quaternion);
    }
  }

  // the hips also carry the clips' vertical bob — in metres, so back into
  // model units before it lands on a bone
  const srcHips = source.bones.hips;
  const dstHips = model.hips;
  if (srcHips && dstHips) {
    dstHips.position.y = (dstHips.userData.restY ??= dstHips.position.y)
      + (srcHips.position.y - source.proportions.hipHeight) / model.scale;
  }
}

/**
 * Wire an authored model onto a procedural build.
 *
 * This is the whole swap in one call: hide the procedural skin, hang the
 * authored one off the same rig, and hand back an `update` to run each frame.
 * Everything a character adds on top of its body — weapons, thruster flames,
 * a shield pane — is passed in `keep` and rides through untouched.
 *
 * The model arrives asynchronously and may never arrive at all, in which case
 * nothing happens and the procedural build simply stands: that is the contract
 * the whole asset pipeline runs on.
 */
/**
 * Load a model that nothing drives: a weapon, a vehicle, a creature on a rig
 * of its own. It is scaled to `targetLength` along its longest axis (or
 * `axis`, when the fit should be by height instead) and centred on its origin
 * the way the procedural prop it replaces was, then handed back for the caller
 * to park wherever the procedural one sat.
 *
 * This is the other half of the intake. `attachAuthored` is for characters
 * built on the canonical skeleton, where our clips drive the model; this is
 * for everything else, including rigs we cannot drive — the massiff is a
 * quadruped, four legs on a 44-bone skeleton, so no humanoid clip has anything
 * to say to it.
 */
/**
 * Gaits written in code for models that arrive without any, keyed by model id.
 * They are built per load, because they compose with the rest pose of the
 * skeleton they are handed.
 */
const GENERATED_CLIPS: Record<string, (root: THREE.Object3D) => THREE.AnimationClip[]> = {
  massiff: massiffClips,
  krykna: kryknaClips,
  krykna_brood: kryknaClips,
  interceptor_drone: droneClips,
  // the monster bosses: their sculpts ship the rig and no clips
  mudhorn: mudhornClips,
  ravinak: ravinakClips,
  mamacore: mamacoreClips,
  rancor: rancorClips,
  krayt_dragon: kraytClips,
  mythosaur: mythosaurClips,
};

export function loadProp(
  id: string,
  targetSize: number,
  opts: {
    axis?: 'x' | 'y' | 'z' | 'longest';
    /** sit the model on y = 0 instead of on its own origin — creatures want this */
    ground?: boolean;
    onLoad?: (root: THREE.Object3D) => void;
  } = {},
): THREE.Group {
  const holder = new THREE.Group();
  loadRaw(id).then((raw) => {
    if (!raw) return;
    const root = raw.clone(true);
    root.updateMatrixWorld(true);
    // A prop is usually static, but a creature model can be skinned (the
    // massiff is): a plain clone leaves its skinned meshes bound to the
    // original's bones, so anything that animates the clone moves nothing.
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => { if (o.name) byName.set(norm(o.name), o); });
    root.traverse((o) => {
      const skinned = o as THREE.SkinnedMesh;
      if (!skinned.isSkinnedMesh) return;
      const bones = skinned.skeleton.bones.map((b) => (byName.get(norm(b.name)) as THREE.Bone) ?? b);
      skinned.bind(new THREE.Skeleton(bones, skinned.skeleton.boneInverses), skinned.bindMatrix);
      padBounds(skinned);
    });
    const box = new THREE.Box3();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const axis = opts.axis ?? 'longest';
    const measured = axis === 'longest' ? Math.max(size.x, size.y, size.z) : size[axis];
    if (!(measured > 1e-4)) return;
    const scale = targetSize / measured;
    root.scale.setScalar(scale);
    // a sculpt's origin is wherever the artist left it, which for a standing
    // creature is usually its middle — put its feet on the floor
    if (opts.ground) root.position.y = -box.min.y * scale;
    // Clips the file ships always win; a model with none falls back to a set
    // authored in code against its own skeleton. That way a later re-export
    // with real animation baked in simply takes over.
    //
    // Built *after* the fit scale is on, because the code-authored gaits
    // measure the rig they are handed: a bob asked for in metres is written
    // into a bone's local units, and against the unscaled model that came out
    // multiplied by the fit scale — on the massiff a 9 cm ride turned into 40
    // cm of bounce, which is what its gallop was jittering with.
    root.updateMatrixWorld(true);
    const own = (raw.userData.clips ?? []) as THREE.AnimationClip[];
    root.userData.clips = own.length ? own : (GENERATED_CLIPS[id]?.(root) ?? []);
    holder.add(root);
    opts.onLoad?.(root);
  }).catch((err) => console.warn(`[authored] prop ${id} failed:`, err));
  return holder;
}

/**
 * Creatures that arrive on a skeleton of their own rather than the canonical
 * humanoid one, keyed to the height they should stand.
 *
 * The massiff is the case in point: a quadruped on a 44-bone rig with four
 * legs and a tail, so nothing in `BONE_MAP` reaches it and none of our clips
 * mean anything to it. Until it has a gait of its own it comes in through
 * `loadCreature`, which is the prop path — the model is placed and scaled and
 * the enemy's own movement carries it, exactly as the swoop bike works.
 * `massiff_static` is the unrigged variant of the same sculpt, and the cheaper
 * choice while nothing is deforming it.
 */
export const CREATURE_MODELS = {
  // ---- monster bosses (docs/BOSSES.md) ----
  // Heights, not lengths: `loadCreature` fits the sculpt by its Y extent and
  // stands it on the ground. The doc specifies each animal by its most
  // legible dimension (a mudhorn by the shoulder, a ravinak by its length),
  // so these are those figures converted through the sculpts' own
  // proportions — see `tools/test-monsters.mjs`, which holds the delivered
  // models to the sizes the design asked for.
  mudhorn: 3.0,
  ravinak: 2.3,
  mamacore: 3.8,
  rancor: 5.0,
  // The two colossi are sized by what *surfaces*, since the rest is buried:
  // these heights are the whole sculpt, and the builder sinks and pitches it
  // so the front is what stands above the ground (docs/BOSSES.md §2.5, §2.6).
  krayt_dragon: 5.4,
  mythosaur: 8.0,

  // the war massiff is an elite beast, not the knee-high hound the sculpt was
  // scaled for — see the size note in ASSETS_MODELS.md
  massiff: 2.05,
  // heights match each kind's DEFS entry, which is what the hit spheres and the
  // camera framing use
  krykna: 1.6,
  krykna_brood: 2.6,
  interceptor_drone: 1.7,
} as const;

export type CreatureId = keyof typeof CREATURE_MODELS;

/**
 * Load a creature model at its registered height. A missing file is normal —
 * the procedural build stands — but an *unregistered* id is a mistake worth
 * catching: `loadProp` would divide by an undefined target size, scale the
 * model by NaN and render nothing, and it would only show up on the day the
 * artwork landed.
 */
export function loadCreature(
  id: CreatureId,
  opts: { onLoad?: (root: THREE.Object3D) => void } = {},
): THREE.Group {
  const height = CREATURE_MODELS[id];
  if (!height) {
    console.warn(`[authored] creature "${id}" has no registered height; add it to CREATURE_MODELS`);
    return new THREE.Group();
  }
  return loadProp(id, height, { axis: 'y', ground: true, onLoad: opts.onLoad });
}

export interface AuthoredSwap {
  /** copy this frame's pose across; a no-op until the model lands */
  update: () => void;
  /** the loaded model, once it is there */
  readonly model: AuthoredModel | null;
  /**
   * True once the question is answered either way: the authored skin is on, or
   * there is no file and the procedural build is the final look. The character
   * select waits on this rather than on `model`, so a character without an
   * authored .glb yet is still presentable.
   */
  readonly settled: boolean;
}

export function attachAuthored(
  rig: Rig,
  id: string,
  targetHeight: number,
  opts: { keep?: THREE.Object3D[]; onLoad?: (model: AuthoredModel) => void; enabled?: boolean } = {},
): AuthoredSwap {
  const keep = opts.keep ?? [];
  const procedural: THREE.Object3D[] = [];
  rig.root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    for (let a: THREE.Object3D | null = o; a; a = a.parent) if (keep.includes(a)) return;
    procedural.push(o);
  });

  const swap: { model: AuthoredModel | null; settled: boolean } = { model: null, settled: opts.enabled === false };
  if (opts.enabled !== false) {
    loadAuthored(id, targetHeight)
      .catch((err) => { console.warn(`[authored] ${id} preparation failed:`, err); return null; })
      .then((model) => {
        swap.settled = true;
        if (!model) return;
        swap.model = model;
        for (const m of procedural) m.visible = false;
        rig.root.add(model.root);
        opts.onLoad?.(model);
      });
  }

  return {
    get model() { return swap.model; },
    get settled() { return swap.settled; },
    update: () => { if (swap.model) retarget(rig, swap.model); },
  };
}
