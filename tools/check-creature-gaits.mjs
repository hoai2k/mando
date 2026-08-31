/**
 * Do the creatures move the way they face?
 *
 * A gait built on the wrong sign convention looks like an animal running
 * backwards, and it is invisible in a still: the pose is right, the direction
 * of travel through it is not. So this measures the thing itself — load each
 * creature in the workbench, run its gait, and track a foot. While a foot is
 * planted it must travel *backward* through the body's frame; that is what
 * pushes the animal forward. A gait whose planted feet travel forward is
 * running in reverse.
 *
 * Also checks the ride height: a body bob is authored in metres, and a bob far
 * larger than the animal's own bounce reads as a jitter rather than a stride.
 */
import { launch } from './harness.mjs';

const CREATURES = [
  { id: 'massiff', feet: ['DEF-front_foot.L', 'DEF-foot.L'], body: 'DEF-spine' },
  { id: 'krykna', feet: ['legL1_mid', 'legR3_mid'], body: 'body' },
  { id: 'broodmother', feet: ['legL1_mid', 'legR3_mid'], body: 'body' },
];

const h = await launch({ url: 'http://localhost:4173/workbench/' });
let failures = 0;

for (const c of CREATURES) {
  await h.page.goto(`http://localhost:4173/workbench/?character=${c.id}`, { waitUntil: 'load' });
  // the .glb lands a beat after the page does
  await h.page.waitForFunction(() => {
    const wb = window.__wb;
    if (!wb?.figures?.length) return false;
    let bones = 0;
    for (const f of wb.figures) f.inst.root.traverse((o) => { if (o.isBone) bones++; });
    return bones > 10;
  }, null, { timeout: 20000 });

  const result = await h.page.evaluate(async ({ feet, body }) => {
    const wb = window.__wb;
    // drive the run pose by hand: the picker is a DOM control, this is the same call
    const sel = document.querySelector('#pose');
    sel.value = 'creatureRun';
    sel.dispatchEvent(new Event('change'));
    const fig = wb.figures[0].inst;
    const find = (name) => {
      const flat = name.replace(/\./g, '');
      let hit = null;
      fig.root.traverse((o) => { if (!hit && (o.name === name || o.name === flat)) hit = o; });
      return hit;
    };
    const bodyBone = find(body);
    const footBones = feet.map(find).filter(Boolean);
    if (!bodyBone || !footBones.length) return { error: `bones missing (${body}, ${feet})` };
    // No three.js in scope here, so the maths is done on the matrices directly:
    // a bone's world position is its matrix translation, and how far forward a
    // foot is sits on the body's own +Z axis (its third matrix column).
    const pos = (o) => { const e = o.matrixWorld.elements; return [e[12], e[13], e[14]]; };
    const forwardOf = (o) => {
      const e = o.matrixWorld.elements;
      const len = Math.hypot(e[8], e[9], e[10]) || 1;
      return [e[8] / len, e[9] / len, e[10] / len];
    };
    const samples = [];
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      fig.root.updateWorldMatrix(true, true);
      const bp = pos(bodyBone);
      const fw = forwardOf(bodyBone);
      samples.push({
        y: bp[1],
        feet: footBones.map((f) => {
          // the contact point, not the joint: the deepest bone under the foot
          let tip = f, depth = 0;
          f.traverse((o) => { let d = 0; for (let a = o; a && a !== f; a = a.parent) d++; if (d > depth) { depth = d; tip = o; } });
          const p = pos(tip);
          return {
            z: (p[0] - bp[0]) * fw[0] + (p[1] - bp[1]) * fw[1] + (p[2] - bp[2]) * fw[2],
            y: p[1],
          };
        }),
      });
    }
    return { samples };
  }, c);

  if (result.error) { console.log(`FAIL ${c.id}: ${result.error}`); failures++; continue; }
  const { samples } = result;
  // Per foot: the longest run of frames moving one way is the stance sweep.
  // Through the body's frame a planted foot goes backward, so the dominant
  // travel must be negative.
  const n = samples[0].feet.length;
  for (let f = 0; f < n; f++) {
    // Over a whole cycle a foot returns to where it started, so the distances
    // it covers each way are equal and only the *pace* separates them: planted
    // it creeps back at the speed of the body, airborne it whips forward in a
    // fraction of the time. So a foot that travels backward slower than it
    // travels forward is pushing the animal the way it faces, and one that
    // does the opposite is running in reverse — no threshold to tune.
    const ys = samples.map((s) => s.feet[f].y);
    const low = Math.min(...ys), high = Math.max(...ys);
    // the planted window: the foot is down when it is in the bottom third of
    // the arc it travels through
    const floor = low + (high - low) * 0.34;
    let planted = 0, travel = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].feet[f].y > floor || samples[i - 1].feet[f].y > floor) continue;
      travel += samples[i].feet[f].z - samples[i - 1].feet[f].z;
      planted++;
    }
    const perFrame = planted ? travel / planted : 0;
    const ok = planted > 4 && perFrame < 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.id} foot ${f}: while planted it travels ${(perFrame * 1000).toFixed(2)} mm/frame through the body (must be negative — a planted foot goes backward, that is what pushes the animal forward), ${planted} planted frames`);
    if (!ok) failures++;
  }
  const ys = samples.map((s) => s.y);
  const bob = Math.max(...ys) - Math.min(...ys);
  const ok = bob < 0.35;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.id} body ride: ${(bob * 100).toFixed(1)} cm peak-to-peak (want < 35 cm)`);
  if (!ok) failures++;
}

await h.close();
console.log(failures ? `\n${failures} failure(s)` : '\nall creature gaits travel the way they face');
process.exit(failures ? 1 : 0);
