# Front-end UI concepts — title, character select, loading (2026-09-28)

Design exploration only; nothing here is in the game yet. There are four directions
for making the screens around a match more sci-fi-western, gritty and game-like. Each
covers the title screen, the character select and the loading ("drop") screen.

**Mockups:** the design canvas at <https://claude.ai/artifact/REWi6vHmwtTjLhNVszFb4n>
has 12 artboards at 1280×720, one row per concept. The title and character select
boards are clickable: pick a mode, move P1, click again to lock in. They use the
game's real logo, key art, board art and portraits.

**Art:** the images each concept needs are requested in
[`ASSETS_IMAGES.md`](ASSETS_IMAGES.md#open--front-end-ui-concepts-2026-09-28).

## What every concept changes

- **A portrait grid replaces the 3D pedestals.** All 13 fighters are on screen at once
  (plus a Random slot) instead of being flipped through one plinth at a time. Every
  playable fighter except Boba Fett already has a 512×614 portrait. A grid also
  removes the pressure to download a model on every flip, which is what the poster
  and prefetch work in `charselect.ts` exists to hide.
- **Player cursors instead of player-owned pedestals.** Each player moves their own
  coloured marker (P1 red, P2 blue) over the shared grid, fighting-game style. The
  same fighter can be picked by two players, as it can today.
- **A player strip along the bottom.** It has one card per seat, showing the pick,
  its loadout (gun, blade, flight) and a state: choosing, locked, or "press A to join".
  This takes over from the name plates under the pedestals.
- **A lock-in moment with some weight.** A stamp, a switch, a chip or a card played.
  Confirming a pick should feel like something happened.
- **Loading screens that sell the drop.** They show the territory, who's going in,
  who's waiting for them, a real tip, and the existing "A · drop in now" skip. The
  loading screen already knows all of this (`LoadingScreen.show(board, chars, enemies)`).
  Only the dressing changes.

Copy in the mockups is taken from `src/text.ts` (mode blurbs, board descriptions,
character descriptions, weapon names) wherever the game already has words for it.

## A · Wanted — the Guild bounty board

Aged paper, rust-red stamps and brass pins on a scorched board. The fonts are a slab
serif for headings, a typewriter face for dossier text and a condensed sans for
prompts.

- **Title:** the three modes are pinned paper tickets. The focused ticket straightens,
  slides out and gets an ACCEPT stamp. A "Guild notice" card sits in the corner.
- **Select:** a 7×2 grid of WANTED posters in sepia. Pressing A on your poster stamps
  it CLAIMED. There are four seat cards at the bottom.
- **Loading:** "Contract accepted". The territory is a pinned photograph and the
  contract sheet lists the hunters and known hostiles (mugshots, with a "?" for the
  warlord). A tracking fob with red LED segments is the progress bar.

This is the most on-theme of the four and the cheapest to build. It's all DOM and CSS,
and the grid needs no 3D at all.

## B · Twin Suns — the widescreen showdown

Letterboxed and cinematic, in burnt orange, blood red and bone. Condensed display type
is paired with an italic serif for epithets ("the Mandalorian", "cold blood, long
rifle").

- **Title:** full-bleed key art with a slow push-in. The modes run along the bottom
  letterbox like film credits, and the focused one gets a sun-dot and a red underline.
- **Select:** "The Lineup". The roster is a row of tall, skewed strips, one per
  fighter, desaturated until focused. The focused strip opens up to show the portrait
  in colour with the name, epithet and loadout.
- **Loading:** a title card with the territory name large in the middle, hunters on
  the left and "the wanted" on the right. The progress bar is a sun travelling an arc
  over the horizon. The tip sits in the top letterbox.

This one has the most drama. The accordion is the weakest pattern for four players on
one screen, so a couch build would pair it with A's seat strip. The PvP VS splash
(`vs.ts`) already speaks this language.

## C · Navicomputer — the salvaged gunship console

Amber phosphor CRT inside a riveted gunmetal bezel, with hazard stripes and a teal
hologram. The fonts are a squared sci-fi face and a pixel terminal face.

- **Title:** the key art is seen through a CRT viewport with scanlines and a slow
  roll bar. The modes are physical toggle switches with lamps on a console below.
- **Select:** "Hunter registry". A 4-wide grid of amber ID chips sits on the left.
  The pick is shown in the middle as a flickering teal hologram over a projector. A
  spec sheet on the right shows HP, gun, blade, flight and the character's line. Four
  "bays" along the bottom show the players.
- **Loading:** "Jump solution". Hyperspace streaks fill the viewport with the
  destination planet ahead. A route line shows jump points, and a segmented "jump
  calc" bar tracks progress. The crew and hostile signatures appear as chips, next to
  a field-manual tip.

This is the most sci-fi of the four. The hologram is also a natural home for the 3D
model if we want to keep one: render the selected fighter's model with a holo shader
in the centre pane instead of the portrait.

## D · Sabacc — cards on a cantina table

Green felt, gold-edged trading cards and pink and cyan neon. The fonts are a chunky
arcade display face and a semi-condensed sans. This is the most "fun" of the four.

- **Title:** the modes are a hand of three cards fanned at the bottom, with the
  focused card raised and glowing. Neon signs sit around the logo.
- **Select:** "Deal me in". A 7×2 grid of trading cards, with the frame colour set by
  class (gold for Mandalorian, copper for bounty hunter, crimson for Force user, teal
  for the wild card). Each player's cursor is a poker chip; P2's wobbles while
  undecided. The seats at the bottom show a card played face-up, or a card back with
  "A sit down".
- **Loading:** "The Deal". The territory card is dealt in the centre, your hand on the
  left and the House on the right, with the warlord face-down. Progress is chip
  stacks filling up.

This is the easiest to read at couch distance and the most playful. It's lighter than
A–C on "gritty", but the felt, wear and neon keep it grounded.

## Recommendation

**A as the base, with B's loading screen.** A's grid, stamps and seat strip are the
clearest four-player pattern and the most sci-fi-western. B's sun-over-the-horizon
drop screen is the strongest loading moment. C's hologram centre pane is the best
way to keep a 3D model on the select screen if losing the models feels like too
much. D is the one to pick if the game should lean arcade rather than gritty.

## Implementation notes (for whichever is picked)

- `src/ui/charselect.ts` becomes a DOM grid. The per-slot state machine (empty,
  browsing, spinning, ready; bots owned by a human slot; pad claiming) carries over
  as-is. Only the stage (pedestals, camera, `layoutStage`, posters) goes away.
  Prefetch can then warm only the *committed* picks rather than every flip.
- `MenuScreen.step()` already moves focus spatially over laid-out rectangles, so a
  grid of focusables navigates correctly with the d-pad today. Multi-cursor needs one
  focus index per player slot.
- `src/ui/loading.ts` keeps its API (`show`, `showTransit`, `progress`). The skip
  prompt and the "files to go" note map straight onto every concept's progress widget.
- Fonts come from Google Fonts in the mockups. The game should self-host them in
  `public/assets/fonts/` so it keeps working offline.

## Round 2 — Twin Suns title, Wanted loading (2026-09-28)

Feedback on round 1: keep **B's title screen** and **A's loading screen**. Show how a
select screen works with four players choosing at once, show more select layouts, and
explore the stage select for both Wave Battle and Missions. Everything is on the
canvas's **Round 2** page. The kept loading screen there now lists four hunters.

Every four-player layout uses the same seat colours: P1 red, P2 blue, P3 green,
P4 yellow. The mock state is always the same: P1 locked on Din, P2 browsing Bossk,
P3 locked on Maul, and P4 either browsing or sharing a pick, to show what a doubled
pick looks like.

### Character select — five layouts

1. **The Lineup, 4 players** (B, reworked). The strips stay as the shared roster.
   Any strip with a cursor on it widens and turns to full colour, and it carries a
   coloured tag for each player on it. Below the strips are four slanted "posse"
   cards, one per seat, showing each pick in full. The accordion's single
   expanded strip couldn't show four picks at once; the cards can.
2. **Split posse.** Four full-height slanted columns, one per player, each with its
   own ◀ ▶ ribbon of faces. There's no shared cursor, so players never fight over
   the grid. This is the closest to today's pedestals, with portraits in place of
   models.
3. **Corner dossiers.** A roster grouped by class (Mandalorians, bounty hunters,
   Force users) in the centre, with a Wanted-style dossier in each corner. Each
   player's pin sits in the tile corner that matches their dossier corner, so four
   pins on one tile still read.
4. **Load the cylinder.** A 2×2 split, one quadrant per player. Each player spins a
   six-chamber revolver cylinder of portraits; the chamber under the hammer is the
   pick, and A "cocks the hammer" to lock in. LB/RB jump a whole class.
5. **Movie poster.** The four picks stand side by side as a film poster over a
   setting sun, with a billing block of their names. The roster below is round
   medallions, with one coloured ring per player, nested when players share a pick.

### Stage select — four styles, each drawn for Wave Battle and for Missions

Wave Battle picks any territory; Missions is the same nine as a campaign in order.
The Missions boards show three territories liberated and the fourth next. That
needs campaign progress to be saved, which the game doesn't do yet: `planets.ts`
unlocks everything. Every territory's lieutenant, warlord, monster, stages and
room count come from `src/text.ts`.

1. **Bounty board.** Each territory is a WANTED poster for its warlord, with a
   dossier sheet for the focused one. In Missions the posters are numbered and
   joined by a red string in campaign order; finished ones are stamped COLLECTED,
   and the dossier lists the route's stages.
2. **Horizon reel.** The focused territory fills the screen in Twin Suns style,
   with a billing of its bosses ("first… then… and then…"). The other territories
   run along a film strip in the bottom letterbox. In Missions the strip becomes a
   chapter trail (I–IX): liberated chapters are filled, the next one is a glowing
   sun, and a side card lists the stages.
3. **Sector chart.** An ink-and-parchment star chart using the planet art, with a
   hand-drawn red circle on the focused planet and a pinned card. In Missions an
   inked route joins the planets in order. Liberated planets are crossed out, and
   "You ride here" flags the next one.
4. **Departures board.** A split-flap board listing destination, the warlord who
   holds it, and status, with a paper ticket stub for the pick. In Missions it
   becomes an itinerary: arrived legs, the leg now boarding, scheduled legs, and a
   ticket that lists the leg's stops.
