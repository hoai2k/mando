# Character Animation Audit & Improvement Strategy

*Audited 2026-08-29 against the live clip set in `src/anim/clips.ts`,
`src/anim/quadruped.ts`, the retargeter in `src/characters/authored.ts`, and
how `player.ts` / `enemy.ts` actually play the clips. Method: code read,
numeric rest-pose measurement of every shipped `.glb`, and workbench renders
(`/workbench/`) of each pose family frozen at their key frames.*

*Second pass, same day: every roadmap item below is now implemented (see the
status table in §6), and a full-roster pose sweep (§7) audited the rest of
the cast. Sections 3-5 are kept as written — they are the reasoning behind
the changes.*

---

## 1. Rig findings (fixed alongside this audit)

### 1.1 Arms sat ~10-15° too tight to the body

Every authored character is sculpted in an A-pose. Measured world direction of
`DEF-upper_arm.*` at rest, per model:

| Model | Arm splay from vertical | Model | Arm splay |
|---|---|---|---|
| din | 19.4° | ventress | 26.6° |
| paz | 16.0° | bossk | 31.0° |
| bokatan | 18.1° | embo | 27.5° |
| armorer | 22.0° | stormtrooper | 24.4° |
| tusken | 23.9° | darktrooper | 28.9° |
| *(24 humanoids total)* | **mean ≈ 24°** | ig11 (thin droid) | 9.4° |

The retargeter pulls each arm's rest to *straight down* (`CANON_DIR`), so a
clip's Z splay is the **absolute** angle the arm hangs at — and the idle/run
clips only gave back 14°/12°. Net effect: arms held ~10-15° inside the pose
the deltoid and biceps geometry was sculpted around, pressing into the torso.
This was the "arms feel tight while running" symptom, and it was adduction,
not shoulder height — clavicle elevation measured 0° in every file, and the
retargeter never moves authored bone *positions*.

**Fix:** idle splay 14→21°, run splay 12→19° (`clips.ts`), landing within a
few degrees of the sculpted A-pose across the roster. Air (45-50°) and flight
(28-32°) already cleared. The splay-sign and splay-amount conventions are now
documented at the top of `clips.ts` for future clips.

### 1.2 Procedural fallback: shoulders buried mid-torso (noted, not changed)

On the stick-figure builds the chest box reaches ear level (top at +0.27 above
the chest joint) while the shoulder bones hang at +0.048 — the arm pivot sits
0.22 m below the "shoulders" of the mesh, which is a genuine "shoulder bone
too low" look. Deliberately left as-is: every character in the roster ships an
authored model, so the procedural build is only ever a loading-order fallback
and the retargeter copies rotations, not positions — the bone placement never
reaches the models players actually see. If it's ever revisited, the recipe is
shoulder joints at `chestLen * 0.5` with the chest slab shortened to top out
just above them.

### 1.3 Enemy melee weapons drifted from the authored fist

Enemy weapons stayed on the canonical `weaponR` bone — but that bone rides
the *hidden procedural* arm, whose proportions differ from the sculpt's, so a
gaffi/club/darksaber floated a hand-width or more from the authored fist at
the top of a swing, and the §7 sweep showed rifles hovering mid-chest in aim
poses too. **Fix:** everything on the weapon bones re-mounts into the model's
hands on load, exactly as player weapons already did. The muzzle group
travels inside the weapon group and shot direction is chest-derived, so
firing is untouched.

---

## 2. Clip inventory & verdicts

| Clip(s) | Role | Verdict |
|---|---|---|
| `idleLower/Upper` | breathe, sway | ✅ good (splay fixed) |
| `runLower/Upper` | 0.6 s cycle, measured stride, rate-matched | ✅ solid mechanics — see §4.1 for the strafe gap |
| `airLower/Upper`, `flyLower/Upper` | jump / jetpack | ✅ reads well |
| `rideLower/Upper` | vehicle saddle | ✅ fine |
| `aimUpper`, `enemyAimUpper` | carbine / one-hand aim | ✅ hand-tuned, leave alone |
| `melee1/2/3` | staff combo | ⚠️ good shapes, upper-body-only, metronomic velocity (§3.1) |
| `saber1/2/3` | Ventress twin blades | ⚠️ good sequencing, missing stance/footwork/flourish (§3.2) |
| `enemySwing` | telegraphed overhead | ✅ right for gameplay |
| `blockLower/Upper` | shield brace | ✅ has a lower-body stance — the model for melee |
| `hitUpper` | flinch | ⚠️ single non-directional react (§4.3) |
| `deathLower/Upper`, `collapse*` | scripted deaths | ✅ superseded by ragdoll for kills |
| massiff `gallop`/`idle` | quadruped | ⚠️ good gait, level spine (§5.1) |
| krykna `move`/`idle` | octopod skitter | ⚠️ mechanically strict pairs (§5.2) |
| drone `idle` | hover bob | ✅ fine |

---

## 3. Melee choreography

### 3.1 Staff combo (`melee1/2/3` — gaffi, clubs)

What's right: three distinct silhouettes (cross-body cut → backhand →
overhead finisher), correct anticipation/strike/recover proportions
(~26/33/40%), chest and head lead the swings, the finisher is the slowest and
biggest (0.55 s vs 0.38/0.42) and gameplay backs it (55 dmg + knockdown vs 32).
The hit lands at 45% of clip duration (`player.ts`), which falls inside the
strike interval of all six player clips — verified against the key times.

What would make it better, in order of visible payoff:

1. **Lower-body engagement.** Swings play on the upper channel while the legs
   keep idling/running. `blockLower` proves the pattern: give each swing a
   short lower one-shot (weight drop + front-foot step for 1, rear-foot pivot
   for 2, a full step-through for 3) played with `playOnce('lower', …)` when
   the player is grounded and slow; skip it above walking speed so the lunge
   impulse still owns the movement.
2. **Velocity shaping.** Keys are near-evenly spaced, so quaternion
   interpolation gives the strike the same angular velocity as the windup.
   Real hits *hold* the cock a beat and release fast: move the strike key
   closer to the windup key (e.g. melee1 `0 / 0.14 / 0.20 / 0.38` instead of
   `0 / 0.1 / 0.22 / 0.38`) — same poses, whip-crack timing. Cheap, big.
3. **Contact feedback.** 40-60 ms of hit-stop (freeze `animator.update` on the
   attacker) plus the existing knockback would sell impact more than any pose
   change.

### 3.2 Ventress' twin-saber set (`saber1/2/3`)

What's right — and worth keeping exactly as designed: the combo alternates
leads (right lead → mirrored left lead → both-blade cross-slash), the
off-blade counter-poises instead of hanging dead, the head tracks each cut,
and the finisher gathers both blades across the chest before throwing them
apart. That is genuine dual-wield sequencing, not a mirrored staff swing.

Gaps, in priority order:

1. **No saber stance.** Out of a swing she holds the generic `idleUpper` /
   `runUpper` — blades hanging at her thighs like tools. A duelist reads from
   the *ready*, not the swing: add `saberIdleUpper` / `saberRunUpper`
   variants (main blade low-forward guard, off blade reversed behind, ~30°
   chest turn) and have `player.ts` pick them when
   `MANDO_ROSTER[id].melee === 'sabers'` and the melee weapon is out. This is
   the single biggest "her technique looks choreographed" win.
2. **Footwork**, same recipe as §3.1 — fencing steps rather than weight drops:
   advance-lunge on 1, passing step on 2, and for the cross-slash finisher a
   rising gather onto the toes before the release.
3. **A flourish beat.** After the combo window lapses (`meleeComboWindow`),
   play a 0.4 s wrist-spin one-shot as the blades come back to guard —
   punctuation that costs one clip.
4. **Blade trails.** A short-lived ribbon (last 4-6 blade-tip positions,
   additive, fading) during `meleeTimer > 0` — the eye reads arc, not pose,
   at combat speed. Pairs with the velocity-shaping pass: a whip-crack strike
   makes a longer, cleaner trail.

### 3.3 `enemySwing`

The 0.3 s telegraph before the 0.15 s strike is a *gameplay* feature
(dodgeable), and the return pose matches the staff set. Leave it; if anything,
add the same velocity shaping so the drop after the long hold reads heavier.

---

## 4. Locomotion & reactions

### 4.1 The strafe gap (biggest visible flaw left)

In combat (`combatFacing`) the character faces the camera while velocity can
point anywhere — and `runLower` plays regardless, so side-stepping and
back-pedaling pump the legs *forward* while the body slides sideways or
backward: a moonwalk. The stride-measurement system can't hide it because the
legs swing in the wrong plane entirely.

Strategy: author `strafeLower` (legs crossing laterally, 0.6 s, same key
grid) and reuse `runLower` at negative `timeScale` for back-pedal — then in
`player.ts` pick lower clip by the angle between facing and velocity
(> 120° → reverse run, 45-120° → strafe with `timeScale` sign from left/right,
else run). The two-channel animator needs no changes; `cycleDistance` already
measures whatever clip it's handed (add lateral measurement for the strafe
clip, or hand-tune its rate).

### 4.2 Run personality (cheap wins, all in-clip)

- ±1-2° of chest roll (Z) opposing the yaw twist that's already there.
- Paz/heavies: play run 8-10% slower via a per-character `gaitRate` bias so
  bulk reads in the stride, not just the silhouette.
- 2-3° foot-roll asymmetry between left and right keys so the cycle doesn't
  read as perfectly mirrored.

### 4.3 Hit reactions

One flinch clip, always frontal. Two more one-shots (`hitFromL`, `hitFromR`
— chest+head thrown with the bolt direction, pick by the attacker bearing
already passed to `damage()`) would make fire-fights read directional for the
cost of ~20 track lines.

---

## 5. Quadruped & creature gaits

### 5.1 Massiff gallop (`quadruped.ts`)

The gait itself is well built: transverse gallop (front pair leads rear by
half a cycle, left leads right by a beat), 55% stance hold so the feet push
instead of prance, spine arch at 2× stride frequency, head counter-motion.

Missing: **vertical travel**. The clip deliberately owns no bob ("the enemy's
own position does that") — but the enemy controller never adds one, so the
authored massiff gallops with a dead-level spine, which is what makes it read
slightly like a toy on wheels. The procedural fallback *did* bob
(`body.position.y + |sin| * 0.07`). Fix in the clip, where the phase can lock
to the legs: a position track on the spine root at 2× stride, ±0.05 m in
model units (the drone's `droneClips` already shows the pattern, including
the world-scale correction), plus ±2° of body roll on the lead beat.

Second gap: at approach speeds the gallop just plays slow (`timeScale` clamps
at 0.4) — a *walk* clip (4-beat, lateral sequence) cross-faded in below
~2.5 m/s would let it stalk, which suits how the massiff is written.

### 5.2 Krykna skitter

Alternating tetrapod is correct for a spider, but the two groups are locked at
exactly 0 / 0.5 phase, all legs swinging in the same plane — mechanical. Three
small de-phasings: offset each leg inside its tetrad by 0.03-0.06 of a cycle
(rippling contact), add the body-height micro-bob the procedural fallback had,
and give leg roots a few degrees of Y yaw during swing so front legs reach
and rear legs push rather than all rowing in parallel.

### 5.3 Drone

One looping hover-idle with de-phased arms is the whole performance and it
reads fine; the controller's root motion does the rest. No action.

---

## 6. Systemic strategy

**Pipeline notes**
- Clips are absolute poses over an all-identity rest, shared by species and
  cached — any new clip is ~15 lines in `clips.ts` and zero runtime cost
  beyond its tracks. The workbench pose editor exports edits in `qt()` units,
  so pose polish can be done visually and pasted back.
- The 45%-of-duration melee contact time works today only because the clips'
  strike intervals happen to straddle it. When re-timing swings (§3.1.2),
  move the contact to per-clip metadata (`{ clip, hitAt }`) first, or the
  whip-crack re-time will land hits before the blade moves.
- Convention corrections that were wrong or missing in comments are now in
  `clips.ts` (splay sign *and* amount); `authored.ts`'s side-label comment
  has the X-signs backwards too but its mirror logic and conclusion are
  correct — worth a one-line fix next time that file is touched.

**Roadmap → all implemented** (same change set as this doc's second revision):

| # | Work | Status |
|---|---|---|
| 1 | Strafe/back-pedal lower clips + picker (§4.1) | ✅ `strafeLower` + programmatic mirror + reversed run; picker in `player.ts` by facing/velocity divergence; `cycleDistance` measures lateral sweeps; `gaitRate` takes the character's world scale so heavies stride slower instead of skating |
| 2 | Saber stance idles/run for Ventress (§3.2.1) | ✅ `saberIdleUpper` / `saberRunUpper`, picked whenever `sabersDrawn` |
| 3 | Melee velocity shaping + hit-stop (§3.1.2-3) | ✅ strike keys pulled tight behind held windups on all seven combat clips (contact times re-checked); 55-90 ms attacker hit-stop on landed hits |
| 4 | Lower-body melee stances (§3.1.1, §3.2.2) | ✅ `meleeLower1-3` one-shots under the swings, played when grounded and near-stationary (the lunge owns the legs otherwise) |
| 5 | Massiff bob + walk, krykna de-phase (§5) | ✅ gallop carries a spine-root bob (`lift()` handles parent-space/world-up conversion); a 4-beat `walk` blends in below gallop speed; krykna legs rippled off the strict tetrad + carapace bob |
| 6 | Blade trails + saber flourish (§3.2.3-4) | ✅ `makeBladeTrail` ribbons on both blades during swings; `saberFlourish` one-shot fires when the combo window lapses with blades lit |
| 7 | Directional hit reacts (§4.3) | ✅ `hitFromR` + mirrored `hitFromL`, picked by attacker bearing in `enemy.ts` |
| 8 | Run personality pass (§4.2) | ✅ chest roll against the yaw twist, foot-roll asymmetry, scale-aware gait rate |

---

## 7. Full-roster pose sweep (second pass)

Every workbench subject was rendered in the poses its kind actually plays
(~140 frame-frozen shots: playables ×7-10, shooters ×4, melee enemies ×4,
creatures ×2-3), reviewed as contact sheets.

**Fixed from the sweep's findings:**
- *Shooters' rifles floated off the authored hands* — worst on the marshal,
  pirate and capo, whose rifles hovered mid-chest in `enemyAimUpper`. The
  melee weapon re-mount was extended to **all** enemy weapon-bone children:
  the muzzle group travels inside the weapon group, and shot direction is
  computed from the chest, so firing is untouched. Verified: marshal/pirate
  rifles now sit in the extended hand along the aim.

**Verified good across the sweep:** every playable's idle/run/aim/fly/
melee/block/death; the Tusken's three-hit staff combo with the gaffi in its
fist through the full windup; the officer's two-hand darksaber swing; the
alamite/pirate club swings; nikto saddle pose; krykna/broodmother rippled
skitter; drone hover; duelist twin pistols; IG-11's whole set.

**Known limitations (documented, not fixed):**
- Authored hands are not posed around grips — an open sculpted palm holds a
  rifle by intersection. A per-model finger pose (or a sculpted grip pose in
  the export) is model work, not rig work.
- Some enemy rifles sit canted relative to the true fire direction in
  `enemyAimUpper` (bolts still fly true — direction is chest-derived). A
  per-character aim-pose polish pass in the workbench editor would tighten it.
- The massiff reads correctly in motion but the workbench's auto-framing
  fills the viewport with it; judge it zoomed out.
