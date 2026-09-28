import * as THREE from 'three';
import { authoredProp } from '../props';
import {
  WALL_T, CRATE_H_MIN, CRATE_H_VAR, CRATE_W_PER_H, CRATE_D_PER_H, type Frame,
} from './common';
import type { StageState } from './builder';

/**
 * The stage builder's smallest placing tools: boxes with and without
 * colliders, walls with doorways cut in them, a point on the surface, and the
 * two kinds of cover. Everything else in this folder is written in these.
 */
const BOULDERS = ['boulder_a', 'boulder_b', 'boulder_c'] as const;
/**
 * Height and depth as fractions of the longest side, measured from each
 * boulder's reference sheet (`reference/props/boulder_*_ref.png`): a is a low
 * wide dome, b a near-round lump, c a tall leaning slab.
 */
const BOULDER_SHAPE: Record<(typeof BOULDERS)[number], { h: number; d: number }> = {
  boulder_a: { h: 0.51, d: 0.79 },
  boulder_b: { h: 0.85, d: 0.95 },
  boulder_c: { h: 0.94, d: 0.77 },
};

export function stagePrimitives(b: StageState) {
  const { group, rand, wallMat, crateMat, rockMat, blocked, groundAt, addBox, addCyl } = b;

  /** a floor/ceiling/wall box: mesh + collider in one */
  const solid = (f: Frame, u0: number, u1: number, v0: number, v1: number,
    y0: number, y1: number, m: THREE.Material): THREE.Mesh => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const along = Math.abs(u1 - u0), across = Math.abs(v1 - v0);
    const cx = f.x(cu, cv), cz = f.z(cu, cv), cy = (y0 + y1) / 2;
    const sx = f.dx !== 0 ? along : across;
    const sz = f.dx !== 0 ? across : along;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), m);
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    group.add(mesh);
    addBox(cx, cy, cz, sx, y1 - y0, sz);
    return mesh;
  };

  /** mesh-only slab (trim, glow strips) — no collider */
  const slab = (f: Frame, u0: number, u1: number, v0: number, v1: number,
    y0: number, y1: number, m: THREE.Material): THREE.Mesh => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const along = Math.abs(u1 - u0), across = Math.abs(v1 - v0);
    const sx = f.dx !== 0 ? along : across;
    const sz = f.dx !== 0 ? across : along;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), m);
    mesh.position.set(f.x(cu, cv), (y0 + y1) / 2, f.z(cu, cv));
    group.add(mesh);
    return mesh;
  };

  /** a wall plane perpendicular to travel at u=uc, spanning v0..v1 minus gaps */
  const wallU = (f: Frame, uc: number, v0: number, v1: number,
    gaps: { c: number; w: number }[], top: number, h: number): void => {
    const edges = gaps.map((g) => [g.c - g.w / 2, g.c + g.w / 2]).sort((a, b) => a[0] - b[0]);
    let at = v0;
    for (const [a, b] of edges) {
      if (a > at) solid(f, uc - WALL_T / 2, uc + WALL_T / 2, at, a, top, top + h, wallMat);
      at = Math.max(at, b);
    }
    if (v1 > at) solid(f, uc - WALL_T / 2, uc + WALL_T / 2, at, v1, top, top + h, wallMat);
  };

  /** a wall running along travel at v=vc, spanning u0..u1 minus gaps */
  const wallV = (f: Frame, vc: number, u0: number, u1: number,
    gaps: { c: number; w: number }[], top: number, h: number): void => {
    const edges = gaps.map((g) => [g.c - g.w / 2, g.c + g.w / 2]).sort((a, b) => a[0] - b[0]);
    let at = u0;
    for (const [a, b] of edges) {
      if (a > at) solid(f, at, a, vc - WALL_T / 2, vc + WALL_T / 2, top, top + h, wallMat);
      at = Math.max(at, b);
    }
    if (u1 > at) solid(f, at, u1, vc - WALL_T / 2, vc + WALL_T / 2, top, top + h, wallMat);
  };

  /**
   * A point standing on the surface, in a zone's own frame.
   *
   * On plates that is the plate; on ground it is the ground under that exact
   * column, which is why vents, posts, props and cover all go through here
   * rather than sharing one `top`. A squad posted at a zone's nominal floor
   * height would be buried in the near dune and hovering over the far one.
   */
  const surf = (f: Frame, u: number, v: number, lift = 0.2): THREE.Vector3 => {
    const x = f.x(u, v), z = f.z(u, v);
    return new THREE.Vector3(x, groundAt(x, z) + lift, z);
  };

  const clearOf = (x: number, z: number, r: number): boolean =>
    blocked.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r);

  /** one cover crate: collider + stand-in + authored sculpt */
  const crate = (x: number, y: number, z: number, ch = CRATE_H_MIN + rand() * CRATE_H_VAR): THREE.Mesh => {
    const sx = ch * CRATE_W_PER_H, sz = ch * CRATE_D_PER_H;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, ch, sz), crateMat);
    mesh.position.set(x, y + ch / 2, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    addBox(x, y + ch / 2, z, sx, ch, sz);
    authoredProp(group, mesh, 'corridor_crate', ch, { x, y, z, axis: 'y' });
    blocked.push({ x, z, r: Math.max(sx, sz) * 0.7 });
    return mesh;
  };

  /**
   * The outdoor answer to a crate: a boulder, standing on a cylinder because
   * that is the shape it is. Three silhouettes so a scatter of them does not
   * read as one prop repeated, and each takes its authored sculpt when the
   * file lands.
   */
  const coverRock = (x: number, y: number, z: number): void => {
    // The same draws, in the same order, as before the sheets landed (size,
    // shape, the ring noise, spin, pick, yaw), so every placement after a
    // boulder is unchanged. What they decide is new: the variant comes first,
    // and the stand-in takes that variant's proportions from its reference
    // sheet, so the collider already fits the sculpt that replaces it.
    const size = 1.6 + rand() * 1.4;                 // the longest side, as the sculpt is scaled
    const id = BOULDERS[Math.floor(rand() * BOULDERS.length)];
    const shape = BOULDER_SHAPE[id];
    const h = size * shape.h;
    const geo = new THREE.CylinderGeometry(size * 0.42, size * 0.5, h, 7, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + (rand() - 0.5) * 0.4;
      pos.setX(i, pos.getX(i) * n);
      pos.setZ(i, pos.getZ(i) * n);
    }
    geo.scale(1, 1, shape.d);                        // shorter across than along
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, rockMat);
    const yaw = rand() * Math.PI;
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    rand();                                          // was the variant pick
    rand();                                          // was the sculpt's own yaw: it now shares the stand-in's
    // the mesh's base ring is size * 0.5 and the noise pushes it out to 0.6,
    // so a 0.46 disc left a shoulder's worth of rock you walked into
    addCyl(x, y + h / 2, z, size * 0.54, h);
    authoredProp(group, mesh, id, size, { x, y, z, yaw, axis: 'longest' });
    blocked.push({ x, z, r: size * 0.6 + 0.8 });
  };

  return { solid, slab, wallU, wallV, surf, clearOf, crate, coverRock };
}
