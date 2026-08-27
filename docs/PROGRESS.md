# Build Progress

Tracked per milestone; updated as work lands. See `docs/PLAN.md` for full scope.

| # | Milestone | Status |
|---|---|---|
| 0 | Plan, asset request docs, project scaffold | ✅ done |
| 1 | Core systems: math, input (KB/M + 2 Xbox pads + menu nav), physics, audio synth | ✅ done |
| 2 | Animation system (canonical skeleton, procedural clips, layered animator) | ✅ done |
| 3 | Characters: Boba + 6 enemy builders (Tusken, Pyke, pirate ×2, droid, Nikto swoop, massiff) | ✅ done |
| 4 | FX: particles, projectiles; twin-sun + nebula skies | ✅ done |
| 5 | Board 1: Tatooine (dunes, mesas, homestead, camp, sail barge, sarlacc) | ✅ done |
| 6 | Board 2: Waystation (12 platforms, spire, cranes, crates, freighter) | ✅ done |
| 7 | Player controller (run/jump/jetpack/dash/slam) + combat (blaster w/ aim assist, gaffi combo, rocket) + camera | ✅ done |
| 8 | Enemies: 4 AI styles (melee/ranged/swoop/hover) + 10-wave spawner | ✅ done |
| 9 | UI: HUD, gamepad-navigable menus, fullscreen button (bottom-right + View button) | ✅ done |
| 10 | 2-player split-screen co-op (horizontal split, per-player camera/HUD) | ✅ done |
| 11 | Build verified + game boots (headless Chromium screenshots), merged to main | ✅ done |

## Verified

- `tsc --noEmit` clean; `vite build` clean (~600 KB bundle, ~159 KB gzip).
- Headless Chromium boot test: title → board select → both boards render; menus navigate by keyboard (same code path as gamepad d-pad events).
- Simulation stepping test: wave 1 spawns 5 enemies on Tatooine, enemies close from 25 m to melee and damage the player; kill scoring credits the right player; wave advance to wave 2 (7 enemies); blaster kills at range with aim assist; gaffi melee combo kills at close range; 2-player split screen renders both viewports with independent HUDs.

## Still open / next steps

- Real-hardware playtest & feel tuning (all movement/combat numbers are first-pass).
- Bosses (Krrsantan-class duel, Pyke capo) — planned stretch.
- Authored asset drops per `docs/ASSETS_IMAGES.md` / `docs/ASSETS_AUDIO.md` (game runs fully procedural today, upgrades automatically when files exist).
- Authored glTF characters via the canonical-skeleton swap contract (`src/anim/skeleton.ts`).

## Log

- 2026-08-27 — Plan written and merged to main. Asset request docs added. Scope addendum: Xbox controller everywhere, fullscreen button, split-screen co-op.
- 2026-08-27 — Full game implemented and verified: two boards, 8 enemy types, wave mode, split-screen co-op, controller-navigable menus, procedural audio. Merged to main.
- 2026-08-27 — Generated all 18 engine-consumed SFX with the ElevenLabs sound-generation API (`tools/generate-sfx.mjs`), checked in under `public/assets/audio/`; audio loader now accepts `.ogg` and `.mp3`. Verified every file decodes in Chromium. Docs updated.
- 2026-08-27 — Cast expansion merged: 5 playable Mandalorians (Boba Fett, Din Djarin, Bo-Katan, Paz Vizsla, The Armorer) with a controller-navigable character select; Imperial remnant enemies (stormtrooper, death trooper, flying dark trooper) join waves 6+; ally NPCs (The Marshal, IG-11, Fennec Shand) reinforce on waves 4/7/9; Grogu follows player 1 in his hover-pram. 23 more ElevenLabs sounds (footsteps, voice barks, ambience beds, music loops) with engine hooks. `docs/ASSETS_MODELS.md` lists all 22 characters needing authored 3D models. Example gameplay video captured from the real build (frame-stepped, ffmpeg-encoded).
- 2026-08-27 — Deployed to GitHub Pages at https://hoai2k.github.io/mando/ via `.github/workflows/deploy.yml` (builds and publishes on every push to `main`). Verified the deployed bundle boots and plays when served from the `/mando/` subpath, with all 41 audio files loading. Audio loader now probes `.mp3` before `.ogg` to avoid a 404 per sample; Grogu's pram angled so he's visible from the chase camera.
- 2026-08-27 — Fixed two player-reported bugs. (1) `Game.render` passed `domElement.width/height` (drawing-buffer pixels) to `setViewport`/`setScissor`, which scale by the renderer pixel ratio themselves — so devicePixelRatio was applied twice and the viewport overran the buffer on HiDPI displays, shoving the character up and to the right. Now uses `renderer.getSize()` (CSS pixels). Only reproduced at devicePixelRatio > 1, which is why earlier headless tests (dpr 1) missed it. (2) The camera-relative right vector was negated (`(cos, -sin)` instead of `forward x up = (-cos, sin)`), inverting strafe on both stick and keyboard and putting the chase camera over the left shoulder. Both call sites now share `yawBasis()` in `core/math.ts`. Grogu moved to the player's left so he no longer crowds the now-correct over-the-right-shoulder frame.
