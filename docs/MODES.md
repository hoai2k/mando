# Game Modes — research, analysis & design

Three modes, **on by default** as of 2026-08-29: the title shows three choices —
**Wave Battle**, **PvP**, and **Missions** (the campaign; the mode keeps its
internal id `campaign`) — one per mode. They spent their build behind a `?modes`
URL flag; that escape hatch survives inverted, so `?nomodes` (or `?modes=off`)
puts the single **Press Start** back and the game is exactly the wave game. The
regression test drives both paths. A second testing flag, **`?waves=boss`**,
compresses the wave game to a boss rush: a single wave before each boss battle
(wave 1 → champion, wave 2 → warlord → monster), for iterating on the bosses.

**Death is a performance (2026-08-30).** Dying no longer parks the player on a
countdown: the death animation plays, the pose freezes, and the body
**disintegrates** into drifting amber motes swept feet-to-head; the respawn
**re-forms** it at the new spot — motes converging, the figure fading back in,
the camera gliding over rather than cutting. The timers *are* the respawn wait,
so the player watches the cycle instead of a clock. A re-forming body takes no
input and no damage until it is whole. Paired with `INFINITE_LIVES` (modes.ts,
on "for now") in the PvE modes: Waves and Missions have no defeat screens —
every fall is a walk back. PvP keeps its three stands; there the cycle plays
on each of them, and running out is still elimination.

This document is the research + design record; `docs/LEVEL_DESIGN.md` carries
the campaign's level-design strategy in detail. Implementation status lives in
`docs/PROGRESS.md`.

---

## 1. Research: what the codebase already gives us

The whole point of the design below is that each mode is a *rule set over the
same simulation*, not a second game. The audit of the existing systems found
these load-bearing pieces:

| System | Where | What it already supports | What each mode needs from it |
|---|---|---|---|
| Match orchestration | `game/game.ts` | wave flow, players, enemies, allies, projectiles, vehicles, split-screen render | a `mode` field and per-mode branches at exactly four points: constructor, match-flow, respawn rules, render |
| Teams | `Combatant.team`, bolt `team` | 0 = players/allies, 1 = hostiles, 2 = props; every hit test is an *inequality* (`t.team === b.team` skips) | PvP works by giving each player a distinct team (2+`slot`) — the projectile, shield and melee pipelines then referee player-vs-player for free |
| Enemy AI | `enemies/enemy.ts` | posted/alerted/engaged awareness, cover, suppression, morale, escort allies (team 0) | campaign reuses posting untouched (squads along a path *are* posts); PvP squads reuse the ally-escort branch, generalised to "escort your owner" |
| Spawning | `enemies/spawner.ts` | `planWave`/`spawnWave`, `standingSpot`, capsule-validated placement | campaign posts hand-picked squads with the same placement guard; PvP spawns no waves at all |
| Character factory | `characters/*` | every enemy build returns a `CharacterInstance` on the shared rig with a muzzle | the PvP playable-NPC adapter wraps any of them in the `PlayerCharacter` surface `Player` expects |
| Camera | `core/camera.ts` | third-person orbit rig, collision, pace-driven distance | campaign uses each player's own rig and the wave game's split-screen render, unchanged (a shared centroid camera was tried first and cut — see §4) |
| Menus | `ui/menus.ts`, `ui/charselect.ts` | pad+keyboard navigable screens; a roster-driven 3D select | title gains two buttons; the select's roster becomes a parameter (PvP hands it the NPC list) |

Genre research that shaped the campaign design (see LEVEL_DESIGN.md for the
numbers): **Gauntlet** (2014/Slayer) runs 8–12 minutes per chapter as a
chain of hand-shaped chambers — including arena floors where waves keep
coming until the room is cleared — with a readable "go this way";
**Minecraft Dungeons** chains authored rooms along one golden path — wide
pockets for fights, pinches between them, landmark rooms to mark progress,
and a beacon/arrow so nobody reads a map. Both alternate *arena beats* with
*corridor beats*; the corridor is where ranged discipline (cover, advance,
cover) replaces circle-strafing. That alternation — room, pinch, room, with
the fight rooms sealed while their waves run — is the spine of our mission
levels.

## 2. Wave Battle

The existing game, now named — plus **two boss battles** woven through it.
The run is seven waves: clearing wave 4 rings in the board's **champion**
(the mid-board boss, `MID_BOSS` in modes.ts — a monster where the board has
one, an elite lieutenant otherwise, on a lighter promotion), then waves 5–7,
and clearing wave 7 rings in the territory's **warlord** — always the harder
of the two (see §4a — the same boss system serves both battles and both
modes). Waves ramp by adding bodies and debuting kinds sooner, never by
making an enemy individually harder, and each wave that debuts a kind
announces it on a new-contact card. On the old ally-milestone waves nobody
walks in on their own any more: a glowing **covert supply cache** drops near
the party instead (`game/allycrate.ts`) — one solid hit springs it, the side
panels blow outward, and a squad of five allies (Marshal / IG-11 / Fennec by
wave) walks out to fight for the rest of that wave only. Victory comes when the warlord falls.

## 3. PvP — territory duel

**Rules.** 2–4 players (the select refuses to start with one). Free-for-all:
every player is their own team (`team = 2 + slot`). Each fighter has **3
lives**; a death costs one, plays the dissolve, and re-forms them at a spawn
far from the killer (`INFINITE_LIVES` covers only the PvE modes — the stands
here are the win condition and stay finite).
Last fighter standing takes the territory, and the end screen celebrates the
champion with their portrait held over the tally (the authored
`portrait_<id>.jpg` where one exists, the drawn face mark otherwise).
Kills and the winner go
to the end screen. No waves, no allies; parked vehicles stay (they are part of
the territory, and a swoop duel is the good kind of chaos).

**Roster.** The Mandalorian/hunter roster plus **every NPC that reads as a
character**: tusken, pyke, pirate (gunner + brawler), stormtrooper,
deathtrooper, darktrooper, jetpack pirate, nikto swoop, battle droid, security
droid variants, flametrooper, quarren, alamite, krykna, broodmother, war
massiff, gunslinger, imperial officer, pyke capo, wookiee enforcer, ring
enforcer, marshal, fennec. Excluded: the **interceptor drone** — it is a
projectile with a face, and a playable kamikaze deletes itself from the match
(listed under expansion ideas as a "possession" gimmick instead).

**Flight** only where the in-game version flies: jetpack pirate, dark trooper
and the nikto swoop get the fuel gauge; everyone else's jump button is just a
jump. (The jetpack fantasy stays a Mandalorian selling point.)

**Size** (2026-08-30). The roster is not one species, and three places have to
answer for that. The **collider** is clamped — `radius ≤ 0.6`, `height ≤ 2.1`
in the roster — so a war beast still fits the cover, doorways and mission
corridors every board was built around. The **character select** scales a
fighter down onto its plinth (`FIT_HEIGHT` / `FIT_FOOTPRINT`): a massiff
measures 3.2 × 4.9 m against a line spaced 1.9 m apart at four players, so at
its own size it did not overhang the plinth so much as swallow whoever stood
next to it. The **chase camera** is told the body's real height and reach
(`ThirdPersonCamera.setSubject`) and keeps a floor under its distance, because
the rig's numbers are tuned around a 1.8 m Mandalorian and framed a massiff
from *inside* it — a wall of hide across the whole screen.

None of that shrinks anyone in play: the collider clamp is about fitting the
world, the other two are about framing. A massiff played is a massiff. The
select measures the built model rather than the stat table, and re-measures
when the authored `.glb` swaps in over the procedural stand-in, since the two
are different sizes and a fit computed once is a fit of the wrong body.

**Balance philosophy** (imperfect on purpose, per the brief): player-side NPCs
are re-statted, not copied. Enemy-side HP/damage are tuned against a 100 HP
player under AI aim; under human aim they'd be either sponges or wet paper. The
player versions are normalised into three lanes:

- **Skirmisher** (trooper/pyke/pirate/tusken/quarren/alamite/krykna): ~100 HP,
  standard run speed, weaker bolt than the Mandalorian carbine — but they come
  with a **squad**.
- **Elite** (deathtrooper, duelist, officer, capo, ring enforcer, flame
  trooper, darktrooper, jetpirate, nikto, droid): 120–160 HP, a signature
  hook (shield pane, darksaber melee, flame-rate fire, flight), no squad.
- **Heavy** (massiff, broodmother, enforcer): 220–300 HP, melee-only, faster
  or harder-hitting than any biped up close, big target, no squad.

**Squads.** Kinds that arrive in squads in the wave game (troopers, pykes,
pirates, tuskens, krykna, alamites) give their player **2–3 AI teammates** of
the same kind on the player's team. They use the existing ally-escort AI
generalised with an `owner`: engage what threatens the owner, come back when
they stray. They respawn with their leader (a squad lead who is out of squad
is just a worse trooper). The squad is the skirmisher lane's whole argument:
your body is cheap, your volume of fire is not.

**The squad carries its leader.** A downed squad leader with a follower still
alive doesn't spend a stand: the player **takes over the nearest surviving
squadmate** — the AI shell retires quietly (no kill credit beyond the down
itself), the player stands up in its body with whatever health it had left,
and the camera glides across to the new body rather than cutting. Only a
wiped squad costs a life and a respawn (which re-forms the fireteam).

**Attack buttons.** Every playable answers X with a melee swing — the
humanoids through the canonical rig's melee combo, the creatures (massiff,
krykna, broodmother, swoop) through their own `attack` animation (the same
coil-and-strike the enemy AI plays). RT fires for anyone with a gun. Y is the
rocket for gun carriers; for a melee-only fighter it is the **heavy lunge** —
a committed leap onto the nearest target that lands as the knockdown finisher,
on a 5 s clock.

**The brood-queen loop.** The playable broodmother fights with eggs. The
sacs on her back are her **clutch and her ammunition readout**: capacity is
exactly the sacs the model shows (`BROOD_EGG_RACK`, 3), every sac starts
shaded dark, and one charges every **3 seconds** — flashing blue a couple of
times as it finishes, then holding white until spent. **Y lays** a charged
egg behind her; **RT lobs** one on an arc at whatever is under the aim, and
the flying egg is a soft cannonball: the first body it meets is knocked
back, unhurt. Either way the egg physically leaves **from the sac that goes
dark** — spawned at that sac's world position and tossed or thrown from
there — so it reads as the same egg being delivered. Either way the egg takes **5 s to hatch** and is destroyable
the whole time — it is a real combatant on her team, so rivals can shoot it
out from under her; what crawls out is a half-size krykna **hatchling** that
hunts for her through the squad-escort AI (the nest is capped at 8 living
brood). When she falls with a hatchling still alive, the takeover puts the
player *in the hatchling's body* (a mid-match morph — position, camera,
kills and lives carry over), and surviving **ten seconds** in it grows them
back into the broodmother, health fraction preserved. Dying as the hatchling
spends the stand as normal and respawns the fighter that was picked. The
hatchling body (`npc:spiderling`) exists only to be morphed into — it is
filtered off the select screen.

**What referees it.** All target acquisition (aim assist, melee sweep, saber
deflect, rockets) goes through one new helper — `game.hostilesFor(player)` —
which returns everything alive whose team differs. The projectile system
already resolves shields, deflects and credit by team inequality.

**The VS splash.** Locking in a PvP line-up cuts to a Smash-style pre-battle
splash: one angled panel per fighter in their player colour, portrait (drawn
mark until the authored `portrait_*` lands), name and kit, split by slanted
seams with the VS emblem on the centre seam. It plays ~3 s (any press skips)
while the match's files warm behind it, then hands off to the drop screen —
showmanship at zero cost to the load.

**Implementation shape: an adapter, not new characters.** A playable NPC is
*not* a re-implemented main character. `buildPlayableNpc(kind)` wraps the
existing enemy `CharacterInstance` (the same build the wave game spawns, same
rig, same authored-model swap, same muzzle) in the `PlayerCharacter` surface
the `Player` controller expects — the Mandalorian-only affordances (weapon
swap visuals, jetpack flames, block shield pane) become no-ops or minimal
stand-ins, and a per-kind stat profile supplies HP/speed/fire data. One
adapter, ~two dozen kinds, zero forked character code.

## 4. Campaign — the liberation run (shown to players as **Missions**)

**Flow.** Title → **Missions** → planet strip → character select → the run.
The planet strip shows one planet per territory, left to right in campaign
order, continuing offscreen (scroll with stick/arrows, click to pick). All nine
are unlocked for now; the lock-past-your-frontier rule is designed (see
expansion) but deliberately not enforced yet.

**The run.** One territory = one level ≈ one Gauntlet chapter (8–12 min),
played in a **purpose-built mission level** (`world/mission.ts`): an authored
chain of walled fight rooms joined by real, walkable corridor pinches, raised
high over the territory so it keeps the board's sky, fog, ambience, gravity
and wave tables while getting clean, intentional geometry. (The first design
laid a waypoint tour over the open wave arena; it played as the open arena
with a to-do list, and was redesigned into the room chain — 2026-08-30.)
Three room templates alternate along the chain (docs/LEVEL_DESIGN.md §2):
**camp** rooms hold a posted garrison under the normal awareness rules —
fight it or slip through to the far gate; **assault** rooms seal both gates
behind an energy pane and run 2–3 waves until the room is held (Gauntlet's
arena floor) — the waves come in by transport, the same carrier pass the
wave game flies, since a mission room is walled but roofless; and the two **boss arenas** — the champion's
mid-chain, the warlord's at the end, oversized on monster boards for what
comes up after. A **guide beacon** (light pillar + radar pip + on-screen
hint) always marks the one next objective. Difficulty ramps by *place*: room
*i* draws its squads from the board's wave table at a wave proportional to
how deep in the chain it sits.

**Corridors.** Between rooms the path pinches into crate-lined corridor legs
with at most one bend — continuous geometry, walked through rather than
teleported into (the old door-teleport segments are gone). Corridors are the
cover-discipline beat: defenders posted behind crates butted flush against
the walls, advance leg by leg. Door frames at both mouths carry the energy
gates the assault rooms seal.

**Per-player cameras.** Every player watches through their own third-person
rig, and Missions splits the screen exactly like the wave game and PvP. (v1
shipped a single shared camera on the party centroid, steered by player 1;
it framed poorly the moment the party split around cover and it cost every
player their own aim — cut 2026-08-30, and the HUD's shared-screen layout
went with it.)

**Checkpoints & death.** The last safe ground — a cleared room's far end, or
the entry of the room being fought — is the checkpoint; death respawns you
there after 4 s (arcade — Gauntlet's food-and-keys economy is in the
expansion list, not v1). Going over a wall or off the level teleports you
back to it. The level ends in the **warlord's arena** (§4a), and the run is
won when the warlord — and on a monster board, the monster under it — falls.

## 4a. Boss battles (shared by Wave Battle and Campaign)

One boss system serves both modes, built on the enemy that already exists
rather than on new content: each territory names a **boss kind** (its
signature final-wave elite — the Wookiee enforcer on the Dune Sea, the Pyke
capo on the Spice Run, the broodmother in the Crevasse, the darksaber officer
in the Refinery, the duelist pair's senior on the Ringworld, and so on) and
the boss is that enemy **promoted**: ×5 HP, ×1.5 damage, and a
**boss health bar** on every player's HUD that deepens gold → orange → red
with the phase. **A warlord reads as a warlord (2026-08-30):** human-sized
kinds grow ×1.6 and the already-big ×1.35 — the Pit Warlord stands 3.5 m
over a 1.8 m raider — the body **flashes red** on every landed hit (pale
blue-white on a turned one), and warlords **parry**: a 55% roll behind a
1.2-second cooldown turns a hit into a sharp sidestep off the line of the
shot for 15% damage. The cooldown is the fairness — sustained fire always
gets through, and even single volleys usually land most of their hits
(measured: 40 spaced shots, 11 turned). The monster bosses take none of
this — their promotion passes scale 1 and their answer is mass.

**The introduction (2026-08-29).** The battle opens on a card, so there is
never any doubt it has begun: letterbox bars, the warlord's name in the
menus' gold over a red *— Warlord —* kicker and a "Warlord of ⟨territory⟩"
epithet, a war horn (`boss_horn`, synth swell under it), and three and a half
seconds of slow motion (0.12×) while every camera pans onto the boss.
Inputs are blanked and everyone on the field keeps their head down through
the card, so the reveal is never a cheap shot in either direction.

**The theme (2026-08-31).** The warlord's battle takes the music over:
`mando-boss.mp3` replaces the board's rotation the moment the card comes up
and holds until the fight is over — through the monster stage too, where a
board has one — then the board's own score comes back. The champion's battle
keeps the board music, which is what leaves the change at the last fight
meaning something. Nothing else on any board plays that track.

Phases keep it a fight rather than a sponge: at ⅔ and ⅓ health the boss
**calls a retinue** — a squad of the board's grunts spawned around the arena
— behind a **damage-free repulsor pulse** that throws everyone off the
warlord, so each phase opens at range on both sides' terms; at the last
third it **enrages** (+28% speed, −40% attack cooldown, +15% damage, via a
per-instance def copy). Camping inside arm's reach draws a **telegraphed
shock-slam**: an ember-ring windup with a real get-out window, then 26
damage and a fling — it only arms when someone is close, so ranged play
never eats it. The fight punishes standing still, never approaching. The
range side has its own answer: every promoted boss (bar the half-buried
colossi and the fliers) carries a **super jump** — a committed ballistic
leap onto where the target is headed, opened with the creature's coil (or
the air pose on a humanoid) and closed with a ground slam that hits for
0.6× the boss's swing, shoves everyone underneath and shakes every nearby
camera. Committed like the massiff's pounce, so a dash or a jetpack hop as
the shadow arrives beats the landing; melee bosses leap from mid-range,
ranged bosses only to cross a real gap, and the enrage roughly halves the
leap's clock. It never fires while the shock-slam's ember ring is up — the
telegraph's promise about where the hit lands is kept. All of
it rides existing machinery: `addReinforcement` for the retinue,
per-instance scaling on `Enemy`, and the standard death/ragdoll/credit path
when it goes down.

- **Wave Battle:** clearing wave 4 announces the champion's battle, clearing
  wave 7 the warlord's; each boss posts with a small honour guard. Victory on
  the warlord's death.
- **Campaign:** the champion's arena sits mid-chain and the warlord's ends
  the level; each seals its gates on entry, and the guide beacon leads
  straight to each. Victory on the warlord's death.

A second tier now has a design: **six large monster bosses** — one per board with a
monster in its bones (mudhorn, ravinak, mamacore, rancor, greater krayt, mythosaur)
— fighting as a final stage *after* the promoted elite on those boards, each with a
bespoke moveset, phases, weak points and arena hazards. The full design and spec is
`docs/BOSSES.md`; their reference-sheet and model requests are open in the asset
docs as of 2026-08-29. Not implemented — the sheets are the blocking input.

## 5. What was deliberately cut (and why)

- **True level streaming** for mission levels — the whole room chain is built
  at match start; it is cheap (boxes and a handful of props), and the gates
  remain the natural seams if streaming is ever wanted.
- **Campaign progression locks/saves** — the strip is all-unlocked; the save
  format is one localStorage key away when wanted.
- **Team PvP (2v2)** — free-for-all shipped first; teams are a lobby UI
  question, not an engine one (teams are already arbitrary integers).
- **Playable drone / boss NPCs with phase logic** — gimmick lanes, below.

## 6. Expansion ideas (design notes for later rounds)

1. **Campaign locks + saves.** `mando.campaign` localStorage key: highest
   liberated territory index. Planet strip renders locked planets dark with a
   chain icon; passed ones get a banner. One evening of work; the strip already
   reads its state from a function.
2. **Room streaming.** Build each mission room lazily as its entry gate first
   opens and dispose cleared ones behind the party (they are one-way in
   spirit already). The gates are the seams.
3. **Gauntlet economy.** Food (HP pickups) hidden off the golden path to reward
   wandering; keys gating optional side doors (loot: rocket charges, shield
   batteries). Pickups are one pooled mesh + a radius check.
4. **PvP team mode & scoring options.** 2v2 by mapping two players per team
   int; score modes (first-to-10 kills, king-of-the-vehicle) are alternate
   victory predicates in the same branch.
5. **PvP bots.** A bot is a `Player` driven by a synthetic `FrameInput` — the
   enemy AI's steering code is 90% of the brain. Lets 1 human play PvP.
6. **Possession gimmick.** The cut playable drone returns as a pickup: die and
   ride a drone for one kamikaze run before respawning (Sacrifice-style).
7. **Campaign co-op scaling.** Squad counts along the path already scale by
   player count; corridor width and cover density could too (wider rooms for
   four capes).
8. **Deeper boss arenas.** The shipped bosses (§4a) are promoted elites with
   phase reinforcements; the next rung is per-boss movesets, arena hazards
   tied to phases, and unique models — PLAN.md's original stretch goal.
   **Designed 2026-08-29** as the six monster bosses in `docs/BOSSES.md`
   (asset requests open); implementation is the remaining rung.
9. **Netplay.** All modes are deterministic-ish single-machine sims; PvP
   online would need rollback or lockstep — out of scope, noted so nobody
   mistakes the team ints for a network design.
10. **Campaign mounts.** The parked-vehicle system works in campaign; a
    speeder stretch between two distant waypoints (convoy chase) is cheap to
    author with the existing movers/vehicles.

## 7. Asset requests raised by these modes

New rounds appended to the asset docs: planet discs for the strip
(`ASSETS_IMAGES.md` round — nine `planet_*.png`), corridor interior surfaces
(wall/floor/ceiling + hazard-stripe trim), a door (`ASSETS_MODELS.md` —
`blast_door.glb`, plus corridor crate/pipe dressing), and audio
(`ASSETS_AUDIO.md` — door open/close, checkpoint chime, PvP round stings).
Everything ships procedural-first per the project rule and upgrades when files
land.

**Lazy loading is mode-aware.** The drop waits on what the chosen mode's first
minute actually posts: the wave game's opening wave; the campaign's trailhead
kinds (its warlord warms in the background with the whole level to arrive);
PvP's squads for the chosen fighters and nothing else. Entering the PvP select
also pulls the widened roster's models down on idle bandwidth while players
flip through it.
