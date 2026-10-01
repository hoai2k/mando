# Crevasse — The Glacier Chute and Lamplight

Branch `claude/sections-crevasse`. Both sections are built, registered
(`src/sections/index.ts`, `ids.ts`) and in the Crevasse run (A the surface ⇒
**Glacier Chute** ⇒ **Lamplight** ⇒ B the deep). Kits owned here: **K7 slide**
(`src/sections/kit/locomotion.ts`) and **K9 darkness** (`src/sections/kit/darkness.ts`).

## State

| | |
|---|---|
| `glacier-chute` | built · autopilot finishes at 1, 2 and 4 players (~70 s of play) |
| `lamplight` | built · autopilot finishes at 1, 2 and 4 players (~40–50 s with hostiles culled) |
| K7 `slideMove` | built · `flightMove` / `deckTilt` to come from their owners (see "For the next K7 mode") |
| K9 `Darkness` | built · lamps, focused beam + battery, flares, warm pools, `lit()`, `fearOfLight()` |
| Tests | `test-sections glacier-chute lamplight` at PLAYERS=1/2/4 · `tools/test-section-crevasse.mjs` (21 checks) |

## The Glacier Chute (`src/sections/glacier-chute.ts`)

**Ends.** Starts just inside the nest mouth's transport door: the door (shut,
cyan strip) is set in the glacier face behind the party, in an ice tunnel with a
roof. The tunnel floor is four ice slabs over the first pitch; walking on (or 7 s)
cracks them (1.3 s of shaking and ice cracking) and they fall away — the slide
begins and the avalanche is loosed. Ends in a snowbank in a dark ice cave at the
bottom (a roofed runout, a snow drift against the back wall, a cold glow). Complete
when every *living* player is past the snowbank line (`Z_SNOW`): the fallen do not
hold the party at the finish (they come back with it on the next stage, or in the
snowbank if they re-form first), but anyone alive and still sliding does.

**Shape.** One analytic surface drives everything: `surface(x, z)` is the
lowest of the lanes standing at z. Each lane is a centre line (Catmull-Rom
through `PLAN`), a flat floor (half-width 4 m in the start tunnel, 7 m on the
run, 9 m on the runout, 5.5 m on the fork branches), a parabolic bank (5 m wide,
3.5 m high — the walls you ride up) and a 20 m ice wall above it. It is set as
`physics.heightAt` for the stage (the context restores the territory's), drawn
as one vertex-coloured mesh sampled from the same function, and read by the
slide for the fall line. ~1.32 km of z, ~285 m of drop.

| Beat | z | What |
|---|---|---|
| The drop | 8–40 | 25° pitch under the collapsing slabs |
| First pitch | 40–150 | 17°, speed arrives; gate 1 |
| Banked S | 150–330 | walls to ride, 4 krykna waiting on the banks, a web, **crevasse 1 (6 m)** with a kicker; gate 2 |
| The fork | 330–640 | left (+x) short with **crevasses 2 and 3 (8 m, 10 m)**; right long and wiggly, 5 drops + 4 webs; gates 3–4 on both |
| Rejoin | 640–700 | gate 5 |
| Ice tunnel | 700–884 | roof with icicles, 4 ceiling drops, 3 webs; gate 6 |
| Final pitch (climax) | 884–1160 | steepest ice (22°), avalanche surging, 3 bank krykna, a web, 2 drops, **crevasse 4 (12 m)**; gates 7–8 |
| Runout | 1160–1320 | into the dark cave, the snowbank |

**Crevasses** are a gap in the surface (the floor drops 60 m) with a 0.55 m
kicker before the lip and a shelf at the lip's height beyond it, so the far side
is level with where you took off: a plain jump at 16+ m/s clears 12 m, slower
wants the jetpack or the super-jump's hold. Orange wands mark both lips.
Falling in is caught at 7 m below the rim and re-forms you at the next gate.

**Flag gates** (8): red-flagged poles either side of the lane and a banner
across it; a branch gate stands on both branches. They are the re-form points.

**The avalanche** (`PathFront`, K4) is loosed with the collapse, 50 m behind
the start, 4 s delay. It runs at 15.5 m/s (14 solo), 19 (17.5 solo) on the final
pitch, dies at the cave mouth. If it falls more than `LOOM` = 70 m behind the
last of the party it runs at 21 m/s to close up — so it is always there on the
HUD and in the rumble (`audio.setBurrowRumble`) but only meets a body that
stalls (a crash, a web, stopping to fight). Caught = re-formed at the next gate
at least 55 m ahead of it. It kills the brood it rolls over.

**Enemies.** Krykna (the board's own) posted on the banks (woken as a body
comes within 45 m) and **drops**: a shadow on the ice for 1.1 s, then the spider
falls from 7 m. **Webs** are breakables on the lane (16 hp): riding through one
is a 3.2/s drag (roughly half your speed); a bolt or the slide kick tears it.

**Respawn.** `reformGate(slot)`: the next gate after the higher of your own
progress and (avalanche + 55 m), but never past the leader's next gate. Before
the collapse, the tunnel floor.

**HUD.** Speed bar (`22 m/s`), avalanche bar (fills as it closes), line:
`Avalanche 64 m behind` / `Kick!` / `Wiped out · clear the lane ahead` /
`Regroup · 2 still sliding`. Objective: the next gate of the rearmost player
(`beacon: false`), hints for the start, crevasses (`Crevasse ahead · jump!`),
the fork and the snowbank.

**Autopilot.** Rides its lane (even slots left, odd slots right on the fork)
by steering onto the centre line with a look-ahead yaw, jumps at the lip (and
holds A over the gap), kicks whatever is inside the kick's reach ahead, shoots
all the way, holds the camera pitch level against the recoil.

## K7 slide (`src/sections/kit/locomotion.ts`)

`slideMove(opts)` returns a `SlideMove`; hang `slide.move()` on
`Player.sectionMove` (compose with `composeMoves`). `opts.lane(x, z)` gives the
channel (`SlideLane`: axis, signed side, floor half-width, bank width),
`opts.drag(p)` extra drag (webs), `opts.onKick` (tear webs), `opts.active(p)`,
`opts.crash` (default on).

- **Gravity along the slope** — only on the heightfield (a box underfoot is
  flat ground): `pull · n.y · (n.x, n.z)`.
- **Traction ≈ 0** — no damping toward the stick; only drag `0.0064 · v²`.
- **Steering** — the stick's X is a *force across the channel* (the lane's
  axis; off the lane, the travel), 15 m/s² (3.5 in the air), not a heading
  change. Sideways momentum carries over: the ice only takes `lateralGrip`
  0.35/s of it, so a turn drifts on after the stick lets go. Edging *out*
  (pushing the way you already slide across, or downhill on a bank —
  `steerTilt` 0.3 s of the cross-slope pull counts as momentum) bites ×1.3;
  digging back *in* against it ×0.55; with no sideways momentum both get the
  mean. The asymmetry is full at 2 m/s across (`steerMomentum`), and the stick
  cannot push past 12 m/s across (`maxLateral`).
- **Push off** — stick forward under 7 m/s shoves at 6 m/s² (the flat, a stall).
- **Dig in** — stick back: extra drag `0.4 · |y|` per second, spray.
- **Banks and walls** — past the floor, outward velocity is turned back along
  the channel (speed kept) in proportion to how far up the bank you are; the top
  of the bank is a rail at any height (nothing leaves the channel sideways, not
  even flying).
- **Crash** — into a standing hostile above 8 m/s: keep 35% of your speed, take
  10, it takes 12 and goes over. 0.8 s cooldown.
- **Melee from the slide** — the fighter's own swing (staff, sabers, fists,
  the melee-only heavy on Y), played on the arms while the legs keep the slide.
  `SectionMove.carried` keeps the lunge and planted feet out of it, so the
  speed stays the slide's. A swing that connects while sliding puts its target
  down for 1.1 s and does at least 22, +0.6 per m/s over 8 (`meleeHit`). The
  boots go out with the press and tear a web within 3.4 m (`onKick`, 0.55 s
  cooldown). At slide speed the body covers ~4 m between the press and
  the contact key, so a blade sweep alone met a spider in the lane only about
  half the time; a carried swing that has struck nothing yet also lands by
  reach from the opening of its contact window to its key (weapon reach + 0.12 m per m/s, out to ~110° round the
  side; `CARRIED_SWING` in player.ts). (Was: a reach-based kick that swallowed the melee button, with no
  animation, so saber users had nothing that read as an attack.)
- **Buttons** — no sprint, no dodge, **hip-fire only** (aim is cleared).
- **Camera** — while the look stick is idle: yaw swings to the direction of
  travel (λ 2.2), pitch tips down by half the slope. FOV already widens with
  speed through the camera's own pace term.
- **Pose** — `crouch()` holds `slideLower` (anim/clips.ts) while grounded
  above 2.5 m/s: feet first, the torso reclined 40° by the hips, the lead leg
  50° forward with the toes up, the trailing leg a half-step back, boot flat.
  `Player.syncVisual` then tips the body onto the ice (0.75 of the pitch
  along the facing, 0.8 of a bank's roll; `SLIDE_POSE`), brings the neck
  forward so the eyes stay on the run, and lifts or lowers the body so the
  lowest *visible* sole sits on the heightfield. Soles come from
  `PlayerCharacter.feet()`: the authored ankles, with each sculpt's rest
  ankle height measured at load (Din's ~15 cm), or the rig's.

Tuning (`SLIDE` in the file): pull 16 and drag 0.0064 give ~19 m/s cruise on
the fork's 11°, ~22 on the S, 26–28 on the final pitch (cap 28). Pull 11 felt
sluggish (9 m/s after 3 s from rest on 17°); 16 gives ~12. Crash/kick numbers
were set after watching the autopilot ride through the brood untouched — a
section where the spiders cannot touch you is not a fight. The design's "~2 min"
comes out at ~70 s for a clean bot line; players crash, fight and dig in.

**For the next K7 mode.** `flightMove` should be a sibling factory in the same
file, using the same two hooks: `adjust` for button meanings and `steer` for
the horizontal velocity (return true), plus `crouch`/new pose hooks as needed.
The shared helper (`basis`) is at the bottom. The pose hook in
`player.ts` is `SectionMove.crouch`; add a sibling rather than overloading it.

## Lamplight (`src/sections/lamplight.ts`)

**Ends.** Starts in the snowbank the chute ended in: a snow drift against the
south wall of chamber A, a faint cold light where the chute's snow came through.
Ends when the last web wall (in the passage north of chamber C) has burnt open
and a player walks through it into the queen tunnel (stage B, interior).

**Layout.** Flat rock floor (`heightAt = Y0`), roof at 11 m (a dark dome per
chamber, `ceilingY = Y0 + 11`). Chambers are rings of rock columns (collider
cylinders r 2.6, overlapping) open only at the tunnel mouths:
A c(0,0) r17 · B c(8,58) r20 · C c(0,116) r16. Crawl tunnels (4.4 m wide,
3.4 m high, box walls and roof) run along x=4. Each chamber has 3 braziers,
3–4 red-glowing nests the brood comes out of, silk-wrapped egg clusters (faint
amber glow), hanging silk sheets.

**Rules.**
- **Brazier**: hold Y 2 s (1.6 solo) → flames, a 6 m warm pool, a checkpoint,
  the chamber's boldness clock reset. Unlit, its ember (unfogged) is visible
  from anywhere in the chamber — the way on in the dark.
- **3/3 lit** → the web over that chamber's way on shrinks back (1.6 s).
  Chamber C's third sets the last web **burning** for 6 s while the whole brood
  comes in two waves (3+party, then 2+party three seconds later), all bold.
- **The brood**: on first entry `[4,6,7] + party−1` (`[3,4,5]` solo), then one
  more from a nest every `6 − ci` s (`9 − ci` solo) while the chamber is dark
  and under its cap (`3 + party + 2·ci`).
- **Boldness**: 60 s (90 solo; C 45/70) in a chamber without a new brazier →
  "The brood grows bold": its krykna stop fearing lamps (never pools or flares).

## K9 darkness (`src/sections/kit/darkness.ts`)

`new Darkness(game, group, opts)`: dims every light in the scene (not under
`opts.keep`) to 4% and restores it on `dispose()`. `move()` is the input hook
(aim = focus, rocket = flare). `update(dt)` runs the lamps, flares, pools and
the dazzle. `lit(pos, lift, kinds?)` answers "what light is this point in"
(`beam` > `lamp` > `flare` > `pool`; lamps need line of sight). `fearOfLight(dark,
bold)` is a ready `Enemy.sectionSteer`.

| | |
|---|---|
| Lamp | SpotLight 0xfff0d8, half-angle 0.46, range 30, power 70, decay 1.3, shadowless, from the helmet along `cam.aimDir` |
| Beam | aim held: half-angle 0.17, range 44, power 260; battery 6 s, refills in 9 s, locked out under 20% once flat (it gutters) |
| Dazzle | 1.5 s in a beam → `knockdown(2)` (down = double damage, the existing rule) |
| Flare | rocket button, 7 s cooldown per player, thrown 15 m/s + 4 up, burns 20 s, 11 m radius; 2 pooled point lights (a third flare takes the oldest's) |
| Pools | `addPool(pos, r)`; the 3 nearest the party carry a point light |
| Fear | in a lamp: out of the cone sideways (0.85) and back (0.45) at 85% speed, facing the light; flare/pool: straight out at 105%; never steps into a pool even hunting |

Lights are fixed from the start (4 spots, 3 pool, 2 flare) so no shader
recompiles mid-fight.

**Beam hint (Lamplight).** The HUD line reads `Hold LT · RMB to focus the beam`
by default, and `Spider in the lamp · hold LT · RMB` whenever a spider is in
your own unfocused lamp — the moment it matters (the controls page does not
mention it; the job page in `guide.ts` does).

## Round 2 (2026-09-28, after merging the working branch)

- Chute completion: every living player past the snowbank (was: every player
  alive and past it). Guide text updated. Two new checks in the suite.
- Lamplight: the beam hint above.
- Main's stick gait (tilt under 0.9 walks): the Lamplight bot's partial `moveY`
  near a goal is now full stick; the chute bot already used full stick, and the
  slide's `steer` reads the raw stick, so the gait does not touch sliding.
- Main's new crouch poses: the surf (`crouchWalkLower` held still) still reads —
  checked side-on, lower and more bent than before.
- `glacier_chute.jpg` has landed and is on the ice.

## Shared-file changes (each a small commented block)

- `src/sections/api.ts` — `SectionMove.steer?(p, dt, input, game)` (own the
  horizontal velocity; the rest of the frame runs as normal) and
  `SectionMove.crouch?(p)` (hold the crouched pose).
- `src/sections/kit/moves.ts` — `composeMoves` forwards `steer` and `crouch`.
- `src/player/player.ts` — `updateGroundMove`: an `else if (sectionMove.steer)`
  branch before the ground damping; `updateLocomotionAnim`: the surf pose
  (`crouchWalkLower` held still) when `crouch()` says so.
- `src/enemies/enemy.ts` — `Enemy.sectionSteer` field, and one line at the top
  of `steer()` that runs it (never over a stagger).
- `src/text.ts` — only the `glacier-chute` and `lamplight` blocks.
- No change to `game.ts`, `hud.ts`, `campaign.ts`, `vehicles.ts`.

Suites run for them: `test-modes`, `test-brood`, `test-sections chimney`.

## Assets

No new requests. Uses `glacier_chute.jpg` (requested; `ice_albedo` until it
lands), `web_sheet.png` (requested; a drawn web until it lands), `cliff_ice`,
`snow_albedo`, `cliff_basalt`, `basalt_albedo`, and the props
`cliff_pillar_ice` (seracs on the glacier top) and `forge_brazier` (the braziers,
at 1.5 m) — both with stand-ins.

## Known issues / left

- The design says "aim assist up one notch" while sliding; not done (hip-fire's
  own soft-lock applies).
- "Camera slightly closer" in Lamplight is not done: the chase distance is the
  player's own dolly setting.
- The Lamplight bot is a perfect lamp user and finishes in ~40–50 s; humans in
  the dark will take several minutes. The brood numbers are the lever if it
  plays short.
- The avalanche is a boiling wall of white puffs (stand-in); a proper snow cloud
  (sprites or a volumetric texture) would sell it better from behind.
