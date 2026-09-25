/** The split weapon GLBs appear on their intended enemies, including officer FX. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const subjects = [
  ['pyke', 'enemy_blaster_rifle'],
  ['pirateMelee', 'pirate_boarding_club'],
  ['flametrooper', 'flame_projector'],
  ['quarren', 'net_launcher'],
  ['alamite', 'alamite_stone_club'],
  ['officer', 'electrostaff'],
];
const h = await launch({ url: `${base}/workbench/?character=pyke&pose=idle&mode=authored` });
try {
  for (const [id, prop] of subjects) {
    await h.page.goto(`${base}/workbench/?character=${id}&pose=idle&mode=authored`);
    await h.page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
      undefined, { timeout: 120000 });
    const result = await h.page.evaluate((model) => {
      const root = window.__wb.figures[0].inst.root;
      const fetched = performance.getEntriesByType('resource')
        .map((resource) => resource.name.split('/').pop());
      const mount = root.getObjectByName('weaponMount');
      const fx = root.getObjectByName('electrostaffElectricity');
      return {
        fetched: fetched.includes(`${model}.glb`),
        mounted: !!mount?.children.length,
        arcs: fx?.children.filter((child) => child.type === 'Line').length ?? 0,
        tips: fx?.children.filter((child) => child.type === 'Mesh').length ?? 0,
      };
    }, prop);
    check(`${id}: ${prop} loaded on hand`, result.fetched && result.mounted, result);
    if (id === 'officer') check('officer: four purple arcs at each of two tips',
      result.arcs === 8 && result.tips === 2, result);
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Enemy weapon props');
