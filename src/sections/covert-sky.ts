import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy } from '../enemies/enemy';
import type { Player } from '../player/player';
import type { StaticBox } from '../core/physics';
import { addBreakable, type Breakable } from '../world/board';
import { audio } from '../core/audio';
import { flightMove } from './kit/locomotion';
import { Interactions, type Interactable } from './kit/interact';
import { composeMoves } from './kit/moves';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Covert Sky (docs/LEVEL_SECTIONS.md §2.13) — the Great Forge, after Hold
 * the Forge, before the dome (stage C).
 *
 * The covert flies to war. The party starts where Hold the Forge left them,
 * at the foot of the forge's shaft with the Armorer's new boosters on, and
 * for this one beat the pack has no limit: they fly up the shaft into the
 * ruined city, down a line of rings across a kilometre of broken towers to
 * the dome, and dive through the breach into the glassed court.
 *
 * **The verb is flying** (K7 `flightMove`): A lifts and never runs dry, LB
 * boosts down the sight line, Y dives, and letting go glides. Everybody
 * flies — the super-jumpers are fitted with the same boosters. Landing works
 * everywhere, and walking a tower top is ordinary on-foot play.
 *
 * **The rings** are the golden path: each one flown through is a checkpoint
 * and a boost, and the party re-forms at the last one reached, already in
 * the air. **The flak towers** are the stops: three guns on tower tops throw
 * telegraphed air-bursts along the ring line (a red tracer climbs, a marker
 * swells where it will burst, then the burst), and each stands behind a
 * **flak screen** — a curtain of bursts across the whole sky — that throws
 * anyone who tries it back to the ring before. A gun is silenced by landing
 * on its roof and holding Y to plant a charge (3 s, exposed, the tower's
 * alamites in the way), or by two rockets into its breech. **Drones** come in
 * pairs as the party passes rings: they are the dogfight.
 *
 * **Escalation**: the climb out (no fight — learn to fly), the first gun
 * alone, the second held by alamites, the third on the dome's approach with
 * alamites and drones together. Its screen is the one across the breach, so
 * the last gun is the key to the dome, and the dive through the breach is
 * the finish.
 *
 * **The edges**: the ruin ridge to either side, the ceiling above, and the
 * cloud deck over the lower city. Anyone who sinks below the rooftops is
 * caught by the updraft and thrown back up at the last ring — the stage's
 * off-path rule, explained by a banner the first time and every time.
 */

/** the shaft: radius, and how far below the city it starts */
const SR = 9;
const SHAFT = 44;
/** the flying volume: half-width and length */
const HALF_W = 80;
const LEN = 1180;
/** above the city floor (G): the cloud deck, the updraft line, the lid */
const DECK = 10;
const UPDRAFT = 8;
const LID = 88;
const RING_R = 7;
/** the dome: its centre (relative to G) and radius */
const DOME = { y: -40, z: 1300, r: 170 };
/** a flak burst's reach and bite */
const BURST_R = 6.5;
const BURST_DMG = 26;
/** seconds from a flak shot to its burst */
const FLAK_FLIGHT = 1.4;
/** a flak screen stands this far past its tower */
const SCREEN_AHEAD = 45;

/**
 * A box's geometry in world space with its UVs in metres over `scale`, so a
 * texture keeps one density across a four-metre crown and a hundred-metre
 * spire once they are merged into one mesh.
 */
function worldBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, scale: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (Math.abs(nor.getX(i)) > 0.5) uv.setXY(i, z / scale, y / scale);
    else if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, x / scale, z / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  return g;
}

/** a small seeded random, so the city is the same city every time */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** distance from p to the segment ab, in the ground plane */
function segDistXZ(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / L));
  return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
}

interface Tower {
  x: number; z: number; w: number; d: number; top: number;
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const G = Y0 + SHAFT;
  const T = TEXT.sections['covert-sky'];
  const party = Math.max(1, game.players.length);
  const solo = party === 1;
  const geo = <Gm extends THREE.BufferGeometry>(g: Gm): Gm => ctx.own(g);

  // ---- materials ----
  const relief = ctx.paint(spec.palette.wall, { rough: 0.9, metal: 0.05 });
  ctx.tile(relief, 'forge_relief', 8, 3, { normal: true });
  relief.side = THREE.DoubleSide;
  const ruin = ctx.paint(0x5d6660, { rough: 0.92, metal: 0.05 });
  ctx.tile(ruin, 'cliff_ruin', 1, 1, { normal: true });
  ctx.tile(ruin, 'ruin_tower', 1, 1, { normal: true });
  const ridgeMat = ctx.paint(spec.palette.rock, { rough: 0.95 });
  ctx.tile(ridgeMat, 'cliff_ruin', 1, 1, { normal: true });
  const roofMat = ctx.paint(spec.palette.floor, { rough: 0.85 });
  ctx.tile(roofMat, 'glass_plain', 1, 1);
  const iron = ctx.paint(0x3a3632, { rough: 0.55, metal: 0.75 });
  // Glass fused by the heat of the glassing: not a pane, a sheen — a muted
  // green-grey glaze where the stone slumped and ran, darker than the sky
  const glass = new THREE.MeshStandardMaterial({
    color: 0x55655d, emissive: 0x10241b, emissiveIntensity: 0.6, roughness: 0.14, metalness: 0.85,
  });
  // the empty window bays: deep shadow, never pitch black
  const bayMat = new THREE.MeshStandardMaterial({ color: 0x151a18, roughness: 1, metalness: 0 });
  ctx.own(bayMat);
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  const deckMat = new THREE.MeshBasicMaterial({ color: 0xb4bab2, transparent: true, opacity: 0.3, depthWrite: false });
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x8d948f, roughness: 0.45, metalness: 0.7, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false,
  });
  const ribMat = new THREE.MeshBasicMaterial({ color: 0x4a504c, wireframe: true, transparent: true, opacity: 0.35 });
  const breachMat = new THREE.MeshBasicMaterial({ color: 0x0a0806, side: THREE.DoubleSide });
  for (const m of [glass, emberMat, deckMat, domeMat, ribMat, breachMat]) ctx.own(m);

  // ---- the shaft: where Hold the Forge left the party ----
  // The forge's dais at the foot, its brazier still glowing, and the round
  // shaft rising to a coin of sky.
  ctx.box(0, Y0 - 1, 0, SR * 2 + 6, 2, SR * 2 + 6, ctx.paint(spec.palette.floor, { rough: 0.85 }));
  ctx.cyl(0, Y0 + 0.5, 0, 6.5, 1.0, ctx.paint(0x5a5f58, { rough: 0.7, metal: 0.25 }));
  ctx.prop('forge_brazier', new THREE.Vector3(0, Y0 + 1, 0), {
    size: 3.5, solid: { r: 1.6, h: 1.6 },
    fallback: () => {
      const g = new THREE.Group();
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.2, 1.4, 20), iron);
      basin.position.y = 0.7;
      const coals = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.2, 20), emberMat);
      coals.position.y = 1.35;
      g.add(basin, coals);
      return g;
    },
  });
  const forgeGlow = new THREE.PointLight(0xff8a3a, 50, 30, 1.4);
  forgeGlow.position.set(0, Y0 + 4, 0);
  ctx.mesh(forgeGlow);
  const shaftMesh = new THREE.Mesh(geo(new THREE.CylinderGeometry(SR + 0.3, SR + 0.3, SHAFT, 36, 1, true)), relief);
  shaftMesh.position.set(0, Y0 + SHAFT / 2, 0);
  ctx.mesh(shaftMesh);
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    ctx.cyl(Math.sin(a) * (SR + 2), Y0 + SHAFT / 2, Math.cos(a) * (SR + 2), 2.2, SHAFT, null);
  }
  // the shaft's mouth: a broken well-head in a plaza of rubble at the city floor
  const lip = new THREE.Mesh(geo(new THREE.TorusGeometry(SR + 1, 1.2, 8, 36)), ruin);
  lip.rotation.x = Math.PI / 2;
  lip.position.set(0, G + 0.4, 0);
  ctx.mesh(lip);

  // ---- the ring line and the flak towers ----
  const ringAt = (x: number, dy: number, z: number) => new THREE.Vector3(x, G + dy, z);
  const ringPos = [
    ringAt(0, 20, 34), ringAt(-10, 36, 150), ringAt(14, 45, 250),
    ringAt(4, 50, 420), ringAt(-20, 40, 520), ringAt(10, 55, 590),
    ringAt(0, 60, 740), ringAt(-16, 42, 830), ringAt(10, 55, 905),
    ringAt(0, 50, 1060),
  ];
  // the breach, on the dome's face: the last ring, and the way in
  const breachZ = 1150;
  const breachY = G + DOME.y + Math.sqrt(DOME.r * DOME.r - (DOME.z - breachZ) ** 2);
  const breachAt = new THREE.Vector3(0, breachY, breachZ);
  const flakSpec = [
    { x: -26, z: 320, top: 44, after: 2 },
    { x: 30, z: 650, top: 52, after: 5 },
    { x: -12, z: 975, top: 56, after: 8 },
  ];

  // the golden path, for the city builder to keep clear and for the walker
  const line: THREE.Vector3[] = [new THREE.Vector3(0, G + 12, 0)];
  ringPos.forEach((r, i) => {
    line.push(r);
    const f = flakSpec.find((t) => t.after === i);
    if (f) line.push(new THREE.Vector3(f.x, G + f.top, f.z));
  });
  line.push(breachAt);

  // ---- the city: broken towers, arches and rib-bridges ----
  const towers: Tower[] = [];
  const rand = rng(0xf0493);
  const clearOfLine = (x: number, z: number, half: number, top: number): boolean => {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i], b = line[i + 1];
      const d = segDistXZ(x, z, a, b);
      const low = Math.min(a.y, b.y) - 14;
      if (d < half + 13 && top > low) return false;
    }
    return Math.hypot(x, z) > SR + half + 8;
  };
  // The city is hundreds of boxes: each stands its own collider, and what is
  // seen is merged into one mesh per material at the end (`mergeCity`).
  const cityParts = {
    ruin: [] as THREE.BufferGeometry[], roof: [] as THREE.BufferGeometry[], ridge: [] as THREE.BufferGeometry[],
    glass: [] as THREE.BufferGeometry[], bay: [] as THREE.BufferGeometry[],
  };
  const solid = (kind: keyof typeof cityParts, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, collide = true): void => {
    if (collide) ctx.box(cx, cy, cz, sx, sy, sz, null);
    cityParts[kind].push(worldBox(cx, cy, cz, sx, sy, sz, kind === 'roof' ? 6 : kind === 'glass' ? 5 : 14));
  };
  /**
   * Window bays in rows up a face: dark recesses, a few missing where the
   * wall has fallen in. `nx`/`nz` is the face's outward normal (one of ±x, −z).
   */
  const bays = (cx: number, cz: number, halfAcross: number, halfOut: number, nx: number, nz: number,
    from: number, to: number, r: () => number, skip = 0.22): void => {
    for (let y = from; y + 3.8 < to; y += 6.5) {
      for (let a = -halfAcross + 2.2; a < halfAcross - 1.6; a += 4.2) {
        if (r() < skip) continue;
        const px = cx + nx * (halfOut + 0.05) + (nz !== 0 ? a : 0);
        const pz = cz + nz * (halfOut + 0.05) + (nx !== 0 ? a : 0);
        solid('bay', px, y + 1.8, pz, nx !== 0 ? 0.3 : 2.2, 3.6, nz !== 0 ? 0.3 : 2.2, false);
      }
    }
  };
  /** the slumped foot of a tower: glass run down over the stone just above the cloud */
  const skirt = (cx: number, cz: number, w: number, d: number, r: () => number): void => {
    const h = 3 + r() * 6;
    solid('glass', cx, G + DECK - 2 + h / 2, cz, w + 3.8, h, d + 3.8, false);
    // and a lip where the run pooled
    solid('glass', cx, G + DECK - 1.6, cz, w + 5, 0.8, d + 5, false);
  };
  const addTower = (t: Tower, opts: { plain?: boolean } = {}, r: () => number = rand): void => {
    const base = G - 30;
    // a broken crown: a narrower tier on three of four quarters, one fallen
    const tier = !opts.plain && t.top - G > 34 && r() < 0.75 ? 4 + r() * 4 : 0;
    const shoulder = t.top - tier;
    solid('ruin', t.x, (base + shoulder) / 2, t.z, t.w, shoulder - base, t.d);
    // a broader podium under the shaft, with a set-back ledge: the old
    // street storeys, which the silhouette steps out to
    if (!opts.plain && shoulder - G > 30) {
      const podTop = G + DECK + 6 + r() * 14;
      solid('ruin', t.x, (base + podTop) / 2, t.z, t.w + 3, podTop - base, t.d + 3);
      solid('roof', t.x, podTop + 0.2, t.z, t.w + 2.6, 0.4, t.d + 2.6);
    }
    solid('roof', t.x, shoulder + 0.25, t.z, t.w - 0.6, 0.5, t.d - 0.6);
    if (tier) {
      const qw = t.w * 0.36, qd = t.d * 0.36;
      const gone = Math.floor(r() * 4);
      for (let q = 0; q < 4; q++) {
        const qx = t.x + (q % 2 ? 1 : -1) * qw / 2, qz = t.z + (q < 2 ? -1 : 1) * qd / 2;
        if (q === gone) {
          // where it fell, the stone ran: a low glassy mound
          solid('glass', qx, shoulder + 0.6, qz, qw, 1.2, qd, false);
          continue;
        }
        const h = tier * (q === (gone + 2) % 4 ? 1 : 0.55 + r() * 0.45);
        solid('ruin', qx, shoulder + h / 2, qz, qw, h, qd);
        solid('roof', qx, shoulder + h + 0.2, qz, qw - 0.4, 0.4, qd - 0.4);
      }
    } else if (!opts.plain) {
      // stubs of the storey that was: broken piers at the corners
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const sx = (k % 2 ? 1 : -1) * (t.w / 2 - 0.8), sz = (k < 2 ? -1 : 1) * (t.d / 2 - 0.8);
        const h = 2 + r() * 6;
        solid('ruin', t.x + sx, t.top + h / 2, t.z + sz, 1.4, h, 1.4);
      }
    }
    // window bays on the faces toward the approach and the middle of the city
    const from = G + DECK + 6;
    bays(t.x, t.z, t.w / 2, t.d / 2, 0, -1, from, shoulder - 2, r);
    const side = t.x > 0 ? -1 : 1;
    bays(t.x, t.z, t.d / 2, t.w / 2, side, 0, from, shoulder - 2, r);
    skirt(t.x, t.z, t.w, t.d, r);
    towers.push({ ...t, top: t.top });
  };
  for (let z = 70; z < 1130; z += 38) {
    for (let k = 0; k < 4; k++) {
      const w = 8 + rand() * 12, d = 8 + rand() * 12;
      const x = -HALF_W + 8 + rand() * (HALF_W * 2 - 16);
      const zz = z + (rand() - 0.5) * 30;
      const top = G + 18 + rand() * 58;
      // room for the broken piers over the top
      if (!clearOfLine(x, zz, Math.max(w, d) / 2, top + 8)) continue;
      if (flakSpec.some((f) => Math.hypot(f.x - x, f.z - zz) < 22)) continue;
      if (towers.some((o) => Math.abs(o.x - x) < (o.w + w) / 2 + 3 && Math.abs(o.z - zz) < (o.d + d) / 2 + 3)) continue;
      addTower({ x, z: zz, w, d, top });
    }
  }
  // rib-bridges between neighbours of a height, each over a broken arch
  const arches: THREE.Mesh[] = [];
  const bridged = new Set<number>();
  for (let i = 0; i < towers.length; i++) {
    if (bridged.has(i)) continue;
    for (let j = i + 1; j < towers.length; j++) {
      const a = towers[i], b = towers[j];
      const span = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
      if (Math.abs(a.z - b.z) > 8 || span < 6 || span > 28) continue;
      const y = Math.min(a.top, b.top) - 9;
      if (y < G + DECK + 12) continue;
      const mid = new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      if (!clearOfLine(mid.x, mid.z, Math.abs(a.x - b.x) / 2, y + 2)) continue;
      solid('ruin', mid.x, y, mid.z, Math.abs(a.x - b.x), 1.6, 3);
      const arch = new THREE.Mesh(geo(new THREE.TorusGeometry(span / 2, 0.9, 6, 16, Math.PI)), ruin);
      arch.position.set(mid.x, y - 0.8, mid.z);
      arch.rotation.x = Math.PI;
      ctx.mesh(arch);
      arches.push(arch);
      bridged.add(i); bridged.add(j);
      break;
    }
  }
  // The ruin ridge either side and behind: the edges of the sky. A chain of
  // the city's tallest spires shoulder to shoulder, every one of them over
  // the lid, so the edge is a broken skyline and never a sheet of wall.
  const ridgeRand = rng(0x5eed);
  const spire = (cx: number, cz: number, sx: number, sz: number, top: number): void => {
    solid('ridge', cx, (G - 30 + top) / 2, cz, sx, top - (G - 30), sz);
    // a stepped crown, so the tops are not one flat line (over the lid: seen, never met)
    solid('ridge', cx, top + 4, cz, sx * 0.6, 8, sz * 0.6, false);
    // the inner face: bays, and here and there the glassed foot
    if (Math.abs(cx) > HALF_W) {
      bays(cx, cz, sz / 2, sx / 2, -Math.sign(cx), 0, G + DECK + 8, G + LID - 6, ridgeRand, 0.6);
      if (ridgeRand() < 0.4) skirt(cx, cz, sx, sz, ridgeRand);
    } else bays(cx, cz, sx / 2, sz / 2, 0, 1, G + DECK + 8, G + LID - 6, ridgeRand, 0.6);
  };
  for (const sd of [-1, 1]) {
    for (let z = -30; z < LEN + 60;) {
      const len = 12 + ridgeRand() * 16;
      const depth = 14 + ridgeRand() * 14;
      // staggered back from the edge, so each spire throws its own shadow line
      const back = ridgeRand() < 0.5 ? 0 : 3 + ridgeRand() * 7;
      spire(sd * (HALF_W + back + depth / 2), z + len / 2, depth, len + 0.5, G + LID + 2 + ridgeRand() * 34);
      if (back > 0) solid('ridge', sd * (HALF_W + depth / 2), G + DECK + 6, z + len / 2, depth, 20, len + 0.5);
      z += len;
    }
  }
  for (let x = -HALF_W; x < HALF_W;) {
    const w = 12 + ridgeRand() * 14;
    spire(x + w / 2, -24 - 6, w + 0.5, 12, G + LID + 2 + ridgeRand() * 30);
    x += w;
  }
  // the cloud deck over the lower city: the rooftops' floor, as far as the eye knows
  for (const [dy, op] of [[DECK - 4, 0.22], [DECK, 0.3]] as const) {
    const m = deckMat.clone();
    m.opacity = op;
    ctx.own(m);
    const deck = new THREE.Mesh(geo(new THREE.PlaneGeometry(HALF_W * 2 + 20, LEN + 80)), m);
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, G + dy, LEN / 2);
    ctx.mesh(deck);
  }
  // a hole in the deck round the shaft's mouth, so the way up is not fogged over
  // (the decks are drawn after the shaft and depth-write off, so they only haze)

  // ---- the dome, and the breach in it ----
  const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(DOME.r, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2)), domeMat);
  dome.position.set(0, G + DOME.y, DOME.z);
  ctx.mesh(dome);
  const ribs = new THREE.Mesh(geo(new THREE.SphereGeometry(DOME.r + 0.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2)), ribMat);
  ribs.position.copy(dome.position);
  ctx.mesh(ribs);
  const normal = breachAt.clone().sub(dome.position).normalize();
  const hole = new THREE.Mesh(geo(new THREE.CircleGeometry(15, 9)), breachMat);
  hole.position.copy(breachAt).addScaledVector(normal, 0.6);
  hole.lookAt(breachAt.clone().addScaledVector(normal, 10));
  ctx.mesh(hole);
  // jagged shards round the hole
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const shard = new THREE.Mesh(geo(new THREE.ConeGeometry(1.4, 6 + (i % 3) * 3, 4)), iron);
    shard.position.set(Math.cos(a) * 15, Math.sin(a) * 15, 0);
    shard.rotation.z = a - Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(shard);
    holder.position.copy(hole.position);
    holder.quaternion.copy(hole.quaternion);
    ctx.mesh(holder);
  }
  const courtGlow = new THREE.PointLight(0xffc070, 60, 60, 1.2);
  courtGlow.position.copy(breachAt).addScaledVector(normal, -12);
  ctx.mesh(courtGlow);

  // ---- rings ----
  const ringGeo = geo(new THREE.TorusGeometry(RING_R, 0.38, 8, 48));
  const breachRingGeo = geo(new THREE.TorusGeometry(13, 0.6, 8, 56));
  const allRings = [...ringPos, breachAt];
  const rings = allRings.map((pos, i) => {
    const next = allRings[i + 1] ?? pos.clone().add(new THREE.Vector3(0, 0, 10));
    const prev = i === 0 ? new THREE.Vector3(0, G, 0) : allRings[i - 1];
    const last = i === allRings.length - 1;
    const n = last ? normal.clone().negate() : next.clone().sub(prev).setY(0).normalize();
    const m = new THREE.MeshBasicMaterial({
      color: last ? 0xffc860 : 0x5affa8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    ctx.own(m);
    const mesh = new THREE.Mesh(last ? breachRingGeo : ringGeo, m);
    mesh.position.copy(pos);
    mesh.lookAt(pos.clone().add(n));
    ctx.mesh(mesh);
    return { pos, n, mesh, mat: m, r: last ? 13 : RING_R, last };
  });

  // ---- the flak towers ----
  const interactions = new Interactions();
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff3a22, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  ctx.own(redMat);
  type Flak = {
    i: number; at: THREE.Vector3; gun: THREE.Group; model: THREE.Group; alive: boolean; charged: boolean;
    fuse: number; cd: number; rockets: number; breech: Breakable; screen: THREE.Mesh; screenZ: number;
    it: Interactable; guards: Enemy[]; socket: THREE.Vector3; box: StaticBox;
    /** the stand-in's turning parts, driven until the sculpt's own `yaw`/`pitch` nodes land */
    yaw: THREE.Object3D; pitch: THREE.Object3D; lamp: THREE.Mesh;
  };
  // Built to its sheet (reference/props/flak_tower_ref.png, docs/ASSETS_MODELS.md):
  // 6.7 × 6.0 × 3.3 m, scaled by the 6 m slab. A round rubble slab 0.9 m
  // thick with sandbags and crates round its rim; the turret on a turntable in
  // the middle, twin barrels level 2.4 m up reaching 0.7 m past the slab's
  // edge; a sensor dish at the back. Pivot at the slab's underside centre.
  const SLAB = { r: 3, t: 0.9 };
  const BARREL_Y = 2.4;
  const stone = ctx.paint(0x8a8a82, { rough: 0.95 });
  ctx.tile(stone, 'cliff_ruin', 1, 0.3, { normal: true });
  const sand = ctx.paint(0x8f7d5a, { rough: 1 });
  const olive = ctx.paint(0x4d5a3a, { rough: 0.8, metal: 0.2 });
  const steel = ctx.paint(0x6c7075, { rough: 0.5, metal: 0.8 });
  const lampOff = new THREE.MeshBasicMaterial({ color: 0x5a1a12 });
  ctx.own(lampOff);
  const lampOn = new THREE.MeshBasicMaterial({ color: 0xff3a22 });
  ctx.own(lampOn);
  const buildFlak = (): { gun: THREE.Group; yaw: THREE.Group; pitch: THREE.Group; lamp: THREE.Mesh } => {
    const gun = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(SLAB.r, SLAB.r * 1.02, SLAB.t, 28), stone);
    slab.position.y = SLAB.t / 2;
    gun.add(slab);
    // sandbag arcs and ammunition crates round the rim, clear of the socket side
    for (const [a0, n] of [[0.6, 5], [2.2, 4], [3.6, 5], [5.2, 3]] as const) {
      for (let k = 0; k < n; k++) {
        const a = a0 + k * 0.17;
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.26, 0.32), sand);
        bag.position.set(Math.sin(a) * 2.6, SLAB.t + 0.13 + (k % 2) * 0.22, Math.cos(a) * 2.6);
        bag.rotation.y = a + Math.PI / 2;
        gun.add(bag);
      }
    }
    for (const a of [1.4, 4.4]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.4), olive);
      crate.position.set(Math.sin(a) * 2.2, SLAB.t + 0.19, Math.cos(a) * 2.2);
      crate.rotation.y = a;
      gun.add(crate);
    }
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.45, 0.45, 24), steel);
    table.position.y = SLAB.t + 0.225;
    gun.add(table);
    // the turret turns on the table (`yaw`), the barrels lift in it (`pitch`)
    const yaw = new THREE.Group();
    yaw.position.y = SLAB.t + 0.45;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.5, 20), steel);
    drum.position.y = 0.25;
    const house = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.4), iron);
    house.position.set(0, 0.5 + 0.5, -0.1);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), steel);
    mast.position.set(0.8, 1.5, -0.55);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.1, 0.1, 14), steel);
    dish.rotation.x = Math.PI / 2 - 0.3;
    dish.position.set(0.8, 1.95 - 0.02, -0.5);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lampOff);
    lamp.position.set(0, 1.1, -0.82);
    yaw.add(drum, house, mast, dish, lamp);
    const pitch = new THREE.Group();
    pitch.position.set(0, BARREL_Y - (SLAB.t + 0.45), 0.55);
    for (const sx of [-0.22, 0.22]) {
      const reach = SLAB.r + 0.7 - 0.55;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, reach, 10), steel);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(sx, 0, reach / 2);
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 10), iron);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(sx, 0, reach - 0.15);
      pitch.add(barrel, brake);
    }
    yaw.add(pitch);
    gun.add(yaw);
    return { gun, yaw, pitch, lamp };
  };
  const flaks: Flak[] = flakSpec.map((f, i) => {
    const top = G + f.top;
    addTower({ x: f.x, z: f.z, w: 16, d: 16, top }, { plain: true });
    // the pivot: the slab's underside, on the tower's roof
    const at = new THREE.Vector3(f.x, top + 0.5, f.z);
    const parts = buildFlak();
    const model = ctx.prop('flak_tower', at, { size: 6, fallback: () => parts.gun });
    // the slab is the landing surface; the turret is the breech the rockets want
    ctx.box(at.x, at.y + SLAB.t / 2, at.z, SLAB.r * 2, SLAB.t, SLAB.r * 2, null);
    const { box } = ctx.box(at.x, at.y + SLAB.t + 1.0, at.z, 1.8, 2.0, 1.8, null);
    // the breech: rockets dent it, bolts do not (see `update`)
    const breech = addBreakable(game.board, parts.gun, box, 1000, { radius: 2.4 });
    const screenZ = f.z + SCREEN_AHEAD;
    const screen = new THREE.Mesh(geo(new THREE.PlaneGeometry(HALF_W * 2, LID + 20)), redMat);
    screen.position.set(0, G + (LID + 20) / 2 - 10, screenZ);
    ctx.mesh(screen);
    // where the charge is planted: on the slab at the turret's back, clear of the sandbags
    const socket = new THREE.Vector3(at.x + 1.5, at.y + SLAB.t, at.z - 1.6);
    const plate = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16)), new THREE.MeshBasicMaterial({ color: spec.palette.accent }));
    ctx.own(plate.material as THREE.Material);
    plate.position.copy(socket).setY(socket.y + 0.02);
    ctx.mesh(plate);
    const flak: Flak = {
      i, at, gun: parts.gun, model, alive: true, charged: false, fuse: 0, cd: 3 + i, rockets: 0, breech,
      screen, screenZ, it: null as unknown as Interactable, guards: [], socket, box,
      yaw: parts.yaw, pitch: parts.pitch, lamp: parts.lamp,
    };
    flak.it = interactions.add({
      pos: socket, hold: 3, radius: 3, verb: T.flakVerb,
      enabled: () => flak.alive && !flak.charged,
      onDone: () => {
        flak.charged = true;
        flak.fuse = 2.5;
        ctx.announce(T.charged, T.flakVerb);
      },
    });
    return flak;
  });
  /** the part to turn: the sculpt's named node once it has landed, the stand-in's until then */
  const node = (f: Flak, name: 'yaw' | 'pitch'): THREE.Object3D =>
    f.model.getObjectByName(name) ?? (name === 'yaw' ? f.yaw : f.pitch);

  // ---- the city, drawn: one mesh per material ----
  for (const [kind, mat, shadow] of [['ruin', ruin, true], ['roof', roofMat, false], ['ridge', ridgeMat, false],
    ['glass', glass, false], ['bay', bayMat, false]] as const) {
    const parts = cityParts[kind];
    if (!parts.length) continue;
    const merged = geo(mergeGeometries(parts, false));
    for (const g of parts) g.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    ctx.mesh(mesh);
  }

  // ---- flak shells: a tracer climbs, a marker swells, the burst ----
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const markMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true });
  const burstMat = new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x2a2624, transparent: true, opacity: 0.5, depthWrite: false });
  for (const m of [shellMat, markMat, burstMat, smokeMat]) ctx.own(m);
  const sphere = geo(new THREE.SphereGeometry(1, 12, 8));
  type Shell = { from: THREE.Vector3; to: THREE.Vector3; t: number; tracer: THREE.Mesh; mark: THREE.Mesh; boom: number; burst: THREE.Mesh; smoke: THREE.Mesh; live: boolean };
  const shells: Shell[] = Array.from({ length: 10 }, () => {
    const tracer = ctx.mesh(new THREE.Mesh(sphere, shellMat));
    const mark = ctx.mesh(new THREE.Mesh(sphere, markMat));
    const burst = ctx.mesh(new THREE.Mesh(sphere, burstMat));
    const smoke = ctx.mesh(new THREE.Mesh(sphere, smokeMat.clone()));
    ctx.own(smoke.material as THREE.Material);
    for (const m of [tracer, mark, burst, smoke]) m.visible = false;
    return { from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, tracer, mark, boom: -1, burst, smoke, live: false };
  });
  const fire = (from: THREE.Vector3, to: THREE.Vector3): void => {
    const s = shells.find((x) => !x.live && x.boom < 0);
    if (!s) return;
    s.live = true;
    s.t = 0;
    s.from.copy(from);
    s.to.copy(to);
    s.tracer.visible = true;
    s.mark.visible = true;
    s.mark.position.copy(to);
  };
  const burstAt = (s: Shell): void => {
    s.live = false;
    s.tracer.visible = false;
    s.mark.visible = false;
    s.boom = 0;
    s.burst.position.copy(s.to);
    s.smoke.position.copy(s.to);
    s.burst.visible = true;
    s.smoke.visible = true;
    for (const p of game.players) {
      if (!p.alive) continue;
      const d = p.position.distanceTo(s.to);
      if (d < BURST_R) p.damage(BURST_DMG * (1 - 0.5 * d / BURST_R), s.to);
    }
    if (game.players.some((p) => p.position.distanceTo(s.to) < 60)) audio.explosion();
  };

  // ---- the flight ----
  const flight = flightMove({ topSpeed: 21, boostSpeed: 34 });

  // ---- state ----
  let started = false;
  let t = 0;
  let taught = false;
  /** the furthest ring flown through by anyone (-1: still in the shaft) */
  let reached = -1;
  let complete = false;
  /** the updraft's and the flak screen's banners, each on its own clock */
  let catchNote = 0;
  let screenNote = 0;
  let breachOpen = false;
  const prev = new Map<number, THREE.Vector3>();
  const dronesSent = new Set<number>();
  const cursors = [0, 0, 0, 0];

  const nextRing = () => Math.min(reached + 1, rings.length - 1);
  /** the first living gun, which is the one whose screen is next */
  const liveFlak = () => flaks.find((f) => f.alive) ?? null;
  const ringBlocked = (i: number): boolean => {
    const f = liveFlak();
    return !!f && rings[i].pos.z > f.screenZ;
  };
  const airSpot = (i: number, slot: number): THREE.Vector3 => {
    if (i < 0) return ctx.defaultRespawn(slot, new THREE.Vector3(0, Y0 + 1, -4.5));
    const r = rings[i];
    const side = new THREE.Vector3(r.n.z, 0, -r.n.x);
    return r.pos.clone().addScaledVector(r.n, 6).addScaledVector(side, (slot % 2 ? 1.5 : -1.5) * Math.ceil(slot / 2))
      .setY(r.pos.y + Math.floor(slot / 2) * 1.5);
  };

  const sendDrones = (i: number): void => {
    if (dronesSent.has(i)) return;
    dronesSent.add(i);
    const alive = game.enemies.filter((e) => e.alive && e.kind === 'drone').length;
    if (alive >= 2 + party) return;
    const ahead = rings[Math.min(i + 1, rings.length - 1)].pos;
    for (const s of [-1, 1]) {
      const at = ahead.clone().add(new THREE.Vector3(s * 12, 10, 15));
      ctx.spawn('drone', at, { exact: true, alert: true, squad: 8870 + i });
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    t += dt;
    if (!started) {
      started = true;
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
        }, flight);
      }
      // the towers' alamites, holding the landings
      flaks.forEach((f, i) => {
        const n = Math.min(6, (solo ? 1 : 2) + i + Math.floor(party / 2));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          f.guards.push(ctx.spawn('alamite', new THREE.Vector3(f.at.x + Math.cos(a) * 5, f.at.y, f.at.z + Math.sin(a) * 5),
            { exact: true, squad: 8860 + i }));
        }
      });
      for (let i = 0; i < party; i++) {
        const f = flaks[i % flaks.length];
        ctx.pickup(new THREE.Vector3(f.at.x - 4, f.at.y, f.at.z + 4));
      }
    }
    if (!taught && t > 2.5) {
      taught = true;
      ctx.announce(T.teachTitle, T.teach);
    }
    interactions.update(dt, game);

    // rings: flown through is a checkpoint and a boost
    for (const p of game.players) {
      const was = prev.get(p.slot) ?? p.position.clone();
      if (p.alive) {
        for (let i = 0; i < rings.length; i++) {
          const r = rings[i];
          const s0 = was.clone().sub(r.pos).dot(r.n);
          const s1 = p.position.clone().sub(r.pos).dot(r.n);
          if (!(s0 < 0 && s1 >= 0)) continue;
          const off = p.position.clone().sub(r.pos);
          off.addScaledVector(r.n, -off.dot(r.n));
          if (off.length() > r.r + 0.6) continue;
          if (r.last) {
            if (breachOpen) complete = true;
            continue;
          }
          if (ringBlocked(i)) continue;
          flight.boost(p, r.n.clone().setY(0.08), 32, 0.6);
          audio.dash();
          if (i > reached) {
            reached = i;
            ctx.checkpoint.copy(r.pos);
            ctx.announce(T.rings(i + 1, rings.length - 1), TEXT.banners.checkpoint);
            if (i >= 1) sendDrones(i);
          }
        }
      }
      prev.set(p.slot, p.position.clone());
    }

    // the updraft: below the rooftops the city throws you back up
    catchNote -= dt;
    screenNote -= dt;
    for (const p of game.players) {
      if (!p.alive) continue;
      const inShaft = Math.hypot(p.position.x, p.position.z) < SR + 3 && p.position.y < G + UPDRAFT + 4;
      if (inShaft || p.position.y >= G + UPDRAFT) continue;
      p.position.copy(airSpot(Math.max(0, reached), p.slot));
      p.velocity.set(0, 7, 0);
      game.particles.dustPuff(p.position, 10);
      if (catchNote <= 0) { catchNote = 4; ctx.announce(T.updraft, T.updraftSub); }
    }

    // the dome is solid, all but the breach: the way in is the hole, once it is open
    for (const p of game.players) {
      if (!p.alive) continue;
      const v = p.position.clone().sub(dome.position);
      const d = v.length();
      if (d >= DOME.r + 0.6 || v.y < 0) continue;
      if (breachOpen && p.position.distanceTo(breachAt) < 15) { complete = true; continue; }
      v.normalize();
      p.position.copy(dome.position).addScaledVector(v, DOME.r + 0.6);
      const into = p.velocity.dot(v);
      if (into < 0) p.velocity.addScaledVector(v, -into);
    }

    // the flak screens: no way past a live gun
    for (const f of flaks) {
      const m = f.screen.material as THREE.MeshBasicMaterial;
      if (!f.alive) {
        f.screen.visible = m.opacity > 0.01;
        m.opacity = Math.max(0, m.opacity - dt * 0.1);
        continue;
      }
      f.screen.visible = true;
      for (const p of game.players) {
        if (!p.alive || p.position.z < f.screenZ) continue;
        p.damage(18, p.position.clone().setZ(f.screenZ));
        p.position.copy(airSpot(Math.min(reached, flakSpec[f.i].after), p.slot));
        p.velocity.set(0, 4, -6);
        if (screenNote <= 0) { screenNote = 4; ctx.announce(T.screen, T.screenSub); }
      }
      // the screen's own bursts, so it reads as fire and not a pane
      if (Math.random() < dt * 4) {
        const s = shells.find((x) => !x.live && x.boom < 0);
        const near = game.players.find((p) => p.alive && Math.abs(p.position.z - f.screenZ) < 120);
        if (s && near) {
          s.to.set((Math.random() - 0.5) * HALF_W * 1.8, G + 15 + Math.random() * (LID - 20), f.screenZ);
          s.boom = 0;
          s.burst.position.copy(s.to);
          s.smoke.position.copy(s.to);
          s.burst.visible = s.smoke.visible = true;
        }
      }
    }

    // the guns: aim, fire, and die
    for (const f of flaks) {
      if (!f.alive) continue;
      // rockets dent the breech, bolts do not: anything short of a blast is healed
      const hit = f.breech.maxHp - f.breech.hp;
      if (hit >= 40) {
        f.rockets++;
        game.particles.impactSparks(f.at.clone().setY(f.at.y + 2), 16);
      }
      f.breech.hp = f.breech.maxHp;
      if (f.charged) {
        f.fuse -= dt;
        // the charge's lamp blinks faster as the fuse runs down
        f.lamp.material = Math.sin(t * (10 + (2.5 - f.fuse) * 12)) > 0 ? lampOn : lampOff;
        if (f.fuse <= 0) f.rockets = 2;
      }
      if (f.rockets >= 2) {
        f.alive = false;
        f.breech.broken = true;
        game.board.breakables = (game.board.breakables ?? []).filter((b) => b !== f.breech);
        ctx.unsolid({ box: f.box });
        const boom = f.at.clone().setY(f.at.y + SLAB.t + 1.2);
        game.particles.explosion(boom, 2.2);
        audio.explosion();
        for (const p of game.players) {
          const d = p.position.distanceTo(boom);
          if (p.alive && d < 5) p.damage(20 * (1 - d / 5), boom);
        }
        // the dead gun: slumped on its mount, barrels down
        node(f, 'pitch').rotation.x = 0.5;
        node(f, 'yaw').rotation.z = 0.25;
        f.lamp.material = lampOff;
        for (const e of f.guards) if (e.alive) e.alert(boom, true);
        const last = flaks.every((x) => !x.alive);
        if (last) { breachOpen = true; ctx.announce(T.breachOpen, T.breachOpenSub); }
        else ctx.announce(T.flakDown, T.flakDownSub);
        continue;
      }
      // pick someone approaching, in range, not standing on the roof
      f.cd -= dt;
      let target: Player | null = null;
      let best = 170;
      for (const p of game.players) {
        if (!p.alive || p.position.z > f.screenZ) continue;
        const d = p.position.distanceTo(f.at);
        if (d < 14 || d > best) continue;
        best = d; target = p;
      }
      if (target) {
        const dx = target.position.x - f.at.x, dz = target.position.z - f.at.z;
        node(f, 'yaw').rotation.y = Math.atan2(dx, dz);
        // barrels lift toward it (negative x turns +z up)
        node(f, 'pitch').rotation.x = -Math.min(1.2, Math.max(0, Math.atan2(target.position.y - (f.at.y + BARREL_Y), Math.hypot(dx, dz))));
      }
      if (target && f.cd <= 0) {
        f.cd = (solo ? 3.3 : 2.6) - Math.min(0.8, party * 0.1);
        const lead = target.position.clone().addScaledVector(target.velocity, FLAK_FLIGHT * 0.8);
        lead.y += 1;
        fire(f.at.clone().setY(f.at.y + BARREL_Y), lead);
      }
    }

    // shells in flight, and bursts fading
    for (const s of shells) {
      if (s.live) {
        s.t += dt;
        const k = Math.min(1, s.t / FLAK_FLIGHT);
        s.tracer.position.lerpVectors(s.from, s.to, k);
        s.tracer.scale.setScalar(0.5);
        s.mark.scale.setScalar(BURST_R * (0.3 + 0.7 * k));
        (s.mark.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.25 * k;
        if (k >= 1) burstAt(s);
      } else if (s.boom >= 0) {
        s.boom += dt;
        const k = s.boom / 0.9;
        s.burst.scale.setScalar(BURST_R * (0.4 + 0.8 * Math.min(1, k * 2)));
        (s.burst.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 * (1 - k * 1.6));
        s.smoke.scale.setScalar(BURST_R * (0.5 + 0.9 * k));
        (s.smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 * (1 - k));
        if (k >= 1) { s.boom = -1; s.burst.visible = s.smoke.visible = false; }
      }
    }

    // the rings: the next one bright, a blocked one dark red, the past ones dim
    const nx = nextRing();
    rings.forEach((r, i) => {
      const blocked = ringBlocked(i) || (r.last && !breachOpen);
      r.mat.color.setHex(r.last ? (breachOpen ? 0xffc860 : 0x7a2a1a) : blocked ? 0x6a1e14 : 0x5affa8);
      r.mat.opacity = i === nx && !blocked ? 0.75 + 0.25 * Math.sin(t * 6) : i <= reached ? 0.2 : blocked ? 0.35 : 0.55;
      r.mesh.rotation.z += dt * (i === nx ? 1.2 : 0.2);
    });
    courtGlow.intensity = breachOpen ? 90 + Math.sin(t * 3) * 10 : 30;
  };

  const objective = () => {
    const f = liveFlak();
    const nx = nextRing();
    if (f && rings[nx].pos.z > f.at.z) {
      return { pos: f.socket.clone(), label: T.flak, hint: T.flakHint, beacon: true };
    }
    if (rings[nx].last) return { pos: breachAt.clone(), label: T.breach, hint: T.breachHint, beacon: false };
    return { pos: rings[nx].pos.clone(), label: T.ring, hint: T.ringHint, beacon: false };
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const down = flaks.filter((f) => !f.alive).length;
    const bars: SectionBar[] = [
      { label: T.rings(Math.max(0, reached + 1), rings.length - 1), value: Math.max(0, reached + 1) / (rings.length - 1), tone: 'info' },
      { label: `${T.flakBar} ${down}/3`, value: down / 3, tone: down === 3 ? 'good' : 'warn' },
    ];
    const at = interactions.hudFor(p.position);
    if (at) bars.push({ ...at.bar, label: T.flakVerb.split(' ')[0] });
    return { title: T.title, bars, line: at ? at.line : reached < 1 ? T.teach : undefined };
  };

  // ---- the autopilot: ring to ring, and down onto each gun ----
  type Way = { at: THREE.Vector3; kind: 'air' | 'ring' | 'roof'; flak?: number; ring?: number };
  const ways: Way[] = [{ at: new THREE.Vector3(0, G + 14, 0), kind: 'air' }];
  rings.forEach((r, i) => {
    ways.push({ at: r.pos, kind: 'ring', ring: i });
    const fi = flakSpec.findIndex((x) => x.after === i);
    if (fi >= 0) {
      ways.push({ at: flaks[fi].socket.clone().setY(flaks[fi].socket.y + 6), kind: 'air' });
      ways.push({ at: flaks[fi].socket, kind: 'roof', flak: fi });
    }
  });

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    let c = cursors[slot];
    // never behind the party's rings: skip what is already passed
    while (c < ways.length - 1 && ways[c].kind === 'ring' && (ways[c].ring ?? 0) <= reached) c++;
    let w = ways[Math.min(c, ways.length - 1)];
    // a gun already silenced needs no landing
    while (w.flak !== undefined && !flaks[w.flak].alive && c < ways.length - 1) { c++; w = ways[c]; }
    if (w.kind === 'air' && c + 1 < ways.length && ways[c + 1].flak !== undefined && !flaks[ways[c + 1].flak!].alive) {
      c += 2; w = ways[Math.min(c, ways.length - 1)];
    }
    const pos = p.position;
    const dx = w.at.x - pos.x, dz = w.at.z - pos.z;
    const flat = Math.hypot(dx, dz);
    const dy = w.at.y - pos.y;
    const out: AutopilotInput = { shootHeld: true, yaw: Math.atan2(dx, dz) };
    if (w.kind === 'roof') {
      const f = flaks[w.flak!];
      if (flat > 1.5) {
        out.moveY = Math.min(1, flat / 4);
        // hold height over the roof until over it
        if (pos.y < w.at.y + 3) out.jumpHeld = true;
        if (p.grounded && pos.y < w.at.y + 3) out.jumpPressed = true;
      } else if (!p.grounded) {
        out.moveY = 0;
      } else {
        out.interactHeld = true;
      }
      if (!f.alive || f.charged) c++;
      cursors[slot] = c;
      return out;
    }
    out.moveY = 1;
    if (dy > 0.5) {
      out.jumpHeld = true;
      if (p.grounded) out.jumpPressed = true;
    }
    const passed = w.kind === 'ring'
      ? (w.ring ?? 0) <= reached || pos.clone().sub(w.at).dot(rings[w.ring!].n) > 1
      : flat < 4 && Math.abs(dy) < 3;
    if (passed && c < ways.length - 1) c++;
    cursors[slot] = c;
    return out;
  };

  const inst: SectionInstance = {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3((i % 2) * 2.4 - 1.2, Y0 + 1, -4.5 - Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: G + LID,
    groundAt: (x, z) => {
      if (Math.hypot(x, z) < SR + 3) return Y0 + (Math.hypot(x, z) < 6.5 ? 1 : 0);
      for (const tw of towers) if (Math.abs(x - tw.x) < tw.w / 2 && Math.abs(z - tw.z) < tw.d / 2) return tw.top + 0.5;
      return G + UPDRAFT;
    },
    // (the ridge's staggered notches reach a little past the edge)
    contains: (x, z) => (Math.abs(x) < HALF_W + 10 && z > -18 && z < LEN) || Math.hypot(x, z) < SR + 1,
    path: line,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot: (slot) => airSpot(reached, slot),
    // the updraft (in `update`) catches a fall long before this backstop
    offPath: (pos) => pos.y < Y0 - 9,
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
      flight.release(game.players);
      const mine = new Set(flaks.map((f) => f.breech));
      if (game.board.breakables) game.board.breakables = game.board.breakables.filter((b) => !mine.has(b));
    },
    debug: () => ({
      reached, breachOpen, flaks: flaks.map((f) => (f.alive ? (f.charged ? 'charged' : 'up') : 'down')),
      t: Math.round(t), pos: game.players.map((p) => p.position.toArray().map(Math.round)),
    }),
  };
  // for tools/test-section-forge.mjs: the live pieces
  (inst as unknown as { probe: unknown }).probe = {
    flaks, rings, flight, G, dome: dome.position, breachAt,
    reached: () => reached,
    breachOpen: () => breachOpen,
    airSpot,
  };
  return inst;
}

export const covertSky: SectionDef = {
  id: 'covert-sky',
  build,
  // the open sky over the ruined city: a long, pale haze
  world: { fogColor: 0x9da59e, fogNear: 180, fogFar: 1100, fill: 1.0 },
};
