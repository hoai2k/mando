import * as THREE from 'three';
import { fbm2, makeRng } from './math';

/**
 * Texture pipeline: procedural canvas textures by default; if an authored
 * image exists at assets/textures/<name>, it transparently replaces the
 * procedural one (see docs/ASSETS_IMAGES.md).
 */

/**
 * Where the static assets sit relative to the page asking for them.
 *
 * Everything is built with a relative base so the site can live in a project
 * subdirectory on GitHub Pages, and the game is served from that root. The
 * model workbench is a second page one level down, so it needs one hop back up
 * to reach the same files.
 */
export const ASSET_ROOT = location.pathname.includes('/workbench') ? '../' : '';

const cache = new Map<string, THREE.Texture>();

export function texture(name: string, make: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256, repeat = 1): THREE.Texture {
  const key = `${name}:${size}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  make(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  // authored override, fire and forget; jpg first since that is what
  // tools/optimize-textures.mjs emits for opaque maps
  tryLoadImage(name, ['jpg', 'png'], (img) => {
    tex.image = img;
    tex.needsUpdate = true;
  });
  return tex;
}

/** Try each extension in order, calling back on the first that loads. */
function tryLoadImage(name: string, exts: string[], onLoad: (img: HTMLImageElement) => void): void {
  if (exts.length === 0) return; // none present — procedural look stands
  new THREE.ImageLoader().load(
    `${ASSET_ROOT}assets/textures/${name}.${exts[0]}`,
    onLoad,
    undefined,
    () => tryLoadImage(name, exts.slice(1), onLoad)
  );
}

/**
 * Load an authored texture if it is present, otherwise do nothing — the caller
 * keeps whatever procedural look it already had. Used for assets that have no
 * meaningful canvas fallback (skies, normal maps, signage).
 */
export function loadOptionalTexture(
  name: string,
  onLoad: (tex: THREE.Texture) => void,
  opts: { srgb?: boolean; exts?: string[] } = {}
): void {
  const exts = opts.exts ?? ['jpg', 'png'];
  if (exts.length === 0) return; // absent — procedural look stands
  new THREE.TextureLoader().load(
    `${ASSET_ROOT}assets/textures/${name}.${exts[0]}`,
    (tex) => {
      // normal/data maps must stay linear, colour maps are sRGB
      tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      onLoad(tex);
    },
    undefined,
    () => loadOptionalTexture(name, onLoad, { ...opts, exts: exts.slice(1) })
  );
}

function grain(ctx: CanvasRenderingContext2D, size: number, seed: number, alpha: number, dark = true): void {
  const rng = makeRng(seed);
  ctx.globalAlpha = alpha;
  for (let i = 0; i < size * 14; i++) {
    const v = rng() * 255 | 0;
    ctx.fillStyle = dark ? `rgb(${v * 0.2},${v * 0.17},${v * 0.12})` : `rgb(${v},${v},${v})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  ctx.globalAlpha = 1;
}

export const sandTexture = () => texture('sand_albedo', (ctx, s) => {
  ctx.fillStyle = '#c99f62';
  ctx.fillRect(0, 0, s, s);
  // wind ripples
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x += 4) {
      const r = fbm2(x * 0.02, y * 0.05, 3);
      const ripple = Math.sin((y + r * 40) * 0.25) * 0.5 + 0.5;
      const v = 0.86 + ripple * 0.17 + (r - 0.5) * 0.12;
      ctx.fillStyle = `rgb(${201 * v | 0},${159 * v | 0},${98 * v | 0})`;
      ctx.fillRect(x, y, 4, 1);
    }
  }
  grain(ctx, s, 7, 0.05);
}, 256, 40);

export const rockTexture = () => texture('rock_albedo', (ctx, s) => {
  for (let y = 0; y < s; y++) {
    const band = fbm2(3.3, y * 0.045, 3);
    const base = 0.72 + band * 0.4;
    for (let x = 0; x < s; x += 3) {
      const n = fbm2(x * 0.03, y * 0.03, 3);
      const v = base * (0.85 + n * 0.3);
      ctx.fillStyle = `rgb(${168 * v | 0},${126 * v | 0},${88 * v | 0})`;
      ctx.fillRect(x, y, 3, 1);
    }
  }
  grain(ctx, s, 12, 0.08);
}, 256, 3);

export const adobeTexture = () => texture('adobe_wall', (ctx, s) => {
  ctx.fillStyle = '#d3b98c';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 4000; i++) {
    const rng = fbm2(i * 0.7, i * 1.3, 2);
    ctx.fillStyle = `rgba(120,95,60,${0.04 + rng * 0.05})`;
    ctx.fillRect((i * 37) % s, (i * 91) % s, 2 + rng * 5, 1 + rng * 2);
  }
  grain(ctx, s, 3, 0.05);
}, 256, 2);

export const clothTexture = () => texture('tent_cloth', (ctx, s) => {
  ctx.fillStyle = '#a58c62';
  ctx.fillRect(0, 0, s, s);
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < s; i += 3) {
    ctx.fillStyle = i % 6 ? '#8f7850' : '#b59a6c';
    ctx.fillRect(0, i, s, 1);
    ctx.fillRect(i, 0, 1, s);
  }
  ctx.globalAlpha = 1;
  grain(ctx, s, 21, 0.07);
}, 128, 3);

export const deckTexture = () => texture('metal_deck', (ctx, s) => {
  ctx.fillStyle = '#4a4e55';
  ctx.fillRect(0, 0, s, s);
  const cell = s / 4;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * cell, y = gy * cell;
      ctx.strokeStyle = '#2c2f34';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
      ctx.fillStyle = `rgba(${30 + ((gx * 7 + gy * 13) % 20)},${32},${36},0.35)`;
      ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
      // tread dots
      ctx.fillStyle = '#585d66';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) ctx.fillRect(x + 8 + i * 10, y + 8 + j * 10, 3, 3);
    }
  }
  grain(ctx, s, 9, 0.09, false);
}, 256, 6);

export const hullTexture = () => texture('metal_hull', (ctx, s) => {
  ctx.fillStyle = '#8b8d90';
  ctx.fillRect(0, 0, s, s);
  const rng = makeRng(42);
  for (let i = 0; i < 14; i++) {
    const x = rng() * s, y = rng() * s, w = 30 + rng() * 90, h = 20 + rng() * 70;
    const v = 0.82 + rng() * 0.3;
    ctx.fillStyle = `rgb(${139 * v | 0},${141 * v | 0},${144 * v | 0})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(40,42,45,0.7)';
    ctx.strokeRect(x, y, w, h);
  }
  // grime streaks
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(50,45,38,${0.05 + rng() * 0.08})`;
    ctx.fillRect(rng() * s, rng() * s, 2 + rng() * 4, 12 + rng() * 50);
  }
  grain(ctx, s, 5, 0.06, false);
}, 256, 2);

export const crateTexture = () => texture('crate_side', (ctx, s) => {
  ctx.fillStyle = '#5d6247';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#3c4030';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, s - 10, s - 10);
  ctx.beginPath();
  ctx.moveTo(10, 10); ctx.lineTo(s - 10, s - 10);
  ctx.moveTo(s - 10, 10); ctx.lineTo(10, s - 10);
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,170,60,0.5)';
  for (let i = 0; i < 6; i++) ctx.fillRect(14 + i * 18, s - 26, 10, 8);
  grain(ctx, s, 33, 0.08);
}, 128, 1);

export const basaltTexture = () => texture('basalt_albedo', (ctx, s) => {
  ctx.fillStyle = '#3a3634';
  ctx.fillRect(0, 0, s, s);
  // cracked volcanic plates: dark cells split by darker seams
  const rng = makeRng(77);
  for (let i = 0; i < 60; i++) {
    const x = rng() * s, y = rng() * s, w = 14 + rng() * 40, h = 12 + rng() * 34;
    const v = 0.8 + rng() * 0.45;
    ctx.fillStyle = `rgb(${58 * v | 0},${54 * v | 0},${50 * v | 0})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(16,13,11,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }
  // faint ember veins in the deepest cracks
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = `rgba(200,80,20,${0.06 + rng() * 0.1})`;
    ctx.fillRect(rng() * s, rng() * s, 1 + rng() * 2, 6 + rng() * 22);
  }
  grain(ctx, s, 19, 0.08);
}, 256, 26);

export const snowTexture = () => texture('snow_albedo', (ctx, s) => {
  ctx.fillStyle = '#e8edf2';
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x += 4) {
      const r = fbm2(x * 0.03, y * 0.06, 3);
      const drift = Math.sin((y + r * 30) * 0.2) * 0.5 + 0.5;
      const v = 0.92 + drift * 0.07 + (r - 0.5) * 0.05;
      ctx.fillStyle = `rgb(${232 * v | 0},${237 * v | 0},${244 * v | 0})`;
      ctx.fillRect(x, y, 4, 1);
    }
  }
  grain(ctx, s, 31, 0.03, false);
}, 256, 34);

export const iceTexture = () => texture('ice_albedo', (ctx, s) => {
  ctx.fillStyle = '#b8d4e2';
  ctx.fillRect(0, 0, s, s);
  const rng = makeRng(55);
  // depth marbling
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(120,170,200,${0.08 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(rng() * s, rng() * s, 20 + rng() * 60, 8 + rng() * 24, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // fracture lines
  ctx.strokeStyle = 'rgba(235,248,255,0.6)';
  for (let i = 0; i < 22; i++) {
    ctx.lineWidth = 0.6 + rng() * 1.2;
    ctx.beginPath();
    let x = rng() * s, y = rng() * s;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rng() - 0.5) * 70; y += (rng() - 0.5) * 70; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}, 256, 8);

export const lavaTexture = () => texture('lava_flow', (ctx, s) => {
  // crusted flow: black skin over a bright molten web (rendered emissive)
  ctx.fillStyle = '#1a0d08';
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) {
    for (let x = 0; x < s; x += 2) {
      const n = fbm2(x * 0.04, y * 0.04, 4);
      if (n > 0.62) {
        const heat = (n - 0.62) / 0.38;
        ctx.fillStyle = `rgb(${200 + heat * 55 | 0},${60 + heat * 130 | 0},${10 + heat * 30 | 0})`;
        ctx.fillRect(x, y, 2, 2);
      } else if (n > 0.55) {
        ctx.fillStyle = '#4a1c0a';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
}, 256, 12);
