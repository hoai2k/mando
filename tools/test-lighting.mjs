/** Dark-board fill, select-stage reveal and saber lights follow the live blades. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const start = async (board, character) => {
  await h.page.evaluate(([b, c]) => {
    window.__quitToTitle?.();
    window.__startMode('wave', 1, b, [c]);
  }, [board, character]);
  await h.page.waitForFunction(([b, c]) => window.__state === 'playing'
    && window.__game?.board.kind === b && window.__game.players[0].characterId === c,
  [board, character], { timeout: 120000 });
};

try {
  await start('nevarro', 'din');
  const lava = await h.page.evaluate(() => {
    const game = window.__game;
    const ambient = game.scene.children.find((o) => o.type === 'AmbientLight');
    const saber = game.players[0].char.root.getObjectByName('saberHandR');
    return { ambient: ambient?.intensity, darksaberLight: !!saber?.getObjectByProperty('type', 'PointLight') };
  });
  check('Lava Flats has the brighter ambient floor', lava.ambient === 0.58, lava);
  check('Darksaber emits no area light', !lava.darksaberLight, lava);
  if (process.env.LIGHTING_SCREENSHOT) await h.shot(process.env.LIGHTING_SCREENSHOT);

  await start('station', 'ventress');
  const thrown = await h.page.evaluate(() => {
    const game = window.__game, player = game.players[0], char = player.char;
    char.setWeapon('gaffi');
    const held = ['saberHandR', 'saberHandL'].map((name) => {
      const blade = char.root.getObjectByName(name);
      return blade.visible && !!blade.getObjectByProperty('type', 'PointLight');
    });
    player.releaseSaber(1, game);
    const flight = player.throwFx.children.find((o) => o.visible);
    return {
      ambient: game.scene.children.find((o) => o.type === 'AmbientLight')?.intensity,
      held,
      leftHandHidden: !char.root.getObjectByName('saberHandL').visible,
      rightHandLit: char.root.getObjectByName('saberHandR').visible,
      flightLit: !!flight?.getObjectByProperty('type', 'PointLight'),
    };
  });
  check('other boards have a modest ambient floor', thrown.ambient === 0.32, thrown);
  check('both held blades have light', thrown.held.every(Boolean), thrown);
  check('off-hand throw moves its light while the held blade stays lit',
    thrown.leftHandHidden && thrown.rightHandLit && thrown.flightLit, thrown);

  await h.page.evaluate(() => window.__charsel.show());
  const before = await h.page.evaluate(() => window.__charsel.slots[0].backGlow.intensity);
  check('select glow starts dark', before === 0, before);
  await h.page.waitForFunction(() => {
    const select = window.__charsel, slot = select.slots[0];
    select.update(0.05);
    return slot.chars.get(select.roster[slot.choice])?.modelReady() && slot.backGlow.intensity > 0;
  }, null, { timeout: 120000 });
  const after = await h.page.evaluate(() => window.__charsel.slots[0].backGlow.intensity);
  check('select glow fades in after the 3D model loads', after > 0 && after < 1.5, after);
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Lighting');
