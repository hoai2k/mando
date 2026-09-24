/**
 * Reweight Jedi's hanging skirt panels without changing the source GLB.
 *
 * The delivered mesh gives much of the hem 70–85% hand/forearm weight. The
 * skirt is part of the torso shell, while the trousers are a separate shell.
 * Starting at the misweighted hem and walking mesh edges below the waist
 * selects both skirt panels without selecting the hands beside them.
 *
 * Usage: node tools/fix-jedi-skirt.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readGlb } from './lib/glb.mjs';

const model = 'jedi';
const { primitives } = await readGlb(`public/models/${model}.glb`).skinnedPrimitives();
const prim = primitives.find((p) => p.jointNames.includes('DEF-hand.L'));
if (!prim) throw new Error('Jedi skinned mesh was not found');
const names = prim.jointNames.map((n) => n.replace(/^DEF-/, ''));
const joint = (name) => {
  const i = names.indexOf(name);
  if (i < 0) throw new Error(`Missing Jedi joint ${name}`);
  return i;
};
const pelvis = joint('pelvis.L');
const thighL = joint('thigh.L');
const thighR = joint('thigh.R');
const isArm = (name) => /^(upper_arm|forearm|hand)\./.test(name);
const isBody = (name) => /^(spine|pelvis|thigh)($|\.)/.test(name);
const coord = (v, axis) => prim.positions[v * 3 + axis];
const armWeight = (v) => {
  let sum = 0;
  for (let k = 0; k < 4; k++) if (isArm(names[prim.joints[v * 4 + k]])) sum += prim.weights[v * 4 + k];
  return sum;
};

// Weld UV and normal seams before following triangle edges.
const points = [];
const byPosition = new Map();
const pointOf = new Int32Array(prim.count);
for (let v = 0; v < prim.count; v++) {
  const x = coord(v, 0), y = coord(v, 1), z = coord(v, 2);
  const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  let p = byPosition.get(key);
  if (p === undefined) {
    p = points.length;
    byPosition.set(key, p);
    points.push({ x, y, vertices: [], neighbours: new Set() });
  }
  pointOf[v] = p;
  points[p].vertices.push(v);
}
for (let i = 0; i < prim.indices.length; i += 3) {
  const triangle = [pointOf[prim.indices[i]], pointOf[prim.indices[i + 1]], pointOf[prim.indices[i + 2]]];
  for (let k = 0; k < 3; k++) {
    points[triangle[k]].neighbours.add(triangle[(k + 1) % 3]);
    points[triangle[k]].neighbours.add(triangle[(k + 2) % 3]);
  }
}

const seeds = [];
for (let p = 0; p < points.length; p++) {
  const point = points[p];
  if (point.y < -0.22 && Math.abs(point.x) > 0.075 && Math.abs(point.x) < 0.19 &&
      armWeight(point.vertices[0]) > 0.4) seeds.push(p);
}
if (seeds.length < 50) throw new Error(`Unexpected Jedi skirt seeds: ${seeds.length}`);
const selected = new Set(seeds);
const stack = [...seeds];
while (stack.length) {
  const p = stack.pop();
  for (const next of points[p].neighbours) {
    const q = points[next];
    if (selected.has(next) || q.y >= 0.12 || Math.abs(q.x) >= 0.195) continue;
    selected.add(next);
    stack.push(next);
  }
}
const vertices = [...selected].flatMap((p) => points[p].vertices).sort((a, b) => a - b);
if (vertices.length < 1200 || vertices.length > 2200) {
  throw new Error(`Unexpected Jedi skirt selection: ${vertices.length} vertices`);
}

const replacements = {};
let originalArmWeight = 0;
for (const v of vertices) {
  const y = coord(v, 1);
  const thigh = coord(v, 0) >= 0 ? thighL : thighR;
  // The top stays with the waist. Below it, progressively follow the thigh.
  const t = Math.max(0, Math.min(1, (0.10 - y) / 0.32));
  const thighMix = t * t * (3 - 2 * t);
  const base = new Map();
  for (let k = 0; k < 4; k++) {
    const j = prim.joints[v * 4 + k], weight = prim.weights[v * 4 + k];
    if (isArm(names[j])) originalArmWeight += weight;
    if (isBody(names[j])) base.set(j, (base.get(j) ?? 0) + weight);
  }
  if (!base.size) base.set(pelvis, 1);
  const baseSum = [...base.values()].reduce((sum, weight) => sum + weight, 0);
  const output = new Map([[thigh, thighMix]]);
  for (const [j, weight] of base) output.set(j, (output.get(j) ?? 0) + (1 - thighMix) * weight / baseSum);
  const slots = [...output].filter(([, weight]) => weight > 1e-5)
    .sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = slots.reduce((total, [, weight]) => total + weight, 0);
  replacements[v] = {
    joints: slots.map(([j]) => j),
    weights: slots.map(([, weight]) => +((weight / sum).toFixed(6))),
  };
}

const fix = {
  id: 'jedi/skirt-follows-thighs', kind: 'skirt-follows-thighs',
  title: 'Skirt panels follow the waist and thighs', confidence: 'high', status: 'applied',
  region: 'lower', foreign: 'armL+armR',
  stats: { vertices: vertices.length, maxDragCm: 0, meanDragCm: 0,
    meanForeignWeight: +(originalArmWeight / vertices.length).toFixed(3),
    heightBand: [0.19, 0.62], donors: 0 },
  removeBones: names.filter(isArm),
  mesh: { node: prim.nodeIndex, mesh: prim.meshIndex, primitive: prim.primIndex, vertexCount: prim.count },
  vertices, donors: {}, replacements,
};
const doc = { format: 'mando-skinfix/1', model, heightM: 1.82,
  note: 'Generated by tools/fix-jedi-skirt.mjs from the delivered Jedi GLB.', fixes: [fix] };
writeFileSync(`public/models/skinfix/${model}.json`, JSON.stringify(doc));
const indexPath = 'public/models/skinfix/index.json';
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
index.models = [...new Set([...index.models, model])].sort();
writeFileSync(indexPath, JSON.stringify(index));
console.log(`Jedi skirt: ${vertices.length} vertices; original arm influence ${(originalArmWeight / vertices.length * 100).toFixed(1)}% average`);
