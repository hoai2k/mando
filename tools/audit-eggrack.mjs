/**
 * Re-measure the broodmother's clutch off the shipped sculpt.
 *
 * `src/characters/eggrack.ts` drives the six eggs `krykna_brood.glb` carries on
 * its abdomen — the game darkens and collapses the model's own geometry rather
 * than laying beads over it — and it finds them by six constants: a centre and
 * a radius each, as fractions of the mesh's bounding box. Constants like that
 * are only as good as the file they were measured from, and nothing at runtime
 * can tell a rack that has drifted onto the abdomen from one that is on the
 * eggs. This re-derives them from the .glb and fails if they have moved.
 *
 * How the eggs are found, with no help from the constants:
 *
 * 1. **Sphere voting.** Every vertex on the rear of the body votes for the
 *    centre of a sphere of radius r that it could lie on — `p - n * r`. The
 *    eggs are near-perfect spheres, so their vertices all vote for the same
 *    point and stand out of the noise; the abdomen, being much larger, does
 *    not. Six peaks come out, at r ≈ 0.056 of the model's width.
 * 2. **Least squares.** Each peak seeds an algebraic sphere fit over the
 *    vertices near its shell whose normals point away from it, iterated until
 *    the centre and radius stop moving.
 *
 * Run:  node tools/audit-eggrack.mjs
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readGlb } from './lib/glb.mjs';

const require_ = createRequire(import.meta.url);
const THREE = require_('three');

const MODEL = new URL('../public/models/krykna_brood.glb', import.meta.url).pathname;
const SOURCE = new URL('../src/characters/eggrack.ts', import.meta.url).pathname;

/** how far a measured egg may sit from the constant, as a fraction of the box */
const TOLERANCE = 0.004;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

/** the EGG_SPHERES literal, read out of the module that uses it */
function declared() {
  const src = readFileSync(SOURCE, 'utf8');
  const block = src.match(/const EGG_SPHERES[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!block) throw new Error('EGG_SPHERES not found in src/characters/eggrack.ts');
  return [...block[1].matchAll(/\[([^\]]+)\]/g)]
    .map((m) => m[1].split(',').map((v) => Number(v.trim())));
}

const glb = await readGlb(MODEL);
const { primitives, world } = glb.skinnedPrimitives();
const prim = primitives[0];
if (!prim) throw new Error('no skinned primitive in krykna_brood.glb');

const P = prim.positions;
const count = prim.count;
// normals arrive quantised in the node's own frame; put them in the same space
// as the positions the reader already de-quantised
const nAcc = glb.accessor(glb.json.meshes[0].primitives[0].attributes.NORMAL);
const basis = new THREE.Matrix3().setFromMatrix4(world[0]);
const N = new Float64Array(count * 3);
const tmp = new THREE.Vector3();
for (let i = 0; i < count; i++) {
  tmp.set(nAcc.array[i * 3], nAcc.array[i * 3 + 1], nAcc.array[i * 3 + 2]).applyMatrix3(basis).normalize();
  N[i * 3] = tmp.x; N[i * 3 + 1] = tmp.y; N[i * 3 + 2] = tmp.z;
}

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < count; i++) {
  for (let k = 0; k < 3; k++) {
    if (P[i * 3 + k] < min[k]) min[k] = P[i * 3 + k];
    if (P[i * 3 + k] > max[k]) max[k] = P[i * 3 + k];
  }
}
const size = max.map((v, k) => v - min[k]);

/** step 1: the peaks of the vote, at the radius the eggs actually are */
function vote(radius, bin = 0.008) {
  const acc = new Map();
  for (let i = 0; i < count; i++) {
    if (P[i * 3 + 2] > min[2] + size[2] * 0.4) continue;      // the rear, where the clutch is
    const c = [0, 1, 2].map((k) => P[i * 3 + k] - N[i * 3 + k] * radius);
    const key = c.map((v) => Math.round(v / bin)).join(',');
    const e = acc.get(key) ?? { n: 0, c: [0, 0, 0] };
    e.n++;
    for (let k = 0; k < 3; k++) e.c[k] += c[k];
    acc.set(key, e);
  }
  return [...acc.values()]
    .sort((a, b) => b.n - a.n)
    .map((e) => ({ n: e.n, c: e.c.map((v) => v / e.n) }));
}

/** peaks far enough apart to be different eggs */
function peaks(radius, want) {
  const out = [];
  for (const p of vote(radius)) {
    if (out.some((q) => dist(q, p.c) < radius * 1.2)) continue;
    out.push(p.c);
    if (out.length === want) break;
  }
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** step 2: least-squares sphere through the vertices on this shell */
function refit(centre, radius) {
  let c = centre.slice();
  let r = radius;
  for (let pass = 0; pass < 12; pass++) {
    const members = [];
    for (let i = 0; i < count; i++) {
      const d = [0, 1, 2].map((k) => P[i * 3 + k] - c[k]);
      const len = Math.hypot(...d);
      if (Math.abs(len - r) > r * 0.32) continue;
      const facing = (d[0] * N[i * 3] + d[1] * N[i * 3 + 1] + d[2] * N[i * 3 + 2]) / len;
      if (facing < 0.8) continue;                             // the shell, not what it sits on
      members.push(i);
    }
    if (members.length < 30) return null;
    const mean = [0, 1, 2].map((k) => members.reduce((s, i) => s + P[i * 3 + k], 0) / members.length);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const rhs = [0, 0, 0];
    for (const i of members) {
      const d = [0, 1, 2].map((k) => P[i * 3 + k] - mean[k]);
      const sq = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) M[a][b] += d[a] * d[b];
        rhs[a] += sq * d[a];
      }
    }
    const mat = new THREE.Matrix3().set(
      M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2],
    );
    const sol = new THREE.Vector3(rhs[0], rhs[1], rhs[2]).applyMatrix3(mat.invert()).multiplyScalar(0.5);
    c = [sol.x + mean[0], sol.y + mean[1], sol.z + mean[2]];
    r = members.reduce((s, i) => s + Math.hypot(...[0, 1, 2].map((k) => P[i * 3 + k] - c[k])), 0) / members.length;
  }
  return { c, r };
}

// The vote's own answer for the radius: whichever candidate makes the sharpest
// peaks is the one the eggs actually are.
let best = { radius: 0, score: 0 };
for (let r = 0.03; r <= 0.09; r += 0.005) {
  const score = vote(r * size[0] / 1.0).slice(0, 6).reduce((s, p) => s + p.n, 0);
  if (score > best.score) best = { radius: r * size[0], score };
}

const found = peaks(best.radius, 6)
  .map((c) => refit(c, best.radius))
  .filter(Boolean)
  .map(({ c, r }) => [
    (c[0] - min[0]) / size[0], (c[1] - min[1]) / size[1], (c[2] - min[2]) / size[2], r / size[0],
  ])
  // The same order the module keeps them in: bottom-up, and left to right
  // across a row. The rows are a good deal further apart than the pair within
  // one, so half a percent of the box's height is what separates them.
  .sort((a, b) => (Math.abs(a[1] - b[1]) > 0.005 ? a[1] - b[1] : a[0] - b[0]));

const want = declared();
console.log(`measured ${found.length} eggs in krykna_brood.glb (${count} verts, box ${size.map((v) => v.toFixed(3)).join(' x ')})`);
check('the sculpt still carries six eggs', found.length === want.length,
  `${found.length} found, ${want.length} declared`);

for (let i = 0; i < Math.min(found.length, want.length); i++) {
  const off = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(found[i][k] - want[i][k])));
  check(`egg ${i} is where eggrack.ts says it is`, off < TOLERANCE,
    `[${found[i].map((v) => v.toFixed(5)).join(', ')}] vs [${want[i].map((v) => v.toFixed(5)).join(', ')}] — off by ${off.toFixed(5)}`);
}

if (failures.length) {
  console.log('\nThe sculpt has moved under the rack. Replace EGG_SPHERES in');
  console.log('src/characters/eggrack.ts with the measured values above.');
}
console.log(failures.length ? `\n${failures.length} FAILED` : '\nthe clutch is where the rack looks for it');
process.exit(failures.length ? 1 : 0);
