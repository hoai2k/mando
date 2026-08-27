# Boba Fett: Daimyo of Tatooine — Game Plan

A fan-made, third-person 3D web game inspired by *The Book of Boba Fett*. Fast, arcade-style movement (run / jump / jetpack-fly) and combat (blaster + gaffi-stick melee) across two boards: the **Tatooine desert (Dune Sea → Mos Espa outskirts)** and a **space waystation** of floating platforms run by Pyke smugglers and pirates.

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
    boba.ts               // player model: green/red Mandalorian armor, jetpack, cape
    tusken.ts | pyke.ts | nikto.ts | pirate.ts | droid.ts | trooper.ts
  player/
    controller.ts         // run/jump/jetpack state machine
    combat.ts             // blaster + gaffi stick, weapon switching, aim assist
  enemies/
    enemy.ts              // shared health/AI base, hit reactions, ragdoll-lite death
    ai.ts                 // behaviors: melee charger, ranged strafer, turret, swooper (flying)
    spawner.ts            // wave/zone spawning, difficulty ramp
  world/
    tatooine.ts           // heightfield dunes, rocks, homestead, vaporators, sarlacc pit, camp
    waystation.ts         // platform graph in space, cranes, cargo, neon signage
    props.ts              // shared prop generators (crates, barrels, antennae, canopies)
    sky.ts                // twin-sun desert sky / starfield nebula skyboxes (shader)
  fx/
    projectiles.ts        // bolt pool, tracers, impact sparks
    particles.ts          // GPU-ish pooled particles: jetpack flame, dust, explosions
  ui/
    hud.ts                // health, jetpack fuel, weapon, crosshair, hit markers, kill counter
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

- **EE-3 blaster carbine** — hitscan-feel but rendered as fast glowing red bolt projectiles (~80 m/s), ~4 shots/s, no ammo (arcade), slight spread when moving.
  **Aim assist:** cone-based soft lock — bolts bend up to ~6° toward the nearest target near the crosshair; crosshair highlights + sticks lightly on targets. Aiming (RMB) narrows FOV and tightens spread.
- **Gaffi stick (gaderffii)** — 3-hit combo (swing → backswing → overhead slam) with forward lunge that homes onto the nearest enemy within ~4 m (arcade magnetism). Higher damage than blaster; slam ends the combo with a knockdown. Melee kills refund a chunk of jetpack fuel → encourages weaving in close.
- **Wrist rocket (Q)** — the Z-6 jetpack's missile: lock-on lob, AoE explosion, 1 charge per ~12 s. Screen shake + big particle payoff.
- **Feedback:** hit markers, damage numbers (toggleable), enemy hit-flash + stagger, kill confirm sound, corpses fling with impulse then fade.
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
| **Boba Fett** (player) | Daimyo | Weathered **green beskar** armor w/ red-maroon helmet accents, T-visor, dented dome, Z-6 jetpack (green/maroon, rocket tip), half-cape, gaffi stick + EE-3 carbine. |
| **Tusken Raider** | Tatooine melee | Sand-wrapped robes, bandolier, cylindrical eye-stalk helmet (BOBF's low-profile redesign), swings gaderffii. *Neutral-turned-hostile "outcast raiders" so the player isn't fighting Boba's adopted tribe.* |
| **Pyke soldier** | Ranged, both boards | Tall tapered grey-green helmet w/ narrow eyes, tubes to chest rig, slate/teal coats, blaster rifles. Main "easy grunt". |
| **Nikto sand rider** | Fast harasser (Tatooine) | Leathery horned reddish faces, biker leathers per the swoop-gang episode; rides a fast hover-swoop in strafing runs. |
| **Space pirate (Weequay/Trandoshan-styled)** | Ranged/melee (waystation) | Ragged spacer gear, mismatched armor plates, shoulder pauldrons. |
| **Security droid (8D8-style skeletal frame)** | Turret/slow tank | Bone-white skeletal droid; on waystation, heavier "loader droid" variant. |
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

## 9. Enemy AI

Simple, readable behaviors (shared steering + separation so groups don't stack):
- **Charger** (Tusken, pirate brawler): approach → telegraphed wind-up → swing; strafes when waiting its turn (max N simultaneous attackers so the player isn't mobbed unfairly).
- **Shooter** (Pyke, pirate): keep 10–20 m, strafe, volley of 3 slow dodgeable bolts, occasionally repositions/takes cover behind props.
- **Swooper/flyer** (Nikto swoop, jet-pirate): figure-eight strafing runs, vulnerable window after each pass.
- **Turret** (droid): stationary, slow tracking beam, high damage — priority-target puzzle.
Difficulty ramps by wave count and mix, not by bullet-sponging (grunts stay 2–4 hits).

## 10. FX, UI, Audio

- **FX:** pooled particle system (dust, sparks, jetpack flame + heat distortion trail, explosions, blood-free "spark/cloth puff" hits), bolt light sources (cheap: few pooled point lights), decal-free scorch flashes.
- **HUD:** health bar, jetpack fuel arc around crosshair (visible where your eyes are), weapon icon, rocket cooldown pip, wave/kill counter, damage direction indicators, boss bar (later). Diegetic green "helmet visor" vignette + subtle HUD tint.
- **Menus:** title → board select (two illustrated cards) → controls card; pause; death (retry fast); victory (score + time).
- **Audio:** synthesized blaster (pitch-swept saw + noise), jetpack (filtered noise roar tied to thrust), melee whooshes/clangs, Pyke/pirate death chirps, ambient wind or station hum per board, minimal dark-drum ambient loop. Master/SFX volume sliders.

## 11. Performance Budget

60 fps target on integrated GPUs: instanced rendering for rocks/props/particles, merged static geometry per zone, ≤ ~150k tris in view, one directional shadow-casting light (cascade-free, tight bounds) + ambient/hemisphere, pooled everything (bolts, particles, enemies), no postprocessing beyond cheap vignette/FXAA (motion blur skipped).

## 12. Build Order (milestones)

1. **M1 — Feel:** Vite+TS scaffold, physics, camera, input, gray-box arena, run/jump/jetpack/dash tuned until movement alone is fun.
2. **M2 — Combat:** blaster + aim assist, target dummies, hit FX, HUD basics; then gaffi combo + lunge.
3. **M3 — Characters & animation:** skeleton/animator/clips, Boba model, one enemy (Pyke shooter) end-to-end with AI, hit reacts, death.
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

- **All enemies are human-size or larger.** The massiff (a ~0.8 m quadruped) was cut; the Tatooine melee slot is filled by Tuskens and pirate brawlers instead.
- **Sprint gauge.** Holding B / Shift on the ground sprints at ~14.4 m/s against a 6-second energy bar, separate from jetpack fuel. The dash burst moved to a tap of the same button while airborne and now costs energy rather than fuel.
- **Knockback reads.** Hits apply an impulse *and* a stagger window; without the stagger the AI's per-frame steering damp erased the impulse before it was visible. Bolt ≈ 0.7 m, melee swing ≈ 2.7 m, finisher ≈ 3.1 m, explosions ≈ 4.7 m. The finisher deliberately shoves rather than launches (0.96 m/s of lift vs 6.65 m/s originally) — its job is to clear the target out of your firing line so you can swing to the next one, not to be spectacular.
- **Blaster readability.** Bolts are longer, fatter, near-white cores with an additive halo, fired at 75 m/s with a muzzle flash. Shots converge on the crosshair via a camera raycast (or the soft-lock target) instead of firing parallel from the muzzle, and the crosshair shows a red lock ring when a target is in the assist cone.
- **No abyss on the station.** Below the platforms gravity drops to 12% with a 3.2 m/s terminal speed and fuel regenerates, so drifting off is recoverable with a tap of jetpack; the killY backstop repositions without damage.
- **Grogu rides with Din Djarin only.**

## 15. Notes & Constraints

- **Fan project:** original code and procedural assets only — no ripped models, textures, audio, or music. Named as an homage; can be re-skinned with generic names ("The Daimyo") if ever needed.
- **Not in scope (v1):** multiplayer, save system, open-world traversal between boards, vehicles as drivables (swoops are enemy-only), mobile touch controls.
