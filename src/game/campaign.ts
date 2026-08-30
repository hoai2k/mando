import * as THREE from 'three';
import type { Game } from './game';
import type { Board } from '../world/board';
import { hazardAt } from '../world/board';
import { buildCorridor, buildDoorFrame, type CorridorSpec } from '../world/corridor';
import { FINAL_WAVE, standingSpot, waveComposition } from '../enemies/spawner';
import { Enemy, type EnemyKind } from '../enemies/enemy';
import { audio } from '../core/audio';

/**
 * The campaign run (docs/MODES.md §4, docs/LEVEL_DESIGN.md): a winding path
 * of fight waypoints laid over the territory's own authored ground, two
 * door-gated corridor segments, bacta pickups, a guide beacon, checkpoints,
 * and the boss arena at the end. All players share one screen; the Game owns
 * the shared camera, this controller owns the level.
 */

type StepKind = 'node' | 'door' | 'corridor' | 'boss';

interface Step {
  kind: StepKind;
  /** where the beacon points for this step */
  pos: THREE.Vector3;
  /** squad that springs at close range instead of being posted (ambush template) */
  ambush?: { kind: EnemyKind; count: number }[];
  ambushSprung?: boolean;
  corridor?: CorridorSpec;
  /** where the party lands when this step completes with a teleport */
  landing?: THREE.Vector3;
  /** boss steps: which battle this arena holds — the champion or the warlord */
  bossTier?: 'mid' | 'final';
  bossCalled?: boolean;
  label: string;
}

interface Pickup {
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  taken: boolean;
}

/** how close counts as "reached" for a plain waypoint */
const ARRIVE_R = 7;
/** door trigger radius */
const DOOR_R = 2.6;
/** ambush squads spring at this range */
const AMBUSH_R = 24;
/** corridors float this far above the territory */
const CORRIDOR_Y = 90;

export class Campaign {
  steps: Step[] = [];
  idx = 0;
  /** where the fallen return: the last surface footing the party earned */
  checkpoint = new THREE.Vector3();
  /** true while the party is inside a corridor (spawns go to its entry) */
  private inCorridor = false;
  private beacon: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private pickups: Pickup[] = [];
  done = false;

  constructor(private game: Game) {
    const board = game.board;
    this.checkpoint.copy(board.playerStarts[0]);

    // ---- the tour: nearest-unvisited-neighbour over the board's own posts ----
    const left = board.groundSpawns.map((v) => v.clone());
    const path: THREE.Vector3[] = [];
    let cur = board.playerStarts[0].clone();
    while (left.length) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < left.length; i++) {
        const d = left[i].distanceToSquared(cur);
        if (d < bd) { bd = d; bi = i; }
      }
      cur = left.splice(bi, 1)[0];
      path.push(cur);
    }
    // very short boards still get a run: reuse the ends
    while (path.length < 6 && path.length > 0) path.push(path[path.length - 1].clone());

    // ---- assemble steps: nodes with two corridor dives, the champion's
    // arena at the path's midpoint, and the warlord's finale ----
    const doorAfter = new Set([Math.floor(path.length / 3) - 1, Math.floor((2 * path.length) / 3) - 1]);
    // the mid-board boss battle sits halfway along the level, the same beat
    // the wave game rings in after wave MID_BOSS_WAVE
    const midBossAfter = Math.floor((path.length - 1) / 2);
    let corridorSeed = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const node = path[i];
      // encounter templates alternate: posted camp / sprung ambush, with a
      // breather (no squad) on the node right after each corridor
      const template = i % 3 === 2 ? 'ambush' : 'camp';
      const wave = 1 + Math.round(((FINAL_WAVE - 1) * i) / Math.max(1, path.length - 1));
      const squad = this.squadFor(wave);
      const step: Step = { kind: 'node', pos: node, label: 'Push on' };
      if (template === 'ambush') {
        step.ambush = squad.map((kind) => ({ kind, count: 1 }));
        step.label = 'Something is wrong here';
      } else {
        this.postSquad(squad, node);
      }
      this.steps.push(step);

      if (doorAfter.has(i)) {
        // the corridor dive: a door on the surface, the lane in the sky
        const origin = new THREE.Vector3(node.x * 0.5, CORRIDOR_Y + corridorSeed * 14, node.z * 0.5);
        const spec = buildCorridor(board, origin, (corridorSeed + 7) * 1013, 3);
        corridorSeed++;
        const doorPos = this.groundAt(board, node.clone().add(new THREE.Vector3(6, 0, 6)));
        buildDoorFrame(board.group, doorPos, Math.atan2(-doorPos.x, -doorPos.z));
        const next = path[i + 1];
        this.steps.push({ kind: 'door', pos: doorPos, corridor: spec, label: 'Enter the door' });
        const exitDoorYaw = 0;
        buildDoorFrame(board.group, spec.exit.clone(), exitDoorYaw);
        this.steps.push({
          kind: 'corridor', pos: spec.exit, corridor: spec,
          landing: this.groundAt(board, next.clone()), label: 'Fight through',
        });
        // corridor defenders: the board's shooters, posted behind the crates
        this.postCorridorDefenders(spec);
        // bacta in each pocket — the corridor is the attrition beat
        for (const p of spec.pockets) this.addPickup(p.clone().add(new THREE.Vector3(0, 0.2, 0)));
      }

      // the champion's arena: the next post on the tour becomes a boss beat
      if (i === midBossAfter) {
        this.steps.push({
          kind: 'boss', bossTier: 'mid',
          pos: this.groundAt(board, path[i + 1].clone()), label: 'Face the champion',
        });
      }

      // hidden bacta off the golden path every third node (reward for wandering)
      if (i % 3 === 1) {
        const side = new THREE.Vector3(node.z, 0, -node.x).normalize().multiplyScalar(9);
        this.addPickup(this.groundAt(board, node.clone().add(side)));
      }
    }

    // ---- boss arena: the board's own last post, promoted ----
    const arena = path[path.length - 1];
    this.steps.push({ kind: 'boss', bossTier: 'final', pos: arena, label: 'Face the warlord' });

    // ---- beacon ----
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffc860, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 60, 12, 1, true), this.beaconMat);
    this.beacon.position.copy(this.steps[0].pos);
    this.beacon.position.y += 30;
    this.beacon.frustumCulled = false;
    board.group.add(this.beacon);
  }

  /** ground-snapped copy of a point, so doors and pickups sit on the dirt */
  private groundAt(board: Board, p: THREE.Vector3): THREE.Vector3 {
    const g = board.physics.groundHeight(p.x, p.z, p.y + 12);
    if (isFinite(g)) p.y = g + 0.1;
    return p;
  }

  /** a small squad drawn from this board's wave table at `wave` */
  private squadFor(wave: number): EnemyKind[] {
    const comp = waveComposition(this.game.board.kind, Math.min(FINAL_WAVE, wave), this.game.players.length);
    const kinds: EnemyKind[] = [];
    for (const entry of comp) for (let i = 0; i < entry.count && kinds.length < 12; i++) kinds.push(entry.kind);
    // 4–6 bodies, biased toward the tail of the list (the wave's newer kinds)
    const size = Math.min(kinds.length, 4 + (wave > 5 ? 2 : 1));
    const out: EnemyKind[] = [];
    for (let i = 0; i < size; i++) out.push(kinds[(kinds.length - 1 - i * 2 + kinds.length * 4) % kinds.length]);
    return out;
  }

  private postSquad(kinds: EnemyKind[], node: THREE.Vector3): void {
    const squad = 9000 + this.steps.length;
    for (const kind of kinds) {
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 8, 0.2, (Math.random() - 0.5) * 8);
      const pos = standingSpot(this.game.board, node.clone().add(jitter), kind);
      const e = new Enemy(kind, pos);
      e.squad = squad;
      e.squadSize = kinds.length;
      this.game.enemies.push(e);
      this.game.scene.add(e.char.root);
    }
  }

  private postCorridorDefenders(spec: CorridorSpec): void {
    const shooters = this.squadFor(4).filter((k) => {
      // corridors are the cover beat: shooters only (melee swarms on ice boards)
      const ranged = new Set<EnemyKind>(['pyke', 'pirate', 'stormtrooper', 'deathtrooper', 'flametrooper', 'quarren', 'ringEnforcer', 'droid']);
      return ranged.has(k);
    });
    const pool: EnemyKind[] = shooters.length ? shooters
      : this.game.board.kind === 'crevasse' ? ['krykna'] : ['stormtrooper'];
    spec.enemySpots.forEach((spot, i) => {
      const kind = pool[i % pool.length];
      const e = new Enemy(kind, spot.pos.clone());
      e.squad = 9500 + i % 3;
      e.squadSize = 3;
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

  get step(): Step { return this.steps[Math.min(this.idx, this.steps.length - 1)]; }
  get objectivePos(): THREE.Vector3 { return this.step.pos; }

  /** HUD line: what to do and how far it is (from player one) */
  hint(from: THREE.Vector3): string {
    const d = Math.round(Math.hypot(this.step.pos.x - from.x, this.step.pos.z - from.z));
    return `${this.step.label} · ${d} m`;
  }

  /** where a fallen player comes back */
  get respawnPoint(): THREE.Vector3 {
    return this.inCorridor && this.step.corridor ? this.step.corridor.entry : this.checkpoint;
  }

  private teleportParty(to: THREE.Vector3): void {
    this.game.players.forEach((p, i) => {
      p.position.set(to.x + (i % 2) * 1.6 - 0.8, to.y + 0.2, to.z + Math.floor(i / 2) * 1.6);
      p.velocity.set(0, 0, 0);
      p.cover = null;
      p.peeking = false;
    });
    audio.uiConfirm();
  }

  update(dt: number): void {
    void dt;
    const game = this.game;
    if (this.done) return;
    const step = this.step;

    // beacon rides the objective and breathes
    this.beacon.position.set(step.pos.x, step.pos.y + 30, step.pos.z);
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
          game.announce('Bacta canister', '+45 health');
          break;
        }
      }
    }

    const nearest = (r: number): boolean =>
      game.players.some((p) => p.alive && p.position.distanceToSquared(step.pos) < r * r);

    // ambush template: the squad springs when the party walks in
    if (step.ambush && !step.ambushSprung && nearest(AMBUSH_R)) {
      step.ambushSprung = true;
      const lead = game.players.find((p) => p.alive) ?? game.players[0];
      for (const spec of step.ambush) {
        for (let i = 0; i < spec.count; i++) {
          const a = Math.random() * Math.PI * 2;
          const at = step.pos.clone().add(new THREE.Vector3(Math.cos(a) * 12, 0.2, Math.sin(a) * 12));
          const e = game.addReinforcement(spec.kind, at);
          e.alert(lead.position, true);
        }
      }
      game.announce('Ambush!');
      audio.waveStart();
    }

    switch (step.kind) {
      case 'node':
        if (nearest(ARRIVE_R)) this.arrive(step.pos);
        break;
      case 'door':
        if (nearest(DOOR_R) && step.corridor) {
          this.inCorridor = true;
          this.teleportParty(step.corridor.entry);
          this.idx++;
          game.announce('Corridor', 'take cover, advance, clear it');
        }
        break;
      case 'corridor':
        if (nearest(DOOR_R) && step.landing) {
          this.inCorridor = false;
          this.teleportParty(step.landing);
          this.checkpoint.copy(step.landing);
          this.idx++;
          game.announce('Checkpoint', 'back to the surface');
          audio.waveClear();
        }
        break;
      case 'boss':
        if (!step.bossCalled && nearest(38)) {
          step.bossCalled = true;
          game.spawnBoss(step.pos, step.bossTier ?? 'final');
        }
        // `monsterStaging` covers the beat between the warlord falling and the
        // board's monster coming up: the step is not done until that is
        if (step.bossCalled && game.boss && !game.boss.alive && !game.monsterStaging) {
          if (step.bossTier === 'mid') {
            // the champion falls: a checkpoint, and the road to the warlord
            this.checkpoint.copy(step.pos);
            this.idx++;
            game.announce('The champion falls', 'the warlord waits at the end');
            audio.waveClear();
          } else {
            this.done = true;
          }
        }
        break;
    }

    // a checkpoint you cannot stand on is no checkpoint: nudge off hazards
    if (hazardAt(game.board, this.checkpoint).kill) this.checkpoint.copy(game.board.playerStarts[0]);
  }

  private arrive(pos: THREE.Vector3): void {
    this.checkpoint.copy(pos);
    this.idx++;
    this.game.announce('Checkpoint', this.step.label);
    audio.waveClear();
  }
}
