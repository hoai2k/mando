import { GATE_W } from '../gate';
import type { Shell } from '../mission';
import { PORTAL_POCKET, WALL_T, ROOF_H, RIM_OVER_CEILING, VESTIBULE, DOOR_MAX_H, type Frame } from './common';
import { Portal } from './barriers';
import type { StageBuilder } from './builder';
import type { StageChain } from './zones';

/**
 * The transport doors at either end of the stage, each in a pocket and set
 * into the border it leaves through. `gorgeDepth` and `gorgeHalf` are the
 * canyon's, where a gorge holds the way on.
 */
export function layDoors(b: StageBuilder, chain: StageChain, gorgeDepth: number, gorgeHalf: number) {
  const {
    board, spec, stage, index, ceiling, onGround, bare, hallFloorMat, wallMat, rockMat, trimMat, accentGlow,
    group, rects, path, groundAt, solid, slab, wallU, wallV,
  } = b;
  const { zoneFrames, zoneTops, last, hasNext, hasPrev } = chain;

  // ---- the transport doors at the stage's ends (docs/MISSIONS_OUTDOOR.md §1.9) ----
  // A pocket beyond the leaves, whose far end is the threshold: the door is
  // stepped through deliberately, never brushed by in a fight that spilled
  // into it, and on the way back it is where a player stands to wait.
  const pocket = (f: Frame, u0: number, top: number, back: boolean, doorH: number): void => {
    const s0 = back ? u0 - PORTAL_POCKET - 1 : u0;
    const s1 = back ? u0 : u0 + PORTAL_POCKET + 1;
    // The pocket is a threshold, so on rolling ground it is levelled into a
    // short platform at the doorway's own height rather than following the
    // dune through it — a door you step *up* into reads as a door.
    // a door's pocket is roofed: it takes a roofed floor whatever it opens on
    solid(f, s0, s1, -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6, top - 3, top, hallFloorMat);
    wallV(f, GATE_W / 2 + 2.6 + WALL_T / 2, s0, s1, [], top, doorH);
    wallV(f, -GATE_W / 2 - 2.6 - WALL_T / 2, s0, s1, [], top, doorH);
    wallU(f, back ? s0 - WALL_T / 2 : s1 + WALL_T / 2,
      -GATE_W / 2 - 2.6 - WALL_T, GATE_W / 2 + 2.6 + WALL_T, [], top, doorH);
    solid(f, s0, s1, -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6, top + doorH, top + doorH + 0.8, wallMat);
    rects.push(f.rect(s0, s1, -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6));
  };

  /**
   * The rock a transport door is set into.
   *
   * A pocket on its own is a shed: four walls and a roof standing in the open,
   * with sky over it and the zone's rim metres behind. Outdoors that reads as
   * a prop dropped on the sand rather than a way out of the place — you cannot
   * tell whether it is shut, and there is nothing to say the door *is* the
   * border. So the border closes over it, in the two bands a dead end's face
   * already uses: a low band with the opening cut into it, and solid rock from
   * there to the top of the cliff. No gap beside the door, no sky above it.
   *
   * Halls and decks skip it — a hall's own wall is already the face, and a deck
   * has no rim to fill. The Spice Run's station entrance is the exception:
   * its hull supplies a full-width face instead of a floating pocket.
   */
  const doorwayFace = (f: Frame, u: number, half: number, top: number, doorH: number): void => {
    const gap = { c: 0, w: GATE_W + 2.6 };
    wallU(f, u, -half, half, [gap], top, doorH);
    solid(f, u - WALL_T / 2, u + WALL_T / 2, -half, half,
      top + doorH, top + ceiling + RIM_OVER_CEILING, rockMat);
  };
  /** does this shell hold a transport door in a border that has to be closed? */
  const facedShell = (shell: Shell): boolean => shell !== 'hall' && shell !== 'deck';

  /**
   * A transport door cut into an actual station hull, rather than a small shed
   * with empty space on three sides. The facade spans much farther than the
   * deck, and its high, deep wings and roof read as a massive hull from the
   * approach. The only opening is the gate; all pieces clear the flight
   * ceiling and the threshold remains walkable.
   *
   * `sgn` is which way the hull runs from the door along the frame: +1 for the
   * way on (the hull is beyond the door), -1 for the way back (the hull is
   * behind the party as they arrive — you leave through the station's hull,
   * so you arrive in front of it).
   */
  const hullFace = (f: Frame, u0: number, sgn: 1 | -1, top: number, doorH: number, deckW: number): void => {
    const U = (a: number, b: number): [number, number] => {
      const x = u0 + sgn * a, y = u0 + sgn * b;
      return [Math.min(x, y), Math.max(x, y)];
    };
    const half = Math.max(72, deckW / 2 + 24);
    doorwayFace(f, u0 - sgn * WALL_T, half, top, doorH);
    for (const side of [-1, 1]) {
      const a = side < 0 ? -half : GATE_W / 2 + 2.6;
      const b = side < 0 ? -GATE_W / 2 - 2.6 : half;
      solid(f, ...U(1, 46), a, b, top - 24, top + ceiling + RIM_OVER_CEILING, rockMat);
      // Layered armour and lit seams keep the giant silhouette legible.
      slab(f, ...U(-WALL_T - 0.15, -WALL_T + 0.15),
        side < 0 ? -half + 2 : half - 2, side < 0 ? -half + 2.4 : half - 1.6,
        top + 2, top + ceiling + 4, trimMat);
      for (const v of [14, 34, 56]) {
        const inner = side * v;
        slab(f, ...U(-WALL_T - 0.16, -WALL_T + 0.16),
          inner - 0.3, inner + 0.3, top + 12, top + ceiling + 2, trimMat);
      }
    }
    solid(f, ...U(PORTAL_POCKET + 2, 46),
      -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6,
      top + doorH, top + ceiling + RIM_OVER_CEILING, rockMat);
    // A broad upper spine and lower keel project beyond the outer wall.
    solid(f, ...U(8, 38), -half - 12, half + 12,
      top + ceiling + RIM_OVER_CEILING, top + ceiling + 17, wallMat);
    solid(f, ...U(10, 40), -half - 7, half + 7,
      top - 37, top - 24, wallMat);
    slab(f, ...U(-WALL_T - 0.16, -WALL_T + 0.16),
      -GATE_W / 2 - 2, GATE_W / 2 + 2, top + doorH + 1, top + doorH + 1.3, accentGlow);
  };

  let exitPortal: Portal | null = null;
  let backPortal: Portal | null = null;
  if (hasNext) {
    const f = zoneFrames[last];
    // A gorge puts the door at the far end of the slot rather than in open
    // ground: the way on is *walked into* — cliff, mouth, ravine, door.
    const u0 = stage.zones[last].l + 1 + (gorgeDepth ? gorgeDepth + 3 : 0);
    const top = onGround
      ? groundAt(f.x(u0 + 2, 0), f.z(u0 + 2, 0))
      : zoneTops[last];
    const doorH = Math.max(6, Math.min(DOOR_MAX_H, stage.zones[last].roofH ?? ROOF_H));
    pocket(f, u0, top, false, doorH);
    // A gorge's way on is a **door in a wall**, not a shed standing in a
    // ravine. The pocket is only nine metres across; a sixteen-metre slot left
    // two metres of walkable rock down either side of it, and the slot's own
    // walls stopped before the pocket did — so the door could be walked round,
    // past the end of the ravine, and out into open desert. Worse, it read as
    // *shut* while you did it: nothing about it said the run was waiting on
    // you to step through.
    //
    // So the slot is closed across its full width at the doorway, in the two
    // bands a rim already uses for a dead end's face: a low band with the
    // opening cut into it, and solid rock from there to the top of the cliff,
    // so there is no gap beside the door and no sky above it.
    // wall to wall: a face that stops short of the border leaves sand either
    // side of the door, which is the walk-round it was built to close
    if (spec.ridge === 'hull' && index === 0 && stage.zones[last].shell === 'deck') {
      hullFace(f, u0, 1, top, doorH, stage.zones[last].w);
    } else if (gorgeHalf) doorwayFace(f, u0 - WALL_T, gorgeHalf + 1.5, top, doorH);
    else if (!bare && facedShell(stage.zones[last].shell)) {
      doorwayFace(f, u0 - WALL_T, stage.zones[last].w / 2 + 1.5, top, doorH);
    }
    exitPortal = new Portal(board, group, f.vec(u0, 0, top),
      { x: f.dx, z: f.dz }, doorH, PORTAL_POCKET);
    path.push(exitPortal.threshold.clone());
  }
  if (hasPrev) {
    // The way back stands at the far end of the vestibule, not on zone 0's
    // edge: the party arrives outside the first zone and walks into it.
    const f = zoneFrames[0];
    const u = -1 - VESTIBULE;
    const top = onGround ? groundAt(f.x(u - 2, 0), f.z(u - 2, 0)) : zoneTops[0];
    const doorH = Math.max(6, Math.min(DOOR_MAX_H, stage.zones[0].roofH ?? ROOF_H));
    pocket(f, u, top, true, doorH);
    if (spec.ridge === 'hull' && stage.zones[0].shell === 'deck') {
      hullFace(f, u, -1, top, doorH, stage.zones[0].w);
    } else if (!bare && facedShell(stage.zones[0].shell)) {
      // the vestibule's lane is held by cliffs a link's width apart; the face
      // closes it wall to wall, past both slabs
      doorwayFace(f, u + WALL_T, Math.max(b.corrW, 9) / 2 + 4, top, doorH);
    }
    backPortal = new Portal(board, group, f.vec(u, 0, top),
      { x: -f.dx, z: -f.dz }, doorH, PORTAL_POCKET);
  }

  return { exitPortal, backPortal };
}
