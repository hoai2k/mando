import * as THREE from 'three';
import type { Board } from '../world/board';
import { Player } from '../player/player';
import { Enemy } from '../enemies/enemy';
import { FINAL_WAVE, spawnWave } from '../enemies/spawner';
import { CombatDirector } from '../enemies/director';
import { ProjectileSystem, type BoltTarget } from '../fx/projectiles';
import type { MandoId } from '../characters/mandalorians';
import { ParticleFX } from '../fx/particles';
import { audio } from '../core/audio';
import { damp, yawBasis } from '../core/math';
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
  projectiles = new ProjectileSystem();
  particles = new ParticleFX();
  /** spreads alerts and decides who is allowed to push the player */
  director = new CombatDirector();
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
  /**
   * Dead Eye slows the whole world. This is the smoothed timescale — the ramp
   * in and out is most of what sells the effect.
   */
  timeScale = 1;
  /** seconds spent on the current wave, for the hunt escalation below */
  private waveTimer = 0;
  private huntCall = 0;
  private huntAnnounced = false;

  constructor(public board: Board, playerCount: number, aspect: number, private events: GameEvents, characters: MandoId[] = ['din', 'paz']) {
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
      const p = new Player(i, aspect, characters[i] ?? 'din');
      p.spawnAt(board.playerStarts[i] ?? board.playerStarts[0]);
      this.scene.add(p.char.root);
      this.players.push(p);
    }


    this.projectiles.onImpact = (point, hitTarget, team) => {
      this.particles.impactSparks(point, hitTarget ? 12 : 6);
      audio.impact();
      // player bolts slamming into the dirt next to someone still count as
      // incoming fire — near misses are what keep heads down
      if (team === 0 && !hitTarget) {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (e.position.distanceToSquared(point) < 4.5 * 4.5) e.suppress(0.22);
        }
      }
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
    this.director.noise(this, point, 70, true); // an explosion is not subtle
    for (const p of this.players) p.cam.shake(Math.max(0, 0.35 - point.distanceTo(p.position) * 0.01));
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = e.position.distanceTo(point);
      if (d < 7) {
        e.damage(90 * (1 - d / 8), point, bySlot);
        e.knockback(point, 18, 0.6);
        e.knockdown(1.4 + Math.random() * 0.8); // blast wave puts them flat
      }
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      const d = p.position.distanceTo(point);
      if (d < 4.5) p.damage(18 * (1 - d / 4.5), point);
    }
  }

  get aliveEnemyCount(): number { return this.enemies.filter((e) => e.alive).length; }

  update(realDt: number, inputs: FrameInput[]): void {
    // ---- Dead Eye ----
    // Any player in Dead Eye slows the world (both of them share it in
    // split-screen — one shared world, one clock). Players still update on a
    // faster clock than the world so the shooter keeps the advantage.
    const wantSlow = this.players.some((p) => p.alive && p.deadeyeActive);
    this.timeScale = damp(this.timeScale, wantSlow ? 0.3 : 1, 9, realDt);
    if (this.timeScale > 0.985) this.timeScale = 1;
    const dt = realDt * this.timeScale;

    this.time += dt;
    if (this.state === 'fighting' || this.state === 'break' || this.state === 'intro') this.elapsed += realDt;
    this.board.update?.(dt, this.time);

    // ---- match flow ----
    this.stateTimer -= dt;
    if (this.state === 'intro' && this.stateTimer <= 0) this.nextWave();
    if (this.state === 'break' && this.stateTimer <= 0) this.nextWave();
    if (this.state === 'fighting' && this.aliveEnemyCount === 0 && this.enemies.length > 0) {
      if (this.wave >= FINAL_WAVE) {
        this.setState('victory');
        this.events.banner('Territory held', 'This is the Way');
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
      p.update(dt, inputs[p.slot], this, realDt);
      if (!p.alive && p.respawnTimer <= 0 && this.state !== 'defeat' && this.state !== 'victory') {
        const partnerAlive = this.players.some((o) => o !== p && o.alive);
        if (this.players.length > 1 && partnerAlive) {
          p.spawnAt(this.board.playerStarts[p.slot] ?? this.board.playerStarts[0]);
          p.hp = p.maxHp * 0.6;
        } else {
          this.setState('defeat');
          this.events.banner('The Mando has fallen');
        }
      }
    }
    if (this.state !== 'defeat' && this.state !== 'victory' && this.players.every((p) => !p.alive) && this.players.length > 1) {
      this.setState('defeat');
      this.events.banner('The Mando has fallen');
    }

    // ---- hunt escalation ----
    // Posted enemies wait to be found, which must not let a wave stall out: if
    // one drags on, the remnant starts sweeping toward the players instead.
    if (this.state === 'fighting') {
      this.waveTimer += dt;
      this.huntCall -= dt;
      if (this.waveTimer > 80 && this.huntCall <= 0) {
        this.huntCall = 22;
        const p = this.players.find((pl) => pl.alive) ?? this.players[0];
        for (const e of this.enemies) if (e.alive) e.alert(p.position, false);
        if (!this.huntAnnounced) {
          this.huntAnnounced = true;
          this.events.banner('They are sweeping for you');
        }
      }
    }

    // ---- enemies ----
    this.director.update(dt, this);
    for (const e of this.enemies) {
      e.update(dt, this);
      if (!e.alive && !e.counted) {
        e.counted = true;
        this.totalKills++;
        this.particles.deathBurst(e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)));
        audio.killConfirm();
        this.director.deathNearby(this, e.position);
        if (e.lastHitBy >= 0 && this.players[e.lastHitBy]) {
          const killer = this.players[e.lastHitBy];
          killer.kills++;
          killer.deadeye = Math.min(1, killer.deadeye + 0.25); // kills feed the meter
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


    // ---- projectiles ----
    const targets: BoltTarget[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      targets.push({
        position: e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)),
        radius: e.radius + 0.35, team: 1, alive: e.alive,
        onHit: (dmg, from) => {
          const wasAlive = e.alive;
          const slot = this.nearestPlayerSlot(from);
          e.damage(dmg, from, slot);
          // every hit shoves: light per bolt, but it stacks over a burst
          e.knockback(from, 5.5, 0.2);
          if (wasAlive) this.hitMarker(slot);
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
    this.waveTimer = 0;
    this.huntCall = 0;
    this.huntAnnounced = false;
    this.setState('fighting');
    const near = this.players[0]?.position ?? this.board.playerStarts[0];
    spawnWave(this.board, this.wave, this.players.length, near, (e) => {
      this.enemies.push(e);
      this.scene.add(e.char.root);
      this.particles.dustPuff(e.position, 10);
    });
    const scattered = this.aliveEnemyCount;
    this.events.banner(
      `Wave ${this.wave}`,
      this.wave === FINAL_WAVE ? `Final wave · ${scattered} hostiles` : `${scattered} hostiles · hunt them down`
    );
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
