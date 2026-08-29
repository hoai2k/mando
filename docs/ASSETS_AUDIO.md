# Asset Requests — Audio

**Open audio requests only.** Every sound the engine can ask for has a file —
111 of 111 as of 2026-08-29 (83 named samples plus four takes each for seven voices),
verified by cross-checking `SampleName` in `src/core/audio.ts` against
`public/assets/audio/`. What remains below needs a gameplay hook or a feature that does not exist yet —
plus board music, which needs a music model rather than the sound-effect API.

**Historical note.** The original 38 sounds are delivered and integrated — they
are recorded in [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md), with their regeneration
prompts living in `tools/generate-sfx.mjs`. Nothing on that list needs making again.
**The six new boards opened the batch below** — every one already plays through a synth
fallback (or is deliberately silent, for the voice barks), and the engine picks the file
up automatically when it lands in `public/assets/audio/`.

The game still runs with zero audio files: every sound falls back to a synthesized WebAudio
voice. Files go in `public/assets/audio/`; the loader tries `.mp3` then `.ogg`.

Board background music is separate: full-length tracks live in `public/music/` and are
streamed as a per-board playlist rather than decoded as samples — see that directory's
README and the track map in `src/core/music.ts`. The `music_combat_desert` /
`music_combat_station` samples remain as the fallback if those tracks fail to load.

**Specs:** OGG Vorbis or MP3, 44.1 kHz, mono for SFX / stereo for ambience and music,
loudness-matched (SFX peaks ≈ −6 dBFS), seamless where looping. Original or licensed audio
only — no ripped film audio; prompts describe character without naming trademarked sources.

### Board music (nice-to-have)

Ten tracks are delivered (see [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md)). Four boards
now open on a signature track of their own — **The Storm Docks**, **The Crevasse**, **The
Great Forge** and **The Prison Rig** — and two more tracks play on any board; the rest of
a board's rotation is still one of the two original playlists (desert for Nevarro and the
Great Forge, station for the others). The dedicated two-track sets below would finish the
job, giving every board its own pair — same specs as the delivered tracks (stereo,
44.1 kHz, loudness-matched, seamless loop; chants and wordless voice fine, no lyric
vocals). Wire-up is one entry per board in `src/core/music.ts`, which is the only file
that names a track.

The shared scoring DNA across all of them, tuned per board: ritual percussion, low male
chant, bass wood flutes, analog synth pulse, and a lonely desert-western twang.

**The Lava Flats** — `ember-rite-march-1/2`
| Track | Prompt |
|---|---|
| *Ember Rite March* | "Slow ritual war march over a volcanic plain: huge low taiko and frame drums in a deliberate processional beat, distorted sub-bass drone, low male chant rising every eighth bar, sparse baritone-guitar twang echoing over the top, ember-crackle percussion textures. Dark, smoldering, unhurried menace. ~85 BPM, 3 minutes, seamless loop" |
| *Black Glass Rivers* | "Brooding volcanic tension bed: bowed low strings and growling brass swells over a heat-shimmer synth drone, intermittent anvil-like metallic hits, a bass wood flute lament in a minor pentatonic mode, distant geyser-burst percussion accents. Crossing cooling crust above something alive. ~2.5 minutes, loopable" |

**The Crevasse** — `hollow-ice-hymn-1/2`
| Track | Prompt |
|---|---|
| *Hollow Ice Hymn* | "Glacial ambient-ritual piece: glassy bowed-cymbal and crystal harmonics, breathy low flute phrases with long echoing tails as if sung into a canyon, deep reverberant chant fragments, slow heartbeat kick far below. Cold, vast, vertiginous; sparse enough to leave room for wind. ~3 minutes, seamless loop" |
| *Silk in the Deep* | "Creeping arachnid dread under ice: ticking irregular percussion like many small legs on frozen plates, detuned music-box motif, low cello pulses, sudden held-breath silences, a keening high string harmonic that never resolves. Skittering intensity that never breaks into full combat. ~2.5 minutes, loopable" |

**The Storm Docks** — `black-swell-shanty-1/2`
| Track | Prompt |
|---|---|
| *Black Swell Shanty* | "Storm-sea work song without words: heaving 6/8 groove like a hull on a swell, deep male hum-chant in shanty phrasing, concertina and low whistle carrying a grim folk melody, rope-creak and chain percussion, thunder-roll toms answering distant foghorn brass. Rain-soaked, salt-bitten, defiant. ~90 BPM, 3 minutes, seamless loop" |
| *Mamacore Wake* | "Something vast circling under a harbour: sub-bass surges that swell and recede like a wake, waterphone shrieks, muted string ostinato speeding up almost imperceptibly, wet slap-percussion, a distant folk whistle warped and uneasy. Dread with a pulse. ~2.5 minutes, loopable" |

**The Refinery** — `rhydonium-heartbeat-1/2`
| Track | Prompt |
|---|---|
| *Rhydonium Heartbeat* | "Claustrophobic industrial interior: relentless machine-room pulse built from clanking pipe hits, hissing steam vents and a throbbing analog synth bass, low-ceiling pressure drones, curt chant stabs used as percussion, an occasional klaxon-tinged two-note motif. Tight, metallic, volatile — a spark away from disaster. ~100 BPM, 3 minutes, seamless loop" |
| *The Chimney* | "Vertical awe inside a reactor shaft: cavernous reverb, slow rising synth arpeggio like an updraft, deep drum hits spaced far apart that bloom upward, a choral pad glimpsed at the top. Tension that opens upward instead of forward. ~2.5 minutes, loopable" |

**The Great Forge** — `anvil-choir-1/2`
| Track | Prompt |
|---|---|
| *Anvil Choir* | "Mythic funeral-forge anthem: full low male choir chanting a solemn creed-like theme, hammer-on-anvil strikes as the primary percussion, deep war drums, duduk-style double-reed lament over a fused-glass desert, a sub-bass groan like a colossal creature far beneath the surface once per loop. Grief and iron resolve. ~75 BPM, 3.5 minutes, seamless loop" |
| *The Storm Interval* | "Magnetic-storm reprise of the same choir theme: fractured by crackling electrical arcs, stuttering tremolo strings, the chant distant and wind-torn, percussion reduced to irregular thunder-strikes, resolving briefly to calm before the next front. ~2.5 minutes, loopable" |

**The Ringworld** — `neon-meridian-1/2`
| Track | Prompt |
|---|---|
| *Neon Meridian* | "Night-city bounty-noir groove: slow analog synthwave pulse, dusty twang guitar playing a lone-gunslinger motif over neon-lit electronics, finger-snap and brushed-trap percussion, warm retro arpeggios, low chant pads mixed like city haze. Cool, prowling, stylish. ~95 BPM, 3 minutes, seamless loop" |
| *Terminator Drift* | "The moving line between day and night: a two-mood piece slowly crossfading between bright driving daylight synths and hushed night-side minimalism with sight-line tension, tram-rail percussion gliding through both halves. ~3 minutes, loopable" |

**The Prison Rig** — `white-deck-cadence-1/2`
| Track | Prompt |
|---|---|
| *White Deck Cadence* | "Sterile penal-facility precision: cold clipped electronic ticking in strict grid time, sequenced bass with a rising charge-up whine motif that peaks and discharges on the loop, pristine icy pads, curt processed drum hits like boots on plated floor, no warmth anywhere. Oppressive order. ~110 BPM, 3 minutes, seamless loop" |
| *Beneath the Moon Pool* | "The same facility heard from underwater: a muffled low-passed echo of the deck cadence far above, slow sub-aquatic pads, kelp-forest shimmer, sonar-like pings, glowing-reef bell tones — dread turned weightless and strangely beautiful. ~3 minutes, loopable" |

## Ambient life & backdrop voices — delivered 2026-08-29

`ship_pass` (sky-traffic close pass), `ship_landing` (the Waystation's working-pad
touchdown and liftoff), `steam_hiss` (Refinery vent cycle) and `bantha_low` (the herd's
idle low) all landed with their hooks — each is sample-first with a synth fallback and
its volume set by the nearest player's range. Prompts recorded in
[`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md) and `tools/generate-sfx.mjs`.

No gull file is needed — the requested `amb_rain` loop already carries the distant
gulls the quay dressing wants.

## Open — not yet consumed by the engine

These need a gameplay hook before the audio is worth producing.

| File | Prompt | Hook needed |
|---|---|---|
| `droid_servo` (loop) | "Robotic servo movement loop, whirring stepper motors and joint creaks, seamless 1s" | Positional per-enemy loop for droids/dark troopers |
| `amb_krayt_call` | "Very distant colossal desert creature call, low mournful bellow rolling over dunes, 4s one-shot, heavily reverbed" | Random distant-ambience timer on the Dune Sea |

## Open — future content

Per-boss voice sets — an entrance roar or line, a taunt at each phase turn, a hurt, a
death. The consumer exists now (the boss fights shipped 2026-08-29 with the horn, the
phase banners and the base kind's barks standing in), so these are producible whenever
distinct warlord voices feel worth nine sets of files.

## Game modes (`?modes`, 2026-08-29) — open, awaiting dedicated hooks

The three modes shipped on existing voices: doors, checkpoints and pickups reuse UI
confirms and the wave-clear chime, and every boss speaks with its base kind's barks.
These become drop-in upgrades once their names are wired in `core/audio.ts`
(`boss_horn` graduated on 2026-08-29 — it is wired and delivered, opening the boss
introduction card and, quieter, each phase turn):

| File | Prompt | Hook (today's stand-in) |
|---|---|---|
| `door_cycle` | "Heavy blast door cycling open: hydraulic unlock clunk, deep metal slide, pressurized thunk at the stop, 2s" | corridor door teleport (`uiConfirm`) |
| `checkpoint_chime` | "Small triumphant two-note beacon chime with a metallic shimmer tail, 1.5s" | campaign checkpoint (`waveClear`) |
| `bacta_pickup` | "Glass-and-liquid pickup slurp with a soft healing shimmer, 1s" | bacta canister (`uiConfirm`) |
| `pvp_round_win` | "Short duel-won sting: two hard timpani hits under a rising metallic flourish, 2.5s" | PvP last-one-standing (`sting(true)`) |

The per-boss voice sets deferred earlier now have their consumer (bosses exist as
promoted elites); they stay deferred only until bosses get per-boss movesets.

**The six monster bosses now have one too.** Their fights shipped on 2026-08-29
(`docs/BOSSES.md`), and each currently speaks with the synth beast voice — a growl as
it erupts, a yelp as it goes down, both pitched heavier for a boss than for a massiff.
A roar/hurt/death set per monster (`mudhorn_roar` and so on, the `mamacore_roar`
pattern) is the upgrade whenever six sets of files feel worth it; nothing waits on
them, and a delivered file is picked up by name.
