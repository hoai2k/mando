/**
 * Give an already-delivered creature sculpt a working jaw, without touching
 * the file on disk.
 *
 * Every monster boss shipped a skinned `jaw` joint because its brief asked for
 * one, and the code gapes it on every bite. The three oldest creature rigs —
 * the massiff and the two spiders — were rigged before that was asked for, so
 * their mouths are welded shut. Re-exporting them is one option; this is the
 * other, and it needs no new art and no new sculpt: **the bone is added at
 * load time**, exactly as `skinfix` re-weights a leaking skirt panel at load
 * time, and the file stays as delivered.
 *
 * This tool does the offline half. It reads the .glb, picks the vertices that
 * belong to the lower jaw (or to a spider's fangs), and writes the bone and
 * those weights to `public/models/jawrig/<id>.json`. `src/characters/jawrig.ts`
 * is the runtime half that applies it.
 *
 * **Why the selection is geometric rather than clever.** There is no jaw in
 * the file to find, so the mouth line has to be described. Each entry below
 * names the skull bone the new jaw hangs from, the bones whose weight it may
 * take, and a cutting plane through the head: everything on the far side of
 * that plane is jaw, feathered over a band so the corner of the mouth bends
 * instead of tearing. The numbers are in the model's own rest units and were
 * read off the sculpt (`--inspect`), then checked by opening the jaw in game.
 *
 * **Only the massiff is done here.** The two spiders want spreading fangs
 * rather than a hinged jaw, and their mouthparts are a few centimetres across
 * on a body you fight at running speed — the selection is far harder to get
 * right and there is almost nothing to see for it, so they stay a re-export
 * request in `docs/ASSETS_MODELS.md`.
 *
 * Run:  node tools/jaw-rig.mjs            # write every rig
 *       node tools/jaw-rig.mjs --inspect  # print the head measurements instead
 */
import * as THREE from 'three';
import { readGlb } from './lib/glb.mjs';
import { mkdirSync, writeFileSync } from 'fs';

/**
 * `plane`: a point and a normal in rest-space model units. Weight is 1 where a
 * vertex sits a full `feather` behind the plane and ramps to 0 at it, so the
 * hinge end of the jaw blends into the skull the way a real weight map does.
 * `limit` keeps the selection in front of the hinge, so the throat and neck
 * stay with the head.
 */
const RIGS = [
  {
    id: 'massiff',
    bone: 'jaw',
    // The Rigify chain runs DEF-spine.004 (neck) forward to DEF-spine.011
    // (snout tip); .010 is the skull, and the jaw hinges off it.
    parent: 'DEF-spine.010',
    from: ['DEF-spine.009', 'DEF-spine.010', 'DEF-spine.011'],
    // the mouth line, and the muzzle axis: the head is carried low and
    // forward, so the plane is tilted to follow it rather than cut level
    plane: { point: [0, 0.012, 0.38], normal: [0, 0.97, 0.24] },
    feather: 0.028,
    limit: { axis: 2, min: 0.352 },
    /**
     * Where the hinge sits, as a point in the model's own rest space — the
     * same space every other number here is in, so it can be read off the
     * sculpt. It is converted into the parent bone's local space on the way
     * out, which is what a bone's `position` actually means.
     */
    hinge: [0, 0.012, 0.365],
  },
];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };

function headStats(prim, fromSlots) {
  const sel = [];
  for (let v = 0; v < prim.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (fromSlots.includes(prim.joints[v * 4 + k])) w += prim.weights[v * 4 + k];
    if (w > 0.5) sel.push(v);
  }
  const box = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const v of sel) for (let i = 0; i < 3; i++) {
    box.min[i] = Math.min(box.min[i], prim.positions[v * 3 + i]);
    box.max[i] = Math.max(box.max[i], prim.positions[v * 3 + i]);
  }
  return { sel, box };
}

async function build(cfg, inspect) {
  const g = await readGlb(`public/models/${cfg.id}.glb`);
  const { primitives, world } = g.skinnedPrimitives();
  const prim = primitives[0];
  if (!prim) throw new Error(`${cfg.id}: no skinned primitive`);
  const fromSlots = cfg.from.map((n) => prim.jointNames.indexOf(n)).filter((i) => i >= 0);
  if (!fromSlots.length) throw new Error(`${cfg.id}: none of ${cfg.from} is a joint`);
  const { sel, box } = headStats(prim, fromSlots);

  if (inspect) {
    console.log(`\n== ${cfg.id} ==`);
    console.log('  joints:', prim.jointNames.length, ' verts:', prim.count, ' head verts:', sel.length);
    console.log('  head box min', box.min.map((v) => +v.toFixed(4)).join(' '), ' max', box.max.map((v) => +v.toFixed(4)).join(' '));
    return null;
  }

  const n = norm3(cfg.plane.normal);
  const d0 = dot(n, cfg.plane.point);
  const vertices = [];
  for (const v of sel) {
    const p = [prim.positions[v * 3], prim.positions[v * 3 + 1], prim.positions[v * 3 + 2]];
    if (cfg.limit && p[cfg.limit.axis] < cfg.limit.min) continue;
    // signed distance below the mouth plane, ramped over the feather band
    const below = d0 - dot(n, p);
    if (below <= 0) continue;
    const w = Math.min(1, below / cfg.feather);
    // a smoothstep, so the corner of the mouth eases instead of creasing
    const weight = w * w * (3 - 2 * w);
    if (weight > 0.02) vertices.push([v, +weight.toFixed(3)]);
  }

  // The hinge is authored in rest space; a bone's position is relative to its
  // parent. Writing the first into the second put the massiff's jaw pivot a
  // third of a body away and its bite tore the whole underside off.
  const parentNode = prim.skinJoints.find((n) => g.json.nodes[n].name === cfg.parent);
  if (parentNode === undefined) throw new Error(`${cfg.id}: no joint named ${cfg.parent}`);
  const local = new THREE.Vector3(...cfg.hinge)
    .applyMatrix4(new THREE.Matrix4().copy(world[parentNode]).invert());

  const doc = {
    format: 'jawrig-1',
    model: cfg.id,
    note: 'generated by tools/jaw-rig.mjs; applied at load by src/characters/jawrig.ts',
    bone: { name: cfg.bone, parent: cfg.parent, translation: [local.x, local.y, local.z] },
    mirror: cfg.mirror ? { name: cfg.mirror, translation: [-local.x, local.y, local.z] } : null,
    mesh: { vertexCount: prim.count },
    vertices,
  };
  mkdirSync('public/models/jawrig', { recursive: true });
  writeFileSync(`public/models/jawrig/${cfg.id}.json`, JSON.stringify(doc));
  console.log(`${cfg.id}: hinge local [${[local.x, local.y, local.z].map((v) => v.toFixed(4))}]`);
  console.log(`${cfg.id}: ${vertices.length} vertices onto '${cfg.bone}' under ${cfg.parent}` +
    (cfg.mirror ? ` (+ ${cfg.mirror})` : '') + `, of ${sel.length} in the head`);
  return doc;
}

const inspect = process.argv.includes('--inspect');
const built = [];
for (const cfg of RIGS) {
  try { if (await build(cfg, inspect)) built.push(cfg.id); }
  catch (err) { console.warn(`${cfg.id}: ${err.message}`); }
}
if (!inspect) {
  mkdirSync('public/models/jawrig', { recursive: true });
  writeFileSync('public/models/jawrig/index.json', JSON.stringify({ models: built }));
  console.log('index:', built.join(', '));
}
