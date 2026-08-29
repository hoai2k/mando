import * as THREE from 'three';
import { loadProp } from '../characters/authored';

/**
 * Shared prop plumbing for the boards.
 *
 * Environment models arrive as rigless props, and every one of them replaces
 * geometry a board already draws. That swap is the same five lines everywhere —
 * load, place, hide the stand-in — so it lives here once rather than nine times
 * across `world/`.
 *
 * Two rules the boards depend on:
 *
 * 1. **The stand-in stays.** It is hidden, not removed, so a board with no
 *    model file (or a failed download) looks exactly as it did before, and the
 *    collision audit still sees geometry on every collider either way.
 * 2. **Colliders do not move.** The physics of every board was audited against
 *    the procedural build; a model is art dropped into that shape, so it is
 *    scaled and placed to fill the collider rather than the collider being
 *    refitted around it. Where a sculpt's proportions genuinely disagree with
 *    the box (the tram), the board says so at the collider, in a comment.
 */

export interface PropPlacement {
  /** where the model goes in the parent's space; y is its base by default */
  x?: number;
  y?: number;
  z?: number;
  /** heading, radians — the sculpts face +Z, like everything else here */
  yaw?: number;
  /** list, radians: a settled wreck is rarely upright */
  roll?: number;
  /** which dimension `size` measures; sculpts are normalised, so default is fine */
  axis?: 'x' | 'y' | 'z' | 'longest';
  /**
   * Sit the model's lowest point on `y` instead of hanging it from its own
   * origin. On by default — every sculpt in this batch is centred on its
   * bounding box, so its base is the only landmark worth placing against.
   */
  ground?: boolean;
}

/**
 * Swap authored art in for procedural geometry.
 *
 * @param parent  where the model hangs — usually the same node as the stand-in,
 *                so a prop that moves (a trawler on the swell) carries it
 * @param hide    the stand-in meshes, hidden the moment the model lands
 * @param id      the `.glb` under `public/models/`
 * @param size    what the model should measure along `axis`, in metres
 */
export function authoredProp(
  parent: THREE.Object3D,
  hide: THREE.Object3D | THREE.Object3D[],
  id: string,
  size: number,
  place: PropPlacement = {},
): THREE.Group {
  const stand = Array.isArray(hide) ? hide : [hide];
  const holder = loadProp(id, size, {
    axis: place.axis ?? 'longest',
    ground: place.ground ?? true,
    onLoad: () => { for (const m of stand) m.visible = false; },
  });
  holder.position.set(place.x ?? 0, place.y ?? 0, place.z ?? 0);
  holder.rotation.y = place.yaw ?? 0;
  holder.rotation.z = place.roll ?? 0;
  parent.add(holder);
  return holder;
}
