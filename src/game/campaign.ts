import { TEXT } from '../text';
import * as THREE from 'three';
import type { Game } from './game';
import { buildMission, MISSION_LAYOUTS, type MissionLevel, type MissionRoom } from '../world/mission';
import { FINAL_WAVE, waveComposition } from '../enemies/spawner';
import { Enemy, enemyBody, type EnemyKind } from '../enemies/enemy';
import { audio } from '../core/audio';

/**
 * The Missions run (docs/MODES.md §4, docs/LEVEL_DESIGN.md): the territory's
 * purpose-built mission level — an authored chain of walled fight rooms and
 * corridor pinches (world/mission.ts) — driven room by room. Camp rooms hold
 * posted garrisons you can fight or slip past; assault rooms seal their gates
 * and run waves from the wall vents until the room is held; the champion's
 * arena sits mid-chain and the warlord's ends it. A guide beacon always marks
 * the way forward, the last safe ground is the checkpoint, and every player
 * watches through their own camera — Missions splits the screen exactly like
 * the wave game.
 */

/** how close to the exit point counts as "through" a camp room */
const EXIT_R = 3.4;
/** vertical slack when judging who is inside a room (jetpack hops included) */
const ROOM_Y_SLACK = 8;
/** falling this far below the level floor reads as "off the path" */
const FALL_DROP = 9;
/** ranged kinds, for corridor defenders — the pinch is the cover-discipline beat */
const RANGED = new Set<EnemyKind>([
  'pyke', 'pirate', 'stormtrooper', 'deathtrooper', 'flametrooper',
  'quarren', 'ringEnforcer', 'droid', 'duelist',
]);

interface Pickup {
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  taken: boolean;
}

export class Campaign {
  level: MissionLevel;
  /** index of the room the party is pushing toward, or fighting in */
  idx = 1;
  private phase: 'travel' | 'fight' = 'travel';
  private waveNum = 0;
  private waveCount = 0;
  private waveDelay = 0;
  /** the sealed room's own hostiles; the gates release when the last falls */
  private roomForce: Enemy[] = [];
  /** a wave is called and its transport is still inbound — the room is owed it */
  private dropping = false;
  private bossCalled = false;
  /** where the fallen return: the last safe ground the party earned */
  checkpoint: THREE.Vector3;
  done = false;
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private pickups: Pickup[] = [];
  private fallNote = 0;

  constructor(private game: Game) {
    this.level = buildMission(game.board, MISSION_LAYOUTS[game.board.kind]);
    // the party drops at the trailhead, not on the territory below
    game.players.forEach((p, i) => p.spawnAt(this.level.starts[i % this.level.starts.length]));
    this.checkpoint = this.level.rooms[0].center.clone();

    // The level's garrison is posted from the start: camp squads in their
    // rooms and defenders behind the pinch crates, found under the normal
    // awareness rules — a quiet route past a camp is a real option.
    const rooms = this.level.rooms;
    rooms.forEach((room, i) => {
      if (room.spec.kind !== 'camp') return;
      const size = Math.min(room.posts.length + 2, 3 + Math.floor(this.rampWave(i) / 3) + this.game.players.length);
      this.postSquad(this.squadFor(this.rampWave(i), size), room.posts, 9000 + i);
    });
    this.level.defenders.forEach((posts, i) => {
      if (!posts.length) return;
      let pool = this.squadFor(this.rampWave(i + 1), posts.length + 2).filter((k) => RANGED.has(k));
      if (!pool.length) pool = game.board.kind === 'crevasse' ? ['krykna'] : ['stormtrooper'];
      posts.forEach((post, j) => {
        const e = new Enemy(pool[j % pool.length],
          this.placeNear(post.pos.clone(), pool[j % pool.length]), 1, { silent: true });
        e.squad = 9300 + i;
        e.squadSize = posts.length;
        game.enemies.push(e);
        game.scene.add(e.char.root);
      });
    });

    for (const pos of this.level.pickups) this.addPickup(pos);

    // ---- the guide beacon: one pillar, always the next objective ----
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffc860, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 60, 12, 1, true), this.beaconMat);
    this.beacon.position.copy(this.objectivePos);
    this.beacon.position.y += 30;
    this.beacon.frustumCulled = false;
    game.board.group.add(this.beacon);
  }

  /**
   * The difficulty ramp is *place*, not time: room `i` of the chain draws its
   * squads from the board's wave table at this wave — wave-one kinds at the
   * trailhead, the board's elites by the last stretch.
   */
  private rampWave(i: number): number {
    const n = this.level.rooms.length;
    return 1 + Math.round(((FINAL_WAVE - 1) * Math.max(0, i - 1)) / Math.max(1, n - 2));
  }

  /** a squad of ~budget bodies drawn across the board's wave-`wave` table */
  private squadFor(wave: number, budget: number): EnemyKind[] {
    const comp = waveComposition(this.game.board.kind,
      Math.min(FINAL_WAVE, Math.max(1, wave)), this.game.players.length);
    const kinds: EnemyKind[] = [];
    for (const entry of comp) for (let i = 0; i < entry.count; i++) kinds.push(entry.kind);
    if (!kinds.length) return ['stormtrooper'];
    const take = Math.min(budget, kinds.length);
    const out: EnemyKind[] = [];
    const stride = Math.max(1, Math.floor(kinds.length / take));
    for (let i = 0; out.length < take && i < kinds.length; i += stride) out.push(kinds[i]);
    // the wave's newest kind always makes the room's mix
    out[out.length - 1] = kinds[kinds.length - 1];
    return out;
  }

  /**
   * Somewhere inside the level a body of `kind` can stand, at or near `pos`.
   * The board-wide `standingSpot` falls back to the territory's own ground —
   * ninety metres below the level — so mission placement never uses it: a
   * hostile dropped onto the surface could never be reached, and a sealed
   * room waiting on it would never open.
   */
  placeNear(pos: THREE.Vector3, kind: EnemyKind): THREE.Vector3 {
    const body = enemyBody(kind);
    const phys = this.game.board.physics;
    const y = this.level.floorY + 0.2;
    if (this.level.contains(pos.x, pos.z) && phys.capsuleFree(pos.x, y, pos.z, body.radius, body.height)) {
      pos.y = y;
      return pos;
    }
    for (let ring = 1; ring <= 5; ring++) {
      const r = ring * 1.7;
      const steps = 8 + ring * 4;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2 + ring;
        const x = pos.x + Math.cos(a) * r;
        const z = pos.z + Math.sin(a) * r;
        if (!this.level.contains(x, z)) continue;
        if (phys.capsuleFree(x, y, z, body.radius, body.height)) return new THREE.Vector3(x, y, z);
      }
    }
    return new THREE.Vector3(pos.x, y, pos.z);
  }

  private postSquad(kinds: EnemyKind[], posts: THREE.Vector3[], squad: number): void {
    kinds.forEach((kind, i) => {
      const base = posts[i % posts.length].clone();
      base.x += (Math.random() - 0.5) * 3;
      base.z += (Math.random() - 0.5) * 3;
      const e = new Enemy(kind, this.placeNear(base, kind), 1, { silent: true });
      e.squad = squad;
      e.squadSize = kinds.length;
      this.game.enemies.push(e);
      this.game.scene.add(e.char.root);
    });
  }

  private addPickup(pos: THREE.Vector3): void {
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
    this.game.board.group.add(g);
    this.pickups.push({ pos: pos.clone(), mesh: g, taken: false });
  }

  private get room(): MissionRoom {
    return this.level.rooms[Math.min(this.idx, this.level.rooms.length - 1)];
  }

  /** where the beacon stands and the radar pip points */
  get objectivePos(): THREE.Vector3 {
    const room = this.room;
    if (this.phase === 'travel') return room.entry;
    // boss arenas: the beacon walks you onto the battle. Everything else
    // points at the way out — never at a set piece (the pit room's centre is
    // the pit), and a sealed exit gate reads as "clear the room to open it".
    if (room.spec.kind === 'champion' || room.spec.kind === 'warlord') return room.center;
    return room.exit;
  }

  /** HUD line: what to do and (on the move) how far it is */
  hint(from: THREE.Vector3): string {
    const room = this.room;
    const obj = this.objectivePos;
    const d = Math.round(Math.hypot(obj.x - from.x, obj.z - from.z));
    if (this.phase === 'travel') return TEXT.missions.makeFor(room.spec.label, d);
    switch (room.spec.kind) {
      case 'assault': return TEXT.missions.holdRoom(room.spec.label, Math.max(1, this.waveNum), this.waveCount);
      case 'champion': return TEXT.missions.bringDownChampion;
      case 'warlord': return TEXT.missions.bringDownWarlord;
      default: return TEXT.missions.pushThrough(room.spec.label, d);
    }
  }

  /** where player `slot` comes back: the checkpoint, fanned out and validated */
  respawnSpot(slot: number): THREE.Vector3 {
    const at = this.checkpoint.clone();
    at.x += (slot % 2) * 1.6 - 0.8;
    at.z += Math.floor(slot / 2) * 1.6 - 0.8;
    return this.placeNear(at, 'pyke');
  }

  private inside(room: MissionRoom, p: { position: THREE.Vector3 }): boolean {
    const r = room.rect;
    return p.position.x >= r.minX && p.position.x <= r.maxX
      && p.position.z >= r.minZ && p.position.z <= r.maxZ
      && Math.abs(p.position.y - this.level.floorY) < ROOM_Y_SLACK;
  }

  private anyInside(room: MissionRoom): boolean {
    return this.game.players.some((p) => p.alive && this.inside(room, p));
  }

  /**
   * Everyone still standing is in the room.
   *
   * The gate that seals a fight is the same gate the party walks in through,
   * so sealing on the *first* body through it locked everyone else out of
   * their own boss fight. A sealed room waits for the whole party; the dead
   * are not counted, since they come back at the checkpoint rather than
   * walking in, and a wipe would otherwise stall the level forever.
   */
  private allInside(room: MissionRoom): boolean {
    const alive = this.game.players.filter((p) => p.alive);
    return alive.length > 0 && alive.every((p) => this.inside(room, p));
  }

  private nearExit(room: MissionRoom): boolean {
    return this.game.players.some((p) => p.alive
      && p.position.distanceToSquared(room.exit) < EXIT_R * EXIT_R);
  }

  private enterRoom(room: MissionRoom): void {
    this.phase = 'fight';
    this.checkpoint.copy(room.entry);
    switch (room.spec.kind) {
      case 'camp':
        this.game.announce(room.spec.label, 'clear it, or slip through');
        break;
      case 'assault':
        room.entryGate?.close();
        room.exitGate?.close();
        this.waveCount = room.spec.waves ?? 2;
        this.waveNum = 0;
        this.roomForce = [];
        this.dropping = false;
        this.waveDelay = 0.9;
        this.game.announce(TEXT.banners.sealedIn, TEXT.banners.hold(room.spec.label));
        audio.waveStart();
        break;
      default:
        // a boss arena: the gates seal and the battle owns the room
        room.entryGate?.close();
        room.exitGate?.close();
        this.bossCalled = true;
        this.game.spawnBoss(room.center, room.spec.kind === 'champion' ? 'mid' : 'final');
        break;
    }
  }

  /**
   * Send in the next wave of a sealed room — by transport, exactly as the wave
   * game does it (src/enemies/arrival.ts).
   *
   * The vents still choose *where* the squad ends up; what changed is how it
   * gets there. Bodies standing up beside the wall read as a spawn, and a
   * mission level is roofless by construction, so the same carrier pass that
   * serves the open boards works over a sealed room without a special case.
   *
   * The squad does not exist until the ship lets it go, so `dropping` holds the
   * room open across the flight — without it the clear check finds an empty
   * force the frame after the wave is called and opens the doors on a room
   * whose defenders are still in the air.
   */
  private spawnRoomWave(room: MissionRoom): void {
    this.waveNum++;
    // later waves of the same room draw from deeper in the table
    const wave = this.rampWave(this.idx) + this.waveNum - 1;
    const budget = Math.min(12, 3 + wave + this.game.players.length);
    const kinds = this.squadFor(wave, budget);
    const spots = kinds.map((_, i) => {
      const vent = room.vents[i % room.vents.length].clone();
      vent.x += (Math.random() - 0.5) * 3;
      vent.z += (Math.random() - 0.5) * 3;
      return vent;
    });
    this.dropping = true;
    this.game.dropReinforcements(kinds, spots, 9500 + this.idx * 10 + this.waveNum, (bodies) => {
      this.dropping = false;
      this.roomForce = this.roomForce.concat(bodies);
      // whoever is on their feet when the ramp opens is what the squad came for
      const lead = this.game.players.find((p) => p.alive) ?? this.game.players[0];
      for (const e of bodies) e.alert(lead.position, true);
    });
    audio.waveStart();
    this.game.announce(TEXT.banners.waveOf(this.waveNum, this.waveCount), TEXT.banners.hold(room.spec.label));
  }

  private clearRoom(room: MissionRoom, fought: boolean): void {
    room.entryGate?.open();
    room.exitGate?.open();
    // the far end of the room is the safe ground — never a set piece's centre
    this.checkpoint.copy(room.exit);
    this.idx++;
    this.phase = 'travel';
    this.bossCalled = false;
    if (fought) audio.waveClear();
    else audio.uiConfirm();
    if (this.idx < this.level.rooms.length) {
      this.game.announce(TEXT.banners.checkpoint, TEXT.banners.pushOn(this.level.rooms[this.idx].spec.label));
    }
  }

  /**
   * Which doors stand open.
   *
   * A blast door's resting state is shut, so something has to say when the way
   * is clear. Rooms behind the party stay open — a door you have been through
   * is a door you can come back through — the room being approached opens the
   * one you walk in by, and a camp keeps both open because it never seals.
   * Everything ahead of the party stays shut, which is what stops a fight
   * three rooms away being shot into from the corridor.
   *
   * Sealing is not done here: `enterRoom` shuts a fight room's doors and
   * `clearRoom` opens them, and this runs first each frame so it never
   * re-opens a door the seal just closed.
   */
  private syncGates(): void {
    const rooms = this.level.rooms;
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if (i < this.idx) { r.entryGate?.open(); r.exitGate?.open(); continue; }
      if (i > this.idx) continue;
      if (this.phase === 'travel') { r.entryGate?.open(); continue; }
      if (r.spec.kind === 'camp') { r.entryGate?.open(); r.exitGate?.open(); }
    }
  }

  /**
   * Run the doors' animation.
   *
   * Separate from `update` because that only ticks while the match is
   * `fighting`, and a door caught mid-slide by an intro or a victory card
   * would freeze there — still carrying its blocker, since the way is not
   * clear until the leaves are. Which doors *should* be open is a question
   * about the run's progress and stays in `update`; moving the leaves is not.
   */
  animateGates(dt: number): void {
    for (const r of this.level.rooms) {
      r.entryGate?.update(dt);
      r.exitGate?.update(dt);
    }
  }

  update(dt: number): void {
    const game = this.game;
    if (this.done) return;

    this.syncGates();

    // beacon rides the objective and breathes
    const obj = this.objectivePos;
    this.beacon.position.set(obj.x, obj.y + 30, obj.z);
    this.beaconMat.opacity = 0.3 + 0.15 * Math.sin(game.time * 2.2);

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
          audio.uiConfirm();
          game.announce(TEXT.banners.bacta.title, TEXT.banners.bacta.sub);
          break;
        }
      }
    }

    // off the path (over a wall, down to the territory): back to the checkpoint
    this.fallNote -= dt;
    for (const p of game.players) {
      if (!p.alive || p.position.y > this.level.floorY - FALL_DROP) continue;
      const at = this.respawnSpot(p.slot);
      p.position.copy(at);
      p.velocity.set(0, 0, 0);
      p.cover = null;
      p.peeking = false;
      if (this.fallNote <= 0) {
        this.fallNote = 4;
        game.announce(TEXT.banners.offPath.title, TEXT.banners.offPath.sub);
      }
    }

    // Hostiles get the same catch as the party. The level is a plate in the
    // sky and the kill plane is 130 m below it, so anything that leaves the
    // floor is deleted — and a boss deleted mid-fight is a room that never
    // clears and a run that cannot be finished. Put it back on the arena
    // instead of losing it.
    const here = this.room;
    for (const e of game.enemies) {
      if (!e.alive || e.position.y > this.level.floorY - FALL_DROP) continue;
      e.position.copy(this.placeNear(here.center.clone(), e.kind));
      e.velocity.set(0, 0, 0);
    }

    const room = this.room;
    if (this.phase === 'travel') {
      // A camp is not sealed, so the first body through starts it; a room that
      // shuts its doors waits until nobody is left outside them.
      const seals = room.spec.kind !== 'camp';
      if (seals ? this.allInside(room) : this.anyInside(room)) this.enterRoom(room);
      return;
    }
    switch (room.spec.kind) {
      case 'camp':
        if (this.nearExit(room)) this.clearRoom(room, false);
        break;
      case 'assault':
        if (this.waveDelay > 0) {
          this.waveDelay -= dt;
          if (this.waveDelay <= 0) this.spawnRoomWave(room);
        } else if (!this.dropping && this.roomForce.every((e) => !e.alive)) {
          if (this.waveNum < this.waveCount) this.waveDelay = 1.6;
          else this.clearRoom(room, true);
        }
        break;
      default:
        // `monsterStaging` covers the beat between the warlord falling and the
        // board's monster coming up: the arena is not done until that is
        if (this.bossCalled && game.boss && !game.boss.alive && !game.monsterStaging) {
          if (room.spec.kind === 'champion') {
            this.clearRoom(room, true);
            game.announce(TEXT.banners.championFallsMission.title, TEXT.banners.championFallsMission.sub);
          } else {
            room.entryGate?.open();
            this.done = true;
          }
        }
        break;
    }
  }
}
