import * as THREE from 'three';
import type { Game } from '../../game/game';
import type { SectionBar } from '../api';

/**
 * Hold-to-interact: the valve, the brazier, the charge socket, the cell
 * release, the breaker panel (docs/SECTIONS_IMPLEMENTATION.md §2).
 *
 * Stand inside `radius` and hold the contextual button (Y, or C on the
 * keyboard — `FrameInput.interactHeld`) for `hold` seconds. Letting go drains
 * the progress back rather than zeroing it, so a hit that makes you flinch
 * costs a moment, not the whole hold. Several players holding together fill
 * it faster (each adds its rate), which makes "cover me while I turn this" a
 * real two-player beat and never a requirement.
 *
 * The press that starts a hold must not also take cover or mount a ride, so a
 * section routes each player's input through `swallow()` — it clears the
 * contextual press for anyone standing at an interactable.
 */
export interface InteractSpec {
  pos: THREE.Vector3;
  /** seconds of holding it takes */
  hold: number;
  /** how close you have to be, metres (default 2.4) */
  radius?: number;
  /** the prompt: "shut the valve" → "Hold Y — shut the valve" */
  verb: string;
  /** may it be used right now? (a cooldown, a door not yet reached) */
  enabled?: () => boolean;
  /** fired once each time the hold completes */
  onDone: (bySlot: number) => void;
  /** if false it can be completed again after `onDone` (default: once) */
  once?: boolean;
}

export class Interactable {
  progress = 0;
  used = false;
  /** slots holding it this frame */
  readonly holders = new Set<number>();

  constructor(readonly spec: InteractSpec) {}

  get radius(): number { return this.spec.radius ?? 2.4; }
  get available(): boolean {
    return !(this.used && this.spec.once !== false) && (this.spec.enabled?.() ?? true);
  }

  /** is this body close enough to use it? */
  inReach(p: THREE.Vector3): boolean {
    const dy = Math.abs(p.y - this.spec.pos.y);
    return dy < 2.5 && Math.hypot(p.x - this.spec.pos.x, p.z - this.spec.pos.z) <= this.radius;
  }
}

/** a set of interactables, ticked together */
export class Interactions {
  readonly items: Interactable[] = [];
  /** the input each slot gave this frame (fed by `swallow`) */
  private held: boolean[] = [];

  add(spec: InteractSpec): Interactable {
    const it = new Interactable(spec);
    this.items.push(it);
    return it;
  }

  /**
   * Route a player's input through here (from `Player.sectionMove.adjust`):
   * remembers whether the button is held, and swallows the contextual press
   * for anyone standing at something they could use, so it does not also
   * snap them into cover.
   */
  swallow<T extends { interactHeld: boolean; slamPressed: boolean }>(slot: number, pos: THREE.Vector3, input: T): T {
    this.held[slot] = input.interactHeld;
    if (this.items.some((it) => it.available && it.inReach(pos))) {
      return { ...input, slamPressed: false };
    }
    return input;
  }

  update(dt: number, game: Game): void {
    for (const it of this.items) {
      it.holders.clear();
      if (!it.available) { it.progress = 0; continue; }
      for (const p of game.players) {
        if (p.alive && this.held[p.slot] && it.inReach(p.position)) it.holders.add(p.slot);
      }
      if (it.holders.size) {
        it.progress += (dt / it.spec.hold) * it.holders.size;
        if (it.progress >= 1) {
          it.progress = 0;
          it.used = true;
          it.spec.onDone([...it.holders][0]);
        }
      } else {
        it.progress = Math.max(0, it.progress - dt / Math.max(0.5, it.spec.hold));
      }
    }
    for (let i = 0; i < this.held.length; i++) this.held[i] = false;
  }

  /** the nearest usable interactable within reach of this position, if any */
  nearest(pos: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (!it.available || !it.inReach(pos)) continue;
      const d = it.spec.pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  /** the prompt and progress bar for a player standing at something, or null */
  hudFor(pos: THREE.Vector3): { line: string; bar: SectionBar } | null {
    const it = this.nearest(pos);
    if (!it) return null;
    return {
      line: `Hold Y — ${it.spec.verb}`,
      bar: { label: it.spec.verb, value: it.progress, tone: 'good' },
    };
  }
}
