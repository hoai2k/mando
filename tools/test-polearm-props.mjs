/** The three assigned polearms must replace their procedural stand-ins. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  for (const [character, model] of [
    ['din', 'beskar_spear'], ['armorer', 'poleaxe'], ['npc:tusken', 'gaffi_collection'],
  ]) {
    await h.page.evaluate(([id]) => {
      window.__quitToTitle?.();
      window.__startMode('wave', 1, 'desert', [id]);
    }, [character]);
    await h.page.waitForFunction(([id]) => {
      const p = window.__game?.players[0];
      return window.__state === 'playing' && p?.characterId === id;
    }, [character], { timeout: 120000 });
    await h.page.waitForFunction((asset) => {
      const root = window.__game?.players[0]?.char.root;
      return !!root?.getObjectByName(asset);
    }, model, { timeout: 15000 }).catch(async () => {
      const names = await h.page.evaluate(() => {
        const out = [];
        window.__game.players[0].char.root.traverse((o) => { if (o.name) out.push(o.name); });
        return out.filter((name) => /spear|axe|gaffi|tripo|polearm/i.test(name));
      });
      throw new Error(`${character} did not load ${model}; matching nodes: ${names.join(', ')}`);
    });
    const loaded = await h.page.evaluate(([asset]) => {
      const p = window.__game.players[0], root = p.char.root;
      p.weapon = 'gaffi';
      p.char.setWeapon('gaffi');
      const node = root.getObjectByName(asset);
      let mesh = node?.isMesh && node.visible ? node : null;
      // A named hand group also contains its hidden procedural fallback.
      // Check the visible authored mesh rather than the first child mesh.
      node?.traverse((child) => { if (!mesh && child.isMesh && child.visible) mesh = child; });
      let shown = !!mesh;
      for (let current = mesh; current && current !== root; current = current.parent)
        shown &&= current.visible;
      return {
        mesh: !!mesh?.isMesh,
        triangles: mesh?.geometry?.index?.count / 3 ?? mesh?.geometry?.attributes?.position?.count / 3,
        material: !!mesh?.material,
        visible: shown,
        label: p.weaponLabel(),
      };
    }, [model]);
    check(`${character}: ${model} loads as a textured weapon`,
      loaded.mesh && loaded.triangles > 100 && loaded.material && loaded.visible, loaded);
    check(`${character}: weapon name appears in HUD`,
      loaded.label === (character === 'din' ? 'Beskar Spear'
        : character === 'armorer' ? 'Poleaxe' : 'Gaffi Stick'), loaded);
    if (process.env.POLEARM_SCREENSHOT_DIR && character !== 'npc:tusken')
      await h.shot(`${process.env.POLEARM_SCREENSHOT_DIR}/${character}-polearm.png`);
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Polearm props');
