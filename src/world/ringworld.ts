import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { clamp, makeRng } from '../core/math';
import { deckTexture, hullTexture, texture } from '../core/assets';
import { gradientSky } from './sky';
import { Mover, type Board } from './board';

/**
 * Board 8 — Glavis Ringworld: a city street strip on a ring station, under a
 * terminator that sweeps slowly along it. Enemy sight ranges halve on the
 * night side — the board is a strategic clock, and both sides migrate with
 * it. A monorail tram runs the length of the street on a loop: an armored
 * ride through hostile territory that anyone can board.
 */

const STRIP_Z = 118;    // half-length of the street
const DAY_LENGTH = 210; // seconds for a full terminator swing

/** the terminator line's z position at a given time */
function terminatorZ(time: number): number {
  return Math.sin((time * Math.PI * 2) / DAY_LENGTH) * (STRIP_Z - 20);
}

/** soft-edged darkness texture for the night side's ground shadow */
const nightGradient = () => texture('ring_night_gradient', (ctx, s) => {
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, 'rgba(4,6,14,0.62)');
  g.addColorStop(0.42, 'rgba(4,6,14,0.62)');
  g.addColorStop(0.58, 'rgba(4,6,14,0)');
  g.addColorStop(1, 'rgba(4,6,14,0)');
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}, 128, 1);

export function buildRingworld(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = () => 0;
  physics.killY = -30;
  const rng = makeRng(7719);

  let timeNow = 0; // written by update, read by lightAt

  const proceduralSky = gradientSky({
    top: 0x1e2436, horizon: 0x8a6a5a, dusk: 0xc07a4a,
    sun1: { dir: new THREE.Vector3(0.1, 0.22, 0.97), color: 0xffd9a8 },
  });
  group.add(proceduralSky);

  // the sun rides the ring: low, warm, always on the horizon somewhere
  const sun = new THREE.DirectionalLight(0xffd9a8, 1.7);
  sun.position.set(20, 42, 150);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -110;
  sun.shadow.camera.right = sun.shadow.camera.top = 110;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0x3c4460, 0x1c1e26, 1.0));

  const streetMat = new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0x9a9da2, roughness: 0.8, metalness: 0.3 });
  const buildingMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x9aa0aa, roughness: 0.7, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.7, metalness: 0.4 });

  // street floor
  const street = new THREE.Mesh(new THREE.BoxGeometry(96, 1, STRIP_Z * 2 + 20), streetMat);
  street.position.y = -0.5;
  street.receiveShadow = true;
  group.add(street);

  // boundary: the strip's end bulkheads and the outer facades
  for (const [wx, wz, w, d] of [
    [0, -(STRIP_Z + 8), 100, 4], [0, STRIP_Z + 8, 100, 4],
  ] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 26, d), buildingMat);
    wall.position.set(wx, 13, wz);
    wall.receiveShadow = true;
    group.add(wall);
    physics.addBox(wx, 13, wz, w, 26, d);
  }

  // building rows: stepped blocks with walkable roofs, lining both sides
  const neonMats: THREE.MeshBasicMaterial[] = [];
  const buildings: [number, number, number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    for (const side of [-1, 1]) {
      const bz = -100 + i * 25 + (side > 0 ? 8 : 0);
      const w = 14 + rng() * 8;
      const h = 5 + rng() * 8;
      const d = 16 + rng() * 6;
      const bx = side * (34 + rng() * 6);
      buildings.push([bx, bz, w, h, d]);
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMat);
      block.position.set(bx, h / 2, bz);
      block.castShadow = block.receiveShadow = true;
      group.add(block);
      physics.addBox(bx, h / 2, bz, w, h, d);
      // rooftop clutter: a vent box to duck behind
      if (h < 11 && rng() > 0.4) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.2), darkMat);
        vent.position.set(bx + (rng() - 0.5) * (w - 4), h + 0.7, bz + (rng() - 0.5) * (d - 4));
        vent.castShadow = true;
        group.add(vent);
        physics.addBox(vent.position.x, h + 0.7, vent.position.z, 2.2, 1.4, 2.2);
      }
      // neon sign on the street face — the night side's landmarks
      const neon = new THREE.MeshBasicMaterial({
        color: [0x33ddc9, 0xd84a9a, 0xd8b02a, 0x6a8aff][(i + (side > 0 ? 1 : 0)) % 4],
        transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.4), neon);
      sign.position.set(bx - side * (w / 2 + 0.1), h * 0.6, bz);
      sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(sign);
      neonMats.push(neon);
    }
  }

  // mid-street plazas: kiosks and planters, the ground-level cover
  for (const [px, pz] of [
    [-8, -84], [10, -60], [-12, -30], [6, -6], [-6, 22], [12, 48], [-10, 74], [4, 96],
  ] as const) {
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 3.2), darkMat);
    kiosk.position.set(px, 1.2, pz);
    kiosk.rotation.y = rng() * 0.7;
    kiosk.castShadow = kiosk.receiveShadow = true;
    group.add(kiosk);
    physics.addBox(px, 1.2, pz, 3.2, 2.4, 3.2);
    const planter = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 2), buildingMat);
    planter.position.set(px + 4 + rng() * 2, 0.55, pz + (rng() - 0.5) * 4);
    planter.castShadow = planter.receiveShadow = true;
    group.add(planter);
    physics.addBox(planter.position.x, 0.55, planter.position.z, 2, 1.1, 2);
  }

  // street lamps: pooled warm light for the night side
  for (let i = 0; i < 5; i++) {
    const lz = -90 + i * 45;
    const lamp = new THREE.PointLight(0xffc98a, 40, 30);
    lamp.position.set(i % 2 ? -18 : 18, 7, lz);
    group.add(lamp);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), darkMat);
    post.position.set(lamp.position.x, 3.5, lz);
    group.add(post);
  }

  // ---- the tram: an armored ride the length of the street ----
  const tram = new THREE.Group();
  const tramBody = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 9), buildingMat);
  tramBody.position.y = 0;
  tram.add(tramBody);
  const tramNose = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.4, 3, 1), darkMat);
  tramNose.rotation.z = Math.PI / 2;
  tramNose.position.set(0, 0, 4.9);
  tram.add(tramNose);
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 0.4), new THREE.MeshBasicMaterial({ color: 0xffb060 }));
    stripe.position.set(s * 1.71, 0.4, 0);
    stripe.rotation.y = s * Math.PI / 2;
    tram.add(stripe);
  }
  tram.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  tram.position.set(24, 1.6, 0);
  group.add(tram);
  // rail bed under it, the visual lane
  const rail = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.2, STRIP_Z * 2 + 10), darkMat);
  rail.position.set(24, 0.1, 0);
  rail.receiveShadow = true;
  group.add(rail);
  const tramBox = physics.addBox(24, 1.6, 0, 3.4, 2.6, 9);
  const tramMover = new Mover(tramBox, tram);

  // ---- the terminator's ground shadow: a soft-edged darkness that moves ----
  const nightMat = new THREE.MeshBasicMaterial({
    map: nightGradient(), transparent: true, depthWrite: false,
  });
  const nightPlane = new THREE.Mesh(new THREE.PlaneGeometry(100, 480), nightMat);
  nightPlane.rotation.x = -Math.PI / 2;
  nightPlane.position.y = 0.06;
  nightPlane.renderOrder = 2;
  group.add(nightPlane);

  const board: Board = {
    group, physics, kind: 'ringworld',
    name: 'The Ringworld',
    objective: 'Glavis · survive 10 waves',
    footstep: 'stone',
    ambience: { sample: 'amb_city', bed: 'hum' },
    music: 'station',
    gravity: 0.85,
    background: new THREE.Color(0x141824),
    heroLight: 0.24,
    skyFile: 'sky_ring',
    proceduralSky,
    fog: new THREE.Fog(0x232a3a, 70, 320),
    playerStarts: [new THREE.Vector3(0, 0.5, -104), new THREE.Vector3(3, 0.5, -104)],
    groundSpawns: [
      new THREE.Vector3(-10, 0.3, 74), new THREE.Vector3(4, 0.3, 96),
      new THREE.Vector3(12, 0.3, 48), new THREE.Vector3(-6, 0.3, 22),
      new THREE.Vector3(-12, 0.3, -30), new THREE.Vector3(10, 0.3, -60),
      new THREE.Vector3(-34, 9, -50), new THREE.Vector3(36, 8, 60), // rooftops
    ],
    airSpawns: [
      new THREE.Vector3(0, 18, 40), new THREE.Vector3(-20, 16, -40), new THREE.Vector3(20, 20, 90),
    ],
    // how lit a spot is: 1 deep in the day side, 0 deep in the night
    lightAt: (x: number, z: number) => {
      void x;
      const b = terminatorZ(timeNow);
      return clamp((z - b) / 36 + 0.5, 0, 1);
    },
  };
  board.movers = [tramMover];

  board.update = (dt: number, time: number) => {
    timeNow = time;
    const b = terminatorZ(time);

    // the darkness follows the terminator: the texture's soft edge sits at
    // the plane's centre, so centring the plane on the line puts the fade
    // exactly where lightAt says it is
    nightPlane.position.z = b;

    // the sun stays over the day side, low on the ring's horizon
    sun.position.set(20, 42, b + 170);
    sun.target.position.set(0, 0, b + 10);
    sun.target.updateMatrixWorld();

    // the tram works the line, easing at the turnarounds
    const tz = Math.sin(time * 0.16) * (STRIP_Z - 14);
    tramMover.moveTo(24, 1.6, tz);

    // neon flickers now and then, the way neon does
    for (let i = 0; i < neonMats.length; i++) {
      neonMats[i].opacity = 0.8 + Math.sin(time * 7 + i * 2.3) * 0.08 + (Math.sin(time * 1.3 + i) > 0.97 ? -0.4 : 0);
    }
  };

  return board;
}
