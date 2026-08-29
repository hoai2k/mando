import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { clamp, fbm2, makeRng } from '../core/math';
import { iceTexture, snowTexture } from '../core/assets';
import { gradientSky } from './sky';
import { addBreakable, type Board } from './board';
import { authoredProp } from './props';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Board 4 — Maldo Kreis: a frozen crevasse. Two snowfield rims over a deep
 * canyon floor, bridged by ice ledges — three fighting layers the jetpack
 * moves between. The floor holds a frozen lake whose plates crack out from
 * under a fight (a ground slam is the fastest way to open it), and the ice
 * itself barely grips: sprinting onto it is a commitment.
 */

const FLOOR_Y = -14;
const LAKE = new THREE.Vector3(0, 0, 44);
const LAKE_R = 21;

function heightAt(x: number, z: number): number {
  const ax = Math.abs(x);
  // canyon profile: floor, steep wall, rim
  const t = clamp((ax - 15) / 26, 0, 1);
  const wall = t * t * (3 - 2 * t); // smoothstep
  const rimH = 2.5 + fbm2(x * 0.02 + 4, z * 0.02 + 9, 3) * 3;
  const floorH = FLOOR_Y + fbm2(x * 0.05, z * 0.05, 2) * 0.9;
  let h = floorH + (rimH - floorH) * wall;
  // the lake bed sits below the plates that cover it
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  // The bed rises the full 1.6 m to meet the floor at the rim. It stopped
  // 0.8 m short, which is just past the 0.55 m step height — so going through
  // the ice left you in a bowl with no way out but thrust, while the water
  // burned. Deep and cold in the middle, wadeable at the edge.
  if (ld < LAKE_R) h = Math.min(h, FLOOR_Y - 1.6 + (ld / LAKE_R) * 1.6);
  // canyon ends climb out
  const az = Math.abs(z);
  if (az > 120) h += (az - 120) * 0.5;
  return h;
}

/** water under the broken plates: cold enough to be a countdown */
function waterDps(x: number, z: number, y: number): number {
  if (y > FLOOR_Y - 0.7) return 0;
  return Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE_R ? 16 : 0;
}

/** ice underfoot barely grips; packed snow on the rims is honest ground */
function tractionAt(x: number, z: number): number {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE_R + 1) return 0.2;
  return Math.abs(x) < 16 ? 0.5 : 0.85;
}

export function buildCrevasse(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = heightAt;
  physics.killY = -45;
  const rng = makeRng(892);

  const proceduralSky = gradientSky({
    top: 0x9fb4c6, horizon: 0xe6edf2, dusk: 0xc8d8e2,
    sun1: { dir: new THREE.Vector3(0.3, 0.5, 0.4), color: 0xf2f4f8 },
  });
  group.add(proceduralSky);

  // flat, bounced polar light: soft key, huge hemisphere fill
  const sun = new THREE.DirectionalLight(0xeef2f8, 1.6);
  sun.position.set(40, 90, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // the canyon runs to z = +-110 and both player starts sit outside a +-90 box
  sun.shadow.camera.left = sun.shadow.camera.bottom = -125;
  sun.shadow.camera.right = sun.shadow.camera.top = 125;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0xd8e6f2, 0x8898a8, 1.1));

  // terrain: snow above, glacial blue in the depths
  const SIZE = 320;
  const seg = 130;
  const terrainGeo = new THREE.PlaneGeometry(SIZE, SIZE, seg, seg);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const snowC = new THREE.Color(0xe8edf2), iceC = new THREE.Color(0x7fa8c4), deepC = new THREE.Color(0x4a7494);
  const c = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const h = heightAt(x, z);
    posAttr.setY(i, h);
    const depth = clamp((1 - (h - FLOOR_Y) / 16), 0, 1);
    c.copy(snowC).lerp(iceC, depth);
    if (h < FLOOR_Y + 0.5) c.lerp(deepC, 0.5);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({
    map: snowTexture(), vertexColors: true, roughness: 0.9, metalness: 0,
  }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // dark water under the lake plates
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE_R, 24),
    new THREE.MeshStandardMaterial({ color: 0x16303f, roughness: 0.25, metalness: 0.1 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, FLOOR_Y - 1.1, LAKE.z);
  group.add(water);

  const iceMat = new THREE.MeshStandardMaterial({ map: iceTexture(), roughness: 0.35, metalness: 0.05 });
  const iceMatFlat = new THREE.MeshStandardMaterial({ map: iceTexture(), color: 0xcfe2ec, roughness: 0.4, flatShading: true });

  // ice ledges on the canyon walls: the middle fighting layer
  const ledges: [number, number, number, number, number][] = [
    // x, y, z, w, d
    [-19, -6, -20, 10, 12], [19, -3, 10, 11, 10], [-20, -1, 55, 9, 10],
    [20, -8, -60, 12, 11], [-18, -9, 80, 10, 9], [21, -5, 70, 9, 9],
  ];
  for (const [lx, ly, lz, w, d] of ledges) {
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), iceMatFlat);
    ledge.position.set(lx, ly, lz);
    // Small enough that the flat collider still matches the corners — at 0.3
    // rad a 12 m ledge overhangs its own box by nearly half a metre, which is
    // exactly where you land coming off a jet hop.
    ledge.rotation.y = (rng() - 0.5) * 0.05;
    ledge.castShadow = ledge.receiveShadow = true;
    group.add(ledge);
    physics.addBox(lx, ly, lz, w, 1.6, d);
  }
  // Ice arches spanning the crevasse: crossings, which means they have to reach
  // the walls. At 44 m they stopped around x = +-22, where the canyon wall is
  // still ten metres below them — three slabs ending in mid-air, reachable only
  // by the jetpack that would have cleared the gap anyway. The wall climbs to
  // their height around x = +-33, so 72 m lands both ends in solid ice.
  const archGeo = new THREE.BoxGeometry(72, 1.8, 6);
  for (const [ay, az] of [[0.5, -35], [1.5, 30], [-1, 95]] as const) {
    const arch = new THREE.Mesh(archGeo, iceMatFlat);
    arch.position.set(0, ay, az);
    arch.castShadow = arch.receiveShadow = true;
    group.add(arch);
    physics.addBox(0, ay, az, 72, 1.8, 6);
  }

  // ice spires on the floor — cover, and something to shatter the quiet
  for (let i = 0; i < 14; i++) {
    const x = (rng() - 0.5) * 26;
    const z = (rng() - 0.5) * 220;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE_R + 3) continue;
    const h = 2 + rng() * 4;
    const r = 0.9 + rng() * 0.8;
    const base = heightAt(x, z);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), iceMat);
    spire.position.set(x, base + h / 2 - 0.2, z);
    spire.castShadow = true;
    group.add(spire);
    // Follow the taper. One 0.8 m cylinder for cones whose bases run 0.98-1.65
    // let you walk most of a metre into the widest of them, and — because a
    // cylinder does not narrow — left a 1.6 m disc of standable air balanced on
    // every spike, metres above the floor. Two stacked slices track it closely
    // enough, and the cone's inscribed radius is what the six-sided mesh
    // actually presents.
    const inr = r * Math.cos(Math.PI / 6);
    physics.addCylinder(x, base + h * 0.05 - 0.2, z, inr * 0.75, h * 0.5);
    physics.addCylinder(x, base + h * 0.55 - 0.2, z, inr * 0.3, h * 0.5);
  }

  // a crashed survey crawler on the north rim: crate cover for the shooters
  const wreckMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.7, metalness: 0.4 });
  // 10 x 8.9 x 7.7 is what the authored crawler measures at its 10 m length —
  // a far taller machine than the low box that stood in for it. Stand-in,
  // sculpt and collider are all sized to the art so the three agree, and the
  // list goes with it: an 8.9 m body rolled 0.18 rad puts a metre of invisible
  // wall in the corners of an axis-aligned box.
  const wreck = new THREE.Mesh(new THREE.BoxGeometry(10, 8.9, 7.7), wreckMat);
  const wx = -34, wz = -70;
  const wBase = heightAt(wx, wz);
  wreck.position.set(wx, wBase + 4.45, wz);
  wreck.castShadow = wreck.receiveShadow = true;
  group.add(wreck);
  physics.addBox(wx, wBase + 4.45, wz, 10, 8.9, 7.7);
  // Lies along the box's long axis with the same list the stand-in has, and
  // grounds on the rim rather than on the box's centre.
  authoredProp(group, wreck, 'survey_crawler', 10, {
    // settled a little into the snow rather than perched on it — the tracks
    // of a machine that has been sitting here through a winter
    x: wx, y: wBase - 0.35, z: wz, axis: 'z', yaw: Math.PI / 2,
  });
  for (const [cx, cz] of [[wx + 7, wz + 2], [wx + 8.5, wz - 1], [wx - 7, wz - 3]] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), wreckMat);
    const cy = heightAt(cx, cz);
    crate.position.set(cx, cy + 1.1, cz);
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    physics.addBox(cx, cy + 1.1, cz, 2.2, 2.2, 2.2);
    authoredProp(group, crate, 'cargo_crate', 2.2, { x: cx, y: cy, z: cz });
  }

  const board: Board = {
    group, physics, kind: 'crevasse',
    name: 'The Crevasse',
    objective: 'Maldo Kreis · survive 7 waves',
    footstep: 'snow',
    ambience: { sample: 'amb_ice', bed: 'wind' },
    music: 'station',
    background: new THREE.Color(0xdde7ee),
    heroLight: 0.08,
    skyFile: 'sky_ice',
    proceduralSky,
    fog: new THREE.Fog(0xdde7ee, 70, 340),
    playerStarts: [new THREE.Vector3(0, heightAt(0, -110) + 0.5, -110), new THREE.Vector3(3, heightAt(3, -110) + 0.5, -110)],
    groundSpawns: [
      new THREE.Vector3(0, 0, 100), new THREE.Vector3(-8, 0, 20),      // floor
      new THREE.Vector3(6, 0, -50), new THREE.Vector3(-4, 0, 70),
      new THREE.Vector3(-34, 0, -70), new THREE.Vector3(40, 0, 60),    // rims
      new THREE.Vector3(-45, 0, 30), new THREE.Vector3(38, 0, -40),
    ].map((v) => v.setY(heightAt(v.x, v.z) + 0.3)),
    airSpawns: [
      new THREE.Vector3(0, 12, -30), new THREE.Vector3(-20, 10, 60), new THREE.Vector3(25, 14, 0),
    ],
    burnAt: waterDps,
    tractionAt,
  };

  // the frozen lake: a grid of plates over dark water. Each is a breakable —
  // bolts chip them, a slam cracks them outright, and whoever is standing
  // there goes down with the floor.
  const plateMat = new THREE.MeshStandardMaterial({
    map: iceTexture(), color: 0xd8eaf2, roughness: 0.3, metalness: 0.05,
    transparent: true, opacity: 0.9,
  });
  for (let gx = -1; gx <= 1; gx++) {
    for (let gz = -1; gz <= 1; gz++) {
      const px = LAKE.x + gx * 12.5, pz = LAKE.z + gz * 12.5;
      if (Math.hypot(px - LAKE.x, pz - LAKE.z) > LAKE_R + 2) continue;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(12.2, 0.6, 12.2), plateMat);
      plate.position.set(px, FLOOR_Y - 0.3, pz);
      plate.receiveShadow = true;
      group.add(plate);
      const box = physics.addBox(px, FLOOR_Y - 0.3, pz, 12.2, 0.6, 12.2);
      addBreakable(board, plate, box, 95, {
        radius: 6.4,
        onBreak: () => audio.iceCrack(0.8),
      });
    }
  }

  // drifting snow + the occasional groan of the glacier
  const flakeCount = 500;
  const flakePos = new Float32Array(flakeCount * 3);
  for (let i = 0; i < flakeCount; i++) {
    flakePos[i * 3] = (rng() - 0.5) * 220;
    flakePos[i * 3 + 1] = -10 + rng() * 40;
    flakePos[i * 3 + 2] = (rng() - 0.5) * 260;
  }
  const flakeGeo = new THREE.BufferGeometry();
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
  flakeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const flakes = new THREE.Points(flakeGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.14, transparent: true, opacity: 0.75, depthWrite: false,
  }));
  flakes.frustumCulled = false;
  group.add(flakes);

  let groan = 20 + rng() * 30;
  board.update = (dt: number, time: number, game?: Game) => {
    const p = flakeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < flakeCount; i++) {
      let y = p.getY(i) - dt * (1.2 + (i % 5) * 0.3);
      if (y < -16) y = 26;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(time * 0.7 + i) * dt * 0.5);
    }
    p.needsUpdate = true;
    groan -= dt;
    if (groan <= 0) {
      groan = 25 + Math.random() * 35;
      audio.iceCrack(0.25); // the glacier settling, far off
    }
    void game;
  };

  return board;
}
