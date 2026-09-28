import * as THREE from 'three';
import { TEXT } from '../text';
import { audio } from '../core/audio';
import { damp } from '../core/math';
import { addBreakable, type Breakable } from '../world/board';
import type { StaticBox } from '../core/physics';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import { composeMoves } from './kit/moves';
import { deckTilt } from './kit/locomotion';

/**
 * The Squall (docs/LEVEL_SECTIONS.md §2.9) — the Storm Docks, between the
 * trawler deck and Run the Pier.
 *
 * The trawler the party fought over at the quay casts off with them aboard,
 * and the crossing to the far pier is made in a squall: the deck heeling
 * under them, green water coming over the rail, quarren hauling themselves
 * up out of the sea, and the net boom swinging loose across the stern.
 *
 * **The verb is holding a deck that will not hold still.** Three things move
 * it, each with its own tell:
 *
 *  - **the roll** (K7 `deckTilt`): ±6–10° on the swell, a drift toward the
 *    low side on every body — players, quarren, loose fuel barrels. On your
 *    feet it is a lean; in the air it is a slide;
 *  - **rogue waves**: five seconds of warning (the wheelhouse horn, the sea
 *    standing up on one side, the deck starting to heel), then green water
 *    sweeps the deck toward the far rail. Anyone braced (the cover button at
 *    a rail, a winch, a crate or the deckhouse wall), up on the deckhouse
 *    roof or in the air holds; anyone in the deckhouse's lee is sheltered;
 *    anyone else is carried, and whoever reaches the far rail goes over it —
 *    hostiles too, which makes a wave a weapon;
 *  - **the net boom** (from the second wave): it breaks its lashing and
 *    swings with the roll across the after deck, knocking flat whoever is in
 *    its arc as it goes by;
 *
 * and **lightning** (from the second wave) strikes the mast after a crackle
 * down the rigging, and whoever is on the deckhouse roof then — the high
 * ground, the one place the sea cannot reach — takes it.
 *
 * Three waves of boarders, each longer and wider than the last (up the stern
 * ramp; over both rails with a dropship pass; everything at once with fliers
 * in the storm's peak), then the far pier comes out of the rain and the
 * trawler comes alongside. The starboard gate swings open onto it, and
 * stepping ashore carries the party on to Run the Pier.
 *
 * **Nothing solid moves.** The trawler is a static deck in physics (K2's
 * rule): the sea, the swell, the quay behind and the pier ahead are what
 * move, and the hull only *rolls in the picture* (`DeckTilt`). Going over
 * the side is the harbour's existing beat — "the water took you" — and the
 * party re-forms on the deckhouse roof.
 */

// ---- the trawler, in deck-local metres (x across, +z toward the bow) ----
/** half the beam */
const HB = 7;
const STERN = -18;
/** the working deck ends at the forecastle's front bulkhead */
const FOC = 12;
const FOC_H = 2.4;
const RAIL_H = 1.1;
const RAIL_T = 0.3;
/** deck to sea */
const FREEBOARD = 2.4;
/** the keel line the hull rolls about, below the deck */
const PIVOT_DROP = 1.5;
/** the deckhouse: cover, the lee, and its roof is the high ground */
const HOUSE = { x: 3, z0: -4.5, z1: 4.5, h: 3 };
/** the wheelhouse on its roof, forward */
const WHEEL = { x: 2.2, z0: 1.2, z1: 4.5, h: 2.4 };
/** the mast stands out of the wheelhouse roof */
const MAST = { x: 0, z: 3, top: 15 };
/** the king post the net boom swings from, just abaft the deckhouse */
const KING = { x: 0, z: -5.6 };
const BOOM_LEN = 8;
/** the boom's height over the deck: chest to head on anyone standing */
const BOOM_Y = 1.7;
/** how far either side of dead aft the boom can swing before its stays stop it */
const BOOM_MAX = 1.3;
/** the port gangway gate the party came aboard by, and the starboard one they leave by */
const GATE_IN = { z0: -10, z1: -7 };
const GATE_OUT = { z0: 5, z1: 8 };
/** the stern ramp's gap in the stern rail */
const RAMP_HALF = 2.2;
/** the winches, forward on both rails */
const WINCH_Z = 10;
/** the far pier, alongside to starboard once docked */
const PIER = { x0: HB + 0.4, x1: HB + 10.4 };

// ---- the storm ----
/** metres per second the trawler makes through the water */
const SPEED = 7;
/** the swell's roll amplitude per wave (degrees), and its period */
const SWELL_DEG = [6, 8, 10];
const SWELL_PERIOD = 7.2;
/** the drift's strength, as a multiple of gravity (see DeckTilt) */
const TILT_GAIN = 1.6;
/** rogue waves: the telegraph, the green water crossing, the push after, the ease */
const TELEGRAPH = 5;
const SWEEP = 1.4;
const SURGE = 1.1;
const DRAIN = 1.6;
/** the heel a rogue wave puts on the deck (degrees) */
const ROGUE_DEG = 20;
/** how fast green water carries an unbraced body toward the far rail (m/s) */
const WASH = 12;
/** the first rogue wave, seconds into the section, and the gap between them by party size */
const ROGUE_FIRST = 24;
const ROGUE_EVERY = [50, 42, 38, 36];
/** lightning: the crackle's warning and the gap between strikes */
const CRACKLE = 2;
const STRIKE_DMG = 42;
/** a breather between waves of boarders, and the far pier's approach */
const BREATHER = 7;
const APPROACH = 14;
/** the boom hits for this, and knocks the struck back this hard */
const BOOM_DMG = 16;

type Entry = 'stern' | 'port' | 'starboard' | 'rails' | 'drop' | 'air';
interface Group { at: number; entry: Entry; n: number }
interface WaveDef { min: number; groups: Group[] }

type RoguePhase = 'idle' | 'telegraph' | 'sweep' | 'surge' | 'drain';
type Phase = 'intro' | 'wave' | 'breather' | 'approach' | 'docked';

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const Y0 = ctx.floorY;
  const SEA_Y = Y0 - FREEBOARD;
  const PIVOT_Y = Y0 - PIVOT_DROP;
  const T = TEXT.sections.squall;
  const party = Math.max(1, game.players.length);

  // ---- materials ----
  const hullMat = ctx.paint(0x5a6a64, { rough: 0.65, metal: 0.45 });
  ctx.tile(hullMat, 'rust_hull', 6, 1.2);
  const deckMat = ctx.paint(0x7a8086, { rough: 0.55, metal: 0.4 });
  ctx.tile(deckMat, 'metal_deck', 4, 9);
  const plateMat = ctx.paint(0x8f9a94, { rough: 0.6, metal: 0.35 });
  ctx.tile(plateMat, 'metal_hull', 2, 1);
  const houseMat = ctx.paint(0xc4c8bc, { rough: 0.7, metal: 0.25 });
  ctx.tile(houseMat, 'hull_plate_large', 1.5, 1);
  const darkMat = ctx.paint(0x2a2d31, { rough: 0.5, metal: 0.6 });
  const rustMat = ctx.paint(0x7a3a24, { rough: 0.7, metal: 0.3 });
  const ropeMat = ctx.paint(0x8a7650, { rough: 0.95, metal: 0 });
  const netMat = ctx.paint(0x3f5c52, { rough: 0.95, metal: 0 });
  ctx.tile(netMat, 'net_weave', 2, 2);
  const stoneMat = ctx.paint(0x4f5c60, { rough: 0.95, metal: 0.05 });
  const plankMat = ctx.paint(0x685843, { rough: 0.9, metal: 0.05 });
  ctx.tile(plankMat, 'dock_planks', 2, 8);
  const shedMat = ctx.paint(0x3e4a52, { rough: 0.8, metal: 0.3 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd28a });
  const hazardMat = new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const redLamp = new THREE.MeshBasicMaterial({ color: 0xff4a3a });
  const greenLamp = new THREE.MeshBasicMaterial({ color: 0x5aff8a });
  for (const m of [glowMat, hazardMat, redLamp, greenLamp]) ctx.own(m);

  // ---- the hull group: everything that rolls ----
  const ship = new THREE.Group();
  ship.name = 'squall-trawler';
  ship.position.set(0, PIVOT_Y, 0);
  ctx.mesh(ship);
  const unit = new THREE.BoxGeometry(1, 1, 1);
  ctx.own(unit);
  /** a mesh on the hull at deck-world coordinates */
  const onHull = <O extends THREE.Object3D>(o: O, x: number, y: number, z: number): O => {
    o.position.set(x, y - PIVOT_Y, z);
    o.traverse((c) => { c.castShadow = c.receiveShadow = true; });
    ship.add(o);
    return o;
  };
  const block = (x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(unit, m);
    mesh.scale.set(sx, sy, sz);
    return onHull(mesh, x, y, z);
  };
  /** a collider and its mesh on the hull (the collider stays level; the mesh rolls) */
  const solid = (x: number, y: number, z: number, sx: number, sy: number, sz: number, m: THREE.Material | null): { box: StaticBox; mesh: THREE.Mesh | null } => {
    const { box } = ctx.box(x, y, z, sx, sy, sz, null);
    return { box, mesh: m ? block(x, y, z, sx, sy, sz, m) : null };
  };
  /** move a prop's holder (placed by ctx.prop under the section group) onto the hull */
  const hullProp = (holder: THREE.Object3D): THREE.Object3D => {
    let top: THREE.Object3D = holder;
    while (top.parent && top.parent !== ctx.group) top = top.parent;
    ship.attach(top);
    return top;
  };

  // the deck, the forecastle and the hull under them
  solid(0, Y0 - 0.5, (STERN + FOC) / 2, HB * 2, 1, FOC - STERN, deckMat);
  // forecastle collider in three steps, each inside the tapered bow above it
  for (const [z0, z1, hw] of [[FOC, 14, HB], [14, 16, 5], [16, 18, 2.5]] as const) {
    ctx.box(0, Y0 + FOC_H / 2, (z0 + z1) / 2, hw * 2, FOC_H, z1 - z0, null);
  }
  const outline = (pts: [number, number][]): THREE.Shape => {
    const s = new THREE.Shape();
    pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
    s.closePath();
    return s;
  };
  const bowPts: [number, number][] = [[HB, 14], [5, 16], [2.5, 18], [0, 19.2], [-2.5, 18], [-5, 16], [-HB, 14]];
  const hullShape = outline([[-HB, STERN], [HB, STERN], [HB, FOC], ...bowPts]);
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 6, bevelEnabled: false });
  hullGeo.rotateX(-Math.PI / 2);
  ctx.own(hullGeo);
  onHull(new THREE.Mesh(hullGeo, [darkMat, hullMat]), 0, Y0 - 6.02, 0);
  const focShape = outline([[-HB, FOC], [HB, FOC], ...bowPts]);
  const focGeo = new THREE.ExtrudeGeometry(focShape, { depth: FOC_H, bevelEnabled: false });
  focGeo.rotateX(-Math.PI / 2);
  ctx.own(focGeo);
  onHull(new THREE.Mesh(focGeo, [deckMat, hullMat]), 0, Y0, 0);
  // a boot-top stripe and a rubbing strake along the sheer, so the hull reads at sea
  block(-HB - 0.05, Y0 - 0.35, (STERN + FOC) / 2, 0.12, 0.25, FOC - STERN, rustMat);
  block(HB + 0.05, Y0 - 0.35, (STERN + FOC) / 2, 0.12, 0.25, FOC - STERN, rustMat);

  // ---- bulwarks: the rails are the edge, and chest-high cover to brace on ----
  const railY = Y0 + RAIL_H / 2;
  const rx = HB - RAIL_T / 2;
  const rail = (x: number, z0: number, z1: number) => solid(x, railY, (z0 + z1) / 2, RAIL_T, RAIL_H, z1 - z0, hullMat);
  const cap = (x: number, z: number, sx: number, sz: number): void => { block(x, Y0 + RAIL_H + 0.05, z, sx, 0.1, sz, darkMat); };
  rail(-rx, STERN, FOC);
  cap(-rx, (STERN + FOC) / 2, RAIL_T + 0.12, FOC - STERN);
  rail(rx, STERN, GATE_OUT.z0);
  cap(rx, (STERN + GATE_OUT.z0) / 2, RAIL_T + 0.12, GATE_OUT.z0 - STERN);
  rail(rx, GATE_OUT.z1, FOC);
  cap(rx, (GATE_OUT.z1 + FOC) / 2, RAIL_T + 0.12, FOC - GATE_OUT.z1);
  // the starboard gangway gate: shut until the far pier is alongside
  const gateOut = ctx.box(rx, railY, (GATE_OUT.z0 + GATE_OUT.z1) / 2, RAIL_T, RAIL_H, GATE_OUT.z1 - GATE_OUT.z0, null).box;
  const gateLeaf = new THREE.Group();
  const leafLen = GATE_OUT.z1 - GATE_OUT.z0;
  const leaf = new THREE.Mesh(unit, hullMat);
  leaf.scale.set(RAIL_T, RAIL_H, leafLen);
  leaf.position.set(0, 0, -leafLen / 2);
  gateLeaf.add(leaf);
  const leafLamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), greenLamp);
  leafLamp.position.set(0.1, RAIL_H / 2 + 0.15, -0.2);
  gateLeaf.add(leafLamp);
  onHull(gateLeaf, rx, railY, GATE_OUT.z1);   // hinged at its forward end
  // the port gate the party came aboard by is shut and dogged: a painted frame in the rail
  block(-rx - 0.02, railY, (GATE_IN.z0 + GATE_IN.z1) / 2, RAIL_T + 0.06, RAIL_H + 0.04, 0.12, darkMat).position.z = GATE_IN.z0;
  block(-rx - 0.02, railY, GATE_IN.z1, RAIL_T + 0.06, RAIL_H + 0.04, 0.12, darkMat);
  // the stern rail, either side of the ramp
  const sternZ = STERN + RAIL_T / 2;
  for (const s of [-1, 1]) {
    const w = HB - RAMP_HALF;
    solid(s * (RAMP_HALF + w / 2), railY, sternZ, w, RAIL_H, RAIL_T, hullMat);
    cap(s * (RAMP_HALF + w / 2), sternZ, w, RAIL_T + 0.12);
    // the ramp's side cheeks
    block(s * (RAMP_HALF + 0.1), Y0 - 0.9, STERN - 2, 0.2, 1.4, 4, hullMat);
  }
  // fenders hung over the side: old tyres on chains
  const tyreGeo = new THREE.TorusGeometry(0.35, 0.14, 6, 12);
  ctx.own(tyreGeo);
  for (const s of [-1, 1]) {
    for (const z of [-14, -8, -2, 4, 9]) {
      const t = new THREE.Mesh(tyreGeo, darkMat);
      t.rotation.y = Math.PI / 2;
      onHull(t, s * (HB + 0.2), Y0 - 0.5, z);
    }
  }

  // the stern ramp: stepped down to the water, where the quarren haul out
  const RAMP_STEPS = 5;
  for (let i = 0; i < RAMP_STEPS; i++) {
    const top = Y0 - 0.4 * (i + 1);
    const z = STERN - 0.35 - i * 0.7;
    ctx.box(0, top - 0.5, z, RAMP_HALF * 2, 1, 0.7, null);
  }
  {
    const len = Math.hypot(RAMP_STEPS * 0.7 + 0.6, FREEBOARD);
    const ramp = new THREE.Mesh(unit, deckMat);
    ramp.scale.set(RAMP_HALF * 2, 0.2, len);
    ramp.rotation.x = -Math.atan2(FREEBOARD, RAMP_STEPS * 0.7 + 0.6);
    onHull(ramp, 0, Y0 - FREEBOARD / 2 - 0.15, STERN - (RAMP_STEPS * 0.7 + 0.6) / 2);
  }

  // ---- the deckhouse and the wheelhouse on it ----
  solid(0, Y0 + HOUSE.h / 2, (HOUSE.z0 + HOUSE.z1) / 2, HOUSE.x * 2, HOUSE.h, HOUSE.z1 - HOUSE.z0, houseMat);
  solid(0, Y0 + HOUSE.h + WHEEL.h / 2, (WHEEL.z0 + WHEEL.z1) / 2, WHEEL.x * 2, WHEEL.h, WHEEL.z1 - WHEEL.z0, houseMat);
  // the roof: a lip of darker plate and a ladder up the after face
  block(0, Y0 + HOUSE.h + 0.04, (HOUSE.z0 + HOUSE.z1) / 2, HOUSE.x * 2 + 0.2, 0.08, HOUSE.z1 - HOUSE.z0 + 0.2, darkMat);
  for (let i = 0; i < 6; i++) block(1.8, Y0 + 0.4 + i * 0.45, HOUSE.z0 - 0.12, 0.7, 0.06, 0.06, darkMat);
  for (const s of [-1, 1]) block(1.8 + s * 0.35, Y0 + 1.5, HOUSE.z0 - 0.12, 0.06, 3, 0.06, darkMat);
  // lit windows, all round: the deckhouse is the one warm thing on the sea
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1a120a, emissive: 0xffa850, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1 });
  ctx.own(winMat);
  const win = (x: number, y: number, z: number, w: number, h: number, alongZ: boolean): void => {
    const frame = new THREE.Mesh(unit, darkMat);
    frame.scale.set(alongZ ? 0.06 : w + 0.16, h + 0.16, alongZ ? w + 0.16 : 0.06);
    onHull(frame, x, y, z);
    const m = new THREE.Mesh(unit, winMat);
    m.scale.set(alongZ ? 0.08 : w, h, alongZ ? w : 0.08);
    onHull(m, x, y, z);
  };
  for (const s of [-1, 1]) {
    for (const z of [-2.8, -0.6, 1.6, 3.4]) win(s * (HOUSE.x + 0.01), Y0 + 1.9, z, 0.8, 0.55, true);
    for (const z of [1.9, 3.3]) win(s * (WHEEL.x + 0.01), Y0 + HOUSE.h + 1.55, z, 1, 0.8, true);
  }
  for (const x of [-1.4, 0, 1.4]) win(x, Y0 + HOUSE.h + 1.55, WHEEL.z1 + 0.01, 1.1, 0.8, false);
  block(-1.2, Y0 + 1.05, HOUSE.z0 - 0.03, 1, 2.1, 0.06, darkMat);   // the after door
  const houseLight = new THREE.PointLight(0xffc98a, 22, 18, 1.6);
  onHull(houseLight, 0, Y0 + 2.2, HOUSE.z0 - 1.5);

  // ---- the mast: crosstree, work lights, stays, and the lightning rod ----
  const mastBase = Y0 + HOUSE.h + WHEEL.h;
  const mastH = Y0 + MAST.top - mastBase;
  ctx.cyl(MAST.x, mastBase + mastH / 2, MAST.z, 0.22, mastH, null);
  const mastMat = ctx.paint(0x3a3f44, { rough: 0.5, metal: 0.7, emissive: 0x000000 });
  const mastMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, mastH, 8), mastMat);
  onHull(mastMesh, MAST.x, mastBase + mastH / 2, MAST.z);
  block(MAST.x, Y0 + 11.2, MAST.z, 4.2, 0.18, 0.18, mastMat);
  const floods: THREE.PointLight[] = [];
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glowMat);
    onHull(lamp, s * 1.9, Y0 + 11, MAST.z);
    const l = new THREE.PointLight(0xffd8a0, 55, 34, 1.4);
    onHull(l, s * 1.9, Y0 + 10.6, MAST.z - 1);
    floods.push(l);
  }
  const rodTop = new THREE.Vector3(MAST.x, Y0 + MAST.top + 0.8, MAST.z);
  block(MAST.x, Y0 + MAST.top + 0.4, MAST.z, 0.05, 0.8, 0.05, darkMat);
  const lampTop = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), redLamp);
  onHull(lampTop, MAST.x, Y0 + MAST.top + 0.05, MAST.z);
  // stays and shrouds: thin lines from the crosstree and the masthead to the rails
  const stayPts: number[] = [];
  const stay = (a: THREE.Vector3, b: THREE.Vector3): void => { stayPts.push(a.x, a.y - PIVOT_Y, a.z, b.x, b.y - PIVOT_Y, b.z); };
  for (const s of [-1, 1]) {
    stay(new THREE.Vector3(s * 2.1, Y0 + 11.2, MAST.z), new THREE.Vector3(s * (HB - 0.2), Y0 + RAIL_H, MAST.z + 1));
    stay(new THREE.Vector3(s * 2.1, Y0 + 11.2, MAST.z), new THREE.Vector3(s * (HB - 0.2), Y0 + RAIL_H, MAST.z - 6));
    stay(new THREE.Vector3(0, Y0 + MAST.top, MAST.z), new THREE.Vector3(s * 2.4, Y0 + FOC_H, 17));
  }
  stay(new THREE.Vector3(0, Y0 + MAST.top - 1, MAST.z), new THREE.Vector3(0, Y0 + 5.2, KING.z));
  const stayGeo = new THREE.BufferGeometry();
  stayGeo.setAttribute('position', new THREE.Float32BufferAttribute(stayPts, 3));
  const stayMat = new THREE.LineBasicMaterial({ color: 0x1e2226 });
  ctx.own(stayMat);
  const stays = new THREE.LineSegments(stayGeo, stayMat);
  ship.add(stays);

  // ---- the net boom on its king post ----
  ctx.cyl(KING.x, Y0 + 2.6, KING.z, 0.3, 5.2, null);
  const kingMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 5.2, 10), rustMat);
  onHull(kingMesh, KING.x, Y0 + 2.6, KING.z);
  const boom = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, BOOM_LEN, 8), rustMat);
  arm.rotation.x = Math.PI / 2;
  arm.position.z = -BOOM_LEN / 2;
  boom.add(arm);
  // the net, balled up along the outer half and hanging in a sagging drape
  const netBall = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), netMat);
  netBall.scale.set(0.8, 0.7, 1.6);
  netBall.position.set(0, -0.35, -BOOM_LEN + 1.4);
  boom.add(netBall);
  const drape = new THREE.Mesh(new THREE.PlaneGeometry(BOOM_LEN * 0.55, 1.2, 6, 2), netMat);
  drape.rotation.y = Math.PI / 2;
  drape.position.set(0, -0.55, -BOOM_LEN * 0.55);
  boom.add(drape);
  onHull(boom, KING.x, Y0 + BOOM_Y, KING.z);
  // the topping lift from the masthead to the boom's tip, re-laid every frame
  const liftGeo = new THREE.BufferGeometry();
  liftGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const lift = new THREE.Line(liftGeo, stayMat);
  ship.add(lift);
  // its arc, painted on the deck once it is loose
  const arcGeo = new THREE.RingGeometry(0.8, BOOM_LEN + 0.3, 40, 1, 0, BOOM_MAX * 2);
  const arc = new THREE.Mesh(arcGeo, hazardMat);
  arc.rotation.x = -Math.PI / 2;
  // the ring's sector starts at +x in its own plane; turn it to sweep across dead aft
  arc.rotation.z = -Math.PI / 2 - BOOM_MAX;
  arc.visible = false;
  onHull(arc, KING.x, Y0 + 0.03, KING.z);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  ctx.own(rimMat);
  const rim = new THREE.Mesh(new THREE.RingGeometry(BOOM_LEN - 0.1, BOOM_LEN + 0.3, 40, 1, 0, BOOM_MAX * 2), rimMat);
  rim.rotation.copy(arc.rotation);
  arc.add(rim);
  rim.rotation.set(0, 0, 0);
  rim.position.z = 0.01;

  // ---- deck gear: the trawl drum, the winches, the fish hold, crates ----
  const drum = (x: number, z: number, w: number): void => {
    solid(x, Y0 + 0.65, z, w, 1.3, 1.5, null);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, w - 0.4, 14), ropeMat);
    d.rotation.z = Math.PI / 2;
    onHull(d, x, Y0 + 0.7, z);
    for (const s of [-1, 1]) block(x + s * (w / 2 - 0.1), Y0 + 0.65, z, 0.2, 1.3, 1.5, darkMat);
  };
  drum(0, -10.5, 2.6);
  for (const s of [-1, 1]) drum(s * 5.1, WINCH_Z, 1.6);
  solid(0, Y0 + 0.52, 8.6, 3, 1.05, 2.6, plateMat);                    // the fish hold's coaming
  block(0, Y0 + 1.07, 8.6, 2.6, 0.06, 2.2, darkMat);
  const crateAt = [new THREE.Vector3(-5.5, Y0, -1), new THREE.Vector3(5.5, Y0, 1.6)];
  for (const at of crateAt) {
    solid(at.x, Y0 + 0.8, at.z, 1.6, 1.6, 1.6, null);
    const stand = (): THREE.Object3D => {
      const g = new THREE.Group();
      const c = new THREE.Mesh(unit, ctx.paint(0x5a6a3a, { rough: 0.8, metal: 0.3 }));
      c.scale.set(1.6, 1.6, 1.6);
      c.position.y = 0.8;
      g.add(c);
      return g;
    };
    hullProp(ctx.prop('cargo_crate', at, { size: 1.6, fallback: stand }));
  }
  // coils of rope and piled nets: dressing, low enough to walk through
  for (const [x, z, s] of [[-4.2, -15, 1], [4.6, -13.5, 0.8], [-3.6, 6.6, 0.7], [3.8, 11, 0.9]] as const) {
    const pile = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), netMat);
    pile.scale.set(1.1 * s, 0.35 * s, 0.9 * s);
    pile.userData.decor = true;
    onHull(pile, x, Y0 + 0.15, z);
  }

  // ---- the loose fuel barrels: they slide with the roll, and they explode ----
  interface Barrel { b: Breakable; box: StaticBox; holder: THREE.Object3D; home: THREE.Vector3; at: THREE.Vector3; vx: number; lost: boolean }
  const barrelHomes = [new THREE.Vector3(3.6, Y0, -14.5), new THREE.Vector3(-4.8, Y0, -5.2), new THREE.Vector3(4.6, Y0, 6.2), new THREE.Vector3(-2.4, Y0, 10.8)];
  const barrels: Barrel[] = barrelHomes.map((home) => {
    const { box } = ctx.box(home.x, Y0 + 0.7, home.z, 1, 1.4, 1, null);
    const stand = (): THREE.Object3D => {
      const g = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 1.4, 12), ctx.paint(0x7a3a24, { rough: 0.6, metal: 0.4, emissive: 0x200a04 }));
      c.position.y = 0.7;
      g.add(c);
      return g;
    };
    const holder = hullProp(ctx.prop('fuel_barrel', home, { size: 1.4, fallback: stand }));
    const b = addBreakable(game.board, holder, box, 30, { explosive: true });
    return { b, box, holder, home, at: home.clone(), vx: 0, lost: false };
  });
  const placeBarrel = (br: Barrel): void => {
    br.box.min.set(br.at.x - 0.5, Y0, br.at.z - 0.5);
    br.box.max.set(br.at.x + 0.5, Y0 + 1.4, br.at.z + 0.5);
    br.b.center.set(br.at.x, Y0 + 0.7, br.at.z);
    br.holder.position.set(br.at.x - br.home.x, 0, br.at.z - br.home.z);
  };
  const restockBarrels = (): void => {
    const phys = game.board.physics;
    for (const br of barrels) {
      if (!br.b.broken && !br.lost) continue;
      // lashed fresh from the forepeak store; never onto somebody
      const free = !game.players.some((p) => Math.hypot(p.position.x - br.home.x, p.position.z - br.home.z) < 1.6);
      if (!free) continue;
      br.at.copy(br.home);
      br.vx = 0;
      br.lost = false;
      br.b.broken = false;
      br.b.hp = br.b.maxHp;
      br.holder.visible = true;
      if (!phys.boxes.includes(br.box)) phys.boxes.push(br.box);
      placeBarrel(br);
    }
  };

  // ---- the sea: a heaving, scrolling plane all round ----
  const SEA_SIZE = 640;
  const SEA_SEG = 64;
  const seaGeo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, SEA_SEG, SEA_SEG);
  seaGeo.rotateX(-Math.PI / 2);
  ctx.own(seaGeo);
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1c333e, roughness: 0.32, metalness: 0.15 });
  ctx.own(seaMat);
  ctx.tile(seaMat, 'sea_surface', 26, 26, { normal: true });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.set(0, SEA_Y, 0);
  sea.receiveShadow = true;
  ctx.mesh(sea);
  const seaPos = seaGeo.attributes.position as THREE.BufferAttribute;
  const seaNorm = seaGeo.attributes.normal as THREE.BufferAttribute;
  // wake: a pale churn astern and a bow wave, both riding the hull line
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xd8e8e4, transparent: true, opacity: 0.35, depthWrite: false, vertexColors: true });
  ctx.own(foamMat);
  const wakeGeo = new THREE.PlaneGeometry(9, 40, 6, 10);
  {
    // bright under the counter, spreading and fading astern, soft at its edges
    const pos = wakeGeo.attributes.position as THREE.BufferAttribute;
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const along = (pos.getY(i) + 20) / 40;          // 0 at the stern, 1 far astern (local +y is world -z)
      pos.setX(i, pos.getX(i) * (0.5 + along * 1.4));
      const edge = 1 - Math.abs(pos.getX(i)) / (4.5 * (0.5 + along * 1.4));
      const a = Math.max(0, (1 - along) * Math.min(1, edge * 2));
      col.push(1, 1, 1, a);
    }
    wakeGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  }
  ctx.own(wakeGeo);
  const wake = new THREE.Mesh(wakeGeo, foamMat);
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, SEA_Y + 0.35, STERN - 20);
  ctx.mesh(wake);

  // ---- the rogue wave: a wall of water, then green water across the deck ----
  const WALL_H = 20;
  const wallGeo = new THREE.PlaneGeometry(150, WALL_H, 40, 12);
  wallGeo.translate(0, WALL_H / 2, 0);
  {
    // curl the top forward into a lip, ragged along its length, and fade in
    // foam toward the crest
    const pos = wallGeo.attributes.position as THREE.BufferAttribute;
    const col: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / WALL_H;
      const x = pos.getX(i);
      const rag = 1 + 0.12 * Math.sin(x * 0.09) + 0.05 * Math.sin(x * 0.23 + 1.3);
      pos.setY(i, pos.getY(i) * rag);
      pos.setZ(i, t * t * t * 8 * rag);
      const c = new THREE.Color(0x163a3c).lerp(new THREE.Color(0x3f7a72), t).lerp(new THREE.Color(0xe8f4f0), Math.max(0, (t - 0.78) / 0.22));
      col.push(c.r, c.g, c.b);
    }
    wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    wallGeo.computeVertexNormals();
  }
  ctx.own(wallGeo);
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  ctx.own(wallMat);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.visible = false;
  ctx.mesh(wall);
  const greenMat = new THREE.MeshStandardMaterial({ color: 0xbfe0d8, roughness: 0.2, transparent: true, opacity: 0.5, depthWrite: false });
  ctx.own(greenMat);
  const green = new THREE.Mesh(unit, greenMat);
  green.visible = false;
  ship.add(green);

  // ---- rain, driven across the deck ----
  const RAIN = 1400;
  const rainPts = new Float32Array(RAIN * 6);
  const rainSeed = new Float32Array(RAIN * 3);
  for (let i = 0; i < RAIN; i++) {
    rainSeed[i * 3] = (Math.random() - 0.5) * 90;
    rainSeed[i * 3 + 1] = Math.random() * 34;
    rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 90;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPts, 3));
  rainGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, Y0, 0), 1e5);
  const rainMat = new THREE.LineBasicMaterial({ color: 0xaac4d4, transparent: true, opacity: 0.45, depthWrite: false });
  ctx.own(rainGeo);
  ctx.own(rainMat);
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  ctx.mesh(rain);
  const RAIN_V = new THREE.Vector3(-5, -30, -9);

  // ---- a fill for the deck, and the lightning's own flash ----
  const fill = new THREE.HemisphereLight(0x8a9cb0, 0x1a2830, 0.9);
  ctx.mesh(fill);
  const flash = new THREE.PointLight(0xdfe8ff, 0, 140, 1.1);
  flash.position.set(0, Y0 + 30, 0);
  ctx.mesh(flash);
  // the bolt: a jagged chain of bright rods, and a soft sheath round it
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 1, depthWrite: false });
  const sheathMat = new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  ctx.own(boltMat);
  ctx.own(sheathMat);
  const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  rodGeo.translate(0, 0.5, 0);
  ctx.own(rodGeo);
  const BOLT_SEGS = 14;
  const bolt = new THREE.Group();
  bolt.visible = false;
  const boltRods: THREE.Mesh[] = [];
  for (let i = 0; i < BOLT_SEGS * 2; i++) {
    const core = i < BOLT_SEGS;
    const m = new THREE.Mesh(rodGeo, core ? boltMat : sheathMat);
    m.frustumCulled = false;
    bolt.add(m);
    boltRods.push(m);
  }
  ctx.mesh(bolt);
  const _up = new THREE.Vector3(0, 1, 0);
  const layRod = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
    const d = b.clone().sub(a);
    m.position.copy(a);
    m.scale.set(r, d.length(), r);
    m.quaternion.setFromUnitVectors(_up, d.normalize());
  };

  // ---- the quay the trawler leaves: the warehouse rim and its gangway gate ----
  const quay = new THREE.Group();
  ctx.mesh(quay);
  const quayEdge = -HB - 2.2;
  {
    const q = new THREE.Mesh(unit, stoneMat);
    // the quay's planked top, as the dock behind the door was
    const top = new THREE.Mesh(unit, plankMat);
    top.scale.set(60, 0.1, 70);
    top.position.set(quayEdge - 30, Y0 + 0.62, -12);
    quay.add(top);
    q.scale.set(60, 8, 70);
    q.position.set(quayEdge - 30, Y0 + 0.6 - 4, -12);
    quay.add(q);
    // the warehouse rim, and the gangway gate in it the party came out of
    const shed = new THREE.Mesh(unit, shedMat);
    shed.scale.set(14, 12, 64);
    shed.position.set(quayEdge - 16, Y0 + 0.6 + 6, -12);
    // corrugation: ribs down the face, and the roofline
    for (let z = -43; z <= 19; z += 2.5) {
      const rib = new THREE.Mesh(unit, darkMat);
      rib.scale.set(0.25, 12, 0.3);
      rib.position.set(quayEdge - 8.9, Y0 + 6.6, z);
      quay.add(rib);
    }
    const eave = new THREE.Mesh(unit, darkMat);
    eave.scale.set(15, 0.6, 65);
    eave.position.set(quayEdge - 16, Y0 + 12.9, -12);
    quay.add(eave);
    quay.add(shed);
    // the transport door the party came out of: an open steel doorway in the
    // rim, its white-blue lamp over it (as the stage behind lit it)
    const doorZ = (GATE_IN.z0 + GATE_IN.z1) / 2;
    const doorX = quayEdge - 8.95;
    const recess = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0x06090c }));
    recess.scale.set(0.2, 4.4, 3.6);
    recess.position.set(doorX, Y0 + 0.6 + 2.2, doorZ);
    quay.add(recess);
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(unit, darkMat);
      post.scale.set(0.6, 5, 0.5);
      post.position.set(doorX + 0.2, Y0 + 0.6 + 2.5, doorZ + sz * 2.05);
      quay.add(post);
    }
    const lintel = new THREE.Mesh(unit, darkMat);
    lintel.scale.set(0.6, 0.5, 4.6);
    lintel.position.set(doorX + 0.2, Y0 + 0.6 + 4.9, doorZ);
    quay.add(lintel);
    const doorGlow = new THREE.MeshBasicMaterial({ color: 0xbfe6ff });
    ctx.own(doorGlow);
    const strip = new THREE.Mesh(unit, doorGlow);
    strip.scale.set(0.12, 0.18, 3.4);
    strip.position.set(doorX + 0.52, Y0 + 0.6 + 4.55, doorZ);
    quay.add(strip);
    const doorLamp = new THREE.PointLight(0xbfe6ff, 26, 22, 1.5);
    doorLamp.position.set(doorX + 1.2, Y0 + 0.6 + 4.2, doorZ);
    quay.add(doorLamp);
    // bollards and lamps along the edge
    for (let z = -42; z <= 18; z += 12) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.8, 8), darkMat);
      b.position.set(quayEdge - 0.8, Y0 + 1, z);
      quay.add(b);
      const pole = new THREE.Mesh(unit, darkMat);
      pole.scale.set(0.15, 5, 0.15);
      pole.position.set(quayEdge - 3, Y0 + 3.1, z + 6);
      quay.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), glowMat);
      bulb.position.set(quayEdge - 2.6, Y0 + 5.6, z + 6);
      quay.add(bulb);
    }
    const quayLamp = new THREE.PointLight(0xffc98a, 40, 30, 1.5);
    quayLamp.position.set(quayEdge - 3, Y0 + 5, (GATE_IN.z0 + GATE_IN.z1) / 2);
    quay.add(quayLamp);
    // the gangway, still hooked to the quay as the trawler pulls away from it
    const plank = new THREE.Mesh(unit, plankMat);
    plank.scale.set(3.2, 0.15, 2.4);
    plank.position.set(quayEdge + 0.9, Y0 + 0.2, (GATE_IN.z0 + GATE_IN.z1) / 2);
    plank.rotation.z = -0.35;
    plank.name = 'gangway';
    quay.add(plank);
  }
  // the moored trawler's sister, left at the quay astern
  const sisterAt = new THREE.Vector3(quayEdge + 5, SEA_Y + 1.2, -34);
  const sister = ctx.prop('trawler', sisterAt, {
    size: 16, yaw: 0.1,
    fallback: () => {
      const g = new THREE.Group();
      const h = new THREE.Mesh(unit, hullMat);
      h.scale.set(7, 2.4, 16);
      g.add(h);
      const d = new THREE.Mesh(unit, houseMat);
      d.scale.set(4.5, 2.6, 4);
      d.position.set(0, 2.5, -4.5);
      g.add(d);
      return g;
    },
  });
  let sisterTop: THREE.Object3D = sister;
  while (sisterTop.parent && sisterTop.parent !== ctx.group) sisterTop = sisterTop.parent;
  quay.attach(sisterTop);

  // ---- the far pier, coming out of the rain at the end ----
  const pier = new THREE.Group();
  pier.visible = false;
  ctx.mesh(pier);
  const PIER_Z0 = -40, PIER_Z1 = 70;
  const pierW = PIER.x1 - PIER.x0;
  const pierCX = (PIER.x0 + PIER.x1) / 2;
  {
    const deck = new THREE.Mesh(unit, plankMat);
    deck.scale.set(pierW, 0.5, PIER_Z1 - PIER_Z0);
    deck.position.set(pierCX, Y0 - 0.25, (PIER_Z0 + PIER_Z1) / 2);
    pier.add(deck);
    const pileGeo = new THREE.CylinderGeometry(0.35, 0.4, 7, 8);
    ctx.own(pileGeo);
    for (let z = PIER_Z0 + 2; z < PIER_Z1; z += 6) {
      for (const x of [PIER.x0 + 0.5, pierCX, PIER.x1 - 0.5]) {
        const pile = new THREE.Mesh(pileGeo, darkMat);
        pile.position.set(x, Y0 - 3.6, z);
        pier.add(pile);
      }
    }
    for (let z = PIER_Z0 + 6; z < PIER_Z1; z += 14) {
      const pole = new THREE.Mesh(unit, darkMat);
      pole.scale.set(0.15, 4.5, 0.15);
      pole.position.set(PIER.x1 - 0.8, Y0 + 2.25, z);
      pier.add(pole);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), glowMat);
      bulb.position.set(PIER.x1 - 1.1, Y0 + 4.5, z);
      pier.add(bulb);
    }
    // the landing: two bollards and a lamp at the gate, and the pier heads' sheds beyond
    for (const dz of [-2.2, 2.2]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.8, 8), darkMat);
      b.position.set(PIER.x0 + 0.8, Y0 + 0.4, (GATE_OUT.z0 + GATE_OUT.z1) / 2 + dz);
      pier.add(b);
    }
    const landLamp = new THREE.PointLight(0xffd8a0, 45, 26, 1.4);
    landLamp.position.set(PIER.x0 + 3, Y0 + 4, (GATE_OUT.z0 + GATE_OUT.z1) / 2);
    pier.add(landLamp);
    for (const z of [PIER_Z1 - 8, PIER_Z1 + 6]) {
      const sh = new THREE.Mesh(unit, shedMat);
      sh.scale.set(pierW + 6, 9, 12);
      sh.position.set(pierCX + 2, Y0 + 4.5, z);
      pier.add(sh);
    }
  }
  const pierLanding = new THREE.Vector3(PIER.x0 + 3.2, Y0, (GATE_OUT.z0 + GATE_OUT.z1) / 2);
  const gangOut = new THREE.Mesh(unit, plankMat);
  gangOut.scale.set(1.4, 0.12, 2.6);
  gangOut.visible = false;
  onHull(gangOut, HB + 0.3, Y0 + 0.02, (GATE_OUT.z0 + GATE_OUT.z1) / 2);

  // ---- passing marks: buoys with blinking lamps, so the speed reads ----
  const buoys = [0, 1, 2, 3, 4].map((i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.2, 10), i % 2 ? rustMat : ctx.paint(0x2a6a3a));
    body.position.y = 0.6;
    g.add(body);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), i % 2 ? redLamp : greenLamp);
    lamp.position.y = 2;
    g.add(lamp);
    g.position.set((i % 2 ? 1 : -1) * (24 + i * 7), SEA_Y, -60 + i * 70);
    ctx.mesh(g);
    return g;
  });

  // ---- the roll ----
  const onDeckXZ = (x: number, z: number): boolean =>
    Math.abs(x) <= HB + 0.2 && z >= STERN - 4.5 && z <= 19.5;
  const tilt = deckTilt({ pivotY: PIVOT_Y, deckY: Y0, gain: TILT_GAIN, onDeck: onDeckXZ });

  // ---- state ----
  let time = 0;
  let phase: Phase = 'intro';
  let phaseT = 0;
  let waveIdx = 0;          // 0..2 while the waves run
  let launched = 0;         // groups of the current wave sent
  let pendingDrops = 0;
  let pendingDropT = 0;
  let waveBodies: Enemy[] = [];
  let complete = false;
  let wiped = false;
  let quiet = false;        // tests: no boarders
  let rollOverride: number | null = null;
  let boomLoose = false;
  let boomTh = 0, boomW = 0, boomPrev = 0;
  let quayT = 0;
  let pierT = 0;
  let seaScroll = 0;
  let speed = 0;
  // rogue waves
  let roguePhase: RoguePhase = 'idle';
  let rogueT = 0;
  let rogueClock = ROGUE_FIRST;
  let rogueSide = Math.random() < 0.5 ? 1 : -1;     // +1: from starboard
  let nextSide = rogueSide;
  let rogueEnv = 0;
  let rogueCount = 0;
  let bigOne = false;       // the climax: wave 3's first rogue wave, the biggest of the crossing
  let washedOver = 0;
  let wallX = 0;
  // lightning
  let lightningOn = false;
  let lightningClock = 16;
  let crackleT = -1;
  let flashT = 0;
  const hitAt = new Map<object, number>();
  const washed = new Set<object>();
  let overboard = 0;
  let strikes = 0;
  let boomHits = 0;
  const cursors = [0, 0, 0, 0];
  const braceLatch = [false, false, false, false];

  const roofSpot = (slot: number): THREE.Vector3 =>
    new THREE.Vector3((slot % 2) * 2.4 - 1.2, Y0 + HOUSE.h, HOUSE.z0 + 1.4 + Math.floor(slot / 2) * 1.8);
  ctx.checkpoint.copy(roofSpot(0));

  const WAVES: WaveDef[] = (() => {
    const q = (base: number): number => Math.max(1, base + (party >= 3 ? 1 : 0) + (party >= 4 && base >= 2 ? 1 : 0) - (party === 1 && base > 2 ? 1 : 0));
    const crew = (base: number): number => Math.max(1, base + Math.floor((party - 1) / 2));
    return [
      { min: 36, groups: [
        { at: 3, entry: 'stern', n: q(2) },
        { at: 15, entry: 'stern', n: q(2) },
        { at: 26, entry: party > 1 ? 'port' : 'stern', n: q(1) },
      ] },
      { min: 46, groups: [
        { at: 2, entry: 'port', n: q(2) },
        { at: 7, entry: 'drop', n: crew(1) },
        { at: 17, entry: 'starboard', n: q(2) },
        { at: 29, entry: 'stern', n: q(2) },
      ] },
      { min: 56, groups: [
        { at: 2, entry: 'rails', n: q(3) },
        { at: 9, entry: 'air', n: party >= 3 ? 2 : 1 },
        { at: 17, entry: 'drop', n: crew(2) },
        { at: 27, entry: 'stern', n: q(3) },
        { at: 38, entry: 'rails', n: q(2) },
      ] },
    ];
  })();

  // ---- boarders ----
  const lead = (): Player | null => game.players.find((p) => p.alive) ?? null;
  const swimIn = (kind: EnemyKind, target: THREE.Vector3, from: THREE.Vector3): void => {
    const e = ctx.spawn(kind, target, { exact: true, squad: 8900 + waveIdx });
    const at = e.position.clone();
    e.beginArrival('swim', from, at);
    waveBodies.push(e);
    const l = lead();
    if (l) e.alert(l.position, true);
  };
  const sendGroup = (g: Group): void => {
    const quarren: EnemyKind = 'quarren';
    const railZ = [-14, -8.5, -2.5, 6.4, 11];
    if (g.entry === 'stern') {
      for (let i = 0; i < g.n; i++) {
        const x = ((i % 3) - 1) * 1.3;
        swimIn(quarren, new THREE.Vector3(x, Y0, STERN + 1.6 + Math.floor(i / 3) * 1.4),
          new THREE.Vector3(x * 2, SEA_Y, STERN - 26 - i * 2));
      }
    } else if (g.entry === 'port' || g.entry === 'starboard' || g.entry === 'rails') {
      for (let i = 0; i < g.n; i++) {
        const side = g.entry === 'port' ? -1 : g.entry === 'starboard' ? 1 : (i % 2 ? 1 : -1);
        const z = railZ[(i * 2 + waveIdx) % railZ.length];
        swimIn(quarren, new THREE.Vector3(side * (HB - 1.3), Y0, z),
          new THREE.Vector3(side * (HB + 24 + i * 2), SEA_Y, z + 8));
      }
    } else if (g.entry === 'drop') {
      let kinds = ctx.squadFor(ctx.wave + waveIdx, g.n + 2).filter((k) => k !== 'quarren' && k !== 'jetpirate');
      if (!kinds.length) kinds = ['pirate'];
      kinds = kinds.slice(0, g.n);
      while (kinds.length < g.n) kinds.push(kinds[kinds.length - 1]);
      const spots = kinds.map((_, i) => new THREE.Vector3(i % 2 ? 4.8 : -4.8, Y0, 6 - (i >> 1) * 3));
      pendingDrops++;
      pendingDropT = 25;
      ctx.drop(kinds, spots, (bodies) => {
        pendingDrops = Math.max(0, pendingDrops - 1);
        waveBodies.push(...bodies);
      });
    } else if (g.entry === 'air') {
      for (let i = 0; i < g.n; i++) {
        const side = i % 2 ? 1 : -1;
        const e = ctx.spawn('jetpirate', new THREE.Vector3(side * 26, Y0 + 9, -4 + i * 6), { exact: true, squad: 8950, alert: true });
        waveBodies.push(e);
      }
    }
  };

  const startWave = (k: number): void => {
    waveIdx = k;
    phase = 'wave';
    phaseT = 0;
    launched = 0;
    waveBodies = [];
    restockBarrels();
    audio.waveStart();
    ctx.announce(T.waveBanner(k + 1), T.waveSub[k]);
    if (k >= 1 && !boomLoose) {
      boomLoose = true;
      arc.visible = true;
    }
    if (k >= 1) lightningOn = true;
    // the squall's peak: the biggest sea of the crossing comes early in the last wave
    if (k === 2) { rogueClock = Math.min(rogueClock, 24); bigOne = true; }
    if (k >= 1) {
      // bacta: one on the foredeck, one on the roof where the lightning is
      ctx.pickup(new THREE.Vector3(0, Y0, 6.2));
      if (k === 2) ctx.pickup(new THREE.Vector3(0, Y0 + HOUSE.h, -2.6));
    }
  };

  /** throw a body over the far rail: green water carrying it clean over the bulwark */
  const overTheSide = (b: { position: THREE.Vector3; velocity: THREE.Vector3 }, side: number): void => {
    b.position.x = side * (HB + 0.9);
    b.position.y = Math.max(b.position.y, Y0 + RAIL_H + 0.3);
    b.velocity.set(side * 4, 2.5, 0);
  };

  /** the harbour took them: splash, re-form on the deckhouse roof */
  const takePlayer = (p: Player): void => {
    game.particles.splash(new THREE.Vector3(p.position.x, SEA_Y, p.position.z), 22);
    audio.splash(true, 0.8);
    overboard++;
    const at = respawnSpot(p.slot);
    p.position.copy(at);
    p.velocity.set(0, 0, 0);
    p.cover = null;
    p.peeking = false;
    washed.delete(p);
    game.announce(TEXT.banners.tookYou.title, T.tookSub);
    p.damage(12, at);
  };

  // ---- the rogue wave ----
  const rogueEvery = (): number => {
    const base = ROGUE_EVERY[Math.min(ROGUE_EVERY.length, party) - 1];
    return waveIdx >= 2 && phase === 'wave' ? base * 0.75 : base;
  };
  let rogueScale = 1;
  const startRogue = (side: number): void => {
    rogueSide = side;
    roguePhase = 'telegraph';
    rogueT = 0;
    rogueCount++;
    rogueScale = bigOne && phase === 'wave' && waveIdx === 2 ? 1.3 : 1;
    audio.bossHorn(rogueScale > 1);
    ctx.announce(rogueScale > 1 ? T.bigOne : T.rogue, T.rogueSub(side > 0 ? T.starboard : T.port));
    if (rogueScale > 1) bigOne = false;
  };

  /** is a body sheltered from green water coming from `side`? */
  const sheltered = (pos: THREE.Vector3, side: number): boolean => {
    // up on the deckhouse, or in the air over the water's reach
    if (pos.y > Y0 + 1.8) return true;
    // in the deckhouse's lee: the water parts round it
    const inHouseZ = pos.z > HOUSE.z0 - 0.4 && pos.z < HOUSE.z1 + 0.4;
    return inHouseZ && pos.x * side < -HOUSE.x + 0.2;
  };
  /** has the water front reached this body yet? */
  const frontX = (): number => {
    const k = roguePhase === 'sweep' ? rogueT / SWEEP : roguePhase === 'surge' ? 1 : 0;
    return rogueSide * (HB - k * HB * 2);
  };
  const wetBy = (pos: THREE.Vector3): boolean => {
    if (roguePhase !== 'sweep' && roguePhase !== 'surge') return false;
    return (pos.x - frontX()) * rogueSide >= -0.2;
  };

  const updateRogue = (dt: number): void => {
    if (roguePhase === 'idle') {
      if (phase === 'approach' || phase === 'docked') { rogueEnv = damp(rogueEnv, 0, 2, dt); return; }
      rogueClock -= dt;
      if (rogueClock <= 0) {
        startRogue(nextSide);
        rogueClock = rogueEvery();
      }
      rogueEnv = damp(rogueEnv, 0, 2, dt);
      wall.visible = false;
      return;
    }
    rogueT += dt;
    const side = rogueSide;
    if (roguePhase === 'telegraph') {
      const k = rogueT / TELEGRAPH;
      // the sea stands up on the weather side and comes on
      wall.visible = true;
      wallX = side * THREE.MathUtils.lerp(90, HB + 5, k * k);
      wall.position.set(wallX, SEA_Y - 3, 0);
      wall.rotation.set(0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      wall.scale.set(1, (0.2 + 0.8 * Math.min(1, k * 1.15)) * rogueScale, 1);
      // spindrift off the crest as it comes on
      if (k > 0.45 && Math.random() < dt * 14) {
        const cy = SEA_Y - 3 + WALL_H * wall.scale.y;
        game.particles.splash(new THREE.Vector3(wallX + side * 2, cy, (Math.random() - 0.5) * 60), 6);
      }
      // the horn again at the halfway, and the deck starts to heel
      if (rogueT - dt < TELEGRAPH / 2 && rogueT >= TELEGRAPH / 2) audio.bossHorn(false);
      rogueEnv = Math.max(0, (rogueT - (TELEGRAPH - 1.5)) / 1.5) * 0.45;
      if (rogueT >= TELEGRAPH) {
        roguePhase = 'sweep';
        rogueT = 0;
        audio.splash(true, 1);
        audio.thunder(0.35);
        for (const p of game.players) p.cam.shake(0.35);
      }
    } else if (roguePhase === 'sweep' || roguePhase === 'surge') {
      rogueEnv = Math.min(1, rogueEnv + dt * 3);
      // the wall breaks over the rail and falls into the sea beyond
      wall.scale.y = Math.max(0.05, wall.scale.y - dt * 1.2);
      wall.position.x = damp(wall.position.x, -side * 4, 1.5, dt);
      if (roguePhase === 'sweep' && rogueT >= SWEEP) { roguePhase = 'surge'; rogueT = 0; }
      else if (roguePhase === 'surge' && rogueT >= SURGE) { roguePhase = 'drain'; rogueT = 0; }
      // spray where the front is
      const fx = frontX();
      for (let i = 0; i < 3; i++) {
        game.particles.splash(new THREE.Vector3(fx, Y0 + 0.6, STERN + Math.random() * (FOC - STERN)), 3);
      }
    } else if (roguePhase === 'drain') {
      rogueEnv = Math.max(0, 1 - rogueT / DRAIN);
      wall.visible = false;
      if (rogueT >= DRAIN) {
        roguePhase = 'idle';
        washed.clear();
        // the next one's weather side, known now so a bot can stand in its lee
        nextSide = Math.random() < 0.65 ? -rogueSide : rogueSide;
      }
    }
    // the green water sheet across the deck, from the weather rail to the front
    const wet = roguePhase === 'sweep' || roguePhase === 'surge' || (roguePhase === 'drain' && rogueT < 0.8);
    green.visible = wet;
    if (wet) {
      const fx = roguePhase === 'drain' ? -side * HB : frontX();
      const x0 = side * HB, x1 = fx;
      const depth = roguePhase === 'drain' ? 1.2 * (1 - rogueT / 0.8) : 1.2;
      green.scale.set(Math.max(0.1, Math.abs(x1 - x0)), Math.max(0.05, depth), FOC - STERN - 0.6);
      green.position.set((x0 + x1) / 2, Y0 + depth / 2 - PIVOT_Y, (STERN + FOC) / 2);
    }
  };

  /** the wash: push, knock down, and over the far rail with whoever reaches it */
  const applyWash = (dt: number): void => {
    if (roguePhase !== 'sweep' && roguePhase !== 'surge') return;
    const to = -rogueSide;
    const farInner = HB - RAIL_T;
    for (const p of game.players) {
      if (!p.alive || p.formT > 0 || p.cover || p.vehicle) continue;
      if (!onDeckXZ(p.position.x, p.position.z) || sheltered(p.position, rogueSide) || !wetBy(p.position)) continue;
      if (!washed.has(p)) { washed.add(p); p.damage(4, new THREE.Vector3(rogueSide * HB, Y0, p.position.z)); }
      if (p.velocity.x * to < WASH * rogueScale) p.velocity.x = to * WASH * rogueScale;
      if (p.position.x * to > farInner - 0.9 && p.position.z < FOC && p.position.z > STERN) overTheSide(p, to);
    }
    for (const e of game.enemies) {
      if (!e.alive || e.arriving || e.team !== 1) continue;
      if (e.position.y > Y0 + 3 || !onDeckXZ(e.position.x, e.position.z)) continue;
      if (sheltered(e.position, rogueSide) || !wetBy(e.position)) continue;
      if (!washed.has(e)) { washed.add(e); e.knockdown(1.6); }
      if (e.velocity.x * to < WASH * rogueScale) e.velocity.x = to * WASH * rogueScale;
      if (e.position.x * to > farInner - 0.9 && e.position.z < FOC && e.position.z > STERN) { overTheSide(e, to); washedOver++; }
    }
    for (const br of barrels) {
      if (br.b.broken || br.lost) continue;
      if (!wetBy(new THREE.Vector3(br.at.x, Y0, br.at.z)) || sheltered(new THREE.Vector3(br.at.x, Y0, br.at.z), rogueSide)) continue;
      br.vx = to * WASH * 0.9;
    }
    void dt;
  };

  // ---- the barrels slide ----
  const updateBarrels = (dt: number): void => {
    const phys = game.board.physics;
    for (const br of barrels) {
      if (br.b.broken || br.lost) continue;
      br.vx += tilt.accel * 0.4 * dt;
      br.vx = damp(br.vx, 0, 0.9, dt);
      if (Math.abs(br.vx) < 0.02) continue;
      // slide it with its own box out of the world, so it does not block itself
      const i = phys.boxes.indexOf(br.box);
      if (i >= 0) phys.boxes.splice(i, 1);
      const pos = new THREE.Vector3(br.at.x, Y0 + 0.02, br.at.z);
      const vel = new THREE.Vector3(br.vx, 0, 0);
      phys.moveCapsule(pos, 0.5, 1.3, vel, dt);
      const moved = pos.x - br.at.x;
      if (Math.abs(moved) < Math.abs(br.vx * dt) * 0.3) {
        // struck something solid: at the far rail with the sea behind it, over it goes
        if (Math.abs(br.vx) > WASH * 0.6 && Math.abs(pos.x) > HB - RAIL_T - 0.9) {
          br.lost = true;
          br.holder.visible = false;
          game.particles.splash(new THREE.Vector3(Math.sign(br.vx) * (HB + 1), SEA_Y, br.at.z), 12);
          continue;
        }
        br.vx *= -0.25;
      }
      // a barrel sliding into a body at speed bowls it over, and stops
      for (const b of [...game.players, ...game.enemies]) {
        if (!b.alive) continue;
        if (Math.abs(b.position.y - Y0) > 1.2) continue;
        if (Math.hypot(b.position.x - pos.x, b.position.z - pos.z) > 0.95) continue;
        if (Math.abs(br.vx) > 3.5) {
          const dmg = Math.abs(br.vx) * 3;
          if (game.players.includes(b as Player)) (b as Player).damage(dmg * 0.6, pos);
          else { (b as Enemy).damage(dmg, pos, -1); (b as Enemy).knockdown(1.2); }
          b.velocity.x += br.vx * 0.8;
        }
        pos.x = br.at.x;
        br.vx = 0;
      }
      br.at.x = pos.x;
      if (i >= 0) phys.boxes.push(br.box);
      placeBarrel(br);
      // a braced player's cover does not slide away from them
      for (const p of game.players) if (p.cover?.solid === br.box) { p.cover = null; p.peeking = false; }
    }
  };

  // ---- the boom ----
  const updateBoom = (dt: number): void => {
    boomPrev = boomTh;
    if (!boomLoose) {
      boomTh = damp(boomTh, 0, 3, dt);
      boomW = 0;
    } else {
      // a pendulum driven by the roll: it lags, overshoots and fetches up on its stays
      const ref = THREE.MathUtils.degToRad(SWELL_DEG[waveIdx] ?? 8);
      const target = THREE.MathUtils.clamp(tilt.roll / ref, -1.2, 1.2) * BOOM_MAX;
      boomW += (5 * (target - boomTh) - 0.8 * boomW) * dt;
      boomTh += boomW * dt;
      if (Math.abs(boomTh) > BOOM_MAX) {
        boomTh = Math.sign(boomTh) * BOOM_MAX;
        if (Math.abs(boomW) > 0.8) game.particles.impactSparks(new THREE.Vector3(Math.sin(boomTh) * BOOM_LEN, Y0 + BOOM_Y, KING.z - Math.cos(boomTh) * BOOM_LEN), 6);
        boomW *= -0.3;
      }
    }
    boom.rotation.y = -boomTh;
    // the topping lift
    const tip = new THREE.Vector3(Math.sin(boomTh) * BOOM_LEN, Y0 + BOOM_Y, KING.z - Math.cos(boomTh) * BOOM_LEN);
    const lp = liftGeo.attributes.position as THREE.BufferAttribute;
    lp.setXYZ(0, 0, Y0 + MAST.top - 1 - PIVOT_Y, MAST.z);
    lp.setXYZ(1, tip.x, tip.y - PIVOT_Y, tip.z);
    lp.needsUpdate = true;
    // the sweep: whoever is standing in the arc it crossed this frame
    if (!boomLoose || Math.abs(boomW) < 0.35) return;
    const lo = Math.min(boomPrev, boomTh), hi = Math.max(boomPrev, boomTh);
    const struck = (pos: THREE.Vector3, key: object): boolean => {
      if (pos.y < Y0 - 0.3 || pos.y > Y0 + BOOM_Y - 0.25) return false;
      const dx = pos.x - KING.x, dz = pos.z - KING.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7 || d > BOOM_LEN + 0.4) return false;
      const ang = Math.atan2(dx, -dz);
      const pad = Math.atan2(0.55, d);
      if (ang < lo - pad || ang > hi + pad) return false;
      if ((hitAt.get(key) ?? -9) > time - 1.2) return false;
      hitAt.set(key, time);
      return true;
    };
    const dir = Math.sign(boomW);
    const shove = (v: THREE.Vector3): void => {
      v.x += Math.cos(boomTh) * dir * 9;
      v.z += Math.sin(boomTh) * dir * 9;
      v.y = Math.max(v.y, 4);
    };
    for (const p of game.players) {
      if (!p.alive || p.formT > 0 || !struck(p.position, p)) continue;
      p.cover = null;
      p.damage(BOOM_DMG, new THREE.Vector3(KING.x, Y0 + BOOM_Y, KING.z), -1, { heavy: true });
      shove(p.velocity);
      boomHits++;
      audio.impact();
    }
    for (const e of game.enemies) {
      if (!e.alive || e.arriving || e.team !== 1 || !struck(e.position, e)) continue;
      e.damage(BOOM_DMG * 2, new THREE.Vector3(KING.x, Y0 + BOOM_Y, KING.z), -1, { heavy: true });
      e.knockdown(1.6);
      shove(e.velocity);
      boomHits++;
      audio.impact();
    }
  };

  // ---- lightning ----
  const onRoof = (pos: THREE.Vector3): boolean =>
    pos.y > Y0 + HOUSE.h - 0.4 && Math.abs(pos.x) < HOUSE.x + 0.5
    && pos.z > HOUSE.z0 - 0.5 && pos.z < HOUSE.z1 + 0.5;
  const nearMast = (pos: THREE.Vector3): boolean =>
    Math.hypot(pos.x - MAST.x, pos.z - MAST.z) < 3 && pos.y > Y0 + HOUSE.h + WHEEL.h - 0.5;
  const strike = (): void => {
    strikes++;
    flashT = 0.35;
    audio.thunder(0.9);
    // a jagged line out of the cloud onto the rod
    const top = rodTop.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, 55, (Math.random() - 0.5) * 20));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= BOLT_SEGS; i++) {
      const at = top.clone().lerp(rodTop, i / BOLT_SEGS);
      if (i > 0 && i < BOLT_SEGS) at.add(new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
      pts.push(at);
    }
    for (let i = 0; i < BOLT_SEGS; i++) {
      layRod(boltRods[i], pts[i], pts[i + 1], 0.14);
      layRod(boltRods[BOLT_SEGS + i], pts[i], pts[i + 1], 0.55);
    }
    bolt.visible = true;
    game.particles.impactSparks(rodTop, 30);
    const from = rodTop.clone();
    for (const p of game.players) {
      if (!p.alive || p.formT > 0) continue;
      if (onRoof(p.position) || nearMast(p.position)) {
        p.damage(STRIKE_DMG, from, -1, { heavy: true });
        game.particles.impactSparks(p.position.clone().setY(p.position.y + 1), 16);
      }
    }
    for (const e of game.enemies) {
      if (!e.alive || e.team !== 1) continue;
      if (onRoof(e.position) || nearMast(e.position)) {
        e.damage(STRIKE_DMG * 2, from, -1, { heavy: true });
        e.knockdown(1.4);
      }
    }
  };
  const updateLightning = (dt: number): void => {
    flashT = Math.max(0, flashT - dt);
    flash.intensity = flashT > 0 ? 900 * (flashT / 0.35) * (0.6 + Math.random() * 0.4) : 0;
    boltMat.opacity = Math.min(1, flashT / 0.2);
    sheathMat.opacity = 0.35 * Math.min(1, flashT / 0.2);
    bolt.visible = flashT > 0;
    if (crackleT >= 0) {
      crackleT += dt;
      // the crackle: sparks walking down the rigging, the mast glowing blue
      const k = Math.min(1, crackleT / CRACKLE);
      mastMat.emissive.setRGB(0.25 * k, 0.4 * k, 0.9 * k);
      mastMat.emissiveIntensity = 0.6 + Math.random() * 1.2 * k;
      if (Math.random() < dt * 20) {
        const y = Y0 + HOUSE.h + WHEEL.h + Math.random() * (MAST.top - HOUSE.h - WHEEL.h);
        game.particles.impactSparks(new THREE.Vector3(MAST.x, y, MAST.z), 3);
      }
      if (Math.random() < dt * 3) audio.floorCharge(0.25);
      if (crackleT >= CRACKLE) {
        crackleT = -1;
        mastMat.emissive.setRGB(0, 0, 0);
        strike();
      }
      return;
    }
    if (!lightningOn || phase === 'approach' || phase === 'docked') return;
    lightningClock -= dt;
    if (lightningClock <= 0) {
      crackleT = 0;
      lightningClock = waveIdx >= 2 ? 12 + Math.random() * 5 : 17 + Math.random() * 6;
    }
  };

  // ---- the voyage: the quay falling astern, the sea going by, the pier ahead ----
  const updateVoyage = (dt: number): void => {
    // under way from the first second; slowing to come alongside at the end
    const want = phase === 'approach' ? SPEED * Math.max(0.15, 1 - pierT / APPROACH) : phase === 'docked' ? 0 : SPEED;
    speed = damp(speed, want, 0.6, dt);
    seaScroll += speed * dt;
    // the quay: first the gap opens as she casts off, then it falls astern
    quayT += dt;
    quay.position.x = -Math.min(18, quayT * quayT * 0.3);
    if (quayT > 1.5) quay.position.z -= speed * dt;
    quay.visible = quay.position.z > -260;
    const plank = quay.getObjectByName('gangway');
    if (plank) plank.rotation.z = -0.35 - Math.min(1.1, quayT * 0.3);
    // the far pier comes out of the rain and stops alongside
    if (phase === 'approach' || phase === 'docked') {
      pier.visible = true;
      const k = Math.min(1, pierT / APPROACH);
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      pier.position.set(12 * (1 - e), 0, 200 * (1 - e));
    }
    // buoys go by, and come round again ahead
    for (const b of buoys) {
      b.position.z -= speed * dt;
      if (b.position.z < -170) b.position.z += 350;
      b.position.y = SEA_Y + Math.sin(time * 1.3 + b.position.x) * 0.4;
      b.rotation.z = Math.sin(time * 0.9 + b.position.z) * 0.15;
    }
    // the sea: swell rolling past, and the texture streaming aft
    const map = seaMat.map;
    if (map) map.offset.set(time * 0.004, seaScroll / (SEA_SIZE / 26));
    if (seaMat.normalMap) seaMat.normalMap.offset.set(-time * 0.006, seaScroll / (SEA_SIZE / 26) + time * 0.01);
    const s = seaScroll;
    for (let i = 0; i < seaPos.count; i++) {
      const x = seaPos.getX(i), z = seaPos.getZ(i);
      const a1 = x * 0.1 + time * 0.8;
      const a2 = (z + s) * 0.06 + time * 0.5;
      const a3 = (x + z + s) * 0.19 + time * 1.7;
      seaPos.setY(i, Math.sin(a1) * 0.55 + Math.sin(a2) * 0.5 + Math.sin(a3) * 0.18);
      const dx = Math.cos(a1) * 0.055 + Math.cos(a3) * 0.034;
      const dz = Math.cos(a2) * 0.03 + Math.cos(a3) * 0.034;
      const inv = 1 / Math.hypot(dx, 1, dz);
      seaNorm.setXYZ(i, -dx * inv, inv, -dz * inv);
    }
    seaPos.needsUpdate = true;
    seaNorm.needsUpdate = true;
    wake.position.y = SEA_Y + 0.35;
    foamMat.opacity = 0.12 + 0.25 * (speed / SPEED);
    // spray over the bow as she buries it, and off the weather rail at the roll's peaks
    if (speed > 2 && Math.random() < dt * 2.2) {
      game.particles.splash(new THREE.Vector3((Math.random() - 0.5) * 4, Y0 + FOC_H, 18.5), 10);
    }
    if (Math.abs(tilt.roll) > THREE.MathUtils.degToRad(6) && Math.random() < dt * 1.5) {
      const hi = -Math.sign(tilt.roll);
      game.particles.splash(new THREE.Vector3(hi * (HB + 0.4), Y0 + 0.6, STERN + Math.random() * (FOC - STERN)), 6);
    }
    // rain streaks, driven across the deck
    const rp = rainGeo.attributes.position as THREE.BufferAttribute;
    const arr = rp.array as Float32Array;
    const len = 0.045;
    for (let i = 0; i < RAIN; i++) {
      let x = rainSeed[i * 3] + RAIN_V.x * dt;
      let y = rainSeed[i * 3 + 1] + RAIN_V.y * dt;
      let z = rainSeed[i * 3 + 2] + RAIN_V.z * dt;
      if (y < -FREEBOARD) { y += 34; x = (Math.random() - 0.5) * 90; z = (Math.random() - 0.5) * 90; }
      if (x < -45) x += 90;
      if (z < -45) z += 90;
      rainSeed[i * 3] = x; rainSeed[i * 3 + 1] = y; rainSeed[i * 3 + 2] = z;
      arr[i * 6] = x; arr[i * 6 + 1] = Y0 + y; arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x - RAIN_V.x * len; arr[i * 6 + 4] = Y0 + y - RAIN_V.y * len; arr[i * 6 + 5] = z - RAIN_V.z * len;
    }
    rp.needsUpdate = true;
  };

  // ---- the waves of boarders ----
  const updateWaves = (dt: number): void => {
    phaseT += dt;
    if (pendingDrops > 0) {
      pendingDropT -= dt;
      if (pendingDropT <= 0) pendingDrops = 0;      // a pass that never came: never a soft-lock
    }
    if (phase === 'intro') {
      if (phaseT >= 5) startWave(0);
      return;
    }
    if (phase === 'wave') {
      const w = WAVES[waveIdx];
      while (!quiet && launched < w.groups.length && phaseT >= w.groups[launched].at) {
        sendGroup(w.groups[launched]);
        launched++;
      }
      if (quiet) launched = w.groups.length;
      const alive = waveBodies.filter((e) => e.alive && !e.removeMe).length;
      const done = launched >= w.groups.length && pendingDrops === 0 && alive === 0 && phaseT >= w.min;
      // a straggler stuck somewhere nobody can reach does not hold the run for ever
      const stale = phaseT > w.min + 150;
      if (done || stale) {
        if (stale) for (const e of waveBodies) if (e.alive) e.damage(1e7, e.position, -1);
        audio.waveClear();
        if (waveIdx >= WAVES.length - 1) {
          phase = 'approach';
          phaseT = 0;
          pierT = 0;
          roguePhase = roguePhase === 'telegraph' ? 'idle' : roguePhase;
          wall.visible = false;
          ctx.announce(T.pierBanner, T.pierSub);
        } else {
          phase = 'breather';
          phaseT = 0;
          ctx.announce(T.clearBanner, T.clearSub(waveIdx + 1));
        }
      }
      return;
    }
    if (phase === 'breather') {
      if (phaseT >= BREATHER) startWave(waveIdx + 1);
      return;
    }
    if (phase === 'approach') {
      pierT += dt;
      if (pierT >= APPROACH) {
        phase = 'docked';
        phaseT = 0;
        // the pier is solid now, and the starboard gate swings open onto it
        ctx.box(pierCX, Y0 - 0.25, (PIER_Z0 + PIER_Z1) / 2, pierW, 0.5, PIER_Z1 - PIER_Z0, null);
        ctx.box(HB + 0.2, Y0 - 0.1, (GATE_OUT.z0 + GATE_OUT.z1) / 2, 0.8, 0.2, GATE_OUT.z1 - GATE_OUT.z0, null);
        ctx.unsolid({ box: gateOut });
        gangOut.visible = true;
        audio.doorCycle();
        ctx.announce(T.alongside, T.alongsideSub);
      }
      return;
    }
    if (phase === 'docked') {
      gateLeaf.rotation.y = damp(gateLeaf.rotation.y, -1.9, 3, dt);
      for (const p of game.players) {
        if (p.alive && p.position.x > PIER.x0 + 0.4 && p.position.y > Y0 - 0.6 && p.position.y < Y0 + 3) complete = true;
      }
    }
  };

  // ---- the frame ----
  let started = false;
  let savedWater: number | undefined;
  const update = (dt: number): void => {
    if (complete) return;
    time += dt;
    if (!started) {
      started = true;
      savedWater = game.board.waterY;
      game.board.waterY = SEA_Y;
      ctx.announce(T.title, T.sub);
      const drift = tilt.move((p) => (p.grounded ? 1 : 1.15));
      for (const p of game.players) p.sectionMove = composeMoves(drift);
    }

    // the roll: the swell, and a rogue wave's heel on top of it
    const amp = THREE.MathUtils.degToRad(phase === 'docked' || phase === 'approach' ? 3 : SWELL_DEG[waveIdx] ?? 8);
    const swell = amp * Math.sin((time / SWELL_PERIOD) * Math.PI * 2) * (0.85 + 0.15 * Math.sin(time * 0.41));
    const heel = -rogueSide * THREE.MathUtils.degToRad(ROGUE_DEG * rogueScale) * rogueEnv;
    tilt.roll = rollOverride ?? swell * (1 - rogueEnv * 0.7) + heel;
    ship.rotation.z = tilt.hullRotation;
    // the quarren, the pirates and the barrels all feel it
    tilt.pushEnemies(game, dt);

    updateVoyage(dt);
    updateRogue(dt);
    applyWash(dt);
    updateBarrels(dt);
    updateBoom(dt);
    updateLightning(dt);
    updateWaves(dt);

    // over the side: the harbour takes a player, and keeps a hostile
    for (const p of game.players) {
      if (!p.alive) continue;
      if (p.position.y < SEA_Y + 0.25 || p.swimming) takePlayer(p);
    }
    for (const e of game.enemies) {
      if (!e.alive || e.arriving || e.team !== 1) continue;
      if (e.position.y < SEA_Y + 0.25) {
        game.particles.splash(new THREE.Vector3(e.position.x, SEA_Y, e.position.z), 16);
        e.damage(1e7, e.position, -1);
      }
    }

    // a wipe: whoever was aboard goes, and the wave begins again after a breath
    const anyAlive = game.players.some((p) => p.alive);
    if (!anyAlive && !wiped) {
      wiped = true;
      for (const e of waveBodies) if (e.alive) e.removeMe = true;
      waveBodies = [];
      // the wave in progress is fought again from its start, after a breath
      if (phase === 'wave') { phase = 'breather'; phaseT = 0; launched = 0; waveIdx = Math.max(-1, waveIdx - 1); }
      roguePhase = 'idle';
      rogueEnv = 0;
      rogueClock = Math.max(rogueClock, 18);
      crackleT = -1;
    } else if (anyAlive) wiped = false;
  };

  // after every body has posed: carry the ones on deck with the rolling hull
  const afterFrame = (): void => {
    tilt.poseBodies(game);
  };

  // the party re-forms on the deckhouse roof — unless the mast is crackling,
  // when the roof is the one place not to be put: then the foredeck
  const respawnSpot = (slot: number): THREE.Vector3 =>
    crackleT >= 0
      ? ctx.defaultRespawn(slot, new THREE.Vector3(0, Y0, HOUSE.z1 + 1.6), new THREE.Vector3(0, 0, -1))
      : ctx.defaultRespawn(slot, roofSpot(0), new THREE.Vector3(0, 0, 1));

  // ---- guidance ----
  const leeSpot = (slot: number, side: number): THREE.Vector3 =>
    new THREE.Vector3(-side * (HOUSE.x + 0.75), Y0, HOUSE.z0 + 1.4 + (slot % 4) * 1.9);
  const gateIn = new THREE.Vector3(HB - 1.8, Y0, (GATE_OUT.z0 + GATE_OUT.z1) / 2);
  const path = [
    new THREE.Vector3(-HB + 1.8, Y0, (GATE_IN.z0 + GATE_IN.z1) / 2),
    leeSpot(0, 1),
    new THREE.Vector3(-HOUSE.x - 1.2, Y0, HOUSE.z1 + 1.6),
    gateIn,
    pierLanding,
  ];

  const objective = () => {
    if (phase === 'docked' || phase === 'approach') {
      return { pos: pierLanding.clone(), label: T.pier, hint: phase === 'docked' ? T.pierHint : T.approachHint, beacon: phase === 'docked' };
    }
    const hint = roguePhase === 'telegraph' ? T.rogueHint
      : phase === 'wave' || phase === 'breather' ? T.hold(Math.min(3, waveIdx + (phase === 'breather' ? 2 : 1)))
      : T.sub;
    return { pos: new THREE.Vector3(0, Y0 + HOUSE.h, -1.5), label: T.deck, hint, beacon: false };
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [];
    if (phase === 'wave') {
      const w = WAVES[waveIdx];
      const total = w.groups.reduce((n, g) => n + g.n, 0);
      const down = waveBodies.filter((e) => !e.alive).length;
      const left = Math.max(0, total - down);
      bars.push({ label: T.waveBar(waveIdx + 1), value: 1 - left / Math.max(1, total), tone: 'info' });
    } else if (phase === 'approach') {
      bars.push({ label: T.dockBar, value: Math.min(1, pierT / APPROACH), tone: 'good' });
    }
    if (roguePhase === 'telegraph') {
      bars.push({ label: T.rogueBar, value: Math.min(1, rogueT / TELEGRAPH), tone: 'danger' });
    }
    let line: string;
    if (crackleT >= 0 && (onRoof(p.position) || nearMast(p.position))) line = T.lightning;
    else if (roguePhase === 'telegraph' || roguePhase === 'sweep' || roguePhase === 'surge') {
      line = p.cover ? T.braced : sheltered(p.position, rogueSide) ? T.lee : T.rogueHint;
    } else if (phase === 'docked') line = T.pierHint;
    else if (phase === 'approach') line = T.approachHint;
    else if (boomLoose && p.position.z < KING.z && Math.abs(p.position.x) < BOOM_LEN) line = T.boomHint;
    else line = T.hold(Math.min(3, waveIdx + (phase === 'breather' ? 2 : 1)));
    return { title: T.title, bars, line };
  };

  /** the next point on the way from `from` to `to` that does not go through the deckhouse */
  const around = (from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 => {
    const fromSide = Math.sign(from.x) || 1, toSide = Math.sign(to.x) || 1;
    const alongHouse = (z: number): boolean => z > HOUSE.z0 - 1 && z < HOUSE.z1 + 1;
    if (fromSide === toSide || Math.abs(from.x) < HOUSE.x - 0.2 || !(alongHouse(from.z) || alongHouse(to.z))) return to;
    // round the forward end: the after end has the king post and the boom
    const zEnd = HOUSE.z1 + 1.4;
    if (from.z < zEnd - 0.6) return new THREE.Vector3(fromSide * (HOUSE.x + 1.1), Y0, zEnd);
    return new THREE.Vector3(toSide * (HOUSE.x + 1.1), Y0, zEnd);
  };

  // ---- the test autopilot: fight from the deckhouse lee, brace on the horn ----
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive || p.formT > 0) return {};
    const steer = (to: THREE.Vector3, stop = 0.35): AutopilotInput => {
      const dx = to.x - p.position.x, dz = to.z - p.position.z;
      const d = Math.hypot(dx, dz);
      const out: AutopilotInput = { shootHeld: true, yaw: Math.atan2(dx, dz) };
      if (d > stop) out.moveY = Math.min(1, d / 1.5);
      return out;
    };
    if (phase === 'docked') {
      if (p.cover) return { slamPressed: true };
      // round the front of the deckhouse, out through the gate, onto the pier
      const ways = [
        new THREE.Vector3((p.position.x < 0 ? -1 : 1) * (HOUSE.x + 1.3), Y0, HOUSE.z1 + 1.5),
        gateIn,
        new THREE.Vector3(PIER.x0 + 3, Y0, gateIn.z),
      ];
      let c = cursors[slot];
      if (c >= ways.length) c = ways.length - 1;
      const w = ways[c];
      if (Math.hypot(w.x - p.position.x, w.z - p.position.z) < 0.9 && c < ways.length - 1) c++;
      cursors[slot] = c;
      return steer(ways[c], 0.2);
    }
    cursors[slot] = 0;
    const side = roguePhase === 'idle' ? nextSide : rogueSide;
    const spot = leeSpot(slot, side);
    const incoming = roguePhase === 'telegraph' || roguePhase === 'sweep' || roguePhase === 'surge';
    if (incoming) {
      // on the horn: brace against whatever is at hand (one press, then hold
      // still), or get into the lee if there is nothing to hold
      if (p.cover) return { shootHeld: false };
      if (p.grounded && p.nearCover && !braceLatch[slot]) {
        braceLatch[slot] = true;
        return { slamPressed: true };
      }
      braceLatch[slot] = false;
      return steer(around(p.position, spot), 0.3);
    }
    braceLatch[slot] = false;
    // the wave has passed: let go of the wall
    if (p.cover) return { slamPressed: true };
    const out = steer(around(p.position, spot), 0.5);
    // in the lee: turn on the nearest boarder and fire
    if (!out.moveY) {
      let best: Enemy | null = null;
      let bestD = 30;
      for (const e of game.enemies) {
        if (!e.alive || e.team !== 1 || e.arriving) continue;
        const d = e.position.distanceTo(p.position);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) out.yaw = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
    }
    return out;
  };

  const dispose = (): void => {
    for (const p of game.players) p.sectionMove = null;
    if (started) game.board.waterY = savedWater;
    const mine = new Set(barrels.map((br) => br.b));
    if (game.board.breakables) game.board.breakables = game.board.breakables.filter((b) => !mine.has(b));
  };

  const inst: SectionInstance & { force: Record<string, (...a: number[]) => void> } = {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(-HB + 1.8 + Math.floor(i / 2) * 1.4, Y0, GATE_IN.z0 + 0.6 + (i % 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + MAST.top + 3,
    groundAt: () => Y0,
    contains: (x, z) => (Math.abs(x) < HB && z > STERN - 4.5 && z < 19)
      || (phase === 'docked' && x >= HB - 0.5 && x < PIER.x1 && z > PIER_Z0 && z < PIER_Z1),
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // the sea is caught in `update` (the harbour's own beat); this is for a body that got past it
    offPath: (pos) => pos.y < SEA_Y - 6,
    hud,
    autopilot,
    afterFrame,
    dispose,
    debug: () => ({
      phase, wave: waveIdx + 1, t: Math.round(phaseT), rogue: roguePhase, rogueCount, nextSide,
      roll: +THREE.MathUtils.radToDeg(tilt.roll).toFixed(1), boomLoose, boomHits, strikes, overboard, washedOver,
      alive: waveBodies.filter((e) => e.alive).length, pendingDrops,
      barrels: barrels.map((br) => (br.b.broken || br.lost ? null : +br.at.x.toFixed(2))),
    }),
    // for the mechanics suite (tools/test-section-squall.mjs)
    force: {
      quiet: (on = 1) => { quiet = !!on; },
      roll: (deg = NaN) => { rollOverride = Number.isNaN(deg) ? null : THREE.MathUtils.degToRad(deg); },
      rogue: (side = 1) => { rogueClock = 999; startRogue(side >= 0 ? 1 : -1); },
      lightning: () => { crackleT = 0; },
      boom: () => { boomLoose = true; arc.visible = true; },
      wave: (k = 0) => { startWave(k); },
      noRogue: () => { rogueClock = 1e9; },
      enemy: (x = 0, z = 0) => { ctx.spawn('quarren', new THREE.Vector3(x, Y0, z), { exact: true }); },
      finish: () => { for (const e of waveBodies) if (e.alive) e.damage(1e7, e.position, -1); waveIdx = WAVES.length - 1; phaseT = 999; launched = 99; phase = 'wave'; },
    },
  };
  return inst;
}

export const squall: SectionDef = {
  id: 'squall',
  build,
  // the storm's own air: close grey rain, the far shore gone
  world: { fogColor: 0x34414b, fogNear: 22, fogFar: 170, background: 0x3a4650 },
};
