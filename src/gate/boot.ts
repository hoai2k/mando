/**
 * The game's entry point, ahead of the game.
 *
 * `index.html` loads this instead of `src/main.ts` so that the door can go up
 * before anything else does. Three things happen here, and the order is the
 * point:
 *
 *  1. The door is shown — or, for a browser that has been let in before, it
 *     isn't, and this costs one microtask.
 *  2. **Warming starts while the visitor reads it.** Somebody at this door is
 *     about to play, so the seconds they spend signing in are spent pulling
 *     down the title screen's art and what follows it. `warmAhead` is a
 *     doorway into the game's own warming plan that does not boot the game;
 *     see `src/core/warmboot.ts` for why that module exists at all.
 *  3. The game is imported, which is what starts it.
 *
 * `src/gate/` knows none of this. It calls a hook and shows two strings — see
 * `GateOptions` — which is what makes it portable to another game unchanged.
 */
import { openGate } from './gate';

void openGate({
  title: 'Bounty Hunters',
  blurb: 'This game is for friends of Hoai Nguyen. Please log in with your Google account.',
  // Fire and forget, and deliberately not awaited: the game must not wait on
  // a warm-up, and a warm-up that fails must not keep anyone out. The import
  // is inside the hook so that a browser holding a pass — which never calls
  // this — does not pay for a module it is about to get from `main` anyway.
  warm: (signal) => {
    void import('../core/warmboot')
      .then((m) => m.warmAhead(signal))
      .catch(() => { /* a missed warm-up costs a later download, nothing more */ });
  },
}).then(() => import('../main'));
