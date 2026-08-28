# Background music

Full-length authored tracks used as each board's background score. Unlike the short
sounds in `../assets/audio/`, these are streamed through an `<audio>` element rather
than decoded into memory — see `MUSIC_PLAYLISTS` in `src/core/audio.ts`.

| Playlist | Tracks |
|---|---|
| desert | `bone-totem-march-1.mp3`, `bone-totem-march-2.mp3` |
| station | `dust-beyond-orbit-1.mp3`, `dust-beyond-orbit-2.mp3` |

A board plays its playlist in random order, never the same track twice in a row. A
board may also name a signature opener with `musicLead` (see `Board` in
`src/world/board.ts`), which plays first and then joins the random rotation:

| Board | Opens with |
|---|---|
| The Storm Docks | `mando-sea-shanty.mp3` |
| The Crevasse | `mando-ice.mp3` |
| The Great Forge | `mando-fada.mp3` |

To add a track, drop the file here and add its path to the playlist array (or to a
board's `musicLead`); if every track in a list fails to load the engine falls back to
`music_combat_*` in `../assets/audio/`, and then to the synth drone.

Filenames are lowercase and hyphenated so they need no URL escaping.
