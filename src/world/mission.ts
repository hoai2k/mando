import type * as THREE from 'three';
import type { VehicleSpec, BoardId } from './board';
import type { Gate, Barrier } from './gate';
import type { Rect } from './stage/common';
import type { Portal } from './stage/barriers';

/**
 * Mission levels, outdoor edition (docs/MISSIONS_OUTDOOR.md).
 *
 * The design this replaces built one walled room chain per territory and it
 * read as a dungeon that could be anywhere. What a run is now: a chain of
 * **zones**, each a *shell* (the geometry) carrying an *encounter* (the
 * rules) — wide outdoor ground held in by cliffs, ravines that pinch it, a
 * roofed hallway beat behind a door in the rock, and back out into something
 * bigger for the bosses. Borders are terrain, and because a **flight ceiling**
 * caps the playable sky they only have to clear that ceiling rather than
 * reach for it.
 *
 * A territory's run is a list of **stages**, each its own map: where two parts
 * of a run want different world rules (space and a hull interior, a deck and
 * the sea, open ground and a plant built inside it) the party crosses a
 * transport door and the next stage is raised in place of the last. That is
 * what keeps map size and resource limits out of the level design.
 *
 * Everything here is geometry + data; `game/campaign.ts` owns the flow. This
 * is the only Missions design: the walled room chain it replaced was retired
 * once this had been the default for a few weeks (it became so on 2026-09-06).
 */

// ---------------------------------------------------------------- types

export type Shell = 'open' | 'canyon' | 'hall' | 'deck' | 'road';
export type Encounter = 'start' | 'trek' | 'camp' | 'assault' | 'chase' | 'lieutenant' | 'warlord';
export type RidgeStyle = 'rock' | 'ice' | 'basalt' | 'ruin' | 'hull' | 'tank' | 'warehouse' | 'panel';
/**
 * What a stage is made of.
 *
 * `built` and `interior` raise plates high over the territory — clean,
 * intentional geometry on any board. The other three stand on ground that
 * already exists, which is what lets a run open on the Dune Sea's own dunes
 * rather than on a copy of them: `territory` lays zones over the wave board's
 * terrain and rims them with cliffs, `plant` lays them over a board that is
 * already a building (the Refinery) and adds nothing but the fights, and
 * `sea` lays them on a seabed under water.
 */
export type StageKind = 'built' | 'interior' | 'territory' | 'plant' | 'sea' | 'section';
/**
 * The gameplay sections (docs/LEVEL_SECTIONS.md, docs/SECTIONS_IMPLEMENTATION.md):
 * whole stages that play as a different game — a lava bike run, a lift under
 * siege, a stealth yard — built and run by their own module in `src/sections/`.
 */
export type SectionId =
  | 'barge-run' | 'worm-sign'
  | 'frigate-guns' | 'ring-walk'
  | 'magma-run' | 'chimney'
  | 'glacier-chute' | 'lamplight'
  | 'squall' | 'run-the-pier'
  | 'the-line' | 'lights-out'
  | 'hold-the-forge' | 'covert-sky'
  | 'tram-top' | 'mark-runs'
  | 'one-way-out' | 'the-lift';
export type ZoneFeature = 'pit' | 'lava' | 'shock' | 'barrels' | 'pillars' | 'crates';

/** an authored sculpt placed in zone-local coordinates */
export interface PropSpec {
  id: string;
  /** along travel from the zone's entry, and across it (+ is left) */
  u: number;
  v: number;
  yaw?: number;
  size?: number;
  /** stand a physics cylinder under it: cover you can hide behind */
  solid?: { r: number; h: number };
}

/** a ride parked in zone-local coordinates */
export interface RideSpec {
  kind: VehicleSpec['kind'];
  u: number;
  v: number;
  yaw?: number;
}

export interface ZoneSpec {
  shell: Shell;
  kind: Encounter;
  /** flavour name, used by banners and the HUD hint */
  label: string;
  /** width across travel and length along it, metres */
  w: number;
  l: number;
  /**
   * How many waves a **supplied** assault runs — a hall, a deck, or a siege
   * (see `siege`). Open ground that is not a siege calls no waves at all, so
   * `waves` is not read there and the layouts warn at load if it is set.
   */
  waves?: number;
  /**
   * Open ground that is not a siege: how deep the posted force stands. The
   * whole fight is standing in the zone when you arrive, and each rank past
   * the first adds two to it. This used to be spelled `waves`, which is why
   * authors kept expecting waves from zones that never call one.
   */
  garrison?: number;
  /**
   * Open ground fought for in waves, supplied from the air.
   *
   * The rule outdoors is the opposite of this and should stay that way: ground
   * is held by whoever is standing on it, posted before the party arrives,
   * nothing flown in. A run that is wave after wave is a wave game wearing a
   * campaign's clothes, and a playtest said as much.
   *
   * But a wave battle is a *different beat*, and a run wants one. Late, on a
   * big piece of open ground, with ships crossing the ceiling and letting
   * squads fall out of them: the fight is sequenced, you can see the next one
   * coming, and the ground you are holding is worth holding because something
   * is being committed to take it from you.
   *
   * So: outdoors only, and rare — two zones in the game carry it, both the
   * large open assault of their territory's last stage. A siege zone posts a
   * holding force rather than its whole fight (the waves are the fight) and
   * runs `waves` of them, which is what every sealed zone does and what no
   * other outdoor zone does.
   */
  siege?: boolean;
  feature?: ZoneFeature;
  /** a bacta niche off one side (halls) or a side crack (canyons) */
  alcove?: boolean;
  /** fliers may be drawn for this zone's waves */
  air?: boolean;
  /**
   * Canyon: the way on is a **door in the far face**, not an open mouth. The
   * rim closes across the front and a blast door is set into it, so the lane
   * reads as a dead end you have to open rather than one you walk out of.
   * (A ravine's *bends* are authored on the links between zones — see
   * `LinkSpec.turn` — because a bend inside one zone would put half of it
   * outside its own rect, and the seal, the vents and the guidance all key
   * off that rect.)
   */
  deadEnd?: boolean;
  /**
   * Outdoors on a stage with its own water: the sides of the zone that are
   * the sea instead of a rim — `left` is +v, `right` is -v. The plate's edge
   * is the border there, lit like a deck's, and the water under it is the
   * catch (the off-path rule already returns whoever goes in). A harbour or a
   * rig walled on four sides never shows its water (audit finding 9).
   */
  water?: ('left' | 'right')[];
  /**
   * Open ground: a runner notch in the far rim with a walled gully behind it,
   * down which a siege's beasts and locals come on foot rather than by ship.
   * Only worth having on a siege — nothing else calls runners.
   */
  pass?: boolean;
  /**
   * Camp: which flank its garrison holds (+1 is left, toward +v). The other
   * flank is the quiet way through. Defaults to alternating by beat.
   */
  postSide?: 1 | -1;
  /** trek: posted sentries who raise the alarm rather than hold ground */
  lookouts?: number;
  /** hall: roof height; default ROOF_H */
  roofH?: number;
  /** road: where along it (fractions of l) the drops come */
  marks?: number[];
  /** road: what holds the far mouth */
  barricade?: 'fence' | 'crates';
  props?: PropSpec[];
  rides?: RideSpec[];
}

export interface LinkSpec {
  /** first leg length along the current heading */
  len: number;
  /** optional 90° bend (+1 left toward +v, -1 right), then a second leg */
  turn?: -1 | 1;
  len2?: number;
  /**
   * Further bends after `len2`, each a 90° turn and a leg. A ravine wants
   * more twists than one bend per link gives it, and a zone cannot bend (its
   * rect is what the seal, the vents and the guidance key off), so the twists
   * live here. Lay them so the chain never folds back on itself: a lane laid
   * across another lane is two walls sharing one floor.
   */
  legs?: { turn: -1 | 1; len: number }[];
  /**
   * A roofed corridor pinch or an open lane between two outdoor zones.
   * Defaults to a corridor when either end is indoors, a trek otherwise.
   */
  kind?: 'corridor' | 'trek';
  /**
   * A breather: nobody posted in it, and a bacta canister halfway. Every link
   * long enough is picketed otherwise, which left no quiet stretch anywhere in
   * a run — two sealed rooms joined by a held corridor are one long fight.
   */
  quiet?: boolean;
}

export interface StageSpec {
  kind: StageKind;
  /**
   * `kind: 'section'` only: which section this stage is. A section stage has
   * no zones and no links — its module builds and runs the whole of it — and
   * its boundaries are one-way (no door back into it, none back out of it).
   */
  section?: SectionId;
  /** the transition card's line: "the ravine", "inside the station" */
  label: string;
  /** what this stage does to the world it is raised in */
  world?: {
    fogColor?: number;
    fogNear?: number;
    fogFar?: number;
    background?: number;
    /** an interior has no sky: the panorama is hidden while the stage stands */
    roofed?: boolean;
    gravity?: number;
    /** a local water plane this far below the floor (harbours, moon pools) */
    waterDrop?: number;
    traction?: number;
    /** hemisphere fill over the stage */
    fill?: number;
  };
  /** overrides the spec's ceiling for this stage */
  ceiling?: number;
  /**
   * Where a ground stage is laid on the board and which way it runs: the
   * first zone's near edge, and the heading the chain walks. Plates pick
   * their own empty patch of sky; ground has to be told which ground.
   */
  anchor?: { x: number; z: number; dx: number; dz: number };
  /**
   * Ring a ground stage with cliffs. On by default for `territory` — the rim
   * is what stops a run wandering off across a whole wave board — and off for
   * `plant` and `sea`, where the building and the water already hold it in.
   */
  rim?: boolean;
  /**
   * Hold the whole chain in **one canyon** instead of a rim per zone.
   *
   * A per-zone rim is a box with sides taller than the box is wide, and a run
   * built out of them reads as a corridor of them — walls at arm's length the
   * whole way, and the territory only visible over the top. A canyon is the
   * other shape the same rule allows: two walls a long way off that run the
   * length of the chain and **close as it goes**, so the opening minutes are
   * open ground with the horizon in them and the last stretch is a place that
   * is closing in on you. `from` and `to` are the half-widths at the chain's
   * start and at its end; the taper is weighted late, so it stays wide and
   * *then* narrows rather than pinching from the first step.
   *
   * `gorge` closes the far end with a cliff and cuts the way on into it: a
   * slot you can see from a long way back, walk up to, and go into. Its
   * transport door stands at the far end of the slot, so the stage is left
   * from inside a ravine rather than through a door in open ground.
   *
   * Straight chains only — the walls are laid along the stage's anchor.
   */
  canyon?: { from: number; to: number; gorge?: { w: number; len: number } };
  zones: ZoneSpec[];
  links: LinkSpec[];
}

export interface MissionSpec {
  palette: { wall: number; floor: number; trim: number; accent: number; rock: number; backdrop: number };
  ridge: RidgeStyle;
  /** metres of playable sky over the floor (docs/MISSIONS_OUTDOOR.md §2) */
  ceiling: number;
  corrW?: number;
  wallH?: number;
  stages: StageSpec[];
}

export interface DefenderPost { pos: THREE.Vector3; toward: THREE.Vector3; }

export interface MissionZone {
  spec: ZoneSpec;
  /** which stage this zone belongs to, and its index in the whole run */
  beat: number;
  entry: THREE.Vector3;
  center: THREE.Vector3;
  exit: THREE.Vector3;
  rect: Rect;
  /** the rect a body has to be in to count as *through the doorway* */
  sealRect: Rect;
  /** past this rect the fight is on (outdoor zones start on a trigger line) */
  triggerRect: Rect;
  entryBarrier: Barrier | null;
  exitBarrier: Barrier | null;
  /** hall waves come out of these: a door in a side wall with a closet behind */
  hatches: { gate: Gate; post: THREE.Vector3 }[];
  vents: THREE.Vector3[];
  farVents: THREE.Vector3[];
  sideVents: THREE.Vector3[];
  posts: THREE.Vector3[];
  /** open zones with a `pass`: where runners enter from, in the gully behind the notch */
  runnerPost: THREE.Vector3 | null;
  /** ...and the ground just inside the notch they run to before they fan out */
  runnerIn: THREE.Vector3 | null;
  /** road zones: the drop marks along it, in order */
  marks: THREE.Vector3[];
  /** the pillars that frame the way on — what the guidance points at */
  landmark: THREE.Vector3;
  /**
   * Where this zone's entry sits in `MissionStage.path`. Anything walking the
   * run rather than playing it — the walkthrough audit, a future escort — can
   * follow the path point by point and still know where it is in the chain.
   */
  pathFrom: number;
}

export interface MissionStage {
  spec: StageSpec;
  index: number;
  zones: MissionZone[];
  /** corridor defender posts; defenders[i] guard the link out of zones[i] */
  defenders: DefenderPost[][];
  pickups: THREE.Vector3[];
  starts: THREE.Vector3[];
  /** parked rides, in world space */
  rides: VehicleSpec[];
  /** the golden path: entry, bends and exit of every zone, in order */
  path: THREE.Vector3[];
  /** the transport door on to the next stage, where there is one */
  exitPortal: Portal | null;
  /** the transport door back to the last stage, where there is one */
  backPortal: Portal | null;
  /** the stage's representative floor height — the ceiling is measured off it */
  floorY: number;
  ceilingY: number;
  /**
   * The walkable surface under a column.
   *
   * A plate stage answers `floorY` everywhere; a ground stage answers the
   * board's own terrain, which is the whole point of it. Everything that used
   * to compare against a single floor — where a body stands, who counts as
   * inside a zone, who has fallen off the level — asks this instead, because
   * on real ground "the floor" is not one number.
   */
  groundAt(x: number, z: number): number;
  /** a local water plane, where the stage has one */
  waterY?: number;
  /** is this x,z over the stage's walkable footprint? */
  contains(x: number, z: number): boolean;
  /** give the board back everything this stage put in it */
  dispose(): void;
  /** hazards that cycle (the shock strips), ticked by the campaign */
  tick(time: number): void;
}

// ---------------------------------------------------------------- the builder
//
// The builder lives in `world/stage/`: `build.ts` runs the phases, and
// `builder.ts` is the state they share. What the rest of the game imports
// from here is re-exported, so nothing outside needs to know the folder is
// there.

export { buildStage } from './stage/build';
export { Fence, Portal } from './stage/barriers';
export { MISSION_Y, RIM_OVER_CEILING, PORTAL_POCKET } from './stage/common';
export { MISSION_LAYOUTS } from './mission-layouts';
export type { BoardId };
