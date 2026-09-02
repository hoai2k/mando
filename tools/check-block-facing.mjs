/**
 * Does the block face what it is blocking?
 *
 * The energy shield hangs off the chest bone and opens along that bone's +Z,
 * so the chest's pitch *is* the shield's aim. Pitched forward it covers the
 * ground in front of the player's boots rather than the bolts coming at their
 * chest — which is invisible in the clip's numbers, since the lean is spread
 * across the hips, the spine and the chest and only adds up on the rig.
 */
import { launch } from './harness.mjs';

const h = await launch({ url: `http://localhost:${process.env.HARNESS_PORT ?? '4173'}/workbench/?character=din` });
let failures = 0;

const pitches = await h.page.evaluate(async () => {
  const sel = document.querySelector('#pose');
  sel.value = 'block';
  sel.dispatchEvent(new Event('change'));
  for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(r));
  const fig = window.__wb.figures.find((f) => f.inst.rig).inst;
  fig.root.updateWorldMatrix(true, true);
  const pitchOf = (bone) => {
    // the bone's own +Z in world space is the third column of its world matrix
    const e = bone.matrixWorld.elements;
    const len = Math.hypot(e[8], e[9], e[10]) || 1;
    return Math.asin(e[9] / len) * 180 / Math.PI;   // positive = aimed above the horizon, negative = at the floor
  };
  const b = fig.rig.bones;
  return { chest: pitchOf(b.chest), head: pitchOf(b.head) };
});

console.log(`  chest (and with it the shield): ${pitches.chest.toFixed(1)}° from level`);
console.log(`  head: ${pitches.head.toFixed(1)}° from level`);
for (const [what, deg] of Object.entries(pitches)) {
  const ok = Math.abs(deg) <= 8;
  console.log(`${ok ? 'ok  ' : 'FAIL'} block ${what} is within 8° of level (got ${deg.toFixed(1)}°)`);
  if (!ok) failures++;
}

await h.close();
console.log(failures ? `\n${failures} failure(s)` : '\nthe block faces forward');
process.exit(failures ? 1 : 0);
