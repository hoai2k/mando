/**
 * Split-screen geometry, in one place so the renderer's viewports and the
 * HUD's DOM panels can never disagree about where a player's screen is.
 *
 * Rectangles are fractions of the window with the origin at the **top left**,
 * which is what CSS wants. WebGL measures from the bottom, so the renderer
 * flips y on its way out — see `glRect`.
 */
import { config, type SplitMode } from '../config';

export interface Rect { x: number; y: number; w: number; h: number; }

/** the most players one screen will take */
export const MAX_PLAYERS = 4;

/**
 * The most fighters a match will hold: humans plus bots.
 *
 * Only humans need a piece of the screen, which is what MAX_PLAYERS is about;
 * a bot needs a body and nothing else, so the two numbers are different on
 * purpose. Eight is what the PvP arena and the select's line of plinths are
 * built to hold.
 */
export const MAX_FIGHTERS = 8;

/**
 * Three players get two on top and one across the bottom rather than a blank
 * quadrant: nobody wants the smallest share of the screen *and* a hole next to
 * them, and a solo bottom strip reads as a deliberate layout instead of a
 * missing fourth.
 *
 * The `columns` preference is the same set of rectangles reflected about the
 * diagonal — rows become columns, the wide third player becomes a tall one —
 * which is why one setting covers every player count instead of needing a
 * picture per case. Four is symmetric, so only two and three tell them apart.
 */
export function splitLayout(count: number, mode: SplitMode = config.video.split): Rect[] {
  const rows = stackedLayout(count);
  return mode === 'columns' ? rows.map(transpose) : rows;
}

/** swap a rectangle's axes: what was a row across the top becomes a left column */
function transpose(r: Rect): Rect {
  return { x: r.y, y: r.x, w: r.h, h: r.w };
}

function stackedLayout(count: number): Rect[] {
  switch (Math.max(1, Math.min(MAX_PLAYERS, count))) {
    case 1: return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 2: return [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ];
    case 3: return [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ];
    default: return [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ];
  }
}

/** the same rectangle in pixels, y measured from the bottom, for setViewport */
export function glRect(r: Rect, width: number, height: number): [number, number, number, number] {
  return [r.x * width, (1 - r.y - r.h) * height, r.w * width, r.h * height];
}
