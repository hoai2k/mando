import { enemyModelIds, modelUrl, warmAuthored } from '../characters/authored';
import type { EnemyKind } from '../enemies/enemy';
import { playableDef, playableModelIds, PVP_ROSTER, STANDARD_ROSTER, type PlayableId } from '../characters/roster';
import { BOSS_KIND, MID_BOSS, MONSTER_BOSS, type GameMode } from '../game/modes';
import { ALLY_WAVES, FINAL_WAVE, waveComposition } from '../enemies/spawner';
import { carrierShipId } from '../enemies/arrival';
import { BOARDS, type BoardInfo } from '../world/boards';
import type { BoardId } from '../world/board';
import { portraitName, textureUrl, warmTexture } from './assets';
import { warmPoster } from '../ui/posters';
import { tracked, type WarmPriority } from './warm';

/**
 * What to fetch ahead, and when.
 *
 * The player spends real seconds on the title, the territory grid and the
 * character select, and none of those screens needs the megabytes the match
 * after them does. So those seconds are spent pulling down what is coming.
 *
 * The shape of it is a **plan** rather than a set of per-screen errands. Each
 * screen declares, once, what it is made of; `warmFor` is told where the player
 * is standing and walks the screens ahead, handing each stage a lane: the one
 * on screen now downloads at `now`, the next at `soon`, everything past that on
 * idle time. Two things fall out of that and are worth stating, because they
 * are the whole design:
 *
 * - **A screen only ever declares what it knows.** There is no board in the
 *   plan until a territory has been picked, no drop-screen cast until there is
 *   a board whose hostiles it can name. Nothing speculative is queued, so
 *   "fetch everything you know you will need" stays honest.
 * - **Certain is not the same as soon.** A need marked `soft` — the rest of a
 *   roster, the waves after the first, a corridor an hour into a campaign — is
 *   real, and rides the idle lane whatever screen declared it. Otherwise seven
 *   character models the player is not looking at would outrank the two files
 *   the very next screen blocks on.
 *
 * The plan is re-run at every transition, and priorities only ever rise (see
 * `WarmQueue.want`), which is exactly right for a player moving forward: a
 * file's screen only ever gets nearer.
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
 * Every boss a board can field: its champion, its warlord, and — on the four
 * boards that have one — the monster that comes up when the warlord falls. The
 * monster is the largest download of the three and arrives last in the fight,
 * so warming it with the other two is what keeps it off the critical path.
 */
function bossKinds(board: BoardId): EnemyKind[] {
  const monster = MONSTER_BOSS[board];
  const kinds: EnemyKind[] = [MID_BOSS[board].kind, BOSS_KIND[board]];
  if (monster) kinds.push(monster.kind);
  return kinds;
}

/**
 * The environment sculpts each territory builds itself out of.
 *
 * These are not warmed for the loading screen's benefit — the drop deliberately
 * does not wait on them, since a board looks right without them and swaps them
 * in as they land. They are warmed because otherwise the *match* pays for them:
 * a territory kicks off every one of these the instant it builds, which on the
 * Dune Sea measured 54 MB across 17 files arriving while the player was already
 * fighting — bandwidth taken from the assets the drop *does* wait on, and a
 * parse hitch per file on the main thread. Fetched from the character select
 * instead, they are usually in the HTTP cache before the match starts.
 *
 * A stale entry costs one wasted prefetch and nothing else: the board asks for
 * what it asks for, and this list only decides what arrives early.
 */
export const BOARD_PROPS: Record<BoardId, string[]> = {
  desert: ['cargo_crate', 'sail_barge', 'vaporator', 'tusken_tent', 'homestead_dome',
    'sandcrawler', 'bantha', 'nikto_swoop', 'landspeeder', 'skiff'],
  station: ['cargo_crate', 'fuel_barrel', 'cargo_crane', 'freighter'],
  nevarro: ['adobe_tower', 'adobe_gate', 'speeder_bike'],
  crevasse: ['cargo_crate', 'survey_crawler'],
  trask: ['cargo_crate', 'trawler', 'dock_shed', 'fish_rack', 'skiff'],
  refinery: ['cargo_crate', 'fuel_barrel', 'reactor_core', 'alarm_console', 'pipe_rack'],
  forge: ['forge_brazier', 'mythosaur_skull', 'speeder_bike'],
  ringworld: ['tram', 'street_kiosk', 'nikto_swoop'],
  narkina: ['cargo_crate', 'sunken_transport'],
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

/** Surfaces the campaign's mission levels tile over their walls and floors (`world/mission.ts`). */
const CORRIDOR_TEXTURES = ['corridor_wall', 'corridor_floor', 'hazard_stripe'];
/** ...and the sculpts the same levels swap in over their stand-ins (gates, cover crates). */
const CORRIDOR_PROPS = ['blast_door', 'corridor_crate'];

/** Every enemy kind a board can post, from wave one through `throughWave`. */
export function boardEnemyIds(board: BoardId, throughWave = FINAL_WAVE): string[] {
  const ids = new Set<string>();
  for (let wave = 1; wave <= throughWave; wave++) {
    // the kinds a wave posts don't depend on the player count, only the counts do
    for (const entry of waveComposition(board, wave, 1)) {
      for (const id of enemyModelIds(entry.kind)) ids.add(id);
    }
    const ally = ALLY_WAVES[wave];
    if (ally) for (const id of enemyModelIds(ally)) ids.add(id);
  }
  // both boss battles are certainties on a full run of the territory
  if (throughWave >= FINAL_WAVE) {
    for (const kind of bossKinds(board)) {
      for (const id of enemyModelIds(kind)) ids.add(id);
    }
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** one thing some screen is made of */
type Need =
  | { kind: 'model'; id: string; soft?: boolean }
  /** `dom` marks a picture the page draws (a portrait, a card, a planet disc)
   *  rather than a surface three wears — the two are fetched differently and a
   *  warm request has to match, or the file comes down twice. */
  | { kind: 'texture'; name: string; ext: string; soft?: boolean; dom?: boolean }
  /** a fighter's pre-rendered select-screen picture (src/ui/posters.ts) */
  | { kind: 'poster'; id: PlayableId; soft?: boolean };

const model = (id: string, soft = false): Need => ({ kind: 'model', id, soft });
const tex = (name: string, ext = 'jpg', soft = false): Need => ({ kind: 'texture', name, ext, soft });
/** a picture the DOM draws: warmed as an <img>, since that is how it is asked for */
const pic = (name: string, ext = 'jpg', soft = false): Need =>
  ({ kind: 'texture', name, ext, soft, dom: true });

/** the screens the warmer plans for; `title` is the boot state */
export type WarmScreen = 'title' | 'select' | 'planets' | 'characters' | 'loading' | 'playing';

/** what the warmer knows when it is asked to plan */
export interface WarmContext {
  screen: WarmScreen;
  /** undefined until a mode is picked — at the title, either path is still open */
  mode?: GameMode;
  /** the chosen territory, once there is one */
  board?: BoardId;
  /** who is on the plinths right now, most-likely-committed first */
  focus?: PlayableId[];
}

/**
 * The route from here to the ground, one stage per screen the player passes
 * through. The title is a fork: until a mode is picked, both the territory grid
 * and the planet strip are "the next screen", so both are planned as one stage.
 */
function stages(mode: GameMode | undefined): WarmScreen[][] {
  const pick: WarmScreen[] = mode === undefined ? ['select', 'planets']
    : mode === 'campaign' ? ['planets'] : ['select'];
  return [['title'], pick, ['characters'], ['loading'], ['playing']];
}

/**
 * How hard to pull, by how many screens away the thing that wants it is.
 *
 * A `soft` need goes to the idle lane whatever the distance. Soft is for what a
 * stage will want but is not on it and not one press from it — the seven
 * fighters the select is not showing, the waves after the first, the corridors
 * an hour into a campaign. Ranking those by distance would put the rest of a
 * roster ahead of the two files the very next screen actually blocks on, which
 * is the wrong way round: they are certain, but they are not soon.
 */
const LANES: WarmPriority[] = ['now', 'soon', 'idle'];
function lane(distance: number, soft: boolean): WarmPriority {
  return soft ? 'idle' : LANES[Math.min(distance, LANES.length - 1)];
}

/** the select-card picture for a territory, split into the name and extension
 * `warmTexture` wants (BoardInfo carries it as one filename). */
function artName(info: BoardInfo): string { return info.art.replace(/\.\w+$/, ''); }
function artExt(info: BoardInfo): string { return info.art.split('.').pop() ?? 'jpg'; }

/**
 * The fighters, in the order this screen would want them: whoever is on a
 * plinth right now first and hard, then the rest of the browsable roster soft —
 * any of them is one flip away, but none of them is on screen.
 */
function rosterNeeds(ctx: WarmContext): Need[] {
  const roster = ctx.mode === 'pvp' ? PVP_ROSTER : STANDARD_ROSTER;
  const out: Need[] = [];
  const seen = new Set<string>();
  const add = (id: PlayableId, soft: boolean): void => {
    // The picture comes before the body it stands in for, deliberately: while
    // the player is flipping, the poster is the thing on screen and the model
    // is what a settled choice will need a moment later. A few tens of KB
    // ahead of a few MB is also simply the right order to spend a connection
    // in.
    out.push({ kind: 'poster', id, soft });
    for (const m of playableModelIds(id)) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(model(m, soft));
    }
    // The fighter's own face, from the screen that first knows who is on
    // offer rather than from the drop screen that displays it. A portrait is
    // on screen within a beat of leaving the select — the VS splash, then the
    // drop's cast, then the end screen — and it used to be declared only by
    // `dropNeeds`, which needs a chosen territory, so nothing was queued until
    // one was picked and the faces raced the screen that shows them.
    //
    // Soft, always: they are certain, but a 40 KB face must never be fetched
    // ahead of the megabytes of model the plinth in front of the player is
    // waiting on.
    out.push(pic(portraitName(id), 'jpg', true));
  };
  for (const id of ctx.focus ?? []) add(id, false);
  // nobody has been focused yet (the title, the grid): the select opens on the
  // head of the roster, so that one is still the certain first render
  if (!ctx.focus?.length && roster.length) add(roster[0], false);
  for (const id of roster) add(id, true);
  return out;
}

/**
 * The drop screen: a full-bleed territory picture and a row of faces, and
 * nothing else. It is also the screen that *blocks*, so the two files it waits
 * on — the sky and wave one's hostiles — are declared here rather than with the
 * match, which is what stops the match's bulk from being confused for them.
 *
 * Nothing here is soft. A portrait that misses shows the drawn helmet and then
 * pops to a photograph a beat later, on the one screen whose whole job is to be
 * looked at, and the two blocking files are what the wait is made of.
 */
function dropNeeds(board: BoardId, ctx: WarmContext): Need[] {
  const mode = ctx.mode ?? 'wave';
  const out: Need[] = [];
  const info = BOARDS.find((b) => b.id === board);
  if (info) out.push(pic(artName(info), artExt(info)));
  // which fighters get picked is not settled until this screen is entered, so
  // cover the browsable roster; PvP's cast depends on the picks twice over
  // (the rivals, and the squads they lead), hence the roster there too
  const roster = mode === 'pvp' ? PVP_ROSTER : STANDARD_ROSTER;
  const faces = new Set(roster.map((id) => portraitName(id)));
  for (const kind of dropCast(board, ctx.focus?.length ? ctx.focus : roster, mode)) {
    faces.add(portraitName(kind));
  }
  for (const name of faces) out.push(pic(name));
  const sky = BOARD_SKY[board];
  if (sky) out.push(tex(sky));
  // the fighters going in are the third thing the drop blocks on. They are
  // normally in hand already — the select will not let a pick be committed
  // until its model is here — but a match started without passing through the
  // select (the test harness, a rematch) has no such guarantee
  for (const id of charModelIds(ctx.focus ?? [])) out.push(model(id));
  for (const id of modeEnemyIds(board, ctx.focus ?? [], mode)) out.push(model(id));
  return out;
}

/**
 * The match itself: everything a territory asks for as it builds and fights,
 * which the drop deliberately does *not* wait on. Warming it is still the
 * difference between a board that is already local and 54 MB arriving across a
 * firefight — bandwidth taken from the files the drop does wait on, and a parse
 * hitch per file on the main thread.
 *
 * A stale entry in any of these lists costs one wasted prefetch and nothing
 * else: the board asks for what it asks for, and this only decides what arrives
 * early.
 */
function matchNeeds(board: BoardId, ctx: WarmContext): Need[] {
  const mode = ctx.mode ?? 'wave';
  const out: Need[] = [];
  for (const id of boardEnemyIds(board, 2)) out.push(model(id));
  for (const name of BOARD_TEXTURES[board]) out.push(tex(name));
  for (const id of BOARD_PROPS[board]) out.push(model(id));
  // the later waves and the boss ladder: real needs on a full run, but the
  // match has ten waves to find them, so they stay behind the opening minute
  for (const id of boardEnemyIds(board)) out.push(model(id, true));
  if (mode === 'wave') {
    // the board's troop carrier: wave 2's first pass flies as a jet blur if the
    // hull has not arrived by then — a missing file stays the blur, by design
    out.push(model(carrierShipId(board), true));
  }
  if (mode === 'campaign') {
    // the mission level is built at match start but its later rooms are only
    // walked into minutes in, so its art can trail the drop
    for (const t of CORRIDOR_TEXTURES) out.push(tex(t, 'png', true));
    for (const id of CORRIDOR_PROPS) out.push(model(id, true));
  }
  return out;
}

/** What a screen is made of. Unknowns yield nothing: the plan never guesses. */
function needs(screen: WarmScreen, ctx: WarmContext): Need[] {
  switch (screen) {
    // the key art and the logo behind the title are in the page's own CSS and
    // are already on their way before any of this runs
    case 'title': return [];
    case 'select': return BOARDS.map((info) => pic(artName(info), artExt(info)));
    case 'planets': return BOARDS.map((info) => pic(`planet_${info.id}`, 'png'));
    case 'characters': return rosterNeeds(ctx);
    case 'loading': return ctx.board ? dropNeeds(ctx.board, ctx) : [];
    case 'playing': return ctx.board ? matchNeeds(ctx.board, ctx) : [];
  }
}

function request(need: Need, priority: WarmPriority): void {
  if (need.kind === 'model') warmAuthored(need.id, priority);
  else if (need.kind === 'poster') warmPoster(need.id, priority);
  else warmTexture(need.name, priority, need.ext, need.dom);
}

/**
 * Plan from here: fetch what this screen is made of, then what the next one is,
 * and so on to the ground — each stage a lane softer than the one before it.
 *
 * There are only three lanes and the route is five stages, so everything past
 * the next screen shares the idle lane. Order is not lost there: stages are
 * walked near-to-far and the queue sorts by priority only, stably, so within a
 * lane the nearer screen's files keep the head of the line.
 *
 * Safe to call as often as the state changes; that is the intended use. A file
 * already in hand is skipped, one already downloading is left alone, and one
 * still queued only ever moves up.
 */
export function warmFor(ctx: WarmContext): void {
  const route = stages(ctx.mode);
  const at = Math.max(0, route.findIndex((stage) => stage.includes(ctx.screen)));
  for (let i = at; i < route.length; i++) {
    for (const screen of route[i]) {
      for (const need of needs(screen, ctx)) request(need, lane(i - at, !!need.soft));
    }
  }
}

/**
 * The hostiles the drop screen puts on cards, per mode: the wave game's opening
 * wave and its closing elite; the campaign's trailhead kinds and the warlord
 * waiting at the end; PvP's own squads (the rivals themselves are the cast, and
 * the VS splash has already introduced them).
 *
 * The drop screen asks for this to know what to draw; the plan asks for it a
 * screen earlier to know which portraits to pull down. One function, so the two
 * cannot drift apart and warm a face that never appears.
 */
export function dropCast(board: BoardId, chars: PlayableId[], mode: GameMode): EnemyKind[] {
  if (mode === 'pvp') {
    const squads = chars
      .map((id) => playableDef(id).profile.squad?.kind)
      .filter((k): k is EnemyKind => !!k);
    return [...new Set(squads)];
  }
  const opening = waveComposition(board, 1, 1).map((e) => e.kind);
  if (mode === 'campaign') {
    return [...new Set<EnemyKind>([...opening.slice(0, 2), BOSS_KIND[board]])];
  }
  const last = waveComposition(board, FINAL_WAVE, 1).map((e) => e.kind);
  const picked: EnemyKind[] = [...opening.slice(0, 2), last[last.length - 1]];
  return [...new Set(picked.filter(Boolean))];
}

/** the authored models behind a set of playables (NPC picks map through the roster) */
function charModelIds(chars: PlayableId[]): string[] {
  return [...new Set(chars.flatMap((id) => playableModelIds(id)))];
}

/**
 * What each mode's opening minute actually posts, beyond the fighters
 * themselves. The wave game opens on wave one; the campaign posts its whole
 * path at build (early nodes are wave-one kinds) and ends at the boss, whose
 * model has the length of the level to arrive — so the drop waits only on the
 * opening kinds there too. PvP posts no hostiles at all: what it needs is the
 * squads the chosen fighters lead.
 */
function modeEnemyIds(board: BoardId, chars: PlayableId[], mode: GameMode): string[] {
  if (mode === 'pvp') {
    const ids = new Set<string>();
    for (const c of chars) {
      const squad = playableDef(c).profile.squad;
      if (squad) for (const id of enemyModelIds(squad.kind)) ids.add(id);
    }
    return [...ids];
  }
  return boardEnemyIds(board, 1);
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
export function matchAssets(board: BoardId, chars: PlayableId[], mode: GameMode = 'wave'): string[] {
  const sky = BOARD_SKY[board];
  const keys = [
    ...charModelIds(chars).map((id) => modelUrl(id)),
    ...modeEnemyIds(board, chars, mode).map((id) => modelUrl(id)),
    ...(sky ? [textureUrl(sky)] : []),
  ];
  return [...new Set(keys)];
}

/** True when every file a match needs is already in hand. */
export function matchReady(board: BoardId, chars: PlayableId[], mode: GameMode = 'wave'): boolean {
  return tracked.progress(matchAssets(board, chars, mode)).pending === 0;
}
