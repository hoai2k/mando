import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import { Enemy, type EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import { addBreakable, type Breakable } from '../world/board';
import { audio } from '../core/audio';
import { deckTexture, hullTexture } from '../core/assets';
import { Interactions } from './kit/interact';
import { composeMoves } from './kit/moves';
import { DetectionField, Takedowns, type LightCone, type DetectionMask } from './kit/detection';

/**
 * Lights Out (docs/LEVEL_SECTIONS.md §2.11) — the Refinery, between the
 * plant (stage B) and the reactor crown (stage C).
 *
 * The plant's rear airlock opens onto the tank farm behind it: night under
 * the plant's smoke, three searchlight towers sweeping the yard, troopers
 * walking loops between the pipe racks. The way on is the lit stair up the
 * reactor crown's base in the far corner; the tank rows all round are the
 * edge of the world.
 *
 * **The verb** is staying out of the light. Each player has a **seen**
 * meter (K6, `kit/detection.ts`): a searchlight's pool fills it in about 0.6
 * s, a sensor post's beam a little slower, and noise made near a hostile
 * (firing, a jetpack burn, sprinting, a hard landing) adds to it. Steam from
 * a venting pipe blocks the beams and swallows noise while it blows. A full
 * meter trips the alarm.
 *
 * **Takedowns.** A melee hit from behind on a trooper who has not clocked
 * you kills him in one blow, silently. One who *has* seen you has three
 * seconds to get on the radio — kill him before he does, or the alarm trips.
 * At night they see about half as far as by day, and from behind only when
 * you are right on top of them (`Enemy.stealthSight`).
 *
 * **The booth.** A control booth on a platform by the plant wall kills
 * every searchlight for ten seconds (twenty to recharge): one player on
 * overwatch, the rest moving. The south-east patrol checks it.
 *
 * **The alarm is not a fail.** It is the Refinery's own alarm console
 * pattern: fences seal the three pipe-rack lanes, turrets rise out of the
 * tank rows, a drop comes in and the whole yard is hunting. Kill the drop and
 * hold an alarm console for three seconds, and the yard goes back to the
 * dark. Or fight through to the stair: it is just the hard way.
 *
 * **Escalation.** The west lane (one patrol, one searchlight: learn the
 * sweep and the takedown), the open middle or the north lane (sensor posts,
 * crossing patrols, a pair), and the stair: two guards at its foot, one
 * facing out, and the third searchlight sweeping the approach — take the
 * guards, or kill the lights from the booth and run it.
 *
 * Nothing left behind: the fallen come back at the last dark corner the
 * party reached; nothing the section needs lives outside it.
 */

// ---- the yard (local metres: x across, z from the plant wall toward the crown) ----
const HX = 45;
const HZ = 70;
const TANK_R = 6.5;
const TANK_H = 22;
const CEIL = 24;
/** the reactor crown's base: the stair climbs its west face to the top */
const CROWN = { x0: 32, x1: HX, z0: 58, z1: HZ, top: 8 };
const STAIR = { x0: 20, x1: CROWN.x0, z0: 62.5, z1: 67.5 };
/** the airlock the party came out of, in the plant's back wall */
const ENTRY = new THREE.Vector3(-36, 0, 3);
/** the control booth: a platform against the plant wall */
const BOOTH = { x0: 8, x1: 16, z0: 0, z1: 6, top: 3 };

/** searchlight towers: base, and the ground points each sweeps between */
const TOWERS: { at: [number, number]; path: [number, number][]; speed: number }[] = [
  { at: [-24, 6], path: [[-40, 16], [-39, 40], [-24, 34], [-14, 16]], speed: 6 },
  { at: [2, 52], path: [[-32, 64], [-8, 64], [16, 64], [12, 42], [-10, 42]], speed: 7 },
  { at: [40, 8], path: [[39, 22], [39, 50], [24, 62], [14, 52], [26, 32]], speed: 6.5 },
];
const TOWER_H = 14;
/** a searchlight's own light on the ground: bright, not blown */
const SPOT_I = 90;
/** sensor posts: fixed beams at chest height that turn slowly */
const SENSORS: { at: [number, number]; yaw: number; rate: number }[] = [
  { at: [-20, 26], yaw: 0, rate: 0.45 },
  { at: [18, 14], yaw: 2, rate: -0.4 },
];
/** steam vents: where, and their cycle offset */
const VENTS: { at: [number, number]; off: number }[] = [
  { at: [-38, 28], off: 0 }, { at: [-12, 62], off: 3 }, { at: [37, 22], off: 5 }, { at: [0, 34], off: 7 },
];
/** pipe racks: the lanes of cover — [x0, z0, x1, z1] of each run */
const RACKS: [number, number, number, number][] = [
  [-33, 8, -33, 44],   // the west lane's inner wall
  [-28, 56, 6, 56],    // the north lane's
  [33, 8, 33, 44],     // the east lane's
];
/** fences the alarm raises across the lanes: [x0, z0, x1, z1] */
const FENCES: [number, number, number, number][] = [
  [-HX, 46, -33.7, 46],
  [8, 56.7, 8, HZ],
  [33.7, 46, HX, 46],
];
/** barrel stacks in the open ground */
const STACKS: [number, number][] = [[-18, 14], [-22, 40], [4, 16], [16, 30], [-4, 48], [20, 50], [-40, 20], [40, 32]];
/** interior tanks: centre and radius */
const INNER_TANKS: [number, number, number][] = [[-7, 28, 5], [12, 42, 4]];
/** alarm consoles */
const CONSOLES: [number, number][] = [[-41, 2.4], [41, 2.4], [16, 68]];
/** the dark corners the party re-forms at, in order along the way */
const SAFE: [number, number][] = [[-36, 6], [-41, 50], [-24, 67], [2, 67]];
/** turret hatches in the tank rows: position and facing */
const TURRETS: { at: [number, number]; yaw: number }[] = [
  { at: [-43.5, 30], yaw: Math.PI / 2 }, { at: [43.5, 36], yaw: -Math.PI / 2 }, { at: [-6, 68.5], yaw: Math.PI },
];
/** how long a trooper who has seen you takes to call it in */
const RADIO = 3;
const BOOTH_DARK = 10;
const BOOTH_COOL = 20;

interface Searchlight {
  lamp: THREE.Vector3;
  cone: LightCone;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  spot: THREE.SpotLight;
  path: THREE.Vector3[];
  speed: number;
  /** metres along the sweep, and which way */
  s: number;
  dir: 1 | -1;
  aim: THREE.Vector3;
  drum: THREE.Object3D;
}
interface Patrol {
  e: Enemy;
  route: THREE.Vector3[];
  i: number;
  step: 1 | -1;
  loop: boolean;
  pause: number;
  /** pauses at these route indices (seconds) */
  holds: Map<number, number>;
}
interface Guard { e: Enemy; yaw: number; swing: number; ph: number }
interface Turret {
  base: THREE.Vector3;
  yaw: number;
  group: THREE.Group;
  head: THREE.Object3D;
  b: Breakable;
  rise: number;
  cd: number;
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['lights-out'];
  const party = Math.max(1, game.players.length);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, Y0 + y, z);

  // ---- materials ----
  // wet deck: the plant's own deck texture, dark and glossy (tiled through the
  // geometry's UVs, since the texture itself is shared)
  const ground = ctx.own(new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0x484c52, roughness: 0.8, metalness: 0.05 }));
  const tankMat = ctx.paint(spec.palette.wall, { rough: 0.6, metal: 0.5 });
  ctx.tile(tankMat, 'tank_wall', 3, 2, { normal: true });
  const steel = ctx.paint(0x3a3f46, { rough: 0.55, metal: 0.6 });
  const dark = ctx.paint(0x1c1f24, { rough: 0.7, metal: 0.4 });
  const plantMat = ctx.own(new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x5a5d62, roughness: 0.7, metalness: 0.4 }));
  const pipeMat = ctx.paint(0x5a5f66, { rough: 0.5, metal: 0.65 });
  const stripe = ctx.paint(0xd8b02a, { rough: 0.5, emissive: 0x3a1004 });
  ctx.tile(stripe, 'hazard_stripe', 2, 1);
  const barrelMat = ctx.paint(0x8f5a24, { rough: 0.6, metal: 0.35 });
  const sodium = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  ctx.own(sodium);
  const redLamp = new THREE.MeshBasicMaterial({ color: 0xff3322 });
  ctx.own(redLamp);

  // ---- night: the board's daylight fill goes down while the yard stands ----
  const dimmed: { light: THREE.Light; was: number }[] = [];
  ctx.board.group.traverse((o) => {
    if (o instanceof THREE.HemisphereLight) { dimmed.push({ light: o, was: o.intensity }); o.intensity = 0.16; }
    else if (o instanceof THREE.DirectionalLight) { dimmed.push({ light: o, was: o.intensity }); o.intensity = 0.1; }
  });
  // and the scene's own fill — its ambient and the reflection probe every
  // metal surface reads — which would otherwise light the yard like a hangar
  const scene = game.scene;
  // (the probe is built on the first render and sets its own intensity, so
  // the night value is held every frame in `update`, and the day's put back
  // on teardown)
  const NIGHT_ENV = 0.05;
  const envWas = scene.environmentIntensity;
  scene.traverse((o) => {
    if (o instanceof THREE.AmbientLight) { dimmed.push({ light: o, was: o.intensity }); o.intensity = 0.06; }
  });
  const moon = new THREE.HemisphereLight(0x3a4a6a, 0x0a0c10, 0.3);
  ctx.mesh(moon);

  // ---- the ground ----
  ctx.box(0, Y0 - 0.5, HZ / 2, HX * 2 + 30, 1, HZ + 30, null);
  {
    const geo = new THREE.PlaneGeometry(HX * 2 + 30, HZ + 30);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 10);
    ctx.own(geo);
    const deck = new THREE.Mesh(geo, ground);
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, Y0, HZ / 2);
    deck.receiveShadow = true;
    ctx.mesh(deck);
  }
  // puddles: glossy dark patches that take the sodium light
  const puddleMat = ctx.paint(0x0c0e12, { rough: 0.18, metal: 0.1 });
  for (const [x, z, r] of [[-30, 10, 3], [-8, 20, 4], [10, 58, 3.5], [24, 22, 3], [-26, 50, 2.5], [36, 56, 3]] as const) {
    const pd = new THREE.Mesh(new THREE.CircleGeometry(r, 18), puddleMat);
    pd.rotation.x = -Math.PI / 2;
    pd.position.set(x, Y0 + 0.02, z);
    pd.scale.y = 0.6;
    ctx.mesh(pd);
  }

  // ---- the tank rows: the edge of the world ----
  const tank = (x: number, z: number, r: number, h: number): void => {
    ctx.cyl(x, Y0 + h / 2, z, r, h, tankMat);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.8, 24, 1, true), ctx.paint(0x6a2020, { rough: 0.6 }));
    band.position.set(x, Y0 + h * 0.62, z);
    ctx.mesh(band);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 4, 24), stripe);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, Y0 + h + 0.1, z);
    ctx.mesh(rim);
  };
  for (let z = 6; z <= HZ + 6; z += 12) { tank(-HX - TANK_R, z, TANK_R, TANK_H); tank(HX + TANK_R, z, TANK_R, TANK_H); }
  for (const x of [-39, -27, -15, -3, 9, 21, 28]) tank(x, HZ + TANK_R, TANK_R, TANK_H + (x === -15 || x === 21 ? 4 : 0));
  // behind the tanks, a wall up past the ceiling so the gaps between them are not doors
  ctx.box(-HX - TANK_R - 1, Y0 + 20, HZ / 2, 2, 40, HZ + 20, null);
  ctx.box(HX + TANK_R + 1, Y0 + 20, HZ / 2, 2, 40, HZ + 20, null);
  ctx.box(0, Y0 + 20, HZ + TANK_R + 1, HX * 2 + 20, 40, 2, null);

  // ---- the plant's back wall, and the airlock the party came out of ----
  ctx.box(0, Y0 + 15, -1.5, HX * 2 + 20, 30, 3, plantMat);
  {
    const door = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 0.3), dark);
    door.position.set(ENTRY.x, Y0 + 2.5, 0.1);
    ctx.mesh(door);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 0.4), stripe);
    frame.position.set(ENTRY.x, Y0 + 5.2, 0.2);
    ctx.mesh(frame);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.2), sodium);
    lamp.position.set(ENTRY.x, Y0 + 5.7, 0.3);
    ctx.mesh(lamp);
    const l = new THREE.PointLight(0xffb060, 14, 12, 1.6);
    l.position.set(ENTRY.x, Y0 + 5.5, 1.5);
    ctx.mesh(l);
    // lit windows high on the plant, and its stacks smoking against the sky
    for (let x = -40; x <= 40; x += 8) {
      if (Math.abs(x - ENTRY.x) < 4) continue;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.9), sodium);
      w.position.set(x, Y0 + 14 + ((x / 8) % 2) * 3, 0.02);
      ctx.mesh(w);
    }
    for (const x of [-20, 6, 30]) ctx.cyl(x, Y0 + 30, -6, 2.2, 36, steel);
  }

  // ---- the reactor crown's base, its lit stair, and the crown above ----
  const crownMat = ctx.own(new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x6a6d72, roughness: 0.6, metalness: 0.5 }));
  ctx.box((CROWN.x0 + CROWN.x1) / 2, Y0 + CROWN.top / 2, (CROWN.z0 + CROWN.z1) / 2, CROWN.x1 - CROWN.x0, CROWN.top, CROWN.z1 - CROWN.z0, crownMat);
  // its upper works, up past the ceiling: the door at the top is the way on
  ctx.box((CROWN.x0 + CROWN.x1) / 2 + 2, Y0 + CROWN.top + 16, CROWN.z1 + 1, CROWN.x1 - CROWN.x0 + 4, 32, 2, crownMat);
  const steps = 16;
  const run = (STAIR.x1 - STAIR.x0) / steps;
  for (let k = 0; k < steps; k++) {
    const top = ((k + 1) / steps) * CROWN.top;
    ctx.box(STAIR.x0 + run * (k + 0.5), Y0 + top / 2, (STAIR.z0 + STAIR.z1) / 2, run, top, STAIR.z1 - STAIR.z0, steel);
  }
  // the stair's rails and its work lights: the brightest thing in the yard
  for (const z of [STAIR.z0 - 0.1, STAIR.z1 + 0.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(STAIR.x1 - STAIR.x0, CROWN.top), 0.08, 0.08), stripe);
    rail.position.set((STAIR.x0 + STAIR.x1) / 2, Y0 + CROWN.top / 2 + 1, z);
    rail.rotation.z = Math.atan2(CROWN.top, STAIR.x1 - STAIR.x0);
    ctx.mesh(rail);
  }
  const stairLights: THREE.PointLight[] = [];
  for (const [x, y, z] of [[STAIR.x0 + 1, 3, STAIR.z0 - 1], [(STAIR.x0 + STAIR.x1) / 2, 7, STAIR.z0 - 1], [CROWN.x0 + 2, CROWN.top + 3.5, 64]] as const) {
    const l = new THREE.PointLight(0xffd08a, 40, 22, 1.4);
    l.position.set(x, Y0 + y, z);
    ctx.mesh(l);
    stairLights.push(l);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), sodium);
    f.position.copy(l.position);
    ctx.mesh(f);
  }
  // the door at the top of the stair, into the crown
  const crownDoor = new THREE.Mesh(new THREE.PlaneGeometry(5, 4.5), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
  ctx.own(crownDoor.material as THREE.Material);
  crownDoor.position.set(38.5, Y0 + CROWN.top + 2.25, CROWN.z1 - 0.02);
  crownDoor.rotation.y = Math.PI;
  ctx.mesh(crownDoor);
  // the reactor itself, looming over the tank rows: the landmark the whole yard walks toward
  ctx.prop('reactor_core', V(40, CROWN.top, HZ + 22), {
    size: 40,
    fallback: () => {
      const g = new THREE.Group();
      const col = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 40, 12), steel);
      col.position.y = 20;
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.8, 34, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.y = 20;
      g.add(col, glow);
      return g;
    },
  });
  const reactorGlow = new THREE.PointLight(0xff8a3a, 90, 70, 1.3);
  reactorGlow.position.set(40, Y0 + 30, HZ + 18);
  ctx.mesh(reactorGlow);

  // ---- pipe racks ----
  const rackSolids: { x0: number; z0: number; x1: number; z1: number }[] = [];
  for (const [x0, z0, x1, z1] of RACKS) {
    const alongX = z0 === z1;
    const len = alongX ? x1 - x0 : z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    ctx.box(cx, Y0 + 2.2, cz, alongX ? len : 1.4, 4.4, alongX ? 1.4 : len, null);
    rackSolids.push({ x0: cx - (alongX ? len / 2 : 0.7), x1: cx + (alongX ? len / 2 : 0.7), z0: cz - (alongX ? 0.7 : len / 2), z1: cz + (alongX ? 0.7 : len / 2) });
    for (let s = 3; s < len; s += 6) {
      const at = alongX ? V(x0 + s, 0, z0) : V(x0, 0, z0 + s);
      ctx.prop('pipe_rack', at, {
        size: 6, yaw: alongX ? 0 : Math.PI / 2,
        fallback: () => {
          const g = new THREE.Group();
          for (const [dy, r] of [[1.2, 0.3], [2.1, 0.22], [2.9, 0.34], [3.8, 0.18]] as const) {
            const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 6, 8), pipeMat);
            p.rotation.z = Math.PI / 2;
            p.position.y = dy;
            g.add(p);
          }
          for (const lx of [-2.8, 2.8]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.4, 1.2), steel);
            leg.position.set(lx, 2.2, 0);
            g.add(leg);
          }
          return g;
        },
      });
    }
  }

  // ---- barrel stacks and the inner tanks ----
  const drum = (x: number, y: number, z: number): void => {
    ctx.cyl(x, Y0 + y + 0.85, z, 0.6, 1.7, null);
    ctx.prop('fuel_barrel', V(x, y, z), {
      size: 1.7, yaw: (x * 7 + z * 3) % 6,
      fallback: () => {
        const g = new THREE.Group();
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.7, 12), barrelMat);
        d.position.y = 0.85;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.2, 12), stripe);
        b.position.y = 1.2;
        g.add(d, b);
        return g;
      },
    });
  };
  for (const [x, z] of STACKS) {
    for (const [dx, dz] of [[0, 0], [1.3, 0.2], [0.6, 1.2]] as const) drum(x + dx, 0, z + dz);
    drum(x + 0.6, 1.7, z + 0.4);
  }
  for (const [x, z, r] of INNER_TANKS) tank(x, z, r, 12);

  // ---- sodium lamp posts: warm pools, and nothing else lit ----
  const lampPools: [number, number][] = [[-30, 2], [0, 2], [24, 2], [-44, 60], [44, 50]];
  for (const [x, z] of lampPools) {
    ctx.cyl(x, Y0 + 3, z, 0.12, 6, steel);
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), sodium);
    f.position.set(x, Y0 + 6.1, z);
    ctx.mesh(f);
    const l = new THREE.PointLight(0xffa040, 12, 11, 1.6);
    l.position.set(x, Y0 + 5.8, z);
    ctx.mesh(l);
  }

  // ---- the detection field ----
  const field = new DetectionField(game, {
    decay: 0.25, hold: 1.5,
    noise: { fire: 0.3, jet: 0.4, sprint: 0.15, land: 0.05, hardLand: 0.25 },
    // noise only counts when a trooper who is not already fighting is near enough to hear it
    noiseGate: (p) => game.enemies.some((e) => e.alive && e.team === 1 && e.awareness !== 'engaged'
      && e.position.distanceToSquared(p.position) < 22 * 22) ? 1 : 0,
    thresholds: [{ at: 1, onCross: () => trip('seen') }],
  });

  // ---- searchlights ----
  const beamGeoCache = new Map<number, THREE.ConeGeometry>();
  const beamGeo = (range: number, half: number): THREE.ConeGeometry => {
    const key = range * 1000 + half;
    let g = beamGeoCache.get(key);
    if (!g) {
      g = new THREE.ConeGeometry(range * Math.tan(half), range, 24, 1, true);
      g.translate(0, -range / 2, 0);
      ctx.own(g);
      beamGeoCache.set(key, g);
    }
    return g;
  };
  const DOWN = new THREE.Vector3(0, -1, 0);
  const searchlights: Searchlight[] = TOWERS.map((t) => {
    const [tx, tz] = t.at;
    // the tower: a lattice mast (a box stand-in) with a platform and the lamp drum
    const mast = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, TOWER_H, 1.2), steel);
    leg.position.y = TOWER_H / 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 3), steel);
    deck.position.y = TOWER_H - 1.2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 2.4), stripe);
    base.position.y = 0.5;
    mast.add(leg, deck, base);
    // the collider stops short of the lamp head, so the beam's own sight line starts clear of its mast
    ctx.prop('searchlight_tower', V(tx, 0, tz), { size: TOWER_H, fallback: () => mast, solid: { r: 1.2, h: TOWER_H - 2 } });
    const lamp = V(tx, TOWER_H + 0.6, tz);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.2, 12), dark);
    drum.position.copy(lamp);
    ctx.mesh(drum);
    const path = t.path.map(([x, z]) => V(x, 0, z));
    const aim = path[0].clone();
    const dir = aim.clone().sub(lamp).normalize();
    const range = 48, half = (10 * Math.PI) / 180;
    const cone = field.addCone({ origin: lamp, dir, halfAngle: half, range, rate: 1.7, tag: 'searchlight' });
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xd8ecff, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    ctx.own(beamMat);
    const beam = new THREE.Mesh(beamGeo(range, half), beamMat);
    beam.position.copy(lamp);
    ctx.mesh(beam);
    const spot = new THREE.SpotLight(0xe0f0ff, SPOT_I, 60, half * 1.25, 0.5, 1.2);
    spot.position.copy(lamp);
    ctx.mesh(spot);
    ctx.mesh(spot.target);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ctx.own(lens.material as THREE.Material);
    drum.add(lens);
    lens.position.y = -0.61;
    lens.rotation.x = Math.PI / 2;
    return { lamp, cone, beam, beamMat, spot, path, speed: t.speed, s: 0, dir: 1 as const, aim, drum };
  });
  const pathLen = (pts: THREE.Vector3[]): number => {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
    return L;
  };
  const pointAt = (pts: THREE.Vector3[], s: number, out: THREE.Vector3): THREE.Vector3 => {
    for (let i = 1; i < pts.length; i++) {
      const seg = pts[i].distanceTo(pts[i - 1]);
      if (s <= seg) return out.copy(pts[i - 1]).lerp(pts[i], seg > 0 ? s / seg : 0);
      s -= seg;
    }
    return out.copy(pts[pts.length - 1]);
  };

  // ---- sensor posts ----
  const sensors = SENSORS.map((sd) => {
    const [x, z] = sd.at;
    ctx.cyl(x, Y0 + 1.2, z, 0.25, 2.4, steel);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.6), dark);
    head.position.set(x, Y0 + 2.5, z);
    ctx.mesh(head);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), redLamp);
    head.add(eye);
    eye.position.z = 0.32;
    const origin = V(x, 2.5, z);
    const range = 15, half = (17 * Math.PI) / 180;
    const cone = field.addCone({ origin, dir: new THREE.Vector3(0, -0.12, 1).normalize(), halfAngle: half, range, rate: 1.3, tag: 'sensor' });
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    ctx.own(mat);
    const beam = new THREE.Mesh(beamGeo(range, half), mat);
    beam.position.copy(origin);
    ctx.mesh(beam);
    return { ...sd, cone, beam, head, yawNow: sd.yaw };
  });

  // ---- steam vents ----
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xc8d0d8, transparent: true, opacity: 0, depthWrite: false });
  ctx.own(steamMat);
  const vents = VENTS.map((vd) => {
    const [x, z] = vd.at;
    const grate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.4), steel);
    grate.position.set(x, Y0 + 0.15, z);
    ctx.mesh(grate);
    const mask: DetectionMask = field.addMask(V(x, 1.6, z), 3.4);
    const plume = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.0, 6, 14, 1, true), steamMat.clone());
    ctx.own(plume.material as THREE.Material);
    plume.position.set(x, Y0 + 3, z);
    ctx.mesh(plume);
    return { pos: V(x, 0.4, z), mask, plume, t: vd.off, puff: 0 };
  });
  const VENT_ON = 4.5, VENT_CYCLE = 11;

  // ---- the booth ----
  ctx.box((BOOTH.x0 + BOOTH.x1) / 2, Y0 + BOOTH.top / 2, (BOOTH.z0 + BOOTH.z1) / 2, BOOTH.x1 - BOOTH.x0, BOOTH.top, BOOTH.z1 - BOOTH.z0, steel);
  for (let k = 0; k < 6; k++) {
    const top = BOOTH.top * (k + 1) / 7;
    ctx.box(12, Y0 + top / 2, BOOTH.z1 + 3.5 - k * 0.55 - 0.3, 3, top, 0.6, steel);
  }
  {
    // the cab: a glassed hut on the platform
    ctx.box(13.5, Y0 + BOOTH.top + 1.3, 2.2, 4, 2.6, 3, dark);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), new THREE.MeshBasicMaterial({ color: 0x5fa0c0, transparent: true, opacity: 0.5 }));
    ctx.own(glass.material as THREE.Material);
    glass.position.set(13.5, Y0 + BOOTH.top + 1.8, 3.72);
    ctx.mesh(glass);
    const l = new THREE.PointLight(0x80c0ff, 6, 8, 1.6);
    l.position.set(11, Y0 + BOOTH.top + 2.2, 4);
    ctx.mesh(l);
  }
  const boothAt = V(10.2, BOOTH.top, 3.5);
  let lightsOff = 0;
  let boothCool = 0;

  // ---- alarm consoles ----
  const interactions = new Interactions();
  let alarm = false;
  let alarmT = 0;
  let landed = false;
  const dropBodies: Enemy[] = [];
  const consoleLamps: THREE.MeshBasicMaterial[] = [];
  const consoles = CONSOLES.map(([x, z]) => {
    const at = V(x, 0, z);
    const body = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.8), dark);
    cab.position.y = 1.3;
    body.add(cab);
    const yaw = z < 5 ? 0 : Math.PI;
    ctx.prop('alarm_console', at, { size: 2.6, yaw, fallback: () => body, solid: { r: 1, h: 2.6 } });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x551410 });
    ctx.own(lampMat);
    consoleLamps.push(lampMat);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampMat);
    lamp.position.set(x, Y0 + 2.8, z);
    ctx.mesh(lamp);
    const standAt = V(x, 0, z + (z < 5 ? 1.8 : -1.8));
    return interactions.add({
      pos: standAt, hold: 3, radius: 2.4, verb: T.resetVerb, once: false,
      enabled: () => alarm && dropCleared(),
      onDone: () => resetAlarm(),
    });
  });
  interactions.add({
    pos: boothAt, hold: 1, radius: 2.2, verb: T.boothVerb, once: false,
    enabled: () => !alarm && lightsOff <= 0 && boothCool <= 0,
    onDone: () => {
      lightsOff = BOOTH_DARK;
      boothCool = BOOTH_DARK + BOOTH_COOL;
      audio.doorCycle();
      ctx.announce(T.lightsOut, T.lightsOutSub);
    },
  });

  // ---- the fences the alarm raises ----
  const fenceMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  ctx.own(fenceMat);
  const fences = FENCES.map(([x0, z0, x1, z1]) => {
    const alongX = z0 === z1;
    const len = alongX ? x1 - x0 : z1 - z0;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const { box } = ctx.box(cx, Y0 + 2.5, cz, alongX ? len : 0.3, 5, alongX ? 0.3 : len, null);
    ctx.unsolid({ box });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, 5), fenceMat);
    pane.position.set(cx, Y0 + 2.5, cz);
    if (!alongX) pane.rotation.y = Math.PI / 2;
    ctx.mesh(pane);
    for (const [px, pz] of [[x0, z0], [x1, z1]] as const) ctx.cyl(px, Y0 + 2.6, pz, 0.25, 5.2, steel);
    return { box, up: false };
  });

  // ---- turrets in the tank rows ----
  const turretMat = ctx.paint(0x4a4f56, { rough: 0.5, metal: 0.6 });
  const breakables: Breakable[] = [];
  const turrets: Turret[] = TURRETS.map((td) => {
    const [x, z] = td.at;
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 10), turretMat);
    post.position.y = 1.2;
    const head = new THREE.Group();
    head.position.y = 2.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.4), turretMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.05, 0.9);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), redLamp);
    eye.position.set(0, 0.2, 0.72);
    head.add(box, barrel, eye);
    group.add(post, head);
    group.position.set(x, Y0 - 3.2, z);
    ctx.mesh(group);
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 1.8), stripe);
    hatch.position.set(x, Y0 + 0.03, z);
    ctx.mesh(hatch);
    const bx = ctx.box(x, Y0 - 50, z, 1.4, 3.2, 1.4, null).box;
    const b = addBreakable(ctx.board, group, bx, 120, { radius: 1.2, onBreak: () => { audio.explosion(); } });
    breakables.push(b);
    return { base: V(x, 0, z), yaw: td.yaw, group, head, b, rise: 0, cd: 1 };
  });

  // ---- state ----
  let started = false;
  let complete = false;
  let safeIdx = 0;
  const takedowns = new Takedowns(game);
  const calm = new WeakMap<Enemy, boolean>();
  const radioAt = new Map<Enemy, number>();
  let tripReason = '';
  const patrols: Patrol[] = [];
  const guards: Guard[] = [];
  ctx.checkpoint.copy(V(SAFE[0][0], 0, SAFE[0][1]));

  const dropCleared = (): boolean => (landed && dropBodies.every((e) => !e.alive)) || alarmT > 45;

  const trip = (why: 'seen' | 'radio'): void => {
    if (alarm) return;
    alarm = true;
    alarmT = 0;
    landed = false;
    dropBodies.length = 0;
    tripReason = why;
    field.enabled = false;
    audio.alarm(0.7);
    ctx.announce(T.alarm, why === 'seen' ? T.alarmSeen : T.alarmRadio);
    for (const f of fences) if (!f.up) { f.up = true; ctx.board.physics.boxes.push(f.box); }
    // the whole yard is on it
    const lead = game.players.find((p) => p.alive);
    if (lead) game.director.noise(game, lead.position, 400, true);
    // a drop onto open ground near the party
    const c = centroid();
    const spots = [[-20, 30], [0, 44], [10, 22], [-30, 58], [20, 58], [26, 12], [-14, 10]]
      .map(([x, z]) => V(x, 0, z))
      .sort((a, b) => a.distanceTo(c) - b.distanceTo(c))
      .slice(0, 3);
    const kinds = ctx.squadFor(ctx.wave + 1, 2 + party);
    const drop = kinds.map((_, i) => spots[i % spots.length].clone().add(new THREE.Vector3((i % 3) * 1.6 - 1.6, 0, Math.floor(i / 3) * 1.6)));
    ctx.drop(kinds, drop, (bodies) => {
      landed = true;
      dropBodies.push(...bodies);
      const l = game.players.find((p) => p.alive);
      for (const e of bodies) if (l) e.alert(l.position, true);
    });
  };

  const resetAlarm = (): void => {
    alarm = false;
    audio.doorCycle();
    ctx.announce(T.reset, T.resetSub);
    for (const f of fences) if (f.up) { f.up = false; ctx.board.physics.boxes = ctx.board.physics.boxes.filter((b) => b !== f.box); }
    field.enabled = true;
    field.reset();
    // whoever is still hunting stays hunting, but nobody already fighting can start a new call
    for (const e of game.enemies) if (e.alive) calm.set(e, e.awareness !== 'engaged');
    radioAt.clear();
  };

  const centroid = (): THREE.Vector3 => {
    const c = new THREE.Vector3();
    let n = 0;
    for (const p of game.players) if (p.alive) { c.add(p.position); n++; }
    return n ? c.multiplyScalar(1 / n) : V(ENTRY.x, 0, ENTRY.z);
  };

  // ---- hostiles ----
  const spawnPatrol = (kind: EnemyKind, route: [number, number][], opts: { loop?: boolean; holds?: [number, number][]; start?: number } = {}): void => {
    const pts = route.map(([x, z]) => V(x, 0, z));
    const i0 = opts.start ?? 0;
    const e = ctx.spawn(kind, pts[i0], { squad: 8850 + patrols.length });
    e.squadSize = 1;
    patrols.push({ e, route: pts, i: (i0 + 1) % pts.length, step: 1, loop: !!opts.loop, pause: 0, holds: new Map(opts.holds ?? []) });
  };
  const spawnGuard = (kind: EnemyKind, x: number, z: number, yaw: number, swing: number): void => {
    const e = ctx.spawn(kind, V(x, 0, z), { squad: 8870 + guards.length });
    e.facingYaw = yaw;
    guards.push({ e, yaw, swing, ph: guards.length * 2.1 });
  };
  const spawnAll = (): void => {
    // the west lane: one walker — learn the sweep, learn the takedown
    spawnPatrol('stormtrooper', [[-39, 12], [-40, 42]]);
    // the middle: round the big tank
    spawnPatrol('stormtrooper', [[-16, 20], [2, 20], [2, 38], [-16, 38]], { loop: true });
    // the north lane: a pair at three or more
    spawnPatrol('stormtrooper', [[-34, 63], [14, 63]]);
    if (party >= 3) spawnPatrol('stormtrooper', [[-34, 66], [14, 66]], { start: 1 });
    // the east lane, which checks the booth
    spawnPatrol('stormtrooper', [[38, 12], [38, 48], [22, 40], [12, 10], [26, 12]], { loop: true, holds: [[3, 3]] });
    if (party >= 2) spawnPatrol('stormtrooper', [[8, 26], [24, 26], [24, 50], [8, 50]], { loop: true, start: 2 });
    // the stair: one watching the lane, one watching the stair (his back to the lane)
    spawnGuard(party >= 3 ? 'deathtrooper' : 'stormtrooper', 16, 60.5, -Math.PI / 2 - 0.4, 0.5);
    spawnGuard('stormtrooper', 18.5, 65, Math.PI / 2, 0.35);
    if (party >= 4) spawnGuard('stormtrooper', -2, 47, Math.PI, 0.9);
  };

  const updatePatrols = (dt: number): void => {
    for (const pt of patrols) {
      const e = pt.e;
      if (!e.alive || e.awareness !== 'idle') continue;
      const goal = pt.route[pt.i];
      e.post.copy(goal);
      e.idleGoal.copy(goal);
      if (Math.hypot(e.position.x - goal.x, e.position.z - goal.z) < 1.4) {
        const hold = pt.holds.get(pt.i);
        if (hold && pt.pause <= 0) pt.pause = hold;
        if (pt.pause > 0) { pt.pause -= dt; if (pt.pause > 0) continue; }
        if (pt.route.length < 2) pt.i = 0;
        else if (pt.loop) pt.i = (pt.i + 1) % pt.route.length;
        else {
          if (pt.i + pt.step >= pt.route.length || pt.i + pt.step < 0) pt.step = pt.step === 1 ? -1 : 1;
          pt.i += pt.step;
        }
      }
    }
    for (const g of guards) {
      const e = g.e;
      if (!e.alive || e.awareness !== 'idle') continue;
      e.idleGoal.copy(e.post);
      e.facingYaw = g.yaw + Math.sin(game.time * 0.35 + g.ph) * g.swing;
    }
  };

  /** the radio: a trooper who has seen you calls it in unless he is dropped first */
  const updateRadio = (): void => {
    const t = game.time;
    for (const e of game.enemies) {
      if (e.team !== 1) continue;
      if (!e.alive) { radioAt.delete(e); continue; }
      const engaged = e.awareness === 'engaged';
      if (!alarm && engaged && calm.get(e) === true && !radioAt.has(e)) radioAt.set(e, t);
      if (!engaged) radioAt.delete(e);
      calm.set(e, !engaged);
    }
    // a body taken out of the match (not killed) never reaches the loop above
    for (const e of radioAt.keys()) if (e.removeMe || !e.alive) radioAt.delete(e);
    if (alarm) return;
    for (const [e, at] of radioAt) {
      if (e.awareness === 'engaged' && t - at >= RADIO) { trip('radio'); return; }
    }
  };
  const radioLeft = (): number => {
    let m = Infinity;
    for (const at of radioAt.values()) m = Math.min(m, RADIO - (game.time - at));
    return m;
  };

  const updateLights = (dt: number): void => {
    lightsOff = Math.max(0, lightsOff - dt);
    boothCool = Math.max(0, boothCool - dt);
    const dark = lightsOff > 0 && !alarm;
    for (const sl of searchlights) {
      if (alarm) {
        // the lights hunt: onto the nearest player in the open
        let best: THREE.Vector3 | null = null, bd = Infinity;
        for (const p of game.players) {
          if (!p.alive) continue;
          const d = p.position.distanceTo(sl.lamp);
          if (d < bd && d < 50) { bd = d; best = p.position; }
        }
        if (best) sl.aim.lerp(best, Math.min(1, dt * 1.5));
      } else {
        const L = pathLen(sl.path);
        sl.s += sl.dir * sl.speed * dt;
        if (sl.s > L) { sl.s = L; sl.dir = -1; } else if (sl.s < 0) { sl.s = 0; sl.dir = 1; }
        const want = pointAt(sl.path, sl.s, new THREE.Vector3());
        sl.aim.lerp(want, Math.min(1, dt * 3));
      }
      sl.cone.dir.copy(sl.aim).sub(sl.lamp).normalize();
      sl.cone.on = !dark;
      sl.beam.visible = !dark;
      sl.beam.quaternion.setFromUnitVectors(DOWN, sl.cone.dir);
      sl.beamMat.color.setHex(alarm ? 0xff6050 : 0xd8ecff);
      sl.spot.color.setHex(alarm ? 0xff5040 : 0xe0f0ff);
      sl.spot.intensity = dark ? 0 : SPOT_I;
      sl.spot.target.position.copy(sl.aim);
      sl.drum.quaternion.setFromUnitVectors(DOWN, sl.cone.dir);
    }
    for (const s of sensors) {
      s.yawNow += s.rate * dt;
      s.cone.dir.set(Math.sin(s.yawNow), -0.12, Math.cos(s.yawNow)).normalize();
      s.beam.quaternion.setFromUnitVectors(DOWN, s.cone.dir);
      s.head.rotation.y = s.yawNow;
    }
    for (const l of stairLights) l.intensity = 38 + Math.sin(game.time * 13 + l.position.x) * 2;
  };

  const updateVents = (dt: number): void => {
    for (const v of vents) {
      v.t += dt;
      const ph = v.t % VENT_CYCLE;
      const on = ph < VENT_ON;
      if (on && !v.mask.on) {
        let near = Infinity;
        for (const p of game.players) if (p.alive) near = Math.min(near, p.position.distanceTo(v.pos));
        audio.steamHiss(Math.max(0.03, Math.min(0.4, 10 / Math.max(near, 4))));
      }
      v.mask.on = on;
      const m = v.plume.material as THREE.MeshBasicMaterial;
      const fade = on ? Math.min(1, ph / 0.5, (VENT_ON - ph) / 0.6) : 0;
      m.opacity = 0.32 * fade;
      v.plume.visible = fade > 0.01;
      v.plume.scale.set(1 + Math.sin(game.time * 3) * 0.05, 0.7 + fade * 0.3, 1);
      if (on) {
        v.puff -= dt;
        if (v.puff <= 0) { v.puff = 0.12; game.particles.dustPuff(v.pos, 4); }
      }
    }
  };

  const updateTurrets = (dt: number): void => {
    for (const t of turrets) {
      const up = alarm && !t.b.broken;
      t.rise = THREE.MathUtils.clamp(t.rise + (up ? dt / 1.5 : -dt / 1.5), 0, 1);
      if (!alarm && t.b.broken && t.rise <= 0) {
        // re-armed under the hatch for the next alarm
        t.b.broken = false;
        t.b.hp = t.b.maxHp;
        t.group.visible = true;
      }
      t.group.position.y = Y0 - 3.2 + t.rise * 3.2;
      const cy = t.group.position.y + 1.6;
      if (t.rise > 0.05 && !t.b.broken) {
        t.b.box.min.set(t.base.x - 0.7, cy - 1.6, t.base.z - 0.7);
        t.b.box.max.set(t.base.x + 0.7, cy + 1.6, t.base.z + 0.7);
        if (!ctx.board.physics.boxes.includes(t.b.box)) ctx.board.physics.boxes.push(t.b.box);
      } else {
        const i = ctx.board.physics.boxes.indexOf(t.b.box);
        if (i >= 0) ctx.board.physics.boxes.splice(i, 1);
      }
      t.b.center.set(t.base.x, cy + 1, t.base.z);
      if (t.rise < 1 || t.b.broken) continue;
      // track and fire at the nearest player it can see
      const muzzle = V(t.base.x, 2.7, t.base.z);
      let target: Player | null = null, bd = 42;
      for (const p of game.players) {
        if (!p.alive) continue;
        const d = p.position.distanceTo(muzzle);
        if (d < bd && field.clearLine(muzzle, p.position.clone().setY(p.position.y + 1.2))) { bd = d; target = p; }
      }
      if (!target) continue;
      const to = target.position.clone().setY(target.position.y + 1.1).sub(muzzle);
      t.head.rotation.y = Math.atan2(to.x, to.z);
      t.cd -= dt;
      if (t.cd <= 0) {
        t.cd = 0.75 + Math.random() * 0.4;
        const d = to.normalize();
        d.x += (Math.random() - 0.5) * 0.05; d.y += (Math.random() - 0.5) * 0.03; d.z += (Math.random() - 0.5) * 0.05;
        game.projectiles.fire(muzzle.clone().addScaledVector(d, 1.2), d.normalize(), 32, party >= 3 ? 7 : 6, 1, -1);
        audio.enemyBlaster();
      }
    }
  };

  // ---- the golden path (the west lane, then the north lane, then the stair) ----
  const route: { at: THREE.Vector3; stair?: boolean }[] = [
    { at: V(-36, 0, 5) }, { at: V(-39, 0, 14) }, { at: V(-40, 0, 27) }, { at: V(-40, 0, 40) },
    { at: V(-39, 0, 52) }, { at: V(-30, 0, 62) }, { at: V(-18, 0, 66) }, { at: V(-4, 0, 66) },
    { at: V(10, 0, 66) }, { at: V(18, 0, 65) },
    { at: V(STAIR.x0 + 2, 1, 65), stair: true }, { at: V(CROWN.x0 + 2, CROWN.top, 65), stair: true },
    { at: V(38, CROWN.top, 66), stair: true },
  ];
  const path = route.map((r) => r.at);
  const progressOf = (p: THREE.Vector3): number => {
    let best = 0, bd = Infinity;
    route.forEach((r, i) => { const d = r.at.distanceTo(p); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  const onTop = (p: THREE.Vector3): boolean =>
    p.x > CROWN.x0 && p.z > CROWN.z0 && p.y > Y0 + CROWN.top - 0.5;

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      spawnAll();
      for (const [x, z] of [[-41, 48], [-2, 68], [22, 8]] as const) ctx.pickup(V(x, 0, z));
      ctx.announce(T.title, T.sub);
      Enemy.stealthSight = { scale: 0.5, behind: 1.8 };
      // the plant's own base alarm stays out of it: this yard has its own
      if (boardUpdate) ctx.board.update = (d, time) => boardUpdate(d, time);
      ctx.board.lightAt = (x, z) => {
        if (alarm) return 1;
        if (field.lightAtGround(x, Y0, z) > 0) return 1;
        if (x > STAIR.x0 - 4 && z > STAIR.z0 - 6) return 0.6;   // the lit stair
        for (const [lx, lz] of lampPools) if ((x - lx) ** 2 + (z - lz) ** 2 < 36) return 0.5;
        return 0;
      };
      takedowns.onTakedown = () => ctx.announce(T.takedown);
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
          meleeHit: (pl, target, amount) => takedowns.meleeHit(pl, target, amount),
        });
      }
    }
    alarmT += dt;
    scene.environmentIntensity = NIGHT_ENV;
    takedowns.update();
    updatePatrols(dt);
    updateLights(dt);
    updateVents(dt);
    field.update(dt);
    updateRadio();
    updateTurrets(dt);
    interactions.update(dt, game);

    for (const [i, m] of consoleLamps.entries()) {
      void i;
      m.color.setHex(alarm ? (Math.sin(game.time * 9) > 0 ? 0xff4433 : 0x581410) : 0x2a6a2a);
    }
    if (alarm && Math.floor(alarmT / 3) !== Math.floor((alarmT - dt) / 3)) audio.alarm(0.35);

    // the dark corners reached: where the fallen come back
    for (const p of game.players) {
      if (!p.alive) continue;
      const prog = progressOf(p.position);
      for (let k = safeIdx + 1; k < SAFE.length; k++) {
        const s = V(SAFE[k][0], 0, SAFE[k][1]);
        if (progressOf(s) <= prog) { safeIdx = k; ctx.checkpoint.copy(s); }
      }
      if (onTop(p.position)) complete = true;
    }
  };

  const objective = () => {
    if (alarm) {
      if (dropCleared()) {
        let best = consoles[0], bd = Infinity;
        const c = centroid();
        for (const it of consoles) { const d = it.spec.pos.distanceTo(c); if (d < bd) { bd = d; best = it; } }
        return { pos: best.spec.pos.clone(), label: T.resetLabel, hint: T.resetHint, beacon: false };
      }
      return { pos: V(STAIR.x0, 0, 65), label: T.stair, hint: T.alarmHint, beacon: false };
    }
    const lead = game.players.some((p) => p.alive && p.position.x > STAIR.x0 - 3 && p.position.z > STAIR.z0 - 4);
    return { pos: lead ? V(38, CROWN.top, 66) : V(STAIR.x0, 0, 65), label: T.stair, hint: lead ? T.climbHint : T.stairHint, beacon: false };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => ctx.defaultRespawn(slot, ctx.checkpoint, new THREE.Vector3(0, 0, 1));

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [];
    const lvl = field.level(slot);
    if (alarm) bars.push({ label: T.alarm, value: 1, tone: 'danger' });
    else bars.push({ label: T.seen, value: lvl, tone: lvl > 0.66 ? 'danger' : lvl > 0.33 ? 'warn' : 'info' });
    const r = radioLeft();
    if (!alarm && r < RADIO) bars.push({ label: T.radio, value: 1 - r / RADIO, tone: 'danger' });
    if (lightsOff > 0) bars.push({ label: T.lightsOut, value: lightsOff / BOOTH_DARK, tone: 'good' });
    const at = interactions.hudFor(p.position);
    if (at) bars.push(at.bar);
    let line = at ? at.line : alarm ? (dropCleared() ? T.resetHint : T.alarmHint) : '';
    if (!line && r < RADIO) line = T.radioLine;
    if (!line && field.litBy[slot]) line = field.litBy[slot]!.tag === 'sensor' ? 'In a sensor beam — move' : 'In the light — move';
    return { title: T.title, bars: bars.slice(0, 3), line: line || T.stairHint };
  };

  // ---- the autopilot ----
  // Walk the lanes; before stepping into a pool of light, wait for it to pass;
  // if the alarm is up, clear it at the nearest console once the drop is down.
  const cursors = [0, 0, 0, 0];
  const lastPos = [0, 1, 2, 3].map(() => new THREE.Vector3());
  const stuck = [0, 0, 0, 0];
  const stuckFrom = [0, 1, 2, 3].map(() => new THREE.Vector3());
  const hop = [0, 0, 0, 0];

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    // re-formed somewhere else: pick the way up again from where it stands
    if (lastPos[slot].distanceTo(p.position) > 6) cursors[slot] = progressOf(p.position);
    lastPos[slot].copy(p.position);
    const out: AutopilotInput = {};
    const go = (at: THREE.Vector3, slow = false): number => {
      const dx = at.x - p.position.x, dz = at.z - p.position.z;
      const d = Math.hypot(dx, dz);
      out.yaw = Math.atan2(dx, dz);
      if (d > 0.4) out.moveY = Math.min(slow ? 0.55 : 0.8, d / 2);
      if (at.y > p.position.y + 0.6 && d < 3) { out.jumpHeld = true; if (p.grounded) out.jumpPressed = true; }
      return d;
    };
    // wedged on something (a fence, a stack): hop over it
    stuck[slot] += 1 / 30;
    if (stuckFrom[slot].distanceTo(p.position) > 1) { stuck[slot] = 0; stuckFrom[slot].copy(p.position); }
    if (stuck[slot] > 1.5) { hop[slot] = 0.8; stuck[slot] = 0; }
    if (hop[slot] > 0) { hop[slot] -= 1 / 30; out.jumpHeld = true; if (p.grounded) out.jumpPressed = true; }

    if (alarm) {
      if (!dropCleared()) { out.shootHeld = true; }
      else {
        const it = interactions.nearest(p.position);
        if (it && consoles.includes(it)) { out.interactHeld = true; return out; }
        let best = consoles[0], bd = Infinity;
        for (const c of consoles) { const d = c.spec.pos.distanceTo(p.position); if (d < bd) { bd = d; best = c; } }
        go(best.spec.pos);
        return out;
      }
    }
    let c = Math.min(cursors[slot], route.length - 1);
    const w = route[c];
    const d = go(w.at, true);
    // before moving on, wait for the next stretch to be dark (never wait standing in the light)
    const here = field.coneAt(p.position);
    if (d < 1.4 && Math.abs(w.at.y - p.position.y) < 1.5) {
      const next = route[Math.min(c + 1, route.length - 1)];
      const mid = next.at.clone().add(p.position).multiplyScalar(0.5);
      const lit = !next.stair && (field.coneAt(next.at) || field.coneAt(mid));
      if (lit && !here && !alarm) { delete out.moveY; return out; }
      if (c < route.length - 1) c++;
    }
    cursors[slot] = c;
    return out;
  };

  const boardUpdate = ctx.board.update;
  const boardLightAt = ctx.board.lightAt;

  const inst: SectionInstance & { test: object } = {
    starts: [0, 1, 2, 3].map((i) => V(ENTRY.x - 1 + (i % 2) * 2, 0, ENTRY.z + 1 + Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + CEIL,
    groundAt: () => Y0,
    contains: (x, z) => x > -HX && x < HX && z > 0 && z < HZ,
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
      Enemy.stealthSight = null;
      ctx.board.update = boardUpdate;
      ctx.board.lightAt = boardLightAt;
      for (const d of dimmed) d.light.intensity = d.was;
      scene.environmentIntensity = envWas || 0.6;
      if (ctx.board.breakables) ctx.board.breakables = ctx.board.breakables.filter((b) => !breakables.includes(b));
      const phys = ctx.board.physics;
      const mine = new Set([...fences.map((f) => f.box), ...breakables.map((b) => b.box)]);
      phys.boxes = phys.boxes.filter((b) => !mine.has(b));
    },
    // handles for the mechanics suite (tools/test-section-refinery.mjs)
    test: {
      field, searchlights, vents, guards, patrols, consoles, trip,
      get alarm() { return alarm; }, get lightsOff() { return lightsOff; },
      get takedowns() { return takedowns.count; }, get dropCleared() { return dropCleared(); },
    },
    debug: () => ({
      alarm, tripReason, takedowns: takedowns.count, safeIdx,
      meters: game.players.map((p) => +field.level(p.slot).toFixed(2)),
      lightsOff: +lightsOff.toFixed(1),
    }),
  };
  return inst;
}

export const lightsOut: SectionDef = {
  id: 'lights-out',
  build,
  // night under the plant's smoke
  world: { fogColor: 0x0b0f18, fogNear: 22, fogFar: 120, background: 0x05070c },
};
