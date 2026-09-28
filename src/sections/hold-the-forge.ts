import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import { Enemy, type EnemyKind } from '../enemies/enemy';
import { buildMandalorian } from '../characters/mandalorians';
import { disposeSubtree } from '../core/dispose';
import { audio } from '../core/audio';
import { DefendTarget, Progress } from './kit/objective';
import { Interactions, type Interactable } from './kit/interact';
import { composeMoves } from './kit/moves';
import type { StaticBox } from '../core/physics';

/**
 * Hold the Forge (docs/LEVEL_SECTIONS.md §2.14) — the Great Forge, after the
 * undercroft (stage B), before Covert Sky.
 *
 * The armoury vault's far door opens into the covert's hidden forge: a round
 * hall fifty metres across, carved like the undercroft the party just came
 * through, under an open shaft to the sky. Three tunnels come in — north,
 * east and west — and the vault passage the party arrives by is the fourth,
 * shut behind them. On the dais in the middle the Armorer is working beskar
 * at the great brazier, and everything on Mandalore that wants her dead is
 * coming down those tunnels.
 *
 * **The verb is holding ground for someone else.** The forging (K5
 * `Progress`) climbs while she works and *stalls* while any hostile is within
 * six metres of her, so the fight is decided at the dais, not wherever the
 * party would rather fight it. She fights back with her hammer and never
 * leaves the dais (K5 `DefendTarget`, held on a short leash round her anvil;
 * hostiles read her as nearer than she is, so they come for her). Two
 * bellows flank the fire: a hostile working at one breaks it and the forging
 * runs at half speed until someone holds Y there to mend it. Six sockets
 * round the dais take **beskar shields** — waist-high cover walls, three up
 * at once for the party, re-placeable — so where the walls go is the plan.
 *
 * **Escalation.** A short breath to raise the shields, then waves by the
 * forging's progress, one tunnel at a time (north, east, west), drones down
 * the shaft from the third, two tunnels at once for the fourth, and the
 * finale from all three with the alamite chieftain. The metal is done when
 * the bar is full *and* the chieftain is down: the climax is a fight, never
 * a timer running out.
 *
 * **Failing.** It cannot be lost, only slowed: if the Armorer falls the
 * forging slips back to its last quarter mark and she stands again at her
 * anvil ten seconds later. The fallen re-form on the dais.
 *
 * **The reward.** Beskar for every hunter — +25 max health for the rest of
 * the run (`Player.maxHpBonus`, which a respawn and a body swap both keep) —
 * and the flight-rated boosters that Covert Sky flies on. The party gathers
 * at the forge under the shaft, and the next stage begins at its foot.
 */

/** the hall's radius, metres (fifty across) */
const R = 25;
const WALL_H = 12;
/** the open shaft over the dais */
const OCULUS = 9;
const SHAFT_H = 64;
/** tunnel half-width, height and length past the wall */
const TW = 3.5;
const TH = 7;
const TL = 16;
/** the dais: two tiers, each a step the legs take (the physics steps 0.55) */
const TIER1 = { r: 9.5, h: 0.5 };
const TIER2 = { r: 7, h: 1.0 };
/** a barricade socket's distance from the centre */
const SOCKET_R = 12.5;
/** how many shields may stand at once, party-wide */
const SHIELDS = 3;
/** a hostile this close to the Armorer stalls the forging */
const STALL_R = 6;
/** a hostile this close to a bellows works it to pieces */
const BELLOWS_R = 2.6;
const BELLOWS_HP = 100;
/** the bellows' damage per hostile, a second */
const BELLOWS_WEAR = 10;
/** seconds of warning a wave's tunnel gives */
const WAVE_WARN = 3;

/** cylinder angle convention (three.js): x = sin θ, z = cos θ */
const dirOf = (theta: number): THREE.Vector3 => new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
/** the three tunnels the waves come down: north, east, west */
const PASS_THETA = [0, Math.PI / 2, -Math.PI / 2];

interface Wave { at: number; passes: number[]; budget: number; air: boolean; chief: boolean }

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['hold-the-forge'];
  const party = Math.max(1, game.players.length);
  const solo = party === 1;
  const DAIS = Y0 + TIER2.h;

  // ---- materials ----
  const relief = ctx.paint(spec.palette.wall, { rough: 0.9, metal: 0.05 });
  ctx.tile(relief, 'forge_relief', 10, 1.4, { normal: true });
  relief.side = THREE.DoubleSide;
  const stone = ctx.paint(spec.palette.rock, { rough: 0.92, metal: 0.05 });
  ctx.tile(stone, 'cliff_ruin', 4, 4, { normal: true });
  stone.side = THREE.DoubleSide;
  const floorMat = ctx.paint(spec.palette.floor, { rough: 0.85, metal: 0.1 });
  ctx.tile(floorMat, 'glass_plain', 6, 6);
  const daisMat = ctx.paint(0x5a5f58, { rough: 0.7, metal: 0.25 });
  ctx.tile(daisMat, 'forge_relief', 3, 0.3);
  const iron = ctx.paint(0x3a3632, { rough: 0.55, metal: 0.75 });
  const beskar = ctx.paint(0x6f7a86, { rough: 0.35, metal: 0.9 });
  const gold = ctx.paint(spec.palette.trim, { rough: 0.4, metal: 0.8 });
  const glowMat = new THREE.MeshBasicMaterial({ color: spec.palette.accent });
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x7a1e1a, roughness: 0.95, side: THREE.DoubleSide });
  const dark = new THREE.MeshBasicMaterial({ color: 0x050504 });
  for (const m of [glowMat, emberMat, clothMat, dark]) ctx.own(m);
  const geo = <G extends THREE.BufferGeometry>(g: G): G => ctx.own(g);

  // ---- the floor ----
  // one slab under the hall and all four tunnels
  ctx.box(0, Y0 - 1, 0, (R + TL + 3) * 2, 2, (R + TL + 3) * 2, floorMat);

  // ---- the wall: carved relief round the hall, open at the four tunnels ----
  // Colliders are a ring of overlapping columns (the physics has no curved
  // wall); what is seen is one carved band, cut where the tunnels come in.
  const gap = Math.atan2(TW + 0.4, R);
  for (let q = 0; q < 4; q++) {
    const a0 = q * (Math.PI / 2) + gap;
    const len = Math.PI / 2 - gap * 2;
    const band = new THREE.Mesh(geo(new THREE.CylinderGeometry(R + 0.4, R + 0.4, WALL_H, 28, 1, true, a0, len)), relief);
    band.position.set(0, Y0 + WALL_H / 2, 0);
    band.receiveShadow = true;
    ctx.mesh(band);
    // the lintel over each tunnel mouth
    const lint = new THREE.Mesh(geo(new THREE.CylinderGeometry(R + 0.4, R + 0.4, WALL_H - TH, 6, 1, true, q * (Math.PI / 2) - gap, gap * 2)), stone);
    lint.position.set(0, Y0 + TH + (WALL_H - TH) / 2, 0);
    ctx.mesh(lint);
  }
  const posts = 56;
  for (let i = 0; i < posts; i++) {
    const th = (i / posts) * Math.PI * 2;
    // skip the columns standing in a tunnel mouth
    const near = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2].some((t) => Math.abs(th - t) < gap + 0.05);
    if (near) continue;
    const d = dirOf(th);
    ctx.cyl(d.x * (R + 2.2), Y0 + WALL_H / 2, d.z * (R + 2.2), 2.4, WALL_H + 2, null);
  }
  // the roof: a stone ring round the shaft, and the shaft itself up to the sky
  const roof = new THREE.Mesh(geo(new THREE.RingGeometry(OCULUS, R + 1, 48, 1)), stone);
  roof.rotation.x = Math.PI / 2;
  roof.position.y = Y0 + WALL_H;
  ctx.mesh(roof);
  const shaft = new THREE.Mesh(geo(new THREE.CylinderGeometry(OCULUS, OCULUS + 1.5, SHAFT_H, 32, 1, true)), stone);
  shaft.position.set(0, Y0 + WALL_H + SHAFT_H / 2, 0);
  ctx.mesh(shaft);
  const skyLight = new THREE.PointLight(0xfff0d8, 30, 60, 1.2);
  skyLight.position.set(0, Y0 + WALL_H + 4, 0);
  ctx.mesh(skyLight);

  // ---- the tunnels: three the waves come down, and the vault passage ----
  // Each is a stone tube whose far end turns out of sight into the dark, so
  // it reads as a way in for them and not a way out for anyone.
  const tunnel = (theta: number, sealed: boolean): void => {
    const d = dirOf(theta);
    const along = Math.abs(d.x) > 0.5 ? 'x' : 'z';
    const mid = R + TL / 2;
    const cx = d.x * mid, cz = d.z * mid;
    const sx = along === 'x' ? TL : TW * 2 + 2, sz = along === 'x' ? TW * 2 + 2 : TL;
    ctx.box(cx, Y0 + TH + 1, cz, sx + 2, 2, sz + 2, stone);   // roof
    const side = (s: number): void => {
      const ox = along === 'x' ? 0 : s * (TW + 1), oz = along === 'x' ? s * (TW + 1) : 0;
      ctx.box(cx + ox, Y0 + TH / 2, cz + oz, along === 'x' ? TL : 2, TH, along === 'x' ? 2 : TL, relief);
    };
    side(-1); side(1);
    const end = R + TL + 1;
    ctx.box(d.x * end, Y0 + TH / 2, d.z * end, along === 'x' ? 2 : TW * 2 + 4, TH, along === 'x' ? TW * 2 + 4 : 2, sealed ? iron : dark);
    if (sealed) {
      // the vault's far door, shut behind the party: a round beskar door in its frame
      const door = new THREE.Mesh(geo(new THREE.CylinderGeometry(TW - 0.2, TW - 0.2, 0.6, 32)), beskar);
      door.rotation.x = Math.PI / 2;
      door.position.set(d.x * (end - 1.2), Y0 + TW, d.z * (end - 1.2));
      ctx.mesh(door);
      const hub = new THREE.Mesh(geo(new THREE.TorusGeometry(1.1, 0.18, 8, 24)), gold);
      hub.position.copy(door.position).addScaledVector(d, -0.4);
      ctx.mesh(hub);
    }
  };
  tunnel(0, false);
  tunnel(Math.PI / 2, false);
  tunnel(-Math.PI / 2, false);
  tunnel(Math.PI, true);

  // each wave tunnel's mouth burns red for the warning before a wave
  const mouthLights = PASS_THETA.map((th) => {
    const d = dirOf(th);
    const l = new THREE.PointLight(0xff3a1a, 0, 22, 1.5);
    l.position.set(d.x * (R + 2), Y0 + TH - 1, d.z * (R + 2));
    ctx.mesh(l);
    return l;
  });

  // ---- dressing: fire bowls on posts and hanging banners round the wall ----
  const bowlGeo = geo(new THREE.CylinderGeometry(0.8, 0.4, 0.5, 12));
  const fireGeo = geo(new THREE.ConeGeometry(0.5, 1.1, 8, 1, true));
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff9a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  ctx.own(flameMat);
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const d = dirOf(th);
    const at = new THREE.Vector3(d.x * (R - 2.5), Y0, d.z * (R - 2.5));
    ctx.cyl(at.x, Y0 + 0.9, at.z, 0.35, 1.8, iron);
    const bowl = new THREE.Mesh(bowlGeo, iron);
    bowl.position.set(at.x, Y0 + 2.0, at.z);
    const fire = new THREE.Mesh(fireGeo, flameMat);
    fire.position.set(at.x, Y0 + 2.7, at.z);
    flames.push(fire);
    ctx.mesh(bowl); ctx.mesh(fire);
    // a banner on the wall behind every other bowl
    if (i % 2 === 0) {
      const cloth = new THREE.Mesh(geo(new THREE.PlaneGeometry(2.4, 6)), clothMat);
      cloth.position.set(d.x * (R - 0.2), Y0 + 7, d.z * (R - 0.2));
      cloth.lookAt(0, Y0 + 7, 0);
      ctx.mesh(cloth);
      const sigil = new THREE.Mesh(geo(new THREE.RingGeometry(0.5, 0.7, 3)), gold);
      sigil.position.copy(cloth.position).addScaledVector(d, -0.05);
      sigil.lookAt(0, Y0 + 7, 0);
      ctx.mesh(sigil);
    }
  }

  // ---- the dais, the forge, the anvil ----
  ctx.cyl(0, Y0 + TIER1.h / 2, 0, TIER1.r, TIER1.h, daisMat);
  ctx.cyl(0, Y0 + TIER2.h / 2, 0, TIER2.r, TIER2.h, daisMat);
  const brazierAt = new THREE.Vector3(0, DAIS, 0);
  ctx.prop('forge_brazier', brazierAt, {
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
  const forgeLight = new THREE.PointLight(0xff8a3a, 60, 34, 1.4);
  forgeLight.position.set(0, DAIS + 3, 0);
  ctx.mesh(forgeLight);
  // the anvil the Armorer works at, south of the fire (toward the party's door)
  const anvilAt = new THREE.Vector3(0, DAIS, -3.0);
  ctx.box(anvilAt.x, DAIS + 0.4, anvilAt.z, 1.4, 0.8, 0.7, iron);
  const hot = new THREE.Mesh(geo(new THREE.BoxGeometry(0.8, 0.08, 0.35)), emberMat);
  hot.position.set(anvilAt.x, DAIS + 0.84, anvilAt.z);
  ctx.mesh(hot);
  const armorerPost = new THREE.Vector3(0, DAIS, -4.3);

  // ---- the bellows, one each side of the fire ----
  const interactions = new Interactions();
  const bellows = [-1, 1].map((s) => {
    const at = new THREE.Vector3(s * 3.4, DAIS, -1.0);
    ctx.box(at.x, DAIS + 0.55, at.z, 1.4, 1.1, 1.6, null);
    const g = new THREE.Group();
    const board = new THREE.Mesh(geo(new THREE.BoxGeometry(1.4, 0.12, 1.6)), iron);
    const top = board.clone();
    const hide = new THREE.Mesh(geo(new THREE.BoxGeometry(1.2, 1, 1.4)), ctx.paint(0x5a3a22, { rough: 0.95 }));
    const nozzle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.1, 0.18, 1.2, 8)), iron);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.rotation.z = s * 0.9;
    nozzle.position.set(-s * 0.9, 0.5, 0.2);
    board.position.y = 0.06;
    g.add(board, top, hide, nozzle);
    g.position.copy(at);
    ctx.mesh(g);
    const b = { at, g, top, hide, hp: BELLOWS_HP, broken: false, it: null as Interactable | null };
    b.it = interactions.add({
      pos: at, hold: solo ? 3 : 4, radius: 2.6, verb: T.bellowsVerb, once: false,
      enabled: () => b.broken,
      onDone: () => { b.broken = false; b.hp = BELLOWS_HP; hide.scale.y = 1; },
    });
    return b;
  });

  // ---- the barricade sockets and the beskar shields ----
  type Socket = { at: THREE.Vector3; theta: number; up: boolean; raiseT: number; boxes: StaticBox[]; wall: THREE.Group; it: Interactable };
  const raisedOrder: Socket[] = [];
  const shieldGeo = geo(new THREE.BoxGeometry(3, 1.2, 0.35));
  const rimGeo = geo(new THREE.BoxGeometry(3.1, 0.12, 0.42));
  const crestGeo = geo(new THREE.CircleGeometry(0.28, 3));
  const plateGeo = geo(new THREE.CylinderGeometry(1.6, 1.6, 0.06, 20));
  const sockets: Socket[] = [];
  for (const pass of PASS_THETA) {
    for (const off of [-0.42, 0.42]) {
      const theta = pass + off;
      const d = dirOf(theta);
      const at = new THREE.Vector3(d.x * SOCKET_R, Y0, d.z * SOCKET_R);
      const plate = new THREE.Mesh(plateGeo, glowMat);
      plate.position.set(at.x, Y0 + 0.03, at.z);
      ctx.mesh(plate);
      // the stand-in is the spec: 3 m wide, 1.2 m tall, pivot at the foot
      const wall = new THREE.Group();
      const face = new THREE.Mesh(shieldGeo, beskar);
      face.position.y = 0.6;
      const rim = new THREE.Mesh(rimGeo, gold);
      rim.position.y = 1.2;
      const crest = new THREE.Mesh(crestGeo, gold);
      crest.position.set(0, 0.7, 0.19);
      wall.add(face, rim, crest);
      // the stand-in and the sculpt share one parent, which is what rises
      const holder = ctx.prop('beskar_barricade', new THREE.Vector3(), { size: 3, fallback: () => wall }).parent as THREE.Group;
      holder.position.set(at.x, Y0 - 1.2, at.z);
      holder.rotation.y = theta;           // the face looks out, toward the tunnel
      holder.visible = false;
      const sock: Socket = { at, theta, up: false, raiseT: 0, boxes: [], wall: holder, it: null as unknown as Interactable };
      sock.it = interactions.add({
        pos: at, hold: 1.2, radius: 2.4, verb: T.socketVerb, once: false,
        enabled: () => !sock.up,
        onDone: () => raise(sock),
      });
      sockets.push(sock);
    }
  }
  function raise(s: Socket): void {
    if (s.up) return;
    // three for the party at once: the oldest folds to make the new one
    if (raisedOrder.length >= SHIELDS) fold(raisedOrder[0]);
    s.up = true;
    s.raiseT = 0;
    s.wall.visible = true;
    // three overlapping blocks along the face: the physics has no turned box
    const tan = new THREE.Vector3(Math.cos(s.theta), 0, -Math.sin(s.theta));
    for (const k of [-1, 0, 1]) {
      s.boxes.push(ctx.box(s.at.x + tan.x * k, Y0 + 0.6, s.at.z + tan.z * k, 1.05, 1.2, 1.05, null).box);
    }
    raisedOrder.push(s);
    audio.clash('steel');
    game.particles.impactSparks(new THREE.Vector3(s.at.x, Y0 + 1, s.at.z), 12);
  }
  function fold(s: Socket): void {
    if (!s.up) return;
    s.up = false;
    s.wall.visible = false;
    for (const b of s.boxes) ctx.unsolid({ box: b });
    s.boxes = [];
    const i = raisedOrder.indexOf(s);
    if (i >= 0) raisedOrder.splice(i, 1);
  }

  // ---- the Armorer ----
  // She is an ally body on the escort AI, pinned to her anvil: its anchor is
  // her post, not a player, so she fights what reaches the dais and walks
  // back to her work when it is clear. Her body is the Armorer's own, with
  // her hammer in hand.
  const hpFor = party === 1 ? 900 : party === 2 ? 1100 : 1400;
  const anchor = { position: armorerPost.clone(), alive: true, team: 0 };
  const makeArmorer = (post: THREE.Vector3): Enemy => {
    const e = new Enemy('marshal', post.clone(), 0, { silent: true });
    disposeSubtree(e.char.root);
    const fighter = buildMandalorian('armorer');
    fighter.setWeapon('gaffi');
    let step = 0;
    e.char = {
      ...fighter,
      attack: () => {
        step = (step % 3) + 1;
        return fighter.animator?.playOnce('upper', `melee${step}`, 0.06) ?? 0.5;
      },
    };
    e.char.root.position.copy(post);
    e.def = {
      ...e.def, hp: hpFor, speed: 5.4, style: 'melee', damage: 30,
      attackRange: 2.1, attackCd: 1.15, notice: 40,
    };
    e.hp = e.maxHp = hpFor;
    e.setOwner(anchor);
    e.facingYaw = Math.atan2(anvilAt.x - post.x, anvilAt.z - post.z);
    game.addAlly(e, 10);
    return e;
  };
  const armorer = new DefendTarget(game, {
    make: makeArmorer, post: armorerPost, leash: 2.6, weight: 2.6, reform: 10,
    regen: 18, threat: STALL_R,
    onDown: () => {
      progress.setBack();
      ctx.announce(T.armorerFell, T.armorerFellSub);
    },
    onUp: () => ctx.announce(T.armorerUp, T.mark(Math.floor(progress.value * 100))),
  });

  // ---- the forging and the waves ----
  const progress = new Progress(solo ? 120 : party === 2 ? 165 : 180);
  const waves: Wave[] = solo
    ? [
      { at: 0, passes: [0], budget: 3, air: false, chief: false },
      { at: 0.2, passes: [1], budget: 4, air: false, chief: false },
      { at: 0.4, passes: [2], budget: 4, air: true, chief: false },
      { at: 0.58, passes: [0], budget: 5, air: false, chief: false },
      { at: 0.76, passes: [1], budget: 5, air: true, chief: true },
    ]
    : [
      { at: 0, passes: [0], budget: 3 + party, air: false, chief: false },
      { at: 0.17, passes: [1], budget: 3 + party, air: false, chief: false },
      { at: 0.34, passes: [2], budget: 4 + party, air: true, chief: false },
      { at: 0.52, passes: [0, 1], budget: 5 + party, air: false, chief: false },
      { at: 0.72, passes: [0, 1, 2], budget: 6 + party, air: true, chief: true },
    ];
  let waveIdx = 0;
  let warnT = -1;
  const finalBodies: Enemy[] = [];
  let chief: Enemy | null = null;

  const launchWave = (w: Wave): void => {
    const last = w === waves[waves.length - 1];
    w.passes.forEach((pi, n) => {
      const d = dirOf(PASS_THETA[pi]);
      const share = Math.max(2, Math.round(w.budget / w.passes.length));
      const kinds = ctx.squadFor(ctx.wave + waveIdx, share, { air: false });
      kinds.forEach((kind, i) => {
        const along = R + 6 + (i % 3) * 3.2;
        const across = ((Math.floor(i / 3) % 2) ? -1 : 1) * (i % 2) * 1.6;
        const at = new THREE.Vector3(d.x * along + d.z * across, Y0, d.z * along - d.x * across);
        const e = ctx.spawn(kind, at, { exact: true, alert: true, squad: 8840 + waveIdx * 4 + n });
        if (last) finalBodies.push(e);
      });
    });
    if (w.air) {
      // drones down the shaft, from the third wave on
      const kinds: EnemyKind[] = Array.from({ length: solo ? 1 : Math.min(3, 1 + Math.floor(party / 2)) }, () => 'drone');
      kinds.forEach((kind, i) => {
        const a = (i / kinds.length) * Math.PI * 2;
        const e = ctx.spawn(kind, new THREE.Vector3(Math.cos(a) * 5, Y0 + 9.5, Math.sin(a) * 5), { exact: true, alert: true });
        if (last) finalBodies.push(e);
      });
    }
    if (w.chief) {
      const d = dirOf(PASS_THETA[w.passes[0]]);
      chief = ctx.spawn('alamite', new THREE.Vector3(d.x * (R + 4), Y0, d.z * (R + 4)), { exact: true, alert: true, squad: 8899 });
      chief.promoteBoss(T.chieftain, solo ? 12 : 8 + party * 3, 1.5);
      game.boss = chief;
      finalBodies.push(chief);
    }
    mouthLights.forEach((l) => { l.intensity = 0; });
  };

  // ---- state ----
  let started = false;
  let prepT = solo ? 10 : 12;
  let phase: 'prep' | 'forging' | 'quench' | 'gift' | 'gather' = 'prep';
  let giftT = 0;
  let complete = false;
  let bellowsNoted = false;
  let hammerT = 0;
  const cursors = [0, 0, 0, 0];
  const daisSpot = (slot: number): THREE.Vector3 => {
    // round the dais edge, facing out; clear of the anvil (south) and the bellows
    const a = [Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.25, -Math.PI * 0.75][slot % 4] + Math.floor(slot / 4) * 0.2;
    return new THREE.Vector3(Math.sin(a) * 5.4, DAIS, Math.cos(a) * 5.4 + 0.6);
  };
  ctx.checkpoint.copy(daisSpot(0));

  const livingHostiles = (): Enemy[] => game.enemies.filter((e) => e.alive && e.team !== 0);

  const update = (dt: number): void => {
    if (complete) return;
    if (!started) {
      started = true;
      ctx.announce(T.title, T.sub);
      for (let i = 0; i < 1 + party; i++) {
        const a = Math.PI + (i - party / 2) * 0.5;
        ctx.pickup(new THREE.Vector3(Math.sin(a) * 16, Y0, Math.cos(a) * 16));
      }
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, _dt, input) => interactions.swallow(pl.slot, pl.position, input),
        });
      }
    }

    interactions.update(dt, game);
    armorer.update(dt);
    const her = armorer.body;

    // she works at the anvil while the dais is clear: back to her post,
    // facing the metal, the hammer coming down every second or so
    const pressed = armorer.hostilesWithin(8) > 0;
    if (her.alive && !pressed && phase !== 'gather' && phase !== 'gift') {
      her.position.x = armorerPost.x; her.position.z = armorerPost.z;
      her.velocity.x = 0; her.velocity.z = 0;
      her.facingYaw = Math.atan2(anvilAt.x - armorerPost.x, anvilAt.z - armorerPost.z);
      hammerT -= dt;
      if (hammerT <= 0 && phase !== 'prep') {
        hammerT = 1.1 + Math.random() * 0.3;
        her.char.attack?.();
        game.particles.impactSparks(new THREE.Vector3(anvilAt.x, DAIS + 0.9, anvilAt.z), 10);
        if (Math.random() < 0.5) audio.clash('steel');
      }
    }
    flames.forEach((f, i) => {
      const k = 0.8 + 0.25 * Math.sin(game.time * 11 + i * 1.7) + 0.1 * Math.sin(game.time * 23 + i);
      f.scale.set(0.9 + 0.1 * k, k, 0.9 + 0.1 * k);
    });
    (hot.material as THREE.MeshBasicMaterial).color.setHSL(0.06, 1, 0.45 + progress.value * 0.2);
    forgeLight.intensity = 50 + Math.sin(game.time * 7) * 6 + (bellows.some((b) => b.broken) ? -25 : 0);

    // the bellows: a hostile working at one wears it down; broken, it droops
    for (const b of bellows) {
      const pump = 0.75 + (b.broken ? 0 : 0.2 * Math.sin(game.time * 2.4 + b.at.x));
      b.top.position.y = pump * 1.1;
      if (!b.broken) b.hide.scale.y = pump;
      b.hide.position.y = b.hide.scale.y * 0.5;
      if (b.broken) continue;
      let n = 0;
      for (const e of game.enemies) {
        if (!e.alive || e.team === 0 || Math.abs(e.position.y - DAIS) > 3) continue;
        if (Math.hypot(e.position.x - b.at.x, e.position.z - b.at.z) < BELLOWS_R) n++;
      }
      b.hp -= n * BELLOWS_WEAR * dt;
      if (b.hp <= 0) {
        b.broken = true;
        b.hide.scale.y = 0.25;
        game.particles.dustPuff(b.at, 14);
        ctx.announce(T.bellowsDown, T.bellowsDownSub);
        bellowsNoted = true;
      }
    }
    const broken = bellows.some((b) => b.broken);

    // the shields rise out of their sockets
    for (const s of sockets) {
      if (!s.up || s.raiseT >= 1) continue;
      s.raiseT = Math.min(1, s.raiseT + dt / 0.4);
      s.wall.position.y = Y0 - 1.2 + 1.2 * s.raiseT;
    }

    // ---- the phases ----
    if (phase === 'prep') {
      prepT -= dt;
      if (prepT <= 0) phase = 'forging';
    }
    if (phase === 'forging' || phase === 'quench') {
      const stall = armorer.down || armorer.crowd > 0;
      const mark = progress.update(dt, { stall, scale: broken ? 0.5 : 1 });
      if (mark !== null && mark < 1) ctx.announce(T.mark(Math.round(mark * 100)), stall ? T.holdStalled : T.hold);
      // the next wave: its tunnel burns red, then they come
      const next = waves[waveIdx];
      if (next && warnT < 0 && progress.value >= next.at) {
        warnT = WAVE_WARN;
        for (const pi of next.passes) mouthLights[pi].intensity = 40;
        const last = waveIdx === waves.length - 1;
        ctx.announce(last ? T.finalWave : T.wave(T.passes[next.passes[0]]), last ? T.finalSub : T.waveSub);
      }
      if (warnT >= 0) {
        warnT -= dt;
        const flick = 30 + Math.sin(game.time * 20) * 12;
        if (next) for (const pi of next.passes) mouthLights[pi].intensity = flick;
        if (warnT < 0 && next) {
          launchWave(next);
          waveIdx++;
        }
      }
      if (progress.done) {
        phase = 'quench';
        const finalOut = waveIdx >= waves.length && finalBodies.every((e) => !e.alive);
        if (finalOut) {
          phase = 'gift';
          giftT = 0;
          // the reward: beskar for every hunter, for the rest of the run
          for (const p of game.players) {
            p.maxHpBonus += 25;
            p.maxHp += 25;
            p.hp = p.maxHp;
            game.particles.impactSparks(p.position.clone().setY(p.position.y + 1.2), 24);
          }
          audio.clash('steel');
          ctx.announce(T.giftTitle, T.giftSub);
          for (const e of livingHostiles()) e.damage(99999, e.position, -1);
        }
      }
    }
    if (phase === 'gift') {
      giftT += dt;
      skyLight.intensity = 30 + Math.min(40, giftT * 12);
      if (giftT >= 3.5) {
        phase = 'gather';
        giftT = 0;
        ctx.announce(T.boosters, T.boostersSub);
      }
    }
    if (phase === 'gather') {
      giftT += dt;
      const onDais = (p: { position: THREE.Vector3 }) => Math.hypot(p.position.x, p.position.z) < TIER1.r && p.position.y > Y0 + 0.3;
      const living = game.players.filter((p) => p.alive);
      if (giftT > 2 && ((living.length && living.every(onDais)) || giftT > 16)) complete = true;
    }
    if (!bellowsNoted && broken) bellowsNoted = true;
  };

  const objective = () => {
    if (phase === 'prep') {
      const free = sockets.find((s) => !s.up) ?? sockets[0];
      return { pos: free.at.clone(), label: T.socketVerb, hint: T.prep, beacon: false };
    }
    if (phase === 'gift' || phase === 'gather') {
      return { pos: new THREE.Vector3(0, DAIS, 0), label: T.shaftLabel, hint: T.shaftHint, beacon: false };
    }
    if (phase === 'quench' && chief && (chief as Enemy).alive) {
      return { pos: (chief as Enemy).position.clone(), label: T.chieftain, hint: T.quench, beacon: false };
    }
    const brokenB = bellows.find((b) => b.broken);
    if (brokenB) return { pos: brokenB.at.clone(), label: T.bellowsVerb, hint: T.bellowsHint, beacon: false };
    const stalled = armorer.down || armorer.crowd > 0;
    return {
      pos: armorer.down ? armorerPost.clone() : armorer.body.position.clone(),
      label: T.forge, hint: stalled ? T.holdStalled : T.hold, beacon: false,
    };
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [
      progress.bar(progress.stalled ? T.stalled : T.forging),
      armorer.bar(T.armorer, T.armorerDown),
    ];
    const at = interactions.hudFor(p.position);
    if (at) bars.push({ ...at.bar, label: at.bar.label === T.bellowsVerb ? T.bellowsBar : T.socketBar });
    let line = at?.line;
    if (!line) {
      if (phase === 'prep') line = T.prep;
      else if (bellows.some((b) => b.broken)) line = T.bellowsBroken;
      else line = `${T.shield} ${raisedOrder.length}/${SHIELDS}`;
    }
    return { title: T.title, bars, line };
  };

  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    // mend a broken bellows, if this is the nearest bot to it
    const brokenB = bellows.find((b) => b.broken);
    let goal: THREE.Vector3 | null = null;
    let hold = false;
    if (brokenB) {
      let nearest = -1, bestD = Infinity;
      for (const q of game.players) {
        if (!q.alive) continue;
        const d = q.position.distanceTo(brokenB.at);
        if (d < bestD) { bestD = d; nearest = q.slot; }
      }
      if (nearest === slot) { goal = brokenB.at; hold = true; }
    }
    // the breath before it starts: raise a shield at "your" socket
    if (!goal && phase === 'prep' && slot < SHIELDS) {
      const s = sockets[(slot * 2) % sockets.length];
      if (!s.up) { goal = s.at; hold = true; }
    }
    if (!goal) goal = daisSpot(slot);
    const dx = goal.x - p.position.x, dz = goal.z - p.position.z;
    const dist = Math.hypot(dx, dz);
    const out: AutopilotInput = { shootHeld: true };
    if (dist > (hold ? 1.2 : 0.8)) {
      out.yaw = Math.atan2(dx, dz);
      out.moveY = Math.min(1, dist / 2);
      cursors[slot] = 0;
    } else {
      if (hold) out.interactHeld = true;
      // on station: face the nearest hostile
      let best: Enemy | null = null, bestD = Infinity;
      for (const e of game.enemies) {
        if (!e.alive || e.team === 0) continue;
        const d = e.position.distanceToSquared(p.position);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) out.yaw = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
    }
    return out;
  };

  const startAt = (i: number) => new THREE.Vector3((i % 2) * 2.4 - 1.2, Y0, -R - 4 - Math.floor(i / 2) * 2.2);

  const inst: SectionInstance = {
    starts: [0, 1, 2, 3].map(startAt),
    floorY: Y0,
    ceilingY: Y0 + WALL_H - 0.5,
    groundAt: (x, z) => {
      const r = Math.hypot(x, z);
      return r < TIER2.r ? Y0 + TIER2.h : r < TIER1.r ? Y0 + TIER1.h : Y0;
    },
    contains: (x, z) => {
      if (Math.hypot(x, z) < R - 0.5) return true;
      const inX = Math.abs(x) < TW && Math.abs(z) > R - 2 && Math.abs(z) < R + TL;
      const inZ = Math.abs(z) < TW && Math.abs(x) > R - 2 && Math.abs(x) < R + TL;
      return inX || inZ;
    },
    path: [startAt(0), new THREE.Vector3(0, Y0, -R + 2), new THREE.Vector3(0, Y0, -TIER1.r - 1), daisSpot(0)],
    update,
    get complete() { return complete; },
    objective,
    respawnSpot: (slot) => ctx.defaultRespawn(slot, daisSpot(slot), new THREE.Vector3(0, 0, 1)),
    hud,
    autopilot,
    dispose: () => {
      for (const p of game.players) p.sectionMove = null;
      armorer.body.removeMe = true;
      if (game.boss === chief) game.boss = null;
    },
    debug: () => ({
      phase, progress: Math.round(progress.value * 100), wave: waveIdx, armorer: Math.round(armorer.body.hp),
      down: armorer.down, crowd: armorer.crowd, shields: raisedOrder.length,
      bellows: bellows.map((b) => Math.round(b.hp)), maxHp: game.players.map((p) => p.maxHp),
    }),
  };
  // for tools/test-section-forge.mjs: the live pieces, and a way to skip the clock
  (inst as unknown as { probe: unknown }).probe = {
    armorer, progress, bellows, sockets, raised: raisedOrder, waves,
    phase: () => phase,
    raise: (i: number) => raise(sockets[i]),
    /** jump the forging to `v`, with every wave already sent and beaten */
    skipTo: (v: number) => { phase = 'forging'; prepT = 0; progress.value = v; waveIdx = waves.length; finalBodies.length = 0; },
  };
  return inst;
}

export const holdTheForge: SectionDef = {
  id: 'hold-the-forge',
  build,
  // the covert's own air: warm and close, the sky only up the shaft
  world: { fogColor: 0x241c14, fogNear: 30, fogFar: 140, fill: 1.1 },
};
