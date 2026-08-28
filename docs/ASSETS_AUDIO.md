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
Nevarro and the Great Forge use the desert set, the rest use the station set. The
dedicated two-track sets below would replace that — same specs as the delivered tracks
(stereo, 44.1 kHz, loudness-matched, seamless loop; chants and wordless voice fine, no
lyric vocals). Wire-up is one entry per board in `MUSIC_PLAYLISTS` (`src/core/audio.ts`)
plus the board's `music` field.

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
