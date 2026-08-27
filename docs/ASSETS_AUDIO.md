# Asset Requests — Audio

All audio is synthesized procedurally via WebAudio at runtime, so nothing here is required. When a file exists at `public/assets/audio/<name>.ogg` or `.mp3`, the audio engine plays it instead of the synth fallback (loader in `src/core/audio.ts` tries `.ogg` then `.mp3`).

**Status (2026-08-27):** all 41 sounds the engine consumes are **generated with the ElevenLabs sound-generation API** and checked in as `.mp3` under `public/assets/audio/` — combat/UI SFX, footsteps, jetpack ignite, enemy voice barks, Grogu coos, ambience beds and music loops included. Regenerate any with `node tools/generate-sfx.mjs <name ...>` (key from `ELEVENLABS_API_KEY` or the untracked `.elevenlabs_key` file; never commit the key). The engine hooks: footsteps by surface, spawn/death barks per enemy kind, swoop flyby, sampled ambience + music loops with synth fallback, victory/defeat stings. Remaining open requests are only the multi-variation files noted below (engine pitch-varies a single file instead).

**Specs:** OGG Vorbis or MP3, 44.1 kHz, mono for SFX / stereo for ambience & music, loudness-matched (SFX peaks ≈ −6 dBFS), loops must be seamless where marked. All sounds must be original or licensed — no ripped film audio; prompts describe character without naming trademarked sources.

## Weapons & combat (one-shots, mono, < 1.5 s)

| File | Prompt for sound generation / recording brief |
|---|---|
| ✅ `blaster_shot.mp3` | "Sci-fi laser blaster shot: sharp percussive attack, descending pitch zap 2kHz→300Hz over 120ms, slight metallic ring tail, punchy, retro-space-western character" |
| ✅ `blaster_impact.mp3` | "Small energy bolt impact on rock/metal: short crackle-spark burst, 150ms, bright transient with tiny debris fizz" |
| ✅ `enemy_blaster.mp3` | "Sci-fi enemy blaster shot, lower and rounder than hero blaster: hollow pulse zap around 500Hz, 150ms, slightly detuned" |
| ✅ `melee_whoosh.mp3` (engine pitch-varies one file; `_1..3` variants still welcome) | "Heavy metal staff swing whoosh, low airy sweep, 250ms; three variations rising in intensity, third ends with a weighty grunt of effort (no words)" |
| ✅ `melee_hit.mp3` | "Blunt heavy melee impact on armor: deep thud with metallic clank overtone, 200ms, satisfying crunch" |
| ✅ `rocket_launch.mp3` | "Small missile launch from shoulder rack: pressurized whoosh-ignition, rising rocket hiss, 400ms" |
| ✅ `explosion.mp3` | "Medium sci-fi explosion: deep sub thump, fiery crackle body, metallic debris tail, 1.2s" |
| ✅ `hit_marker.mp3` | "Tiny arcade hit-confirm tick: bright 30ms click-blip, subtle" |
| ✅ `kill_confirm.mp3` | "Short arcade kill-confirm: two-note descending metallic blip, 200ms, understated" |
| ✅ `player_hurt.mp3` | "Muffled pained grunt inside a helmet, male, short, no words, 300ms" |

## Movement (loops marked)

| File | Prompt |
|---|---|
| ✅ `jetpack_loop.mp3` (seamless loop) | "Jetpack thruster loop: tight roaring flame jet, filtered white-noise core with low turbine whine, steady, seamless 2s loop, mono" |
| ✅ `jetpack_ignite.mp3` | "Jetpack ignition burst: sharp pressurized whump into flame roar onset, 300ms" |
| ✅ `dash.mp3` | "Short burst thruster dash: quick doppler whoosh with flame crackle, 250ms" |
| ✅ `land_hard.mp3` / ✅ `land_soft.mp3` | "Armored boots landing on sand — soft crunch thump / heavy two-stage armored slam landing with dust, 300ms" |
| ✅ `footstep_sand.mp3` (engine pitch-varies; `_1..4` variants welcome) | "Single armored footstep on packed desert sand, dry crunch, 150ms, four variations" |
| ✅ `footstep_metal.mp3` (engine pitch-varies; `_1..4` variants welcome) | "Single armored footstep on hollow steel deck plate, dull clank, 150ms, four variations" |

## Enemies (one-shots, mono)

| File | Prompt |
|---|---|
| ✅ `tusken_cry.mp3` | "Aggressive alien desert-nomad war cry: hoarse braying howl through a breathing mask, 800ms, original creature voice" |
| ✅ `pyke_chatter.mp3` / ✅ `pyke_death.mp3` | "Alien gangster radio chatter: burbling filtered vocalizations through a rebreather, gurgly and nasal, 600ms / same voice, short defeated gurgle-slump" |
| ✅ `pirate_taunt.mp3` / ✅ `pirate_death.mp3` | "Gravelly alien pirate taunt bark, guttural, 500ms / short death groan cut off" |
| `droid_servo.ogg` (loop, not yet consumed by engine) | "Robotic servo movement loop, whirring stepper motors and joint creaks, seamless 1s" |
| ✅ `droid_death.mp3` | "Robot power-down destruction: descending servo whine into sparking electrical fizzle and metal collapse, 900ms" |
| ✅ `massiff_growl.mp3` / ✅ `massiff_yelp.mp3` | "Reptilian hound aggressive snarling growl, 600ms / short reptilian yelp, 300ms" |
| ✅ `swoop_pass.mp3` | "Fast hover-bike flyby with doppler: whining repulsor engine sweep left-to-right, 1s, stereo" |
| ✅ `imperial_bark.mp3` / ✅ `imperial_death.mp3` | "Soldier voice through helmet radio filter: short muffled command bark / short death cry cut off with static" |
| ✅ `grogu_coo.mp3` | "Cute tiny alien baby creature cooing, soft curious babble, short" |

## Ambience (stereo, seamless loops, 30–60 s)

| File | Prompt |
|---|---|
| ✅ `amb_desert.mp3` (18s loop) | "Desert planet ambience: dry wind over dunes, occasional distant sand hiss and faint unidentifiable animal call far away, sparse, lonely, seamless loop" |
| ✅ `amb_station.mp3` (18s loop) | "Space station exterior ambience: deep hull hum, distant machinery clunks, occasional pressure hiss and crane groan, cold industrial, seamless loop" |
| `amb_krayt_call.ogg` | "Very distant colossal desert creature call, low mournful bellow rolling over dunes, 4s one-shot, heavily reverbed" |

## Music (stereo, seamless loops)

| File | Prompt |
|---|---|
| ✅ `music_title.mp3` (20s loop) | "Dark space-western title theme: slow lone electric-guitar-like twang motif over deep drone and sparse tribal percussion, moody and mythic, 60s seamless loop, original composition" |
| ✅ `music_combat_desert.mp3` (20s loop) | "Driving mid-tempo combat loop: tribal drums, low staccato strings, occasional brass stabs, desert-western tension, 90s seamless loop" |
| ✅ `music_combat_station.mp3` (20s loop) | "Driving industrial combat loop: pulsing synth bass, metallic percussion, tense strings, sci-fi noir, 90s seamless loop" |
| ✅ `music_victory.mp3` / ✅ `music_defeat.mp3` | "Short triumphant dark-western sting, 8s / short somber low-brass defeat sting, 6s" |

## UI (mono, tiny)

| File | Prompt |
|---|---|
| ✅ `ui_move.mp3` | "Minimal UI navigation blip, soft dry click-tick, 40ms" |
| ✅ `ui_confirm.mp3` | "UI confirm: warm two-tone mechanical latch chirp, 150ms" |
| ✅ `ui_back.mp3` | "UI back/cancel: single low soft thunk, 100ms" |
| ✅ `wave_start.mp3` | "War-horn-like alert announcing an enemy wave: short low alien horn blast with metallic edge, 800ms" |
| ✅ `wave_clear.mp3` | "Positive wave-cleared fanfare sting, three ascending dark-brass notes, 1.2s, restrained" |
