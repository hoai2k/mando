import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const missing = new Set();
h.page.on('response', (response) => {
  if (response.status() === 404) missing.add(new URL(response.url()).pathname);
});
try {
  for (const [party, expected] of [
    [['jedi'], 'rivalMaul'],
    [['maul'], 'rivalRevan'],
    [['maul', 'revan'], 'gunslinger'],
  ]) {
    await h.page.evaluate((ids) => {
      window.__quitToTitle?.();
      window.__startMode('wave', ids.length, 'ringworld', ids);
    }, party);
    await h.page.waitForFunction(() => window.__state === 'playing' && !!window.__game);
    const boss = await h.page.evaluate(() => {
      const g = window.__game;
      const at = g.players[0].position.clone();
      at.x += 12;
      const e = g.spawnBoss(at, 'final');
      return { kind: e.kind, name: e.bossName };
    });
    check(`Ringworld boss avoids ${party.join(' + ')}`, boss.kind === expected, boss);
    if (expected !== 'gunslinger') {
      await h.page.waitForFunction(() => window.__game?.boss?.char?.modelReady?.(), null,
        { timeout: 120000 });
      const equipped = await h.page.evaluate(() => ({
        model: window.__game.boss.char.modelReady(),
        saber: window.__game.boss.char.gaffi.visible,
      }));
      check(`${expected} loads an authored body and drawn saber`,
        equipped.model && equipped.saber, equipped);
    }
  }

  await h.page.evaluate(() => {
    window.__quitToTitle?.();
    window.__startMode('wave', 2, 'ringworld', ['jedi', 'duelist']);
  });
  await h.page.waitForFunction(() => window.__state === 'playing' && !!window.__game);
  const waves = await h.page.evaluate(() => {
    const g = window.__game;
    const plans = [];
    g.stageArrivals = (plan) => { plans.push(plan.map((p) => p.kind)); };
    g.wave = 5;
    g.nextWave();
    g.wave = 6;
    g.nextWave();
    return plans;
  });
  check('wave 6 fields an unselected Force rival', waves[0]?.includes('rivalMaul'),
    waves[0]?.filter((kind) => kind.startsWith('rival')));
  check('wave 7 matches both Force and bounty hunter players',
    waves[1]?.includes('rivalMaul') && waves[1]?.includes('rivalEmbo'),
    waves[1]?.filter((kind) => kind.startsWith('rival')));
  check('selected Jedi and Cad Bane never appear as enemies',
    waves.every((wave) => !wave.includes('rivalGalen') && !wave.includes('rivalCadBane')),
    waves.map((wave) => wave.filter((kind) => kind.startsWith('rival'))));

  await h.page.evaluate(() => {
    window.__quitToTitle?.();
    window.__startMode('campaign', 1, 'station', ['din']);
  });
  await h.page.waitForFunction(() => window.__state === 'playing' && !!window.__game?.campaign);
  const mission = await h.page.evaluate(() => window.__game.campaign.squadFor(6, 12, null));
  check('late Missions squad gives Din an unselected Mandalorian rival',
    mission.includes('rivalBoKatan'), mission.filter((kind) => kind.startsWith('rival')));
  check('browser reported no unexpected errors',
    h.errors.length === 0 || (missing.size > 0
      && h.errors.every((error) => error.includes('Failed to load resource'))
      && [...missing].every((path) => /\/portrait_(?:jedi|maris|maul|revan)\.jpg$/.test(path))),
    { errors: h.errors.length, missing: [...missing] });
} finally {
  await h.close();
}
check.done('Party-aware rivals');
