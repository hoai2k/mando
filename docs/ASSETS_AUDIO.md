# Asset Requests — Audio

**Open audio requests only.** The original 38 sounds are delivered and integrated — they
are recorded in [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md), with their regeneration
prompts living in `tools/generate-sfx.mjs`. Nothing on that list needs making again.
**The six new boards opened the batch below** — every one already plays through a synth
fallback (or is deliberately silent, for the voice barks), and the engine picks the file
up automatically when it lands in `public/assets/audio/`.

The game still runs with zero audio files: every sound falls back to a synthesized WebAudio
voice. Files go in `public/assets/audio/`; the loader tries `.mp3` then `.ogg`.

Board background music is separate: full-length tracks live in `public/music/` and are
streamed as a per-board playlist rather than decoded as samples — see that directory's
README and `MUSIC_PLAYLISTS` in `src/core/audio.ts`. The `music_combat_desert` /
`music_combat_station` samples remain as the fallback if those tracks fail to load.

**Specs:** OGG Vorbis or MP3, 44.1 kHz, mono for SFX / stereo for ambience and music,
loudness-matched (SFX peaks ≈ −6 dBFS), seamless where looping. Original or licensed audio
only — no ripped film audio; prompts describe character without naming trademarked sources.

## Open — the six new boards (priority 1)

All hooks are live in the engine today (`src/core/audio.ts`); each falls back to a synth
voice until the file exists.

### Ambience loops (stereo, seamless, ~20–40 s)

| File | Board | Prompt |
|---|---|---|
| `amb_lava` | Nevarro | "Volcanic plain ambience: deep magma rumble, distant gas vents hissing, occasional rock pops and settling gravel, dry wind, seamless loop" |
| `amb_ice` | The Crevasse | "Glacial canyon ambience: thin whistling wind, deep distant ice groans and settling cracks, faint snow hiss, empty and cold, seamless loop" |
| `amb_rain` | Trask | "Harbour storm ambience: steady heavy rain on metal decking, gusting wind, waves slapping pilings, creaking moored boats, distant gulls, seamless loop" |
| `amb_refinery` | The Refinery | "Industrial plant interior ambience: deep machinery drone, cycling pumps, steam hisses, metallic clanks echoing in a large hall, seamless loop" |
| `amb_forge` | The Great Forge | "Dead-world ambience: hollow wind over glass dunes, faint electrical crackle on the horizon, occasional deep sub-bass earth groan, desolate, seamless loop" |
| `amb_city` | The Ringworld | "Quiet alien city-street ambience: low crowd murmur behind walls, neon buzz, distant tram hum, occasional door hiss, night-city calm, seamless loop" |
| `amb_sea` | The Prison Rig | "Open-ocean facility ambience: steady sea swell against metal pylons, gull-less empty wind, faint sterile facility hum, distant intercom chime, seamless loop" |

### Board effects (mono one-shots unless noted)

| File | Hook | Prompt |
|---|---|---|
| `thunder_crack` | Trask lightning, Forge storm front | "Close thunder crack rolling off into a long rumble, 3s" |
| `geyser_blast` | Nevarro geysers | "Volcanic steam geyser eruption: pressurized blast into a roaring column, 1.5s" |
| `alarm_klaxon` | Refinery alarm cycle | "Industrial two-tone alarm klaxon, one cycle, harsh and metallic, 700ms" |
| `ice_crack` | Crevasse lake plates (loud) + glacier groans (quiet, pitch-varied) | "Thick lake ice splitting: sharp crack then a deep resonant groan, 1s" |
| `flame_burst` | Incinerator trooper's projector | "Flamethrower burst: ignition whump into a sustained roaring jet, 1.5s" |
| `mythosaur_call` | The Living Waters (Forge) | "Colossal creature call from deep underwater, mournful sub-bass bellow, heavily muffled, felt more than heard, 4s" |
| `splash_in` | Anyone hitting the water (all water boards) | "Armored body plunging into sea water: deep whump and spray, 800ms" |
| `splash_out` | Surfacing / breaching / wading footfalls (quiet, pitch-varied) | "Water shedding off a surfacing body, light splash and drips, 600ms" |
| `mamacore_roar` | Trask's hunter — quiet cue when it turns toward you, loud on the strike | "Huge aquatic predator roar breaking the surface: wet bellow with a gurgling snap, 1.5s" |
| `floor_charge` | The Prison Rig's electrified decks charging | "Electrical floor plate charging up: rising capacitor whine over a building hum, 1s" |

### Footsteps (mono, ~150 ms; pitch-varied in engine)

| File | Prompt |
|---|---|
| `footstep_snow` | "Single armored footstep in dry packed snow, crisp crunch, 150ms" |
| `footstep_stone` | "Single armored footstep on solid volcanic stone, hard mineral tap with slight grit, 150ms" |

### Enemy voice barks (mono; deliberately silent until the file exists)

| File | Used by | Prompt |
|---|---|---|
| `spider_chitter` | Krykna + broodmother (spawn, sighting, death, brood hatch) | "Large insectoid spider vocalization: rapid chitinous clicking rising to a hiss, unsettling, 1s" |
| `quarren_bark` | Quarren netcaster | "Gruff aquatic alien shout, wet gurgling undertone, aggressive challenge, no real words, 1s" |
| `alamite_shriek` | Alamite | "Feral humanoid cave-creature shriek, raspy and echoing, 1s" |
| `drone_whine` | Interceptor drone (dive warning — this is the player's dodge cue, keep it piercing) | "Small aggressive drone spinning up: rising servo whine into an overdriven scream, 1.2s" |

### Board music (nice-to-have)

Each new board currently borrows one of the two delivered playlists (`music/` README):
Nevarro and the Great Forge use the desert set, the rest use the station set. A dedicated
two-track set per board in the same dark-percussion style would replace that — same specs
as the delivered tracks. Wire-up is one entry per board in `MUSIC_PLAYLISTS`
(`src/core/audio.ts`) plus the board's `music` field.

## Open — nice-to-have variation sets

The engine currently pitch-varies a single file for each of these, which is convincing but
repetitive over a long session. Real variants would replace that.

| Files | Prompt |
|---|---|
| `footstep_sand_1..4` | "Single armored footstep on packed desert sand, dry crunch, 150ms, four distinct variations" |
| `footstep_metal_1..4` | "Single armored footstep on hollow steel deck plate, dull clank, 150ms, four distinct variations" |
| `melee_whoosh_1..3` | "Heavy metal staff swing whoosh, low airy sweep, 250ms; three variations rising in intensity, the third ending with a weighty grunt of effort (no words)" |

Adding these needs a small engine change too — the loader currently expects one file per
name, so it would need a variant-picking helper in `src/core/audio.ts`.

## Open — not yet consumed by the engine

These need a gameplay hook before the audio is worth producing.

| File | Prompt | Hook needed |
|---|---|---|
| `droid_servo` (loop) | "Robotic servo movement loop, whirring stepper motors and joint creaks, seamless 1s" | Positional per-enemy loop for droids/dark troopers |
| `amb_krayt_call` | "Very distant colossal desert creature call, low mournful bellow rolling over dunes, 4s one-shot, heavily reverbed" | Random distant-ambience timer on the Dune Sea |

## Open — future content

Bosses, when built, will each want a set: an entrance roar or line, a taunt, a hurt, and a
death. Deferred until the boss fights exist (see `ASSETS_MODELS.md`).
