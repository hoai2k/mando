/** Maul's elbow shells stay joined, and jacket pieces do not follow an arm. */
import { readFileSync } from 'node:fs';
import { readGlb } from './lib/glb.mjs';
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const doc = JSON.parse(readFileSync('public/models/skinfix/maul.json', 'utf8'));
const chest = doc.fixes.find((f) => f.id === 'maul/chest-details-follow-torso');
const { primitives } = await readGlb('public/models/maul.glb').skinnedPrimitives();
const source = primitives[0];
const parent = [], welded = new Map(), point = new Int32Array(source.count);
for (let i = 0; i < source.count; i++) {
  const key = [0, 1, 2].map((a) => Math.round(source.positions[i * 3 + a] * 1e4)).join(',');
  let id = welded.get(key);
  if (id === undefined) { id = parent.length; welded.set(key, id); parent.push(id); }
  point[i] = id;
}
const root = (start) => {
  let i = start;
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
};
for (let i = 0; i < source.indices.length; i += 3) {
  const a = root(point[source.indices[i]]);
  parent[root(point[source.indices[i + 1]])] = a;
  parent[root(point[source.indices[i + 2]])] = a;
}
const shells = new Map();
for (let i = 0; i < source.count; i++) {
  const id = root(point[i]);
  if (!shells.has(id)) shells.set(id, []);
  shells.get(id).push(i);
}
const bySize = (n) => [...shells.values()].find((shell) => shell.length === n);
const nearElbow = (shell) => shell.filter((i) => {
  const y = source.positions[i * 3 + 1];
  return y > 0.10 && y < 0.19;
});
const pairs = [
  [nearElbow(bySize(482)), nearElbow(bySize(2169))],
  [nearElbow(bySize(431)), nearElbow(bySize(2282))],
];
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?character=maul&pose=saberIdle&mode=authored` });
try {
  await h.page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
    undefined, { timeout: 120000 });
  const torso = await h.page.evaluate((indices) => {
    let mesh;
    window.__wb.figures[0].inst.root.traverse((o) => {
      if (o.isSkinnedMesh && o.geometry.attributes.position.count === 22933) mesh = o;
    });
    const ji = mesh.geometry.attributes.skinIndex, wt = mesh.geometry.attributes.skinWeight;
    let maxArm = 0, minSum = Infinity;
    for (const i of indices) {
      let arm = 0, sum = 0;
      for (let k = 0; k < 4; k++) {
        const weight = wt.getComponent(i, k);
        sum += weight;
        if (/^(?:DEF-)?(?:upper_arm|forearm|hand)\./.test(mesh.skeleton.bones[ji.getComponent(i, k)].name)) arm += weight;
      }
      maxArm = Math.max(maxArm, arm);
      minSum = Math.min(minSum, sum);
    }
    return { maxArm, minSum };
  }, chest.vertices);
  check('Maul chest pieces have torso weights and no arm pull',
    torso.maxArm < 0.02 && torso.minSum > 0.99, torso);

  await h.page.locator('#pauseAnimation').click();
  for (const pose of ['saberIdle', 'saber1', 'saber2', 'saber3']) {
    await h.page.locator('#pose').selectOption(pose);
    let worst = 0;
    for (const fraction of [0, 0.25, 0.5, 0.75, 0.95]) {
      await h.page.locator('#animationTime').evaluate((slider, value) => {
        slider.value = String(Math.floor(Number(slider.max) * value));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, fraction);
      const gap = await h.page.evaluate((groups) => {
      let mesh;
      window.__wb.figures[0].inst.root.traverse((o) => {
        if (o.isSkinnedMesh && o.geometry.attributes.position.count === 22933) mesh = o;
      });
      mesh.updateWorldMatrix(true, false);
      const V = mesh.position.constructor, pos = mesh.geometry.attributes.position;
      const points = (ids) => ids.map((i) => {
        const v = new V(pos.getX(i), pos.getY(i), pos.getZ(i));
        mesh.applyBoneTransform(i, v).applyMatrix4(mesh.matrixWorld);
        return v;
      });
      return groups.map(([upper, lower]) => {
        const a = points(upper), b = points(lower);
        let min = Infinity;
        for (const u of a) for (const v of b) min = Math.min(min, u.distanceTo(v));
        return min;
      });
      }, pairs);
      worst = Math.max(worst, ...gap);
    }
    check(`Maul ${pose}: both elbows stay joined throughout the clip`, worst < 0.012, worst);
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Maul skin');
