# Storm Docks sections — notes (team `trask`)

Branch `claude/sections-trask`, from `claude/level-design-gameplay-sections-koa6ye`.
Harness port 4218.

| Item | State |
|---|---|
| **The Squall** (`squall`, LEVEL_SECTIONS §2.9) | built; registered; suites pass at 1, 2 and 4 players |
| **K7 tilt** (`deckTilt` in `src/sections/kit/locomotion.ts`) | built; used by the Squall |
| **Run the Pier** (`run-the-pier`, §2.10) | not started: waits on K1's reversed rail camera being merged into the working branch |

## The Squall — what is built

`src/sections/squall.ts`, text in `TEXT.sections.squall`, mechanics suite
`tools/test-section-squall.mjs`.

**The two ends.** The run is cut after the trawler deck (zone 5), and that
stage leaves by its transport door in the warehouse rim. The Squall opens on
the trawler's deck just inside its shut port gangway gate. The quay is
alongside: a planked dock with the same steel doorway and white-blue
transport lamp in the warehouse wall, the gangway still hooked on and tipping
off as she casts off, and the sister trawler (`trawler` model) moored astern.
The quay opens away and falls astern in the first ~12 s. It ends when the far
pier comes out of the rain and the trawler comes alongside. The starboard
gangway gate swings open and a plank bridges to the pier. A player stepping
onto the pier completes the section, and the transport card reads "making for
the pier heads". Run the Pier will begin on that pier.

**The deck** (36 × 14 m, as the diagram): the working deck from the stern
ramp to the forecastle bulkhead (30 m). The forecastle is a 2.4 m whaleback
over the bow (stepped colliders inside a tapered hull). The deckhouse is
amidships (6 × 9 × 3 m, roof walkable) with the wheelhouse forward on it, and
the mast stands on that (lightning rod at +16 m). The king post and net boom
are just abaft the deckhouse. The trawl drum is on the after deck, winches on
both rails forward, the fish-hold coaming forward of the house, and a cargo
crate by each rail amidships. The bulwarks are 1.1 m (chest-high, so they are
cover to brace on). The stern ramp is stepped down into the water. There are
four loose fuel barrels. Rails, the ramp and the sea are the edges. Everything
solid is a level, static collider. Only the picture rolls.

**How it plays.**

- *Intro (5 s):* she casts off, the quay falls astern, "the trawler casts off
  into the storm".
- *Wave 1 — quarren up the stern ramp.* Three groups swim in astern and haul
  out onto the ramp top (the existing `swim` arrival). The swell rolls ±6°. The
  **first rogue wave comes at 24 s**, in the middle of wave 1, as the
  teaching one.
- *Wave 2 — over both rails.* The **net boom breaks loose** (its arc is
  painted on the after deck). **Lightning** starts. Quarren come over the port
  rail, then the starboard rail, then the stern, with a raider dropship pass
  onto the foredeck in between. The roll is ±8°.
- *Wave 3 — the squall's peak.* Quarren over both rails at once, jet pirates
  in from the storm, a dropship pass, the stern, and the rails again. The roll
  is ±10°, rogue waves come 25% more often, and lightning comes every 12–17 s.
  **The big one**, the biggest sea of the crossing (heel 26°, wash ×1.3), comes
  ~24 s into it. That is the climax.
- *Alongside.* When wave 3 is clear, the far pier comes in over 14 s while
  she slows and the roll drops to ±3°. Then the gate opens: step ashore.

Autopilot run length: ~176 s with hostiles culled, ~220 s with hostiles left
alive (two bots, no deaths). Real play with a party that hunts boarders
should land near the design's ~4 min.

**The rogue wave.** Every 50 / 42 / 38 / 36 s by party size (×0.75 in wave
3). *Telegraph 5 s:* the wheelhouse horn (twice), a banner naming the side,
the HUD bar, a 20 m wall of water rising on the weather side with spindrift
off its crest, and the deck starting to heel. *Sweep 1.4 s:* green water
crosses from the weather rail to the lee rail (a translucent sheet, spray
along its front). *Surge 1.1 s:* it keeps pushing. *Drain 1.6 s:* the heel
comes off. The heel is 20° toward the lee side. Anyone the water has reached
is pushed to the lee at 12 m/s (minus whatever they are running against:
about 5 m/s net if running straight into it). A body carried within 0.9 m of
the lee rail goes over it.

Who holds:
- anyone **braced** (in cover: the existing snap, Y/C, at a rail, winch,
  crate, drum, coaming or deckhouse wall);
- anyone **on the deckhouse roof** or in the air above 1.8 m;
- anyone **in the deckhouse's lee** (the water parts round the house);
- anyone stopped short of the rail by something solid.

Hostiles are knocked down and carried the same way, and one that goes over is
gone (killed, counted in `washedOver`). Barrels caught by it go over too. They
are restocked at the next wave.

**Over the side** (the harbour's beat): whoever hits the water gets a splash
and "The water took you" (`TEXT.banners.tookYou`, sub "hauled back aboard —
the deckhouse roof"). They re-form on the deckhouse roof and take 12 damage
(plus 4 from the wave's first contact). A respawn after death is on the roof
too, except while the mast is crackling, when it is on the foredeck.

**The boom** (from wave 2): a pendulum driven by the roll (spring 5, damping
0.8, stops at ±1.3 rad on its stays). It lags the roll, overshoots and clangs
on its stops. When it is moving (> 0.35 rad/s), whoever stands in the arc it
crosses, feet below 1.45 m over the deck, is hit: 16 damage (32 to hostiles),
knocked down and thrown along the swing (1.2 s per-body cooldown). You can
jump it. It is the best weapon on the ship against quarren coming up the
stern ramp: 17 hits in one autopilot run, nearly all on boarders.

**Lightning** (from wave 2): every 17–23 s (12–17 s in wave 3). 2 s of
crackle (the mast glows blue, sparks walk down it, a charge sound; players on
the roof get "Lightning! Off the roof"), then the strike: a bolt onto the rod
and a flash. 42 damage and a knockdown to anyone on the deckhouse roof or by
the masthead. Hostiles take double.

**The drift (K7).** Gain 1.6 × g × sin(roll), added to every body's velocity
before it moves. On the ground that is ~0.43 m/s at 10°: a lean you correct
without thinking. In the air it is ~1.4 m/s (3× the ground): a real slide. So
jumps, jetpack burns and knockdowns carry you downhill, and a flyer hanging
over the rail drifts out over the sea. The barrels take 0.4 of it with light
damping, so they slide rail to rail with the swell. A barrel faster than
3.5 m/s bowls over whoever it hits (3 × speed damage, 0.6× for players). They
are explosive (`addBreakable`).

**Co-op and solo.** Group sizes scale with the party: base +1 at 3 players,
+1 more for base-2+ groups at 4, and −1 for base-3 groups solo. Totals are
about 21 boarders solo, 23 at 2 players and 43 at 4. Rogue waves are rarer
solo (every 50 s). The five-second horn is the co-op beat. The HUD tells each
player whether they are braced or in the lee.

**The picture.** The hull and everything on it is one group rolled about a
keel line 1.5 m under the deck. The colliders never rotate. At the end of each
frame (`afterFrame`, below) every living body on the deck is carried with the
point of the hull it stands on, upright. The camera follows the body's
physical position, so the horizon stays level and the deck moves under it.
The sea is a 640 m plane with a sea_surface texture streaming aft at the
trawler's speed (7 m/s), a three-sine swell with analytic normals, a wake, a
bow-wave spray, passing buoys, and driven rain (line streaks). Colours and
fog are the storm's (`world` in the def).

## K7 — `deckTilt`

`src/sections/kit/locomotion.ts` (my part is the `deckTilt` block; the slide
and flight owners add theirs to the same file). `deckTilt({ pivotY, deckY,
gain, onDeck, carryUpTo })` returns a `DeckTilt`:

- `roll` (radians, + = +X side low): set it every frame.
- `move(scale?)`: a `sectionMove` adding the drift to a player, skipping
  anyone in cover or riding.
- `pushEnemies(game, dt)`: the drift for hostiles (not arriving, not
  hovering more than 3 m up).
- `push(body, dt, scale)`: any body with position and velocity.
- `accel`: the drift right now.
- `carry(pos, out)`: where a hull-riding point is drawn.
- `poseBodies(game)`: carry every body's root with the hull, from `afterFrame`.
- `hullRotation`: the angle to put on the rolled group.

## Shared-file changes (all small, commented)

- `src/sections/api.ts`: `SectionInstance.afterFrame?(dt)`, called at the end
  of every frame after all bodies have posed.
- `src/game/mission-api.ts`: `MissionController.sectionAfterFrame?(dt)`
  (optional, like `sectionHud`).
- `src/game/campaign.ts`: `sectionAfterFrame(dt)` forwards to the standing
  section's `afterFrame`.
- `src/game/game.ts`: one call at the end of `update()`:
  `this.campaign?.sectionAfterFrame?.(dt)`.

Why: the section's `update` runs inside the campaign, before players and
enemies move and write their poses. The roll has to move the drawn bodies
after that, or their feet float over and sink into a rolling deck. Any
section that needs to adjust what is drawn after the simulation (a mount's
rider pose, a K2 treadmill's parallax) can use the same hook.

## Registration

`src/sections/index.ts` (`squall`), `src/sections/ids.ts` (`BUILT_SECTIONS`,
and `SECTION_ASSETS.squall = cargo_crate, fuel_barrel, trawler`),
`TEXT.sections.squall` in `src/text.ts`. No new assets: every prop has a
procedural stand-in, and the models used (`cargo_crate`, `fuel_barrel`,
`trawler`) already exist. `rain_streak.png` (requested for this section) is
not used yet. The rain is line streaks, which read well.

## Tests

- `node tools/test-sections.mjs squall` at `PLAYERS=1` (maul, din), `2` and
  `4` (jedi, bokatan, maul, din): passes, ~176 s simulated, no deaths.
- `node tools/test-section-squall.mjs` checks:
  - the drift, both ways, and air > ground;
  - the drawn roll at the rail;
  - the barrels sliding;
  - a rogue wave taking an unbraced player over (re-formed on the roof),
    holding a braced one, and taking a hostile for good;
  - lightning on the roof and not on the deck;
  - the loose boom's hit;
  - a wipe returning the wave in progress to a breather, then fought again,
    with the party re-formed on the roof.
- Test hooks: `section.force.{quiet, roll, rogue, lightning, boom, wave,
  noRogue, enemy, finish}` and `section.debug()`.

## Known issues / notes for tuning

- The autopilot stands in the lee and shoots what it faces, so a boarder aft
  of the king post can outlast it for a while. That is a bot limit, not a
  soft-lock. A wave that is not clear 150 s past its minimum is ended anyway
  (stragglers killed) so it can never hold the run.
- Corpses (ragdolls) are not carried with the roll, since their root belongs to
  the ragdoll. At the rail on a big heel a corpse can look up to ~2 m off the
  deck for the few seconds before it fades.
- Pickups and bolts are drawn in physics space. A pickup by the rail at 10°
  looks ~0.7 m off. The bacta is placed on the centreline (foredeck, and the
  roof in wave 3) for that reason.
- The forecastle top is a perch with no rail. Green water covers it too, and
  going off it is the sea.
- `rain_streak.png` could replace the line rain when it lands.

## Left to do

- **Run the Pier** (§2.10), once K1's reversed rail camera is merged into
  the working branch: merge it into `claude/sections-trask`, build it on the
  pier the Squall ends at, register it.
