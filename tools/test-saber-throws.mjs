/** Every playable saber wielder can throw and recover the hilts they carry. */
import { blankInput, launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  for (const id of ['ventress', 'jedi', 'maris', 'maul', 'revan', 'din']) {
    await h.startStepped('wave', 1, 'desert', [id]);
    const result = await h.page.evaluate(([base, character]) => {
      const game = window.__game;
      const player = game.players[0];
      player.hp = 10000;
      for (const enemy of game.enemies) { enemy.alive = false; enemy.removeMe = true; }
      const frame = (over = {}) => game.update(1 / 60, [{ ...base, ...over }, base, base, base]);
      const step = (count, over = {}) => { for (let i = 0; i < count; i++) frame(over); };
      const startedWithGun = player.weapon === 'blaster';
      if (character === 'din') {
        step(10, { shootHeld: true });
        step(5);
        frame({ meleeSwapPressed: true });
        frame();
      }
      const selected = { kind: player.meleeKind, weapon: player.weapon };
      const capacity = player.saberCapacity;
      step(36, { shootHeld: true });
      const thrown = {
        held: player.sabersHeld,
        weapon: player.weapon,
        state: player.thrownSabers[0]?.state,
        mainVisible: player.char.root.getObjectByName('saberHandR')?.visible,
        offhandExists: !!player.char.root.getObjectByName('saberHandL'),
        doubleBlade: !!player.thrownSabers[0]?.saber.userData.oppositeBlade,
      };
      if (character === 'din') frame({ rangedSwapPressed: true });
      step(150);
      const returned = player.sabersHeld;
      const finalWeapon = player.weapon;
      const finalState = player.thrownSabers[0]?.state;
      let morphCleared = null;
      if (character === 'din') {
        // A thrown hilt belongs to its original body, including when a
        // playable morph changes both the model and the hilt style.
        frame({ meleeSwapPressed: true });
        frame();
        frame({ meleeSwapPressed: true });
        frame();
        step(36, { shootHeld: true });
        const wasOut = player.thrownSabers[0]?.state !== 'held';
        player.morph('maul', game);
        morphCleared = wasOut && player.throwFx === null
          && player.thrownSabers.every((saber) => saber === null);
      }
      return {
        startedWithGun, selected, capacity, thrown,
        returned, finalWeapon, finalState,
        morphCleared,
      };
    }, [blankInput(), id]);
    check(`${id}: saber available before throw`, result.selected.kind === 'sabers'
      && result.selected.weapon === (result.startedWithGun ? 'gaffi' : 'none'), result);
    check(`${id}: one saber leaves its hand`, result.thrown.held === result.capacity - 1
      && result.thrown.state !== 'held' && result.thrown.mainVisible === false
      && result.thrown.weapon === 'gaffi', result);
    check(`${id}: saber returns to its owner`, result.returned === result.capacity
      && result.finalState === 'held', result);
    if (id === 'din') {
      check('Din keeps gun fire and can switch back while a saber returns',
        result.startedWithGun && result.finalWeapon === 'blaster', result);
      check('a character morph retires the old thrown saber', result.morphCleared, result);
    }
    if (id === 'maul') {
      check('Maul throws one double-ended saber', result.capacity === 1
        && !result.thrown.offhandExists && result.thrown.doubleBlade, result);
    }
  }
  check('browser reported no errors', h.errors.length === 0, h.errors);
} finally {
  await h.close();
}
check.done('Saber throws');
