import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { fbm2, makeRng, ridge2 } from '../core/math';
import { adobeTexture, clothTexture, rockTexture, sandTexture } from '../core/assets';
import { tatooineSky } from './sky';
import type { Board } from './board';

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

  group.add(tatooineSky());

  // lighting: warm key sun + cool fill + hemisphere bounce
  const sun = new THREE.DirectionalLight(0xffe8c0, 2.6);
  sun.position.set(60, 90, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -90;
  sun.shadow.camera.right = sun.shadow.camera.top = 90;
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
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    map: sandTexture(), vertexColors: true, roughness: 1, metalness: 0,
  }));
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
    physics.addBox(mx, base + h / 2 - 0.6, mz, r * 1.5, h, r * 1.5);
  }

  // scattered boulders (instanced)
  const boulderGeo = new THREE.DodecahedronGeometry(1, 0);
  const boulders = new THREE.InstancedMesh(boulderGeo, rockMat, 90);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2, d = 20 + rng() * 130;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const s = 0.5 + rng() * 2.2;
    m4.compose(
      new THREE.Vector3(x, heightAt(x, z) + s * 0.3, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3)),
      new THREE.Vector3(s, s * (0.7 + rng() * 0.5), s)
    );
    boulders.setMatrixAt(i, m4);
  }
  boulders.castShadow = boulders.receiveShadow = true;
  group.add(boulders);

  // moisture vaporators
  const vapMat = new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: 0.6, metalness: 0.15 });
  for (const [vx, vz] of [[-20, 55], [-32, 62], [-12, 68], [25, 40]] as const) {
    const v = new THREE.Group();
    const base = heightAt(vx, vz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 7, 6), vapMat);
    pole.position.y = 3.5;
    v.add(pole);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 1.6), vapMat);
      ring.position.y = 4.2 + i * 1.1;
      ring.rotation.y = i * 0.5;
      v.add(ring);
    }
    v.position.set(vx, base, vz);
    v.traverse((o) => { o.castShadow = true; });
    group.add(v);
    physics.addBox(vx, base + 3.5, vz, 1.2, 7, 1.2);
  }

  // homestead dome + entry hut
  const adobeMat = new THREE.MeshStandardMaterial({ map: adobeTexture(), roughness: 1 });
  const hx = -15, hz = 60, hBase = heightAt(hx, hz);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), adobeMat);
  dome.position.set(hx, hBase, hz);
  dome.castShadow = dome.receiveShadow = true;
  group.add(dome);
  physics.addBox(hx, hBase + 2, hz, 8, 4, 8);

  // Tusken camp: cluster of tents + totems
  const tentMat = new THREE.MeshStandardMaterial({ map: clothTexture(), roughness: 1, side: THREE.DoubleSide });
  const campC = new THREE.Vector3(-70, 0, -60);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tx = campC.x + Math.cos(a) * 10, tz = campC.z + Math.sin(a) * 10;
    const base = heightAt(tx, tz);
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.6, 7, 1, true), tentMat);
    tent.position.set(tx, base + 1.8, tz);
    tent.castShadow = true;
    group.add(tent);
    physics.addBox(tx, base + 1.5, tz, 3.4, 3, 3.4);
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
  physics.addBox(bx, bBase + 2.5, bz, 20, 6, 12);

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
    if (i % 4 === 0) {
      const tent = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.42, 7, 6), tentMat2);
      tent.position.set(SARLACC.x + Math.cos(a) * 5, pitBase + 2, SARLACC.z + Math.sin(a) * 5);
      group.add(tent);
      tentacles.push(tent);
    }
  }

  return {
    group, physics, kind: 'desert',
    background: new THREE.Color(0xd9b98a),
    fog: new THREE.Fog(0xdcc094, 90, 420),
    playerStarts: [new THREE.Vector3(0, heightAt(0, 4) + 0.5, 4), new THREE.Vector3(3, heightAt(3, 4) + 0.5, 4)],
    groundSpawns: [
      new THREE.Vector3(-70, 0, -60), new THREE.Vector3(-60, 0, -48), // camp
      new THREE.Vector3(48, 0, 58), new THREE.Vector3(58, 0, 70),     // barge
      new THREE.Vector3(-18, 0, 64), new THREE.Vector3(30, 0, 44),    // homestead
      new THREE.Vector3(90, 0, -10), new THREE.Vector3(-95, 0, -18),
      new THREE.Vector3(0, 0, -90), new THREE.Vector3(-40, 0, 90),
    ].map((v) => v.setY(heightAt(v.x, v.z) + 0.3)),
    airSpawns: [
      new THREE.Vector3(-40, 24, 20), new THREE.Vector3(60, 26, -30), new THREE.Vector3(0, 30, 70),
    ],
    hazard: { center: new THREE.Vector3(SARLACC.x, pitBase, SARLACC.z), radius: 8.5 },
    update: (dt, time) => {
      tentacles.forEach((t, i) => {
        t.rotation.x = Math.sin(time * 1.3 + i * 2.1) * 0.35;
        t.rotation.z = Math.cos(time * 1.7 + i * 1.3) * 0.35;
      });
    },
  };
}
