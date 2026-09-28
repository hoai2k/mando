import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Vehicle } from '../game/vehicles';
import type { Player } from '../player/player';
import { Treadmill } from './kit/treadmill';
import { RideLedger } from './kit/mounts';
import { DefendTarget, type Defended } from './kit/objective';
import { composeMoves } from './kit/moves';
import { audio } from '../core/audio';
import { loadOptionalTexture } from '../core/assets';

/**
 * Guns of the Frigate (docs/LEVEL_SECTIONS.md §2.4) — the Spice Run, between
 * the approach (stage A, whose last room is the outer yard) and the inside of
 * the station (stage B, whose first room is the spice vault).
 *
 * The outer yard's way on is a docking-collar door in the station's hull
 * face. Its far side is the spice frigate's dorsal hatch: the party climbs
 * out onto the frigate's back as she casts off, and has to hold her while she
 * runs the pirate blockade round to the station's far dock. Every pirate who
 * can fly comes after her. There are four quad guns on the hull, and nobody
 * in a gun can shoot the deck.
 *
 * **Built on K2, K3 and K5.** The hull never moves (K2, `kit/treadmill.ts`):
 * the station face the collar let go of, the debris, the dust and at the end
 * the far dock go past it. The guns are K3 turrets (`game/vehicles.ts`,
 * `kind: 'turret'`, 200° arcs, heat, half-rate auto-fire when nobody is in
 * them). The hull's health is K5's bar (`DefendTarget` over the hull), and it
 * is the fail state: if it empties, the wave comes round again from its start
 * with the hull as it was when the wave began.
 *
 * The waves come in from four bearings (ahead, astern, port, starboard) and
 * are called on the radar four seconds before they arrive — the HUD line, a
 * red lamp flashing on that side of the hull, and the contacts themselves on
 * the radar from 120 m:
 *
 * 1. **Drones.** Interceptor swarms making runs at the hull; a hull strike
 *    costs the bar. A third of each swarm (with company) peels off to hunt
 *    whoever is on deck instead.
 * 2. **Gun-dropships.** Raider dropships on strafing passes down either
 *    flank, looping over the bow or stern to come back down the other side.
 * 3. **Boarding tubes.** A dropship that survives its run hovers beside a
 *    boarding point and latches a tube onto the deck edge. Pirates and a
 *    Pyke heavy pour out of it, and the latched tube drains the hull until
 *    somebody cuts its latch — melee, or a rocket; bolts spark off the clamp.
 *    The guns cannot depress onto the deck (and an unmanned gun locks onto
 *    the nearest body in its arc, so boarders and a latch *blind* it), which
 *    is the section's real question: who leaves their gun?
 * 4. **Everything.** Swarms, a gunship and tubes together.
 *
 * Then the finale: a **pirate corvette** comes up from astern and holds
 * station off the starboard side. Three shield domes on its back (shoot them
 * out — the starboard gun and the two on the centreline reach it, the port
 * gun does not), then its bridge. Every ten seconds or so it turns its nose
 * on the frigate and its spinal gun draws a red line across the deck: two and
 * a half seconds to get off it, gunners included. With the bridge gone it
 * breaks away burning, the far dock slides in from ahead, the frigate docks,
 * and the forward hatch opens: the way down, into the spice vault.
 *
 * The void is the edge. Over the side (the bulwarks are knee-high and have
 * gaps at the boarding points) is a fall into space, which returns you up
 * through the nearest hatch — as does dying.
 */

// ---------------------------------------------------------------- the hull

/** half the deck's beam, metres (22 m across) */
const HALF_W = 11;
/** the deck runs from the stern to the bow along +z: 70 m */
const STERN = -35;
const BOW = 35;
/** where the bow starts to taper */
const TAPER = 24;
const BOW_TIP_W = 2.5;
const DECK_T = 1.6;
/** the two dorsal hatches: aft (the party comes up it) and forward (the way down) */
const AFT_HATCH = new THREE.Vector3(0, 0, -12);
const FWD_HATCH = new THREE.Vector3(0, 0, 8);
const HATCH_HALF = 1.3;
const WELL_D = 4.2;
const BULWARK_H = 0.9;

type Bearing = 'ahead' | 'astern' | 'port' | 'starboard';
/** port is +x: the frigate faces +z, so her left hand is +x */
const BEARING: Record<Bearing, THREE.Vector3> = {
  ahead: new THREE.Vector3(0, 0, 1),
  astern: new THREE.Vector3(0, 0, -1),
  port: new THREE.Vector3(1, 0, 0),
  starboard: new THREE.Vector3(-1, 0, 0),
};

/** the four quad guns, in a diamond; slot 1 takes the first, slot 2 the next… */
const GUNS: { key: Bearing; x: number; z: number; yaw: number }[] = [
  { key: 'starboard', x: -7, z: 0, yaw: -Math.PI / 2 },
  { key: 'ahead', x: 0, z: 23, yaw: 0 },
  { key: 'astern', x: 0, z: -23, yaw: Math.PI },
  { key: 'port', x: 7, z: 0, yaw: Math.PI / 2 },
];
/** half of each gun's 200° arc */
const GUN_ARC = (100 * Math.PI) / 180;
/** the guns cannot depress onto their own deck */
const GUN_PITCH_MIN = 0.05;

/** the three boarding points on the deck edge (B1 port aft, B2 starboard, B3 port forward) */
const BOARD_PTS: { x: number; z: number; bearing: Bearing }[] = [
  { x: HALF_W, z: -15, bearing: 'port' },
  { x: -HALF_W, z: 5, bearing: 'starboard' },
  { x: HALF_W, z: 17, bearing: 'port' },
];
const BOARD_GAP = 2.2;

/** the hull's health, and what hurts it */
const HULL_HP = 1000;
const DRONE_STRIKE = 30;
const GUNSHIP_BURST = 8;
const TUBE_DRAIN = 8;
const SPINAL_HULL = 60;
const SPINAL_DMG = 70;
/**
 * What an unmanned gun's fire does to armour (gunships, the corvette's domes
 * and bridge). Its bolts carry no shooter (`bySlot` −1); a gun somebody is
 * aiming does full damage. The auto-fire is there to thin the drones — the
 * armoured work needs crew.
 */
const AUTO_VS_ARMOUR = 0.25;
/** seconds of warning before a contact arrives */
const RADAR_WARN = 4;
/** the spinal gun: telegraph, then the shot */
const SPINAL_WARN = 2.5;
const SPINAL_HALF = 2.0;

/** the treadmill's speeds, m/s of world going astern */
const CRUISE = 24;
const COMBAT = 18;
const APPROACH = 10;

/** the deck's half-beam at `z` (the bow tapers to a point) */
function halfW(z: number): number {
  if (z <= TAPER) return HALF_W;
  return Math.max(BOW_TIP_W, HALF_W - ((z - TAPER) / (BOW - TAPER)) * (HALF_W - BOW_TIP_W));
}
function onHull(x: number, z: number, margin = 0): boolean {
  return z >= STERN - margin && z <= BOW + margin && Math.abs(x) <= halfW(Math.min(BOW, z)) + margin;
}

const _v = new THREE.Vector3();

/** a point on the quadratic curve p0 → p1 → p2, and its derivative */
function bez(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return out.set(p0.x * a + p1.x * b + p2.x * c, p0.y * a + p1.y * b + p2.y * c, p0.z * a + p1.z * b + p2.z * c);
}
function bezD(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(
    2 * (1 - u) * (p1.x - p0.x) + 2 * u * (p2.x - p1.x),
    2 * (1 - u) * (p1.y - p0.y) + 2 * u * (p2.y - p1.y),
    2 * (1 - u) * (p1.z - p0.z) + 2 * u * (p2.z - p1.z),
  );
}
function bezLen(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): number {
  let len = 0;
  const a = p0.clone(), b = new THREE.Vector3();
  for (let i = 1; i <= 10; i++) { bez(p0, p1, p2, i / 10, b); len += a.distanceTo(b); a.copy(b); }
  return Math.max(1, len);
}

// ---------------------------------------------------------------- the waves

type EventKind = 'swarm' | 'gunship' | 'board';
interface WaveEvent {
  at: number;
  kind: EventKind;
  bearing: Bearing;
  /** a swarm's size */
  n?: number;
  /** a boarding point */
  pt?: number;
  /** hold this one until no tube is latched (one tube at a time) */
  oneTube?: boolean;
}

/** the four waves before the corvette, scaled to the party */
function waveScript(k: number, party: number): WaveEvent[] {
  const p = party;
  switch (k) {
    case 0: return [
      { at: RADAR_WARN, kind: 'swarm', bearing: 'ahead', n: 4 + 2 * p },
      { at: 14, kind: 'swarm', bearing: 'port', n: 3 + 2 * p },
      // two bearings at once: one gun cannot cover both
      { at: 24, kind: 'swarm', bearing: 'starboard', n: 3 + p },
      { at: 24, kind: 'swarm', bearing: 'astern', n: 2 + p },
    ];
    case 1: return [
      { at: RADAR_WARN, kind: 'gunship', bearing: 'astern' },
      { at: 8, kind: 'swarm', bearing: 'port', n: 3 + p },
      { at: p >= 2 ? 16 : 24, kind: 'gunship', bearing: 'starboard' },
      { at: 28, kind: 'swarm', bearing: 'ahead', n: 3 + p },
    ];
    case 2: return [
      { at: RADAR_WARN, kind: 'board', bearing: 'port', pt: 0 },
      { at: 10, kind: 'swarm', bearing: 'ahead', n: 3 + p },
      { at: 18, kind: 'board', bearing: 'port', pt: 2, oneTube: p === 1 },
      { at: 26, kind: 'gunship', bearing: 'astern' },
      ...(p >= 3 ? [{ at: 32, kind: 'swarm' as const, bearing: 'starboard' as const, n: 2 + p }] : []),
    ];
    default: return [
      { at: RADAR_WARN, kind: 'board', bearing: 'starboard', pt: 1 },
      { at: 8, kind: 'gunship', bearing: 'ahead' },
      { at: 14, kind: 'swarm', bearing: 'astern', n: 3 + p },
      { at: p >= 3 ? 16 : 24, kind: 'board', bearing: 'port', pt: 0, oneTube: p <= 2 },
      { at: 22, kind: 'swarm', bearing: 'port', n: 3 + p },
      ...(p >= 2 ? [{ at: 30, kind: 'gunship' as const, bearing: 'port' as const }] : []),
    ];
  }
}
const WAVES = 4;

// ---------------------------------------------------------------- the stand-ins

/** `raider_dropship`: ~14 m, +z forward, origin under the belly */
function dropshipStandIn(): THREE.Group {
  const g = new THREE.Group();
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a4a30, roughness: 0.8, metalness: 0.4 });
  const bare = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.55, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x4a90c0, emissiveIntensity: 0.6, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x7fd0ff });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.0, 10), rust);
  body.position.set(0, 2.2, -0.5);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1.9, 12, 8), glass);
  nose.scale.set(1, 0.8, 1.2);
  nose.position.set(0.3, 2.6, 5.2);
  const patch = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.2, 3.4), bare);
  patch.position.set(0, 3.2, -2.2);
  const bay = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 5), bare);
  bay.position.set(0, 0.5, -0.5);
  g.add(body, nose, patch, bay);
  for (const [x, z] of [[-3.4, 2.5], [3.6, 2.2], [-3.3, -4], [3.5, -4.3]]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.8), bare);
    pylon.position.set(x * 0.72, 2.4, z);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 3.2, 10), rust);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(x, 2.4, z);
    const jet = new THREE.Mesh(new THREE.CircleGeometry(0.6, 10), glow);
    jet.position.set(x, 2.4, z - 1.62);
    jet.rotation.y = Math.PI;
    g.add(pylon, pod, jet);
  }
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.6, 8), bare);
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, 0.6, 4.2);
  g.add(gun);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return g;
}

/** `boarding_tube`: 3 m Ø × 8 m, the clamp collar (`latch`) at the origin, the tube along +z */
function tubeStandIn(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.85, metalness: 0.35 });
  const rib = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.6, metalness: 0.6 });
  const red = new THREE.MeshBasicMaterial({ color: 0xff3a24 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 7.6, 14, 1, true), skin);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 4.2;
  g.add(tube);
  for (let i = 0; i < 6; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.14, 6, 16), rib);
    r.position.z = 1.2 + i * 1.3;
    g.add(r);
  }
  const latch = new THREE.Group();
  latch.name = 'latch';
  const collar = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.35, 8, 20), rib);
  latch.add(collar);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.9), rib);
    tooth.position.set(Math.cos(a) * 1.75, Math.sin(a) * 1.75, -0.2);
    tooth.rotation.z = a;
    latch.add(tooth);
  }
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), red);
    lamp.position.set(s * 1.2, 1.2, -0.3);
    latch.add(lamp);
  }
  g.add(latch);
  return g;
}

/** `pirate_corvette`: ~60 m, +z forward, origin at the keel; `gen_0..2`, `spine_gun`, `bridge` */
function corvetteStandIn(): THREE.Group {
  const g = new THREE.Group();
  const rust = new THREE.MeshStandardMaterial({ color: 0x6e4630, roughness: 0.85, metalness: 0.35 });
  const bare = new THREE.MeshStandardMaterial({ color: 0x7d838a, roughness: 0.55, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2f34, roughness: 0.7, metalness: 0.5 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x7fd0ff });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 46), rust);
  hull.position.set(0, 3.5, -2);
  const belly = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 40), dark);
  belly.position.set(0, 0.5, -1);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 5.6, 12, 4, 1), rust);
  nose.rotation.x = Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.set(0, 3.5, 27);
  nose.scale.set(1, 1, 0.8);
  g.add(hull, belly, nose);
  for (const [x, y, z, sx, sy, sz] of [[5.3, 4.5, 6, 0.8, 3, 12], [-5.3, 2.5, -8, 0.8, 3.5, 14], [0, 7.2, 10, 6, 0.6, 9]]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), bare);
    slab.position.set(x, y, z);
    g.add(slab);
  }
  // the spinal gun: a long barrel under the keel, out past the nose
  const spine = new THREE.Group();
  spine.name = 'spine_gun';
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 26, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, 0);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.9, 1.6, 10), bare);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0, 13);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), new THREE.MeshBasicMaterial({ color: 0xff5a2a }));
  bore.name = 'bore';
  bore.position.set(0, 0, 13.85);
  spine.add(barrel, muzzle, bore);
  spine.position.set(0, -0.6, 20);
  g.add(spine);
  // the bridge: a block at the stern, windows lit
  const bridge = new THREE.Group();
  bridge.name = 'bridge';
  const block = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 8), bare);
  const win = new THREE.Mesh(new THREE.BoxGeometry(7.1, 0.7, 0.3), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  win.position.set(0, 0.8, 4.05);
  bridge.add(block, win);
  bridge.position.set(0, 9, -18);
  g.add(bridge);
  // three shield-generator domes on pylons
  for (let i = 0; i < 3; i++) {
    const gen = new THREE.Group();
    gen.name = `gen_${i}`;
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 2.4, 10), dark);
    pylon.position.y = -1.6;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a6cff, emissive: 0x2a60ff, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.2 }));
    gen.add(pylon, dome);
    gen.position.set(0, 9.6, -4 + i * 11);
    g.add(gen);
  }
  // mismatched engine pods astern
  for (const [x, y, r] of [[-4.5, 4.5, 2.0], [4.5, 4.5, 1.7], [0, 1.5, 1.6], [0, 7.5, 1.3]]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, 7, 12), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(x, y, -27);
    const jet = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 12), glow);
    jet.position.set(x, y, -30.55);
    jet.rotation.y = Math.PI;
    g.add(pod, jet);
  }
  return g;
}

// ---------------------------------------------------------------- the section

interface Drone { e: Enemy; role: 'hull' | 'hunter'; p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; u: number; len: number; speed: number }

interface Ship {
  kind: 'gunship' | 'board';
  e: Enemy;
  model: THREE.Group;
  state: 'inbound' | 'pass' | 'loop' | 'latching' | 'latched' | 'leaving' | 'wreck';
  t: number;
  /** the curve it is flying, and how far along */
  p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3; u: number; len: number; speed: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  roll: number;
  /** a gunship's side (+1 port, −1 starboard) and pass direction along z */
  side: number;
  dir: number;
  fireT: number;
  tube: Tube | null;
  pt: number;
}

interface Tube {
  pt: number;
  holder: THREE.Group;
  latch: Enemy | null;
  queue: EnemyKind[];
  nextT: number;
  ext: number;
  cut: boolean;
  bodies: Enemy[];
  ship: Ship;
  fall: number;
}

interface Gen { i: number; e: Enemy | null; node: THREE.Object3D | null; down: boolean }

type Phase = 'castoff' | 'wave' | 'breather' | 'corvette' | 'broken' | 'docking' | 'docked';

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['frigate-guns'];
  const party = Math.max(1, game.players.length);
  const P = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, Y0 + y, z);

  // ---- materials ----
  const plate = ctx.paint(0x5a606a, { rough: 0.75, metal: 0.45 });
  ctx.tile(plate, 'hull_plate_large', 1 / 8, 1 / 8, { normal: true });
  const hullSide = ctx.paint(0x3e434c, { rough: 0.8, metal: 0.4 });
  ctx.tile(hullSide, 'metal_hull', 1 / 10, 1 / 10);
  const rust = ctx.paint(0x6e4a34, { rough: 0.85, metal: 0.3 });
  ctx.tile(rust, 'rust_hull', 1 / 6, 1 / 6);
  const dark = ctx.paint(0x24272c, { rough: 0.7, metal: 0.5 });
  const trim = ctx.paint(spec.palette.trim, { rough: 0.6, metal: 0.5 });
  const stripe = ctx.paint(0xd8b030, { rough: 0.7, metal: 0.2 });
  ctx.tile(stripe, 'hazard_stripe', 1, 1);
  const lampOff = new THREE.MeshBasicMaterial({ color: 0x401010 });
  ctx.own(lampOff);
  const green = new THREE.MeshBasicMaterial({ color: 0x5aff8a });
  ctx.own(green);
  const amber = new THREE.MeshBasicMaterial({ color: 0xffb040 });
  ctx.own(amber);

  // ---- the deck: one slab with the forward hatch cut through it ----
  // The outline in the plan (x, −z), extruded upward, so its top face is the
  // deck and the hatch is a real hole into the well below.
  const outline = (): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-HALF_W, -STERN);
    s.lineTo(HALF_W, -STERN);
    s.lineTo(HALF_W, -TAPER);
    s.lineTo(BOW_TIP_W, -BOW);
    s.lineTo(-BOW_TIP_W, -BOW);
    s.lineTo(-HALF_W, -TAPER);
    s.closePath();
    return s;
  };
  const deckShape = outline();
  const hole = new THREE.Path();
  hole.moveTo(FWD_HATCH.x - HATCH_HALF, -(FWD_HATCH.z - HATCH_HALF));
  hole.lineTo(FWD_HATCH.x - HATCH_HALF, -(FWD_HATCH.z + HATCH_HALF));
  hole.lineTo(FWD_HATCH.x + HATCH_HALF, -(FWD_HATCH.z + HATCH_HALF));
  hole.lineTo(FWD_HATCH.x + HATCH_HALF, -(FWD_HATCH.z - HATCH_HALF));
  hole.closePath();
  deckShape.holes.push(hole);
  const deckGeo = ctx.own(new THREE.ExtrudeGeometry(deckShape, { depth: DECK_T, bevelEnabled: false }));
  const deck = new THREE.Mesh(deckGeo, [plate, hullSide]);
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = Y0 - DECK_T;
  deck.receiveShadow = true;
  ctx.mesh(deck);

  // its colliders: boxes round the hatch, and the bow as a run of slices
  const slab = (x0: number, x1: number, z0: number, z1: number): void => {
    ctx.box((x0 + x1) / 2, Y0 - DECK_T / 2, (z0 + z1) / 2, x1 - x0, DECK_T, z1 - z0, null);
  };
  const hz0 = FWD_HATCH.z - HATCH_HALF, hz1 = FWD_HATCH.z + HATCH_HALF;
  slab(-HALF_W, HALF_W, STERN, hz0);
  slab(-HALF_W, -HATCH_HALF, hz0, hz1);
  slab(HATCH_HALF, HALF_W, hz0, hz1);
  slab(-HALF_W, HALF_W, hz1, TAPER);
  for (let z = TAPER; z < BOW; z += 1) {
    const w = halfW(z + 0.5);
    slab(-w, w, z, Math.min(BOW, z + 1));
  }

  // ---- the hull under the deck: the flanks fall away into the void ----
  const bodyGeo = ctx.own(new THREE.ExtrudeGeometry(outline(), { depth: 10, bevelEnabled: false }));
  const body = new THREE.Mesh(bodyGeo, [hullSide, rust]);
  body.rotation.x = -Math.PI / 2;
  body.scale.set(0.97, 1, 1);
  body.position.y = Y0 - DECK_T - 10;
  ctx.mesh(body);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 62), hullSide);
  ctx.own(keel.geometry);
  keel.position.set(0, Y0 - DECK_T - 14, -3);
  ctx.mesh(keel);
  // a row of lit ports along each flank, so the side reads as a ship's side
  const portGeo = ctx.own(new THREE.BoxGeometry(0.2, 0.4, 0.55));
  for (const sx of [-1, 1]) {
    for (const [y, step] of [[-3.4, 2.6], [-6.8, 4.1]] as const) {
      for (let z = STERN + 4; z < TAPER - 2; z += step) {
        if (Math.sin(z * 1.7 + y) > 0.6) continue;
        const port = new THREE.Mesh(portGeo, amber);
        port.position.set(sx * (HALF_W * 0.97 + 0.02), Y0 + y, z);
        ctx.mesh(port);
      }
    }
  }
  // the engine block astern, below the deck, with three bells burning blue
  const engine = new THREE.Mesh(new THREE.BoxGeometry(20, 9, 10), dark);
  ctx.own(engine.geometry);
  engine.position.set(0, Y0 - 7, STERN - 5);
  ctx.mesh(engine);
  const plumeMat = new THREE.MeshBasicMaterial({ color: 0x6ab8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  ctx.own(plumeMat);
  const plumes: THREE.Mesh[] = [];
  for (const x of [-6.5, 0, 6.5]) {
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 4, 16, 1, true), trim);
    ctx.own(bell.geometry);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(x, Y0 - 7, STERN - 12);
    ctx.mesh(bell);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(2.4, 16, 16, 1, true), plumeMat);
    ctx.own(plume.geometry);
    plume.rotation.x = Math.PI / 2;
    plume.position.set(x, Y0 - 7, STERN - 22);
    ctx.mesh(plume);
    plumes.push(plume);
  }
  const engineLight = new THREE.PointLight(0x6ab8ff, 0, 60, 1.4);
  engineLight.position.set(0, Y0 - 4, STERN - 12);
  ctx.mesh(engineLight);
  // a sensor mast at the bow tip, a landmark down the length of the deck
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 7, 8), trim);
  ctx.own(mast.geometry);
  mast.position.set(0, Y0 + 3.5, BOW - 1.2);
  ctx.mesh(mast);

  // ---- bulwarks: knee-high armour along both flanks, open at the boarding points ----
  const bulwarkRuns = (side: number): [number, number][] => {
    const gaps = BOARD_PTS.filter((b) => Math.sign(b.x) === side).map((b) => b.z).sort((a, b) => a - b);
    const runs: [number, number][] = [];
    let from = STERN + 1.5;
    for (const g of gaps) { runs.push([from, g - BOARD_GAP]); from = g + BOARD_GAP; }
    runs.push([from, TAPER - 0.5]);
    return runs;
  };
  for (const side of [-1, 1]) {
    for (const [z0, z1] of bulwarkRuns(side)) {
      if (z1 - z0 < 0.5) continue;
      const armour = ctx.paint(0x7a7068, { rough: 0.8, metal: 0.45 });
      ctx.tile(armour, 'rust_hull', (z1 - z0) / 5, 0.3);
      ctx.box(side * (HALF_W - 0.3), Y0 + BULWARK_H / 2, (z0 + z1) / 2, 0.6, BULWARK_H, z1 - z0, armour);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, z1 - z0), stripe);
      ctx.own(band.geometry);
      band.position.set(side * (HALF_W - 0.3), Y0 + BULWARK_H + 0.02, (z0 + z1) / 2);
      ctx.mesh(band);
    }
  }

  // ---- deck furniture: low vent housings, cover for the fight on the deck ----
  const COVER: [number, number, number, number][] = [
    [4.2, -6, 2.4, 1.6], [-4.2, -6, 2.4, 1.6], [4.5, 12, 1.8, 2.6], [-4.5, 14, 1.8, 2.6], [-5, -17, 2.2, 1.6], [5.2, -26, 1.8, 2],
  ];
  const housing = ctx.paint(0x6a7079, { rough: 0.7, metal: 0.5 });
  ctx.tile(housing, 'hull_plate_large', 0.5, 0.5);
  for (const [x, z, sx, sz] of COVER) {
    ctx.box(x, Y0 + 0.6, z, sx, 1.2, sz, housing);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.8, 0.05, sz * 0.8), trim);
    ctx.own(grille.geometry);
    grille.position.set(x, Y0 + 1.23, z);
    ctx.mesh(grille);
  }
  // a pipe run down the centreline between the hatches: ankle-high dressing, not a wall
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 14, 8), trim);
  ctx.own(pipe.geometry);
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(1.9, Y0 + 0.2, -2);
  ctx.mesh(pipe);

  // ---- the gun rings: a lit ring on the deck round each quad gun ----
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x63b4ff, transparent: true, opacity: 0.6 });
  ctx.own(ringMat);
  for (const gn of GUNS) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.45, 32), ringMat);
    ctx.own(ring.geometry);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(gn.x, Y0 + 0.03, gn.z);
    ctx.mesh(ring);
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.3, 0.18, 24), dark);
    ctx.own(bed.geometry);
    bed.position.set(gn.x, Y0 + 0.09, gn.z);
    ctx.mesh(bed);
  }

  // ---- the boarding points: clamp sockets on the edge, striped ----
  for (const b of BOARD_PTS) {
    const s = Math.sign(b.x);
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, BOARD_GAP * 2 - 0.4), stripe);
    ctx.own(socket.geometry);
    socket.position.set(b.x - s * 0.5, Y0 + 0.05, b.z);
    ctx.mesh(socket);
  }

  // ---- the hatches ----
  const coaming = (at: THREE.Vector3, lamp: THREE.Material): THREE.Mesh[] => {
    const lamps: THREE.Mesh[] = [];
    for (const [dx, dz, sx, sz] of [[0, HATCH_HALF + 0.15, HATCH_HALF * 2 + 0.6, 0.3], [0, -HATCH_HALF - 0.15, HATCH_HALF * 2 + 0.6, 0.3],
      [HATCH_HALF + 0.15, 0, 0.3, HATCH_HALF * 2], [-HATCH_HALF - 0.15, 0, 0.3, HATCH_HALF * 2]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.3, sz), trim);
      ctx.own(c.geometry);
      c.position.set(at.x + dx, Y0 + 0.15, at.z + dz);
      ctx.mesh(c);
    }
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), lamp);
      ctx.own(l.geometry);
      l.position.set(at.x + dx * (HATCH_HALF + 0.15), Y0 + 0.38, at.z + dz * (HATCH_HALF + 0.15));
      ctx.mesh(l);
      lamps.push(l);
    }
    return lamps;
  };
  // the aft hatch: the one the party climbed out of. It shuts behind them.
  coaming(AFT_HATCH, amber);
  const aftLid = new THREE.Group();
  const aftLidMesh = new THREE.Mesh(new THREE.BoxGeometry(HATCH_HALF * 2, 0.16, HATCH_HALF * 2), trim);
  ctx.own(aftLidMesh.geometry);
  aftLidMesh.position.set(0, 0.08, HATCH_HALF);
  aftLid.add(aftLidMesh);
  aftLid.position.set(AFT_HATCH.x, Y0, AFT_HATCH.z - HATCH_HALF);
  aftLid.rotation.x = -Math.PI * 0.55;   // standing open at the start
  ctx.mesh(aftLid);
  const aftGlow = new THREE.PointLight(0xffc080, 6, 8, 1.5);
  aftGlow.position.set(AFT_HATCH.x, Y0 + 0.6, AFT_HATCH.z);
  ctx.mesh(aftGlow);
  const aftShaft = new THREE.Mesh(new THREE.PlaneGeometry(HATCH_HALF * 2, HATCH_HALF * 2), new THREE.MeshBasicMaterial({ color: 0xffb070 }));
  ctx.own(aftShaft.geometry); ctx.own(aftShaft.material as THREE.Material);
  aftShaft.rotation.x = -Math.PI / 2;
  aftShaft.position.set(AFT_HATCH.x, Y0 + 0.02, AFT_HATCH.z);
  ctx.mesh(aftShaft);
  // the forward hatch: a real well down into the frigate, shut until she docks
  const fwdLamps = coaming(FWD_HATCH, lampOff);
  const wellWall = (dx: number, dz: number, sx: number, sz: number): void => {
    ctx.box(FWD_HATCH.x + dx, Y0 - WELL_D / 2, FWD_HATCH.z + dz, sx, WELL_D, sz, dark);
  };
  wellWall(HATCH_HALF + 0.25, 0, 0.5, HATCH_HALF * 2 + 1);
  wellWall(-HATCH_HALF - 0.25, 0, 0.5, HATCH_HALF * 2 + 1);
  wellWall(0, HATCH_HALF + 0.25, HATCH_HALF * 2, 0.5);
  wellWall(0, -HATCH_HALF - 0.25, HATCH_HALF * 2, 0.5);
  ctx.box(FWD_HATCH.x, Y0 - WELL_D - 0.25, FWD_HATCH.z, HATCH_HALF * 2 + 1, 0.5, HATCH_HALF * 2 + 1, dark);
  const wellLight = new THREE.PointLight(0x7affa0, 0, 10, 1.5);
  wellLight.position.set(FWD_HATCH.x, Y0 - WELL_D + 1, FWD_HATCH.z);
  ctx.mesh(wellLight);
  for (const sx of [-0.5, 0.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, WELL_D, 0.08), trim);
    ctx.own(rail.geometry);
    rail.position.set(FWD_HATCH.x + sx, Y0 - WELL_D / 2, FWD_HATCH.z + HATCH_HALF - 0.1);
    ctx.mesh(rail);
  }
  const fwdLid = ctx.box(FWD_HATCH.x, Y0 - 0.2, FWD_HATCH.z, HATCH_HALF * 2, 0.4, HATCH_HALF * 2, null);
  const fwdLidPivot = new THREE.Group();
  const fwdLidMesh = new THREE.Mesh(new THREE.BoxGeometry(HATCH_HALF * 2, 0.4, HATCH_HALF * 2), trim);
  ctx.own(fwdLidMesh.geometry);
  fwdLidMesh.position.set(0, -0.2, HATCH_HALF);
  fwdLidPivot.add(fwdLidMesh);
  fwdLidPivot.position.set(FWD_HATCH.x, Y0, FWD_HATCH.z - HATCH_HALF);
  ctx.mesh(fwdLidPivot);

  // ---- the radar lamps: one on each side of the hull, red when a contact comes that way ----
  const lampSpots: Record<Bearing, THREE.Vector3> = {
    ahead: P(0, 7.2, BOW - 1.2), astern: P(0, 2.2, STERN + 0.6),
    port: P(HALF_W - 0.3, 2.2, -6), starboard: P(-HALF_W + 0.3, 2.2, -6),
  };
  const redLamp = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  ctx.own(redLamp);
  const radarLamps = {} as Record<Bearing, { mesh: THREE.Mesh; light: THREE.PointLight }>;
  for (const b of Object.keys(lampSpots) as Bearing[]) {
    const at = lampSpots[b];
    if (b !== 'ahead') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, at.y - Y0, 6), trim);
      ctx.own(post.geometry);
      post.position.set(at.x, (at.y + Y0) / 2, at.z);
      ctx.mesh(post);
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampOff);
    ctx.own(mesh.geometry);
    mesh.position.copy(at);
    ctx.mesh(mesh);
    const light = new THREE.PointLight(0xff2a1a, 0, 22, 1.6);
    light.position.copy(at);
    ctx.mesh(light);
    radarLamps[b] = { mesh, light };
  }

  // ---- space: the sun, a planet, the station she left, and the scroll ----
  const sun = new THREE.DirectionalLight(0xf4f0ea, 1.35);
  sun.position.set(-160, Y0 + 140, 90);
  sun.target.position.set(0, Y0, 0);
  ctx.mesh(sun);
  ctx.mesh(sun.target);
  const rim = new THREE.HemisphereLight(0x9ab8ff, 0x1a1c24, 0.6);
  ctx.mesh(rim);
  const planetMat = new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 1, metalness: 0 });
  ctx.own(planetMat);
  loadOptionalTexture('planet_station', (tex) => { planetMat.map = tex; planetMat.color.set(0xffffff); planetMat.needsUpdate = true; }, { exts: ['png'] });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(2200, 64, 32), planetMat);
  ctx.own(planet.geometry);
  planet.position.set(1400, Y0 - 2600, 900);
  ctx.mesh(planet);

  const mill = new Treadmill({ dir: new THREE.Vector3(0, 0, -1), speed: 0, ease: 4 });
  ctx.own(mill);

  // The station face the collar let go of: a wall of hull astern, lit ports,
  // the docking collar at her stern. It stays put while she lies docked, then
  // recedes astern for the whole section.
  const stationMat = ctx.paint(0x4a5262, { rough: 0.8, metal: 0.4 });
  ctx.tile(stationMat, 'panel_white', 14, 9);
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffd79a });
  ctx.own(windowMat);
  const stationFace = (w: number, h: number, withBay: boolean): THREE.Group => {
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.BoxGeometry(w, h, 30), stationMat);
    ctx.own(face.geometry);
    g.add(face);
    // lit ports in rows, one row under each deck rib, with dark gaps
    const winGeo = ctx.own(new THREE.BoxGeometry(2.2, 1.1, 0.4));
    for (let row = 0; row < 5; row++) {
      const wy = -h / 2 + (row + 0.5) * (h / 5) - 6;
      for (let wx = -w / 2 + 8; wx < w / 2 - 8; wx += 4.5) {
        if (Math.sin(wx * 0.37 + row * 2.1) > 0.55) continue;
        if (withBay && Math.abs(wx) < 28 && Math.abs(wy + 6) < 22) continue;
        const m = new THREE.Mesh(winGeo, windowMat);
        m.position.set(wx, wy, 15.1);
        g.add(m);
      }
    }
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(w, 3, 4), dark);
      ctx.own(rib.geometry);
      rib.position.set(0, -h / 2 + (i + 0.5) * (h / 5), 16);
      g.add(rib);
    }
    return g;
  };
  const station = stationFace(320, 200, false);
  station.rotation.y = Math.PI;       // its lit face toward the frigate
  station.position.set(0, Y0 - 10, STERN - 60);
  ctx.mesh(station);
  const collar = new THREE.Group();
  const collarRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.7, 10, 24), trim);
  ctx.own(collarRing.geometry);
  collar.add(collarRing);
  const collarTube = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1, 16, 1, true), dark);
  ctx.own(collarTube.geometry);
  collarTube.rotation.x = Math.PI / 2;
  collar.add(collarTube);
  ctx.mesh(collar);
  const collarLen = 60 - 15 - 12;     // from the station face to the engine block
  const stationItem = mill.conveyor(station, { behind: 6000 });
  const layCollar = (k: number): void => {
    // k: 1 = mated, 0 = drawn back into the station face
    const faceZ = stationItem.pos.z + 15;
    const len = Math.max(0.1, collarLen * k);
    collarTube.scale.set(1, len, 1);
    collarTube.position.set(0, 0, len / 2);
    collar.position.set(0, Y0 - 7, faceZ);
    collarRing.position.set(0, 0, 0.3);
  };
  layCollar(1);

  // debris: rocks and hull fragments, recycled round the loop
  const rockMat = ctx.paint(0x5a524c, { rough: 1, metal: 0.05 });
  const debris: { obj: THREE.Mesh; spin: THREE.Vector3 }[] = [];
  for (let i = 0; i < 34; i++) {
    let x = 0, y = 0;
    do {
      x = (Math.random() - 0.5) * 320;
      y = (Math.random() - 0.5) * 160 - 10;
    } while (Math.abs(x) < 34 && Math.abs(y) < 26);
    const r = 1.5 + Math.random() * (Math.abs(x) > 80 ? 11 : 5);
    const shard = i % 5 === 0;
    const geo = ctx.own(shard ? new THREE.BoxGeometry(r * 1.6, r * 0.25, r * 0.9) : new THREE.DodecahedronGeometry(r, 0));
    const m = new THREE.Mesh(geo, shard ? hullSide : rockMat);
    m.position.set(x, Y0 + y, -300 + Math.random() * 600);
    m.scale.set(1, 0.6 + Math.random() * 0.6, 0.8 + Math.random() * 0.5);
    ctx.mesh(m);
    mill.conveyor(m, { behind: 300, loop: 600 });
    debris.push({ obj: m, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6) });
  }

  // dust: short streaks going by the hull — what sells the speed
  const STREAKS = 420;
  const streakPos = new Float32Array(STREAKS * 6);
  const streakBase = new Float32Array(STREAKS * 3);
  for (let i = 0; i < STREAKS; i++) {
    let x = 0, y = 0;
    do { x = (Math.random() - 0.5) * 140; y = (Math.random() - 0.5) * 70; } while (Math.abs(x) < 12 && y < 3 && y > -14);
    streakBase[i * 3] = x;
    streakBase[i * 3 + 1] = Y0 + y;
    streakBase[i * 3 + 2] = (Math.random() - 0.5) * 260;
  }
  const streakGeo = ctx.own(new THREE.BufferGeometry());
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  const streakMat = new THREE.LineBasicMaterial({ color: 0xbfd4ff, transparent: true, opacity: 0.5 });
  ctx.own(streakMat);
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  ctx.mesh(streaks);
  const layStreaks = (dt: number): void => {
    const v = mill.speed;
    const len = Math.min(9, 0.12 * v + 0.05);
    for (let i = 0; i < STREAKS; i++) {
      let z = streakBase[i * 3 + 2] - v * dt * 1.6;
      if (z < -130) z += 260;
      streakBase[i * 3 + 2] = z;
      const x = streakBase[i * 3], y = streakBase[i * 3 + 1];
      streakPos.set([x, y, z, x, y, z + len], i * 6);
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakMat.opacity = Math.min(0.55, v / 30);
  };
  layStreaks(0);

  // the far dock: two gantry arms and the station wall ahead, brought in at the end
  const dock = new THREE.Group();
  dock.visible = false;
  const dockWall = stationFace(300, 180, true);
  dockWall.rotation.y = Math.PI;
  dockWall.position.set(0, -6, 90);
  dock.add(dockWall);
  const bayGlow = new THREE.Mesh(new THREE.PlaneGeometry(50, 34), new THREE.MeshBasicMaterial({ color: 0x9ad0ff }));
  ctx.own(bayGlow.geometry); ctx.own(bayGlow.material as THREE.Material);
  bayGlow.position.set(0, -6, 74.8);
  bayGlow.rotation.y = Math.PI;
  dock.add(bayGlow);
  const clamps: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 110), stationMat);
    ctx.own(arm.geometry);
    arm.position.set(sx * 24, -8, 20);
    dock.add(arm);
    for (const z of [-20, 0, 20]) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 3), trim);
      ctx.own(clamp.geometry);
      clamp.position.set(sx * 20, -5.5, z);
      dock.add(clamp);
      clamps.push(clamp);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), green);
      ctx.own(lamp.geometry);
      lamp.position.set(sx * 21.5, -1, z);
      dock.add(lamp);
    }
  }
  dock.position.set(0, Y0, 0);
  ctx.mesh(dock);

  // ---- the pools: dropships, tubes, the corvette ----
  // `ctx.prop` hands back the sculpt's holder; the stand-in is its sibling
  // under one parent. The parent is what flies: moved, both go.
  const flying = (id: string, size: number, fallback: () => THREE.Object3D): { rig: THREE.Group; sculpt: THREE.Group } => {
    const sculpt = ctx.prop(id, new THREE.Vector3(0, 0, 0), { size, fallback });
    const rig = sculpt.parent as THREE.Group;
    rig.visible = false;
    return { rig, sculpt };
  };
  const shipModels: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) shipModels.push(flying('raider_dropship', 14, dropshipStandIn).rig);
  const tubeModels = BOARD_PTS.map(() => flying('boarding_tube', 8, tubeStandIn).rig);
  const corvetteProp = flying('pirate_corvette', 60, corvetteStandIn);
  const corvette = corvetteProp.rig;
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x5aa0ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  ctx.own(shieldMat);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), shieldMat);
  ctx.own(shield.geometry);
  shield.scale.set(10, 9, 36);
  shield.position.set(0, 5, 0);
  corvette.add(shield);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff7040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  ctx.own(beamMat);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1, 12, 1, true), beamMat);
  ctx.own(beam.geometry);
  beam.visible = false;
  ctx.mesh(beam);
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0, depthWrite: false });
  ctx.own(laneMat);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, SPINAL_HALF * 2), laneMat);
  ctx.own(lane.geometry);
  lane.rotation.x = -Math.PI / 2;
  lane.visible = false;
  ctx.mesh(lane);
  const laneEdgeMat = new THREE.MeshBasicMaterial({ color: 0xffd0a0, transparent: true, opacity: 0 });
  ctx.own(laneEdgeMat);
  const laneEdges = [-1, 1].map((s) => {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 0.18), laneEdgeMat);
    ctx.own(e.geometry);
    e.rotation.x = -Math.PI / 2;
    e.userData.side = s;
    e.visible = false;
    ctx.mesh(e);
    return e;
  });

  // ---- state ----
  let phase: Phase = 'castoff';
  let phaseT = 0;
  let waveIdx = 0;
  let waveT = 0;
  let fired: boolean[] = [];
  let told: boolean[] = [];
  let complete = false;
  let started = false;
  let docked = false;
  let dockItem: ReturnType<typeof mill.conveyor> | null = null;
  let lidOpen = 0;
  let deckToned = false;
  let stationToned = false;
  let housingToned = false;
  let hullCheckpoint = HULL_HP;
  let rides: RideLedger | null = null;
  const guns: Vehicle[] = [];
  const drones: Drone[] = [];
  const ships: Ship[] = [];
  const tubes: Tube[] = [];
  const boarders: Enemy[] = [];
  const radar: { bearing: Bearing; what: EventKind | 'corvette'; t: number }[] = [];
  const cursors = [0, 0, 0, 0];
  /** the latch a player's blade is about to land on (melee is what cuts a latch) */
  let meleeOn: Enemy | null = null;
  ctx.checkpoint.set(AFT_HATCH.x, Y0, AFT_HATCH.z + 2.6);

  // ---- the hull bar (K5) ----
  const hull = new DefendTarget<Defended>(game, {
    make: (post) => ({ position: post, velocity: new THREE.Vector3(), alive: true, hp: HULL_HP, maxHp: HULL_HP, team: 0 }),
    post: P(0, 0, 0), leash: 1, reform: 3.5, weight: 1,
    onDown: () => breach(),
    onUp: () => { hull.body.hp = hullCheckpoint; },
  });
  const hullHit = (n: number): void => {
    const b = hull.body;
    if (hull.down || phase === 'docking' || phase === 'docked' || phase === 'broken') return;
    b.hp = Math.max(0, b.hp - n);
    if (b.hp <= 0) b.alive = false;
    for (const p of game.players) if (p.alive) p.cam.shake(Math.min(0.05, 0.004 * n));
  };

  // ---- hit-proxies ----
  // A dropship, a latch, a dome and a bridge are things the guns, the
  // blasters, the blades and the radar all have to find. The engine's one
  // shape for that is an enemy body, so each is a hidden body the section
  // drives (`Enemy.scripted`) and sizes to the thing it stands for; its
  // visuals are the section's own. Turret soft-lock, lock-on and the radar
  // pip come with it for free.
  const proxy = (at: THREE.Vector3, hp: number, shape: { r: number; h: number; parts?: { z: number; y: number; r: number }[] },
    drive: (e: Enemy, dt: number) => void, hurt?: (amount: number, from: THREE.Vector3, bySlot: number) => number): Enemy => {
    const e = ctx.spawn('droid', at, { exact: true, squad: 8840 });
    e.position.copy(at);
    e.hp = e.maxHp = hp;
    e.radius = shape.r;
    e.height = shape.h;
    e.hitParts = shape.parts ?? [];
    e.char.root.visible = false;
    const last = at.clone();
    e.scripted = {
      drive: (b, dt) => {
        drive(b, dt);
        // what it is actually doing, for the guns' lead — a bolt's shove
        // would otherwise pile up in a body nothing else moves
        if (dt > 0) b.velocity.subVectors(b.position, last).divideScalar(dt);
        last.copy(b.position);
        return 'still';
      },
      ...(hurt ? { hurt } : {}),
    };
    return e;
  };
  const retire = (e: Enemy | null): void => {
    if (!e) return;
    if (e.alive) { e.alive = false; e.counted = true; }
    e.removeMe = true;
  };

  // ---- drones ----
  const hullPoint = (): THREE.Vector3 => {
    const z = STERN + 6 + Math.random() * (TAPER - STERN - 8);
    return P((Math.random() - 0.5) * 2 * (HALF_W - 2.5), 0.4, z);
  };
  const spawnSwarm = (bearing: Bearing, n: number): void => {
    const out = BEARING[bearing];
    const across = new THREE.Vector3(out.z, 0, -out.x);
    for (let i = 0; i < n; i++) {
      const hunter = i % 3 === 2;
      const p0 = P(0, 14 + Math.random() * 16, 0).addScaledVector(out, 175 + i * 6).addScaledVector(across, (Math.random() - 0.5) * 50);
      const p2 = hunter ? P((Math.random() - 0.5) * 12, 9, (Math.random() - 0.5) * 30) : hullPoint();
      const p1 = p2.clone().addScaledVector(out, 55).addScaledVector(across, (Math.random() - 0.5) * 40);
      p1.y = Y0 + 16 + Math.random() * 10;
      const d: Drone = { e: null as unknown as Enemy, role: hunter ? 'hunter' : 'hull', p0, p1, p2, u: 0, len: bezLen(p0, p1, p2), speed: 26 + Math.random() * 6 };
      d.e = ctx.spawn('drone', p0, { exact: true, squad: 8841 });
      d.e.position.copy(p0);
      d.e.scripted = { drive: (e, dt) => { driveDrone(d, e, dt); return 'still'; } };
      drones.push(d);
    }
  };
  const driveDrone = (d: Drone, e: Enemy, dt: number): void => {
    d.u = Math.min(1, d.u + (d.speed * dt) / d.len);
    bez(d.p0, d.p1, d.p2, d.u, e.position);
    bezD(d.p0, d.p1, d.p2, d.u, _v).multiplyScalar(d.speed / d.len);
    e.velocity.copy(_v);
    e.facingYaw = Math.atan2(_v.x, _v.z);
    if (d.role === 'hunter' && d.u > 0.8) {
      // near enough: let it hunt like any interceptor
      e.scripted = null;
      const lead = game.players.find((p) => p.alive);
      if (lead) e.alert(lead.position, true);
      return;
    }
    if (d.u >= 1) {
      // a strike on the hull
      const at = e.position.clone();
      game.particles.explosion(at, 0.55);
      audio.explosion();
      for (const p of game.players) {
        if (!p.alive) continue;
        const dd = p.position.distanceTo(at);
        if (dd < 4.5) p.damage(18 * (1 - dd / 5.5), at, -1, { heavy: true });
      }
      hullHit(DRONE_STRIKE);
      retire(e);
    }
  };

  // ---- dropships ----
  const takeModel = (): THREE.Group | null => shipModels.find((m) => !m.visible && !m.userData.busy) ?? null;
  const shipProxy = (s: Ship, hp: number): Enemy => proxy(s.pos.clone(), hp,
    { r: 2.8, h: 4, parts: [{ z: 4.5, y: 2.2, r: 2.4 }, { z: -4.5, y: 2.2, r: 2.4 }] },
    (e, dt) => driveShip(s, e, dt),
    (amount, _from, bySlot) => {
      if (s.state === 'latched' && amount < 40) return amount * 0.25;
      return bySlot < 0 && amount < 40 ? amount * AUTO_VS_ARMOUR : amount;
    });
  const launchShip = (kind: 'gunship' | 'board', bearing: Bearing, pt = 0): void => {
    const model = takeModel();
    if (!model) return;
    model.userData.busy = true;
    const out = BEARING[bearing];
    // a gunship comes in high; a boarder comes up from under the hull, where
    // no gun on the deck can depress to it — the radar is the only warning
    const p0 = P(0, kind === 'gunship' ? 18 : -34, 0).addScaledVector(out, 200);
    const s: Ship = {
      kind, e: null as unknown as Enemy, model, state: 'inbound', t: 0,
      p0, p1: new THREE.Vector3(), p2: new THREE.Vector3(), u: 0, len: 1, speed: 26,
      pos: p0.clone(), vel: new THREE.Vector3(), yaw: 0, roll: 0,
      side: bearing === 'starboard' ? -1 : 1, dir: 1, fireT: 1.5, tube: null, pt,
    };
    if (kind === 'gunship') {
      // come in to the start of a pass down the nearer flank
      if (bearing === 'port' || bearing === 'starboard') s.side = bearing === 'port' ? 1 : -1;
      else s.side = Math.random() < 0.5 ? 1 : -1;
      s.dir = bearing === 'ahead' ? -1 : 1;
      s.p2.copy(P(s.side * 32, 9, -s.dir * 62));
      s.p1.copy(s.p2).addScaledVector(out, 60).setY(Y0 + 24);
      s.speed = 34;
    } else {
      const b = BOARD_PTS[pt];
      s.side = Math.sign(b.x);
      s.p2.copy(P(b.x + s.side * 7.5, -2.8, b.z));
      s.p1.copy(s.p2).add(new THREE.Vector3(s.side * 14, -34, 0)).addScaledVector(out, 40);
      s.speed = 24;
    }
    s.len = bezLen(s.p0, s.p1, s.p2);
    s.e = shipProxy(s, kind === 'gunship' ? 650 + 220 * (party - 1) : 900 + 300 * (party - 1));
    model.visible = true;
    ships.push(s);
    audio.shipPass(0.4);
  };

  const fly = (s: Ship, dt: number, easeOut = false): boolean => {
    const step = (s.speed * dt) / s.len;
    // a boarder brakes onto its hover spot rather than arriving at speed
    s.u = Math.min(1, s.u + (easeOut ? step * Math.max(0.18, (1 - s.u) * 2.2) : step));
    bez(s.p0, s.p1, s.p2, s.u, s.pos);
    bezD(s.p0, s.p1, s.p2, s.u, s.vel).multiplyScalar(s.speed / s.len);
    if (s.vel.lengthSq() > 0.5) {
      const want = Math.atan2(s.vel.x, s.vel.z);
      let d = want - s.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      s.yaw += d * Math.min(1, dt * 3);
      s.roll = THREE.MathUtils.lerp(s.roll, -d * 0.8, Math.min(1, dt * 2));
    }
    return s.u >= 1;
  };

  const shipFire = (s: Ship): void => {
    // a burst at whoever is on the deck in reach, or at the plating
    const targets = game.players.filter((p) => p.alive && p.position.distanceTo(s.pos) < 75);
    const aim = targets.length && Math.random() < 0.75
      ? targets[Math.floor(Math.random() * targets.length)].position.clone().add(new THREE.Vector3(0, 1, 0))
      : hullPoint();
    const origin = s.pos.clone().add(new THREE.Vector3(Math.sin(s.yaw) * 4, 0.6, Math.cos(s.yaw) * 4));
    for (let k = 0; k < 3; k++) {
      const dir = aim.clone().sub(origin).normalize();
      dir.x += (Math.random() - 0.5) * 0.05;
      dir.y += (Math.random() - 0.5) * 0.03;
      dir.z += (Math.random() - 0.5) * 0.05;
      game.projectiles.fire(origin, dir.normalize(), 46, 8, 1, -1);
    }
    game.particles.muzzleFlash(origin, aim.clone().sub(origin).normalize());
    audio.enemyBlaster();
    hullHit(GUNSHIP_BURST);
  };

  const driveShip = (s: Ship, e: Enemy, dt: number): void => {
    s.t += dt;
    if (s.state === 'inbound') {
      if (fly(s, dt, s.kind === 'board')) {
        if (s.kind === 'gunship') startPass(s);
        else { s.state = 'latching'; s.t = 0; latchTube(s); }
      }
    } else if (s.state === 'pass') {
      if (fly(s, dt)) startLoop(s);
      s.fireT -= dt;
      if (s.fireT <= 0 && Math.abs(s.pos.z) < 46) { s.fireT = 0.6; shipFire(s); }
    } else if (s.state === 'loop') {
      if (fly(s, dt)) startPass(s);
    } else if (s.state === 'latching' || s.state === 'latched') {
      // hold beside the boarding point, bobbing on its thrusters
      s.pos.copy(s.p2).setY(s.p2.y + Math.sin(s.t * 1.6) * 0.3);
      s.vel.set(0, 0, 0);
      s.roll *= 0.95;
      const wantYaw = 0;
      s.yaw += (wantYaw - s.yaw) * Math.min(1, dt * 2);
    } else if (s.state === 'leaving') {
      s.vel.x += s.side * 9 * dt;
      s.vel.y -= 4 * dt;
      s.vel.z -= 6 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.roll += s.side * dt * 0.4;
      if (s.t > 6) { endShip(s); return; }
    }
    e.position.set(s.pos.x, s.pos.y - 2, s.pos.z);
    e.velocity.copy(s.vel);
    e.facingYaw = s.yaw;
  };

  const startPass = (s: Ship): void => {
    s.state = 'pass';
    s.p0.copy(s.pos);
    s.p2.copy(P(s.side * 32, 8 + Math.random() * 3, s.dir * 68));
    s.p1.copy(s.p0).lerp(s.p2, 0.5).setX(s.side * 30);
    s.u = 0;
    s.speed = 14;
    s.len = bezLen(s.p0, s.p1, s.p2);
    s.fireT = 1.2;
  };
  const startLoop = (s: Ship): void => {
    // over the bow or the stern, and back down the other flank
    s.state = 'loop';
    s.p0.copy(s.pos);
    s.p1.copy(P(0, 40, s.dir * 110));
    s.side = -s.side;
    s.dir = -s.dir;
    s.p2.copy(P(s.side * 32, 10, -s.dir * 68));
    s.u = 0;
    s.speed = 24;
    s.len = bezLen(s.p0, s.p1, s.p2);
  };
  const endShip = (s: Ship): void => {
    retire(s.e);
    s.model.visible = false;
    s.model.userData.busy = false;
    const i = ships.indexOf(s);
    if (i >= 0) ships.splice(i, 1);
  };
  const wreckShip = (s: Ship): void => {
    s.state = 'wreck';
    s.t = 0;
    game.particles.explosion(s.pos.clone(), 1.6);
    audio.explosion();
    if (s.tube) cutTube(s.tube, false);
    s.e.removeMe = true;
  };

  // ---- boarding tubes ----
  const latchPos = (pt: number): THREE.Vector3 => {
    const b = BOARD_PTS[pt];
    return P(b.x - Math.sign(b.x) * 0.45, 0, b.z);
  };
  const doorOf = (s: Ship): THREE.Vector3 => s.pos.clone().add(new THREE.Vector3(-s.side * 2.4, 1.6, 0));
  const latchTube = (s: Ship): void => {
    const pt = s.pt;
    const queue: EnemyKind[] = ['pirate', 'pirateMelee'];
    for (let i = 1; i < party; i++) queue.push(i % 2 ? 'pirate' : 'pyke');
    // the Pyke heavy comes out last, once the deck is busy — the capo himself
    // when there is company to take him on, a Pyke gunner for a lone hunter
    // until the last wave
    queue.push(party >= 2 || waveIdx >= 3 ? 'capo' : 'pyke');
    if (party >= 3) queue.push('pirateMelee');
    const t: Tube = { pt, holder: tubeModels[pt], latch: null, queue, nextT: 0.4, ext: 0, cut: false, bodies: [], ship: s, fall: 0 };
    s.tube = t;
    tubes.push(t);
    t.holder.visible = true;
    t.holder.scale.set(1, 1, 0.05);
    audio.doorCycle();
  };
  const latchHurt = (t: Tube) => (amount: number): number => {
    const e = t.latch;
    // a blade, or anything heavy (a rocket's blast): the clamp gives.
    // Bolts spark off it.
    if (e && meleeOn === e) { meleeOn = null; return amount * 1.15; }
    if (amount >= 40) return amount;
    return amount * 0.08;
  };
  const armLatch = (t: Tube): void => {
    const at = latchPos(t.pt);
    // a clamp takes eight or so good blows: long enough that the tube has
    // emptied onto the deck by the time it gives
    t.latch = proxy(at, (party === 1 ? 240 : 320) + 90 * Math.max(0, party - 2), { r: 1.2, h: 2.8 }, (e) => { e.position.copy(at); e.velocity.set(0, 0, 0); }, latchHurt(t));
    ctx.announce(T.boarders, T.boardersSub);
    audio.alarm(0.45);
  };
  const cutTube = (t: Tube, announce: boolean): void => {
    if (t.cut) return;
    t.cut = true;
    t.fall = 0;
    if (t.latch) {
      if (announce) {
        game.particles.explosion(t.latch.position.clone().setY(Y0 + 1.4), 0.5);
        audio.explosion();
        ctx.announce(T.latchCut, T.latchCutSub);
      }
      retire(t.latch);
      t.latch = null;
    }
    t.queue = [];
    const s = t.ship;
    if (s.state === 'latched' || s.state === 'latching') { s.state = 'leaving'; s.t = 0; s.vel.set(0, 0, 0); }
  };
  const updateTube = (t: Tube, dt: number): void => {
    const s = t.ship;
    const at = latchPos(t.pt).setY(Y0 + 1.9);
    if (t.cut) {
      // torn loose: it flops out and falls away astern
      t.fall += dt;
      t.holder.position.copy(at).add(new THREE.Vector3(Math.sign(BOARD_PTS[t.pt].x) * t.fall * 5, -t.fall * t.fall * 4, -t.fall * 10));
      t.holder.rotation.x += dt * 0.8;
      if (t.fall > 2.5) {
        t.holder.visible = false;
        t.holder.rotation.set(0, 0, 0);
        const i = tubes.indexOf(t);
        if (i >= 0) tubes.splice(i, 1);
      }
      return;
    }
    const door = doorOf(s);
    if (s.state === 'latching') {
      t.ext = Math.min(1, t.ext + dt / 1.6);
      t.holder.position.copy(door).lerp(at, t.ext);
      t.holder.scale.set(1, 1, Math.max(0.05, t.ext * door.distanceTo(at) / 8));
      t.holder.lookAt(door);
      if (t.ext >= 1) { s.state = 'latched'; armLatch(t); }
      return;
    }
    t.holder.position.copy(at);
    t.holder.scale.set(1, 1, door.distanceTo(at) / 8);
    t.holder.lookAt(door);
    // latched: it drains the hull, and pours boarders
    hullHit(TUBE_DRAIN * dt);
    t.nextT -= dt;
    const mine = t.bodies.filter((b) => b.alive).length;
    if (t.nextT <= 0) {
      const b = BOARD_PTS[t.pt];
      const s2 = Math.sign(b.x);
      const kind = t.queue.shift() ?? (mine < 2 ? 'pirate' : null);
      // the first two come out together as the collar blows, then one at a time
      t.nextT = t.bodies.length === 0 ? 0.25 : t.queue.length ? 1.5 : 12;
      if (kind) {
        const e = ctx.spawn(kind, P(b.x - s2 * 2.4, 0, b.z + (Math.random() - 0.5) * 1.6), { exact: true, alert: true, squad: 8842 });
        e.facingYaw = s2 > 0 ? -Math.PI / 2 : Math.PI / 2;
        t.bodies.push(e);
        boarders.push(e);
        game.particles.dustPuff(e.position.clone(), 6);
      }
    }
    if (t.latch && !t.latch.alive) cutTube(t, true);
  };

  // ---- the corvette ----
  const gens: Gen[] = [0, 1, 2].map((i) => ({ i, e: null, node: null, down: false }));
  let bridge: Enemy | null = null;
  let bridgeNode: THREE.Object3D | null = null;
  const cv = { pos: new THREE.Vector3(), yaw: 0, t: 0, arrive: 0, slideZ: 0, spinal: 'idle' as 'idle' | 'charge' | 'fire' | 'recover', spinalT: 7, laneZ: 0, turn: 0, fall: 0, burnT: 0 };
  const CV_X = -52;
  const genHp = 900 + 300 * (party - 1);
  const bridgeHp = 1600 + 500 * (party - 1);
  const armour = (amount: number, bySlot: number): number => (bySlot < 0 && amount < 40 ? amount * AUTO_VS_ARMOUR : amount);
  const nodeWorld = (n: THREE.Object3D | null, local: THREE.Vector3): THREE.Vector3 => {
    corvette.updateMatrixWorld(true);
    if (n) return n.getWorldPosition(new THREE.Vector3());
    return local.clone().applyMatrix4(corvette.matrixWorld);
  };
  const GEN_LOCAL = [0, 1, 2].map((i) => new THREE.Vector3(0, 9.6, -4 + i * 11));
  const BRIDGE_LOCAL = new THREE.Vector3(0, 9, -18);
  // the sculpt's own nodes once it has landed, the stand-in's until then
  const node = (name: string): THREE.Object3D | null =>
    corvetteProp.sculpt.getObjectByName(name) ?? corvette.getObjectByName(name) ?? null;
  const findNodes = (): void => {
    for (const g of gens) g.node = node(`gen_${g.i}`);
    bridgeNode = node('bridge');
  };
  const shieldsUp = (): boolean => gens.some((g) => !g.down);
  const startCorvette = (): void => {
    phase = 'corvette';
    phaseT = 0;
    hullCheckpoint = hull.body.hp;
    corvette.visible = true;
    corvette.rotation.set(0, 0, 0);
    shield.visible = true;
    findNodes();
    cv.arrive = 0;
    cv.spinal = 'idle';
    cv.spinalT = 9;
    cv.pos.set(CV_X - 20, Y0 - 6, -260);
    cv.yaw = 0;
    cv.turn = 0;
    cv.slideZ = 0;
    for (const g of gens) {
      g.down = false;
      if (g.node) g.node.visible = true;
      g.e = proxy(nodeWorld(g.node, GEN_LOCAL[g.i]), genHp, { r: 2.6, h: 5.2 }, (e) => {
        e.position.copy(nodeWorld(g.node, GEN_LOCAL[g.i])).y -= 2.6;
      }, (amount, _from, bySlot) => { shieldMat.opacity = 0.32; return armour(amount, bySlot); });
    }
    bridge = proxy(nodeWorld(bridgeNode, BRIDGE_LOCAL), bridgeHp, { r: 3.6, h: 5, parts: [{ z: 2.5, y: 2.5, r: 3 }, { z: -2.5, y: 2.5, r: 3 }] },
      (e) => {
        e.position.copy(nodeWorld(bridgeNode, BRIDGE_LOCAL)).y -= 2.5;
        e.facingYaw = cv.yaw;
      },
      (amount, _from, bySlot) => {
        if (shieldsUp()) { shieldMat.opacity = 0.5; return 0; }
        return armour(amount, bySlot);
      });
    ctx.announce(T.corvette, T.corvetteSub);
    audio.bossHorn(false);
    radar.push({ bearing: 'starboard', what: 'corvette', t: 3 });
  };
  const spinalLaneZ = (): number => {
    // on whoever is on the deck (or in a gun): the line goes where people are
    const alive = game.players.filter((p) => p.alive && onHull(p.position.x, p.position.z, 1));
    const who = alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
    const z = who ? who.position.z + (Math.random() - 0.5) * 4 : (Math.random() - 0.5) * 40;
    return THREE.MathUtils.clamp(z, STERN + 4, TAPER - 2);
  };
  const updateCorvette = (dt: number): void => {
    cv.t += dt;
    // the sculpt may land mid-fight: its own domes and bridge replace the stand-in's
    findNodes();
    for (const g of gens) if (g.node) g.node.visible = !g.down;
    if (bridgeNode) bridgeNode.visible = phase !== 'broken';
    // up from astern, easing into station off the starboard side
    if (cv.arrive < 1) {
      cv.arrive = Math.min(1, cv.arrive + dt / 12);
      const k = 1 - (1 - cv.arrive) ** 3;
      cv.pos.set(THREE.MathUtils.lerp(CV_X - 20, CV_X, k), THREE.MathUtils.lerp(Y0 - 6, Y0 - 4, k), THREE.MathUtils.lerp(-260, 0, k));
    }
    // the spinal gun
    const shooting = cv.arrive >= 1 && phase === 'corvette';
    if (shooting) {
      cv.spinalT -= dt;
      if (cv.spinal === 'idle') {
        if (cv.spinalT < 3.5 && cv.laneZ === cv.slideZ) cv.laneZ = spinalLaneZ();
        if (cv.spinalT <= 0) {
          cv.spinal = 'charge';
          cv.spinalT = SPINAL_WARN;
          audio.floorCharge(0.5);
        }
      } else if (cv.spinal === 'charge') {
        if (cv.spinalT <= 0) { cv.spinal = 'fire'; cv.spinalT = 0.55; spinalShot(); }
      } else if (cv.spinal === 'fire') {
        if (cv.spinalT <= 0) { cv.spinal = 'recover'; cv.spinalT = 1.4; }
      } else if (cv.spinalT <= 0) {
        cv.spinal = 'idle';
        cv.spinalT = party === 1 ? 9 : 7.5;
        cv.slideZ = cv.laneZ;
      }
    }
    // slide along to the lane it wants, and turn its nose on the frigate to shoot
    const wantZ = cv.spinal === 'idle' && cv.spinalT > 3.5 ? cv.slideZ : cv.laneZ;
    const turnTo = cv.spinal === 'charge' || cv.spinal === 'fire' ? 1 : 0;
    cv.turn += THREE.MathUtils.clamp(turnTo - cv.turn, -dt / 1.1, dt / 1.1);
    if (cv.arrive >= 1) {
      cv.pos.z += THREE.MathUtils.clamp(wantZ - cv.pos.z, -6 * dt, 6 * dt);
      cv.pos.y = Y0 - 4 + Math.sin(cv.t * 0.5) * 0.6;
    }
    cv.yaw = (Math.PI / 2) * cv.turn * cv.turn * (3 - 2 * cv.turn);
    if (phase === 'broken') {
      // breaking away: rolling, dropping, falling astern, burning
      cv.fall += dt;
      cv.pos.y -= cv.fall * 3 * dt;
      cv.pos.z -= (mill.speed * 0.5 + cv.fall * 6) * dt;
      cv.pos.x -= 4 * dt;
      corvette.rotation.z += dt * 0.25;
      cv.burnT -= dt;
      if (cv.burnT <= 0) {
        cv.burnT = 0.35;
        const at = nodeWorld(null, new THREE.Vector3((Math.random() - 0.5) * 8, 4 + Math.random() * 5, (Math.random() - 0.5) * 50));
        game.particles.explosion(at, 1.3);
        if (Math.random() < 0.4) audio.explosion();
      }
      if (cv.fall > 9) corvette.visible = false;
    }
    corvette.position.copy(cv.pos);
    corvette.rotation.y = cv.yaw;
    // the shield: a flicker when struck, gone when the domes are
    shieldMat.opacity = Math.max(0.14, shieldMat.opacity - dt * 1.5);
    shield.visible = shieldsUp() && phase === 'corvette';
    // the telegraph and the beam
    const warn = cv.spinal === 'charge';
    lane.visible = warn;
    for (const e of laneEdges) e.visible = warn;
    if (warn) {
      const k = 1 - cv.spinalT / SPINAL_WARN;
      lane.position.set(0, Y0 + 0.05, cv.laneZ);
      laneMat.opacity = 0.18 + 0.4 * k + 0.12 * Math.sin(game.time * (10 + 20 * k));
      laneEdgeMat.opacity = 0.6 + 0.4 * Math.sin(game.time * 14);
      for (const e of laneEdges) e.position.set(0, Y0 + 0.06, cv.laneZ + (e.userData.side as number) * SPINAL_HALF);
    }
    beam.visible = cv.spinal === 'fire';
    if (beam.visible) {
      const from = nodeWorld(null, new THREE.Vector3(0, -0.6, 34));
      const to = P(HALF_W + 40, from.y - Y0, cv.laneZ);
      from.z = to.z = cv.laneZ;
      beam.position.copy(from).lerp(to, 0.5);
      beam.scale.set(1, from.distanceTo(to), 1);
      beam.rotation.set(0, 0, Math.PI / 2);
      beamMat.opacity = Math.min(0.9, cv.spinalT * 2);
    }
    // the domes and the bridge
    for (const g of gens) {
      if (g.down || !g.e || g.e.alive) continue;
      g.down = true;
      if (g.node) g.node.visible = false;
      game.particles.explosion(nodeWorld(null, GEN_LOCAL[g.i]), 1.2);
      audio.explosion();
      const left = gens.filter((x) => !x.down).length;
      ctx.announce(T.genDown(left), left === 0 ? T.genDownSub : '');
      g.e.removeMe = true;
      g.e = null;
    }
    if (phase === 'corvette' && bridge && !bridge.alive) {
      bridge.removeMe = true;
      bridge = null;
      phase = 'broken';
      phaseT = 0;
      cv.spinal = 'idle';
      cv.fall = 0;
      lane.visible = false;
      for (const e of laneEdges) e.visible = false;
      beam.visible = false;
      if (bridgeNode) bridgeNode.visible = false;
      ctx.announce(T.broken, T.brokenSub);
      audio.waveClear();
      for (const d of drones) retire(d.e);
    }
  };
  const spinalShot = (): void => {
    audio.explosion();
    hullHit(SPINAL_HULL);
    for (const p of game.players) {
      if (!p.alive) continue;
      if (Math.abs(p.position.z - cv.laneZ) > SPINAL_HALF + 0.4) continue;
      if (!onHull(p.position.x, p.position.z, 1) || p.position.y > Y0 + 6) continue;
      p.damage(SPINAL_DMG, P(-HALF_W, 1, cv.laneZ), -1, { heavy: true });
      p.velocity.x += 7;
      p.velocity.y += 3;
    }
    for (let i = 0; i < 5; i++) game.particles.impactSparks(P((Math.random() - 0.5) * 2 * HALF_W, 0.3, cv.laneZ), 14);
  };

  // ---- the waves ----
  let events: WaveEvent[] = [];
  /** a tube latched, or a boarding ship on its way to latch one */
  const tubeActive = (): boolean => tubes.some((t) => !t.cut)
    || ships.some((s) => s.kind === 'board' && (s.state === 'inbound' || s.state === 'latching'));
  const fire = (ev: WaveEvent): void => {
    if (ev.kind === 'swarm') spawnSwarm(ev.bearing, ev.n ?? 4);
    else if (ev.kind === 'gunship') launchShip('gunship', ev.bearing);
    else launchShip('board', ev.bearing, ev.pt ?? 0);
  };
  const waveBusy = (): boolean =>
    drones.some((d) => d.e.alive) || ships.some((s) => s.state !== 'wreck' && s.state !== 'leaving')
    || tubeActive() || boarders.some((b) => b.alive);
  const clearField = (): void => {
    for (const d of drones) retire(d.e);
    drones.length = 0;
    for (const s of [...ships]) { if (s.tube) { s.tube.holder.visible = false; } endShip(s); }
    for (const t of tubes) { t.holder.visible = false; retire(t.latch); }
    tubes.length = 0;
    for (const b of boarders) retire(b);
    boarders.length = 0;
    radar.length = 0;
  };
  const startWave = (k: number): void => {
    waveIdx = k;
    waveT = 0;
    events = waveScript(k, party);
    fired = events.map(() => false);
    told = events.map(() => false);
    phase = 'wave';
    phaseT = 0;
    hullCheckpoint = hull.body.hp;
    ctx.announce(T.wave(k + 1, WAVES), T.waveSubs[k]);
    audio.waveStart();
  };
  function breach(): void {
    // the hull is gone: the wave comes round again, with the hull it began with
    ctx.announce(T.breached, T.breachedSub);
    audio.alarm(0.6);
    clearField();
    if (phase === 'corvette') {
      for (const g of gens) retire(g.e);
      retire(bridge);
      bridge = null;
      corvette.visible = false;
      lane.visible = false;
      for (const e of laneEdges) e.visible = false;
      beam.visible = false;
      restartAt = 'corvette';
    } else restartAt = 'wave';
    phase = 'breather';
    phaseT = 0;
  }
  let restartAt: 'wave' | 'corvette' | null = null;

  const updateWaves = (dt: number): void => {
    if (phase !== 'wave') return;
    waveT += dt;
    events.forEach((ev, i) => {
      if (fired[i]) return;
      // one tube at a time: the next waits for the last to be cut and its boarders down
      if (ev.oneTube && (tubeActive() || deckBoarders().length) && !told[i]) { ev.at = Math.max(ev.at, waveT + RADAR_WARN + 2); return; }
      // on the radar first
      const due = ev.at - waveT;
      if (due <= RADAR_WARN && !told[i]) {
        told[i] = true;
        radar.push({ bearing: ev.bearing, what: ev.kind, t: Math.max(0, due) });
        audio.alarm(0.2);
      }
      if (due <= 0) { fired[i] = true; fire(ev); }
    });
    if (fired.every(Boolean) && !waveBusy()) {
      phase = 'breather';
      phaseT = 0;
      restartAt = null;
      // damage control: a patch on the hull, and a bacta canister at the hatches
      hull.body.hp = Math.min(HULL_HP, hull.body.hp + HULL_HP * 0.1);
      ctx.announce(T.clear(waveIdx + 1), T.clearSub);
      audio.waveClear();
      ctx.pickup(P(AFT_HATCH.x + 2.4, 0, AFT_HATCH.z + 1));
      if (party >= 3) ctx.pickup(P(FWD_HATCH.x - 2.4, 0, FWD_HATCH.z - 2));
    }
  };

  // ---- the golden path: the aft hatch, the guns, the forward hatch ----
  const path = [
    P(AFT_HATCH.x, 0, AFT_HATCH.z + 2.4),
    P(-4.5, 0, -2),
    P(0, 0, 3),
    P(FWD_HATCH.x, 0, FWD_HATCH.z - 2.4),
    P(FWD_HATCH.x, -WELL_D, FWD_HATCH.z),
  ];

  const inWell = (pos: THREE.Vector3): boolean =>
    Math.abs(pos.x - FWD_HATCH.x) < HATCH_HALF + 0.2 && Math.abs(pos.z - FWD_HATCH.z) < HATCH_HALF + 0.2;

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      rides = new RideLedger(ctx);
      for (const gn of GUNS) {
        guns.push(rides.add({ kind: 'turret', x: gn.x, z: gn.z, y: Y0, yaw: gn.yaw }, {
          team: 0, hp: 900,
          // the eye a hand over the gunner's shield (K3's default sits level with
          // its top edge, and the plate filled the lower half of the sight)
          turret: { yawArc: GUN_ARC, pitchMin: GUN_PITCH_MIN, pitchMax: 0.75, autoRange: 110, sight: { x: 0, y: 2.7, z: -0.35 } },
        }));
      }
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          meleeHit: (_p, target, amount) => {
            if (tubes.some((t) => t.latch === target)) meleeOn = target as Enemy;
            return amount;
          },
        });
      }
      ctx.announce(T.title, T.sub);
      audio.doorCycle();
    }
    phaseT += dt;
    // the plate texture lands bright; the frigate is old grey metal
    if (plate.map && !deckToned) { deckToned = true; plate.color.set(0x8a9098); }
    if (stationMat.map && !stationToned) { stationToned = true; stationMat.color.set(0x6c7684); }
    if (housing.map && !housingToned) { housingToned = true; housing.color.set(0x8c939c); }
    mill.update(dt);
    hull.update(dt);
    layStreaks(dt);
    for (const d of debris) { d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.y += d.spin.y * dt; }
    const flicker = 0.85 + Math.sin(game.time * 23) * 0.1;
    const thrust = Math.min(1, mill.speed / CRUISE);
    for (const pl of plumes) {
      pl.visible = thrust > 0.04;
      pl.scale.set(0.6 + thrust * 0.5, 0.2 + thrust * flicker, 0.6 + thrust * 0.5);
    }
    plumeMat.opacity = 0.15 + 0.45 * thrust;
    engineLight.intensity = 40 * thrust;

    // ---- the cast-off ----
    if (phase === 'castoff') {
      const k = THREE.MathUtils.clamp((phaseT - 1.2) / 2.5, 0, 1);
      layCollar(1 - k);
      if (phaseT > 3.2 && mill.target === 0) {
        mill.setSpeed(CRUISE, 6);
        ctx.announce(T.castOff, T.castOffSub);
        audio.shipLanding(0.5);
      }
      if (phaseT > 7) startWave(0);
    } else if (station.visible) {
      layCollar(0);
      if (stationItem.retired) station.visible = false;
    }
    // the aft hatch swings shut behind the party once they are out
    if (phaseT > 2 || phase !== 'castoff') {
      aftLid.rotation.x = Math.min(0, aftLid.rotation.x + dt * 1.2);
      aftGlow.intensity = Math.max(0, aftGlow.intensity - dt * 3);
      aftShaft.visible = aftLid.rotation.x < -0.15;
    }

    updateWaves(dt);
    if (phase === 'breather' && phaseT > (restartAt ? 4.5 : 6)) {
      if (restartAt === 'corvette') { restartAt = null; startCorvette(); }
      else if (restartAt === 'wave') { restartAt = null; startWave(waveIdx); }
      else if (waveIdx + 1 < WAVES) startWave(waveIdx + 1);
      else { mill.setSpeed(COMBAT, 5); startCorvette(); }
    }
    if (phase === 'corvette' || phase === 'broken') updateCorvette(dt);
    if (phase === 'corvette' && cv.arrive >= 1) {
      // escorts: a swarm now and then, from ahead or the starboard bow
      if (Math.floor((phaseT - dt) / 24) !== Math.floor(phaseT / 24) && phaseT > 20) {
        const b: Bearing = Math.floor(phaseT / 24) % 2 ? 'ahead' : 'port';
        radar.push({ bearing: b, what: 'swarm', t: RADAR_WARN });
        const n = 2 + party;
        setTimeout0(RADAR_WARN, () => { if (phase === 'corvette') spawnSwarm(b, n); });
      }
    }
    if (phase === 'broken' && phaseT > 4) {
      // the far dock comes in from ahead, and she slows onto it
      phase = 'docking';
      phaseT = 0;
      mill.setSpeed(APPROACH, 4);
      const D = 320;
      dock.position.set(0, Y0, D);
      dock.visible = true;
      dockItem = mill.conveyor(dock, { behind: 1e6 });
      mill.stopAt(mill.travelled + D);
      for (const b of boarders) if (b.alive) b.alert(game.players[0]?.position ?? P(0, 0, 0), true);
    }
    if (phase === 'docking' && mill.stopped && phaseT > 2) {
      phase = 'docked';
      phaseT = 0;
      docked = true;
      ctx.unsolid({ box: fwdLid.box });
      ctx.announce(T.docked, T.dockedSub);
      audio.checkpointChime();
      ctx.checkpoint.set(FWD_HATCH.x, Y0, FWD_HATCH.z - 3);
    }
    if (docked) {
      lidOpen = Math.min(1, lidOpen + dt / 1.2);
      fwdLidPivot.rotation.x = -lidOpen * Math.PI * 0.55;
      wellLight.intensity = 20 * lidOpen;
      for (const l of fwdLamps) l.material = green;
      for (const c of clamps) c.scale.x = 1 + lidOpen * 0.5;
      for (const p of game.players) {
        if (p.alive && inWell(p.position) && p.position.y < Y0 - 1.2) complete = true;
      }
    }
    void dockItem;

    // ---- the things in the air, the tubes and the boarders ----
    for (let i = drones.length - 1; i >= 0; i--) if (!drones[i].e.alive || drones[i].e.removeMe) drones.splice(i, 1);
    for (const s of [...ships]) {
      if (s.state === 'wreck') {
        s.t += dt;
        s.pos.y -= (2 + s.t * 5) * dt;
        s.pos.z -= (mill.speed * 0.6 + 4) * dt;
        s.roll += dt * 1.4;
        if (Math.random() < dt * 6) game.particles.explosion(s.pos.clone(), 0.5);
        if (s.t > 3) endShip(s);
      } else if (!s.e.alive) wreckShip(s);
      s.model.position.copy(s.pos);
      s.model.rotation.set(0, s.yaw, s.roll, 'YXZ');
    }
    for (const t of [...tubes]) updateTube(t, dt);
    for (let i = boarders.length - 1; i >= 0; i--) {
      const b = boarders[i];
      // over the side is into space
      if (b.alive && b.position.y < Y0 - 10) b.damage(99999, b.position, -1);
      if (!b.alive || b.removeMe) boarders.splice(i, 1);
    }
    for (const r of radar) r.t -= dt;
    for (let i = radar.length - 1; i >= 0; i--) if (radar[i].t < -3) radar.splice(i, 1);
    // the radar lamps flash toward whatever is coming
    for (const b of Object.keys(radarLamps) as Bearing[]) {
      const on = radar.some((r) => r.bearing === b && r.t > -2);
      const lit = on && Math.sin(game.time * 12) > 0;
      radarLamps[b].mesh.material = lit ? redLamp : lampOff;
      radarLamps[b].light.intensity = lit ? 30 : 0;
    }
    for (const t of timers) t.t -= dt;
    for (const t of timers.filter((x) => x.t <= 0)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    rides?.prune(dt);

    // a wipe: the wave comes round again (the hull as it was when it began)
    if (!game.players.some((p) => p.alive) && (phase === 'wave' || phase === 'corvette')) {
      hull.body.hp = Math.max(hull.body.hp, hullCheckpoint);
      breach();
    }
  };
  const timers: { t: number; fn: () => void }[] = [];
  const setTimeout0 = (t: number, fn: () => void): void => { timers.push({ t, fn }); };

  // ---- what the HUD says ----
  const activeLatch = (near?: THREE.Vector3): Tube | null => {
    let best: Tube | null = null, bd = Infinity;
    for (const t of tubes) {
      if (t.cut || !t.latch) continue;
      const d = near ? near.distanceTo(t.latch.position) : 0;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  };
  const deckBoarders = (): Enemy[] => boarders.filter((b) => b.alive && onHull(b.position.x, b.position.z, 1));
  const radarLine = (): string | null => {
    const r = radar.filter((x) => x.t > -2).sort((a, b) => a.t - b.t)[0];
    if (!r) return null;
    const what = T.contacts[r.what];
    const where = T.bearings[r.bearing];
    return r.t > 0 ? T.radar(what, where) : T.inbound(what[0].toUpperCase() + what.slice(1), where);
  };

  const objective = () => {
    if (docked) return { pos: P(FWD_HATCH.x, 0, FWD_HATCH.z), label: T.hatchLabel, hint: T.hatchHint, beacon: true };
    if (phase === 'docking' || phase === 'broken') return { pos: P(FWD_HATCH.x, 0, FWD_HATCH.z), label: T.hatchLabel, hint: T.docking, beacon: false };
    const latch = activeLatch();
    if (latch?.latch) return { pos: latch.latch.position.clone().setY(Y0 + 1), label: T.latchLabel, hint: T.latchHint, beacon: false };
    if (phase === 'corvette') {
      const spinal = cv.spinal === 'charge';
      const g = gens.find((x) => !x.down && x.e);
      if (g?.e) return { pos: g.e.position.clone(), label: T.genLabel, hint: spinal ? T.spinal : T.corvetteHint, beacon: false };
      if (bridge) return { pos: bridge.position.clone(), label: T.bridgeLabel, hint: spinal ? T.spinal : T.bridgeHint, beacon: false };
    }
    if (deckBoarders().length) {
      const b = deckBoarders()[0];
      return { pos: b.position.clone(), label: T.hullLabel, hint: T.boardHint, beacon: false };
    }
    if (!guns.length) return { pos: P(GUNS[0].x, 0, GUNS[0].z), label: T.gunLabel, hint: T.gunHint, beacon: false };
    const free = guns.find((g) => g.alive && !g.rider);
    if (free) {
      const anyone = game.players.some((p) => p.vehicle);
      return { pos: free.pos.clone().setY(Y0), label: T.gunLabel, hint: anyone ? T.holdHint : T.gunHint, beacon: false };
    }
    return { pos: P(0, 0, 0), label: T.hullLabel, hint: T.holdHint, beacon: false };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    // up through the nearest hatch (the forward one only once she has docked)
    const p = game.players[slot];
    const from = p ? p.position : ctx.checkpoint;
    let hatch = AFT_HATCH;
    if (docked || Math.hypot(from.x - FWD_HATCH.x, from.z - FWD_HATCH.z) < Math.hypot(from.x - AFT_HATCH.x, from.z - AFT_HATCH.z)) hatch = FWD_HATCH;
    const spot = hatch === FWD_HATCH ? P(hatch.x, 0, hatch.z - 3) : P(hatch.x, 0, hatch.z + 2.6);
    const facing = hatch === FWD_HATCH ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
    return ctx.defaultRespawn(slot, spot, facing);
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [hull.bar(T.hull, T.hullDown)];
    const gun = p.vehicle && guns.includes(p.vehicle) ? p.vehicle : null;
    if (gun) {
      bars.push({ label: gun.overheated ? T.venting : T.heat, value: gun.heat, tone: gun.overheated ? 'danger' : gun.heat > 0.7 ? 'warn' : 'info' });
    }
    if (phase === 'corvette') {
      const up = gens.filter((g) => !g.down);
      if (up.length) {
        const hp = up.reduce((a, g) => a + (g.e ? g.e.hp : 0), 0);
        bars.push({ label: T.gens(up.length), value: hp / (genHp * 3), tone: 'info' });
      } else if (bridge) bars.push({ label: T.bridge, value: bridge.hp / bridge.maxHp, tone: 'danger' });
    }
    let title: string = T.title;
    if (phase === 'wave' || (phase === 'breather' && restartAt === 'wave')) title = `${T.wave(waveIdx + 1, WAVES)} · ${T.waves[waveIdx]}`;
    else if (phase === 'corvette') title = T.corvette;
    const spinal = phase === 'corvette' && cv.spinal === 'charge';
    const line = spinal ? T.spinal : radarLine() ?? objective().hint;
    return { title, bars: bars.slice(0, 3), line };
  };

  // ---- the autopilot ----
  // Slots 1–3 man the guns (starboard, bow, stern: the port gun is left on
  // auto, and it is the one that cannot see the corvette), slot 0 fights on
  // the deck. Alone, slot 0 mans the starboard gun and leaves it whenever a
  // tube latches or a boarder is on the deck — the section's question, asked
  // of a bot.
  const obstacles = (): { x: number; z: number; r: number }[] => [
    ...guns.map((g) => ({ x: g.pos.x, z: g.pos.z, r: 2.0 })),
    ...COVER.map(([x, z, sx, sz]) => ({ x, z, r: Math.hypot(sx, sz) / 2 + 0.55 })),
  ];
  /**
   * Walk toward `to`: straight, unless a gun or a vent housing is on the
   * line, in which case toward the near side of it (a detour point just off
   * its circle, on whichever side the line already passes).
   */
  const walkTo = (p: Player, to: THREE.Vector3, out: AutopilotInput, stopAt = 0.6): boolean => {
    const tx = THREE.MathUtils.clamp(to.x, -(halfW(to.z) - 2.2), halfW(to.z) - 2.2);
    const tz = THREE.MathUtils.clamp(to.z, STERN + 3, BOW - 6);
    const px = p.position.x, pz = p.position.z;
    const d = Math.hypot(tx - px, tz - pz);
    if (d < stopAt) return true;
    let gx = tx, gz = tz;
    let nearest = Infinity;
    for (const o of obstacles()) {
      if (Math.hypot(tx - o.x, tz - o.z) < o.r) continue;          // the goal is at it
      const ux = (tx - px) / d, uz = (tz - pz) / d;
      const along = (o.x - px) * ux + (o.z - pz) * uz;
      if (along < -0.5 || along > d) continue;
      const cx = px + ux * along, cz = pz + uz * along;
      const off = Math.hypot(o.x - cx, o.z - cz);
      if (off >= o.r) continue;
      if (along >= nearest) continue;
      nearest = along;
      // round it on the side the line already leans to
      let sx = cx - o.x, sz = cz - o.z;
      const sl = Math.hypot(sx, sz);
      if (sl < 1e-3) { sx = -uz; sz = ux; } else { sx /= sl; sz /= sl; }
      gx = o.x + sx * (o.r + 1.1) + ux * 0.8;
      gz = o.z + sz * (o.r + 1.1) + uz * 0.8;
    }
    out.yaw = Math.atan2(gx - px, gz - pz);
    out.moveY = Math.min(1, d / 2);
    return false;
  };
  const airTargets = (): Enemy[] => {
    const list: Enemy[] = [];
    for (const d of drones) if (d.e.alive) list.push(d.e);
    for (const s of ships) if (s.e.alive && s.state !== 'latched' && s.state !== 'latching' && s.state !== 'wreck') list.push(s.e);
    for (const g of gens) if (g.e?.alive) list.push(g.e);
    if (bridge?.alive && !shieldsUp()) list.push(bridge);
    for (const e of game.enemies) if (e.alive && e.kind === 'drone' && !e.scripted && !list.includes(e)) list.push(e);
    return list;
  };
  const inLane = (z: number): boolean => phase === 'corvette' && (cv.spinal === 'charge' || cv.spinal === 'fire') && Math.abs(z - cv.laneZ) < SPINAL_HALF + 1.5;
  const aimAt = (p: Player, from: THREE.Vector3, tgt: Enemy, speed: number): { yaw: number; pitch: number } => {
    const aim = tgt.position.clone();
    aim.y += tgt.height * 0.55;
    const t = from.distanceTo(aim) / speed;
    aim.addScaledVector(tgt.velocity, t * 0.9);
    const dx = aim.x - from.x, dy = aim.y - from.y, dz = aim.z - from.z;
    void p;
    return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  };
  const angleDiff = (a: number, b: number): number => {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  const deckPilot = (p: Player, slot: number): AutopilotInput => {
    const out: AutopilotInput = {};
    if (p.vehicle) return cursors[slot]++ % 8 === 0 && p.vehicle ? { slamPressed: true } : {};
    // off the spinal gun's line first of all
    if (inLane(p.position.z)) {
      const up = cv.laneZ + (cv.laneZ < 0 ? 1 : -1) * (SPINAL_HALF + 4);
      walkTo(p, P(p.position.x, 0, up), out, 0.3);
      out.sprintHeld = true;
      return out;
    }
    const latch = activeLatch(p.position);
    const close = deckBoarders().filter((b) => b.position.distanceTo(p.position) < 14);
    if (latch?.latch && !close.length) {
      const at = latch.latch.position;
      const s = Math.sign(BOARD_PTS[latch.pt].x);
      const stand = P(at.x - s * 1.8, 0, at.z);
      const d = Math.hypot(at.x - p.position.x, at.z - p.position.z);
      if (d > 2.6) { walkTo(p, stand, out, 0.4); out.shootHeld = false; return out; }
      out.yaw = Math.atan2(at.x - p.position.x, at.z - p.position.z);
      p.cam.pitch = -0.15;
      if (cursors[slot]++ % 10 === 0) out.meleePressed = true;
      return out;
    }
    const foes = deckBoarders();
    if (foes.length) {
      foes.sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position));
      const f = foes[0];
      const d = f.position.distanceTo(p.position);
      if (d > 9) walkTo(p, f.position, out, 6);
      if (!out.moveY) out.yaw = Math.atan2(f.position.x - p.position.x, f.position.z - p.position.z);
      // level with them: a gunner's pitch left over from the sky puts every bolt overhead
      p.cam.pitch = Math.atan2(f.position.y + f.height * 0.5 - (p.position.y + 1.5), Math.max(1, d));
      out.shootHeld = true;
      return out;
    }
    if (docked) {
      const inside = walkTo(p, P(FWD_HATCH.x, 0, FWD_HATCH.z), out, 0.15);
      if (inside || Math.hypot(p.position.x - FWD_HATCH.x, p.position.z - FWD_HATCH.z) < 1.1) {
        out.yaw = 0;
        out.moveY = 0.4;
      }
      return out;
    }
    const home = slot === 0 ? P(0, 0, -3) : P(slot % 2 ? 3 : -3, 0, -8 + slot * 3);
    if (!walkTo(p, home, out, 1.2)) return out;
    const air = airTargets().filter((e) => e.position.distanceTo(p.position) < 70);
    if (air.length) {
      air.sort((a, b) => a.position.distanceTo(p.position) - b.position.distanceTo(p.position));
      const a = aimAt(p, p.position.clone().setY(p.position.y + 1.4), air[0], 60);
      out.yaw = a.yaw;
      p.cam.pitch = THREE.MathUtils.clamp(a.pitch, -0.6, 0.9);
      out.shootHeld = true;
    }
    return out;
  };

  const gunPilot = (p: Player, slot: number, gun: Vehicle): AutopilotInput => {
    const out: AutopilotInput = {};
    if (p.vehicle !== gun) {
      if (p.vehicle) return cursors[slot]++ % 8 === 0 ? { slamPressed: true } : {};
      if (inLane(gun.pos.z)) return deckPilot(p, slot);
      const away = new THREE.Vector3(p.position.x - gun.pos.x, 0, p.position.z - gun.pos.z);
      if (away.lengthSq() < 0.01) away.set(0, 0, -1);
      away.normalize();
      const stand = gun.pos.clone().addScaledVector(away, 2.6);
      const near = Math.hypot(gun.pos.x - p.position.x, gun.pos.z - p.position.z) < 3.4;
      if (!near) { walkTo(p, stand, out, 0.3); return out; }
      if (p.nearVehicle === gun && cursors[slot]++ % 6 === 0) out.slamPressed = true;
      else { out.yaw = Math.atan2(gun.pos.x - p.position.x, gun.pos.z - p.position.z); out.moveY = 0.3; }
      return out;
    }
    // in the gun: off it if the spinal line is on it, or if it is a bot on its own with boarders
    if (inLane(gun.pos.z)) return cursors[slot]++ % 4 === 0 ? { slamPressed: true } : {};
    if (docked) return cursors[slot]++ % 6 === 0 ? { slamPressed: true } : {};
    const sight = gun.sightWorld(new THREE.Vector3());
    let best: Enemy | null = null, bd = Infinity;
    for (const e of airTargets()) {
      const dx = e.position.x - gun.pos.x, dz = e.position.z - gun.pos.z;
      if (Math.abs(angleDiff(Math.atan2(dx, dz), gun.baseYaw)) > GUN_ARC) continue;
      const d = Math.hypot(dx, dz);
      if (d > 140 || e.position.y + e.height * 0.5 < sight.y - 0.5) continue;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) {
      out.yaw = gun.baseYaw;
      p.cam.pitch = 0.2;
      return out;
    }
    const a = aimAt(p, sight, best, gun.def.gun?.speed ?? 95);
    out.yaw = a.yaw;
    p.cam.pitch = THREE.MathUtils.clamp(a.pitch, GUN_PITCH_MIN, 0.75);
    const err = Math.abs(angleDiff(gun.yaw, a.yaw)) + Math.abs(gun.aimPitch - p.cam.pitch);
    out.shootHeld = !gun.overheated && gun.heat < 0.92 && err < 0.12;
    return out;
  };

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive || !started) return {};
    if (docked || phase === 'docking' || phase === 'broken') return deckPilot(p, slot);
    const solo = party === 1;
    if (solo) {
      const busy = !!activeLatch() || deckBoarders().length > 0;
      if (busy) return deckPilot(p, slot);
      return guns[0]?.alive ? gunPilot(p, slot, guns[0]) : deckPilot(p, slot);
    }
    if (slot === 0) return deckPilot(p, slot);
    const gun = guns[(slot - 1) % 3];
    return gun?.alive ? gunPilot(p, slot, gun) : deckPilot(p, slot);
  };

  return {
    starts: [0, 1, 2, 3].map((i) => P(AFT_HATCH.x + ((i % 2) * 2 - 1) * 1.6, 0, AFT_HATCH.z + 2.4 + Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + 32,
    // one height for the deck; off the hull there is nothing (the void)
    groundAt: (x, z) => (onHull(x, z, 0.5) ? Y0 : Y0 - 400),
    contains: (x, z) => onHull(x, z, 0.6),
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // over the side is space; the well under the forward hatch is the way down
    offPath: (pos) => (pos.y < Y0 - 6 && !(docked && inWell(pos))) || !onHull(pos.x, pos.z, 18),
    hud,
    autopilot,
    dispose: () => {
      rides?.dispose();
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({
      phase, wave: waveIdx + 1, hull: Math.round(hull.body.hp), drones: drones.length, ships: ships.length,
      tubes: tubes.map((t) => `B${t.pt + 1}:${t.cut ? 'cut' : t.ship.state}`).join(' '), boarders: boarders.length, speed: Math.round(mill.speed * 10) / 10,
      spinal: cv.spinal, gens: gens.filter((g) => !g.down).length, docked,
    }),
  };
}

export const frigateGuns: SectionDef = {
  id: 'frigate-guns',
  build,
  // the Spice Run's 0.45 g, and the station board's own starfield overhead
  world: { gravity: 0.45, fill: 1.1 },
};
