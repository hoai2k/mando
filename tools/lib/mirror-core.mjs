/**
 * Which triangles to drop and which to mirror, for replacing one side of a
 * sculpt's lower body with a mirror of the other (see
 * tools/mirror-lower-body.mjs). Plain arrays in, plain arrays out, no Node or
 * three.js, so the candidate viewer runs exactly this code for its live
 * preview.
 *
 * positions: model-space xyz per vertex. joints/weights: four per vertex,
 * weights as 0..1 floats. jointNames: skin joint names without `DEF-`.
 * Params: centreX (mirror plane x = centreX), cutY, armX, back
 * ({ z, x, cutY }: a higher cut behind the body, near the middle).
 *
 * Returns indices (original vertices, then appended copies numbered from
 * count), sources (the original vertex each copy mirrors) and mirrorJoint.
 */
export const MIRROR_DEFAULTS = { centreX: 0, cutY: 0.13, armX: 0.19, back: null };
const MARGIN = 0.02;

export function planMirror({ positions, joints, weights, indices, jointNames }, params = {}) {
  const { centreX, cutY, armX, back } = { ...MIRROR_DEFAULTS, ...params };
  const n = positions.length / 3;
  const pos = (v, a) => positions[v * 3 + a];
  // the cut height at a point: optionally higher behind the body. `grow`
  // widens the back region (what is mirrored) or narrows it (what is dropped)
  // so the two overlap at its edges instead of leaving a gap.
  const cutAt = (x, z, grow = 0) => (back && z < back.z + grow && Math.abs(x - centreX) < back.x + grow ? back.cutY : cutY);

  const isArm = jointNames.map((nm) => /^(shoulder|upper_arm|forearm|hand)\./.test(nm));
  const swapSide = (nm) => nm.replace(/\.L(?=$|\.)/, '.__').replace(/\.R(?=$|\.)/, '.L').replace(/\.__/, '.R');
  const mirrorJoint = jointNames.map((nm) => {
    const k = jointNames.indexOf(swapSide(nm));
    if (k < 0) throw new Error(`no mirror bone for ${nm}`);
    return k;
  });
  const armWeight = (v) => {
    let sum = 0;
    for (let k = 0; k < 4; k++) if (isArm[joints[v * 4 + k]]) sum += weights[v * 4 + k];
    return sum;
  };

  // weld UV/normal seams so triangles that share a corner are connected
  const weld = new Int32Array(n);
  {
    const seen = new Map();
    for (let v = 0; v < n; v++) {
      const k = `${pos(v, 0)},${pos(v, 1)},${pos(v, 2)}`;
      if (!seen.has(k)) seen.set(k, seen.size);
      weld[v] = seen.get(k);
    }
  }
  const unionFind = (size) => {
    const parent = Int32Array.from({ length: size }, (_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const join = (a, b, c) => { const r = find(a); parent[find(b)] = r; parent[find(c)] = r; };
    return { find, join };
  };

  const triCount = indices.length / 3;
  const triVerts = (t) => [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
  const isArmy = (vs) => (armWeight(vs[0]) + armWeight(vs[1]) + armWeight(vs[2])) / 3 >= 0.5;

  // Arm-skinned triangles that join up with the arm above the cut are arm,
  // even inside armX (the inner face of a forearm hanging by the hip).
  const armReach = new Set();
  {
    const uf = unionFind(n);
    const armyTris = [];
    for (let t = 0; t < triCount; t++) {
      const vs = triVerts(t);
      if (!isArmy(vs)) continue;
      armyTris.push(t);
      uf.join(weld[vs[0]], weld[vs[1]], weld[vs[2]]);
    }
    const high = new Set();
    for (const t of armyTris) {
      const vs = triVerts(t);
      if (Math.min(...vs.map((v) => pos(v, 1))) >= cutY) high.add(uf.find(weld[vs[0]]));
    }
    for (const t of armyTris) if (high.has(uf.find(weld[indices[t * 3]]))) armReach.add(t);
  }

  // Seams overlap rather than meet: a replaced-side triangle is dropped only
  // when all its corners are past the plane and below the cut; a kept-side
  // one is mirrored when any corner is. Only body-skinned triangles are
  // copied: an arm-skinned one inside armX is a held prop or a shield edge.
  let keep = [];
  const mirrorTris = [];
  let dropped = 0;
  for (let t = 0; t < triCount; t++) {
    const vs = triVerts(t);
    const xs = vs.map((v) => pos(v, 0));
    const rel = (grow) => vs.map((v) => pos(v, 1) - cutAt(pos(v, 0), pos(v, 2), grow));
    const cx = (xs[0] + xs[1] + xs[2]) / 3;
    const army = isArmy(vs);
    const arm = army && (Math.abs(cx - centreX) > armX || armReach.has(t));
    if (!arm && Math.max(...xs) < centreX && Math.max(...rel(-MARGIN)) < 0) { dropped++; continue; }
    keep.push(...vs);
    if (!army && Math.max(...xs) > centreX && Math.min(...rel(MARGIN)) < 0) mirrorTris.push(vs);
  }

  // Weapon parts skinned to the hand survive as loose slivers once the body
  // round them is gone: drop small islands wholly on the replaced side.
  let loose = 0;
  {
    const uf = unionFind(n);
    for (let i = 0; i < keep.length; i += 3) uf.join(weld[keep[i]], weld[keep[i + 1]], weld[keep[i + 2]]);
    const islands = new Map();
    for (let i = 0; i < keep.length; i += 3) {
      const r = uf.find(weld[keep[i]]);
      const g = islands.get(r) ?? { tris: 0, inside: true };
      g.tris++;
      for (let k = 0; k < 3; k++) {
        const v = keep[i + k];
        if (pos(v, 0) >= centreX || pos(v, 1) >= cutAt(pos(v, 0), pos(v, 2), -MARGIN)) g.inside = false;
      }
      islands.set(r, g);
    }
    const small = keep.length / 3 * 0.02;
    const gone = new Set([...islands].filter(([, g]) => g.inside && g.tris < small).map(([r]) => r));
    loose = gone.size;
    if (loose) {
      const kept = [];
      for (let i = 0; i < keep.length; i += 3) {
        if (gone.has(uf.find(weld[keep[i]]))) { dropped++; continue; }
        kept.push(keep[i], keep[i + 1], keep[i + 2]);
      }
      keep = kept;
    }
  }

  // each kept-side vertex is copied once; copies get reversed winding
  const copyOf = new Map();
  const sources = [];
  for (const vs of mirrorTris) for (const v of vs) if (!copyOf.has(v)) { copyOf.set(v, n + sources.length); sources.push(v); }
  for (const vs of mirrorTris) keep.push(copyOf.get(vs[0]), copyOf.get(vs[2]), copyOf.get(vs[1]));
  return { indices: keep, sources, mirrorJoint, dropped, mirrored: mirrorTris.length, loose };
}
