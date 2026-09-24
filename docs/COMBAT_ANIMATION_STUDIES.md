# Workbench combat animation studies

These are candidates for visual review. The **In game** picker group contains clips that gameplay requests. A `•` means that attack has workbench alternates; **None** runs the original clip. The **Not in game · preview** group and `◆` badge identify motions gameplay does not currently call. The three unarmed clips are in this group. Their hands are empty in the workbench. The player currently reuses saber motions when all sabers are thrown, so these dedicated unarmed clips are not yet part of the combat controller. Attack alternates play at twice their original study speed; unarmed previews retain their original pacing.

## Options

| Original attack | Workbench alternatives | Choreography aim |
| --- | --- | --- |
| Melee 1 | Fixed-foot thrust; long lunge thrust; deflect → thrust | Put the spear point first, then move the body and lead foot. |
| Melee 2 | Butt-end return; low rising sweep | Give the staff's second end a job and vary the attack level. |
| Melee 3 | Descending blow; diagonal step and strike | Carry a heavy finish with the hips and lead leg. |
| Sabers 1 | Right-point lunge; right draw-cut | Let one blade strike while the other covers. |
| Sabers 2 | Left parry and return; left oblique cut | Change the lead hand and attack line. |
| Sabers 3 | Cross then open; twin point finish | Show both blades acting together at a clear finishing beat. |
| Enemy swing | Compact counterstrike; committed driving strike | Use club, rifle stock, or a bare/mechanical fist according to the character's existing equipment. |
| Not in game: unarmed | Lead straight; rear straight; front kick | A three-beat empty-hand set with a guard, hip drive, and recovery. |

The workbench chooses equipment families from the existing roster. Din can review staff and twin-saber entries, Ventress and the Jedi can review twin-saber entries, and other playable staff users can review staff entries. Humanoid enemies see their `enemySwing` alternatives. Characters using separate creature rigs keep their existing creature attack preview. The same canonical bone tracks drive procedural and authored humanoids.

Pacing and committed pose vary by style: Paz and the Armorer are heavier and slower; Bo-Katan, Ventress, and Embo are quicker; Din, the Jedi, and Cad Bane use measured timing; Bossk and the Tusken use a reaching hunter stance; droids use reduced trunk rotation and straight piston actions. These are game choreography interpretations, not motion captured performances of the named characters.

## Source decisions

- [Academie Duello, *Attacks of the Spear*](https://www.academieduello.com/blog/attacks-of-the-spear/) informs the fixed-foot and lunge thrusts, especially its point/body/foot order.
- [Academie Duello, *Polearms*](https://www.academieduello.com/learn/arts/polearms/) describes quarterstaff use of both ends and two-handed leverage. [IWUF's taolu overview](https://www.iwuf.org/en/sport-wushu/competitive-wushu/taolu/) describes staff attacks, whole-body power, and dual-weapon coordination. These inform the return strike, sweep, and dual-saber studies; the current staff previews use one hand until a complete two-arm version is choreographed. The blades are not claimed to be a formal wushu style.
- [England Boxing's coaching handbook, straight punches](https://www.englandboxing.org/wp-content/uploads/2022/03/EB_Boxing-Coaching-Handbook-Part-1_v8-002.pdf) informs the lead/rear straight guard, hip rotation, extension, and recovery of the unarmed previews.
- Two suitable public-domain motion sources were found: [Quaternius's CC0 Animated Human](https://opengameart.org/content/animated-human-low-poly) includes a punch, and the [CC0 Universal Animation Library](https://opengameart.org/content/universal-animation-library) includes humanoid combat motions intended for retargeting. The [CC0 Animated Men Pack](https://poly.pizza/bundle/Animated-Men-Pack-DAC9SDgMQT) also supplies a punch in GLB/FBX form. We kept these as retargeting candidates rather than presenting their source-rig motion as if it already fit the game's canonical skeleton. The workbench's unarmed previews are newly keyed for that skeleton and are not imports from these packs.
- The [Star Wars Databank entries for Din](https://www.starwars.com/databank/the-mandalorian), [Bo-Katan](https://www.starwars.com/databank/bo-katan-kryze), [Ventress](https://www.starwars.com/databank/asajj-ventress), [Embo](https://www.starwars.com/databank/embo), [Bossk](https://www.starwars.com/databank/bossk), [Cad Bane](https://www.starwars.com/databank/cad-bane), and [IG-11](https://www.starwars.com/databank/ig-11) inform character weight, weapon, and temperament choices.
- The [CMU Motion Capture Database](https://mocap.cs.cmu.edu/) has boxing, punching, and kicking trials and grants free use with restrictions on direct resale of the data. We used it to check that such reference motion exists. These candidates were authored on this game's canonical rig; no CMU motion file was imported or redistributed. The data is **not labeled public domain** here.

## Review limits

The right hand drives the gaderffii and Maul's connected double blade. Their free arms have keyed counterweight poses instead of a runtime grip solver. The old solver reached across the chest and made the forearm pass through the torso; that was the cause of the reported regression. The workbench slider previews authored variants from 0% to 125% reach while the game uses the subtle 50% version. Din's three-hit spear combo keeps its original strikes and has a 25% chance per hit to use Long lunge thrust, Low rising sweep, or Diagonal step and strike at the corresponding combo step. The alternate's keyed contact beat sets that hit's timing. Other characters still use these as workbench studies. Study the weapon path, hand contact, foot placement, and return to guard before promoting other candidates.

Din carries one right-hand Darksaber with the Jedi hilt asset and a black blade edged in white, following the [Star Wars Databank description](https://www.starwars.com/databank/darksaber). His second and third saber hits now use right-hand backswing and overhead clips instead of left-blade choreography.
