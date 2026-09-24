# Authored character weapon grip audit — 2026-09-24

## Method

I reviewed 41 workbench captures covering 28 authored characters and their available weapon stances. Every capture used **Model** view: the visible authored skin and weapon were the only placement reference. The procedural figure was hidden. The images are single sampled frames, so they establish the pictured mismatch but do not prove that every frame of a clip is affected.

## Confirmed mismatches

| Character and workbench pose | Observation | Evidence |
|---|---|---|
| Jedi — Saber stance, run; Sabers 1 | The hilts drift outside the authored fingers, especially with the hands lowered. | [Saber motion](weapon-grips/saber-motion.png) |
| Ventress — Saber stance, run; Sabers 1 | Her idle grip is improved, but the off-hand hilt pulls inward in the run and the forward hilt misses its hand during Sabers 1. | [Saber motion](weapon-grips/saber-motion.png) |
| Stormtrooper, Pyke Soldier, Pirate (blaster), Cobb Vanth — Enemy aim / Aim standing | The firing hand is open above or behind the gun body; the other hand does not support it. | [Rifle grips A](weapon-grips/rifle-grips-a.png) |
| Death Trooper, Dark Trooper, Fennec Shand, Pyke Capo — Enemy aim / Aim standing | Same family of hand-to-receiver gap. | [Rifle grips B](weapon-grips/rifle-grips-b.png) |
| Cad Bane — Aim standing; Guild Gunslinger — Enemy aim | The fingers meet the pistol receivers while the actual grips hang below the palms. | [Pistols](weapon-grips/pistols-launcher.png) |
| Quarren Netcaster — Enemy aim | The launcher tube stands beside an open hand rather than inside a grip. | [Launcher](weapon-grips/pistols-launcher.png) |

The shared enemy `rifle()` prop is a box and barrel without a grip mesh, which explains why adjusting its attachment alone cannot produce a convincing held weapon. The pistol prop has a modeled grip, but its authored hand alignment needs a separate correction. Saber drift during motion indicates that matching only an idle-frame offset is insufficient for those authored hands.

There is also a positioning-source issue in the implementation: `loadAuthored()` still builds each hand mount to reproduce the canonical `weaponR`/`weaponL` frame and its fixed offset. That frame came from the procedural rig. The visual audit did not treat it as ground truth; future grip corrections should replace it with authored palm and weapon-grip anchors, then drive a support hand toward the weapon where a two-handed pose calls for one.

## Sampled without a comparable visible gap

Din (Aim standing, Saber stance idle, Sabers 1), Paz (Aim standing), Bo-Katan (Aim standing), Armorer (Aim standing), Embo (Aim standing), Bossk (Aim standing), IG-11 (Aim standing), and Ventress and Jedi in Saber stance idle. Several melee first-frame samples had the weapon partly obscured or outside the hand crop, so they are not a clearance of the whole attack clip.

## Ventress stowed hilts

The revised Rest pose placement moves both hilts 2 cm inward, 4.5 cm higher, and 5.5 cm back relative to the previous mount. They remain visible from the front and side: [Rest pose views](weapon-grips/ventress-rest-hips.png). No manual anchor editor was needed for this placement.
