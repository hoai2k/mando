/**
 * Strays: lumps of geometry in a delivered sculpt that belong to nothing.
 *
 * Playtest, 2026-09-20: *"the (detached) floating sphere thing just behind one
 * of Din Djarin's shoulders — that is a 3D model error."* It is: a 1,290
 * triangle ball, welded to no part of the body, sitting in the same skinned
 * mesh as everything else. The generator that made these files left it there,
 * and nothing in the game can tell it from armour.
 *
 * So it is found the way it reads: a sculpt is one connected surface, and
 * anything that shares no edge with the surface everything else is on, and is
 * small beside it, is not part of the model. This decodes every .glb in
 * `public/models`, welds each primitive's vertices by position (a sculpt
 * splits them at every UV seam, so raw indices under-report what is joined),
 * finds the connected pieces, and reports every piece that is not the body.
 *
 * Reporting is the default. `--write` turns the findings into fix files under
 * `public/models/strays/`, which the game applies at load — the same contract
 * `skinfix` uses, and for the same reason: the files on disk stay exactly as
 * delivered, so a redelivery is a re-run of this tool rather than a lost edit.
 *
 * **Writing a fix takes a model's name**, never the whole shelf. Detached is
 * not the same as wrong: a rack of fish, a pair of lamps, a creature's eyes
 * are all their own shells and all belong where they are. Only a piece somebody
 * has *looked at* should be deleted, so the report is the tool's normal output
 * and `--write <id>` is the deliberate second step.
 *
 *   node tools/audit-strays.mjs             # report on every model
 *   node tools/audit-strays.mjs din         # one
 *   node tools/audit-strays.mjs din --write # ...and drop what it found there
 *
 * Exits non-zero when a model's fix file no longer matches what is in the
 * model — a redelivery that moved the geometry the fix was cut for.
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readGlb, primitives, components, decoderReady } from './lib/glb.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const MODELS = join(ROOT, 'public/models');
const FIXES = join(MODELS, 'strays');

/**
 * How small a piece has to be, against the biggest one in the same primitive,
 * before it is a stray rather than a part.
 *
 * A model legitimately has more than one shell — an eye, a buckle, a loose
 * pauldron, a cape sewn as its own piece — and those are of a size with what
 * they belong to. What this is looking for is the opposite: a fraction of a
 * per cent of the model, attached to nothing. Din's ball is 1.1% of his
 * triangles, which is why this sits where it does rather than lower.
 */
const STRAY_SHARE = 0.03;
/** ...and a piece bigger than this many triangles is somebody's design, whatever its share */
const STRAY_MAX_TRIS = 4000;

const args = process.argv.slice(2);
const write = args.includes('--write');
const only = args.find((a) => !a.startsWith('--'));
if (write && !only) {
  console.log('--write takes a model: `node tools/audit-strays.mjs din --write`.\n' +
    'Detached is not the same as wrong, so a fix is cut for a piece somebody has looked at.');
  process.exit(2);
}

await decoderReady;

const files = readdirSync(MODELS)
  .filter((f) => f.endsWith('.glb'))
  .filter((f) => !only || basename(f, '.glb') === only)
  .sort();

if (!files.length) {
  console.log(only ? `no such model: ${only}` : 'no models to read');
  process.exit(1);
}

let found = 0;
let drifted = 0;
let forReview = 0;
const written = [];

for (const file of files) {
  const id = basename(file, '.glb');
  let glb;
  try {
    glb = readGlb(join(MODELS, file));
  } catch (e) {
    console.log(`  ${id.padEnd(22)} unreadable: ${e.message}`);
    continue;
  }
  // the mesh node's own scale, so sizes are reported in metres of model rather
  // than in whatever units the quantiser chose
  const node = (glb.json.nodes ?? []).find((n) => n.mesh !== undefined);
  const scale = node?.scale?.[0] ?? 1;
  const strays = [];
  for (const prim of primitives(glb)) {
    const pieces = components(prim, 1);
    if (pieces.length < 2) continue;
    const body = pieces[0];
    for (const piece of pieces.slice(1)) {
      if (piece.triCount > STRAY_MAX_TRIS) continue;
      if (piece.triCount > body.triCount * STRAY_SHARE) continue;
      strays.push({
        mesh: prim.mesh,
        primitive: prim.prim,
        triangles: piece.triCount,
        vertices: piece.vertCount,
        shareOfModel: +((piece.triCount / body.triCount) * 100).toFixed(2),
        sizeM: piece.size.map((v) => +(v * scale).toFixed(3)),
        centreM: piece.centre.map((v) => +(v * scale).toFixed(3)),
        // the runs of triangles to drop, as [first, last] pairs over the
        // primitive's own index order — compact, and exactly what the loader
        // needs to rebuild the index without them
        runs: runsOf(piece.tris),
      });
    }
  }
  if (!strays.length) continue;
  found += strays.length;
  const tris = strays.reduce((t, s) => t + s.triangles, 0);
  console.log(`  ${id.padEnd(22)} ${strays.length} stray piece(s), ${tris} triangles`);
  for (const s of strays) {
    console.log(`      ${String(s.triangles).padStart(5)} tris (${s.shareOfModel}% of the model) · ` +
      `${s.sizeM.map((v) => v.toFixed(2)).join(' x ')} m at ${s.centreM.map((v) => v.toFixed(2)).join(', ')}`);
  }
  const path = join(FIXES, `${id}.json`);
  if (write) {
    mkdirSync(FIXES, { recursive: true });
    const doc = {
      format: 'mando-strays/1',
      model: id,
      note: 'Geometry welded to nothing, dropped at load. Written by tools/audit-strays.mjs.',
      strays,
    };
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
    written.push(id);
  } else if (!existsSync(path)) {
    forReview++;
  } else {
    // a fix file exists: does it still describe what is in the model?
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const covered = (doc.strays ?? []).reduce((t, s) => t + s.triangles, 0);
    if (covered !== tris) {
      console.log(`      the fix file covers ${covered} of ${tris} triangles — re-run with --write`);
      drifted++;
    } else {
      console.log('      covered by a fix file, dropped at load');
    }
  }
}

/** contiguous [first, last] runs over a sorted list of triangle numbers */
function runsOf(list) {
  const out = [];
  let start = null;
  let prev = null;
  for (const t of list) {
    if (start === null) { start = t; prev = t; continue; }
    if (t === prev + 1) { prev = t; continue; }
    out.push([start, prev]);
    start = t; prev = t;
  }
  if (start !== null) out.push([start, prev]);
  return out;
}

if (write) {
  // the index is every model that has a fix file, not just the one just cut:
  // it is what the game reads to know which models to ask for a fix at all
  mkdirSync(FIXES, { recursive: true });
  const models = readdirSync(FIXES)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => basename(f, '.json'))
    .sort();
  writeFileSync(join(FIXES, 'index.json'),
    `${JSON.stringify({ format: 'mando-strays-index/1', models }, null, 2)}\n`);
  console.log(`\nwrote ${written.join(', ')}; ${models.length} model(s) now carry a fix`);
} else if (!found) {
  console.log('\nno stray geometry in any delivered model');
} else {
  console.log(`\n${found} detached piece(s) across ${files.length} model(s)` +
    (forReview ? ` — ${forReview} model(s) for review: look at them before cutting a fix` : '') +
    (drifted ? ` — ${drifted} fix file(s) no longer match their model` : ''));
}
process.exit(drifted ? 1 : 0);
