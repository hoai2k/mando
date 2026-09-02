import * as THREE from 'three';
import { ASSET_ROOT } from '../core/assets';

/**
 * Bones added to a delivered sculpt at load time.
 *
 * Every monster boss can open its mouth, because each of those sculpts shipped
 * a skinned `jaw` joint its brief asked for and the gait code gapes it on each
 * bite. The massiff is older than that rule: it arrived on a 44-bone Rigify
 * chain with no jaw at all, so the beast that pounces at your face bites with
 * its mouth welded shut.
 *
 * Fixing that does not need a new sculpt, only a new bone — so this adds one,
 * the same way `skinfix.ts` re-weights a leaking skirt panel: on the loaded
 * geometry, leaving the file on disk exactly as delivered. `tools/jaw-rig.mjs`
 * picks the lower-jaw vertices offline and writes them to
 * `public/models/jawrig/<id>.json`; this applies that document.
 *
 * The work is done on the *source* scene, before it is cached and cloned, so
 * every clone inherits the bone and every one of them can open its mouth.
 * Once the bone exists nothing else has to know: the clips in `anim/quadruped.ts`
 * look their bones up by name and drive whatever they find.
 */

export interface JawRigDoc {
  format: string;
  model: string;
  bone: { name: string; parent: string; translation: [number, number, number] };
  mirror: { name: string; translation: [number, number, number] } | null;
  mesh: { vertexCount: number };
  /** [vertex index, weight] pairs */
  vertices: [number, number][];
}

/**
 * Bone names lose their dots on the way in (the loader flattens them, so
 * `DEF-spine.010` arrives as `DEF-spine010`), and a rig file naturally writes
 * the name the sculpt was authored with. Compare both the same way or the
 * parent lookup silently misses and the mouth stays shut.
 */
const norm = (n: string): string => n.replace(/[.\s:[\]]/g, '');

let indexPromise: Promise<Set<string>> | null = null;

/** Which models have a jaw rig at all, so the rest cost no request. */
function riggedModels(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = fetch(`${ASSET_ROOT}models/jawrig/index.json`)
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((doc: { models?: string[] }) => new Set(doc.models ?? []))
      .catch(() => new Set<string>());
  }
  return indexPromise;
}

const docs = new Map<string, Promise<JawRigDoc | null>>();

/** The jaw rig for a model, or null when it has none. Cached for the session. */
export function loadJawRig(id: string): Promise<JawRigDoc | null> {
  let p = docs.get(id);
  if (!p) {
    p = riggedModels().then((set) => {
      if (!set.has(id)) return null;
      return fetch(`${ASSET_ROOT}models/jawrig/${id}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<JawRigDoc>) : null))
        .catch((err) => { console.warn(`[jawrig] ${id}: could not load`, err); return null; });
    });
    docs.set(id, p);
  }
  return p;
}

/** the skinned mesh the document is describing */
function targetOf(root: THREE.Object3D, doc: JawRigDoc): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (found || !m.isSkinnedMesh || !m.geometry.attributes.skinIndex) return;
    if (m.geometry.attributes.skinIndex.count === doc.mesh.vertexCount) found = m;
  });
  return found;
}

/**
 * Hang a new bone off `parent` and give the skeleton room for it.
 *
 * The subtle part is the inverse bind matrix. It is tempting to read the
 * bone's world matrix and invert it, but that is only right if the pose the
 * file's nodes are in *is* the pose it was skinned in — and on these exports it
 * is not. The bind pose lives only in the skin's inverse bind matrices, so this
 * derives the new bone's from its parent's: undo the parent's inverse to get
 * the parent's bind-pose world, walk down the new bone's own offset, and invert
 * that. Only the file's own data is used, so it holds whatever pose the nodes
 * happen to be sitting in.
 *
 * Getting it wrong does not fail loudly. It flings every weighted vertex off
 * to the horizon the first time the bone turns.
 */
function addBone(mesh: THREE.SkinnedMesh, parent: THREE.Bone, parentIndex: number,
  name: string, translation: [number, number, number]): number {
  const skeleton = mesh.skeleton;
  const bone = new THREE.Bone();
  bone.name = name;
  bone.position.fromArray(translation);
  parent.add(bone);
  bone.updateMatrix();
  const parentBind = new THREE.Matrix4().copy(skeleton.boneInverses[parentIndex]).invert();
  const bind = parentBind.multiply(bone.matrix);
  skeleton.bones.push(bone);
  skeleton.boneInverses.push(bind.invert());
  // The skeleton's bone-matrix buffer is sized at construction, so it has to be
  // rebuilt rather than pushed to; rebinding keeps the mesh's own bind matrix.
  mesh.bind(new THREE.Skeleton(skeleton.bones, skeleton.boneInverses), mesh.bindMatrix);
  return mesh.skeleton.bones.length - 1;
}

/**
 * Move `weight` of a vertex onto joint `joint`, taking it proportionally from
 * whatever held it. The four influence slots are full on a Rigify export, so
 * the smallest one is the one that gets spent — after the scaling it is the
 * least of what was there.
 */
function weighVertex(idx: THREE.BufferAttribute, w: THREE.BufferAttribute,
  v: number, joint: number, weight: number): void {
  const n = idx.itemSize;
  let smallest = 0;
  let smallestW = Infinity;
  for (let k = 0; k < n; k++) {
    const scaled = w.getComponent(v, k) * (1 - weight);
    w.setComponent(v, k, scaled);
    if (scaled < smallestW) { smallestW = scaled; smallest = k; }
  }
  idx.setComponent(v, smallest, joint);
  w.setComponent(v, smallest, weight + smallestW);
}

/**
 * Apply a jaw rig to a freshly loaded model. Idempotent: a scene that already
 * carries the bone is left alone, which is what makes it safe to call on a
 * cached tree.
 */
export function applyJawRig(root: THREE.Object3D, doc: JawRigDoc): void {
  root.updateMatrixWorld(true);
  const mesh = targetOf(root, doc);
  if (!mesh) {
    console.warn(`[jawrig] ${doc.model}: no skinned mesh with ${doc.mesh.vertexCount} vertices`);
    return;
  }
  if (mesh.skeleton.bones.some((b) => norm(b.name) === norm(doc.bone.name))) return;   // already rigged
  const parentIndex = mesh.skeleton.bones.findIndex((b) => norm(b.name) === norm(doc.bone.parent));
  const parent = mesh.skeleton.bones[parentIndex];
  if (!parent) {
    console.warn(`[jawrig] ${doc.model}: no bone named ${doc.bone.parent} to hang the jaw from`);
    return;
  }
  const joint = addBone(mesh, parent, parentIndex, doc.bone.name, doc.bone.translation);
  const mirror = doc.mirror
    ? addBone(mesh, parent, parentIndex, doc.mirror.name, doc.mirror.translation) : -1;

  const geo = mesh.geometry;
  const idx = geo.attributes.skinIndex as THREE.BufferAttribute;
  const w = geo.attributes.skinWeight as THREE.BufferAttribute;
  for (const [v, weight] of doc.vertices) {
    if (v >= idx.count) continue;
    // a mirrored pair (a spider's fangs) splits on the model's centre line
    const side = mirror >= 0 && geo.attributes.position.getX(v) < 0 ? mirror : joint;
    weighVertex(idx, w, v, side, weight);
  }
  idx.needsUpdate = true;
  w.needsUpdate = true;
  // `skinfix` restores this snapshot whenever its fixes are toggled (the
  // workbench does), so the jaw has to be part of the baseline rather than a
  // change layered over it — otherwise reviewing a skin fix welds the mouth
  // shut again.
  const snapshot = geo.userData.skinOriginal as { index: THREE.TypedArray; weight: THREE.TypedArray } | undefined;
  if (snapshot) {
    snapshot.index.set(idx.array as THREE.TypedArray);
    snapshot.weight.set(w.array as THREE.TypedArray);
  }
}
