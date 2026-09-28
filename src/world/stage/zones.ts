import * as THREE from 'three';
import { Gate, GATE_W, type Barrier } from '../gate';
import { addBreakable } from '../board';
import type { MissionZone } from '../mission';
import {
  EPS, WALL_T, ROOF_H, TRIGGER_IN, RIM_OVER_CEILING, BARRICADE_HP, PASS_W, PASS_DEPTH, Frame,
} from './common';
import { Fence } from './barriers';
import type { StageBuilder } from './builder';
import { layLink } from './links';
import { layVestibule } from './vestibule';

/**
 * The chain itself: each zone's floor and shell — a roofed hall, a deck, a
 * building that is already there, or open ground with a border of rock — its
 * barriers, dressing and spawn geometry, and the link on to the next one.
 *
 * Returns what the later phases lay against: the zones, the frame and floor
 * height each was laid in, and whether the stage has a transport door at
 * either end.
 */
export function layZones(b: StageBuilder) {
  const {
    board, spec, stage, index, beat0, pal, baseWallH, ceiling, onGround, bare, wantRim, canyon,
    floorMat, hallFloorMat, wallMat, rockMat, trimMat, owned, group,
    boxes, breakables, rects, pickups, path, lanes, anchor, floorY, groundAt,
    solid, slab, wallU, wallV, surf, crate, ridge, setPieces, placeProps, placeRides,
  } = b;

  const zones: MissionZone[] = [];
  const zoneFrames: Frame[] = [];
  const zoneTops: number[] = [];
  const stageSeed = index * 137;
  let frame = onGround
    ? new Frame(anchor.x, anchor.z, anchor.dx, anchor.dz)
    : new Frame(-70 + stageSeed, -30, 1, 0);
  const last = stage.zones.length - 1;
  /** a stage boundary is a transport door, not a wall: leave a way through */
  const hasNext = index + 1 < spec.stages.length;
  const hasPrev = index > 0;

  for (let i = 0; i <= last; i++) {
    const zs = stage.zones[i];
    const f = frame;
    const { w, l } = zs;
    const top = onGround
      ? groundAt(f.x(l / 2, 0), f.z(l / 2, 0))
      : floorY + (b.spaceN++ % 3) * EPS;
    const isHall = zs.shell === 'hall';
    const wallH = zs.kind === 'warlord' ? baseWallH + 2.5 : baseWallH;
    const roofH = zs.roofH ?? ROOF_H;
    const hatches: { gate: Gate; post: THREE.Vector3 }[] = [];
    let runnerPost: THREE.Vector3 | null = null;
    let runnerIn: THREE.Vector3 | null = null;
    const marks: THREE.Vector3[] = [];

    // ---- the floor ----
    // A ground stage stands on the board's own: no plate, no seam, and the
    // dunes or basalt the territory is *made of* under the fight.
    if (!onGround) solid(f, -1, l + 1, -w / 2 - 1, w / 2 + 1, top - 1, top, isHall ? hallFloorMat : floorMat);
    rects.push(f.rect(-0.5, l + 0.5, -w / 2 - 0.5, w / 2 + 0.5));

    const dir = { x: f.dx, z: f.dz };
    // A way in and a way on: the zone's own neighbours, plus the transport
    // doors at either end of the stage. Their barrier is built after the loop
    // (a Portal, not a gate), but the gap in the wall has to be left here.
    const entryOpen = i > 0 || (i === 0 && hasPrev);
    const exitOpen = i < last || (i === last && hasNext);
    const internalEntry = i > 0;
    const internalExit = i < last;
    let entryBarrier: Barrier | null = null;
    let exitBarrier: Barrier | null = null;
    let landmark = f.vec(l, 0, top + 4);

    if (isHall) {
      // ---- a roofed room: real walls, blast doors, wall hatches ----
      const entryGaps = entryOpen ? [{ c: 0, w: GATE_W }] : [];
      const exitGaps = exitOpen ? [{ c: 0, w: GATE_W }] : [];
      wallU(f, -WALL_T / 2, -w / 2 - WALL_T, w / 2 + WALL_T, entryGaps, top, roofH);
      wallU(f, l + WALL_T / 2, -w / 2 - WALL_T, w / 2 + WALL_T, exitGaps, top, roofH);
      const alcoveGap = zs.alcove ? [{ c: l / 2, w: 3.2 }] : [];
      const hatchGaps = [{ c: l * 0.35, w: 2.6 }, { c: l * 0.7, w: 2.6 }];
      wallV(f, w / 2 + WALL_T / 2, -WALL_T, l + WALL_T, [...alcoveGap, hatchGaps[0]], top, roofH);
      wallV(f, -w / 2 - WALL_T / 2, -WALL_T, l + WALL_T, [hatchGaps[1]], top, roofH);
      // the roof: the hallway beat is indoors, and the jetpack is a hop in it
      solid(f, -1, l + 1, -w / 2 - 1, w / 2 + 1, top + roofH, top + roofH + 0.8, wallMat);
      slab(f, 1, l - 1, w / 2 - 0.22, w / 2 - 0.02, top + 0.04, top + 0.18, trimMat);
      slab(f, 1, l - 1, -w / 2 + 0.02, -w / 2 + 0.22, top + 0.04, top + 0.18, trimMat);

      // Wall hatches: a closet behind a door in each side wall. The wave is
      // posted in the closet and the hatch opens — a squad walking out of the
      // wall reads as the garrison being let in, where bodies standing up
      // beside it read as a spawn, and a roofed room has no sky to drop from.
      hatchGaps.forEach((h, k) => {
        const side = k === 0 ? 1 : -1;
        const p0 = side * (w / 2 + WALL_T);
        const outer = side * (w / 2 + WALL_T + 4.2);
        solid(f, h.c - 2, h.c + 2, Math.min(p0, outer), Math.max(p0, outer), top - 1, top, hallFloorMat);
        wallU(f, h.c - 2 - WALL_T / 2, Math.min(p0, outer), Math.max(p0, outer), [], top, roofH);
        wallU(f, h.c + 2 + WALL_T / 2, Math.min(p0, outer), Math.max(p0, outer), [], top, roofH);
        wallV(f, outer + side * WALL_T / 2, h.c - 2 - WALL_T, h.c + 2 + WALL_T, [], top, roofH);
        solid(f, h.c - 2, h.c + 2, Math.min(p0, outer), Math.max(p0, outer), top + roofH, top + roofH + 0.8, wallMat);
        const gate = new Gate(board, group, f.vec(h.c, p0, top),
          { x: f.px * side, z: f.pz * side }, roofH, pal.accent, { width: 2.6 });
        hatches.push({ gate, post: f.vec(h.c, side * (w / 2 + 3.2), top + 0.2) });
        rects.push(f.rect(h.c - 2, h.c + 2, Math.min(p0, outer), Math.max(p0, outer)));
      });

      if (zs.alcove) {
        const p0 = w / 2 + WALL_T;
        solid(f, l / 2 - 2.4, l / 2 + 2.4, p0 - 0.5, p0 + 3.4, top - 1, top, hallFloorMat);
        wallU(f, l / 2 - 2.4 - WALL_T / 2, p0 + 0.05, p0 + 3.4 + WALL_T, [], top, roofH);
        wallU(f, l / 2 + 2.4 + WALL_T / 2, p0 + 0.05, p0 + 3.4 + WALL_T, [], top, roofH);
        wallV(f, p0 + 3.4 + WALL_T / 2, l / 2 - 2.4 - WALL_T, l / 2 + 2.4 + WALL_T, [], top, roofH);
        pickups.push(f.vec(l / 2, p0 + 1.8, top + 0.2));
        rects.push(f.rect(l / 2 - 2.4, l / 2 + 2.4, p0, p0 + 3.4));
      }
      // zone 0 of a stage with a door behind it has a vestibule, and the room
      // seals against it like against any other way in
      if (internalEntry || entryOpen) entryBarrier = new Gate(board, group, f.vec(0, 0, top), dir, roofH, pal.accent);
      if (internalExit) exitBarrier = new Gate(board, group, f.vec(l, 0, top), dir, roofH, pal.accent);
      const lamp = new THREE.PointLight(0xffd9a0, 40 + (w * l) / 8, Math.max(w, l) * 1.7, 1.4);
      lamp.position.set(f.x(l / 2, 0), top + roofH - 0.4, f.z(l / 2, 0));
      group.add(lamp);
      landmark = f.vec(l, 0, top + 2.5);
    } else if (zs.shell === 'deck') {
      // ---- a plate in the void: no rim, the edge is the border ----
      const edge = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.5 });
      owned.push(edge);
      slab(f, -0.6, 0.2, -w / 2, w / 2, top + 0.02, top + 0.2, edge);
      if (internalExit) {
        slab(f, l - 0.2, l + 0.6, -w / 2, w / 2, top + 0.02, top + 0.2, edge);
        exitBarrier = new Fence(board, group, f.vec(l + 1, 0, top), dir, GATE_W + 3, ceiling, pal.accent);
      }
      landmark = f.vec(l + 6, 0, top + 3);
    } else if (bare) {
      // ---- a building or a sea that is already there ----
      // Nothing is built: the walls, the water and the way through are the
      // board's own. All a zone adds is where the fight happens and what
      // holds it — a pane across the way on, and nothing across the way in.
      if (internalExit && zs.kind !== 'camp' && zs.kind !== 'trek' && zs.kind !== 'start') {
        exitBarrier = new Fence(board, group, surf(f, l + 0.6, 0, 0), dir,
          Math.min(zs.w, 14), Math.min(ceiling, 12), pal.accent);
      }
      landmark = surf(f, l + 4, 0, 3);
    } else {
      // ---- outdoors: the border is terrain ----
      const half = w / 2 + 1.5;
      const back = -1.5, front = l + 1.5;
      const gapHalf = (GATE_W + 3) / 2;
      const pillars: [number, number][] = [];
      /**
       * No rim on a trailhead standing on the territory's own ground.
       *
       * A rim has to clear the flight ceiling, so it is one 45-plus-metre
       * slab per run whatever the zone is. Around a 56 x 44 m `open` zone
       * that is a box with sides taller than they are far apart, and the
       * first thing the Dune Sea's run did was stand you in the middle of
       * one with the board's own mesa poking through the west wall: cramped,
       * unreadable, and neither outdoor nor indoor, which is the opposite of
       * what rule 1 of docs/MISSIONS_OUTDOOR.md asks the opening ten seconds
       * to do. The trailhead has no fight to hold in and nothing behind it to
       * come back from, so the territory holds it instead — its dunes, its
       * mesas, its horizon — and the guidance points the way on. Every zone
       * after it keeps its border.
       */
      const openTrailhead = onGround && zs.kind === 'start';
      // A canyon stage is bordered once, down the whole chain, rather than a
      // box per zone — so the zones inside it lay no rim of their own.
      const rimmed = (wantRim || !onGround) && !openTrailhead && !canyon;
      /** the playable side of this zone's borders, for the rock to stand clear of */
      const heart = { x: f.x(l / 2, 0), z: f.z(l / 2, 0) };
      // sides run the full length — except a side that is the sea, where the
      // plate's lit edge is the border and the water is what you see
      const wet = new Set(stage.world?.waterDrop !== undefined && !onGround ? zs.water ?? [] : []);
      if (rimmed) {
        if (!wet.has('left')) ridge([[f.x(back, half), f.z(back, half)], [f.x(front, half), f.z(front, half)]], top, { inside: heart });
        if (!wet.has('right')) ridge([[f.x(back, -half), f.z(back, -half)], [f.x(front, -half), f.z(front, -half)]], top, { inside: heart });
      }
      if (wet.size) {
        const edge = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.5 });
        owned.push(edge);
        for (const side of wet) {
          const v = side === 'left' ? w / 2 + 1 : -w / 2 - 1;
          slab(f, -1, l + 1, Math.min(v, v - Math.sign(v) * 0.3), Math.max(v, v - Math.sign(v) * 0.3), top + 0.02, top + 0.2, edge);
        }
      }
      // A dead end's way on is a door in the rock rather than an open mouth —
      // except where the stage itself ends here, because then the transport
      // door *is* that door and a second one 20 cm in front of it is just a
      // second door. Either way the rim leaves the gap: the face fills it.
      const doorFace = !!zs.deadEnd && internalExit;
      const frontGaps: [number, number][] = exitOpen ? [[-gapHalf, gapHalf]] : [];
      if (zs.pass && rimmed) {
        // The pass is a way *in*, for the siege's runners: a notch in the far
        // rim, well clear of the exit's own gap, and a short gully behind it
        // walled on three sides — floored on a plate stage, so a body has
        // somewhere to stand. It used to be a four-metre notch with a post
        // nine metres out over nothing, and the post never validated, so no
        // runner ever came through it (audit finding 5).
        const pv = Math.max(w / 3, gapHalf + PASS_W / 2 + 4);
        const ph = PASS_W / 2;
        frontGaps.push([pv - ph, pv + ph]);
        const gEnd = front + PASS_DEPTH;
        if (!onGround) solid(f, l + 1, gEnd + 1, pv - ph - 1, pv + ph + 1, top - 1, top, floorMat);
        rects.push(f.rect(l + 1, gEnd, pv - ph, pv + ph));
        const gully = { x: f.x(front + PASS_DEPTH / 2, pv), z: f.z(front + PASS_DEPTH / 2, pv) };
        const gw = ph + 1.5;
        ridge([[f.x(front, pv + gw), f.z(front, pv + gw)], [f.x(gEnd, pv + gw), f.z(gEnd, pv + gw)]], top, { inside: gully });
        ridge([[f.x(front, pv - gw), f.z(front, pv - gw)], [f.x(gEnd, pv - gw), f.z(gEnd, pv - gw)]], top, { inside: gully });
        ridge([[f.x(gEnd, pv + gw), f.z(gEnd, pv + gw)], [f.x(gEnd, pv - gw), f.z(gEnd, pv - gw)]], top, { inside: gully });
        runnerPost = surf(f, gEnd - 3.5, pv);
        runnerIn = surf(f, l - 4, pv);
        lanes.push([runnerPost.clone(), runnerIn.clone()]);
      }
      frontGaps.sort((a, b) => a[0] - b[0]);
      if (rimmed) {
        // the back wall, with the way in
        if (entryOpen) {
          ridge([[f.x(back, half), f.z(back, half)], [f.x(back, gapHalf), f.z(back, gapHalf)]], top, { inside: heart });
          ridge([[f.x(back, -gapHalf), f.z(back, -gapHalf)], [f.x(back, -half), f.z(back, -half)]], top, { inside: heart });
        } else {
          ridge([[f.x(back, half), f.z(back, half)], [f.x(back, -half), f.z(back, -half)]], top, { inside: heart });
        }
        // the front, minus the way on and any runner notch
        let at = -half;
        for (const [a, b] of frontGaps) {
          if (a > at) ridge([[f.x(front, at), f.z(front, at)], [f.x(front, a), f.z(front, a)]], top, { inside: heart });
          at = b;
        }
        if (half > at) ridge([[f.x(front, at), f.z(front, at)], [f.x(front, half), f.z(front, half)]], top, { inside: heart });
      }
      // The way on is framed whether or not the zone is walled: the pair of
      // spires is what the eye picks out from eighty metres, and an unrimmed
      // trailhead needs that more than a walled zone does, not less.
      // (a canyon stage's last beat is framed by the gorge mouth instead — a
      // second pair of spires three metres short of it is a gate to nowhere)
      if (exitOpen && !(canyon?.gorge && i === last)) {
        pillars.push([f.x(front, gapHalf + 3), f.z(front, gapHalf + 3)],
          [f.x(front, -gapHalf - 3), f.z(front, -gapHalf - 3)]);
      }
      if (pillars.length) ridge([], top, { pillarAt: pillars });
      if (exitOpen) landmark = surf(f, front, 0, ceiling * 0.5);

      if (doorFace) {
        // A hewn face filling the rim's gap, with the door in the middle of it
        // and a lamp over the door — in a dark ravine the way on should be the
        // brightest thing in front of you. The face is built in two bands so
        // the doorway is a doorway rather than a full-height slot up the
        // cliff: a low band with the opening in it, and solid rock above.
        const faceH = 7;
        const rimH = ceiling + RIM_OVER_CEILING;
        wallU(f, l + 1.2, -gapHalf - 1, gapHalf + 1, [{ c: 0, w: GATE_W }], top, faceH);
        solid(f, l + 1.2 - WALL_T / 2, l + 1.2 + WALL_T / 2, -gapHalf - 1, gapHalf + 1,
          top + faceH, top + rimH, rockMat);
        exitBarrier = new Gate(board, group, surf(f, l + 1.2, 0, 0), dir, faceH, pal.accent);
        const lamp = new THREE.PointLight(0xffd9a0, 30, 26, 1.5);
        lamp.position.set(f.x(l + 1.2, 0), top + faceH - 0.5, f.z(l + 1.2, 0));
        group.add(lamp);
        landmark = surf(f, l + 1.2, 0, 3);
      }

      // An outdoor fight is held in by its exit, never by a cage behind it.
      //
      // A **road** is not in this list, because a road builds its own far
      // mouth below — crates or a fence, by `barricade`. It used to be, and
      // the two of them made two fences at the same spot: the second
      // assignment took the variable and the first was orphaned, still holding
      // its blocker, which nothing could then open. What that leaves is an
      // invisible wall across the way on that survives clearing the road —
      // one metre by seven point eight, standing on Nevarro's causeway and the
      // Great Forge's highway, the two roads whose barricade is a fence. The
      // Dune Sea escaped it only because its barricade is crates.
      if (internalExit && !doorFace
        && (zs.kind === 'assault' || zs.kind === 'lieutenant' || zs.kind === 'warlord')) {
        exitBarrier = new Fence(board, group, surf(f, l + 0.6, 0, 0), dir, GATE_W + 3, ceiling, pal.accent);
      }
      if ((zs.kind === 'lieutenant' || zs.kind === 'warlord') && entryOpen) {
        // the arena's own gate behind the party, so the fight has a back wall
        entryBarrier = new Fence(board, group, surf(f, -0.6, 0, 0), dir, GATE_W + 3, ceiling, pal.accent);
      }
      if (zs.alcove) {
        pickups.push(f.vec(l * 0.5, w / 2 - 2.2, top + 0.2));
      }
      // road: the drop marks and the barricade at the far mouth
      if (zs.shell === 'road') {
        for (const m of zs.marks ?? [0.4, 0.75]) marks.push(surf(f, l * m, 0));
        if (zs.barricade === 'crates') {
          // A crate line plugs a mouth. Out in the open ground of a canyon
          // there is nothing to plug — you drive round it — so where the run
          // ends at a gorge the barricade goes into the gorge's own mouth,
          // which is the one place on the road that is narrower than the ride.
          const inMouth = !!canyon?.gorge && i === last;
          const bu = inMouth ? l + 5 : l - 2;
          const bn = inMouth ? Math.max(2, Math.round(canyon!.gorge!.w / 5.2)) : 2;
          for (let k = -bn; k <= bn; k++) {
            const x = f.x(bu, k * 2.6), z = f.z(bu, k * 2.6);
            const mesh = crate(x, groundAt(x, z), z, 1.5);
            const box = boxes[boxes.length - 1];
            addBreakable(board, mesh, box, BARRICADE_HP);
            breakables.push({ mesh });
          }
        } else if (internalExit) {
          exitBarrier = new Fence(board, group, surf(f, l + 0.6, 0, 0), dir, GATE_W + 3, ceiling, pal.accent);
        }
      }
    }

    setPieces(f, zs, top, isHall ? roofH : wallH);
    placeProps(f, zs, top);
    placeRides(f, zs, top);

    // ---- spawn geometry ----
    const farVents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l - 3.5, w / 2 - 3.5], [l - 3.5, -(w / 2 - 3.5)],
      [l - 3.5, w * 0.17], [l - 3.5, -w * 0.17],
    ]) farVents.push(surf(f, u, v));
    const sideVents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l * 0.5, w / 2 - 3], [l * 0.5, -(w / 2 - 3)],
      [l * 0.32, w / 2 - 3.5], [l * 0.32, -(w / 2 - 3.5)],
      [l * 0.7, w / 2 - 3.5], [l * 0.7, -(w / 2 - 3.5)],
    ]) sideVents.push(surf(f, u, v));
    const posts: THREE.Vector3[] = [];
    if (zs.kind === 'camp') {
      // A camp says "clear it, or slip through", so its garrison holds one
      // flank of the middle third and leaves the other quiet. Posted on and
      // beside the centreline round the exit, as every other zone is, a camp
      // was a small assault with nothing to slip past (audit finding 7).
      const side = zs.postSide ?? ((beat0 + i) % 2 ? 1 : -1);
      for (const [u, v] of [
        [0.36, 0.3], [0.46, 0.38], [0.52, 0.3], [0.6, 0.4], [0.66, 0.32], [0.42, 0.44],
      ]) posts.push(surf(f, l * u, side * Math.min(w * v, w / 2 - 2)));
    } else {
      for (const [u, v] of [
        [l * 0.6, w * 0.28], [l * 0.6, -w * 0.28], [l * 0.75, 0],
        [l * 0.82, w * 0.2], [l * 0.82, -w * 0.2],
      ]) posts.push(surf(f, u, v));
    }

    zoneFrames.push(f);
    zoneTops.push(top);
    const pathFrom = path.length;
    zones.push({
      spec: zs,
      pathFrom,
      beat: beat0 + i,
      entry: surf(f, 2.4, 0),
      center: surf(f, l / 2, 0),
      exit: surf(f, l - 2.4, 0),
      rect: f.rect(0, l, -w / 2, w / 2),
      sealRect: f.rect(1.2, l - 1.2, -w / 2, w / 2),
      triggerRect: f.rect(Math.min(TRIGGER_IN, l * 0.4), l, -w / 2, w / 2),
      entryBarrier, exitBarrier, hatches,
      farVents, sideVents, vents: [], posts, runnerPost, runnerIn, marks,
      landmark,
    });
    path.push(surf(f, 2.4, 0), surf(f, l - 2.4, 0));

    // ---- the link on to the next zone ----
    if (i === last) break;
    frame = layLink(b, i, f, l, isHall);
  }

  // The vestibule: every stage with a door behind it opens outside its first
  // zone rather than inside it. Its point leads the golden path, so every
  // zone's place in the path moves up one.
  let vestibule: THREE.Vector3 | null = null;
  if (hasPrev && zones.length) {
    vestibule = layVestibule(b, zoneFrames[0], stage.zones[0], zoneTops[0]);
    for (const z of zones) z.pathFrom++;
  }

  return { zones, zoneFrames, zoneTops, last, hasNext, hasPrev, vestibule };
}

export type StageChain = ReturnType<typeof layZones>;
