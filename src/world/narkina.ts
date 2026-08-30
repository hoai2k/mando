import * as THREE from 'three';
import { PhysicsWorld, type StaticCylinder } from '../core/physics';
import { clamp, fbm2, makeRng, ridge2 } from '../core/math';
import { deckTexture, hullTexture, loadOptionalTexture } from '../core/assets';
import { gradientSky } from './sky';
import type { Board } from './board';
import { authoredProp } from './props';
import { audio } from '../core/audio';
import type { Game } from '../game/game';

/**
 * Board 9 — "The Prison Rig": a sterile white Imperial labour facility
 * standing on pylons over an ocean world, inspired by the Empire's
 * floor-shocked island prisons. Above the surface it fights like a platform
 * board with one twist — deck sections charge up and electrify on a cycle,
 * and everything standing on them (guards included) had better hop. Below
 * the surface is the other half of the board: a swimmable sea with a kelp
 * forest, a glowing reef, a sunken transport to explore, and a moon pool
 * that surfaces inside the facility — the stealth route past every sentry.
 */

const WATER_Y = 0;
const DECK_Y = 6;

/**
 * Soft round glow for the shock sparks. Untextured points render as hard
 * squares, which read as debris rather than as light coming off the plate.
 * Built per board so it is torn down with the match, like the board's own
 * geometry.
 */
function sparkSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(210,240,255,0.6)');
  g.addColorStop(1, 'rgba(160,220,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function heightAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  // rolling seabed with a ridge-carved trench swinging through it
  let h = -22 + fbm2(x * 0.015 + 11, z * 0.015 + 4, 4) * 5;
  h -= ridge2(x * 0.008 + 2, z * 0.008, 3) * 6;
  // a seamount rises toward the light south of the rig
  const sm = Math.hypot(x - 55, z - 70);
  if (sm < 40) h += Math.cos((sm / 40) * Math.PI * 0.5) * 15;
  // distant breaker ring keeps the arena bounded
  if (d > 150) h += (d - 150) * 0.35;
  return h;
}

export function buildNarkina(): Board {
  const group = new THREE.Group();
  const physics = new PhysicsWorld();
  physics.heightAt = heightAt;
  physics.killY = -60;
  const rng = makeRng(9134);

  const proceduralSky = gradientSky({
    top: 0x9fb2c4, horizon: 0xe4ecf0, dusk: 0xc8d4da,
    sun1: { dir: new THREE.Vector3(-0.3, 0.42, 0.3), color: 0xf6f8fa },
  });
  group.add(proceduralSky);

  // hard white glare over a grey sea — the sterile look is the point
  const sun = new THREE.DirectionalLight(0xf4f7fa, 2.2);
  sun.position.set(-50, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
  sun.shadow.camera.right = sun.shadow.camera.top = 80;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(new THREE.HemisphereLight(0xd0dce6, 0x2c4048, 1.0));

  // the sea: a broad plane that breathes; the fog swap in Game.render does
  // the murk once a camera goes below it
  const seaGeo = new THREE.PlaneGeometry(400, 400, 36, 36);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({
    color: 0x2a4a56, roughness: 0.25, metalness: 0.15,
    transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false,
  }));
  sea.position.y = WATER_Y;
  group.add(sea);
  const seaPos = seaGeo.attributes.position as THREE.BufferAttribute;

  // seabed
  const seg = 110;
  const bedGeo = new THREE.PlaneGeometry(380, 380, seg, seg);
  bedGeo.rotateX(-Math.PI / 2);
  const bedPos = bedGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(bedPos.count * 3);
  const sandC = new THREE.Color(0x6a7a72), rockC = new THREE.Color(0x3c4a48), reefC = new THREE.Color(0x2f5a55);
  const c = new THREE.Color();
  for (let i = 0; i < bedPos.count; i++) {
    const x = bedPos.getX(i), z = bedPos.getZ(i);
    const h = heightAt(x, z);
    bedPos.setY(i, h);
    c.copy(sandC).lerp(rockC, Math.min(Math.max((-8 - h) / 14, 0), 1));
    if (fbm2(x * 0.04, z * 0.04, 3) > 0.62) c.lerp(reefC, 0.5);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  bedGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  bedGeo.computeVertexNormals();
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
  }));
  bed.receiveShadow = true;
  group.add(bed);

  const whiteMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0xdfe4e8, roughness: 0.45, metalness: 0.3 });
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), color: 0xc9ced4, roughness: 0.55, metalness: 0.35 });
  // Clean composite panelling on every white surface of the rig — the sterile
  // Imperial look the board is built around, which the generic hull map only
  // approximated with a grey tint.
  loadOptionalTexture('panel_white', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    for (const m of [whiteMat, deckMat]) {
      m.map = tex;
      m.color.setHex(0xffffff);
      m.needsUpdate = true;
    }
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.6, metalness: 0.4 });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xdff2ff });

  /** one white deck slab with its light strip, walkable, on the physics */
  const deck = (x: number, z: number, w: number, d: number, y = DECK_Y): void => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), deckMat);
    slab.position.set(x, y - 0.55, z);
    slab.castShadow = slab.receiveShadow = true;
    group.add(slab);
    physics.addBox(x, y - 0.55, z, w, 1.1, d);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.06, 0.3), stripMat);
    strip.position.set(x, y + 0.04, z + d / 2 - 0.4);
    group.add(strip);
  };

  // ---- the rig: a ring of decks around an open moon pool ----
  // The pool is the hole in the middle: dive it and you are under the rig;
  // surface through it and you are inside the perimeter, behind every post.
  deck(0, -16, 34, 12);          // north hall
  deck(0, 16, 34, 12);           // south hall
  deck(-16, 0, 12, 22);          // west walk
  deck(16, 0, 12, 22);           // east walk
  // satellite pads, bridged
  deck(0, -52, 18, 16);
  deck(46, 10, 16, 16, 7);
  deck(-46, -6, 16, 16, 5.4);
  deck(8, 54, 18, 16, 6.6);
  // bridges
  deck(0, -34, 5, 26);
  deck(31, 4, 18, 5, 6.5);
  deck(-31, -3, 18, 5, 5.7);
  deck(4, 36, 5, 22, 6.3);

  // control tower on the ring
  const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 12, 8), whiteMat);
  tower.position.set(-11, DECK_Y + 6, -19);
  tower.castShadow = tower.receiveShadow = true;
  group.add(tower);
  physics.addBox(-11, DECK_Y + 6, -19, 10, 12, 8);
  const towerWin = new THREE.Mesh(new THREE.BoxGeometry(8, 1.4, 0.2), stripMat);
  towerWin.position.set(-11, DECK_Y + 9, -14.9);
  group.add(towerWin);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.3, 9, 6), darkMat);
  antenna.position.set(-11, DECK_Y + 16, -19);
  group.add(antenna);

  // pylons: the rig's legs, down into the sea — swim between them
  for (const [px, pz] of [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, -50], [44, 8], [-44, -4], [8, 52]] as const) {
    const base = heightAt(px, pz);
    const h = DECK_Y - base;
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, h, 8), whiteMat);
    pylon.position.set(px, base + h / 2, pz);
    pylon.castShadow = pylon.receiveShadow = true;
    group.add(pylon);
    physics.addCylinder(px, base + h / 2, pz, 1.6, h);
  }

  // white cargo containers: the cover
  for (const [cx, cz, cy] of [
    [-8, -16, DECK_Y], [6, -14, DECK_Y], [12, 18, DECK_Y], [-13, 14, DECK_Y],
    [2, -52, DECK_Y], [44, 6, 7], [-48, -8, 5.4], [10, 56, 6.6], [-3, -34, DECK_Y],
  ] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), whiteMat);
    crate.position.set(cx, cy + 1.2, cz);
    crate.rotation.y = rng() * 0.7;
    crate.castShadow = crate.receiveShadow = true;
    group.add(crate);
    const box = physics.addBox(cx, cy + 1.2, cz, 2.4, 2.4, 2.4);
    authoredProp(group, crate, 'cargo_crate', 2.4, { x: cx, y: cy, z: cz, yaw: crate.rotation.y },
      { physics, replace: [box], maxBoxes: 4 });
  }

  // ---- the electrified floors ----
  // Sections charge (blink + rising whine), then go live: everything standing
  // on the plate takes the shock, guards included. The board's rhythm: hop,
  // reposition, or be somewhere else when the hum peaks.
  //
  // Each zone is three pieces of the same field, all additively blended so
  // they read as light rather than paint: a bluish sheet floating a hand's
  // width over the plate, arcs crawling across it, and sparks popping off it.
  // A plain flickering white rectangle said "hazard" but not "electricity".
  interface ShockZone {
    x: number; z: number; w: number; d: number; y: number;
    plate: THREE.Mesh; arcs: THREE.LineSegments; sparks: THREE.Points;
    /** how many bolts this plate can carry at once, by its area */
    bolts: number;
    phase: number; charged: boolean;
  }
  const zones: ShockZone[] = [];
  const zoneSpecs: [number, number, number, number, number, number][] = [
    // x, z, w, d, y, cycle phase offset
    [0, -16, 33, 11, DECK_Y, 0],
    [0, 16, 33, 11, DECK_Y, 5.5],
    [0, -34, 4.4, 25, DECK_Y, 11],
    [31, 4, 17, 4.4, 6.5, 8.2],
    [4, 36, 4.4, 21, 6.3, 2.8],
  ];
  /** the field floats this far over the deck — six inches, in metres */
  const FIELD_H = 0.15;
  /** kinks per bolt: enough to look struck, few enough to redraw every flicker */
  const BOLT_STEPS = 7;
  const SPARKS_PER_ZONE = 44;
  const sparkTex = sparkSprite();
  for (const [zx, zz, w, d, zy, phase] of zoneSpecs) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      // A film, not a glow. The deck is near-white, and additive light on
      // white stays white — the field has to *tint* the plate to read as a
      // layer of charged air over it at all.
      new THREE.MeshBasicMaterial({
        color: 0x2f9fd8, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(zx, zy + FIELD_H, zz);
    group.add(plate);

    // bolts are drawn in the zone's own space, so a strike is generated in
    // plate-local x/z and the parent puts it over the right piece of deck
    const bolts = Math.max(3, Math.round(Math.sqrt(w * d) * 0.7));
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bolts * BOLT_STEPS * 2 * 3), 3));
    // the bolts are rewritten every flicker, so a fitted sphere would be stale
    // the moment it was computed — quote one big enough for any strike
    arcGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(w, d));
    // white-hot lines drawn over the film rather than added to it, for the
    // same reason: additive white over a white deck is invisible
    const arcs = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: 0xf4fdff, transparent: true, opacity: 0, depthWrite: false,
    }));
    arcs.position.set(zx, zy + FIELD_H, zz);
    group.add(arcs);

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS_PER_ZONE * 3), 3));
    sparkGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(w, d));
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
      color: 0xeaf8ff, size: 0.22, map: sparkTex, sizeAttenuation: true,
      transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    sparks.position.set(zx, zy + FIELD_H, zz);
    group.add(sparks);

    zones.push({ x: zx, z: zz, w, d, y: zy, plate, arcs, sparks, bolts, phase, charged: false });
  }
  const SHOCK_CYCLE = 16;   // seconds: ~11 off, 2.2 charging, 2.8 live
  /** seconds a set of bolts holds before the next one strikes */
  const FLICKER = 0.055;
  let flickerT = 0;

  /**
   * Re-strike one zone: `intensity` (0..1) scales how much of the plate is lit
   * at once, so a charging plate skitters with one or two thin arcs and a live
   * one is webbed over.
   */
  function restrike(zn: ShockZone, intensity: number): void {
    const attr = zn.arcs.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const count = Math.max(1, Math.round(zn.bolts * intensity));
    const hw = zn.w / 2, hd = zn.d / 2;
    let o = 0;
    for (let b = 0; b < count; b++) {
      // a bolt strikes between two points on the plate, wandering most in the
      // middle of its run — a straight line between them reads as a laser
      const x0 = (Math.random() - 0.5) * zn.w;
      const z0 = (Math.random() - 0.5) * zn.d;
      const a = Math.random() * Math.PI * 2;
      const len = 1.2 + Math.random() * Math.min(zn.w, zn.d) * 0.7;
      const x1 = clamp(x0 + Math.cos(a) * len, -hw, hw);
      const z1 = clamp(z0 + Math.sin(a) * len, -hd, hd);
      let px = x0, py = 0, pz = z0;
      for (let step = 1; step <= BOLT_STEPS; step++) {
        const t = step / BOLT_STEPS;
        const wander = Math.sin(t * Math.PI) * 1.35;
        const nx = clamp(x0 + (x1 - x0) * t + (Math.random() - 0.5) * wander, -hw, hw);
        const nz = clamp(z0 + (z1 - z0) * t + (Math.random() - 0.5) * wander, -hd, hd);
        const ny = step === BOLT_STEPS ? 0 : Math.random() * 0.13;
        arr[o++] = px; arr[o++] = py; arr[o++] = pz;
        arr[o++] = nx; arr[o++] = ny; arr[o++] = nz;
        px = nx; py = ny; pz = nz;
      }
    }
    attr.needsUpdate = true;
    zn.arcs.geometry.setDrawRange(0, count * BOLT_STEPS * 2);

    // Sparks jump off wherever the field is biting. Most of them are beaded
    // along the bolts just drawn: a line is one pixel wide however close you
    // stand to it, and glows strung along its path are what give a bolt any
    // thickness at all. The rest scatter over the plate so the whole zone
    // crackles rather than only the lit paths.
    const sp = zn.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const spArr = sp.array as Float32Array;
    const lit = Math.max(2, Math.round(SPARKS_PER_ZONE * intensity));
    const onBolt = Math.round(lit * 0.65);
    const verts = count * BOLT_STEPS * 2;
    for (let i = 0; i < SPARKS_PER_ZONE; i++) {
      if (i >= lit) {
        // the unlit remainder is parked under the deck rather than drawn dim
        spArr[i * 3] = 0; spArr[i * 3 + 1] = -50; spArr[i * 3 + 2] = 0;
        continue;
      }
      if (i < onBolt && verts > 0) {
        const v = Math.floor(Math.random() * verts) * 3;
        spArr[i * 3] = arr[v] + (Math.random() - 0.5) * 0.2;
        spArr[i * 3 + 1] = arr[v + 1] + Math.random() * 0.12;
        spArr[i * 3 + 2] = arr[v + 2] + (Math.random() - 0.5) * 0.2;
      } else {
        spArr[i * 3] = (Math.random() - 0.5) * zn.w;
        spArr[i * 3 + 1] = Math.random() * Math.random() * 0.7;
        spArr[i * 3 + 2] = (Math.random() - 0.5) * zn.d;
      }
    }
    sp.needsUpdate = true;
  }

  function setFieldVisible(zn: ShockZone, on: boolean): void {
    zn.arcs.visible = on;
    zn.sparks.visible = on;
  }
  for (const zn of zones) setFieldVisible(zn, false);

  // ---- below: the reasons to dive ----
  // kelp forest on the trench's shoulder
  // Each plant is two crossed alpha cards where the frond artwork exists — a
  // ribbon leaf reads as a plant from any angle, where the fallback cylinder
  // reads as a pole. The material is swapped in place, so the cards are built
  // either way and simply carry no cutout until the texture lands.
  const kelpMat = new THREE.MeshStandardMaterial({ color: 0x2f6a4c, roughness: 0.9, side: THREE.DoubleSide });
  loadOptionalTexture('kelp_frond', (tex) => {
    kelpMat.map = tex;
    kelpMat.alphaMap = tex;
    kelpMat.transparent = true;
    kelpMat.alphaTest = 0.4;
    kelpMat.color.setHex(0xffffff);
    kelpMat.needsUpdate = true;
    // the cylinder was the stand-in; the cards replace it
    for (const plant of kelp) plant.children.forEach((c, i) => { c.visible = i > 0; });
  }, { exts: ['png'] });
  const kelp: THREE.Group[] = [];
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2, dd = 30 + rng() * 70;
    const x = Math.cos(a) * dd - 20, z = Math.sin(a) * dd - 20;
    const base = heightAt(x, z);
    const h = Math.min(6 + rng() * 12, WATER_Y - 2 - base);
    if (h < 4) continue;
    const plant = new THREE.Group();
    plant.position.set(x, base + h / 2, z);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.24, h, 5), kelpMat);
    plant.add(stalk);
    // two cards crossed at right angles, so the frond has no edge-on angle
    for (const turn of [0, Math.PI / 2]) {
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.9, h), kelpMat);
      card.rotation.y = turn + rng() * 0.4;
      card.visible = false;   // shown when the artwork arrives
      plant.add(card);
    }
    // kelp parts around a swimmer; a forest of solid poles would be a fence
    plant.userData.decor = true;
    group.add(plant);
    kelp.push(plant);
  }
  // glowing reef on the seamount slope
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x3ac8b8, emissive: 0x2a8a80, roughness: 0.6 });
  for (let i = 0; i < 22; i++) {
    const x = 40 + rng() * 34, z = 52 + rng() * 34;
    const base = heightAt(x, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3 + rng() * 0.5, 7, 6), glowMat);
    bulb.position.set(x, base + 0.4, z);
    // soft coral, half-sunk in the seabed: brushing through it is right
    bulb.userData.decor = true;
    group.add(bulb);
  }
  for (const [lx, lz] of [[52, 62], [62, 74]] as const) {
    const l = new THREE.PointLight(0x3ac8b8, 40, 26);
    l.position.set(lx, heightAt(lx, lz) + 3, lz);
    group.add(l);
  }
  // a sunken prison transport: broken hull you can swim through
  const wreckMat = new THREE.MeshStandardMaterial({ map: hullTexture(), color: 0x7a8288, roughness: 0.7, metalness: 0.4 });
  const wreckBase = heightAt(-52, 48);
  const wreck = new THREE.Group();
  const hullL = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 20), wreckMat);
  hullL.position.set(-4.5, 3, 0);
  wreck.add(hullL);
  const hullR = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 20), wreckMat);
  hullR.position.set(4.5, 3, 0);
  wreck.add(hullR);
  const hullTop = new THREE.Mesh(new THREE.BoxGeometry(15, 2, 20), wreckMat);
  hullTop.position.set(0, 7, 0);
  wreck.add(hullTop);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 8, 3, 1), wreckMat);
  nose.rotation.z = Math.PI / 2;
  nose.rotation.y = Math.PI / 2;
  nose.position.set(0, 4, 13);
  wreck.add(nose);
  wreck.position.set(-52, wreckBase, 48);
  wreck.rotation.y = 0.6;
  wreck.rotation.z = 0.12;
  wreck.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  group.add(wreck);
  // Hung off the wreck node, so it inherits the yaw and roll the collider rows
  // below were built around — and the corridor between the hulls, which is the
  // whole point of the wreck, stays where the physics says it is.
  // Collision follows the wreck's own axes. It lies yawed 0.6 rad and rolled
  // 0.12, which no axis-aligned box describes: the old three boxes left the
  // hull sides open at the ends and put invisible steel out in the water
  // alongside them. Upright cylinders stepped along the hull take the yaw for
  // free, and the corridor between the two hulls — the whole point of the
  // wreck — stays swimmable.
  const wyaw = 0.6, wroll = 0.12;
  const local = (lx: number, ly: number, lz: number): [number, number, number] => {
    const x1 = lx * Math.cos(wroll) - ly * Math.sin(wroll);
    const y1 = lx * Math.sin(wroll) + ly * Math.cos(wroll);
    return [
      -52 + x1 * Math.cos(wyaw) + lz * Math.sin(wyaw),
      wreckBase + y1,
      48 - x1 * Math.sin(wyaw) + lz * Math.cos(wyaw),
    ];
  };
  const wreckStand: StaticCylinder[] = [];
  for (const lz of [-10, -5, 0, 5, 10]) {
    for (const lx of [-4.5, 4.5]) {                       // the two hull walls
      const [x, y, z] = local(lx, 3, lz);
      wreckStand.push(physics.addCylinder(x, y, z, 3, 6));
    }
    for (const lx of [-3.6, 3.6]) {                       // the roof over them
      const [x, y, z] = local(lx, 7, lz);
      wreckStand.push(physics.addCylinder(x, y, z, 4.2, 2));
    }
  }
  for (const lz of [10, 14]) {                            // the blunt nose
    const [x, y, z] = local(0, 4, lz);
    wreckStand.push(physics.addCylinder(x, y, z, 3.6, 7));
  }
  // Hung off the wreck node, so it inherits the yaw and roll the collider rows
  // above were built around — and the corridor between the hulls, which is the
  // whole point of the wreck, stays where the physics says it is. The fit is
  // strictly better at keeping it: the sculpt's own gap is the gap.
  authoredProp(wreck, [hullL, hullR, hullTop, nose], 'sunken_transport', 28, { axis: 'z' },
    { physics, replace: wreckStand, maxBoxes: 24 });

  // fish: a slow school circling the reef
  const fishCount = 120;
  const fishPos = new Float32Array(fishCount * 3);
  const fishSeed = new Float32Array(fishCount * 2);
  for (let i = 0; i < fishCount; i++) {
    fishSeed[i * 2] = rng() * Math.PI * 2;
    fishSeed[i * 2 + 1] = 8 + rng() * 22;
  }
  const fishGeo = new THREE.BufferGeometry();
  fishGeo.setAttribute('position', new THREE.BufferAttribute(fishPos, 3));
  fishGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const fish = new THREE.Points(fishGeo, new THREE.PointsMaterial({
    color: 0xa8d8d0, size: 0.22, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  fish.frustumCulled = false;
  group.add(fish);

  const board: Board = {
    group, physics, kind: 'narkina',
    name: 'The Prison Rig',
    objective: 'Imperial ocean facility · survive 7 waves',
    footstep: 'metal',
    ambience: { sample: 'amb_sea', bed: 'wind' },
    music: 'station',
    // pads over deep water: shooters hold their platform
    rangedLeash: true,
    background: new THREE.Color(0xdde8ee),
    heroLight: 0.16,
    skyFile: 'sky_narkina',
    proceduralSky,
    fog: new THREE.Fog(0xdde8ee, 80, 360),
    waterY: WATER_Y,
    playerStarts: [new THREE.Vector3(0, DECK_Y + 0.4, -46), new THREE.Vector3(3, DECK_Y + 0.4, -46)],
    groundSpawns: [
      new THREE.Vector3(0, DECK_Y + 0.3, 16), new THREE.Vector3(-16, DECK_Y + 0.3, 0),
      new THREE.Vector3(16, DECK_Y + 0.3, 0), new THREE.Vector3(0, DECK_Y + 0.3, -16),
      new THREE.Vector3(46, 7.3, 10), new THREE.Vector3(-46, 5.7, -6),
      new THREE.Vector3(8, 6.9, 54), new THREE.Vector3(0, DECK_Y + 0.3, -52),
    ],
    airSpawns: [
      new THREE.Vector3(0, 20, 0), new THREE.Vector3(-30, 18, 30), new THREE.Vector3(35, 22, -25),
    ],
  };

  board.update = (dt: number, time: number, game?: Game) => {
    // the sea breathes
    for (let i = 0; i < seaPos.count; i++) {
      const x = seaPos.getX(i), z = seaPos.getZ(i);
      seaPos.setY(i, Math.sin(x * 0.05 + time * 0.8) * 0.16 + Math.cos(z * 0.04 + time * 0.6) * 0.12);
    }
    seaPos.needsUpdate = true;

    // kelp sways
    for (let i = 0; i < kelp.length; i++) {
      kelp[i].rotation.x = Math.sin(time * 0.7 + i * 1.3) * 0.08;
      kelp[i].rotation.z = Math.cos(time * 0.55 + i * 0.9) * 0.1;
    }

    // the school circles the reef
    const fp = fishGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fishCount; i++) {
      const a = fishSeed[i * 2] + time * 0.12;
      const r = fishSeed[i * 2 + 1];
      const x = 55 + Math.cos(a) * r;
      const z = 70 + Math.sin(a) * r;
      fp.setXYZ(i, x, heightAt(x, z) + 3 + Math.sin(time * 1.4 + i) * 1.2, z);
    }
    fp.needsUpdate = true;

    // ---- floor-shock cycle ----
    // one clock for every plate: bolts re-strike together, which is what makes
    // the whole facility read as running off a single generator
    flickerT += dt;
    const struck = flickerT >= FLICKER;
    if (struck) flickerT = 0;
    for (const zn of zones) {
      const t = (time + zn.phase) % SHOCK_CYCLE;
      const mat = zn.plate.material as THREE.MeshBasicMaterial;
      const arcMat = zn.arcs.material as THREE.LineBasicMaterial;
      const sparkMat = zn.sparks.material as THREE.PointsMaterial;
      const charging = t >= 11 && t < 13.2;
      const live = t >= 13.2;
      if (charging) {
        // building: the sheet pulses up while the odd arc gropes across it
        const ramp = (t - 11) / 2.2;
        mat.opacity = (Math.sin(time * 12) * 0.5 + 0.5) * 0.08 + ramp * 0.2;
        setFieldVisible(zn, true);
        if (struck) restrike(zn, 0.12 + ramp * 0.3);
        arcMat.opacity = (0.25 + ramp * 0.45) * (0.6 + Math.random() * 0.4);
        sparkMat.opacity = ramp * 0.7;
        if (!zn.charged) { zn.charged = true; audio.floorCharge(0.4); }
      } else if (live) {
        // live: the sheet holds bright and the plate is webbed over, each
        // strike a fraction dimmer or brighter than the last so it never
        // settles into a steady glow
        mat.opacity = 0.4 + Math.sin(time * 30) * 0.07;
        setFieldVisible(zn, true);
        if (struck) restrike(zn, 0.75 + Math.random() * 0.25);
        arcMat.opacity = 0.75 + Math.random() * 0.25;
        sparkMat.opacity = 0.8 + Math.random() * 0.2;
        if (game) {
          const on = (px: number, py: number, pz: number): boolean =>
            Math.abs(px - zn.x) < zn.w / 2 && Math.abs(pz - zn.z) < zn.d / 2 &&
            py > zn.y - 0.4 && py < zn.y + 1.2;
          // shocks land in beats, synced to the flicker
          if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) {
            for (const p of game.players) {
              if (p.alive && on(p.position.x, p.position.y, p.position.z)) {
                p.damage(7, p.position.clone().setY(p.position.y - 1));
                game.particles.impactSparks(p.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 8);
              }
            }
            for (const e of game.enemies) {
              if (!e.alive || !on(e.position.x, e.position.y, e.position.z)) continue;
              e.damage(10, e.position.clone().setY(e.position.y - 1), -1);
              e.suppress(0.5);
              game.particles.impactSparks(e.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 6);
            }
          }
        }
      } else {
        // discharged: the sheet dies away and the arcs cut out at once
        mat.opacity = Math.max(0, mat.opacity - dt * 2);
        setFieldVisible(zn, false);
        zn.charged = false;
      }
    }
  };

  return board;
}
