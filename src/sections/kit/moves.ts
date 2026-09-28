import type { FrameInput } from '../../core/input';
import type { Player } from '../../player/player';
import type { Game } from '../../game/game';
import type { SectionMove } from '../api';

/**
 * `Player.sectionMove` is one slot, and a section often has several things
 * that want the player's input — an interact prompt swallowing the Y press, a
 * heat rule clamping the fuel, a slide steering the body. `composeMoves` runs
 * every `adjust` in order (each sees the last one's input) and gives the frame
 * to the first `take` that claims it.
 */
export function composeMoves(...moves: (SectionMove | null | undefined)[]): SectionMove {
  const list = moves.filter((m): m is SectionMove => !!m);
  return {
    adjust(p: Player, dt: number, input: FrameInput, game: Game): FrameInput {
      let inp = input;
      for (const m of list) if (m.adjust) inp = m.adjust(p, dt, inp, game);
      return inp;
    },
    take(p: Player, dt: number, input: FrameInput, game: Game, realDt: number): boolean {
      for (const m of list) if (m.take?.(p, dt, input, game, realDt)) return true;
      return false;
    },
    steer(p: Player, dt: number, input: FrameInput, game: Game): boolean {
      for (const m of list) if (m.steer?.(p, dt, input, game)) return true;
      return false;
    },
    crouch(p: Player): boolean {
      return list.some((m) => m.crouch?.(p) ?? false);
    },
  };
}
