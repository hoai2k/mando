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

## Round 3 — the chosen flow, and the Missions route restyled (2026-09-28)

**Decided so far:**

| Screen | Choice |
|---|---|
| Title | Twin Suns (round 1, B) |
| Wave Battle territory | Departures board (round 2, stage 4) |
| Character select | The Lineup, four players (round 2, select 1) |
| Loading | Wanted (round 1, A), showing all four hunters |

On the canvas's **Round 3** page, the top row shows those four screens in order.

**Missions: the current route map, restyled.** All four keep what `src/ui/planets.ts`
already does. The route is `plotRoute(9)`: the same zig-zag, at the same node
positions. The lanes are shallow arcs, ◀ ▶ or a click moves to a planet, the map
pans so the chosen planet sits in the middle, and the lanes behind it light up. What
changes is the art direction, plus three additions:

- **Liberated vs. next.** Three states: finished lanes and planets, the next
  territory, and a marching "plotted course" from your progress to whatever you're
  looking at. This needs campaign progress to be saved (see round 2).
- **An information panel.** A fixed panel shows what the old hanging caption
  couldn't fit: the stages, the room count, the lieutenant and the warlord.
- **On-screen ◀ ▶ buttons** for mouse players.

1. **Twin Suns trail.** Letterboxed like the title, over warm dust and two star
   layers that move at different speeds as the map pans. The focused planet has a
   rotating sun-flare ring. Liberated planets get an orange check, the header shows
   nine small suns for progress, and the bottom letterbox is the chapter card.
2. **Bounty string.** The route is a red string between brass pins on the Wanted
   board. Each planet hangs a paper tag naming its warlord, and finished tags are
   stamped COLLECTED. A dossier strip with the territory photo sits along the
   bottom. This one leads straight into the Wanted loading screen.
3. **Holo table.** The same route laid on a tilted holo-table grid, so the zig-zag
   reads as near and far. The planets stand upright over their projection pads on
   light beams. The side readouts are amber terminal text.
4. **Transit line.** The route is drawn as a rail line with station roundels and
   name plates. A split-flap "Next stop" header and a split-flap leg board sit
   beside a ticket stub. This matches the Departures board chosen for Wave Battle,
   so both modes read as one transit system.

Implementation note for the holo table: CSS `perspective` tilts the grid and lanes,
but the planets are laid out flat. Their screen positions come from projecting each
route point through the same perspective, so nothing depends on nested
`preserve-3d`.

## Round 4 — delivered art, and travelling between systems (2026-09-28)

**Delivered art, now in the mockups.** The canvas's **Round 4** page opens with the
chosen flow using the images that arrived on `main`:

- `title_twin_suns.jpg` behind the title. The logo and tagline moved into the sky's
  empty upper right, clear of both hunters.
- `ui_bounty_board.jpg` behind the Wanted loading screen, with `ui_paper_aged.jpg`
  as the stock for the photograph and the contract sheet. The field note sits on a
  dark backing so it reads over the board's paper scraps.
- `ui_paper_aged.jpg` as the Departures ticket stub.
- The rendered `portrait_din`, `portrait_maul` and `portrait_boba_fett` in the Lineup
  and on the loading screen. Boba Fett's strip no longer shows a placeholder.

The Round 3 page's flow boards have the same updates.

**Missions A is kept and renamed "The Bounty Hunt".** It sits in the flow as 2b.

**Missions — travelling between solar systems.** Each territory gets its own solar
system: its world seen from its own angle, its own sun or twin suns at the edge or
behind the limb, and a moon, gas giant or ring for depth. The nine
`system_<id>.jpg` vistas are delivered under `public/assets/textures/`,
with the same colours and surfaces as the `planet_<id>.png` discs. The mockups
currently build these scenes from the discs; the vistas are available for the
next round. They keep A's letterboxed Twin Suns card along the bottom.

1. **Warp from the stars.** The other eight systems are distant stars strung along
   the game's own zig-zag route across the top of the sky. Picking one zooms its
   whole system out of that star to fill the screen, while the old system shrinks
   back into its own star.
2. **The next system over.** The route runs left to right through space. The system
   you're in fills the view; the previous one is a star at the left edge and the
   next one a star at the right edge, each with its name. Moving on zooms the next
   system out of the right-hand star, and the old one falls back into the left edge,
   so travel always has a direction.
3. **Galaxy map with a lens.** This keeps the current pan-to-centre route map, drawn
   as stars along a galaxy arm, each star tinted with its own sun's colour. The
   chosen star opens a bronze-framed lens above it that zooms into that system's
   scene.
4. **One system, nine worlds.** Everything is in one system around a pair of suns,
   one world per orbit, and the route spirals outward along transfer arcs. The
   camera flies to and closes in on the chosen world. Each world's night side faces
   away from the suns wherever it sits on its orbit.

## Round 4, update — the system paintings in, and Systems 4 animated (2026-09-28)

- **The system paintings are in.** Warp, The next system over and the galaxy lens
  now show the delivered `system_<id>.jpg` vistas. The CSS-built scenes stay in the
  mockup code as a fallback.
- **Systems 4 (one system, nine worlds) is reworked:**
  - The twin suns stay still.
  - The worlds are laid out so every world sits lower on screen than the one before
    it. The route sweeps down the near side of the tilted orbital plane, so **down is
    always on and up is always back** through the list.
  - A bare **left or right** goes to whichever neighbour (back or on) lies further
    that way. If neither does, nothing happens. The chosen world shows "▲ previous" and
    "▼ next" hints, and there's an on-screen d-pad for the mouse.
  - **The move between worlds is animated.** A small ship flies the transfer arcs,
    passing through any worlds in between on a longer jump, with the camera following
    it. The camera pulls back mid-flight so the jump reads against the whole system,
    then closes in on arrival. A bright trail marks the path flown, the old world
    shrinks as the new one grows, the chapter card fades through the jump, and the
    header reads "En route". A single hop takes 1.1 s, plus 0.38 s for each extra
    world.
- **Title art.** `title_twin_suns.jpg` has no Mandalorians in it, so
  `title_twin_suns_v2.jpg` is requested in `ASSETS_IMAGES.md`: the same standoff,
  with a posse of armored, T-visor hunters.

## Round 4, second update — Systems 4 at true distances (2026-09-28)

- **Systems 1 and 2 were showing only the painting.** Each painted scene carried a
  `z-index` for the zoom, and that lifted it over the title strip, the star map and
  the chapter card. The scenes now sit in their own stacking layer beneath the UI.
- **Systems 4 now keeps the worlds tiny against the gaps between them.** Parked, the
  camera is right on the chosen world (it fills the middle of the screen), and every
  other world is millions of kilometres off screen. A chevron on the frame points
  to the previous and next world, with its name and distance ("53 million km").
  The suns are usually off screen too, so their light spills in from the edge they
  sit beyond.
- **A jump is a fly-to, not a hop.** In well under a second (0.95 s, plus 0.22 s for
  each extra world), the camera zooms out in log space, 12 to 30× depending on the
  distance. The worlds shrink to named points of light and the orbits and suns come
  into view. The camera crosses while pulled back, then punches in on the new world.
  Star streaks, a stretching engine burn on the ship and the starfield swelling sell
  the speed, the header reads the distance being covered, and the chapter card fades
  through the jump.
- The layout rules from the first update still hold: down is on, up is back, and a
  bare left or right takes the neighbour that lies further that way.

**Title, revised (2026-09-28).** The title goes back to the original stand-in art
(`title_bg.jpg`, the battered T-visor helmet). The logo now sits on the left, over a
darkened side of the image. The top strip and the "Two suns. One contract." line are
gone. The bottom right reads **1–4 PLAYERS** above "Press A to ride out", in place of
the mode blurb. The Twin Suns letterboxed menu along the bottom stays.
`title_twin_suns_v2.jpg` (with Mandalorians) is still requested, as an option to
compare against the stand-in.
