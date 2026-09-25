/** One exported hand anchor follows every pose of the same weapon. */
import { readFileSync } from 'node:fs';
import { launch, makeCheck } from './harness.mjs';

const data = JSON.parse(readFileSync('src/characters/data/sharedWeaponGrips.json', 'utf8'));
const check = makeCheck();
const base = `http://localhost:${process.env.HARNESS_PORT ?? '4173'}`;
const h = await launch({ url: `${base}/workbench/?character=din&pose=idle&mode=authored` });
const near = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 1e-5);

try {
  for (const id of ['din', 'embo', 'ig11', 'paz', 'revan']) {
    await h.page.goto(`${base}/workbench/?character=${id}&pose=${id === 'revan' ? 'flourish' : 'idle'}&mode=authored`);
    await h.page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
      undefined, { timeout: 120000 });
    const expected = data.entries.find((e) => e.character === id);
    const scale = data.weaponScales.find((e) => e.character === id)?.scaleMultiplier ?? 1;
    const poses = id === 'revan' ? ['flourish', 'saberIdle', 'saberRun'] : ['idle', 'aim', 'run'];
    for (const pose of poses) {
      await h.page.locator('#pose').selectOption(pose);
      const actual = await h.page.evaluate((saber) => {
        const root = window.__wb.figures[0].inst.root;
        const mount = root.getObjectByName('weaponMount');
        const weapon = saber ? mount.children.find((c) => c.name === 'saberHandR') : mount.children[0];
        const holster = saber ? root.getObjectByName('saberHolsterR') : null;
        return { position: weapon.position.toArray(), quaternion: weapon.quaternion.toArray(),
          scale: weapon.scale.x, holsterScale: holster?.scale.x };
      }, id === 'revan');
      check(`${id} ${pose}: shared hand grip and scale`,
        near(actual.position, expected.editedPosition)
          && (near(actual.quaternion, expected.editedQuaternion)
            || near(actual.quaternion, expected.editedQuaternion.map((n) => -n)))
          && actual.scale === scale && (id !== 'revan' || actual.holsterScale === scale));
    }
  }
  for (const entry of data.entries.filter((e) => !['din', 'embo', 'ig11', 'paz', 'revan'].includes(e.character))) {
    await h.page.goto(`${base}/workbench/?character=${entry.character}&pose=idle&mode=authored`);
    await h.page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
      undefined, { timeout: 120000 });
    const actual = await h.page.evaluate((side) => {
      const root = window.__wb.figures[0].inst.root;
      const mount = root.getObjectByName(side === 'left' ? 'weaponMountL' : 'weaponMount');
      const weapon = mount?.children[0];
      return weapon && { position: weapon.position.toArray(),
        quaternion: weapon.quaternion.toArray(), scale: weapon.scale.x };
    }, entry.side);
    const scale = data.weaponScales.find((e) => e.character === entry.character
      && e.side === entry.side)?.scaleMultiplier ?? 1;
    check(`${entry.character} ${entry.side}: authored grip and scale`, !!actual
      && near(actual.position, entry.editedPosition)
      && (near(actual.quaternion, entry.editedQuaternion)
        || near(actual.quaternion, entry.editedQuaternion.map((n) => -n)))
      && Math.abs(actual.scale - scale) < 1e-5, actual);
  }
  await h.page.goto(`${base}/workbench/?character=pirate&pose=idle&mode=authored`);
  await h.page.waitForFunction(() => window.__wb?.figures?.[0]?.inst.modelReady?.(),
    undefined, { timeout: 120000 });
  const pirateRifle = await h.page.evaluate(() => {
    const mount = window.__wb.figures[0].inst.root.getObjectByName('weaponMount');
    return mount.children[0].position.toArray();
  });
  check('blaster pirate does not receive the melee pirate club grip',
    !near(pirateRifle, data.entries.find((e) => e.character === 'pirateMelee').editedPosition));
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Shared weapon grips');
