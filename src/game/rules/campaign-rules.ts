import type { Game } from '../game';
import type { Player } from '../../player/player';
import { openMatch, type ModeRules } from './rules';
import { Campaign } from '../campaign';
import { LegacyCampaign } from '../campaign-legacy';
import { missionsOutdoor } from '../modes';
import type { MissionController } from '../mission-api';
import { audio } from '../../core/audio';
import { TEXT } from '../../text';

/**
 * Missions — the liberation run (docs/MODES.md §4). The rules themselves are
 * thin: `Campaign` already is a controller, holding the room chain, the
 * gates, the beacon and the checkpoints. This is the seam that lets `Game`
 * treat it as one mode among three.
 */
export class CampaignRules implements ModeRules {
  readonly objective = TEXT.banners.objective.campaign;
  private built: MissionController | null = null;

  constructor(private g: Game) {}

  /** the mission level, once `begin` has raised it */
  get campaign(): MissionController {
    if (!this.built) throw new Error('the mission level is raised in begin()');
    return this.built;
  }

  begin(): void {
    // Raises the mission level over the territory and moves the party to its
    // trailhead, so it waits for players to exist; every player keeps their
    // own camera, split-screen as ever.
    //
    // Which level: the walled room chain, or the experimental outdoor stage
    // chain (docs/MISSIONS_OUTDOOR.md) when `?missions=new` asks for it. The
    // two are interchangeable behind `MissionController`, which is the whole
    // point of the flag — either design is one URL away rather than a revert.
    this.built = missionsOutdoor() ? new Campaign(this.g) : new LegacyCampaign(this.g);
    this.g.campaign = this.built;
  }

  update(dt: number): void {
    const g = this.g;
    openMatch(g);
    if (g.state !== 'fighting') return;
    this.campaign.update(dt);
    if (this.campaign.done && g.state === 'fighting') {
      g.setState('victory');
      g.announce(TEXT.banners.territoryLiberated.title, TEXT.banners.territoryLiberated.sub);
      audio.waveClear();
    }
  }

  respawn(p: Player): void {
    const g = this.g;
    // arcade checkpointing: the walk back is the cost (LEVEL_DESIGN.md §2)
    p.spawnAt(this.campaign.respawnSpot(p.slot) ?? g.board.playerStarts[0].clone());
    p.hp = p.maxHp * 0.8;
    g.announce(TEXT.banners.backOnYourFeet.title, TEXT.banners.backOnYourFeet.sub);
  }

  topLine(p: Player): string { return this.campaign.hint(p.position); }
  scoreLine(): string | null { return null; }
}
