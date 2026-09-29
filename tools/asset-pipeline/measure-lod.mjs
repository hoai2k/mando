/**
 * Measure the low-LOD stand-ins off the authored models.
 *
 * Every procedural stand-in in the game — a character still downloading, the
 * workbench's "Procedural" view, a `authored: false` build — is built from
 * `src/characters/data/lod.json`, and this is what writes it. It serves the
 * repo with Vite, opens `measure-lod.html` in Chromium, and that page loads
 * each .glb through the game's own loaders (so every model is measured in
 * exactly the frame, size and rest pose the game shows it in) and reduces it
 * to a handful of boxes per bone:
 *
 *   chars      the rig measured off the authored skeleton (canonical
 *              Proportions) and, per canonical bone, boxes around the
 *              vertices that bone drives, in the frame of that bone on a rig
 *              built with those proportions
 *   creatures  the sculpt's own skeleton (so the code-built gaits run on the
 *              stand-in exactly as on the sculpt) and boxes per bone
 *   props      weapons and vehicles: boxes in the frame `loadProp` fits them in
 *
 * Re-run it whenever a model, its fitted height or a weapon length changes:
 *
 *   CHROMIUM_PATH=... node tools/asset-pipeline/measure-lod.mjs [id,id,...]
 *
 * With ids, only those entries are re-measured and merged into the file. It
 * ends with a table of every model's solid volume against its stand-in's box
 * volume and height, now and as the file had them (LOD_STATS=path.json keeps
 * the same as JSON).
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { loadPlaywright } from '../harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'src/characters/data/lod.json');
const AUDIT = join(ROOT, 'docs/audits/rig-joints.md');
const only = process.argv[2] ?? null;

/**
 * The closing section of the audit: what fixing the rigs would take. Kept
 * here, not hand-edited into the report, so a re-run does not lose it.
 */
const FEASIBILITY = `## Fixing the GLB rigs: feasibility

**Verdict: assisted, yes; fully automatic, no.** A tool can safely *move* the flagged limb joints and re-bind
the skin to them without touching a single vertex or weight; it should not also re-weight the skin, and a person
should look at every model it changes before it ships.

**What the audit says.** The pattern is systematic, not random: on nearly every sculpt the elbows, wrists and
ankles sit 5-10 cm off the limb's centre line (typically behind the elbow, and to one side of the ankle), which is
what an auto-rigger fitting a template skeleton to an A-pose mesh does. Drawn over the models
(\`show-joints.mjs\`) the worst cases are unmistakable: Ventress's elbows and wrists sit in the air beside her
forearms, the escort droid's, Revan's, the ring enforcer's and the Wookiee's limb joints are 12-22 cm out. The
measured skeletons also carry a few oddities of their own (see the per-model tables): Boba Fett's spine chain is
almost all "chest" (spine 5.6 cm, chest 47 cm, neck 6.6 cm, shoulders *below* the chest joint), Din's thigh bone is
short against his shin (30 cm / 50 cm), several rigs put the hip joints above the pelvis bone (negative hip drop), and
on Ventress, Embo and both Pykes no vertex is dominated by a hand bone at all.

**What a re-bind involves.** Skinning is \`v' = sum_i w_i * J_i * IBM_i * v\`, and in the bind pose
\`J_i * IBM_i\` is the identity. Moving joint *i* to a better spot means:

1. change that joint node's local translation (bind pose), and give each child the opposite change so the
   children stay where they are unless they are being moved too;
2. recompute every affected inverse bind matrix as the inverse of the joint's new bind-pose world matrix
   (the joint and, because their world matrices did not change, nothing else);
3. keep every joint's bind *rotation*. \`retarget\` drives the sculpts by rotation deltas against each bone's
   rest orientation, so as long as orientations are unchanged no clip, retarget table or shoulder-slide tuning
   needs re-deriving.

The mesh looks identical in the bind pose after this — only the pivots it bends about move. It is a mechanical
edit of node translations and one accessor per skin, best done straight on the .glb with glTF-Transform rather
than a Blender round trip (which would re-export the gltfpack quantisation, texture transforms and the decimated
topology). It must be made on the originals in \`public/models/full/\` and the decimation re-run from them
(\`tools/asset-pipeline/decimate.mjs\` always decimates from there), keeping the untouched originals aside.

**Which joints to move, and where.** Only the limb joints the audit calls *likely misplaced*, and only
*across* the limb: to the centre of the limb's cross-section at the joint's current position along it. The
along-the-limb reading comes from the seam of the existing weights, which the auto-rigger computed *from* the
misplaced bones, so it is biased toward the old joint and should not drive a move. Shoulders, hips, the neck and
the spine read too loosely under pauldrons, robes and packs (see the caveats above) to be moved by a tool at all.

**Why not re-weight automatically too.** The current weights were made for the current joints, so after a move
the bend band stays where it was: good enough for an across-the-limb correction (it mostly removes the
volume loss and the elbow "hinge behind the arm"), not for a large move along the limb. The obvious next step —
Blender's automatic (heat) weights on the new skeleton — is where the risk is:

- these sculpts are many-shell, non-manifold meshes (armour plates, belts, pouches, robes, capes), which is where
  heat weighting fails outright ("failed to find solution for one or more bones") or bleeds between bones;
- robes and long coats get bridged between the legs, and a pack, holster or pauldron gets smeared across the
  bones under it — exactly the faults \`skinfix\`, \`rigidpack\`, \`strays\` and \`jawrig\` were written to
  repair, and those documents are vertex-indexed and tuned against today's weights, so every one would need
  re-checking;
- the workbench grips (shared weapon grips, saber, staff, Boba's rifle, holsters) are stored relative to the hand
  and hip bones: moving a wrist moves every grip on that hand, and each would need re-placing in the workbench.

**Suggested path.** (1) A script reads \`rig-joints.json\`, proposes an across-the-limb move per *likely
misplaced* joint, applies it to a copy of the full-resolution file (translations + IBMs only, weights untouched)
and re-decimates; (2) a person compares old and new in the workbench on the gait, landing and attack clips and
the grip views, accepting or rejecting per model; (3) re-run \`measure-lod.mjs\` so the stand-ins and this audit
follow; (4) re-weight by hand, in Blender, only the few models where the bend band then visibly sits in the wrong
place (Ventress, the escort droid, Revan, the ring enforcer and the Wookiee are the candidates). Checks to run
after each: check-gait, check-landing, test-shared-weapon-grips, test-workbench-weapon-grips, test-parry.
`;

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const port = server.config.server.port ?? 5199;
const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page]', e));
try {
  const url = `http://localhost:${port}/tools/asset-pipeline/measure-lod.html${only ? `?only=${only}` : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.__lod, null, { timeout: 30 * 60 * 1000, polling: 1000 });
  const result = await page.evaluate(() => window.__lod);
  if (result.error) throw new Error(result.error);
  let data = result.data;
  if (only) {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    for (const k of ['chars', 'creatures', 'props']) data[k] = { ...prev[k], ...data[k] };
  }
  await writeFile(OUT, format(data));
  console.log(`wrote ${OUT}`);
  if (!only) {
    await mkdir(dirname(AUDIT), { recursive: true });
    await writeFile(AUDIT, auditReport(result.reports));
    // the same, for a tool to act on: every joint where it is and where the
    // mesh says it should be (see the report's caveats before trusting one)
    await writeFile(AUDIT.replace(/\.md$/, '.json'), `${JSON.stringify({
      note: 'Rig joint audit (tools/asset-pipeline/measure-lod.mjs). Positions in the model frame used by the game (metres at the fitted height, x = character left, y up, z forward), bind pose. at = the skeleton joint; est = the mesh estimate; see rig-joints.md for method and caveats.',
      models: Object.fromEntries(result.reports.map((r) => [r.id, {
        height: r.height,
        joints: Object.fromEntries(r.joints.map((j) => [j.joint, { method: j.method, at: j.at, est: j.est ?? null, offset: j.off, centre: j.centre, radius: j.radius }])),
      }])),
    }, null, 1)}\n`);
    console.log(`wrote ${AUDIT}`);
  }
  // how the stand-ins measure up: box volume against the solid the model
  // encloses, and how high they reach against the model's own top
  if (process.env.LOD_STATS) await writeFile(process.env.LOD_STATS, JSON.stringify(result.stats, null, 1));
  const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
  console.log('\nmodel                      kind      solid m³   boxes/solid (was)   top m  stand-in (was)   bottom m  stand-in (was)');
  for (const s of result.stats) {
    console.log(`${s.id.padEnd(26)} ${s.kind.padEnd(9)} ${f(s.solid, 4).padStart(9)}   ${f(s.now.vol / s.solid).padStart(5)} (${s.was ? f(s.was.vol / s.solid) : '–'})`.padEnd(70)
      + `${f(s.top, 3).padStart(6)}  ${f(s.now.top, 3)} (${s.was ? f(s.was.top, 3) : '–'})    ${f(s.bottom, 3).padStart(6)}  ${f(s.now.bottom, 3)} (${s.was ? f(s.was.bottom, 3) : '–'})`);
  }
  for (const r of result.reports) {
    const p = Object.entries(r.p).map(([k, v]) => `${k} ${v}`).join(', ');
    if (process.env.LOD_RAW) console.log(JSON.stringify({ raw: r.raw, joints: r.joints }));
    console.log(`${r.id} (${r.height} m): ${p}${r.empty.length ? `\n  no geometry on: ${r.empty.join(', ')}` : ''}`);
  }
} finally {
  await browser.close();
  await server.close();
}

/** one entry per line, one part per line: diffable, and not a megabyte of whitespace */
function format(data) {
  const block = (obj, inner) => Object.entries(obj).map(([id, v]) => `    ${JSON.stringify(id)}: ${inner(v)}`).join(',\n');
  const rows = (arr) => `[\n${arr.map((r) => `        ${JSON.stringify(r)}`).join(',\n')}\n      ]`;
  const entry = (v) => `{\n${Object.entries(v).map(([k, x]) =>
    `      ${JSON.stringify(k)}: ${Array.isArray(x) && Array.isArray(x[0]) ? rows(x) : JSON.stringify(x)}`).join(',\n')}\n    }`;
  return `{\n  "v": 1,\n${['chars', 'creatures', 'props'].map((k) => `  ${JSON.stringify(k)}: {\n${block(data[k], entry)}\n  }`).join(',\n')}\n}\n`;
}

/**
 * The joint audit, as a page a person can read: where each authored joint is
 * against where the mesh says it should be (see `auditJoints` in the page).
 */
function auditReport(reports) {
  const cm = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) : '–');
  const FLAG_OFF = 0.03;
  const flagsOf = (j) => {
    const f = [];
    if (j.method !== 'none' && j.off > FLAG_OFF) f.push(`off ${cm(j.off)} cm`);
    if (Number.isFinite(j.centre) && Number.isFinite(j.radius) && j.radius > 0) {
      if (j.centre > j.radius) f.push('**outside the mesh**');
      else if (j.centre > 0.35 * j.radius) f.push('off centre line');
    }
    if (j.method === 'none') f.push('no estimate');
    return f;
  };
  /**
   * Two independent readings agreeing is the bar for "likely": the seam says
   * the joint is off by more than 4 cm *and* the cut through the limb says it
   * is well off the limb's centre — or it is outside the mesh altogether.
   */
  const LIMB = /^(elbow|wrist|knee|ankle)/;
  const likely = (j) => LIMB.test(j.joint) && Number.isFinite(j.centre) && Number.isFinite(j.radius) && j.radius > 0
    && (j.centre > j.radius || (j.method !== 'none' && j.off > 0.04 && j.centre > 0.5 * j.radius));
  const lines = [];
  lines.push('# Rig joint audit', '');
  lines.push('Generated by `tools/asset-pipeline/measure-lod.mjs` (with `src/characters/data/lod.json`, and the same data as JSON in `rig-joints.json`); do not edit by hand. No .glb is modified by it.', '');
  lines.push('Every authored character .glb, in its bind pose at the height the game fits it to, with each skeleton joint');
  lines.push('compared against where the mesh itself says the joint should be. Offsets are *actual minus estimate*, in cm,');
  lines.push('in the model frame (x = the character\'s left, y up, z forward).', '');
  lines.push('**How the estimate is made.** Limb joints and the neck: the weighted centroid of the vertices whose skin');
  lines.push('weights are split between the bones either side of the joint (both >= 0.2) — the seam the skin bends about,');
  lines.push('which also sits mid cross-section (`seam`). Where fewer than a dozen vertices are shared, the band of each');
  lines.push('side\'s vertices within 2 cm of the other side stands in (`band`). Spine chain (pelvis, spine, chest): the');
  lines.push('centroid of the torso\'s horizontal cross-section at the bone head; only the horizontal offset counts (`slice`).', '');
  lines.push('**Centre line.** Independently of the estimate, the limb is cut square to its axis at the *actual* joint:');
  lines.push('`centre` is how far the joint sits from that section\'s centre and `radius` the section\'s mean radius.');
  lines.push('A joint further from the centre than the radius is outside the mesh.', '');
  lines.push('**Caveat — read before fixing anything.** The seam estimate inherits the skinning: automatic weights are');
  lines.push('computed *from* the bones, so a joint that is misplaced along its limb drags its own seam with it, and the');
  lines.push('`along` column will understate it. The `across` and centre-line columns do not have that problem — a bone off');
  lines.push('the limb\'s centre line shows up there whatever the weights did. Robes, capes, armour plates and hair');
  lines.push('weighted to a limb widen its sections and pull the centroids; treat any single number as a lead, not a verdict.', '');
  lines.push('**How far to trust it.** Checked by drawing both points on the models: elbows, knees, wrists and ankles');
  lines.push('on bare or tight-clad limbs read well — the seam is a clean ring and its centroid sits mid-limb. Shoulders,');
  lines.push('hips and the neck are weaker: the seam there is a broad band that takes in pauldrons, collars, the chest and');
  lines.push('the pelvis, and under armour or a robe it can sit several centimetres from any sensible pivot. The spine');
  lines.push('slices are pulled backward by anything worn on the back (a jetpack moves the chest\'s centroid by ~10 cm).', '');
  lines.push(`Flags: offset over ${FLAG_OFF * 100} cm; joint more than 35% of the section radius off the centre line; joint outside the mesh.`);
  lines.push('**Likely misplaced** is only called on the limb joints (elbow, wrist, knee, ankle), where both readings are');
  lines.push('trustworthy, and needs them to agree: the seam offset over 4 cm *and* the joint more than half the limb\'s radius');
  lines.push('off its centre line — or the joint outside the mesh outright. The rest are leads for a person to look at.', '');
  lines.push('## Summary', '');
  lines.push('| model | height m | likely misplaced | other flags |');
  lines.push('|---|---|---|---|');
  for (const r of reports) {
    const bad = r.joints.filter(likely);
    const flagged = r.joints.filter((j) => !likely(j) && flagsOf(j).length).map((j) => j.joint);
    lines.push(`| ${r.id} | ${r.height} | ${bad.map((j) => `${j.joint} (${cm(Math.max(j.off, j.centre))})`).join(', ') || '–'} | ${flagged.join(', ') || '–'} |`);
  }
  lines.push('');
  for (const r of reports) {
    lines.push(`## ${r.id}`, '');
    if (r.empty.length) lines.push(`Bones with no geometry of their own: ${r.empty.join(', ')}.`, '');
    lines.push('| joint | method | n | offset | along | across | dx | dy | dz | centre | radius | flags |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const j of r.joints) {
      lines.push(`| ${j.joint} | ${j.method} | ${j.n} | ${cm(j.off)} | ${cm(j.along)} | ${cm(j.across)} | ${cm(j.d[0])} | ${cm(j.d[1])} | ${cm(j.d[2])} | ${cm(j.centre)} | ${cm(j.radius)} | ${[...(likely(j) ? ['**likely misplaced**'] : []), ...flagsOf(j)].join('; ')} |`);
    }
    lines.push('');
  }
  lines.push(FEASIBILITY);
  return lines.join('\n');
}

