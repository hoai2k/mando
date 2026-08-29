# Campaign Level Design — strategy & per-territory notes

How a wave arena becomes a Gauntlet-length liberation run. Companion to
`docs/MODES.md` §4; this file is the level designer's side of it.

## 1. The pacing target, with numbers

A Gauntlet (2014/Slayer) chapter runs **8–12 minutes**: roughly 8–12 combat
pockets of 30–60 s, separated by 10–20 s of traversal, with one mid-level
set-piece and a finale. Minecraft Dungeons levels run longer (15–20 min) but
share the shape: *pocket → pinch → pocket*, with the golden path always
readable and the fights always optional-ish (you can run, but running wakes
things that follow).

Our budget per territory:

| Beat | Count | Time each | Total |
|---|---|---|---|
| Open-path fight waypoints | 6–7 | 40–60 s | ~5–6 min |
| Corridor segments (door → door) | 2 | 60–90 s | ~2–3 min |
| Traversal between beats | 8–9 gaps | 10–15 s | ~1.5–2 min |
| Boss arena finale | 1 | 60–120 s | ~1–2 min |
| **Level** | | | **~9.5–13 min** |

That lands on Gauntlet's chapter length with co-op skewing shorter (squads die
faster to four guns; enemy counts scale ×1.5 per extra player via the existing
multiplier, which claws most of it back).

## 2. The winding path

The path is generated over the board's own authored ground: the 8–12
`groundSpawns` every board already declares are the level designer's vetted
"places a fight can happen", so the campaign path is a **tour of them** —
nearest-unvisited-neighbour from the player start, which on every board
produces a winding S-curve rather than a straight march (the spawns were
placed to spread waves out, so consecutive nearest hops naturally zig-zag).
Rules layered on the tour:

- **Ramp along the path.** Waypoint *i* of *n* posts a squad drawn from the
  board's wave table at wave `1 + round(9 · i/(n−1))` — trailhead squads are
  wave-1 grunts, the last stretch posts the board's elites. Difficulty is
  *place*, not time.
- **Squads are posted, not triggered.** They stand at their waypoint under the
  normal awareness rules. Fights start when you're seen or heard — a wide,
  quiet route past a camp is a real (and intended) option, but blaster fire
  travels 55 m, so the loud way compounds.
- **The guide never marks enemies.** A light-pillar beacon + radar pip + HUD
  distance marks the *next waypoint only*. Exploration feel comes from what
  the beacon doesn't tell you: what's between you and it.
- **Checkpoints ride the path.** Reaching a waypoint makes it the respawn
  point, with the wave-clear chime and a banner so "safe" is announced. No
  lives economy in v1.
- **Encounter templates alternate** (the Gauntlet/Dungeons standard —
  identical pockets go flat by the third one): *camp* nodes post their squad
  under the normal awareness rules; every third node is an *ambush* — its
  squad springs from the surrounding ground at ~24 m with a hard alert and an
  "Ambush!" sting. The node after each corridor carries no squad at all: a
  breather beat, so the corridor's pressure has somewhere to land.
- **A pickup economy, small on purpose.** Bacta canisters (+45 HP) sit in
  every corridor pocket — the attrition beat pays for itself — and one hides
  ~9 m off the golden path every third node, the standing reward for
  wandering that both references teach. Keys/food economies stay in the
  expansion list.

## 3. Corridors — the cover beat

Twice per level (after roughly ⅓ and ⅔ of the waypoints) the beacon leads to a
**door**. Doors teleport the whole party into a corridor segment: a
procedurally assembled interior lane, built high above the territory so it
reads as its own space (and so the door remains the seam where real streaming
can later slot in — see MODES.md expansion §2).

Corridor grammar (each segment rolls its own from these pieces):

- **Lane**: 6–8 m wide, 55–80 m long, 2–3 bends (left/right alternating), 4 m
  ceiling. Bends break sightlines so each leg is its own micro-encounter.
- **Cover rows**: chest-high crates in staggered pairs every 8–12 m, usable by
  both sides — the enemy cover AI (`findCover`/peek/suppression) is the whole
  point of the beat, and the player's snap-to-cover faces it.
- **Pockets**: 1–2 wider rooms (12×14 m) mid-lane with a crate cluster —
  the "advance under fire" set-piece, 2 squads posted.
- **Defenders**: ranged kinds only (the board's shooters — troopers, pykes,
  pirates; flametroopers on Imperial boards as the push-punisher), posted
  *behind* cover facing the entrance. One squad per leg, one per pocket:
  ~8–12 defenders per corridor.
- **Exit door** at the far end returns the party to the surface at the next
  waypoint. Doors close behind you (no backtracking through a cleared
  corridor; keeps pacing forward, avoids stale-post edge cases).

Design intent: corridors invert the open field. Outside, the jetpack and the
dash rule and cover is optional; inside, the ceiling is low (jetpack is a
hop, not a route), the lane is enfiladed, and the loop is *tuck, peek, drop
one, advance*. Ten seconds of it teaches what the cover button is for.

## 4. Boss arena

The last waypoint sits in the board's most arena-shaped spot (widest clear
radius among the spawns — computed, not hand-tagged). The territory's boss
(MODES.md §4a) posts there with a 3-strong honour guard; the beacon walks you
in. Phase reinforcements spawn on the arena rim at ⅔ and ⅓ HP so the fight
sweeps outward, not into a corner. Death mid-boss respawns at the previous
waypoint — the walk back is the retry cost.

## 5. Per-territory notes (what each board's path leans on)

| Territory | Path character | Corridor flavour | Boss |
|---|---|---|---|
| Dune Sea | dune crests and rock arches; sarlacc as a path-adjacent hazard the beacon skirts | moisture-farm cellars (sandstone kit) | Wookiee enforcer |
| Spice Run | platform-to-platform; the jetpack *is* the traversal beat, corridors are the respite | station service decks | Pyke capo |
| Lava Flats | path crosses the crust bridges; geysers as free altitude at two waypoints | gate blockhouse | Imperial officer |
| Crevasse | descends rim → ledges → canyon floor and climbs back; ice traction on legs 3–5 | ice tunnels (krykna nests: melee corridor variant — swarm instead of shooters) | Broodmother |
| Storm Docks | finger-to-finger with two trawler-mover crossings; mamacore timer discourages swimming the gaps | fish-hold below decks | Pyke capo |
| Refinery | already interior: the "open" beats are the reactor shaft ring, corridors are its own halls (most corridor-native board) | rhydonium galleries (breakable barrels seeded in cover rows) | Imperial officer (darksaber) |
| Great Forge | storm cycle gates the open legs — move on the calm, fight under cover in the storm | dome undercrofts | Wookiee enforcer |
| Ringworld | street runs with the terminator: night-side legs favour sneaking, tram as a moving waypoint | maintenance spine under the street | Gunslinger |
| Prison Rig | deck hops over live floors; one leg dives the moon pool (the stealth showpiece) | white cell blocks (Narkina look, electrified-floor pocket) | Imperial officer |

v1 generates all of this from each board's existing data (spawns, hazards,
movers, wave tables) with one shared generator; the table above is the tuning
guide for the per-board passes that follow playtesting.

## 6. Readability rules (the Gauntlet lessons, kept)

1. **One beacon.** Never two objectives on screen; the pillar is tall enough
   to read over dunes and through fog.
2. **Distance on the HUD**, not a map. `142 m` under the objective name is
   enough to know "far"; the radar pip gives bearing.
3. **Doors glow.** A door-waypoint's beacon sits *on* the door; the door
   frame carries its own emissive trim so the last 20 m needs no beacon.
4. **Fights end audibly.** The existing wave-clear chime plays when a
   waypoint's squad dies, marking "safe to move" without any UI.
5. **The path never doubles back through a cleared pocket** — the tour visits
   each spawn once, corridors are one-way, and the boss arena is terminal.
