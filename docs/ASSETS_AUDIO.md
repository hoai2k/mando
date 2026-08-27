# Asset Requests — Audio

All audio is synthesized procedurally via WebAudio at runtime, so nothing here is required. When a file exists at `public/assets/audio/<name>.ogg` (or `.mp3`), the audio engine plays it instead of the synth fallback (`src/core/assets.ts`).

**Specs:** OGG Vorbis preferred (MP3 ok), 44.1 kHz, mono for SFX / stereo for ambience & music, loudness-matched (SFX peaks ≈ −6 dBFS), loops must be seamless where marked. All sounds must be original or licensed — no ripped film audio; prompts describe character without naming trademarked sources.

## Weapons & combat (one-shots, mono, < 1.5 s)

| File | Prompt for sound generation / recording brief |
|---|---|
| `blaster_shot.ogg` | "Sci-fi laser blaster shot: sharp percussive attack, descending pitch zap 2kHz→300Hz over 120ms, slight metallic ring tail, punchy, retro-space-western character" |
| `blaster_impact.ogg` | "Small energy bolt impact on rock/metal: short crackle-spark burst, 150ms, bright transient with tiny debris fizz" |
| `enemy_blaster.ogg` | "Sci-fi enemy blaster shot, lower and rounder than hero blaster: hollow pulse zap around 500Hz, 150ms, slightly detuned" |
| `melee_whoosh_1.ogg` / `_2.ogg` / `_3.ogg` | "Heavy metal staff swing whoosh, low airy sweep, 250ms; three variations rising in intensity, third ends with a weighty grunt of effort (no words)" |
| `melee_hit.ogg` | "Blunt heavy melee impact on armor: deep thud with metallic clank overtone, 200ms, satisfying crunch" |
| `rocket_launch.ogg` | "Small missile launch from shoulder rack: pressurized whoosh-ignition, rising rocket hiss, 400ms" |
| `explosion.ogg` | "Medium sci-fi explosion: deep sub thump, fiery crackle body, metallic debris tail, 1.2s" |
| `hit_marker.ogg` | "Tiny arcade hit-confirm tick: bright 30ms click-blip, subtle" |
| `kill_confirm.ogg` | "Short arcade kill-confirm: two-note descending metallic blip, 200ms, understated" |
| `player_hurt.ogg` | "Muffled pained grunt inside a helmet, male, short, no words, 300ms" |

## Movement (loops marked)

| File | Prompt |
|---|---|
| `jetpack_loop.ogg` (seamless loop) | "Jetpack thruster loop: tight roaring flame jet, filtered white-noise core with low turbine whine, steady, seamless 2s loop, mono" |
| `jetpack_ignite.ogg` | "Jetpack ignition burst: sharp pressurized whump into flame roar onset, 300ms" |
| `dash.ogg` | "Short burst thruster dash: quick doppler whoosh with flame crackle, 250ms" |
| `land_soft.ogg` / `land_hard.ogg` | "Armored boots landing on sand — soft crunch thump / heavy two-stage armored slam landing with dust, 300ms" |
| `footstep_sand_1..4.ogg` | "Single armored footstep on packed desert sand, dry crunch, 150ms, four variations" |
| `footstep_metal_1..4.ogg` | "Single armored footstep on hollow steel deck plate, dull clank, 150ms, four variations" |

## Enemies (one-shots, mono)

| File | Prompt |
|---|---|
| `tusken_cry.ogg` | "Aggressive alien desert-nomad war cry: hoarse braying howl through a breathing mask, 800ms, original creature voice" |
| `pyke_chatter.ogg` / `pyke_death.ogg` | "Alien gangster radio chatter: burbling filtered vocalizations through a rebreather, gurgly and nasal, 600ms / same voice, short defeated gurgle-slump" |
| `pirate_taunt.ogg` / `pirate_death.ogg` | "Gravelly alien pirate taunt bark, guttural, 500ms / short death groan cut off" |
| `droid_servo.ogg` (loop) | "Robotic servo movement loop, whirring stepper motors and joint creaks, seamless 1s" |
| `droid_death.ogg` | "Robot power-down destruction: descending servo whine into sparking electrical fizzle and metal collapse, 900ms" |
| `massiff_growl.ogg` / `massiff_yelp.ogg` | "Reptilian hound aggressive snarling growl, 600ms / short reptilian yelp, 300ms" |
| `swoop_pass.ogg` | "Fast hover-bike flyby with doppler: whining repulsor engine sweep left-to-right, 1s, stereo" |

## Ambience (stereo, seamless loops, 30–60 s)

| File | Prompt |
|---|---|
| `amb_desert.ogg` | "Desert planet ambience: dry wind over dunes, occasional distant sand hiss and faint unidentifiable animal call far away, sparse, lonely, seamless loop" |
| `amb_station.ogg` | "Space station exterior ambience: deep hull hum, distant machinery clunks, occasional pressure hiss and crane groan, cold industrial, seamless loop" |
| `amb_krayt_call.ogg` | "Very distant colossal desert creature call, low mournful bellow rolling over dunes, 4s one-shot, heavily reverbed" |

## Music (stereo, seamless loops)

| File | Prompt |
|---|---|
| `music_title.ogg` | "Dark space-western title theme: slow lone electric-guitar-like twang motif over deep drone and sparse tribal percussion, moody and mythic, 60s seamless loop, original composition" |
| `music_combat_desert.ogg` | "Driving mid-tempo combat loop: tribal drums, low staccato strings, occasional brass stabs, desert-western tension, 90s seamless loop" |
| `music_combat_station.ogg` | "Driving industrial combat loop: pulsing synth bass, metallic percussion, tense strings, sci-fi noir, 90s seamless loop" |
| `music_victory.ogg` / `music_defeat.ogg` | "Short triumphant dark-western sting, 8s / short somber low-brass defeat sting, 6s" |

## UI (mono, tiny)

| File | Prompt |
|---|---|
| `ui_move.ogg` | "Minimal UI navigation blip, soft dry click-tick, 40ms" |
| `ui_confirm.ogg` | "UI confirm: warm two-tone mechanical latch chirp, 150ms" |
| `ui_back.ogg` | "UI back/cancel: single low soft thunk, 100ms" |
| `wave_start.ogg` | "War-horn-like alert announcing an enemy wave: short low alien horn blast with metallic edge, 800ms" |
| `wave_clear.ogg` | "Positive wave-cleared fanfare sting, three ascending dark-brass notes, 1.2s, restrained" |
