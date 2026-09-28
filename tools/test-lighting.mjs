/** Dark-board fill, select-stage reveal and saber lights follow the live blades. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
const start = async (board, character) => {
  // 'auto' would hand the lights back on a machine drawing at software-GL speed
  await h.page.evaluate(() => { window.__config.video.saberLights = 'on'; });
  await h.startMode('wave', 1, board, [character]);
};
/**
 * Where the saber lights are this frame: the pool's lights that are lit, and
 * how far each is from the nearest of the named blades that is showing. The
 * pool is placed as the frame is drawn, so draw one.
 */
const LIT = `(names) => {
  const game = window.__game;
  window.__renderOnce();
  const lit = game.saberLights.lights.filter((l) => l.intensity > 0);
  const blades = [];
  for (const root of names.roots) root.traverse((o) => { if (o.userData.saberLight) blades.push(o); });
  const showing = blades.filter((b) => { for (let p = b; p; p = p.parent) if (!p.visible) return false; return true; });
  const near = (l) => Math.min(...showing.map((b) => b.getWorldPosition(l.position.clone()).distanceTo(l.position)));
  return { pool: game.saberLights.lights.length, lit: lit.length, showing: showing.length,
    worst: lit.length ? Math.max(...lit.map(near)) : 0 };
}`;

try {
  await start('nevarro', 'din');
  const lava = await h.page.evaluate(() => {
    const game = window.__game;
    const ambient = game.scene.children.find((o) => o.type === 'AmbientLight');
    const saber = game.players[0].char.root.getObjectByName('saberHandR');
    let asks = false;
    saber?.traverse((o) => { if (o.userData.saberLight) asks = true; });
    return { ambient: ambient?.intensity, darksaberAsks: asks, pool: game.saberLights.lights.length };
  });
  check('Lava Flats has the brighter ambient floor', lava.ambient === 0.58, lava);
  check('Darksaber emits no area light, and Din gets no saber lights at all',
    !lava.darksaberAsks && lava.pool === 0, lava);
  if (process.env.LIGHTING_SCREENSHOT) await h.shot(process.env.LIGHTING_SCREENSHOT);

  await start('station', 'ventress');
  const thrown = await h.page.evaluate(`(() => {
    const game = window.__game, player = game.players[0], char = player.char;
    const lit = ${LIT};
    const lights = () => game.scene.children.filter((o) => o.isPointLight).length;
    const count0 = lights();
    char.setWeapon('none');
    const stowed = lit({ roots: [char.root] });
    char.setWeapon('gaffi');
    const held = lit({ roots: [char.root] });
    player.releaseSaber(1, game);
    const inFlight = lit({ roots: [char.root, player.throwFx] });
    return {
      ambient: game.scene.children.find((o) => o.type === 'AmbientLight')?.intensity,
      stowed, held, inFlight,
      leftHandHidden: !char.root.getObjectByName('saberHandL').visible,
      rightHandLit: char.root.getObjectByName('saberHandR').visible,
      lightCountSteady: lights() === count0,
    };
  })()`);
  check('other boards have a modest ambient floor', thrown.ambient === 0.32, thrown);
  check('a pair of sabers gets a pool of two, dark while stowed',
    thrown.held.pool === 2 && thrown.stowed.lit === 0, thrown);
  check('both held blades have light', thrown.held.lit === 2 && thrown.held.worst < 0.8, thrown.held);
  check('off-hand throw moves its light while the held blade stays lit',
    thrown.leftHandHidden && thrown.rightHandLit && thrown.inFlight.lit === 2 && thrown.inFlight.worst < 0.8, thrown.inFlight);
  check('drawing, stowing and throwing never change how many lights the scene has',
    thrown.lightCountSteady, thrown);


  // 'auto' hands the pool back after sustained slow frames, and 'off' is off
  const auto = await h.page.evaluate(() => {
    const pool = window.__game.saberLights;
    for (let i = 0; i < 20; i++) pool.watch(0.05, 'auto');       // one second of 20 fps
    const afterBlip = pool.lights.length;
    for (let i = 0; i < 100; i++) pool.watch(0.05, 'auto');      // five seconds of it
    const afterSlow = { n: pool.lights.length, by: pool.disabledBy };
    pool.setMode('on');
    const back = pool.lights.length;
    pool.setMode('off');
    return { afterBlip, afterSlow, back, off: pool.lights.length };
  });
  check("'auto' rides out a slow second but gives the lights up after sustained slow frames",
    auto.afterBlip === 2 && auto.afterSlow.n === 0 && auto.afterSlow.by === 'framerate', auto);
  check("'on' brings the pool back and 'off' takes it away", auto.back === 2 && auto.off === 0, auto);

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
