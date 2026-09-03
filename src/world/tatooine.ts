import { TEXT } from '../text';
import * as THREE from 'three';
import { PhysicsWorld, type StaticBox, type StaticCylinder } from '../core/physics';
import { fbm2, makeRng, ridge2 } from '../core/math';
import { adobeTexture, clothTexture, loadOptionalTexture, rockTexture, sandTexture } from '../core/assets';
import { tatooineSky } from './sky';
import type { Board } from './board';
import { authoredProp } from './props';
import { audio } from '../core/audio';

/**
 * Board 1 — the Dune Sea: rolling dunes flattening into a central arena,
 * mesas to jet onto, a moisture-farm homestead, a Tusken camp, a crashed
 * sail barge for cover, and the sarlacc pit as a lethal hazard.
 */

const SIZE = 380;
const SARLACC = new THREE.Vector3(70, 0, -85);

function heightAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  // dunes grow with distance from the arena center
  const duneAmp = 2.2 + Math.min(d / 60, 1) * 9;
  let h = fbm2(x * 0.012 + 40, z * 0.012 + 17, 4) * duneAmp;
  h += fbm2(x * 0.05, z * 0.05, 2) * 0.7;
  // bowl rim keeps play inside
  if (d > 150) h += (d - 150) * 0.35;
  // sarlacc depression
  const sd = Math.hypot(x - SARLACC.x, z - SARLACC.z);
  if (sd < 26) h -= Math.cos((sd / 26) * Math.PI * 0.5) * 10;
  return h;
}

export function buildTatooine(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = heightAt;
  physics.killY = -40;
  const rng = makeRng(1138);

  const proceduralSky = tatooineSky();
  group.add(proceduralSky);

  // lighting: warm key sun + cool fill + hemisphere bounce
  const sun = new THREE.DirectionalLight(0xffe8c0, 2.6);
  sun.position.set(60, 90, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The board runs to +-95 (mesas, spawn posts), so +-90 left its far corners
  // with no shadows at all and popped them in at the boundary.
  sun.shadow.camera.left = sun.shadow.camera.bottom = -115;
  sun.shadow.camera.right = sun.shadow.camera.top = 115;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  const sun2 = new THREE.DirectionalLight(0xffb070, 0.7);
  sun2.position.set(90, 50, 60);
  group.add(sun2);
  group.add(new THREE.HemisphereLight(0xcfe0f0, 0xb08a55, 0.75));

  // terrain
  const seg = 130;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const sandC = new THREE.Color(0xd2a86a), duneC = new THREE.Color(0xb98e52), pitC = new THREE.Color(0x6e5433);
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const h = heightAt(x, z);
    posAttr.setY(i, h);
    const sd = Math.hypot(x - SARLACC.x, z - SARLACC.z);
    c.copy(sandC).lerp(duneC, Math.min(Math.max(h / 10, 0), 1));
    if (sd < 26) c.lerp(pitC, 1 - sd / 26);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({
    map: sandTexture(), vertexColors: true, roughness: 1, metalness: 0,
  });
  // authored normal map gives the dunes real ripple relief under the twin suns
  loadOptionalTexture('sand_normal', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    terrainMat.normalMap = tex;
    terrainMat.normalScale.set(0.7, 0.7);
    terrainMat.needsUpdate = true;
  }, { srgb: false, exts: ['png'] }); // stays PNG: JPEG ringing corrupts normals
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  const rockMat = new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 0.95, flatShading: true });

  // mesas — flat-top rock towers you can jet onto (physics boxes)
  const mesas: [number, number, number, number][] = [
    [-55, 30, 14, 11], [48, 52, 12, 9], [-30, -70, 16, 13], [95, -20, 10, 8], [-95, -25, 12, 15],
  ];
  for (const [mx, mz, r, h] of mesas) {
    const base = heightAt(mx, mz);
    const geo = new THREE.CylinderGeometry(r * 0.82, r, h, 9, 3);
    const gp = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < gp.count; i++) {
      const nx = gp.getX(i), ny = gp.getY(i), nz = gp.getZ(i);
      const w = 1 + (ridge2(nx * 0.2 + mx, nz * 0.2 + mz, 3) - 0.5) * 0.35;
      gp.setX(i, nx * w); gp.setZ(i, nz * w);
      if (Math.abs(ny - h / 2) > 0.01) gp.setY(i, ny + (fbm2(nx + mx, nz + mz, 2) - 0.5) * 1.4);
    }
    geo.computeVertexNormals();
    const mesa = new THREE.Mesh(geo, rockMat);
    mesa.position.set(mx, base + h / 2 - 0.6, mz);
    mesa.castShadow = mesa.receiveShadow = true;
    group.add(mesa);
    // A box only covered 0.75r of a mesa that is r wide at the base and wider
    // still where the noise pushes it out, so the sloping faces between the
    // box corners were walk-through. A cylinder is what the mesa actually is.
    physics.addCylinder(mx, base + h / 2 - 0.6, mz, r * 1.04, h);
  }

  // scattered boulders (instanced)
  const boulderGeo = new THREE.DodecahedronGeometry(1, 0);
  const boulders = new THREE.InstancedMesh(boulderGeo, rockMat, 90);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2, d = 20 + rng() * 130;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = 0.5 + rng() * 2.2;
    const y = heightAt(x, z) + s * 0.3;
    // rng() order here is load-bearing: it fixes the boulder field's layout,
    // so the euler is drawn before the vertical scale exactly as compose did
    const spin = new THREE.Euler(rng() * 3, rng() * 3, rng() * 3);
    const sy = s * (0.7 + rng() * 0.5);
    m4.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(spin), new THREE.Vector3(s, sy, s));
    boulders.setMatrixAt(i, m4);
    // Boulders had no collider at all — you walked straight through every one.
    // A dodecahedron's inradius is ~0.79 of its circumradius, so collide on the
    // inscribed cylinder: forgiving at the corners rather than blocking bare
    // air. Low ones fall under STEP_HEIGHT and become steps, not walls.
    physics.addCylinder(x, y, z, s * 0.79, sy * 2);
  }
  boulders.castShadow = boulders.receiveShadow = true;
  group.add(boulders);

  // moisture vaporators
  const vapMat = new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: 0.6, metalness: 0.15 });
  // one geometry per repeated prop rather than one per copy
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.55, 7, 6);
  const ringGeo = new THREE.BoxGeometry(1.6, 0.25, 1.6);
  for (const [vx, vz] of [[-20, 55], [-32, 62], [-12, 68], [25, 40]] as const) {
    const v = new THREE.Group();
    const base = heightAt(vx, vz);
    const pole = new THREE.Mesh(poleGeo, vapMat);
    pole.position.y = 3.5;
    v.add(pole);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(ringGeo, vapMat);
      ring.position.y = 4.2 + i * 1.1;
      ring.rotation.y = i * 0.5;
      v.add(ring);
    }
    v.position.set(vx, base, vz);
    v.traverse((o) => { o.castShadow = true; });
    group.add(v);
    const stand = physics.addBox(vx, base + 3.5, vz, 1.2, 7, 1.2);
    // 7 m to the top of the condenser stack, standing on the sand
    authoredProp(group, v, 'vaporator', 7, { x: vx, y: base, z: vz, axis: 'y' },
      { physics, replace: [stand], maxBoxes: 8 });
  }

  // homestead dome + entry hut
  const adobeMat = new THREE.MeshStandardMaterial({ map: adobeTexture(), roughness: 1 });
  const hx = -15, hz = 60, hBase = heightAt(hx, hz);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), adobeMat);
  dome.position.set(hx, hBase, hz);
  dome.castShadow = dome.receiveShadow = true;
  group.add(dome);
  // Round dome, round collider: the 8 m box cut its corners off and clipped
  // the 10 m span of the dome at the sides. Two stacked discs then follow the
  // curve instead of inscribing it — one 4.2 m disc left the skirt, where the
  // dome is widest and lowest, as something you could walk a shoulder into.
  const domeStand = [
    physics.addCylinder(hx, hBase + 0.85, hz, 4.9, 1.7),
    physics.addCylinder(hx, hBase + 2.2, hz, 3.7, 4.4),
  ];
  // 10 m across, matching the dome the two stacked discs were fitted to
  authoredProp(group, dome, 'homestead_dome', 10, { x: hx, y: hBase, z: hz, axis: 'z' },
    { physics, replace: domeStand, maxBoxes: 14 });

  // Tusken camp: cluster of tents + totems
  const tentMat = new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 1, side: THREE.DoubleSide });
  const campTentGeo = new THREE.ConeGeometry(2.6, 3.6, 7, 1, true);
  const campC = new THREE.Vector3(-70, 0, -60);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tx = campC.x + Math.cos(a) * 10, tz = campC.z + Math.sin(a) * 10;
    const base = heightAt(tx, tz);
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.6, 7, 1, true), tentMat);
    tent.position.set(tx, base + 1.8, tz);
    tent.castShadow = true;
    group.add(tent);
    // Two stacked discs follow the tent's taper: one 3.4 m box stopped well
    // inside a 5.2 m sculpt at the skirt and stood as invisible wall above its
    // peak. Same treatment as the ice spires.
    const tentStand = [
      physics.addCylinder(tx, base + 1.3, tz, 2.2, 2.6),
      physics.addCylinder(tx, base + 3.6, tz, 1.3, 2.0),
    ];
    // each tent faces the middle of the camp, the way a ring of them would be pitched
    authoredProp(group, tent, 'tusken_tent', 5.2, {
      x: tx, y: base, z: tz, axis: 'x', yaw: Math.atan2(campC.x - tx, campC.z - tz),
    }, { physics, replace: tentStand, maxBoxes: 8 });
  }

  // ---- the sandcrawler on the rim (PLAN.md §16) ----
  // A landmark out on the bowl slope, past where the fighting goes but close
  // enough to walk to — so it is solid, and it gets a row of colliders along
  // its own axis the way the barge hull does.
  const scx = -104, scz = 132, scYaw = 0.9;
  const scBase = heightAt(scx, scz);
  const crawler = new THREE.Group();
  const crawlerMat = new THREE.MeshStandardMaterial({ map: rockTexture(), color: 0x9a6a4a, roughness: 0.9, metalness: 0.25 });
  const scHull = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 30), crawlerMat);
  scHull.position.y = 8;
  crawler.add(scHull);
  const scProw = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 6), crawlerMat);
  scProw.position.set(0, 4.5, 16);
  scProw.rotation.x = 0.35;
  crawler.add(scProw);
  crawler.position.set(scx, scBase, scz);
  crawler.rotation.y = scYaw;
  crawler.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  group.add(crawler);
  // r 6.4, not 5.5: the hull is 12 m across, so a 5.5 m disc left half a metre
  // of each flank as something you walk into and through — which is exactly
  // what the audit is for. The row holds the crawler up until its sculpt
  // lands; after that the fit follows the tracks and the treads.
  const scAxis = new THREE.Vector2(Math.sin(scYaw), Math.cos(scYaw));
  const scStand = [-13, -6.5, 0, 6.5, 13].map((t) =>
    physics.addCylinder(scx + scAxis.x * t, scBase + 7, scz + scAxis.y * t, 6.4, 15));
  authoredProp(crawler, [scHull, scProw], 'sandcrawler', 35, { axis: 'z' },
    { physics, replace: scStand, cell: 0.95, maxBoxes: 26 });

  // ---- banthas at the Tusken camp (PLAN.md §16) ----
  // The camp's livestock: solid, so bolts stop on the hide, but no health and
  // no team — they are scenery that breathes, not targets. Placed clear of the
  // tents, and they sway on their own clock rather than wandering, so a moving
  // collider can never shoulder anything into the fire.
  const banthas: Array<{ node: THREE.Group; phase: number }> = [];
  let banthaLowIn = 8;
  /** the far-off krayt: rare enough to stay a surprise, on no schedule you can read */
  let kraytCallIn = 40 + Math.random() * 50;
  const banthaMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.8 });
  for (const [bnx, bnz, bnYaw] of [[-58, -70, 1.2], [-52, -62, 2.1], [-62, -78, 0.4]] as const) {
    const base = heightAt(bnx, bnz);
    const node = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 9), banthaMat);
    body.scale.set(1, 1.05, 1.9);
    body.position.y = 1.9;
    parts.push(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), banthaMat);
    head.position.set(0, 1.6, 2.7);
    parts.push(head);
    for (const sx of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.13, 6, 10, Math.PI * 1.3), hornMat);
      horn.position.set(sx * 0.55, 2.1, 2.7);
      horn.rotation.set(Math.PI / 2, 0, sx * 0.6);
      parts.push(horn);
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.5, 6), banthaMat);
        leg.position.set(sx * 0.8, 0.75, sz * 1.1);
        parts.push(leg);
      }
    }
    for (const p of parts) { p.castShadow = true; node.add(p); }
    node.position.set(bnx, base, bnz);
    node.rotation.y = bnYaw;
    group.add(node);
    // A bantha is nearly six metres nose to tail, so one disc at its middle
    // left both ends — the head most of all — as geometry with nothing under
    // it. Three along the animal's own axis, the way a long body gets extra
    // hit spheres. The animal sways on the spot, so its colliders stay put:
    // the fit is what the sculpt occupies at rest, which is where it is.
    const bnAxis = new THREE.Vector2(Math.sin(bnYaw), Math.cos(bnYaw));
    const bnStand = ([[-1.7, 1.7, 1.9, 3.4], [0.3, 1.8, 1.6, 3.8], [2.4, 1.4, 1.7, 2.8]] as const).map(
      ([t, r, cy, ch]) => physics.addCylinder(bnx + bnAxis.x * t, base + cy, bnz + bnAxis.y * t, r, ch));
    authoredProp(node, parts, 'bantha', 4.5, { axis: 'z' },
      { physics, replace: bnStand, maxBoxes: 10 });
    banthas.push({ node, phase: banthas.length * 2.1 });
  }

  // crashed sail barge — tilted hull + deck planes for cover
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 0.8, metalness: 0.3 });
  const barge = new THREE.Group();
  const bx = 45, bz = 65;
  const bBase = heightAt(bx, bz);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 10), hullMat);
  hull.rotation.z = 0.28;
  hull.rotation.y = 0.6;
  hull.position.y = 2;
  barge.add(hull);
  const sail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 14), new THREE.MeshStandardMaterial({ color: 0x8a2f24, roughness: 0.9 }));
  sail.position.set(-6, 6, 2);
  sail.rotation.z = 0.5;
  barge.add(sail);
  barge.position.set(bx, bBase, bz);
  barge.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  group.add(barge);
  // The wreck lies along the hull's own yaw, which is the axis its row of
  // colliders follows, and grounds on the sand the barge node sits on. The
  // sculpt carries its own mast, so the procedural sail goes with the hull.
  // The hull is 26 m long and yawed 0.6 rad, which one axis-aligned box cannot
  // describe: the old 20x12 AABB put invisible walls off the bow and let you
  // walk through the hull ends. A short row of cylinders along the hull's own
  // axis follows it at any rotation, and keeps the same deck height to stand on.
  const hullAxis = new THREE.Vector2(Math.cos(0.6), -Math.sin(0.6));
  const bargeStand: Array<StaticBox | StaticCylinder> = [];
  for (const t of [-9, -4.5, 0, 4.5, 9]) {
    bargeStand.push(physics.addCylinder(bx + hullAxis.x * t, bBase + 2.5, bz + hullAxis.y * t, 4.4, 6));
  }
  // The sail is a 9 m plank leaning 0.5 rad, and its own AABB is 4.7 m wide
  // for 0.4 m of canvas — a slab of invisible wall. Three boxes climbing the
  // lean stay where the sail is: solid to shoot past, nothing to snag on.
  for (const k of [-1, 0, 1]) {
    bargeStand.push(physics.addBox(
      bx - 6 - Math.sin(0.5) * k * 3, bBase + 6 + Math.cos(0.5) * k * 3, bz + 2,
      1.5, 3.4, 14,
    ));
  }
  // The wreck lies along the hull's own yaw, which is the axis its row of
  // colliders follows, and grounds on the sand the barge node sits on. The
  // sculpt carries its own mast, so the procedural sail goes with the hull —
  // and the fit takes the deck, the mast and the lean together.
  authoredProp(barge, [hull, sail], 'sail_barge', 26, { yaw: 0.6, axis: 'z' },
    { physics, replace: bargeStand, cell: 0.9, maxBoxes: 26 });

  // sarlacc: teeth ring + tentacles that sway
  const pitBase = heightAt(SARLACC.x, SARLACC.z);
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 0.7 });
  const tentMat2 = new THREE.MeshStandardMaterial({ color: 0x7a5c46, roughness: 0.9 });
  const tentacles: THREE.Mesh[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const tx = SARLACC.x + Math.cos(a) * 11, tz = SARLACC.z + Math.sin(a) * 11;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.6, 5), toothMat);
    tooth.position.set(tx, heightAt(tx, tz) + 0.8, tz);
    tooth.rotation.x = (Math.cos(a) * 0.3);
    tooth.lookAt(SARLACC.x, heightAt(SARLACC.x, SARLACC.z) + 6, SARLACC.z);
    group.add(tooth);
    // A ring of two-metre fangs stands outside the kill radius, so it is the
    // first thing anyone charging the pit meets — it has to stop them rather
    // than let them run through it into the mouth. Sunk well into the slope of
    // the crater so nobody slips beneath it on the downhill side.
    physics.addCylinder(tx, heightAt(tx, tz) + 0.3, tz, 0.75, 3.6);
    if (i % 4 === 0) {
      const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, 7, 6), tentMat2);
      tent.position.set(SARLACC.x + Math.cos(a) * 5, pitBase + 2, SARLACC.z + Math.sin(a) * 5);
      // deliberately intangible: they writhe, they stand inside a kill zone
      // nobody survives to touch them in, and a solid one would be a handhold
      // over the mouth
      tent.userData.decor = true;
      group.add(tent);
      tentacles.push(tent);
    }
  }

  return {
    group, physics, kind: 'desert',
    name: TEXT.boards.desert.name,
    footstep: 'sand',
    ambience: { sample: 'amb_desert', bed: 'wind' },
    music: 'desert',
    background: new THREE.Color(0xd9b98a),
    heroLight: 0.1,
    skyFile: 'sky_desert',
    proceduralSky,
    fog: new THREE.Fog(0xdcc094, 90, 420),
    playerStarts: [new THREE.Vector3(0, heightAt(0, 4) + 0.5, 4), new THREE.Vector3(3, heightAt(3, 4) + 0.5, 4)],
    groundSpawns: [
      new THREE.Vector3(-70, 0, -60), new THREE.Vector3(-60, 0, -48), // camp
      new THREE.Vector3(34, 0, 52), new THREE.Vector3(58, 0, 70),     // barge
      new THREE.Vector3(-30, 0, 70), new THREE.Vector3(30, 0, 44),    // homestead
      new THREE.Vector3(90, 0, -10), new THREE.Vector3(-95, 0, -1),
      new THREE.Vector3(0, 0, -90), new THREE.Vector3(-40, 0, 90),
    ].map((v) => v.setY(heightAt(v.x, v.z) + 0.3)),
    airSpawns: [
      new THREE.Vector3(-40, 24, 20), new THREE.Vector3(60, 26, -30), new THREE.Vector3(0, 30, 70),
    ],
    hazards: [{ center: new THREE.Vector3(SARLACC.x, pitBase, SARLACC.z), radius: 8.5, kind: 'kill' }],
    // rides (PLAN.md §17): the Tuskens' swoops at the camp, the farmer's
    // landspeeder by the homestead, a cargo skiff out past the barge — and
    // two of the herd broken to the saddle, standing at the corral's edge
    // where the grazers behind them are scenery and these are not. What tells
    // them apart on sight is the woven saddle; on the radar they are rides.
    vehicles: [
      { kind: 'swoop', x: -80, z: -50, yaw: 0.8 },
      { kind: 'swoop', x: -77, z: -45, yaw: 1.2 },
      { kind: 'landspeeder', x: -26, z: 52, yaw: 2.4 },
      { kind: 'skiff', x: 58, z: 48, yaw: 0.5 },
      { kind: 'bantha', x: -66, z: -58, yaw: 1.6 },
      { kind: 'bantha', x: -49, z: -71, yaw: 2.6 },
    ],
    update: (dt, time, game) => {
      // one of the herd lows every so often, louder the closer you graze
      // something enormous, out past the rim, that the player never meets
      kraytCallIn -= dt;
      if (kraytCallIn <= 0) {
        kraytCallIn = 70 + Math.random() * 90;
        audio.kraytCall(0.3 + Math.random() * 0.12);
      }

      banthaLowIn -= dt;
      if (banthaLowIn <= 0 && game) {
        banthaLowIn = 16 + Math.random() * 22;
        const b = banthas[Math.floor(Math.random() * banthas.length)];
        if (b) {
          const near = game.players.reduce((m, p) => Math.min(m, p.position.distanceTo(b.node.position)), 999);
          audio.banthaLow(Math.max(0.04, Math.min(0.4, 30 / Math.max(near, 8))));
        }
      }
      // the herd shifts its weight and swings its heads, slowly
      for (const b of banthas) {
        b.node.rotation.z = Math.sin(time * 0.4 + b.phase) * 0.03;
        b.node.position.y = heightAt(b.node.position.x, b.node.position.z)
          + Math.sin(time * 0.7 + b.phase) * 0.04;
      }
      tentacles.forEach((t, i) => {
        t.rotation.x = Math.sin(time * 1.3 + i * 2.1) * 0.35;
        t.rotation.z = Math.cos(time * 1.7 + i * 1.3) * 0.35;
      });
    },
  };
}
