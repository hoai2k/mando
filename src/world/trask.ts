import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { makeRng } from '../core/math';
import { crateTexture, deckTexture, hullTexture, loadOptionalTexture } from '../core/assets';
import { gradientSky } from './sky';
import { Mover, type Board } from './board';
import { authoredProp } from './props';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Board 5 — Trask: a storm-lashed fishing port. A grid of dock fingers over
 * a cold harbour, with two trawlers heaving on the swell — moving decks that
 * carry whoever rides them. The water is a countdown, not a wall: cold bites
 * fast, and the mamacore pool between the piers bites faster. Rain squalls
 * and lightning flatten visibility in beats — storms are when you reposition.
 */

const SEA_BED = -1.5;
const DECK_TOP = 1.7;
const WATER_Y = 0;
const MAMACORE = new THREE.Vector3(14, 0, -6);

/** seconds of cumulative water time before the mamacore comes looking */
const HUNT_AFTER = 5;
/** seconds from the first ripple to the strike — the window to get out */
const HUNT_TELEGRAPH = 2.4;

export function buildTrask(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = () => SEA_BED;
  physics.killY = -40;
  const rng = makeRng(2287);

  const proceduralSky = gradientSky({
    top: 0x3a4450, horizon: 0x67707a, dusk: 0x505a64,
  });
  group.add(proceduralSky);

  // storm light: cold, dim, flat — plus the lightning rig
  const sun = new THREE.DirectionalLight(0x9fb0c0, 1.5);
  sun.position.set(-50, 70, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
  sun.shadow.camera.right = sun.shadow.camera.top = 80;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0x6a7a8c, 0x2c3a46, 1.35));
  const lightning = new THREE.DirectionalLight(0xcfe0ff, 0);
  lightning.position.set(30, 80, 20);
  group.add(lightning);
  // sodium worklights on the quay
  const lamp = new THREE.PointLight(0xffc98a, 50, 35);
  lamp.position.set(0, 7, 18);
  group.add(lamp);

  // the sea: a big dark plane that heaves in update
  const seaGeo = new THREE.PlaneGeometry(340, 340, 40, 40);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1c333e, roughness: 0.35, metalness: 0.15 });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.position.y = 0.05;
  group.add(sea);
  const seaPos = seaGeo.attributes.position as THREE.BufferAttribute;
  const seaNorm = seaGeo.attributes.normal as THREE.BufferAttribute;

  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0x8a9096, roughness: 0.75, metalness: 0.35 });
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x6a7a72, roughness: 0.6, metalness: 0.45 });
  // Rusted plating over both the trawler hulls and the decks players stand on:
  // the harbour reads as working boats rather than clean grey boxes.
  loadOptionalTexture('rust_hull', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    for (const m of [hullMat, deckMat]) {
      m.map = tex;
      m.color.setHex(0xffffff);
      m.needsUpdate = true;
    }
  });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.4 });
  // repeated props share one geometry apiece: fifty pilings and fourteen crates
  // were fifty and fourteen separate buffer sets
  const pileGeo = new THREE.CylinderGeometry(0.22, 0.26, 3.4, 6);
  const trCrateGeo = new THREE.BoxGeometry(2.3, 2.3, 2.3);

  // dock plan: a main quay and fingers reaching into the harbour
  const docks: [number, number, number, number][] = [
    // x, z, w, d
    [0, 24, 70, 16],       // main quay
    [-26, -6, 10, 48],     // west finger
    [0, -16, 8, 66],       // centre finger
    [28, -2, 10, 40],      // east finger
    [-6, -52, 34, 10],     // cross pier at the far end
    [40, -36, 14, 12],     // isolated pad (jet or boat to reach)
    [-44, -32, 12, 12],
  ];
  for (const [dx, dz, w, d] of docks) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), deckMat);
    deck.position.set(dx, DECK_TOP - 0.4, dz);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    physics.addBox(dx, DECK_TOP - 0.4, dz, w, 0.8, d);
    // pilings
    for (let i = 0; i < Math.max(2, ((w + d) / 14) | 0) * 2; i++) {
      const px = dx + (rng() - 0.5) * (w - 1);
      const pz = dz + (rng() - 0.5) * (d - 1);
      const pile = new THREE.Mesh(pileGeo, darkMat);
      pile.position.set(px, 0, pz);
      group.add(pile);
    }
  }

  // Cargo nets hung along the quay edges: dressing, never collision — they are
  // flagged decor so the audit does not read them as geometry missing a box,
  // and they only appear where the artwork does, since a net is its cutout.
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide,
    transparent: true, alphaTest: 0.4, visible: false,
  });
  loadOptionalTexture('net_weave', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    netMat.map = tex;
    netMat.alphaMap = tex;
    netMat.visible = true;
    netMat.needsUpdate = true;
  }, { exts: ['png'] });
  const netGeo = new THREE.PlaneGeometry(3.2, 2.2);
  for (const [nx, nz, turn] of [
    [-18, 32.2, 0], [6, 32.2, 0], [26, 32.2, 0],
    [-31.2, -12, Math.PI / 2], [-4.2, -34, Math.PI / 2], [33.2, -10, Math.PI / 2],
  ] as const) {
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(nx, DECK_TOP - 1.3, nz);
    net.rotation.y = turn;
    net.userData.decor = true;
    group.add(net);
  }

  // crates and barrels: cover on the quay and fingers
  for (const [cx, cz] of [
    [-8, 26], [-5.4, 26], [-6.6, 28.4], [10, 21], [22, 27], [-24, 24],
    [-26, 8], [-26, -20], [1.5, -30], [-1.8, -44], [28, 10], [26, -16],
    [-6, -50], [40, -36],
  ] as const) {
    const crate = new THREE.Mesh(trCrateGeo, crateMat);
    crate.position.set(cx, DECK_TOP + 1.15, cz);
    crate.rotation.y = rng() * 0.8;
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    // The crate is set down at an angle, and an axis-aligned box around a
    // turned cube misses its corners entirely — a third of the sculpt with
    // nothing under it. The fit follows the crate as it lies.
    const box = physics.addBox(cx, DECK_TOP + 1.15, cz, 2.3, 2.3, 2.3);
    authoredProp(group, crate, 'cargo_crate', 2.3, { x: cx, y: DECK_TOP, z: cz, yaw: crate.rotation.y },
      { physics, replace: [box], maxBoxes: 4 });
  }

  // harbour-master's shed on the quay
  // 7.1 m to the ridge, which is what the sculpt measures at its 10 m length;
  // the stand-in and the box follow it rather than the other way round.
  const shed = new THREE.Mesh(new THREE.BoxGeometry(10, 7.1, 6.8), hullMat);
  shed.position.set(24, DECK_TOP + 3.55, 24);
  shed.castShadow = shed.receiveShadow = true;
  group.add(shed);
  physics.addBox(24, DECK_TOP + 3.55, 24, 10, 7.1, 6.8);
  // 10 m along the quay — the sculpt's long axis is X, which is the way the
  // shed's box already runs, so it needs no turn
  authoredProp(group, shed, 'dock_shed', 10, { x: 24, y: DECK_TOP, z: 24, axis: 'x' });

  // ---- fish-drying racks (PLAN.md §16) ----
  // Quay dressing that is also the only new solid on the board: chest-high, so
  // it enters the cover system honestly rather than being scenery you shoot
  // through.
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x6a5c4a, roughness: 0.95 });
  for (const [fx, fz, fyaw] of [[-18, 20, 0.2], [14, 28, -0.3], [-30, -14, 1.4]] as const) {
    const rack = new THREE.Group();
    const bits: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), rackMat);
      leg.position.set(sx * 0.9, 1, 0);
      bits.push(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.1), rackMat);
    bar.position.y = 1.95;
    bits.push(bar);
    for (let i = 0; i < 4; i++) {
      const fish = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.06), rackMat);
      fish.position.set(-0.6 + i * 0.4, 1.6, 0);
      bits.push(fish);
    }
    for (const b of bits) { b.castShadow = true; rack.add(b); }
    rack.position.set(fx, DECK_TOP, fz);
    rack.rotation.y = fyaw;
    group.add(rack);
    const rackBox = physics.addBox(fx, DECK_TOP + 1.05, fz, 2.4, 2.1, 1.6);
    authoredProp(rack, bits, 'fish_rack', 2.2, { axis: 'x' },
      { physics, replace: [rackBox], cell: 0.4, maxBoxes: 8 });
  }

  // ---- quay dressing: buoys on the swell, rope coils on the deck (PLAN.md §16.6) ----
  // The buoys ride the exact swell function the sea computes, so they always
  // sit on the surface rather than in or above it; all decor, no colliders.
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xb03a2a, roughness: 0.8 });
  const buoyPostMat = new THREE.MeshStandardMaterial({ color: 0x3a352c, roughness: 0.9 });
  const buoyGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const buoyPostGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5);
  const buoys: THREE.Group[] = [];
  for (const [ux, uz] of [
    [-44, 6], [-41, 9], [14, -66], [17.5, -63], [44, -22], [40, 8], [43.5, 10.5], [-18, -70],
  ] as const) {
    const buoy = new THREE.Group();
    const ball = new THREE.Mesh(buoyGeo, buoyMat);
    ball.scale.y = 0.8;
    buoy.add(ball);
    const post = new THREE.Mesh(buoyPostGeo, buoyPostMat);
    post.position.y = 0.6;
    buoy.add(post);
    buoy.position.set(ux, WATER_Y, uz);
    buoy.userData.decor = true;
    group.add(buoy);
    buoys.push(buoy);
  }
  // rope coils: flattened tori by the bollards and rack corners — set dressing
  const coilMat = new THREE.MeshStandardMaterial({ color: 0x5c4a30, roughness: 1 });
  const coilGeo = new THREE.TorusGeometry(0.42, 0.13, 6, 12);
  for (const [cx, cz] of [[-10, 30.5], [4, 31], [24, 29.5], [-27.5, -20], [1.5, -44], [29.5, -14]] as const) {
    const coil = new THREE.Mesh(coilGeo, coilMat);
    coil.rotation.x = -Math.PI / 2;
    coil.position.set(cx, DECK_TOP + 0.08, cz);
    coil.scale.y = 0.5;
    coil.castShadow = true;
    coil.userData.decor = true;
    group.add(coil);
  }

  // ---- the trawlers: decks that heave and drift on the swell ----
  const movers: Mover[] = [];
  interface BoatSpec {
    home: THREE.Vector3; phase: number; node: THREE.Group; mover: Mover;
    /** the deckhouse box, carried along with the deck */
    house: Mover;
    /** the mast, likewise — thin, but you can stand right against it */
    mast: Mover;
  }
  const boats: BoatSpec[] = [];
  for (const [bx, bz, phase] of [[-12, -34, 0], [16, -46, 2.4]] as const) {
    const boat = new THREE.Group();
    // hull + deckhouse + boom crane
    const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 16), hullMat);
    hull.position.y = -0.2;
    boat.add(hull);
    // A wedge lying flat across the beam. Rotating on X *and* Z turned the
    // prism on its side: its axis ended up along -X, so a 7 m cross-section
    // stood up 2.3 m above the deck as a fin you walk through, while 4.7 m of
    // it reached past the collision box entirely. Rotating on X alone lays the
    // triangle in the deck plane where a bow belongs.
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 2.4, 3, 1), hullMat);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, -0.2, 7.4);
    boat.add(bow);
    // The deckhouse is a third of the boat's usable area and stands chest-high
    // on ground you fight over, so it blocks like it looks. It rides the same
    // Mover as the deck, which keeps the box under the mesh as the swell lifts
    // them both.
    const house = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 4), deckMat);
    house.position.set(0, 2.2, -4.5);
    boat.add(house);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 6, 6), darkMat);
    mast.position.set(0, 4, 1);
    boat.add(mast);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 7), darkMat);
    boom.position.set(0, 6, 2.5);
    boom.rotation.x = 0.5;
    // rigging thinner than a forearm is not worth a collider — you would
    // catch on it far more often than you would ever mean to touch it
    boom.userData.decor = true;
    boat.add(boom);
    boat.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    boat.position.set(bx, 1.0, bz);
    group.add(boat);
    // The trawler hangs off the boat node, so it heaves on the swell with the
    // deck box under it. Grounded at the box's underside (local -1.0) and
    // measured along the hull, which puts its working deck where the collider
    // top already is — the surface people fight on does not move.
    // One walkable box over the working deck; the deckhouse is dressing.
    // Its centre matches the boat group's origin so Mover.moveTo keeps the
    // visual hull and the collision box in lockstep.
    const box = physics.addBox(bx, 1.0, bz, 7, 2.0, 16);
    const mover = new Mover(box, boat);
    movers.push(mover);
    // the deckhouse gets its own box, offset from the boat's origin the way the
    // mesh is; it is not a rider, so it is moved directly rather than carried
    const houseBox = physics.addBox(bx, 1.0 + 2.2, bz - 4.5, 4.5, 2.6, 4);
    const houseMover = new Mover(houseBox, null);
    // the mast stands 6 m off a deck people fight on, so it blocks too
    const mastBox = physics.addBox(bx, 1.0 + 4, bz + 1, 0.45, 6, 0.45);
    const mastMover = new Mover(mastBox, null);
    // The trawler hangs off the boat node, so it heaves on the swell with the
    // deck box under it. Grounded at the box's underside (local -1.0) and
    // measured along the hull, which puts its working deck where the collider
    // top already is — the surface people fight on does not move.
    //
    // The deck box stays: it is the flat everyone fights on, and it is what
    // decides who rides the swell. What the fit adds is the rest of the boat —
    // the flare of the hull, the deckhouse, the mast — carried by the same
    // mover, so the superstructure is solid wherever the sculpt actually put it
    // rather than where two hand-placed boxes guessed.
    authoredProp(boat, [hull, bow, house, mast], 'trawler', 16, { y: -1.0, axis: 'z' },
      {
        physics,
        replace: [houseBox, mastBox],
        cell: 0.7,
        maxBoxes: 18,
        onFit: (fitted) => mover.carry(fitted),
      });
    boats.push({
      home: new THREE.Vector3(bx, 1.0, bz), phase, node: boat, mover,
      house: houseMover, mast: mastMover,
    });
  }

  // ---- the mamacore pool: churning water between the piers ----
  const maw = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 20),
    new THREE.MeshStandardMaterial({ color: 0x0c1d26, roughness: 0.3 }),
  );
  maw.rotation.x = -Math.PI / 2;
  maw.position.set(MAMACORE.x, 0.12, MAMACORE.z);
  group.add(maw);
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x35424a, roughness: 0.8 });
  const tentacles: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.3, 3.2, 6), tentMat);
    t.position.set(MAMACORE.x + Math.cos(a) * 2.6, 0.6, MAMACORE.z + Math.sin(a) * 2.6);
    // they writhe, and they stand inside a kill zone nobody survives long
    // enough to lean on — solid ones would be handholds over the mouth
    t.userData.decor = true;
    group.add(t);
    tentacles.push(t);
  }

  // ---- rain ----
  const dropCount = 900;
  const dropPos = new Float32Array(dropCount * 3);
  for (let i = 0; i < dropCount; i++) {
    dropPos[i * 3] = (rng() - 0.5) * 160;
    dropPos[i * 3 + 1] = rng() * 30;
    dropPos[i * 3 + 2] = (rng() - 0.5) * 160;
  }
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  dropGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const rain = new THREE.Points(dropGeo, new THREE.PointsMaterial({
    color: 0x9fb8c8, size: 0.08, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  rain.frustumCulled = false;
  group.add(rain);

  const board: Board = {
    group, physics, kind: 'trask',
    name: 'The Storm Docks',
    objective: 'Trask · survive 7 waves',
    footstep: 'metal',
    ambience: { sample: 'amb_rain', bed: 'wind' },
    music: 'station',
    // dock fingers are islands: shooters hold their pier instead of wading
    rangedLeash: true,
    background: new THREE.Color(0x46505a),
    heroLight: 0.22,
    skyFile: 'sky_trask',
    proceduralSky,
    fog: new THREE.Fog(0x46505a, 45, 240),
    playerStarts: [new THREE.Vector3(0, DECK_TOP + 0.3, 26), new THREE.Vector3(3, DECK_TOP + 0.3, 26)],
    groundSpawns: [
      new THREE.Vector3(-26, DECK_TOP + 0.3, -18), new THREE.Vector3(0, DECK_TOP + 0.3, -40),
      new THREE.Vector3(28, DECK_TOP + 0.3, -14), new THREE.Vector3(-6, DECK_TOP + 0.3, -52),
      new THREE.Vector3(40, DECK_TOP + 0.3, -36), new THREE.Vector3(-44, DECK_TOP + 0.3, -32),
      new THREE.Vector3(24, DECK_TOP + 0.3, 20), new THREE.Vector3(-26, DECK_TOP + 0.3, 6),
    ],
    airSpawns: [
      new THREE.Vector3(-15, 14, -20), new THREE.Vector3(25, 12, -40), new THREE.Vector3(0, 16, 10),
    ],
    hazards: [{ center: MAMACORE.clone(), radius: 4.5, kind: 'kill', yMax: 1.0 }],
    // chest-deep everywhere: the harbour is wadeable, and the danger is the
    // thing hunting in it, not the water itself
    waterY: WATER_Y,
    movers,
    // a cargo skiff moored in the channel between the fingers — it rides the
    // water, and skims over the mamacore's bite depth
    vehicles: [{ kind: 'skiff', x: -14, z: 8, yaw: 0 }],
  };

  // ---- the mamacore hunts by the clock ----
  // Spend too long in the water and a ripple wake starts converging on you:
  // ~2.4 s from the first ring to the strike, which is exactly enough time to
  // wade for a ladder or jet clear. It grabs whoever is still in the water.
  interface Hunt { active: boolean; t: number; pos: THREE.Vector3; ring: THREE.Mesh; }
  const ringGeo = new THREE.TorusGeometry(0.9, 0.1, 6, 22);
  const hunts: Hunt[] = [0, 1].map(() => {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0x9fd8d0, transparent: true, opacity: 0.7, depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    group.add(ring);
    return { active: false, t: 0, pos: new THREE.Vector3(), ring };
  });

  let boltIn = 6 + rng() * 8;      // seconds to the next lightning strike
  let boltFlash = 0;
  let thunderIn = -1;
  board.update = (dt: number, time: number, game?: Game) => {
    // swell: the sea surface rolls, the boats ride it
    // The swell is two sinusoids, so its normal is the analytic slope rather
    // than a topology pass: computeVertexNormals() walked 3,200 triangles and
    // renormalised 1,681 vertices every frame for a surface whose derivative
    // is two more cosines. Same water, a fraction of the work.
    for (let i = 0; i < seaPos.count; i++) {
      const x = seaPos.getX(i), z = seaPos.getZ(i);
      const ax = x * 0.08 + time * 1.1;
      const az = z * 0.06 + time * 0.8;
      seaPos.setY(i, Math.sin(ax) * 0.22 + Math.cos(az) * 0.18);
      // dy/dx and dy/dz; the surface normal is (-dy/dx, 1, -dy/dz) normalised
      const dx = -Math.cos(ax) * 0.22 * 0.08;
      const dz = Math.sin(az) * 0.18 * 0.06;
      const inv = 1 / Math.hypot(dx, 1, dz);
      seaNorm.setXYZ(i, dx * inv, inv, dz * inv);
    }
    seaPos.needsUpdate = true;
    seaNorm.needsUpdate = true;

    // buoys bob on the same two sinusoids the surface just computed
    for (const buoy of buoys) {
      const ax = buoy.position.x * 0.08 + time * 1.1;
      const az = buoy.position.z * 0.06 + time * 0.8;
      buoy.position.y = WATER_Y + Math.sin(ax) * 0.22 + Math.cos(az) * 0.18;
      buoy.rotation.x = Math.sin(az) * 0.12;
      buoy.rotation.z = Math.cos(ax) * 0.12;
    }

    for (const b of boats) {
      const heave = Math.sin(time * 0.9 + b.phase) * 0.45;
      const surge = Math.sin(time * 0.32 + b.phase * 2) * 2.2;
      const cx = b.home.x + surge * 0.4, cy = b.home.y + heave, cz = b.home.z + surge;
      b.mover.moveTo(cx, cy, cz);
      b.house.moveTo(cx, cy + 2.2, cz - 4.5);
      b.mast.moveTo(cx, cy + 4, cz + 1);
      b.node.rotation.z = Math.sin(time * 0.8 + b.phase) * 0.05;
      b.node.rotation.x = Math.cos(time * 0.66 + b.phase) * 0.035;
    }

    // the hunt: ripples converge on whoever has been in the water too long
    if (game) {
      for (let i = 0; i < hunts.length && i < game.players.length; i++) {
        const h = hunts[i];
        const p = game.players[i];
        const inWater = p.alive && p.position.y + 0.9 < WATER_Y;
        if (!h.active) {
          h.ring.visible = false;
          if (inWater && p.waterTime > HUNT_AFTER) {
            h.active = true;
            h.t = HUNT_TELEGRAPH;
            const a = Math.random() * Math.PI * 2;
            h.pos.set(p.position.x + Math.cos(a) * 15, WATER_Y + 0.08, p.position.z + Math.sin(a) * 15);
            audio.mamacoreRoar(0.3); // something big turned toward you
          }
          continue;
        }
        h.t -= dt;
        // the wake homes on the swimmer — it arrives when the timer does
        const tx = p.position.x - h.pos.x, tz = p.position.z - h.pos.z;
        const d2 = Math.hypot(tx, tz);
        if (d2 > 0.05) {
          const speed = Math.max(6, d2 / Math.max(h.t, 0.15));
          const step = Math.min(speed * dt, d2);
          h.pos.x += (tx / d2) * step;
          h.pos.z += (tz / d2) * step;
        }
        h.ring.visible = true;
        h.ring.position.copy(h.pos);
        const s = 1 + Math.sin(time * 9) * 0.18;
        h.ring.scale.set(s, s, 1);
        if (Math.random() < dt * 16) game.particles.splash(h.pos, 2);
        if (h.t <= 0) {
          h.active = false;
          h.ring.visible = false;
          game.particles.splash(h.pos.clone(), 32);
          audio.mamacoreRoar(0.85);
          const pd = Math.hypot(p.position.x - h.pos.x, p.position.z - h.pos.z);
          if (inWater && pd < 3.4) {
            // grabbed, mauled, and spat toward the surface — twice is fatal
            p.damage(55, h.pos, -1, { heavy: true });
            p.velocity.y = 14;
            p.velocity.x += (p.position.x - h.pos.x) * 2.2;
            p.velocity.z += (p.position.z - h.pos.z) * 2.2;
          }
          p.waterTime = HUNT_AFTER - 3; // it circles back fast — get out
        }
      }
    }

    // the mamacore churns
    for (let i = 0; i < tentacles.length; i++) {
      const t = tentacles[i];
      t.position.y = 0.2 + Math.abs(Math.sin(time * 1.4 + i * 1.9)) * 1.1;
      t.rotation.x = Math.sin(time * 1.8 + i) * 0.4;
      t.rotation.z = Math.cos(time * 1.3 + i * 2.2) * 0.4;
    }

    // rain falls hard and at a slant
    const p = dropGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < dropCount; i++) {
      let y = p.getY(i) - dt * 26;
      if (y < 0) { y = 28; }
      p.setY(i, y);
      p.setX(i, p.getX(i) + dt * 4);
      if (p.getX(i) > 80) p.setX(i, -80);
    }
    p.needsUpdate = true;

    // lightning: a flash, then thunder arrives late, like it should
    boltIn -= dt;
    if (boltIn <= 0) {
      boltIn = 7 + Math.random() * 12;
      boltFlash = 0.35;
      thunderIn = 0.6 + Math.random() * 1.4;
      lightning.position.set((Math.random() - 0.5) * 120, 80, (Math.random() - 0.5) * 120);
    }
    if (boltFlash > 0) {
      boltFlash -= dt;
      lightning.intensity = Math.max(0, boltFlash) * (14 + Math.random() * 10);
    } else lightning.intensity = 0;
    if (thunderIn > 0) {
      thunderIn -= dt;
      if (thunderIn <= 0) audio.thunder(0.5 + Math.random() * 0.3);
    }
  };

  return board;
}
