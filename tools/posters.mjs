// ============================================================================
// posters — pre-render every playable fighter as a transparent PNG for the
// character select to flip through without building a body per keypress.
//
//     node tools/posters.mjs                    # the whole PvP roster
//     node tools/posters.mjs din npc:massiff    # just these
//
// Writes public/posters/<id>.png plus public/posters/posters.json, whose
// entries carry the world-space box each picture spans measured off the
// fighter's own feet. The runtime lays its <img> over that box re-projected
// through whatever camera the stage is using, which is what makes the
// picture-to-model handover land on the same pixels — src/ui/posters.ts
// explains the contract, and `CharacterSelect.posterShot` is what renders it,
// so the tool and the screen cannot drift into different cameras.
//
// Needs a build: npm run build (the harness serves dist/).
// ============================================================================
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { launch } from './harness.mjs';

const OUT = 'public/posters';
const INDEX = `${OUT}/posters.json`;
/**
 * A picture with almost no transparency is a solid rectangle — something
 * composited in behind the fighter — and on the stage that reads as a card
 * behind them rather than as a body. Refuse it.
 */
const MIN_CLEAR = 0.02;

const h = await launch();
const want = process.argv.slice(2);
const roster = await h.page.evaluate(() => window.__playables().map(
  (d) => ({ id: d.id, name: d.profile.name, modelIds: d.modelIds })));
const targets = want.length ? roster.filter((r) => want.includes(r.id)) : roster;
if (!targets.length) {
  console.error(`no such fighter: ${want.join(' ')}`);
  await h.close();
  process.exit(1);
}

await mkdir(OUT, { recursive: true });

// START FROM THE INDEX ALREADY ON DISK. A named run re-renders SOME fighters
// into one shared map; writing it from an empty object would delete every
// other fighter's entry, and a fighter with no entry has no poster at all as
// far as src/ui/posters.ts is concerned — the .png on disk does not save it,
// because the box is what places the picture. So merge, and let each rendered
// fighter overwrite only its own entry.
let fighters = {};
try {
  const prev = JSON.parse(await readFile(INDEX, 'utf8'));
  if (prev?.fighters) fighters = prev.fighters;
} catch { /* no index yet — first run */ }

let failed = 0;
for (const target of targets) {
  const file = target.id.replace('npc:', '');
  // A FRESH PAGE PER FIGHTER — or rather a fresh app, which a reload is.
  //
  // The select screen is one long-lived object, and shooting thirty fighters
  // through one of them carries state between them: every fighter built so
  // far is still parked on the plinth, and the screen's own clock has been
  // running the whole time. Both feed the pose, so the same fighter came out
  // differently depending on what had been shot before it — a dozen of the
  // thirty pictures churned between two runs that produced identical output
  // when either was shot on its own. Reloading is the cheap way to be sure
  // each one is rendered from the same starting point.
  await h.page.reload({ waitUntil: 'load' });
  await h.page.waitForFunction(() => typeof window.__posterShot === 'function');
  const shot = await h.page.evaluate(
    ([id]) => window.__posterShot(id), [target.id]);
  if (!shot || shot.error) {
    console.log(`  ${file}: FAILED — ${shot?.error ?? 'no shot'}`);
    failed++;
    continue;
  }

  // ---- the two ways a poster can be silently, confidently wrong ----
  // 1. THE WRONG BODY. The select screen shows the authored model, so that is
  //    what a poster has to depict. A picture of the procedural stand-in looks
  //    like a deliberate art choice and nobody notices it is wrong until they
  //    see the same fighter in a fight. `modelReady` cannot catch this on its
  //    own — it answers true for a load that FAILED too, since a fighter with
  //    no file is meant to be presentable — so ask what actually parsed.
  const missing = [];
  for (const m of target.modelIds) {
    const cached = await h.page.evaluate(([id]) => window.__modelCached(id), [m]);
    if (!cached) missing.push(m);
  }
  if (missing.length) {
    console.log(`  ${file}: FAILED — rendered without ${missing.join(', ')}.glb; `
      + 'that is a picture of the procedural build');
    failed++;
    continue;
  }
  // 2. NO ALPHA (see MIN_CLEAR).
  if (shot.clear < MIN_CLEAR) {
    console.log(`  ${file}: FAILED — only ${(shot.clear * 100).toFixed(1)}% transparent; `
      + 'the poster has no alpha');
    failed++;
    continue;
  }

  await writeFile(`${OUT}/${file}.png`, Buffer.from(shot.png.split(',')[1], 'base64'));
  fighters[file] = shot.box;
  const b = shot.box;
  console.log(`  ${file}: ${shot.w}x${shot.h}px  ${(shot.clear * 100).toFixed(0)}% clear  `
    + `x[${b.u0.toFixed(2)},${b.u1.toFixed(2)}] y[${b.v0.toFixed(2)},${b.v1.toFixed(2)}]`);
}

await writeFile(INDEX, `${JSON.stringify({
  note: 'generated by tools/posters.mjs — see src/ui/posters.ts for the contract',
  px: 760,
  fighters,
}, null, 1)}\n`);
console.log(`\nwrote ${Object.keys(fighters).length} posters to ${OUT}${failed ? ` (${failed} failed)` : ''}`);
await h.close();
process.exit(failed ? 1 : 0);
