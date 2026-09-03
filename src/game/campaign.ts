import { TEXT } from '../text';
import * as THREE from 'three';
import type { Game } from './game';
import {
  buildStage, MISSION_LAYOUTS, PORTAL_POCKET, type MissionStage, type MissionZone, type Portal,
} from '../world/mission';
import { ALLY_WAVES, FINAL_WAVE, MID_BOSS_WAVE, waveComposition } from '../enemies/spawner';
import { Enemy, enemyBody, type EnemyKind } from '../enemies/enemy';
import { audio } from '../core/audio';
import { hazardAt, type Board } from '../world/board';
import { AllyCrate } from './allycrate';
import { spawnVehicles } from './vehicles';
import { ceilingOverride } from './modes';
import type { MissionController } from './mission-api';

/** scratch for the hazard probe in placeNear */
const _probe = new THREE.Vector3();

/**
 * The Missions run, outdoor edition (docs/MISSIONS_OUTDOOR.md).
 *
 * A territory is a chain of **stages**, each its own map, and each stage a
 * chain of **zones** — open ground held in by cliffs, ravines that pinch it,
 * a roofed hallway beat behind a door in the rock, arenas under the sky. This
 * drives all of it: the garrisons, the sealed fights and where their waves
 * come from, the guidance, the checkpoints, the flight ceiling, and the
 * transport doors that swap one stage for the next.
 *
 * The previous design — one walled room chain per territory — is kept whole
 * in `campaign-legacy.ts` behind `?backup=missions`.
 */

/** how close to the exit point counts as "through" a walked zone */
const EXIT_R = 4.2;
/** vertical slack when judging who is inside a zone (jetpack hops included) */
const ZONE_Y_SLACK = 12;
/** falling this far below the stage floor reads as "off the path" */
const FALL_DROP = 9;
/** ...or this far, where the stage has water of its own under it */
const WATER_DROP = 2.5;
/** the vent glyphs light this long before the carrier lets the squad go... */
const VENT_CUE_LEAD = 1.0;
/** ...and stay lit through the drop itself */
const VENT_CUE_LIFE = 3.4;
/** how long a ground arrow pulses before settling to a breadcrumb */
const ARROW_PULSE = 8;
/** the transport beat before the stage swap: inputs blanked, cameras drift */
const PORTAL_BEAT = 1.5;
/** how far a cancelled exit walks the player back out of the pocket */
const PORTAL_CANCEL_STEP = 3;
/** ranged kinds, for corridor defenders — the pinch is the cover-discipline beat */
const RANGED = new Set<EnemyKind>([
  'pyke', 'pirate', 'stormtrooper', 'deathtrooper', 'flametrooper',
  'quarren', 'ringEnforcer', 'droid', 'gunslinger',
]);

interface Pickup {
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  taken: boolean;
  /** its slot in the stage's own pickup list, so a stage remembers what was taken */
  index: number;
}

/**
 * What a stage remembers while the party is somewhere else.
 *
 * Going back through a transport door rebuilds the stage you left, and it has
 * to come back *as you left it*: cleared through the zone you walked out of,
 * its gates open, its garrison gone, the pickups you took missing. Without
 * this, stepping back would drop you into a fresh copy of a fight you had
 * already won.
 */
interface StageMemory {
  clearedTo: number;
  pickupsTaken: boolean[];
  visited: boolean;
}

export class Campaign implements MissionController {
  stage: MissionStage;
  /** which stage of the run is standing */
  stageIdx = 0;
  /** index of the zone the party is pushing toward, or fighting in */
  idx = 0;
  phase: 'travel' | 'fight' = 'travel';
  private waveNum = 0;
  private waveCount = 0;
  private waveDelay = 0;
  /** the sealed zone's own hostiles; the way on opens when the last falls */
  private zoneForce: Enemy[] = [];
  /** a wave is called and its transport is still inbound — the zone is owed it */
  private dropping = false;
  private bossCalled = false;
  /** road: which of its drop marks have fired */
  private marksFired: boolean[] = [];
  /** where the fallen return: the last safe ground the party earned */
  checkpoint: THREE.Vector3;
  done = false;
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private arrow: THREE.Mesh;
  private arrowMat: THREE.MeshBasicMaterial;
  private arrowLife = 0;
  private pickups: Pickup[] = [];
  private fallNote = 0;
  private ceilingNoted = false;
  private ventCue: { at: number; spots: THREE.Vector3[] } | null = null;
  private glyphs: { mesh: THREE.Group; mat: THREE.MeshBasicMaterial }[] = [];
  private glyphLife = 0;
  private memory: StageMemory[] = [];
  /** the transport beat: seconds left, and where the party is headed */
  private transitT = 0;
  private transitTo = -1;
  /** back-transit: the slots standing in the pocket, waiting on the others */
  readonly exited = new Set<number>();
  /** what the board looked like before this stage dressed it */
  private worldSaved: {
    fog: THREE.Fog | null; background: THREE.Color; gravity: number | undefined;
    waterY: number | undefined; traction: Board['tractionAt']; skyVisible: boolean;
    /** what the scene was actually drawing behind everything — often a panorama */
    sceneBackground: THREE.Scene['background'];
  } | null = null;

  constructor(private game: Game) {
    const spec = MISSION_LAYOUTS[game.board.kind];
    this.memory = spec.stages.map(() => ({ clearedTo: 0, pickupsTaken: [], visited: false }));
    this.stage = this.raise(0);
    this.checkpoint = this.stage.zones[0].center.clone();
    game.players.forEach((p, i) => p.spawnAt(this.stage.starts[i % this.stage.starts.length]));

    // ---- the guide beacon: one pillar, always the next objective ----
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffc860, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 60, 12, 1, true), this.beaconMat);
    this.beacon.position.copy(this.objectivePos);
    this.beacon.position.y += 30;
    this.beacon.frustumCulled = false;
    game.scene.add(this.beacon);

    // ---- the ground arrow: laid at every checkpoint, pointing at the next ----
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffc860, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const chev = new THREE.Shape();
    chev.moveTo(0, 1.6); chev.lineTo(1.3, -0.6); chev.lineTo(0, 0.1); chev.lineTo(-1.3, -0.6);
    this.arrow = new THREE.Mesh(new THREE.ShapeGeometry(chev), this.arrowMat);
    this.arrow.rotation.x = -Math.PI / 2;
    this.arrow.visible = false;
    game.scene.add(this.arrow);
  }

  // ---------------------------------------------------------------- stages

  /**
   * Raise stage `i` over the territory and dress the world for it.
   *
   * A stage is a map: an interior swaps the fog, the background and the sky
   * out from under the party, a harbour stage brings its own water, the
   * Crevasse's ice takes the grip down. Everything replaced is remembered, so
   * the next swap can put it back before dressing the world again.
   */
  private raise(i: number): MissionStage {
    const game = this.game;
    const spec = MISSION_LAYOUTS[game.board.kind];
    const board = game.board;
    let beat0 = 0;
    for (let k = 0; k < i; k++) beat0 += spec.stages[k].zones.length;
    const stage = buildStage(board, spec, i, beat0);

    // the ceiling: the cut between the playable sky and the ambient one
    const override = ceilingOverride();
    const ceilingY = override !== null ? stage.floorY + override : stage.ceilingY;
    game.ceilingY = ceilingY;
    // a carrier belongs to the ambient band, so it releases above the cut
    game.dropHeight = Math.max(38, ceilingY - stage.floorY + 10);

    const w = stage.spec.world;
    this.worldSaved = {
      fog: board.fog, background: board.background, gravity: board.gravity,
      waterY: board.waterY, traction: board.tractionAt,
      skyVisible: board.proceduralSky?.visible ?? true,
      sceneBackground: game.scene.background,
    };
    if (w) {
      if (w.fogColor !== undefined) {
        board.fog = new THREE.Fog(w.fogColor, w.fogNear ?? 12, w.fogFar ?? 90);
        game.scene.fog = board.fog;
      }
      if (w.background !== undefined) {
        board.background = new THREE.Color(w.background);
        game.scene.background = board.background;
      }
      if (w.roofed && board.proceduralSky) board.proceduralSky.visible = false;
      if (w.gravity !== undefined) board.gravity = w.gravity;
      if (w.traction !== undefined) {
        const prev = this.worldSaved.traction;
        const grip = w.traction;
        board.tractionAt = (x, z) => (stage.contains(x, z) ? grip : prev ? prev(x, z) : 1);
      }
    }
    if (stage.waterY !== undefined) board.waterY = stage.waterY;

    // The stage has to be the standing one *before* anyone is posted in it:
    // `placeNear` — which every garrison, defender and ride placement goes
    // through — validates against `this.stage`, so populating a stage that is
    // not yet the current one reads the last one, or nothing at all.
    this.stage = stage;
    this.populate(stage, i);
    return stage;
  }

  /** the garrison, the defenders, the pickups and the rides a stage stands up with */
  private populate(stage: MissionStage, stageIdx: number): void {
    const game = this.game;
    const mem = this.memory[stageIdx];
    stage.zones.forEach((zone, i) => {
      // a zone the party already cleared comes back cleared
      if (mem.visited && i < mem.clearedTo) return;
      if (zone.spec.kind === 'camp') {
        const size = Math.min(zone.posts.length + 2,
          3 + Math.floor(this.rampWave(zone.beat) / 3) + game.players.length);
        this.postSquad(this.squadFor(this.rampWave(zone.beat), size, zone), zone.posts, 9000 + zone.beat);
      } else if (zone.spec.kind === 'trek' && zone.spec.lookouts) {
        // lookouts hold nothing: they see you and tell the next zone about it
        this.postSquad(this.squadFor(this.rampWave(zone.beat), zone.spec.lookouts, zone),
          zone.posts, 9100 + zone.beat);
      } else if (zone.spec.shell === 'road' && zone.spec.barricade) {
        // the squad behind the barricade at the far mouth
        this.postSquad(this.squadFor(this.rampWave(zone.beat), 3 + game.players.length, zone),
          zone.farVents, 9200 + zone.beat);
      }
    });
    stage.defenders.forEach((posts, i) => {
      if (!posts.length) return;
      if (mem.visited && i < mem.clearedTo) return;
      const beat = stage.zones[Math.min(i + 1, stage.zones.length - 1)].beat;
      let pool = this.squadFor(this.rampWave(beat), posts.length + 2, null).filter((k) => RANGED.has(k));
      if (!pool.length) pool = game.board.kind === 'crevasse' ? ['krykna'] : ['stormtrooper'];
      posts.forEach((post, j) => {
        const kind = pool[j % pool.length];
        const e = new Enemy(kind, this.placeNear(post.pos.clone(), kind), 1, { silent: true });
        e.squad = 9300 + stageIdx * 20 + i;
        e.squadSize = posts.length;
        game.addEnemy(e);
      });
    });

    this.pickups = [];
    stage.pickups.forEach((pos, i) => {
      if (mem.pickupsTaken[i]) return;
      this.addPickup(pos, i);
    });

    // Rides belong to the stage, not to the board: a mission level is raised
    // ninety metres over the territory, so the board's own parked vehicles are
    // unreachable, and each stage parks its own on the plates it built.
    // A parked ride is solid, so the old stage's rides have to be properly
    // retired rather than just hidden — their colliders would otherwise stand
    // in the new stage as invisible boxes.
    for (const v of game.vehicles) {
      v.retire();
      game.scene.remove(v.group);
    }
    game.board.vehicles = stage.rides;
    game.vehicles = spawnVehicles(game.board, game.scene);
  }

  /** put the world back the way this stage found it */
  private lower(): void {
    const board = this.game.board;
    const saved = this.worldSaved;
    if (saved) {
      board.fog = saved.fog;
      this.game.scene.fog = saved.fog;
      board.background = saved.background;
      board.gravity = saved.gravity;
      board.waterY = saved.waterY;
      board.tractionAt = saved.traction;
      if (board.proceduralSky) board.proceduralSky.visible = saved.skyVisible;
      // Whatever the scene was actually drawing goes back — which on most
      // boards is the authored panorama, not the flat colour. Restoring
      // `board.background` alone would replace a territory's sky with a
      // single colour the first time a run came back out of an interior.
      this.game.scene.background = saved.sceneBackground;
      this.worldSaved = null;
    }
    for (const pk of this.pickups) this.game.scene.remove(pk.mesh);
    this.pickups = [];
    for (const g of this.glyphs) this.game.scene.remove(g.mesh);
    this.glyphs = [];
    this.stage.dispose();
  }

  /**
   * Cross a transport door: tear this stage down, raise the next (or the
   * last), and re-form the party at its start.
   *
   * `back` rebuilds the stage from its memory — cleared through the zone the
   * party walked out of — and stands them at the door they came back through
   * rather than at the trailhead.
   */
  private enterStage(next: number, back: boolean): void {
    const game = this.game;
    const spec = MISSION_LAYOUTS[game.board.kind];
    if (next < 0 || next >= spec.stages.length) return;

    // what this stage will look like if the party ever comes back to it
    const mem = this.memory[this.stageIdx];
    mem.visited = true;
    mem.clearedTo = Math.max(mem.clearedTo, back ? this.idx : this.stage.zones.length);
    // a pickup this stage never stood up was taken on an earlier visit, and
    // one it did stands or does not by its own flag
    mem.pickupsTaken = this.stage.pickups.map((_, i) =>
      this.pickups.find((p) => p.index === i)?.taken ?? true);

    // nothing from the old map comes with the party
    for (const e of game.enemies) e.removeMe = true;
    for (const a of game.allies) a.removeMe = true;
    if (game.allyCrate) { game.allyCrate.retire(game); game.allyCrate = null; }
    this.zoneForce = [];
    this.dropping = false;
    this.ventCue = null;
    this.glyphLife = 0;
    this.exited.clear();

    this.lower();
    this.stageIdx = next;
    this.stage = this.raise(next);
    const stage = this.stage;
    // Coming back, the party arrives at the door they left by, standing in
    // ground they already cleared — so the run picks up where their progress
    // did, which may be past the last zone entirely (waiting at the way on).
    this.idx = back ? Math.min(this.memory[next].clearedTo, stage.zones.length) : 0;
    this.phase = 'travel';
    this.bossCalled = false;
    this.marksFired = [];

    // where they stand: the trailhead going forward, the door they came back
    // through going back
    const spots = back && stage.exitPortal
      ? [0, 1, 2, 3].map((k) => stage.exitPortal!.pos.clone()
        .add(new THREE.Vector3((k % 2) * 1.8 - 0.9, 0, Math.floor(k / 2) * 1.8 - 0.9)))
      : stage.starts;
    game.players.forEach((p, i) => {
      p.exited = false;
      const at = this.placeNear(spots[i % spots.length].clone(), 'pyke');
      // re-form rather than blink: the same dissolve-and-gather the respawn
      // plays, so a transport reads as arriving somewhere
      p.spawnAt(at);
    });
    this.checkpoint.copy(stage.zones[Math.min(this.idx, stage.zones.length - 1)].center);
    game.announce(TEXT.missions.arrivedAt(stage.spec.label), TEXT.banners.transportSub);
    audio.checkpointChime();
  }

  /** the transport beat, then the swap: called by the portal checks below */
  private beginTransit(to: number): void {
    if (this.transitT > 0) return;
    this.transitT = PORTAL_BEAT;
    this.transitTo = to;
    const spec = MISSION_LAYOUTS[this.game.board.kind];
    this.game.announce(TEXT.banners.transport(spec.stages[to]?.label ?? ''), TEXT.banners.transportSub);
    audio.doorCycle();
  }

  // ---------------------------------------------------------------- ramp

  /**
   * The difficulty ramp is *place*, not time: beat `i` of the whole run —
   * across every stage — draws its squads from the board's wave table at this
   * wave. Trailhead beats post wave-one grunts, the last stretch posts elites.
   */
  private rampWave(beat: number): number {
    const spec = MISSION_LAYOUTS[this.game.board.kind];
    const n = spec.stages.reduce((t, s) => t + s.zones.length, 0);
    return 1 + Math.round(((FINAL_WAVE - 1) * Math.max(0, beat - 1)) / Math.max(1, n - 2));
  }

  /**
   * A squad of ~budget bodies drawn across the board's wave-`wave` table.
   *
   * Fliers are drawn only where the zone has room for them: a swoop's 26 m
   * orbit does not fit a ravine, but an 80 m arena under a 30 m ceiling is
   * exactly what one is for — and with the ceiling holding them inside the
   * level, an air kind can no longer stalk the run from out of reach.
   */
  private squadFor(wave: number, budget: number, zone: MissionZone | null): EnemyKind[] {
    const over = Math.max(0, wave - FINAL_WAVE);
    const comp = waveComposition(this.game.board.kind,
      Math.min(FINAL_WAVE, Math.max(1, wave)), this.game.players.length);
    const kinds: EnemyKind[] = [];
    const air = !!zone?.spec.air;
    for (const entry of comp) {
      if (entry.air && !air) continue;
      for (let i = 0; i < entry.count; i++) kinds.push(entry.kind);
    }
    if (!kinds.length) return ['stormtrooper'];
    const take = Math.min(budget, kinds.length);
    const out: EnemyKind[] = [];
    const stride = Math.max(1, Math.floor(kinds.length / take));
    for (let i = 0; out.length < take && i < kinds.length; i += stride) out.push(kinds[i]);
    // the wave's newest kind always makes the zone's mix
    out[out.length - 1] = kinds[kinds.length - 1];
    for (let i = 0; i < over; i++) out.push(kinds[kinds.length - 1]);
    return out;
  }

  /**
   * Somewhere inside the stage a body of `kind` can stand, at or near `pos`.
   * The board-wide `standingSpot` falls back to the territory's own ground —
   * far below the stage — so mission placement never uses it: a hostile
   * dropped onto the surface could never be reached, and a sealed zone
   * waiting on it would never open.
   */
  placeNear(pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3 {
    const body = enemyBody(kind);
    const phys = this.game.board.physics;
    const y = this.stage.floorY + 0.2;
    const ok = (x: number, z: number): boolean => {
      if (!phys.capsuleFree(x, y, z, body.radius, body.height)) return false;
      const hz = hazardAt(this.game.board, _probe.set(x, y, z));
      return !hz.kill && hz.dps <= 0;
    };
    if (this.stage.contains(pos.x, pos.z) && ok(pos.x, pos.z)) {
      pos.y = y;
      return pos;
    }
    for (let ring = 1; ring <= 6; ring++) {
      const r = ring * 1.7;
      const steps = 8 + ring * 4;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2 + ring;
        const x = pos.x + Math.cos(a) * r;
        const z = pos.z + Math.sin(a) * r;
        if (!this.stage.contains(x, z)) continue;
        if (ok(x, z)) return new THREE.Vector3(x, y, z);
      }
    }
    return new THREE.Vector3(pos.x, y, pos.z);
  }

  private postSquad(kinds: EnemyKind[], posts: THREE.Vector3[], squad: number): void {
    if (!posts.length) return;
    kinds.forEach((kind, i) => {
      const base = posts[i % posts.length].clone();
      base.x += (Math.random() - 0.5) * 3;
      base.z += (Math.random() - 0.5) * 3;
      const e = new Enemy(kind, this.placeNear(base, kind), 1, { silent: true });
      e.squad = squad;
      e.squadSize = kinds.length;
      this.game.addEnemy(e);
    });
  }

  private addPickup(pos: THREE.Vector3, index: number): void {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.6, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8e8f0, roughness: 0.4, metalness: 0.5, emissive: 0x1a3a4a }),
    );
    body.position.y = 0.5;
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x63d0ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.position.y = 0.5;
    g.add(body, glow);
    g.position.copy(pos);
    this.game.scene.add(g);
    this.pickups.push({ pos: pos.clone(), mesh: g, taken: false, index });
  }

  private get zone(): MissionZone {
    return this.stage.zones[Math.min(this.idx, this.stage.zones.length - 1)];
  }

  // ---------------------------------------------------------------- guidance

  /** where the beacon stands and the radar pip points */
  get objectivePos(): THREE.Vector3 {
    const zone = this.zone;
    if (this.phase === 'travel') return zone.entry;
    // boss arenas: the beacon walks you onto the battle. Everything else
    // points at the way out — never at a set piece — and a sealed exit reads
    // as "clear this and it opens".
    if (zone.spec.kind === 'lieutenant' || zone.spec.kind === 'warlord') return zone.center;
    // the run's last cleared zone points at the way on to the next stage
    if (this.idx >= this.stage.zones.length - 1 && this.stage.exitPortal) {
      return this.stage.exitPortal.pos;
    }
    return zone.exit;
  }

  /** what the objective is called, for the HUD's screen marker */
  get objectiveLabel(): string {
    if (this.transitT > 0) {
      const spec = MISSION_LAYOUTS[this.game.board.kind];
      return spec.stages[this.transitTo]?.label ?? '';
    }
    return this.zone.spec.label;
  }

  /** HUD line: what to do and (on the move) how far it is */
  hint(from: THREE.Vector3): string {
    const zone = this.zone;
    const obj = this.objectivePos;
    const d = Math.round(Math.hypot(obj.x - from.x, obj.z - from.z));
    if (this.transitT > 0) return TEXT.missions.boarding(this.objectiveLabel);
    if (this.phase === 'travel') return TEXT.missions.makeFor(zone.spec.label, d);
    switch (zone.spec.kind) {
      case 'assault': return TEXT.missions.holdRoom(zone.spec.label, Math.max(1, this.waveNum), this.waveCount);
      case 'chase': return zone.spec.barricade === 'crates' && d < 30
        ? TEXT.missions.clearTheWay
        : TEXT.missions.ride(zone.spec.label, d);
      case 'lieutenant': return TEXT.missions.bringDownLieutenant;
      case 'warlord': return TEXT.missions.bringDownWarlord;
      default: return TEXT.missions.pushThrough(zone.spec.label, d);
    }
  }

  /** where player `slot` comes back: the checkpoint, fanned out and validated */
  respawnSpot(slot: number): THREE.Vector3 {
    const at = this.checkpoint.clone();
    at.x += (slot % 2) * 1.6 - 0.8;
    at.z += Math.floor(slot / 2) * 1.6 - 0.8;
    return this.placeNear(at, 'pyke');
  }

  // ---------------------------------------------------------------- zone flow

  private inside(zone: MissionZone, p: { position: THREE.Vector3 }, which: 'rect' | 'sealRect' | 'triggerRect' = 'rect'): boolean {
    const r = zone[which];
    return p.position.x >= r.minX && p.position.x <= r.maxX
      && p.position.z >= r.minZ && p.position.z <= r.maxZ
      && Math.abs(p.position.y - this.stage.floorY) < ZONE_Y_SLACK;
  }

  private anyInside(zone: MissionZone, which: 'rect' | 'triggerRect' = 'rect'): boolean {
    return this.game.players.some((p) => p.alive && this.inside(zone, p, which));
  }

  /**
   * Everyone still standing is in the zone — and past its doorway.
   *
   * The door that seals an indoor fight is the same door the party walks in
   * through, so sealing on the *first* body through it locked everyone else
   * out of their own boss fight. The dead are not counted: they come back at
   * the checkpoint rather than walking in, and a wipe would otherwise stall
   * the run for good.
   */
  private allInside(zone: MissionZone): boolean {
    const alive = this.game.players.filter((p) => p.alive);
    return alive.length > 0 && alive.every((p) => this.inside(zone, p, 'sealRect'));
  }

  private nearExit(zone: MissionZone): boolean {
    return this.game.players.some((p) => p.alive
      && p.position.distanceToSquared(zone.exit) < EXIT_R * EXIT_R);
  }

  private enterZone(zone: MissionZone): void {
    this.phase = 'fight';
    this.checkpoint.copy(zone.entry);
    switch (zone.spec.kind) {
      case 'start':
        // the trailhead: no fight, and the way on is the far end of it. It
        // still checkpoints and still lays its arrow, so the first thing the
        // run teaches is what the guidance looks like.
        break;
      case 'trek':
      case 'camp': {
        this.game.announce(zone.spec.label, zone.spec.kind === 'trek' ? 'keep moving' : 'clear it, or slip through');
        // The covert's supply cache, in the beat before each boss arena: the
        // same crate the wave game drops on its milestone waves, and the same
        // kinds — the marshal ahead of the champion, Fennec ahead of the
        // warlord.
        const next = this.stage.zones[this.idx + 1];
        const ally = next?.spec.kind === 'lieutenant' ? ALLY_WAVES[MID_BOSS_WAVE - 1]
          : next?.spec.kind === 'warlord' ? ALLY_WAVES[FINAL_WAVE] : undefined;
        if (ally && !this.game.allyCrate) {
          const want = zone.entry.clone().lerp(zone.center, 0.6);
          const side = new THREE.Vector3(zone.exit.z - zone.entry.z, 0, -(zone.exit.x - zone.entry.x)).normalize();
          want.addScaledVector(side, Math.min(9, zone.spec.w * 0.28));
          this.game.allyCrate = new AllyCrate(this.game, ally, want, want);
          this.game.announce(zone.spec.label, 'a covert supply cache is down — crack it open');
        }
        break;
      }
      case 'chase':
        // A road is held at its far mouth, never behind: the fight is the
        // length of it, and the barricade is what you are riding at.
        zone.exitBarrier?.close();
        this.marksFired = (zone.marks ?? []).map(() => false);
        this.game.announce(zone.spec.label, 'ride it — they will come at you the whole way');
        audio.waveStart();
        break;
      case 'assault':
        // Indoors the doors seal behind you; outdoors only the way on is shut,
        // because a cage under an open sky is a lie and retreating into ground
        // you already cleared is its own worse fight.
        if (zone.spec.shell === 'hall') zone.entryBarrier?.close();
        zone.exitBarrier?.close();
        this.waveCount = zone.spec.waves ?? 2;
        this.waveNum = 0;
        this.zoneForce = [];
        this.dropping = false;
        this.waveDelay = 0.9;
        this.game.announce(TEXT.banners.sealedIn, TEXT.banners.hold(zone.spec.label));
        audio.waveStart();
        break;
      default:
        // a boss arena: the way in and the way on both seal, and the battle
        // owns the ground between them
        zone.entryBarrier?.close();
        zone.exitBarrier?.close();
        this.bossCalled = true;
        this.game.spawnBoss(zone.center, zone.spec.kind === 'lieutenant' ? 'mid' : 'final');
        break;
    }
  }

  /**
   * Send in the next wave of a sealed zone.
   *
   * How it arrives is the shell's business. Under the sky it is a carrier
   * pass, exactly as in the wave game — the ship crosses the ambient band
   * above the ceiling and lets the squad fall through it, which reads as
   * reinforcements being committed where bodies standing up beside a wall
   * read as a spawn. A roofed hall has no sky, so its waves come out of the
   * **wall hatches** instead: posted in the closets behind them, and the
   * doors open.
   *
   * The squad does not exist until the ship lets it go, so `dropping` holds
   * the zone open across the flight — without it the clear check finds an
   * empty force the frame after the wave is called.
   */
  private spawnZoneWave(zone: MissionZone): void {
    this.waveNum++;
    const wave = this.rampWave(zone.beat) + this.waveNum - 1;
    const budget = Math.min(12, 3 + wave + this.game.players.length);
    const kinds = this.squadFor(wave, budget, zone);

    if (zone.spec.shell === 'hall' && zone.hatches.length) {
      const bodies: Enemy[] = [];
      kinds.forEach((kind, i) => {
        const post = zone.hatches[i % zone.hatches.length].post.clone();
        post.x += (Math.random() - 0.5) * 2;
        post.z += (Math.random() - 0.5) * 2;
        const e = new Enemy(kind, this.placeNear(post, kind), 1, { silent: true });
        e.squad = 9500 + zone.beat * 10 + this.waveNum;
        e.squadSize = kinds.length;
        this.game.addEnemy(e);
        bodies.push(e);
      });
      for (const h of zone.hatches) h.gate.open();
      this.zoneForce = this.zoneForce.concat(bodies);
      const lead = this.game.players.find((p) => p.alive) ?? this.game.players[0];
      for (const e of bodies) e.alert(lead.position, true);
      this.game.waveSpawned += bodies.length;
      audio.waveStart();
      this.game.announce(TEXT.banners.waveOf(this.waveNum, this.waveCount), TEXT.banners.hold(zone.spec.label));
      return;
    }

    // The first wave of a sealed zone comes at the party from the far side;
    // the later ones flank in from the edges.
    const pool = (this.waveNum === 1 ? zone.farVents : zone.sideVents);
    const vents = pool.length ? pool : zone.vents;
    // where a zone has a runner notch in its rim, the beasts and locals come
    // in through it on foot rather than by transport
    const runners = zone.runnerPost ? kinds.filter((k) => RUNNER_KINDS.has(k)) : [];
    const dropped = kinds.filter((k) => !runners.includes(k));
    if (runners.length) {
      runners.forEach((kind, i) => {
        const from = zone.runnerPost!.clone();
        from.x += (Math.random() - 0.5) * 5;
        from.z += (Math.random() - 0.5) * 5;
        const to = vents[i % vents.length];
        const e = new Enemy(kind, this.placeNear(to.clone(), kind), 1, { silent: true });
        e.squad = 9600 + zone.beat * 10 + this.waveNum;
        e.squadSize = runners.length;
        this.game.addEnemy(e);
        e.beginArrival('run', from, e.position.clone());
        this.zoneForce.push(e);
      });
      this.game.waveSpawned += runners.length;
    }
    if (!dropped.length) {
      audio.waveStart();
      this.game.announce(TEXT.banners.waveOf(this.waveNum, this.waveCount), TEXT.banners.hold(zone.spec.label));
      return;
    }
    const spots = dropped.map((_, i) => {
      const vent = vents[i % vents.length].clone();
      vent.x += (Math.random() - 0.5) * 3;
      vent.z += (Math.random() - 0.5) * 3;
      return vent;
    });
    this.dropping = true;
    const eta = this.game.dropReinforcements(dropped, spots, 9500 + zone.beat * 10 + this.waveNum, (bodies) => {
      this.dropping = false;
      this.zoneForce = this.zoneForce.concat(bodies);
      const lead = this.game.players.find((p) => p.alive) ?? this.game.players[0];
      for (const e of bodies) e.alert(lead.position, true);
    });
    // the vents light a beat before the ship lets go, so the drop is read from
    // the floor before it is seen in the sky
    this.ventCue = { at: Math.max(0, eta - VENT_CUE_LEAD), spots: vents.slice() };
    audio.waveStart();
    this.game.announce(TEXT.banners.waveOf(this.waveNum, this.waveCount), TEXT.banners.hold(zone.spec.label));
  }

  /**
   * The vent glyphs: a ring and a column of light on each vent the incoming
   * wave will use. Meshes only — additive, no scene lights, so lighting them
   * costs no shader rebuild mid-fight. Pooled and reused wave to wave.
   */
  private showVentGlyphs(spots: THREE.Vector3[]): void {
    const accent = MISSION_LAYOUTS[this.game.board.kind].palette.accent;
    while (this.glyphs.length < spots.length) {
      const g = new THREE.Group();
      const m = new THREE.MeshBasicMaterial({
        color: accent, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.7, 24), m);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 7, 12, 1, true), m);
      column.position.y = 3.5;
      g.add(ring, column);
      g.visible = false;
      this.game.scene.add(g);
      this.glyphs.push({ mesh: g, mat: m });
    }
    this.glyphs.forEach((gl, i) => {
      gl.mesh.visible = i < spots.length;
      if (i < spots.length) gl.mesh.position.copy(spots[i]);
    });
    this.glyphLife = VENT_CUE_LIFE;
  }

  private updateVentGlyphs(dt: number): void {
    if (this.ventCue) {
      this.ventCue.at -= dt;
      if (this.ventCue.at <= 0) {
        this.showVentGlyphs(this.ventCue.spots);
        this.ventCue = null;
      }
    }
    if (this.glyphLife <= 0) return;
    this.glyphLife -= dt;
    const pulse = 0.45 + 0.35 * Math.sin(this.game.time * 9);
    const fade = Math.min(1, this.glyphLife / 0.6);
    for (const gl of this.glyphs) {
      gl.mat.opacity = pulse * fade;
      if (this.glyphLife <= 0) gl.mesh.visible = false;
    }
  }

  private clearZone(zone: MissionZone, fought: boolean): void {
    zone.entryBarrier?.open();
    zone.exitBarrier?.open();
    for (const h of zone.hatches) h.gate.close();
    // the far end of the zone is the safe ground — never a set piece's centre
    this.checkpoint.copy(zone.exit);
    this.idx++;
    this.phase = 'travel';
    this.bossCalled = false;
    if (fought) audio.waveClear();
    audio.checkpointChime();

    // The ground arrow: laid where the checkpoint was earned, pointing along
    // the path to the next zone's entry. Eight seconds bright, then a dim
    // breadcrumb for anyone who comes back this way.
    const to = this.idx < this.stage.zones.length
      ? this.stage.zones[this.idx].entry
      : this.stage.exitPortal?.pos ?? zone.exit;
    this.arrow.position.set(zone.exit.x, zone.exit.y + 0.08, zone.exit.z);
    this.arrow.rotation.z = -Math.atan2(to.x - zone.exit.x, to.z - zone.exit.z);
    this.arrow.visible = true;
    this.arrowLife = ARROW_PULSE;

    if (this.idx < this.stage.zones.length) {
      this.game.announce(TEXT.banners.checkpoint, TEXT.banners.pushOn(this.stage.zones[this.idx].spec.label));
    } else if (this.stage.exitPortal) {
      this.game.announce(TEXT.banners.checkpoint, TEXT.banners.pushOn(TEXT.missions.boarding(
        MISSION_LAYOUTS[this.game.board.kind].stages[this.stageIdx + 1]?.label ?? '')));
    }
  }

  /**
   * Which barriers stand open.
   *
   * A shut way is the resting state, so something has to say when it is
   * clear. Zones behind the party stay open — ground you have been through is
   * ground you can come back through — the zone being approached opens the way
   * in, and everything ahead stays shut, which is what stops a fight three
   * zones away being shot into from a corridor.
   *
   * Sealing is not done here: `enterZone` shuts a fight's ways and `clearZone`
   * opens them, and this runs first each frame so it never re-opens a way the
   * seal just closed.
   */
  private syncGates(): void {
    const zones = this.stage.zones;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (i < this.idx) { z.entryBarrier?.open(); z.exitBarrier?.open(); continue; }
      if (i > this.idx) continue;
      if (this.phase === 'travel') { z.entryBarrier?.open(); continue; }
      if (z.spec.kind === 'camp' || z.spec.kind === 'trek') { z.entryBarrier?.open(); z.exitBarrier?.open(); }
      // an outdoor fight never shuts the way you came in by
      else if (z.spec.shell !== 'hall' && z.spec.kind === 'assault') z.entryBarrier?.open();
    }
    // the way on to the next stage waits for the whole run to reach it
    const portal = this.stage.exitPortal;
    if (portal) {
      if (this.idx >= zones.length) portal.open();
      else portal.close();
    }
    // the way back is always open: it is a safety valve, not a fight
    this.stage.backPortal?.open();
  }

  /**
   * Run the doors' animation.
   *
   * Separate from `update` because that only ticks while the match is
   * `fighting`, and a door caught mid-slide by an intro or a victory card
   * would freeze there — still carrying its blocker, since the way is not
   * clear until the leaves are.
   */
  animateGates(dt: number): void {
    for (const z of this.stage.zones) {
      z.entryBarrier?.update(dt);
      z.exitBarrier?.update(dt);
      for (const h of z.hatches) h.gate.update(dt);
    }
    this.stage.exitPortal?.update(dt);
    this.stage.backPortal?.update(dt);
  }

  // ---------------------------------------------------------------- portals

  /**
   * The transport doors (docs/MISSIONS_OUTDOOR.md §1.9).
   *
   * Forward, one player boarding takes the party: nobody is left behind and
   * nobody is asked. Back, every living player has to be standing in the
   * pocket — a player who steps in is marked *exited* on every HUD and can
   * cancel back out, which is what stops a run being undone by one wrong step
   * in a fight.
   */
  private updatePortals(): void {
    const game = this.game;
    const stage = this.stage;
    const forward = stage.exitPortal;
    if (forward && forward.open_ && this.idx >= stage.zones.length) {
      for (const p of game.players) {
        if (!p.alive) continue;
        if (forward.depthOf(p.position) >= PORTAL_POCKET - 0.6) {
          this.beginTransit(this.stageIdx + 1);
          return;
        }
      }
    }

    const back = stage.backPortal;
    if (!back) return;
    const living = game.players.filter((p) => p.alive);
    for (const p of game.players) {
      const inPocket = p.alive && back.depthOf(p.position) >= PORTAL_POCKET - 0.6;
      if (inPocket && !this.exited.has(p.slot)) {
        this.exited.add(p.slot);
        p.exited = true;
        game.announce(TEXT.banners.steppedOut.title, TEXT.banners.steppedOut.sub);
      } else if (this.exited.has(p.slot) && (!p.alive || p.cancelExit)) {
        // cancel: they walk back out of the pocket and the wait resets
        this.exited.delete(p.slot);
        p.exited = false;
        p.cancelExit = false;
        p.position.addScaledVector(
          new THREE.Vector3(back.forward.x, 0, back.forward.z), -PORTAL_CANCEL_STEP);
      }
    }
    if (living.length > 0 && living.every((p) => this.exited.has(p.slot))) {
      this.beginTransit(this.stageIdx - 1);
    }
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    const game = this.game;
    if (this.done) return;

    // the transport beat: inputs are blanked by `Player.exited`, the card is
    // up, and the swap lands when the clock runs out
    if (this.transitT > 0) {
      this.transitT -= dt;
      if (this.transitT <= 0) {
        const to = this.transitTo;
        this.transitTo = -1;
        this.enterStage(to, to < this.stageIdx);
      }
      return;
    }

    this.syncGates();
    this.stage.tick(game.time);

    // beacon rides the objective and breathes
    const obj = this.objectivePos;
    this.beacon.position.set(obj.x, obj.y + 30, obj.z);
    this.beaconMat.opacity = 0.3 + 0.15 * Math.sin(game.time * 2.2);
    this.updateVentGlyphs(dt);
    if (this.arrowLife > 0) {
      this.arrowLife -= dt;
      this.arrowMat.opacity = 0.25 + 0.4 * Math.max(0, Math.sin(game.time * 3)) * Math.min(1, this.arrowLife / 2);
    } else if (this.arrow.visible) {
      this.arrowMat.opacity = 0.25;
    }

    // pickups: touch to heal
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.mesh.rotation.y = game.time * 1.4;
      for (const p of game.players) {
        if (!p.alive) continue;
        if (p.position.distanceToSquared(pk.pos) < 2.1) {
          pk.taken = true;
          pk.mesh.visible = false;
          p.hp = Math.min(p.maxHp, p.hp + 45);
          audio.bactaPickup();
          game.announce(TEXT.banners.bacta.title, TEXT.banners.bacta.sub);
          break;
        }
      }
    }

    // off the path: over a rim, off a plate, or into the stage's own water
    this.fallNote -= dt;
    const drowned = this.stage.waterY;
    for (const p of game.players) {
      if (!p.alive) continue;
      const fell = p.position.y < this.stage.floorY - FALL_DROP;
      const wet = drowned !== undefined && p.position.y < this.stage.floorY - WATER_DROP;
      if (!fell && !wet) continue;
      const at = this.respawnSpot(p.slot);
      p.position.copy(at);
      p.velocity.set(0, 0, 0);
      p.cover = null;
      p.peeking = false;
      if (this.fallNote <= 0) {
        this.fallNote = 4;
        const line = wet && !fell ? TEXT.banners.tookYou : TEXT.banners.offPath;
        game.announce(line.title, line.sub);
      }
    }

    // Hostiles get the same catch as the party. The stage is a plate in the
    // sky and the kill plane is far below it, so anything that leaves the
    // floor is deleted — and a boss deleted mid-fight is a zone that never
    // clears and a run that cannot be finished. Put it back instead.
    const here = this.zone;
    for (const e of game.enemies) {
      if (!e.alive || e.position.y > this.stage.floorY - FALL_DROP) continue;
      e.position.copy(this.placeNear(here.center.clone(), e.kind));
      e.velocity.set(0, 0, 0);
    }

    this.updateCeilingNote();
    this.updatePortals();
    if (this.transitT > 0) return;

    const zone = this.zone;
    if (this.idx >= this.stage.zones.length) return;   // waiting at the transport
    if (this.phase === 'travel') {
      // Indoors a fight waits for the whole party through the door; outdoors
      // it starts on a trigger line six metres in, which is what lets the way
      // in stay open behind you.
      const seals = zone.spec.shell === 'hall'
        && (zone.spec.kind === 'assault' || zone.spec.kind === 'lieutenant' || zone.spec.kind === 'warlord');
      const arena = zone.spec.kind === 'lieutenant' || zone.spec.kind === 'warlord';
      const walked = zone.spec.kind === 'camp' || zone.spec.kind === 'trek' || zone.spec.kind === 'start';
      const ready = seals || arena ? this.allInside(zone)
        : walked ? this.anyInside(zone)
          : this.anyInside(zone, 'triggerRect');
      if (ready) this.enterZone(zone);
      return;
    }
    switch (zone.spec.kind) {
      case 'start':
      case 'trek':
      case 'camp':
        if (this.nearExit(zone)) this.clearZone(zone, false);
        break;
      case 'chase':
        this.updateChase(dt, zone);
        break;
      case 'assault':
        if (this.waveDelay > 0) {
          this.waveDelay -= dt;
          if (this.waveDelay <= 0) this.spawnZoneWave(zone);
        } else if (!this.dropping && this.zoneForce.every((e) => !e.alive)) {
          if (this.waveNum < this.waveCount) this.waveDelay = 1.6;
          else this.clearZone(zone, true);
        }
        break;
      default:
        // `monsterStaging` covers the beat between the warlord falling and the
        // board's monster coming up: the arena is not done until that is
        if (this.bossCalled && game.boss && !game.boss.alive && !game.monsterStaging) {
          if (game.allyCrate) {
            game.allyCrate.retire(game);
            game.allyCrate = null;
          }
          if (zone.spec.kind === 'lieutenant') {
            this.clearZone(zone, true);
            game.announce(TEXT.banners.lieutenantFallsMission.title, TEXT.banners.lieutenantFallsMission.sub);
          } else {
            zone.entryBarrier?.open();
            this.done = true;
          }
        }
        break;
    }
  }

  /**
   * The road: harried the whole length of it.
   *
   * Nothing is sealed behind the party — the fight *is* the ride — and the
   * marks along the road fire their drops as the lead player passes them. It
   * clears when everyone still standing is past the far mouth, which the
   * barricade holds until it is rammed, blown, or cleared on foot.
   */
  private updateChase(dt: number, zone: MissionZone): void {
    void dt;
    const lead = this.game.players.filter((p) => p.alive)
      .sort((a, b) => a.position.distanceToSquared(zone.exit) - b.position.distanceToSquared(zone.exit))[0];
    if (lead) {
      zone.marks.forEach((m, i) => {
        if (this.marksFired[i]) return;
        if (lead.position.distanceToSquared(m) > 18 * 18) return;
        this.marksFired[i] = true;
        // A road is a hundred and sixty metres of fight; dying at the far end
        // and walking the whole of it again is not a cost, it is a punishment.
        // Each mark you reach is ground earned.
        this.checkpoint.copy(m);
        const wave = this.rampWave(zone.beat);
        const kinds = this.squadFor(wave, 3 + this.game.players.length, zone);
        const spots = kinds.map((_, k) => {
          const at = m.clone();
          at.x += (Math.random() - 0.5) * zone.spec.w * 0.6;
          at.z += (Math.random() - 0.5) * zone.spec.w * 0.6;
          void k;
          return at;
        });
        this.dropping = true;
        this.game.dropReinforcements(kinds, spots, 9700 + zone.beat * 10 + i, (bodies) => {
          this.dropping = false;
          this.zoneForce = this.zoneForce.concat(bodies);
          for (const e of bodies) e.alert(lead.position, true);
        });
        audio.waveStart();
      });
    }
    // the barricade is the wall: a fence lifts when the road's escort is down,
    // crates are shot or rammed out of the way
    if (zone.spec.barricade === 'fence' && this.zoneForce.every((e) => !e.alive) && !this.dropping) {
      zone.exitBarrier?.open();
    }
    // Through: the barricade is open and someone is out the far mouth. The
    // ride is the encounter, so it ends where the road does — waiting on every
    // last player to cross would hold the run on whoever is walking back.
    const open = !zone.exitBarrier || zone.exitBarrier.open_;
    const alive = this.game.players.filter((p) => p.alive);
    if (open && alive.some((p) => this.pastExit(zone, p.position))) this.clearZone(zone, true);
  }

  /** past the far mouth of a road: the ride is over and the ground is earned */
  private pastExit(zone: MissionZone, p: THREE.Vector3): boolean {
    const toExit = new THREE.Vector3().subVectors(zone.exit, zone.entry);
    const len = toExit.length() || 1;
    toExit.divideScalar(len);
    const along = (p.x - zone.entry.x) * toExit.x + (p.z - zone.entry.z) * toExit.z;
    return along >= len - 1.5;
  }

  /**
   * The one-time word about the ceiling. It is not a wall so much as where the
   * playable sky stops, and saying so once — the first time anyone meets it —
   * is the whole of the feedback it needs.
   */
  private updateCeilingNote(): void {
    if (this.ceilingNoted || this.game.ceilingY === null) return;
    const y = this.game.ceilingY;
    for (const p of this.game.players) {
      if (!p.alive || p.position.y + p.height < y - 0.2) continue;
      this.ceilingNoted = true;
      this.game.announce(TEXT.missions.ceiling[this.game.board.kind], TEXT.banners.ceilingSub);
      break;
    }
  }
}

/** locals and beasts, who come overland through a rim notch rather than by air */
const RUNNER_KINDS = new Set<EnemyKind>(['tusken', 'massiff', 'alamite', 'krykna', 'pirateMelee']);
