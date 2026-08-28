import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Board } from '../world/board';
import { Player } from '../player/player';
import { Enemy } from '../enemies/enemy';
import { FINAL_WAVE, spawnWave, waveComposition } from '../enemies/spawner';
import { CombatDirector } from '../enemies/director';
import { ProjectileSystem, type BoltTarget } from '../fx/projectiles';
import type { MandoId } from '../characters/mandalorians';
import { ParticleFX } from '../fx/particles';
import { audio } from '../core/audio';
import { yawBasis } from '../core/math';
import { loadOptionalTexture } from '../core/assets';
import { disposeSubtree } from '../core/dispose';
import { ENEMY_MODEL_ID, preloadAuthored } from '../characters/authored';
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
  private envSource: THREE.Texture | null = null;
  private envBuilt = false;
  /** PMREM output; three hands back a render target that has to be freed too */
  private envRT: THREE.WebGLRenderTarget | null = null;
  /** set by dispose(), so async loads that land afterwards stay out of a dead scene */
  private disposed = false;
  private rocketGeo = new THREE.ConeGeometry(0.09, 0.42, 6);
  private rocketMat = new THREE.MeshBasicMaterial({ color: 0xffd090 });
  totalKills = 0;
  elapsed = 0;
  /** seconds spent on the current wave, for the hunt escalation below */
  private waveTimer = 0;
  /** hostiles this wave put on the board — see the wave-clear check */
  private waveSpawned = 0;
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
        // the panorama is megabytes; quitting or restarting mid-download used
        // to drop it into a torn-down scene, orphaning the decoded texture
        if (this.disposed) { tex.dispose(); return; }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.scene.background = tex;
        this.scene.backgroundIntensity = board.skyIntensity ?? 1;
        this.envSource = tex;
        this.envBuilt = false;   // rebuild the reflection probe off the real sky
        if (board.proceduralSky) board.proceduralSky.visible = false;
      });
    }

    for (let i = 0; i < playerCount; i++) {
      const p = new Player(i, aspect, characters[i] ?? 'din');
      p.spawnAt(board.playerStarts[i] ?? board.playerStarts[0]);
      p.char.setHeroLight(board.heroLight ?? 0);
      this.scene.add(p.char.root);
      this.players.push(p);
    }


    // a bolt turned around by a shield: sparks at the pane, and the blocker
    // feels it land
    this.projectiles.onDeflect = (point) => {
      this.particles.impactSparks(point, 10);
      audio.impact();
      for (const p of this.players) {
        if (!p.blocking) continue;
        if (p.position.distanceToSquared(point) < 2.5 * 2.5) {
          p.char.shieldHit();
          p.cam.shake(0.05);
        }
      }
    };
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

    // The intro banner buys a couple of seconds; spend them fetching the models
    // wave one is about to need, rather than parsing them on the spawn frame.
    this.preloadWave(1);

    audio.startAmbient(board.kind === 'desert' ? 'desert' : 'station');
    audio.startMusic(board.kind === 'desert' ? 'desert' : 'station');
    this.events.banner(board.kind === 'desert' ? 'The Dune Sea' : 'The Spice Run', 'Survive 10 waves');
  }

  /**
   * Give the GPU back everything this match built.
   *
   * Three frees buffers and textures only on an explicit dispose(), so without
   * this every "Retry Board" left a whole previous board — terrain, props,
   * skies, characters, the reflection probe — resident for the life of the tab,
   * and repeated restarts walked GPU memory upward until the browser dropped
   * the context. Resources shared across matches (the character material cache,
   * the texture cache, loaded .glb scenes) are tagged and skipped; see
   * core/dispose.ts.
   */
  dispose(): void {
    this.disposed = true;
    audio.stopAmbient();
    audio.stopMusic();
    audio.stopJetpacks();

    disposeSubtree(this.scene);
    this.rocketGeo.dispose();
    this.rocketMat.dispose();
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.background = null;
    this.scene.environment?.dispose();
    this.envRT?.dispose();
    this.envRT = null;
    this.scene.environment = null;
    this.envSource = null;
    this.rockets.length = 0;
    this.enemies.length = 0;
    this.allies.length = 0;
    this.players.length = 0;
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

  update(dt: number, inputs: FrameInput[]): void {
    this.time += dt;
    if (this.state === 'fighting' || this.state === 'break' || this.state === 'intro') this.elapsed += dt;
    this.board.update?.(dt, this.time);

    // ---- match flow ----
    this.stateTimer -= dt;
    if (this.state === 'intro' && this.stateTimer <= 0) this.nextWave();
    if (this.state === 'break' && this.stateTimer <= 0) this.nextWave();
    // A wave is cleared once everything it spawned is down. Testing
    // `enemies.length > 0` instead — as a stand-in for "the wave has started" —
    // stalled the station permanently: enemies knocked into the abyss are
    // removed the same frame they die, rather than lingering as a corpse, so
    // the array could empty completely and the check could never fire again.
    if (this.state === 'fighting' && this.waveSpawned > 0 && this.aliveEnemyCount === 0) {
      // the fallen fade away now that the wave is decided
      for (const e of this.enemies) if (!e.alive) e.fadeOut();
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
      p.update(dt, inputs[p.slot], this);
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


    // ---- projectiles ----
    const targets: BoltTarget[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // Credit goes to whoever pulled the trigger. Deriving it from the bolt's
      // impact position instead handed player A's kills to player B whenever
      // the target happened to be standing nearer B — and credited ally fire to
      // a random player.
      const onHit = (dmg: number, from: THREE.Vector3, bySlot: number): void => {
        const wasAlive = e.alive;
        e.damage(dmg, from, bySlot);
        // every hit shoves: light per bolt, but it stacks over a burst
        e.knockback(from, 5.5, 0.2);
        if (wasAlive && bySlot >= 0) this.hitMarker(bySlot);
      };
      targets.push({
        position: e.position.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)),
        radius: e.radius + 0.35, team: 1, alive: e.alive,
        onHit,
      });
      // long bodies (the war massiff) need more than the one centre sphere
      if (e.def.hitParts) {
        const sin = Math.sin(e.yaw), cos = Math.cos(e.yaw);
        for (const part of e.def.hitParts) {
          targets.push({
            position: new THREE.Vector3(
              e.position.x + sin * part.z,
              e.position.y + part.y,
              e.position.z + cos * part.z
            ),
            radius: part.r, team: 1, alive: e.alive,
            onHit,
          });
        }
      }
    }
    for (const p of this.players) {
      if (!p.alive) continue;
      targets.push({
        position: p.position.clone().add(new THREE.Vector3(0, 0.9, 0)),
        radius: p.radius + 0.35, team: 0, alive: p.alive,
        shield: p.shieldCollider,
        slot: p.slot,
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
        this.particles.rocketExhaust(r.mesh.position, r.vel.clone().negate().normalize(), dt);
      }
    }
    this.rockets = this.rockets.filter((r) => r.life > 0);

    this.particles.update(dt);
  }

  /** Warm the .glb cache for everything a wave can put on the board. */
  private preloadWave(wave: number): void {
    if (wave > FINAL_WAVE) return;
    for (const entry of waveComposition(this.board.kind, wave, this.players.length)) {
      const id = ENEMY_MODEL_ID[entry.kind];
      if (id) preloadAuthored(id);
    }
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
    this.waveSpawned = 0;
    this.huntCall = 0;
    this.huntAnnounced = false;
    this.setState('fighting');
    const near = this.players[0]?.position ?? this.board.playerStarts[0];
    spawnWave(this.board, this.wave, this.players.length, near, (e) => {
      this.waveSpawned++;
      this.enemies.push(e);
      this.scene.add(e.char.root);
      this.particles.dustPuff(e.position, 10);
    });
    // the break before the next wave is the lead time for its new arrivals
    this.preloadWave(this.wave + 1);
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

  /**
   * Give the scene something for metal to reflect.
   *
   * The authored characters are PBR: their metallic-roughness maps drive most
   * of the armour to full metal, and a metal with nothing to reflect renders
   * black — which is exactly how they looked before this existed. Pre-filter
   * the board's sky into a reflection probe (a neutral room when a board has no
   * panorama) and every metal surface, procedural ones included, picks up the
   * light of the place it is standing in.
   */
  private buildEnvironment(renderer: THREE.WebGLRenderer): void {
    this.envBuilt = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = this.envSource
      ? pmrem.fromEquirectangular(this.envSource)
      : pmrem.fromScene(new RoomEnvironment(), 0.04);
    // The probe is rebuilt once when the authored sky lands, so the first one
    // has to go — and it is a render target, which pmrem.dispose() does not
    // free. Freeing the texture alone left the framebuffer behind.
    this.scene.environment?.dispose();
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
  }

  /** Split-screen render: one viewport per player (horizontal split). */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this.envBuilt) this.buildEnvironment(renderer);
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
