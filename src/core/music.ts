import type { BoardId } from '../world/board';

/**
 * The board music map: which tracks exist, which board opens on which one.
 * This is the one file to edit when a track is added — drop the .mp3 in
 * `public/music/` (lowercase and hyphenated, so the URL needs no escaping) and
 * list it here. Nothing else in the engine names a track.
 *
 * These are full-length, multi-megabyte files, so they stream through an
 * <audio> element on the music bus rather than being decoded up front; see
 * `AudioEngine.startPlaylist`.
 */

/** Tracks that suit any board, played alongside whichever playlist is picked. */
export const MUSIC_ANY: string[] = [
  'music/mando-african.mp3',
  'music/mando-capoeira.mp3',
];

/** Tracks tied to a board's flavor: dusty frontier vs. cold Imperial steel. */
export const MUSIC_PLAYLISTS: Record<'desert' | 'station', string[]> = {
  desert: ['music/bone-totem-march-1.mp3', 'music/bone-totem-march-2.mp3'],
  station: ['music/dust-beyond-orbit-1.mp3', 'music/dust-beyond-orbit-2.mp3'],
};

/**
 * A board's signature track: it opens the match, and the rest of that board's
 * rotation follows at random. Boards left out here open on a random track.
 */
export const BOARD_MUSIC_LEAD: Partial<Record<BoardId, string>> = {
  trask: 'music/mando-sea-shanty.mp3',      // The Storm Docks
  crevasse: 'music/mando-ice.mp3',          // The Crevasse
  forge: 'music/mando-fada.mp3',            // The Great Forge
  narkina: 'music/mando-indian.mp3',        // The Prison Rig
};

/**
 * The warlord's theme. It takes the music over for the final boss battle on
 * every board — the fight that ends a match, and the monster that comes up
 * after it where a board has one — and the board's own rotation resumes when
 * the field is clear. Nothing else plays it, so hearing it means one thing.
 */
export const MUSIC_BOSS = 'music/mando-boss.mp3';

/**
 * Everything a board can play, opener first when it has one: the lead, then
 * the any-board tracks, then the ones for its flavor, each listed once.
 */
export function playlistFor(kind: 'desert' | 'station', board?: BoardId): { urls: string[]; hasLead: boolean } {
  const lead = board ? BOARD_MUSIC_LEAD[board] : undefined;
  const rest = [...MUSIC_ANY, ...MUSIC_PLAYLISTS[kind]].filter((u) => u !== lead);
  return { urls: lead ? [lead, ...rest] : rest, hasLead: !!lead };
}
