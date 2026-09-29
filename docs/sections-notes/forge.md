# Great Forge — Hold the Forge and Covert Sky (team `forge`)

Branch `claude/sections-forge`. Owner of kits **K5 objective bar**
(`src/sections/kit/objective.ts`) and **K7 flight** (`flightMove` in
`src/sections/kit/locomotion.ts`).

Run order on the Great Forge (`SECTION_PLACEMENT`, unchanged):
A glassed plain → B undercroft / armoury vault ⇒ **Hold the Forge** ⇒
**Covert Sky** ⇒ C glassed court → forge steps → sleeper's basin.

## State

| Section | Built | Suite (1 / 2 / 4 players, mixed chars) | Mechanics test |
|---|---|---|---|
| `hold-the-forge` | yes, registered | pass / pass / pass | `tools/test-section-forge.mjs` pass |
| `covert-sky` | yes, registered | pass / pass / pass | same file, pass |

Simulated times with the suite's once-a-second cull (the forge run includes
the Covert Sky run after it, since the forge's next stage is a section):
forge ≈ 219 s solo / 260 s at 2 / 274 s at 4; sky alone ≈ 71–79 s.

## Hold the Forge (`src/sections/hold-the-forge.ts`)

**Continuity.** Starts inside the armoury vault's far passage (the south
tunnel), the round beskar vault door shut behind the party. The hall is 50 m
across (R = 25), walled in the same carved relief as the undercroft
(`forge_relief`), with an open shaft (r 9) over the dais. Three tunnels (N, E,
W) come in; each ends in darkness, so they read as ways in for *them*.
Ends with the party gathered on the dais under the shaft, which is where
Covert Sky begins.

**How it plays.**
- *Breath* (12 s, 10 solo): "Raise shields · hold Y". Six glowing sockets
  round the dais at 12.5 m, two facing each wave tunnel. Hold Y 1.2 s to raise
  a 3 × 1.2 m beskar shield (solid; blocks bolts). Three may stand at once for
  the party; a fourth folds the oldest. Re-placeable at any time.
- *The forging* (K5 `Progress`): 165 s at 2 players, 180 at 4, 120 solo.
  **Stalls** while any hostile is within 6 m of the Armorer. **Half speed**
  with a bellows broken. Quarter marks announce.
- *The Armorer* (K5 `DefendTarget`): an ally body on the escort AI, anchored
  to her post by the anvil (not to a player), leash 2.6 m so she never leaves
  the dais; target weight 2.6 (hostiles read her as 2.6× nearer). While
  nothing is within 8 m she is pinned at the anvil hammering (melee clip,
  sparks, a steel clang). HP 900 / 1100 / 1400 (1 / 2 / 4+ players), regen
  18/s while clear. If she falls: forging back to its last quarter mark, she
  re-forms at the anvil 10 s later.
- *Bellows*: two, flanking the fire. A hostile within 2.6 m wears one down
  (10 HP/s each, 100 HP). Broken: it droops, the forge light dims, the banner
  says so, HUD/objective point at it. Hold Y 4 s (3 solo) to mend.
- *Waves*, by progress, each announced 3 s ahead by its tunnel mouth burning
  red: 0% N; 17% E; 34% W + drones down the shaft; 52% N+E; 72% all three +
  drones + the **Alamite Chieftain** (promoted alamite, boss bar via
  `game.boss`). Solo: 0 / 20 / 40 / 58 / 76%, single tunnels. Squads come
  from the board's own wave table (`ctx.squadFor`).
- *Climax*: the forging completes only when the bar is full **and** the final
  wave (with the chieftain) is down.
- *Reward*: "This is the Way — beskar for each of you: +25 max health for the
  run", then the boosters appear on the anvil ("The boosters are forged —
  flight-rated, the shaft is the way out"). Objective: gather at the forge.
  Completes when every living hunter is on the dais (or 16 s).

**+25 max HP for the run.** `Player.maxHpBonus += 25; maxHp += 25; hp = maxHp`.
Player objects live for the whole match (`Game.start`), `spawnAt` refills to
`maxHp`, the campaign's respawn sets `hp = maxHp * 0.8`, and `morph` now
rebuilds `maxHp` as `profile.maxHp + maxHpBonus`, so it survives stage
changes, deaths and body swaps. Verified in the mechanics test (a death in the
forge, the stage change, a death in Covert Sky).

## Covert Sky (`src/sections/covert-sky.ts`)

**Continuity.** Starts on the forge's dais at the foot of the shaft
(brazier glowing, carved shaft walls, a coin of sky). The shaft is 44 m to
the city floor (G). Ends through the dome's breach, into stage C's glassed
court inside the dome ring.

**How it plays.**
- *Flight* (K7): "Fly — Hold A to fly · LB boost · Y dive" banner at 2.5 s,
  and the same line on the HUD until the second ring.
- *Rings*: 10 plus the breach, along a 1.15 km line. Each flown through is a
  checkpoint (`ctx.checkpoint`), a boost (32 m/s for 0.6 s) and, from ring 2,
  a drone pair ahead (capped at 2 + party alive). The next ring pulses; rings
  behind a live flak screen are dark red.
- *Flak towers* ×3 (after rings 3, 6, 9): the gun traverses to track, fires
  every 2.6 s (3.3 solo, a little faster with more players) at someone
  approaching within 170 m: a red tracer, a red wireframe marker swelling
  where it will burst (1.4 s), then a 6.5 m burst for up to 26. Kill it by
  landing on the roof and holding Y 3 s at the socket (charge, 2.5 s fuse,
  "clear the tower"), or two rockets into the breech (a breakable whose HP is
  healed every frame; only hits of 40+ in a frame count, so bolts do nothing).
  Alamites hold each roof: 2/3/4 (+1 per two players), 1/2/3 solo.
- *Flak screen*: a red curtain across the whole sky 45 m past each live gun.
  Touching it: 18 damage and thrown back to the ring before the gun, with the
  banner "Flak screen — silence the gun on the tower first".
- *The breach*: opens when the last gun falls ("The breach is open — dive
  into the dome"). The dome is solid except within 15 m of the breach.
- *Off-path*: below G + 8 (the cloud deck's underside) outside the shaft,
  **the updraft** catches you: back at the last ring, in the air, thrown up,
  banner "Caught by the updraft — below the rooftops the city throws you back
  up". No damage. (`offPath` itself is only a backstop far below.)
- *Edges*: the ruin ridge — a chain of spires either side and behind, every
  one taller than the lid (G + 88) — the lid, the cloud deck, the dome.

**The city** is seeded (same every run). Towers are kept 13 m clear of the
golden path's segments unless well below them, so the ring line is always
flyable. Drawn as five merged meshes (stone, roofs, ridge, glass, bays) with
world-scaled UVs; every solid box keeps its own collider.

*Tower polish (2026-09-28, orchestrator's review).* The first pass had plain
boxes with full-height emissive green panes that read as neon bars. Now:
- **Silhouettes**: most towers step out to a wider podium (the old street
  storeys) and carry a broken crown, a narrower tier on three of four
  quarters with one fallen, or broken corner piers where no tier stands.
  Neighbours of a height are joined by rib-bridges over broken arches.
- **Window bays**: dark recesses in rows up the faces toward the approach
  and the city's middle, about one in five missing; sparser on the ridge.
- **Fused glass** is a muted green-grey glaze (`0x55655d`, faint emissive,
  low roughness, metallic, opaque): slumped skirts and a pooled lip at each
  tower's foot above the cloud deck, and a low glassy mound where a crown
  quarter fell. No panes.
- **The ridge** spires are staggered back from the edge (a low wall fills
  each notch at the cloud line), so the edge reads as separate towers.
- **Textures**: stone is `cliff_ruin` (+ normal), overridden by
  `ruin_tower` / `ruin_tower_normal` when those land; missing files are
  harmless (`loadOptionalTexture`).
Flak towers keep plain flat roofs, so the landing reads.

## K5 — `kit/objective.ts`

- `DefendTarget<T>(game, { make, post, leash, weight, reform, regen, threat, onDown, onUp })`:
  `body`, `down`, `crowd` (hostiles within `threat`), `hostilesWithin(r)`,
  `health`, `bar(label, downLabel)`. It sets `body.targetWeight`; `make`
  re-creates the body at the post after `reform` seconds.
- `Progress(seconds, marks = [.25, .5, .75])`: `update(dt, { stall, scale, cap })`
  returns the mark crossed; `setBack()`, `lastMark`, `done`, `bar(label)`.

## K7 — `flightMove(opts)` in `kit/locomotion.ts`

Self-contained block (the Crevasse's `slideMove` lands in the same file).
Goes in through `Player.sectionMove` (compose it with `composeMoves`).
Defaults: top speed 21 m/s airborne, boost 34 m/s for 0.8 s (cooldown 1.4 s)
along the camera's aim, dive −26 m/s, glide fall capped at −6 m/s. Fuel is
held full. Super-jumpers relight the rise mid-air and show a plume.
`boost(p, dir, speed, secs)` for rings; `release(players)` on dispose.

## Shared-file changes (all small, commented blocks)

- `src/player/player.ts`
  - `flightTopSpeed: number | null` field, and one line in `updateGroundMove`
    that uses it as the top speed while airborne (K7).
  - `relightRise()` method: a super-jumper's rise re-arms mid-air (K7).
  - `maxHpBonus` field, and `morph` builds `maxHp` as
    `profile.maxHp + maxHpBonus` (the forge's reward).
- `src/enemies/enemy.ts` — `nearestFoe` divides a foe's squared distance by
  its `targetWeight²` when it has one (K5).
- `src/text.ts` — my two `TEXT.sections` blocks only.
- `src/sections/index.ts`, `ids.ts` — my lines only.

Suites run for the shared changes: `test-modes`, `test-allies`,
`test-missions` (see below).

## Tuning, and why

- Forging 165 s at 2 players: long enough for five waves; the stall rule
  makes real time longer. Solo 120 s as the design asks.
- Target weight 2.6: alamites spawned in a tunnel go for her over a hunter
  standing in the way unless the hunter is much nearer — the party has to
  meet them, not wait for them.
- Bellows radius 2.6 m / 10 HP/s: the first pass at 3.2 m / 14 HP/s broke
  both in the first minute solo; now a bellows breaks only when a hostile has
  actually reached it for ~10 s.
- Flak 26 per burst at 6.5 m, 1.4 s flight: a boost (LB) takes you out of the
  marker in time; flying a straight line does not.
- Covert Sky lid G + 88 (lowered from 100) so the edge spires can all stand
  over it without swallowing the sky.

## Known issues / left to do

- The authored models `beskar_barricade` and `flak_tower` are requested but
  not delivered; both ship as procedural stand-ins at the specified size and
  pivot. `ruin_tower.jpg` is requested; the towers fall back to `cliff_ruin`.
- The Armorer is a `marshal` ally body dressed as the Armorer (her own
  character build, hammer in hand) and re-tuned as a melee fighter. If an
  `armorer` ally kind is ever added to `enemy.ts`, `makeArmorer` should use it.
- The chieftain uses `game.boss` for the bar; the board's boss-phase retinue
  call only happens if the run's earlier boss left the phase counter at 0.
- The dome is a translucent shell (no collider mesh; the section pushes
  bodies back out of it).
