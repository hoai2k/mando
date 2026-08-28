import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { makeRng } from '../core/math';
import { crateTexture, deckTexture, hullTexture, loadOptionalTexture } from '../core/assets';
import { spaceSky } from './sky';
import type { Board } from './board';

/**
 * Board 2 — "The Spice Run" waystation: a constellation of floating platforms
 * and gantries around a central refinery spire. The jetpack is the only road.
 */

interface Plat { x: number; y: number; z: number; w: number; d: number; }

export function buildWaystation(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = null;
  physics.killY = -55;
  const rng = makeRng(66);

  const proceduralSky = spaceSky();
  group.add(proceduralSky);

  // lighting: cold key + warm sodium fill + dim ambient
  const key = new THREE.DirectionalLight(0xbdd4ff, 1.7);
  key.position.set(-70, 90, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -90;
  key.shadow.camera.right = key.shadow.camera.top = 90;
  key.shadow.camera.far = 300;
  key.shadow.bias = -0.0008;
  group.add(key);
  const sodium = new THREE.DirectionalLight(0xffb45e, 1.15);
  sodium.position.set(60, 30, -50);
  group.add(sodium);
  group.add(new THREE.HemisphereLight(0x4a5270, 0x1c1e28, 1.5));
  const padLight = new THREE.PointLight(0xffc98a, 60, 45);
  padLight.position.set(0, 9, -4);
  group.add(padLight);

  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.7, metalness: 0.45 });
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTexture(), roughness: 0.6, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.4 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.8 });

  const platforms: Plat[] = [
    { x: 0, y: 0, z: 0, w: 30, d: 30 },        // main pad
    { x: 42, y: 6, z: 8, w: 16, d: 14 },
    { x: -38, y: 4, z: -16, w: 18, d: 12 },
    { x: 22, y: 12, z: -38, w: 14, d: 14 },
    { x: -18, y: 14, z: 42, w: 16, d: 12 },
    { x: 52, y: 20, z: -18, w: 12, d: 10 },
    { x: -52, y: 18, z: 20, w: 12, d: 12 },
    { x: 0, y: 26, z: -58, w: 14, d: 10 },
    { x: 8, y: 24, z: 60, w: 12, d: 10 },
    { x: -60, y: 30, z: -40, w: 10, d: 10 },
    { x: 62, y: 34, z: 30, w: 10, d: 10 },
    { x: 0, y: 40, z: 8, w: 12, d: 12 },       // crow's nest above spire base
  ];

  for (const p of platforms) {
    const deck = new THREE.Mesh(new THREE.BoxGeometry(p.w, 1.2, p.d), deckMat);
    deck.position.set(p.x, p.y - 0.6, p.z);
    deck.castShadow = deck.receiveShadow = true;
    group.add(deck);
    // underside greeble + rim lights
    const under = new THREE.Mesh(new THREE.BoxGeometry(p.w * 0.6, 2.2, p.d * 0.6), darkMat);
    under.position.set(p.x, p.y - 2.2, p.z);
    group.add(under);
    physics.addBox(p.x, p.y - 0.6, p.z, p.w, 1.2, p.d);
    // guard posts on corners of bigger platforms
    if (p.w >= 14) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 5), darkMat);
        post.position.set(p.x + sx * (p.w / 2 - 0.4), p.y + 0.6, p.z + sz * (p.d / 2 - 0.4));
        group.add(post);
      }
    }
  }

  // central refinery spire
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7.5, 60, 12), hullMat);
  spire.position.set(0, 8, 8);
  spire.castShadow = spire.receiveShadow = true;
  group.add(spire);
  physics.addBox(0, 8, 8, 12, 60, 12);
  // glowing windows band
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffc76a });
  for (let i = 0; i < 14; i++) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), winMat);
    const a = rng() * Math.PI * 2, wy = -6 + rng() * 40;
    const r = 5.6 + (7.5 - 5.5) * (0.5 - wy / 120);
    w.position.set(Math.cos(a) * r, 8 + wy, 8 + Math.sin(a) * r);
    w.lookAt(w.position.x * 2, w.position.y, 8 + (w.position.z - 8) * 2);
    group.add(w);
  }
  // antenna crown
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 12, 6), darkMat);
  antenna.position.set(0, 44, 8);
  group.add(antenna);

  // cargo cranes reaching over platforms
  for (const [cx, cy, cz, rot] of [[26, 10, -20, 0.7], [-30, 12, 20, -1.9], [40, 26, 10, 2.4]] as const) {
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.4, 18, 1.4), darkMat);
    mast.position.y = 9;
    crane.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(20, 1.1, 1.1), darkMat);
    arm.position.set(7, 17, 0);
    crane.add(arm);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 4), darkMat);
    cable.position.set(14, 13.5, 0);
    crane.add(cable);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), crateMat);
    hook.position.set(14, 9.5, 0);
    crane.add(hook);
    crane.position.set(cx, cy - 10, cz);
    crane.rotation.y = rot;
    crane.traverse((o) => { o.castShadow = true; });
    group.add(crane);
  }

  // spice container stacks on the main pad (cover)
  const cratePositions: [number, number, number][] = [
    [-8, 0, -6], [-8, 0, -3.4], [-6.5, 2.6, -5], [6, 0, 7], [8.7, 0, 7], [7.3, 2.6, 7],
    [10, 0, -8], [-4, 0, 10], [44, 6, 5], [-40, 4, -14], [22, 12, -34],
  ];
  for (const [cx, cy, cz] of cratePositions) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 2.6), crateMat);
    crate.position.set(cx, cy + 1.3, cz);
    crate.rotation.y = rng() * 0.6;
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    physics.addBox(cx, cy + 1.3, cz, 2.6, 2.6, 2.6);
  }

  // fuel barrels clustered around the pads (cover + set dressing)
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6e, roughness: 0.7, metalness: 0.4 });
  loadOptionalTexture('barrel', (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    barrelMat.map = tex;
    barrelMat.color.setHex(0xffffff);
    barrelMat.needsUpdate = true;
  });
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.5, 14);
  for (const [bx, by, bz] of [
    [12.5, 0, 3], [13.6, 0, 4.2], [12.2, 0, 5.1],
    [-11, 0, -9], [-12.2, 0, -10.2],
    [45, 6, 10], [-36, 4, -19], [24, 12, -33],
  ] as const) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, by + 0.75, bz);
    barrel.rotation.y = rng() * Math.PI;
    barrel.castShadow = barrel.receiveShadow = true;
    group.add(barrel);
    physics.addBox(bx, by + 0.75, bz, 1.1, 1.5, 1.1);
  }

  // parked freighter on a landing pad
  const ship = new THREE.Group();
  const shipBody = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 8), hullMat);
  shipBody.rotation.z = Math.PI / 2;
  shipBody.position.y = 2.2;
  ship.add(shipBody);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), darkMat);
  cockpit.position.set(4.6, 2.4, 0);
  ship.add(cockpit);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.35, 3.2), hullMat);
    wing.position.set(-1, 1.6, s * 3);
    ship.add(wing);
  }
  ship.position.set(-38, 4, -16);
  ship.traverse((o) => { o.castShadow = true; });
  group.add(ship);
  physics.addBox(-38, 6, -16, 8, 4, 6);

  // neon cantina sign + hazard beacons (animated)
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x33ddc9, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  loadOptionalTexture('neon_sign', (tex) => {
    neonMat.map = tex;
    neonMat.color.setHex(0xffffff); // let the artwork supply the colour
    neonMat.needsUpdate = true;
  }, { exts: ['png'] }); // stays PNG: the glyphs sit on transparency
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4), neonMat);
  neon.position.set(-4.4, 6, 8.2);
  neon.rotation.y = Math.PI;
  group.add(neon);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff4433 });
  const beacons: THREE.Mesh[] = [];
  for (const p of platforms) {
    if (p.w > 13) continue;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), beaconMat.clone());
    b.position.set(p.x + p.w / 2 - 0.5, p.y + 0.5, p.z + p.d / 2 - 0.5);
    group.add(b);
    beacons.push(b);
  }

  const plat = (i: number, dy = 0.4) => new THREE.Vector3(platforms[i].x, platforms[i].y + dy, platforms[i].z);

  return {
    group, physics, kind: 'station',
    background: new THREE.Color(0x05050e),
    skyFile: 'sky_space',
    // drifting between platforms should never feel like a death sentence
    gravity: 0.45,
    heroLight: 0.34,
    voidY: -3,
    voidGravity: 0.12,
    voidFallSpeed: 3.2,
    // the nebula is bright enough to silhouette the platforms against it
    skyIntensity: 0.62,
    proceduralSky,
    fog: null,
    playerStarts: [new THREE.Vector3(0, 0.5, -6), new THREE.Vector3(3, 0.5, -6)],
    groundSpawns: [plat(1), plat(2), plat(3), plat(4), plat(5), plat(6), plat(7), plat(8), plat(0).add(new THREE.Vector3(10, 0, -10))],
    airSpawns: [
      new THREE.Vector3(20, 26, 20), new THREE.Vector3(-30, 30, 10), new THREE.Vector3(10, 36, -30),
      plat(9, 6), plat(10, 6), plat(11, 8),
    ],
    update: (dt, time) => {
      const blink = (Math.sin(time * 4) + 1) / 2;
      for (const b of beacons) (b.material as THREE.MeshBasicMaterial).color.setRGB(0.4 + blink * 0.6, 0.12, 0.1);
      (neon.material as THREE.MeshBasicMaterial).opacity = 0.72 + Math.sin(time * 11) * 0.08 + (Math.sin(time * 1.7) > 0.92 ? -0.4 : 0);
    },
  };
}
