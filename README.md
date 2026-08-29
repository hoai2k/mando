# Bounty Hunters — a *Mandalorian* fan game

**▶ Play it: https://hoai2k.github.io/mando/**

A fast, arcade-style third-person 3D web game: run, jetpack-fly, blast and brawl your way
through ten waves on any of nine boards, solo or up to four in split-screen. Built with
Three.js + TypeScript + Vite, no server, no downloads — it runs in the browser.

Fan project. Audio is generated and most geometry is procedural; nothing is taken from
the shows. Not affiliated with or endorsed by Lucasfilm or Disney — see
[LICENSE](LICENSE) for the code licence and the full fan-work notice.

**Model workbench:** https://hoai2k.github.io/mando/workbench/?edit=models — a turntable
for the cast. Pick a character, run any animation the game plays, and stand an authored
model next to the procedural build it replaces. *Edit mode* freezes the pose, draws the
rig on the figure and gives each joint a rotation gizmo — local, world or camera-relative.
Edits go into the clips, so you can leave edit mode and watch the animation with them,
undo and redo them, and export the whole session as one JSON.

## Controls

The game is built for a controller. Keyboard and mouse gameplay is off by
default — turn on **Keyboard & mouse** in Settings for the left column.

| Action | Keyboard / Mouse (opt-in) | Xbox controller |
|---|---|---|
| Move | `WASD` | Left stick |
| Look / aim | Mouse | Right stick |
| Jump → hold to jetpack | `Space` | `A` |
| Sprint — press while already moving, hold to keep it | hold `Shift` | hold `LB` |
| Dash — press from a standstill, then push a direction | hold `Shift` | hold `LB` |
| Block — raise the shield (hold) | hold `R` | hold `B` |
| Fire blaster | Left mouse | `RT` |
| Aim (zoom) | Right mouse | `LT` |
| Melee combo (gaffi stick, or the sabers) | `F` | `X` |
| Wrist rocket | `Q` | `Y` |
| Camera distance | Mouse wheel | hold right stick click + up/down |
| Take cover (on ground, near a box) / ground slam (in air) | `C` / `Ctrl` | `RB` |
| Switch weapon (draw or stow, for a blades-only fighter) | `E` | D-pad right |
| Pause | `Esc` | `Start` |
| Fullscreen | button, bottom-right | `View` |

The same reference lives in the game: the **(i)** button, bottom-right, draws these bindings
on a controller diagram, and the **gear** beside it opens audio settings. Both are also on the
title and pause menus.

**Blocking** raises a force shield in front of you. Bolts that hit it bounce off and fly on
as your own fire. It runs off the same energy gauge as sprinting, so a fight is a budget:
spend it holding a shield up and you have none left to run with. Behind the shield you can
shuffle but not run, and you cannot shoot or swing — and raising it in the air kills your
lift and brings you down, because a brace needs the ground under it.

Menus are fully navigable by controller. **Up to four-player split-screen co-op**: on the
character-select screen, each extra controller presses **A** on its own pedestal to join.
The screen splits to suit — two players share it top and bottom, three get two quarters
above a full-width strip, four take a quadrant each — and every player has their own
camera, HUD, health and fuel. Waves grow with the party. If one player falls they respawn
while the others hold the wave; everyone down is a defeat.

## Playing the game

The title screen offers three modes:

| Mode | What it is |
|---|---|
| **Wave Battle** | The core game — ten waves on one territory, then the board's warlord as a boss wave. Solo or up to four in split-screen. |
| **PvP** | Hunter against hunter, each with a squad of followers, last one standing. |
| **Missions** | The campaign: a path across the galaxy on a shared screen, door-gated corridors between arenas, a boss holding each territory. |

Full design record in [`docs/MODES.md`](docs/MODES.md). Add `?nomodes` to the URL for the
one-button title and the wave game on its own.

Then pick a territory, and pick your fighter. Nine of them, in two families — the covert's
Mandalorians, who all carry the carbine and the gaffi stick, and the underworld hunters,
who each bring a weapon of their own:

| Fighter | | |
|---|---|---|
| **Din Djarin** | Mandalorian | Bare beskar shine — carbine + gaffi stick |
| **Paz Vizsla** | Mandalorian | Heavy blue plate, the broadest silhouette |
| **Bo-Katan Kryze** | Mandalorian | Night-owl blue, rangefinder helmet |
| **The Armorer** | Mandalorian | Gold plate and horned helm |
| **Asajj Ventress** | Hunter | Twin red sabers and no gun at all — she deflects blaster fire back at whoever sent it |
| **Embo** | Hunter | Wide woven-metal hat, laser crossbow |
| **Bossk** | Hunter | Reptilian brawn, long rifle |
| **Cad Bane** | Hunter | Twin heavy pistols, one in each hand |
| **IG-11** | Hunter | Assassin droid on leg thrusters, long rifle |

The armour is cosmetic; the weapon is not — a crossbow, a rifle and a pair of pistols
each fire differently, and Ventress's sabers swing where everyone else's staff does.
She is the one real departure: no ranged weapon at all, so aiming and firing are simply
not hers, and in exchange the blades turn blaster bolts back at whoever fired them. They
stow themselves after a few seconds' quiet and come back out on the melee button.

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
and recoil climbs. You can
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

### The nine territories

- **The Dune Sea** — Tatooine wastes: Tusken outcasts, pirate brawlers, Pyke patrols, Nikto
  swoop riders, war massiffs, and a sarlacc pit that will eat anything knocked into it.
- **The Spice Run** — a smugglers' waystation of floating platforms in deep space. The
  jetpack is the only road.
- **The Lava Flats** — Nevarro's black glass, cut by lava rivers, with geysers that launch
  whoever is standing on them. Ride one for free altitude.
- **The Crevasse** — three layers of ice over a canyon floor, low traction, a frozen lake
  a ground slam opens, and the krykna that own the dark.
- **The Storm Docks** — a Trask fishing port in a squall: heaving trawler decks, netcasters,
  and the mamacore circling under the pier. The harbour is safe to cross — briefly.
- **The Refinery** — the interior board: low halls around a 40 m reactor shaft, chaining
  rhydonium barrels, and alarm consoles that call the garrison until you shoot them out.
- **The Great Forge** — Mandalore's glassed ruin under a magnetic storm that strikes
  anything without a roof over it. The calm is for fighting.
- **The Ringworld** — a Glavis street under a moving terminator. The night side halves
  everyone's sight; a tram runs the length of the board.
- **The Prison Rig** — an Imperial rig on an ocean world: electrified decks above, and a
  whole sea below to dive, hide in and surface behind the sentries.

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
- [`docs/ASSETS_COMPLETED.md`](docs/ASSETS_COMPLETED.md) — everything already delivered, with the prompts that made it

Characters, textures and sounds are all swappable without touching gameplay code: authored
glTF models drop in against the canonical skeleton in `src/anim/skeleton.ts`, and any file
placed at the documented path under `public/assets/` overrides its procedural stand-in.

## Board music

Full-length tracks stream from [`public/music/`](public/music/). Which board plays what is
one file — [`src/core/music.ts`](src/core/music.ts): a list of tracks that suit any board,
a list per board flavor, and the signature opener a board starts on (The Storm Docks opens
on the sea shanty, The Crevasse on the ice theme, The Great Forge on the forge chant, The
Prison Rig on its own). After the opener a board picks at random, never the same track
twice in a row. Adding a track is dropping the .mp3 in that directory and listing it there.

## Regenerating sound effects

```bash
ELEVENLABS_API_KEY=... node tools/generate-sfx.mjs [name ...]
```

Existing files are skipped unless named explicitly. Never commit the key.

## Settings

Volume sliders are in the game, under the gear button. They persist per device.

The defaults live in [`src/config.ts`](src/config.ts) — `master`, `sfx` and `music`, each a
linear gain from 0 to 1 — and can also be changed from the browser console:

```js
__config.audio.sfx = 0.2;   // quieter blasters
__audio.applyConfig();      // take effect now
__saveAudio();              // remember it across reloads
```

## Tests

```bash
npm run build     # tsc --noEmit + vite build
npm test          # boot the built game in Chromium and play a wave
```

```bash
npm run audit:boards   # every board's props vs. its colliders
npm run audit:spawns   # every wave's spawns vs. its colliders
```

`npm test` drives the real build behind a synthetic Xbox pad
([`tools/harness.mjs`](tools/harness.mjs)) — it starts its own preview server, walks
title → board → character select, plays a wave and fails on any console error. It needs
a browser once: `npx playwright install chromium` (or point `CHROMIUM_PATH` at one you
already have). CI runs it before every deploy, along with both audits: `audit:boards`
fails a build where something solid-looking has no collider, and `audit:spawns` fails one
where any wave, on any board, would post a hostile inside the scenery.

The harness is also a library, for writing one-off probes against a running match:

```js
import { launch, BTN } from './tools/harness.mjs';
const h = await launch();
await h.startMatch();
await h.pad.stick('left', 0, -1, 1200);      // walk forward
console.log(await h.step(2));                 // advance 2 s of game time
await h.close();
```

## Licence

[MIT](LICENSE) for the code and the original assets, with a fan-work notice: this is a
non-commercial homage, and the names and likenesses it borrows belong to their owners.
