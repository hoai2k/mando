import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { fbm2, makeRng, ridge2 } from '../core/math';
import { adobeTexture, basaltTexture, lavaTexture } from '../core/assets';
import { gradientSky } from './sky';
import { addBreakable, type Board } from './board';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Board 3 — Nevarro: the lava flats outside the town gate. Black basalt cut
 * by two glowing lava rivers (damage zones, not instant death), crossed by
 * cooling crust plates that can be shot out from under whoever stands on
 * them, with geysers that erupt on a rhythm — a hazard to enemies and a free
 * jetpack boost to anyone bold enough to ride one.
 */

const SIZE = 360;
/** the lava's surface height; terrain carved below it glows */
const LAVA_Y = -1.1;

/** winding centre-line of each lava river as z = f(x) */
function riverPath(x: number, i: number): number {
  return i === 0
    ? Math.sin(x * 0.021 + 1.2) * 34 - 26
    : Math.sin(x * 0.017 - 0.7) * 42 + 52;
}

function riverDepth(x: number, z: number): number {
  let carve = 0;
  for (let i = 0; i < 2; i++) {
    const d = Math.abs(z - riverPath(x, i));
    const w = i === 0 ? 12 : 9;
    if (d < w) carve = Math.max(carve, Math.cos((d / w) * Math.PI * 0.5) * 4.2);
  }
  return carve;
}

function heightAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  let h = fbm2(x * 0.014 + 9, z * 0.014 + 3, 4) * 4.5 + ridge2(x * 0.006, z * 0.006, 3) * 2.2;
  if (d > 140) h += (d - 140) * 0.4; // bowl rim keeps play inside
  h -= riverDepth(x, z);
  return h;
}

/** molten ground: standing in a river channel, at lava level, burns */
function lavaDps(x: number, z: number, y: number): number {
  if (y > LAVA_Y + 1.4) return 0;
  return heightAt(x, z) < LAVA_Y - 0.15 ? 26 : 0;
}

interface Geyser {
  pos: THREE.Vector3;
  phase: number;       // offset into the shared cycle
  glow: THREE.Mesh;
  erupting: boolean;
}

const GEYSER_CYCLE = 8.5;
const _up = new THREE.Vector3(0, 1, 0);

export function buildNevarro(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = heightAt;
  physics.killY = -40;
  const rng = makeRng(1701);

  const proceduralSky = gradientSky({
    top: 0x5f6b7d, horizon: 0xc09a72, dusk: 0xb0603a,
    sun1: { dir: new THREE.Vector3(-0.5, 0.32, 0.4), color: 0xffd9b0 },
  });
  group.add(proceduralSky);

  // lighting: pale key over ash, warm bounce off the lava below
  const sun = new THREE.DirectionalLight(0xf4e0c8, 2.0);
  sun.position.set(-70, 80, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -90;
  sun.shadow.camera.right = sun.shadow.camera.top = 90;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  const emberBounce = new THREE.HemisphereLight(0x8a94a8, 0xb0501e, 0.85);
  group.add(emberBounce);

  // terrain, tinted darker toward the channels where the heat has baked it
  const seg = 130;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  // the basalt map is itself near-black, so these multipliers stay bright or
  // the ground renders as a void — learned from the first boot screenshot
  const rockC = new THREE.Color(0xb8b2ac), ashC = new THREE.Color(0x8a8480), scorchC = new THREE.Color(0x4a3c32);
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const h = heightAt(x, z);
    posAttr.setY(i, h);
    c.copy(rockC).lerp(ashC, Math.min(Math.max(h / 8, 0), 1));
    const carve = riverDepth(x, z);
    if (carve > 0.5) c.lerp(scorchC, Math.min(carve / 3, 1));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    map: basaltTexture(), vertexColors: true, roughness: 1, metalness: 0,
  }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // the lava itself: one glowing sheet under everything; only the carved
  // channels dip below it, so that is exactly where it shows
  const lavaMat = new THREE.MeshStandardMaterial({
    map: lavaTexture(), emissiveMap: lavaTexture(), emissive: 0xff7a28, emissiveIntensity: 1.5,
    roughness: 1, metalness: 0,
  });
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE, 1, 1), lavaMat);
  lava.rotation.x = -Math.PI / 2;
  lava.position.y = LAVA_Y;
  group.add(lava);
  const lavaGlow = new THREE.PointLight(0xff6a20, 120, 60);
  lavaGlow.position.set(0, 2, riverPath(0, 0));
  group.add(lavaGlow);

  // volcanic stone shares the ground's basalt map — the warm rock map from
  // Tatooine kept rendering these as chocolate, whatever it was tinted
  const rockMat = new THREE.MeshStandardMaterial({ map: basaltTexture(), color: 0xd8d5d0, roughness: 0.95, flatShading: true });

  // basalt columns — this board's mesas, hexagonal and sheer
  for (const [mx, mz, r, h] of [[-60, -40, 9, 10], [50, -70, 8, 13], [85, 30, 10, 9], [-40, 85, 8, 12], [-95, 20, 11, 8]] as const) {
    const base = heightAt(mx, mz);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 6, 1), rockMat);
    col.position.set(mx, base + h / 2 - 0.4, mz);
    col.castShadow = col.receiveShadow = true;
    group.add(col);
    physics.addCylinder(mx, base + h / 2 - 0.4, mz, r * 0.96, h);
  }

  // scattered basalt blocks: the board's cover boxes
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, d = 18 + rng() * 110;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (riverDepth(x, z) > 0.4) continue; // not in the lava
    const w = 1.6 + rng() * 1.6, hgt = 1.3 + rng() * 1.2;
    const y = heightAt(x, z);
    const block = new THREE.Mesh(blockGeo, rockMat);
    block.scale.set(w, hgt, w * (0.8 + rng() * 0.5));
    block.position.set(x, y + hgt / 2 - 0.1, z);
    block.rotation.y = rng() * Math.PI;
    block.castShadow = block.receiveShadow = true;
    group.add(block);
    physics.addBox(x, y + hgt / 2 - 0.1, z, w, hgt, w * 0.9);
  }

  // town gate: adobe wall segment with an arch and two watchtowers, the
  // defendable anchor at the board's north edge
  const adobeMat = new THREE.MeshStandardMaterial({ map: adobeTexture(), color: 0x9a8a78, roughness: 1 });
  const gateZ = -108;
  const gateBase = heightAt(0, gateZ);
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 4), adobeMat);
    wall.position.set(sx * 18, gateBase + 3.5, gateZ);
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
    physics.addBox(sx * 18, gateBase + 3.5, gateZ, 26, 7, 4);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 11, 8), adobeMat);
    tower.position.set(sx * 32, gateBase + 5.5, gateZ);
    tower.castShadow = tower.receiveShadow = true;
    group.add(tower);
    physics.addCylinder(sx * 32, gateBase + 5.5, gateZ, 3.6, 11);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(12, 2.4, 4), adobeMat);
  lintel.position.set(0, gateBase + 7.6, gateZ);
  lintel.castShadow = true;
  group.add(lintel);
  physics.addBox(0, gateBase + 7.6, gateZ, 12, 2.4, 4);

  const board: Board = {
    group, physics, kind: 'nevarro',
    name: 'The Lava Flats',
    objective: 'Nevarro · survive 10 waves',
    footstep: 'stone',
    ambience: { sample: 'amb_lava', bed: 'wind' },
    music: 'desert',
    background: new THREE.Color(0x8a8078),
    heroLight: 0.12,
    skyFile: 'sky_nevarro',
    proceduralSky,
    fog: new THREE.Fog(0x9a8878, 80, 400),
    playerStarts: [new THREE.Vector3(0, heightAt(0, -96) + 0.5, -96), new THREE.Vector3(3, heightAt(3, -96) + 0.5, -96)],
    groundSpawns: [
      new THREE.Vector3(-60, 0, -44), new THREE.Vector3(52, 0, -66),
      new THREE.Vector3(88, 0, 26), new THREE.Vector3(-42, 0, 80),
      new THREE.Vector3(-98, 0, 18), new THREE.Vector3(4, 0, 96),
      new THREE.Vector3(96, 0, -18), new THREE.Vector3(-80, 0, -80),
    ].map((v) => v.setY(heightAt(v.x, v.z) + 0.3)),
    airSpawns: [
      new THREE.Vector3(-30, 26, 0), new THREE.Vector3(50, 24, 40), new THREE.Vector3(0, 30, -60),
    ],
    burnAt: lavaDps,
  };

  // crust plates: cooling skin bridging the rivers — real shortcuts, until
  // somebody shoots one out from under you
  const crustMat = new THREE.MeshStandardMaterial({ map: basaltTexture(), color: 0x8a7a70, roughness: 1, flatShading: true });
  for (const [px, ri, tilt] of [[-40, 0, 0.04], [30, 0, -0.05], [70, 1, 0.06], [-15, 1, -0.03]] as const) {
    const pz = riverPath(px, ri);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.7, 26), crustMat);
    plate.position.set(px, LAVA_Y + 1.15, pz);
    plate.rotation.z = tilt;
    plate.castShadow = plate.receiveShadow = true;
    group.add(plate);
    const box = physics.addBox(px, LAVA_Y + 1.15, pz, 7.5, 0.7, 26);
    addBreakable(board, plate, box, 130, { radius: 4.2 });
  }

  // geysers: posted along the channels, telegraphed glow → eruption. The
  // blast launches whoever is above it — lethal pressure for the AI, a free
  // 20 m of altitude for a player who times the ride.
  const geysers: Geyser[] = [];
  const glowGeo = new THREE.CylinderGeometry(1.9, 2.3, 0.5, 10);
  for (const [gx, gz, phase] of [
    [-40, riverPath(-40, 0) + 13, 0], [18, riverPath(18, 0) - 13, 2.9],
    [64, riverPath(64, 1) + 11, 5.4], [-8, riverPath(-8, 1) - 11, 7.1],
    [96, riverPath(96, 0) + 12, 4.2],
  ] as const) {
    const y = heightAt(gx, gz);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.0, 1.1, 9), rockMat);
    rim.position.set(gx, y + 0.3, gz);
    rim.castShadow = rim.receiveShadow = true;
    group.add(rim);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xff7a28, transparent: true, opacity: 0.0 }));
    glow.position.set(gx, y + 0.75, gz);
    group.add(glow);
    geysers.push({ pos: new THREE.Vector3(gx, y + 0.8, gz), phase, glow, erupting: false });
  }

  board.update = (dt: number, time: number, game?: Game) => {
    // lava breathes
    lavaMat.emissiveIntensity = 1.35 + Math.sin(time * 1.7) * 0.25;
    lavaGlow.intensity = 110 + Math.sin(time * 2.3) * 25;

    for (const g of geysers) {
      const t = (time + g.phase) % GEYSER_CYCLE;
      const mat = g.glow.material as THREE.MeshBasicMaterial;
      if (t < 1.4) {
        // telegraph: the vent brightens before it lets go
        mat.opacity = (t / 1.4) * 0.75;
        g.erupting = false;
      } else if (t < 2.2) {
        mat.opacity = 0.9;
        if (game) {
          game.particles.jetPlume(g.pos, _up, dt, { power: 1, scale: 3.2 });
          if (!g.erupting) {
            g.erupting = true;
            audio.geyser(0.5);
            game.director.noise(game, g.pos, 30);
            // launch whoever is over the vent
            for (const p of game.players) {
              if (p.alive && p.position.distanceTo(g.pos) < 2.6) {
                p.velocity.y = Math.max(p.velocity.y, 17);
              }
            }
            for (const e of game.enemies) {
              if (!e.alive || e.position.distanceTo(g.pos) > 2.6) continue;
              e.damage(12, g.pos, -1);
              e.knockback(g.pos, 8, 0.5, 1.4); // mostly straight up
            }
          }
        }
      } else {
        mat.opacity = Math.max(0, mat.opacity - dt * 2);
        g.erupting = false;
      }
    }
  };

  return board;
}
