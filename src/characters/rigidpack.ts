import * as THREE from 'three';

/**
 * Din's authored pack is welded into the body's single skinned primitive.
 * The two tanks and centre plate are still identifiable in bind space: they
 * form the raised, central patch behind the upper back. Automatic weights gave
 * that patch shoulder and arm influences, so aiming bends the metal shell.
 *
 * These bounds were checked against the actual din.glb vertex mask in the
 * model workbench. The vertex-count guard leaves a replacement sculpt alone
 * until its geometry can be inspected again.
 */
export function rigidifyDinJetpack(root: THREE.Object3D): number {
  let changed = 0;
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || mesh.geometry.attributes.position?.count !== 69089) return;
    const chest = mesh.skeleton.bones.findIndex((b) => b.name.replace(/[.\s:[\]]/g, '') === 'DEF-spine003');
    if (chest < 0) return;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const index = mesh.geometry.attributes.skinIndex as THREE.BufferAttribute;
    const weight = mesh.geometry.attributes.skinWeight as THREE.BufferAttribute;
    if (!index || !weight || index.count !== pos.count || weight.count !== pos.count) return;
    const selected: number[] = [];
    const p = new THREE.Vector3();
    // The mesh's local transform is the original glTF quantization transform.
    // Its parents are rescaled for the game and the workbench, but this frame
    // remains stable in both places.
    mesh.updateMatrix();
    for (let i = 0; i < pos.count; i++) {
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrix);
      if (Math.abs(p.x) >= 0.0703 || p.y <= 0.116 || p.y >= 0.322 || p.z >= -0.03) continue;
      selected.push(i);
    }
    // din.glb has 5,358 vertices in this patch. A substantially different
    // count means the geometry changed and this spatial mask needs re-audit.
    if (selected.length < 5200 || selected.length > 5500) return;
    for (const i of selected) {
      for (let k = 0; k < index.itemSize; k++) {
        index.setComponent(i, k, k === 0 ? chest : 0);
        weight.setComponent(i, k, k === 0 ? 1 : 0);
      }
    }
    index.needsUpdate = true;
    weight.needsUpdate = true;
    changed += selected.length;
  });
  return changed;
}
