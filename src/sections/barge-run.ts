import * as THREE from 'three';
import { TEXT } from '../text';
import type { SectionDef, SectionInstance, SectionHud, SectionBar, AutopilotInput } from './api';
import type { SectionContext } from './context';
import type { Enemy, EnemyKind } from '../enemies/enemy';
import type { Player } from '../player/player';
import type { FrameInput } from '../core/input';
import type { StaticBox } from '../core/physics';
import type { Game } from '../game/game';
import { Mover, addBreakable, type Breakable } from '../world/board';
import { audio } from '../core/audio';
import { Treadmill, type ConveyorItem } from './kit/treadmill';
import { Interactions } from './kit/interact';
import { composeMoves } from './kit/moves';
import { BARGE, SKIFF, buildBarge, buildSkiff } from './barge-hull';
import { worldBox, rockColumn } from './dune-dressing';

/**
 * The Barge Run (docs/LEVEL_SECTIONS.md §2.1) — the Dune Sea, after the
 * ravine and the cistern court (stage B), before Worm Sign.
 *
 * The cistern court's far door is an airlock onto the far side of the mesas.
 * It opens onto a skiff landing cut into the mesa foot: a rock ledge, the
 * mooring posts, the party's skiff tied up — and out on the open dunes, the
 * Tusken sail barge the party is after, pulling away under full canvas.
 *
 * **Built on K2, the treadmill.** Neither hull moves in physics. The dunes
 * do: the sand's picture slides astern at fourteen metres a second, dune
 * ridges, rocks and buttes come by on the conveyor, dust streams off both
 * hulls, and the landing itself slides away behind as the skiff casts off.
 * What *does* move is the gap: the skiff's lateral offset is a `Mover`, so
 * the party is carried in with it from twenty-six metres off to nine.
 *
 * **The beats.**
 *
 * 1. **Broadside.** The skiff holds twenty-six metres off the barge's port
 *    side. Riflemen on the barge's rails trade fire across the gap, Nikto
 *    swoops strafe the skiff, and the barge's heavy gun lobs shells at it —
 *    each one a ring on the skiff's deck a second and a half before it
 *    lands. The skiff has hull points (the bar on everyone's HUD); the
 *    skiff's own **deck gun** is the tool for the swoops, and it fires on
 *    its own at half rate when nobody is in it, so a solo player can leave
 *    it. Shoot the barge's gunner and the shelling stops.
 * 2. **Close and board.** The skiff pulls in to nine metres — a jetpack hop,
 *    a super-jump, or the two boarding planks the barge's crew drop to come
 *    across themselves. A jump short is a fall to the sand and a re-form on
 *    the skiff. The cargo deck is a fight through the racks, in two waves.
 * 3. **The upper deck.** The stair or the jetpack reaches it. The barge's
 *    heavy gun is there — take it and turn it on the two Tusken skiffs coming
 *    up from astern. When they burn, the helmsman comes out of the wheel to
 *    fight for his ship. Kill him and the barge slews and grounds on a
 *    sandbank, which is where Worm Sign begins.
 *
 * Nothing left behind: falling off either hull re-forms you on the skiff;
 * a straggler still on the landing when it slides away is re-formed on the
 * skiff too. If the skiff's hull points run out in the broadside it breaks
 * up and the party re-forms on a fresh one, and the broadside starts again.
 *
 * **K3.** The two guns are the section's own small `DeckGun` for now,
 * behind an interface the real K3 turret (`kit/mounts.ts`, on the Lava
 * Flats branch) will replace: man it with Y, aim with the camera, fire,
 * mind the heat, jump or Y to get out; unmanned it fires at half rate.
 */

/** the world going by, metres a second */
const SPEED = 14;
/** the skiff's gap to the barge's port side, broadside and alongside */
const GAP_FAR = 26;
const GAP_NEAR = 9;
/** the skiff lies alongside the barge's fore half, where the planks come down */
const SKIFF_Z = 10;
const skiffX = (gap: number): number => -(BARGE.halfBeam + gap + SKIFF.halfBeam);
/** the landing ledge: its top is the skiff's deck, and the mesa behind it */
const LEDGE_W = 12;
/** shells: telegraph seconds, blast radius, and what one costs the skiff */
const SHELL_WARN = 1.5;
const SHELL_R = 2.6;
/** the broadside's length: at least this, and at most that */
const BROADSIDE_MIN = 22;
const BROADSIDE_MAX = 75;
/** a plank's hinge angle stowed: flat on the cargo deck, pointing inboard */
const STOWED = Math.PI - 0.02;

type Phase = 'landing' | 'castoff' | 'broadside' | 'close' | 'deck' | 'upper' | 'helm' | 'grounding' | 'done';

// ---------------------------------------------------------------- the guns

/**
 * The interface the Barge Run needs from a mounted gun. Kept small so the
 * K3 turret can stand in for `DeckGun` without the section changing shape.
 */
interface MountedGun {
  /** the gun's pivot, world space (it rides the skiff: `moveTo`) */
  readonly pos: THREE.Vector3;
  /** the slot in the seat, or −1 */
  gunner: number;
  /** 0..1, and locked out until it has vented */
  readonly heat: number;
  readonly overheated: boolean;
  /** whose side it is on right now (a captured gun changes hands) */
  friendly: boolean;
  moveTo(p: THREE.Vector3): void;
  /** where a gunner stands */
  seat(out: THREE.Vector3): THREE.Vector3;
  update(dt: number, trigger: boolean, targets: THREE.Vector3[]): void;
}

interface GunOpts { rate: number; damage: number; speed: number; heat: number; range: number; barrels: number; size: number;
  /** the trunnion's height over the deck */
  lift: number }

/** the section's own mounted gun until K3 lands (see the file header) */
class DeckGun implements MountedGun {
  readonly pos = new THREE.Vector3();
  gunner = -1;
  heat = 0;
  overheated = false;
  friendly = true;
  /** shots fired, for tests */
  shots = 0;
  private cd = 0;
  private sinceShot = 9;
  private yaw = 0;
  private pitch = 0;
  private barrel = 0;
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private tilt = new THREE.Group();
  private muzzles: THREE.Object3D[] = [];

  constructor(private game: Game, ctx: SectionContext, at: THREE.Vector3, private o: GunOpts, yaw0: number) {
    this.yaw = yaw0;
    const metal = ctx.paint(0x4a4a44, { rough: 0.5, metal: 0.7 });
    const dark = ctx.paint(0x24221e, { rough: 0.6, metal: 0.5 });
    const s = o.size;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * s, 1.1 * s, 0.7 * s, 10), metal);
    base.position.y = 0.35 * s;
    this.group.add(base);
    // the pedestal: a heavy gun stands its barrels over a gunner's head, so it
    // can fire down over its own ship's rail
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.4 * s, o.lift, 8), dark);
    post.position.y = o.lift / 2;
    this.group.add(post);
    ctx.own(post.geometry);
    this.head.position.y = Math.max(0.7 * s, o.lift - 0.7 * s);
    this.group.add(this.head);
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.8 * s, 1.0 * s, 0.14 * s), metal);
    shield.position.set(0, 0.8 * s, 0.55 * s);
    this.head.add(shield);
    this.tilt.position.set(0, 0.7 * s, 0.4 * s);
    this.head.add(this.tilt);
    for (let k = 0; k < o.barrels; k++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 1.9 * s, 6), dark);
      b.rotation.x = Math.PI / 2;
      const dx = (k - (o.barrels - 1) / 2) * 0.28 * s;
      b.position.set(dx, 0, 0.95 * s);
      this.tilt.add(b);
      const m = new THREE.Object3D();
      m.position.set(dx, 0, 1.95 * s);
      this.tilt.add(m);
      this.muzzles.push(m);
    }
    for (const mesh of [base, shield]) mesh.castShadow = true;
    ctx.own(base.geometry); ctx.own(shield.geometry);
    ctx.mesh(this.group);
    this.moveTo(at);
  }

  moveTo(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.group.position.copy(p);
  }

  seat(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x - Math.sin(this.yaw) * 1.3 * this.o.size, this.pos.y, this.pos.z - Math.cos(this.yaw) * 1.3 * this.o.size);
  }

  /** the aim point: the gunner's camera, soft-locked onto whatever it is near */
  private aim(targets: THREE.Vector3[], muzzle: THREE.Vector3): THREE.Vector3 | null {
    const game = this.game;
    if (this.gunner >= 0) {
      const p = game.players[this.gunner];
      if (!p) return null;
      const dir = p.cam.aimDir(new THREE.Vector3());
      // soft-lock by bearing: the target nearest the aim's heading, within
      // twelve degrees across and a generous band up and down — a gunner
      // steers the gun round, and the gun finds the range
      const aimYaw = Math.atan2(dir.x, dir.z), aimPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      let best: THREE.Vector3 | null = null, bs = Infinity;
      for (const t of targets) {
        const to = t.clone().sub(muzzle);
        const d = to.length();
        if (d > this.o.range || d < 2) continue;
        let dy = Math.atan2(to.x, to.z) - aimYaw;
        dy = Math.abs(Math.atan2(Math.sin(dy), Math.cos(dy)));
        const dp = Math.abs(Math.atan2(to.y, Math.hypot(to.x, to.z)) - aimPitch);
        if (dy > 0.21 || dp > 0.6) continue;
        const score = dy + dp * 0.3;
        if (score < bs) { bs = score; best = t; }
      }
      if (best) return best.clone();
      return muzzle.clone().addScaledVector(dir, 60);
    }
    // on its own: the nearest thing in range
    let best: THREE.Vector3 | null = null, bd = this.o.range;
    for (const t of targets) {
      const d = t.distanceTo(muzzle);
      if (d < bd) { bd = d; best = t; }
    }
    return best ? best.clone() : null;
  }

  update(dt: number, trigger: boolean, targets: THREE.Vector3[]): void {
    this.cd -= dt;
    // it cools once the trigger has been off a moment, not while it is firing
    this.sinceShot += dt;
    if (this.sinceShot > 0.5 || this.overheated) this.heat = Math.max(0, this.heat - dt * 0.4);
    if (this.overheated && this.heat < 0.3) this.overheated = false;
    const muzzle = new THREE.Vector3(this.pos.x, this.pos.y + Math.max(0.7 * this.o.size, this.o.lift - 0.7 * this.o.size) + 0.7 * this.o.size, this.pos.z);
    const at = this.friendly ? this.aim(targets, muzzle) : null;
    if (at) {
      const to = at.clone().sub(muzzle);
      const wantYaw = Math.atan2(to.x, to.z);
      const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
      const turn = this.gunner >= 0 ? 12 : 3;
      let dy = wantYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, turn * dt);
      this.pitch += (THREE.MathUtils.clamp(wantPitch, -0.5, 0.8) - this.pitch) * Math.min(1, turn * dt);
    }
    this.head.rotation.y = this.yaw;
    this.tilt.rotation.x = -this.pitch;
    const manned = this.gunner >= 0;
    const firing = this.friendly && !this.overheated && (manned ? trigger : !!at);
    if (!firing || this.cd > 0 || !at) return;
    this.cd = 1 / (this.o.rate * (manned ? 1 : 0.5));
    const m = this.muzzles[this.barrel++ % this.muzzles.length];
    // (read straight off the node: in a stepped test nothing renders, so no one else refreshes it)
    m.updateWorldMatrix(true, false);
    const from = m.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    this.game.projectiles.fire(from, dir, this.o.speed, this.o.damage, 0, manned ? this.gunner : -1);
    this.shots++;
    this.sinceShot = 0;
    this.game.particles.muzzleFlash(from, dir);
    audio.blaster();
    if (manned) {
      this.heat = Math.min(1, this.heat + this.o.heat);
      if (this.heat >= 1) { this.overheated = true; audio.overheat(); }
    }
  }
}

// ---------------------------------------------------------------- the section

interface Shell { at: THREE.Vector3; t: number; ring: THREE.Mesh }
interface Raider {
  group: THREE.Group;
  /** where it holds station off the starboard side */
  station: THREE.Vector3;
  z: number;
  arrived: boolean;
  b: Breakable | null;
  crew: Enemy[];
  sinking: number;
}

function build(ctx: SectionContext): SectionInstance {
  const { game, spec } = ctx;
  const Y0 = ctx.floorY;
  const T = TEXT.sections['barge-run'];
  const party = Math.max(1, game.players.length);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, Y0 + y, z);
  const rng = (() => { let s = 7654321; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

  // ---- materials ----
  const sandMat = ctx.paint(spec.palette.floor, { rough: 1, metal: 0 });
  ctx.tile(sandMat, 'sand_albedo', 40, 40, { normal: true });
  const rockMat = ctx.paint(spec.palette.rock, { rough: 0.95, metal: 0.02 });
  ctx.tile(rockMat, 'cliff_sandstone', 1, 1, { normal: true });
  const mesaMat = ctx.paint(spec.palette.wall, { rough: 0.95, metal: 0.02 });
  ctx.tile(mesaMat, 'cliff_sandstone', 1, 1, { normal: true });
  const woodMat = ctx.paint(0x5a4028, { rough: 0.9 });
  const doorMat = ctx.paint(0x5a5550, { rough: 0.6, metal: 0.6 });
  ctx.tile(doorMat, 'metal_hull', 1, 1);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  ctx.own(lampMat);
  const shellMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.6, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  ctx.own(shellMat);

  // ---- the treadmill: the world goes astern ----
  const mill = new Treadmill({ dir: new THREE.Vector3(0, 0, -1), speed: 0, ease: 4, board: ctx.board });
  ctx.own(mill);

  // the sand: one flat collider (touching it is a fall), its picture sliding by
  const SAND = 420;
  ctx.box(0, Y0 - 1, 0, SAND, 2, SAND, null);
  {
    const geo = new THREE.PlaneGeometry(SAND, SAND, 1, 1);
    ctx.own(geo);
    const sand = new THREE.Mesh(geo, sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, Y0, 0);
    sand.receiveShadow = true;
    ctx.mesh(sand);
    mill.strip(() => sandMat.map, { metresPerRepeat: SAND / 40, axis: 'y', sign: -1 });
    mill.strip(() => sandMat.normalMap, { metresPerRepeat: SAND / 40, axis: 'y', sign: -1 });
  }

  // ---- the hulls ----
  const barge = buildBarge(ctx, V(0, 0, 0), { sails: 1 });
  const skiff = buildSkiff(ctx, V(skiffX(GAP_FAR), 0, SKIFF_Z), { gaps: BARGE.planks.map((z) => z - SKIFF_Z), gapHalf: BARGE.plankHalf });
  // The skiff's colliders ride one Mover: the envelope is its deck, the rest
  // (rails, bow) are carried rigidly, and whoever stands on it goes with it.
  const skiffMover = new Mover(skiff.envelope, skiff.group);
  skiffMover.carry(skiff.boxes.slice(1));
  (ctx.board.movers ??= []).push(skiffMover);
  let gap = GAP_FAR;
  const skiffDeck = (): THREE.Vector3 => V(skiffX(gap), SKIFF.deck, SKIFF_Z);
  const placeSkiff = (g: number): void => {
    gap = g;
    const c = skiff.envelope.min.clone().add(skiff.envelope.max).multiplyScalar(0.5);
    skiffMover.moveTo(skiffX(g), c.y, c.z);
    skiff.group.position.set(skiffX(g), Y0, SKIFF_Z);
  };
  placeSkiff(GAP_FAR);
  // the barge starts out ahead, pulling away: its picture closes in once the
  // skiff is under way (the colliders are already where it ends up — nobody
  // can reach that water on foot, and the crew is only put aboard once it has)
  const bargeStartZ = 110;
  barge.group.position.z = bargeStartZ;

  // ---- the landing: a ledge cut into the mesa foot, and the airlock ----
  const ledgeX1 = skiffX(GAP_FAR) - SKIFF.halfBeam - 0.1;
  const ledgeX0 = ledgeX1 - LEDGE_W;
  const landing = new THREE.Group();
  ctx.mesh(landing);
  const landingBoxes: StaticBox[] = [];
  const lbox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material | null): void => {
    landingBoxes.push(ctx.box(cx, cy, cz, sx, sy, sz, null).box);
    if (mat) {
      const m = new THREE.Mesh(worldBox(sx, sy, sz, 14), mat);
      ctx.own(m.geometry);
      m.position.set(cx, cy, cz);
      m.castShadow = m.receiveShadow = true;
      landing.add(m);
    }
  };
  // the ledge (the envelope: the first box), then the mesa over it
  lbox((ledgeX0 + ledgeX1) / 2, Y0 + SKIFF.deck / 2, SKIFF_Z, LEDGE_W, SKIFF.deck, 34, rockMat);
  lbox(ledgeX0 - 9, Y0 + 22, SKIFF_Z, 18, 44, 80, mesaMat);
  lbox((ledgeX0 + ledgeX1) / 2, Y0 + 20, SKIFF_Z - 30, LEDGE_W, 40, 26, mesaMat);
  lbox((ledgeX0 + ledgeX1) / 2, Y0 + 20, SKIFF_Z + 30, LEDGE_W, 40, 26, mesaMat);
  // the cistern's airlock: shut in the mesa face, the way the party came
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 5), doorMat);
  ctx.own(door.geometry);
  door.position.set(ledgeX0 + 0.1, Y0 + SKIFF.deck + 2.5, SKIFF_Z);
  landing.add(door);
  for (const dz of [-3, 3]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5.6, 0.6), doorMat);
    ctx.own(jamb.geometry);
    jamb.position.set(ledgeX0 + 0.3, Y0 + SKIFF.deck + 2.8, SKIFF_Z + dz);
    landing.add(jamb);
  }
  const doorLamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2), lampMat);
  ctx.own(doorLamp.geometry);
  doorLamp.position.set(ledgeX0 + 0.35, Y0 + SKIFF.deck + 5.8, SKIFF_Z);
  landing.add(doorLamp);
  // mooring posts along the lip
  for (const dz of [-8, -1, 6, 13]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6), woodMat);
    ctx.own(post.geometry);
    post.position.set(ledgeX1 - 0.6, Y0 + SKIFF.deck + 0.6, SKIFF_Z + dz);
    landing.add(post);
  }
  const landingItem = mill.conveyor(landing, { behind: 260, boxes: landingBoxes });

  // ---- the dunes going by: ridges, rocks and buttes on the conveyor ----
  const LOOP = 440;
  const scenery: ConveyorItem[] = [];
  for (let k = 0; k < 26; k++) {
    const side = k % 2 ? 1 : -1;
    const x = side * (48 + rng() * 90);
    const z = -LOOP / 2 + (k / 26) * LOOP + rng() * 10;
    const g = new THREE.Group();
    g.position.set(x, Y0, z);
    if (rng() < 0.55) {
      // a dune ridge: a long low swell of sand
      const d = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), sandMat);
      ctx.own(d.geometry);
      d.scale.set(10 + rng() * 14, 3 + rng() * 5, 24 + rng() * 30);
      d.rotation.y = (rng() - 0.5) * 0.8;
      g.add(d);
    } else {
      const h = 6 + rng() * 26;
      const r = 3 + rng() * 7;
      const m = new THREE.Mesh(rockColumn(r * 0.7, r, h, 10, k * 1.7, 7), rockMat);
      ctx.own(m.geometry);
      m.position.y = h / 2 - 1;
      m.castShadow = true;
      g.add(m);
    }
    ctx.mesh(g);
    scenery.push(mill.conveyor(g, { behind: LOOP / 2, loop: LOOP }));
  }
  // the far buttes: a slow parallax band
  for (let k = 0; k < 10; k++) {
    const side = k % 2 ? 1 : -1;
    const h = 40 + rng() * 50;
    const r = 12 + rng() * 14;
    const m = new THREE.Mesh(rockColumn(r * 0.8, r * 1.1, h, 18, k * 2.3, 7), mesaMat);
    ctx.own(m.geometry);
    m.position.set(side * (170 + rng() * 60), Y0 + h / 2 - 3, -300 + k * 60);
    ctx.mesh(m);
    mill.parallax(m, 0.18, 600, 300);
  }

  // ---- dust off the hulls: streaks streaming astern at the world's speed ----
  const DUST = 260;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3);
  const dustLife = new Float32Array(DUST);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  ctx.own(dustGeo);
  // a soft round puff, not the square a bare point draws
  const puff = document.createElement('canvas');
  puff.width = puff.height = 64;
  {
    const g2 = puff.getContext('2d')!;
    const grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 64, 64);
  }
  const puffTex = ctx.own(new THREE.CanvasTexture(puff));
  const dustMat = new THREE.PointsMaterial({ color: 0xd8bb88, size: 1.6, map: puffTex, transparent: true, opacity: 0.4, depthWrite: false });
  ctx.own(dustMat);
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  ctx.mesh(dust);
  let dustNext = 0;
  const emitDust = (x: number, y: number, z: number, spread: number): void => {
    const i = dustNext++ % DUST;
    dustPos[i * 3] = x + (Math.random() - 0.5) * spread;
    dustPos[i * 3 + 1] = y + Math.random() * 0.6;
    dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * 1.5;
    dustLife[i] = 1.4;
  };

  // ---- the guns ----
  const deckGun = new DeckGun(game, ctx, V(0, 0, 0),
    { rate: 7, damage: 16, speed: 70, heat: 0.035, range: 75, barrels: 4, size: 0.8, lift: 0.9 }, Math.PI / 2);
  const heavyGun = new DeckGun(game, ctx, barge.toWorld(BARGE.gun),
    { rate: 2.6, damage: 60, speed: 60, heat: 0.08, range: 110, barrels: 2, size: 1.2, lift: 2.8 }, -Math.PI / 2);
  heavyGun.friendly = false;
  heavyGun.group.position.z = BARGE.gun.z + 110;
  const guns: DeckGun[] = [deckGun, heavyGun];
  const deckGunAt = (): THREE.Vector3 => V(skiffX(gap) + SKIFF.gun.x, SKIFF.gun.y, SKIFF_Z + SKIFF.gun.z);
  deckGun.moveTo(deckGunAt());
  const triggers = [false, false, false, false];
  const mountedAt = [0, 0, 0, 0];

  // ---- the boarding planks: stepped, walkable, down from the barge's port rail ----
  const plankFrom = -BARGE.halfBeam;
  const plankTo = (): number => skiffX(GAP_NEAR) + SKIFF.halfBeam - 0.2;
  const planks: { z: number; group: THREE.Group; drop: number; boxes: StaticBox[] }[] = BARGE.planks.map((z) => {
    const g = new THREE.Group();
    const len = plankFrom - plankTo();
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.6, 0.16, BARGE.plankHalf * 1.4), woodMat);
    ctx.own(m.geometry);
    // hinged at the barge's rail; stowed flat on the cargo deck until it is
    // swung over the side like a drawbridge
    m.position.set(-len / 2, 0, 0);
    g.add(m);
    g.position.set(plankFrom, Y0 + BARGE.lower + 0.1, z);
    g.rotation.z = STOWED;
    ctx.mesh(g);
    return { z, group: g, drop: 0, boxes: [] };
  });
  const lowerPlanks = (): void => {
    for (const pl of planks) {
      if (pl.boxes.length) continue;
      // steps from the skiff's rail up to the barge's deck
      const x0 = plankTo(), x1 = plankFrom;
      const n = 9;
      for (let k = 0; k < n; k++) {
        const top = Y0 + SKIFF.deck + ((BARGE.lower - SKIFF.deck) * (k + 1)) / n;
        const xa = x0 + ((x1 - x0) * k) / n;
        const xb = x1 + 0.4;
        pl.boxes.push(ctx.box((xa + xb) / 2, top - 0.15, pl.z, xb - xa, 0.3, BARGE.plankHalf * 1.4, null).box);
      }
    }
  };

  // ---- the raiders: two Tusken skiffs coming up from astern ----
  const raiders: Raider[] = [V(BARGE.halfBeam + 16 + SKIFF.halfBeam, 0, -6), V(BARGE.halfBeam + 26 + SKIFF.halfBeam, 0, -34)].map((station) => {
    const g = new THREE.Group();
    const hullMat = ctx.paint(0x5a3a24, { rough: 0.8, metal: 0.3 });
    ctx.tile(hullMat, 'rust_hull', 3, 1);
    const hull = new THREE.Mesh(worldBox(SKIFF.halfBeam * 2, SKIFF.deck - SKIFF.keel, SKIFF.halfLen * 2, 6), hullMat);
    ctx.own(hull.geometry);
    hull.position.y = (SKIFF.deck + SKIFF.keel) / 2;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), ctx.paint(0x6a2a1a, { rough: 1 }));
    ctx.own(sail.geometry);
    (sail.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    sail.position.set(0, SKIFF.deck + 4, 1);
    sail.rotation.y = Math.PI / 2;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 7, 6), woodMat);
    ctx.own(mast.geometry);
    mast.position.set(0, SKIFF.deck + 3.5, 1);
    g.add(hull, sail, mast);
    g.visible = false;
    g.position.set(station.x, Y0, -150);
    ctx.mesh(g);
    return { group: g, station, z: -150, arrived: false, b: null, crew: [], sinking: 0 };
  });

  // ---- state ----
  const interactions = new Interactions();
  let phase: Phase = 'landing';
  let phaseT = 0;
  let complete = false;
  let hull = 1;                  // the skiff's hull points, 0..1
  let breakups = 0;
  let shellT = 6;
  const shells: Shell[] = [];
  let shellGunner: Enemy | null = null;
  const railGunners: Enemy[] = [];
  const swoops: Enemy[] = [];
  let swoopWaves = 0;
  const waveA: Enemy[] = [];
  const waveB: Enemy[] = [];
  let helmsman: Enemy | null = null;
  let aboardT = 0;
  let wiped = false;
  let started = false;

  const alive = (list: Enemy[]): number => list.filter((e) => e.alive).length;
  const onSkiff = (pos: THREE.Vector3): boolean =>
    Math.abs(pos.x - skiffX(gap)) < SKIFF.halfBeam + 0.2 && Math.abs(pos.z - SKIFF_Z) < SKIFF.halfLen + 1
    && pos.y > Y0 + SKIFF.deck - 0.4 && pos.y < Y0 + SKIFF.deck + 3;
  const onBarge = (pos: THREE.Vector3): boolean =>
    Math.abs(pos.x) < BARGE.halfBeam + 0.3 && Math.abs(pos.z) < BARGE.halfLen + 3 && pos.y > Y0 + BARGE.lower - 0.5;
  const onUpper = (pos: THREE.Vector3): boolean =>
    Math.abs(pos.x) < BARGE.upperHalfBeam + 0.3 && pos.z < BARGE.upperFore + 0.5 && pos.z > BARGE.upperAft - 0.5 && pos.y > Y0 + BARGE.upper - 0.6;

  const announcePhase = (title: string, sub: string): void => ctx.announce(title, sub);

  // ---- spawning ----
  const railSpots = [-14, -8, 1, 12, 17].map((z) => V(-BARGE.halfBeam + 1.1, BARGE.lower, z));
  const spawnBroadside = (): void => {
    for (const e of [...railGunners, ...swoops]) if (e.alive) e.removeMe = true;
    railGunners.length = 0;
    swoops.length = 0;
    const n = Math.min(railSpots.length, 1 + party);
    for (let k = 0; k < n; k++) railGunners.push(ctx.spawn(k % 3 === 2 ? 'tusken' : 'pyke', railSpots[k], { exact: true, alert: true }));
    // the upper deck: the heavy gun's crew, and a spotter
    shellGunner = ctx.spawn('pyke', V(BARGE.gun.x - 1.6, BARGE.upper, BARGE.gun.z - 1.2), { exact: true, alert: true });
    shellGunner.hp = shellGunner.maxHp = 70 + 25 * party;
    railGunners.push(ctx.spawn('pyke', V(-3, BARGE.upper, -13), { exact: true, alert: true }));
    spawnSwoops();
  };
  const spawnSwoops = (): void => {
    swoopWaves++;
    const n = 1 + Math.floor(party / 2) + (swoopWaves > 1 && party > 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const at = V(skiffX(gap) + (k % 2 ? 30 : -30), 9, SKIFF_Z + (k - n / 2) * 18);
      swoops.push(ctx.spawn('nikto', at, { exact: true, alert: true }));
    }
  };
  const cargoKinds = (n: number, heavy: boolean): EnemyKind[] => {
    const out: EnemyKind[] = [];
    for (let k = 0; k < n; k++) out.push(k % 3 === 0 ? 'pyke' : heavy && k % 4 === 3 ? 'pirateMelee' : 'tusken');
    return out;
  };
  const spawnWave = (list: Enemy[], n: number, heavy: boolean): void => {
    cargoKinds(n, heavy).forEach((kind, k) => {
      const c = barge.cargo[k % barge.cargo.length];
      const at = c.clone().add(new THREE.Vector3(c.x > 0 ? -1.6 : 1.6, 0.1, (k % 2) * 1.2 - 0.6));
      list.push(ctx.spawn(kind, at, { exact: true, alert: heavy }));
    });
  };

  // ---- the shells: a ring on the skiff's deck, then the blast ----
  const ringGeo = new THREE.RingGeometry(SHELL_R - 0.35, SHELL_R, 32);
  ctx.own(ringGeo);
  const fireShell = (): void => {
    const local = new THREE.Vector3((Math.random() - 0.5) * (SKIFF.halfBeam * 1.4), 0, (Math.random() - 0.5) * SKIFF.halfLen * 1.6);
    // one shell in three is laid on a player standing on the deck
    const aboard = game.players.filter((p) => p.alive && onSkiff(p.position));
    if (aboard.length && Math.random() < 0.4) {
      const p = aboard[(Math.random() * aboard.length) | 0];
      local.set(p.position.x - skiffX(gap), 0, p.position.z - SKIFF_Z);
    }
    const ring = new THREE.Mesh(ringGeo, shellMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(local.x, SKIFF.deck + 0.08, local.z);
    skiff.group.add(ring);
    shells.push({ at: local, t: 0, ring });
    audio.shipPass();
  };
  const updateShells = (dt: number): void => {
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i];
      s.t += dt;
      const k = s.t / SHELL_WARN;
      (s.ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.55 * k;
      s.ring.scale.setScalar(1.3 - 0.3 * k);
      if (s.t < SHELL_WARN) continue;
      const at = V(skiffX(gap) + s.at.x, SKIFF.deck + 0.3, SKIFF_Z + s.at.z);
      game.particles.explosion(at, 0.9);
      audio.explosion();
      hull = Math.max(0, hull - (party === 1 ? 0.08 : 0.1));
      for (const p of game.players) {
        const d = p.position.distanceTo(at);
        if (d < 12) p.groundShake(0.35 * (1 - d / 12));
        if (!p.alive || d > SHELL_R + 0.4) continue;
        p.damage(24, at, -1, { heavy: true });
        const push = p.position.clone().sub(at).setY(0);
        if (push.lengthSq() > 1e-4) p.velocity.addScaledVector(push.normalize(), 6);
        p.velocity.y += 4;
      }
      skiff.group.remove(s.ring);
      shells.splice(i, 1);
    }
  };
  const clearShells = (): void => { for (const s of shells) skiff.group.remove(s.ring); shells.length = 0; };

  // ---- the skiff breaking up: a fresh one, and the broadside again ----
  const breakUp = (): void => {
    breakups++;
    game.particles.explosion(skiffDeck(), 2);
    audio.explosion();
    ctx.announce(T.brokeUp, T.brokeUpSub);
    clearShells();
    hull = 1;
    placeSkiff(GAP_FAR);
    for (const p of game.players) {
      if (!p.alive) continue;
      p.position.copy(respawnSpot(p.slot));
      p.velocity.set(0, 0, 0);
    }
    phase = 'broadside';
    phaseT = 0;
    shellT = 6;
    spawnBroadside();
  };

  // ---- the hands on the guns ----
  for (const gun of guns) {
    interactions.add({
      pos: gun.pos, radius: 2.6, hold: 0.35, verb: T.manVerb, once: false,
      enabled: () => gun.friendly && gun.gunner < 0,
      onDone: (slot) => {
        if (guns.some((g) => g.gunner === slot)) return;
        gun.gunner = slot;
        mountedAt[slot] = game.time;
        ctx.announce(T.manned, T.mannedSub);
      },
    });
  }
  const gunOf = (slot: number): DeckGun | null => guns.find((g) => g.gunner === slot) ?? null;
  const seatTmp = new THREE.Vector3();
  const gunnerMove = (p: Player, _dt: number, input: FrameInput): FrameInput => {
    const gun = gunOf(p.slot);
    if (!gun) return input;
    const leave = (input.jumpPressed || input.slamPressed) && game.time - mountedAt[p.slot] > 0.6;
    if (leave || !p.alive || !gun.friendly) { gun.gunner = -1; return { ...input, slamPressed: false }; }
    triggers[p.slot] = input.shootHeld;
    gun.seat(seatTmp);
    p.position.x = seatTmp.x;
    p.position.z = seatTmp.z;
    p.velocity.x = 0;
    p.velocity.z = 0;
    return { ...input, moveX: 0, moveY: 0, jumpPressed: false, jumpHeld: false, dashPressed: false, sprintHeld: false,
      shootHeld: false, rocketPressed: false, meleePressed: false, slamPressed: false };
  };

  // ---- guidance: the golden path (onto the skiff, across a plank, up the stair, to the gun, to the helm) ----
  const path = [
    V(ledgeX0 + 2, SKIFF.deck, SKIFF_Z), V(skiffX(GAP_NEAR), SKIFF.deck, SKIFF_Z),
    V(plankTo(), SKIFF.deck, BARGE.planks[0]), V(-BARGE.halfBeam + 1, BARGE.lower, BARGE.planks[0]),
    V(0, BARGE.lower, BARGE.stairFoot + 1.5), V(0, BARGE.upper, BARGE.upperFore - 1.5),
    V(BARGE.gun.x - 1.8, BARGE.upper, BARGE.gun.z), V(BARGE.helm.x, BARGE.upper, BARGE.helm.z + 1),
  ];

  const targetPoints = (): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    for (const e of game.enemies) {
      if (!e.alive || e.team !== 1 || !e.targetable) continue;
      out.push(e.position.clone().add(new THREE.Vector3(0, e.def.height * 0.6, 0)));
    }
    for (const r of raiders) if (r.b && !r.b.broken) out.push(r.b.center.clone().add(new THREE.Vector3(0, 3, 0)));
    return out;
  };

  const setPhase = (p: Phase): void => { phase = p; phaseT = 0; };

  const update = (dt: number): void => {
    if (!started) {
      started = true;
      ctx.announce(T.title, T.sub);
      for (const p of game.players) {
        p.sectionMove = composeMoves({
          adjust: (pl, d, input) => interactions.swallow(pl.slot, pl.position, gunnerMove(pl, d, input)),
        });
      }
      ctx.checkpoint.copy(skiffDeck());
    }
    if (complete) return;
    phaseT += dt;
    mill.update(dt);
    interactions.update(dt, game);

    // the guns
    const targets = targetPoints();
    deckGun.moveTo(deckGunAt());
    for (const gun of guns) gun.update(dt, gun.gunner >= 0 ? triggers[gun.gunner] : false, targets);
    for (let s = 0; s < 4; s++) triggers[s] = false;

    // the dust
    if (mill.speed > 1) {
      const n = Math.ceil(mill.speed / SPEED * 3);
      for (let k = 0; k < n; k++) {
        emitDust(skiffX(gap) + (Math.random() - 0.5) * 4, Y0 + 0.4, SKIFF_Z - SKIFF.halfLen, 3);
        emitDust((Math.random() - 0.5) * 11, Y0 + 0.5, barge.group.position.z - BARGE.halfLen, 10);
        for (const r of raiders) if (r.group.visible && !r.sinking) emitDust(r.group.position.x, Y0 + 0.4, r.group.position.z - SKIFF.halfLen, 3);
      }
    }
    for (let i = 0; i < DUST; i++) {
      if (dustLife[i] <= 0) { dustPos[i * 3 + 1] = -9999; continue; }
      dustLife[i] -= dt;
      dustPos[i * 3 + 2] -= mill.speed * dt;
      dustPos[i * 3 + 1] += dt * 0.8;
    }
    (dustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // bodies on the sand are out of it: a hostile knocked off a deck is left in the dunes
    for (const e of game.enemies) {
      if (e.alive && e.team === 1 && e.kind !== 'nikto' && e.position.y < Y0 + 0.9) e.damage(99999, e.position, -1);
    }

    switch (phase) {
      case 'landing': {
        // cast off once everyone standing is aboard (or a while after the first is)
        const living = game.players.filter((p) => p.alive);
        const aboard = living.filter((p) => onSkiff(p.position)).length;
        if (aboard > 0) aboardT += dt;
        if (living.length && (aboard === living.length || aboardT > 8)) {
          setPhase('castoff');
          mill.setSpeed(SPEED, 5);
          announcePhase(T.castOff, T.castOffSub);
          audio.speederIgnite();
        }
        break;
      }
      case 'castoff': {
        // the barge's picture closes from far ahead to alongside
        const k = Math.min(1, phaseT / 11);
        barge.group.position.z = bargeStartZ * (1 - k * k * (3 - 2 * k));
        heavyGun.group.position.z = BARGE.gun.z + barge.group.position.z;
        if (k >= 1) {
          setPhase('broadside');
          spawnBroadside();
          announcePhase(T.broadside, T.broadsideSub);
        }
        break;
      }
      case 'broadside': {
        // the barge's gun, while its gunner lives
        if (shellGunner?.alive) {
          shellT -= dt;
          if (shellT <= 0) {
            shellT = (party === 1 ? 6.5 : 5) + Math.random() * 2;
            fireShell();
          }
        }
        updateShells(dt);
        // swoops and rail fire chip the hull
        let chip = 0;
        for (const e of swoops) if (e.alive && e.position.distanceTo(skiffDeck()) < 32) chip += 0.006;
        for (const e of railGunners) if (e.alive) chip += 0.0018;
        hull = Math.max(0, hull - chip * dt * (party === 1 ? 0.7 : 1));
        if (alive(swoops) === 0 && swoopWaves < 2 && phaseT > 12) spawnSwoops();
        if (hull <= 0) { breakUp(); break; }
        const silenced = !shellGunner?.alive;
        if ((silenced && phaseT > BROADSIDE_MIN) || phaseT > BROADSIDE_MAX) {
          clearShells();
          setPhase('close');
          announcePhase(T.close, silenced ? T.closeSub : T.closeSubAnyway);
        }
        break;
      }
      case 'close': {
        const k = Math.min(1, phaseT / 6);
        placeSkiff(GAP_FAR + (GAP_NEAR - GAP_FAR) * (k * k * (3 - 2 * k)));
        for (const pl of planks) {
          pl.drop = Math.min(1, Math.max(0, (phaseT - 4) / 1.8));
          const down = Math.atan2(BARGE.lower - SKIFF.deck, plankFrom - plankTo());
          const k2 = pl.drop * pl.drop * (3 - 2 * pl.drop);
          pl.group.rotation.z = STOWED + (down - STOWED) * k2;
        }
        if (k >= 1 && phaseT > 5.8) {
          lowerPlanks();
          setPhase('deck');
          spawnWave(waveA, 2 + party, false);
          announcePhase(T.board, T.boardSub);
        }
        break;
      }
      case 'deck': {
        if (!waveB.length && alive(waveA) <= 1 && phaseT > 4) spawnWave(waveB, 2 + party, true);
        const lowerClear = waveB.length > 0 && alive(waveA) + alive(waveB) + alive(railGunners) === 0;
        if (lowerClear || (waveB.length > 0 && phaseT > 150)) {
          setPhase('upper');
          heavyGun.friendly = true;
          for (const r of raiders) { r.group.visible = true; r.z = -150; }
          spawnSwoops();
          announcePhase(T.upper, T.upperSub);
        }
        break;
      }
      case 'upper': {
        // the raiders come up from astern and hold station off the starboard side
        let burnt = 0;
        raiders.forEach((r, i) => {
          if (r.sinking > 0) {
            r.sinking += dt;
            r.z -= dt * (4 + r.sinking * 8);
            r.group.position.set(r.station.x, Y0 - r.sinking * 0.5, r.z);
            r.group.rotation.z = Math.min(0.6, r.sinking * 0.2);
            if (r.sinking > 6) r.group.visible = false;
            burnt++;
            return;
          }
          if (!r.arrived) {
            const want = r.station.z;
            const t = Math.max(0, phaseT - i * 5);
            r.z = -150 + Math.min(1, t / 12) * (want + 150);
            r.group.position.set(r.station.x, Y0, r.z);
            if (t >= 12) {
              r.arrived = true;
              // at station: a deck to stand on, a hull to shoot, a crew to fight
              const { box } = ctx.box(r.station.x, Y0 + (SKIFF.deck + SKIFF.keel) / 2, r.station.z,
                SKIFF.halfBeam * 2, SKIFF.deck - SKIFF.keel, SKIFF.halfLen * 2, null);
              r.b = addBreakable(ctx.board, r.group, box, 360 + 140 * party, {
                onBreak: () => {
                  r.sinking = 0.001;
                  game.particles.explosion(r.group.position.clone().setY(Y0 + 2.5), 2);
                  audio.explosion();
                  for (const e of r.crew) if (e.alive) e.damage(99999, r.group.position, -1);
                  ctx.announce(T.raiderDown, raiders.filter((x) => x.sinking > 0 || x.b?.broken).length >= 2 ? T.raidersDone : T.raiderOne);
                },
              });
              const kinds: EnemyKind[] = ['pyke', 'tusken', party > 2 ? 'pyke' : 'tusken'];
              kinds.forEach((kind, k) => {
                r.crew.push(ctx.spawn(kind, V(r.station.x, SKIFF.deck, r.station.z - 4 + k * 4), { exact: true, alert: true }));
              });
            }
          }
        });
        if (burnt >= 2) {
          setPhase('helm');
          helmsman = ctx.spawn('gunslinger', V(BARGE.helm.x, BARGE.upper, BARGE.helm.z + 0.5), { exact: true, alert: true });
          announcePhase(T.helm, T.helmSub);
        }
        break;
      }
      case 'helm': {
        if (helmsman && !helmsman.alive) {
          setPhase('grounding');
          mill.stop(3.5);
          announcePhase(T.grounded, T.groundedSub);
          audio.explosion();
        }
        break;
      }
      case 'grounding': {
        // the barge slews and ploughs into the sandbank
        const k = Math.min(1, phaseT / 3.5);
        barge.group.rotation.set(0, k * 0.14, k * 0.05);
        for (const p of game.players) if (p.alive) p.groundShake(0.1 * (1 - k));
        if (Math.random() < dt * 20) game.particles.dustPuff(V((Math.random() - 0.5) * 14, 0.5, BARGE.halfLen), 10);
        if (phaseT > 4) { setPhase('done'); complete = true; }
        break;
      }
      default: break;
    }

    // the checkpoint follows the skiff (the fallen come back aboard it)
    ctx.checkpoint.copy(skiffDeck());
    // a wipe in the broadside: a fresh skiff (once — the party re-forms on it)
    const anyAlive = game.players.some((p) => p.alive);
    if (!anyAlive && !wiped && phase === 'broadside') { wiped = true; breakUp(); }
    else if (anyAlive) wiped = false;
  };

  const objective = () => {
    switch (phase) {
      case 'landing':
        return { pos: skiffDeck().add(new THREE.Vector3(0, 1.5, 0)), label: T.skiff, hint: T.hintBoard, beacon: false };
      case 'castoff':
        return { pos: barge.toWorld(new THREE.Vector3(0, BARGE.lower + 3, 0)).add(new THREE.Vector3(0, 0, barge.group.position.z)), label: T.barge, hint: T.hintCastoff, beacon: false };
      case 'broadside':
        if (shellGunner?.alive) return { pos: shellGunner.position.clone().add(new THREE.Vector3(0, 2, 0)), label: T.gunner, hint: T.hintBroadside, beacon: false };
        return { pos: V(-BARGE.halfBeam, BARGE.lower + 2, 10), label: T.barge, hint: T.hintSilenced, beacon: false };
      case 'close':
        return { pos: V(-BARGE.halfBeam, BARGE.lower + 1, BARGE.planks[0]), label: T.planks, hint: T.hintClose, beacon: false };
      case 'deck':
        return { pos: V(0, BARGE.lower + 1, 8), label: T.cargo, hint: T.hintDeck, beacon: false };
      case 'upper': {
        const r = raiders.find((x) => x.arrived && x.b && !x.b.broken);
        if (heavyGun.gunner < 0) return { pos: heavyGun.pos.clone().add(new THREE.Vector3(0, 2, 0)), label: T.heavyGun, hint: T.hintUpper, beacon: false };
        return { pos: (r ? r.group.position.clone() : V(20, 3, -20)).add(new THREE.Vector3(0, 3, 0)), label: T.raiders, hint: T.hintRaiders, beacon: false };
      }
      case 'helm':
        return { pos: (helmsman?.position.clone() ?? barge.toWorld(BARGE.helm)).add(new THREE.Vector3(0, 2, 0)), label: T.helmsman, hint: T.hintHelm, beacon: false };
      default:
        return { pos: V(0, BARGE.upper + 2, 0), label: T.barge, hint: T.hintGrounded, beacon: false };
    }
  };

  const respawnSpot = (slot: number): THREE.Vector3 => {
    const deck = skiffDeck();
    // round the middle of the deck, clear of the gun at the stern
    const at = new THREE.Vector3(deck.x + ((slot % 2) - 0.5) * 1.8, deck.y + 0.1, deck.z + 1.5 - Math.floor(slot / 2) * 1.8);
    return ctx.placeAt(at, 'pyke');
  };

  const hud = (slot: number): SectionHud | null => {
    const p = game.players[slot];
    if (!p) return null;
    const bars: SectionBar[] = [];
    if (phase === 'broadside' || phase === 'castoff') bars.push({ label: T.hull, value: hull, tone: hull < 0.3 ? 'danger' : hull < 0.6 ? 'warn' : 'good' });
    const gun = gunOf(slot);
    let line = '';
    if (gun) {
      bars.push({ label: gun.overheated ? T.vent : T.heat, value: gun.heat, tone: gun.overheated ? 'danger' : gun.heat > 0.7 ? 'warn' : 'info' });
      line = T.gunLine;
    } else {
      const at = interactions.hudFor(p.position);
      if (at) { bars.push(at.bar); line = at.line; }
      else if (phase === 'upper' && heavyGun.gunner < 0) line = T.lineHeavy;
      else if (phase === 'broadside') line = deckGun.gunner < 0 ? T.lineAuto : T.lineBroadside;
    }
    if (phase === 'upper') {
      for (const r of raiders) if (r.b && !r.b.broken) bars.push({ label: T.raider, value: r.b.hp / r.b.maxHp, tone: 'danger' });
    }
    return { bars, line };
  };

  // ---- the autopilot: the gunner fires, the rest board and climb ----
  const autopilot = (slot: number): AutopilotInput => {
    const p = game.players[slot];
    if (!p || !p.alive) return {};
    const steer = (to: THREE.Vector3, extra: AutopilotInput = {}): AutopilotInput => {
      const dx = to.x - p.position.x, dz = to.z - p.position.z;
      const d = Math.hypot(dx, dz);
      return { yaw: Math.atan2(dx, dz), moveY: d > 0.5 ? Math.min(1, d / 2) : 0, ...extra };
    };
    const nearestEnemy = (): THREE.Vector3 | null => {
      let best: THREE.Vector3 | null = null, bd = 60;
      for (const t of targetPoints()) { const d = t.distanceTo(p.position); if (d < bd) { bd = d; best = t; } }
      return best;
    };
    const fight = (): AutopilotInput => {
      const t = nearestEnemy();
      return t ? { yaw: Math.atan2(t.x - p.position.x, t.z - p.position.z), shootHeld: true } : {};
    };
    const gun = gunOf(slot);
    // the gunner: aim at the nearest target and hold the trigger (the soft-lock does the rest)
    if (gun) {
      const stay = (gun === deckGun && phase === 'broadside') || (gun === heavyGun && phase === 'upper');
      if (!stay) return { jumpPressed: true };
      const t = targetPoints().sort((a, b) => a.distanceTo(gun.pos) - b.distanceTo(gun.pos))[0];
      return t ? { yaw: Math.atan2(t.x - gun.pos.x, t.z - gun.pos.z), shootHeld: !gun.overheated } : {};
    }
    switch (phase) {
      case 'landing':
      case 'castoff':
        return onSkiff(p.position) && phase === 'castoff' ? fight() : steer(skiffDeck());
      case 'broadside': {
        if (slot === 0 && deckGun.gunner < 0) {
          const seat = deckGun.seat(new THREE.Vector3());
          if (p.position.distanceTo(deckGun.pos) < 2.2) return { interactHeld: true };
          return steer(seat);
        }
        if (!onSkiff(p.position)) return steer(skiffDeck());
        // keep out of a shell's ring
        for (const s of shells) {
          const at = V(skiffX(gap) + s.at.x, SKIFF.deck, SKIFF_Z + s.at.z);
          if (Math.hypot(at.x - p.position.x, at.z - p.position.z) < SHELL_R + 0.8) {
            const away = p.position.clone().sub(at).setY(0).normalize().multiplyScalar(4).add(p.position);
            away.x = THREE.MathUtils.clamp(away.x, skiffX(gap) - 1.5, skiffX(gap) + 1.5);
            away.z = THREE.MathUtils.clamp(away.z, SKIFF_Z - 5, SKIFF_Z + 5);
            return steer(away);
          }
        }
        return fight();
      }
      case 'close':
        if (!onSkiff(p.position)) return steer(skiffDeck());
        return fight();
      case 'deck':
      case 'upper':
      case 'helm': {
        // across the nearer plank, up the stair, to the upper deck
        const plankZ = BARGE.planks[slot % 2];
        if (!onBarge(p.position)) {
          const foot = V(plankTo() - 0.8, SKIFF.deck, plankZ);
          if (onSkiff(p.position) && Math.hypot(foot.x - p.position.x, foot.z - p.position.z) > 1.2 && p.position.x < foot.x - 1.2) return steer(foot);
          return steer(V(-BARGE.halfBeam + 2, BARGE.lower, plankZ));
        }
        if (phase === 'deck') {
          // clear the cargo deck: stand in its middle and shoot
          const mid = V(0, BARGE.lower, 10);
          if (Math.hypot(mid.x - p.position.x, mid.z - p.position.z) > 3) return { ...steer(mid), shootHeld: true };
          return fight();
        }
        if (!onUpper(p.position)) {
          // round to the stair's foot, then up it
          const onStair = Math.abs(p.position.x) < BARGE.stairHalf - 0.3 && p.position.z < BARGE.stairFoot + 2.2;
          if (!onStair) return steer(V(0, BARGE.lower, BARGE.stairFoot + 1.5));
          return steer(V(0, BARGE.upper, BARGE.upperFore - 2));
        }
        if (phase === 'upper' && slot === 0 && heavyGun.gunner < 0) {
          if (p.position.distanceTo(heavyGun.pos) < 2.2) return { interactHeld: true };
          return steer(heavyGun.seat(new THREE.Vector3()));
        }
        if (phase === 'helm' && helmsman?.alive) {
          const h = helmsman.position;
          if (Math.hypot(h.x - p.position.x, h.z - p.position.z) > 6) return { ...steer(h), shootHeld: true };
        }
        return fight();
      }
      default:
        return {};
    }
  };

  const inst: SectionInstance & { test: object } = {
    starts: [0, 1, 2, 3].map((i) => V(ledgeX0 + 2.5 + (i % 2) * 1.8, SKIFF.deck, SKIFF_Z - 1 + Math.floor(i / 2) * 1.8)),
    floorY: Y0,
    ceilingY: Y0 + 30,
    groundAt: () => Y0,
    contains: (x, z) => Math.abs(x) < 80 && Math.abs(z) < 80,
    path,
    update,
    get complete() { return complete; },
    objective,
    respawnSpot,
    // the sand is a fall, and so is being carried off on the landing
    offPath: (pos) => pos.y < Y0 + 1 || pos.z < -40,
    hud,
    autopilot,
    dispose: () => {
      if (ctx.board.movers) ctx.board.movers = ctx.board.movers.filter((m) => m !== skiffMover);
      for (const p of game.players) p.sectionMove = null;
      if (ctx.board.breakables) {
        const mine = new Set(raiders.map((r) => r.b).filter(Boolean));
        ctx.board.breakables = ctx.board.breakables.filter((b) => !mine.has(b));
      }
    },
    debug: () => ({
      phase, t: +phaseT.toFixed(1), hull: +hull.toFixed(2), gap: +gap.toFixed(1), breakups,
      speed: +mill.speed.toFixed(1), raiders: raiders.map((r) => (r.b ? Math.round(r.b.hp) : r.arrived ? 'x' : '-')).join(','),
      gunners: guns.map((g) => g.gunner).join(','), shots: guns.map((g) => g.shots).join(','),
    }),
    test: {
      mill, guns, deckGun, heavyGun, raiders, shells, planks,
      get phase() { return phase; },
      get hull() { return hull; },
      set hull(v: number) { hull = v; },
      get gap() { return gap; },
      get breakups() { return breakups; },
      get shellGunner() { return shellGunner; },
      get helmsman() { return helmsman; },
      onSkiff, onBarge, onUpper, skiffDeck, landingItem,
      fireShell,
    },
  };
  void scenery;
  return inst;
}

export const bargeRun: SectionDef = {
  id: 'barge-run',
  build,
  // late afternoon over the open dunes, the suns low and the air thick with sand
  world: { fogColor: 0xdcb98a, fogNear: 120, fogFar: 520, fill: 1.1 },
};
