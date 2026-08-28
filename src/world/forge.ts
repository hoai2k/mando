import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { fbm2, makeRng } from '../core/math';
import { rockTexture } from '../core/assets';
import { gradientSky } from './sky';
import type { Board } from './board';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Board 7 — Mandalore: the Great Forge. A glassed plain — fused green-grey
 * desert left by the Purge — around the shattered civic dome, with hanging
 * ruin-chunks to jet between under the broken roof. On a slow clock a
 * magnetic storm arcs across the whole board: everything in the open, AI
 * included, takes strikes until it finds a roof — the calm is for fighting,
 * the storm is for repositioning. Beneath the far pool, something colossal
 * occasionally answers.
 */

const SIZE = 340;
const POOL = new THREE.Vector3(66, 0, 44);

function heightAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  let h = fbm2(x * 0.016 + 21, z * 0.016 + 8, 4) * 3.4;
  h += fbm2(x * 0.05, z * 0.05, 2) * 0.5;
  // the dome floor is swept level
  if (d < 36) h *= d / 36;
  // the Living Waters sink into their basin
  const pd = Math.hypot(x - POOL.x, z - POOL.z);
  if (pd < 14) h -= Math.cos((pd / 14) * Math.PI * 0.5) * 2.6;
  if (d > 140) h += (d - 140) * 0.38;
  return h;
}

/** storm cadence: a long calm, a short warning, then the arcs */
const CALM_T = 46, WARN_T = 6, STORM_T = 13;
const CYCLE = CALM_T + WARN_T + STORM_T;

const _up = new THREE.Vector3(0, 1, 0);
const _probe = new THREE.Vector3();

export function buildForge(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = heightAt;
  physics.killY = -40;
  const rng = makeRng(5510);

  const proceduralSky = gradientSky({
    top: 0x5a6a66, horizon: 0xa8b2a4, dusk: 0x7a8878,
    sun1: { dir: new THREE.Vector3(0.2, 0.34, -0.5), color: 0xe8f0da },
  });
  group.add(proceduralSky);

  const sun = new THREE.DirectionalLight(0xdfe8d0, 1.9);
  sun.position.set(30, 70, -70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -90;
  sun.shadow.camera.right = sun.shadow.camera.top = 90;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  const hemi = new THREE.HemisphereLight(0x9aa89c, 0x4a4c42, 0.8);
  group.add(hemi);
  // the storm's own light: a cold arc-lamp that lives only while it does
  const stormLight = new THREE.DirectionalLight(0xbfd8ff, 0);
  stormLight.position.set(-20, 90, 30);
  group.add(stormLight);

  // terrain: fused glass-sand, green-grey, darker in the melt channels
  const seg = 120;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  // the sand map underneath is warm; these pull it to fused grey-green glass
  const glassC = new THREE.Color(0x6f8078), duneC = new THREE.Color(0x55625a), meltC = new THREE.Color(0x3a4a44);
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const h = heightAt(x, z);
    posAttr.setY(i, h);
    const n = fbm2(x * 0.03 + 5, z * 0.03, 3);
    c.copy(glassC).lerp(duneC, Math.min(Math.max(h / 6, 0), 1));
    if (n > 0.62) c.lerp(meltC, (n - 0.62) * 2);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  // no sand map here: fused glass is *smooth*, and the bare vertex-colour
  // surface with a low roughness is what sells ground that melted once
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.45, metalness: 0.08,
  }));
  terrain.receiveShadow = true;
  group.add(terrain);

  const ruinMat = new THREE.MeshStandardMaterial({ map: rockTexture(), color: 0x9aa0a2, roughness: 0.85, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a4044, roughness: 0.7, metalness: 0.3 });

  // ---- the dome: an arc of standing wall segments + surviving roof slabs ----
  // The roof pieces are the point: overhead cover is what the storm makes
  // valuable, and the dome has just enough of it left.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    if (i === 2 || i === 3 || i === 7) continue; // collapsed gaps — the ways in
    const wx = Math.cos(a) * 34, wz = Math.sin(a) * 34;
    const h = 12 + ((i * 37) % 9);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(22, h, 3), ruinMat);
    const base = heightAt(wx, wz);
    wall.position.set(wx, base + h / 2 - 1.5, wz);
    wall.rotation.y = -a + Math.PI / 2;
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
    // AABB approximation of the rotated segment: use a cylinder-ish footprint
    physics.addCylinder(wx, base + h / 2 - 1.5, wz, 8.5, h);
  }
  // roof slabs at two heights over parts of the dome interior
  for (const [sx, sz, w, d, sy] of [
    [-10, -12, 26, 20, 20], [14, 8, 22, 18, 23], [-4, 18, 16, 14, 21],
  ] as const) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), ruinMat);
    slab.position.set(sx, sy, sz);
    slab.rotation.z = (rng() - 0.5) * 0.12;
    slab.castShadow = slab.receiveShadow = true;
    group.add(slab);
    physics.addBox(sx, sy, sz, w, 1.6, d);
  }
  // the Forge dais at the centre, brazier still warm
  const daisBase = heightAt(0, 0);
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 2.2, 14), ruinMat);
  dais.position.set(0, daisBase + 1.1, 0);
  dais.castShadow = dais.receiveShadow = true;
  group.add(dais);
  physics.addCylinder(0, daisBase + 1.1, 0, 9.6, 2.2);
  const brazier = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 1.6, 10), darkMat);
  brazier.position.set(0, daisBase + 3, 0);
  group.add(brazier);
  physics.addCylinder(0, daisBase + 3, 0, 1.6, 1.6);
  const ember = new THREE.PointLight(0xff8a3a, 35, 26);
  ember.position.set(0, daisBase + 4, 0);
  group.add(ember);

  // hanging ruin-chunks: floating platforms to jet between under the roofline
  for (const [hx, hy, hz, s] of [
    [-22, 7, 6, 5], [18, 10, -14, 6], [6, 14, 16, 5], [-12, 17, -18, 4.5],
    [28, 6, 20, 5], [-30, 11, -26, 5.5], [44, 9, -6, 5],
  ] as const) {
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(s, 1.8, s * 0.85), ruinMat);
    chunk.position.set(hx, hy, hz);
    chunk.rotation.y = rng() * Math.PI;
    chunk.castShadow = chunk.receiveShadow = true;
    group.add(chunk);
    physics.addBox(hx, hy, hz, s, 1.8, s * 0.85);
  }

  // outlying rubble: cover across the open glass
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2, dd = 45 + rng() * 85;
    const x = Math.cos(a) * dd, z = Math.sin(a) * dd;
    if (Math.hypot(x - POOL.x, z - POOL.z) < 18) continue;
    const w = 1.6 + rng() * 2.4, h = 1.2 + rng() * 2;
    const y = heightAt(x, z);
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.8), ruinMat);
    block.position.set(x, y + h / 2 - 0.15, z);
    block.rotation.y = rng() * Math.PI;
    block.castShadow = block.receiveShadow = true;
    group.add(block);
    physics.addBox(x, y + h / 2 - 0.15, z, w, h, w * 0.8);
  }

  // ---- the Living Waters ----
  const poolBase = heightAt(POOL.x, POOL.z);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0e2228, roughness: 0.15, metalness: 0.1 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(11, 24), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(POOL.x, poolBase + 1.1, POOL.z);
  group.add(water);
  // the eye: a dim glow that surfaces for a few seconds when the rumble comes
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x4ad0c0, transparent: true, opacity: 0 }),
  );
  eye.position.set(POOL.x - 3, poolBase + 0.8, POOL.z + 2);
  group.add(eye);

  const board: Board = {
    group, physics, kind: 'forge',
    name: 'The Great Forge',
    objective: 'Mandalore · survive 10 waves',
    footstep: 'stone',
    ambience: { sample: 'amb_forge', bed: 'wind' },
    music: 'desert',
    background: new THREE.Color(0x99a496),
    heroLight: 0.14,
    skyFile: 'sky_mandalore',
    proceduralSky,
    fog: new THREE.Fog(0x99a496, 75, 380),
    playerStarts: [new THREE.Vector3(0, heightAt(0, -100) + 0.5, -100), new THREE.Vector3(3, heightAt(3, -100) + 0.5, -100)],
    groundSpawns: [
      new THREE.Vector3(-70, 0, -50), new THREE.Vector3(60, 0, -66),
      new THREE.Vector3(90, 0, 10), new THREE.Vector3(-52, 0, 74),
      new THREE.Vector3(-96, 0, 14), new THREE.Vector3(10, 0, 92),
      new THREE.Vector3(0, 0, 10), new THREE.Vector3(-16, 0, -8),      // inside the dome
    ].map((v) => v.setY(heightAt(v.x, v.z) + 0.3)),
    airSpawns: [
      new THREE.Vector3(-30, 24, 20), new THREE.Vector3(40, 26, -30), new THREE.Vector3(0, 30, 60),
    ],
  };

  let mythosaurIn = 35 + rng() * 30;
  let eyeGlow = 0;
  let strikeTick = 0;
  let stormWasOn = false;
  board.update = (dt: number, time: number, game?: Game) => {
    const t = time % CYCLE;
    const warning = t >= CALM_T && t < CALM_T + WARN_T;
    const storm = t >= CALM_T + WARN_T;

    // the sky presses down as the storm builds, and crackles while it runs
    const dim = warning ? 1 - ((t - CALM_T) / WARN_T) * 0.55 : storm ? 0.45 : 1;
    sun.intensity = 1.9 * dim;
    hemi.intensity = 0.8 * (0.6 + 0.4 * dim);
    stormLight.intensity = storm ? (Math.sin(time * 17) * 0.5 + 0.5) * 1.6 : 0;

    if (storm && !stormWasOn) audio.thunder(0.6); // the front arrives
    stormWasOn = storm;

    if (storm && game) {
      strikeTick -= dt;
      if (strikeTick <= 0) {
        strikeTick = 0.7;
        // arcs find whoever stands under open sky — a roof is the answer.
        // The AI reads the same rule: suppression plants it where it hides.
        const sheltered = (pos: THREE.Vector3): boolean => {
          _probe.copy(pos);
          _probe.y += 1.5;
          return !!physics.raycast(_probe, _up, 45);
        };
        for (const p of game.players) {
          if (!p.alive || sheltered(p.position)) continue;
          if (Math.random() < 0.65) {
            p.damage(5, p.position.clone().add(new THREE.Vector3(0, 8, 0)));
            game.particles.impactSparks(p.position.clone().setY(p.position.y + 1.6), 14);
          }
        }
        for (const e of game.enemies) {
          if (!e.alive || sheltered(e.position)) continue;
          if (Math.random() < 0.5) {
            e.damage(8, e.position.clone().add(new THREE.Vector3(0, 8, 0)), -1);
            e.suppress(0.6);
            game.particles.impactSparks(e.position.clone().setY(e.position.y + 1.6), 10);
          }
        }
        if (Math.random() < 0.5) audio.thunder(0.25 + Math.random() * 0.2);
      }
    }

    // the mythosaur: pure theatre, maximum goosebumps
    mythosaurIn -= dt;
    if (mythosaurIn <= 0) {
      mythosaurIn = 50 + Math.random() * 40;
      eyeGlow = 6;
      audio.mythosaur(0.5);
    }
    if (eyeGlow > 0) {
      eyeGlow -= dt;
      (eye.material as THREE.MeshBasicMaterial).opacity = Math.min(0.7, eyeGlow) * Math.min(1, (6 - eyeGlow) * 2) * 0.6;
      eye.position.x = POOL.x - 3 + Math.sin(time * 0.4) * 1.5;
    } else {
      (eye.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    (water.material as THREE.MeshStandardMaterial).roughness = 0.15 + Math.sin(time * 0.9) * 0.05;
  };

  return board;
}
