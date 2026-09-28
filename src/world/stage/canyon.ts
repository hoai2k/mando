import * as THREE from 'three';
import { GATE_W } from '../gate';
import { CORNER_LAP, Frame } from './common';
import type { StageBuilder } from './builder';
import type { StageChain } from './zones';

/**
 * A canyon stage's single border, laid once down the whole chain after the
 * zones inside it. Returns where a gorge puts the way on, which the transport
 * door is set against.
 */
export function layCanyon(b: StageBuilder, chain: StageChain) {
  const { stage, canyon, anchor, path, groundAt, ridge } = b;
  const { zones, zoneFrames, last, hasNext } = chain;

  /**
   * The stage's border as one place rather than a row of boxes.
   *
   * Two walls laid along the chain's own axis, wide apart where the run
   * starts and closing as it goes, and a cliff across the far end with the way
   * on cut into it. The taper is weighted late (t²) so the opening is genuinely
   * open — the point of the shape is that you *notice* it closing, which you
   * cannot do if it has been closing since the first step.
   *
   * Everything here is laid in the anchor's frame: a canyon is for a straight
   * chain, which is what the layouts that ask for one are.
   */
  /** how far along the chain's axis the way on stands, when a gorge holds it */
  let gorgeDepth = 0;
  /** half the width of that gorge, so the door's face can fill it wall to wall */
  let gorgeHalf = 0;
  if (canyon && zoneFrames.length) {
    const axis = new Frame(anchor.x, anchor.z, anchor.dx, anchor.dz);
    const lastF = zoneFrames[last];
    // where the last zone's far edge falls along the axis
    const chainEnd = (lastF.ex - anchor.x) * anchor.dx + (lastF.ez - anchor.z) * anchor.dz
      + stage.zones[last].l;
    const halfAt = (u: number): number => {
      const t = Math.min(1, Math.max(0, u / Math.max(1, chainEnd)));
      return canyon.from + (canyon.to - canyon.from) * t * t;
    };
    /** one wall run, in short segments so the taper is a curve and not a corner */
    const wall = (u0: number, u1: number, side: 1 | -1): void => {
      const steps = Math.max(1, Math.ceil((u1 - u0) / 14));
      for (let k = 0; k < steps; k++) {
        const ua = u0 + ((u1 - u0) * k) / steps;
        const ub = u0 + ((u1 - u0) * (k + 1)) / steps;
        const va = side * halfAt(ua), vb = side * halfAt(ub);
        const mid = (ua + ub) / 2;
        ridge([[axis.x(ua, va), axis.z(ua, va)], [axis.x(ub, vb), axis.z(ub, vb)]],
          groundAt(axis.x(mid, 0), axis.z(mid, 0)),
          { inside: { x: axis.x(mid, 0), z: axis.z(mid, 0) } });
      }
    };
    const gorge = hasNext ? canyon.gorge : undefined;
    // the mouth of the gorge sits a little past the last zone, so the cliff is
    // something you walk *up to* rather than something the fight ends against
    const uCliff = chainEnd + 3;
    gorgeDepth = gorge ? gorge.len : 0;
    wall(-8, uCliff, 1);
    wall(-8, uCliff, -1);
    // the wall behind: a canyon is a place, and a place has a back to it.
    //
    // It runs past the corners. Each run pushes its rock outward along its
    // own perpendicular, so where two meet at a corner the square outside it
    // has no rock in it at all — and a ray from the middle of the canyon
    // reaching that corner at a glancing angle met the slab with three metres
    // of clear air behind it before any cliff. The borders audit measured it
    // from the corral, on the bearing of each back corner. So the closing
    // runs overlap the sides by more than a piece's reach.
    const backHalf = halfAt(-8) + CORNER_LAP;
    ridge([[axis.x(-8, backHalf), axis.z(-8, backHalf)], [axis.x(-8, -backHalf), axis.z(-8, -backHalf)]],
      groundAt(axis.x(-8, 0), axis.z(-8, 0)), { inside: { x: axis.x(10, 0), z: axis.z(10, 0) } });

    if (gorge) {
      const gh = gorge.w / 2;
      const endHalf = halfAt(uCliff) + CORNER_LAP;
      const face = groundAt(axis.x(uCliff, 0), axis.z(uCliff, 0));
      const behind = { x: axis.x(uCliff - 14, 0), z: axis.z(uCliff - 14, 0) };
      // the cliff that closes the canyon, either side of the slot
      for (const side of [1, -1] as const) {
        ridge([[axis.x(uCliff, side * gh), axis.z(uCliff, side * gh)],
          [axis.x(uCliff, side * endHalf), axis.z(uCliff, side * endHalf)]], face, { inside: behind });
      }
      // The slot itself: constrained, not tight — wide enough to fight down.
      // It runs *past* the doorway at its end rather than stopping short of
      // it, so the rock closes over the pocket behind the door instead of
      // leaving it standing out of the back of the cliff.
      gorgeHalf = gh;
      const inSlot = { x: axis.x(uCliff + gorgeDepth / 2, 0), z: axis.z(uCliff + gorgeDepth / 2, 0) };
      for (const side of [1, -1] as const) {
        ridge([[axis.x(uCliff, side * gh), axis.z(uCliff, side * gh)],
          [axis.x(uCliff + gorgeDepth + 9, side * gh), axis.z(uCliff + gorgeDepth + 9, side * gh)]],
        face, { inside: inSlot });
      }
      // two spires at the mouth: the thing you steer at from a hundred metres
      ridge([], face, {
        pillarAt: [
          [axis.x(uCliff - 1, gh + 4.5), axis.z(uCliff - 1, gh + 4.5)],
          [axis.x(uCliff - 1, -gh - 4.5), axis.z(uCliff - 1, -gh - 4.5)],
        ],
      });
      // the guidance points at the mouth, not at the last zone's far edge
      const mouth = new THREE.Vector3(axis.x(uCliff, 0), face + 3, axis.z(uCliff, 0));
      zones[last].landmark = mouth.clone();
      path.push(mouth.clone());
    } else {
      // no gorge: the canyon still has to *end*, or the far wall is two lines
      // running off into the territory with open ground between them. A cliff
      // across it, with the doorway's own gap left where a way on exists.
      const endHalf = halfAt(uCliff) + CORNER_LAP;
      const face = groundAt(axis.x(uCliff, 0), axis.z(uCliff, 0));
      const behind = { x: axis.x(uCliff - 14, 0), z: axis.z(uCliff - 14, 0) };
      const gapHalf = hasNext ? (GATE_W + 4) / 2 : 0;
      for (const side of [1, -1] as const) {
        if (endHalf <= gapHalf) continue;
        ridge([[axis.x(uCliff, side * gapHalf), axis.z(uCliff, side * gapHalf)],
          [axis.x(uCliff, side * endHalf), axis.z(uCliff, side * endHalf)]], face, { inside: behind });
      }
    }
  }

  return { gorgeDepth, gorgeHalf };
}
