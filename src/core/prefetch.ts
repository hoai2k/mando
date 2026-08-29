import { ENEMY_MODEL_ID, modelUrl, warmAuthored } from '../characters/authored';
import { MANDO_ROSTER, type MandoId } from '../characters/mandalorians';
import { playableModelId, type PlayableId } from '../characters/roster';
import { ALLY_WAVES, FINAL_WAVE, waveComposition } from '../enemies/spawner';
import { BOARDS } from '../world/boards';
import type { BoardId } from '../world/board';
import { textureUrl, warmTexture } from './assets';
import { tracked, type WarmPriority } from './warm';

/**
 * What to fetch ahead, and when.
 *
 * The player spends real seconds on the title, the territory grid and the
 * character select, and none of those screens needs the megabytes the match
 * after them does. So each screen quietly pulls down what the *next* one will
 * want: the title warms the first Mandalorian, choosing a territory warms that
 * territory's sky and the enemies its opening waves post, and so on. By the
 * time Start is pressed the heavy files are usually already local and the
 * loading screen is a formality.
 *
 * Everything here is a hint. If a guess is wrong the file is simply downloaded
 * later, in the same place it always was; nothing renders differently because
 * a warm request was missed. The one hard requirement lives in `matchAssets`,
 * which is the set the loading screen actually waits on.
 */

/** Board surface textures, per territory, for warming only.
 *
 * These mirror what each builder asks `texture()` and `loadOptionalTexture()`
 * for. A stale entry costs a wasted (or skipped) prefetch and nothing else —
 * the loading screen waits on what the build really requested, not on this. */
const BOARD_TEXTURES: Record<BoardId, string[]> = {
  desert: ['sand_albedo', 'rock_albedo', 'adobe_wall', 'tent_cloth'],
  station: ['metal_deck', 'metal_hull', 'crate_side'],
  nevarro: ['basalt_albedo', 'lava_flow', 'rock_albedo', 'metal_hull'],
  crevasse: ['snow_albedo', 'ice_albedo', 'rock_albedo'],
  trask: ['metal_deck', 'metal_hull', 'crate_side', 'rock_albedo', 'rust_hull', 'net_weave'],
  refinery: ['metal_deck', 'metal_hull', 'crate_side'],
  forge: ['rock_albedo', 'metal_hull', 'basalt_albedo', 'forge_relief'],
  ringworld: ['metal_deck', 'metal_hull', 'crate_side', 'city_facade', 'city_facade_glow',
    'neon_sign', 'neon_sign_2', 'neon_sign_3', 'skyline_silhouette', 'skyline_silhouette_2'],
  narkina: ['metal_deck', 'metal_hull', 'ice_albedo', 'panel_white', 'kelp_frond'],
};

/**
 * The panorama behind each board, matching the `skyFile` its builder sets.
 * The refinery is indoors and has none — and since the match waits on this
 * list, naming a sky it will never load would hold the drop until the cap.
 */
const BOARD_SKY: Partial<Record<BoardId, string>> = {
  desert: 'sky_desert', station: 'sky_space', nevarro: 'sky_nevarro',
  crevasse: 'sky_ice', trask: 'sky_trask',
  forge: 'sky_mandalore', ringworld: 'sky_ring', narkina: 'sky_narkina',
};

export const MANDO_IDS = Object.keys(MANDO_ROSTER) as MandoId[];

/** Every enemy kind a board can post, from wave one through `throughWave`. */
export function boardEnemyIds(board: BoardId, throughWave = FINAL_WAVE): string[] {
  const ids = new Set<string>();
  for (let wave = 1; wave <= throughWave; wave++) {
    // the kinds a wave posts don't depend on the player count, only the counts do
    for (const entry of waveComposition(board, wave, 1)) {
      const id = ENEMY_MODEL_ID[entry.kind];
      if (id) ids.add(id);
    }
    const ally = ALLY_WAVES[wave];
    const allyId = ally ? ENEMY_MODEL_ID[ally] : undefined;
    if (allyId) ids.add(allyId);
  }
  return [...ids];
}

/**
 * Boot: the title screen is the longest anyone sits still, and the first thing
 * they will see rendered is a Mandalorian on a plinth. Warm that one model and
 * the territory art the next screen is made of — the art is small, and a grid
 * of nine cards popping in one at a time is the first impression otherwise.
 */
export function warmTitle(): void {
  warmAuthored(MANDO_IDS[0], 'soon');
  for (const info of BOARDS) warmTexture(info.art.replace(/\.\w+$/, ''), 'idle', info.art.split('.').pop());
}

/**
 * The territory grid: the roster is next, and any of them could be picked, so
 * warm all of them. The first is usually already here from the title.
 */
export function warmBoardSelect(): void {
  for (const id of MANDO_IDS) warmAuthored(id, 'idle');
}

/**
 * A territory has been chosen and the player is now picking a character, which
 * takes them a good few seconds: fetch that board's sky, its surfaces, and the
 * models its first waves will post. The opening waves come first — those are
 * what the match will need in its first minute — and the later ones trail
 * behind them at idle priority.
 */
export function warmTerritory(board: BoardId): void {
  const sky = BOARD_SKY[board];
  if (sky) warmTexture(sky, 'soon');
  for (const name of BOARD_TEXTURES[board]) warmTexture(name, 'soon');
  for (const id of boardEnemyIds(board, 2)) warmAuthored(id, 'soon');
  for (const id of boardEnemyIds(board)) warmAuthored(id, 'idle');
  for (const id of MANDO_IDS) warmAuthored(id, 'idle');
}

/** the authored models behind a set of playables (NPC picks map through the roster) */
function charModelIds(chars: PlayableId[]): string[] {
  return chars.map((id) => playableModelId(id)).filter((id): id is string => !!id);
}

/** Warm whatever a match is about to need at once, for a straight-to-play start. */
export function warmMatch(board: BoardId, chars: PlayableId[]): void {
  for (const id of charModelIds(chars)) warmAuthored(id, 'now');
  for (const id of boardEnemyIds(board, 1)) warmAuthored(id, 'now');
  const sky = BOARD_SKY[board];
  if (sky) warmTexture(sky, 'now');
}

/**
 * The files a match must actually have before it is worth showing: the players'
 * own models, the enemies wave one will post, and the board's sky.
 *
 * Everything else the board asks for as it builds — its surface textures — is
 * picked up from the tracker instead, since the builder is the only thing that
 * truly knows what it wants. Later waves are deliberately not here: they are
 * warming in the background and the match has ten waves to wait for them.
 */
export function matchAssets(board: BoardId, chars: PlayableId[]): string[] {
  const sky = BOARD_SKY[board];
  const keys = [
    ...charModelIds(chars).map((id) => modelUrl(id)),
    ...boardEnemyIds(board, 1).map((id) => modelUrl(id)),
    ...(sky ? [textureUrl(sky)] : []),
  ];
  return [...new Set(keys)];
}

/** True when every file a match needs is already in hand. */
export function matchReady(board: BoardId, chars: PlayableId[]): boolean {
  return tracked.progress(matchAssets(board, chars)).pending === 0;
}

/** Warm one specific model at a given urgency (the character select's flips). */
export function warmModel(id: string, priority: WarmPriority = 'idle'): void {
  warmAuthored(id, priority);
}
