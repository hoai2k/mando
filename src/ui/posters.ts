import { ASSET_ROOT } from '../core/assets';
import { warmImage, warmQueue, type WarmPriority } from '../core/warm';

// ============================================================================
// posters — the pre-rendered fighter pictures the character select flips
// through, and the contract that keeps them interchangeable with the models.
//
// WHY. Putting a fighter on a plinth is not free: a .glb download, a parse, a
// skinned-mesh upload and a bounds measurement all land on the main thread.
// Paying that on every press of ◀ is what makes flipping feel stuck — and the
// spinner that covers it, honest as it is, means the roster cannot be browsed
// at all until each model lands. So a flip shows a PICTURE, and the real body
// is built only once the player has settled on a choice (SETTLE_MS) or locked
// it in. A fighter already built stays built; the picture is never shown for
// it again.
//
// A POSTER IS A STAND-IN FOR THE MODEL, NOT FOR THE CHARACTER. It is rendered
// from the authored .glb, through the select screen's own camera, on the
// select screen's own plinth — so what the picture shows is exactly what the
// model will show when it takes over. The generator refuses to write a poster
// that came out procedural for a fighter that has a .glb: a picture of the
// stand-in looks like a deliberate art choice, and nobody notices it is wrong
// until they compare it against the fight.
//
// THE CORRELATION. A poster is not "a picture of a fighter", it is a picture
// of a KNOWN RECT. tools/posters.mjs renders each fighter through
// `CharacterSelect.posterShot`, which uses the screen's own camera and plinth
// rather than a re-derived copy, so the two cannot drift. What it records is
// the box the body occupies in WORLD UNITS OFF ITS OWN FEET — a property of
// the body, not of the framing — and the runtime re-projects that box through
// whatever camera the stage is currently using. That is what lets one
// reference render serve one plinth or four, at any window shape, as the
// camera eases back and the line re-spaces itself.
//
// A DOM <img> over that rect, not a billboard in the scene: the picture
// already contains what a perspective camera does to a body with depth, which
// a flat quad in the world cannot reproduce.
//
// WHAT IS NOT PINNED. A cape is a spring simulation that integrates over dt
// (see `cape` in characters/builder.ts), so its hang depends on how many
// frames it has been stepped — which is how long that fighter's .glb took.
// The rig pose, the yaw and the framing are all pinned, so a regeneration
// reproduces most fighters exactly; the half-dozen who wear cloth come back a
// few pixels wider or narrower as the cape sits differently. It is a still of
// a swinging cape either way, and the live model's cape starts from its own
// state regardless, so there is nothing to match. Left alone deliberately:
// forcing it would mean either running the sim to a steady state (which also
// winds on every creature's animation mixer, trading a settled cape for an
// unsettled beast) or freezing cloth that is supposed to move.
//
// Regenerate after any change to a fighter's model, rig, rest pose or scale,
// or to the select screen's camera:
//     npm run build && node tools/posters.mjs
// ============================================================================

/**
 * Margin around the measured silhouette, so a rim light or an antialiased
 * edge is never clipped by the crop.
 */
export const POSTER_PAD = 1.06;
/** Reference render height in pixels, and the aspect it is rendered at. */
export const POSTER_PX = 760;
export const POSTER_ASPECT = 16 / 9;
/**
 * How long a choice must sit still before its real body is built.
 *
 * Long enough that holding ◀ through the roster builds nothing, short enough
 * that stopping on someone feels like it committed to them.
 */
export const SETTLE_MS = 550;

/**
 * The point in the idle loop every poster is posed at.
 *
 * A fixed absolute time rather than "however far the idle had run by the time
 * the model landed", which is what it used to be: the generator drives the
 * screen's own update loop while it waits for a .glb, so the pose depended on
 * how long the download took and the same fighter came out differently on
 * every run. Any settled point in the loop will do; what matters is that it is
 * the same one every time.
 *
 * The plinth holds a body at this same instant for as long as its picture is
 * still the thing on screen, so the swap lands on the frame the picture froze
 * and the fighter does not change stance as it happens. (`Animator.poseAt`
 * also has to finish the idle's crossfade: a fade that has never been stepped
 * sits at no weight, and a mixer update of zero seconds spends none of the
 * time it needs — which is how every poster came to be shot with the rig in
 * its bind stance, arms flat at the sides, while the live model stood there
 * in the idle with its arms relaxed out.)
 */
export const POSTER_ANIM_T = 1.2;

/** Where the generator writes, relative to the site root. */
export const POSTER_DIR = 'posters';

/**
 * The filename a playable answers to. Playable ids carry a `npc:` prefix for
 * the hostile kinds, which has no business in a path — the portraits already
 * drop it the same way (see `portraitName`), and no Mandalorian shares a name
 * with a hostile kind, so the two cannot collide.
 */
export function posterName(id: string): string { return id.replace('npc:', ''); }

export function posterUrl(id: string): string {
  return `${ASSET_ROOT}${POSTER_DIR}/${posterName(id)}.png`;
}

/**
 * The box a fighter's picture spans, in world units measured off its feet:
 * `u` across, `v` up, with 0 at the middle of the plinth and at the floor.
 */
export interface PosterBox { u0: number; u1: number; v0: number; v1: number }

let index: Record<string, PosterBox> | null = null;
let indexPromise: Promise<Record<string, PosterBox>> | null = null;

/**
 * The generated index, or an empty one when the posters were never generated.
 *
 * Every caller degrades to "no poster for this fighter", which is the
 * behaviour the select screen had before any of this existed: build the body,
 * hold a spinner until it lands. So a missing or stale index costs a slower
 * flip and nothing else, and the game still runs from a fresh checkout with no
 * generated art in it at all.
 */
export function loadPosterIndex(): Promise<Record<string, PosterBox>> {
  if (!indexPromise) {
    indexPromise = fetch(`${ASSET_ROOT}${POSTER_DIR}/posters.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((j: { fighters?: Record<string, PosterBox> }) => {
        index = j?.fighters ?? {};
        return index;
      });
  }
  return indexPromise;
}

/** Synchronous lookup — null until `loadPosterIndex` has resolved. */
export function posterMeta(id: string): PosterBox | null {
  return (index && index[posterName(id)]) || null;
}

/** Every fighter the index knows a picture for, for warming them. */
export function posterIds(): string[] { return index ? Object.keys(index) : []; }

/**
 * Pull a fighter's picture down ahead of the screen that flips through them.
 *
 * Through an <img>, because that is how the select screen asks for it — a
 * fetch would land in a different cache and download every one of them twice
 * (see `warmImage`). A fighter the index knows nothing about is skipped
 * rather than guessed at: a poster that does not exist costs a 404 per
 * fighter per session, for a picture that was never going to be shown.
 */
export function warmPoster(id: string, priority: WarmPriority = 'idle'): void {
  if (!posterMeta(id)) return;
  const url = posterUrl(id);
  warmQueue.want(url, priority, () => warmImage(url));
}
