import * as THREE from 'three';
import { ASSET_ROOT } from '../core/assets';

/**
 * Stray geometry in the delivered sculpts.
 *
 * Playtest: *"the (detached) floating sphere thing just behind one of Din
 * Djarin's shoulders — that is a 3D model error."* It is. `din.glb` carries a
 * 1,290-triangle ball welded to nothing, inside the same skinned mesh as the
 * body, so it rides his shoulder wherever he goes and nothing in the game can
 * tell it from armour.
 *
 * `tools/audit-strays.mjs` finds them — a sculpt is one connected surface, and
 * a piece sharing no edge with the surface the rest of the model is on, and
 * tiny beside it, belongs to nobody — and writes one fix file per model to
 * `public/models/strays/<id>.json`. This drops what they name from the loaded
 * geometry, so the files on disk stay exactly as delivered, which is the same
 * contract `skinfix.ts` keeps and for the same reason: these models are
 * generated, and a redelivery should cost a re-run of the tool rather than a
 * re-do of an edit somebody made by hand.
 *
 * A fix names triangles rather than vertices, as runs over the primitive's own
 * index order. Dropping a triangle is one pass over the index; the vertices it
 * used are left in the buffers, unreferenced and undrawn, which costs a little
 * memory and saves rewriting every other attribute in the file.
 */

export interface Stray {
  /** which glTF mesh and primitive this piece is in */
  mesh: number;
  primitive: number;
  triangles: number;
  vertices: number;
  shareOfModel: number;
  sizeM: [number, number, number];
  centreM: [number, number, number];
  /** [first, last] triangle numbers, inclusive, over the primitive's index order */
  runs: [number, number][];
}

export interface StrayDoc {
  format: string;
  model: string;
  note?: string;
  strays: Stray[];
}

let indexPromise: Promise<Set<string>> | null = null;

/** Which models have a fix file at all, so the rest cost no request. */
function fixedModels(): Promise<Set<string>> {
  if (!indexPromise) {
    indexPromise = fetch(`${ASSET_ROOT}models/strays/index.json`)
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((doc: { models?: string[] }) => new Set(doc.models ?? []))
      .catch(() => new Set<string>());
  }
  return indexPromise;
}

const docs = new Map<string, Promise<StrayDoc | null>>();

/** The stray fixes for a model, or null when it has none. Cached for the session. */
export function loadStrays(id: string): Promise<StrayDoc | null> {
  let p = docs.get(id);
  if (!p) {
    p = fixedModels().then((set) => {
      if (!set.has(id)) return null;
      return fetch(`${ASSET_ROOT}models/strays/${id}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<StrayDoc>) : null))
        .catch((err) => { console.warn(`[strays] ${id}: could not load fixes`, err); return null; });
    });
    docs.set(id, p);
  }
  return p;
}

/** the mesh a fix names — by glTF mesh/primitive, else the only indexed one */
function targetOf(root: THREE.Object3D, stray: Stray): THREE.Mesh | null {
  let exact: THREE.Mesh | null = null;
  let only: THREE.Mesh | null = null;
  let count = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry?.index) return;
    count++;
    only ??= m;
    const g = m.userData.gltf as { mesh: number; primitive: number } | undefined;
    if (g && g.mesh === stray.mesh && g.primitive === stray.primitive) exact = m;
  });
  return exact ?? (count === 1 ? only : null);
}

/**
 * Drop the geometry a model's fix file names.
 *
 * Runs once on the file's own geometry, which every clone of the model then
 * shares — the same place and the same rule as the skin-weight fixes. Applying
 * it twice would cut the wrong triangles the second time (the numbering is the
 * index order, and the first pass changed it), so a geometry that has been
 * through this is marked and skipped.
 */
export function applyStrays(root: THREE.Object3D, doc: StrayDoc): void {
  for (const stray of doc.strays ?? []) {
    const mesh = targetOf(root, stray);
    if (!mesh) {
      console.warn(`[strays] ${doc.model}: no mesh ${stray.mesh}/${stray.primitive} to fix`);
      continue;
    }
    const geo = mesh.geometry;
    const index = geo.index;
    if (!index) continue;
    if (geo.userData.straysDropped) continue;
    const src = index.array as ArrayLike<number>;
    const tris = src.length / 3;
    // a lookup of the triangles to lose, so the copy below is one pass
    const drop = new Uint8Array(tris);
    let dropped = 0;
    for (const [from, to] of stray.runs) {
      for (let t = Math.max(0, from); t <= Math.min(tris - 1, to); t++) {
        if (!drop[t]) { drop[t] = 1; dropped++; }
      }
    }
    if (!dropped) continue;
    const keep = tris - dropped;
    // the same width as what came in: a model with more than 65,535 vertices
    // indexes in 32 bits, and narrowing it here would fold its far side onto
    // its near one
    const out = (src as Uint16Array | Uint32Array).constructor === Uint16Array
      ? new Uint16Array(keep * 3) : new Uint32Array(keep * 3);
    let at = 0;
    for (let t = 0; t < tris; t++) {
      if (drop[t]) continue;
      out[at++] = src[t * 3];
      out[at++] = src[t * 3 + 1];
      out[at++] = src[t * 3 + 2];
    }
    geo.setIndex(new THREE.BufferAttribute(out, 1));
    geo.userData.straysDropped = true;
    // the bounds were measured with the stray in them, and a lump off the
    // shoulder is exactly the kind of thing that stretches a bounding sphere
    // and with it every frustum and raycast test against this model
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }
}
