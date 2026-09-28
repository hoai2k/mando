# Prison Rig — The Lift, One Way Out, and K2 (the treadmill)

Branch `claude/sections-narkina`. Owner of `src/sections/the-lift.ts`,
`src/sections/one-way-out.ts`, `src/sections/kit/treadmill.ts`,
`tools/test-section-treadmill.mjs`, and the `one-way-out` / `the-lift` blocks in
`TEXT.sections`.

## State

| Piece | State |
|---|---|
| **K2 treadmill** (`kit/treadmill.ts`) | Built, general, tested (`tools/test-section-treadmill.mjs`, 29 checks). |
| **The Lift** (`the-lift`) | Built, registered, placed before stage D. `test-sections` passes at 1, 2, 4 players (≈125 s simulated). |
| **One Way Out** (`one-way-out`) | Built, registered, placed before stage C. `test-sections` passes at 1, 2, 4 players (≈22–30 s simulated with the suite culling hostiles; 90–150 s with them alive). |

Both registered in `sections/index.ts` and `sections/ids.ts` (`BUILT_SECTIONS`,
`SECTION_ASSETS`). Placement was already in `SECTION_PLACEMENT`.

Tested with `CHARS` default (din, maul, armorer, jedi), `CHARS=maul` solo (a
super-jumper alone) and `CHARS=bokatan,revan,ventress,paz` at four.

## K2 — the treadmill

`new Treadmill({ dir, speed?, ease?, board? })`. `dir` is the way the *world*
moves past the platform (down a shaft for a rising lift, astern for a barge).
The platform itself is ordinary static colliders and never moves.

- `setSpeed(v, secs = ease)` — an S-curve (smoothstep) between speeds. A stop
  (`stop()`) is the design's two-second deceleration and covers v·T/2.
- `stopAt(odometer)` — come to rest with `travelled` exactly on a mark. It
  starts the deceleration when there is just room (shortens it if there is
  less) and lands the last centimetres exactly. This is what makes a landing
  stop dead level; Tram Top's station stop and the Barge Run's grounding want it.
- `strip(tex | () => tex, { metresPerRepeat, axis, sign, factor })` — a
  surface whose texture slides. The getter form lets a texture that has not
  landed yet be scrolled once it has.
- `conveyor(obj, { behind, loop?, factor?, boxes?, onRecycle?, onPass? })` —
  a thing carried by the world. With `loop` it is recycled upstream (`laps`
  counts); without, `onPass` fires once and it is retired. `boxes` become one
  `Mover` (first box the envelope, the rest carried) registered on
  `board.movers`, so bodies on it are carried by the game's rider carry. A
  recycle or a `place(s)` jump zeroes the mover's delta, so nobody is flung
  the length of a loop. A stopped treadmill still re-places its movers every
  frame, so their delta goes to zero rather than going stale.
- `parallax(obj, factor, loop)` — a far layer at a fraction of the speed.
- `spawnAhead(dist, at?)` — a point `dist` upstream of `at`, carried in:
  `pos`, `remaining`, `eta`. Place what must *arrive* there.
- `travelled` — the odometer the section hangs its beats on.
- `dispose()` takes its movers off the board (the context owns the colliders).

Order of a frame: the campaign ticks the section (so the treadmill) *after*
`Game.carryMoverRiders`, so riders are carried by the previous frame's
travel, one frame late. At 2 m/s that is 7 cm and invisible; at the Barge
Run's 14 m/s it is 47 cm of lag on a fast mover, so if it shows there, the
fix is to tick the treadmill from `board.update` (which runs before the
carry) rather than to touch the engine.

For the next wave: the barge/skiff decks, the frigate hull and the tram roof
are static; the dune strip, the starfield and the city are `strip`s and
`parallax` layers; enemy skiffs, the corvette and station platforms come in
on `spawnAhead` or as `conveyor` items with `boxes`; `stopAt` for any stop.
The Lift is the worked example.

## The Lift (`the-lift`)

Continuity: the supervisor deck's far door is the lift. The section opens on
the platform with that door behind the party — landing "C", level with the
platform, blast doors shut — and it slides away below as the lift starts. It
ends when the shaft's mouth comes down to the platform under the open sky of
the top decks: a deck ring round the mouth, a crane, the sea far below, and
the rig's superstructure across the far side with the **deck gate** in it
(the transport door onto stage D's assembly deck).

Plan: 12 × 12 m platform (rails on the west and pylon sides, open on the
landing side and the far side), shaft wall 4 m back from the open far edge
(camera room, per the design), 3 m behind the rails, 7 m on the landing side
where each landing's 4.5 m deck leaves a 2.5 m gap. 200 m of travel at 2 m/s.

How it plays:

1. **First stretch (0–75 m).** A landing every 25 m. Its squad is posted
   when it is 16 m above (so they fire down as it comes), alerted inside ±9 m,
   and one or two jump across when it is level. A jet-trooper drop now and
   then (troopers ride their packs down onto the deck, plumes and all).
2. **Power cut 1 (75 m).** `stopAt(75)`: the landing is exactly level. Its
   squad is bigger, a drop comes in, and the breaker on the landing's wall
   takes a 4 s hold (3 s solo). Then the lift restarts and the HUD counts the
   five seconds to get back aboard; after that anyone still on the landing is
   re-formed on the platform (and the landing going down would take them
   off-path anyway).
3. **Second stretch (75–150 m).** Debris starts (1.5 s growing shadow, 34
   heavy damage), drops come every 18 s.
4. **Power cut 2 (150 m).** Deathtroopers in the drop.
5. **Last stretch (150–200 m).** Drops every 13 s, and jet troopers that stay
   up and circle the shaft (the jetpack pirate's kit in trooper plate). The
   gate squad (an officer and deathtroopers/troopers) takes the top deck 30 m
   before the lift arrives and fires down the shaft.
6. **Breakout.** `stopAt(200)`, a bridge plate runs out to the deck, and the
   gate opens when the gate squad is down. Through it is the end.

Tuning and why:
- Landing squads 1–5 (1 + stretch + party/2), cut squads 2 + stretch + party
  (≤ 7): the first playtest shots had 19 hostiles alive at the second cut
  because guards on passed landings kept fighting from far below. Now a
  landing's guards leave with it 12 m under the platform (`behind: L + 12`),
  and the count sits at 1–6.
- Drops 30 / 18 / 13 s apart by stretch, 1–3 bodies; solo gets one fewer
  from the second stretch.
- Gate squad 2 + party (≤ 7) plus the officer; it was 3 + party and downed
  the solo bot as the lift arrived.
- The platform holds 4 comfortably; that is the design's "tight defence".

Falling off an open edge or riding a landing down past 8 m under the deck is
off-path: re-form on the platform. Death: re-form on the platform. The lift
is the checkpoint and only goes up.

Assets: the platform's visuals are the stand-in for `freight_lift` (12 m,
origin at the deck's centre, a `pylon` node), colliders kept separate. Walls
wear `shaft_wall` when it lands and `panel_white` until then
(`tilePreferred`, exported from `the-lift.ts`).

## One Way Out (`one-way-out`)

Continuity: stage B's last beat is the swim up the moon pool shaft. The
section opens with the party standing round the moon pool's opening in the
floor of the cell blocks (water, a ladder, a lit coaming), on a 4 m apron that
is never live. It ends in the stair core, a white stairwell climbing north out
of sight to the work floor, where stage C begins.

Plan: hall 48 × 36 m, roof 10 m. 12 × 8 grid of 4 m shock tiles (the apron is
the ninth row). Six cell blocks (B1–B3 west, B4–B6 east) behind barred
shutters, each with a release panel. Gantries 6 m up round the west, east and
north walls, with a lit gap in each gantry's rail where you come up to its
**control desk**. Four gantry doors (red-lit) that guards come in by. The
stair core in the north wall, framed with lit jambs and a STAIRS sign.

How it plays:

- **The grid.** Patterns: a two-row band sweeping from the pool to the
  stairs, a flipping checkerboard, a ring closing in from the walls, and
  column bands sweeping west to east (the last two only once a block is
  open). Each step telegraphs 1.5 s (pale pulsing blue), then is live 2.2 s
  (dark glass under arcs), with a 2.6 s rest between patterns; solo stretches
  every timing by 1.35. Live: 13 damage every half second (11 solo) and a
  0.6 s snare to a player; 22 to a guard. In the air over a tile you are safe.
- **Desks.** Each desk runs a third of the floor (west cols 0–3, north cols
  4–7, east cols 8–11). **A desk cannot be taken while its gantry's guards
  stand within 11 m of it** ("fight up to it"; the HUD says so). Hold 4.5 s
  (3.5 solo). Its third goes dead for good, and the rig answers with a squad.
- **Blocks.** Hold 2 s at a panel: the shutter lifts and 4–5 prisoners come
  out (5 at three or four players). The first opening starts the pressure.
- **Prisoners.** Allies on the escort AI (team 0): unarmed brawlers following
  the nearest player. A guard who dies drops his rifle; the nearest
  empty-handed prisoner within 16 m runs for it and fights as a rifleman
  after (7 damage, 2-bolt volleys). **A prisoner will not step onto a
  charging or live tile**, so if you fly across live floor the crowd waits at
  the edge: walk them a quiet path. When the floor lights up *under* them they
  scramble for the nearest quiet tile after a 0.35–1.15 s reaction. First
  pass had them walking after the player onto live tiles and the floor killed
  almost all of them; this is both readable and what "the path you take is
  theirs" means.
- **Pressure.** From 14 s after the first block, guards keep coming through
  the door furthest from the party, every `max(12, 24 − 0.6·headcount)` s
  (×1.25 solo), 1 + headcount/7 + party/2 of them, capped at 4 + 2·party
  alive. The bigger the crowd, the harder the rig pushes.
- **Climax.** Two desks (one solo) open the stair core. The floor overloads
  (patterns 1.25× faster), and the guards' last squad — troopers,
  deathtroopers and an officer — comes down the stairs and holds the
  stairwell. The way out counts once that squad is down and a player steps
  into the core. The headcount then (living prisoners within 22 m of the
  stairs) is announced as the score; ten or more gets the "they hold the
  stairs" line.

Respawn: beside a living player who is standing, else at the pool. The
design says "re-form at the entry"; §0.4 says forward with the party, and the
hall is small, so the party wins and the pool is the wipe case.

The prisoner stand-in (temporary, by request): a random mix of **Maris**
(`buildMandalorian('maris')`, `setWeapon('none')`) and **Cobb Vanth** (the
`marshal`, `buildGunfighter('marshal')`, his rifle hidden). Each is spawned as a
`pirateMelee` and re-dressed (its `char` swapped before it is added, its `def`
copied with 110 HP, 5.6 m/s, 9-damage 1.2 m punches), so no shared file
changed. Picking up a guard's rifle draws the body's *own* gun (Maris's blaster,
Cobb's rifle) rather than attaching a prop; a Mandalorian's `muzzle` is a getter,
so the gun it shows is the one its bolts leave from.

## Shared-file changes

None. `src/text.ts` changed only inside the two `TEXT.sections` blocks.
`src/sections/index.ts` and `ids.ts` got one line each per section.

## Known issues / left

- **The `prisoner` model** is not wired: `authored.ts`'s `ModelId` has no
  `'prisoner'` and that file is shared. When the model lands, add the id there
  and build the prisoner from it in `buildPrisoner` (`one-way-out.ts`),
  replacing the Maris / Cobb Vanth stand-in. The prisoner is also built on a `pirateMelee`, whose
  own sculpt starts loading on an orphaned rig and is thrown away — harmless,
  one cached fetch.
- **The 10+ bonus** is announced but does not yet reach stage C (the design
  wants the supervisor deck's lieutenant to get no reinforcements). That needs
  a flag on the campaign that stage C's lieutenant zone reads —
  `campaign.ts`, shared; left for the orchestrator.
- The autopilots are good enough to finish at 1, 2 and 4 (and to fight a
  held desk and a held stairwell), not to play well: with hostiles alive the
  solo bot loses most prisoners to gunfire. The numbers above were tuned by
  watching traces and screenshots, not by human play; the prisoner counts,
  pressure timings and desk hold are the knobs to turn first.
- The Lift's riders are carried one frame late (see K2); invisible at 2 m/s.
- `shock_tile` (floor) and `shaft_wall` (lift walls) upgrade the look when
  they land; the procedural grid texture and `panel_white` stand in.
