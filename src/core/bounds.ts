import * as THREE from 'three';

/**
 * How big a built character actually is on screen.
 *
 * Two places need this and neither can ask the stat tables for it. A playable
 * NPC's collider is clamped (`radius ≤ 0.6`, `height ≤ 2.1` in the roster) so
 * that a war beast still fits the doorways and cover the boards were built
 * around — but the *body* is not clamped, and a massiff is four metres of
 * animal behind that 0.6 m capsule. The character select needs the real size to
 * scale a fighter onto its plinth; the chase camera needs it to stay outside
 * the thing it is following.
 */

const _part = new THREE.Box3();

/**
 * World-space bounds of the geometry actually on screen under `root`.
 *
 * `Box3.setFromObject` is no use here: it unions every descendant whether or
 * not it is visible, and a character carries its hidden procedural stand-in
 * under the authored model that replaced it — so it would measure a body
 * unioned with its own ghost. This prunes an invisible subtree instead, and
 * ignores `root`'s own flag, since a caller may be measuring something it keeps
 * hidden for reasons of its own.
 */
export function visibleBounds(root: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  root.updateWorldMatrix(false, true);
  walk(root, out, true);
  return out;
}

function walk(o: THREE.Object3D, out: THREE.Box3, isRoot: boolean): void {
  if (!isRoot && !o.visible) return;
  const geo = (o as THREE.Mesh).geometry;
  if (geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (geo.boundingBox) out.union(_part.copy(geo.boundingBox).applyMatrix4(o.matrixWorld));
  }
  for (const child of o.children) walk(child, out, false);
}

/**
 * A cheap signature of a subtree's shape, for noticing that an authored model
 * has swapped in over a procedural stand-in.
 *
 * Counting nodes is not free, but it is orders cheaper than re-measuring
 * geometry, which is the point: the callers run every frame and only want to
 * pay for the measurement when the thing being measured has actually changed.
 */
export function nodeCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse(() => { n++; });
  return n;
}
