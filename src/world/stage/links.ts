import * as THREE from 'three';
import { mat } from '../../characters/builder';
import { authoredProp } from '../props';
import type { DefenderPost } from '../mission';
import {
  EPS, WALL_T, CORR_H, TRAIL_MIN_LEN, TRAIL_EVERY, PICKET_MIN_LEN, PICKET_EVERY,
  CRATE_H_MIN, CRATE_H_VAR, CRATE_W_PER_H, CRATE_D_PER_H, Frame,
} from './common';
import type { StageBuilder } from './builder';

/**
 * The trail post stand-in, lathed to its reference sheet
 * (`reference/props/trail_post_ref.png`, 1.8 m): a flanged foot, a slim pole,
 * and the lantern's frame and cap at the top. [radius, height] in metres.
 */
const TRAIL_POST_GEO = new THREE.LatheGeometry([
  [0.01, 0], [0.2, 0], [0.2, 0.05], [0.12, 0.09], [0.08, 0.2], [0.055, 0.26],
  [0.055, 1.5], [0.08, 1.53], [0.08, 1.55], [0.02, 1.55], [0.02, 1.73], [0.13, 1.73],
  [0.14, 1.76], [0.04, 1.8], [0.01, 1.8],
].map(([r, y]) => new THREE.Vector2(r, y)), 8);

/**
 * The link out of zone `i`, which was laid in frame `f` and is `l` long: one
 * leg along the heading and any bends after it, roofed as a corridor or open
 * as a lane, with its crates, trail posts and pickets. Returns the frame the
 * next zone is laid in, at the far end of the last leg.
 */
export function layLink(b: StageBuilder, i: number, f: Frame, l: number, isHall: boolean): Frame {
  const {
    stage, corrW, onGround, canyon, rand, floorMat, wallMat, trimMat, accentGlow, group,
    rects, pickups, defenders, path, floorY, groundAt,
    solid, slab, wallU, wallV, surf, crate, ridge,
  } = b;

  const link = stage.links[i] ?? { len: 14 };
  const nextIsHall = stage.zones[i + 1].shell === 'hall';
  const roofed = link.kind ? link.kind === 'corridor' : (isHall || nextIsHall);
  const linkPosts: DefenderPost[] = [];
  let g = new Frame(f.x(l + 1.5, 0), f.z(l + 1.5, 0), f.dx, f.dz);
  const laneW = roofed ? corrW : Math.max(corrW, 9);

  const leg = (lf: Frame, len: number, withCrates: boolean): void => {
    const ltop = onGround
      ? groundAt(lf.x(len / 2, 0), lf.z(len / 2, 0))
      : floorY + (b.spaceN++ % 3) * EPS;
    if (!onGround) solid(lf, -1, len + 1, -laneW / 2 - 1, laneW / 2 + 1, ltop - 1, ltop, floorMat);
    if (roofed) {
      solid(lf, -1, len + 1, -laneW / 2 - 1, laneW / 2 + 1, ltop + CORR_H, ltop + CORR_H + 1, wallMat);
      // the lane walls sit 5 cm proud and run only their own span: the room
      // and junction walls seal the corners, and a wall that overshot into a
      // junction left a notch bodies wedged into at every bend
      wallV(lf, laneW / 2 + WALL_T / 2 + 0.05, 0.05, len - 0.05, [], ltop, CORR_H);
      wallV(lf, -laneW / 2 - WALL_T / 2 - 0.05, 0.05, len - 0.05, [], ltop, CORR_H);
      const light = new THREE.PointLight(0xffd9a0, 9, len + 12, 1.6);
      light.position.set(lf.x(len / 2, 0), ltop + CORR_H - 0.5, lf.z(len / 2, 0));
      group.add(light);
    } else if (!canyon) {
      // An outdoor lane: cliffs, not walls, and the sky stays overhead.
      //
      // The runs stop at the leg's own ends. They used to overshoot by a
      // metre at each end, which walled off every bend: a leg's side wall
      // reached back across the junction its neighbour turns out of, and
      // the two overhangs met in an interior corner a body could walk into
      // and never out of. The roofed corridors have always stopped short
      // for exactly this reason; the cliffs have to as well.
      const hw = laneW / 2 + 1.5;
      const lane = { x: lf.x(len / 2, 0), z: lf.z(len / 2, 0) };
      ridge([[lf.x(0, hw), lf.z(0, hw)], [lf.x(len, hw), lf.z(len, hw)]], ltop, { inside: lane });
      ridge([[lf.x(0, -hw), lf.z(0, -hw)], [lf.x(len, -hw), lf.z(len, -hw)]], ltop, { inside: lane });
    }
    if (!onGround) slab(lf, 0.5, len - 0.5, -laneW / 2 + 0.02, -laneW / 2 + 0.2, ltop + 0.04, ltop + 0.16, trimMat);
    rects.push(lf.rect(-0.5, len + 0.5, -laneW / 2 - 0.5, laneW / 2 + 0.5));
    // the breadcrumb: posts down any lane long enough to be a walk
    if (len >= TRAIL_MIN_LEN) {
      for (let d = TRAIL_EVERY; d < len; d += TRAIL_EVERY) {
        const px = lf.x(d, laneW / 2 - 0.9), pz = lf.z(d, laneW / 2 - 0.9);
        const ltop = groundAt(px, pz);
        const post = new THREE.Mesh(TRAIL_POST_GEO, mat(0x3a3a3a, { rough: 0.8, metal: 0.3 }));
        post.position.set(px, ltop, pz);
        group.add(post);
        // the lantern glass, 1.55-1.73 m up under its cap, as on the sheet
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 8), accentGlow);
        head.position.set(px, ltop + 1.64, pz);
        group.add(head);
        authoredProp(group, [post, head], 'trail_post', 1.8, { x: px, y: ltop, z: pz, axis: 'y' });
      }
    }
    if (withCrates && roofed && len >= 12) {
      // a staggered pair butted flush against the walls: tuck, peek, advance.
      // Flush matters — a crate floating off the wall leaves a gap too narrow
      // for a body, and that pocket catches anyone hugging the wall.
      for (const [t, side] of [[0.42, 1], [0.68, -1]] as const) {
        // Sized to the lane: a crate is flush to the wall, so in a five-metre
        // corridor its full depth reached to within half a metre of the
        // centreline and the golden path — the line the arrow sends you
        // down — ran through its shoulder. The trail audit read it as a
        // wall across the way. A crate leaves the middle of the lane clear.
        const per = lf.dx !== 0 ? CRATE_D_PER_H : CRATE_W_PER_H;
        const ch = Math.min(CRATE_H_MIN + rand() * CRATE_H_VAR, (laneW / 2 - 1.0) / per);
        const across = per * ch;
        const v = side * (laneW / 2 + 0.03 - across / 2);
        crate(lf.x(len * t, v), ltop, lf.z(len * t, v), ch);
        linkPosts.push({
          pos: lf.vec(len * t + 1.5, v, ltop + 0.2),
          toward: lf.vec(0, 0, ltop),
        });
      }
    }
    // Pickets down the lane, roofed or not: somebody is *in* the corridor
    // rather than waiting at the far end of it. They alternate sides so the
    // walk is a series of angles rather than a shooting gallery, and they
    // stand off the centreline so the golden path stays clear. Anything
    // that lands inside a crate or a wall is dropped by `fits` below.
    if (len >= PICKET_MIN_LEN) {
      let n = 0;
      for (let d = PICKET_EVERY * 0.6; d < len - 2; d += PICKET_EVERY) {
        const side = n++ % 2 ? 1 : -1;
        const v = side * Math.min(laneW / 2 - 1.4, 3.2);
        linkPosts.push({ pos: surf(lf, d, v), toward: lf.vec(0, 0, ltop) });
      }
    }
    path.push(surf(lf, len / 2, 0));
  };

  const legs: { turn: -1 | 1; len: number }[] = [];
  if (link.turn && link.len2) legs.push({ turn: link.turn, len: link.len2 });
  for (const extra of link.legs ?? []) legs.push(extra);
  leg(g, link.len, true);
  let lastLen = link.len;
  for (const { turn, len: len2 } of legs) {
    const jf = new Frame(g.x(lastLen, 0), g.z(lastLen, 0), g.dx, g.dz);
    const jtop = onGround
      ? groundAt(jf.x(laneW / 2, 0), jf.z(laneW / 2, 0))
      : floorY + (b.spaceN++ % 3) * EPS;
    if (!onGround) solid(jf, -1, laneW + 1, -laneW / 2 - 1, laneW / 2 + 1, jtop - 1, jtop, floorMat);
    if (roofed) {
      solid(jf, -1, laneW + 1, -laneW / 2 - 1, laneW / 2 + 1, jtop + CORR_H, jtop + CORR_H + 1, wallMat);
      wallU(jf, laneW + WALL_T / 2, -laneW / 2 - WALL_T, laneW / 2 + WALL_T, [], jtop, CORR_H);
      wallV(jf, -turn * (laneW / 2 + WALL_T / 2), -WALL_T, laneW + WALL_T, [], jtop, CORR_H);
    } else {
      const outer = -turn * (laneW / 2 + 1.5);
      const bend = { x: jf.x(laneW / 2, turn * laneW * 0.25), z: jf.z(laneW / 2, turn * laneW * 0.25) };
      ridge([[jf.x(-1.5, outer), jf.z(-1.5, outer)], [jf.x(laneW + 1.5, outer), jf.z(laneW + 1.5, outer)]],
        jtop, { inside: bend });
      ridge([[jf.x(laneW + 1.5, outer), jf.z(laneW + 1.5, outer)],
        [jf.x(laneW + 1.5, -outer), jf.z(laneW + 1.5, -outer)]], jtop, { inside: bend });
    }
    rects.push(jf.rect(0, laneW, -laneW / 2, laneW / 2));
    // The corner itself is a point on the golden path. Without it the route
    // reads as "leg one's middle, then leg two's middle", and the straight
    // line between those two cuts across the inside of the bend — into the
    // cliff that makes the bend a bend.
    path.push(surf(jf, laneW / 2, 0));
    const ndx = turn > 0 ? jf.px : -jf.px;
    const ndz = turn > 0 ? jf.pz : -jf.pz;
    const g2 = new Frame(
      jf.x(laneW / 2, turn * (laneW / 2)),
      jf.z(laneW / 2, turn * (laneW / 2)), ndx, ndz);
    leg(g2, len2, false);
    g = g2;
    lastLen = len2;
  }
  // bacta midway down every other link — the attrition beat pays for itself
  if (i % 2 === 1) pickups.push(surf(g, 6, -1.4));
  defenders.push(linkPosts);
  return new Frame(g.x(lastLen + 1.5, 0), g.z(lastLen + 1.5, 0), g.dx, g.dz);
}
