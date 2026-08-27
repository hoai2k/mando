import * as THREE from 'three';
import type { Board } from '../world/board';
import { Player } from '../player/player';
import { Enemy } from '../enemies/enemy';
import { FINAL_WAVE, spawnWave } from '../enemies/spawner';
import { ProjectileSystem, type BoltTarget } from '../fx/projectiles';
import { ParticleFX } from '../fx/particles';
import { audio } from '../core/audio';
import type { FrameInput } from '../core/input';

export type MatchState = 'intro' | 'fighting' | 'break' | 'victory' | 'defeat';

export interface GameEvents {
  banner: (text: string, sub?: string) => void;
  stateChanged: (s: MatchState) => void;
  hitMarker: (slot: number) => void;
}

interface Rocket {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  target: Enemy | null;
  life: number;
  bySlot: number;
}

export class Game {
  scene = new THREE.Scene();
  players: Player[] = [];
  enemies: Enemy[] = [];
  projectiles = new ProjectileSystem();
  particles = new ParticleFX();
  time = 0;
  wave = 0;
  state: MatchState = 'intro';
  private stateTimer = 2.2;
  private rockets: Rocket[] = [];
  private rocketGeo = new THREE.ConeGeometry(0.09, 0.42, 6);
  private rocketMat = new THREE.MeshBasicMaterial({ color: 0xffd090 });
  totalKills = 0;
  elapsed = 0;

  constructor(public board: Board, playerCount: number, aspect: number, private events: GameEvents) {
    this.scene.add(board.group);
    this.scene.add(this.projectiles.group);
    this.scene.add(this.particles.group);
    this.scene.background = board.background;
    this.scene.fog = board.fog;

    for (let i = 0; i < playerCount; i++) {
      const p = new Player(i, aspect);
      p.spawnAt(board.playerStarts[i] ?? board.playerStarts[0]);
      this.scene.add(p.char.root);
      this.players.push(p);
    }

    this.projectiles.onImpact = (point, hitTarget) => {
      this.particles.impactSparks(point, hitTarget ? 12 : 6);
      audio.impact();
    };

    audio.startAmbient(board.kind === 'desert' ? 'desert' : 'station');
    audio.startMusic(board.kind === 'desert' ? 55 : 49);
    this.events.banner(board.kind === 'desert' ? 'The Dune Sea' : 'The Spice Run', 'Survive 10 waves');
  }

  dispose(): void {
    audio.stopAmbient();
    audio.stopMusic();
    audio.setJetpackThrust(0, 0);
    audio.setJetpackThrust(1, 0);
  }

  fireRocket(origin: THREE.Vector3, dir: THREE.Vector3, target: Enemy | null, bySlot: number): void {
    const mesh = new THREE.Mesh(this.rocketGeo, this.rocketMat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.rockets.push({ mesh, vel: dir.clone().multiplyScalar(38), target, life: 4, bySlot });
  }

  hitMarker(slot: number): void {
    this.events.hitMarker(slot);
    audio.hitMarker();
  }

  private explode(point: THREE.Vector3, bySlot: number): void {
    this.particles.explosion(point);
    audio.explosion();
    for (const p of this.players) p.cam.shake(Math.max(0, 0.35 - point.distanceTo(p.position) * 0.01));
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(point);
      if (d < 7) {
        e.damage(90 * (1 - d / 8), point, bySlot);
        e.knockback(point, 18);
      }
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = p.position.distanceTo(point);
      if (d < 4.5) p.damage(18 * (1 - d / 4.5), point);
    }
  }

  get aliveEnemyCount(): number { return this.enemies.filter((e) => e.alive).length; }

  update(dt: number, inputs: FrameInput[]): void {
    this.time += dt;
    if (this.state === 'fighting' || this.state === 'break' || this.state === 'intro') this.elapsed += dt;
    this.board.update?.(dt, this.time);

    // ---- match flow ----
    this.stateTimer -= dt;
    if (this.state === 'intro' && this.stateTimer <= 0) this.nextWave();
    if (this.state === 'break' && this.stateTimer <= 0) this.nextWave();
    if (this.state === 'fighting' && this.aliveEnemyCount === 0 && this.enemies.length > 0) {
      if (this.wave >= FINAL_WAVE) {
        this.setState('victory');
        this.events.banner('Territory held', 'The Daimyo rules');
        audio.waveClear();
      } else {
        this.setState('break');
        this.stateTimer = 4.5;
        this.events.banner(`Wave ${this.wave} cleared`);
        audio.waveClear();
      }
    }

    // ---- players ----
    for (const p of this.players) {
      p.update(dt, inputs[p.slot], this);
      if (!p.alive && p.respawnTimer <= 0 && this.state !== 'defeat' && this.state !== 'victory') {
        const partnerAlive = this.players.some((o) => o !== p && o.alive);
        if (this.players.length > 1 && partnerAlive) {
          p.spawnAt(this.board.playerStarts[p.slot] ?? this.board.playerStarts[0]);
          p.hp = p.maxHp * 0.6;
        } else {
          this.setState('defeat');
          this.events.banner('The Daimyo has fallen');
        }
      }
    }
    if (this.state !== 'defeat' && this.state !== 'victory' && this.players.every((p) => !p.alive) && this.players.length > 1) {
      this.setState('defeat');
      this.events.banner('The Daimyo has fallen');
    }

    // ---- enemies ----
    for (const e of this.enemies) {
      e.update(dt, this);
      if (!e.alive && !e.counted) {
        e.counted = true;
        this.totalKills++;
        this.particles.deathBurst(e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)));
        audio.killConfirm();
        if (e.lastHitBy >= 0 && this.players[e.lastHitBy]) {
          this.players[e.lastHitBy].kills++;
          this.events.hitMarker(e.lastHitBy);
        }
      }
      if (e.removeMe) this.scene.remove(e.char.root);
    }
    this.enemies = this.enemies.filter((e) => !e.removeMe);

    // ---- projectiles ----
    const targets: BoltTarget[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      targets.push({
        position: e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)),
        radius: e.radius + 0.35, team: 1, alive: e.alive,
        onHit: (dmg, from) => {
          const wasAlive = e.alive;
          e.damage(dmg, from, this.nearestPlayerSlot(from));
          if (wasAlive) this.hitMarker(this.nearestPlayerSlot(from));
        },
      });
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      targets.push({
        position: p.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        radius: p.radius + 0.35, team: 0, alive: p.alive,
        onHit: (dmg, from) => p.damage(dmg, from),
      });
    }
    this.projectiles.update(dt, this.board.physics, targets);

    // ---- rockets ----
    for (const r of this.rockets) {
      r.life -= dt;
      if (r.target && r.target.alive) {
        const to = r.target.position.clone().add(new THREE.Vector3(0, r.target.height * 0.5, 0)).sub(r.mesh.position).normalize();
        r.vel.lerp(to.multiplyScalar(38), Math.min(1, dt * 4));
      }
      const step = r.vel.clone().multiplyScalar(dt);
      const hit = this.board.physics.raycast(r.mesh.position, step.clone().normalize(), step.length() + 0.2);
      let exploded = false;
      if (hit) { this.explode(hit.point, r.bySlot); exploded = true; }
      else {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (e.position.distanceTo(r.mesh.position) < e.radius + 0.9) {
            this.explode(r.mesh.position.clone(), r.bySlot);
            exploded = true;
            break;
          }
        }
      }
      if (r.life <= 0 && !exploded) { this.explode(r.mesh.position.clone(), r.bySlot); exploded = true; }
      if (exploded) { this.scene.remove(r.mesh); r.life = -1; }
      else {
        r.mesh.position.add(step);
        r.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r.vel.clone().normalize());
        this.particles.jetFlame(r.mesh.position, new THREE.Vector3(0, 0, 0));
      }
    }
    this.rockets = this.rockets.filter((r) => r.life > 0);

    this.particles.update(dt);
  }

  private nearestPlayerSlot(from: THREE.Vector3): number {
    let slot = 0, bestD = Infinity;
    for (const p of this.players) {
      const d = p.position.distanceToSquared(from);
      if (d < bestD) { bestD = d; slot = p.slot; }
    }
    return slot;
  }

  private setState(s: MatchState): void {
    this.state = s;
    this.events.stateChanged(s);
  }

  private nextWave(): void {
    this.wave++;
    this.setState('fighting');
    const near = this.players[0]?.position ?? this.board.playerStarts[0];
    spawnWave(this.board, this.wave, this.players.length, near, (e) => {
      this.enemies.push(e);
      this.scene.add(e.char.root);
      this.particles.dustPuff(e.position, 10);
    });
    this.events.banner(`Wave ${this.wave}`, this.wave === FINAL_WAVE ? 'Final wave' : undefined);
    audio.waveStart();
  }

  /** Split-screen render: one viewport per player (horizontal split). */
  render(renderer: THREE.WebGLRenderer): void {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const n = this.players.length;
    renderer.setScissorTest(n > 1);
    for (let i = 0; i < n; i++) {
      const vh = n > 1 ? h / 2 : h;
      const vy = n > 1 ? (i === 0 ? h / 2 : 0) : 0;
      const cam = this.players[i].cam.camera;
      cam.aspect = w / vh;
      cam.updateProjectionMatrix();
      renderer.setViewport(0, vy, w, vh);
      renderer.setScissor(0, vy, w, vh);
      renderer.render(this.scene, cam);
    }
    renderer.setScissorTest(false);
  }
}
