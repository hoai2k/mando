import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy } from '../enemies/enemy';
import { Darkness, fearOfLight } from './kit/darkness';
import { Interactions, type Interactable } from './kit/interact';
import { composeMoves } from './kit/moves';
import { audio } from '../core/audio';
import { loadOptionalTexture } from '../core/assets';

/**
 * Lamplight (docs/LEVEL_SECTIONS.md §2.8) — the Crevasse, after the Glacier
 * Chute, before the queen tunnel (stage B).
 *
 * The chute ends in a snowbank in the dark, and the dark is the brood's inner
 * caverns: three chambers joined by crawl tunnels, pitch black but for the egg
 * sacs and the lamps on the party's helmets. The thing in the dark is afraid
 * of the lamps — until there are too many of them to be afraid.
 *
 * **The verb is the light** (K9, `kit/darkness.ts`). You see what you point
 * at. A krykna caught in a lamp backs out of it and circles for your flank;
 * holding aim focuses the beam and a body held in it for a second and a half
 * is dazzled (down for two, double damage). The rocket button throws a flare.
 * Each chamber has three **braziers**: lighting one (hold Y, two seconds)
 * makes a pool of warm light the brood will not enter and a checkpoint;
 * lighting all three makes the webs over the chamber's way on shrink back.
 *
 * **The escalation** is the boldness clock: a chamber that stays dark too
 * long (sixty seconds without a new brazier; ninety solo) stops fearing the
 * lamps, and the swarm comes straight in. Chamber A teaches it with a small
 * brood; B is wider, with more nests; C is the smallest and the boldest, and
 * lighting its last brazier sets the web wall to the queen tunnel burning —
 * the climax is holding the lit chamber while it burns and the whole brood
 * comes at once. The way on, in the dark, is always the next unlit brazier's
 * ember.
 *
 * Nothing is left behind: the fallen re-form at the last lit brazier, and the
 * web walls only ever open.
 */

type V2 = { x: number; z: number };
interface Chamber { c: V2; r: number; braziers: V2[]; nests: V2[] }

const CHAMBERS: Chamber[] = [
  {
    c: { x: 0, z: 0 }, r: 17,
    braziers: [{ x: -9, z: -4 }, { x: 9, z: 2 }, { x: -3, z: 9 }],
    nests: [{ x: -14, z: 6 }, { x: 13, z: -8 }, { x: 10, z: 12 }],
  },
  {
    c: { x: 8, z: 58 }, r: 20,
    braziers: [{ x: -4, z: 52 }, { x: 20, z: 56 }, { x: 8, z: 68 }],
    nests: [{ x: -9, z: 50 }, { x: 24, z: 48 }, { x: 22, z: 68 }, { x: -6, z: 68 }],
  },
  {
    c: { x: 0, z: 116 }, r: 16,
    braziers: [{ x: -8, z: 112 }, { x: 8, z: 110 }, { x: -6, z: 124 }],
    nests: [{ x: -13, z: 118 }, { x: 13, z: 120 }, { x: -8, z: 104 }, { x: 9, z: 127 }],
  },
];
/** the crawl tunnels run along z at this x, this wide and this high */
const TX = 4;
const TW = 2.2;
const TH = 3.4;
const TUNNELS: [number, number][] = [[15.5, 39.5], [76.6, 101.5]];
/** the passage from chamber C to the queen tunnel, and the web wall across it */
const EXIT: [number, number] = [131, 150];
const WEB_Z = 134;
const ROOF = 11;

function build(ctx: SectionContext): SectionInstance {
  const { game } = ctx;
  const T = TEXT.sections.lamplight;
  const party = Math.max(1, game.players.length);
  const Y0 = ctx.floorY;
  const solo = party === 1;
  const boldAfter = [solo ? 90 : 60, solo ? 90 : 60, solo ? 70 : 45];

  // the cave floor is flat rock (the walls are columns and slabs)
  game.board.physics.heightAt = () => Y0;

  // ---- materials ----
  const rock = ctx.paint(0x2c3036, { rough: 0.95, metal: 0.05 });
  ctx.tile(rock, 'cliff_basalt', 2, 2, { normal: true });
  const floorMat = ctx.paint(0x23272c, { rough: 0.55, metal: 0.1 });
  ctx.tile(floorMat, 'basalt_albedo', 14, 28);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 1, side: THREE.BackSide });
  ctx.own(roofMat);
  const iron = ctx.paint(0x2a2622, { rough: 0.6, metal: 0.8 });
  const snowMat = ctx.paint(0xdfe8f0, { rough: 0.95, metal: 0 });
  ctx.tile(snowMat, 'snow_albedo', 3, 3);
  // the silk: the requested sheet when it lands, drawn strands until then
  const webTex = drawWeb();
  ctx.own(webTex);
  const webMat = new THREE.MeshBasicMaterial({ map: webTex, color: 0xd8dde2, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  ctx.own(webMat);
  let gone = false;
  loadOptionalTexture('web_sheet', (tex) => {
    if (gone) return;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    webMat.map = tex;
    webMat.needsUpdate = true;
  }, { exts: ['png'] });
  const burnMat = new THREE.MeshBasicMaterial({ map: webTex, color: 0xff7a30, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  ctx.own(burnMat);
  const eggMat = new THREE.MeshStandardMaterial({ color: 0x8a7a50, emissive: 0xffa040, emissiveIntensity: 0.22, roughness: 0.45 });
  ctx.own(eggMat);
  const nestMat = new THREE.MeshStandardMaterial({ color: 0x6a2a24, emissive: 0xff3020, emissiveIntensity: 0.45, roughness: 0.45 });
  ctx.own(nestMat);

  // ---- the floor ----
  {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 190), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(4, Y0, 60);
    floor.receiveShadow = true;
    ctx.mesh(floor);
    ctx.own(floor.geometry);
  }

  // ---- the chambers: rings of rock columns, open where a tunnel meets them ----
  const colGeo = new THREE.DodecahedronGeometry(1, 1);
  ctx.own(colGeo);
  const openings: { x: number; z: number; half: number }[] = [
    { x: TX, z: TUNNELS[0][0], half: TW }, { x: TX, z: TUNNELS[0][1], half: TW },
    { x: TX, z: TUNNELS[1][0], half: TW }, { x: TX, z: TUNNELS[1][1], half: TW },
    { x: 0, z: EXIT[0], half: 2.4 },
  ];
  const rc = 2.6;
  const column = (x: number, z: number, h: number, seed: number): void => {
    ctx.cyl(x, Y0 + h / 2, z, rc, h, null);
    const m = new THREE.Mesh(colGeo, rock);
    m.scale.set(rc * 1.25, h * 0.55, rc * 1.25);
    m.position.set(x, Y0 + h * 0.45, z);
    m.rotation.set(seed * 0.7, seed * 1.3, seed * 0.4);
    ctx.mesh(m);
  };
  CHAMBERS.forEach((ch, ci) => {
    const ringR = ch.r + rc - 0.3;
    const n = Math.ceil((2 * Math.PI * ringR) / 3.1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = ch.c.x + Math.cos(a) * ringR, z = ch.c.z + Math.sin(a) * ringR;
      // leave the mouths open: no column whose body would stand in a tunnel
      if (openings.some((o) => Math.abs(x - o.x) < o.half + rc + 0.2 && Math.abs(z - o.z) < rc + 4)) continue;
      column(x, z, ROOF + 2, i + ci * 7);
    }
    // the roof: a low dome of rock, dark as the floor
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), roofMat);
    dome.scale.set(ch.r + 3, ROOF, ch.r + 3);
    dome.position.set(ch.c.x, Y0, ch.c.z);
    ctx.mesh(dome);
    ctx.own(dome.geometry);
  });

  // ---- the crawl tunnels, and the passage out ----
  const tunnel = (x: number, z0: number, z1: number, half: number, h: number): void => {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    ctx.box(x - half - 0.6, Y0 + h / 2, zc, 1.2, h, len, rock);
    ctx.box(x + half + 0.6, Y0 + h / 2, zc, 1.2, h, len, rock);
    ctx.box(x, Y0 + h + 0.6, zc, half * 2 + 2.4, 1.2, len, rock);
  };
  for (const [z0, z1] of TUNNELS) tunnel(TX, z0 - 1, z1 + 1, TW, TH);
  tunnel(0, EXIT[0] - 1, EXIT[1], 2.4, 4);
  ctx.box(0, Y0 + 2, EXIT[1] + 0.6, 7, 4, 1.2, rock);     // far out in the black: nobody sees this end

  // ---- the snowbank: where the chute put the party down ----
  {
    const drift = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), snowMat);
    drift.scale.set(9, 5, 7);
    drift.position.set(0, Y0 - 0.3, -17.5);
    ctx.mesh(drift);
    ctx.own(drift.geometry);
    ctx.box(0, Y0 + 0.6, -17.2, 10, 1.2, 3, null);
    const chill = new THREE.PointLight(0x7fb8ff, 5, 14, 1.6);
    chill.position.set(0, Y0 + 7, -16);
    ctx.mesh(chill);
  }

  // ---- decoration: egg sacs, nests, hanging silk ----
  const eggGeo = new THREE.SphereGeometry(0.5, 10, 8);
  ctx.own(eggGeo);
  const webPlane = new THREE.PlaneGeometry(1, 1);
  ctx.own(webPlane);
  const rand = mulberry(7);
  CHAMBERS.forEach((ch) => {
    // egg clusters round the walls, the only other light
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const r = ch.r - 1.5;
      const x = ch.c.x + Math.cos(a) * r, z = ch.c.z + Math.sin(a) * r;
      if (openings.some((o) => Math.abs(x - o.x) < o.half + 2 && Math.abs(z - o.z) < 4)) continue;
      for (let k = 0; k < 4; k++) {
        const egg = new THREE.Mesh(eggGeo, eggMat);
        egg.scale.set(0.9 + rand() * 0.6, 1.1 + rand() * 0.6, 0.9 + rand() * 0.6);
        egg.position.set(x + (rand() - 0.5) * 1.8, Y0 + 0.5 + rand() * 3.5, z + (rand() - 0.5) * 1.8);
        ctx.mesh(egg);
      }
    }
    // the nests: where they come out of the walls, lit red from inside
    for (const n of ch.nests) {
      for (let k = 0; k < 6; k++) {
        const egg = new THREE.Mesh(eggGeo, nestMat);
        egg.scale.setScalar(0.8 + rand() * 0.7);
        egg.position.set(n.x + (rand() - 0.5) * 2.2, Y0 + 0.4 + rand() * 2.2, n.z + (rand() - 0.5) * 2.2);
        ctx.mesh(egg);
      }
    }
    // silk sheets between the columns and the roof
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2;
      const r = ch.r * (0.5 + rand() * 0.45);
      const w = new THREE.Mesh(webPlane, webMat);
      w.scale.set(3 + rand() * 5, 2 + rand() * 4, 1);
      w.position.set(ch.c.x + Math.cos(a) * r, Y0 + ROOF * (0.55 + rand() * 0.3), ch.c.z + Math.sin(a) * r);
      w.rotation.set((rand() - 0.5) * 0.8, rand() * Math.PI, (rand() - 0.5) * 0.5);
      ctx.mesh(w);
    }
  });

  // ---- the web walls: across each chamber's way on ----
  interface WebWall { z: number; x: number; half: number; box: ReturnType<SectionContext['box']>['box']; mesh: THREE.Mesh; state: 'shut' | 'shrinking' | 'burning' | 'open'; t: number }
  const walls: WebWall[] = [
    { z: TUNNELS[0][0] + 0.5, x: TX, half: TW },
    { z: TUNNELS[1][0] + 0.5, x: TX, half: TW },
    { z: WEB_Z, x: 0, half: 2.4 },
  ].map((w) => {
    const h = w.z === WEB_Z ? 4 : TH;
    const box = ctx.box(w.x, Y0 + h / 2, w.z, w.half * 2, h, 0.6, null).box;
    const mesh = new THREE.Mesh(webPlane, webMat);
    mesh.scale.set(w.half * 2 + 0.4, h + 0.2, 1);
    mesh.position.set(w.x, Y0 + h / 2, w.z);
    ctx.mesh(mesh);
    return { ...w, box, mesh, state: 'shut' as const, t: 0 };
  });

  // ---- the braziers ----
  const interactions = new Interactions();
  interface Brazier { ci: number; at: THREE.Vector3; lit: boolean; it: Interactable; ember: THREE.Mesh; flames: THREE.Mesh[]; pool: THREE.Mesh }
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a30, fog: false });
  ctx.own(emberMat);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  ctx.own(flameMat);
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  ctx.own(poolMat);
  const emberGeo = new THREE.SphereGeometry(0.16, 8, 6);
  const flameGeo = new THREE.ConeGeometry(0.28, 1, 7);
  const poolGeo = new THREE.CircleGeometry(6, 28);
  ctx.own(emberGeo); ctx.own(flameGeo); ctx.own(poolGeo);
  // the dark stands up with the stage: the world's own light goes out now,
  // behind the arrival veil, not on the first frame of play
  const dark: Darkness = new Darkness(game, ctx.group, { keep: ctx.group });
  const braziers: Brazier[] = [];
  CHAMBERS.forEach((ch, ci) => {
    for (const b of ch.braziers) {
      const at = new THREE.Vector3(b.x, Y0, b.z);
      const standIn = (): THREE.Object3D => {
        const g = new THREE.Group();
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.36, 0.5, 10, 1, true), iron);
        bowl.position.y = 0.95;
        g.add(bowl);
        for (let k = 0; k < 3; k++) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5), iron);
          const a = (k / 3) * Math.PI * 2;
          leg.position.set(Math.cos(a) * 0.35, 0.45, Math.sin(a) * 0.35);
          leg.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
          g.add(leg);
        }
        return g;
      };
      ctx.prop('forge_brazier', at, { size: 1.5, fallback: standIn, solid: { r: 0.6, h: 1.2 } });
      // the ember: seen through the dark from anywhere in the chamber
      const ember = new THREE.Mesh(emberGeo, emberMat);
      ember.position.set(b.x, Y0 + 1.25, b.z);
      ctx.mesh(ember);
      const flames = [0, 1, 2].map((k) => {
        const f = new THREE.Mesh(flameGeo, flameMat);
        f.position.set(b.x + Math.cos(k * 2.1) * 0.2, Y0 + 1.6, b.z + Math.sin(k * 2.1) * 0.2);
        f.visible = false;
        ctx.mesh(f);
        return f;
      });
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(b.x, Y0 + 0.04, b.z);
      pool.visible = false;
      ctx.mesh(pool);
      const br: Brazier = {
        ci, at, lit: false, ember, flames, pool,
        it: interactions.add({
          pos: at, hold: solo ? 1.6 : 2, radius: 2.6, verb: T.verb,
          onDone: () => light(br),
        }),
      };
      braziers.push(br);
    }
  });

  // ---- state ----
  let started = false;
  let complete = false;
  const entered = [false, false, false];
  const darkT = [0, 0, 0];
  const bold = [false, false, false];
  const trickle = [6, 6, 6];
  const home = new Map<Enemy, number>();
  let burning = -1;       // seconds into the last web's burn; -1 before it
  let burnt = false;
  let rush = false;
  ctx.checkpoint.set(0, Y0, -11);

  const litIn = (ci: number): number => braziers.filter((b) => b.ci === ci && b.lit).length;
  const chamberDone = (ci: number): boolean => litIn(ci) === 3;
  const current = (): number => { for (let ci = 0; ci < 3; ci++) if (!chamberDone(ci)) return ci; return 3; };
  const inChamber = (x: number, z: number, ci: number): boolean => {
    const ch = CHAMBERS[ci];
    return Math.hypot(x - ch.c.x, z - ch.c.z) < ch.r;
  };

  const light = (br: Brazier): void => {
    br.lit = true;
    br.ember.visible = false;
    for (const f of br.flames) f.visible = true;
    br.pool.visible = true;
    dark.addPool(br.at, 6);
    ctx.checkpoint.copy(br.at).add(new THREE.Vector3(0, 0, -2));
    darkT[br.ci] = 0;
    if (bold[br.ci]) bold[br.ci] = false;
    audio.flame(0.6);
    audio.checkpointChime();
    const n = litIn(br.ci);
    if (n < 3) ctx.announce(T.lit, T.litSub(n));
    else if (br.ci < 2) {
      walls[br.ci].state = 'shrinking';
      ctx.announce(T.opened, T.openedSub);
    } else {
      // the last chamber: the web to the queen tunnel catches, and the brood comes
      walls[2].state = 'burning';
      burning = 0;
      rush = true;
      ctx.announce(T.burning, T.burningSub);
      spawnBrood(2, Math.round(3 + party * 1.5), true);
    }
  };

  const spawnBrood = (ci: number, n: number, loud = false): void => {
    const ch = CHAMBERS[ci];
    for (let i = 0; i < n; i++) {
      const nest = ch.nests[(i + Math.floor(Math.random() * ch.nests.length)) % ch.nests.length];
      const at = new THREE.Vector3(nest.x + (Math.random() - 0.5) * 2, Y0, nest.z + (Math.random() - 0.5) * 2);
      const e = ctx.spawn('krykna', at, { alert: true });
      home.set(e, ci);
      e.sectionSteer = fear;
    }
    if (loud) audio.bark('spider_chitter', 0.8);
  };
  const isBold = (e: Enemy): boolean => {
    if (rush) return true;
    const ci = home.get(e);
    return ci !== undefined && bold[ci];
  };
  const fear = fearOfLight(dark, isBold);

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves(dark.move(), {
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
        });
      }
      for (let i = 0; i < 1 + party; i++) {
        const ch = CHAMBERS[i % 3];
        ctx.pickup(new THREE.Vector3(ch.c.x + 2, Y0, ch.c.z + (i % 2 ? 3 : -3)));
      }
    }
    dark.update(dt);
    interactions.update(dt, game);

    // ---- the chambers: the brood wakes when the party comes in, and grows bold in the dark ----
    for (let ci = 0; ci < 3; ci++) {
      const inside = game.players.some((p) => p.alive && inChamber(p.position.x, p.position.z, ci));
      if (!entered[ci] && inside) {
        entered[ci] = true;
        spawnBrood(ci, (solo ? [2, 3, 4] : [3, 4, 5])[ci] + (party - 1), true);
      }
      if (!entered[ci] || chamberDone(ci)) continue;
      darkT[ci] += dt;
      if (!bold[ci] && darkT[ci] > boldAfter[ci]) {
        bold[ci] = true;
        ctx.announce(T.bold, T.boldSub);
        audio.bark('spider_chitter', 0.9);
      }
      // more come out of the nests while the chamber is dark
      trickle[ci] -= dt;
      const alive = [...home.entries()].filter(([e, c]) => c === ci && e.alive).length;
      if (trickle[ci] <= 0 && inside) {
        trickle[ci] = (solo ? 11 : 8) - ci;
        if (alive < 3 + party + ci) spawnBrood(ci, 1);
      }
    }
    for (const [e] of home) if (!e.alive) home.delete(e);

    // ---- the web walls ----
    for (const w of walls) {
      if (w.state === 'shrinking') {
        w.t += dt;
        const k = Math.max(0, 1 - w.t / 1.6);
        w.mesh.scale.y = (w.z === WEB_Z ? 4 : TH) * k + 0.01;
        w.mesh.position.y = Y0 + (w.z === WEB_Z ? 4 : TH) * (1 - k * 0.5);
        if (w.t > 0.4 && w.box) { ctx.unsolid({ box: w.box }); }
        if (k <= 0) { w.state = 'open'; w.mesh.visible = false; }
      } else if (w.state === 'burning') {
        w.t += dt;
        burning = w.t;
        const m = w.mesh;
        m.material = burnMat;
        burnMat.opacity = 0.6 + Math.random() * 0.3;
        m.scale.y = 4 * Math.max(0.05, 1 - w.t / 6);
        if (Math.random() < dt * 30) game.particles.explosion(new THREE.Vector3(w.x + (Math.random() - 0.5) * 4, Y0 + Math.random() * 4 * (1 - w.t / 6), w.z), 0.15);
        if (w.t >= 6) {
          w.state = 'open';
          m.visible = false;
          ctx.unsolid({ box: w.box });
          burnt = true;
          ctx.announce(T.burnt, T.exit);
        }
      }
    }
    // the fire lights the passage while it burns
    if (burning >= 0 && !burnt && dark.pools.every((p) => p.pos.z < WEB_Z - 1)) dark.addPool(new THREE.Vector3(0, Y0, WEB_Z - 1.5), 3.5, 0xff6a20);

    // flames
    for (const br of braziers) {
      if (!br.lit) {
        const pulse = 0.8 + 0.2 * Math.sin(game.time * 2.3 + br.at.x);
        br.ember.scale.setScalar(pulse);
        continue;
      }
      br.flames.forEach((f, k) => {
        const t = game.time * 9 + k * 2 + br.at.z;
        f.scale.set(1, 0.9 + 0.35 * Math.sin(t) + Math.random() * 0.15, 1);
      });
    }

    // through the burnt web into the queen tunnel: done
    if (burnt && game.players.some((p) => p.alive && p.position.z > WEB_Z + 3)) complete = true;
  };

  const nextBrazier = (from?: THREE.Vector3): Brazier | null => {
    const ci = current();
    if (ci > 2) return null;
    const left = braziers.filter((b) => b.ci === ci && !b.lit);
    if (!from) return left[0] ?? null;
    return left.sort((a, b) => a.at.distanceToSquared(from) - b.at.distanceToSquared(from))[0] ?? null;
  };
  const partyCentre = (): THREE.Vector3 => {
    const c = new THREE.Vector3();
    let n = 0;
    for (const p of game.players) if (p.alive) { c.add(p.position); n++; }
    return n ? c.divideScalar(n) : c.set(0, Y0, 0);
  };

  const objective = () => {
    const ci = current();
    if (ci > 2) {
      return {
        pos: new THREE.Vector3(0, Y0, WEB_Z + 4), label: T.exit,
        hint: burnt ? T.hintExit : T.hintBurn, beacon: false,
      };
    }
    const b = nextBrazier(partyCentre())!;
    return { pos: b.at.clone(), label: T.label, hint: T.hintLight, beacon: false };
  };

  const respawnSpot = (slot: number): THREE.Vector3 => ctx.defaultRespawn(slot, ctx.checkpoint);

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [];
    const lamp = dark.bar(slot);
    if (lamp) bars.push(lamp);
    const at = interactions.hudFor(p.position);
    if (at) bars.push({ label: at.bar.label, value: at.bar.value, tone: 'good' });
    const ci = Math.min(2, current());
    let line: string = at ? at.line : T.dark;
    if (!at && dark.flareReady(slot) > 0) line = T.flare(Math.ceil(dark.flareReady(slot)));
    return { title: T.braziers(litIn(ci)), bars, line };
  };

  // ---- the autopilot: brazier to brazier, lamp on the nearest spider ----
  const spine: V2[] = [
    { x: 0, z: -6 }, { x: TX, z: TUNNELS[0][0] - 3 }, { x: TX, z: TUNNELS[0][1] + 2 }, { x: 8, z: 50 },
    { x: TX, z: TUNNELS[1][0] - 3 }, { x: TX, z: TUNNELS[1][1] + 2 }, { x: 0, z: 110 }, { x: 0, z: WEB_Z - 3 }, { x: 0, z: WEB_Z + 6 },
  ];
  /** how far along the spine a z is: 0 in A, 1–2 in T1, 3 in B, 4–5 in T2, 6 in C, 7+ the passage */
  const region = (z: number): number => (z < TUNNELS[0][0] ? 0 : z < TUNNELS[0][1] ? 1 : z < TUNNELS[1][0] ? 3 : z < TUNNELS[1][1] ? 4 : z < WEB_Z - 1 ? 6 : 8);
  const chamberRegion = [0, 3, 6];
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const ci = current();
    const reg = region(p.position.z);
    let goal: THREE.Vector3 | null = null;
    let holding = false;
    if (ci <= 2 && reg === chamberRegion[ci]) {
      const b = nextBrazier(p.position);
      if (b) {
        if (b.it.inReach(p.position)) holding = true;
        else goal = b.at;
      }
    } else if (ci > 2 && !burnt) {
      // the web is burning: hold the chamber, in the light, facing the brood
      holding = p.position.z > 108;
      if (!holding) goal = new THREE.Vector3(0, Y0, 116);
    } else {
      // on along the spine to wherever the work is
      const want = ci > 2 ? 8 : chamberRegion[ci];
      const next = spine.find((s, i) => i > 0 && region(s.z) <= want && s.z > p.position.z + 1.2) ?? spine[spine.length - 1];
      goal = new THREE.Vector3(next.x, Y0, next.z);
    }
    // the nearest spider, for the lamp and the gun
    let foe: Enemy | null = null;
    let fd = 16;
    for (const e of game.enemies) {
      if (!e.alive || e.team !== 1) continue;
      const d = e.position.distanceTo(p.position);
      if (d < fd) { fd = d; foe = e; }
    }
    const out: AutopilotInput = { shootHeld: !!foe, lookY: (-0.1 - p.cam.pitch) * 0.3 };
    if (holding) {
      out.interactHeld = ci <= 2 && !!nextBrazier(p.position)?.it.inReach(p.position);
      if (foe) {
        out.yaw = Math.atan2(foe.position.x - p.position.x, foe.position.z - p.position.z);
        out.aimHeld = dark.lamps[slot].battery > 0.3;
      }
    } else if (goal) {
      const dx = goal.x - p.position.x, dz = goal.z - p.position.z;
      out.yaw = Math.atan2(dx, dz);
      out.moveY = Math.min(1, Math.hypot(dx, dz) / 2);
    }
    if (foe && fd < 2.4) out.meleePressed = true;
    return out;
  };

  const inTunnel = (x: number, z: number): boolean =>
    TUNNELS.some(([z0, z1]) => z > z0 - 1 && z < z1 + 1 && Math.abs(x - TX) < TW);
  return {
    starts: [0, 1, 2, 3].map((i) => new THREE.Vector3(((i % 2) * 2 - 1) * 1.8, Y0, -12 + Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + ROOF,
    groundAt: () => Y0,
    contains: (x, z) => CHAMBERS.some((_, ci) => inChamber(x, z, ci)) || inTunnel(x, z)
      || (z > EXIT[0] - 1 && z < EXIT[1] && Math.abs(x) < 2.4),
    path: [new THREE.Vector3(0, Y0, -12), ...braziers.map((b) => b.at.clone()), new THREE.Vector3(0, Y0, WEB_Z + 4)],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    hud,
    autopilot,
    dispose: () => {
      gone = true;
      dark.dispose();
      for (const p of game.players) p.sectionMove = null;
      for (const e of home.keys()) e.sectionSteer = null;
    },
    debug: () => ({
      lit: [0, 1, 2].map(litIn), bold: [...bold], burning, burnt,
      z: game.players.map((p) => Math.round(p.position.z)),
    }),
  };
}

/** a web drawn on a canvas: radial strands and a spiral, for when web_sheet.png is not in */
function drawWeb(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(235,240,245,0.85)';
  g.lineWidth = 1.4;
  const cx = 128, cy = 128;
  const spokes = 14;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + Math.sin(i) * 0.1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 180, cy + Math.sin(a) * 180); g.stroke();
  }
  g.lineWidth = 1;
  for (let r = 10; r < 180; r += 9 + r * 0.06) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + Math.sin(i) * 0.1;
      const rr = r * (0.92 + 0.08 * Math.sin(i * 3.1 + r));
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** a small seeded random, so the cave dresses the same way every time */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lamplight: SectionDef = {
  id: 'lamplight',
  build,
  // the dark: black fog close in, no sky, the ice's grip
  world: { fogColor: 0x020304, fogNear: 5, fogFar: 36, background: 0x000000, roofed: true, traction: 0.55 },
};
