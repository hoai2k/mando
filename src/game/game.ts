import * as THREE from 'three';
import type { Board } from '../world/board';
import { Player } from '../player/player';
import { Enemy } from '../enemies/enemy';
import { FINAL_WAVE, spawnWave } from '../enemies/spawner';
import { ProjectileSystem, type BoltTarget } from '../fx/projectiles';
import { buildGrogu } from '../characters/enemies';
import type { MandoId } from '../characters/mandalorians';
import { ParticleFX } from '../fx/particles';
import { audio } from '../core/audio';
import { yawBasis } from '../core/math';
import { loadOptionalTexture } from '../core/assets';
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
  allies: Enemy[] = [];
  private grogu: ReturnType<typeof buildGrogu> | null = null;
  private groguCoo = 6;
  projectiles = new ProjectileSystem();
  particles = new ParticleFX();
  time = 0;
  wave = 0;
  state: MatchState = 'intro';
  private stateTimer = 2.2;
  private rockets: Rocket[] = [];
  private tmpSize = new THREE.Vector2();
  private rocketGeo = new THREE.ConeGeometry(0.09, 0.42, 6);
  private rocketMat = new THREE.MeshBasicMaterial({ color: 0xffd090 });
  totalKills = 0;
  elapsed = 0;

  constructor(public board: Board, playerCount: number, aspect: number, private events: GameEvents, characters: MandoId[] = ['boba', 'din']) {
    this.scene.add(board.group);
    this.scene.add(this.projectiles.group);
    this.scene.add(this.particles.group);
    this.scene.background = board.background;
    this.scene.fog = board.fog;

    // authored equirect panorama replaces the procedural sky dome when present
    if (board.skyFile) {
      loadOptionalTexture(board.skyFile, (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.background = tex;
        this.scene.backgroundIntensity = board.skyIntensity ?? 1;
        if (board.proceduralSky) board.proceduralSky.visible = false;
      });
    }

    for (let i = 0; i < playerCount; i++) {
      const p = new Player(i, aspect, characters[i] ?? 'boba');
      p.spawnAt(board.playerStarts[i] ?? board.playerStarts[0]);
      this.scene.add(p.char.root);
      this.players.push(p);
    }

    // Grogu tags along with player 1 in his floating pram
    this.grogu = buildGrogu();
    this.grogu.root.position.copy(this.players[0].position).add(new THREE.Vector3(-1.5, 1.4, -1));
    this.scene.add(this.grogu.root);

    this.projectiles.onImpact = (point, hitTarget) => {
      this.particles.impactSparks(point, hitTarget ? 12 : 6);
      audio.impact();
    };

    audio.startAmbient(board.kind === 'desert' ? 'desert' : 'station');
    audio.startMusic(board.kind === 'desert' ? 'desert' : 'station');
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

    // ---- allies ----
    for (const a of this.allies) {
      a.update(dt, this);
      if (!a.alive && !a.counted) {
        a.counted = true;
        this.particles.deathBurst(a.position.clone().add(new THREE.Vector3(0, a.height * 0.5, 0)));
      }
      if (a.removeMe) this.scene.remove(a.char.root);
    }
    this.allies = this.allies.filter((a) => !a.removeMe);

    // ---- Grogu follows player 1, out of harm's way ----
    if (this.grogu) {
      const p0 = this.players[0];
      // trail him behind and to the player's LEFT: the chase camera sits over
      // the right shoulder, so anything on the right crowds the frame
      const b = yawBasis(p0.cam.yaw);
      const goal = new THREE.Vector3(
        p0.position.x - b.fwdX * 2.2 - b.rightX * 1.7,
        p0.position.y + 1.35,
        p0.position.z - b.fwdZ * 2.2 - b.rightZ * 1.7
      );
      this.grogu.root.position.lerp(goal, Math.min(1, dt * 3.6));
      // angle the pram's open face back toward the chase camera so Grogu is
      // actually visible instead of showing the blank shell of the pram
      this.grogu.root.rotation.y = p0.cam.yaw - Math.PI * 0.78;
      this.grogu.cosmetic?.(dt, this.time);
      this.groguCoo -= dt;
      if (this.groguCoo <= 0) {
        this.groguCoo = 10 + Math.random() * 14;
        audio.bark('grogu_coo', 0.5);
      }
    }

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
    for (const a of this.allies) {
      if (!a.alive) continue;
      targets.push({
        position: a.position.clone().add(new THREE.Vector3(0, a.height * 0.5, 0)),
        radius: a.radius + 0.35, team: 0, alive: a.alive,
        onHit: (dmg, from) => a.damage(dmg, from, -1),
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
    if (s === 'victory') audio.sting(true);
    if (s === 'defeat') audio.sting(false);
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

    // ally reinforcements from the covert on milestone waves
    const allyKind = this.wave === 4 ? 'marshal' : this.wave === 7 ? 'ig11' : this.wave === 9 ? 'fennec' : null;
    if (allyKind) {
      const start = this.board.playerStarts[0].clone().add(new THREE.Vector3(2.5, 0, 2.5));
      const ally = new Enemy(allyKind, start, 0);
      this.allies.push(ally);
      this.scene.add(ally.char.root);
      this.particles.dustPuff(start, 12);
      const names: Record<string, string> = { marshal: 'The Marshal joins the fight', ig11: 'IG-11 joins the fight', fennec: 'Fennec Shand joins the fight' };
      this.events.banner(`Wave ${this.wave}`, names[allyKind]);
    }
  }

  /** Split-screen render: one viewport per player (horizontal split). */
  render(renderer: THREE.WebGLRenderer): void {
    // getSize reports CSS pixels, which is what setViewport/setScissor expect —
    // they scale by the renderer's pixel ratio themselves. Passing
    // domElement.width here applies devicePixelRatio twice, blowing the
    // viewport past the drawing buffer on HiDPI screens and shoving the
    // rendered scene up and to the right.
    renderer.getSize(this.tmpSize);
    const w = this.tmpSize.x;
    const h = this.tmpSize.y;
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
