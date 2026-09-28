# Level audit: the existing Missions zones and stages (2026-09-28)

What this covers: every zone and stage of the nine authored runs as they stand at
`4e5cb2c`: `src/world/mission-layouts.ts`, the builders in `src/world/stage/`
and the flow in `src/game/campaign.ts`. It does **not** cover the gameplay sections
(`docs/LEVEL_SECTIONS.md`, `docs/SECTIONS_IMPLEMENTATION.md`). Where a
recommendation here touches a beat a section is planned to replace, the note says so.

How it was done. I read the layouts, the stage builders and the campaign
flow. Then I booted all nine runs in the Playwright harness (`dist/` at HEAD,
one player, stepped) and forced every stage. For each stage I recorded the
golden-path length, every zone's validated posts, vents, hatches and runner post,
the garrison posted at raise, the pickets in each link, the pickups and the rides.
I also took a screenshot from every zone's entry looking at its exit. The
screenshots are in the session scratchpad, not in the repo. The measured numbers
below come from that survey. Everything else is cited to code at HEAD.

Notation: `shell:encounter w×l`. Beats are numbered from 0 across the whole
run, the way `TEXT.missions.rooms` and `zone.beat` count them. O = open,
C = canyon/road, I = interior hall, D = deck, S = sea.

---

## Top findings, ranked

1. **Nine territories are built from about four templates.** The Lava Flats and the
   Great Forge are the same run beat for beat: `open:start → open:camp(rides)
   → road:chase → open:assault ‖ hall:assault 28×24 → hall:lieutenant 30×26 ‖
   open:assault 50–54 → canyon:camp 14–16×50 → open:warlord`. The Storm Docks
   and the Ringworld are also one run twice, down to the link list:
   `open:start → open:camp 44×40 + one ride + alcove → canyon:assault 12×46–50
   deadEnd → hall 28×24 → hall 30×26 → open:assault ×3 → canyon:camp alcove →
   open:warlord`. The 28×24 assault hall plus 30×26 lieutenant hall, joined by a
   14+12 m bent corridor, appears in **8 of 9** runs at identical sizes. The
   closing trio (open assault, then a narrow canyon camp, then an open warlord)
   appears in **6 of 9**. There are six identical 44×40 open camps. The runs differ
   in palette and props, not in shape, which is the problem
   `MISSIONS_OUTDOOR.md` §0 set out to fix.
2. **Every interior stage opens inside its first sealed fight, with the way out
   left open behind you.** The party re-forms at `startZone.entry ± 0.9`
   (`stage/finish.ts:35`), which is 2.4 m into zone 0. When zone 0 is a hall
   assault (station, nevarro, crevasse, forge, narkina interiors) or an arena
   (the Dune Sea's fighting pit), `allInside` is true on the first frame
   (`campaign.ts:1425–1436`). The room seals with its posted garrison already
   standing in it (7–8 bodies measured), or the sandworm spawns 25 m away as the
   loading veil lifts. The same room's back portal is never shut
   (`campaign.ts:1200`), and the back rule counts only living players
   (`campaign.ts:1248–1266`). So a **solo player who backs 3.4 m into the door
   while fighting is transported to the previous stage**.
3. **The roads are a 3-second dash.** They are 70, 72 and 78 m long
   (`mission-layouts.ts:104, 246, 456`), against the 120–180 m the design
   called for. A swoop or bike tops out at 24–27 m/s (`game/vehicles.ts:126–148`).
   Marks fire as the lead passes them (`campaign.ts:1511–1518`), so the drops land
   behind a party that is already at the barricade, and the fight happens on foot at
   the far mouth. Nothing harries the column. The set piece the corrals exist to
   feed barely happens.
4. **Outdoor assaults misreport themselves.** Unless `siege` is set, an outdoor
   assault posts its whole fight and calls no waves
   (`campaign.ts:83, 349, 938`). The player is still told **"Sealed in"**
   (`campaign.ts:948`) while the entry stays open, and the HUD reads **"wave 1
   of 1"** (`campaign.ts:769`). `waves: 3` on seven non-siege outdoor zones
   does nothing but add 4 bodies to the posted garrison.
5. **`pass` is dead geometry in all five zones that use it.** Measured: after
   validation `runnerPost` is null for the dune gate, the crossing, the cracked
   lake, the glassed court and the plaza. Every probe along the notch axis, from
   the zone's front edge to 9 m out, is blocked. So runners never come through a
   pass. That includes the two sieges, whose massiffs and krykna come by carrier
   like everyone else. What is left is a notch in the far rim that reads as a
   second way on and goes nowhere. On the 16 m dune gate it overlaps the real exit
   gap: the notch spans v 3.3–7.3 and the gap v ±3.4 (`stage/zones.ts:180–183`).
6. **Eight of nine lieutenants are a promoted grunt in the same pillared 30×26 box,**
   one corridor after a 28×24 hall assault. That makes two sealed rooms back to
   back with no breather. The Refinery's lieutenant fights in "the reactor floor",
   an 18×18 slot in the plant's south strip at z = −46. The reactor atrium (the
   board's 44×44 open 40 m shaft with catwalk rings, `world/refinery.ts:82–150`)
   is 24 m north and is never used. It is the one space in the game built for
   jetpack combat.
7. **Camps say "clear it, or slip through", but slipping through is not possible.**
   Every zone's garrison posts sit at 0.6–0.82 of its length, on and beside the
   centreline (`stage/zones.ts:293–297`), around an exit you have to touch
   within 4.2 m (`campaign.ts:890`). Every camp therefore plays as a smaller
   assault, and the stealth read of the Tusken corral and the kiosk-steal ride
   parking is only on paper.
8. **Rides with nowhere to go.** The Storm Docks' skiff, the Refinery's landspeeder
   and the Ringworld's two swoops are parked in a camp whose only way on is a
   9 m trek lane into a 12 m dead-end canyon and a hall door. That gives about 50 m
   of use, then the ride is abandoned. The Lava Flats' corral parks 3 bikes for up
   to 4 players.
9. **The two water boards never show their water.** Built-stage outdoor zones
   are rimmed on all four sides (`stage/zones.ts:166`, `!onGround`). The Storm
   Docks' trawler deck ("the sea on three sides") and the Prison Rig's assembly
   deck are wooden or white boxes with the water plane under them where no
   one can see it (screenshots `trask-s0-z5`, `narkina-s3-z0`). The harbour, the
   pier and the rig's edge carry most of those boards' personality.
10. **The Spice Run's low gravity has no verb.** Decks are single flat plates.
    The platform chains (`plates[]`, three plates with 15 m gaps rising 4 m each)
    were never built. Deck-to-deck links are laid as outdoor lanes walled by
    66 m hull ridges (`stage/links.ts:46`). Nothing on the run asks you to jet
    across a gap at 0.45 g.
11. **The Crevasse's "deep" is a steel deck under a black sky.** An `interior`
    stage textures every floor with `corridor_floor` (`stage/builder.ts:111`),
    and its open zones get no roof. The cracked lake (a siege) is diamond plate
    under an empty background (screenshot `crevasse-s1-z2`). The planned lake
    traction disc and the hatchery's breakable `krykna_brood` sacs are absent.
12. **Co-op scaling flattens late and pinches solo.** Outdoor assaults cap at 14
    posted (`campaign.ts:349`). The Storm Docks' trawler deck already posts 13
    for one player, so four players meet the same fight. Camps cap at `posts + 2`
    (`campaign.ts:318`), and the desert ravine validated 3 posts, so its garrison
    is 4 solo and 5 with four players. Halls and arenas wait for **every** living
    player (`allInside`) with no timeout, so one straggler stalls four.

---

## The Dune Sea (`desert`): 10 beats, 3 stages, 731 m, 64 posted

Rhythm: O O C ‖ C C I ‖ O C O O. This is the flagship and the best-shaped run.
The trailhead canyon closing onto a lit gorge is the strongest opening in the
game (screenshot `desert-s0-z0`).

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A open desert | 0 | the trailhead flats | open:start | 44×44 | KEEP | The one opening that uses a canyon (`StageSpec.canyon`); the gorge is the landmark from spawn |
| | 1 | the Tusken corral | open:camp +5 rides | 44×40 | KEEP | Rides have owners; tents, bantha, the theme in ten seconds |
| | 2 | the dune road | road:chase | 26×70 | REWORK | 70 m ≈ 3 s at speed (finding 3); the Barge Run section is planned to replace it |
| B ravine | 3 | the ravine | canyon:camp | 14×56 | KEEP | The S-bend through rock is a real place |
| | 4 | the cistern approach | canyon:assault deadEnd | 12×50 | MERGE | Same width, same rock, same posted-garrison fight as #3; its only content is the door |
| | 5 | the cistern court | hall:assault pit | 28×24 | KEEP | War massiff debut round the pit; the only hall with a set piece that changes movement |
| C far side | 6 | the fighting pit | open:lieutenant | 56×50 | REWORK | Boss spawns as the veil lifts (finding 2) |
| | 7 | the dune gate | canyon:assault pass | 16×60 | REWORK | Third canyon fight; dead pass; 14 posted solo |
| | 8 | the caravan graves | open:camp | 60×40 | KEEP | Beached barge landmark, the Fennec cache |
| | 9 | the Old One's hollow | open:warlord | 80×70 | KEEP | Right size for the krayt; rides for ramming |

**#2 the dune road.** The bowl limits length (the comment at
`mission-layouts.ts:64–66`), so extend the ride rather than the lane. Add the lead §7 names
(`ROAD_MARK_LEAD`, never implemented) so the first mark's drop is called when the lead is *at the
corral exit* and lands mid-road ahead of the party. Add a swoop pack at
`enterZone('chase')` (`campaign.ts:921–928`), meaning `squadFor` with air kinds
flown in over the rim, as §1.2 specified and never shipped. If the Barge Run
lands, cut this beat and leave the corral as the rides' only home.

**#4 cistern approach → merge into #3.** Make the ravine one `canyon:camp` about 90 m
long across the existing S-bend link, ending at the door face. Move `deadEnd: true`
onto it. `deadEnd` only builds the door face when there is an internal exit
(`stage/zones.ts:178`), which holds. That saves a beat and a 12 m-wide fight
that looks exactly like the one before it.

**#5 cistern court.** The hall floor takes the stage's sand texture because stage B is
`built`, not `interior` (`stage/builder.ts:111`), so the court reads as a
sand-floored steel room (screenshot `desert-s1-z2`). Choose floor texture per
shell (hall → `corridor_floor`) rather than per stage.

**#6 fighting pit.** Give stage C a 20 m approach before the arena: either a
`trek` zone (the airlock's exit tunnel) or a start offset so `starts` land
outside the arena's `sealRect`. The worm's reveal needs the party to walk in.

**#7 dune gate.** Either make it the desert's siege (`siege: true`, with the pass
fixed so Tuskens and massiffs run in, which is what `RUNNER_KINDS` was for) or
drop `pass` and shorten it to 40 m. As it stands it is the run's third canyon
assault.

---

## The Spice Run (`station`): 8 beats, 3 stages, 389 m, 40 posted

Rhythm: D D D ‖ I I ‖ D D D. It is the second-shortest run. The hull facade
over the docking bay (`stage/doors.ts:89–120`) is an excellent landmark.

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A approach | 0 | the docking bay | deck:start | 40×30 | KEEP | Freighter and the hull wall ahead read at once |
| | 1 | the cargo gantries | deck:camp | 26×40 | REWORK | Designed as three plates with jet gaps; built as one flat plate |
| | 2 | the outer yard | deck:assault ×2 | 44×36 | KEEP | Cranes, jet pirates, the hull door |
| B inside | 3 | the spice vault | hall:assault barrels | 28×24 | KEEP | Barrels are the station's fight; fix the arrival (finding 2) |
| | 4 | the loading gantry | hall:lieutenant | 30×26 | REWORK | The gunslinger in the generic box |
| C prize | 5 | the crew catwalks | deck:camp | 24×38 | REWORK | Arrival pocket floats on a plate; flat |
| | 6 | the reactor ring | deck:assault ×3 | 40×32 | KEEP | The spire; Guns of the Frigate is planned to replace it |
| | 7 | the hold of the prize | deck:warlord | 60×50 | REWORK | An empty plate (screenshot `station-s2-z2`); no cache before it |

**#1 and #5: build the plates.** Implement `ZoneSpec.plates` in the deck branch
of `stage/zones.ts:122–131`: several floor slabs with gaps ≤ 18 m (§7's
`DECK_GAP_MAX`, not yet in code), each
with the lit near edge already drawn for the single plate. Author the gantries as
3×(18×14) plates, 15 m gaps, 4 m rise, and the catwalks as three plates along a
hull ridge. That gives the jetpack its first verb here. Also skip `ridge()` on
links between two decks (`stage/links.ts:46`), so the void is the border, as
§3.2 intended.

**#4 loading gantry.** Give it `roofH: 14` and a raised catwalk (a slab at 6 m
along one wall with crate steps). A gunslinger duel wants two levels. Or move
the lieutenant out to #5 as a deck duel, and let the catwalks' camp become the
breather.

**#5 arrival.** `facedShell` excludes decks (`stage/doors.ts:61`), so the back
portal is a free-standing shed on a floating plate. The stage-A hull facade
branch (`doors.ts:89`) should also cover a deck stage's *back* portal. You
leave through the station's hull, so you should arrive in front of it.

**#7 warlord and the cache.** The Fennec cache only drops in a camp or trek
immediately before a boss (`campaign.ts:909–912`). Here the camp is two beats
back, so the Spice Run is the one run with **no cache**. Either let the rule
look back to the last walked zone of the stage, or reorder #5/#6. Add
`feature: 'crates'` plus container props: 60×50 with a parked dropship is
too bare for the mudhorn's charges to have anything to hit.

---

## The Lava Flats (`nevarro`): 9 beats, 3 stages, 531 m, 49 posted

Rhythm: O O C O ‖ I I ‖ O C O. This is the Great Forge's template (finding 1).
In software GL the territory stage reads very dark: the basalt rim is
near-black against ash (screenshots `nevarro-s0-z2/z3`). Check it on a real GPU
before trusting it.

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A flats | 0 | the ash flats | open:start | 40×48 | KEEP | Real terrain, lava glow |
| | 1 | the bike pool | open:camp +3 bikes | 44×40 | KEEP | Rides with owners; needs a 4th bike |
| | 2 | the crust causeway | road:chase | 26×72 | REWORK | No lava either side (the zone lays none); 72 m. Magma Run planned to replace it |
| | 3 | the town gate | open:assault ×2 | 36×30 | REWORK | Its door is a generic door in basalt; the board's adobe gate and towers are not the door |
| B garrison | 4 | the garrison yard | hall:assault | 28×24 | KEEP | Only as the one hall fight; see cross-cutting |
| | 5 | the magistrate court | hall:lieutenant | 30×26 | REWORK | A promoted massiff (a leaper) in a pillared box |
| C glass fields | 6 | the crossing | open:assault siege lava | 50×44 | KEEP | One of two sieges; lava channels change movement |
| | 7 | the cantina row | canyon:camp | 16×50 | REWORK | The label promises a street; it is the generic pre-warlord canyon |
| | 8 | the rancor pen | open:warlord barrels | 76×66 | KEEP | Right size; barrels |

**#1.** Add a fourth `speederBike` to `rides` (`mission-layouts.ts:239–243`).
With 4 players and the riders rule claiming up to half the crew's rides
(`campaign.ts:645`), someone always walks the causeway.

**#2.** If it stays, give it `feature: 'lava'` strips along both edges. The
lava branch in `stage/dressing.ts:136` only lays crosswise cuts, so it needs a
lengthwise variant: a causeway with live lava either side, the one idea that
makes it Nevarro.

**#3.** Place `adobe_gate` and two `adobe_tower` props at the stage's
transport door and hide the portal's frame behind the gate leaves. This is the
continuity beat: "the town gate" → "the garrison".

**#5.** Move the massiff lieutenant outdoors. Swap it with #6 (lieutenant on
the lava crossing, siege after it) or give the court `roofH: 12` and no
pillars so the pounce has room.

**#7.** Either make the cantina row a street (kiosk/door props, `panel`-style
facades are wrong here, but adobe props exist) or rename it. At present the name
is the only difference from five other pre-warlord canyons.

---

## The Crevasse (`crevasse`): 8 beats, 2 stages, 558 m, 45 posted

Rhythm: O C C ‖ I I O C O. The theme is canyons, so two canyons up front is
fair. The problem is stage B.

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A surface | 0 | the rim shelf | open:start | 60×50 | KEEP | Crawler landmark; the crack ahead |
| | 1 | the frozen gallery | canyon:camp pillars | 12×80 | KEEP | The longest canyon; ice pillars |
| | 2 | the nest mouth | canyon:assault deadEnd | 10×40 | MERGE | Same as #1, narrower; only a door |
| B deep | 3 | the queen tunnel | hall:assault pillars | 28×24 | REWORK | A steel box in an ice cavern; arrival inside it |
| | 4 | the hatchery | hall:lieutenant | 30×26 | REWORK | The egg sacs that make it a hatchery are not there |
| | 5 | the cracked lake | open:assault siege pass | 50×46 | KEEP | The second siege, but fix the floor, roof and pass |
| | 6 | the ice chimney | canyon:camp | 14×50 | REWORK | "Chimney" and flat; the generic pre-warlord canyon |
| | 7 | the breaker deep | open:warlord | 72×62 | KEEP | Ravinak arena |

**#2.** Fold it into #1 as its last 30 m (`deadEnd` on the gallery). The
Glacier Chute section is planned between #2 and #3, so the surface stage's end
matters. One long gallery that ends at the glacier door is the cleaner handoff.

**#3–#7 floors and roof.** Choose floor texture per shell
(`stage/builder.ts:111`): `snow_albedo`/ice for open and canyon zones even in an
interior stage. Put a roof slab (the ceiling height, mesh plus collider) over the
interior stage's outdoor zones, with a few stalactite pieces, so "under the
ice" is a cavern rather than a night sky.

**#4.** Place `krykna_brood` props with `addBreakable` (§1.7 listed them) and
make them the lieutenant's retinue source. Otherwise the krykna lieutenant is
the same pillared-box fight as seven others.

**#5.** Build the traction disc (a `tractionAt` override inside a 10 m radius
of the zone centre, 0.4) and fix the pass so krykna run in (finding 5).

**#6.** A chimney should climb: give it a rise (successive floor slabs up 2 m
each along its length), or rename it.

---

## The Storm Docks (`trask`): 8 beats, 1 stage, 468 m, 49 posted

Rhythm: O O C I I O C O. Beat for beat and link for link it is the Ringworld
(finding 1). Every outdoor zone is walled on four sides by 34+6 m warehouse
ridges, so the harbour is never seen (screenshots `trask-s0-z1`, `z5`).

| # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|
| 0 | the quay steps | open:start | 60×40 | KEEP | Shed and skiff landmark; open the sea side |
| 1 | the fish market | open:camp +skiff | 44×40 | REWORK | Designed as an 8 m pier over the sea; built as the standard 44×40 box; skiff goes nowhere |
| 2 | the net lofts | canyon:assault deadEnd | 12×46 | MERGE | The fifth deadEnd canyon assault in the game |
| 3 | the freighter hold | hall:assault barrels | 28×24 | KEEP | Barrels; the one interior fight |
| 4 | the cold stores | hall:lieutenant | 30×26 | MERGE | Second sealed room in a row; move the officer outdoors |
| 5 | the trawler deck | open:assault ×3 | 52×44 | KEEP | Trawler landmark; the Squall section is planned to replace it |
| 6 | the pier heads | canyon:camp | 10×50 | REWORK | Should be a pier with water both sides |
| 7 | the mamacore pool | open:warlord pit | 70×60 | KEEP | Pool hazard; mamacore |

**Water edges (all outdoor zones).** Add a zone-level `edges?: ('rim' |
'water')[]` (or a `pier: true` shorthand) that skips the side ridges in the
outdoor branch (`stage/zones.ts:166–176`) and lets the existing off-path water
rule (`campaign.ts:1390`) be the border. Apply it to #1 (as the pier the doc
describes: 8–10 × 70, water both sides), #5 (three sides) and #6.

**#1 skiff.** On a pier the skiff is a moving wall down the market, which was
the point (§3.5). Otherwise delete it.

**#2 → merge.** With #1 a pier, #2 is redundant. The pier can end at the
freighter's cargo door (`deadEnd` on #1).

**#4 → move the lieutenant.** Make #5 the lieutenant (the officer on the trawler's
deck) and cut the cold stores, or make the cold stores a `trek` breather. It
also removes a link (the 14 m corridor), which suits a run the sections will
later split.

---

## The Refinery (`refinery`): 8 beats, 3 stages, 378 m (the shortest), 37 posted

Rhythm: O O C ‖ I I I ‖ O O. The plant stage walks one straight 7–9 m strip
of the board's south hall (lane z = −46, `mission-layouts.ts:402`). From its
start the exit door is visible down the whole length (screenshots
`refinery-s1-z0/z1/z2`).

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A yard | 0 | the tanker yard | open:start | 60×50 | KEEP | Shrink; one pipe rack in 3000 m² of nothing |
| | 1 | the pipe run | open:camp +landspeeder | 44×40 | REWORK | Designed as a 12×60 lane between racks; the standard box; the landspeeder goes nowhere |
| | 2 | the intake ramp | canyon:assault deadEnd | 12×40 | MERGE | The deadEnd pattern again |
| B plant | 3 | the barrel stores | hall:assault | 18×18 | KEEP | The board's barrels and alarm consoles do real work |
| | 4 | the reactor floor | hall:lieutenant | 18×18 | REWORK | Not at the reactor (finding 6) |
| | 5 | the pump hall | hall:assault | 18×18 | CUT | Third identical slot of the same strip |
| C field | 6 | the reactor crown | open:camp | 50×44 | KEEP | 40 m core landmark, cache |
| | 7 | the loading field | open:warlord barrels | 70×60 | KEEP | Zillo, barrels |

**#1–#2.** Turn #1 into the lane it was designed as (`canyon:camp 12×60`,
`pipe_rack` props tiled along both walls, `deadEnd` at the intake). Drop #2 and
the landspeeder, or keep the yard open and give the landspeeder a reason (a
drive to the intake across #0). Note: Lights Out is placed *before stage C*
in the working-tree `SECTION_PLACEMENT`, while `LEVEL_SECTIONS.md` §3 says it
replaces the pipe run. Settle which before reworking #1.

**#4 reactor floor.** Re-route the plant lane. From #3 turn north through the
doorway at x ≈ −22 into the atrium (x, z ∈ ±22), and hold the lieutenant there
around the core with the three catwalk rings (`world/refinery.ts:141`) as high
ground. A `plant` stage is a straight lane in the anchor's frame, so this needs
`LinkSpec.turn` support in the bare branch, or a second anchor. It is the only
arena in the game with real verticality, and it goes unused.

**#5 pump hall.** Cut it, or make it the exit up the atrium: the "rear
airlock" as a lift on the shaft wall. That would make stage C's "reactor crown"
arrival literal.

---

## The Great Forge (`forge`): 9 beats, 3 stages, 551 m, 53 posted

Rhythm: O O C O ‖ I I ‖ O C O, the Lava Flats run (finding 1). Its
strengths are the landmarks (the dome on the skyline, the brazier, the skull).

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A plain | 0 | the glassed plain | open:start | 44×50 | KEEP | Emptiness is the personality |
| | 1 | the glass corral | open:camp +4 rides | 44×40 | KEEP | Owned rides |
| | 2 | the glass highway | road:chase | 28×78 | REWORK | 78 m (finding 3); Covert Sky planned to replace it |
| | 3 | the shattered gate | open:assault ×2 | 38×32 | REWORK | Generic door; the dome wall is not the door |
| B undercroft | 4 | the dome undercroft | hall:assault pillars | 28×24 | KEEP | Only if the Nevarro hall changes |
| | 5 | the armoury vault | hall:lieutenant | 30×26 | REWORK | Alamite lieutenant in the standard box |
| C dome | 6 | the glassed court | open:assault ×3 pass | 54×48 | REWORK | Dead pass, not a siege; Hold the Forge planned to replace it |
| | 7 | the forge steps | canyon:camp | 14×50 | REWORK | "Steps" and flat; generic pre-warlord canyon |
| | 8 | the sleeper's basin | open:warlord | 80×70 | KEEP | Skull, rides, mythosaur |

**Differentiate it from the Lava Flats.** The corral → road → gate opening can
stay in one of the two runs, not both. Once the sections land, both roads are
replaced (Magma Run, Covert Sky) and the difference comes for free. Until
then, give the Forge a `canyon` stage A like the Dune Sea's, a glassed valley
closing onto the dome's breach, instead of rimmed boxes.

**#3.** Set the transport door into a `ruin` wall with dome-rib props so the
door is "the vault door in the dome wall" (§3.7).

**#6.** If Hold the Forge is not imminent, make this the Forge's siege, with the
pass fixed so alamites run in. It is already 54 m of open ground with a landmark
at its centre.

**#7.** Give the steps an actual rise (stepped floor slabs) toward the basin rim.
Walking *down* into the sinkhole is the reveal for the mythosaur.

---

## The Ringworld (`ringworld`): 8 beats, 1 stage, 488 m, 49 posted

Rhythm: O O C I I O C O, the Storm Docks run (finding 1). The facades and
lit windows read very well (screenshot `ringworld-s0-z5`).

| # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|
| 0 | the tram stop | open:start | 56×48 | KEEP | Tram landmark |
| 1 | the market arcade | open:camp +2 swoops | 44×40 | REWORK | Designed as a 16×80 street; the standard box; swoops go nowhere |
| 2 | the night-side row | canyon:assault deadEnd | 12×50 | MERGE | DeadEnd pattern again |
| 3 | the terminus | hall:assault crates | 28×24 | KEEP | The one hall fight |
| 4 | the sentinel walk | hall:lieutenant | 30×26 | REWORK | Enforcer in the standard box; second sealed room in a row |
| 5 | the plaza | open:assault ×3 pass | 50×44 | KEEP | Kiosks, jet pirates; fix the dead pass; no fountain yet |
| 6 | the service spine | canyon:camp | 14×60 | REWORK | Generic pre-warlord canyon; Mark Runs planned to replace it |
| 7 | the high street terrace | open:warlord | 64×56 | KEEP | Nexu |

**#1.** Author it as the street (`canyon:camp 16×80`, kiosks ×6 down both
sides as §1.7 lists), which is the Ringworld's signature shape. Then move the
swoops to the tram stop's end of it: a street is where a swoop has somewhere to
go. Tram Top is planned to replace this beat, so do the cheap version (the data
change) only.

**#2 → merge** into the street as its dead-end far end.

**#4.** Make the sentinel walk a `canyon` (a covered walkway is a lane) and
fight the enforcer in the plaza (#5 as lieutenant, siege elsewhere). The
Ringworld then has one hall, not two.

---

## The Prison Rig (`narkina`): 9 beats, 4 stages, 491 m (90 of it swum), 39 posted

Rhythm: O C ‖ S S ‖ I I ‖ O C O. The dive is the best idea in any run, but it
is not delivered.

| Stage | # | Beat | shell:encounter | size | Verdict | Reason |
|---|---|---|---|---|---|---|
| A landing | 0 | the landing deck | open:start | 56×44 | KEEP | Troop carrier; open the sea side |
| | 1 | the gantry run | canyon:camp shock | 12×60 | KEEP | Shock strips are the rig's verb |
| B sea | 2 | the kelp forest | open:trek (sea) | 40×40 | REWORK | No air clock, no cache, a stray picket |
| | 3 | the moon pool shaft | canyon:trek (sea) | 20×26 | REWORK | "Surfacing" is walking into a shed |
| C cell block | 4 | the work floor | hall:assault shock | 28×24 | KEEP | Shock plus alarm console; One Way Out planned to replace it |
| | 5 | the supervisor deck | hall:lieutenant | 30×26 | REWORK | Deathtrooper in the standard box |
| D top decks | 6 | the assembly deck | open:assault shock | 50×44 | KEEP | Beached wreck, shock plates |
| | 7 | the discharge gantry | canyon:camp | 12×50 | CUT | Repeats #1 minus the shock strips; exists only to hold the cache |
| | 8 | the moon pool deck | open:warlord pit | 66×56 | KEEP | Kwazel maw from the pool |

**#2–#3 the sea.** The stage's links get pickets like any other, so one ranged
trooper stands on the seabed (measured: 1 posted). Skip `defenders` when
`stage.kind === 'sea'` (`campaign.ts:363`). Put a bacta pickup inside the sunken
transport. The link-bacta rule (`stage/links.ts:153`) gives this stage none.
The air clock ("air is the clock", `mission-layouts.ts:562`) does not exist. Either
build a breath meter or stop claiming it; a 90 m swim with nothing in it is a
dead walk. Both transport doors on this stage are free-standing sheds on the sea
floor, because a `bare` stage gets no door face (`stage/doors.ts:61, 133`,
screenshot `narkina-s1-z1`). Implement the planned `PortalKind` `dive` and
`surface` variants: a floor hatch into the water at the gantry's end, and a lit
pool ring you swim up into.

**#7 → cut.** Let the Fennec cache drop in #6 after it clears (the rule at
`campaign.ts:909` would need to accept an assault), or place it in the warlord
arena's entry. That shortens the one four-stage run.

**Water edges** as for the Storm Docks: #0, #6 and #8 are "the sea on two sides"
in the design and white boxes in the build.

---

## Cross-cutting issues

### The repeated patterns, counted

| Pattern | Where | Count |
|---|---|---|
| `hall:assault 28×24` → corridor 14+12 → `hall:lieutenant 30×26 pillars` | station, nevarro, crevasse, trask, forge, ringworld, narkina (refinery: 18×18 variant) | 8/9 |
| `canyon:camp 10–16 × 50–60 alcove` immediately before `open:warlord` | nevarro, crevasse, trask, forge, ringworld, narkina | 6/9 |
| `open:assault 50–54 × 44–48 waves 3` as the last big fight | nevarro, crevasse, trask, forge, ringworld, narkina | 6/9 |
| `canyon:assault 10–12 × 40–50 deadEnd` straight after a camp | desert, crevasse, trask, refinery, ringworld | 5/9 |
| `open:camp 44×40` (identical size) | desert, nevarro, trask, refinery, forge, ringworld | 6/9 |
| corral → road → gate assault opening | desert, nevarro, forge | 3/9 |
| lieutenant indoors | all but desert | 8/9 (the design said about half) |

The fix is not more beat kinds. It is using the ones that exist differently per
board: move three lieutenants outdoors (nevarro, trask, ringworld; one word each
in the spec), give each run one signature constrained beat instead of the
deadEnd canyon (a pier, a street, a pipe lane, a ravine), and let the pre-boss
breather be a different shell per board: an open `trek`, a climb, a pier.

### "Alcove" means two different things

In a hall, `alcove` cuts a real 4.8 × 3.4 m niche with bacta in it
(`stage/zones.ts:107–114`). Outdoors it only puts a canister against the side
wall at mid-length (`stage/zones.ts:250–252`). Thirteen outdoor zones set it.
Either cut a notch in the rim at that spot (the "side crack" the spec comment
promises) or rename the outdoor flag `bacta`.

### Guidance

- Outdoor assaults: say "Hold ⟨zone⟩" without "Sealed in", and hide the wave
  count unless `supplied(zone.spec)` (`campaign.ts:769, 948`). Rename
  `waves` to `garrison` (or read `waves` only when `siege`) so authors stop
  expecting waves.
- Pass notches: until runners work, remove `pass` from the three non-siege zones.
  When fixing, put the runner post *inside* the notch at u = l − 2 so
  `fits()` passes, and lay a floor stub behind it on built stages.
- Camps: the promise "clear it, or slip through" needs posts that leave a
  route. Post camp garrisons across the middle third at |v| ≥ 0.3 w with a
  gap on one flank (a `postSide` field, or a camp-specific post list in
  `stage/zones.ts:293`), and let the exit be touched from the quiet side.
- The beacon, marker, arrow and trail posts work. The arrow fix and the
  "reached stays reached" rule are sound. The screenshots show the marker and
  pillar readable in every zone except the dark Lava Flats.

### Checkpoints and respawn

- Arrival checkpoints are right. The trouble is that the zone at the arrival point
  is often a live fight (finding 2). The fix: `starts` behind zone 0's entry, and
  `backPortal.close()` while `phase === 'fight'` in zone 0, with the back
  portal reopening on clear (`campaign.ts:1200`).
- Fight respawn is 4 m before the zone entry (`campaign.ts:825`). For zone 0 of a
  stage that point is inside the back portal's pocket mouth (u = −1.6; the
  pocket spans −6..−1). It does not trigger the exit, but a respawned player stands
  in a doorway. The vestibule fix above removes this too.
- The 80 m frozen gallery and the 60 m canyons checkpoint only at entry. A
  mid-zone checkpoint (as roads get at their marks) would help once camps are
  longer after the merges above.

### Pacing

| Run | Beats | Stages | Path (m) | Posted at raise (1p) | First contact (est.) |
|---|---|---|---|---|---|
| desert | 10 | 3 | 731 | 64 | picket ~53 m in |
| station | 8 | 3 | 389 | 40 | ~40 m |
| nevarro | 9 | 3 | 531 | 49 | ~57 m |
| crevasse | 8 | 2 | 558 | 45 | ~60 m |
| trask | 8 | 1 | 468 | 49 | ~48 m |
| refinery | 8 | 3 | 378 | 37 | ~60 m |
| forge | 9 | 3 | 551 | 53 | ~60 m |
| ringworld | 8 | 1 | 488 | 49 | ~57 m |
| narkina | 9 | 4 | 491 | 39 | ~53 m |

First contact is always a link picket 40–60 m in, which is fine. Every link of
12 m or more carries pickets (`stage/links.ts:103`), so there is no quiet
stretch anywhere after the trailhead. That includes the sea and the approach to
every boss. One deliberate breather per run (a `trek` with lookouts, which is
implemented and used nowhere) would reset tempo better than another camp.
The Refinery and the Spice Run are half the Dune Sea. The merges above shorten
four runs by one beat each, so the Spice Run and the Refinery especially need
their sections, or the plates and atrium work, to carry weight.

### Co-op (1 vs 4)

- Raise the outdoor-assault cap with player count (`Math.min(10 + 2 ×
  players, …)` at `campaign.ts:349`) and lower the solo base. Thirteen posted
  bodies against one player on the trawler deck is the harshest fight in the game.
- Camps: base the cap on `posts.length + players` rather than `+ 2`
  (`campaign.ts:318`), and add posts where a narrow canyon validated only 3.
- `allInside` seals: after 8 s with most of the party inside, re-form stragglers
  at the entry (the respawn animation exists) rather than waiting forever.
- Rides: park `players + 1` in every corral (nevarro needs one more). Check the
  riders rule leaves at least `players` rides unclaimed.

### Continuity at transport doors

| Door | Leave by | Arrive at | Verdict |
|---|---|---|---|
| desert A→B | gorge door in the cliff | door in the ravine rock | good |
| desert B→C | court's far wall (the "airlock") | door in a rock face, *inside the lieutenant arena* | fix the arrival |
| station A→B | the hull facade | hall wall | good |
| station B→C | hall wall | a shed on a floating deck | face it with hull |
| nevarro A→B | a steel door in basalt at "the town gate" | hall wall | use the adobe gate |
| crevasse A→B | glacier door | hall wall ("the deep" is steel) | fix the materials |
| refinery A→B / B→C | intake door / south-strip door | plant strip / 90 m up at "the crown" | acceptable; the atrium route fixes the crown |
| forge A→B | a door in a ruin rim, not the dome | hall wall | use the dome wall |
| narkina A→B→C | a door (should be a dive hatch) / a shed on the seabed (should be surfacing) | shed / hall wall | build the dive and surface portals |

### Doc drift

`MISSIONS_OUTDOOR.md` §3 no longer describes the build. It still has the pier fish
market, the 16×80 arcade, the 12×60 pipe run, the three-plate gantries, the lava
trench, the traction disc, the egg sacs, the adobe gate door, the dive hatch, 70×60
trailheads, 140–180 m roads, the ceilings table (§3.10 says 30/45…, code
38/60…), and "Crevasse stage A is a territory" (it is `built`). It also lacks
the cantina row and the discharge gantry. `RIDE_MIN_SIDE` is 40 in code
(`stage/common.ts:40`) against 56 in §1.8 and §7. Either update §3 to the
layouts or head it "plan, see mission-layouts.ts".

---

## Recommendations, prioritised

| # | Change | Where | Effort |
|---|---|---|---|
| 1 | Close the back portal during a zone-0 fight; start each stage behind zone 0's entry (vestibule), so no stage opens inside a sealed room or a boss arena | `campaign.ts:1200`, `stage/finish.ts:35`, layouts (desert C) | S |
| 2 | Outdoor-assault messaging: no "Sealed in", no "wave 1 of 1" unless supplied; rename `waves` on non-siege zones | `campaign.ts:769, 938, 948`, `mission.ts` | S |
| 3 | Fix or remove `pass`: runner post inside the notch plus a floor stub, or drop it from the dune gate, glassed court and plaza | `stage/zones.ts:180–183`, layouts | S |
| 4 | Cache rule: look back to the stage's last walked zone before a boss (gives the Spice Run its cache; lets the Prison Rig's #7 go) | `campaign.ts:909–912` | S |
| 5 | Floor texture per shell, not per stage (desert court, the whole Crevasse deep) | `stage/builder.ts:111`, `stage/zones.ts` | S |
| 6 | Merge the redundant deadEnd canyon assaults into the camp before them (desert #4, crevasse #2, trask #2, refinery #2, ringworld #2); cut refinery #5 and narkina #7 | `mission-layouts.ts`, `text.ts` rooms | S (data), plus test updates |
| 7 | Move three lieutenants outdoors (nevarro, trask, ringworld); put a `trek` or corridor breather between the hall assault and the hall lieutenant elsewhere | layouts | S–M |
| 8 | Camp posting that leaves a flank, so "slip through" is real | `stage/zones.ts:293–297`, `campaign.ts:318` | M |
| 9 | Roads: marks called ahead, a swoop pack at chase start, 4th bike on Nevarro; or accept the sections replace them and cut the roads when they land | `campaign.ts:921, 1496–1535`, layouts | M |
| 10 | Water edges for Storm Docks and Prison Rig outdoor zones (pier, trawler deck, rig decks) | `stage/zones.ts:166–176`, `ZoneSpec` | M |
| 11 | Refinery lieutenant in the reactor atrium (plant-stage bend) | `stage/zones.ts` bare branch, `stage/links.ts`, layouts | M |
| 12 | Spice Run deck plate chains; no hull ridges on deck links; hull face on the stage-C arrival | `stage/zones.ts:122–131`, `stage/links.ts:46`, `stage/doors.ts:61, 89` | M |
| 13 | Sea stage: no pickets, a wreck cache, `dive` and `surface` portals, an air meter (or drop the claim) | `campaign.ts:363`, `stage/doors.ts`, player/HUD | M–L |
| 14 | Co-op scaling: outdoor cap by player count, camp cap by posts plus players, straggler re-form on seals | `campaign.ts:318, 349, 1429` | S–M |
| 15 | De-template the pairs: give the Forge a canyon opening; author the Ringworld arcade as a 16×80 street; Nevarro's causeway with lengthwise lava; the Crevasse cavern roof and traction disc | layouts, `stage/dressing.ts`, `stage/canyon.ts` | L (across runs) |
| 16 | Bring `MISSIONS_OUTDOOR.md` §3 in line with the layouts | docs | S |

Items 1–5 are small, safe and fix things a player trips over on every run. Items
6–7 are the cheapest cure for sameness and should be done before the sections
land, so the sections are inserted into runs that already differ.
