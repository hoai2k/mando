# Mando — a *Mandalorian* fan game

**▶ Play it: https://hoai2k.github.io/mando/**

A fast, arcade-style third-person 3D web game: run, jetpack-fly, blast and brawl your way
through ten waves on two boards. Built with Three.js + TypeScript + Vite, no server, no
downloads — it runs in the browser.

Fan project. All geometry is procedural and all audio is generated; nothing is taken from
the shows.

## Controls

| Action | Keyboard / Mouse | Xbox controller |
|---|---|---|
| Move | `WASD` | Left stick |
| Look / aim | Mouse | Right stick |
| Jump → hold to jetpack | `Space` | `A` |
| Sprint (hold) | hold `Shift` | hold `B` |
| Jetpack dash burst (in air) | tap `Shift` | tap `B` |
| Fire blaster | Left mouse | `RT` |
| Aim (zoom) | Right mouse | `LT` |
| Melee combo (gaffi stick) | `F` | `X` |
| Wrist rocket | `Q` | `Y` |
| Ground slam (in air) | `Ctrl` / `C` | `RB` |
| Switch weapon | `E` | `LB` |
| Pause | `Esc` | `Start` |
| Fullscreen | button, bottom-right | `View` |

Menus are fully navigable by controller. **Two-player split-screen co-op**: choose
"Players: 2" on the board-select screen with a second controller connected.

## Playing the game

Pick a board, then pick your Mandalorian — both play identically, so choose your armor:

- **Din Djarin** — bare beskar shine
- **Paz Vizsla** — heavy blue plate, oversized pauldrons

**The Dune Sea** — Tatooine wastes: Tusken outcasts, massiff hounds, Pyke patrols, Nikto
swoop riders and a sarlacc pit that will eat anything knocked into it.

**The Spice Run** — a smugglers' waystation of floating platforms in deep space. The
jetpack is the only road.

From wave 6 the Imperial remnant shows up (stormtroopers, death troopers, flying dark
troopers). Allies join you along the way: **The Marshal** (wave 4), **IG-11** (wave 7) and
**Fennec Shand** (wave 9).

Survive ten waves to hold the territory.

## Developing

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build to dist/
```

Pushes to `main` deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — full design and architecture
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — build log and what's still open
- [`docs/ASSETS_MODELS.md`](docs/ASSETS_MODELS.md) — 3D models wanted, with the skeleton swap contract
- [`docs/ASSETS_IMAGES.md`](docs/ASSETS_IMAGES.md) / [`docs/ASSETS_AUDIO.md`](docs/ASSETS_AUDIO.md) — texture and audio requests

Characters, textures and sounds are all swappable without touching gameplay code: authored
glTF models drop in against the canonical skeleton in `src/anim/skeleton.ts`, and any file
placed at the documented path under `public/assets/` overrides its procedural stand-in.

## Regenerating sound effects

```bash
ELEVENLABS_API_KEY=... node tools/generate-sfx.mjs [name ...]
```

Existing files are skipped unless named explicitly. Never commit the key.
