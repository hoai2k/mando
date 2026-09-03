import * as THREE from 'three';
import { markOwned } from '../core/dispose';

/**
 * The broodmother's clutch, driven on the sculpt's own eggs.
 *
 * `krykna_brood.glb` carries six eggs on her abdomen, and they are real
 * geometry: six near-complete spheres welded into the body mesh by a collar of
 * about thirty triangles each (no shared vertices, no separate submesh — one
 * skinned mesh, one material, so nothing can be shown or hidden by itself).
 * This module finds those six spheres in the buffer, and gives the game a
 * handle on each one:
 *
 * - **ready** is the sculpt exactly as delivered — full, pale, untouched;
 * - **spent** is that same egg darkened and collapsed against her back;
 * - in between, an egg growing back into its shell.
 *
 * When one is laid or thrown the procedural egg (`buildSpiderEgg`) is spawned
 * at that sphere's world position and the sphere collapses behind it, so the
 * thing that flies off her back is the thing that was on it.
 *
 * The shape work is baked once, at load: every egg vertex gets a second
 * position (and normal) — where it sits when the sac is empty — and the
 * vertex shader mixes between the two. So a sac costs nothing per frame but a
 * uniform, the six of them stay one draw call, and skinning still owns the
 * pose. Colour rides the same path: a per-egg tint multiplied into the
 * fragment, which is 1 at ready and therefore literally the sculpt.
 */

/** how many eggs the broodmother's back carries — the sculpt's own count */
export const BROOD_EGG_RACK = 6;

/**
 * The six eggs as they sit in `krykna_brood.glb`: `[x, y, z, radius]`, the
 * centre as a fraction of the mesh's own bounding box and the radius as a
 * fraction of that box's width.
 *
 * Measured off the file rather than guessed — `node tools/audit-eggrack.mjs`
 * re-derives them from the shipped .glb (vertex-normal sphere voting, then a
 * least-squares fit) and fails if they have drifted, so a re-export that moves
 * the clutch is caught rather than silently producing a rack that shades the
 * abdomen. Fractions of the box, not absolute units, so a re-export at another
 * scale still lands on the eggs.
 *
 * Ordered bottom-up, which is the order the clutch fills: one low at the tip
 * of the abdomen, a pair above it, a pair above those, and one riding the top.
 */
const EGG_SPHERES: readonly (readonly [number, number, number, number])[] = [
  [0.49990, 0.65235, 0.05353, 0.05227],
  [0.39017, 0.67103, 0.08385, 0.05576],
  [0.60932, 0.67119, 0.08355, 0.05566],
  [0.37721, 0.81698, 0.15366, 0.05855],
  [0.62219, 0.81667, 0.15376, 0.05875],
  [0.49980, 0.91239, 0.16393, 0.05865],
];

/**
 * How far outside its fitted radius a vertex can sit and still be that egg's.
 * The fit is good to about a percent; the slack takes the sculpt's surface
 * bumps without reaching the abdomen, which is a whole radius away from every
 * one of these centres except across the collar.
 */
const EGG_SLACK = 1.06;

/**
 * The fewest vertices an egg can be made of before this refuses the job. A
 * healthy egg carries 80–140; anything near zero means the constants no longer
 * describe the file, and shading the wrong vertices would be worse than not
 * shading any — the caller falls back to its stand-in rack.
 */
const MIN_EGG_VERTS = 40;

/**
 * What a spent sac collapses to. It is flattened against her back rather than
 * merely shrunk: `SPENT_FLAT` of its height along the outward axis and
 * `SPENT_WIDE` of its width across it, measured from the collar where the egg
 * meets the abdomen — which stays put, so the mesh does not tear at the seam.
 * The result is a slack disc of shell skin, not a small egg.
 */
const SPENT_FLAT = 0.28;
const SPENT_WIDE = 0.62;

/** A spent sac's colour, as a multiplier on the sculpt's own pale shell. */
const SPENT_TINT = new THREE.Color(0.11, 0.12, 0.10);
/** ...and a ready one's, which is no change at all: the sculpt as delivered. */
const READY_TINT = new THREE.Color(1, 1, 1);
/** the last beat of the charge, flashing */
const CHARGE_LIT = new THREE.Color(0.62, 0.95, 1.85);
const CHARGE_DIM = new THREE.Color(0.22, 0.28, 0.52);

/** Where in the charge the flashing starts, and how many flashes it fits. */
const FLASH_FROM = 0.72;
const FLASH_BEATS = 4;

interface Egg {
  /** centre in the mesh's own local space, for `spot` */
  readonly centre: THREE.Vector3;
  /** the vertex whose skin weights carry that centre */
  readonly vertex: number;
}

export interface SculptRack {
  readonly count: number;
  /** how full sac `i` looks: 0 collapsed and dark, 1 the untouched sculpt */
  setFill(index: number, fill: number): void;
  /** what sac `i` is shaded: a multiplier, so `READY_TINT` shows the sculpt */
  setTint(index: number, tint: THREE.Color): void;
  /**
   * What sac `i` is showing: `fill` 0 collapsed to 1 the untouched sculpt, and
   * `shade` the tint's luminance on the same scale. The rack's own answer, so
   * a check reads what is on screen rather than what was asked for.
   */
  shown(index: number): { fill: number; shade: number } | null;
  /** world position of egg `i`, skinned: where the delivered egg is born */
  spot(index: number, out: THREE.Vector3): boolean;
  /**
   * Per-frame. The hurt flash takes private copies of the body's materials
   * (see `Player.adoptTintMats`) and a copy does not carry an `onBeforeCompile`
   * hook, so the rack re-fits itself to whatever material the mesh is wearing
   * now rather than to one captured at build time.
   */
  refresh(): void;
}

/** the shader's own name for a vertex that belongs to no egg */
const NO_EGG = -1;

const VERT_PARS = /* glsl */`
attribute float aEggIdx;
attribute vec3 aEggSpent;
attribute vec3 aEggSpentNormal;
uniform float uEggFill[${BROOD_EGG_RACK}];
uniform vec3 uEggTint[${BROOD_EGG_RACK}];
varying vec3 vEggTint;
`;

const VERT_NORMAL = /* glsl */`
vEggTint = vec3(1.0);
if (aEggIdx >= 0.0) {
  int eggIndex = int(aEggIdx + 0.5);
  vEggTint = uEggTint[eggIndex];
  objectNormal = normalize(mix(aEggSpentNormal, objectNormal, uEggFill[eggIndex]));
}
`;

const VERT_POSITION = /* glsl */`
if (aEggIdx >= 0.0) {
  transformed = mix(aEggSpent, transformed, uEggFill[int(aEggIdx + 0.5)]);
}
`;

const FRAG_PARS = /* glsl */`varying vec3 vEggTint;`;
const FRAG_TINT = /* glsl */`diffuseColor.rgb *= vEggTint;`;

/**
 * The same position mix, for the shadow pass. Without it a collapsed sac goes
 * on casting a full egg's shadow onto her own back, which is exactly where the
 * camera is looking from.
 */
const DEPTH_PARS = /* glsl */`
attribute float aEggIdx;
attribute vec3 aEggSpent;
uniform float uEggFill[${BROOD_EGG_RACK}];
`;

/**
 * Fit the rack to a loaded `krykna_brood` model.
 *
 * Returns null when the sculpt is not one this understands — no skinned mesh,
 * no index buffer, or the six spheres finding nothing where the constants say
 * they are. The caller keeps its stand-in rack in that case.
 */
export function attachEggRack(model: THREE.Object3D): SculptRack | null {
  const mesh = biggestSkinnedMesh(model);
  if (!mesh) return null;
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const index = geo.getIndex();
  if (!pos || !nor || !index) return null;

  // Every clone of this model shares the file's own geometry, so the segment
  // work is done once and the second broodmother finds it already there.
  const cached = geo.getAttribute('aEggIdx');
  const owner = cached ? null : segment(geo);
  if (!cached && !owner) return null;
  if (owner) bake(geo, owner);

  // ...and so is the anchor scan, which is the same answer for every clone
  const eggs = (geo.userData.eggAnchors as Egg[] | undefined) ?? anchors(geo);
  if (eggs.length !== BROOD_EGG_RACK) return null;
  geo.userData.eggAnchors = eggs;

  // Uniforms live here, not on any one material: they outlive every material
  // the mesh wears, so the hurt flash can swap the material out and the rack
  // keeps its state without a frame of the wrong clutch.
  //
  // They start at the sculpt as delivered, which is the whole point of driving
  // its own eggs: a broodmother nobody is counting eggs for — the wave boss,
  // the character select, the workbench — is simply the model, untouched. Only
  // a rack somebody drives ever collapses one.
  const fill = { value: new Array<number>(BROOD_EGG_RACK).fill(1) };
  const tint = { value: Array.from({ length: BROOD_EGG_RACK }, () => READY_TINT.clone()) };
  const hooked = new WeakSet<THREE.Material>();

  const hook = (shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }): void => {
    shader.uniforms.uEggFill = fill;
    shader.uniforms.uEggTint = tint;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERT_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_POSITION}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_TINT}`);
  };

  // The shadow pass runs its own material, which knows nothing of the one
  // above: it needs the same collapse or the sac's shadow stays egg-shaped.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uEggFill = fill;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DEPTH_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_POSITION}`);
  };
  markOwned(depth);
  mesh.customDepthMaterial = depth;

  const refresh = (): void => {
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (hooked.has(m)) continue;
      // A material that arrived shared — the file's own, worn by every clone —
      // is copied first, or two queens on one board would share a clutch.
      const mine = m.userData?.shared ? markOwned(m.clone()) : m;
      mine.onBeforeCompile = hook;
      mine.needsUpdate = true;
      hooked.add(mine);
      if (mine !== m) {
        if (Array.isArray(mesh.material)) mesh.material[i] = mine;
        else mesh.material = mine;
      }
    }
  };
  refresh();

  return {
    count: eggs.length,
    setFill: (i, f) => { if (i >= 0 && i < eggs.length) fill.value[i] = f; },
    setTint: (i, c) => { if (i >= 0 && i < eggs.length) tint.value[i].copy(c); },
    shown: (i) => {
      const c = tint.value[i];
      if (!c) return null;
      return { fill: fill.value[i], shade: c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 };
    },
    spot: (i, out) => {
      const egg = eggs[i];
      if (!egg) return false;
      // the centre carried by the skin weights of the vertex nearest it, so a
      // sac on a walking queen reports where it actually is this frame
      out.copy(egg.centre);
      mesh.applyBoneTransform(egg.vertex, out);
      mesh.localToWorld(out);
      return true;
    },
    refresh,
  };
}

/** the body: on this sculpt there is exactly one skinned mesh, but be sure */
function biggestSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  const found: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (s.isSkinnedMesh && s.geometry?.getAttribute('position')) found.push(s);
  });
  let best: THREE.SkinnedMesh | null = null;
  for (const s of found) {
    if (!best || s.geometry.getAttribute('position').count > best.geometry.getAttribute('position').count) best = s;
  }
  return best;
}

/**
 * Which egg each vertex belongs to, or -1. The eggs stand a full radius clear
 * of one another's centres and of the abdomen except across their collars, so
 * "inside the nearest fitted sphere" is the whole rule.
 */
function segment(geo: THREE.BufferGeometry): Int32Array | null {
  const pos = geo.getAttribute('position');
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.x > 1e-6)) return null;

  const centres = EGG_SPHERES.map(([fx, fy, fz]) => new THREE.Vector3(
    box.min.x + fx * size.x, box.min.y + fy * size.y, box.min.z + fz * size.z,
  ));
  const radii = EGG_SPHERES.map(([, , , fr]) => fr * size.x);

  const owner = new Int32Array(pos.count).fill(NO_EGG);
  const counts = new Array<number>(BROOD_EGG_RACK).fill(0);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let best = NO_EGG;
    let bestD = Infinity;
    for (let e = 0; e < centres.length; e++) {
      const d = v.distanceTo(centres[e]) / radii[e];
      if (d < bestD) { bestD = d; best = e; }
    }
    if (bestD < EGG_SLACK) { owner[i] = best; counts[best]++; }
  }
  for (const n of counts) if (n < MIN_EGG_VERTS) return null;
  return owner;
}

/**
 * Write the spent pose into the geometry: for every egg vertex, where it sits
 * once the sac has collapsed, and the normal it wears there.
 *
 * The collar — the egg vertices that share a triangle with the abdomen — is
 * what the collapse is measured from. Its centroid is the sac's base and the
 * line from it to the egg's centre is the outward axis; the egg is squashed
 * towards that base along the axis and drawn in across it. Vertices on the
 * collar itself barely move, so the seam holds and the mesh does not open.
 */
function bake(geo: THREE.BufferGeometry, owner: Int32Array): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const index = geo.getIndex()!;

  const idx = new Float32Array(pos.count);
  const spent = new Float32Array(pos.count * 3);
  const spentN = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    idx[i] = owner[i];
    spent[i * 3] = pos.getX(i); spent[i * 3 + 1] = pos.getY(i); spent[i * 3 + 2] = pos.getZ(i);
    spentN[i * 3] = nor.getX(i); spentN[i * 3 + 1] = nor.getY(i); spentN[i * 3 + 2] = nor.getZ(i);
  }

  // the collar: an egg vertex in a triangle that is not wholly its own egg
  const collar: THREE.Vector3[][] = Array.from({ length: BROOD_EGG_RACK }, () => []);
  const centre: THREE.Vector3[] = Array.from({ length: BROOD_EGG_RACK }, () => new THREE.Vector3());
  const tally = new Array<number>(BROOD_EGG_RACK).fill(0);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const e = owner[i];
    if (e < 0) continue;
    centre[e].add(v.fromBufferAttribute(pos, i));
    tally[e]++;
  }
  for (let e = 0; e < BROOD_EGG_RACK; e++) centre[e].divideScalar(Math.max(tally[e], 1));

  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (owner[a] === owner[b] && owner[b] === owner[c]) continue;
    for (const i of [a, b, c]) {
      const e = owner[i];
      if (e >= 0) collar[e].push(new THREE.Vector3().fromBufferAttribute(pos, i));
    }
  }

  const base = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const u = new THREE.Vector3();
  const lat = new THREE.Vector3();
  for (let e = 0; e < BROOD_EGG_RACK; e++) {
    const ring = collar[e];
    base.set(0, 0, 0);
    for (const p of ring) base.add(p);
    if (ring.length) base.divideScalar(ring.length);
    // A collar so small that its centroid lands on the egg's own centre gives
    // no axis to squash along; fall back to the line out from the abdomen,
    // which is the direction every one of these eggs stands proud in anyway.
    axis.copy(centre[e]).sub(base);
    if (axis.lengthSq() < 1e-10) axis.copy(centre[e]).normalize();
    else axis.normalize();

    for (let i = 0; i < pos.count; i++) {
      if (owner[i] !== e) continue;
      u.fromBufferAttribute(pos, i).sub(base);
      const h = u.dot(axis);
      lat.copy(u).addScaledVector(axis, -h);
      lat.multiplyScalar(SPENT_WIDE).addScaledVector(axis, h * SPENT_FLAT).add(base);
      spent[i * 3] = lat.x; spent[i * 3 + 1] = lat.y; spent[i * 3 + 2] = lat.z;
    }
  }

  spentNormals(index, owner, spent, spentN);

  geo.setAttribute('aEggIdx', new THREE.BufferAttribute(idx, 1));
  geo.setAttribute('aEggSpent', new THREE.BufferAttribute(spent, 3));
  geo.setAttribute('aEggSpentNormal', new THREE.BufferAttribute(spentN, 3));
}

/**
 * Normals for the collapsed pose, accumulated over the egg triangles only.
 * A flattened sphere still wearing a sphere's normals lights like the egg that
 * is no longer there, which is the one thing a spent sac must not look like.
 */
function spentNormals(
  index: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  owner: Int32Array, spent: Float32Array, out: Float32Array,
): void {
  const touched = new Set<number>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const ia = index.getX(t), ib = index.getX(t + 1), ic = index.getX(t + 2);
    if (owner[ia] < 0 && owner[ib] < 0 && owner[ic] < 0) continue;
    for (const i of [ia, ib, ic]) {
      if (owner[i] < 0 || touched.has(i)) continue;
      touched.add(i);
      out[i * 3] = 0; out[i * 3 + 1] = 0; out[i * 3 + 2] = 0;
    }
  }
  for (let t = 0; t < index.count; t += 3) {
    const ia = index.getX(t), ib = index.getX(t + 1), ic = index.getX(t + 2);
    if (owner[ia] < 0 || owner[ib] < 0 || owner[ic] < 0) continue;
    a.fromArray(spent, ia * 3); b.fromArray(spent, ib * 3); c.fromArray(spent, ic * 3);
    n.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
    for (const i of [ia, ib, ic]) {
      out[i * 3] += n.x; out[i * 3 + 1] += n.y; out[i * 3 + 2] += n.z;
    }
  }
  for (const i of touched) {
    n.fromArray(out, i * 3);
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0); else n.normalize();
    out[i * 3] = n.x; out[i * 3 + 1] = n.y; out[i * 3 + 2] = n.z;
  }
}

/**
 * Each egg's centre and the vertex whose skin weights stand for it. The centre
 * is a point in the middle of a sphere, so it is on no bone of its own; the
 * nearest vertex's weights are what carry it through the pose.
 */
function anchors(geo: THREE.BufferGeometry): Egg[] {
  const pos = geo.getAttribute('position');
  const idx = geo.getAttribute('aEggIdx');
  if (!idx) return [];
  const sum = Array.from({ length: BROOD_EGG_RACK }, () => new THREE.Vector3());
  const tally = new Array<number>(BROOD_EGG_RACK).fill(0);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const e = Math.round(idx.getX(i));
    if (e < 0 || e >= BROOD_EGG_RACK) continue;
    sum[e].add(v.fromBufferAttribute(pos, i));
    tally[e]++;
  }
  const eggs: Egg[] = [];
  for (let e = 0; e < BROOD_EGG_RACK; e++) {
    if (!tally[e]) return [];
    const centre = sum[e].divideScalar(tally[e]);
    let vertex = 0;
    let best = Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.round(idx.getX(i)) !== e) continue;
      const d = v.fromBufferAttribute(pos, i).distanceToSquared(centre);
      if (d < best) { best = d; vertex = i; }
    }
    eggs.push({ centre, vertex });
  }
  return eggs;
}

/**
 * What sac `i` should be shaded, given the clutch's own reading of it:
 * < 0 spent, 0..1 the egg growing, >= 1 ready. Written into `out`.
 */
export function eggTint(state: number, fill: number, out: THREE.Color): THREE.Color {
  if (state >= FLASH_FROM && state < 1) {
    // the last beat of the charge: a couple of flashes, so a clutch about to
    // come up says so before it does
    const lit = Math.sin(((state - FLASH_FROM) / (1 - FLASH_FROM)) * Math.PI * FLASH_BEATS) > 0;
    return out.copy(lit ? CHARGE_LIT : CHARGE_DIM);
  }
  return out.copy(SPENT_TINT).lerp(READY_TINT, fill);
}
