# Asset Requests — Audio

**Open audio requests only.** Every sound the engine can ask for has a file —
**139 of 139 as of 2026-09-02** (111 named samples plus four takes each for seven
voices), verified by cross-checking `SampleName` in `src/core/audio.ts` against
`public/assets/audio/`: no missing files, no duplicate names, no orphaned files.
What remains below is board music (a music model rather than the sound-effect API)
and voice sets for creatures that do not exist in code yet.

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

Eleven tracks are delivered (see [`ASSETS_COMPLETED.md`](ASSETS_COMPLETED.md)), including
the warlord's theme that every board's final boss battle plays. Four boards
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

## Hooks built and voiced — delivered 2026-09-02

Both sounds that were waiting on a consumer now have one, so both were produced:

| File | Hook built for it |
|---|---|
| `droid_servo` (loop) | A **single shared servo bed** rather than a loop per droid: `audio.setDroidServo(level)` takes a level the game has already weighted by each droid's distance and speed, so a dozen machines cost one voice and a powered-down room stays quiet. Torn down with the match beside the jetpack and saber loops. |
| `amb_krayt_call` | A **distant-ambience timer on the Dune Sea**: something enormous calls from past the rim every 70–160 s. It never means an animal is coming — the desert is meant to sound inhabited by things the player never meets. |

## Open — future content

Per-boss voice sets — an entrance roar or line, a taunt at each phase turn, a hurt, a
death. The consumer exists now (the boss fights shipped 2026-08-29 with the horn, the
phase banners and the base kind's barks standing in), so these are producible whenever
distinct warlord voices feel worth nine sets of files.

## Game modes — delivered 2026-09-02

The three modes shipped on borrowed voices (UI confirms, the wave-clear chime); all
four now have their own, wired at the sites that used the stand-ins:

| File | Now wired to |
|---|---|
| `door_cycle` | mission gate `open()` — the doors had no voice of their own at all before |
| `checkpoint_chime` | `clearRoom` (a room that fought back still keeps the wave-clear payoff underneath) |
| `bacta_pickup` | the bacta canister pickup |
| `pvp_round_win` | PvP last-one-standing, over the victory music |

The per-boss voice sets for the **promoted humanoid warlords** stay deferred until
bosses get per-boss movesets; they still speak with their base kind's barks under the
`boss_horn`.

## Monster boss voices — six sets delivered 2026-09-02

Each of the six shipped monster bosses (`docs/BOSSES.md` §2.1–2.6) now has its own
**roar / hurt / death**, written to that creature's build so they read as different
animals rather than one growl pitched down: `mudhorn`, `ravinak`, `rancor`, `krayt`,
`mythosaur` (17 files) plus `mamacore_hurt` / `mamacore_death` — the mamacore's *roar*
is the `mamacore_roar` that already ships for the pier attack, since the boss is that
same hazard finally surfacing.

Routing is `audio.monster(voice, part)`, which falls back to the shared beast growl and
yelp when a set is absent — so a monster is always safe to ship silent and gains its
voice the moment three files land under its name. The **hurt** cry is throttled to one
every 1.6 s, since under sustained fire an untimed one machine-guns.

**Still open — the second batch.** `sandworm`, `zillo`, `nexu` and `kwazelMaw`
(`docs/BOSSES.md` §2.7–2.10) are designed but **not in code yet**, so their sets are
deliberately not produced: a file with no consumer cannot be verified. Each wants the
same roar/hurt/death (`<kind>_roar` etc., picked up by name through the same router
with no code change), and the worm additionally wants `sandworm_rumble` — a rolling
sub-bass drag through sand, 3 s, loopable — beside the `mythosaur_call` it borrows for
its underground approach.
