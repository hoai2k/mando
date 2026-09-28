import * as THREE from 'three';
import type { RidgeStyle } from '../mission';

/**
 * What every phase of the stage builder shares that is not state: the
 * numbers the level is laid out in, the ridge styles, the seeded dice and the
 * zone frame. Moved here from `world/mission.ts` with `buildStage` itself, so
 * the phases in this folder can import them without importing the module that
 * imports them.
 */

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

// ---------------------------------------------------------------- constants

/** the level floor's altitude over the territory */
export const MISSION_Y = 90;
/** how far a rim's first row must clear the ceiling */
export const RIM_OVER_CEILING = 6;
/** the backdrop row's height, as a multiple of the ceiling */
export const BACKDROP_H = 2.2;
/**
 * The widest gap a deck's plates are laid with (`ZoneSpec.plates`): a jetpack
 * hop at the Spice Run's 0.45 g, not a leap of faith.
 */
export const DECK_GAP_MAX = 18;
/** how far past an outdoor zone's entry the fight starts */
export const TRIGGER_IN = 6;
/** trail posts along any link at least this long, every this many metres */
export const TRAIL_MIN_LEN = 30;
export const TRAIL_EVERY = 15;
/**
 * A link long enough to be worth holding, and how often somebody stands in it.
 *
 * A corridor used to be garrisoned only where the builder happened to put
 * crates — and crates only go into *roofed* lanes, so every outdoor canyon
 * link in the game was a walk with nobody in it. What a playtest reported was
 * exactly that: a long stretch of nothing and then a wave at the end. A lane
 * is ground somebody holds, and a picket every dozen metres is what makes it
 * read that way.
 */
export const PICKET_MIN_LEN = 12;
export const PICKET_EVERY = 13;
/** the shortest side a non-road zone needs before it may park a ride */
export const RIDE_MIN_SIDE = 40;
/** how far from an open edge a ride is parked */
export const RIDE_EDGE_CLEAR = 6;
/**
 * How much room a parked ride needs around it, measured from its keel: enough
 * that the longest hull (a skiff, ~5 m nose to tail) is clear of a prop's own
 * blocked circle rather than settling onto its roof.
 */
export const RIDE_CLEAR = 3;
/**
 * How far past its nominal radius a rim piece's drawn rock actually reaches,
 * once `rimPiece` has noised its vertices outward. The noise is a fraction of
 * `r` scaled by height, so the overhang grows with the boulder rather than
 * being a fixed margin — 1.6 covers the worst of it on every ridge style.
 */
export const RIM_NOISE_REACH = 1.6;
/**
 * How much of a border piece has to be *standing* on the level's own floor —
 * over it, with no collider under it — before the piece is dropped as being in
 * the way rather than leaning over the edge like a cliff.
 */
/**
 * How many square metres of a border piece have to be over the level's own
 * floor with nothing under them before the piece is given a collider of its
 * own. Low on purpose: backing rock is cheap and cannot make the level worse,
 * where leaving it unbacked is a wall you walk through. One square metre, which is to say
 * any at all: two boards kept a wall apiece at eight and again at two —
 * pieces leaning just far enough over a lane to be walked into, and not far
 * enough to be counted.
 */
export const RIM_BARE_MIN = 1;
/**
 * How much of a rim piece's radius its own collider fills. The drawn rock is
 * a cylinder that tapers going *up*, and its noise only ever bites inward by
 * a few per cent of the radius near the base, so at body height the rock is
 * very nearly the full radius it was placed for. This used to be 0.72, from when the
 * noise swelled pieces outward: on a six-metre boulder that left a metre and
 * a half of drawn rock all round with nothing in it, which the floor audit
 * reported as walk-through points along every backed piece.
 */
export const RIM_SOLID_FRACTION = 0.97;
/**
 * How long each step of a leaning border's staircase is. Half of it is how far
 * that step's axis-aligned box reaches past the rock line into the lane, so
 * this is the standoff between a diagonal cliff and the wall that stops you.
 */
export const STAIR_STEP = 1.6;
/**
 * Room a body needs beside the golden path. Rock closer than its own radius
 * plus this is standing on the way through, and is removed rather than given
 * a collider — the one case where the answer is to take the wall away.
 */
export const PATH_CLEAR = 1.2;
/** how far a canyon's closing walls run past its side walls, so the corners are rock */
export const CORNER_LAP = 8;
/** how wide a strip either side of the golden path counts as walkable ground */
export const PATH_WALKABLE = 2.5;
/**
 * A runner pass (`ZoneSpec.pass`): a notch this wide in the far rim, and a
 * gully this deep behind it, walled on three sides, that the beasts and
 * locals of a siege come down on foot.
 */
export const PASS_W = 6;
export const PASS_DEPTH = 12;
/** per crate in a crate-line barricade */
export const BARRICADE_HP = 40;
/** depth of the confirm pocket behind a transport door's leaves */
export const PORTAL_POCKET = 4;
/**
 * How long the antechamber between a stage's back door and its first zone is.
 *
 * A stage used to re-form the party 2.4 m inside zone 0, so where zone 0 was
 * a sealed room or a boss arena the fight started on the first frame, with
 * the posted garrison standing round them as the loading veil lifted and the
 * door they came in by a step behind. Every stage with a door behind it now
 * opens in this vestibule instead: the party arrives *outside* the first
 * zone and walks into it (docs/AUDIT_LEVELS_2026-09.md, item 1).
 */
export const VESTIBULE = 8;

export const WALL_T = 1;
/**
 * The tallest a doorway, a hatch or a transport door stands. A hall roofed
 * higher than this (the Refinery's reactor atrium) keeps its doors this tall
 * and fills the wall over them, rather than cutting a slot to the roof.
 */
export const DOOR_MAX_H = 8;
export const CORR_H = 3.8;
export const WALL_H = 5.5;
export const ROOF_H = 8;
/** adjacent floor plates get staggered lifts so coplanar tops never shimmer */
export const EPS = 0.013;

/** the shock strips cycle: dark, a charging flicker, then live */
export const SHOCK_CYCLE = 9;
export const SHOCK_CHARGE_AT = 5.2;
export const SHOCK_LIVE_AT = 6.4;
export const SHOCK_DPS = 22;
/**
 * What a zone's pit costs a second. High enough that standing in one is a
 * mistake you feel at once and a couple of seconds is fatal, low enough that
 * walking across a corner of it is a wound rather than the end of the run.
 */
export const PIT_DPS = 60;

/** crate proportions, matched to corridor_crate.glb */
export const CRATE_H_MIN = 1.15;
export const CRATE_H_VAR = 0.35;
export const CRATE_W_PER_H = 1.18;
export const CRATE_D_PER_H = 1.42;

/**
 * What each ridge style is made of.
 *
 * `tex` is the cliff-face tileable (delivered 2026-09-03 for this design —
 * the existing surface set was all top-down ground, and a 36 m wall seen
 * side-on wants a face); `glow` is its emissive map where the style has lit
 * windows or docking lights; `sil` is the alpha horizon strip drawn behind
 * the backdrop row. `noise` and `facets` shape the silhouette — rock is
 * lumpy and many-sided, a hull plate is flat and square.
 */
export const RIDGE_LOOK: Record<RidgeStyle, {
  tex: string; noise: number; facets: number; taper: number; glow?: string; sil?: string;
}> = {
  rock:      { tex: 'cliff_sandstone', noise: 0.16, facets: 9, taper: 0.72, sil: 'ridge_silhouette_desert' },
  ice:       { tex: 'cliff_ice', noise: 0.13, facets: 7, taper: 0.6, sil: 'ridge_silhouette_ice' },
  basalt:    { tex: 'cliff_basalt', noise: 0.09, facets: 6, taper: 0.86, sil: 'ridge_silhouette_basalt' },
  ruin:      { tex: 'cliff_ruin', noise: 0.2, facets: 8, taper: 0.8, sil: 'ridge_silhouette_ruin' },
  hull:      { tex: 'hull_plate_large', noise: 0.02, facets: 4, taper: 0.99, glow: 'hull_plate_large_glow' },
  tank:      { tex: 'tank_wall', noise: 0.01, facets: 16, taper: 0.94 },
  warehouse: { tex: 'warehouse_wall', noise: 0.03, facets: 4, taper: 0.98 },
  panel:     { tex: 'city_facade', noise: 0.02, facets: 4, taper: 0.99, glow: 'city_facade_glow' },
};

/** deterministic rng so a territory's level is the same one every run */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** the walkable frame of one space: entry point + travel direction on the floor plan */
export class Frame {
  px: number; pz: number;
  constructor(public ex: number, public ez: number, public dx: number, public dz: number) {
    // "left" across the travel axis: +v
    this.px = -dz;
    this.pz = dx;
  }
  x(u: number, v: number): number { return this.ex + this.dx * u + this.px * v; }
  z(u: number, v: number): number { return this.ez + this.dz * u + this.pz * v; }
  vec(u: number, v: number, y: number): THREE.Vector3 {
    return new THREE.Vector3(this.x(u, v), y, this.z(u, v));
  }
  rect(u0: number, u1: number, v0: number, v1: number): Rect {
    const xs = [this.x(u0, v0), this.x(u1, v0), this.x(u0, v1), this.x(u1, v1)];
    const zs = [this.z(u0, v0), this.z(u1, v0), this.z(u0, v1), this.z(u1, v1)];
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    };
  }
}

/** the outdoor ground a ridge style stands on */
export function stageFloorTexture(style: RidgeStyle): string {
  switch (style) {
    case 'basalt': return 'ash_ground';
    case 'ruin': return 'glass_plain';
    case 'panel': return 'street_paving';
    case 'warehouse': return 'dock_planks';
    case 'ice': return 'snow_albedo';
    case 'hull': return 'metal_deck';
    case 'tank': return 'scree_ground';
    default: return 'sand_albedo';
  }
}
