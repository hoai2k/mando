/**
 * Split-screen geometry, in one place so the renderer's viewports and the
 * HUD's DOM panels can never disagree about where a player's screen is.
 *
 * Rectangles are fractions of the window with the origin at the **top left**,
 * which is what CSS wants. WebGL measures from the bottom, so the renderer
 * flips y on its way out — see `glRect`.
 */
export interface Rect { x: number; y: number; w: number; h: number; }

/** the most players one screen will take */
export const MAX_PLAYERS = 4;

/**
 * Three players get two on top and one across the bottom rather than a blank
 * quadrant: nobody wants the smallest share of the screen *and* a hole next to
 * them, and a solo bottom strip reads as a deliberate layout instead of a
 * missing fourth.
 */
export function splitLayout(count: number): Rect[] {
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
