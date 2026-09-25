/**
 * Repair Maul's split elbow shells and chest details without changing his GLB.
 * Run after fix-sith-skirts.mjs; the runtime applies all three fixes in order.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { readGlb } from './lib/glb.mjs';

const path = 'public/models/skinfix/maul.json';
const doc = JSON.parse(readFileSync(path, 'utf8'));
const { primitives, world } = await readGlb('public/models/maul.glb').skinnedPrimitives();
if (primitives.length !== 1) throw new Error('Maul: expected one skinned primitive');
const p = primitives[0];
if (p.count !== 22933) throw new Error(`Maul mesh changed: ${p.count} vertices`);
const names = p.jointNames.map((n) => n.replace(/^DEF-/, ''));
const joint = (name) => {
  const i = names.indexOf(name);
  if (i < 0) throw new Error(`Maul bone missing: ${name}`);
  return i;
};
const pos = (i) => [p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const weights = (i) => {
  const out = new Map();
  for (let k = 0; k < 4; k++) {
    const w = p.weights[i * 4 + k];
    if (w > 0) out.set(p.joints[i * 4 + k], (out.get(p.joints[i * 4 + k]) ?? 0) + w);
  }
  return out;
};
const packed = (map) => {
  const entries = [...map].filter(([, w]) => w > 1e-5).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = entries.reduce((n, [, w]) => n + w, 0);
  const rounded = entries.map(([, w]) => +(w / sum).toFixed(6));
  rounded[rounded.length - 1] = +(1 - rounded.slice(0, -1).reduce((a, b) => a + b, 0)).toFixed(6);
  return { joints: entries.map(([i]) => i), weights: rounded };
};
const mesh = { node: p.nodeIndex, mesh: p.meshIndex, primitive: p.primIndex, vertexCount: p.count };

// Weld UV-split points before finding connected pieces. The upper-arm skins
// and forearm/gauntlet skins are disconnected shells in one GLB primitive.
const welded = new Map(), point = new Int32Array(p.count), parent = [];
for (let i = 0; i < p.count; i++) {
  const key = pos(i).map((n) => Math.round(n * 1e4)).join(',');
  let id = welded.get(key);
  if (id === undefined) { id = parent.length; welded.set(key, id); parent.push(id); }
  point[i] = id;
}
const root = (start) => {
  let i = start;
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
};
for (let i = 0; i < p.indices.length; i += 3) {
  const a = root(point[p.indices[i]]);
  parent[root(point[p.indices[i + 1]])] = a;
  parent[root(point[p.indices[i + 2]])] = a;
}
const byRoot = new Map();
for (let i = 0; i < p.count; i++) {
  const id = root(point[i]);
  if (!byRoot.has(id)) byRoot.set(id, []);
  byRoot.get(id).push(i);
}
const shells = [...byRoot.values()].sort((a, b) => b.length - a.length);
const bySize = (size) => {
  const shell = shells.find((s) => s.length === size);
  if (!shell) throw new Error(`Maul shell of ${size} vertices missing`);
  return shell;
};

// At the bind pose the upper and lower arm rims nearly meet. One rim follows
// upper_arm, the other forearm, so bending pulls them several centimetres
// apart. Give both rims the *same* 50/50 upper/forearm blend, fading to the
// file's original weights before leaving the elbow. Include Rigify's twist
// bones in that shared blend to avoid a new seam within either shell.
const elbowVertices = [], elbowReplacements = {};
for (const side of ['L', 'R']) {
  const upperShell = bySize(side === 'L' ? 431 : 482);
  const lowerShell = bySize(side === 'L' ? 2282 : 2169);
  const elbowBone = p.skinJoints[joint(`forearm.${side}`)];
  const m = world[elbowBone].elements;
  const elbow = [m[12], m[13], m[14]];
  const canonical = new Map([
    [joint(`upper_arm.${side}`), 0.10], [joint(`upper_arm.${side}.001`), 0.40],
    [joint(`forearm.${side}`), 0.40], [joint(`forearm.${side}.001`), 0.10],
  ]);
  for (const i of [...upperShell, ...lowerShell]) {
    const r = distance(pos(i), elbow);
    if (r >= 0.10) continue;
    const amount = r <= 0.06 ? 1 : (0.10 - r) / 0.04;
    const mixed = new Map();
    for (const [bone, w] of weights(i)) mixed.set(bone, (mixed.get(bone) ?? 0) + w * (1 - amount));
    for (const [bone, w] of canonical) mixed.set(bone, (mixed.get(bone) ?? 0) + w * amount);
    elbowVertices.push(i);
    elbowReplacements[i] = packed(mixed);
  }
}
elbowVertices.sort((a, b) => a - b);

const isArm = (name) => /^(upper_arm|forearm|hand)\./.test(name);
const armWeight = (i) => [...weights(i)].reduce((sum, [bone, w]) => sum + (isArm(names[bone]) ? w : 0), 0);
const torsoShells = shells.filter((shell) => {
  if (shell.length < 80 || shell.length > 250) return false;
  const coords = shell.map(pos);
  const maxX = Math.max(...coords.map((v) => Math.abs(v[0])));
  const minY = Math.min(...coords.map((v) => v[1]));
  const maxY = Math.max(...coords.map((v) => v[1]));
  const arm = shell.reduce((sum, i) => sum + armWeight(i), 0) / shell.length;
  return maxX < 0.10 && minY > 0.09 && maxY < 0.22 && arm > 0.03;
});
const sizes = torsoShells.map((s) => s.length).sort((a, b) => b - a);
if (JSON.stringify(sizes) !== JSON.stringify([174, 164, 148, 122, 88]))
  throw new Error(`Maul torso details changed: ${sizes}`);

// The torso pieces should follow the jacket, never the nearby arms. Borrow
// weights from the closest certain torso point, rather than pinning them all
// to one bone and making a new crease at the ribs.
const torsoBones = new Set(['spine.002', 'spine.003', 'spine.004']);
const donors = [...bySize(2421), ...bySize(7255)].filter((i) => {
  const [x, y] = pos(i);
  const w = weights(i);
  const torso = [...w].reduce((n, [bone, v]) => n + (torsoBones.has(names[bone]) ? v : 0), 0);
  return Math.abs(x) < 0.11 && y > 0.09 && y < 0.22 && torso > 0.85 && armWeight(i) < 0.02;
});
if (donors.length < 50) throw new Error(`Maul: only ${donors.length} certain torso donors`);
const torsoVertices = torsoShells.flat().sort((a, b) => a - b), torsoReplacements = {};
for (const i of torsoVertices) {
  let best = -1, bestD = Infinity;
  for (const d of donors) {
    const dist = distance(pos(i), pos(d));
    if (dist < bestD) { best = d; bestD = dist; }
  }
  torsoReplacements[i] = packed(weights(best));
}

doc.fixes = doc.fixes.filter((fix) => !fix.id.startsWith('maul/elbow-') && fix.id !== 'maul/chest-details-follow-torso');
doc.fixes.push({
  id: 'maul/elbow-shells-blend', kind: 'elbow-shells-split',
  title: 'Upper arms and forearms meet through the elbow bend', confidence: 'high', status: 'applied',
  region: 'arms', foreign: 'upper-arm/forearm seam',
  stats: { vertices: elbowVertices.length, maxDragCm: 0, meanDragCm: 0, meanForeignWeight: 0,
    heightBand: [1.1, 1.6], donors: 0 },
  removeBones: [], mesh, vertices: elbowVertices, donors: {}, replacements: elbowReplacements,
});
doc.fixes.push({
  id: 'maul/chest-details-follow-torso', kind: 'arm-drives-torso',
  title: 'Chest details remain attached to the jacket', confidence: 'high', status: 'applied',
  region: 'torso', foreign: 'armL+armR',
  stats: { vertices: torsoVertices.length, maxDragCm: 0, meanDragCm: 0,
    meanForeignWeight: +(torsoVertices.reduce((sum, i) => sum + armWeight(i), 0) / torsoVertices.length).toFixed(3),
    heightBand: [1.0, 1.6], donors: donors.length },
  removeBones: names.filter(isArm), mesh, vertices: torsoVertices, donors: {}, replacements: torsoReplacements,
});
doc.note = 'Lower cloth fix from fix-sith-skirts.mjs; elbow and chest fixes from fix-maul-arms.mjs.';
writeFileSync(path, JSON.stringify(doc));
console.log(`Maul: blended ${elbowVertices.length} elbow vertices, reweighted ${torsoVertices.length} chest vertices`);
