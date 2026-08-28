# Mando — a *Mandalorian* fan game

**▶ Play it: https://hoai2k.github.io/mando/**

A fast, arcade-style third-person 3D web game: run, jetpack-fly, blast and brawl your way
through ten waves on two boards. Built with Three.js + TypeScript + Vite, no server, no
downloads — it runs in the browser.

Fan project. Audio is generated and most geometry is procedural; nothing is taken from
the shows.

**Model workbench:** https://hoai2k.github.io/mando/workbench/?edit=models — a turntable
for the cast. Pick a character, run any animation the game plays, and stand an authored
model next to the procedural build it replaces.

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
| Dead Eye (slow motion) | `V` | click right stick |
| Ground slam (in air) / Take cover (on ground, near a box) | `Ctrl` / `C` | `RB` |
| Switch weapon | `E` | `LB` |
| Pause | `Esc` | `Start` |
| Fullscreen | button, bottom-right | `View` |

Menus are fully navigable by controller. **Two-player split-screen co-op**: choose
"Players: 2" on the board-select screen with a second controller connected.

## Playing the game

Pick a board, then pick your Mandalorian — both play identically, so choose your armor:

- **Din Djarin** — bare beskar shine
- **Paz Vizsla** — heavy blue plate, oversized pauldrons

Hostiles don't queue up to charge you. Each wave is **posted around the board** in
squads that hold their ground until something gives you away — a shot, an explosion,
a squadmate's shout, or walking into their line of sight. Go and find them: the
**radar** in the top-right shows every remaining hostile's bearing (dim amber for a
camp that hasn't noticed you, red once it is fighting), and the counter under it is
what's left of the wave. Once a fight starts only a couple of them press the attack
at a time while the rest hold a firing line around you, so there is always a flank
worth pushing.

The gunfights borrow their feel from *Red Dead Redemption 2*: pressing aim snaps
onto the target nearest your crosshair, then the fine aim is yours; hip fire sprays
and recoil climbs; **Dead Eye** (`V` / right-stick click) drops the world into slow
motion while your trigger stays fast — the meter refills as you kill. And you can
**take cover** like they do: press `C` (or `RB`) near a crate to snap against it —
slide along the face with the stick, hold aim to lean out past the corner and
shoot (it picks the corner with a clear shot to your target), release to duck
back; jump, dash or push away to leave. Enemies fight from
cover — shooters duck behind spice crates, barrels and hut walls, peek out to loose
a volley, and duck back (suppress them and they stay hidden; flank the box and they
scramble for a new one). They get pinned under heavy fire, get knocked flat by
explosions and the gaffi finisher (hit them again on the ground for double),
sometimes crumple into a wounded crawl you have to finish, and the last survivor of
a shattered squad may break and run for a new position.

**The Dune Sea** — Tatooine wastes: Tusken outcasts, pirate brawlers, Pyke patrols, Nikto
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

## Settings

Audio volumes live in [`src/config.ts`](src/config.ts) — `master`, `sfx` and `music`, each a
linear gain from 0 to 1. They can also be changed while playing, from the browser console:

```js
__config.audio.sfx = 0.2;   // quieter blasters
__audio.applyConfig();      // take effect now
__saveAudio();              // remember it across reloads
```
