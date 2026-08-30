import * as THREE from 'three';
import { loadProp } from '../characters/authored';
import { fitColliders, type FitOptions } from './collide';
import type { PhysicsWorld } from '../core/physics';

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
 * 2. **The sculpt decides what is solid.** A prop that passes `collide` has its
 *    colliders fitted to the model's own geometry when it lands, and the
 *    stand-in's are dropped (see `collide.ts`). The hand-placed ones are the
 *    fallback, not the truth: they are what a board falls back to when the
 *    model is missing. A prop that leaves `collide` out keeps the old contract
 *    — the model is scaled and placed to fill the collider that is already
 *    there. Something that travels can have both: `onFit` hands the fitted set
 *    to its `Mover`, which carries them the way it carries its own box.
 */

/**
 * Every sculpt id the board currently being built has asked for.
 *
 * The prefetcher keeps its own list of these (`BOARD_PROPS`) so it can warm a
 * territory's art while the player is still choosing a character — it has to,
 * since nothing knows what a board wants until the board is built. A list kept
 * by hand next to code that changes is a list that goes stale silently, so this
 * records the truth and `tools/test-loadperf.mjs` holds the two against each
 * other.
 */
export const propsUsed = new Set<string>();

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
 * @param collide  fit colliders to the sculpt on arrival, replacing the
 *                 stand-in's — see `collide.ts`
 */
export function authoredProp(
  parent: THREE.Object3D,
  hide: THREE.Object3D | THREE.Object3D[],
  id: string,
  size: number,
  place: PropPlacement = {},
  collide?: { physics: PhysicsWorld } & FitOptions,
): THREE.Group {
  propsUsed.add(id);
  const stand = Array.isArray(hide) ? hide : [hide];
  const holder = loadProp(id, size, {
    axis: place.axis ?? 'longest',
    ground: place.ground ?? true,
    onLoad: () => {
      for (const m of stand) m.visible = false;
      // The holder is placed below, after loadProp returns, so the fit has to
      // wait for a world matrix that reflects it — which it does, since the
      // model arrives frames later.
      if (collide) fitColliders(collide.physics, holder, collide);
    },
  });
  // Named for the prop audit (`tools/audit-props.mjs`), which walks a built
  // board looking for sculpts and asks whether the colliders under each one
  // match what it draws.
  holder.userData.prop = id;
  holder.userData.fitted = !!collide;
  holder.position.set(place.x ?? 0, place.y ?? 0, place.z ?? 0);
  holder.rotation.y = place.yaw ?? 0;
  holder.rotation.z = place.roll ?? 0;
  parent.add(holder);
  return holder;
}
