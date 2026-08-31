# Background music

Full-length authored tracks used as each board's background score. Unlike the short
sounds in `../assets/audio/`, these are streamed through an `<audio>` element rather
than decoded into memory.

**The map lives in `src/core/music.ts`** — that one file lists every track and says
which board opens on which. To add a track, drop the file here and list it there;
nothing else in the engine names a track.

| List | Tracks |
|---|---|
| any board | `mando-african.mp3`, `mando-capoeira.mp3` |
| desert | `bone-totem-march-1.mp3`, `bone-totem-march-2.mp3` |
| station | `dust-beyond-orbit-1.mp3`, `dust-beyond-orbit-2.mp3` |

A board plays the any-board tracks plus the list for its flavor, in random order,
never the same track twice in a row. A board can also name a signature opener, which
plays first and then joins the rotation:

The **boss theme** is separate from all of that: `mando-boss.mp3` is never in a rotation
— it takes the music over for the final boss battle on every board (`MUSIC_BOSS`), and the
board's own score returns when the fight ends.

| Board | Opens with |
|---|---|
| The Storm Docks | `mando-sea-shanty.mp3` |
| The Crevasse | `mando-ice.mp3` |
| The Great Forge | `mando-fada.mp3` |
| The Prison Rig | `mando-indian.mp3` |

If every track in a board's rotation fails to load, the engine falls back to
`music_combat_*` in `../assets/audio/`, and then to a synth drone.

Filenames are lowercase and hyphenated so they need no URL escaping.
