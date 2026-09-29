/**
 * Geometric joint audit: where each character's joints are, read off the
 * *volume* of its mesh alone — no bones, no skin weights — against where its
 * skeleton puts them and (when docs/audits/rig-joints.json is at hand) where
 * the skin-weight seam puts them.
 *
 *   CHROMIUM_PATH=... node tools/asset-pipeline/geo-joints.mjs [id,id,...] [--shots=dir] [--seam=path] [--no-write]
 *
 * Writes docs/audits/geo-joints.json and geo-joints.md (with ids, only those
 * models are re-measured and merged in). `--shots=dir` also saves, per model,
 * the model with the three sets of joints drawn on it and the geometric
 * stand-in. No .glb is modified.
 *
 * How (the code is in geo-estimate.mjs and geo-core.mjs):
 *   1. The game's loader puts the model in its bind pose at its fitted height
 *      (geo-joints-page.ts); only its triangles come back.
 *   2. The triangles are voxelised (1 cm) into a solid: the outside is
 *      flood-filled and everything it cannot reach is inside, so the many
 *      overlapping armour shells of a sculpt become one volume, and an open
 *      coat or robe — whose inside the fill reaches through its hem — stays a
 *      thin shell. A morphological opening (a 2 cm ball) then takes every
 *      thin shell away: coats, capes, robes, fingers, straps.
 *   3. Segmentation by horizontal slices: the crotch is where the two legs'
 *      slice components join; each arm is followed from where it hangs clear
 *      of the torso up to the armpit and down to the hand, and cut from the
 *      torso above the armpit by the vertical plane through its inner edge.
 *   4. Per limb, voxels are ordered by geodesic distance from its root, and
 *      the limb is cut square to the resulting centre line at every
 *      centimetre: the cut's centroid is the centre line, its area and widths
 *      the volume profile.
 *   5. Cues, pooled across both sides (see geo-estimate.mjs): bends in the
 *      centre line, constrictions of the section between bulges, the hand's
 *      flattening, the instep crease where the front of the shin turns into
 *      the foot — each weighed by anthropometric priors used as search windows,
 *      and placed on the limb's centre line. Shoulders and hips are found by
 *      carrying the upper arm's and thigh's axes into the torso, and are weak.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openGeoPage, ROOT } from './geo-browser.mjs';
import { analyse } from './geo-estimate.mjs';
import { CHARACTERS } from './geo-chars.mjs';

export const LIMB_JOINTS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const only = args.find((a) => !a.startsWith('--'))?.split(',') ?? null;
const shotsDir = opt('shots', null);
// bind-pose triangles per model, kept between runs (re-analysing needs no browser)
const cacheDir = opt('cache', join(tmpdir(), 'geo-joints-cache'));
const seamPath = opt('seam', join(ROOT, 'docs/audits/rig-joints.json'));
const OUT = join(ROOT, 'docs/audits/geo-joints.json');
const seam = existsSync(seamPath) ? JSON.parse(await readFile(seamPath, 'utf8')) : null;
if (!seam) console.log(`(no seam audit at ${seamPath}: comparing against the rig only)`);

const cm = (a, b) => (a && b ? +(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100).toFixed(1) : null);
const dcm = (a, b) => (a && b ? [0, 1, 2].map((k) => +((a[k] - b[k]) * 100).toFixed(1)) : null);

export const MARKER = { rig: 0xff3030, seam: 0x3aa0ff, geo: 0x30ff60 };

const prev = existsSync(OUT) ? JSON.parse(await readFile(OUT, 'utf8')) : { models: {} };
const models = only ? { ...prev.models } : {};
let page = null;
const browser = async () => { page ??= await openGeoPage(); await page.reset(); return page; };
/** the model's bind-pose triangles and rig joints, from the cache or the browser */
async function dumpOf(id, height) {
  const bin = join(cacheDir, `${id}-${height}.bin`), meta = join(cacheDir, `${id}-${height}.json`);
  if (!args.includes('--fresh') && existsSync(bin) && existsSync(meta)) {
    const b = await readFile(bin);
    return { tris: new Float32Array(b.buffer, b.byteOffset, b.length / 4), ...JSON.parse(await readFile(meta, 'utf8')) };
  }
  const d = await (await browser()).dump(id, height);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(bin, Buffer.from(d.tris.buffer, d.tris.byteOffset, d.tris.byteLength));
  await writeFile(meta, JSON.stringify({ joints: d.joints, bones: d.bones }));
  return d;
}
try {
  if (shotsDir) await mkdir(shotsDir, { recursive: true });
  for (const [id, height] of Object.entries(CHARACTERS)) {
    if (only && !only.includes(id)) continue;
    const t0 = Date.now();
    const dump = await dumpOf(id, height);
    let res;
    try { res = analyse(dump.tris, height); } catch (err) { console.log(`${id}: FAILED ${err.message}`); models[id] = { height, error: err.message }; await save(); continue; }
    const joints = {};
    for (const j of LIMB_JOINTS) for (const side of ['L', 'R']) {
      const k = `${j}.${side}`;
      const e = res.joints[k];
      const at = dump.joints[k] ?? null;
      const se = seam?.models?.[id]?.joints?.[k]?.est ?? null;
      joints[k] = {
        at, est: e.p, seam: se,
        conf: e.conf, offsetCm: cm(at, e.p), d: dcm(e.p, at), seamOffsetCm: cm(se, e.p), rigSeamCm: cm(at, se),
        mirrorCm: e.mirrorCm, spreadCm: e.spreadCm ?? null, used: e.used ?? [], cues: e.cues, prior: e.prior ?? null,
        ...(e.note ? { note: e.note } : {}),
      };
    }
    models[id] = { height, crotchY: res.crotchY, armpitY: res.armpitY, triangles: dump.tris.length / 9, joints, standIn: res.standIn };
    console.log(`${id}: ${((Date.now() - t0) / 1000).toFixed(1)} s — ${LIMB_JOINTS.filter((j) => j !== 'shoulder' && j !== 'hip').map((j) => `${j} ${joints[`${j}.L`].offsetCm}cm c${joints[`${j}.L`].conf}`).join(', ')}`);
    if (shotsDir) {
      const pts = (f) => Object.values(joints).map(f).filter(Boolean);
      const markers = [
        { color: MARKER.rig, r: 0.011, pts: pts((j) => j.at) },
        { color: MARKER.seam, r: 0.009, pts: pts((j) => j.seam) },
        { color: MARKER.geo, r: 0.012, pts: pts((j) => j.est) },
      ];
      const links = Object.values(joints).filter((j) => j.at && j.est).map((j) => ({ color: 0xffff00, a: j.at, b: j.est }));
      const pg = await browser();
      await writeFile(join(shotsDir, `geo-${id}-markers.png`), await pg.shot({ id, height, mode: 'model', standIn: [], markers, links, views: ['front', 'side'], opacity: 0.45 }));
      await pg.reset();
      await writeFile(join(shotsDir, `geo-${id}-standin.png`), await pg.shot({ id, height, mode: 'standin', standIn: res.standIn, markers: markers.slice(2), views: ['front', 'side', 'threeq'] }));
    }
    await save();
  }
} finally {
  await page?.close();
}

/** written after every model, so a crash part-way keeps what was measured */
async function save() {
  if (args.includes('--no-write')) return;
  const sorted = Object.fromEntries(Object.keys(CHARACTERS).filter((id) => models[id]).map((id) => [id, models[id]]));
  const json = {
    note: 'Generated by tools/asset-pipeline/geo-joints.mjs from the mesh volume alone (no bones, no weights). Frame: metres at the fitted height, x = the character\'s left, y up, z forward. at = the rig\'s joint, est = the geometric estimate, seam = the skin-weight seam estimate from rig-joints.json (if it was at hand).',
    models: sorted,
  };
  await writeFile(OUT, `${JSON.stringify(json, null, 1)}\n`);
  await writeFile(OUT.replace(/\.json$/, '.md'), (await import('./geo-report.mjs')).report(json));
  // the workbench overlay's slice of it (src/workbench/geoOverlay.ts)
  const slim = Object.fromEntries(Object.entries(sorted).filter(([, m]) => !m.error).map(([id, m]) => [id, {
    height: m.height,
    joints: Object.fromEntries(Object.entries(m.joints).map(([k, j]) => [k, { est: j.est, seam: j.seam, conf: j.conf }])),
    standIn: m.standIn,
  }]));
  await writeFile(join(ROOT, 'src/workbench/data/geoOverlay.json'), `${JSON.stringify({ note: 'Generated by tools/asset-pipeline/geo-joints.mjs; see docs/audits/geo-joints.md.', models: slim })}\n`);
}
if (!args.includes('--no-write')) console.log(`wrote ${OUT}, geo-joints.md and src/workbench/data/geoOverlay.json`);
