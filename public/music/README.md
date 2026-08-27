# Background music

Full-length authored tracks used as each board's background score. Unlike the short
sounds in `../assets/audio/`, these are streamed through an `<audio>` element rather
than decoded into memory — see `MUSIC_PLAYLISTS` in `src/core/audio.ts`.

| Board | Tracks |
|---|---|
| The Dune Sea (desert) | `bone-totem-march-1.mp3`, `bone-totem-march-2.mp3` |
| The Spice Run (station) | `dust-beyond-orbit-1.mp3`, `dust-beyond-orbit-2.mp3` |

A board picks a random track from its list on start and then cycles through the list
forever. To add a track, drop the file here and add its path to the board's array; if
every track in a list fails to load the engine falls back to `music_combat_*` in
`../assets/audio/`, and then to the synth drone.

Filenames are lowercase and hyphenated so they need no URL escaping.
