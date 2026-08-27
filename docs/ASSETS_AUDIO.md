# Asset Requests — Audio

**Open audio requests only.** All 41 sounds the engine currently consumes are delivered and
integrated — they are recorded in [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md), with their
regeneration prompts living in `tools/generate-sfx.mjs`. Nothing on that list needs making
again.

The game still runs with zero audio files: every sound falls back to a synthesized WebAudio
voice. Files go in `public/assets/audio/`; the loader tries `.mp3` then `.ogg`.

**Specs:** OGG Vorbis or MP3, 44.1 kHz, mono for SFX / stereo for ambience and music,
loudness-matched (SFX peaks ≈ −6 dBFS), seamless where looping. Original or licensed audio
only — no ripped film audio; prompts describe character without naming trademarked sources.

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
