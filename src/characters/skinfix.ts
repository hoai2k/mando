import * as THREE from 'three';
import { ASSET_ROOT } from '../core/assets';

/**
 * Skin-weight fixes for the authored models.
 *
 * The .glb files are Rigify exports skinned with automatic weights, which
 * leak across limb chains wherever two body parts rest near each other: a
 * skirt panel beside a hanging hand takes hand weight and lifts with the arm,
 * a gauntlet against a thigh takes thigh weight and jitters with the stride.
 * `tools/skin-audit.mjs` finds those leaks and writes one fix file per model
 * to `public/models/skinfix/<id>.json`; this module applies them to the
 * loaded geometry, so the models on disk stay exactly as delivered.
 *
 * A fix is a list of vertices and the bones whose weight to take off them.
 * The remaining weights are renormalised; a vertex left with nothing takes
 * the weights of its nearest certain neighbour, listed under `donors`. Fixes
 * compose by being applied in order to the original weights, which is what
 * lets the workbench switch any one of them on and off for review.
 */

export interface SkinFix {
  id: string;
  kind: string;
  title: string;
  confidence: 'high' | 'review';
  status: 'applied' | 'pending' | 'discarded';
  /** the reviewer's call, once made in the workbench and folded back in */
  decision?: 'approve' | 'discard';
  region: string;
  foreign: string;
  stats: {
    vertices: number;
    maxDragCm: number;
    meanDragCm: number;
    meanForeignWeight: number;
    heightBand: [number, number];
    donors: number;
  };
  /** Rigify bone names without the DEF- prefix */
  removeBones: string[];
  mesh: { node: number; mesh: number; primitive: number; vertexCount: number };
  vertices: number[];
  donors: Record<string, { joints: number[]; weights: number[] }>;
}

export interface SkinFixDoc {
  format: string;
  model: string;
  heightM: number;
  fixes: SkinFix[];
}

let indexPromise: Promise<Set<string>> | null = null;

/** Which models have a fix file at all, so the rest cost no request. */
function fixedModels(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = fetch(`${ASSET_ROOT}models/skinfix/index.json`)
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((doc: { models?: string[] }) => new Set(doc.models ?? []))
      .catch(() => new Set<string>());
  }
  return indexPromise;
}

const docs = new Map<string, Promise<SkinFixDoc | null>>();

/** The fix file for a model, or null when it has none. Cached for the session. */
export function loadSkinFix(id: string): Promise<SkinFixDoc | null> {
  let p = docs.get(id);
  if (!p) {
    p = fixedModels().then((set) => {
      if (!set.has(id)) return null;
      return fetch(`${ASSET_ROOT}models/skinfix/${id}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<SkinFixDoc>) : null))
        .catch((err) => { console.warn(`[skinfix] ${id}: could not load fixes`, err); return null; });
    });
    docs.set(id, p);
  }
  return p;
}

const norm = (n: string): string => n.replace(/^DEF-/, '').replace(/[.\s:[\]]/g, '');

interface Original { index: THREE.TypedArray; weight: THREE.TypedArray }

/** the untouched weights, captured the first time a geometry is patched */
function original(geo: THREE.BufferGeometry): Original {
  let o = geo.userData.skinOriginal as Original | undefined;
  if (!o) {
    o = {
      index: (geo.attributes.skinIndex.array as THREE.TypedArray).slice(),
      weight: (geo.attributes.skinWeight.array as THREE.TypedArray).slice(),
    };
    geo.userData.skinOriginal = o;
  }
  return o;
}

/** the skinned mesh a fix names — by glTF mesh/primitive, else by vertex count */
function targetOf(root: THREE.Object3D, fix: SkinFix): THREE.SkinnedMesh | null {
  let byCount: THREE.SkinnedMesh | null = null;
  let exact: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry.attributes.skinIndex) return;
    const g = m.userData.gltf as { mesh: number; primitive: number } | undefined;
    if (g && g.mesh === fix.mesh.mesh && g.primitive === fix.mesh.primitive) exact = m;
    else if (m.geometry.attributes.skinIndex.count === fix.mesh.vertexCount) byCount ??= m;
  });
  return exact ?? byCount;
}

function applyOne(mesh: THREE.SkinnedMesh, fix: SkinFix): void {
  const geo = mesh.geometry;
  const idx = geo.attributes.skinIndex as THREE.BufferAttribute;
  const w = geo.attributes.skinWeight as THREE.BufferAttribute;
  const names = mesh.skeleton.bones.map((b) => norm(b.name));
  const remove = new Set(fix.removeBones.map(norm));
  const n = idx.itemSize;
  for (const i of fix.vertices) {
    if (i >= idx.count) continue;
    const donor = fix.donors[i];
    if (donor) {
      for (let k = 0; k < n; k++) {
        idx.setComponent(i, k, donor.joints[k] ?? 0);
        w.setComponent(i, k, donor.weights[k] ?? 0);
      }
      continue;
    }
    let sum = 0;
    for (let k = 0; k < n; k++) {
      if (remove.has(names[idx.getComponent(i, k)])) w.setComponent(i, k, 0);
      sum += w.getComponent(i, k);
    }
    if (sum > 0) for (let k = 0; k < n; k++) w.setComponent(i, k, w.getComponent(i, k) / sum);
  }
}

/**
 * Put exactly these fixes on the model: the weights go back to the file's
 * own, then each fix is applied in order. Every clone of a model shares its
 * geometry, so this lands on all of them at once — which is right for the
 * game (one model, one set of fixes) and for the workbench (the figure on
 * the turntable is a clone).
 */
export function setSkinFixes(root: THREE.Object3D, fixes: SkinFix[]): void {
  const touched = new Set<THREE.SkinnedMesh>();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry.attributes.skinIndex) return;
    const o0 = original(m.geometry);
    (m.geometry.attributes.skinIndex.array as THREE.TypedArray).set(o0.index);
    (m.geometry.attributes.skinWeight.array as THREE.TypedArray).set(o0.weight);
    touched.add(m);
  });
  for (const fix of fixes) {
    const mesh = targetOf(root, fix);
    if (!mesh) { console.warn(`[skinfix] ${fix.id}: no skinned mesh with ${fix.mesh.vertexCount} vertices`); continue; }
    applyOne(mesh, fix);
  }
  for (const m of touched) {
    m.geometry.attributes.skinIndex.needsUpdate = true;
    m.geometry.attributes.skinWeight.needsUpdate = true;
  }
}

/** The fixes a model wears in the game: every one whose status is `applied`. */
export const activeFixes = (doc: SkinFixDoc | null): SkinFix[] =>
  (doc?.fixes ?? []).filter((f) => f.status === 'applied');
