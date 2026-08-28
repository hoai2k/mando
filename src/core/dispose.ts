import * as THREE from 'three';

/**
 * GPU resource teardown.
 *
 * Three.js frees buffers and textures only on an explicit `dispose()` — losing
 * the last reference to a mesh does nothing. A match builds a lot of them (the
 * terrain, every prop, every procedural character, the skies, the reflection
 * probe), so without a teardown pass each restart left the whole previous board
 * resident for the life of the tab.
 *
 * The complication is that not everything under a scene belongs to that scene.
 * Three kinds of resource are shared and outlive any one match:
 *
 *   - the material cache in `characters/builder.ts`, handed to every character;
 *   - the canvas/authored texture cache in `core/assets.ts`;
 *   - loaded .glb scenes, which are cached per id and cloned per instance —
 *     a clone shares its original's geometries, materials and textures.
 *
 * Those are tagged with `markShared` where they are created, and skipped here.
 * Everything else is the match's own and goes.
 */

/** Flag a resource as outliving any single match, so teardown leaves it alone. */
export function markShared<T extends { userData: Record<string, unknown> }>(res: T): T {
  res.userData.shared = true;
  return res;
}

/** Flag every geometry, material and texture under `root` as shared. */
export function markSharedTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (mesh.geometry) markShared(mesh.geometry);
    for (const m of materialsOf(mesh)) {
      markShared(m);
      for (const t of texturesOf(m)) markShared(t);
    }
  });
}

/** Undo `markShared` on a per-instance copy (material clones inherit userData). */
export function markOwned<T extends { userData: Record<string, unknown> }>(res: T): T {
  res.userData.shared = false;
  return res;
}

function isShared(res: { userData?: Record<string, unknown> }): boolean {
  return res.userData?.shared === true;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  if (!mesh.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** Every texture a material holds, whatever slot it sits in. */
function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const value of Object.values(m as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) out.push(value as THREE.Texture);
  }
  return out;
}

/**
 * Dispose every unshared geometry, material and texture under `root`, then
 * detach its children. Safe to call twice: three's dispose() is idempotent.
 */
export function disposeSubtree(root: THREE.Object3D): void {
  // One resource is often worn by many objects — every pooled bolt shares one
  // geometry — so each is disposed once rather than once per wearer.
  const done = new Set<unknown>();
  const once = (res: { dispose: () => void; userData?: Record<string, unknown> }): void => {
    if (isShared(res) || done.has(res)) return;
    done.add(res);
    res.dispose();
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const skinned = o as unknown as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) once(skinned.skeleton);
    if (!mesh.isMesh && !skinned.isSkinnedMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    if (mesh.geometry) once(mesh.geometry);
    for (const m of materialsOf(mesh)) {
      if (isShared(m)) continue;
      for (const t of texturesOf(m)) once(t);
      once(m);
    }
  });
  root.clear();
}
