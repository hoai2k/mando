/**
 * The game's entry point, ahead of the game.
 *
 * `index.html` loads this instead of `src/main.ts` so that the door is the
 * only thing a stranger's browser downloads: the game is behind a dynamic
 * import, which Vite splits into its own chunk and does not fetch until the
 * import runs. Somebody who never signs in never pulls Three.js, the boards or
 * the cast — which is both a better doorman and a faster page for everyone.
 *
 * With no gate configured (every dev server, every browser suite) `openGate`
 * resolves on the spot and this costs one microtask.
 */
import { openGate } from './gate';

void openGate().then(() => import('../main'));
