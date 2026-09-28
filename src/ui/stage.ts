/**
 * The front end's fixed stage.
 *
 * The title, the territory boards, the mission map, the hunter select and the
 * drop screen are laid out at 1280×720, the size they were designed at, and
 * scaled as a whole to fit the window. A screen's own background still fills
 * the window edge to edge; only the furniture sits on the stage. That keeps
 * every screen exactly as it was drawn at any window shape, rather than
 * re-deriving each layout in viewport units.
 *
 * `--fe-scale` is the one number the stylesheet needs; it is kept current here.
 */
export const STAGE_W = 1280;
export const STAGE_H = 720;

function fit(): void {
  const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  document.documentElement.style.setProperty('--fe-scale', s.toFixed(4));
}

let installed = false;
export function installStage(): void {
  if (installed) return;
  installed = true;
  fit();
  window.addEventListener('resize', fit);
}

/** A stage element, appended to `parent`: everything a screen lays out goes in here. */
export function makeStage(parent: HTMLElement, className = ''): HTMLElement {
  installStage();
  const el = document.createElement('div');
  el.className = `fe-stage ${className}`.trim();
  parent.appendChild(el);
  return el;
}
