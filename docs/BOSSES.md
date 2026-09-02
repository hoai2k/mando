# Monster Bosses — design & spec

Ten large creature bosses — six designed 2026-08-29, four more on 2026-09-02 — built
as **additional boss battles on top of the shipped promoted-elite bosses**
(docs/MODES.md §4a). Where §4a promotes an existing
humanoid elite, these are the next rung the expansion list asked for — per-boss
movesets, arena hazards tied to phases, and unique models — built as *monsters*: large
creatures inspired by the beasts of the source shows, each matched to the board whose
systems already carry most of its fight. Every design below is an original fan
interpretation; asset prompts describe designs and never name trademarked characters,
per the standing rule in `ASSETS_IMAGES.md`.

**Status: the first six models are delivered and in the game; the four of the second
batch (§2.7–2.10) are in the game as procedural stand-ins with their sheets and
models requested; the fights are at v1.** The first sculpts landed on 2026-08-29
and each is a real boss battle — see §4 for exactly what of the design below is
standing and what is not. In short: every monster spawns as the second, final stage
of its board's boss fight (the worm as the Dune Sea's champion instead), at the
health and damage specced here, with the entrance card, the boss bar, the phase
turns, the retinue calls and the enrage; the bespoke movesets in §2 (the charge, the
ice-burst, the breach, the grab, the inhale) are **not** implemented, and each
monster fights with its own melee inside the shared boss rhythm — except the worm,
whose burrow cycle (§2.7) *is* implemented, since it is the whole creature.

**One monster per territory, and no monster serves two (2026-09-02).** The roster
was audited for duplicates: the six finals were already distinct, but the Refinery,
the Ringworld and the Prison Rig had no monster at all, and the war massiff was the
promoted champion of both the Dune Sea and the Lava Flats. The second batch fixes
both — a monster final for each of the three, and the Dune Sea's champion is now its
own creature, the worm, which leaves the massiff to Nevarro. Every creature that
holds a boss slot anywhere is now unique to its board: sandworm and krayt (Dune Sea),
mudhorn (Waystation), massiff and rancor (Lava Flats), krykna and ravinak (Crevasse),
mamacore (Trask), zillo (Refinery), alamite and mythosaur (Forge), nexu (Ringworld),
kwazel maw (Prison Rig). The humanoid warlords still share kinds across boards
(three officers, two capos, two enforcers) — they are promoted elites, not monsters,
and were outside the audit.

---

## 1. Where they sit in the game

The promoted-elite bosses stay exactly as shipped — these are **added on the six boards
that have a monster**, as a second, final stage:

- **Wave Battle:** clearing the final wave rings in the boss wave as today. The
  promoted elite falling is not victory — a short quake-and-roar beat (~4 s, screen
  shake + the board's monster tell) and the monster erupts with its own entrance
  banner and boss bar. Victory when it falls. Every territory has a monster now
  (the Refinery, the Ringworld and the Prison Rig joined on 2026-09-02).
- **The champion's slot** can hold a monster too: the Dune Sea's mid-board battle is
  the worm (§2.7), spawned through the same `MID_BOSS` promotion with scale 1 like
  the finals, so its `Def` is champion-scale by construction.
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
| Dune Sea (champion) | `sandworm` | THE HUNGER UNDER THE SAND | 2000 | 36 (eruption 30) | ~40 m, 5.5 m reared | heightfield dunes, the burrow cycle (implemented) |
| Refinery | `zillo` | THE SPECIMEN | 4200 | 45 | 5 m shoulder, 12 m long | rhydonium barrels, alarm consoles, the reactor shaft |
| Ringworld | `nexu` | THE NIGHT-SIDE STALKER | 2800 | 36 | 2.2 m shoulder, 5 m long | the terminator's light field, the tram, street cover |
| Prison Rig | `kwazelMaw` | THE THING IN THE MOON POOL | 3800 | 48 | 4.2 m tall, 9 m long | the moon pool, the water system, the shock floors |

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

### 2.7 Dune Worm — Dune Sea, the champion — `sandworm`

**The creature.** A burrowing worm of the deep dunes, forty metres of it, of which
only the head and the first five and a half metres of neck ever stand out of the
sand: a blunt eyeless dome of a head split three ways by mandibles that spread
around a ringed, tooth-lined gullet, an armored neck of overlapping bone-pale plates
over sand-ochre hide, and behind it a body that shows itself only as **arches** —
humps of plated back that rise out of the dunes along the path the head has taken
and sink again, so the animal reads as forty metres long whether the head is up or
not. It is the desert's fast hunter where the krayt is its slow inevitability; a
Tusken chant calls it the hunger under the sand, and the tribes follow the wakes.

**The fight — implemented (2026-09-02).** Arena is wherever the wake goes; the whole
fight is the **burrow cycle**, which is the creature's only design and the set's
first bespoke moveset to ship:

- **Under** — submerged, it hunts at 9.5 m/s: a running wake of thrown sand (the
  `plows` dust), a sub-bass rumble that comes and goes, and a radar blip. It is
  **untargetable and unhurtable** down there — bolts pass over the wake, the
  lock-on finds nothing, explosions and slams do not reach it — which is the fight's
  lesson: the worm has to be hurt while it is up. It comes up once it is within 5 m
  of its prey, or after 9 s under wherever it is.
- **Rising** (0.9 s) — the sand boils and the cameras nearby shake; the head unit
  climbs out of the ground. Targetable from the first frame of the rise.
- **The eruption** — as it breaks the surface, everyone within 6 m takes 30 and is
  thrown up and out; every camera within 24 m feels it. The wake is the telegraph:
  the hit is the cost of standing on it.
- **Up** (7 s) — rooted where it surfaced, it turns to follow its prey and **bites**
  anything within 6.5 m for 36 through the ordinary melee wind-up. If the prey gets
  well out of reach it does not wait out its spell — after 2.5 s up with nothing
  within 1.8× reach it sinks early and hunts.
- **Sinking** (0.8 s) — back under, and the cycle repeats.
- **The arches** — humps of body break the surface behind the head and sink again,
  so forty metres of animal read whether the head is up or not. Cosmetic for now: no
  collision and no hit volume, since the head is the fight.

  **How they are built is changing (2026-09-02).** What ships today is three separate
  `sandworm_arch` props placed along a trail of where the root has been, each on its
  own rise-and-sink beat. The accepted replacement is **one continuous body**: a
  single forty-metre sculpt whose spine chain the game lays along that same trail,
  with a travelling wave deciding which stretches are above the sand. That makes the
  humps the same animal as the head, keeps them attached through the worm's turns,
  removes the cut faces the prop has to hide, and gives the exposed coils real nodes
  to hang weak points on later. It costs a per-frame chain solve in `cosmetic`, and a
  sculpt modelled dead straight rather than pre-reared — which is why the reference
  canvas is being regenerated (`ASSETS_IMAGES.md`) and the `sandworm_arch` request is
  withdrawn. Until the straight sculpt lands the arch props stand.
- **Phases** — ⅔ and ⅓ through the shared boss rhythm: the Tusken retinue (the
  board's guard) and the enrage. The anti-camp shock-slam is suppressed while it is
  under — the eruption is its answer to a camper. It never super-jumps (it has no
  legs) and cannot be knocked down.

**Integration notes.** `Def.burrows` carries the cycle's numbers; `Enemy.burrow`
is the state, `Enemy.submerged`/`targetable` gate damage, knockback, knockdown and
the target list. The visual today is two bodies in one `CharacterInstance`
(`buildSandworm`): a `buildMonsterBase` worm for the head unit, sunk whole by
`setBurrow`, and three arch props placed along the root's trail. Under the single-body
replacement above, both collapse into one sculpt and the trail feeds a spine solver
instead. Sculpt: `sandworm`, modelled **straight** along +Z with a chain of 24 or more
evenly spaced spine joints, fitted by length. Nodes: `head, jaw, mandibleL/R/T/B,
gullet, spine1..24`. (The maw is four-way rather than three, matching the delivered
art.)

### 2.8 Zillo — Refinery — `zillo`

**The creature.** The Empire's specimen — an armored reptilian crawler five metres
at the shoulder and twelve long, held in the plant's containment until the garrison
fell: a long flat skull with a lipless underslung jaw, small deep-set eyes, a body
under overlapping slate-green **armor plates** that blaster bolts skate off, three
clawed digits on each of four splayed limbs, a long spined tail. Under the plates,
between them, the pale flesh glows faintly with what they have been feeding it.

**The fight.** Arena is the reactor hall: the barrels are the cover and the trap,
and the shaft is the only way over it.

- **Plate deflection** — its signature (design; not implemented): the plates are
  ×0 deflect zones with the mythosaur's spark FX; the **seams** between them
  (`seams`, emissive) and the **jaw interior** are the ×2 weak zones, exposed when
  it rears to strike.
- **Tail sweep** — a wide slow 180° sweep behind it, 45 + knockback; the reach the
  claws don't have.
- **Barrel rush** — it charges through barrel stacks: rhydonium detonates on the
  existing chain path and it *shrugs it off* (burn-immune by armor), so the
  player's own trap turns on them.
- **Shaft climb** — at ⅓ it climbs the reactor column and drops onto the ring the
  most players hold (the leap-slam pattern), the one moment the seams are open from
  above.
- **Phases** — ⅔ and ⅓: stormtrooper retinue (the containment detail, team 1 and
  shooting at everyone).

**Integration notes.** Quadruped through `loadCreature`; sized to the halls (7.2 m
ceilings). Nodes: `head, jaw, spine1..3, legFL/FR/BL/BR (+_lower), tail1..3,
plates, seams`.

### 2.9 Nexu — Ringworld — `nexu`

**The creature.** A hunting cat the size of a landspeeder — 2.2 m at the shoulder,
5 m long — loosed on the street by the gunslinger's menagerie: a wide split-jawed
head, **four eyes** (two forward, two on the temples), a ridge of red-tipped
**quills** down the spine that rise when it hunts, tawny-and-black hide, long
clawed limbs, a forked tail. The fastest thing on four legs in the game: it
outruns a sprint.

**The fight.** Arena is the street strip under the terminator; the tram runs
through the fight.

- **Pounce** — implemented: the massiff's committed ballistic leap, aimed at where
  the target is headed; a dash or a jetpack hop beats it. 36 + a shove.
- **Night hunter** — (design) it prefers the dark side: sight range does not fall
  with the light on its target the way every other hostile's does, so the safe
  side of the board is not safe from *it*.
- **Roof run** — (design) it takes the tram roof and the kiosk roofs as ground and
  leaps between them, so the street's cover is a lattice it moves over.
- **Weak zones** — (design) the **eyes** (`eyeL/R` pairs, emissive) ×2; the quills
  along the back deflect ×0.
- **Phases** — ⅔ and ⅓: pirate retinue (the menagerie's handlers). At ⅓ the quills
  go up and it enrages: pounces come in pairs.

**Integration notes.** `pounces: true` on the Def generalises the massiff's gate.
Nodes: `head, jaw, eyeL/R, eyeL2/R2, spine1..2, legFL/FR/BL/BR (+_lower),
tail1..2, quills`.

### 2.10 Kwazel Maw — Prison Rig — `kwazelMaw`

**The creature.** The thing the moon pool has been feeding — a huge amphibian, 4.2 m
tall and 9 m long, hauled up out of the sea onto the white decks: a wide flat
toad-like head with a mouth that opens the whole width of it, bulbous side-set eyes,
a long low body on four splayed webbed limbs, a broad rudder tail, slick dark
blue-black hide with **bioluminescent stripes** in cyan running down both flanks
that pulse as it breathes — the one light in the sea under the rig.

**The fight.** Arena is the rig's deck ring around the moon pool; the shock floors
keep cycling, and the sea is its escape.

- **Gulp** — implemented as its melee: the mouth opens the width of the head and
  slams shut, 48 in a 6 m lane.
- **Dive** — (design) below ⅔ it drops into the moon pool (the submerged pattern
  the worm now ships) and resurfaces at a random deck edge; the stripes glow up
  through the water where it will come up — the tell.
- **Tongue lash** — (design) a 12 m tongue snap that pulls a caught player toward
  the mouth (the grab-and-carry piece, shared with the rancor and the mamacore).
- **Shock immunity** — at home in the water and unbothered by the deck charge: it
  is `burnImmune`, and the shock floors' 10-a-beat is nothing to 3800 HP.
- **Weak zones** — (design) the **stripes** (`stripesL/R`, emissive) ×2 while lit;
  they dim for 3 s after each dive.
- **Phases** — ⅔ and ⅓: stormtrooper retinue (the warden's men, who would rather
  it ate the prisoners).

**Integration notes.** Quadruped through `loadCreature`. Nodes: `head, jaw,
body1..3, legFL/FR/BL/BR (+_lower), tail1..2, stripesL/R`.

---

## 3. Shared implementation ledger

What the six fights need beyond what ships today — kept honest so the gameplay round
is scoped before it starts:

| Piece | New or reuse | Notes |
|---|---|---|
| Boss-stat spawn + banner | reuse | `Def` carries final stats; `promoteBoss(name, 1, 1, 1)` for banner/bar |
| Two-stage boss wave | new (small) | elite death → quake beat → monster spawn; one branch in the §4a flow |
| Retinue at ⅔/⅓ | reuse | `BOSS_RETINUE` gains per-monster overrides (massiff, krykna, quarren, pirate, alamite) |
| Submerged/emerged state | **shipped as the worm's burrow cycle** | `Def.burrows` + `Enemy.updateBurrower`; the ravinak, mamacore, krayt, mythosaur and kwazel maw can adopt it |
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
| The second batch as `EnemyKind`s (sandworm, zillo, nexu, kwazelMaw) with stand-ins, gaits against their briefed rigs, monster stage on the Refinery / Ringworld / Prison Rig, the worm as the Dune Sea's champion | **done** (2026-09-02; sculpts requested, `ASSETS_MODELS.md`) |
| The worm's burrow cycle: under (untargetable, unhurtable, a wake), rise, eruption, rooted bites, sink; trailing body arches | **done** (`Enemy.updateBurrower`, `buildSandworm`) |
| The worm as one continuous body: a spine chain solved onto the head's trail, replacing the three arch props | **not implemented** — designed and accepted 2026-09-02, waiting on the straight sculpt (§2.7) |
| The nexu's pounce (`pounces` on the Def) | **done** |
| Two-stage boss wave: warlord falls → 4 s quake → monster erupts, victory only when it falls | **done** (`Game.updateMonsterStage`, shared by the wave game and the campaign arena) |
| Entrance card, boss bar, phase turns at ⅔/⅓, repulsor pulse, enrage, anti-camp shock-slam | **done** — reused wholesale from §4a |
| Per-monster retinue (pirate, krykna, quarren, pirate, massiff, alamite) | **done** (`MONSTER_BOSS[board].retinue`) |
| Models: `loadCreature`, own rigs, code gaits against the delivered node names | **done** (`src/anim/quadruped.ts`) |
| Half-buried colossi: krayt and mythosaur sunk and reared, ground thrown where the body passes | **done** (`buried` and `plows`) |
| Prefetch: the monster warms with the board's other two bosses | **done** |
| The §2 movesets — charge/skid-stun, ice-burst, breach bite, debris hurl, grab, inhale, sarlacc bait, darkness beat | **not implemented** |
| Weak/deflect zones (×2 / ×0.5 / ×0 on the named nodes) | **not implemented** — the sculpts ship the nodes, so this is the natural next round; until then a monster takes normal damage everywhere, which is why the specced HP still reads right |
| Submerged/emerged states for the water monsters, arena holes, persistent rubble | **not implemented** (the worm's cycle is the pattern to lift) |

The order matters: the weak zones are the set's shared vocabulary and want the
multi-volume hit pipeline the ledger above calls "new (shared)"; the bespoke moves sit
on top of that. Neither is blocked on art any more.

**Audio** follows the boss-voice precedent in [`ASSETS_AUDIO.md`](ASSETS_AUDIO.md):
each monster wants a roar/hurt/death set (sample ids `<id>_roar` etc., the
`mamacore_roar` pattern) with the synth beast voices standing until samples land.
Those requests are deferred with the fights, same as the humanoid boss voices.

**Asset order of work** is the standard pipeline: reference sheet → model →
gameplay. The first batch's sheets were overtaken by its models; the second batch's
sheets and models are both open in the request docs as of 2026-09-02, and nothing
blocks on them — the four fight as stand-ins until the files land.
