# Monster Bosses — design & spec

Six large creature bosses, designed 2026-08-29 as **additional boss battles on top of
the shipped promoted-elite bosses** (docs/MODES.md §4a). Where §4a promotes an existing
humanoid elite, these are the next rung the expansion list asked for — per-boss
movesets, arena hazards tied to phases, and unique models — built as *monsters*: large
creatures inspired by the beasts of the source shows, each matched to the board whose
systems already carry most of its fight. Every design below is an original fan
interpretation; asset prompts describe designs and never name trademarked characters,
per the standing rule in `ASSETS_IMAGES.md`.

**Status: all six models delivered and in the game; the fights are at v1.** The
sculpts landed on 2026-08-29 and each is now a real boss battle — see §4 for exactly
what of the design below is standing and what is not. In short: every monster spawns
as the second, final stage of its board's boss fight, at the health and damage
specced here, with the entrance card, the boss bar, the phase turns, the retinue
calls and the enrage; the bespoke movesets in §2 (the charge, the ice-burst, the
breach, the grab, the inhale) are **not** implemented, and each monster fights with
its own melee inside the shared boss rhythm.

---

## 1. Where they sit in the game

The promoted-elite bosses stay exactly as shipped — these are **added on the six boards
that have a monster**, as a second, final stage:

- **Wave Battle:** clearing wave 10 rings in the boss wave as today. On a monster
  board, the promoted elite falling is not victory — a short quake-and-roar beat
  (~4 s, screen shake + the board's monster tell) and the monster erupts with its own
  entrance banner and boss bar. Victory when it falls. Boards without a monster
  (Refinery, Ringworld, Prison Rig) end at the elite as today.
- **Campaign:** the final arena plays the same two-stage fight; the elite becomes the
  monster's herald. Checkpoint at the last waypoint covers both stages.
- **PvP:** untouched. Monsters are not playable (same reasoning that excluded the
  interceptor drone — a boss moveset isn't a fighter).

One system serves all six, layered on what §4a built: a monster is an `EnemyKind`
spawned with boss stats (its `Def` *is* boss-scale — `promoteBoss(name, 1, 1, 1)`
attaches the banner/bar without re-scaling), `relentless`, immune to knockdown and
morale, with retinue calls at ⅔ and ⅓ health through the existing `BOSS_RETINUE`
path. Each monster adds one or two bespoke moves; everything else rides systems the
boards already run (hazard zones, breakables, movers, traction, the water system, the
light field, `spawnOnHurt`).

### Roster at a glance

| Board | Id | Banner | HP | Hit | Size | Board system it leans on |
|---|---|---|---|---|---|---|
| Waystation | `mudhorn` | THE SMUGGLERS' PRIZE | 2600 | 40 | 2.6 m shoulder | platform edges, breakable crates |
| Crevasse | `ravinak` | THE ICE-BREAKER | 3000 | 40 | 8 m long | traction (ice), hazard zones |
| Trask | `mamacore` | THE MAMACORE | 3400 | 50 | 12 m long | water system, heaving movers, the existing mamacore pool |
| Nevarro | `rancor` | THE WARLORD'S RANCOR | 3600 | 45 | 5 m tall | town furniture (gate, towers), breakables |
| Dune Sea | `krayt_dragon` | THE OLD ONE OF THE DUNE SEA | 5200 | 45 | ~40 m (18 m surfaces) | heightfield dunes, sarlacc kill zone, burn pools |
| Great Forge | `mythosaur` | THE SLEEPER BELOW | 5600 | 50 | ~12 m surfaces | Living Waters pool, light field, the existing eye/skull event |

Player HP is 100 throughout; hit numbers are per connected swing/bite before the ×1.5
§4a damage scale is considered (it is not applied — these numbers are final). For
scale: the broodmother enters her §4a boss fight at ~2500 HP, the Wookiee enforcer's
base hit is 34.

**Weak points** are the shared vocabulary of the set: every monster has an armored
default body (bolts do ×0.5 there — a sponge by design) and one or more glowing or
fleshy weak zones (×2) that its moveset exposes in windows. The HUD hit-marker's
crit color reads the ×2 hits, so the lesson teaches itself. Weak zones are named
nodes on the model (the broodmother's `sac1..3` precedent) so the game can attach
hit volumes and emissive pulses to them.

---

## 2. The six fights

### 2.1 Mudhorn — Waystation — `mudhorn`

**The creature.** A hulking woolly horned beast, 2.6 m at the shoulder and 4.5 m long
— a one-horned rhinoceros build under a coat of shaggy matted dark-brown wool, cloven
hooves, small furious eyes. The Pykes were smuggling it through the waystation in a
cargo container; the boss beat *is* the container breaking open.

**The fight.** Arena is the main cargo deck. The comedy and the danger are the same
thing: a charging quadruped on a floating platform board.

- **Charge** — its signature. 1 s telegraph (head down, hoof scrape, bark of steam),
  then a straight-line charge at ~16 m/s. Being hit is 40 damage and a *huge* flat
  knockback — on this board that means being launched over an edge, and the jetpack
  recovery is the fight's drama. The charge smashes any crate in the line (existing
  breakables path) — it eats the arena's cover as the fight runs.
- **Overrun** — a charge that misses skids 4–6 m. If the skid ends in a crate stack
  or the crane mast, the mudhorn is **stunned 3 s, head down** — the punish window,
  and the fight's lesson: bait the charge through your cover into something solid.
  Weak zone: the nape under the horn boss (`nape`), exposed only in the stun.
- **Horn toss** — inside 3 m it hooks upward: 30 damage and a vertical launch
  (slam-bait; a read player answers with the slam).
- **Stomp** — a player who slams within 6 m of it gets a counter-shockwave (ring
  knockback, 20) so slam-spam doesn't trivialize it.
- **Phases** — ⅔ and ⅓: bellows, calls pirate retinue (its would-be handlers; they
  are team 1 and just as happy to shoot the player). At ⅓ it enrages: charges come
  in committed pairs with only the short skid between.

**Integration notes.** Pure massiff DNA: `style: 'melee'`, `relentless`, the charge
is the pounce gate re-aimed along the ground. Quadruped rig through `loadCreature`
with code clips in `src/anim/quadruped.ts` style. Nodes: `head, jaw, horn, nape,
legFL/FR/BL/BR, tail1..2`.

### 2.2 Ravinak — Crevasse — `ravinak`

**The creature.** An 8 m tusked leviathan built like an armored walrus-crocodile:
blunt whiskered snout, two great down-curved ivory tusks, slate-grey blubbered hide
with barnacled plates down the back, four broad clawed flippers, a heavy tapering
tail. It lives *under* the crevasse floor the players fight on — the ice is its roof.

**The fight.** Arena is the frozen floor between the walls. It is never entirely
present: it ambushes through the ice and hauls out to brawl, and every hole it makes
stays in the arena.

- **Ice-burst ambush** — a cracking line races under the ice toward a player
  (audible + a running crack decal, ~1.5 s), then it erupts: 40 damage, knock-up,
  and a permanent hole — a circular hazard zone of freezing water (damage over time,
  survivable, swim out — the existing zone machinery with the water system).
- **Tusk sweep** — hauled out, a 180° close sweep, 40 damage, long reach (4 m).
- **Bellow** — shakes icicles from the crevasse walls: 4–6 falling spikes at marked
  shadow decals, 25 each. Fills the mid-range the sweep can't.
- **Beached lunge** — a long belly-slide across the ice at a distant player, riding
  the board's low-traction system (it slides like the players do). Afterwards it is
  **beached for 3 s** — weak zone: the pale throat (`throat`), ×2, only readable
  from the front, which is exactly where you don't want to stand when it recovers.
- **Phases** — ⅔ and ⅓: krykna pour from the ambush holes (retinue). At ⅓ it
  shatters the arena's center — one big hole, the fight now ringing open water.

**Integration notes.** Submerged/emerged is a two-state machine like the mamacore
hazard's, but targetable when out. `loadCreature`, nodes: `head, jaw, tuskL/R,
throat, flipperFL/FR/BL/BR, body1..3, tail`.

### 2.3 Mamacore — Trask — `mamacore`

**The creature.** The thing that has been under the pier all along — the board's
existing timer-driven kill hazard, finally surfacing. A monstrous deep-harbor fish,
12 m long: a cavernous circular mouth ringed with needle teeth, barbels trailing from
the jaw, scarred storm-grey mottled hide, rows of pale gill frills that glow when it
works them, stubby side fins, a broad eel tail, small milky eyes.

**The fight.** Fought from the trawler decks and the quay — the monster never fully
leaves the water. The heaving movers, the squall and the pool are already the arena.

- **Circling wake** — its telegraph language: a dorsal wake circles the trawler and
  tightens on the gunwale lane it will hit next.
- **Breach bite** — it arcs over a deck edge, jaws first: a marked lane across the
  deck, 50 damage, debris splinters. During the breach the **pale belly** (`belly`)
  is the ×2 weak zone — the reward for standing your ground in the next lane over.
- **Wave slam** — a tail slap sends a wash across the whole deck: sweeping knockback
  (10 damage, but the deck edge is the real threat) — jetpack over it. For 4 s after,
  the **gill frills** (`gills1..3`) glow and take ×2.
- **Drag-under** — the existing hunt-by-the-clock rule runs during the fight, but the
  boss-fight version is a *grab*, not the kill zone: the grabbed player is carried,
  taking 15/s, and shooting the mamacore's gills breaks the grip — the co-op moment.
- **Ram** — below ⅔ it rams whichever trawler holds the most players; that mover
  lists a further 6° for 10 s (the movers already heave — this is a bias on the same
  system).
- **Phases** — ⅔ and ⅓: quarren retinue swarm the quay — the dock hands feed the
  thing, and they'd rather feed it *you*. At ⅓ it beaches its forebody on the quay
  for a standing jaw phase: the biggest damage window in the fight, with its bite
  covering the whole quay while it lasts.

**Integration notes.** Builds directly on `src/world/trask.ts`'s pool, timer and
roar audio (`mamacore_roar` is already a sample id). The kill zone converts to the
grab for the duration of the fight. `loadCreature`, nodes: `head, jaw, belly,
gills1..3, body1..5, finL/R, tailFin`.

### 2.4 Rancor — Nevarro — `rancor`

**The creature.** A towering hunched reptilian brute, 5 m tall: massive long-clawed
arms longer than its legs, a flat wide skull with an underslung tusked jaw, deep-set
eyes, leathery umber-brown hide creased with old fighting-pit scars, a short heavy
tail. The garrison commander's pit monster, loosed on the town when the garrison
falls.

**The fight.** Arena is the town square inside the adobe gate; the towers, gate and
market furniture are the cover — while they last.

- **Claw combo** — two lateral swipes and an overhead smash, each a stepped advance;
  45 damage a hit. The smash breaks any breakable it lands on.
- **Debris hurl** — it tears a chunk from the nearest structure and throws it: a slow
  arcing projectile (dodgeable on read), 40 damage in a small ring — and the rubble
  persists as a chest-high cover collider, so the fight *creates* cover as it
  destroys it.
- **Grab** — a short lunge; a caught player is squeezed (15/s, max 3 s) and hurled.
  Dash i-frames beat the lunge; a jetpack burn (heavy fuel drain) breaks the grip
  early. The one genuinely new mechanic in the set — if it slips, the v1 fallback is
  a heavy two-hand slam with the same telegraph.
- **Leap-slam** — it jumps at a distant target and lands in a ring shockwave (35 +
  knockback). Its hands stay planted for 2.5 s after — the punish window: the
  **head** (`skullSoft`, behind the jaw hinge) takes ×2 while planted.
- **Phases** — at ⅔ it mounts the gate lintel and roars the retinue in (pirates); at
  ⅓, blind rage: 1.3× move speed, combos run a third swipe, and it no longer
  telegraphs the grab with a bellow — only the crouch.

**Integration notes.** The set's only biped-ish monster; still `loadCreature` on its
own rig (arms are load-bearing, the canonical rig fits none of it). Nodes: `head,
jaw, skullSoft, spine1..2, armL/R upper/fore/hand chains, legL/R chains, tail1..2`.

### 2.5 Greater Krayt — Dune Sea — `krayt_dragon`

**The creature.** A colossal burrowing desert dragon, ~40 m nose to buried tail, of
which the front ~18 m ever surfaces: a broad flat skull with a tooth-crammed jaw,
four small pale eyes, a frilled bone collar, ringed armored neck, two clawed
burrowing forelimbs, a serpent body ridged with sand-worn plates in bone-white and
ochre. Deep in its open gullet, an amber glow — the pearl.

**The fight.** Arena is the open dune bowl between homestead and camp; the sarlacc
pit stays live and matters.

- **Sand swim** — submerged travel as a running dune wake plus rumble; untargetable
  under the sand. This is its neutral: the fight alternates wake-reading with
  surfaced brawling.
- **Eruption** — the wake converges on a player, sand boils (~1.2 s), and it breaches
  under them: 45 damage in a 6 m ring plus a violent knock-up.
- **Acid spit** — surfaced, it lobs 3 venom globs in a fan; each leaves a burn pool
  (~8 s) on the existing burn-zone machinery. The pools herd — the real attack is
  where they force you to stand.
- **Inhale** — its signature and its undoing. It rears, jaws wide, and *inhales*:
  a suction cone dragging players toward the mouth at up to 10 m/s (fight it with
  movement; being swallowed is 70 and spat out). While it inhales the **gullet**
  (`gullet`, emissive) is exposed — and a **rocket (Q) into the gullet detonates
  inside**: 10× rocket damage and a long stagger. The fight's legend — the arena's
  Tusken survivors say it can be killed from within, and the mechanic pays it off.
- **The sarlacc** — bait an eruption inside the sarlacc's ring and the pit answers:
  tentacles seize the krayt for 8 s of pinned bonus time, once per phase. Two
  monsters, one grudge.
- **Phases** — ⅔ and ⅓: it dives and runs an eruption chain (three quick breaches on
  three players' positions), and the dunes disgorge a massiff pack as retinue.

**Integration notes.** Only the forebody is ever modelled or simulated; the taper
sleeves into the sand. Submerged state reuses the ravinak pattern at scale; the
inhale is a radial force on player velocity (the physics is a wind, not an
animation). `loadCreature`, nodes: `head, jaw, gullet, collar, neck1..4, clawL/R,
body1..6`.

### 2.6 Mythosaur — Great Forge — `mythosaur`

**The creature.** The payoff of the board's standing mystery: the half-buried horned
skull at the rim of the Living Waters, and the glowing eye that already surfaces when
the rumble comes. The living animal matches its own relic — a broad skull with two
great down-swept horns, a tusked underbite, glowing pale eyes, ridged black-green
hide streaked with mineral scale, heavy neck plates, powerful clawed forelimbs.
Perhaps 30 m of animal; the fight ever sees ~12 — head, neck and claws above the
water.

**The fight.** Arena is the dais and the pool rim. It rises out of the existing
eye-glow event, and it is the set's one boss that is not slain — at 0 HP it breaks
off, bellows, and sinks: **DRIVEN BACK TO THE DEEP**. (No ragdoll: a bespoke exit on
the same death-credit path.)

- **Bite lunge** — a fast strike at anyone holding the rim: 50 in a lane.
- **Horn sweep** — the head sweeps the dais arc, 45 + knockback toward the water.
- **Geyser dive** — it submerges and the pool answers: 5–7 geyser rings telegraph on
  the rim floor, then erupt as knock-up columns (30). Its re-emergence point is the
  last geyser — the tell that brings it back into the fight.
- **Deep bellow** — the darkness beat. The board's light field dies to ember glow for
  6 s — the brazier, the players' jets, and **its eyes** are the light there is — and
  it lunges once in the dark, telegraphed by audio alone (the swelling water-rush;
  the audio system's stereo pan carries the direction).
- **Weak zones** — the horns and skull plates *deflect* (×0, sparks — the armor
  lesson taught loudest). The **eyes** (`eyeL/R`, emissive) are ×2 always; the
  **throat gill-vents** (`vents1..2`) open and take ×2 for 4 s after every bellow
  and geyser dive.
- **Phases** — ⅔ and ⅓: alamites swarm from the galleries (retinue). At ⅓ it hauls a
  foreclaw onto the dais and holds it there: continuous slow claw sweeps rake the
  dais while the head fights on — the arena's safe ground halves.

**Integration notes.** Anchored to the pool exactly as the event is
(`src/world/forge.ts` owns the eye, rumble and skull; the fight replaces the event's
timer with an encounter). Deflect zones are hit volumes returning the spark FX with
zero damage. `loadCreature`, nodes: `head, jaw, hornL/R, eyeL/R, vents1..2,
neck1..4, clawL/R, back`.

---

## 3. Shared implementation ledger

What the six fights need beyond what ships today — kept honest so the gameplay round
is scoped before it starts:

| Piece | New or reuse | Notes |
|---|---|---|
| Boss-stat spawn + banner | reuse | `Def` carries final stats; `promoteBoss(name, 1, 1, 1)` for banner/bar |
| Two-stage boss wave | new (small) | elite death → quake beat → monster spawn; one branch in the §4a flow |
| Retinue at ⅔/⅓ | reuse | `BOSS_RETINUE` gains per-monster overrides (massiff, krykna, quarren, pirate, alamite) |
| Submerged/emerged state | new (shared) | one state machine serves ravinak, mamacore, krayt, mythosaur |
| Line charge + skid stun | mostly reuse | massiff pounce gate re-aimed; stun timer on wall/breakable hit |
| Lobbed projectile + burn pool | reuse | grenade-arc math + existing burn zones (krayt spit) |
| Suction cone (inhale) | new (small) | radial force on player velocity, capped |
| Grab-and-carry | new (risky) | rancor + mamacore share it; v1 fallback is a heavy slam |
| Weak/deflect hit volumes | new (shared) | sphere volumes on named nodes; ×2 / ×0.5 / ×0 damage taps into the one hit pipeline |
| Persistent arena holes/rubble | reuse | hazard zones (holes) and a spawned collider (rubble) |
| Darkness beat | reuse | the forge light field already dims for its event |
| Monster gaits | reuse pattern | code clips against own rigs, `quadruped.ts` style; clips shipped in a .glb win, as everywhere |

### What v1 actually implements

| Piece | State |
|---|---|
| Six monsters as `EnemyKind`s at the specced HP/damage, `relentless`, boss-scale `Def` | **done** |
| Two-stage boss wave: warlord falls → 4 s quake → monster erupts, victory only when it falls | **done** (`Game.updateMonsterStage`, shared by the wave game and the campaign arena) |
| Entrance card, boss bar, phase turns at ⅔/⅓, repulsor pulse, enrage, anti-camp shock-slam | **done** — reused wholesale from §4a |
| Per-monster retinue (pirate, krykna, quarren, pirate, massiff, alamite) | **done** (`MONSTER_BOSS[board].retinue`) |
| Models: `loadCreature`, own rigs, code gaits against the delivered node names | **done** (`src/anim/quadruped.ts`) |
| Half-buried colossi: krayt and mythosaur sunk and reared, ground thrown where the body passes | **done** (`buried` and `plows`) |
| Prefetch: the monster warms with the board's other two bosses | **done** |
| The §2 movesets — charge/skid-stun, ice-burst, breach bite, debris hurl, grab, inhale, sarlacc bait, darkness beat | **not implemented** |
| Weak/deflect zones (×2 / ×0.5 / ×0 on the named nodes) | **not implemented** — the sculpts ship the nodes, so this is the natural next round; until then a monster takes normal damage everywhere, which is why the specced HP still reads right |
| Submerged/emerged states, arena holes, persistent rubble | **not implemented** |

The order matters: the weak zones are the set's shared vocabulary and want the
multi-volume hit pipeline the ledger above calls "new (shared)"; the bespoke moves sit
on top of that. Neither is blocked on art any more.

**Audio** follows the boss-voice precedent in [`ASSETS_AUDIO.md`](ASSETS_AUDIO.md):
each monster wants a roar/hurt/death set (sample ids `<id>_roar` etc., the
`mamacore_roar` pattern) with the synth beast voices standing until samples land.
Those requests are deferred with the fights, same as the humanoid boss voices.

**Asset order of work** is the standard pipeline: reference sheet → model →
gameplay. The sheets are the blocking input; both request docs carry the monster
batch as of 2026-08-29.
