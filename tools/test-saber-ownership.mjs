/** One saber belongs at its hip, hand, or in flight, never in two places. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  for (const id of ['ventress', 'jedi', 'maris', 'maul', 'revan']) {
    await h.page.evaluate((character) => {
      window.__manual = false;
      window.__quitToTitle?.();
      window.__startMode('campaign', 1, 'station', [character]);
    }, id);
    await h.page.waitForFunction((character) => {
      if (window.__state !== 'playing' || window.__game?.players[0]?.characterId !== character) return false;
      const char = window.__game.players[0].char;
      if (!char.modelReady()) return false;
      const hand = char.root.getObjectByName('saberHandR');
      return hand?.children.some((child) =>
        child !== hand.userData.blade && child.type === 'Group' && child.children.length > 0);
    }, id, { timeout: 120000 });

    const states = await h.page.evaluate(() => {
      const player = window.__game.players[0];
      const char = player.char;
      const root = char.root;
      const visible = () => Object.fromEntries(['saberHandR', 'saberHandL', 'saberHolsterR', 'saberHolsterL']
        .map((name) => [name, root.getObjectByName(name)?.visible]));
      char.setWeapon('none');
      const stowed = visible();
      char.setWeapon('gaffi');
      const drawn = visible();
      char.setSaberHeld(0, false);
      const rightThrown = visible();
      char.setWeapon('none');
      const leftStowedRightThrown = visible();
      char.setSaberHeld(0, true);
      const returned = visible();
      const rightHand = root.getObjectByName('saberHandR');
      const bladeLight = rightHand?.getObjectByProperty('type', 'PointLight');
      const authoredHilt = rightHand?.children.some((child) =>
        child !== rightHand.userData.blade
        && child.type === 'Group'
        && child.children.length > 0);
      return {
        modelLoaded: char.modelReady(), nozzles: char.nozzles.length,
        stowed, drawn, rightThrown, leftStowedRightThrown, returned,
        bladeLight: bladeLight?.color?.getHex(), authoredHilt,
        oppositeBlade: !!rightHand?.userData.oppositeBlade,
      };
    });
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(`${id}: authored body loaded`, states.modelLoaded, states);
    if (id !== 'ventress') check(`${id}: separated authored hilt loaded`, states.authoredHilt, states);
    if (id === 'maul' || id === 'revan') {
      check(`${id}: correct blade count`, states.oppositeBlade === (id === 'maul'), states);
      check(`${id}: stows one hilt at the waist`,
        eq(states.stowed, { saberHandR: false, saberHolsterR: true }), states);
      check(`${id}: draws that hilt into his right hand`,
        eq(states.drawn, { saberHandR: true, saberHolsterR: false }), states);
      check(`${id}: has no duplicate hilt after a throw`,
        eq(states.rightThrown, { saberHandR: false, saberHolsterR: false }), states);
      check(`${id}: catches and stows the same hilt`,
        eq(states.returned, { saberHandR: false, saberHolsterR: true }), states);
      check(`${id}: has no jetpack nozzles`, states.nozzles === 0, states);
      check(`${id}: blade light is red`, states.bladeLight === 0xff3a24, states);
      continue;
    }
    check(`${id}: both hilts stow handle-up at the waist`,
      eq(states.stowed, { saberHandR: false, saberHandL: false, saberHolsterR: true, saberHolsterL: true }), states);
    check(`${id}: drawing moves both hilts to the hands`,
      eq(states.drawn, { saberHandR: true, saberHandL: true, saberHolsterR: false, saberHolsterL: false }), states);
    check(`${id}: thrown right saber is absent from hip and hand`,
      eq(states.rightThrown, { saberHandR: false, saberHandL: true, saberHolsterR: false, saberHolsterL: false }), states);
    check(`${id}: the other hand can stow independently`,
      eq(states.leftStowedRightThrown, { saberHandR: false, saberHandL: false, saberHolsterR: false, saberHolsterL: true }), states);
    check(`${id}: catch returns the right hilt to its hip when stowed`,
      eq(states.returned, { saberHandR: false, saberHandL: false, saberHolsterR: true, saberHolsterL: true }), states);
    if (id === 'jedi') {
      check('Jedi has no jetpack nozzles', states.nozzles === 0, states);
      check('Jedi blade light is cool white', states.bladeLight === 0xddefff, states);
    } else if (id === 'maris') {
      check('Maris has no jetpack nozzles', states.nozzles === 0, states);
      check('Maris tonfa blade light is white', states.bladeLight === 0xddefff, states);
    } else check('Ventress blade light stays red', states.bladeLight === 0xff3a24, states);
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Saber ownership');
