import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Board, Hazard, VehicleSpec, BoardId } from './board';
import type { StaticBox, StaticCylinder } from '../core/physics';
import { addBreakable, hazardAt } from './board';
import { mat } from '../characters/builder';
import { authoredProp } from './props';
import { loadOptionalTexture } from '../core/assets';
import { Gate, GATE_W, type Barrier } from './gate';
import { disposeSubtree } from '../core/dispose';

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
 * design is **experimental** and sits behind `?missions=new`; the walled room
 * chain in `world/mission-legacy.ts` is what Missions runs by default.
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
export type StageKind = 'built' | 'interior' | 'territory' | 'plant' | 'sea';
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
  /** assault rooms: how many sealed waves the zone runs */
  waves?: number;
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
  /** open: a runner notch in the far rim, and a post outside it */
  pass?: boolean;
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
   * A roofed corridor pinch or an open lane between two outdoor zones.
   * Defaults to a corridor when either end is indoors, a trek otherwise.
   */
  kind?: 'corridor' | 'trek';
}

export interface StageSpec {
  kind: StageKind;
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

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number; }

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
  /** open zones with a `pass`: where runners enter from */
  runnerPost: THREE.Vector3 | null;
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

// ---------------------------------------------------------------- constants

/** the level floor's altitude over the territory */
export const MISSION_Y = 90;
/** how far a rim's first row must clear the ceiling */
export const RIM_OVER_CEILING = 6;
/** the backdrop row's height, as a multiple of the ceiling */
const BACKDROP_H = 2.2;
/** how far past an outdoor zone's entry the fight starts */
const TRIGGER_IN = 6;
/** trail posts along any link at least this long, every this many metres */
const TRAIL_MIN_LEN = 30;
const TRAIL_EVERY = 15;
/** the shortest side a non-road zone needs before it may park a ride */
const RIDE_MIN_SIDE = 40;
/** how far from an open edge a ride is parked */
const RIDE_EDGE_CLEAR = 6;
/** per crate in a crate-line barricade */
const BARRICADE_HP = 40;
/** depth of the confirm pocket behind a transport door's leaves */
export const PORTAL_POCKET = 4;

const WALL_T = 1;
const CORR_H = 3.8;
const WALL_H = 5.5;
const ROOF_H = 8;
/** adjacent floor plates get staggered lifts so coplanar tops never shimmer */
const EPS = 0.013;

/** the shock strips cycle: dark, a charging flicker, then live */
const SHOCK_CYCLE = 9;
const SHOCK_CHARGE_AT = 5.2;
const SHOCK_LIVE_AT = 6.4;
const SHOCK_DPS = 22;

/** crate proportions, matched to corridor_crate.glb */
const CRATE_H_MIN = 1.15;
const CRATE_H_VAR = 0.35;
const CRATE_W_PER_H = 1.18;
const CRATE_D_PER_H = 1.42;

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
const RIDGE_LOOK: Record<RidgeStyle, {
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
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** the walkable frame of one space: entry point + travel direction on the floor plan */
class Frame {
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

// ---------------------------------------------------------------- barriers

/**
 * An energy fence across an outdoor mouth: two pylons and a pane between them.
 *
 * Outdoors a slab of metal across a canyon reads as a mistake, but the fight
 * still has to be held in — so a mouth that seals gets this instead. It spans
 * the whole gap up to the ceiling, because a pane you can hop is not a seal.
 */
export class Fence implements Barrier {
  pos: THREE.Vector3;
  private box: StaticBox | null = null;
  private pane: THREE.Mesh;
  private caps: THREE.Mesh[] = [];
  private t = 1;
  private want = 1;
  private half: THREE.Vector3;
  private cylinders: StaticCylinder[] = [];

  constructor(private board: Board, parent: THREE.Object3D, pos: THREE.Vector3,
    dir: { x: number; z: number }, width: number, height: number, accent: number) {
    this.pos = pos.clone();
    const across = width / 2;
    this.half = new THREE.Vector3(
      dir.x !== 0 ? 0.5 : across + 0.5, height / 2, dir.x !== 0 ? across + 0.5 : 0.5);

    const hub = new THREE.Group();
    hub.position.copy(pos);
    hub.rotation.y = Math.atan2(dir.x, dir.z);
    parent.add(hub);
    const steel = mat(0x4a5058, { rough: 0.6, metal: 0.7 });
    const glow = new THREE.MeshBasicMaterial({ color: accent });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 4.5, 10), steel);
      post.position.set(side * across, 2.25, 0);
      post.castShadow = true;
      hub.add(post);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), glow.clone());
      cap.position.set(side * across, 4.6, 0);
      hub.add(cap);
      this.caps.push(cap);
      this.cylinders.push(board.physics.addCylinder(
        pos.x + (dir.x !== 0 ? 0 : side * across), pos.y + 2.25,
        pos.z + (dir.x !== 0 ? side * across : 0), 0.5, 4.5));
      // the emitter's own sculpt, when the file lands
      authoredProp(hub, post, 'energy_pylon', 4.5, { x: side * across, y: 0, z: 0, axis: 'y' });
    }
    const paneMat = new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    // the cell grid, so the pane reads as a field rather than a coloured sheet
    loadOptionalTexture('energy_cells', (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(2, Math.round(width / 2)), Math.max(2, Math.round(height / 2)));
      paneMat.map = tex;
      paneMat.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
    this.pane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), paneMat);
    this.pane.position.set(0, height / 2, 0);
    hub.add(this.pane);
    this.closeNow();
  }

  get closed(): boolean { return this.box !== null; }
  get open_(): boolean { return this.t >= 1 && this.want >= 1; }

  private closeNow(): void {
    this.t = 0;
    this.want = 0;
    this.block(true);
    this.paint();
  }

  close(): void { this.want = 0; this.block(true); }
  open(): void { this.want = 1; }

  retire(): void {
    this.block(false);
    const cyl = this.board.physics.cylinders;
    for (const c of this.cylinders) {
      const i = cyl.indexOf(c);
      if (i >= 0) cyl.splice(i, 1);
    }
    this.cylinders.length = 0;
  }

  update(dt: number): void {
    if (this.t === this.want) return;
    const step = dt / 0.5;
    this.t = this.want > this.t ? Math.min(1, this.t + step) : Math.max(0, this.t - step);
    this.block(this.t < 0.8);
    this.paint();
  }

  private paint(): void {
    const m = this.pane.material as THREE.MeshBasicMaterial;
    m.opacity = (1 - this.t) * 0.34;
    this.pane.visible = this.t < 0.99;
    // the caps say what the pane is about to do before it does it
    for (const c of this.caps) (c.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  private block(on: boolean): void {
    if (on === (this.box !== null)) return;
    if (on) {
      this.box = this.board.physics.addBox(
        this.pos.x, this.pos.y + this.half.y, this.pos.z,
        this.half.x * 2, this.half.y * 2, this.half.z * 2);
    } else {
      const boxes = this.board.physics.boxes;
      const i = boxes.indexOf(this.box!);
      if (i >= 0) boxes.splice(i, 1);
      this.box = null;
    }
  }

}

/**
 * A transport door: the boundary between two stages (docs/MISSIONS_OUTDOOR.md
 * §1.9). Wider than a blast door, lit white-blue rather than in the palette's
 * accent, and with a **pocket** behind the leaves whose far end is the
 * threshold — so it is stepped through deliberately and never brushed by.
 */
export class Portal extends Gate {
  /** the far end of the pocket: crossing this is boarding */
  readonly threshold: THREE.Vector3;
  /** the pocket a player stands in to wait for the others, on the way back */
  readonly pocket: THREE.Vector3;
  readonly forward: { x: number; z: number };

  constructor(board: Board, parent: THREE.Object3D, pos: THREE.Vector3,
    dir: { x: number; z: number }, wallH: number, depth: number) {
    super(board, parent, pos, dir, wallH, 0xbfe6ff, { width: GATE_W + 1.6 });
    this.forward = { x: dir.x, z: dir.z };
    this.threshold = new THREE.Vector3(pos.x + dir.x * depth, pos.y, pos.z + dir.z * depth);
    this.pocket = new THREE.Vector3(pos.x + dir.x * (depth * 0.5), pos.y, pos.z + dir.z * (depth * 0.5));
    // a lamp over it, so the way on is the brightest thing ahead
    const lamp = new THREE.PointLight(0xbfe6ff, 26, 22, 1.5);
    lamp.position.set(pos.x, pos.y + wallH - 0.4, pos.z);
    parent.add(lamp);
  }

  /** how far along the doorway's own axis this position stands */
  depthOf(p: THREE.Vector3): number {
    return (p.x - this.pos.x) * this.forward.x + (p.z - this.pos.z) * this.forward.z;
  }
}

// ---------------------------------------------------------------- the builder

/**
 * Raise one stage of a territory's run over the board.
 *
 * Everything the stage puts into the world — meshes, colliders, hazards,
 * board hooks — is recorded, so `dispose()` can take it all back out again
 * when the party crosses a transport door into the next one.
 */
export function buildStage(board: Board, spec: MissionSpec, index: number, beat0 = 0): MissionStage {
  const stage = spec.stages[index];
  const pal = spec.palette;
  const corrW = spec.corrW ?? 6;
  const baseWallH = spec.wallH ?? WALL_H;
  const ceiling = stage.ceiling ?? spec.ceiling;
  const interior = stage.kind === 'interior';
  /** this stage stands on ground the board already has, not on plates */
  const onGround = stage.kind === 'territory' || stage.kind === 'plant' || stage.kind === 'sea';
  /** a `plant` adds fights to a building that is already built; it lays no geometry */
  const bare = stage.kind === 'plant' || stage.kind === 'sea';
  const wantRim = stage.rim ?? (stage.kind === 'territory');
  /**
   * One canyon down the whole chain, in place of a rim per zone. Only ground
   * stages that build their own geometry can have one: a `plant` and a `sea`
   * are held in by the building and the water they stand in.
   */
  const canyon = bare ? undefined : stage.canyon;
  const terrainAt = (x: number, z: number): number =>
    board.physics.heightAt ? board.physics.heightAt(x, z) : 0;
  const rand = rng(index * 104729 + stage.zones.length * 7919 + pal.wall);

  // ---- materials (own copies: mat() caches by colour and shares game-wide) ----
  const wallMat = mat(pal.wall, { rough: 0.75, metal: 0.25 }).clone();
  const floorMat = mat(pal.floor, { rough: 0.85, metal: 0.15 }).clone();
  const rockMat = mat(pal.rock, { rough: 0.92, metal: 0.05 }).clone();
  const backdropMat = mat(pal.backdrop, { rough: 1, metal: 0 }).clone();
  const crateMat = mat(0x4a4436, { rough: 0.8, metal: 0.2 }).clone();
  const trimMat = mat(pal.trim, { rough: 0.5, metal: 0.4, emissive: pal.trim }).clone();
  const accentGlow = new THREE.MeshBasicMaterial({ color: pal.accent });
  const owned: { dispose(): void }[] = [wallMat, floorMat, rockMat, backdropMat, crateMat, trimMat, accentGlow];
  /**
   * Dress a material with its tileable, and with the normal and emissive maps
   * that came with it where they exist.
   *
   * The cliff set ships `<name>_normal.png` alongside each face, and that is
   * most of what sells a cliff at 30 m: the albedo carries the strata, the
   * normal carries the fact that they stick out. Both are optional — a
   * missing file leaves the palette colour standing, as everywhere else in
   * this game.
   */
  const tile = (m: THREE.MeshStandardMaterial, name: string, rx: number, ry: number,
    opts: { normal?: boolean; glow?: string } = {}): void => {
    loadOptionalTexture(name, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      m.map = tex;
      // the tileables are dark; with the surface detail carried by the map the
      // tint's job is hue, not value
      m.color.lerp(new THREE.Color(0xffffff), 0.7);
      m.needsUpdate = true;
    }, { exts: ['jpg', 'png'] });
    if (opts.normal) {
      loadOptionalTexture(`${name}_normal`, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rx, ry);
        m.normalMap = tex;
        m.needsUpdate = true;
      }, { exts: ['png', 'jpg'] });
    }
    if (opts.glow) {
      loadOptionalTexture(opts.glow, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(rx, ry);
        m.emissiveMap = tex;
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveIntensity = 0.85;
        m.needsUpdate = true;
      }, { exts: ['jpg', 'png'] });
    }
  };
  const look = RIDGE_LOOK[spec.ridge];
  tile(wallMat, 'corridor_wall', 6, 2);
  tile(floorMat, interior ? 'corridor_floor' : stageFloorTexture(spec.ridge), 8, 8);
  tile(crateMat, 'corridor_wall', 1, 1);
  tile(rockMat, look.tex, 2, 1, { normal: true, glow: look.glow });
  tile(backdropMat, look.tex, 3, 1);

  const group = new THREE.Group();
  group.name = `mission-stage-${index}`;
  board.group.add(group);

  // ---- what this stage added, for the swap ----
  const boxes: StaticBox[] = [];
  const cylinders: StaticCylinder[] = [];
  const hazards: Hazard[] = [];
  const breakables: { mesh: THREE.Object3D }[] = [];
  const rects: Rect[] = [];
  const pickups: THREE.Vector3[] = [];
  const defenders: DefenderPost[][] = [];
  const rides: VehicleSpec[] = [];
  const path: THREE.Vector3[] = [];
  const blocked: { x: number; z: number; r: number }[] = [];
  const shockStrips: { hazards: Hazard[]; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  /** rim faces, merged per stage into one draw call each */
  const rimGeo: THREE.BufferGeometry[] = [];
  const backGeo: THREE.BufferGeometry[] = [];
  let spaceN = 0;

  /**
   * Whether this stage has been torn down. A sculpt lands frames — sometimes
   * seconds — after it is asked for, and a stage swap can happen in between:
   * the fit that arrives late has to be dropped rather than installed into a
   * world the stage no longer owns.
   */
  let retired = false;
  const removeBoxes = (bs: StaticBox[]): void => {
    const gone = new Set<StaticBox>(bs);
    board.physics.boxes = board.physics.boxes.filter((b) => !gone.has(b));
  };
  const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): StaticBox => {
    const b = board.physics.addBox(cx, cy, cz, sx, sy, sz);
    boxes.push(b);
    return b;
  };
  const addCyl = (cx: number, cy: number, cz: number, r: number, h: number): StaticCylinder => {
    const c = board.physics.addCylinder(cx, cy, cz, r, h);
    cylinders.push(c);
    return c;
  };
  const addHazard = (h: Hazard): Hazard => {
    (board.hazards ??= []).push(h);
    hazards.push(h);
    return h;
  };

  // A plate stage floats at a fixed altitude; a ground stage takes the height
  // of the ground it was anchored to. The ceiling is measured off the *highest*
  // ground the chain crosses, so a lid never comes down on someone standing on
  // a rise — the ceiling is meant to be unfelt, and a dune is no exception.
  const raw = stage.anchor ?? { x: 0, z: 0, dx: 1, dz: 0 };
  // The turtle steps by `dx`/`dz` directly, so a heading that is not unit
  // length silently scales every zone and every link along with it — a
  // diagonal written as (1, -1) walks the whole chain √2 too far.
  const aLen = Math.hypot(raw.dx, raw.dz) || 1;
  const anchor = { x: raw.x, z: raw.z, dx: raw.dx / aLen, dz: raw.dz / aLen };
  const floorY = onGround ? terrainAt(anchor.x, anchor.z) : MISSION_Y;
  const groundAt = (x: number, z: number): number => (onGround ? terrainAt(x, z) : floorY);
  let highest = floorY;
  if (onGround) {
    // Sample the ground the chain actually crosses — its zones and the links
    // between them, plus a little margin. Overshooting is not harmless: on a
    // bowl-shaped board the terrain climbs steeply once you are past the
    // playable area, so sampling fifty metres beyond the last zone measured
    // the rim the party never reaches and lifted the ceiling twenty metres
    // over where it was authored.
    let reach = 12;
    for (const zs of stage.zones) reach += zs.l;
    for (const link of stage.links) reach += link.len + (link.len2 ?? 0);
    for (let t = 0; t <= reach; t += 8) {
      for (let side = -40; side <= 40; side += 20) {
        const x = anchor.x + anchor.dx * t - anchor.dz * side;
        const z = anchor.z + anchor.dz * t + anchor.dx * side;
        highest = Math.max(highest, terrainAt(x, z));
      }
    }
  }
  const ceilingY = (onGround ? highest : floorY) + ceiling;

  // ---- lighting ----
  // Outdoors the territory's own sun does most of the work and the fill only
  // has to keep a cliff face in shadow off black; an interior has no sky at
  // all and carries the whole of its own light.
  const hemi = new THREE.HemisphereLight(pal.accent, pal.floor,
    stage.world?.fill ?? (interior ? 1.5 : 0.8));
  hemi.position.set(0, floorY + 40, 0);
  group.add(hemi);

  // ---------------------------------------------------------------- helpers

  /** a floor/ceiling/wall box: mesh + collider in one */
  const solid = (f: Frame, u0: number, u1: number, v0: number, v1: number,
    y0: number, y1: number, m: THREE.Material): THREE.Mesh => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const along = Math.abs(u1 - u0), across = Math.abs(v1 - v0);
    const cx = f.x(cu, cv), cz = f.z(cu, cv), cy = (y0 + y1) / 2;
    const sx = f.dx !== 0 ? along : across;
    const sz = f.dx !== 0 ? across : along;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), m);
    mesh.position.set(cx, cy, cz);
    mesh.receiveShadow = true;
    group.add(mesh);
    addBox(cx, cy, cz, sx, y1 - y0, sz);
    return mesh;
  };

  /** mesh-only slab (trim, glow strips) — no collider */
  const slab = (f: Frame, u0: number, u1: number, v0: number, v1: number,
    y0: number, y1: number, m: THREE.Material): THREE.Mesh => {
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const along = Math.abs(u1 - u0), across = Math.abs(v1 - v0);
    const sx = f.dx !== 0 ? along : across;
    const sz = f.dx !== 0 ? across : along;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), m);
    mesh.position.set(f.x(cu, cv), (y0 + y1) / 2, f.z(cu, cv));
    group.add(mesh);
    return mesh;
  };

  /** a wall plane perpendicular to travel at u=uc, spanning v0..v1 minus gaps */
  const wallU = (f: Frame, uc: number, v0: number, v1: number,
    gaps: { c: number; w: number }[], top: number, h: number): void => {
    const edges = gaps.map((g) => [g.c - g.w / 2, g.c + g.w / 2]).sort((a, b) => a[0] - b[0]);
    let at = v0;
    for (const [a, b] of edges) {
      if (a > at) solid(f, uc - WALL_T / 2, uc + WALL_T / 2, at, a, top, top + h, wallMat);
      at = Math.max(at, b);
    }
    if (v1 > at) solid(f, uc - WALL_T / 2, uc + WALL_T / 2, at, v1, top, top + h, wallMat);
  };

  /** a wall running along travel at v=vc, spanning u0..u1 minus gaps */
  const wallV = (f: Frame, vc: number, u0: number, u1: number,
    gaps: { c: number; w: number }[], top: number, h: number): void => {
    const edges = gaps.map((g) => [g.c - g.w / 2, g.c + g.w / 2]).sort((a, b) => a[0] - b[0]);
    let at = u0;
    for (const [a, b] of edges) {
      if (a > at) solid(f, at, a, vc - WALL_T / 2, vc + WALL_T / 2, top, top + h, wallMat);
      at = Math.max(at, b);
    }
    if (u1 > at) solid(f, at, u1, vc - WALL_T / 2, vc + WALL_T / 2, top, top + h, wallMat);
  };

  /**
   * A point standing on the surface, in a zone's own frame.
   *
   * On plates that is the plate; on ground it is the ground under that exact
   * column, which is why vents, posts, props and cover all go through here
   * rather than sharing one `top`. A squad posted at a zone's nominal floor
   * height would be buried in the near dune and hovering over the far one.
   */
  const surf = (f: Frame, u: number, v: number, lift = 0.2): THREE.Vector3 => {
    const x = f.x(u, v), z = f.z(u, v);
    return new THREE.Vector3(x, groundAt(x, z) + lift, z);
  };

  const clearOf = (x: number, z: number, r: number): boolean =>
    blocked.every((b) => Math.hypot(x - b.x, z - b.z) > b.r + r);

  /** one cover crate: collider + stand-in + authored sculpt */
  const crate = (x: number, y: number, z: number, ch = CRATE_H_MIN + rand() * CRATE_H_VAR): THREE.Mesh => {
    const sx = ch * CRATE_W_PER_H, sz = ch * CRATE_D_PER_H;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, ch, sz), crateMat);
    mesh.position.set(x, y + ch / 2, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    addBox(x, y + ch / 2, z, sx, ch, sz);
    authoredProp(group, mesh, 'corridor_crate', ch, { x, y, z, axis: 'y' });
    blocked.push({ x, z, r: Math.max(sx, sz) * 0.7 });
    return mesh;
  };

  /**
   * The outdoor answer to a crate: a boulder, standing on a cylinder because
   * that is the shape it is. Three silhouettes so a scatter of them does not
   * read as one prop repeated, and each takes its authored sculpt when the
   * file lands.
   */
  const coverRock = (x: number, y: number, z: number): void => {
    const size = 1.6 + rand() * 1.4;
    const h = size * (0.62 + rand() * 0.3);
    const geo = new THREE.CylinderGeometry(size * 0.42, size * 0.5, h, 7, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const n = 1 + (rand() - 0.5) * 0.4;
      pos.setX(i, pos.getX(i) * n);
      pos.setZ(i, pos.getZ(i) * n);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, rockMat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = rand() * Math.PI;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    // the mesh's base ring is size * 0.5 and the noise pushes it out to 0.6,
    // so a 0.46 disc left a shoulder's worth of rock you walked into
    addCyl(x, y + h / 2, z, size * 0.54, h);
    const id = ['boulder_a', 'boulder_b', 'boulder_c'][Math.floor(rand() * 3)];
    authoredProp(group, mesh, id, size, { x, y, z, yaw: rand() * Math.PI, axis: 'longest' });
    blocked.push({ x, z, r: size * 0.6 + 0.8 });
  };

  /**
   * One piece of a border: a noised, tapering column of rock (or a clean slab
   * of hull, by style). The mesh joins the merge list; the collider is a
   * cylinder, which is what the shape actually is — a box lies about a round
   * thing, and the mesas proved that years ago.
   */
  const rimPiece = (x: number, z: number, r: number, h: number, y0: number, backdrop: boolean): void => {
    const geo = new THREE.CylinderGeometry(r * look.taper, r, h, look.facets, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      // leave the base ring alone so neighbours still meet at the floor
      const grip = (py + h / 2) / h;
      const n = (rand() - 0.5) * look.noise * r * (0.35 + grip);
      pos.setX(i, pos.getX(i) * (1 + n));
      pos.setZ(i, pos.getZ(i) * (1 + n));
    }
    geo.computeVertexNormals();
    geo.translate(x, y0 + h / 2, z);
    (backdrop ? backGeo : rimGeo).push(geo);
  };

  /**
   * A border along a polyline, in world coordinates: overlapping pieces tall
   * enough to clear the ceiling, plus a sparser, taller row behind that is
   * mesh only — the mountains beyond, which nothing has to reach.
   *
   * **A border has a side.** `opts.inside` is a point on the playable side of
   * the line, and every rock this lays is placed *away* from it. Without that
   * the geometry and the collision disagreed twice over, and both were felt:
   *
   * - the rocks were centred on the line, so four to six metres of cliff stood
   *   inside a slab that only stops you 1.6 m in — you walked several metres
   *   into solid-looking rock before anything pushed back;
   * - the row of mountains behind was offset along a *fixed* perpendicular,
   *   which is only "behind" for half the rims in a level. The other half —
   *   every zone's right-hand wall, every front face, every lane's far side —
   *   put twenty-metre boulders with no collider at all inside the playable
   *   space. That is the "I walk through the walls" and the "why am I going
   *   around a mountain" of a run in one bug.
   */
  const ridge = (pts: [number, number][], y0: number,
    opts: { pillarAt?: [number, number][]; inside?: { x: number; z: number } } = {}): void => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) continue;
      const nx = (x1 - x0) / len, nz = (z1 - z0) / len;
      // which way is out of the level: the perpendicular that points away
      // from the playable side, where the caller says which side that is
      let ox = -nz, oz = nx;
      if (opts.inside) {
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        if ((opts.inside.x - mx) * ox + (opts.inside.z - mz) * oz > 0) { ox = -ox; oz = -oz; }
      }
      // The wall is **one box per run**, not one collider per rock.
      //
      // A rim is forty-odd pieces and a stage is a dozen rims, and every
      // collider in the world is walked by every capsule step, every ground
      // probe and every spawn validation — five hundred cylinders would be
      // paid for on every frame by every body. What a cliff owes the
      // simulation is "you cannot pass here", and a slab just inside the rock
      // line says that for the whole run at once. The rocks are what you see;
      // this is what you walk into.
      const T = 3.2;
      // The slab starts under the lowest ground the run crosses and reaches
      // past the ceiling, so a dip along a rim is never a gap you can walk
      // through and a rise is never a step you can climb over.
      let base = y0;
      if (onGround) {
        base = Infinity;
        for (let t = 0; t <= len; t += 4) base = Math.min(base, groundAt(x0 + nx * t, z0 + nz * t));
        base -= 3;
      }
      const wallH2 = ceilingY - base + RIM_OVER_CEILING;
      // One slab is the right answer for a run along an axis. A *diagonal* one
      // is not: an axis-aligned box drawn round it fills the whole bounding
      // rectangle, so a wall that leans ten metres across the level walls off
      // ten metres of ground the rock never covers. A leaning run is laid as a
      // short staircase instead — a handful of boxes, still nothing next to a
      // collider per rock, and it follows the line it is drawn along.
      const lean = Math.min(Math.abs(nx), Math.abs(nz)) * len;
      const parts = lean <= T ? 1 : Math.min(16, Math.ceil(lean / T));
      const segLen = len / parts;
      for (let s = 0; s < parts; s++) {
        const tm = (s + 0.5) * segLen;
        addBox(x0 + nx * tm, base + wallH2 / 2, z0 + nz * tm,
          Math.abs(nx) * segLen + Math.abs(nz) * T, wallH2,
          Math.abs(nz) * segLen + Math.abs(nx) * T);
      }
      const r = 4 + rand() * 2;
      const step = r * 1.15;
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * len;
        // The rock stands *outside* the slab, not on top of it. A piece is a
        // cylinder of radius r, so a centre on the line puts r metres of it in
        // front of the collider; pushing the centre out by that much lands the
        // face of the cliff on the face of the wall, which is where a player
        // who cannot walk through it expects to be stopped. The jitter only
        // ever goes further out, for the same reason.
        const out = r - T / 2 + 0.25 + rand() * 1.1;
        const px = x0 + nx * t + ox * out;
        const pz = z0 + nz * t + oz * out;
        // On ground each piece is seated in the ground under it, a couple of
        // metres deep so a rise between two pieces never shows daylight below
        // the rock; on a plate they all stand on the plate.
        const base = onGround ? groundAt(px, pz) - 2.5 : y0;
        rimPiece(px, pz, r, ceilingY - base + RIM_OVER_CEILING, base, false);
        // the row behind — further out again, never back across the level
        if (k % 2 === 0) {
          const away = 14 + rand() * 10;
          const bx = px + ox * away, bz = pz + oz * away;
          rimPiece(bx, bz, r * (1.2 + rand() * 0.6),
            ceiling * BACKDROP_H * (0.8 + rand() * 0.5),
            (onGround ? groundAt(bx, bz) : y0) - 6, true);
        }
      }
    }
    // the gap framers: the two pieces either side of a way through, taller
    // than their neighbours, which is what the eye picks out from 80 m
    for (const [px, pz] of opts.pillarAt ?? []) {
      const ph = (ceiling + RIM_OVER_CEILING) * 1.25;
      // seated in the ground under the spire itself, not at the zone's
      // nominal floor: on rolling dunes those are metres apart, and the
      // difference is a spire hanging in the air or buried to its shoulders
      const py = (onGround ? groundAt(px, pz) : y0) - 1.5;
      rimPiece(px, pz, 4.6, ph, py, false);
      // a pillar stands on its own, away from any wall run, so it carries its
      // own collider — the one shape in a rim that is round on every side
      addCyl(px, py + ph / 2, pz, 4.4, ph);
      authoredProp(group, [], spec.ridge === 'ice' ? 'cliff_pillar_ice' : 'cliff_pillar_rock',
        ph, { x: px, y: py, z: pz, axis: 'y' });
    }
  };

  /** the props a zone asked for, placed in its own frame */
  const placeProps = (f: Frame, zs: ZoneSpec, top0: number): void => {
    let top = top0;
    for (const p of zs.props ?? []) {
      const x = f.x(p.u, p.v), z = f.z(p.u, p.v);
      const size = p.size ?? 4;
      top = groundAt(x, z);
      if (p.solid) {
        // cover you can hide behind: a collider under the sculpt, and a
        // stand-in cylinder so the shape is there before the file lands
        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(p.solid.r * 0.85, p.solid.r, p.solid.h, 8), rockMat);
        stand.position.set(x, top + p.solid.h / 2, z);
        stand.castShadow = stand.receiveShadow = true;
        group.add(stand);
        const disc = addCyl(x, top + p.solid.h / 2, z, p.solid.r, p.solid.h);
        // `solid` describes the *stand-in*, and the sculpt that replaces it is
        // usually nothing like a disc — a twenty-six metre sail barge stood on
        // a four-metre cylinder is a wreck you walk through the length of. So
        // the sculpt supplies its own the moment it lands (`world/collide.ts`),
        // exactly as the boards do, and the disc it replaces goes.
        authoredProp(group, stand, p.id, size, { x, y: top, z, yaw: p.yaw, axis: 'longest' }, {
          physics: board.physics,
          replace: [disc],
          maxBoxes: 24,
          // a stage that was torn down while its art was still in flight must
          // not put colliders back into the world it has already given up
          onFit: (fitted) => { if (retired) removeBoxes(fitted); else boxes.push(...fitted); },
        });
        blocked.push({ x, z, r: p.solid.r + 1.2 });
      } else {
        authoredProp(group, [], p.id, size, { x, y: top, z, yaw: p.yaw, axis: 'longest' });
        blocked.push({ x, z, r: size * 0.4 });
      }
    }
  };

  /** the rides a zone parks, checked against the edges before they are taken */
  const placeRides = (f: Frame, zs: ZoneSpec, top: number): void => {
    for (const r of zs.rides ?? []) {
      const short = Math.min(zs.w, zs.l);
      if (zs.shell !== 'road' && short < RIDE_MIN_SIDE) {
        console.warn(`[mission] ${zs.label}: no room to turn a ride (${short} m)`);
        continue;
      }
      const edge = Math.min(zs.w / 2 - Math.abs(r.v), r.u, zs.l - r.u);
      if (edge < RIDE_EDGE_CLEAR) {
        console.warn(`[mission] ${zs.label}: a ride is parked ${edge.toFixed(1)} m from an edge`);
      }
      const rx = f.x(r.u, r.v), rz = f.z(r.u, r.v);
      rides.push({ kind: r.kind, x: rx, z: rz, yaw: r.yaw, y: groundAt(rx, rz) });
      blocked.push({ x: rx, z: rz, r: 3 });
    }
  };

  /** the set pieces a zone carries: a pit, hazard channels, barrels, pillars */
  const setPieces = (f: Frame, zs: ZoneSpec, top: number, wallH: number): void => {
    const { w, l } = zs;
    // A building or a seabed that already exists comes with its own cover,
    // its own hazards and its own dressing. Adding crates to the Refinery's
    // barrel hall would be furnishing a furnished room.
    if (bare) return;
    // A territory has its own lava, its own shock plates and its own pit —
    // the sarlacc is *there*, forty metres off the trailhead. Laying a second
    // set over the top of them would be the level arguing with the board.
    const dressed = !onGround;
    if (dressed && zs.feature === 'pit') {
      const r = Math.min(w, l) * 0.18 + 1.4;
      const maw = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.72, 1.1, 20),
        mat(0x120c08, { rough: 1 }));
      maw.position.set(f.x(l / 2, 0), top - 0.53, f.z(l / 2, 0));
      group.add(maw);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.45, 24), accentGlow);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(f.x(l / 2, 0), top + 0.03, f.z(l / 2, 0));
      group.add(ring);
      addHazard({ center: f.vec(l / 2, 0, top), radius: r - 0.3, kind: 'kill', yMax: top + 2.2 });
      blocked.push({ x: f.x(l / 2, 0), z: f.z(l / 2, 0), r: r + 2 });
    }
    if (dressed && (zs.feature === 'lava' || zs.feature === 'shock')) {
      const dps = zs.feature === 'lava' ? 26 : SHOCK_DPS;
      const cuts = l >= 20 ? [l * 0.38, l * 0.66] : [l * 0.5];
      cuts.forEach((cu, ci) => {
        const glow = new THREE.MeshBasicMaterial({
          color: zs.feature === 'lava' ? 0xff5a2a : 0x9fe8ff,
          transparent: zs.feature === 'shock', opacity: 1,
        });
        owned.push(glow);
        const strip: Hazard[] = [];
        for (const side of [-1, 1]) {
          const v0 = side * 1.7, v1 = side * (w / 2 - 1.2);
          slab(f, cu - 1.2, cu + 1.2, Math.min(v0, v1), Math.max(v0, v1), top + 0.02, top + 0.1, glow);
          const span = Math.abs(v1 - v0);
          for (let d = 1.2; d < span; d += 2.4) {
            strip.push(addHazard({
              center: f.vec(cu, v0 + side * d, top), radius: 1.5, kind: 'burn', dps, yMax: top + 2.2,
            }));
          }
        }
        if (zs.feature === 'shock') shockStrips.push({ hazards: strip, mat: glow, phase: ci * SHOCK_CYCLE / 2 });
        blocked.push({ x: f.x(cu, 0), z: f.z(cu, 0), r: 3 });
      });
    }
    if (zs.feature === 'barrels') {
      for (let b = 0; b < 4; b++) {
        for (let tries = 0; tries < 8; tries++) {
          const u = 3 + rand() * (l - 6);
          const v = (rand() - 0.5) * (w - 5);
          if (Math.abs(v) < 2 || !clearOf(f.x(u, v), f.z(u, v), 1.2)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.4, 10),
            mat(0x7a3a24, { rough: 0.6, metal: 0.4, emissive: 0x200a04 }));
          mesh.position.set(x, top + 0.7, z);
          group.add(mesh);
          const box = addBox(x, top + 0.7, z, 1, 1.4, 1);
          addBreakable(board, mesh, box, 30, { explosive: true });
          breakables.push({ mesh });
          blocked.push({ x, z, r: 1.4 });
          break;
        }
      }
    }
    const isArena = zs.kind === 'lieutenant' || zs.kind === 'warlord';
    if (isArena) {
      // the boss stands up in the middle and the monster erupts where it fell
      blocked.push({ x: f.x(l / 2, 0), z: f.z(l / 2, 0), r: 7 });
    }
    if (zs.feature === 'pillars' || isArena) {
      const lane = isArena ? 4 : 2.4;
      const pillarH = interior || zs.shell === 'hall' ? wallH - 0.8 : 5.5 + rand() * 2;
      for (let b = 0; b < 3; b++) {
        for (let tries = 0; tries < 10; tries++) {
          const u = 4 + rand() * (l - 8);
          const v = (rand() - 0.5) * (w - 7);
          if (Math.abs(v) < lane || !clearOf(f.x(u, v), f.z(u, v), 2)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, pillarH, 10),
            zs.shell === 'hall' ? wallMat : rockMat);
          mesh.position.set(x, top + pillarH / 2, z);
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
          addCyl(x, top + pillarH / 2, z, 1.25, pillarH);
          blocked.push({ x, z, r: 2.6 });
          break;
        }
      }
    }
    // cover: crates indoors, rocks out
    const fights = zs.kind === 'camp' || zs.kind === 'assault' || zs.kind === 'chase' || isArena;
    if (fights) {
      const n = Math.min(7, Math.max(2, Math.round((w * l) / 150))) + (zs.feature === 'crates' ? 2 : 0);
      for (let c = 0; c < n; c++) {
        for (let tries = 0; tries < 12; tries++) {
          const u = 3 + rand() * Math.max(1, l - 6);
          const v = (rand() - 0.5) * (w - 5);
          if (Math.abs(v) < 2.1 || !clearOf(f.x(u, v), f.z(u, v), 1.6)) continue;
          const x = f.x(u, v), z = f.z(u, v);
          const y = groundAt(x, z);
          if (interior || zs.shell === 'hall' || zs.shell === 'deck' || rand() < 0.35) crate(x, y, z);
          else coverRock(x, y, z);
          break;
        }
      }
    }
  };

  // ---------------------------------------------------------------- zones

  const zones: MissionZone[] = [];
  const zoneFrames: Frame[] = [];
  const zoneTops: number[] = [];
  const stageSeed = index * 137;
  let frame = onGround
    ? new Frame(anchor.x, anchor.z, anchor.dx, anchor.dz)
    : new Frame(-70 + stageSeed, -30, 1, 0);
  const last = stage.zones.length - 1;
  /** a stage boundary is a transport door, not a wall: leave a way through */
  const hasNext = index + 1 < spec.stages.length;
  const hasPrev = index > 0;

  for (let i = 0; i <= last; i++) {
    const zs = stage.zones[i];
    const f = frame;
    const { w, l } = zs;
    const top = onGround
      ? groundAt(f.x(l / 2, 0), f.z(l / 2, 0))
      : floorY + (spaceN++ % 3) * EPS;
    const isHall = zs.shell === 'hall';
    const wallH = zs.kind === 'warlord' ? baseWallH + 2.5 : baseWallH;
    const roofH = zs.roofH ?? ROOF_H;
    const hatches: { gate: Gate; post: THREE.Vector3 }[] = [];
    let runnerPost: THREE.Vector3 | null = null;
    const marks: THREE.Vector3[] = [];

    // ---- the floor ----
    // A ground stage stands on the board's own: no plate, no seam, and the
    // dunes or basalt the territory is *made of* under the fight.
    if (!onGround) solid(f, -1, l + 1, -w / 2 - 1, w / 2 + 1, top - 1, top, floorMat);
    rects.push(f.rect(-0.5, l + 0.5, -w / 2 - 0.5, w / 2 + 0.5));

    const dir = { x: f.dx, z: f.dz };
    // A way in and a way on: the zone's own neighbours, plus the transport
    // doors at either end of the stage. Their barrier is built after the loop
    // (a Portal, not a gate), but the gap in the wall has to be left here.
    const entryOpen = i > 0 || (i === 0 && hasPrev);
    const exitOpen = i < last || (i === last && hasNext);
    const internalEntry = i > 0;
    const internalExit = i < last;
    let entryBarrier: Barrier | null = null;
    let exitBarrier: Barrier | null = null;
    let landmark = f.vec(l, 0, top + 4);

    if (isHall) {
      // ---- a roofed room: real walls, blast doors, wall hatches ----
      const entryGaps = entryOpen ? [{ c: 0, w: GATE_W }] : [];
      const exitGaps = exitOpen ? [{ c: 0, w: GATE_W }] : [];
      wallU(f, -WALL_T / 2, -w / 2 - WALL_T, w / 2 + WALL_T, entryGaps, top, roofH);
      wallU(f, l + WALL_T / 2, -w / 2 - WALL_T, w / 2 + WALL_T, exitGaps, top, roofH);
      const alcoveGap = zs.alcove ? [{ c: l / 2, w: 3.2 }] : [];
      const hatchGaps = [{ c: l * 0.35, w: 2.6 }, { c: l * 0.7, w: 2.6 }];
      wallV(f, w / 2 + WALL_T / 2, -WALL_T, l + WALL_T, [...alcoveGap, hatchGaps[0]], top, roofH);
      wallV(f, -w / 2 - WALL_T / 2, -WALL_T, l + WALL_T, [hatchGaps[1]], top, roofH);
      // the roof: the hallway beat is indoors, and the jetpack is a hop in it
      solid(f, -1, l + 1, -w / 2 - 1, w / 2 + 1, top + roofH, top + roofH + 0.8, wallMat);
      slab(f, 1, l - 1, w / 2 - 0.22, w / 2 - 0.02, top + 0.04, top + 0.18, trimMat);
      slab(f, 1, l - 1, -w / 2 + 0.02, -w / 2 + 0.22, top + 0.04, top + 0.18, trimMat);

      // Wall hatches: a closet behind a door in each side wall. The wave is
      // posted in the closet and the hatch opens — a squad walking out of the
      // wall reads as the garrison being let in, where bodies standing up
      // beside it read as a spawn, and a roofed room has no sky to drop from.
      hatchGaps.forEach((h, k) => {
        const side = k === 0 ? 1 : -1;
        const p0 = side * (w / 2 + WALL_T);
        const outer = side * (w / 2 + WALL_T + 4.2);
        solid(f, h.c - 2, h.c + 2, Math.min(p0, outer), Math.max(p0, outer), top - 1, top, floorMat);
        wallU(f, h.c - 2 - WALL_T / 2, Math.min(p0, outer), Math.max(p0, outer), [], top, roofH);
        wallU(f, h.c + 2 + WALL_T / 2, Math.min(p0, outer), Math.max(p0, outer), [], top, roofH);
        wallV(f, outer + side * WALL_T / 2, h.c - 2 - WALL_T, h.c + 2 + WALL_T, [], top, roofH);
        solid(f, h.c - 2, h.c + 2, Math.min(p0, outer), Math.max(p0, outer), top + roofH, top + roofH + 0.8, wallMat);
        const gate = new Gate(board, group, f.vec(h.c, p0, top),
          { x: f.px * side, z: f.pz * side }, roofH, pal.accent, { width: 2.6 });
        hatches.push({ gate, post: f.vec(h.c, side * (w / 2 + 3.2), top + 0.2) });
        rects.push(f.rect(h.c - 2, h.c + 2, Math.min(p0, outer), Math.max(p0, outer)));
      });

      if (zs.alcove) {
        const p0 = w / 2 + WALL_T;
        solid(f, l / 2 - 2.4, l / 2 + 2.4, p0 - 0.5, p0 + 3.4, top - 1, top, floorMat);
        wallU(f, l / 2 - 2.4 - WALL_T / 2, p0 + 0.05, p0 + 3.4 + WALL_T, [], top, roofH);
        wallU(f, l / 2 + 2.4 + WALL_T / 2, p0 + 0.05, p0 + 3.4 + WALL_T, [], top, roofH);
        wallV(f, p0 + 3.4 + WALL_T / 2, l / 2 - 2.4 - WALL_T, l / 2 + 2.4 + WALL_T, [], top, roofH);
        pickups.push(f.vec(l / 2, p0 + 1.8, top + 0.2));
        rects.push(f.rect(l / 2 - 2.4, l / 2 + 2.4, p0, p0 + 3.4));
      }
      if (internalEntry) entryBarrier = new Gate(board, group, f.vec(0, 0, top), dir, roofH, pal.accent);
      if (internalExit) exitBarrier = new Gate(board, group, f.vec(l, 0, top), dir, roofH, pal.accent);
      const lamp = new THREE.PointLight(0xffd9a0, 40 + (w * l) / 8, Math.max(w, l) * 1.7, 1.4);
      lamp.position.set(f.x(l / 2, 0), top + roofH - 0.4, f.z(l / 2, 0));
      group.add(lamp);
      landmark = f.vec(l, 0, top + 2.5);
    } else if (zs.shell === 'deck') {
      // ---- a plate in the void: no rim, the edge is the border ----
      const edge = new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true, opacity: 0.5 });
      owned.push(edge);
      slab(f, -0.6, 0.2, -w / 2, w / 2, top + 0.02, top + 0.2, edge);
      if (internalExit) {
        slab(f, l - 0.2, l + 0.6, -w / 2, w / 2, top + 0.02, top + 0.2, edge);
        exitBarrier = new Fence(board, group, f.vec(l + 1, 0, top), dir, GATE_W + 3, ceiling, pal.accent);
      }
      landmark = f.vec(l + 6, 0, top + 3);
    } else if (bare) {
      // ---- a building or a sea that is already there ----
      // Nothing is built: the walls, the water and the way through are the
      // board's own. All a zone adds is where the fight happens and what
      // holds it — a pane across the way on, and nothing across the way in.
      if (internalExit && zs.kind !== 'camp' && zs.kind !== 'trek' && zs.kind !== 'start') {
        exitBarrier = new Fence(board, group, surf(f, l + 0.6, 0, 0), dir,
          Math.min(zs.w, 14), Math.min(ceiling, 12), pal.accent);
      }
      landmark = surf(f, l + 4, 0, 3);
    } else {
      // ---- outdoors: the border is terrain ----
      const half = w / 2 + 1.5;
      const back = -1.5, front = l + 1.5;
      const gapHalf = (GATE_W + 3) / 2;
      const pillars: [number, number][] = [];
      /**
       * No rim on a trailhead standing on the territory's own ground.
       *
       * A rim has to clear the flight ceiling, so it is one 45-plus-metre
       * slab per run whatever the zone is. Around a 56 x 44 m `open` zone
       * that is a box with sides taller than they are far apart, and the
       * first thing the Dune Sea's run did was stand you in the middle of
       * one with the board's own mesa poking through the west wall: cramped,
       * unreadable, and neither outdoor nor indoor, which is the opposite of
       * what rule 1 of docs/MISSIONS_OUTDOOR.md asks the opening ten seconds
       * to do. The trailhead has no fight to hold in and nothing behind it to
       * come back from, so the territory holds it instead — its dunes, its
       * mesas, its horizon — and the guidance points the way on. Every zone
       * after it keeps its border.
       */
      const openTrailhead = onGround && zs.kind === 'start';
      // A canyon stage is bordered once, down the whole chain, rather than a
      // box per zone — so the zones inside it lay no rim of their own.
      const rimmed = (wantRim || !onGround) && !openTrailhead && !canyon;
      /** the playable side of this zone's borders, for the rock to stand clear of */
      const heart = { x: f.x(l / 2, 0), z: f.z(l / 2, 0) };
      // sides run the full length
      if (rimmed) {
        ridge([[f.x(back, half), f.z(back, half)], [f.x(front, half), f.z(front, half)]], top, { inside: heart });
        ridge([[f.x(back, -half), f.z(back, -half)], [f.x(front, -half), f.z(front, -half)]], top, { inside: heart });
      }
      // A dead end's way on is a door in the rock rather than an open mouth —
      // except where the stage itself ends here, because then the transport
      // door *is* that door and a second one 20 cm in front of it is just a
      // second door. Either way the rim leaves the gap: the face fills it.
      const doorFace = !!zs.deadEnd && internalExit;
      const frontGaps: [number, number][] = exitOpen ? [[-gapHalf, gapHalf]] : [];
      if (zs.pass) {
        frontGaps.push([w / 3 - 2, w / 3 + 2]);
        runnerPost = surf(f, l + 9, w / 3);
      }
      frontGaps.sort((a, b) => a[0] - b[0]);
      if (rimmed) {
        // the back wall, with the way in
        if (entryOpen) {
          ridge([[f.x(back, half), f.z(back, half)], [f.x(back, gapHalf), f.z(back, gapHalf)]], top, { inside: heart });
          ridge([[f.x(back, -gapHalf), f.z(back, -gapHalf)], [f.x(back, -half), f.z(back, -half)]], top, { inside: heart });
        } else {
          ridge([[f.x(back, half), f.z(back, half)], [f.x(back, -half), f.z(back, -half)]], top, { inside: heart });
        }
        // the front, minus the way on and any runner notch
        let at = -half;
        for (const [a, b] of frontGaps) {
          if (a > at) ridge([[f.x(front, at), f.z(front, at)], [f.x(front, a), f.z(front, a)]], top, { inside: heart });
          at = b;
        }
        if (half > at) ridge([[f.x(front, at), f.z(front, at)], [f.x(front, half), f.z(front, half)]], top, { inside: heart });
      }
      // The way on is framed whether or not the zone is walled: the pair of
      // spires is what the eye picks out from eighty metres, and an unrimmed
      // trailhead needs that more than a walled zone does, not less.
      // (a canyon stage's last beat is framed by the gorge mouth instead — a
      // second pair of spires three metres short of it is a gate to nowhere)
      if (exitOpen && !(canyon?.gorge && i === last)) {
        pillars.push([f.x(front, gapHalf + 3), f.z(front, gapHalf + 3)],
          [f.x(front, -gapHalf - 3), f.z(front, -gapHalf - 3)]);
      }
      if (pillars.length) ridge([], top, { pillarAt: pillars });
      if (exitOpen) landmark = surf(f, front, 0, ceiling * 0.5);

      if (doorFace) {
        // A hewn face filling the rim's gap, with the door in the middle of it
        // and a lamp over the door — in a dark ravine the way on should be the
        // brightest thing in front of you. The face is built in two bands so
        // the doorway is a doorway rather than a full-height slot up the
        // cliff: a low band with the opening in it, and solid rock above.
        const faceH = 7;
        const rimH = ceiling + RIM_OVER_CEILING;
        wallU(f, l + 1.2, -gapHalf - 1, gapHalf + 1, [{ c: 0, w: GATE_W }], top, faceH);
        solid(f, l + 1.2 - WALL_T / 2, l + 1.2 + WALL_T / 2, -gapHalf - 1, gapHalf + 1,
          top + faceH, top + rimH, rockMat);
        exitBarrier = new Gate(board, group, surf(f, l + 1.2, 0, 0), dir, faceH, pal.accent);
        const lamp = new THREE.PointLight(0xffd9a0, 30, 26, 1.5);
        lamp.position.set(f.x(l + 1.2, 0), top + faceH - 0.5, f.z(l + 1.2, 0));
        group.add(lamp);
        landmark = surf(f, l + 1.2, 0, 3);
      }

      // an outdoor fight is held in by its exit, never by a cage behind it
      if (internalExit && !doorFace
        && (zs.kind === 'assault' || zs.kind === 'lieutenant' || zs.kind === 'warlord' || zs.kind === 'chase')) {
        exitBarrier = new Fence(board, group, surf(f, l + 0.6, 0, 0), dir, GATE_W + 3, ceiling, pal.accent);
      }
      if ((zs.kind === 'lieutenant' || zs.kind === 'warlord') && internalEntry) {
        // the arena's own gate behind the party, so the fight has a back wall
        entryBarrier = new Fence(board, group, surf(f, -0.6, 0, 0), dir, GATE_W + 3, ceiling, pal.accent);
      }
      if (zs.alcove) {
        pickups.push(f.vec(l * 0.5, w / 2 - 2.2, top + 0.2));
      }
      // road: the drop marks and the barricade at the far mouth
      if (zs.shell === 'road') {
        for (const m of zs.marks ?? [0.4, 0.75]) marks.push(surf(f, l * m, 0));
        if (zs.barricade === 'crates') {
          // A crate line plugs a mouth. Out in the open ground of a canyon
          // there is nothing to plug — you drive round it — so where the run
          // ends at a gorge the barricade goes into the gorge's own mouth,
          // which is the one place on the road that is narrower than the ride.
          const inMouth = !!canyon?.gorge && i === last;
          const bu = inMouth ? l + 5 : l - 2;
          const bn = inMouth ? Math.max(2, Math.round(canyon!.gorge!.w / 5.2)) : 2;
          for (let k = -bn; k <= bn; k++) {
            const x = f.x(bu, k * 2.6), z = f.z(bu, k * 2.6);
            const mesh = crate(x, groundAt(x, z), z, 1.5);
            const box = boxes[boxes.length - 1];
            addBreakable(board, mesh, box, BARRICADE_HP);
            breakables.push({ mesh });
          }
        } else if (internalExit) {
          exitBarrier = new Fence(board, group, surf(f, l + 0.6, 0, 0), dir, GATE_W + 3, ceiling, pal.accent);
        }
      }
    }

    setPieces(f, zs, top, isHall ? roofH : wallH);
    placeProps(f, zs, top);
    placeRides(f, zs, top);

    // ---- spawn geometry ----
    const farVents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l - 3.5, w / 2 - 3.5], [l - 3.5, -(w / 2 - 3.5)],
      [l - 3.5, w * 0.17], [l - 3.5, -w * 0.17],
    ]) farVents.push(surf(f, u, v));
    const sideVents: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l * 0.5, w / 2 - 3], [l * 0.5, -(w / 2 - 3)],
      [l * 0.32, w / 2 - 3.5], [l * 0.32, -(w / 2 - 3.5)],
      [l * 0.7, w / 2 - 3.5], [l * 0.7, -(w / 2 - 3.5)],
    ]) sideVents.push(surf(f, u, v));
    const posts: THREE.Vector3[] = [];
    for (const [u, v] of [
      [l * 0.6, w * 0.28], [l * 0.6, -w * 0.28], [l * 0.75, 0],
      [l * 0.82, w * 0.2], [l * 0.82, -w * 0.2],
    ]) posts.push(surf(f, u, v));

    zoneFrames.push(f);
    zoneTops.push(top);
    const pathFrom = path.length;
    zones.push({
      spec: zs,
      pathFrom,
      beat: beat0 + i,
      entry: surf(f, 2.4, 0),
      center: surf(f, l / 2, 0),
      exit: surf(f, l - 2.4, 0),
      rect: f.rect(0, l, -w / 2, w / 2),
      sealRect: f.rect(1.2, l - 1.2, -w / 2, w / 2),
      triggerRect: f.rect(Math.min(TRIGGER_IN, l * 0.4), l, -w / 2, w / 2),
      entryBarrier, exitBarrier, hatches,
      farVents, sideVents, vents: [], posts, runnerPost, marks,
      landmark,
    });
    path.push(surf(f, 2.4, 0), surf(f, l - 2.4, 0));

    // ---- the link on to the next zone ----
    if (i === last) break;
    const link = stage.links[i] ?? { len: 14 };
    const nextIsHall = stage.zones[i + 1].shell === 'hall';
    const roofed = link.kind ? link.kind === 'corridor' : (isHall || nextIsHall);
    const linkPosts: DefenderPost[] = [];
    let g = new Frame(f.x(l + 1.5, 0), f.z(l + 1.5, 0), f.dx, f.dz);
    const laneW = roofed ? corrW : Math.max(corrW, 9);

    const leg = (lf: Frame, len: number, withCrates: boolean): void => {
      const ltop = onGround
        ? groundAt(lf.x(len / 2, 0), lf.z(len / 2, 0))
        : floorY + (spaceN++ % 3) * EPS;
      if (!onGround) solid(lf, -1, len + 1, -laneW / 2 - 1, laneW / 2 + 1, ltop - 1, ltop, floorMat);
      if (roofed) {
        solid(lf, -1, len + 1, -laneW / 2 - 1, laneW / 2 + 1, ltop + CORR_H, ltop + CORR_H + 1, wallMat);
        // the lane walls sit 5 cm proud and run only their own span: the room
        // and junction walls seal the corners, and a wall that overshot into a
        // junction left a notch bodies wedged into at every bend
        wallV(lf, laneW / 2 + WALL_T / 2 + 0.05, 0.05, len - 0.05, [], ltop, CORR_H);
        wallV(lf, -laneW / 2 - WALL_T / 2 - 0.05, 0.05, len - 0.05, [], ltop, CORR_H);
        const light = new THREE.PointLight(0xffd9a0, 9, len + 12, 1.6);
        light.position.set(lf.x(len / 2, 0), ltop + CORR_H - 0.5, lf.z(len / 2, 0));
        group.add(light);
      } else if (!canyon) {
        // An outdoor lane: cliffs, not walls, and the sky stays overhead.
        //
        // The runs stop at the leg's own ends. They used to overshoot by a
        // metre at each end, which walled off every bend: a leg's side wall
        // reached back across the junction its neighbour turns out of, and
        // the two overhangs met in an interior corner a body could walk into
        // and never out of. The roofed corridors have always stopped short
        // for exactly this reason; the cliffs have to as well.
        const hw = laneW / 2 + 1.5;
        const lane = { x: lf.x(len / 2, 0), z: lf.z(len / 2, 0) };
        ridge([[lf.x(0, hw), lf.z(0, hw)], [lf.x(len, hw), lf.z(len, hw)]], ltop, { inside: lane });
        ridge([[lf.x(0, -hw), lf.z(0, -hw)], [lf.x(len, -hw), lf.z(len, -hw)]], ltop, { inside: lane });
      }
      if (!onGround) slab(lf, 0.5, len - 0.5, -laneW / 2 + 0.02, -laneW / 2 + 0.2, ltop + 0.04, ltop + 0.16, trimMat);
      rects.push(lf.rect(-0.5, len + 0.5, -laneW / 2 - 0.5, laneW / 2 + 0.5));
      // the breadcrumb: posts down any lane long enough to be a walk
      if (len >= TRAIL_MIN_LEN) {
        for (let d = TRAIL_EVERY; d < len; d += TRAIL_EVERY) {
          const px = lf.x(d, laneW / 2 - 0.9), pz = lf.z(d, laneW / 2 - 0.9);
          const ltop = groundAt(px, pz);
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.8, 6),
            mat(0x3a3a3a, { rough: 0.8, metal: 0.3 }));
          post.position.set(px, ltop + 0.9, pz);
          group.add(post);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), accentGlow);
          head.position.set(px, ltop + 1.9, pz);
          group.add(head);
          authoredProp(group, [post, head], 'trail_post', 1.8, { x: px, y: ltop, z: pz, axis: 'y' });
        }
      }
      if (withCrates && roofed && len >= 12) {
        // a staggered pair butted flush against the walls: tuck, peek, advance.
        // Flush matters — a crate floating off the wall leaves a gap too narrow
        // for a body, and that pocket catches anyone hugging the wall.
        for (const [t, side] of [[0.42, 1], [0.68, -1]] as const) {
          const ch = CRATE_H_MIN + rand() * CRATE_H_VAR;
          const across = (lf.dx !== 0 ? CRATE_D_PER_H : CRATE_W_PER_H) * ch;
          const v = side * (laneW / 2 + 0.03 - across / 2);
          crate(lf.x(len * t, v), ltop, lf.z(len * t, v), ch);
          linkPosts.push({
            pos: lf.vec(len * t + 1.5, v, ltop + 0.2),
            toward: lf.vec(0, 0, ltop),
          });
        }
      }
      path.push(surf(lf, len / 2, 0));
    };

    leg(g, link.len, true);
    if (link.turn && link.len2) {
      const jf = new Frame(g.x(link.len, 0), g.z(link.len, 0), g.dx, g.dz);
      const jtop = onGround
        ? groundAt(jf.x(laneW / 2, 0), jf.z(laneW / 2, 0))
        : floorY + (spaceN++ % 3) * EPS;
      if (!onGround) solid(jf, -1, laneW + 1, -laneW / 2 - 1, laneW / 2 + 1, jtop - 1, jtop, floorMat);
      if (roofed) {
        solid(jf, -1, laneW + 1, -laneW / 2 - 1, laneW / 2 + 1, jtop + CORR_H, jtop + CORR_H + 1, wallMat);
        wallU(jf, laneW + WALL_T / 2, -laneW / 2 - WALL_T, laneW / 2 + WALL_T, [], jtop, CORR_H);
        wallV(jf, -link.turn * (laneW / 2 + WALL_T / 2), -WALL_T, laneW + WALL_T, [], jtop, CORR_H);
      } else {
        const outer = -link.turn * (laneW / 2 + 1.5);
        const bend = { x: jf.x(laneW / 2, link.turn * laneW * 0.25), z: jf.z(laneW / 2, link.turn * laneW * 0.25) };
        ridge([[jf.x(-1.5, outer), jf.z(-1.5, outer)], [jf.x(laneW + 1.5, outer), jf.z(laneW + 1.5, outer)]],
          jtop, { inside: bend });
        ridge([[jf.x(laneW + 1.5, outer), jf.z(laneW + 1.5, outer)],
          [jf.x(laneW + 1.5, -outer), jf.z(laneW + 1.5, -outer)]], jtop, { inside: bend });
      }
      rects.push(jf.rect(0, laneW, -laneW / 2, laneW / 2));
      // The corner itself is a point on the golden path. Without it the route
      // reads as "leg one's middle, then leg two's middle", and the straight
      // line between those two cuts across the inside of the bend — into the
      // cliff that makes the bend a bend.
      path.push(surf(jf, laneW / 2, 0));
      const ndx = link.turn > 0 ? jf.px : -jf.px;
      const ndz = link.turn > 0 ? jf.pz : -jf.pz;
      const g2 = new Frame(
        jf.x(laneW / 2, link.turn * (laneW / 2)),
        jf.z(laneW / 2, link.turn * (laneW / 2)), ndx, ndz);
      leg(g2, link.len2, false);
      g = g2;
      frame = new Frame(g2.x(link.len2 + 1.5, 0), g2.z(link.len2 + 1.5, 0), ndx, ndz);
    } else {
      frame = new Frame(g.x(link.len + 1.5, 0), g.z(link.len + 1.5, 0), g.dx, g.dz);
    }
    // bacta midway down every other link — the attrition beat pays for itself
    if (i % 2 === 1) pickups.push(surf(g, 6, -1.4));
    defenders.push(linkPosts);
  }

  // ---------------------------------------------------------------- the canyon

  /**
   * The stage's border as one place rather than a row of boxes.
   *
   * Two walls laid along the chain's own axis, wide apart where the run
   * starts and closing as it goes, and a cliff across the far end with the way
   * on cut into it. The taper is weighted late (t²) so the opening is genuinely
   * open — the point of the shape is that you *notice* it closing, which you
   * cannot do if it has been closing since the first step.
   *
   * Everything here is laid in the anchor's frame: a canyon is for a straight
   * chain, which is what the layouts that ask for one are.
   */
  /** how far along the chain's axis the way on stands, when a gorge holds it */
  let gorgeDepth = 0;
  if (canyon && zoneFrames.length) {
    const axis = new Frame(anchor.x, anchor.z, anchor.dx, anchor.dz);
    const lastF = zoneFrames[last];
    // where the last zone's far edge falls along the axis
    const chainEnd = (lastF.ex - anchor.x) * anchor.dx + (lastF.ez - anchor.z) * anchor.dz
      + stage.zones[last].l;
    const halfAt = (u: number): number => {
      const t = Math.min(1, Math.max(0, u / Math.max(1, chainEnd)));
      return canyon.from + (canyon.to - canyon.from) * t * t;
    };
    /** one wall run, in short segments so the taper is a curve and not a corner */
    const wall = (u0: number, u1: number, side: 1 | -1): void => {
      const steps = Math.max(1, Math.ceil((u1 - u0) / 14));
      for (let k = 0; k < steps; k++) {
        const ua = u0 + ((u1 - u0) * k) / steps;
        const ub = u0 + ((u1 - u0) * (k + 1)) / steps;
        const va = side * halfAt(ua), vb = side * halfAt(ub);
        const mid = (ua + ub) / 2;
        ridge([[axis.x(ua, va), axis.z(ua, va)], [axis.x(ub, vb), axis.z(ub, vb)]],
          groundAt(axis.x(mid, 0), axis.z(mid, 0)),
          { inside: { x: axis.x(mid, 0), z: axis.z(mid, 0) } });
      }
    };
    const gorge = hasNext ? canyon.gorge : undefined;
    // the mouth of the gorge sits a little past the last zone, so the cliff is
    // something you walk *up to* rather than something the fight ends against
    const uCliff = chainEnd + 3;
    gorgeDepth = gorge ? gorge.len : 0;
    wall(-8, uCliff, 1);
    wall(-8, uCliff, -1);
    // the wall behind: a canyon is a place, and a place has a back to it
    const backHalf = halfAt(-8);
    ridge([[axis.x(-8, backHalf), axis.z(-8, backHalf)], [axis.x(-8, -backHalf), axis.z(-8, -backHalf)]],
      groundAt(axis.x(-8, 0), axis.z(-8, 0)), { inside: { x: axis.x(10, 0), z: axis.z(10, 0) } });

    if (gorge) {
      const gh = gorge.w / 2;
      const endHalf = halfAt(uCliff);
      const face = groundAt(axis.x(uCliff, 0), axis.z(uCliff, 0));
      const behind = { x: axis.x(uCliff - 14, 0), z: axis.z(uCliff - 14, 0) };
      // the cliff that closes the canyon, either side of the slot
      for (const side of [1, -1] as const) {
        ridge([[axis.x(uCliff, side * gh), axis.z(uCliff, side * gh)],
          [axis.x(uCliff, side * endHalf), axis.z(uCliff, side * endHalf)]], face, { inside: behind });
      }
      // the slot itself: constrained, not tight — wide enough to fight down
      const inSlot = { x: axis.x(uCliff + gorgeDepth / 2, 0), z: axis.z(uCliff + gorgeDepth / 2, 0) };
      for (const side of [1, -1] as const) {
        ridge([[axis.x(uCliff, side * gh), axis.z(uCliff, side * gh)],
          [axis.x(uCliff + gorgeDepth + 4, side * gh), axis.z(uCliff + gorgeDepth + 4, side * gh)]],
        face, { inside: inSlot });
      }
      // two spires at the mouth: the thing you steer at from a hundred metres
      ridge([], face, {
        pillarAt: [
          [axis.x(uCliff - 1, gh + 4.5), axis.z(uCliff - 1, gh + 4.5)],
          [axis.x(uCliff - 1, -gh - 4.5), axis.z(uCliff - 1, -gh - 4.5)],
        ],
      });
      // the guidance points at the mouth, not at the last zone's far edge
      const mouth = new THREE.Vector3(axis.x(uCliff, 0), face + 3, axis.z(uCliff, 0));
      zones[last].landmark = mouth.clone();
      path.push(mouth.clone());
    } else {
      // no gorge: the canyon still has to *end*, or the far wall is two lines
      // running off into the territory with open ground between them. A cliff
      // across it, with the doorway's own gap left where a way on exists.
      const endHalf = halfAt(uCliff);
      const face = groundAt(axis.x(uCliff, 0), axis.z(uCliff, 0));
      const behind = { x: axis.x(uCliff - 14, 0), z: axis.z(uCliff - 14, 0) };
      const gapHalf = hasNext ? (GATE_W + 4) / 2 : 0;
      for (const side of [1, -1] as const) {
        if (endHalf <= gapHalf) continue;
        ridge([[axis.x(uCliff, side * gapHalf), axis.z(uCliff, side * gapHalf)],
          [axis.x(uCliff, side * endHalf), axis.z(uCliff, side * endHalf)]], face, { inside: behind });
      }
    }
  }

  // ---- the transport doors at the stage's ends (docs/MISSIONS_OUTDOOR.md §1.9) ----
  // A pocket beyond the leaves, whose far end is the threshold: the door is
  // stepped through deliberately, never brushed by in a fight that spilled
  // into it, and on the way back it is where a player stands to wait.
  const pocket = (f: Frame, u0: number, top: number, back: boolean, doorH: number): void => {
    const s0 = back ? u0 - PORTAL_POCKET - 1 : u0;
    const s1 = back ? u0 : u0 + PORTAL_POCKET + 1;
    // The pocket is a threshold, so on rolling ground it is levelled into a
    // short platform at the doorway's own height rather than following the
    // dune through it — a door you step *up* into reads as a door.
    solid(f, s0, s1, -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6, top - 3, top, floorMat);
    wallV(f, GATE_W / 2 + 2.6 + WALL_T / 2, s0, s1, [], top, doorH);
    wallV(f, -GATE_W / 2 - 2.6 - WALL_T / 2, s0, s1, [], top, doorH);
    wallU(f, back ? s0 - WALL_T / 2 : s1 + WALL_T / 2,
      -GATE_W / 2 - 2.6 - WALL_T, GATE_W / 2 + 2.6 + WALL_T, [], top, doorH);
    solid(f, s0, s1, -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6, top + doorH, top + doorH + 0.8, wallMat);
    rects.push(f.rect(s0, s1, -GATE_W / 2 - 2.6, GATE_W / 2 + 2.6));
  };

  let exitPortal: Portal | null = null;
  let backPortal: Portal | null = null;
  if (hasNext) {
    const f = zoneFrames[last];
    // A gorge puts the door at the far end of the slot rather than in open
    // ground: the way on is *walked into* — cliff, mouth, ravine, door.
    const u0 = stage.zones[last].l + 1 + (gorgeDepth ? gorgeDepth + 3 : 0);
    const top = onGround
      ? groundAt(f.x(u0 + 2, 0), f.z(u0 + 2, 0))
      : zoneTops[last];
    const doorH = Math.max(6, (stage.zones[last].roofH ?? ROOF_H));
    pocket(f, u0, top, false, doorH);
    exitPortal = new Portal(board, group, f.vec(u0, 0, top),
      { x: f.dx, z: f.dz }, doorH, PORTAL_POCKET);
    path.push(exitPortal.threshold.clone());
  }
  if (hasPrev) {
    const f = zoneFrames[0];
    const top = onGround ? groundAt(f.x(-3, 0), f.z(-3, 0)) : zoneTops[0];
    const doorH = Math.max(6, (stage.zones[0].roofH ?? ROOF_H));
    pocket(f, -1, top, true, doorH);
    backPortal = new Portal(board, group, f.vec(-1, 0, top),
      { x: -f.dx, z: -f.dz }, doorH, PORTAL_POCKET);
  }

  // ---- one draw call per rim row ----
  const mergeInto = (geos: THREE.BufferGeometry[], m: THREE.Material, shadow: boolean): void => {
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    group.add(mesh);
  };
  mergeInto(rimGeo, rockMat, true);
  mergeInto(backGeo, backdropMat, false);

  // The horizon: an alpha strip standing well behind the backdrop row, in the
  // fog's own colour. The rims and the row behind them give the level its
  // walls and its depth; this is what puts a country beyond them, and it
  // costs one billboard ring per stage.
  if (look.sil && !interior) {
    const silMat = new THREE.MeshBasicMaterial({
      color: pal.backdrop, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    });
    owned.push(silMat);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(520, 520, ceiling * 3.4, 48, 1, true), silMat);
    ring.position.set(0, floorY + ceiling * 1.1, 0);
    ring.frustumCulled = false;
    group.add(ring);
    loadOptionalTexture(look.sil, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(9, 1);
      silMat.map = tex;
      silMat.alphaTest = 0.35;
      silMat.color.set(0xffffff);
      silMat.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
  }

  // ---- validation: keep only spots a body actually fits in ----
  const fits = (p: THREE.Vector3): boolean => {
    if (!board.physics.capsuleFree(p.x, p.y, p.z, 0.6, 2.1)) return false;
    const hz = hazardAt(board, p);
    return !hz.kill && hz.dps <= 0;
  };
  for (const zone of zones) {
    zone.farVents = zone.farVents.filter(fits);
    zone.sideVents = zone.sideVents.filter(fits);
    zone.vents = [...zone.farVents, ...zone.sideVents];
    if (!zone.vents.length) zone.vents.push(zone.center.clone());
    zone.posts = zone.posts.filter(fits);
    if (!zone.posts.length) zone.posts.push(zone.center.clone());
    if (zone.runnerPost && !fits(zone.runnerPost)) zone.runnerPost = null;
    for (const h of zone.hatches) if (!fits(h.post)) h.post.copy(zone.center);
  }
  for (let i = 0; i < defenders.length; i++) defenders[i] = defenders[i].filter((d) => fits(d.pos));

  const startZone = zones[0];
  const starts = [[0.9, 0.9], [-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9]].map(([dx, dz]) => {
    const x = startZone.entry.x + dx, z = startZone.entry.z + dz;
    return new THREE.Vector3(x, groundAt(x, z) + 0.2, z);
  });

  // ---- the stage's own water, where it has one ----
  let waterY: number | undefined;
  if (stage.world?.waterDrop !== undefined) {
    waterY = floorY - stage.world.waterDrop;
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({
        color: pal.backdrop, roughness: 0.28, metalness: 0.1,
        transparent: true, opacity: 0.85,
      }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, waterY, 0);
    group.add(sea);
    owned.push(sea.material as THREE.Material);
    const seaMat = sea.material as THREE.MeshStandardMaterial;
    loadOptionalTexture('sea_surface', (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(60, 60);
      seaMat.map = tex;
      seaMat.color.set(0xffffff);
      seaMat.needsUpdate = true;
    }, { exts: ['jpg', 'png'] });
    loadOptionalTexture('sea_surface_normal', (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(60, 60);
      seaMat.normalMap = tex;
      seaMat.needsUpdate = true;
    }, { exts: ['png', 'jpg'] });
  }

  const contains = (x: number, z: number): boolean =>
    rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);

  // ---- teardown: a stage swap has to give all of this back ----
  const dispose = (): void => {
    retired = true;
    board.group.remove(group);
    // `disposeSubtree`, not a hand-rolled traverse: a stage is full of authored
    // sculpts, and a loaded .glb is cached once and *cloned* per instance, so
    // a clone shares its original's geometries and textures. Disposing those by
    // hand would free art every future instance of that prop still needs —
    // which is exactly the kind of thing that shows up three stage swaps later
    // as a renderer that has run out of memory. The shared ones are tagged;
    // this is what respects the tag.
    disposeSubtree(group);
    for (const r of owned) r.dispose();
    const phys = board.physics;
    // A barrier's blocker comes and goes with its animation, so it may be
    // standing in the world right now under a reference nothing else holds:
    // retire them before the recorded lists are swept.
    for (const p of [exitPortal, backPortal]) p?.retire();
    for (const z of zones) {
      for (const b of [z.entryBarrier, z.exitBarrier]) b?.retire();
      for (const h of z.hatches) h.gate.retire();
    }
    const boxSet = new Set(boxes);
    const cylSet = new Set(cylinders);
    phys.boxes = phys.boxes.filter((b) => !boxSet.has(b));
    phys.cylinders = phys.cylinders.filter((c) => !cylSet.has(c));
    if (board.hazards) board.hazards = board.hazards.filter((h) => !hazards.includes(h));
    if (board.breakables) {
      const meshes = breakables.map((b) => b.mesh);
      board.breakables = board.breakables.filter((b) => !meshes.includes(b.mesh));
    }
  };

  return {
    spec: stage,
    index,
    zones, defenders, pickups, starts, rides, path,
    exitPortal, backPortal,
    floorY, ceilingY, waterY, groundAt,
    contains, dispose,
    tick: (time: number) => {
      for (const s of shockStrips) {
        const t = (time + s.phase) % SHOCK_CYCLE;
        const live = t >= SHOCK_LIVE_AT;
        const charging = !live && t >= SHOCK_CHARGE_AT;
        for (const h of s.hazards) h.dps = live ? SHOCK_DPS : 0;
        s.mat.opacity = live ? 0.85 + Math.sin(time * 30) * 0.12
          : charging ? 0.2 + ((t - SHOCK_CHARGE_AT) / (SHOCK_LIVE_AT - SHOCK_CHARGE_AT)) * 0.4 * (Math.sin(time * 14) * 0.5 + 0.5)
            : 0.12;
      }
    },
  };
}

/** the outdoor ground a ridge style stands on */
function stageFloorTexture(style: RidgeStyle): string {
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

export { MISSION_LAYOUTS } from './mission-layouts';
export type { BoardId };
