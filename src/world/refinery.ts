import * as THREE from 'three';
import { PhysicsWorld } from '../core/physics';
import { makeRng } from '../core/math';
import { crateTexture, deckTexture, hullTexture } from '../core/assets';
import { addBreakable, type Board } from './board';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Board 6 — the Rhydonium Refinery: the first interior. A ring of walled
 * work halls under a low ceiling around a central reactor shaft — a 40 m
 * open chimney the jetpack owns, ringed by catwalks. Rhydonium barrels chain
 * explosively (the AI's own cover habit becomes a trap), and wall consoles
 * sound a base-wide alarm while any garrison squad is fighting — shoot the
 * consoles out to keep your firefights local.
 */

const WALL_H = 40;
/** underside of the roof slab — the walls run up to meet it, leaving no ledge */
const ROOF_UNDER = 41.25;
const CEIL_Y = 7.2;

export function buildRefinery(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = () => 0;
  physics.killY = -20;
  const rng = makeRng(3311);

  // interior light: no sun. A dim cool wash, warm sodium pools, red alert rig.
  group.add(new THREE.HemisphereLight(0x6a7484, 0x1a1c20, 0.85));
  // A directional wash standing in for bounce off the walls — deliberately not
  // a shadow caster. This is a windowless building: the roof and the ceiling
  // slabs are solid, so a sun-shaped shadow map either lights the interior
  // through its own roof (what it did) or blacks the whole board out. Either
  // way a full 2048 shadow pass was being rendered every frame for nothing.
  const key = new THREE.DirectionalLight(0xbfd0e0, 0.7);
  key.position.set(30, 60, 10);
  group.add(key);
  const lamps: THREE.PointLight[] = [];
  for (const [lx, lz] of [[-30, -30], [30, -30], [-30, 30], [30, 30], [0, 0]] as const) {
    const l = new THREE.PointLight(0xffc98a, 45, 38);
    l.position.set(lx, lx === 0 ? 30 : 6.4, lz);
    group.add(l);
    lamps.push(l);
  }
  const alertLight = new THREE.PointLight(0xff2a1a, 0, 90);
  alertLight.position.set(0, 20, 0);
  group.add(alertLight);

  const floorMat = new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0x767a80, roughness: 0.75, metalness: 0.4 });
  const wallMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x8a8d92, roughness: 0.65, metalness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.7, metalness: 0.4 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.8 });

  // floor + high roof (the shaft is lit from lamps, not sky)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100), floorMat);
  floor.position.y = -0.5;
  floor.receiveShadow = true;
  group.add(floor);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(100, 1.5, 100), darkMat);
  roof.position.y = 42;
  group.add(roof);
  physics.addBox(0, 42, 0, 100, 1.5, 100);

  // outer walls
  for (const [wx, wz, w, d] of [[0, -50, 102, 2], [0, 50, 102, 2], [-50, 0, 2, 102], [50, 0, 2, 102]] as const) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    wall.position.set(wx, WALL_H / 2, wz);
    wall.receiveShadow = true;
    group.add(wall);
    // Meet the roof. The walls stopped at 40 and the roof's underside is at
    // 41.25, leaving a 1.25 m slot over a 2 m ledge — too low for the 1.75 m
    // player capsule to stand in, so a jetpack landing on the wall top
    // oscillated between the ceiling pushing down and the ledge snapping back.
    physics.addBox(wx, ROOF_UNDER / 2, wz, w, ROOF_UNDER, d);
  }

  // low ceiling over the outer work halls; the centre 44×44 stays open — the
  // reactor atrium, a jetpack chimney ringed with catwalks
  const ceilSpecs: [number, number, number, number][] = [
    [0, -36, 100, 28], [0, 36, 100, 28], [-36, 0, 28, 44], [36, 0, 28, 44],
  ];
  for (const [cx, cz, w, d] of ceilSpecs) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), darkMat);
    slab.position.set(cx, CEIL_Y + 0.5, cz);
    group.add(slab);
    physics.addBox(cx, CEIL_Y + 0.5, cz, w, 1, d);
  }

  // interior walls: partition the halls into rooms with wide doorways
  const partitions: [number, number, number, number][] = [
    [-22, -30, 2, 24], [22, -30, 2, 24], [-22, 30, 2, 24], [22, 30, 2, 24],
    [-36, -12, 16, 2], [36, -12, 16, 2], [-36, 12, 16, 2], [36, 12, 16, 2],
    [0, -30, 14, 2], [0, 30, 14, 2],
  ];
  for (const [px, pz, w, d] of partitions) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, CEIL_Y, d), wallMat);
    wall.position.set(px, CEIL_Y / 2, pz);
    wall.castShadow = wall.receiveShadow = true;
    group.add(wall);
    physics.addBox(px, CEIL_Y / 2, pz, w, CEIL_Y, d);
  }

  // the reactor: a glowing column up the middle of the shaft
  const core = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5.5, 40, 12), wallMat);
  core.position.y = 20;
  core.castShadow = core.receiveShadow = true;
  group.add(core);
  // The column tapers 5.5 -> 4.5 over its height; one 5.2 m cylinder sank you
  // 0.3 m into the base and put an invisible wall 0.7 m off the top. Stack a
  // few, each matching the radius over its own slice.
  for (let i = 0; i < 4; i++) {
    const h = 40 / 4;
    const cy = i * h + h / 2;
    const r = 5.5 - (cy / 40) * 1.0;   // radius at the middle of this slice
    physics.addCylinder(0, cy, 0, r, h);
  }
  // Outside the core at every height, not just the top five metres: a straight
  // 4.7 m shell against a 5.5 -> 4.5 taper was swallowed by its own column for
  // 29 of its 34 m, so the board's signature light only showed near the roof.
  const coreGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(4.8, 5.8, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  coreGlow.position.y = 20;
  group.add(coreGlow);

  // catwalk rings around the shaft at three heights
  for (const cy of [8, 16, 24]) {
    for (const [gx, gz, w, d] of [
      [0, -14, 26, 4], [0, 14, 26, 4], [-14, 0, 4, 26], [14, 0, 4, 26],
    ] as const) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), floorMat);
      walk.position.set(gx, cy, gz);
      walk.castShadow = walk.receiveShadow = true;
      group.add(walk);
      physics.addBox(gx, cy, gz, w, 0.5, d);
    }
  }

  // crates: cover through the halls. One geometry between them, as elsewhere —
  // eighteen identical boxes were eighteen separate buffer sets.
  const refCrateGeo = new THREE.BoxGeometry(2.4, 2.4, 2.4);
  for (let i = 0; i < 18; i++) {
    const room = [[-36, -36], [36, -36], [-36, 36], [36, 36], [-36, 0], [36, 0], [0, -40], [0, 40]][i % 8];
    const cx = room[0] + (rng() - 0.5) * 14;
    const cz = room[1] + (rng() - 0.5) * 12;
    const crate = new THREE.Mesh(refCrateGeo, crateMat);
    crate.position.set(cx, 1.2, cz);
    crate.rotation.y = rng() * 0.8;
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    physics.addBox(cx, 1.2, cz, 2.4, 2.4, 2.4);
  }

  const board: Board = {
    group, physics, kind: 'refinery',
    name: 'The Refinery',
    objective: 'Imperial rhydonium plant · survive 10 waves',
    footstep: 'metal',
    ambience: { sample: 'amb_refinery', bed: 'hum' },
    music: 'station',
    background: new THREE.Color(0x0a0b0e),
    heroLight: 0.3,
    fog: new THREE.Fog(0x101216, 30, 160),
    playerStarts: [new THREE.Vector3(0, 0.5, 44), new THREE.Vector3(3, 0.5, 44)],
    groundSpawns: [
      new THREE.Vector3(-36, 0.3, -36), new THREE.Vector3(36, 0.3, -36),
      new THREE.Vector3(-36, 0.3, 36), new THREE.Vector3(36, 0.3, 36),
      new THREE.Vector3(-40, 0.3, 0), new THREE.Vector3(40, 0.3, 0),
      new THREE.Vector3(0, 0.3, -42), new THREE.Vector3(-10, 8.3, -14),
    ],
    airSpawns: [
      new THREE.Vector3(0, 20, -12), new THREE.Vector3(12, 26, 8), new THREE.Vector3(-12, 14, 6),
    ],
  };

  // ---- rhydonium barrels: the volatile kind of cover ----
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8f5a24, roughness: 0.6, metalness: 0.35 });
  const barrelGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.7, 12);
  const hazardStripe = new THREE.MeshStandardMaterial({ color: 0xd8b02a, roughness: 0.5, emissive: 0x3a1004 });
  for (const [bx, bz] of [
    [-30, -40], [-28.4, -40.8], [32, -34], [40, 30], [41.4, 31.6],
    [-40, 26], [-14, -1], [15, 2], [-2, -15], [4, 15.5],
    [26, 44], [-33, 42], [44, -8],
  ] as const) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, 0.85, bz);
    barrel.rotation.y = rng() * Math.PI;
    barrel.castShadow = barrel.receiveShadow = true;
    group.add(barrel);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.2, 12), hazardStripe);
    band.position.set(bx, 1.2, bz);
    group.add(band);
    const box = physics.addBox(bx, 0.85, bz, 1.2, 1.7, 1.2);
    addBreakable(board, barrel, box, 45, {
      explosive: true, radius: 1.1,
      onBreak: () => { band.visible = false; },
    });
  }

  // ---- alarm consoles: while any stands, engaged squads call the base ----
  interface Console { alive: boolean; light: THREE.Mesh; }
  const consoles: Console[] = [];
  for (const [cx, cz, ry] of [[-48.5, -20, Math.PI / 2], [48.5, 20, -Math.PI / 2], [-20, 48.5, Math.PI], [20, -48.5, 0]] as const) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.8), darkMat);
    body.position.set(cx, 1.3, cz);
    body.rotation.y = ry;
    body.castShadow = true;
    group.add(body);
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff4433 }),
    );
    light.position.set(cx, 2.8, cz);
    group.add(light);
    const box = physics.addBox(cx, 1.3, cz, Math.abs(ry) === Math.PI / 2 ? 0.8 : 2.4, 2.6, Math.abs(ry) === Math.PI / 2 ? 2.4 : 0.8);
    const rec: Console = { alive: true, light };
    consoles.push(rec);
    addBreakable(board, body, box, 70, {
      radius: 1.5,
      onBreak: () => { rec.alive = false; light.visible = false; audio.impact(); },
    });
  }

  let alarmIn = 14;
  let alertPulse = 0;
  board.update = (dt: number, time: number, game?: Game) => {
    coreGlow.material.opacity = 0.13 + Math.sin(time * 2.1) * 0.04;

    // the alarm: while a console stands and a squad is fighting, the whole
    // garrison hears about it on a cadence. Kill the consoles, keep it local.
    alarmIn -= dt;
    if (alarmIn <= 0 && game) {
      alarmIn = 16;
      const anyEngaged = game.enemies.some((e) => e.alive && e.isEngaged);
      const consolesLeft = consoles.some((cn) => cn.alive);
      if (anyEngaged && consolesLeft) {
        audio.alarm(0.55);
        alertPulse = 2.6;
        const near = game.players.find((p) => p.alive) ?? game.players[0];
        if (near) game.director.noise(game, near.position, 400);
      }
    }
    if (alertPulse > 0) {
      alertPulse -= dt;
      alertLight.intensity = (Math.sin(time * 9) * 0.5 + 0.5) * 90;
      for (const cn of consoles) if (cn.alive) (cn.light.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(time * 9) > 0 ? 0xff4433 : 0x581410);
    } else {
      alertLight.intensity = Math.max(0, alertLight.intensity - dt * 120);
    }
    void lamps;
  };

  return board;
}
