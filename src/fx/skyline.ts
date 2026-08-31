import * as THREE from 'three';
import { markShared } from '../core/dispose';
import type { Board } from '../world/board';

/**
 * Skyline halos: the contrast that makes an airborne enemy readable.
 *
 * A flier is nearly always seen against the sky, and that is the one backdrop
 * a board cannot vary. The problem is never the flier on its own — it is a
 * flier the same tone as the sky behind it: a dark trooper over the Spice
 * Run's black space, or a white-armoured one against the Dune Sea's bright
 * noon. Either disappears; the same trooper over the other board is perfectly
 * legible and wants nothing done to it.
 *
 * So a halo is a *contrast deficit* remedy, not a marker. It appears only when
 * body and sky are close in tone, and it leans the way the sky is not:
 *
 *   - dark body, dark sky   → a faint light halo, added to the sky
 *   - light body, light sky → a faint dark halo, laid over it
 *   - anything against its opposite → nothing at all
 *
 * It is deliberately small — a rim just wider than the body. The disc is
 * centred on the body and drawn in the transparent pass, so the body, already
 * in the depth buffer from the opaque pass, punches its own silhouette out of
 * the middle: what is left is an outline rather than a blob. And it fades in
 * with height above whatever is directly below, so it appears exactly when a
 * body is skylined and never haloes a trooper standing on a deck.
 */

export interface HaloTone {
  color: number;
  /** added to the sky (a glow) rather than painted over it (a shadow) */
  additive: boolean;
  /** how light the sky itself is, 0..1 — the body is judged against this */
  skyLuma: number;
}

/** below this much sky luminance the halo lights up rather than darkens */
const DARK_SKY = 0.45;
/** no halo below this height over the surface underneath; full by the second */
const HALO_MIN_ALT = 4;
const HALO_FULL_ALT = 12;
/**
 * How far a body has to be into its sky's own half of the tonal scale before
 * it needs the full halo — a body at the pivot needs none, one this much past
 * it needs all of it.
 */
const TONE_RAMP = 0.3;
/** a hint of an outline at full strength, not a lamp */
const GLOW_OPACITY = 0.34;
const SHADOW_OPACITY = 0.3;
/** the disc's width as a multiple of body height: a rim, barely wider than it */
const HALO_SPAN = 1.9;

let disc: THREE.Texture | null = null;

/**
 * The soft disc every halo is drawn with: solid at the centre, gone by the
 * rim, so nothing about it has a visible edge. Shared across every enemy on
 * the board and marked as such, since a match teardown frees what it owns and
 * this outlives any one match.
 */
function haloDisc(): THREE.Texture {
  if (disc) return disc;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2 - 1);
  // weighted toward the middle, so what survives the body punching its
  // silhouette out is a tight rim rather than a wide glow
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  disc = markShared(new THREE.CanvasTexture(c));
  disc.colorSpace = THREE.NoColorSpace;
  return disc;
}

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** mean albedo of a texture, measured once and remembered by its uuid */
const texLuma = new Map<string, number>();

/**
 * How light a texture's artwork is, on average.
 *
 * An authored character carries its colour in its map and leaves the
 * material's own `color` white, so reading the material alone calls every
 * sculpted trooper light. The map is scaled into a few pixels and averaged
 * instead — once per texture for the life of the tab, since the answer cannot
 * change.
 */
function textureLuma(tex: THREE.Texture): number | null {
  const hit = texLuma.get(tex.uuid);
  if (hit !== undefined) return hit;
  const img = tex.image as CanvasImageSource | undefined;
  if (!img) return null;
  try {
    const n = 8;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, n, n);
    const { data } = ctx.getImageData(0, 0, n, n);
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      if (a < 0.1) continue;                       // cut-out pixels are not the body
      sum += luminance(data[i], data[i + 1], data[i + 2]) / 255 * a;
      weight += a;
    }
    const luma = weight > 0 ? sum / weight : 0.5;
    texLuma.set(tex.uuid, luma);
    return luma;
  } catch {
    return null;                                   // tainted or undecoded: fall back
  }
}

/**
 * How light this body reads, 0..1 — its own artwork, not its lighting.
 *
 * Returns null while there is nothing to measure, so a caller can wait rather
 * than commit: an authored model swaps in a second or two after the procedural
 * build, and it is the one that will actually be looked at.
 */
export function bodyLuma(root: THREE.Object3D): number | null {
  let sum = 0;
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std?.color) continue;
      const tint = luminance(std.color.r, std.color.g, std.color.b);
      const mapped = std.map ? textureLuma(std.map) : null;
      sum += mapped === null ? tint : mapped * tint;
      n++;
    }
  });
  return n > 0 ? sum / n : null;
}

/**
 * What tone this board's sky wants behind a flier.
 *
 * The board's own background colour is the honest measure even where an
 * authored panorama is loaded over it: the two are picked to match, and the
 * fallback colour is the one thing every board has. Its fog is the second
 * choice — on an enclosed board that is what fills the distance.
 */
export function skylineTone(board: Board): HaloTone {
  const sky = board.background instanceof THREE.Color
    ? board.background
    : board.fog?.color ?? new THREE.Color(0x808080);
  const skyLuma = luminance(sky.r, sky.g, sky.b);
  return skyLuma < DARK_SKY
    // a touch of blue in the glow keeps it from reading as a white sticker
    ? { color: 0xdfeaff, additive: true, skyLuma }
    : { color: 0x131820, additive: false, skyLuma };
}

/** A halo sized for a body of `height`, ready to hang under its root. */
export function makeHalo(tone: HaloTone, height: number): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloDisc(),
    color: tone.color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: tone.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    // A halo is a reading aid, not a light: it must not pick up the board's
    // own lighting or it would go dark on the very night sky it exists for.
    fog: false,
  }));
  const span = height * HALO_SPAN;
  sprite.scale.set(span, span, 1);
  sprite.position.y = height * 0.55;
  return sprite;
}

/**
 * How strongly a body this far above the surface beneath it should be haloed:
 * nothing on the deck, everything against open sky.
 */
export function haloStrength(altitude: number): number {
  if (!isFinite(altitude)) return 1;      // nothing underneath at all: open sky
  if (altitude <= HALO_MIN_ALT) return 0;
  return Math.min(1, (altitude - HALO_MIN_ALT) / (HALO_FULL_ALT - HALO_MIN_ALT));
}

/**
 * How much this body needs a halo against this sky.
 *
 * Not the gap between the two tones — that was the first shape this took, and
 * it reads the world wrong. The sky's own luminance is only an estimate (a
 * board's background colour is a base tint; the rendered sky carries sun and
 * haze on top of it), so a metric that subtracts one from the other inherits
 * every bit of that error: on the Dune Sea it scored a white trooper against a
 * bright noon as *already legible* and gave it almost nothing.
 *
 * What matters is simpler and needs only the half of the scale the sky is on,
 * which the estimate is reliable enough to name: a dark body is lost on a dark
 * sky, a light body on a light one, and either against its opposite looks
 * after itself. So the need is how far the body sits into its sky's own half.
 * An unmeasurable body is treated as needing one — better a faint rim nobody
 * asked for than a flier nobody can see.
 */
export function contrastNeed(tone: HaloTone, body: number | null): number {
  if (body === null) return 1;
  const into = tone.additive ? DARK_SKY - body : body - DARK_SKY;
  return Math.max(0, Math.min(1, into / TONE_RAMP));
}

/** the opacity a halo of this tone runs at, at full strength */
export function haloPeak(tone: HaloTone): number {
  return tone.additive ? GLOW_OPACITY : SHADOW_OPACITY;
}
