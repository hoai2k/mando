import { ASSET_ROOT } from '../core/assets';

/**
 * The front end's typefaces, self-hosted under `assets/fonts/` so the menus
 * look the same offline as on.
 *
 * Registered from script rather than from `@font-face` in the stylesheet: the
 * files are served from `public/`, and a relative URL in CSS resolves against
 * the stylesheet's own path, which is a different place in the dev server and
 * the built site. `ASSET_ROOT` is the one base every other asset already uses.
 *
 * Every face has a system fallback in the stylesheets, so a file that fails to
 * arrive costs a look, never a screen.
 *
 * Licences: Anton, Playfair Display, Barlow Condensed, Alfa Slab One and IBM
 * Plex Mono are SIL Open Font Licence 1.1; Special Elite is Apache 2.0. See
 * `public/assets/fonts/README.md`.
 */
const FACES: Array<[family: string, file: string, descriptors?: FontFaceDescriptors]> = [
  ['Anton', 'anton-400.woff2'],
  ['Playfair Display', 'playfair-display-italic-600.woff2', { style: 'italic', weight: '600' }],
  ['Barlow Condensed', 'barlow-condensed-500.woff2', { weight: '500' }],
  ['Barlow Condensed', 'barlow-condensed-600.woff2', { weight: '600' }],
  ['Barlow Condensed', 'barlow-condensed-700.woff2', { weight: '700' }],
  ['Alfa Slab One', 'alfa-slab-one-400.woff2'],
  ['Special Elite', 'special-elite-400.woff2'],
  ['IBM Plex Mono', 'ibm-plex-mono-600.woff2', { weight: '600' }],
];

export function loadFonts(): void {
  if (typeof FontFace === 'undefined') return;
  for (const [family, file, desc] of FACES) {
    const face = new FontFace(family, `url(${ASSET_ROOT}assets/fonts/${file})`, { display: 'swap', ...desc });
    document.fonts.add(face);
    face.load().catch(() => { /* the fallback stack stands in */ });
  }
}
