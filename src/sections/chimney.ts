import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy } from '../enemies/enemy';
import { RisingPlane } from './kit/front';
import { Interactions } from './kit/interact';
import { composeMoves } from './kit/moves';

/**
 * The Chimney (docs/LEVEL_SECTIONS.md §2.6) — the Lava Flats, after the
 * Magma Run, before the glass fields.
 *
 * The bikes run out of river at a basalt landing in a magma chamber, and as
 * the party arrives the vent floods. The only way out is up: a basalt shaft
 * a hundred and sixteen metres tall, magma rising behind them, the sky a coin
 * of light at the top.
 *
 * **Why it is built as stacked floors.** Everyone in this game can fly — a
 * jetpack burn climbs twenty-eight metres and a super-jumper rises for as long
 * as A is held — so an open shaft is a lift, not a climb. The chimney is
 * three rock floors, each with **one hole**, on alternating sides. Getting
 * up means crossing every floor, through whoever is holding it, to the hole on
 * the far side; the magma is the reason not to linger, and the floors are the
 * checkpoints. Between floors a pair of wall ledges is the jetpack's rest (a
 * floor is thirty metres up and a burn is twenty-eight), and within six metres
 * of the magma the heat stops a pack refilling, so a rest has to be taken
 * *above* it.
 *
 * The beats, bottom to top: the flood (no fight, the magma starts), the first
 * floor (a posted squad), the second (a heavier one, boulders rolled down the
 * hole), the third (the elites and fliers), and the crack — twenty-four metres
 * to the lip while the vent surges. Each floor has a **valve**: hold it four
 * seconds (three alone) and the rise stops for ten (six at the chamber
 * floor's, which teaches it), and the shutter over the hole above opens —
 * the co-op beat: one turns, the others hold the floor.
 *
 * Nothing can be left behind: the fallen come back on the highest floor a
 * living player has reached (or, if the magma is already over it, on the
 * nearest safe ledge at or below the leader), and a wipe drops the magma back
 * twelve metres under the last floor reached before it moves again.
 */

/** half the shaft's inside width, metres */
const HALF = 12;
const WALL_T = 3;
/** the floor tops, relative to the chamber floor; the last is the lip */
const FLOORS = [0, 32, 62, 92];
const LIP = 116;
/** which side each floor's hole is on (index 1..4; the lip is 4) */
const HOLE_SIDE = [0, 1, -1, 1, -1];
/** the hole spans this far in from the wall along x, and ±HOLE_Z along z */
const HOLE_IN = 8;
const HOLE_Z = 4;
const SLAB_T = 3;
/** the magma pool's start, below the chamber floor, and the pit it sits in */
const MAGMA_Y0 = -8;
/** the pit is narrower than the gap to any hole, so whoever drops back down a hole lands on rock */
const PIT = 4;
/** metres above the magma inside which a jetpack will not refill */
const HEAT_BAND = 6;
/** seconds of warning a boulder's shadow gives */
const BOULDER_WARN = 1.5;

type Stand = { pos: THREE.Vector3; kind: 'floor' | 'ledge'; level: number };

/** the middle of the hole through floor `k` (the lip is 4), in shaft-local x */
function holeCentre(k: number): { x: number } {
  return { x: HOLE_SIDE[k] * (HALF - HOLE_IN / 2) };
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections.chimney;
  const party = Math.max(1, game.players.length);

  // ---- materials ----
  const rock = ctx.paint(spec.palette.rock, { rough: 0.95, metal: 0.05 });
  ctx.tile(rock, 'cliff_basalt', 3, 6, { normal: true });
  const slab = ctx.paint(spec.palette.wall, { rough: 0.9, metal: 0.05 });
  ctx.tile(slab, 'cliff_basalt', 2, 2, { normal: true });
  const ledgeMat = ctx.paint(spec.palette.floor, { rough: 0.9 });
  ctx.tile(ledgeMat, 'ash_ground', 1, 1);
  const trim = new THREE.MeshBasicMaterial({ color: spec.palette.accent });
  ctx.own(trim);

  // ---- the shaft walls: four slabs, the -z one opened for the arrival tunnel ----
  const wallTop = LIP + 6;
  const wallBot = -12;
  const wallH = wallTop - wallBot;
  const wy = Y0 + wallBot + wallH / 2;
  const o = HALF + WALL_T / 2;
  ctx.box(o, wy, 0, WALL_T, wallH, HALF * 2 + WALL_T * 2, rock);
  ctx.box(-o, wy, 0, WALL_T, wallH, HALF * 2 + WALL_T * 2, rock);
  ctx.box(0, wy, o, HALF * 2, wallH, WALL_T, rock);
  // the -z wall, round the tunnel mouth (6 m wide, 6 m tall)
  const TW = 3, TH = 6;
  ctx.box(-(HALF + TW) / 2, wy, -o, HALF - TW, wallH, WALL_T, rock);
  ctx.box((HALF + TW) / 2, wy, -o, HALF - TW, wallH, WALL_T, rock);
  const aboveH = wallTop - TH;
  ctx.box(0, Y0 + TH + aboveH / 2, -o, TW * 2, aboveH, WALL_T, rock);
  ctx.box(0, Y0 + (wallBot) / 2, -o, TW * 2, -wallBot, WALL_T, rock);

  // ---- the arrival tunnel: where the Magma Run's bikes stopped ----
  // A basalt tube running back from the mouth to the landing the bikes pulled
  // up at, shut at its far end by the fence the river run ended against — so
  // the stage opens *inside* the door the last one left by.
  const tunnelLen = 12;
  const tz0 = -HALF - WALL_T;
  ctx.box(0, Y0 - 1.5, tz0 - tunnelLen / 2, TW * 2 + 2, 3, tunnelLen, ledgeMat);
  ctx.box(TW + 1, Y0 + TH / 2, tz0 - tunnelLen / 2, 2, TH, tunnelLen, rock);
  ctx.box(-TW - 1, Y0 + TH / 2, tz0 - tunnelLen / 2, 2, TH, tunnelLen, rock);
  ctx.box(0, Y0 + TH + 1, tz0 - tunnelLen / 2, TW * 2 + 4, 2, tunnelLen, rock);
  ctx.box(0, Y0 + TH / 2, tz0 - tunnelLen - 1, TW * 2 + 4, TH, 2, rock);
  // the fence at the landing: two pylons and a dead pane
  const fenceMat = new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  ctx.own(fenceMat);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(TW * 2, TH - 0.5), fenceMat);
  pane.position.set(0, Y0 + TH / 2, tz0 - tunnelLen + 0.1);
  ctx.mesh(pane);
  for (const sx of [-1, 1]) ctx.cyl(sx * (TW - 0.3), Y0 + TH / 2, tz0 - tunnelLen + 0.3, 0.35, TH, slab);

  // ---- the chamber floor: a ring round the magma pit ----
  const ringW = HALF - PIT;
  const fy = Y0 - SLAB_T / 2;
  ctx.box(0, fy, (PIT + HALF) / 2, HALF * 2, SLAB_T, ringW, slab);
  ctx.box(0, fy, -(PIT + HALF) / 2, HALF * 2, SLAB_T, ringW, slab);
  ctx.box((PIT + HALF) / 2, fy, 0, ringW, SLAB_T, PIT * 2, slab);
  ctx.box(-(PIT + HALF) / 2, fy, 0, ringW, SLAB_T, PIT * 2, slab);
  // the pit's bottom, well under the magma: nothing ever stands on it
  ctx.box(0, Y0 - 10, 0, PIT * 2, 2, PIT * 2, rock);

  // A basalt column stands out of the pool in the lower half — cover on the
  // chamber floor, and a hop for whoever wants the shortcut up its side.
  const colTop = 18;
  ctx.cyl(0, Y0 + (colTop - 9) / 2, 0, 2.2, colTop + 9, rock);

  // ---- the floors, each with its one hole ----
  const slabWithHole = (top: number, side: number): void => {
    const cy = Y0 + top - SLAB_T / 2;
    const edge = side * (HALF - HOLE_IN);                   // the hole's inner edge
    const mainW = HALF * 2 - HOLE_IN;
    ctx.box(-side * (HOLE_IN / 2), cy, 0, mainW, SLAB_T, HALF * 2, slab);
    const hx = (edge + side * HALF) / 2;
    const sideLen = HALF - HOLE_Z;
    ctx.box(hx, cy, HOLE_Z + sideLen / 2, HOLE_IN, SLAB_T, sideLen, slab);
    ctx.box(hx, cy, -HOLE_Z - sideLen / 2, HOLE_IN, SLAB_T, sideLen, slab);
    // a lit lip round the hole, so the way up reads from the floor below
    for (const [x, z, sx, sz] of [
      [edge, 0, 0.3, HOLE_Z * 2], [hx, HOLE_Z, HOLE_IN, 0.3], [hx, -HOLE_Z, HOLE_IN, 0.3],
    ] as const) {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.25, sz), trim);
      lip.position.set(x, Y0 + top - SLAB_T - 0.05, z);
      ctx.mesh(lip);
    }
  };
  for (let k = 1; k <= 3; k++) slabWithHole(FLOORS[k], HOLE_SIDE[k]);
  slabWithHole(LIP, HOLE_SIDE[4]);

  // ---- the ledges: two rests per level, under the next hole ----
  const stands: Stand[] = [];
  for (let k = 0; k < 4; k++) stands.push({ pos: new THREE.Vector3(0, Y0 + FLOORS[k], k === 0 ? -8 : 0), kind: 'floor', level: k });
  const ledge = (x: number, y: number, z: number, w: number, d: number, level: number): void => {
    ctx.box(x, Y0 + y - 0.5, z, w, 1, d, ledgeMat);
    stands.push({ pos: new THREE.Vector3(x, Y0 + y, z), kind: 'ledge', level });
  };
  for (let k = 0; k < 4; k++) {
    const next = HOLE_SIDE[k + 1];
    const base = FLOORS[k];
    const span = (k < 3 ? FLOORS[k + 1] : LIP) - base;
    ledge(-next * 2, base + span * 0.36, HALF - 2, 6, 4, k);
    ledge(next * 7, base + span * 0.7, -HALF + 2, 6, 4, k);
  }

  // ---- the magma ----
  const magma = new RisingPlane(MAGMA_Y0, party === 1 ? 0.8 : party === 2 ? 0.95 : 1.05, 6);
  const magmaMat = new THREE.MeshStandardMaterial({
    color: 0xff5a1a, emissive: 0xff4a10, emissiveIntensity: 1.6, roughness: 0.6, metalness: 0,
  });
  ctx.own(magmaMat);
  ctx.tile(magmaMat, 'lava_flow', 3, 3);
  ctx.tile(magmaMat, 'magma_crust', 3, 3, { glow: 'magma_crust_glow' });
  const magmaGeo = new THREE.PlaneGeometry(HALF * 2 + WALL_T, HALF * 2 + WALL_T);
  ctx.own(magmaGeo);
  const magmaMesh = new THREE.Mesh(magmaGeo, magmaMat);
  magmaMesh.rotation.x = -Math.PI / 2;
  ctx.mesh(magmaMesh);
  const glow = new THREE.PointLight(0xff5a1a, 80, 70, 1.3);
  ctx.mesh(glow);
  const sky = new THREE.PointLight(0xffe0b0, 20, 60, 1.5);
  sky.position.set(0, Y0 + LIP + 4, 0);
  ctx.mesh(sky);
  const hazard = ctx.hazard({
    center: new THREE.Vector3(0, Y0 + magma.y, 0), radius: HALF * 1.6, kind: 'kill', yMax: Y0 + magma.y + 0.5,
  });

  // ---- the shutters: an iron blast shutter over every hole ----
  // The galleries were a mine once; every hole through a floor has its old
  // blast shutter, held shut by the vent pressure. Venting it at the floor's
  // valve throws the shutter open — and eases the rise for a moment, which is
  // what makes a floor a place you have to *hold* rather than one you fly
  // through. A shutter never shuts again once it is open.
  const shutterMat = ctx.paint(0x4a3a30, { rough: 0.6, metal: 0.7 });
  const shutters = [1, 2, 3, 4].map((k) => {
    const hole = holeCentre(k);
    const top = Y0 + (k < 4 ? FLOORS[k] : LIP);
    const { box, mesh } = ctx.box(hole.x, top - SLAB_T / 2, 0, HOLE_IN, SLAB_T * 0.6, HOLE_Z * 2, shutterMat);
    return { k, box, mesh: mesh!, open: false, slide: 0, x0: hole.x };
  });
  const openShutter = (k: number): void => {
    const sh = shutters[k - 1];
    if (!sh || sh.open) return;
    sh.open = true;
    ctx.unsolid({ box: sh.box });
  };

  // ---- the valves, one per floor (the chamber floor's teaches it) ----
  const interactions = new Interactions();
  const valves = [0, 1, 2, 3].map((k) => {
    const at = k === 0
      ? new THREE.Vector3(-6, Y0, -HALF + 3)
      : new THREE.Vector3(-HOLE_SIDE[k] * 4, Y0 + FLOORS[k], HALF - 3);
    // proportioned to the valve wheel's sheet (`reference/props/valve_wheel_ref.png`)
    // at the 1.6 m the sculpt is scaled to: a bolted flange, a pedestal pipe,
    // and a 0.82 m handwheel centred 1.19 m up on an axle stub 0.23 m forward
    const wheel = new THREE.Group();
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.28, 0.08, 12), slab);
    flange.position.y = 0.04;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.19, 8), slab);
    post.position.y = 0.6;
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.23, 8), slab);
    axle.rotation.x = Math.PI / 2;
    axle.position.set(0, 1.19, 0.115);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.04, 6, 20), trim);
    ring.position.set(0, 1.19, 0.23);
    wheel.add(flange, post, axle, ring);
    const holder = ctx.prop('valve_wheel', at, { size: 1.6, fallback: () => wheel });
    void holder;
    const it = interactions.add({
      pos: at, hold: party === 1 ? 3 : 4, verb: T.valveVerb,
      enabled: () => magma.y < FLOORS[k] + 1,
      onDone: () => {
        magma.pause(k === 0 ? 6 : 10);
        openShutter(k + 1);
        ctx.announce(T.valveHeld, k === 3 ? T.lipOpen : T.shutterOpen);
        if (k === 3) { surged = true; magma.surge(2, 14); }
      },
    });
    return { k, at, it, ring };
  });

  // ---- boulders: rolled down the hole above whoever is highest ----
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false });
  ctx.own(shadowMat);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  ctx.mesh(shadow);
  const boulderMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 0), rock);
  boulderMesh.visible = false;
  ctx.mesh(boulderMesh);
  let boulderT = 20;
  let boulder: { at: THREE.Vector3; fromY: number; t: number } | null = null;

  // ---- state ----
  let reached = 0;          // the highest floor a living player has stood on
  let started = false;
  let complete = false;
  let wiped = false;
  let surged = false;
  const squads: Enemy[][] = [[], [], [], []];
  const alerted = [false, false, false, false];
  const heatCap: number[] = [1, 1, 1, 1];
  ctx.checkpoint.set(0, Y0, -8);
  const cursors = [0, 0, 0, 0];

  const floorAt = (k: number): THREE.Vector3 => {
    if (k === 0) return new THREE.Vector3(0, Y0, -8);
    // the solid middle of the floor, clear of its hole and its valve
    return new THREE.Vector3(-HOLE_SIDE[k] * 2, Y0 + FLOORS[k], -4);
  };
  const holeAt = (k: number): THREE.Vector3 =>
    new THREE.Vector3(HOLE_SIDE[k] * (HALF - HOLE_IN / 2), Y0 + (k < 4 ? FLOORS[k] : LIP), 0);
  const onFloor = (p: THREE.Vector3, k: number): boolean => {
    const top = Y0 + (k < 4 ? FLOORS[k] : LIP);
    return Math.abs(p.y - top) < 1.6 && Math.abs(p.x) < HALF && Math.abs(p.z) < HALF;
  };

  // ---- the golden path, for guidance and the test walker ----
  // `gate`: do not go past this point until the shutter over hole `gate` is open
  type Way = { at: THREE.Vector3; stand: boolean; gate?: number };
  const ways: Way[] = [{ at: new THREE.Vector3(0, Y0, tz0 - 4), stand: true }, { at: new THREE.Vector3(0, Y0, -8), stand: true }];
  for (let k = 0; k < 4; k++) {
    ways.push({ at: valves[k].at.clone(), stand: true, gate: k + 1 });
    const mine = stands.filter((s) => s.kind === 'ledge' && s.level === k);
    for (const s of mine) ways.push({ at: s.pos.clone(), stand: true });
    const up = holeAt(k + 1);
    ways.push({ at: new THREE.Vector3(up.x, up.y + 2.5, 0), stand: false });
    // step off just past the hole's lip, then on to the floor's middle
    const lipX = HOLE_SIDE[k + 1] * (HALF - HOLE_IN - 2);
    ways.push({ at: new THREE.Vector3(lipX, up.y, 0), stand: true });
    if (k < 3) ways.push({ at: floorAt(k + 1), stand: true });
  }
  const path = ways.map((w) => w.at);

  const leader = () => {
    let best: THREE.Vector3 | null = null;
    for (const p of game.players) if (p.alive && (!best || p.position.y > best.y)) best = p.position;
    return best;
  };

  const spawnSquads = (): void => {
    for (let k = 1; k <= 3; k++) {
      const budget = Math.min(8, 1 + k + party);
      const kinds = ctx.squadFor(ctx.wave + k - 1, budget, { air: k === 3 });
      const centre = floorAt(k);
      kinds.forEach((kind, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        const at = new THREE.Vector3(centre.x + Math.cos(a) * 5, centre.y, centre.z + Math.sin(a) * 4 + 2);
        squads[k].push(ctx.spawn(kind, at, { exact: true, squad: 8800 + k }));
      });
    }
  };

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      spawnSquads();
      for (let i = 0; i < 2 + party; i++) ctx.pickup(new THREE.Vector3(-HOLE_SIDE[1 + (i % 3)] * 8, Y0 + FLOORS[1 + (i % 3)], -HALF + 2.5));
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => {
            // the heat: no refill within the band over the magma
            const hot = pl.position.y - (Y0 + magma.y) < HEAT_BAND;
            heatCap[pl.slot] = hot ? Math.min(heatCap[pl.slot], pl.fuel) : 1;
            if (hot) pl.fuel = Math.min(pl.fuel, heatCap[pl.slot]);
            return interactions.swallow(pl.slot, pl.position, input);
          },
        });
      }
    }

    // the magma, its surge for the last climb, and what it touches
    const lead = leader();
    magma.update(dt);
    magma.y = Math.min(magma.y, LIP - 8);
    magmaMesh.position.set(0, Y0 + magma.y, 0);
    const map = magmaMat.map;
    if (map) map.offset.set(game.time * 0.01, game.time * 0.02);
    glow.position.set(0, Y0 + magma.y + 3, 0);
    glow.intensity = 60 + Math.sin(game.time * 3) * 10;
    hazard.center.y = Y0 + magma.y;
    hazard.yMax = Y0 + magma.y + 0.5;

    // valves
    interactions.update(dt, game);
    for (const v of valves) v.ring.rotation.y += dt * (v.it.progress > 0 ? 6 : 0.4);
    // an open shutter slides back into the wall
    for (const sh of shutters) {
      if (!sh.open || sh.slide >= 1) continue;
      sh.slide = Math.min(1, sh.slide + dt / 1.2);
      sh.mesh.position.x = sh.x0 + Math.sign(sh.x0) * HOLE_IN * sh.slide;
      sh.mesh.scale.x = HOLE_IN * (1 - sh.slide * 0.9);
    }

    // checkpoints are floors reached, and a floor is reached by standing on it
    for (const p of game.players) {
      if (!p.alive) continue;
      for (let k = reached + 1; k < 4; k++) {
        if (onFloor(p.position, k)) {
          reached = k;
          ctx.checkpoint.copy(floorAt(k));
          ctx.announce(TEXT.banners.checkpoint, T.floorOf(k, 3));
        }
      }
      if (onFloor(p.position, 4) || p.position.y > Y0 + LIP + 0.6) complete = true;
    }

    // a squad wakes when the party comes up under it
    for (let k = 1; k <= 3; k++) {
      if (alerted[k] || !lead || lead.y < Y0 + FLOORS[k] - 16) continue;
      alerted[k] = true;
      for (const e of squads[k]) if (e.alive) e.alert(lead, true);
    }

    // a wipe: the magma falls back under the last floor, and waits
    const anyAlive = game.players.some((p) => p.alive);
    if (!anyAlive && !wiped) {
      wiped = true;
      magma.resetTo(Math.max(MAGMA_Y0, FLOORS[reached] - 12), 4);
    } else if (anyAlive) wiped = false;

    // boulders
    boulderT -= dt;
    if (!boulder && boulderT <= 0 && lead) {
      boulderT = 9 + Math.random() * 4;
      // the level the leader is on, and the hole above it
      let lvl = 0;
      for (let k = 3; k >= 0; k--) if (lead.y >= Y0 + FLOORS[k] - 1) { lvl = k; break; }
      const hole = holeAt(lvl + 1);
      const at = new THREE.Vector3(hole.x + (Math.random() - 0.5) * 4, Y0 + FLOORS[lvl], (Math.random() - 0.5) * 6);
      if (at.y > Y0 + magma.y + 2) boulder = { at, fromY: hole.y, t: 0 };
    }
    if (boulder) {
      boulder.t += dt;
      const b = boulder;
      shadow.position.set(b.at.x, b.at.y + 0.05, b.at.z);
      shadowMat.opacity = Math.min(0.55, (b.t / BOULDER_WARN) * 0.55);
      shadow.scale.setScalar(0.4 + Math.min(1, b.t / BOULDER_WARN) * 0.6);
      if (b.t > BOULDER_WARN - 0.45) {
        const k = Math.min(1, (b.t - (BOULDER_WARN - 0.45)) / 0.45);
        boulderMesh.visible = true;
        boulderMesh.position.set(b.at.x, THREE.MathUtils.lerp(b.fromY, b.at.y + 1.4, k * k), b.at.z);
        boulderMesh.rotation.x += dt * 4;
      }
      if (b.t >= BOULDER_WARN) {
        for (const p of game.players) {
          if (!p.alive) continue;
          if (Math.abs(p.position.y - b.at.y) < 3 && Math.hypot(p.position.x - b.at.x, p.position.z - b.at.z) < 2.8) {
            p.damage(38, b.at);
          }
        }
        game.particles.dustPuff(b.at, 18);
        boulder = null;
        boulderMesh.visible = false;
        shadowMat.opacity = 0;
      }
    }
  };

  const objective = () => {
    const next = Math.min(4, reached + 1);
    const lead = leader();
    const below = lead ? Math.max(0, Math.round(lead.y - (Y0 + magma.y))) : 0;
    // a shut way up points at the valve that opens it; an open one at the hole
    if (!shutters[next - 1].open) {
      return { pos: valves[next - 1].at.clone(), label: T.valveLabel, hint: T.valveHint, beacon: false };
    }
    const hole = holeAt(next);
    return {
      pos: new THREE.Vector3(hole.x, hole.y, hole.z),
      label: next === 4 ? T.lip : `floor ${next}`,
      hint: magma.paused ? T.valveHeld : T.climb(below),
      // a sixty-metre column is no guide inside a shaft; the lit lip of the hole is
      beacon: false,
    };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    // forward, with the party: the highest safe place at or below the leader
    const lead = leader();
    const floorK = floorAt(reached);
    // nobody standing: a wipe, and the magma is dropped back under the floor
    // reached (see `update`) — that floor is where the party re-forms
    if (!lead) return ctx.defaultRespawn(slot, floorK);
    const safe = Y0 + magma.y + 4;
    const cap = lead.y + 1;
    let pick: THREE.Vector3 | null = floorK.y >= safe ? floorK : null;
    for (const s of stands) {
      if (s.pos.y < safe || s.pos.y > cap) continue;
      if (!pick || s.pos.y > pick.y) pick = s.pos;
    }
    if (!pick) {
      for (const s of stands) if (s.pos.y >= safe && (!pick || s.pos.y < pick.y)) pick = s.pos;
    }
    return ctx.defaultRespawn(slot, pick ?? floorK);
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const gap = p.position.y - (Y0 + magma.y);
    const bars: SectionBar[] = [{
      label: magma.paused ? T.paused : T.magma,
      value: Math.max(0, Math.min(1, 1 - gap / 30)),
      tone: gap < 8 ? 'danger' : gap < 16 ? 'warn' : 'info',
    }];
    const at = interactions.hudFor(p.position);
    if (at) bars.push({ label: at.bar.label, value: at.bar.value, tone: 'good' });
    return { bars, line: at ? at.line : `${Math.max(0, Math.round(gap))} m above the magma` };
  };

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    // at a valve whose shutter is still shut: hold it
    for (const v of valves) {
      if (v.it.available && !shutters[v.k].open && v.it.inReach(p.position)) {
        return { interactHeld: true, shootHeld: true };
      }
    }
    let c = cursors[slot];
    // never aim below the floor already won: re-sync to the first waypoint above the feet
    while (c < ways.length - 1 && ways[c].at.y < p.position.y - 6) c++;
    const w = ways[Math.min(c, ways.length - 1)];
    const dy = w.at.y - p.position.y;
    const onIt = Math.hypot(w.at.x - p.position.x, w.at.z - p.position.z);
    // A ledge or floor is climbed *beside* and then stepped onto: steered at
    // from below, a body ends up under its lip with its head on the rock. So
    // until the feet are over its top, aim a few metres toward the middle of
    // the shaft; and hold a little height over it until standing above it.
    const aim = w.at.clone();
    const below = w.stand && dy > 0.5;
    if (below && onIt > 1.2) {
      const inward = new THREE.Vector3(-w.at.x, 0, -w.at.z);
      if (inward.lengthSq() > 1e-3) aim.addScaledVector(inward.normalize(), 4.5);
    }
    const dx = aim.x - p.position.x, dz = aim.z - p.position.z;
    const flat = Math.hypot(dx, dz);
    const out: AutopilotInput = { shootHeld: true, yaw: Math.atan2(dx, dz) };
    // only close in on a ledge once high enough to land on it
    if (flat > 0.8 && !(below && flat < 1.5)) out.moveY = Math.min(1, flat / 3);
    if (!below && onIt > 0.8) {
      const tx = w.at.x - p.position.x, tz = w.at.z - p.position.z;
      out.yaw = Math.atan2(tx, tz);
      out.moveY = Math.min(1, onIt / 3);
    }
    const jet = p.profile.flight === 'jetpack';
    // an empty pack on the ground waits to refill rather than hopping in place
    if (jet && p.grounded && p.fuel < 0.3 && dy > 1 && p.position.y - (Y0 + magma.y) > 7) {
      return { shootHeld: true, yaw: out.yaw };
    }
    const wantY = w.stand ? w.at.y + (onIt > 1.2 ? 1.8 : 0) : w.at.y;
    const resting = w.stand && jet && p.grounded && p.fuel < 0.85 && p.position.y - (Y0 + magma.y) > 10 && dy > 2;
    if (p.position.y < wantY - 0.3 && !resting) {
      out.jumpHeld = true;
      if (p.grounded) out.jumpPressed = true;
    }
    // arrived: on a floor or ledge, or up through a hole
    const there = w.stand ? onIt < 2.2 && Math.abs(dy) < 1.8 && p.grounded : p.position.y > w.at.y - 0.5;
    const gated = w.gate !== undefined && !shutters[w.gate - 1].open;
    // a jetpack rests to a full tank before the next climb, unless the magma says go
    const next = ways[c + 1];
    if (there && jet && next && next.at.y > p.position.y + 2 && p.fuel < 0.95
      && p.position.y - (Y0 + magma.y) > 9) { cursors[slot] = c; return { shootHeld: true }; }
    if (there && !gated && c < ways.length - 1) c++;
    cursors[slot] = c;
    return out;
  };

  return {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3((i % 2) * 2 - 1, Y0, tz0 - 3 - Math.floor(i / 2) * 2)),
    floorY: Y0,
    ceilingY: Y0 + LIP + 12,
    groundAt: () => Y0,
    contains: (x, z) => (Math.abs(x) < HALF && Math.abs(z) < HALF)
      || (Math.abs(x) < TW && z < -HALF && z > tz0 - tunnelLen),
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // the pit under the magma is the only way off the chimney, and the magma kills first
    offPath: (pos) => pos.y < Y0 - 9,
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
    },
    debug: () => ({ magma: magma.y, reached, surged, paused: magma.paused }),
  };
}

export const chimney: SectionDef = {
  id: 'chimney',
  build,
  // the chamber's own air: ash-red and close, the sky only at the top
  world: { fogColor: 0x2a120a, fogNear: 30, fogFar: 170, fill: 0.9 },
};
