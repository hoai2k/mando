# Dune Sea — The Barge Run and Worm Sign

Branch `claude/sections-desert`. Owner files: `src/sections/barge-run.ts`,
`src/sections/worm-sign.ts`, the shared `src/sections/barge-hull.ts` (both
hulls) and `src/sections/dune-dressing.ts` (world-scaled rock), the two
`TEXT.sections` blocks, their lines in `index.ts`/`ids.ts`, and
`tools/test-section-desert.mjs`. `tools/shot-section.mjs` is the brief's
look-at-it script, kept as a tool.

Run: A (trailhead → corral → dune road) ⇒ B (ravine → cistern court) ⇒
**The Barge Run** ⇒ **Worm Sign** ⇒ C (the fighting pit, with the sandworm as
the lieutenant) → … Placement was already in `SECTION_PLACEMENT`.

## State

| Item | State |
|---|---|
| Worm Sign (`worm-sign`) | built; registered; `test-sections` passes at 1, 2 and 4 players |
| The Barge Run (`barge-run`) | built; registered; `test-sections` passes at 1, 2 and 4 players; both guns are K3 turrets |
| `tools/test-section-desert.mjs` | 32 checks (Worm Sign 20, Barge Run 12), all pass |
| Whole Dune Sea run with sections (`RUNS=desert … --runs-only`) | passes: B → barge-run → worm-sign → C, nothing leaks |

Also passed with an all-jetpack party (`din,bokatan,paz,armorer` at 4) and an
all-super-jump one (`maul,jedi` at 2). Autopilot times with hostiles culled:
Barge Run ~111–122 s, Worm Sign ~36–40 s (the bot waits for quiet and
decoys the apron, so it rarely draws a strike; real play is longer).

## Continuity

- **In (Barge Run):** the cistern court's far door is an airlock onto the far
  side of the mesas. The section opens on a rock ledge cut into the mesa foot,
  the airlock shut in the face behind the party, the skiff tied up at the lip,
  and the barge far out on the dunes pulling away. When the party is aboard,
  the skiff casts off and the whole landing — ledge, mesa and door — slides
  away astern on the treadmill, so there is no door behind you to go back to.
- **Barge Run → Worm Sign:** the run ends when the helmsman dies and the barge
  slews onto a sandbank. Worm Sign begins beside that same barge (the same
  `buildBarge` hull, aground, listing, sails slack), across the south end of
  the field, with a plank down off its cargo deck onto the entry island.
- **Out (Worm Sign):** the far end is the fighting pit's rim: a ridge of rim
  rock across the field with one gap, framed by two Tusken banners, the pit
  floor dropping away through it and the pit's old tower beyond. Reaching the
  gap ends the section — and the worm breaches behind the party and goes under
  toward the pit. **The worm you evade is the one you fight next**: it is the
  same `sandworm` kind, and stage C's lieutenant is that animal. Nothing in
  Worm Sign depends on stage C's first zone's geometry (the audit-fixes branch
  may add a vestibule there).

## Worm Sign — how it plays

A 110 × 198 m field of deep sand between two mesa walls (the flanks are
solid to the rock face), from the grounded barge (south) to the pit rim
(north). Eighteen rock islands in three braided routes: a straight line down
the middle with long sand gaps (18–21 m), and a winding route on each flank
with short ones (6–11 m). They meet on the checkpoint islands at the 66 m and
128 m marks, and on the last island at 150 m; after that is the **apron**,
27 m of open sand to the rim with nothing to stand on.

- **Noise (K6).** `DetectionField` with a `noiseGate` that only hears a body
  over sand (and under the worm's reach). Rates per second or per event:
  walk 0.16, sprint 0.42, jet/super-jump thrust 0.5, a shot 0.07, landing 0.05,
  hard landing 0.25. It holds 0.8 s, then drains 0.22 a second (a full meter
  empties in about 4.5 s). Island shelves are a 0.5 m step up (walkable), so
  getting onto rock is quiet.
- **Hunger** is the sum of the living players' meters. Threshold
  `(0.35 + 0.27·party) × tier` — 0.62 solo, 0.89 at two, 1.43 at four; the
  tier multiplier is 1.0 / 0.85 / 0.7 for the three thirds of the crossing.
- **The worm** is the stage C `sandworm`, spawned by the section and driven by
  `Enemy.scripted` (`drive` places it and sets `burrowDepth`/`setBurrow`;
  `hurt` returns 0 — it cannot be hurt here; a hit while it is up sends it
  down sooner). Its states: `roam` (loose loops ahead of the party, a visible
  sand hump and dust), `stalk` (hungry but nobody on sand: it circles the
  party's rock and waits — the next body onto the sand gets the ring at
  once), `drawn` (a thumper is pounding: it circles that), `ring` (the
  telegraph), `rise` / `up` / `sink`. Fully under, its body is hidden (only
  the wake shows), so forty metres of worm never ploughs up through an
  island.
- **The strike.** A ring of rippling sand forms under the loudest player on
  the sand and **follows them** for all but the last 0.5 s of the telegraph,
  at 9.5 / 11 / 12.5 m/s by tier — faster than a run (9.2), slower than a
  sprint (14.4). Telegraph 2.0 / 1.8 / 1.6 s, ring radius 5 / 5.5 / 6 m. Then
  the worm erupts through it: anyone in it, off the rock and under 16 m up,
  takes 38 (solo) or 45 and is thrown. Hostiles on the sand in it die. The
  hunger halves. Rest before it can be called again: 3.0 / 2.4 / 1.8 s.
  **Rock is always safe**, even inside the ring. Why these numbers: with a
  ring that only a sprint outruns, the choices are real — sprint (loud, so the
  next ring comes sooner), make the rock, or be quiet enough not to call it.
  A slower ring (the first draft, 8.5 m/s) let a plain run escape every
  strike and the worm stopped mattering.
- **Thumpers.** Posts on the four checkpoint islands (two on the last one).
  Hold Y 0.6 s to pull one; hands full (no gun, blade, shield or rocket) until
  it is planted on sand (hold Y 1 s, feet on the sand). It pounds 15 s; the
  worm ignores every player while it does, circles it, and on the last 2 s
  rings it and eats it. A spent, eaten or dropped thumper is back on its post
  6 s later.
- **The thumper prop**, built to its sheet (`thumper`, 2.0 × 1.8 × 2.4 m, the
  sculpt scaled by the 2.4 m height, `loadProp(…, { axis: 'y', ground: true })`):
  three spiked legs with the feet on a 1.8 m triangle, a crank lever across the
  top with a netted stone counterweight on its −x end, and the `hammer` node on
  the +x end, 0.7 m off the centre, bottoming out 0.5 m above the ground and
  riding a 0.45 m stroke while it pounds. Pivot at the ground under the
  tripod's centre. When the sculpt loads, its own `hammer` node is driven
  (the stroke converted into its parent's scaled units) and the stand-in,
  procedural hammer included, is hidden. Collider: a cylinder r 0.9 m, 2.4 m
  tall while it stands (on its post or planted), none while carried or gone.
  It plants 1.6 m ahead of the planter, clear of their capsule; the post's
  stake stands 1.4 m off, clear of the feet.
- **Tusken camps.** Two, on the big islands of each flank's middle third
  (tents, a fire, 3–5 Tuskens and Pykes, posted). Their fire is heard: every
  hostile bolt adds 0.06 to each player on the sand within 34 m of the shooter
  (the section wraps `game.projectiles.fire` while it stands and restores it
  on dispose). Shooting them from the rock is free.
- **Ceiling** 17 m over the sand: flight is always loud and never above the
  worm's reach.
- **Checkpoints**: the four checkpoint islands; the fallen re-form on the
  furthest one a living player has stood on. A wipe drains every meter and
  sends the worm off ahead. Bacta on the last three checkpoint islands.
- **HUD**: Noise (yours) and Worm (the party's hunger against the threshold,
  or the thumper's time while one pounds); a line for sand/rock/ring/carry.
- **Autopilot**: even slots take the west braid, odd the east; on each island
  wait for the hunger to fall under 0.4 of the threshold, then walk the gap;
  a ring under you → sprint to the nearest rock ahead. On the last island
  slot 0 pulls a thumper, plants it on the apron's east flank, and everyone
  sprints the apron while it pounds.

## The Barge Run — how it plays

- **K2.** `Treadmill` along −z at 14 m/s once under way (5 s ease). The sand
  (one 420 m plane, collider flat) scrolls its texture; 26 dune ridges and rock
  stacks loop on the conveyor (440 m), ten far buttes on a 0.18 parallax band;
  a 260-point dust stream pours astern off each hull. The landing (ledge, mesa
  and airlock) is a pass-once conveyor item with its colliders on a `Mover`.
- **Hulls.** `barge-hull.ts`: the barge is 12 × 40 m (+ prow), cargo deck at
  +4, the superstructure's roof (upper deck) at +10 over the aft half, a
  12-step stair up its fore face, the helm aft, a mast and two yards, cargo
  racks for cover, two gaps in the port bulwark where the planks come down.
  The skiff is 4.6 × 14 m, deck at +2, low rails with a gangway gap to port
  and plank gaps to starboard. Its colliders ride one `Mover` (the lateral
  offset), eased 26 m → 9 m.
- **Beats.** Landing (board: cast off when everyone standing is aboard, or 8 s
  after the first) → cast-off (the barge's picture closes from 110 m ahead over
  11 s; its crew goes aboard when it arrives) → **broadside** (rail riflemen,
  the heavy gun's gunner lobbing a shell every 5–8.5 s — a ring on the skiff's
  deck for 1.5 s, one in three laid on a player; swoops; the skiff's hull
  points chipped by swoops within 32 m and by the rail gunners; the gunner
  dead and 22 s gone, or 75 s, ends it) → **close** (6 s ease in, then the two
  planks swing down and become stepped, walkable colliders) → **cargo deck**
  (two waves posted in the racks) → **upper deck** (the heavy gun changes
  hands; two Tusken skiffs come up from astern and hold station 16 and 26 m
  off the starboard side as breakables, 360 + 140·party hull, with a crew of
  three each) → **helm** (the helmsman, a `gunslinger`, comes out to fight) →
  grounding (the treadmill stops over 3.5 s, the barge slews, done).
- **Failing.** Falling to the sand (anything under +1 m) re-forms you on the
  skiff; so does being carried off astern on the landing. A hostile that
  lands on the sand is left in the dunes (killed). If the skiff's hull points
  run out in the broadside (or the party wipes there) it breaks up: a fresh
  skiff back at 26 m, the party on it, the broadside restarted.
- **Tuning.** Solo: one fewer rail gunner and a smaller swoop wing (a solo
  gunner went from 100 to 44 HP in seven seconds against the first draft's
  numbers), shells cost 8% of the hull instead of 10%, and chip damage is
  scaled by 0.7.

## The guns: K3 turrets

Both guns are K3 `turret` rides (`kit/mounts.ts` `RideLedger`, added on the
section's first update — rides added in `build` are wiped when the stage
finishes raising). Y mounts one (the ordinary ride path), the camera is its
sight, RT fires, heat locks it and it vents, Y steps off; unmanned it fights
for its `team` at `def.turret.auto` × its rate.

- **Deck gun** (the skiff's stern): the stock quad gun, `yawArc` π, auto 0.5,
  team 0; `moveMount` every frame, so it rides the skiff's lateral `Mover`.
- **Heavy gun** (the barge's upper deck): 3.2 shots/s, 55 damage, 90 m/s,
  two barrels, all round. It stands on a 1.1 m gun ring (a step up on its
  west side) so its sight clears the barge's own starboard rail when firing
  down at the raiders. Team 1 with `auto: 0` through the broadside (silent:
  its gunner's fire is the telegraphed shelling, and a turret hosing the skiff
  at full rate on top of that was not survivable); a player who jetpacks over
  and takes it stops the shelling. When the cargo deck is cleared it changes
  hands (`team = 0`, `auto = 0.5`).
- K3's auto-aim only looks for bodies, not breakables, so an unmanned heavy
  gun shoots the raiders' crews, not their hulls; a gunner sinks the hulls.
  The autopilot's gunner aims with yaw plus `lookY` (pitch), since the sight
  is the camera.
- Both have 5000 hull so the fight's own fire never wrecks them (and the
  ledger would bring a wreck back in any case).

**For K3's owner:** the stand-in quad gun's shield top (y 2.3) sits right at
the sight (y 2.25), so any aim below level looks into the shield: from the
skiff's deck gun the lower half of the view is the shield's back. Seen in
the Barge Run's screenshots; `vehicles.ts` is not mine to change.

## Shared-file changes

- `src/game/campaign.ts` (constructor, one commented line): the guide column
  is lit at construction only if the raised section's objective allows it
  (`objective().beacon !== false`). It used to be lit unconditionally, and the
  intro plays before the first `update`, so a `?section=` boot showed a
  sixty-metre column for one to three seconds over objectives that ask for
  none. Reproduced with `campaign.beacon.visible` sampled through a stepped
  boot (true for the intro frames, false once `update` ran); checked in
  `tools/test-section-desert.mjs` at boot and across the whole Barge Run. The
  "stands over beacon-less objectives mid-run" report was the same intro
  window: once `update` runs it already followed `beacon: false`.

Otherwise everything goes through the section hooks (`Enemy.scripted`,
`Player.sectionMove`, `board.movers`, `board.breakables`). Worm Sign wraps
`game.projectiles.fire` at runtime for as long as it stands and puts it back
on dispose. The working branch was merged in twice (K1–K3; then main, every
section and the audit fixes); conflicts only in `index.ts`/`ids.ts`, both sides
kept.

## Round 2 (after main's stick gait)

main reads the stick as a gait (≤ 0.6 walks at ≤ 1.4 m/s, ≥ 0.9 runs). Worm
Sign's autopilot already pushes full tilt; the Barge Run's used `d / 2` near a
waypoint and now uses full tilt until 1.5 m out, then a walk to settle. The
stowed boarding planks no longer clip a crate stack (two stacks moved clear of
them). The wipe comment in the broadside now says what the code does: a fresh
skiff on *every* wipe, once per wipe (the frame the last player falls), not on
every frame the party is down — that was the intent.

## Known issues / left

- A solo player who never silences the barge's gunner loses the skiff's hull
  at about 1.2 % a second; the broadside closes at 75 s regardless, which is
  just before a solo skiff would break up. Tight on purpose; loosen the chip
  rates in `update`'s broadside case if play says so.
- The `thumper` and `quad_turret` sculpts are not delivered; the stand-ins are
  the look. The `quad_turret` stand-in is K3's (being rebuilt to 4.0 × 3.0 ×
  2.7 m by the Lava Flats team). The placements leave room for it: the skiff's
  deck gun sits on the 4.6 m-wide stern with its 3 m drum clear of both rails
  (0.8 m of deck either side) and its barrels reaching over the starboard rail;
  the heavy gun's ring is 3.4 m across, 4.7 m from the fore rail and 2.8 m from
  the starboard one, so a 3 m drum and 1.5 m barrel reach fit.
- The treadmill carries riders a frame late (narkina's note). The only rider
  it carries here is a straggler left on the landing as it slides away, who is
  re-formed on the skiff anyway; the skiff's own lateral move is a `Mover`
  outside the treadmill.
