import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Combatant, Enemy, EnemyKind } from '../enemies/enemy';
import { addBreakable, type Breakable } from '../world/board';
import { loadOptionalTexture } from '../core/assets';
import { yawBasis } from '../core/math';
import { RailCamera } from './kit/railcam';

/**
 * The Ring Walk (docs/LEVEL_SECTIONS.md §2.3) — the Spice Run, between the
 * station's interior (stage B, whose last room is the loading gantry) and the
 * prize (stage C, the crew catwalks at 0.45 g under the stars).
 *
 * The loading gantry's far door is a maintenance airlock. It opens onto the
 * outer hull of the station's habitat ring, and the party has to walk a
 * quarter of the ring — three hundred metres of hull spine, twelve wide, with
 * the station's hub and spokes wheeling over it and a planet under it — to the
 * airlock that lets onto the crew catwalks. It is the one stage in the game
 * seen through **one** camera (K1, `kit/railcam.ts`): all four hunters in one
 * shot on a curving hull, a side-scrolling brawler in three dimensions.
 *
 * Four stretches, joined by rail gates, with three **locks** (the camera
 * stops, the frame closes, a wave arrives; clear it to move on):
 *
 * 1. **The spine** — pirates posted behind cargo pods and the conduit, a
 *    jetpack pair. Teaches the twin-stick aim.
 * 2. **The vent run** — plasma vents fire up out of grates across the whole
 *    spine on a cycle (a red glow in the grate for 1.2 s first), and two
 *    stretches of plating are gone (7 and 6 m: at 0.45 g a jump carries).
 *    Lock 1: three dropship passes over the curve, each called as the last
 *    thins (a squad, fliers, then heavier).
 * 3. **The spoke junction** — a spoke twenty metres wide climbs out of the
 *    ring toward the hub; its apron is Lock 2: three waves out of the spoke
 *    and the sky, and a gun hatch that rises out of the hull and has to be
 *    shot in its open eye (or clubbed shut).
 * 4. **The sweep** — two sensor booms, one on each edge, sweep the spine like
 *    clock hands at knee height. Caught, and the boom calls drones up over the
 *    hull's edge. Jump the beam, or put the conduit between you and the boom.
 *    Walking in sets off the booms' alarm once: a drone flight and a pair of
 *    fliers come up over the edge, so the stretch is fought under the beams
 *    rather than walked past them.
 *    Lock 3 at the airlock: the Pyke capo's retinue comes out of it.
 *
 * The ring's gravity plating is the hull: its field holds you to the spine
 * (0.45 g, the station's own), and off its edge — or down through a missing
 * panel — is the void, which re-forms you at the last rail gate. Nothing
 * resets. The fallen come back at the last gate the camera's leading edge has
 * crossed, or at the back of the shot when the camera has scrolled past it.
 *
 * **Geometry.** The ring is centred at `C` and walked from θ = 0 to θ = π/2,
 * so both ends run square to the world axes (the airlock blocks are boxes).
 * The spine's surface is a heightfield (`physics.heightAt`), which gives the
 * curve exact edges; everything standing on it is round (cylinders), which
 * the solver resolves radially, so nothing on the curve is a box that lies
 * about its footprint.
 */

/** the ring's radius at the middle of the spine, metres */
const R = 190;
/** half the spine's width */
const HALF = 6;
/** where the walk ends: the crew airlock's door, a quarter of the ring on */
const S_END = (R * Math.PI) / 2;
/** the lane runs on past the door into the airlock's throat */
const THROAT = 8;
/** the maintenance airlock the party starts in: s ∈ [CAGE, 0] */
const CAGE = -10;
/** no floor below this: the void */
const VOID = -1e4;
/** rail gates, metres along the spine */
const GATES = [0, 74, 164, 232];
/** the missing plating in the vent run */
const GAPS: [number, number][] = [[92, 99], [122, 128]];
/** the vents: where, and their phase in the cycle (seconds) */
const VENTS = [{ s: 84, phase: 0 }, { s: 108, phase: 1.6 }, { s: 115, phase: 3.2 }];
const VENT_IDLE = 2.4;
const VENT_WARN = 1.2;
const VENT_FIRE = 1.0;
const VENT_CYCLE = VENT_IDLE + VENT_WARN + VENT_FIRE;
const VENT_HALF = 0.9;
const VENT_TALL = 9;
/** the conduit down the middle: the runs it stands in, and where it is crossed */
const CONDUIT: [number, number][] = [[6, 22], [26, 46], [50, 70], [78, 91], [100, 121], [229, 247], [251, 268]];
const CONDUIT_H = 1.1;
/** the locks: the arena (window) and the centroid that springs it */
const LOCKS = [
  { from: 130, to: 164, at: 140 },
  { from: 176, to: 216, at: 188 },
  { from: 266, to: S_END, at: 276 },
];
/** the spoke junction: its apron widens the spine on the inner side */
const APRON = { from: 176, to: 214, lat: 13 };
const SPOKE_S = 196;
/** the gun hatch */
const HATCH = { s: 200, lat: -3 };
/** the sensor booms: pivot on an edge (lat), arm reach, sweep period */
const BOOMS = [{ s: 243, lat: -7.2, phase: 0 }, { s: 258, lat: 7.2, phase: 2.6 }];
const BOOM_REACH = 15;
const BOOM_PERIOD = 5.2;
const BOOM_H = 0.9;

type Lane = { s: number; lat: number };

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['ring-walk'];
  const party = Math.max(1, game.players.length);
  const C = new THREE.Vector3(0, Y0, R);

  // ---- lane maths: s along the spine, lat to its right (inward, toward the hub) ----
  const at = (s: number, lat = 0, y = Y0): THREE.Vector3 => {
    if (s > S_END) return new THREE.Vector3(R - lat, y, R + (s - S_END));
    if (s < 0) return new THREE.Vector3(s, y, lat);
    const th = s / R, r = R - lat;
    return new THREE.Vector3(r * Math.sin(th), y, R - r * Math.cos(th));
  };
  const lane = (x: number, z: number): Lane => {
    if (x < 0 && Math.abs(z) < 40) return { s: x, lat: z };
    if (z > R && Math.abs(x - R) < 40) return { s: S_END + (z - R), lat: R - x };
    const dx = x, dz = z - R;
    return { s: Math.atan2(dx, -dz) * R, lat: R - Math.hypot(dx, dz) };
  };
  function tangent(s: number): THREE.Vector3 {
    if (s < 0) return new THREE.Vector3(1, 0, 0);
    if (s > S_END) return new THREE.Vector3(0, 0, 1);
    const th = s / R;
    return new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
  }
  const yawAlong = (s: number): number => { const t = tangent(s); return Math.atan2(t.x, t.z); };
  const inGap = (s: number): boolean => GAPS.some(([a, b]) => s > a && s < b);
  const conduitAt = (s: number): boolean => CONDUIT.some(([a, b]) => s >= a && s <= b);
  const onApron = (s: number, lat: number): boolean => s > APRON.from && s < APRON.to && lat >= HALF - 0.5 && lat <= APRON.lat;
  const floorAt = (x: number, z: number): number => {
    const { s, lat } = lane(x, z);
    if (s < CAGE - 1 || s > S_END + THROAT) return VOID;
    if (s > S_END) return Math.abs(lat) <= 2.6 ? Y0 : VOID;
    if (inGap(s)) return VOID;
    if (Math.abs(lat) <= HALF || onApron(s, lat)) return Y0;
    return VOID;
  };
  // the spine is the ground: exact curved edges, and nothing under the gaps
  ctx.board.physics.heightAt = floorAt;

  // ---- materials ----
  const plate = ctx.paint(0x8a8f96, { rough: 0.7, metal: 0.55 });
  // a lathe's flat sectors face down; the hull is only ever seen from above, but say so
  plate.side = THREE.DoubleSide;
  const hullMat = ctx.paint(0x8a96a8, { rough: 0.75, metal: 0.6 });
  hullMat.side = THREE.DoubleSide;
  const dark = ctx.paint(0x24272c, { rough: 0.8, metal: 0.5 });
  const trim = ctx.paint(0x3a3f47, { rough: 0.5, metal: 0.8 });
  const amber = new THREE.MeshBasicMaterial({ color: 0xe8a23a });
  const redGlow = new THREE.MeshBasicMaterial({ color: 0xff3a24 });
  const greenGlow = new THREE.MeshBasicMaterial({ color: 0x5ee08a });
  const white = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
  for (const m of [amber, redGlow, greenGlow, white]) { ctx.own(m); m.side = THREE.DoubleSide; }
  // the spine's own plating when it lands, the station's hull plate until then
  let spine = false;
  loadOptionalTexture('ring_hull_spine', (tex) => {
    spine = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    plate.map = tex; plate.color.set(0xffffff); plate.needsUpdate = true;
  });
  loadOptionalTexture('metal_deck', (tex) => {
    if (spine) return;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    plate.map = tex; plate.color.set(0xd0dcec); plate.needsUpdate = true;
  });
  ctx.tile(hullMat, 'hull_plate_large', 1, 1, { normal: true });

  // ---- the ring: a lathe round the station's axis ----
  // Lathe vertices are (r sin φ, y, r cos φ) about C; the walk's θ is φ = π − θ.
  const lathe = (profile: [number, number][], th0: number, th1: number, mat: THREE.Material, uvScale?: [number, number]): THREE.Mesh => {
    const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
    const segs = Math.max(4, Math.ceil(Math.abs(th1 - th0) * R / 3));
    const geo = new THREE.LatheGeometry(pts, segs, Math.PI - th1, th1 - th0);
    if (uvScale) {
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[0], uv.getY(i) * uvScale[1]);
    }
    ctx.own(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(C).setY(0);
    m.receiveShadow = true;
    return ctx.mesh(m);
  };
  // the spine's plating, walked sectors only, broken at the gaps
  const deck = (s0: number, s1: number, r0 = R - HALF, r1 = R + HALF): void => {
    const len = s1 - s0;
    lathe([[r0, Y0], [r1, Y0]], s0 / R, s1 / R, plate, [len / 6, (r1 - r0) / 6]);
  };
  const cuts = [0, ...GAPS.flat(), S_END];
  for (let i = 0; i < cuts.length; i += 2) deck(cuts[i], cuts[i + 1]);
  deck(APRON.from, APRON.to, R - APRON.lat, R - HALF);
  // the rest of the ring's walkway, round the far side — somebody else's hull
  lathe([[R - HALF, Y0], [R + HALF, Y0]], S_END / R, Math.PI * 2, plate, [(Math.PI * 1.5 * R) / 6, 2]);
  // the hull under the spine, all the way round: skirt, shoulders, belly
  const body: [number, number][] = [
    [R + HALF, Y0], [R + HALF + 0.4, Y0 - 1.2], [R + HALF + 2.6, Y0 - 3.5], [R + HALF + 3.2, Y0 - 8],
    [R + HALF + 1.2, Y0 - 13], [R - HALF - 1.2, Y0 - 13], [R - HALF - 3.2, Y0 - 8],
    [R - HALF - 2.6, Y0 - 3.5], [R - HALF - 0.4, Y0 - 1.2], [R - HALF, Y0],
  ];
  lathe(body, 0, Math.PI * 2, hullMat, [120, 2.5]);
  // the edge bands: amber hazard strips where the plating stops
  for (const r of [R - HALF, R + HALF - 0.35]) lathe([[r, Y0 + 0.02], [r + 0.35, Y0 + 0.02]], 0, S_END / R, amber);
  // pipe runs along both edges, as the hull carries them
  const tube = (s0: number, s1: number, lat: number, y: number, rad: number, mat: THREE.Material): void => {
    const pts: THREE.Vector3[] = [];
    for (let s = s0; s <= s1 + 0.01; s += 3) pts.push(at(Math.min(s, s1), lat, y));
    if (pts.length < 2) return;
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, rad, 8, false);
    ctx.own(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    ctx.mesh(m);
  };
  for (const lat of [-HALF - 0.9, HALF + 0.9]) tube(-40, S_END + 4, lat, Y0 - 0.6, 0.45, trim);
  // blinking edge lights every eight metres, the rhythm the eye walks by
  const lampGeo = new THREE.SphereGeometry(0.16, 6, 4);
  ctx.own(lampGeo);
  const edgeLamps = new THREE.InstancedMesh(lampGeo, amber, Math.ceil(S_END / 8) * 2 + 2);
  {
    const m = new THREE.Matrix4();
    let k = 0;
    for (let s = 4; s < S_END; s += 8) {
      for (const lat of [-HALF + 0.2, HALF - 0.2]) {
        if (inGap(s)) continue;
        m.makeTranslation(at(s, lat, Y0 + 0.12));
        edgeLamps.setMatrixAt(k++, m);
      }
    }
    edgeLamps.count = k;
    ctx.mesh(edgeLamps);
  }

  // ---- the conduit: a lane divider you hop, which stops bolts and beams ----
  for (const [a, b] of CONDUIT) {
    tube(a, b, 0, Y0 + CONDUIT_H - 0.95, 0.95, trim);
    // solid as a chain of posts: round, so the curve has no corners to catch on
    for (let s = a; s <= b; s += 1.5) {
      const p = at(s);
      ctx.cyl(p.x, Y0 + CONDUIT_H / 2, p.z, 0.95, CONDUIT_H, null);
    }
  }

  // ---- the missing plates: a hole into the dark of the hull ----
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 1, metalness: 0, side: THREE.BackSide });
  ctx.own(pitMat);
  for (const [a, b] of GAPS) {
    const mid = (a + b) / 2;
    const c = at(mid, 0, Y0 - 5);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(b - a, 10, HALF * 2), pitMat);
    ctx.own(pit.geometry);
    pit.position.copy(c);
    pit.rotation.y = yawAlong(mid) - Math.PI / 2;
    ctx.mesh(pit);
    // torn edges, lit red, so the gap reads from the camera
    for (const s of [a, b]) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, HALF * 2), redGlow);
      ctx.own(lip.geometry);
      lip.position.copy(at(s, 0, Y0 + 0.04));
      lip.rotation.y = pit.rotation.y;
      ctx.mesh(lip);
    }
  }

  // ---- the maintenance airlock the party starts in ----
  // A cage on the hull in front of the loading gantry's bulkhead: posts, a
  // roof frame and ray-shield panes (you can see into it from the rail),
  // its inner door the transport door the party just came through.
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x7fc4ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  ctx.own(shieldMat);
  // the gantry's bulkhead behind the cage: the door you came through, shut
  // Solid, but drawn as one face toward the ring: the rail camera starts
  // behind this wall looking through it at the party, as a brawler's camera
  // looks through the near side of a building.
  ctx.box(CAGE - 1, Y0 + 6, 0, 2, 20, (HALF + 4) * 2, null);
  const gantryMat = ctx.paint(0x2c3038, { rough: 0.7, metal: 0.6 });
  const gantry = new THREE.Mesh(new THREE.PlaneGeometry((HALF + 4) * 2, 18), gantryMat);
  ctx.own(gantry.geometry);
  gantry.position.set(CAGE - 0.02, Y0 + 7, 0);
  gantry.rotation.y = Math.PI / 2;
  ctx.mesh(gantry);
  // one-sided like the wall it is set in
  const innerMat = new THREE.MeshBasicMaterial({ color: 0xff3a24 });
  ctx.own(innerMat);
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(4, 4.4), innerMat);
  ctx.own(inner.geometry);
  inner.position.set(CAGE + 0.03, Y0 + 2.2, 0);
  inner.rotation.y = Math.PI / 2;
  ctx.mesh(inner);
  // the cage's sides: posts and panes, solid
  for (const side of [-1, 1]) {
    ctx.box((CAGE + 0) / 2, Y0 + 2.5, side * (HALF - 0.6), -CAGE, 5, 0.3, null);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(-CAGE, 5), shieldMat);
    ctx.own(pane.geometry);
    pane.position.set(CAGE / 2, Y0 + 2.5, side * (HALF - 0.6));
    ctx.mesh(pane);
    for (let x = CAGE; x <= 0.01; x += 5) ctx.cyl(x, Y0 + 2.6, side * (HALF - 0.6), 0.22, 5.2, trim);
  }
  for (let x = CAGE; x <= 0.01; x += 2.5) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, HALF * 2 - 1), trim);
    ctx.own(beam.geometry);
    beam.position.set(x, Y0 + 5.1, 0);
    ctx.mesh(beam);
  }
  // the outer door: a shield across the cage's mouth, dropped once it cycles
  const outerDoor = ctx.box(-0.3, Y0 + 2.5, 0, 0.3, 5, (HALF - 0.6) * 2, null).box;
  const outerPane = new THREE.Mesh(new THREE.PlaneGeometry((HALF - 0.6) * 2, 5), shieldMat.clone());
  ctx.own(outerPane.geometry); ctx.own(outerPane.material as THREE.Material);
  outerPane.position.set(-0.3, Y0 + 2.5, 0);
  outerPane.rotation.y = Math.PI / 2;
  ctx.mesh(outerPane);
  const cageLamp = new THREE.PointLight(0xffe6c0, 30, 18, 1.6);
  cageLamp.position.set(CAGE / 2, Y0 + 4.4, 0);
  ctx.mesh(cageLamp);

  // ---- the crew airlock at the far end ----
  // A module on the hull, wider than the spine, its door a throat into it:
  // the crew catwalks (stage C) are through it. Solid round the throat.
  const endX = R, endZ = R;
  const modW = HALF + 5, modD = 22, modH = 18;
  ctx.box(endX - (modW + 2.6) / 2, Y0 + modH / 2 - 2, endZ + modD / 2, modW - 2.6, modH + 4, modD, dark);
  ctx.box(endX + (modW + 2.6) / 2, Y0 + modH / 2 - 2, endZ + modD / 2, modW - 2.6, modH + 4, modD, dark);
  ctx.box(endX, Y0 + (modH + 4.4) / 2, endZ + modD / 2, 5.2, modH - 4.4, modD, dark);
  ctx.box(endX, Y0 + modH / 2, endZ + THROAT + (modD - THROAT) / 2, 5.2, modH, modD - THROAT, dark);
  // the throat's inside: lit, so the way on is the brightest thing at the end
  const throatLamp = new THREE.PointLight(0xbfe0ff, 0, 20, 1.4);
  throatLamp.position.set(endX, Y0 + 3.4, endZ + 3);
  ctx.mesh(throatLamp);
  const endDoorBox = ctx.box(endX, Y0 + 2.2, endZ + 0.3, 5.2, 4.4, 0.4, trim);
  const endDoor = { box: endDoorBox.box, mesh: endDoorBox.mesh!, open: 0, want: 0, solid: true };
  // a lit frame round the door, red while it is held, green once it is the way on
  const frameMat = new THREE.MeshBasicMaterial({ color: 0xff3a24 });
  ctx.own(frameMat);
  for (const [x, y, w, hh] of [[-3, 2.5, 0.4, 5], [3, 2.5, 0.4, 5], [0, 5.1, 6.4, 0.4]] as const) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.3), frameMat);
    ctx.own(bar.geometry);
    bar.position.set(endX + x, Y0 + y, endZ - 0.12);
    ctx.mesh(bar);
  }
  // A collider that comes and goes (the door, the hatch) is taken out of and
  // put back into the physics list directly: `ctx.unsolid` would also drop it
  // from the context's ledger, and a box put back after that would outlive
  // the stage.
  const solid = (box: { min: THREE.Vector3 }, on: boolean): void => {
    const phys = ctx.board.physics;
    const has = phys.boxes.includes(box as never);
    if (on && !has) phys.boxes.push(box as never);
    if (!on && has) phys.boxes = phys.boxes.filter((b) => b !== box);
  };
  const setDoor = (open: boolean): void => {
    endDoor.want = open ? 1 : 0;
    if (open === endDoor.solid) { solid(endDoor.box, !open); endDoor.solid = !open; }
  };

  // ---- rail gates: arches, red while the lock ahead holds, green once passed ----
  const gateLamps: THREE.Mesh[] = [];
  for (let k = 1; k < GATES.length; k++) {
    const s = GATES[k];
    for (const lat of [-HALF - 0.6, HALF + 0.6]) {
      const p = at(s, lat);
      ctx.cyl(p.x, Y0 + 3.2, p.z, 0.35, 6.4, trim);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, HALF * 2 + 1.6), trim);
    ctx.own(beam.geometry);
    beam.position.copy(at(s, 0, Y0 + 6.4));
    beam.rotation.y = yawAlong(s) - Math.PI / 2;
    ctx.mesh(beam);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, HALF * 2 + 1.2), redGlow);
    ctx.own(lamp.geometry);
    lamp.position.copy(at(s, 0, Y0 + 6.05));
    lamp.rotation.y = beam.rotation.y;
    ctx.mesh(lamp);
    gateLamps.push(lamp);
  }
  // each lock's wall: a red fence across the spine at its far edge, while it holds
  const fenceMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
  ctx.own(fenceMat);
  const fences = LOCKS.map((l) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 1, 6), fenceMat);
    ctx.own(f.geometry);
    f.position.copy(at(l.to - 0.3, 0, Y0 + 3));
    f.rotation.y = yawAlong(l.to);
    f.visible = false;
    return ctx.mesh(f);
  });

  // ---- cover: cargo pods clamped to the hull (round, so the curve holds) ----
  const podMat = ctx.paint(0x56606e, { rough: 0.6, metal: 0.6 });
  const pods: [number, number][] = [[18, -3], [31, 3], [44, -3], [58, 3], [66, -3], [140, 3], [152, -3], [186, 3], [206, 3], [236, 3], [262, -3], [276, 3], [286, -3]];
  const POD_R = 1.0;
  for (const [s, lat] of pods) {
    const p = at(s, lat);
    const { mesh } = ctx.cyl(p.x, Y0 + 1.1, p.z, POD_R, 2.2, podMat);
    if (mesh) mesh.rotation.y = s;
    // a red hazard band round each, so cover reads at a glance from the rail
    const band = new THREE.Mesh(new THREE.CylinderGeometry(POD_R + 0.03, POD_R + 0.03, 0.22, 16, 1, true), redGlow);
    ctx.own(band.geometry);
    band.position.set(p.x, Y0 + 1.7, p.z);
    ctx.mesh(band);
  }

  // ---- the spoke junction ----
  const hub = new THREE.Vector3(C.x, Y0 + 70, C.z);
  // the station's own steel, untextured: a 150 m beam wears no tile well
  const steel = ctx.paint(0x9aa4b2, { rough: 0.55, metal: 0.7 });
  const spoke = (th: number, w: number): void => {
    // anywhere round the ring, not just on the walked quarter
    const r = R - (APRON.lat + 6);
    const base = new THREE.Vector3(r * Math.sin(th), Y0 + 3, R - r * Math.cos(th));
    const dir = hub.clone().sub(base);
    const len = dir.length() - 34;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 9, len), steel);
    ctx.own(m.geometry);
    m.position.copy(base).addScaledVector(dir.normalize(), len / 2);
    m.lookAt(hub);
    ctx.mesh(m);
    // a line of window light along it
    const lights = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.3, len * 0.9), white);
    ctx.own(lights.geometry);
    lights.position.copy(m.position);
    lights.quaternion.copy(m.quaternion);
    lights.translateY(4.6);
    ctx.mesh(lights);
  };
  // the junction's own spoke, and three more round the ring
  for (let k = 0; k < 4; k++) spoke(SPOKE_S / R + k * (Math.PI / 2), 20);
  // its base on the apron's inner edge: solid, with the door the first wave uses
  const baseP = at(SPOKE_S, APRON.lat + 5);
  ctx.cyl(baseP.x, Y0 + 6, baseP.z, 6, 16, hullMat);
  const spokeDoor = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4), amber);
  ctx.own(spokeDoor.geometry);
  spokeDoor.position.copy(at(SPOKE_S, APRON.lat - 0.95, Y0 + 2));
  spokeDoor.rotation.y = yawAlong(SPOKE_S);
  spokeDoor.lookAt(at(SPOKE_S, 0, Y0 + 2));
  ctx.mesh(spokeDoor);
  // the hub: the postcard over everything
  const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(36, 42, 46, 48), steel);
  ctx.own(hubMesh.geometry);
  hubMesh.position.copy(hub);
  ctx.mesh(hubMesh);
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(6, 16, 120, 24), steel);
  ctx.own(spire.geometry);
  spire.position.copy(hub).add(new THREE.Vector3(0, 80, 0));
  ctx.mesh(spire);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(42.4, 42.4, 1.2, 48, 1, true), white);
  ctx.own(band.geometry);
  band.position.copy(hub).add(new THREE.Vector3(0, 8, 0));
  ctx.mesh(band);

  // ---- the world under and around: a planet, a low sun ----
  const planetMat = new THREE.MeshStandardMaterial({ color: 0x4a6a8a, roughness: 1, metalness: 0 });
  ctx.own(planetMat);
  loadOptionalTexture('planet_station', (tex) => { planetMat.map = tex; planetMat.color.set(0xffffff); planetMat.needsUpdate = true; }, { exts: ['png'] });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(2200, 64, 32), planetMat);
  ctx.own(planet.geometry);
  planet.position.set(C.x - 900, Y0 - 2650, C.z - 1500);
  ctx.mesh(planet);
  const sun = new THREE.DirectionalLight(0xf4f0ea, 1.25);
  sun.position.set(C.x - 400, Y0 + 160, C.z - 500);
  sun.target.position.copy(C);
  ctx.mesh(sun);
  ctx.mesh(sun.target);
  const rim = new THREE.HemisphereLight(0x9ab8ff, 0x1a1c24, 0.55);
  ctx.mesh(rim);

  // ---- the vents ----
  const ventGrate = ctx.paint(0x2a2a2a, { rough: 0.6, metal: 0.7, emissive: 0x000000 });
  const plasmaMat = new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  ctx.own(plasmaMat);
  const vents = VENTS.map((v) => {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(VENT_HALF * 2, 0.1, HALF * 2 - 0.4), ventGrate.clone());
    ctx.own(grate.geometry); ctx.own(grate.material as THREE.Material);
    grate.position.copy(at(v.s, 0, Y0 + 0.03));
    grate.rotation.y = yawAlong(v.s) - Math.PI / 2;
    ctx.mesh(grate);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, VENT_TALL), plasmaMat.clone());
    ctx.own(sheet.geometry); ctx.own(sheet.material as THREE.Material);
    sheet.position.copy(at(v.s, 0, Y0 + VENT_TALL / 2));
    sheet.rotation.y = yawAlong(v.s);
    ctx.mesh(sheet);
    const glow = new THREE.PointLight(0xff5a24, 0, 16, 1.5);
    glow.position.copy(at(v.s, 0, Y0 + 1.5));
    ctx.mesh(glow);
    return { ...v, grate, sheet, glow, hurt: new WeakMap<object, number>() };
  });
  /** a vent's state at time t: 'idle' | 'warn' | 'fire', and seconds until it next fires */
  const ventState = (v: { phase: number }, t: number): { st: 'idle' | 'warn' | 'fire'; toFire: number } => {
    const k = ((t + v.phase) % VENT_CYCLE + VENT_CYCLE) % VENT_CYCLE;
    if (k < VENT_IDLE) return { st: 'idle', toFire: VENT_IDLE + VENT_WARN - k };
    if (k < VENT_IDLE + VENT_WARN) return { st: 'warn', toFire: VENT_IDLE + VENT_WARN - k };
    return { st: 'fire', toFire: VENT_CYCLE - k + VENT_IDLE + VENT_WARN };
  };

  // ---- the gun hatch ----
  const hatchP = at(HATCH.s, HATCH.lat);
  const hatchRing = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 20), trim);
  ctx.own(hatchRing.geometry);
  hatchRing.position.set(hatchP.x, Y0 + 0.06, hatchP.z);
  ctx.mesh(hatchRing);
  const turret = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 1.6, 16), dark);
  ctx.own(dome.geometry);
  dome.position.y = 0.8;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 8), trim);
  ctx.own(barrel.geometry);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.2, 1.0);
  turret.add(dome, barrel);
  turret.position.set(hatchP.x, Y0 - 1.8, hatchP.z);
  ctx.mesh(turret);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  ctx.own(eyeMat);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), eyeMat);
  ctx.own(eye.geometry);
  eye.position.set(0, 1.25, 0.72);
  turret.add(eye);
  const hatch = {
    alive: true, active: false, lift: 0, t: 0, open: false, fireT: 0,
    box: null as ReturnType<typeof ctx.box> | null,
    breakable: null as Breakable | null,
  };
  const hatchOpen = (open: boolean): void => {
    if (open === hatch.open) return;
    hatch.open = open;
    const list = ctx.board.breakables ??= [];
    if (open) {
      // the eye is a breakable only while it is out: bolts and blades both find it
      hatch.box ??= ctx.box(hatchP.x, Y0 + 0.9, hatchP.z, 1.8, 1.8, 1.8, null);
      solid(hatch.box.box, true);
      if (!hatch.breakable) {
        hatch.breakable = addBreakable(ctx.board, eye, hatch.box.box, 240 + 60 * party, {
          radius: 1.3,
          onBreak: () => {
            hatch.alive = false;
            eye.visible = false;
            game.particles.deathBurst(new THREE.Vector3(hatchP.x, Y0 + 1, hatchP.z), 22);
            ctx.announce(T.hatchShut);
          },
        });
      } else if (!list.includes(hatch.breakable)) list.push(hatch.breakable);
    } else if (hatch.breakable) {
      ctx.board.breakables = list.filter((b) => b !== hatch.breakable);
      if (hatch.box) solid(hatch.box.box, false);
    }
  };
  // a breakable outlives the stage otherwise: the board's list is the board's
  ctx.own({ dispose: () => { if (ctx.board.breakables && hatch.breakable) ctx.board.breakables = ctx.board.breakables.filter((b) => b !== hatch.breakable); } });

  // ---- the sensor booms ----
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85 });
  ctx.own(beamMat);
  const booms = BOOMS.map((b) => {
    const pivot = at(b.s, b.lat);
    ctx.cyl(pivot.x, Y0 + 1.1, pivot.z, 0.55, 2.2, trim);
    const arm = new THREE.Group();
    arm.position.set(pivot.x, Y0, pivot.z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), redGlow);
    ctx.own(head.geometry);
    head.position.y = 2.4;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, BOOM_REACH), beamMat);
    ctx.own(beam.geometry);
    beam.position.set(0, BOOM_H, BOOM_REACH / 2);
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 3), trim);
    ctx.own(rod.geometry);
    rod.position.set(0, 2.2, 1.5);
    arm.add(head, beam, rod);
    ctx.mesh(arm);
    // across the spine, from its own edge (toward the middle): the sweep swings ±75° about that
    const tg = tangent(b.s), inward = -Math.sign(b.lat);
    const across = Math.atan2(-tg.z * inward, tg.x * inward);
    return { ...b, pivot, arm, across, angle: across, cool: 0 };
  });
  const beamHits = (bm: typeof booms[number], pos: THREE.Vector3): boolean => {
    if (pos.y > Y0 + BOOM_H + 0.25) return false;                 // jumped it
    const dx = pos.x - bm.pivot.x, dz = pos.z - bm.pivot.z;
    const along = dx * Math.sin(bm.angle) + dz * Math.cos(bm.angle);
    if (along < 0.5 || along > BOOM_REACH) return false;
    const off = Math.abs(dx * Math.cos(bm.angle) - dz * Math.sin(bm.angle));
    if (off > 0.7) return false;
    // the conduit stands taller than the beam: on its far side, you are in its shadow
    const lp = lane(pos.x, pos.z);
    if (conduitAt(lp.s) && Math.sign(lp.lat) !== Math.sign(bm.lat) && Math.abs(lp.lat) > 1.0) return false;
    return true;
  };

  // ---- the rail camera ----
  const lanePts: THREE.Vector3[] = [];
  for (let s = CAGE - 6; s <= S_END + THROAT + 0.01; s += 1) lanePts.push(at(s, 0));
  // the lane's polyline starts at s = CAGE - 6: rail metres are offset by that
  const L0 = CAGE - 6;
  const safe = (s: number, lat: number): boolean => {
    const ws = s + L0;
    if (inGap(ws - 1) || inGap(ws) || inGap(ws + 1)) return false;
    if (VENTS.some((v) => Math.abs(ws - v.s) < 2.4)) return false;
    if (Math.abs(lat) > HALF - 0.8) return false;
    if (conduitAt(ws) && Math.abs(lat) < 1.6) return false;
    return pods.every(([ps, pl]) => Math.hypot(ps - ws, pl - lat) > 1.9);
  };
  const rail = new RailCamera({
    lane: lanePts,
    gates: GATES.map((g) => g - L0),
    // off the ring's outer side, up, and a little behind: looking along the
    // curve with the hub over the far edge of the hull
    eye: { back: 8, side: -9.5, up: 9, lookAhead: 8 },
    lead: 0.4,
    span: 28,
    maxSpeed: 8,
    fov: 54,
    stop: S_END - 10 - L0,
    safe,
    groundAt: () => Y0,
    formation: [-3, 3, -4.6, 4.6],
    width: 16,
  });
  /** a world lane position to rail metres, and back */
  const rs = (s: number): number => s - L0;
  const ws = (r: number): number => r + L0;

  // ---- state ----
  let started = false;
  let t = 0;
  let doorT = 2.2;          // the outer door cycles this long after arrival
  let lockIdx = -1;         // the lock standing, or -1
  let lockDone = 0;         // how many locks are cleared
  let complete = false;
  let releasing = false;
  const lockBodies: Enemy[] = [];
  let dropHold = 0;
  let capo: Enemy | null = null;
  let wave = 0;             // the wave inside the standing lock
  let waveT = 0;
  let lastGate = 0;
  const spotted = [0, 0, 0, 0];
  const jumpT = [0, 0, 0, 0];
  const meleeT = [0, 0, 0, 0];
  let drones = 0;
  /** the sweep's alarm: rung once, as the party walks in under the booms */
  let sweepAlarm = false;
  const SWEEP_ALARM_AT = 238;

  const spawnPosted = (kind: EnemyKind, s: number, lat: number, dy = 0): Enemy =>
    ctx.spawn(kind, at(s, lat, Y0 + dy), { exact: true });

  const spawnStart = (): void => {
    // the spine: posted behind the pods and the conduit, and a jetpack pair
    const posts: [number, number][] = [[22, -2.4], [30, 4.6], [36, 2.2], [46, -4.6], [48, -2.2], [60, 2.4], [70, -3], [42, 4.6], [54, -4.6]];
    const n = Math.min(posts.length, 5 + party);
    for (let i = 0; i < n; i++) spawnPosted(i % 3 === 2 ? 'pyke' : 'pirate', posts[i][0], posts[i][1]);
    spawnPosted('jetpirate', 62, -3, 4);
    spawnPosted('jetpirate', 64, 3, 5);
    // the vent run: two between the gaps
    spawnPosted('pirate', 104, -3);
    if (party >= 2) spawnPosted('pirate', 112, 3);
    // the sweep: posted by the booms, under their cover
    const sweep: [number, number][] = [[240, 3], [250, -3], [264, 3], [246, -4]];
    for (let i = 0; i < Math.min(sweep.length, 1 + party); i++) spawnPosted(i % 2 ? 'pyke' : 'pirate', sweep[i][0], sweep[i][1]);
    // bacta at the gates
    ctx.pickup(at(GATES[1] + 3, 2));
    ctx.pickup(at(GATES[2] + 3, -2));
    ctx.pickup(at(GATES[3] + 3, 2));
    if (party > 2) ctx.pickup(at(APRON.from + 6, 8));
  };

  const arenaSpots = (l: { from: number; to: number }, n: number): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const s = l.from + (l.to - l.from) * (0.55 + 0.4 * ((i * 0.618) % 1));
      out.push(at(s, (i % 2 ? 1 : -1) * (2.4 + (i % 3)), Y0));
    }
    return out;
  };
  // A carrier takes a while to arrive and its squad falls a long way, so a
  // lock never trusts a drop as landed: it holds for DROP_GRACE seconds after
  // one is called, and counts every hostile in (or over) its arena as standing.
  const DROP_GRACE = 11;
  const drop = (kinds: EnemyKind[], spots: THREE.Vector3[]): void => {
    dropHold = DROP_GRACE;
    ctx.drop(kinds, spots, (bodies) => { lockBodies.push(...bodies); });
  };

  const springLock = (k: number): void => {
    lockIdx = k;
    wave = 0;
    waveT = 0;
    const l = LOCKS[k];
    rail.lock(rs(l.from), rs(l.to));
    fences[k].visible = true;
    const title = [T.lock1, T.lock2, T.lock3][k];
    const sub = [T.lock1Sub, T.lock2Sub, T.lock3Sub][k];
    ctx.announce(title, sub);
  };

  /** the waves inside a lock: returns true once the last is out and down */
  const runLock = (dt: number): boolean => {
    const l = LOCKS[lockIdx];
    waveT += dt;
    dropHold = Math.max(0, dropHold - dt);
    const standingNow = (): number => {
      let n = dropHold > 0 ? 1 : 0;
      for (const e of game.enemies) {
        if (!e.alive || e.team !== 1) continue;
        if (lockBodies.includes(e)) { n++; continue; }
        const lp = lane(e.position.x, e.position.z);
        if (lp.s > l.from - 6 && lp.s < l.to + 6 && Math.abs(lp.lat) < 22) n++;
      }
      return n;
    };
    /** the wave in hand is down to its last one or two, and nothing is still falling */
    const thin = (): boolean => dropHold <= 0 && standingNow() <= Math.min(2, party);
    const budget = Math.min(8, 2 + party);
    if (lockIdx === 0) {
      // three dropship passes over the curve: a squad, fliers, then heavier — each
      // called while the last is still on its feet, so the arena never goes quiet
      if (wave === 0 && waveT > 1.2) { wave = 1; waveT = 0; drop(ctx.squadFor(ctx.wave, budget), arenaSpots(l, budget)); }
      if (wave === 1 && (waveT > 22 || thin())) {
        wave = 2; waveT = 0;
        drop(ctx.squadFor(ctx.wave + 1, budget, { air: true }), arenaSpots(l, budget));
      }
      if (wave === 2 && (waveT > 22 || thin())) {
        wave = 3; waveT = 0;
        drop(ctx.squadFor(ctx.wave + 2, budget + 1), arenaSpots(l, budget + 1));
      }
      return wave === 3 && dropHold <= 0 && standingNow() === 0;
    }
    if (lockIdx === 1) {
      // out of the spoke's door; then fliers off the spoke, and the hatch; then a drop
      if (wave === 0 && waveT > 1) {
        wave = 1; waveT = 0;
        for (let i = 0; i < budget + 1; i++) lockBodies.push(spawnPosted(i % 3 === 2 ? 'pyke' : 'pirate', SPOKE_S - 5 + i * 2, APRON.lat - 2 - (i % 2) * 3));
      }
      if (wave === 1 && (waveT > 25 || thin())) {
        wave = 2; waveT = 0;
        hatch.active = true;
        for (let i = 0; i < Math.max(2, Math.ceil(budget / 2)); i++) lockBodies.push(spawnPosted('jetpirate', SPOKE_S - 6 + i * 4, 6 + (i % 2) * 4, 8));
      }
      if (wave === 2 && (waveT > 25 || thin())) {
        wave = 3; waveT = 0;
        const kinds = ctx.squadFor(ctx.wave + 2, budget + 1);
        if (party >= 2) kinds[0] = 'enforcer';
        drop(kinds, arenaSpots(l, kinds.length));
      }
      return wave === 3 && dropHold <= 0 && standingNow() === 0 && !hatch.alive;
    }
    // the capo's retinue walks out of the airlock the party wants; when the capo
    // is half down he calls his crew off a carrier
    if (wave === 0 && waveT > 0.8) {
      wave = 1; waveT = 0;
      endDoor.want = 1;
      capo = spawnPosted('capo', S_END - 4, 0);
      lockBodies.push(capo);
      const guards: EnemyKind[] = ['pyke', 'pyke', 'pirate', 'pyke', 'pirate', 'pyke'];
      for (let i = 0; i < Math.min(guards.length, 2 + party); i++) lockBodies.push(spawnPosted(guards[i], S_END - 6 - (i >> 1) * 2, (i % 2 ? 1 : -1) * 3));
      if (party >= 2) lockBodies.push(spawnPosted('enforcer', S_END - 8, 0));
    }
    if (wave === 1 && waveT > 2.5) endDoor.want = 0;
    if (wave === 1 && capo && (!capo.alive || capo.hp < capo.maxHp * 0.5)) {
      wave = 2; waveT = 0;
      drop(ctx.squadFor(ctx.wave + 2, budget), arenaSpots(l, budget));
    }
    return wave === 2 && dropHold <= 0 && standingNow() === 0;
  };

  const leader = (): number => {
    let best = -Infinity;
    for (const p of game.players) if (p.alive) best = Math.max(best, lane(p.position.x, p.position.z).s);
    return best;
  };

  const update = (dt: number): void => {
    if (complete) return;
    t += dt;
    if (!started) {
      started = true;
      spawnStart();
      rail.engage(game);
      ctx.checkpoint.copy(at(-5, 0));
      ctx.announce(T.title, T.sub);
    }
    rail.update(dt);
    if (releasing) {
      if (rail.out) complete = true;
      return;
    }

    // the outer door cycles, then the hull is the party's
    if (doorT > 0) {
      doorT -= dt;
      (outerPane.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(t * 14) * 0.08;
      if (doorT <= 0) {
        ctx.unsolid({ box: outerDoor });
        outerPane.visible = false;
        ctx.announce(T.open, T.openSub);
      }
    }

    // gates: a checkpoint each time the leading edge crosses one
    if (rail.gateIdx > lastGate) {
      lastGate = rail.gateIdx;
      ctx.checkpoint.copy(at(GATES[lastGate], 0));
      ctx.announce(TEXT.banners.checkpoint, T.gateSub(lastGate));
    }
    gateLamps.forEach((m, i) => {
      const passed = rail.gateIdx >= i + 1;
      const held = lockIdx >= 0 && LOCKS[lockIdx].to >= GATES[i + 1] - 1 && LOCKS[lockIdx].from < GATES[i + 1];
      m.material = held ? redGlow : passed ? greenGlow : amber;
    });

    // locks: sprung by the party's centroid, held until the waves are down
    const c = rail.centroid(game);
    const cw = c === null ? -Infinity : ws(c);
    if (lockIdx < 0 && lockDone < LOCKS.length && cw >= LOCKS[lockDone].at) springLock(lockDone);
    if (lockIdx >= 0) {
      fenceMat.opacity = 0.25 + Math.sin(t * 6) * 0.1;
      if (runLock(dt)) {
        fences[lockIdx].visible = false;
        rail.unlock();
        lockBodies.length = 0;
        lockIdx = -1;
        lockDone++;
        if (lockDone === LOCKS.length) {
          endDoor.want = 1;
          setDoor(true);
          throatLamp.intensity = 40;
          ctx.announce(T.airlockOpen, T.airlockSub);
        } else ctx.announce(T.clear);
      }
    }

    // The sweep's alarm (tuning pass, 2026-09-28): bots walked the booms in
    // seven seconds, so the stretch's own verb was barely played. One flight,
    // once, as the party walks in — then the beams sweep over a fight.
    if (!sweepAlarm && lockIdx < 0 && cw >= SWEEP_ALARM_AT) {
      sweepAlarm = true;
      ctx.announce(T.alarm, T.alarmSub);
      const n = Math.min(6, 2 + party);
      for (let i = 0; i < n; i++) {
        ctx.spawn('drone', at(252 + i * 3, (i % 2 ? -1 : 1) * (HALF + 5), Y0 - 4), { exact: true, alert: true });
        drones++;
      }
      for (let i = 0; i < (party >= 2 ? 2 : 1); i++) ctx.spawn('jetpirate', at(262 + i * 4, (i % 2 ? 3 : -3), Y0 + 6), { exact: true, alert: true });
    }

    // the end door slides into the frame above it
    endDoor.open += Math.sign(endDoor.want - endDoor.open) * Math.min(Math.abs(endDoor.want - endDoor.open), dt / 0.8);
    endDoor.mesh.position.y = Y0 + 2.2 + endDoor.open * 4.2;
    frameMat.color.setHex(lockDone === LOCKS.length ? 0x5ee08a : 0xff3a24);
    // into the throat: the camera gives the screen back, then the run carries on
    if (lockDone === LOCKS.length) {
      for (const p of game.players) {
        if (!p.alive) continue;
        if (lane(p.position.x, p.position.z).s > S_END + 2.5) { releasing = true; rail.release(); break; }
      }
    }

    // vents
    for (const v of vents) {
      const { st } = ventState(v, t);
      const gm = v.grate.material as THREE.MeshStandardMaterial;
      const sm = v.sheet.material as THREE.MeshBasicMaterial;
      if (st === 'idle') { gm.emissive.setHex(0x000000); sm.opacity = 0; v.glow.intensity = 0; continue; }
      if (st === 'warn') {
        const k = 0.5 + 0.5 * Math.sin(t * 18);
        gm.emissive.setRGB(0.9 * k + 0.3, 0.12, 0.05);
        sm.opacity = 0.05;
        v.glow.intensity = 12 * k;
        continue;
      }
      gm.emissive.setRGB(1.2, 0.45, 0.1);
      sm.opacity = 0.3 + Math.random() * 0.12;
      v.glow.intensity = 70;
      const bodies: Combatant[] = [];
      for (const p of game.players) if (p.alive) bodies.push(p);
      for (const e of game.enemies) if (e.alive) bodies.push(e);
      for (const b of bodies) {
        const lp = lane(b.position.x, b.position.z);
        if (Math.abs(lp.s - v.s) > VENT_HALF + 0.5 || Math.abs(lp.lat) > HALF + 0.5) continue;
        if (b.position.y > Y0 + VENT_TALL) continue;
        const last = v.hurt.get(b) ?? -9;
        if (t - last < 0.6) continue;
        v.hurt.set(b, t);
        const from = at(v.s, lp.lat, Y0);
        b.damage(22, from, -1);
        // thrown clear of the sheet, back the way they came
        const dir = Math.sign(lp.s - v.s) || -1;
        const tg = tangent(lp.s);
        b.velocity.x += tg.x * dir * 7;
        b.velocity.z += tg.z * dir * 7;
        b.velocity.y = Math.max(b.velocity.y, 3);
      }
    }

    // the gun hatch: rises, opens its eye and fires, sinks, again — until it is shut
    if (hatch.active && hatch.alive) {
      hatch.t += dt;
      const k = hatch.t % 7.5;
      const up = k < 5;
      hatch.lift += (up ? 1 : -1) * dt / 0.6;
      hatch.lift = Math.min(1, Math.max(0, hatch.lift));
      hatchOpen(hatch.lift > 0.8);
      if (hatch.open) {
        // track the nearest hunter and fire at them
        let near: THREE.Vector3 | null = null;
        let nd = 40;
        for (const p of game.players) {
          if (!p.alive) continue;
          const d = p.position.distanceTo(hatchP);
          if (d < nd) { nd = d; near = p.position; }
        }
        if (near) {
          turret.rotation.y = Math.atan2(near.x - hatchP.x, near.z - hatchP.z);
          hatch.fireT -= dt;
          if (hatch.fireT <= 0) {
            hatch.fireT = 0.55;
            const from = new THREE.Vector3(hatchP.x, Y0 + 1.25, hatchP.z);
            const dir = near.clone().setY(near.y + 1.1).sub(from).normalize();
            from.addScaledVector(dir, 1.4);
            game.projectiles.fire(from, dir, 30, 9, 1);
          }
        }
      }
    } else if (!hatch.alive) {
      hatch.lift = Math.max(0, hatch.lift - dt / 1.2);
      hatchOpen(false);
    }
    turret.position.y = Y0 - 1.8 + hatch.lift * 1.8;

    // the sensor booms: clock hands at knee height; caught, the drones come
    for (const bm of booms) {
      bm.angle = bm.across + Math.sin((t + bm.phase) * (Math.PI * 2 / BOOM_PERIOD)) * 1.3;
      bm.arm.rotation.y = bm.angle;
      bm.cool = Math.max(0, bm.cool - dt);
      if (bm.cool > 0) continue;
      for (const p of game.players) {
        if (!p.alive || !beamHits(bm, p.position)) continue;
        bm.cool = 7;
        spotted[p.slot] = 3;
        ctx.announce(T.spotted, T.spottedSub);
        const alive = game.enemies.filter((e) => e.alive && e.kind === 'drone').length;
        const n = Math.min(1 + Math.ceil(party / 2), Math.max(0, 6 - alive));
        for (let i = 0; i < n; i++) {
          // up over the edge of the hull, out of the void
          const side = i % 2 ? -1 : 1;
          ctx.spawn('drone', at(bm.s + 6 + i * 3, side * (HALF + 5), Y0 - 4), { exact: true, alert: true });
          drones++;
        }
        break;
      }
    }
    for (let i = 0; i < spotted.length; i++) spotted[i] = Math.max(0, spotted[i] - dt);
  };

  const objective = () => {
    if (doorT > 0) return { pos: at(1.5, 0, Y0 + 1), label: T.doorLabel, hint: T.cycling, beacon: false };
    if (lockIdx >= 0) {
      const l = LOCKS[lockIdx];
      const n = lockBodies.filter((e) => e.alive).length;
      if (lockIdx === 1 && hatch.active && hatch.alive) {
        return { pos: new THREE.Vector3(hatchP.x, Y0 + 1, hatchP.z), label: T.hatchLabel, hint: T.hatchHint, beacon: false };
      }
      return { pos: at((l.from + l.to) / 2, 0, Y0 + 1), label: T.lockLabel, hint: n ? T.locked(n) : T.lockHint, beacon: false };
    }
    if (lockDone === LOCKS.length) return { pos: at(S_END + 3, 0, Y0 + 1), label: T.airlock, hint: T.airlockHint, beacon: false };
    const next = GATES.find((g) => g > ws(rail.front) - 2) ?? S_END;
    const lead = leader();
    const hint = lead > 76 && lead < 132 ? T.vents : lead > 232 ? T.sweep : T.walk;
    const k = GATES.indexOf(next);
    return { pos: at(next, 0, Y0 + 1), label: k > 0 ? T.gate(k) : T.airlock, hint, beacon: false };
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    if (spotted[slot] > 0) return { line: T.spotted };
    if (lockIdx === 1 && hatch.open && hatch.alive) return { line: T.hatchLine };
    return null;
  };

  // ---- the autopilot: walk the rail, shoot the nearest, jump the gaps, wait on the vents ----
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const lp = lane(p.position.x, p.position.z);
    const out: AutopilotInput = {};
    const lats = [-3.2, 3.2, -4.6, 4.6];
    let wantS = Math.min(ws(rail.front) - 3, S_END + 5);
    let wantLat = lats[slot % 4];
    if (lockIdx >= 0) {
      const l = LOCKS[lockIdx];
      wantS = l.from + (l.to - l.from) * (0.4 + 0.1 * slot);
    }
    if (lockDone === LOCKS.length) { wantS = S_END + 5; wantLat = 0; }
    if (doorT > 0) wantS = Math.min(wantS, -2);
    // the hatch: the nearest goes and clubs it; everyone shoots its eye
    let aimAt: THREE.Vector3 | null = null;
    if (lockIdx === 1 && hatch.active && hatch.alive) {
      aimAt = new THREE.Vector3(hatchP.x, Y0 + 1.2, hatchP.z);
      if (slot === 0 || party === 1) { wantS = HATCH.s - 1.8; wantLat = HATCH.lat; }
      if (hatch.open && p.position.distanceTo(hatchP) < 3.2) {
        meleeT[slot] -= 1 / 30;
        if (meleeT[slot] <= 0) { meleeT[slot] = 0.45; out.meleePressed = true; }
      }
    }
    // a pod in the lane: go round it on the outside (the conduit is on the inside)
    for (const [ps, pl] of pods) {
      if (ps - lp.s > -1.5 && ps - lp.s < 5 && Math.abs(wantLat - pl) < POD_R + 0.9 && Math.sign(wantLat) === Math.sign(pl)) {
        wantLat = pl + Math.sign(pl) * 2.1;
      }
    }
    // vents: never step onto a grate that is about to fire; standing on one, get off it
    for (const v of vents) {
      const ahead = v.s - lp.s;
      const { st, toFire } = ventState(v, t);
      if (ahead > -VENT_HALF - 0.6 && ahead < VENT_HALF + 0.6) { wantS = Math.max(wantS, v.s + 3); break; }
      if (ahead > 0 && ahead < 4.5 && (st !== 'idle' || toFire < 1.8)) { wantS = Math.min(wantS, v.s - 3); }
    }
    const target = at(wantS, wantLat);
    const dx = target.x - p.position.x, dz = target.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    const b = yawBasis(p.moveYaw ?? p.cam.yaw);
    if (dist > 0.8) {
      // the stick is a gait (a light push walks at 1.4 m/s): run until the last couple of metres
      const k = dist > 2 ? 1 : 0.5;
      out.moveY = ((dx * b.fwdX + dz * b.fwdZ) / dist) * k;
      out.moveX = ((dx * b.rightX + dz * b.rightZ) / dist) * k;
    }
    // the gaps: jump at the lip, and carry the jump across
    jumpT[slot] = Math.max(0, jumpT[slot] - 1 / 30);
    const gapAhead = GAPS.some(([a, bEnd]) => a - lp.s > 0 && a - lp.s < 2.6 && wantS > bEnd);
    const overGap = inGap(lp.s);
    if (gapAhead && p.grounded) { out.jumpPressed = true; out.jumpHeld = true; jumpT[slot] = 0.35; }
    else if (jumpT[slot] > 0 || (overGap && p.position.y < Y0 + 1.5)) out.jumpHeld = true;
    // the conduit: hop it when the lane asks to cross it
    if (conduitAt(lp.s) && Math.abs(lp.lat) < 2 && Math.sign(lp.lat) !== Math.sign(wantLat) && p.grounded) {
      out.jumpPressed = true; out.jumpHeld = true;
    }
    // aim: the hatch, else the nearest hostile in range, twin-stick in the rail's own basis
    if (!aimAt) {
      let nd = 34;
      for (const e of game.hostilesFor(p)) {
        if (!e.alive) continue;
        const d = e.position.distanceTo(p.position);
        if (d < nd) { nd = d; aimAt = e.position; }
      }
    }
    if (aimAt) {
      const ax = aimAt.x - p.position.x, az = aimAt.z - p.position.z;
      const n = Math.hypot(ax, az) || 1;
      out.aimStickX = (ax * b.rightX + az * b.rightZ) / n;
      out.aimStickY = (ax * b.fwdX + az * b.fwdZ) / n;
      out.shootHeld = true;
    }
    return out;
  };

  const inst: SectionInstance = {
    starts: [0, 1, 2, 3].map((i) => at(-7 + Math.floor(i / 2) * 2.2, (i % 2 ? 1 : -1) * 2)),
    floorY: Y0,
    ceilingY: Y0 + 60,
    groundAt: (x, z) => {
      const y = floorAt(x, z);
      return y === VOID ? Y0 - 30 : y;
    },
    contains: (x, z) => {
      const { s, lat } = lane(x, z);
      if (s < CAGE - 0.5 || s > S_END + THROAT) return false;
      if (s > S_END) return Math.abs(lat) < 2.6;
      return Math.abs(lat) <= HALF + 1.2 || onApron(s, lat);
    },
    path: lanePts.filter((_, i) => i % 10 === 0).concat([at(S_END + 4)]).filter((p) => lane(p.x, p.z).s >= CAGE + 3),
    update,
    get complete() { return complete; },
    objective,
    respawnSpot: (slot) => ctx.placeAt(rail.respawnSpot(slot), 'pyke'),
    // the void: over the edge, or down through a missing plate
    offPath: (pos) => {
      if (pos.y < Y0 - 3.5) return true;
      const { s, lat } = lane(pos.x, pos.z);
      return s > CAGE && s < S_END && Math.abs(lat) > HALF + 1.4 && !onApron(s, lat);
    },
    hud,
    autopilot,
    dispose: () => {
      rail.dispose();
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({
      focus: +ws(rail.focus).toFixed(1), rear: +ws(rail.rear).toFixed(1), front: +ws(rail.front).toFixed(1),
      gate: rail.gateIdx, lock: lockIdx, locksDone: lockDone, wave, hatch: hatch.alive, blend: rail.blend,
      drones, releasing,
    }),
  };
  // for tools/test-section-railcam.mjs: the rail itself, and where its metres start
  return Object.assign(inst, { rail, railOffset: L0 });
}

export const ringWalk: SectionDef = {
  id: 'ring-walk',
  build,
  // open space: no fog, the station's own 0.45 g, a cold fill from the hub's light
  world: { gravity: 0.45, fill: 1.1 },
};
