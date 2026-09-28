# Frigate team — Guns of the Frigate (the Spice Run, A ⇒ B)

Branch `claude/sections-frigate`. Owner of `src/sections/frigate-guns.ts`,
`tools/test-section-frigate.mjs` and `TEXT.sections['frigate-guns']`. Built on three merged
kits: K2 treadmill (`kit/treadmill.ts`), K3 turrets (`game/vehicles.ts`, `kit/mounts.ts`
`RideLedger`) and K5 objective bar (`kit/objective.ts` `DefendTarget`).

## State

| Piece | State |
|---|---|
| `frigate-guns` (`src/sections/frigate-guns.ts`) | **Built, registered, playable.** `test-sections` passes at 1, 2 and 4 players, jetpack and super-jump parties. Played un-culled by the autopilot end to end at 1 and 4 players. Screenshots checked for every beat. |
| Mechanic suite (`tools/test-section-frigate.mjs`) | **Passes** (guns, no depression, tubes, hull breach, corvette, spinal line, the void). |
| Registration | `index.ts`, `ids.ts` (`BUILT_SECTIONS`, `SECTION_ASSETS`). Placement was already in `SECTION_PLACEMENT` (station, before stage B). |

## What it is

**The ends.** Stage A's outer yard leaves by a transport door in the station's hull face,
treated as a docking-collar door. The section opens with the party standing round the frigate's
**aft dorsal hatch**: its lid is up and the shaft is lit, as if they have just climbed out.
Astern, the station's hull face fills the view, with the collar tube mated to the frigate's
stern. The lid swings shut behind them (one way), the collar draws back into the station, and
the frigate casts off. The station recedes astern for the rest of the section. The section ends
when the corvette breaks away and the frigate slides into the station's far dock: two gantry
arms and the station wall with a lit bay come in from ahead on the treadmill, she stops between
the clamps, and the **forward dorsal hatch** opens. It is a real hole in the deck with a 4 m well
under it. Dropping into it completes the section, and stage B (inside the station, the spice
vault) is below. Nothing depends on B's first zone's geometry, so a vestibule added there by
the audit work is fine.

**The hull.** The deck is 70 × 22 m (z −35 stern … +35 bow, the bow tapering from z 24), with its
top at the stage floor. The deck is one extruded slab with the forward hatch cut through it, and
the colliders are boxes round the hatch plus a run of slices for the bow. Under it the hull body,
keel and engine block fall away, with lit ports down the flanks and three engine bells astern
whose plumes grow with the speed. Knee-high **bulwarks** run along both flanks, open at the three
**boarding points** (B1 port z −15, B2 starboard z +5, B3 port z +17; striped sockets). There
are six low vent housings for cover on the deck fight, a centreline pipe, gun rings, and four
red **radar lamps** (bow mast, stern, port, starboard) that flash toward an incoming contact.

**The world** (K2). Nothing on the deck moves. A treadmill (dir −z) scrolls the station face (a
one-pass conveyor), 34 rocks and hull shards (looped every 600 m), and 420 dust streaks whose
length grows with the speed (these sell the motion), and at the end it brings in the far dock
(`stopAt` lands it exactly alongside). Speeds: 24 m/s cruise, 18 in the corvette fight, 10 on
the approach, then a 4 s eased stop. The sky is the station board's own starfield and gas giant,
plus a planet far below the hull for the void. `world: { gravity: 0.45, fill: 1.1 }`, the Spice
Run's 0.45 g.

**The guns** (K3). There are four quad guns in a diamond: starboard (−7, 0) facing −x, bow (0, 23),
stern (0, −23), and port (7, 0) facing +x. Each is put in by a `RideLedger` on the first update.
They have 200° arcs (`yawArc` 100°), 900 hp, the party's team, and half-rate auto-fire when
empty. **They cannot depress onto their own deck:** `pitchMin` is +0.08 rad, so a bolt clears a
standing boarder's head from about 5 m out. The sight is raised to 2.7 m, because K3's default
eye sits level with the stand-in's gunner shield and the plate filled the lower half of the view.
An unmanned gun locks onto the nearest body in its arc, which can be a boarder or a latch it
cannot reach. It then tracks without firing. That is deliberate and it is the design's question:
**boarders blind the auto guns, so someone has to leave a gun.**

**The hull bar** (K5). A `DefendTarget` over a hull body (1000 hp) supplies the bar, the tones
and the breach. The breach is its `onDown`: the field is cleared, and 4.5 s later the wave comes
round again from its start. `onUp` restores the hull to the value it had when the wave began.
Each wave start takes a checkpoint of the hull. A **party wipe** does the same (rule 4). Between
waves, damage control patches +10% and a bacta canister appears at the aft hatch (and a second
at the forward hatch for 3+ players).

**The waves.** Each contact is called on the radar 4 s ahead: the HUD line reads
`Radar ▸ drones · port`, then `Drones inbound · port`, and that side's lamp flashes. The
contacts show on the radar from 120 m (they spawn at about 175–200 m).

1. **Drones** (ahead 4+2p, port 3+2p, then starboard 3+p and astern 2+p at once). The drones
   are `drone` bodies flown by `Enemy.scripted` on curved attack runs at 26–32 m/s. A run that
   reaches the deck is a hull strike (30 hull, splash on anyone within 4.5 m). Every third drone
   is a **hunter**: it breaks off at 80% of its run and becomes an ordinary kamikaze interceptor
   after whoever is on deck, gunners included.
2. **Gun-dropships** (`raider_dropship`). They come in fast (34 m/s) to the start of a strafing
   pass 32 m off a flank, fly the length of the hull at 14 m/s firing 3-bolt bursts at the deck
   every 0.6 s (8 hull a burst), then loop over the bow or stern and come back down the other
   flank. They take 650 hp + 220 per extra player.
3. **Boarding tubes.** A boarding dropship comes up **from under the hull**, where no gun can
   depress to it, so the radar is the only warning. It holds beside its boarding point and runs
   a tube up onto the deck edge (1.6 s). When the collar clamps, two boarders come out together,
   then one every 1.5 s. The queue is pirate, pirate brawler, one more per extra player (pirate
   or Pyke), and last the **Pyke heavy**. The heavy is the capo with company or in wave 4, and a
   Pyke gunner for a lone hunter before that. After the queue, the tube keeps sending a pirate
   every 12 s while fewer than two of its own are alive. A latched tube **drains 8 hull a second**.
   The **latch** takes a blade in full (+15%), and anything of 40+ in one hit (a rocket's blast)
   in full. Bolts do 8%: they spark off the clamp. It has 240 hp alone, 320 at two, and +90 per
   player past two. Cut, the tube tears away and the ship peels off. Alone, a second tube waits
   until the first is cut and its boarders are down; with company the two can overlap.
4. **Everything.** A tube at B2, a gunship ahead, swarms astern and to port, a second tube at B1
   (with company, sooner), and a second gunship at 2+ players.

**The corvette** (the finale). A procedural stand-in to the `pirate_corvette` spec: about 60 m
long, rust and bare plate, the spinal gun as a barrel under the keel out past the nose, and
nodes `gen_0..2`, `spine_gun` and `bridge`. It comes up from astern over 12 s and holds station
52 m off the starboard side. That puts it in reach of the starboard, bow and stern guns, but not
the port gun, whose crew has to move. A shield bubble covers it while any dome stands, and the
bridge takes nothing until all three are down. The domes have 900 hp (+300 per extra player)
and the bridge 1600 (+500). **Unmanned guns do a quarter of their damage to armour** (the
gunships, the domes and the bridge): the auto-fire thins drones, but the armoured work needs
crew. This is our reading of the design's "half rate and a quarter of the accuracy". The K3 auto
brain's spread is fixed, so the quarter is on the damage.

- **The spinal gun.** Every 7.5 s (9 s alone) the corvette slides along to line up on a player
  (on deck or in a gun) and turns its nose on the frigate. A red lane 4 m wide lights across the
  deck with flashing edges: **2.5 s to get off it**. Then the beam fires, doing 70 damage and a
  shove to anyone on the line (gunners included) and 60 to the hull. Drone escorts come every
  24 s from ahead or port.
- Bridge down: it **breaks away burning**. Explosions walk its hull as it rolls and drops astern.
  4 s later the far dock comes in from ahead and she docks.

**The void.** `offPath` is below the deck by 6 m (except the open well) or 18 m off the
footprint. `respawnSpot` is always the **nearest hatch** to where you fell or died: the aft one,
or the forward one (only the forward one once she has docked). The party stands round it with
the campaign's slot offsets. Boarders who go over the side die in space.

**Objective and HUD.** The objective is, in priority order: the open forward hatch (the only
place with a beacon), a latch, a shield dome or the bridge, a boarder on deck, a free gun, then
the hull. The panel shows the title (`Wave n of 4 · …` / `Pirate corvette`), the bars (Hull, Gun
heat or *Venting* when you are in a gun, *Shield domes n/3* or *Corvette bridge*) and one line
(the radar call, the spinal warning, or the hint). Top-left hints are kept to **26 characters or
fewer**: longer ones wrapped into the kill counter.

**The autopilot.** Slots 1–3 man the starboard, bow and stern guns (the port gun is left on auto:
it is the one that cannot see the corvette). They aim with lead at the nearest air target in
their arc, above the barrels' floor, and hold the trigger short of a lock-up. Slot 0 fights on
the deck: boarders within 14 m first, then the latch (it stands inboard and swings), then air
targets from the middle of the deck. **Alone**, slot 0 mans the starboard gun and leaves it
whenever a tube latches or a boarder is aboard, which is the section's question, asked of a bot.
Everyone bails off a gun whose base the spinal lane crosses and walks off the line, dismounts at
the dock, and walks into the forward hatch. The bot steers round the guns and vent housings with
a detour point.

## Tuning, and why

| Number | Value | Why |
|---|---|---|
| Hull | 1000, +10% between waves | the waves chip it; the tubes and the spinal gun are what threaten it |
| Drone strike / speed | 30 hull / 26–32 m/s | at 24 hull and 19–23 m/s the auto guns cleared every swarm and the hull never moved |
| Gunship | 650 (+220), burst 8 hull / 0.6 s | at 420 hp it died on its way in, before it ever strafed |
| Boarder approach | from 34 m under the hull | from level the guns killed every boarding ship before it latched, so the deck fight never happened |
| Latch | 240 alone / 320 at two, bolts 8% | at 150 a bot cut it in two seconds, before the first boarder was out |
| Tube burst | two boarders at once, then every 1.5 s | the deck is contested the moment the collar clamps |
| Solo heavy | a Pyke, the capo from wave 4 | the capo on a lone hunter at the latch was a guaranteed wipe (and a wipe restarts the wave) |
| Auto vs armour | ¼ | with full auto damage the corvette fell in under 20 s with one gunner |
| Domes / bridge | 900 / 1600 (+300 / +500) | a crewed corvette fight of about 40 s, the spinal gun firing three or four times |
| Spinal | 2.5 s telegraph, lane 4 m, 70 dmg, 60 hull, every 7.5 s (9 alone) | the design's; lined up on a player so it always asks something |
| Gun pitch floor | +0.08 rad | +0.05 still clipped a boarder standing 8 m off the barrels |

Measured with the autopilot, **un-culled** (bots aim perfectly, so humans will find it harder):
alone, the whole section takes about 4.6 min, with no deaths and the hull ending around 65–70%.
At 4 players (din, maul, armorer, jedi) it takes about 4.3 min with no deaths and the hull ending
around 60%. The corvette fight takes about 40 s either way. The suite (culled) finishes it in
181–192 s.

## Assets

- `raider_dropship` (delivered): the gunships and boarding ships fly it. It has a stand-in for
  when the file is missing.
- `boarding_tube`, `pirate_corvette`, `quad_turret` (requested, not delivered): procedural
  stand-ins to the `ASSETS_MODELS.md` spec. **Tube:** 3 m Ø × 8 m, the `latch` collar at the
  origin, the tube along +z (the section points +z at the ship's door and scales z to fit).
  **Corvette:** ~60 m, +z forward, origin at the keel, with nodes `gen_0..2`, `spine_gun` and
  `bridge`. The section looks the named nodes up in the sculpt first and the stand-in second,
  hides a dome's node when it falls, and hides the bridge node when it breaks. The quad gun is
  K3's own stand-in.
- `SECTION_ASSETS['frigate-guns']` warms all five ids, plus `interceptor_drone`.
- Textures: `hull_plate_large` (deck and housings, re-toned after load because it lands bright),
  `metal_hull`, `rust_hull` (flanks, bulwarks), `panel_white` (station faces), `hazard_stripe`
  and `planet_station`. Nothing new was requested.

## How it is built (for whoever picks it up)

- **Hit-proxies.** A dropship, a latch, a dome and the bridge are all things that the guns'
  auto-target and soft-lock, blasters, blades, lock-on and the radar have to find, and in the
  engine that means an enemy body. Each one is a hidden `droid` (`squad` 8840) driven by
  `Enemy.scripted`, with its `radius`, `height` and `hitParts` sized to what it stands for, and
  a `hurt` hook for the rules (latch: melee or heavy; armour: ¼ from `bySlot` −1; bridge: 0
  under the shield). Its visuals are the section's own. The proxy driver writes the body's real
  velocity every frame, because each hit's shove otherwise piles up in a body nothing else moves
  and poisons every gun's lead. That was the bug that made the bridge unkillable.
- **Moving a `ctx.prop`.** `ctx.prop` returns the sculpt's holder, and the stand-in is its
  **sibling** under one parent. To move or hide the whole thing, move `holder.parent` (the
  `flying()` helper). Moving the returned group leaves a missing model's stand-in where it was
  built.
- **Melee on the latch.** This uses `SectionMove.meleeHit`: the hook marks the latch a blade is
  about to land on, and the latch's `hurt` gives that hit full damage.
- **Test probe.** The instance carries a `probe` (`hold`, `wave`, `corvette`, `latchAt`,
  `spinal`, `setHull`, `spawn`, …) for `tools/test-section-frigate.mjs`. Nothing in the game
  reads it.

## Shared-file changes (each one small and commented)

- `src/ui/hud.ts`: the ride prompt has a turret branch. A gun said *stick drives · A hop · RB
  shield*, and now it says `QUAD GUN hp · RT fire · Y off`. This is one line, and the Barge Run's
  deck guns get it too.
- `src/text.ts`: `TEXT.hud.gunning` (for the above), and my own `TEXT.sections['frigate-guns']`
  block.
- `src/sections/index.ts`, `src/sections/ids.ts`: registration and `SECTION_ASSETS`.

No change to `vehicles.ts`, `player.ts`, `game.ts` or `campaign.ts`.

## Tests

- `CHROMIUM_PATH=/opt/pw-browsers/chromium HARNESS_PORT=4220 node tools/test-sections.mjs frigate-guns`
  at `PLAYERS=1` (din, and maul), `2` (din+maul, jedi+armorer) and `4` (din, maul, armorer,
  jedi): pass.
- `RUNS=station node tools/test-sections.mjs --runs-only`: the Spice Run with both of its
  sections, in order, hands over.
- `node tools/test-section-frigate.mjs`: 27 checks, all pass.
- For the `hud.ts` change: `tools/test-section-mounts.mjs` (K3) and `tools/test-modes.mjs` pass.

## Known issues / left

- On a `?section=` boot the campaign's beacon column is lit for the first ~2 s before its first
  update. That is the framework, not the section, and a real run's transit douses it.
- The station board's ambient sky traffic includes a `spice_run_frigate` flying past, which can
  read as a sister ship. It was left alone, because it is the board's.
- The K3 auto-fire brain picks the nearest body in its arc even when that body is unreachable,
  so a latch or a boarder near an unmanned gun silences it. This is kept as design (see above).
  If it plays badly, the fix belongs in `turretTarget` (a pitch-reachability test), which is
  K3's file.
- Bots aim perfectly, so the tuning above is a floor. Watch a human play: the latch HP and the
  tube drain are the numbers most likely to need moving.
- There are no authored models of our own: the corvette, the tube and the dock are stand-ins.
