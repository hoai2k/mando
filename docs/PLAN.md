# Mando — Game Plan

A fan-made, third-person 3D web game following a Mandalorian bounty hunter. Fast, arcade-style movement (run / jump / jetpack-fly) and combat (blaster + gaffi-stick melee) across two boards: the **Tatooine desert (Dune Sea → Mos Espa outskirts)** and a **space waystation** of floating platforms run by Pyke smugglers and pirates.

This document describes every component and how it will be built. Nothing is built yet — it exists so decisions can be steered before implementation.

---

## 1. Goals & Design Pillars

1. **Fast and dynamic** — the jetpack is the star. Ground running flows into boosted jumps, hovering, and dashes with almost no friction. Movement should feel great even with no enemies around.
2. **Arcade combat** — generous soft-lock aiming, big readable projectiles, short time-to-kill on basic enemies, lots of targets. Skill expression comes from movement + weapon switching, not precision aim.
3. **Faithful atmosphere** — Tatooine's twin suns, ochre dunes, moisture vaporators, Tusken silhouettes, Pyke helmets, the neon-and-sandstone feel of Mos Espa; a grimy industrial spice-running waystation hanging in space.
4. **Procedural now, authored later** — every character is built on a real skeleton (bone hierarchy) with procedural meshes skinned to it. Swapping in an authored glTF later means matching bone names, not rewriting the animation system.
5. **Instant play** — static web build, no server, loads in seconds, 60 fps on a mid laptop.

---

## 2. Tech Stack

| Choice | Decision | Why |
|---|---|---|
| Renderer | **Three.js** (latest) | Best-supported WebGL scene graph, native glTF loading for future authored models, `SkinnedMesh`/`AnimationMixer` give us a production animation pipeline for free. |
| Language | **TypeScript** | The codebase will be ~40+ modules; types keep the entity/combat systems sane. |
| Build | **Vite** | Instant dev server, one-command static build (deployable to GitHub Pages). |
| Physics | **Custom lightweight kinematic physics** (capsule vs. heightfield/boxes/spheres) | Full physics engines (Rapier/cannon) fight against arcade feel. Character controllers for this genre are better hand-rolled: exact control of acceleration, air control, snap-to-ground, knockback. Enemies are kinematic too. |
| Audio | **WebAudio, procedurally synthesized** | Blaster zaps, jetpack roar, impacts, ambient wind — all synthesizable; no copyrighted audio assets. Music: simple dark ambient drone loop via oscillators. |
| Assets | **100% procedural geometry + canvas-generated textures** | No downloads, no licensing issues, and it forces the rig-first architecture that makes future model swaps clean. |

No frameworks beyond that — no React, no ECS library. A simple `Entity` base class + per-system update loops keeps it debuggable.

---

## 3. Repository / Module Layout

```
/index.html
/src
  main.ts                 // boot, game loop, state machine (menu → board select → play → death/win)
  core/
    input.ts              // keyboard+mouse (pointer lock), gamepad
    physics.ts            // capsule collider, colliders (box/sphere/heightfield), raycasts
    camera.ts             // 3rd-person orbit camera w/ collision, aim mode, screen shake
    audio.ts              // WebAudio synth voices (blaster, jetpack, hits, UI, ambient)
    math.ts               // helpers (damping, spring, easing)
  anim/
    skeleton.ts           // canonical humanoid bone set + rig builder
    animator.ts           // clip player: blending, layers (upper/lower body), events
    clips.ts              // procedural keyframe clips (idle, run, jump, fly, melee combo, shoot, hit, death)
  characters/
    builder.ts            // attaches procedural meshes to bones ("proc skin"); glTF swap point
    mandalorians.ts       // playable Mandalorians: beskar armor variants, jetpack, cape
    tusken.ts | pyke.ts | nikto.ts | pirate.ts | droid.ts | trooper.ts
  player/
    controller.ts         // run/jump/jetpack state machine
    combat.ts             // blaster + gaffi stick, weapon switching, aim assist
  enemies/
    enemy.ts              // shared health/AI base, awareness states, hit reactions, death
    ai.ts                 // behaviors: melee charger, ranged strafer, turret, swooper (flying)
    director.ts           // alert spreading + who is allowed to push the player
    spawner.ts            // wave composition, squads posted around the board
  world/
    tatooine.ts           // heightfield dunes, rocks, homestead, vaporators, sarlacc pit, camp
    waystation.ts         // platform graph in space, cranes, cargo, neon signage
    props.ts              // shared prop generators (crates, barrels, antennae, canopies)
    sky.ts                // twin-sun desert sky / starfield nebula skyboxes (shader)
  fx/
    projectiles.ts        // bolt pool, tracers, impact sparks
    particles.ts          // GPU-ish pooled particles: jetpack flame, dust, explosions
  ui/
    hud.ts                // health, jetpack fuel, weapon, crosshair, hit markers, kill/hostile counts
    radar.ts              // motion-tracker dial: hostile bearings, coloured by awareness
    menus.ts              // title, board select, pause, death/victory screens
docs/PLAN.md
```

---

## 4. Player: Movement & Controls

**State machine:** `Grounded (idle/run) → Jump → Airborne → Jetpack (boost/hover) → Landing`.

- **Run** ~9 m/s with snappy accel (reach top speed in ~0.15 s), slight camera FOV kick at speed.
- **Jump** — generous height, coyote time (0.12 s), jump buffering.
- **Jetpack** — hold Space in air: strong upward thrust; **fuel bar** (~3.5 s of thrust) regenerates on the ground and slowly in the air when not thrusting. While thrusting, WASD gives strong lateral air control → true flying between platforms.
- **Dash/boost** (Shift) — short horizontal jetpack burst with i-frames feel (0.25 s), small fuel cost. This is the "fun button".
- **Slam** (Ctrl while airborne) — fast descent; landing near enemies knocks them back (small AoE). Rewards aggressive aerial play.

**Controls:** WASD move, mouse look (pointer lock), Space jump/jetpack, Shift dash, LMB shoot, RMB (hold) aim/zoom, F or MMB melee, 1/2 weapon select, Q rocket (charged, long cooldown, from the jetpack — big AoE, limited ammo). Gamepad supported with the same mapping.

**Camera:** over-the-shoulder orbit (~4.5 m), spherecast against world so it never clips, shifts closer + over shoulder when aiming, subtle shake on fire/hits/explosions, look-ahead when dashing.

## 5. Combat

- **EE-3 blaster carbine** — hitscan-feel but rendered as fast glowing red bolt projectiles (~80 m/s), ~4 shots/s, no ammo (arcade), spread when hip-firing (worse on the move), recoil climb per shot (about half when shouldered).
  **Aim assist (RDR2 "Normal" lock-on):** pressing aim snaps the camera onto the target nearest the reticle over ~0.15 s, then fine aim is yours at reduced look sensitivity; bolts also soft-lock toward the crosshair target. Aiming narrows FOV and removes spread.
- **Player cover** (C / RB on the ground, near a box ≥1 m tall and ≥1 m wide, within ~2.4 m) — RDR2 snap-to-cover: the player presses against the box face (a HUD prompt appears in range), slides along it with the stick (clamped to the face), and is protected while tucked — enemy sightlines and bolts are blocked by the box, and the tucked player holds fire. Holding aim leans out past a corner to shoot: the corner is chosen by camera lean, overridden by whichever corner has a clear raycast to the soft-locked target (re-checked ~3×/s — crates sit in rows, and leaning into the neighbour is a peek wasted); the lean reaches ~1 m past the edge so shots clear deep boxes. Release tucks back in. Jump (exits with the jump), dash, melee, pressing cover again, or pushing off the wall for 0.2 s all leave. Weapon switching is disabled in cover; rockets fire only while leaned out.
- **Camera distance** (hold right-stick click, then push the stick up or down; mouse wheel on keyboard) — dollies the chase camera between 1.9 m and 11 m and *keeps* it there: the chosen distance is the new default until it is changed again. Aiming pulls in proportionally (about 59% of the chosen distance) so the over-the-shoulder framing holds its relationship at any zoom. While the stick is held in, its vertical axis dollies instead of pitching; yaw still turns the camera.
- **Gaffi stick (gaderffii)** — 3-hit combo (swing → backswing → overhead slam) with forward lunge that homes onto the nearest enemy within ~4 m (arcade magnetism). Higher damage than blaster; the finisher puts grounded humanoids flat on their back (a real knockdown state, ~1.6–2.1 s), and any hit on a downed or wounded enemy lands double — the RDR2 brawl loop of haymaker → finish them on the ground. Melee kills refund a chunk of jetpack fuel → encourages weaving in close.
- **Wrist rocket (Q)** — the Z-6 jetpack's missile: lock-on lob, AoE explosion, 1 charge per ~12 s. Screen shake + big particle payoff.
- **Feedback / hit reactions (Euphoria-flavoured):** hit markers, enemy hit-flash + stagger, kill confirm sound; explosions and ground slams knock enemies flat (they get back up shaken); a hit that leaves a grounded humanoid under 25% HP has a 40% chance to drop it into a **wounded crawl** — out of the fight, dragging itself away, bleeding out in 8–12 s unless finished.
- **Ragdoll deaths & persistent corpses:** a killing blow ragdolls the body with the impulse of the last hit — the live pose freezes (the mixer just stops updating), the body tips over along the accumulated impulse (damage fling plus any knockback stacked after it) pivoting at the feet with a thud-and-bounce, limbs flail with damped random angular velocities, and the capsule flies and slides before settling. Heavier kills throw and flail harder, with sideways scatter so a mowed-down line doesn't fall in lockstep. Enemies already prone (wounded crawlers, knockdowns) keep their held pose instead of double-tipping. Corpses then **stay where they fell for the rest of the wave** (settled bodies cost nothing per frame) and fade out over ~1.2 s when the wave clears — materials are cloned per corpse at fade start, since the procedural builder shares them from a cache. Corpses that fall off the station or die mid-air settle wherever they land; below the kill plane they're removed.
- **Player health:** 100 HP, short regen after 5 s without damage (arcade), death → quick respawn at board checkpoint.

## 6. Animation System (built for future authored models)

This is the flexibility the brief demands:

1. **Canonical skeleton** — a named humanoid bone set (`hips, spine, chest, neck, head, shoulder.L/R, upperArm.L/R, forearm.L/R, hand.L/R, upperLeg.L/R, lowerLeg.L/R, foot.L/R` + attachment bones `weapon.R, jetpack, cape`). Built as a real `THREE.Bone` hierarchy per character, with per-species proportions (Pykes: big elongated heads, short bodies; Wookiee-class: tall/broad).
2. **Procedural "skin"** — `characters/builder.ts` parents proc meshes (armor plates, helmets, robes) to bones. Because animation drives *bones*, the meshes ride along for free.
3. **Animator** — plays `AnimationClip`s through `THREE.AnimationMixer` with cross-fade blending, plus **two layers**: lower body (locomotion) and upper body (shoot/melee), so you can fire mid-run/flight. Clip events (e.g. `melee_hit_frame`, `footstep`) drive gameplay/audio.
4. **Procedural clips** — `clips.ts` authors keyframe tracks in code (quaternion keys per bone): idle sway, run cycle w/ arm swing, jump, jetpack fly pose (legs trailing, arms out), 3 melee swings, aim/shoot additive, hit react, death. Because they're standard `AnimationClip`s on named bones, **an authored glTF with the same bone names can replace the whole character and either keep our clips or bring its own** — the animator, controller, and combat code don't change.
5. **Procedural garnish on top** — cape/robe cloth sim (verlet chain), head-look-at IK toward aim target, foot placement lean. These operate as post-pass on bones so they work on authored rigs too.

**Swap contract (documented in code):** to bring in an authored model, provide a glTF whose skeleton uses the canonical names, register it in `builder.ts`, done.

## 7. Characters (procedural, show-accurate styling)

| Character | Role | Visual notes (from the show) |
|---|---|---|
| **Din Djarin** (player) | Mandalorian | Polished bare-silver **beskar** cuirass and helmet (no rangefinder), brown flight suit and cape, cheek-ridged helmet, slim jetpack, gaffi stick + EE-3 carbine. |
| **Paz Vizsla** (player) | Mandalorian | Heavy dark-blue plate, oversized pauldrons and chest, reinforced helmet crest, bulkiest silhouette; same jetpack and weapon loadout. |
| **War massiff** | Tatooine elite (wave 5+) | Armoured quadruped predator: slab-sided hide under a spine of dorsal plates and spikes, flank scutes, heavy tusked skull slung low and forward, thick segmented tail. 2.1 m tall, 5.6 m long. Runs down anyone who tries to jog away and pounces the last 16 m. |
| **Tusken Raider** | Tatooine melee | Sand-wrapped robes, bandolier, cylindrical eye-stalk helmet in the low-profile style, swings gaderffii. *Neutral-turned-hostile "outcast raiders".* |
| **Pyke soldier** | Ranged, both boards | Tall tapered grey-green helmet w/ narrow eyes, tubes to chest rig, slate/teal coats, blaster rifles. Main "easy grunt". |
| **Nikto sand rider** | Fast harasser (Tatooine) | Leathery horned reddish faces, biker leathers per the swoop-gang episode; rides a fast hover-swoop in strafing runs. |
| **Space pirate (Weequay/Trandoshan-styled)** | Ranged/melee (waystation) | Ragged spacer gear, mismatched armor plates, shoulder pauldrons. |
| **Security droid (8D8-style skeletal frame)** | Turret/slow tank | Bone-white skeletal droid; on waystation, heavier "loader droid" variant. |
| **Incinerator trooper** | Ranged (Nevarro, Refinery) | White trooper plate w/ dark-red trim + helmet crest, twin back fuel tanks, flame projector: a stream committed to its aim line — sidestep it. |
| **Krykna / broodmother** | Melee swarm + boss (Crevasse) | Person-sized bone-white cave spiders on free-form eight-leg rigs, relentless like the massiff; the broodmother spawns hatchlings as she takes damage. |
| **Quarren netcaster** | Ranged (Trask) | Squid-faced dock hand in an oilskin coat; net launcher snares the player's legs (walk it off, or cut free with a melee swing). At home in the harbour. |
| **Alamite** | Melee (Great Forge) | Pale hunched cave-dweller, tusked underbite, bony dorsal ridge, stone club. |
| **Interceptor drone** | Kamikaze flier (Great Forge) | Black probe-style drone, red eye, dangling arms; stalks, whines, then commits to an unsteered dive — the whine is the dodge cue. |
| **Ringworld enforcer** | Shielded shooter (Ringworld) | Oxblood plate + tower shield whose energy pane reflects bolts; flank it, rush it, or rocket it. |
| **Bosses (stretch, post-MVP)** | — | Tatooine: **Krrsantan-class Wookiee enforcer** melee duel. Waystation: **Pyke capo + shield**. |

Faces/details are low-poly stylized (not realistic) — a deliberate "stylized action figure" art direction that procedural geometry can actually deliver at high quality, reads instantly, and won't clash when authored models arrive.

## 8. Boards

### Board 1 — Tatooine: The Dune Sea
- **Terrain:** procedural heightfield dunes (layered noise, wind-rippled normal detail), scattered rock mesas and arches (jet up them), a moisture-farm homestead, crashed sail-barge wreck as cover playground, **sarlacc pit** (environmental hazard — knockback into it = death), Tusken camp with tents, campfire, banthas (ambient).
- **Atmosphere:** twin suns w/ warm double-shadow tint, ochre→lavender gradient sky (custom shader), heat-haze shimmer near ground, blowing dust particles, occasional distant krayt-dragon call. Fog color matched to the show's bleached daylight look.
- **Flow:** open arena with 4 spawn zones (camp raiders, Pyke landing site, Nikto swoop circuit, homestead droids). Wave-based **"Hold the Territory"** mode: survive escalating waves, kill counter + score, victory at wave 10.

### Board 2 — "The Spice Run" Waystation
- **Layout:** a chain of ~12 floating platforms/gantries around a central refinery spire, connected by nothing — **the jetpack is the road**. Cargo cranes, stacked spice containers, glowing antenna masts, landing pads with parked freighters, rotating ring section. Fall off = respawn on last platform (small HP cost) — arcade, not punishing.
- **Atmosphere:** deep-space skybox w/ purple-orange nebula + dense starfield, cold rim lighting + warm sodium work-lights, blinking hazard beacons, slow parallax of a nearby gas giant. Grimy industrial kit-bash aesthetic (greebles, pipes, vents).
- **Flow:** same wave mode, but spawns emphasize verticality: pirates on distant platforms sniping (fly to them or trade fire), jet-trooper pirates who fly at you, turret droids on crane arms.

### Boards 3–8 (the second wave of boards — built on shared board systems)

The `Board` interface carries per-board data (name, footstep surface, ambience, music,
wave table) plus opt-in systems any board can declare: multi-zone **hazards** (kill /
burn + a free-form `burnAt` field), **movers** (platforms that carry riders),
**breakables** (props wired into bolts, explosions and ground slams; may chain-explode),
**traction** (ice), and a **light field** the AI's sight range reads.

- **Board 3 — Nevarro, "The Lava Flats."** Black basalt cut by two lava rivers (burn
  zones), breakable cooling-crust bridges, telegraphed geysers that launch whoever stands
  on them (hazard to the AI, free altitude to a bold player), the town gate as anchor.
  Enemies: pirates, incinerator troopers, Imperials, late massiffs.
- **Board 4 — Maldo Kreis, "The Crevasse."** Snowfield rims over a deep canyon floor with
  ice-ledge middle layers — three vertical fighting layers. Low-traction ice, a frozen
  lake of breakable plates over bleed-out water (a ground slam opens it), krykna spiders
  as the melee mass, a broodmother as the wave-10 boss (spawns hatchlings as she is hurt).
- **Board 5 — Trask, "The Storm Docks."** Dock fingers over a harbour that bites (20 dps),
  two trawler movers heaving on a real swell, rain with delayed thunder after each
  lightning flash, the mamacore kill pool, Quarren netcasters whose nets root the player.
- **Board 6 — "The Refinery."** The first interior: walled halls under a low ceiling
  around an open 40 m reactor shaft ringed by catwalks (the jetpack chimney). Chaining
  rhydonium barrels punish the AI's own cover habit; alarm consoles call the whole
  garrison while any squad is engaged — shoot them out to keep firefights local.
- **Board 7 — Mandalore, "The Great Forge."** Fused glass desert around the shattered
  dome, floating ruin-chunks, and a magnetic-storm cycle: everything without a roof
  overhead (checked by raycast — the dome and roof slabs count) takes arcs, AI included,
  so the calm is for fighting and the storm is for repositioning. The Living Waters are
  pure theatre: an eye glow and a sub-bass mythosaur call on a long timer.
- **Board 8 — Glavis, "The Ringworld."** A city street strip at 0.85 g under a terminator
  sweeping a 210-second cycle — enemy sight ranges halve on the night side, so both sides
  migrate with the light. Walkable rooftops, neon, a rideable armored tram the length of
  the board, shielded ringworld enforcers, and the duelist pair as the final wave.

## 9. Enemy AI

### Awareness — hostiles hold ground until they find you

A wave is **posted**, not thrown at you: `spawner.ts` breaks it into squads of
2–4 and places each squad at a spawn point somewhere on the board (farthest-point
sampling, so squads spread out rather than bunch up; never within 55 m of a
player). Every enemy remembers a `post` and stays there.

Each enemy is `idle`, `alerted` or `engaged`:
- **idle** — mills around its post, looks around, holds the ground. Clearing a
  wave means going out and finding them, which is what the radar is for.
- **alerted** — heard a blaster, an explosion, or a squadmate's shout: turns
  toward it, then walks over to look. Patience scales with the distance to
  what it heard, so a shot 80 m away is worth the walk.
- **engaged** — has a foe in sight (or in memory for ~9 s after losing it).

Spotting needs sight, not proximity: range depends on the kind, is halved to the
sides and cut to 8 m behind, and needs line of sight — so a camp can be
approached from behind, or slipped past. Getting shot skips the investigate step
entirely. Line-of-sight is rechecked a few times a second per enemy (staggered),
not per frame; it is a heightfield march and the boards now carry 40+ hostiles.

**Noise** is the other sense: player blaster fire carries 55 m, an enemy's 30 m,
an explosion 70 m (and alerts straight to combat). Firefights therefore pull in
the neighbours, and a jetpack-and-blaster approach wakes a lot more of the board
than a careful one.

If a wave drags past 80 s the remnant starts sweeping toward the players, so a
hunt can't stall.

### The combat director

`director.ts` handles what an individual can't: it spreads alerts through a
squad, and it decides **who is allowed to push**. Of the enemies engaged with a
given player, only 2 melee and 2 ranged are *committed* at a time; the rest hold
an assigned bearing at standoff distance and shoot from there. Bearings are
handed out around the full circle, so a group closes in around the player from
several sides instead of stampeding in from one.

### Self-preservation (the RDR2 layer)

Enemies value their own lives, per RDR2's combat AI:
- **Cover** — shooters fight from behind the boards' boxes (spice crates,
  barrels, huts, vaporators, the barge). A shooter scans nearby collision
  boxes for a spot that blocks the sightline both ways *and* is within
  blaster range of the target, walks there, then loops: hide a beat behind
  the box (holding fire), step out to a peek point off the box's edge, fire
  a volley, duck back. Committed shooters run the same loop at ~2× tempo so
  the director's pressure roles survive. Cover spots are ground- and
  path-validated so nobody steps off a platform to reach one, and being shot
  in the open triggers an immediate dive for the nearest crate; when the
  target flanks the box, the spot is abandoned. An edge guard also stops any
  walking enemy from steering itself off a platform lip (knockbacks can
  still throw them off — that stays).
- **Suppression** — hits and near misses (player bolts landing within ~4.5 m)
  build a suppression value; past a threshold a shooter stops working its
  firing position or advancing, plants where it is, fires less often and much
  less accurately until it recovers — and a suppressed shooter in cover stays
  hidden ~3× longer. Pouring fire at a crate genuinely keeps a head down.
- **Flinch** — a death rattles every hostile within 12 m (suppression spike).
- **Morale** — when a squad of 3+ is down to its last member, even odds it
  breaks and runs: sprints away from the threat, rallies at ~55 m, and turns
  to fight from there as a new post. Droids never break; fliers don't either.
- **Wounded crawl** — see Combat feedback above; a crawler still counts toward
  the wave until it bleeds out or is finished.

### Per-kind behaviour
- **Charger** (Tusken, pirate brawler): committed → approach, telegraphed wind-up,
  swing. Not committed → circle at 9–14 m and wait for a turn.
- **Shooter** (Pyke, pirate, troopers): fights from cover when a valid spot is
  in range (see Self-preservation), otherwise works a firing position on its
  bearing — 9–18 m when committed, 15–30 m when holding the line — strafes
  there, and fires volleys only with line of sight. On the station it stays
  leashed to its platform.
- **Swooper/flyer** (Nikto swoop, jet-pirate, dark trooper): figure-eight strafing
  runs, vulnerable window after each pass; loiters near its post until alerted.
- **Turret** (droid): stationary, slow tracking beam, high damage — priority-target puzzle.
- **Beast** (war massiff): `relentless` — exempt from the director's standoff rotation and from morale breaks, because a predator that waits its turn or runs away isn't one. Chases at 10.5 m/s (a jog is 9.2, a sprint 14.4, so it catches anyone who doesn't spend the energy gauge) and closes the last 4–16 m with a ballistic **pounce**, led to intercept the target's velocity. The leap has no steering once airborne, so a dash or jetpack hop to the side beats it; a miss costs it 0.7 s. 300 HP with hit spheres on the skull and haunches as well as the torso, since one capsule sphere can't cover a five-metre body.
- **Allies** (Marshal, IG-11, Fennec) escort rather than hunt: they engage what is
  near the player, and come back if they stray past ~34 m.

Difficulty ramps by wave count and mix, not by bullet-sponging (grunts stay 2–4
hits). Wave sizes run about 9–10 hostiles on wave 1 to ~41 on wave 10 (×1.5 in
two-player).

## 10. FX, UI, Audio

- **FX:** pooled particle system (dust, sparks, jetpack flame + heat distortion trail, explosions, blood-free "spark/cloth puff" hits), bolt light sources (cheap: few pooled point lights), decal-free scorch flashes.
- **HUD:** health bar, jetpack fuel arc around crosshair (visible where your eyes are), weapon icon, rocket cooldown pip, wave/kill counter, **hostiles-remaining count**, damage direction indicators, boss bar (later). Diegetic green "helmet visor" vignette + subtle HUD tint.
- **Radar** (`ui/radar.ts`): a 120 m motion-tracker dial per viewport, rotated so up is where the camera looks. Contacts are coloured by awareness — dim amber for a camp that hasn't noticed you, brighter amber once it is coming to look, red once it is fighting — with allies green and your co-op partner blue. Anything beyond the sweep is pinned to the rim as a chevron, so the bearing is always readable while the distance is not; a tick above or below a blip means it is well above or below you. The count under the dial is the wave's remaining hostiles.
- **Menus:** title → board select (two illustrated cards) → controls card; pause; death (retry fast); victory (score + time).
- **Audio:** synthesized blaster (pitch-swept saw + noise), jetpack (filtered noise roar tied to thrust), melee whooshes/clangs, Pyke/pirate death chirps, ambient wind or station hum per board, minimal dark-drum ambient loop. Master/SFX volume sliders.

## 11. Performance Budget

60 fps target on integrated GPUs: instanced rendering for rocks/props/particles, merged static geometry per zone, ≤ ~150k tris in view, one directional shadow-casting light (cascade-free, tight bounds) + ambient/hemisphere, pooled everything (bolts, particles, enemies), no postprocessing beyond cheap vignette/FXAA (motion blur skipped).

## 12. Build Order (milestones)

1. **M1 — Feel:** Vite+TS scaffold, physics, camera, input, gray-box arena, run/jump/jetpack/dash tuned until movement alone is fun.
2. **M2 — Combat:** blaster + aim assist, target dummies, hit FX, HUD basics; then gaffi combo + lunge.
3. **M3 — Characters & animation:** skeleton/animator/clips, playable Mandalorian model, one enemy (Pyke shooter) end-to-end with AI, hit reacts, death.
4. **M4 — Tatooine board:** terrain, props, sky/lighting, full enemy roster (Tusken, Nikto swoop, pirates), wave mode, win/lose loop.
5. **M5 — Waystation board:** platforms, space sky, pirates/jet-pirates/turrets, fall-respawn.
6. **M6 — Polish:** audio pass, menus/board select, difficulty tuning, performance pass, gamepad.
7. **Stretch:** bosses (Krrsantan-class duel, Pyke capo), score persistence, photo mode.

## 13. Addendum (user-requested, v1 scope)

- **Full Xbox controller support, including menus.** Every menu is navigable with d-pad/left stick + A (confirm) / B (back); gameplay uses the standard twin-stick mapping (LS move, RS look, RT shoot, LT aim, A jump/jetpack, X melee, B dash, Y rocket, LB weapon switch, RB slam, Start pause, View fullscreen). Keyboard+mouse remains fully supported for player 1.
- **Fullscreen icon button** fixed at the bottom-right of the screen at all times (menus and gameplay); also bound to the controller View button.
- **2-player split-screen co-op.** Horizontal split (P1 top, P2 bottom). Player 2 joins from the board-select screen with a second controller (or via a "2 Players" menu option). One shared enemy pool/wave state; per-player camera, HUD, health, fuel. If one player dies they respawn while the partner survives the wave; both down = defeat.
- **Asset request docs** — `docs/ASSETS_IMAGES.md` and `docs/ASSETS_AUDIO.md` list every texture/image and audio asset the game can consume, with generation prompts, specs, and drop-in file paths. The game runs 100% procedurally without them and upgrades automatically when files are present (loader checks `/assets/...` and falls back to procedural).
- **Progress tracking** — `docs/PROGRESS.md` is updated as milestones complete.

## 14. Revisions from playtesting

- **All enemies are human-size or larger.** The massiff was originally a ~0.8 m quadruped and got cut for it; it is back as the **war massiff** — a bred war beast at 2.1 m to the spines and 5.6 m nose to tail, roughly triple a trooper's bulk — and promoted from wave-1 chaff to a wave-5+ elite. Nothing else was ever cut for size.
- **Sprint gauge.** Holding B / Shift on the ground sprints at ~14.4 m/s against a 6-second energy bar, separate from jetpack fuel. The dash burst moved to a tap of the same button while airborne and now costs energy rather than fuel.
- **Knockback reads.** Hits apply an impulse *and* a stagger window; without the stagger the AI's per-frame steering damp erased the impulse before it was visible. Bolt ≈ 0.7 m, melee swing ≈ 2.7 m, finisher ≈ 3.1 m, explosions ≈ 4.7 m. The finisher deliberately shoves rather than launches (0.96 m/s of lift vs 6.65 m/s originally) — its job is to clear the target out of your firing line so you can swing to the next one, not to be spectacular.
- **Blaster readability.** Bolts are longer, fatter, near-white cores with an additive halo, fired at 75 m/s with a muzzle flash. Shots converge on the crosshair via a camera raycast (or the soft-lock target) instead of firing parallel from the muzzle, and the crosshair shows a red lock ring when a target is in the assist cone.
- **No abyss on the station.** Below the platforms gravity drops to 12% with a 3.2 m/s terminal speed and fuel regenerates, so drifting off is recoverable with a tap of jetpack; the killY backstop repositions without damage.
- **Grogu rides with Din Djarin only.**

## 15. Notes & Constraints

- **Fan project:** original code and procedural assets only — no ripped models, textures, audio, or music. Named as an homage; can be re-skinned with generic names ("The Mandalorian") if ever needed.
- **Not in scope (v1):** multiplayer, save system, open-world traversal between boards, vehicles as drivables (swoops are enemy-only), mobile touch controls.
