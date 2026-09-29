import * as THREE from 'three';
import type { SectionContext } from './context';
import type { StaticBox } from '../core/physics';

/**
 * The Dune Sea sections' two hulls, built from colliders the party walks on
 * and a procedural dressing over them: the Tusken **sail barge** (the Barge
 * Run's target, and the wreck Worm Sign starts beside) and the party's
 * **skiff**.
 *
 * Built rather than loaded because the Barge Run is fought *on* them: the
 * cargo deck, the stair, the upper deck, the helm and the rails all have to
 * be exactly where the colliders say. The `sail_barge` and `skiff` sculpts
 * the board already uses are wrecks and rides; neither carries a two-deck
 * fighting layout, so the stand-in is the look (rule 7 still holds — nothing
 * waits on a file).
 *
 * Local frame: the bow is +z, the port side (where the skiff comes
 * alongside) is −x, y = 0 is the sand. A hull can be laid at a quarter turn
 * (`yaw` of 0 or ±π/2): the colliders are axis-aligned, so they turn with it
 * exactly.
 */

/** the sail barge's numbers, local metres */
export const BARGE = {
  halfBeam: 6,
  halfLen: 20,
  /** hull bottom, riding over the sand on its repulsors */
  keel: 0.8,
  /** the cargo deck */
  lower: 4,
  /** the superstructure's roof, the upper deck, aft of `upperFore` */
  upper: 10,
  upperHalfBeam: 4.5,
  upperFore: -2,
  upperAft: -20,
  /** the stair from the cargo deck up to the upper deck: its foot's z and half-width */
  stairFoot: 5,
  stairHalf: 1.5,
  /** the two boarding points on the port rail: gaps in the bulwark, z centres */
  planks: [7.5, 14.5],
  plankHalf: 1.6,
  railH: 1.1,
  /** the heavy gun on the upper deck, and the helm aft */
  gun: new THREE.Vector3(1.6, 10, -7),
  helm: new THREE.Vector3(0, 10, -16.5),
  mast: new THREE.Vector3(0, 4, 11),
};

/** the skiff's numbers, local metres (its own frame: centre of the deck at x = z = 0) */
export const SKIFF = {
  halfBeam: 2.3,
  halfLen: 7,
  keel: 0.9,
  deck: 2,
  railH: 0.8,
  /** the deck gun, at the stern */
  gun: new THREE.Vector3(0, 2, -4.6),
};

export interface Hull {
  group: THREE.Group;
  /** every collider, world space */
  boxes: StaticBox[];
  /** local → world for a point on this hull */
  toWorld(v: THREE.Vector3): THREE.Vector3;
}

/** a quarter-turned, placed box builder for one hull */
function placer(ctx: SectionContext, origin: THREE.Vector3, yaw: number, solid: boolean) {
  const q = Math.round(yaw / (Math.PI / 2)) & 3;
  const turn = (x: number, z: number): [number, number] =>
    q === 0 ? [x, z] : q === 1 ? [z, -x] : q === 2 ? [-x, -z] : [-z, x];
  const boxes: StaticBox[] = [];
  const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): void => {
    if (!solid) return;
    const [x, z] = turn(cx, cz);
    const [w, d] = q % 2 ? [sz, sx] : [sx, sz];
    boxes.push(ctx.box(origin.x + x, origin.y + cy, origin.z + z, w, sy, d, null).box);
  };
  const toWorld = (v: THREE.Vector3): THREE.Vector3 => {
    const [x, z] = turn(v.x, v.z);
    return new THREE.Vector3(origin.x + x, origin.y + v.y, origin.z + z);
  };
  return { box, boxes, toWorld };
}

/** shared dressing materials, made once per section */
function hullMats(ctx: SectionContext) {
  const hull = ctx.paint(0x9a7a56, { rough: 0.75, metal: 0.25 });
  ctx.tile(hull, 'rust_hull', 4, 1);
  const deck = ctx.paint(0x8a6a44, { rough: 0.9 });
  ctx.tile(deck, 'dock_planks', 3, 8);
  const trim = ctx.paint(0x5a4834, { rough: 0.6, metal: 0.4 });
  const sail = ctx.paint(0x9a4a2c, { rough: 1 });
  ctx.tile(sail, 'tent_cloth', 2, 2);
  sail.side = THREE.DoubleSide;
  const crate = ctx.paint(0x7a6246, { rough: 0.85 });
  ctx.tile(crate, 'crate_side', 1, 1);
  return { hull, deck, trim, sail, crate };
}

/**
 * The sail barge. `solid` stands its colliders (the Barge Run fights on it;
 * Worm Sign only needs its hull to be an edge). `sails` 0..1 is how full the
 * canvas is — slack on a wreck.
 */
export function buildBarge(ctx: SectionContext, origin: THREE.Vector3, opts: {
  yaw?: number; solid?: boolean; sails?: number; list?: number;
} = {}): Hull & { cargo: THREE.Vector3[] } {
  const yaw = opts.yaw ?? 0;
  const { box, boxes, toWorld } = placer(ctx, origin, yaw, opts.solid ?? true);
  const m = hullMats(ctx);
  const B = BARGE;
  const g = new THREE.Group();
  g.position.copy(origin);
  g.rotation.set(0, yaw, opts.list ?? 0);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    ctx.own(geo);
    return mesh;
  };
  const slab = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, solid = true): void => {
    add(new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z);
    if (solid) box(x, y, z, sx, sy, sz);
  };

  // ---- the hull and the cargo deck ----
  const hullH = B.lower - B.keel;
  slab(0, B.keel + hullH / 2 - 0.3, 0, B.halfBeam * 2, hullH - 0.6, B.halfLen * 2, m.hull);
  slab(0, B.lower - 0.3, 0, B.halfBeam * 2, 0.6, B.halfLen * 2, m.deck);
  // the prow: a tapered wedge past the bow, and its collider a narrower block
  {
    const shape = new THREE.Shape();
    shape.moveTo(-B.halfBeam, 0);
    shape.lineTo(B.halfBeam, 0);
    shape.lineTo(0, 6);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: hullH, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const prow = add(geo, m.hull, 0, B.keel, B.halfLen);
    prow.position.y = B.keel;
    box(0, B.keel + hullH / 2, B.halfLen + 1.5, B.halfBeam, hullH, 3);
  }
  // the repulsor glow under the keel, and the stern's engine housings
  for (const sx of [-1, 1]) slab(sx * 3.5, B.keel + 1.3, -B.halfLen - 0.8, 2.4, 2.6, 1.6, m.trim, false);

  // ---- the bulwarks: rails round the cargo deck, with the two boarding gaps ----
  const railY = B.lower + B.railH / 2;
  const railRun = (x: number, z0: number, z1: number): void => {
    if (z1 - z0 < 0.2) return;
    slab(x, railY, (z0 + z1) / 2, 0.3, B.railH, z1 - z0, m.trim);
  };
  {
    // starboard: whole; port: cut at the planks
    railRun(B.halfBeam - 0.15, -B.halfLen, B.halfLen);
    let z = -B.halfLen;
    for (const pz of B.planks) { railRun(-B.halfBeam + 0.15, z, pz - B.plankHalf); z = pz + B.plankHalf; }
    railRun(-B.halfBeam + 0.15, z, B.halfLen);
    slab(0, railY, B.halfLen - 0.15, B.halfBeam * 2, B.railH, 0.3, m.trim);
  }

  // ---- the superstructure: the upper deck's block, and its rails ----
  const supH = B.upper - B.lower;
  const supLen = B.upperFore - B.upperAft;
  const supZ = (B.upperFore + B.upperAft) / 2;
  slab(0, B.lower + supH / 2, supZ, B.upperHalfBeam * 2, supH, supLen, m.hull);
  slab(0, B.upper - 0.2, supZ, B.upperHalfBeam * 2 + 0.4, 0.4, supLen + 0.4, m.deck, false);
  // portholes along the block's sides
  const glass = new THREE.MeshBasicMaterial({ color: 0x3a2a1a });
  ctx.own(glass);
  for (let z = B.upperAft + 2; z < B.upperFore - 1; z += 3) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), glass);
      w.position.set(sx * (B.upperHalfBeam + 0.02), B.lower + 3.5, z);
      w.rotation.y = sx * Math.PI / 2;
      g.add(w);
    }
  }
  const uRailY = B.upper + B.railH / 2;
  for (const sx of [-1, 1]) slab(sx * (B.upperHalfBeam - 0.15), uRailY, supZ, 0.3, B.railH, supLen, m.trim);
  slab(0, uRailY, B.upperAft + 0.15, B.upperHalfBeam * 2, B.railH, 0.3, m.trim);
  // the fore rail, with the stair head's gap in it
  for (const sx of [-1, 1]) {
    const w = B.upperHalfBeam - B.stairHalf;
    slab(sx * (B.stairHalf + w / 2), uRailY, B.upperFore - 0.15, w, B.railH, 0.3, m.trim);
  }

  // ---- the stair: the cargo deck up to the upper deck ----
  {
    const steps = 12;
    const run = (B.stairFoot - B.upperFore) / steps;
    for (let k = 0; k < steps; k++) {
      const top = B.lower + ((k + 1) / steps) * supH;
      const zFront = B.stairFoot - run * k;
      const len = zFront - B.upperFore + 0.05;
      slab(0, (B.lower + top) / 2, zFront - len / 2, B.stairHalf * 2, top - B.lower, len, m.deck);
    }
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, Math.hypot(B.stairFoot - B.upperFore, supH)), m.trim);
      ctx.own(rail.geometry);
      rail.position.set(sx * (B.stairHalf + 0.05), (B.lower + B.upper) / 2 + 1, (B.stairFoot + B.upperFore) / 2);
      rail.rotation.x = Math.atan2(supH, B.stairFoot - B.upperFore);
      g.add(rail);
    }
  }

  // ---- the helm: a console on the upper deck's aft end ----
  slab(B.helm.x, B.upper + 0.6, B.helm.z - 1.6, 2.4, 1.2, 0.8, m.trim);
  {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 14), m.trim);
    ctx.own(wheel.geometry);
    wheel.position.set(B.helm.x, B.upper + 1.5, B.helm.z - 1.1);
    g.add(wheel);
  }

  // ---- the mast, the yards and the sails ----
  {
    const h = 24;
    add(new THREE.CylinderGeometry(0.3, 0.45, h, 8), m.trim, B.mast.x, B.lower + h / 2, B.mast.z);
    box(B.mast.x, B.lower + h / 2, B.mast.z, 0.8, h, 0.8);
    const full = opts.sails ?? 1;
    // rigged fore-and-aft, the canvas along the hull: broadside on, the whole
    // spread of red cloth is what you see
    for (const [y, w, hh] of [[B.lower + 21, 14, 7], [B.lower + 12.5, 18, 8]] as const) {
      add(new THREE.CylinderGeometry(0.15, 0.15, w + 1, 6), m.trim, 0, y + hh / 2, B.mast.z - w / 2 + 1).rotation.x = Math.PI / 2;
      // a sail bellies forward when full, hangs when slack
      const geo = new THREE.PlaneGeometry(w, hh, 8, 6);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i) / (w / 2), v = pos.getY(i) / (hh / 2);
        pos.setZ(i, (1 - u * u) * (1 - v * v * 0.3) * 1.8 * full + (1 - full) * (v < 0 ? v * 0.6 : 0));
      }
      geo.computeVertexNormals();
      const sailMesh = add(geo, m.sail, 0.3, y, B.mast.z - w / 2 + 1);
      sailMesh.rotation.y = Math.PI / 2;
    }
  }

  // ---- cargo racks on the cargo deck: cover for the fight there ----
  const cargo: THREE.Vector3[] = [];
  for (const [x, z, n] of [[3.4, 17.2, 2], [-3.2, 11.5, 1], [3.6, 5.2, 2], [-3.4, 18, 2], [3.2, 1.2, 1]] as const) {
    for (let k = 0; k < n; k++) {
      slab(x, B.lower + 0.6 + k * 1.2, z, 1.8, 1.2, 1.8, m.crate);
    }
    cargo.push(toWorld(new THREE.Vector3(x, B.lower, z)));
  }

  ctx.mesh(g);
  return { group: g, boxes, toWorld, cargo };
}

/**
 * The barge after the Barge Run: aground on a sandbank, listing, sails slack.
 * Laid across the south end of Worm Sign's field, bow to the east.
 */
export function buildGroundedBarge(ctx: SectionContext, origin: THREE.Vector3, list: number): Hull {
  const hull = buildBarge(ctx, origin, { yaw: Math.PI / 2, sails: 0.1, list });
  // ploughed in: the keel is under the sand, not over it
  hull.group.position.y -= 0.6;
  return hull;
}

/**
 * The skiff: a fourteen-metre open deck with low rails and the deck gun at
 * the stern. Built about its own centre (the group's position is the deck's
 * middle at y = 0), so a `Mover` can carry it by moving the group.
 */
export function buildSkiff(ctx: SectionContext, origin: THREE.Vector3,
  opts: { gaps?: number[]; gapHalf?: number } = {}): Hull & { envelope: StaticBox } {
  const { box, boxes, toWorld } = placer(ctx, origin, 0, true);
  const m = hullMats(ctx);
  const S = SKIFF;
  const g = new THREE.Group();
  g.position.copy(origin);
  const add = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number, solid = true): void => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    ctx.own(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    if (solid) box(x, y, z, sx, sy, sz);
  };
  // the envelope first: the deck a rider stands on (a Mover carries the rest with it)
  add(S.halfBeam * 2, S.deck - S.keel, S.halfLen * 2, m.hull, 0, (S.deck + S.keel) / 2, 0);
  const envelope = boxes[0];
  const deckGeo = new THREE.BoxGeometry(S.halfBeam * 2 - 0.2, 0.05, S.halfLen * 2 - 0.2);
  ctx.own(deckGeo);
  const deck = new THREE.Mesh(deckGeo, m.deck);
  deck.position.set(0, S.deck + 0.02, 0);
  g.add(deck);
  // the bow, a wedge, and the rails: low, so a jump clears them
  add(S.halfBeam * 1.2, S.deck - S.keel, 2, m.hull, 0, (S.deck + S.keel) / 2, S.halfLen + 1);
  // the rails, cut for a gangway amidships on the port side (where it ties up
  // at a landing) and, on the starboard side, where boarding planks come down
  const rail = (x: number, gaps: number[], half: number): void => {
    let z0 = -S.halfLen;
    for (const gz of [...gaps].sort((a, b) => a - b)) {
      if (gz - half > z0) add(0.2, S.railH, gz - half - z0, m.trim, x, S.deck + S.railH / 2, (z0 + gz - half) / 2);
      z0 = gz + half;
    }
    if (S.halfLen > z0) add(0.2, S.railH, S.halfLen - z0, m.trim, x, S.deck + S.railH / 2, (z0 + S.halfLen) / 2);
  };
  rail(-(S.halfBeam - 0.1), [0], 1.5);
  rail(S.halfBeam - 0.1, opts.gaps ?? [], opts.gapHalf ?? 1.6);
  add(S.halfBeam * 2, S.railH, 0.2, m.trim, 0, S.deck + S.railH / 2, -S.halfLen + 0.1);
  // the engines astern and the repulsor vanes under it
  for (const sx of [-1, 1]) add(0.9, 0.9, 1.6, m.trim, sx * 1.4, S.deck - 0.4, -S.halfLen - 0.8, false);
  ctx.mesh(g);
  return { group: g, boxes, toWorld, envelope };
}
