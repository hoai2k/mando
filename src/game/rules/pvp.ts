import * as THREE from 'three';
import type { Game } from '../game';
import type { Player } from '../../player/player';
import { openMatch, type ModeRules } from './rules';
import { Enemy } from '../../enemies/enemy';
import { standingSpot } from '../../enemies/spawner';
import { playableDef } from '../../characters/roster';
import { audio } from '../../core/audio';

/**
 * PvP — the territory duel (docs/MODES.md §3). Every fighter is their own
 * team, so the projectile, shield and melee pipelines referee player against
 * player for free; what this rule set adds is the three stands, the squads
 * that carry their leader, and the last-one-standing call.
 */
export class PvpRules implements ModeRules {
  readonly objective = 'Last fighter standing takes it';

  constructor(private g: Game) {}

  begin(): void {
    // squad leaders bring their fireteam
    for (const p of this.g.players) this.spawnSquadFor(p);
  }

  /** PvP scoring and the last-one-standing call. */
  update(): void {
    const g = this.g;
    openMatch(g);
    if (g.state !== 'fighting') return;
    for (const p of g.players) {
      if (p.alive || p.deathCounted) continue;
      p.deathCounted = true;
      // a squad leader with a living follower isn't done: the player carries
      // on in the survivor's body, and only a wiped squad spends a stand
      const heir = this.squadHeir(p);
      const killer = p.lastHitBy >= 0 && p.lastHitBy !== p.slot ? g.players[p.lastHitBy] : null;
      if (killer) {
        killer.kills++;
        g.hitMarker(killer.slot);
        g.announce(`${killer.profile.name} downs ${p.profile.name}`,
          heir ? 'the squad fights on'
            : p.lives > 0 ? `${p.lives} stand${p.lives === 1 ? '' : 's'} left` : `${p.profile.name} is out`);
      } else if (!heir && p.lives <= 0) {
        g.announce(`${p.profile.name} is out`);
      }
      audio.killConfirm();
      if (heir) this.takeOverFollower(p, heir);
    }
    const standing = g.players.filter((p) => p.alive || p.lives > 0 || p.respawnTimer > 0);
    if (g.players.length > 1 && standing.length <= 1) {
      const winner = standing[0]
        ?? g.players.reduce((a, b) => (b.kills > a.kills ? b : a), g.players[0]);
      g.winnerSlot = winner.slot;
      g.setState('victory');
      audio.pvpRoundWin();   // the duel gets its own sting over the victory music
      g.announce(`${winner.profile.name} takes the territory`, 'This is the Way');
    }
  }

  respawn(p: Player): void {
    const g = this.g;
    // PvP keeps its finite stands: elimination is the mode's win condition
    if (p.lives <= 0) return;   // out of lives — update() calls the match
    p.lives--;
    p.deathCounted = false;
    // a player who fell mid-morph (died as the hatchling) comes back as the
    // fighter they picked, not the body they borrowed
    if (p.characterId !== p.baseCharacterId) p.morph(p.baseCharacterId, g);
    p.spawnAt(this.spawnPoint(p.slot, p.position));
    this.spawnSquadFor(p);   // the fireteam re-forms on its leader
    g.particles.dustPuff(p.position, 10);
  }

  topLine(p: Player): string {
    const stands = (p.alive ? 1 : 0) + p.lives;
    return stands > 0 ? `${stands} stand${stands === 1 ? '' : 's'} left` : 'ELIMINATED';
  }

  scoreLine(p: Player): string {
    const rivals = this.g.players.filter((o) => o !== p && (o.alive || o.lives > 0 || o.respawnTimer > 0)).length;
    return `${p.kills} kills · ${rivals} rival${rivals === 1 ? '' : 's'} left`;
  }

  /** the board's own posts, farthest-first so fighters start (and return) apart */
  spawnPoint(slot: number, awayFrom?: THREE.Vector3): THREE.Vector3 {
    const g = this.g;
    const spawns = g.board.groundSpawns;
    if (!spawns.length) return g.startFor(slot);
    const others = g.players.filter((p) => p.alive).map((p) => p.position);
    if (awayFrom) others.push(awayFrom);
    let best = spawns[slot % spawns.length];
    let bestD = -1;
    for (const s of spawns) {
      let d = Infinity;
      for (const o of others) d = Math.min(d, s.distanceToSquared(o));
      if (others.length === 0) d = Math.random();
      if (d > bestD) { bestD = d; best = s; }
    }
    return standingSpot(g.board, best.clone().add(new THREE.Vector3(0, 0.2, 0)), 'pyke');
  }

  /** spawn (or re-spawn) a squad leader's AI fireteam beside them */
  private spawnSquadFor(p: Player): void {
    const g = this.g;
    const squad = playableDef(p.characterId).profile.squad;
    if (!squad) return;
    // any followers it still has stay; only the missing places are refilled.
    // hunters (a broodmother's brood) share the owner but are not the squad
    const have = g.enemies.filter((e) => e.owner === p && e.alive && !e.hunts).length;
    for (let i = have; i < squad.count; i++) {
      const a = (i / squad.count) * Math.PI * 2;
      const at = standingSpot(g.board,
        p.position.clone().add(new THREE.Vector3(Math.cos(a) * 2.5, 0.2, Math.sin(a) * 2.5)), squad.kind);
      const e = new Enemy(squad.kind, at, p.team);
      e.setOwner(p);
      g.addEnemy(e, { puff: 6 });
    }
  }

  /** the nearest living squad follower a fallen leader can carry on as */
  private squadHeir(p: Player): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.g.enemies) {
      if (e.owner !== p || !e.alive) continue;
      if (e.def.egg) continue;   // an unhatched egg is not a body to carry on in
      const d = e.position.distanceToSquared(p.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /**
   * The fallen leader lives on in a surviving squadmate: the AI shell retires
   * without a death (no credit, no burst of its own) and the player stands up
   * in its place with whatever health the survivor had left. The camera flies
   * over rather than cutting — glideFrom eases the position across while
   * snapToward swings the look onto the new body.
   *
   * When the survivor is a different kind — the broodmother's hatchling — the
   * player morphs into *its* body, and the growth clock arms: survive ten
   * seconds as the hatchling and grow back into what fell.
   */
  private takeOverFollower(p: Player, heir: Enemy): void {
    const g = this.g;
    const healthFrac = Math.max(0.3, Math.min(1, heir.hp / heir.maxHp));
    heir.alive = false;
    heir.counted = true;   // not a kill: no score, no death FX
    heir.removeMe = true;
    // the leader's body goes down in a burst where it fell
    g.particles.deathBurst(p.position.clone().add(new THREE.Vector3(0, p.height * 0.5, 0)));
    const wasId = p.characterId;
    if (`npc:${heir.kind}` !== wasId) {
      p.morph(`npc:${heir.kind}`, g);
      p.beginGrowth(wasId, 10);
    }
    p.cam.glideFrom(0.8);
    p.cancelRebirth();   // possessing a standing body: no re-form to play
    p.spawnAt(heir.position);
    p.hp = p.maxHp * healthFrac;
    p.deathCounted = false;   // the next death counts fresh
    const look = heir.position.clone();
    look.y += p.height;
    p.cam.snapToward(look, 0.45);
    g.particles.dustPuff(p.position, 6);
  }
}
