/** Xbox gameplay buttons and the rendered controls copy stay in sync. */
import { launch, makeCheck } from './harness.mjs';

const check = makeCheck();
const h = await launch();
try {
  await h.startCoop(1, 'desert');
  const result = await h.page.evaluate(() => {
    window.__manual = true;
    const input = window.__input;
    const pad = window.__pads[0];
    input.padForPlayer[0] = 0;
    input.menuMode = false;
    const read = (button) => {
      pad.buttons.fill(0);
      input.read(0, 1 / 60);
      pad.buttons[button] = 1;
      const out = input.read(0, 1 / 60);
      pad.buttons.fill(0);
      input.read(0, 1 / 60);
      return { block: out.blockHeld, cover: out.slamPressed, special: out.rocketPressed };
    };
    return { rb: read(5), y: read(3), b: read(1) };
  });
  check('RB holds the shield', result.rb.block && !result.rb.cover && !result.rb.special, result);
  check('Y activates cover, riding or ground slam', result.y.cover && !result.y.block && !result.y.special, result);
  check('B activates the character special', result.b.special && !result.b.block && !result.b.cover, result);
} finally {
  await h.close();
}
check.done('controller bindings');
