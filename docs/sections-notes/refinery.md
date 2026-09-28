# Refinery — The Line and Lights Out (and K6 detection)

Branch `claude/sections-refinery`. Owner files: `src/sections/the-line.ts`,
`src/sections/lights-out.ts`, `src/sections/kit/detection.ts`, the two
`TEXT.sections` blocks, their lines in `index.ts`/`ids.ts`, and
`tools/test-section-refinery.mjs`.

## State

| Item | State |
|---|---|
| K6 detection (`kit/detection.ts`) | built; covered by the mechanics suite |
| The Line (`the-line`) | built; registered; `test-sections` passes at 1, 2 and 4 players |
| Lights Out (`lights-out`) | built; registered; `test-sections` passes at 1, 2 and 4 players |
| `tools/test-section-refinery.mjs` | 22 checks, all pass |

Placement was already in `SECTION_PLACEMENT`: the Refinery runs
A (yard) ⇒ **The Line** ⇒ B (the plant) ⇒ **Lights Out** ⇒ C (reactor crown).

## K6 — `src/sections/kit/detection.ts`

General on purpose (Worm Sign uses the noise half).

- `DetectionField(game, opts)`: one meter per player, 0..1. `decay` (per s)
  after `hold` s with nothing feeding it. `thresholds: [{ at, onCross(slot),
  onClear?(slot) }]` fire on the way up and, once the meter drops under half the
  mark, on the way down. `enabled = false` freezes every meter.
- **Noise** is read off each player every frame: a shot (`fireCd` jumps), a
  jetpack or super-jump thrust, sprinting, walking (0 by default), landing and
  landing hard. Rates in `NoiseRates` (defaults in `DEFAULT_NOISE`),
  overridable. `noiseGate(p)` scales it per player (Lights Out: only if an
  unaware hostile is within 22 m; Worm Sign: only on sand). `noise(slot, n)`
  adds a section's own sound. `heard[slot]` is this frame's noise and
  `loudest()` the loudest player.
- **Light**: `addCone({ origin, dir, halfAngle, range, rate, tag })` returns a
  `LightCone`; mutate `dir` to sweep, `on` to switch it off. It fills the meter
  of anyone whose chest is inside it with a clear line of sight (throttled to
  every 0.12 s per cone and player), faster on the axis and close in.
  `litBy[slot]` is the cone lighting each player. `coneAt(pos)` and
  `lightAtGround(x, y, z)` answer "is this spot lit" for autopilots and for
  `board.lightAt`.
- **Masks** (`addMask(centre, r)`, toggle `.on`): steam. Block every cone's
  line through them and swallow the noise of anyone standing in one.
- `clearLine(a, b)` skips its first metre, so a lamp never blinds itself on
  its own mast.
- **`Takedowns`**: the silent takedown rule. A melee hit on a hostile that is
  `idle` or `alerted` — or turned `engaged` less than 0.6 s ago — from outside
  its front 110° (judged by the facing it had while still calm) does its whole
  health. Route the player's melee through `takedowns.meleeHit` (a
  `SectionMove.meleeHit`) and call `update()` every frame. `eligible(e, from)`
  for autopilots, `count`, `onTakedown`.

## The Line — how it plays

The intake processing floor, just inside the intake ramp's blast door (shut
behind the party, its two light strips matching stage A's door). A hall
110 × 26 m, 14 m roof, the plant's own textures and tints (`deckTexture`,
`hullTexture`, 0x767a80 / 0x8a8d92) so it reads as the same building as
stage B. Four belts (3, 5, 5, 7 m/s) carry bodies, crates and rhydonium
barrels toward the smelter; the belt texture is drawn on a canvas so the motion
reads without art (`conveyor_belt.jpg` upgrades it).

1. **The belts** (z 2–30): troopers on both catwalks, a pair on the floor.
2. **Two press rows** (z 30 and 56): frames that span the hall floor to roof,
   so the only way on is the opening over each belt, and a press head slams
   into each on its own cycle (1 s warning: a hiss and a red strip on the
   belt). The rows are staggered so some belt is always open; the second row's
   windows are shorter. Under a press: 38 damage (30 solo), spat back out
   upstream. Crates queue at a shut press and get crushed under a falling one;
   barrels caught by one explode.
3. **The arms** (z 60–86): three welding arms sweep a boom across two belts at
   waist height (16 damage and a shove). Jump it, or walk the floor lanes,
   which pass under it and which the flametroopers hold.
4. **The smelter** (z 86–104): the floor lanes end at a slag pit, the belts
   surge ×1.5, and the only ground is the door deck by the plant door. Its
   release is held 4 s (3 solo) while the last squad comes along the gantry
   and down onto the deck; a second squad drops in when the release is thrown.
   The door lifts, and stepping through is the transport into the plant.

**Brake switches** on the catwalks (station 1 right, 2 left, 3 right; hold 1.5 s)
hold the machines of the station ahead for 15 s (25 solo): the press row
locks open or the arms park. Never required; every press can be timed.

Checkpoints: the entry, past each press row, the door deck. Off-path (the pit,
the smelter mouth) re-forms at the last one. Autopilot: everyone keeps right —
right walkway, the fast belt past the deck, slot 0 throws the right-side
switches; the rest wait at each frame for a press with ≥ 1.5 s of open window
and no crate in the way.

## Lights Out — how it plays

The tank farm behind the plant, 90 × 70 m at night: the plant's back wall and
the airlock the party came out of behind them, tank rows on three sides (with
a wall behind them past the ceiling, so the gaps are not doors), the reactor
crown's base in the far corner with a lit stair up its west face, and the
reactor itself looming over the tanks as the landmark.

- **Seen** (K6): searchlight pools fill the meter at 1.7/s × exposure — a
  player standing in one trips the alarm in ~0.53 s (measured; the design says
  0.6). Sensor posts at 1.3/s. Noise near an unaware trooper: a shot 0.3,
  jetpack 0.4/s, sprint 0.15/s, a hard landing 0.25. Decay 0.25/s after 1.5 s.
- **Troopers' own eyes**: `Enemy.stealthSight = { scale: 0.5, behind: 1.8 }`
  and `board.lightAt` (1 in a beam, 0.6 on the stair, 0.5 under a sodium lamp,
  0 in the dark). In the dark a stormtrooper sees about 9.5 m ahead, 4.7 m to
  the side and 1.8 m behind. **A trooper who spots you radios it in after 3 s**
  unless he is dropped first; the HUD shows the countdown.
- **Takedowns** from behind within lunge range (≈ 2.5–3 m) kill in one blow,
  silently; tested with a jetpacker and a super-jumper.
- **Steam vents** (four, 4.5 s on in an 11 s cycle) block the beams and mask
  noise; a pale plume shows it.
- **The booth** (SE, on a platform against the plant wall): hold 1 s — every
  searchlight dark for 10 s, 20 s to recharge. The SE patrol stops at its
  steps.
- **Patrols**: west lane (1, turning at z 22 so it never sees the party forming at the airlock), round the middle tank (1), north lane (1, a pair
  at 3+), the east lane via the booth (1), a middle-east loop at 2+; two stair
  guards (one watching the lane, one watching the stair with his back to it;
  a deathtrooper at 3+), and a third sentry at 4.
- **The alarm** (a full meter or a radio call) is never a fail: red
  searchlights hunt, fences seal the three pipe-rack lanes, three turrets rise
  out of hatches at the tank rows (120 HP, shootable; 6–7 damage a bolt), a
  drop lands near the party, and the whole yard is alerted. Once the drop is
  dead (or 45 s have passed) an alarm console (three: by the airlock, by the
  booth, by the stair) resets it with a 3 s hold, and the yard goes dark again;
  anyone still hunting stays hunting but cannot start a new radio call.
- The stair's top is the transport to the reactor crown.

Night: while the yard stands, the board's hemisphere and directional lights,
the scene's ambient and the reflection probe (`scene.environmentIntensity`,
which the game resets on its first render, so it is held every frame) are
turned down, and put back on teardown. The ground is matte for that reason:
at night a glossy deck mirrored the probe into white sheets.

Autopilot: the west lane, the north lane, the stair; waits for the next
stretch to be dark before stepping on; takes down any unaware trooper close
ahead from behind; during an alarm fights, then resets at the nearest console.

## Shared-file changes (each one small and commented)

- `src/player/player.ts` `landHit`: the damage goes through
  `this.sectionMove?.meleeHit?.(…) ?? this.meleeDamage` (3 lines).
- `src/enemies/enemy.ts`: `static stealthSight: { scale, behind } | null`
  (null everywhere but Lights Out), read in `canSee` for the notice range and
  the behind range (2 lines + the field).
- `src/sections/api.ts`: `SectionMove.meleeHit?` (the hook's type).
- `src/sections/kit/moves.ts`: `composeMoves` chains `meleeHit`.
- `src/text.ts`: the two `TEXT.sections` blocks only.

Lights Out also swaps `board.update` (the plant's console alarm is kept out of
the yard) and `board.lightAt` while it stands; both are restored on teardown.

## Tuning notes

- Presses: open 2.6 s (row 1) / 1.9 s (row 2), +0.5 s solo; warn 1.0, slam
  0.16, down 0.7, rise 0.8.
- Arms: ±40° at 1.7 rad/s; placed so none reaches the mount-up point at the
  end of the right walkway (z 85.6).
- The radio's 3 s: long enough to finish a trooper who turns, short enough
  that walking away from one is not an answer.
- The behind range: 2.2 m let a guard turn before a lunge from 3 m landed
  (the takedown then read his new facing); 1.8 m plus judging "behind" by his
  calm facing makes it reliable.

## After the merge (2026-09-28)

The radio check in the mechanics suite failed on about three seeds in five on
the merged branch. The cause was state left over from earlier checks, not the
other teams' changes: after the takedown the player stood in the stair light
by the second guard, who spotted him and radioed during the next check, and
the check's own spot was sometimes swept by a searchlight or a sensor. The
check now starts from a clean alarm, sends the player back into the dark
after the takedown, and points the lights away. It also turned up one game
fix: the west-lane patrol's south turn was about 8 m from the airlock, close
enough to see the party still forming at the start and trip the alarm, so it
now turns at z 22.

## Known issues / left to do

- `hydraulic_press` and `welding_arm` sculpts: the game drives the press head
  and the arm's boom itself. When the models land, the press's own `head` node
  and the arm's `shoulder`/`elbow` should be hidden or driven instead (today
  the press's gantry sculpt hangs over an empty stand-in, and the arm's sculpt
  replaces only the base).
- `searchlight_tower`'s `lamp` node likewise: the game's drum sweeps; hide the
  sculpt's drum when it lands.
- The Line's flametroopers' flames are not pushed along the belts (design
  nice-to-have).
- Enemy bolts fired at a player on the far side of a steam plume still fly; the
  plume only blocks detection, not fire.
- The test suite culls hostiles every second, so the autopilot times are not
  play times. Played with hostiles (no cull), a solo bot is spotted in the west
  lane and fights through on the alarm; a real player has the booth, the vents
  and the takedowns.

## 2026-09-28 — after main's walk gait (orchestrator)

`main` now reads the left stick as a gait: up to 0.6 tilt walks (at most
1.4 m/s), 0.6–0.9 climbs to the run. The autopilots' careful paces were
written against a linear stick, so Lights Out's 0.55 creep became a 1.3 m/s
walk and the searchlights caught it every pass (the alarm loop never ended).
Re-set to the old speeds: Lights Out 0.74 / 0.83, The Line's slow 0.76.
