import * as THREE from 'three';
import type { SectionContext } from './context';

/**
 * Rock and sand dressing shared by the Dune Sea's sections: world-scaled
 * sandstone so a thirty-metre mesa face and a two-metre boulder carry the
 * same strata at the same size (a material's own repeat is per face, which
 * tiles a big box like brickwork), mesa walls that stand as the edge of the
 * world, and stratified crags.
 */

/** a box whose UVs repeat every `m` metres on every face */
export function worldBox(sx: number, sy: number, sz: number, m: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry's faces, 4 vertices each: +x, −x, +y, −y, +z, −z
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / m, uv.getY(i) * dims[f][1] / m);
    }
  }
  return geo;
}

/** an irregular upright rock: a jittered frustum, UVs at world scale */
export function rockColumn(rTop: number, rBot: number, h: number, m: number, seed: number, sides = 8): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, sides, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + Math.sin(a * 3 + seed) * 0.08 + Math.sin(a * 5 + seed * 1.7 + y) * 0.06;
    pos.setXYZ(i, x * k, y, z * k);
  }
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const circ = Math.PI * (rTop + rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / m, uv.getY(i) * h / m);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A mesa wall along one flank, `side` −1 (west) or +1 (east), its face at
 * |x| = `face`, from `z0` to `z1`: stepped blocks up past the ceiling, a
 * talus of fallen rock at the foot. Solid to the face, so the edge is the
 * rock you can see.
 */
export function mesaWall(ctx: SectionContext, mat: THREE.Material, rockMat: THREE.Material,
  side: number, face: number, z0: number, z1: number, y0: number, rng: () => number,
  opts: { minH?: number; maxH?: number; talus?: boolean } = {}): void {
  const minH = opts.minH ?? 28, maxH = opts.maxH ?? 50;
  for (let z = z0; z < z1; ) {
    const len = 9 + rng() * 8;
    const h = minH + rng() * (maxH - minH);
    const d = 14 + rng() * 8;
    const push = rng() * 2.2;
    const cx = side * (face + push + d / 2);
    ctx.box(cx, y0 + h / 2 - 1, z + len / 2, d, h, len + 0.4, null);
    const block = new THREE.Mesh(worldBox(d, h, len + 0.4, 16), mat);
    ctx.own(block.geometry);
    block.position.set(cx, y0 + h / 2 - 1, z + len / 2);
    block.castShadow = block.receiveShadow = true;
    ctx.mesh(block);
    // a stepped cap: the mesa's upper tier, set back from the face
    if (rng() < 0.6) {
      const ch = 6 + rng() * 10;
      const cd = d * (0.4 + rng() * 0.3);
      const cap = new THREE.Mesh(worldBox(cd, ch, len * 0.8, 16), mat);
      ctx.own(cap.geometry);
      cap.position.set(side * (face + push + d - cd / 2), y0 + h + ch / 2 - 1.2, z + len / 2);
      cap.castShadow = true;
      ctx.mesh(cap);
    }
    // the talus at its foot: fallen blocks, the wall's scale, and a little cover
    if (opts.talus !== false && rng() < 0.55) {
      const r = 1.1 + rng() * 1.7;
      const hh = r * (1.1 + rng() * 0.8);
      const x = side * (face - r * 0.55);
      const zz = z + rng() * len;
      ctx.cyl(x, y0 + hh / 2, zz, r * 0.9, hh, null);
      const m = new THREE.Mesh(rockColumn(r * 0.7, r, hh, 6, z + side), rockMat);
      ctx.own(m.geometry);
      m.position.set(x, y0 + hh / 2 - 0.1, zz);
      m.rotation.y = rng() * 6;
      m.castShadow = m.receiveShadow = true;
      ctx.mesh(m);
    }
    z += len;
  }
}

/** the far skyline: buttes standing out past the walls, visual only */
export function buttes(ctx: SectionContext, mat: THREE.Material, side: number, from: number,
  z0: number, z1: number, y0: number, rng: () => number, n = 6): void {
  for (let k = 0; k < n; k++) {
    const h = 50 + rng() * 40;
    const r = 9 + rng() * 10;
    const m = new THREE.Mesh(rockColumn(r * 0.8, r * 1.1, h, 16, k * 3 + side, 7), mat);
    ctx.own(m.geometry);
    m.position.set(side * (from + rng() * 40), y0 + h / 2 - 4, z0 + (k + rng() * 0.6) * (z1 - z0) / n);
    ctx.mesh(m);
  }
}

/**
 * A stratified crag standing on an island: two or three stacked, stepped-in
 * frustums. Returns its collider's radius and height (the caller stands it).
 */
export function crag(ctx: SectionContext, mat: THREE.Material, x: number, y: number, z: number,
  r: number, h: number, seed: number): void {
  const tiers = h > 3.5 ? 3 : 2;
  let yy = y, rr = r;
  for (let t = 0; t < tiers; t++) {
    const th = (h / tiers) * (t === tiers - 1 ? 1.1 : 1);
    const top = rr * (0.78 + ((seed * 7 + t) % 3) * 0.05);
    const m = new THREE.Mesh(rockColumn(top, rr, th, 5, seed + t, 7), mat);
    ctx.own(m.geometry);
    m.position.set(x + Math.sin(seed + t) * 0.2, yy + th / 2, z + Math.cos(seed + t) * 0.2);
    m.rotation.y = seed + t;
    m.castShadow = m.receiveShadow = true;
    ctx.mesh(m);
    yy += th;
    rr = top * 0.96;
  }
}
