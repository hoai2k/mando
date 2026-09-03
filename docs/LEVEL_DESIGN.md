# Mission Level Design — strategy & per-territory layouts

How a territory becomes a Gauntlet-length liberation run. Companion to
`docs/MODES.md` §4; this file is the level designer's side of it. Rewritten
2026-08-30 when the waypoint-tour design (a path laid over the open wave
arena, watched through one shared camera) was replaced by purpose-built
mission levels and per-player cameras.

> **2026-09-03 — superseded in part.** The *shape* of the level described in
> §2–§4 (eight walled rooms, roofed corridors, doors on every seam) is being
> replaced by the outdoor zone design in `docs/MISSIONS_OUTDOOR.md`: open
> ground bounded by terrain, ravines, an interior hallway beat behind a door,
> a per-board flight ceiling, and layered guidance. The rules in §1, §5, §6
> and §7 carry over unchanged. Read that document first.

## 1. The research, and what it demanded

- **Gauntlet (2014/Slayer).** Chapters run 8–12 minutes as a chain of
  hand-shaped chambers; its signature floor type is the **arena room** —
  waves keep coming until the room is cleared, often from spawners at the
  walls — and its co-op holds together because the chamber walls hold the
  party together. Rooms are contained; the way forward is never in doubt.
- **Minecraft Dungeons.** Levels are authored room chains along one golden
  path: wide pockets for fights, pinches between them, landmark rooms so
  players feel their progress, and lockdown encounters that seal an area
  while its mobs pour in. It *dresses* the path as terrain, but the
  underlying structure is rooms-and-connectors, not open world.

The v1 campaign laid a waypoint tour over the territory's open wave arena.
It technically had pockets and pinches, but the player experience was the
open arena with a to-do list: no containment, fights bled into each other,
and the "corridors" were teleports to a separate volume. The lesson from
both references is that the *feel* comes from walls — contained areas the
fight cannot leave, pinches that reset the tempo, and a chain you walk in
one direction. So Missions now builds exactly that.

## 2. The mission level (`world/mission.ts`)

One territory = one authored **room chain**: 8 rooms joined by 7 corridor
links, built from a per-territory `MissionSpec` (sizes, bends, palette, set
pieces) and raised ~90 m over the territory — the altitude trick the old
corridor segments proved out — so the level keeps the board's sky, fog,
ambience, gravity, traction and wave tables while getting clean, flat,
intentional geometry on every board. Rooms are open-roofed (the territory's
sky is the ceiling; jetpack verticality stays); corridors are roofed and
low. Everything is walked — no teleports, one continuous path.

Room templates, alternating along the chain:

- **start** — the trailhead. The party spawns here; no fight.
- **camp** — a posted garrison under the normal awareness rules, standing
  among cover crates in the room's far half. Fight it or slip through: the
  room clears when someone reaches the far gate, and blaster fire travels,
  so the loud way compounds. No lockdown.
- **assault** — the Gauntlet arena floor. Crossing the threshold seals both
  doors and runs **2–3 waves**, each alerted the moment it lands. The vents
  along the walls choose *where* a squad ends up; how it gets there is a
  carrier pass overhead (`src/enemies/arrival.ts`), exactly as in the wave
  game — the rooms have walls but no roof, so the same drop works, and a
  squad descending into the room reads as reinforcements being committed
  where bodies standing up beside the wall read as a spawn. The room is not
  clear while a transport still holds its wave. The doors release on the last body; the wave counter rides
  the HUD hint. **The seal waits for the whole party** — it is the same door
  everyone walks in through, so sealing on the first body inside locked the
  rest out of their own boss fight. The dead are not counted: they come back
  at the checkpoint rather than walking in, and a wipe would otherwise stall
  the level for good.
- **champion / warlord** — the boss arenas (MODES.md §4a), mid-chain and
  final. Gates seal for the battle; on monster boards the warlord's arena is
  sized (up to 40×34 m, walls raised) for the second-stage monster that
  erupts where the warlord fell.

Rules layered on the chain:

- **Ramp by place, not time.** Room *i* of *n* draws squads from the board's
  wave table at wave `1 + round(6 · (i−1)/(n−2))`; an assault room's later
  waves draw one wave deeper each. Trailhead rooms post wave-1 grunts, the
  last stretch posts the board's elites, and the newest kind in the table
  always makes the room's mix.
- **One beacon.** A light pillar + radar pip + HUD distance marks the single
  next objective: the next room's entry gate on the move, the exit gate
  during a fight, the boss himself in an arena.
- **Checkpoints are earned ground.** Entering a room checkpoints its entry;
  clearing it checkpoints its far end (never a set piece's centre — the pit
  room taught that). Death respawns there after 4 s; going over a wall or
  off the level teleports you back to it.
- **A pickup economy, small on purpose.** Bacta canisters (+45 HP) sit in
  wall alcoves off two rooms per level (the reward for poking into corners)
  and midway down every other corridor (the attrition beat pays for itself).
- **Set pieces are per-territory** (§4): a kill-pit maw, lava or shock
  channels with a narrow safe bridge, explosive rhydonium barrels seeded in
  the fight, hard-cover pillars, extra crate cover.

## 3. Corridors — the pinch

Links between rooms are 5–6 m wide crate-lined legs with **at most one 90°
bend** through a small junction, 12–18 m per leg, 3.8 m ceiling. A staggered
pair of crates sits **butted flush against the walls** — flush matters: a
crate floating off the wall leaves a gap too narrow for a body, and that
pocket catches anyone hugging the wall (the walkthrough audit wedged in it
until the geometry was fixed). Ranged defenders post behind the crates
facing the entrance; the loop is *tuck, peek, drop one, advance*. Door
frames stand in both mouths and carry the energy gates. The low ceiling
makes the jetpack a hop, not a route — the cover button's classroom, exactly
as before, just walked into instead of teleported into.

## 4. Per-territory layouts (`MISSION_LAYOUTS`)

All nine share the chain grammar; what changes is palette, corridor width,
bend pattern, set pieces, room proportions and the labels the banners use.
Every room label is authored (— "the cistern court", "the warden bridge") so
the HUD reads like a place, not a quest log.

| Territory | Shape & set pieces | Warlord arena |
|---|---|---|
| Dune Sea | sandstone yards; a sarlacc-maw **kill pit** in the cistern court (fight around it, beacon never in it); the champion's pit is the worm's | 40×34 — the Old One erupts |
| Spice Run | dark-metal decks, 5 m service corridors; **rhydonium barrels** in the spice vault | 34×30 — the mudhorn |
| Lava Flats | basalt; **lava channels** with a centre bridge cross two rooms | 38×32 — the rancor pen |
| Crevasse | ice palette and **0.55 traction** over the whole footprint; ice **pillars** in two rooms | 36×32 — the ravinak |
| Storm Docks | plank-and-iron docks; barrels in the cold stores | 38×32 — the mamacore pool |
| Refinery | tightest chain: 5 m corridors, a bend in every link, **barrels** twice | 34×30 — the specimen |
| Great Forge | glassed stone; ruin **pillars** in two rooms | 40×34 — the mythosaur |
| Ringworld | long straight avenues (rooms elongated along travel, links up to 18 m) for the street feel | 34×30 — the nexu |
| Prison Rig | white panels, 5 m corridors; **shock floors** in two work halls | 34×30 — the moon-pool thing |

## 5. Readability rules (the Gauntlet lessons, kept)

1. **One beacon.** Never two objectives on screen; the pillar reads over
   walls and through fog.
2. **Distance on the HUD**, not a map. `— 42 m` under the objective name is
   enough to know "far"; the radar pip gives bearing.
3. **Doors are doors.** Every doorway carries a real blast door: two leaves
   that part down the middle over 0.75 s, in a frame trimmed in the
   territory's accent colour. Shut is the resting state and shut means shut —
   the leaves fill the whole full-height opening, not just the frame's 3.6 m,
   and the blocker stands until they have actually cleared the way, so a door
   is never passable while it still looks closed and nothing is ever shot
   through one. What opens them is progress: rooms behind the party stay
   open, the room being approached opens the door you walk in by, a camp
   keeps both open because it never seals, and everything ahead stays shut —
   which is what stops a fight three rooms away being sniped from a corridor.
   Their animation is driven outside the match's `fighting` state, so a door
   caught mid-slide by a boss intro or a victory card does not freeze there
   holding its blocker.
4. **Fights end audibly.** The wave-clear chime plays when an assault room
   opens; camp rooms confirm quietly.
5. **The path never doubles back.** The chain is one-way in spirit: cleared
   rooms hold nothing new, and the trim skirting along the walls points the
   eye forward.

## 6. Cameras

Every player has their own third-person rig and viewport; Missions splits
the screen exactly like the wave game. The v1 shared centroid camera (one
screen, player 1 steering) died on contact with the room design: walls and
crates split the party out of frame, and screen-relative aim meant nobody
owned their own crosshair. Per-player cameras also mean every mechanic —
ADS, lock-on, cover peek, the boss-intro pan — behaves identically across
all three modes.

## 7. Verification

Two audits drove the geometry (and both caught real bugs — the corridor
wall notch at bends, the floating-crate pocket, the beacon standing in the
pit): a build audit (rooms don't overlap, every room keeps ≥3 validated
spawn vents, garrisons post, no hostile strands below the level) and an
**on-foot walkthrough** — a steering autopilot walking a real player through
every room, gate and bend of all nine levels to liberation with zero falls
and zero wedges. `tools/test-modes.mjs` keeps the regression: room chain
shape, sealed assault waves, boss retinue, liberation, per-player cameras.
