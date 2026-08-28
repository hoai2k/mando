import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { makeRng } from '../core/math';
import { crateTexture, deckTexture, hullTexture } from '../core/assets';
import { gradientSky } from './sky';
import { Mover, type Board } from './board';
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

  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0x8a9096, roughness: 0.75, metalness: 0.35 });
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x6a7a72, roughness: 0.6, metalness: 0.45 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.4 });

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
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.4, 6), darkMat);
      pile.position.set(px, 0, pz);
      group.add(pile);
    }
  }

  // crates and barrels: cover on the quay and fingers
  for (const [cx, cz] of [
    [-8, 26], [-5.4, 26], [-6.6, 28.4], [10, 21], [22, 27], [-24, 24],
    [-26, 8], [-26, -20], [1.5, -30], [-1.8, -44], [28, 10], [26, -16],
    [-6, -50], [40, -36],
  ] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.3, 2.3), crateMat);
    crate.position.set(cx, DECK_TOP + 1.15, cz);
    crate.rotation.y = rng() * 0.8;
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    physics.addBox(cx, DECK_TOP + 1.15, cz, 2.3, 2.3, 2.3);
  }

  // harbour-master's shed on the quay
  const shed = new THREE.Mesh(new THREE.BoxGeometry(10, 4.5, 7), hullMat);
  shed.position.set(24, DECK_TOP + 2.25, 24);
  shed.castShadow = shed.receiveShadow = true;
  group.add(shed);
  physics.addBox(24, DECK_TOP + 2.25, 24, 10, 4.5, 7);

  // ---- the trawlers: decks that heave and drift on the swell ----
  const movers: Mover[] = [];
  interface BoatSpec { home: THREE.Vector3; phase: number; node: THREE.Group; mover: Mover; }
  const boats: BoatSpec[] = [];
  for (const [bx, bz, phase] of [[-12, -34, 0], [16, -46, 2.4]] as const) {
    const boat = new THREE.Group();
    // hull + deckhouse + boom crane
    const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 16), hullMat);
    hull.position.y = -0.2;
    boat.add(hull);
    const bow = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 2.4, 3, 1), hullMat);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.z = Math.PI / 2;
    bow.position.set(0, -0.2, 9.2);
    boat.add(bow);
    const house = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.6, 4), deckMat);
    house.position.set(0, 2.2, -4.5);
    boat.add(house);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 6, 6), darkMat);
    mast.position.set(0, 4, 1);
    boat.add(mast);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 7), darkMat);
    boom.position.set(0, 6, 2.5);
    boom.rotation.x = 0.5;
    boat.add(boom);
    boat.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    boat.position.set(bx, 1.0, bz);
    group.add(boat);
    // One walkable box over the working deck; the deckhouse is dressing.
    // Its centre matches the boat group's origin so Mover.moveTo keeps the
    // visual hull and the collision box in lockstep.
    const box = physics.addBox(bx, 1.0, bz, 7, 2.0, 16);
    const mover = new Mover(box, boat);
    movers.push(mover);
    boats.push({ home: new THREE.Vector3(bx, 1.0, bz), phase, node: boat, mover });
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
    objective: 'Trask · survive 10 waves',
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
    for (let i = 0; i < seaPos.count; i++) {
      const x = seaPos.getX(i), z = seaPos.getZ(i);
      seaPos.setY(i, Math.sin(x * 0.08 + time * 1.1) * 0.22 + Math.cos(z * 0.06 + time * 0.8) * 0.18);
    }
    seaPos.needsUpdate = true;
    seaGeo.computeVertexNormals();

    for (const b of boats) {
      const heave = Math.sin(time * 0.9 + b.phase) * 0.45;
      const surge = Math.sin(time * 0.32 + b.phase * 2) * 2.2;
      b.mover.moveTo(b.home.x + surge * 0.4, b.home.y + heave, b.home.z + surge);
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
            p.damage(55, h.pos);
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
