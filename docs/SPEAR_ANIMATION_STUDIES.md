# Spear attack studies in the model workbench

The three **Melee 1 → Alternates** options are workbench-only candidates. **None** plays the existing game swing. They appear for roster characters whose equipped melee weapon is the gaderffii spear/staff, and run on both the authored and procedural rig. No combat timing or hit detection has changed.

| Option | Movement idea | Key timing in the clip |
| --- | --- | --- |
| Test Animation 1 | Fixed-foot point extension, then torso drive | Hands extend around 0.30 s; body follows around 0.39 s; recover behind a high point. |
| Test Animation 2 | Extended point followed by a front-foot lunge | Point starts moving before the forward weight transfer at 0.47 s; deep front-leg bend marks the finish. |
| Test Animation 3 | Outward circular deflection and immediate straight thrust | The arms describe the deflection by 0.31 s, re-center, then thrust around 0.55 s. |

These are interpretations for a short, right-hand-mounted gaderffii. The point is the weapon's local +Y end (the narrow spearhead); the hooked blade is the butt end. The mount turns the point along the extending arm during thrusts. For now, these are one-handed attacks: the free arm reaches subtly during windup and folds into a bent guard at contact. The workbench's **Free arm counterweight** slider varies that authored arm motion from 0% to 125%. The same keyed approach applies to the original gaderffii swings and the Tusken's staff. Assess silhouette, weapon path, and foot contact before considering any candidate for game combat.

## Research basis

- [Academie Duello, *Attacks of the Spear*](https://www.academieduello.com/blog/attacks-of-the-spear/) describes fixed-foot, lunge, and long strikes, with the spear extending before the body and the feet following last. This drives the first two timing patterns.
- [International Wushu Federation, *2023 Taolu Group A Judges Training* (p. 21)](https://iwuf.org/wp-content/uploads/2023/04/TAOLU-GROUP-A-EN-CN.pdf) identifies outward block (lán), inward block (ná), and thrust (zhā), and calls for a clear arc during the blocks and alignment of arm and shaft on a level thrust. This informs the third candidate.
- [Hua Ying Wushu & Tai Chi Academy, *Spear (qiāng)*](https://davidbao.com/2020/06/18/spear-%E6%9E%AA-qiang/) describes core and upper-body rotation, stable footwork, and the intercept/control/thrust sequence.
