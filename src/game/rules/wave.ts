import * as THREE from 'three';
import type { Game } from '../game';
import type { Player } from '../../player/player';
import type { ModeRules } from './rules';
import { ENEMY_NAME, type EnemyKind } from '../../enemies/enemy';
import { ALLY_WAVES, FINAL_WAVE, MID_BOSS_WAVE, planWave, postInView, spawnWave, waveComposition } from '../../enemies/spawner';
import { enemyModelIds, warmAuthored } from '../../characters/authored';
import { AllyCrate } from '../allycrate';
import { BOSS_KIND, INFINITE_LIVES, MID_BOSS, bossRush } from '../modes';
import { audio } from '../../core/audio';
import { TEXT } from '../../text';

/** seconds a wave may drag on before the remnant starts sweeping for the players */
const HUNT_AFTER = 45;
/** ...or this few left on the board, scattered, whichever comes first */
const HUNT_REMNANT = 3;
/** the pause between a cleared wave and the next bell */
const BREAK = 4.5;

/**
 * Wave Battle: seven waves of a territory's garrison with two boss battles
 * woven through them (docs/MODES.md §2). The champion answers for clearing
 * wave 4 and the warlord for clearing wave 7, and victory is the warlord —
 * or, on a board with a monster under it, what comes up when he falls.
 */
export class WaveRules implements ModeRules {
  readonly objective: string;
  /**
   * The waves each boss battle rings in after. Normally the design's schedule
   * (spawner.ts); `?waves=boss` compresses it to a single wave before each
   * battle, for iterating on the bosses themselves.
   */
  private readonly midBossWave = bossRush() ? 1 : MID_BOSS_WAVE;
  private readonly finalWave = bossRush() ? 2 : FINAL_WAVE;
  /** true while the mid-board champion's battle runs */
  private midBossActive = false;
  /** the champion has fallen; the second run of waves is open */
  private midBossDown = false;
  /** seconds spent on the current wave, for the hunt escalation */
  private waveTimer = 0;
  private huntCall = 0;
  private huntAnnounced = false;

  constructor(private g: Game) {
    this.objective = g.board.objective ?? TEXT.banners.objective.wave;
  }

  /** the last wave before the warlord — the boss bar and the drop screen ask */
  get lastWave(): number { return this.finalWave; }

  begin(): void {
    const g = this.g;
    // The intro banner buys a couple of seconds; spend them fetching the
    // models wave one is about to need, rather than parsing them on the
    // spawn frame.
    this.preloadWave(1);
    // The three allies are certain to appear in a full match and are only
    // three files, so warm them now rather than the instant one walks into a
    // firefight.
    for (const kind of Object.values(ALLY_WAVES)) {
      for (const id of enemyModelIds(kind)) warmAuthored(id, 'soon');
    }
    for (const kind of [MID_BOSS[g.board.kind].kind, BOSS_KIND[g.board.kind]]) {
      for (const bossId of enemyModelIds(kind)) warmAuthored(bossId, 'soon');
    }
  }

  update(dt: number): void {
    const g = this.g;
    if (g.state === 'intro' && g.stateTimer <= 0) this.nextWave();
    if (g.state === 'break' && g.stateTimer <= 0) this.nextWave();
    // A wave is cleared once everything it spawned is down. Testing
    // `enemies.length > 0` instead — as a stand-in for "the wave has started" —
    // stalled the station permanently: enemies knocked into the abyss are
    // removed the same frame they die, rather than lingering as a corpse, so
    // the array could empty completely and the check could never fire again.
    if (g.state === 'fighting' && g.waveSpawned > 0 && g.aliveEnemyCount === 0
        && g.incomingCount === 0 && !g.monsterStaging) {
      this.clearWave();
    }
    if (g.state === 'fighting') this.huntEscalation(dt);
  }

  /** the bell after a wave is decided: victory, a boss battle, or the next wave */
  private clearWave(): void {
    const g = this.g;
    // the fallen fade away now that the wave is decided
    for (const e of g.enemies) if (!e.alive) e.fadeOut();
    // cache backup was for this wave only: the squad melts back into the
    // covert, and an uncracked crate leaves with its chance
    if (g.allyCrate) {
      g.allyCrate.retire(g);
      g.allyCrate = null;
    }
    if (g.wave > this.finalWave) {
      // the warlord is down: the territory is truly held
      g.setState('victory');
      g.announce(TEXT.banners.territoryHeld.title, TEXT.banners.territoryHeld.sub);
    } else if (this.midBossActive) {
      // the champion falls; the second run of waves opens
      this.midBossActive = false;
      this.midBossDown = true;
      g.setState('break', BREAK);
      g.announce(TEXT.banners.lieutenantFalls.title, TEXT.banners.lieutenantFalls.sub);
    } else if (g.wave === this.finalWave || (g.wave === this.midBossWave && !this.midBossDown)) {
      // a boss battle rings in on the next bell
      g.setState('break', BREAK);
      g.announce(TEXT.banners.waveCleared(g.wave), TEXT.banners.somethingBig);
    } else {
      g.setState('break', BREAK);
      g.announce(TEXT.banners.waveCleared(g.wave));
    }
    audio.waveClear();
  }

  /**
   * Posted enemies wait to be found, which must not let a wave stall out: if
   * one drags on, or is down to its last few bodies scattered over the board,
   * the remnant starts sweeping toward the players instead. (45 s and ≤ 3
   * left, from 80 s — waves 1–3 were mostly walking, audit L8.)
   */
  private huntEscalation(dt: number): void {
    const g = this.g;
    this.waveTimer += dt;
    this.huntCall -= dt;
    const remnant = g.waveSpawned > 0 && g.incomingCount === 0 && g.aliveEnemyCount <= HUNT_REMNANT;
    if (!(this.waveTimer > HUNT_AFTER || remnant) || this.huntCall > 0) return;
    this.huntCall = 22;
    const p = g.players.find((pl) => pl.alive) ?? g.players[0];
    for (const e of g.enemies) if (e.alive) e.alert(p.position, false);
    if (!this.huntAnnounced) {
      this.huntAnnounced = true;
      g.announce(TEXT.banners.sweepingForYou);
    }
  }

  respawn(p: Player): void {
    const g = this.g;
    const partnerAlive = g.players.some((o) => o !== p && o.alive);
    if (INFINITE_LIVES || (g.players.length > 1 && partnerAlive)) {
      p.spawnAt(g.board.playerStarts[p.slot] ?? g.board.playerStarts[0]);
      if (g.players.length > 1) p.hp = p.maxHp * 0.6;
    } else {
      g.setState('defeat');
      g.announce(TEXT.banners.hunterFallen);
    }
  }

  /** the wave game is the one mode a party can lose outright */
  partyWiped(): void {
    if (INFINITE_LIVES || this.g.players.length <= 1) return;
    if (this.g.state === 'defeat' || this.g.state === 'victory') return;
    if (!this.g.players.every((p) => !p.alive)) return;
    this.g.setState('defeat');
    this.g.announce(TEXT.banners.huntersFallen);
  }

  topLine(): string | null {
    const g = this.g;
    if (this.midBossActive || g.wave > this.finalWave) return g.boss?.bossName ?? TEXT.hud.theWarlord;
    return TEXT.hud.wave(Math.max(g.wave, 1));
  }

  scoreLine(): string | null { return null; }

  /**
   * Where a boss battle posts its warlord: in front of whoever is alive, far
   * enough out to be walked up to, close enough that the reveal is a body and
   * not a dot on the horizon (audit B10).
   */
  private bossPost(tier: 'mid' | 'final'): THREE.Vector3 {
    const g = this.g;
    const p = g.players.find((pl) => pl.alive) ?? g.players[0];
    if (!p) return g.farPost();
    const kind = tier === 'mid' ? MID_BOSS[g.board.kind].kind : BOSS_KIND[g.board.kind];
    return postInView(g.board, p.position, p.cam.yaw, kind) ?? g.farPost();
  }

  /**
   * Ring the next wave now. Public because the match is not the only thing
   * that rings it: `?waves=boss` and the browser suites drive the flow
   * directly rather than waiting out four and a half seconds a time.
   */
  nextWave(): void {
    const g = this.g;
    this.waveTimer = 0;
    g.waveSpawned = 0;
    this.huntCall = 0;
    this.huntAnnounced = false;
    g.setState('fighting');
    // clearing wave MID_BOSS_WAVE rings in the champion's battle instead of
    // the next wave
    if (g.wave === this.midBossWave && !this.midBossDown) {
      this.midBossActive = true;
      g.spawnBoss(this.bossPost('mid'), 'mid');
      return;
    }
    g.wave++;
    // past the final wave is the warlord's battle, and the last bell
    if (g.wave > this.finalWave) {
      g.spawnBoss(this.bossPost('final'), 'final');
      return;
    }
    const near = g.players[0]?.position ?? g.board.playerStarts[0];
    if (g.wave <= 1) {
      // the first wave is the garrison already holding the territory: it is
      // simply there, posted, waiting to be found
      spawnWave(g.board, g.wave, g.players.length, near, (e) => g.addEnemy(e, { counts: true, puff: 10 }));
    } else {
      // every later wave is reinforcements, and reinforcements arrive:
      // carriers streak over and drop squads, locals run in over the edge,
      // quarren surface from the sea, fliers cross in at altitude
      g.stageArrivals(planWave(g.board, g.wave, g.players.length, near));
    }
    // the break before the next wave is the lead time for its new arrivals
    this.preloadWave(g.wave + 1);
    const scattered = g.aliveEnemyCount + g.incomingCount;
    g.announce(
      TEXT.banners.wave(g.wave),
      g.wave === this.finalWave ? TEXT.banners.finalWave(scattered) : TEXT.banners.huntThemDown(scattered),
    );
    this.announceDebuts();
    audio.waveStart();

    // the covert's supply cache on milestone waves: a glowing crate near the
    // party, holding a squad of allies for whoever cracks it open
    const cacheKind = ALLY_WAVES[g.wave] ?? null;
    if (cacheKind) {
      g.allyCrate = new AllyCrate(g, cacheKind, g.players[0]?.position ?? g.board.playerStarts[0]);
      g.announce(TEXT.banners.wave(g.wave), TEXT.banners.supplyCache);
    }
  }

  /**
   * The little card naming kinds that debut this wave. The wave tables are
   * deterministic in which kinds appear, so a diff against every earlier wave
   * is exactly "first appearance".
   */
  private announceDebuts(): void {
    const g = this.g;
    const seen = new Set<EnemyKind>();
    for (let w = 1; w < g.wave; w++) {
      for (const entry of waveComposition(g.board.kind, w, g.players.length)) seen.add(entry.kind);
    }
    const fresh = [...new Set(
      waveComposition(g.board.kind, g.wave, g.players.length).map((entry) => entry.kind),
    )].filter((k) => !seen.has(k));
    if (fresh.length) g.announceContacts(fresh.map((k) => ENEMY_NAME[k]));
  }

  /**
   * Warm the .glb cache for everything a wave can put on the board.
   *
   * `now`, because the wave is the next thing to happen — but through the warm
   * queue all the same, so a six-kind wave cannot open six downloads at once
   * across a connection the match is already using for its scenery.
   */
  private preloadWave(wave: number): void {
    const g = this.g;
    if (wave > this.finalWave) return;
    for (const entry of waveComposition(g.board.kind, wave, g.players.length)) {
      for (const id of enemyModelIds(entry.kind)) warmAuthored(id, 'now');
    }
    // Allies are not part of a wave's composition, so they were downloading
    // cold at the moment they walked in — mid-fight, against a spawn storm.
    const ally = ALLY_WAVES[wave];
    if (ally) for (const id of enemyModelIds(ally)) warmAuthored(id, 'now');
  }
}
