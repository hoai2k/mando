# Ringworld — section notes

Team: Ringworld (branch `claude/sections-ringworld`). Owns **K8 pursuit**
(`src/sections/kit/pursuit.ts`), **The Mark Runs** (`mark-runs`, §2.16) and
**Tram Top** (`tram-top`, §2.15).

## State

| Item | State |
|---|---|
| K8 pursuit (`kit/pursuit.ts`) | built; mechanics suite passes |
| The Mark Runs (`src/sections/mark-runs.ts`) | built, registered; `test-sections` passes at 1, 2 and 4 players; `test-section-mark-runs` passes |
| Tram Top | **waiting on K1 (rail camera) and K2 (treadmill)**, being built on other branches. Not started. |

## The Mark Runs — what is built

**Where it goes.** The Ringworld's one authored stage is cut after the plaza
(zone 5) by `SECTION_PLACEMENT`; this is the stage in the cut. It opens at the
top of the fire stair the plaza's door leads to: a stair head on the first
roof with its door shut behind the party (one way). It ends on a landing pad
whose own stair down — a lit hatch-house with "service spine" neon over it —
is the way on; walking into it after the pad fight completes the section and
the run carries on into the service spine (A3).

**The route** is the diagram's, at its scale (`docs/sections/16-the-mark-runs.svg`,
3 px = 1 m): twelve roofs (R1, R2, R3a/R3b, R4, R5, R6, R7, R8a/R8b, R9, R10 =
the pad), ~480 m, out along the near row, round the corner at R5 → R6, back
along the far row. Gaps 11–16 m (the diagonal fork leaps up to ~17 m), roofs
between −3 and +7 m of the section floor. Every roof is a tower top going down
into a street haze 58 m below; each has a glowing lip (green on the checkpoint
roofs), vents, water tanks, antenna masts and neon signs as cover and clutter.
More towers stand round the route (lower near it, taller in the distance) so
the route's roofs read as the tops.

**The mark** is a `gunslinger` with a jetpack (two tanks and nozzles on his
back, jet plumes on every leap) driven by a K8 `Runner` along an authored
route graph (29 nodes, two forks).

**How it plays.**

- **Start.** The party comes out of the stair head. The net launcher rack
  (purple glow) is two steps from the door. He stands at the far side of R1
  for ~3 s looking back (or until someone closes to 22 m), then bolts.
- **The gap** — HUD panel "The Paymaster": a lead bar (green / amber past
  two-thirds of the escape distance / red with a countdown while the escape
  clock runs) and a bounty-value bar; the panel line shows nets left, or the
  escape warning.
- **The speed curve** (K8): he sprints (12.5 m/s, 3 s of stamina) when a
  hunter is within 14 m, runs (9.0) at a normal lead, eases to a jog (6.4) as
  the lead grows to 38 m, and past 38 m stops for a 2.2 s breather (every 8 s
  at most) looking back. A player runs 9.2 and sprints 14.4, so running keeps
  pace and sprinting closes; his sprint outpaces a run but not a sprint.
- **Escape.** More than 60 m from every hunter for 8 s (solo: 75 m / 10 s) —
  the clock decays at twice the rate when you close back in — and he is gone:
  every living hunter is put back on the last checkpoint roof, he is put on
  his restart node a lead ahead (23–35 m), every trick after that node is
  stood back up, nets refill, and he runs again after 2.5 s.
- **Checkpoint roofs:** R1, R4, R6, R9 (the diagram's green circles). Reaching
  one refills nets; each has a resupply crate (arms anyone who skipped the
  rack) and a bacta canister.
- **Forks** (after R2 and after R7): arriving at the fork node he counts the
  hunters nearest each way on and takes the one with fewest (tie: the one
  whose nearest hunter is farthest). "He is choosing a way — split up" goes up
  as he decides. R3a is the high way (+7), R3b the low (−3); R8a straight on,
  R8b the high way to the south.
- **His pirates** (R2, R5, R8a, R9): 3 each solo/2p, 4 at 3–4p (a jet pirate
  on R5 and R9 at 2p+, a melee pirate on R8a). Each squad is called when he
  passes the node before its roof ("His pirates — the next roof is waiting"),
  or wakes when a hunter comes within 34 m.
- **Crate kicks** (R4 and R7): a five-crate stack beside his line. As he
  passes it wobbles for 1.0 s (the telegraph), then goes over *back along his
  line* at the hunters: 18 damage (14 solo) and a shove to anyone in the lane,
  once per fall. The crates stay down as solid clutter.
- **The sign** over the last gap (R9 → pad): an 18 m neon sign hangs on a
  gantry well above any jump. As he lands on the pad he shoots it loose: 1.5 s
  of sparks and flicker, then it drops into the gap and hangs from pad height
  to +7 m, live for 10 s (12 damage and a shove back, 8 solo). The last
  crossing goes over it.
- **Hits in the chase** (`hurt` filter on the mark): a blaster hit staggers
  him 1.1 s (≈10 m of lead at his run) and costs 4% bounty per 34 damage; a
  hit from a hunter within 3.6 m (a hand on him: melee, a lunge, point-blank)
  staggers him 1.4 s and costs nothing. After a stagger he cannot be
  staggered again for 1.4 s (a party cannot pin him). A hit mid-leap staggers
  him on landing. He cannot be killed in the chase.
- **The net launcher** (B / Q, replacing the rocket while it has nets): three
  nets, 0.9 s between shots, a slow net (30 m/s, ~35 m range) that bends onto
  him from a generous cone. In the chase a net snares him 2.4 s, free. A net
  on a pirate knocks it down.
- **The pad duel.** At the end of his route he turns ("Cornered"): promoted
  like a lieutenant (he parries, flashes when hit) with 190 × (4 + 1.5 per
  extra hunter) HP — 760 / 1045 / 1330 / 1615 — at 0.85× damage solo. No
  super-jump off the pad; instead he **jet-hops** 11 m across the pad away
  from any hunter within 7 m (every 4.5–7 s). Each hit is capped at 20% of
  his health. Blaster damage costs bounty as a share of his health (half of
  him by blaster = −15%); hands cost nothing.
  - **A net** at or under half health takes him alive; above half it holds
    him 2.6 s (open to a beating).
  - **Beaten to zero by hand** takes him alive.
  - **Shot dead**: still a clear, at half the bounty.
  Taken, he lies wrapped (or knocked cold), is off everyone's target list, and
  the objective moves to the stair down.
- **Bounty value** is the score: the banner says "Taken alive · bounty N%" or
  "Dead · bounty N%". At 85%+ taken alive, everyone's rocket is recharged and a
  "Full bounty" banner follows.

**Objective:** the marker is locked on him ("the mark · N m"), `beacon: false`
(a light column on a man running the roofs is wrong); after the fight, the
stair down with the beacon. Hints are ≤ 20 characters (they are upper-case and
wrap in a quarter-screen): "Grab the launcher", "Keep him in reach", "Split
up at the fork", "He's getting away!", "Wear him down", "Net him now!", "Take
the stair down".

**Nothing left behind.** Roof edges and the drop are the boundary: below the
section floor − 14 m is off the path, and the fallen come back on the most
advanced roof a living hunter is standing on (never the pad), else the last
checkpoint. Nets refill on every respawn. A wipe holds him; when the party is
back he restarts from the checkpoint as for an escape. On the pad he cannot
leave: knocked over the lip, he is put back on the pad.

## Tuning, and why

- **Speeds** — built round the player's 9.2 run / 14.4 sprint so that running
  holds the gap and only sprinting closes it; his sprint is a 3 s burst so a
  sprinting hunter wins in the end. Solo he is a touch slower (8.6 run, 12
  sprint).
- **Breather** — without it a party that falls behind (a fall, a pirate
  fight) never gets back in reach; with it the chase always tightens again,
  which is the "always feels tight" the design asks for. It only happens past
  38 m and never on a leap edge.
- **Escape** — kept at the design's 60 m / 8 s (75 / 10 solo). Standing still
  from the start, he is gone ~20 s in (the mechanics test measures it).
- **Stagger 1.1 s / guard 1.4 s** — 1.1 s at 9 m/s is the design's "−10 m".
  The guard stops four blasters holding him still, which would kill the chase.
- **Chase bounty cost 4% per bolt** — about 25 blaster hits empties it: enough
  that spraying him is visibly expensive, not so much that one volley ruins
  the run.
- **Duel HP** — first built at 1.5× and it lasted four seconds: player fire
  is ~140 dps a hunter. 4× (+1.5× per extra hunter) is a warlord's pool (a
  warlord is 5× unscaled). The test bots out-aim people, and still take ~6 s;
  humans dodging his volleys and chasing his hops should take 20–40 s.
- **Net at half** — a net that takes him at full health made the duel two
  button presses. At half, the choice is the section's: shoot him down to half
  (−15%), or go in by hand for free and risk his volleys.
- **Hand reach 3.6 m** — generous enough to include lunges and point-blank
  fire, which is what "take him by hand" feels like.

## Shared-file changes

- `src/enemies/enemy.ts` — one new field and two small, commented blocks:
  `Enemy.scripted: { drive?, hurt? } | null` (null everywhere outside a
  section). In `update`, right after the arrival branch: if `scripted.drive`
  returns a pose (`'ground' | 'air' | 'still'`) the AI is skipped for the frame
  but timers, pose and visuals run. In `damage`, first thing: `scripted.hurt`
  sees the hit and returns the damage that lands (0 = swallowed). Inert when
  null. `test-hits`, `test-arrivals`, `test-modes` run against it.
- `src/text.ts` — only the `TEXT.sections['mark-runs']` block.
- `src/sections/index.ts`, `src/sections/ids.ts` — one line each.

## Tests

- `CHROMIUM_PATH=/opt/pw-browsers/chromium HARNESS_PORT=4217 PLAYERS=1|2|4 node tools/test-sections.mjs mark-runs`
  — passes at 1, 2, 4 (mixed `din,maul,armorer,jedi`), ~62–67 s simulated,
  0 deaths, nobody outside.
- `HARNESS_PORT=4217 node tools/test-section-mark-runs.mjs` — 22 checks:
  escape distance/time at 1p and 2p, that he only escapes after the full clock
  and restarts on the checkpoint roof and runs again; the fork rule both ways;
  a blaster hit staggers and costs, a hand staggers free, a removal-sized hit
  (the harness cull) does nothing; a net stops him in the chase; the duel
  starts at the end of his route, the sign drops, a net at full only holds
  him, under half takes him alive and out of the fight, the stair then carries
  the run on; shot dead is a clear at a cost; a fall re-forms on a roof.
- `tools/probe-mark-runs.mjs [seconds] [every]` — prints the runner, phase and
  party every few seconds while the autopilot plays (tuning aid).

**The harness cull.** `test-sections` kills every team-1 hostile each second
with a 9,999,999-damage hit from slot 0. The mark is the objective, not a
hostile, so `hurt` ignores any hit ≥ 5,000 (no weapon in the game comes close);
the autopilot has to actually net him on the pad.

**Autopilot.** Follows his route with a cursor per bot (even slots take the
first way at a fork, odd the second, so the fork rule is exercised), re-synced
to the roof underfoot after a respawn or fall. Over a gap it holds height over
both ends until it is over the far roof and aims 4 m past his landing (a
super-jumper takes 2 m more). Grabs the rack first. On the pad it shoots him
to half, then fires nets; after the capture it walks into the stair.

## Known issues / notes for others

- Booting straight into a section with `?section=` shows the campaign's guide
  beacon for the first second (the `Campaign` constructor lights it before the
  first fighting frame updates it). Framework, not this section; harmless.
- No authored models are requested for this section; the only asset is
  `rooftop.jpg` (requested in `ASSETS_IMAGES.md`), used through `ctx.tile` —
  the roofs are a flat grey membrane until it lands.
- Nets are a section-local projectile (not the projectile pool), so they do
  not deflect off shields.

- Once the section is complete `contains` answers true: the campaign moves
  the party into the next stage during the transit while the section object
  still stands, and the suite's once-a-second sample could land on that frame.

## What is left

- **Tram Top** — needs K1 and K2 merged into
  `claude/level-design-gameplay-sections-koa6ye`; then merge that branch here
  and build it (street run, gantries with the roof crouch, the station stop,
  the tunnel through the car interiors, the rival tram).
