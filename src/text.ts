/**
 * Every word the game says, in one place.
 *
 * If a player can read it on screen, it is here: menus, prompts, HUD labels,
 * banners, the names and descriptions of characters, weapons, boards and
 * modes. Nothing here decides anything — the code reads these strings and the
 * strings never read the code — so this file can be rewritten end to end
 * without touching a line of logic.
 *
 * Two conventions, both worth keeping when adding to it:
 *
 *  - A line that has to fit a value is a function, not a template littered
 *    through the source: `stands(2)` rather than `${n} stands left` written
 *    wherever the HUD happens to be. The value's *shape* stays with the words
 *    that frame it, which is what makes plurals and word order editable here.
 *  - Anything with markup in it says so by carrying tags. The screens that use
 *    those set `innerHTML`; everything else is plain text and set as text.
 *
 * What is deliberately NOT here: developer console warnings (nobody playing
 * reads them), asset filenames and ids, and the model workbench, which is a
 * tool rather than part of the game.
 *
 * The order is the order a player meets it — the title, the screens on the way
 * into a match, the HUD and what the game shouts mid-fight, then the menus —
 * followed by the things a match is *made* of, which are read on several
 * screens at once: the cast, their weapons, the boards, the bosses, the
 * hostiles, the rides, and the mission rooms.
 */

export const TEXT = {
  // ---------- the game itself ----------
  game: {
    title: 'Bounty Hunters',
    tagline: 'a Mandalorian fan game',
  },

  // ---------- title screen ----------
  title: {
    waveBattle: 'Wave Battle',
    pvp: 'PvP',
    missions: 'Missions',
    /** the one-button title behind `?nomodes` */
    pressStart: 'Press Start',
    /** bottom right of the title, over the Press Start prompt */
    players: '1–4 Players',
  },

  // ---------- board / territory select ----------
  boardSelect: {
    title: 'Choose Territory',
    /** the board's heading: a transit departures board */
    departures: 'Departures',
    /** the line under it; `mode` is the mode's own name */
    sub: (mode: string) => `Outer Rim transit · ${mode}`,
    cols: { gate: 'Gt', dest: 'Destination', held: 'Held by', status: 'Status' },
    boarding: 'Boarding',
    onTime: 'On time',
    clock: 'High noon',
    ticket: {
      oneWay: 'One way',
      gate: (g: string) => `Gate ${g}`,
      admit: (who: string) => `Admit ${who}`,
      hunters: '1–4 hunters',
      fighters: '2–8 fighters',
      to: (where: string) => `To · ${where}`,
      waves: '7 waves · a lieutenant · the warlord',
      pvp: 'Last fighter standing',
      punch: 'Punch',
    },
    /** the prompt bar under the board, each beside its button glyph */
    prompts: { pick: 'Pick a departure', punch: 'Punch the ticket', back: 'Back' },
  },

  // ---------- mission (campaign) select ----------
  planets: {
    title: 'Missions',
    /** the header of the galaxy map */
    heading: 'The Bounty Hunt',
    sub: 'Nine territories to liberate, one warlord at a time',
    hint: '<b>◀ ▶</b> travel the sector · <b>A</b>/<b>Enter</b>/<b>click</b> begin the mission · <b>B</b>/<b>Esc</b> back',
    /** the corner of the lens: which system it is looking at */
    system: (n: string, where: string) => `System ${n} · ${where}`,
    chapter: (n: string, where: string) => `Chapter ${n} · ${where}`,
    rooms: (n: number) => `${n} rooms`,
    warlord: 'warlord,',
    rideOut: 'Ride out',
    liberatedCount: (n: number, of: number) => `${n} of ${of} liberated`,
  },

  // ---------- character select ----------
  charSelect: {
    /** the standard line-up's heading */
    title: 'Hunters',
    /** PvP's, where the roster widens to the whole cast */
    titlePvp: 'Fighters',
    /** the italic line beside the heading */
    sub: 'who rides out?',
    confirm: 'Confirm',
    cancel: 'Cancel',
    /** the prompt bar's invitation while a place is open; `a` is the A glyph */
    joinPrompt: (a: string) => `Press ${a} to join`,
    /** never "ready": the tests wait for that word to mean a locked-in plinth */
    lockedCount: (n: number, of: number) => `${n} of ${of} locked in`,
    locked: 'Locked in',
    choosing: 'Choosing',
    start: 'Start Game',
    player: (n: number) => `Player ${n}`,
    /** the short tag on a card and on the strip a player is standing on */
    tag: (n: number) => `P${n}`,
    cpu: 'CPU',
    /** the one word a roster strip has room for, where the first name is not it */
    short: { boba_fett: 'Fett', duelist: 'Bane', ventress: 'Ventress' } as Record<string, string>,
    noGun: 'No gun',
    /** an open place's card; `a` and `y` are the button glyphs */
    join: (a: string) => `Press ${a} to join`,
    /** the second line of the invitation, where the mode has bots */
    joinBot: (y: string) => `Press ${y} for Bot`,
    ready: 'READY',
    loading: 'Loading…',
    bot: 'BOT',
    /** a bot whose owner has locked in and is choosing for it now */
    botPicking: (owner: string) => `${owner} is picking`,
    /** a bot waiting on its owner to settle their own fighter first */
    botWaiting: (owner: string) => `${owner} picks after locking in`,
    /** the stat line under a fighter's name on their plinth */
    kit: {
      hp: (n: number) => `<b>${n} HP</b>`,
      jetpack: 'jetpack',
      superJump: 'super jump',
      squad: (n: number) => `squad of ${n}`,
      laysEggs: 'lays eggs',
    },
    needFighters: (n: number) =>
      `<b>PvP needs ${n} fighters</b> — press <b>A</b> on another controller to join the duel`,
  },

  // ---------- the drop (loading screen) ----------
  loading: {
    raising: 'Raising the territory',
    filesToGo: (n: number) => `${n} file${n === 1 ? '' : 's'} to go`,
    ready: 'Ready',
    preparing: 'Preparing the drop',
    skip: 'Drop in now',
    /** the contract's terms line, by mode */
    terms: (t: string) => `Terms · ${t}`,
    /** the hostile nobody has a picture of yet */
    unknownWarlord: 'Warlord',
    /** the Wanted sheet's furniture */
    contract: (n: string) => `Guild contract № ${n}`,
    accepted: 'Accepted',
    lastSeen: (planet: string, place: string) => `${planet} — last seen: ${place}`,
    hunters: 'Hunters',
    fighters: 'Fighters',
    hostiles: 'Known hostiles',
    fob: 'Tracking fob',
    fieldNote: 'Field note',
    /** one is picked per drop: short, true to the controls, and never a promise */
    tips: [
      'Hold jump in the air to thrust — the jetpack runs on a fuel budget. Land to let it refill.',
      'Hold RB to raise your block shield. It turns bolts from the front.',
      'Press C / Y near cover to take it — hold aim to peek.',
      'A covert supply cache drops mid-fight. Crack it open before they do.',
      'Drop a rider and the ride is yours: C / Y to climb aboard.',
    ],
  },

  // ---------- the VS splash ----------
  vs: {
    wanted: 'Wanted',
    deadOrAlive: 'Dead or alive',
    highNoon: 'High noon',
    skip: 'A to skip',
    player: (n: number) => `P${n}`,
    bot: 'BOT',
    squad: (n: number) => ` · squad ×${n}`,
  },

  // ---------- heads-up display ----------
  hud: {
    bars: { health: 'HP', fuel: 'JET', energy: 'ENERGY', heat: 'HEAT', air: 'AIR' },
    newContact: '◢ New contact',
    newContacts: '◢ New contacts',
    /** the kicker over a boss's name card */
    lieutenant: 'Lieutenant',
    warlord: 'Warlord',
    /** the boss intro's Wanted card */
    wanted: 'Wanted',
    reward: 'Reward',
    /** flavour: the bounty on each of a territory's three boss battles */
    bounty: { lieutenant: '10,000 cr', warlord: '25,000 cr', monster: '40,000 cr' } as Record<string, string>,
    inCover: 'IN COVER · hold aim to peek',
    firingFromCover: 'FIRING FROM COVER',
    takeCover: 'C / Y — take cover',
    rideVehicle: (name: string) => `C / Y — ride the ${name}`,
    driving: (name: string, hp: number, maxHp: number) =>
      `${name} ${hp}/${maxHp} · stick drives · A hop · RB shield · Y off`,
    /** a mounted gun (K3 turret): it does not drive */
    gunning: (name: string, hp: number, maxHp: number) => `${name} ${hp}/${maxHp} · RT fire · Y off`,
    /** a living mount is ridden, not driven: it charges, and your gun hand is free */
    riding: (name: string, hp: number, maxHp: number, charge: string) =>
      `${name} ${hp}/${maxHp} · A hop · RB shield · X ${charge} · RT fire · Y off`,
    chargeReady: 'charge',
    chargeWait: 'charge…',
    reforming: 'RE-FORMING',
    disintegrating: 'DISINTEGRATING',
    down: 'DOWN',
    eggs: (n: number) => `◆ EGGS ×${n}`,
    eggCharging: '◇ egg charging',
    rocket: 'ROCKET',
    lunge: 'LUNGE',
    specialReady: (what: string) => `◆ ${what} READY`,
    specialCooling: (what: string, secs: string) => `◇ ${what.toLowerCase()} ${secs}s`,
    victory: 'VICTORY',
    eliminated: 'ELIMINATED',
    standsLeft: (n: number) => `${n} stand${n === 1 ? '' : 's'} left`,
    wave: (n: number) => `Wave ${n}`,
    theWarlord: 'The warlord',
    followBeacon: 'Follow the beacon',
    killsAndRivals: (kills: number, rivals: number) =>
      `${kills} kills · ${rivals} rival${rivals === 1 ? '' : 's'} left`,
    killsAndHostiles: (kills: number, hostiles: number) =>
      `${kills} kills · ${hostiles} hostiles remaining`,
  },

  // ---------- what the game announces mid-match ----------
  //
  // The big banner across the middle of the screen: a wave turning over, a
  // warlord arriving, somebody going down. `sub` is the small line under it.
  banners: {
    objective: {
      pvp: 'Last fighter standing takes it',
      campaign: 'Follow the beacon · liberate the territory',
      /** a board that does not name its own */
      wave: 'Survive 7 waves and two warlords',
    },
    lieutenantOf: (board: string) => `Lieutenant of ${board}`,
    warlordOf: (board: string) => `Warlord of ${board}`,
    bringThemDown: 'Bring them down',
    neverEmpty: (board: string) => `The ${board} was never empty`,
    callsForBackup: 'They call for backup',
    lastStand: 'Enraged — a last stand',
    groundOpening: { title: 'Something is coming up', sub: 'the ground will not hold' },
    territoryHeld: { title: 'Territory held', sub: 'This is the Way' },
    territoryLiberated: { title: 'Territory liberated', sub: 'This is the Way' },
    lieutenantFalls: { title: 'The lieutenant falls', sub: 'The warlord is watching' },
    waveCleared: (n: number) => `Wave ${n} cleared`,
    somethingBig: 'Something big is coming',
    backOnYourFeet: { title: 'Back on your feet', sub: 'the beacon waits' },
    hunterFallen: 'The hunter has fallen',
    huntersFallen: 'The hunters have fallen',
    sweepingForYou: 'They are sweeping for you',
    wave: (n: number) => `Wave ${n}`,
    finalWave: (hostiles: number) => `Final wave · ${hostiles} hostiles`,
    huntThemDown: (hostiles: number) => `${hostiles} hostiles · hunt them down`,
    supplyCache: 'A covert supply cache is down — crack it open',
    reinforcements: 'Reinforcements!',
    reinforcementsSub: (kind: string, n: number) => `${kind} ×${n} join the fight`,
    // PvP
    downs: (killer: string, victim: string) => `${killer} downs ${victim}`,
    squadFightsOn: 'the squad fights on',
    standsLeft: (n: number) => `${n} stand${n === 1 ? '' : 's'} left`,
    isOut: (who: string) => `${who} is out`,
    takesTheTerritory: (who: string) => `${who} takes the territory`,
    thisIsTheWay: 'This is the Way',
    // Missions
    sealedIn: 'Sealed in',
    /** an open assault that is not a siege: nothing seals, nothing is sent */
    holdGround: { title: (where: string) => `Take ${where}`, sub: 'clear them off it' },
    hold: (where: string) => `hold ${where}`,
    waveOf: (n: number, of: number) => `Wave ${n} of ${of}`,
    checkpoint: 'Checkpoint',
    riders: { title: 'Riders', sub: 'drop the rider, take the ride' },
    swoopPack: { title: 'Swoop pack', sub: 'they are coming in over the rim' },
    regrouped: 'the party regroups at the door',
    airLow: { title: 'Air low', sub: 'the wreck holds air — or make for the pool' },
    pushOn: (where: string) => `push on to ${where}`,
    bacta: { title: 'Bacta canister', sub: '+45 health' },
    offPath: { title: 'Off the path', sub: 'back to the last checkpoint' },
    tookYou: { title: 'The water took you', sub: 'back to the last checkpoint' },
    ceilingHit: (line: string) => line,
    ceilingSub: 'nothing flies over the rim',
    transport: (where: string) => `Making for ${where}`,
    transportSub: 'stand by',
    steppedOut: { title: 'Standing in the transport', sub: 'everyone aboard before it goes back' },
    lieutenantFallsMission: { title: 'The lieutenant falls', sub: 'the warlord waits at the end' },
  },

  // ---------- pause ----------
  pause: {
    /** the heading: a small italic word over the big one */
    kicker: 'paused',
    heading: 'Hold fire',
    /** what the costly choices cost */
    restartNote: (mode: string) => (mode === 'wave' ? 'Wave 1, same hunters' : 'From the start, same hunters'),
    quitNote: 'The contract is lost',
    inProgress: 'Contract in progress',
    statWave: 'Wave',
    statClock: 'On the clock',
    statTakedowns: 'Takedowns',
    upNext: 'Up next:',
    nextLieutenant: (name: string, wave: number) => `<b>${name}</b> — the lieutenant comes out when wave ${wave} is cleared.`,
    nextWarlord: (name: string, wave: number) => `<b>${name}</b> — the warlord comes out when wave ${wave} is cleared.`,
    onTheField: (name: string) => `<b>${name}</b> is on the field.`,
    select: 'Select',
    title: 'Paused',
    resume: 'Resume',
    controls: 'Controls',
    settings: 'Settings',
    restart: 'Restart Board',
    quit: 'Quit to Title',
  },

  // ---------- the end of a match ----------
  end: {
    defeat: 'The Hunters Have Fallen',
    /** PvP, where somebody is left standing — the one champion the game has, and a player */
    champion: (name: string) => `${name} Takes the Territory`,
    nobody: 'Nobody',
    liberated: 'Territory Liberated',
    held: 'Territory Held',
    nextTerritory: 'Next Territory',
    /** the campaign's next stop, by name */
    rideOn: (name: string) => `Ride on to ${name}`,
    /** a held territory's way back to the departures board */
    nextDeparture: 'Next departure',
    newHunters: 'New hunters',
    newFighters: 'New fighters',
    rematch: 'Rematch',
    retry: 'Retry',
    quit: 'Quit',
    confirm: 'Confirm',
    // ---- Territory held: the contract settled, and the payout ledger ----
    settled: (n: string) => `Guild contract № ${n} · settled`,
    paid: 'Paid in full',
    cleared: (place: string, clock: string) => `${place} — cleared, ${clock}`,
    heldSummary: (waves: number, warlord: string, clock: string) =>
      `${waves} waves weathered · ${warlord} put down · ${clock} on the clock.`,
    ledger: 'Payout ledger',
    ledgerCols: { hunter: 'Hunter', takedowns: 'Takedowns', credits: 'Credits' },
    /** flavour: what one takedown is worth on the ledger */
    creditsPerKill: 150,
    topGun: 'Top gun',
    split: (n: number) => (n === 1 ? 'One hunter, one share' : `Split ${n} ways, as agreed`),
    cr: 'cr',
    // ---- Territory liberated: back on the bounty-hunt map ----
    liberatedStamp: 'Liberated',
    free: (name: string) => `${name} is free`,
    chapterDone: (n: string, world: string) => `Chapter ${n} complete · ${world}`,
    liberatedSummary: (rooms: number, warlord: string, clock: string) =>
      `${rooms} rooms cleared · ${warlord} felled · ${clock}`,
    nextStop: (n: string, name: string) => `Next · ${n} · ${name}`,
    routeCount: (n: number, of: number) => `Territory ${n} of ${of} on the route`,
    huntDone: 'The last territory — the hunt is done',
    // ---- PvP: last fighter standing ----
    lastStanding: 'last fighter standing',
    standings: 'Final standings',
    stillStanding: 'still standing',
    out: 'out',
    takedowns: (n: number) => `${n} takedown${n === 1 ? '' : 's'}`,
    // ---- defeat: the contract void ----
    void: 'Contract void',
    fellAtWave: (wave: number, of: number, clock: string) => `Last seen at wave ${wave} of ${of} · ${clock} on the clock`,
    fellAt: (clock: string) => `Last seen at ${clock} on the clock`,
    between: (n: number) => ` · ${n} takedowns between them`,
    keeps: (warlord: string, place: string) => `"${warlord} keeps ${place}. For now."`,
    championTag: (slot: string, kills: number) => `Champion · ${slot} · ${kills} kills`,
    playerKills: (who: string, kills: number) => `<b>${who}</b> ${kills} kills`,
    /** the wave counter runs one past the last while the warlord is fought */
    warlordDown: 'warlord down',
    waveNote: (wave: number) => `wave ${wave}`,
    noteAndTime: (note: string, time: string) => ` · ${note} · ${time}`,
    time: (time: string) => ` · ${time}`,
  },

  // ---------- the end of the hunt: all nine territories liberated ----------
  complete: {
    kicker: 'the bounty hunt is over',
    heading: 'The Outer Rim is free',
    tally: (n: number, time: string) => `${n} territories · ${n} warlords · ${time} on the clock`,
    takedowns: (n: number) => `${n} takedowns`,
    mostTakedowns: 'most takedowns',
    huntAgain: 'Hunt again',
    credits: 'Roll credits',
    quit: 'Quit',
  },

  // ---------- the credits ----------
  //
  // Everything on the credits roll is here; src/ui/credits.ts only lays it out.
  // It rolls top to bottom in the order written:
  //
  //   - `sections` is a list of { head, lines }. Add a section by adding an
  //     entry; reorder the roll by reordering them.
  //   - each line is [role, who]: the role sits right-aligned beside the name,
  //     as in ['Sound effects', 'Jane Doe'].
  //   - leave the role empty — ['', '...'] — for a line on its own, centred:
  //     a name standing alone under its heading, or a sentence.
  //   - the first section's lone lines are set large, as the lead credit.
  credits: {
    title: 'Bounty Hunters',
    sub: 'a Mandalorian fan game',
    back: 'Back',
    sections: [
      { head: 'Principal Game Designer', lines: [['', 'Hoai Nguyen']] },
      {
        head: 'Music',
        lines: [['Composed by', 'Hoai Nguyen, with Suno']],
      },
      {
        head: 'QA & game testing',
        lines: [['Testing, feedback & inspiration', 'Francis Nguyen']],
      },
      {
        head: 'Built with',
        lines: [
          ['Code & design assistance', 'Claude Code, by Anthropic'],
          ['Code assistance', 'Codex, by OpenAI'],
          ['3D engine', 'three.js — Ricardo Cabello (mrdoob) and contributors'],
          ['Tooling', 'TypeScript · Vite · Playwright'],
        ],
      },
      {
        head: 'Boba Fett model',
        lines: [
          ['', '“STAR WARS – Jedi Survivor (ESB): Boba Fett”'],
          ['by', 'Zorg_Sinister (fred346b) on Sketchfab'],
          ['licence', 'Creative Commons Attribution 4.0 — creativecommons.org/licenses/by/4.0'],
          ['', 'Decimated, retextured and colour-graded for this game.'],
        ],
      },
      {
        head: 'Other assets',
        lines: [
          ['Character, prop and vehicle models', 'generated with Tripo AI, rigged and cleaned in Blender'],
          ['Key art, board, system & planet paintings', 'generated with ChatGPT ImageGen, by OpenAI'],
          ['Sound effects & voices', 'generated with ElevenLabs'],
          ['Select-screen portraits', 'rendered in the game from its own models'],
        ],
      },
      {
        head: 'Type',
        lines: [
          ['Anton', 'Vernon Adams'],
          ['Playfair Display', 'Claus Eggers Sørensen'],
          ['Barlow Condensed', 'Jeremy Tribby'],
          ['Alfa Slab One', 'JM Solé'],
          ['IBM Plex Mono', 'IBM'],
          ['Special Elite', 'Astigmatic'],
          ['', 'SIL Open Font Licence 1.1 · Special Elite: Apache Licence 2.0'],
        ],
      },
      {
        head: 'From a galaxy far, far away',
        lines: [
          ['Star Wars', 'created by George Lucas'],
          ['The Mandalorian', 'created by Jon Favreau'],
          ['', 'With characters, creatures and places from The Book of Boba Fett, Star Wars: The Clone Wars, Star Wars: The Force Unleashed, Star Wars: Knights of the Old Republic and Star Wars Jedi: Survivor.'],
        ],
      },
      {
        head: 'Fan work',
        lines: [
          ['', 'Star Wars and all related names, characters and likenesses are © & ™ Lucasfilm Ltd. and The Walt Disney Company.'],
          ['', 'Bounty Hunters is a non-commercial fan project, made by fans for fans. It is not affiliated with, endorsed, sponsored or approved by Lucasfilm Ltd. or The Walt Disney Company.'],
        ],
      },
    ] as Array<{ head: string; lines: Array<[string, string]> }>,
    last: 'This is the Way.',
  },

  // ---------- settings ----------
  settings: {
    title: 'Settings',
    master: 'Master volume',
    sfx: 'Sound effects',
    music: 'Music',
    dynamicCamera: 'Dynamic camera',
    splitScreen: 'Split screen',
    stacked: 'Stacked',
    sideBySide: 'Side by side',
    saberLights: 'Saber lights',
    auto: 'Auto',
    on: 'On',
    off: 'Off',
    lookSensitivity: 'Look sensitivity',
    invertY: 'Invert look (Y)',
    keyboardMouse: 'Keyboard & mouse',
    back: 'Back',
    kicker: 'tune the kit',
    saved: 'Saved on this device',
    sections: { sound: 'Sound', camera: 'Camera & aim', screen: 'Screen & hands' },
    credits: 'Roll credits',
    noteKicker: (row: string) => `Field note · ${row}`,
    prompts: { adjust: 'Adjust', flip: 'Flip', back: 'Back' },
    /** the field note beside the list: whichever row is focused explains itself */
    notes: {
      master: 'Everything at once — music, effects and voices.',
      sfx: 'Blasters, blades, jetpacks and the things that growl back.',
      music: 'The score: each territory has its own, and the warlords bring theirs.',
      dynamicCamera: 'The chase camera closes in when you stand still and opens out when you sprint, dash or fly. Off, it holds the one distance the right stick dials in.',
      lookSensitivity: 'How far a push of the right stick — or a move of the mouse — turns you. The middle of the gauge is the default.',
      invertY: 'Push up to look down, as a flight stick does.',
      splitScreen: 'Which way co-op divides the window. Stacked gives each player a wide strip; side by side turns the same layout on its side. Four players get a quadrant either way.',
      saberLights: 'A lit blade glows on what is around it. Auto turns this off for the session if the game runs slowly.',
      keyboardMouse: 'Adds WASD and mouse aiming. While it is off the cursor stays free during play.',
      credits: 'Who made this, and whose galaxy it borrows.',
      back: 'Back to where you came from. Everything here is already saved.',
    },
  },

  // ---------- the corner buttons and the controls sheet ----------
  controls: {
    /** the field manual's heading, its line, and its three pages */
    manual: 'Field manual',
    manualSub: 'controls, for hunters new to the guild',
    pages: { job: 'The job', foot: 'On foot', saddle: 'In the saddle', keyboard: 'Keyboard & mouse' },
    /** the job page: what the stage in play wants, for a party that is stuck */
    briefSteps: 'How it goes',
    briefTips: 'Good to know',
    briefFoot: 'Stuck? The marker and the hint line under the objective always point the way on.',
    /** development builds only: skip the section in play */
    skipSection: 'Skip section (dev)',
    /** the job page for an ordinary stage of a Missions run */
    stageBrief: {
      goal: (label: string): string => `Make for ${label}.`,
      steps: [
        'Follow the marker and the light column to the next objective.',
        'Clear what stands in the way; a sealed door opens once its zone is cleared.',
        'Walk through the open transport door at the end to move on to the next stage.',
      ],
      tips: [
        'The hint line under the objective always says what to do next.',
        'The fallen come back beside the party, a little way forward.',
      ],
    },
    turnPage: 'Turn the page',
    padFoot: 'Start pauses · View goes fullscreen · A on a spare pad joins the posse',
    saddleNote: 'Drop a rider and the ride is yours. Stand by it and press Y (C on the keyboard) to climb on.',
    keyboardNote: 'Turn on Keyboard & mouse in Settings to play with WASD and mouse aiming.',
    title: 'Controls',
    back: 'Back',
    settingsButton: 'Settings',
    fullscreen: 'Fullscreen (controller: View button)',
    /** what a screen reader announces for the controller diagram */
    padAlt: "Xbox controller with the game's button bindings labelled",
    /** keyboard and mouse, as [what it does, what to press] */
    keyboard: [
      ['Move', 'W A S D'],
      ['Look / aim', 'Mouse'],
      ['Jump → hold to jetpack', 'Space'],
      ['Sprint (moving) · dash (from a stop)', 'Shift'],
      ['Block — raise shield (hold)', 'R'],
      ['Fire blaster', 'Left mouse'],
      ['Aim — zoom', 'Right mouse'],
      ['Melee combo — draws the blade', 'F · Middle mouse'],
      ['Special (rocket / power)', 'Q'],
      ['Camera distance', 'Mouse wheel'],
      ['Take cover · ground slam · mount a ride', 'C · Ctrl'],
      ['Next blade carried', '1'],
      ['Next gun carried', '2 · E'],
    ] as Array<[string, string]>,
    driving: [
      ['Mount a parked ride · get off', 'Y · C'],
      ['Accelerate · brake, then reverse', 'Left stick ↑↓ · W S'],
      ['Steer', 'Left stick ←→ · A D'],
      ['Hop — a kick off the repulsors', 'A · Space'],
      ['Shield the ride (hold) — turns fire, not walls', 'RB · R'],
      ['Boost', 'LB · Shift'],
      ['Charge — on a bantha', 'X · F'],
      ['Fire from the saddle — on a bantha', 'RT · Left mouse'],
    ] as Array<[string, string]>,
    always: [
      ['Navigate menus', '↑ ↓ ← → · click'],
      ['Select · back', 'Enter · Esc'],
      ['Pause', 'Esc'],
      ['Join co-op (up to 4)', 'A on a free pad'],
      ['Fullscreen', 'Alt + F'],
    ] as Array<[string, string]>,
    /** callouts on the controller diagram, in the order they are drawn */
    pad: {
      lt: ['LT', 'Aim (zoom)'],
      lb: ['LB', 'Dodge — tap with a direction'],
      lbHold: ['', 'Hold on to sprint'],
      leftStick: ['Left stick', 'Move'],
      dpad: ['D-pad ←→', 'Next blade · next gun'],
      dpadMenus: ['', 'Navigate menus'],
      rt: ['RT', 'Fire blaster — draws it'],
      rb: ['RB', 'Block — raise shield'],
      rbAir: ['', 'Shield the ride (hold)'],
      y: ['Y', 'Cover · ride · slam'],
      b: ['B', 'Special (rocket / power)'],
      a: ['A', 'Jump → hold to jetpack'],
      x: ['X', 'Melee combo — draws the blade'],
      rightStick: ['Right stick', 'Look &amp; aim'],
      rightStickClick: ['Click + up/down', 'Camera distance'],
    } as Record<string, [string, string]>,
  },

  // ---------- the playable cast ----------
  //
  // The name and the one line under it on the character select and the drop
  // screen. Everything else about a fighter — colours, loadout, how they fly —
  // lives with the roster in src/characters/mandalorians.ts; only the words
  // are here.
  characters: {
    din: { name: 'Din Djarin', desc: 'The Mandalorian — pure beskar shine, this is the way.' },
    paz: { name: 'Paz Vizsla', desc: 'Heavy infantry of the covert — a walking siege wall.' },
    bokatan: { name: 'Bo-Katan Kryze', desc: 'Nite Owl of Clan Kryze — born to the creed, and to rule it.' },
    armorer: { name: 'The Armorer', desc: 'Keeper of the forge — she shapes the beskar and the creed alike.' },
    boba_fett: { name: 'Boba Fett', desc: 'The legendary armored bounty hunter, armed for any contract.' },
    ventress: { name: 'Asajj Ventress', desc: 'Twin red blades and a dancer\u2019s patience \u2014 the assassin of the outer dark.' },
    jedi: { name: 'Galen Marek', desc: 'A hooded guardian with twin white blades and a measured hand.' },
    maris: { name: 'Maris Brood', desc: 'A swift duelist wielding twin white tonfa sabers.' },
    maul: { name: 'Darth Maul', desc: 'A relentless acrobat wielding a red double-bladed saber.' },
    revan: { name: 'Darth Revan', desc: 'A hooded fighter with a masked face and a single red saber.' },
    embo: { name: 'Embo', desc: 'The hat, the bow, the silence \u2014 a hunter who never wastes a bolt.' },
    bossk: { name: 'Bossk', desc: 'Cold blood and a long rifle \u2014 he could smell you a board away.' },
    duelist: { name: 'Cad Bane', desc: 'Two pistols, no creed \u2014 the fastest draw for hire in the outer systems.' },
    ig11: { name: 'IG-11', desc: 'Hunter-killer droid on its second conscience \u2014 precision, now with mercy by choice.' },
  },

  // ---------- the playable NPCs of the PvP roster ----------
  //
  // Their names come from `enemies` above — a Pyke Capo is a Pyke Capo whether
  // you are shooting one or playing one — so only the line under the name,
  // which is written for the player picking them, lives here.
  npcs: {
    tusken: 'A raider of the wastes — and the two cousins who swing beside you.',
    pyke: 'Syndicate muscle. Thin blood, thick numbers.',
    pirate: 'A gunner with a crew that follows the loudest voice — yours.',
    pirateMelee: 'A brawler and his boarding party. Get close, stay close.',
    stormtrooper: 'The armour cannot aim, but three of you missing together adds up.',
    quarren: 'A dock hand with a net gun and two mates off the trawler.',
    alamite: 'A cave-dweller and its pack — stone clubs, no manners.',
    krykna: 'One spider you steer, three that follow. The nest hunts as one.',
    nikto: 'A swoop rider — the bike flies, and so do you.',
    deathtrooper: 'Black armour, better rifle, no backup needed.',
    darktrooper: 'A war droid on thrusters. Slow trigger, heavy bolt, real flight.',
    jetpirate: 'A pirate with a stolen jetpack and everything that implies.',
    droid: 'A security frame: walks slowly, hits like a turret.',
    flametrooper: 'Short reach, terrible opinions about your cover.',
    officer: 'A double-ended electrostaff crackles at both tips.',
    capo: 'Pyke royalty behind a personal shield-heavy frame.',
    ringEnforcer: 'Oxblood plate and a tower shield habit — a walking wall.',
    marshal: 'The Marshal of Mos Pelgo, quick on the draw.',
    fennec: 'One shot, one answer. The rifle decides at any range.',
    massiff: 'Five and a half metres of war beast. You are the pounce now.',
    broodmother: 'The Crevasse made flesh. Lay eggs on Y; the brood hunts for you.',
    spiderling: 'A hatchling of the brood. Small, quick, and ten seconds from motherhood.',
    enforcer: 'A Wookiee gladiator. Doors are a suggestion.',
  },

  // ---------- weapons, as the HUD and the menus name them ----------
  weapons: {
    ranged: {
      carbine: 'EE-3 Carbine', crossbow: 'Laser Crossbow', longrifle: 'Long Rifle', pistols: 'Twin Pistols',
    },
    melee: { gaffi: 'Gaffi Stick', sabers: 'Twin Sabers', fists: 'Fists' },
    /**
     * A signature weapon the HUD names for itself rather than by its slot:
     * a staff other than the gaffi, or a single saber rather than a pair.
     */
    props: {
      beskarSpear: 'Beskar Spear', poleaxe: 'Poleaxe', quarterstaff: 'Quarterstaff', forcePike: 'Force Pike',
      tuskenGaffi: 'Tusken Gaffi', nightsisterPolearm: 'Nightsister Polearm',
      doubleSaber: 'Double Saber', redSaber: 'Red Saber', darksaber: 'Darksaber',
    },
    /** what a playable NPC's slots are called, built from its own name */
    npcRifle: (name: string) => `${name} Rifle`,
    npcBlaster: (name: string) => `${name} Blaster`,
    npcClaws: 'Claws & Steel',
    npcRifleButt: 'Rifle Butt',
  },

  // ---------- boards, as the territory select and the drop screen name them ----------
  //
  // the world each territory is on, named on the tickets, the mission map and
  // the drop screen's photograph
  worlds: {
    desert: 'Tatooine', station: 'Deep space', nevarro: 'Nevarro', crevasse: 'Maldo Kreis',
    trask: 'Trask', refinery: 'Imperial plant', forge: 'Mandalore', ringworld: 'Glavis',
    narkina: 'Ocean world',
  } as Record<string, string>,

  // `objective` is the line under the board's name on the banner that opens a
  // Wave Battle; the two territories without one fall back to
  // `banners.objective.wave`.
  boards: {
    desert: { name: 'The Dune Sea', desc: 'Tatooine wastes — Tusken outcasts, Pyke patrols, swoop gangs, and the sarlacc. Watch your step.' },
    station: { name: 'The Spice Run', desc: 'A smugglers’ waystation in deep space. Floating platforms — the jetpack is the only road.' },
    nevarro: { name: 'The Lava Flats', desc: 'Nevarro’s black glass, cut by living lava. Geysers erupt on a rhythm — ride them, or feed the rivers.', objective: 'Nevarro · survive 7 waves' },
    crevasse: { name: 'The Crevasse', desc: 'Maldo Kreis. Three layers of ice, a lake that cracks underfoot, and the spiders that own the dark.', objective: 'Maldo Kreis · survive 7 waves' },
    trask: { name: 'The Storm Docks', desc: 'A Trask fishing port in a squall. Heaving trawler decks, lightning, and the mamacore under the pier.', objective: 'Trask · survive 7 waves' },
    refinery: { name: 'The Refinery', desc: 'An Imperial rhydonium plant. Low corridors, a 40 m reactor shaft, volatile barrels, and the alarm consoles.', objective: 'Imperial rhydonium plant · survive 7 waves' },
    forge: { name: 'The Great Forge', desc: 'Mandalore’s glassed ruins. Magnetic storms sweep the open ground — the calm is for fighting.', objective: 'Mandalore · survive 7 waves' },
    ringworld: { name: 'The Ringworld', desc: 'A Glavis street under a moving terminator. The dark side hides you; the tram runs through both.', objective: 'Glavis · survive 7 waves' },
    narkina: { name: 'The Prison Rig', desc: 'A white Imperial facility on an ocean world. Electrified decks above; a whole sea to dive below.', objective: 'Imperial ocean facility · survive 7 waves' },
  },

  // ---------- bosses ----------
  bosses: {
    /** the warlord who holds each territory, named on the banner and the boss bar */
    warlord: {
      desert: 'The Pit Warlord',
      station: 'The Spice Baron',
      nevarro: 'The Garrison Commander',
      crevasse: 'The Broodmother',
      trask: 'The Harbourmaster',
      refinery: 'The Electrostaff Officer',
      forge: 'The Forge Tyrant',
      ringworld: 'The Fastest Gun on Glavis',
      narkina: 'The Prison Warden',
    },
    /**
     * The thing that comes out of the floor after the warlord, on the boards
     * that have one — the third and last boss battle there, and its own
     * animal rather than another armoured officer.
     */
    monster: {
      station: "The Smugglers' Prize",
      crevasse: 'The Ice-Breaker',
      trask: 'The Mamacore',
      nevarro: "The Warlord's Rancor",
      desert: 'The Old One of the Dune Sea',
      forge: 'The Sleeper Below',
      refinery: 'The Specimen',
      ringworld: 'The Night-Side Stalker',
      narkina: 'The Thing in the Moon Pool',
    },
    /**
     * The warlord's second, sent out halfway through: the first of a
     * territory's boss battles and the easier of the two.
     *
     * Not a "champion" — that word belongs to the player who wins a duel, and
     * having it mean an enemy as well made the same word both the prize and
     * the obstacle.
     */
    lieutenant: {
      desert: 'The Hunger Under the Sand',
      station: 'The Dock Assassin',
      nevarro: "The Magistrate's Hound",
      crevasse: 'The Tunnel Queen',
      trask: 'The Freighter Captain',
      refinery: 'The Furnace Master',
      forge: 'The Rockdweller Alpha',
      ringworld: 'The Silent Sentinel',
      narkina: 'The Floor Supervisor',
    },
  },

  // ---------- hostiles, as the drop screen and the contact card name them ----------
  enemies: {
    tusken: 'Tusken Raider', massiff: 'War Massiff', pirateMelee: 'Pirate Brawler', pyke: 'Pyke Syndicate',
    pirate: 'Pirate Gunner', droid: 'Battle Droid', nikto: 'Nikto Swoop', jetpirate: 'Jetpack Pirate',
    stormtrooper: 'Stormtrooper', deathtrooper: 'Death Trooper', darktrooper: 'Dark Trooper',
    gunslinger: 'Guild Gunslinger', officer: 'Imperial Officer', capo: 'Pyke Capo', enforcer: 'Wookiee Enforcer',
    flametrooper: 'Flametrooper', krykna: 'Krykna', broodmother: 'Broodmother', quarren: 'Quarren',
    alamite: 'Alamite', drone: 'Interceptor Drone', ringEnforcer: 'Ring Enforcer',
    escortDroid: 'Escort Droid', marshal: 'The Marshal', fennec: 'Fennec Shand',
    mudhorn: 'Mudhorn', ravinak: 'Ravinak', mamacore: 'Mamacore', rancor: 'Rancor',
    kraytDragon: 'Greater Krayt', mythosaur: 'Mythosaur',
    sandworm: 'Dune Worm', zillo: 'Zillo Beast', nexu: 'Nexu', kwazelMaw: 'Kwazel Maw',
    spiderEgg: 'Krykna Egg', spiderling: 'Krykna Hatchling',
    // a rival goes by its hero's name from `characters` above (src/enemies/rivals.ts)
  },

  // ---------- rides ----------
  vehicles: { speeder: 'Speeder bike', skiff: 'Cargo skiff' },

  // ---------- missions ----------
  missions: {
    /**
     * What each room of a territory's run is called, in the order you walk
     * them: the trailhead first, the warlord's arena last. The HUD names the
     * one ahead of you ("Make for the cistern court") and the banner names the
     * one you are sealed into, so these are read aloud constantly.
     *
     * The layouts in src/world/mission.ts take them by position, and hold the
     * two lists to the same length at load — a room without a name would be
     * announced as "undefined", which is the one failure worth catching loudly.
     */
    rooms: {
    desert: ['the trailhead flats', 'the Tusken corral', 'the dune road', 'the ravine', 'the cistern court', 'the fighting pit', 'the dune gate', 'the caravan graves', "the Old One's hollow"],
    station: ['the docking bay', 'the cargo gantries', 'the outer yard', 'the spice vault', 'the loading gantry', 'the crew catwalks', 'the reactor ring', 'the hold of the prize'],
    nevarro: ['the ash flats', 'the bike pool', 'the crust causeway', 'the town gate', 'the garrison yard', 'the magistrate court', 'the crossing', 'the cantina row', 'the rancor pen'],
    crevasse: ['the rim shelf', 'the frozen gallery', 'the queen tunnel', 'the hatchery', 'the cracked lake', 'the ice chimney', 'the breaker deep'],
    trask: ['the quay steps', 'the fish market', 'the freighter hold', 'the cold stores', 'the trawler deck', 'the pier heads', 'the mamacore pool'],
    refinery: ['the tanker yard', 'the pipe run', 'the barrel stores', 'the reactor floor', 'the reactor crown', 'the loading field'],
    forge: ['the glassed plain', 'the glass corral', 'the glass highway', 'the shattered gate', 'the dome undercroft', 'the armoury vault', 'the glassed court', 'the forge steps', "the sleeper's basin"],
    ringworld: ['the tram stop', 'the market arcade', 'the night-side row', 'the terminus', 'the sentinel walk', 'the plaza', 'the service spine', 'the high street terrace'],
    narkina: ['the landing deck', 'the gantry run', 'the kelp forest', 'the moon pool shaft', 'the work floor', 'the supervisor deck', 'the assembly deck', 'the moon pool deck'],
    },
    /**
     * What each **stage** of a run is called: the line on the transition card
     * when the party crosses a transport door into a map with its own world
     * rules (docs/MISSIONS_OUTDOOR.md §1.9). One entry per stage, in order.
     */
    stages: {
      desert: ['the open desert', 'the ravine', 'the far side'],
      station: ['the approach', 'inside the station', 'the prize'],
      nevarro: ['the flats', 'the garrison', 'the glass fields'],
      crevasse: ['the surface', 'the deep'],
      trask: ['the harbour', 'the pier heads'],
      refinery: ['the yard', 'the plant', 'the loading field'],
      forge: ['the plain', 'the undercroft', 'the dome'],
      ringworld: ['the high street', 'the night-side row', 'the service spine'],
      narkina: ['the landing deck', 'the sea', 'the cell block', 'the top decks'],
    },
    /**
     * The one-time line when a player first meets the ceiling. It is not a
     * wall so much as where the playable sky stops and the ambient sky — the
     * one carriers cross and fliers come down out of — begins.
     */
    ceiling: {
      desert: 'The sky thins out here',
      station: "The hull's field ends here",
      nevarro: 'The ash cloud sits low',
      crevasse: 'The storm sits low here',
      trask: 'The squall closes overhead',
      refinery: 'The stack smoke closes overhead',
      forge: 'The magnetic storm closes overhead',
      ringworld: "The ring's ceiling ends here",
      narkina: 'The rig grid ends here',
    },
    /** the HUD's standing instruction, by what the room ahead wants */
    makeFor: (where: string, metres: number) => `Make for ${where} · ${metres} m`,
    holdRoom: (where: string, wave: number, of: number) => `Hold ${where} · wave ${wave} of ${of}`,
    holdGround: (where: string, left: number) => `Take ${where} · ${left} holding it`,
    bringDownLieutenant: 'Bring down the lieutenant',
    bringDownWarlord: 'Bring down the warlord',
    pushThrough: (where: string, metres: number) => `Push through ${where} · ${metres} m`,
    ride: (where: string, metres: number) => `Ride for ${where} · ${metres} m`,
    clearTheWay: 'Break through the barricade',
    /** the transport door, and the wait to go back through one */
    boarding: (where: string) => `Transport · ${where}`,
    /**
     * The stage is cleared and the party is walking to the transport door.
     * Without this the HUD kept naming the last zone — "Make for the dune
     * road" while you stood at the door it opens — so a run that was waiting
     * on one step through looked like a run with nothing left to say.
     */
    wayOn: (where: string, metres: number) => `The way on is open · ${where} · ${metres} m`,
    stepThrough: (where: string) => `Step through to ${where}`,
    exited: 'You have exited · B to cancel',
    waitingOn: (name: string, n: number) => `${name} has stepped out — waiting on ${n} more`,
    arrivedAt: (where: string) => `Arrived · ${where}`,
  },
  /**
   * The gameplay sections (docs/LEVEL_SECTIONS.md). `stage` is the transport
   * card's line for the stage — where the party is going — and `title` the
   * banner when it arrives. A section's own running lines (its hints and
   * banners) live beside it here as its module grows them; one block each,
   * so two sections never edit the same lines.
   */
  sections: {
    'barge-run': {
      stage: 'the skiff landing', title: 'The Barge Run',
      sub: 'the barge is pulling away — board the skiff',
      skiff: 'the skiff', barge: 'the sail barge', gunner: "the barge's gunner",
      planks: 'the boarding planks', cargo: 'the cargo deck', heavyGun: 'the heavy gun',
      raiders: 'the Tusken skiffs', helmsman: 'the helmsman',
      hintBoard: 'Board the skiff',
      hintCastoff: 'Casting off · after the barge',
      hintBroadside: 'Shoot the gunner · mind the shells',
      hintSilenced: 'Gun silenced · hold on',
      hintClose: 'Closing in · get ready to board',
      hintDeck: 'Take the cargo deck',
      hintUpper: 'Up top · take the heavy gun',
      hintRaiders: 'Burn the Tusken skiffs',
      hintHelm: 'Kill the helmsman',
      hintGrounded: 'She is aground',
      castOff: 'Cast off', castOffSub: 'after that barge',
      broadside: 'Broadside', broadsideSub: 'their gun is on the skiff — shoot the gunner',
      close: 'Closing', closeSub: 'the gun is silent — bring her alongside',
      closeSubAnyway: 'bring her alongside — board under fire',
      board: 'Board her', boardSub: 'across the planks or jump — take the cargo deck',
      upper: 'The upper deck', upperSub: 'two skiffs astern — take the heavy gun',
      raiderDown: 'Skiff burning', raiderOne: 'one more astern', raidersDone: 'that is both — the helm!',
      helm: 'The helmsman', helmSub: 'he will not give up the wheel',
      grounded: 'Aground', groundedSub: 'the barge slews onto a sandbank',
      brokeUp: 'The skiff breaks up', brokeUpSub: 'a fresh one — back into the broadside',
      hull: 'Skiff', heat: 'Heat', vent: 'Venting', raider: 'Tusken skiff',
      gunLine: 'Fire · mind the heat · Y off',
      lineHeavy: 'Y at the heavy gun · take it',
      lineAuto: 'Deck gun on auto · half rate',
      lineBroadside: 'Hold the skiff',
    },
    'worm-sign': {
      stage: 'worm country', title: 'Worm Sign',
      sub: 'it hunts by sound — stay on the rock',
      hint: 'Rock is silent · sand is not',
      hintRing: 'WORM SIGN · get to rock!',
      hintStalk: 'It is circling · let it settle',
      hintDrawn: 'The thumper has it · move!',
      hintApron: 'Plant a thumper · run the apron',
      island: (k: number) => `checkpoint island ${k}`,
      rim: 'the pit rim',
      checkSub: (k: number, n: number) => `rock island ${k} of ${n}`,
      noise: 'Noise',
      hunger: 'Worm',
      drawn: 'Thumper',
      wormSign: 'Worm sign',
      wormSignSub: 'the sand is moving under you — rock, now',
      pullVerb: 'pull the thumper',
      plantVerb: 'plant the thumper',
      carryTitle: 'Thumper',
      carrySub: 'hands full · plant it out on the sand',
      carryLine: 'Carrying · plant it on sand',
      planted: 'Thumper planted',
      plantedSub: 'fifteen seconds — go while it listens',
      lineSand: 'On sand · it can hear you',
      lineRock: 'On rock · silent',
      lineRing: 'The ring is on you · move!',
      rimTitle: 'The pit rim',
      rimSub: 'it is going under — into the pit ahead',
    },
    'frigate-guns': {
      stage: 'the frigate', title: 'Guns of the Frigate',
      sub: 'casting off — run the blockade to the far dock',
      castOff: 'Casting off',
      castOffSub: 'the collar is letting go — man the guns',
      gunLabel: 'a quad gun',
      gunHint: 'Y at a quad gun to man it',
      holdHint: 'RT fires · Y steps off',
      hullLabel: 'the hull',
      wave: (k: number, of: number) => `Wave ${k} of ${of}`,
      waves: ['Drones', 'Gun-dropships', 'Boarding tubes', 'Everything they have'],
      waveSubs: [
        'interceptor swarms — shoot them off the hull',
        'gun-dropships on strafing runs',
        'dropships latching tubes — someone leave a gun',
        'swarms, gunships and boarders',
      ],
      clear: (k: number) => `Wave ${k} clear`,
      clearSub: 'damage control patched the hull',
      radar: (what: string, bearing: string) => `Radar ▸ ${what} · ${bearing}`,
      inbound: (what: string, bearing: string) => `${what} inbound · ${bearing}`,
      bearings: { ahead: 'ahead', astern: 'astern', port: 'port', starboard: 'starboard' },
      contacts: { swarm: 'drones', gunship: 'gunship', board: 'boarder', corvette: 'corvette' },
      boarders: 'Boarders on the hull!',
      boardersSub: 'a tube has latched — leave a gun, cut the latch',
      latchLabel: 'the boarding latch',
      latchHint: 'Latch: melee or rocket it',
      latchCut: 'Latch cut',
      latchCutSub: 'the tube tears away',
      boardHint: 'Boarders! Leave a gun',
      breached: 'Hull breached',
      breachedSub: 'damage control — the wave comes round again',
      corvette: 'Pirate corvette',
      corvetteSub: 'three shield domes — knock them out',
      corvetteHint: 'Shoot the 3 shield domes',
      genLabel: 'a shield dome',
      genDown: (n: number) => (n > 0 ? `Shield dome down · ${n} left` : 'Shields down'),
      genDownSub: 'go for the bridge',
      bridgeLabel: "the corvette's bridge",
      bridgeHint: 'Shields down · the bridge',
      spinal: 'Clear the red line!',
      broken: 'The corvette is breaking away',
      brokenSub: 'burning — the far dock is ahead',
      docking: 'Hold on · docking',
      docked: 'Docked',
      dockedSub: 'down the forward hatch — the spice vault',
      hatchLabel: 'the forward hatch',
      hatchHint: 'Down the forward hatch',
      hull: 'Hull',
      hullDown: 'Hull breached',
      heat: 'Gun heat',
      venting: 'Venting',
      gens: (n: number) => `Shield domes ${n}/3`,
      bridge: 'Corvette bridge',
      lost: 'Lost to the void',
      lostSub: 'back up through the nearest hatch',
    },
    'magma-run': {
      stage: 'the lava tunnels', title: 'The Magma Run',
      sub: 'steal a bike and ride the river out',
      bikes: 'the bikes',
      bikesHint: 'Steal a bike · Y at one',
      chase: 'Bike thieves!',
      chaseSub: 'the crew wants them back — ride',
      stretches: ['the run-in', 'the columns', 'the falls', 'the gun barge'],
      hints: [
        'RT cannons · X swings',
        'Watch for the cracks',
        'Falls ahead · A hops',
        'Sink the gun barge',
      ],
      gate: (n: number) => `gate ${n}`,
      barge: 'the gun barge',
      bargeUp: 'Gun barge!',
      bargeSub: 'kill the gunner, knock the crew off, or ram it',
      bargeHold: 'The boom holds · sink it',
      bargeDown: 'The barge is going down',
      bargeDownSub: 'the boom is off the mouth — to the landing',
      landing: 'the landing',
      landingHint: 'Pull up at the landing',
      freshBike: 'A fresh bike',
      freshBikeSub: 'back in the run',
      columns: 'The columns are coming down',
      speed: 'Speed',
      cannon: 'Cannons',
      venting: 'Venting',
      hull: 'Barge hull',
      metres: (m: number) => `${m} of 2000 m`,
    },
    'ring-walk': {
      stage: 'the outer ring', title: 'The Ring Walk',
      sub: 'a quarter of the ring to the crew airlock',
      cycling: 'Outer door cycling…',
      doorLabel: 'the outer door',
      open: 'Outer door open',
      openSub: 'walk the hull — RS points the gun',
      walk: 'Walk the hull · RS aims',
      gate: (k: number) => `rail gate ${k}`,
      gateSub: (k: number) => `rail gate ${k} of 3`,
      vents: 'Time the vents · jump the gaps',
      locked: (n: number) => `Locked in · ${n} left`,
      lockLabel: 'hold here',
      lockHint: 'Locked in · clear the hull',
      clear: 'Clear — the rail is open',
      lock1: 'Dropships over the curve',
      lock1Sub: 'hold the end of the vent run',
      lock2: 'The spoke junction',
      lock2Sub: 'three waves, and a gun hatch in the hull',
      lock3: "The capo's retinue",
      lock3Sub: 'they came out of the airlock you want',
      hatchLabel: 'the gun hatch',
      hatchHint: 'Gun hatch · shoot its eye',
      hatchShut: 'Gun hatch down',
      hatchLine: 'Hatch open — shoot the eye',
      sweep: 'Jump the beam · or duck the conduit',
      spotted: 'Spotted',
      spottedSub: 'the boom called drones',
      airlock: 'the crew airlock',
      airlockOpen: 'The airlock is open',
      airlockSub: 'the crew catwalks are through it',
      airlockHint: 'Into the airlock',
    },
    chimney: {
      stage: 'the magma chamber', title: 'The Chimney',
      sub: 'the vent is flooding — climb',
      lip: 'the chimney lip',
      climb: (m: number) => `Climb · magma ${m} m below`,
      valveVerb: 'vent the shutter',
      valveLabel: 'the valve',
      valveHint: 'Way up shut · hold Y at the valve',
      valveHeld: 'Vented · the magma is holding',
      shutterOpen: 'the shutter above is open — climb',
      lipOpen: 'the lip is open — the vent is surging, go!',
      magma: 'Magma',
      paused: 'Held',
    },
    'glacier-chute': {
      stage: 'the glacier', title: 'The Glacier Chute',
      sub: 'the shelf is going — ride it down',
      cracking: 'The ice is cracking',
      gone: 'the floor is going — slide!',
      avalanche: 'Avalanche',
      avalancheSub: 'the whole shelf is coming down behind you',
      caught: 'Caught by the avalanche',
      caughtSub: 'dug out further down',
      fell: 'Down a crevasse',
      fellSub: 'hauled out at the next gate',
      gate: (k: number) => `gate ${k} of 8`,
      gateLabel: (k: number) => `flag gate ${k}`,
      snowbank: 'the snowbank',
      fork: 'Fork · left jumps, right spiders',
      hintStart: 'Walk on · the floor will go',
      hintSlide: 'Steer · pull back to dig in',
      hintJump: 'Crevasse ahead · jump!',
      hintWeb: 'Web ahead · shoot it or kick',
      hintEnd: 'Into the snowbank · regroup',
      regroup: (n: number) => `Regroup · ${n} still sliding`,
      speed: (v: number) => `${v} m/s`,
      behind: (m: number) => `Avalanche ${m} m behind`,
      kick: 'Kick!',
      crash: 'Wiped out · clear the lane ahead',
    },
    lamplight: {
      stage: 'the dark', title: 'Lamplight',
      sub: 'the brood is afraid of your lamp — for now',
      braziers: (lit: number) => `${lit}/3 braziers lit`,
      verb: 'light the brazier',
      label: 'the brazier',
      hintLight: 'Hold Y at the brazier',
      hintOn: 'The web is open · go on',
      hintBurn: 'Hold them off · the web is burning',
      hintExit: 'Through the web · the queen tunnel',
      lit: 'Brazier lit',
      litSub: (lit: number) => `${lit} of 3 in this chamber`,
      opened: 'The webs shrink back',
      openedSub: 'the way on is open',
      bold: 'The brood grows bold',
      boldSub: 'light a brazier to push them back',
      burning: 'The web wall is burning',
      burningSub: 'the whole brood is coming',
      burnt: 'The way is open',
      exit: 'the queen tunnel',
      beam: 'Beam',
      flare: (s: number) => (s > 0 ? `Flare in ${s}s` : 'Q/B · throw a flare'),
      dark: 'Aim to focus · Q/B for a flare',
    },
    squall: {
      stage: 'the open harbour', title: 'The Squall',
      sub: 'the trawler casts off into the storm',
      hold: (w: number) => `Hold the deck · wave ${w} of 3`,
      waveBanner: (w: number) => `Boarders · wave ${w} of 3`,
      waveSub: ['quarren up the stern ramp', 'over both rails — and the boom is loose', 'the squall at its height'],
      waveBar: (w: number) => `Wave ${w} of 3`,
      clearBanner: 'The deck is held',
      clearSub: (w: number) => `wave ${w} of 3 over the side — more coming`,
      rogue: 'Rogue wave',
      bigOne: 'The big one',
      rogueSub: (side: string) => `off the ${side} side — brace!`,
      rogueBar: 'Rogue wave',
      rogueHint: 'Rogue wave! Brace — Y at a wall',
      braced: 'Braced — hold on',
      lee: 'In the lee — hold on',
      port: 'port', starboard: 'starboard',
      lightning: 'Lightning! Off the roof',
      boomHint: 'The boom is loose — mind it',
      tookSub: 'hauled back aboard — the deckhouse roof',
      deck: 'the deckhouse',
      pier: 'the far pier',
      pierBanner: 'The far pier',
      pierSub: 'out of the rain — she is coming alongside',
      approachHint: 'Coming alongside the far pier',
      dockBar: 'Alongside',
      alongside: 'Alongside',
      alongsideSub: 'the starboard gate is open — step ashore',
      pierHint: 'Starboard gate · step ashore',
    },
    'run-the-pier': {
      stage: 'the far pier', title: 'Run the Pier',
      sub: 'the mamacore is out — run for the pier heads!',
      run: 'Run! It is right behind you',
      close: 'It is on you — sprint or shoot it!',
      under: 'Caught — dragged under…',
      grace: 'A gate — catch your breath',
      caught: 'Caught',
      caughtSub: 'dragged under — back at the front in a moment',
      stagger: 'Staggered',
      staggerSub: 'it drops back — run!',
      staggered: 'Staggered',
      mamacore: 'Mamacore',
      mamacoreLabel: 'the mamacore',
      staggerBar: 'Stagger it',
      reset: 'Everyone caught',
      resetSub: 'back to the last gate',
      gateSub: (k: number) => `gate ${k} of 2`,
      gap: 'the gap', gapHint: 'Gap ahead — jump!',
      collapsed: 'the collapsed pier', collapsedHint: 'Pier gone ahead — jet or leap!',
      craneHint: 'The crane load — time it',
      heads: 'the pier heads',
      door: 'the pier heads door', doorHint: 'Through the door — go!',
    },
    'the-line': {
      stage: 'the processing line', title: 'The Line',
      sub: 'the line is running — ride it to the plant',
      pressLabel: 'the press row',
      pressHint: 'Time the presses — or brake them',
      armsLabel: 'the smelter',
      armsHint: 'Jump the arms · off before the end',
      ledgeLabel: 'the plant door',
      ledgeHint: 'Off the belts — onto the door deck',
      releaseHint: 'Hold Y at the door release',
      doorLabel: 'the plant',
      doorHint: 'The door is open — into the plant',
      brakeVerb: 'throw the brake',
      braked: 'Brake thrown',
      brakedPress: 'the press row ahead is held open',
      brakedArms: 'the welding arms are parked',
      row1Held: 'Row 1 held',
      row2Held: 'Row 2 held',
      armsParked: 'Arms parked',
      doorBar: 'Door',
      releaseVerb: 'open the door',
      surge: 'Line surge',
      surgeSub: 'the belts are running fast — get to the door',
      opening: 'The door is opening',
      openingSub: 'hold the deck',
      station: (k: number) => `station ${k} of 4`,
      crushed: 'Crushed',
    },
    'lights-out': {
      stage: 'the tank farm', title: 'Lights Out',
      sub: 'stay out of the light — take them from behind',
      stair: 'the lit stair',
      stairHint: 'Stay dark · reach the lit stair',
      climbHint: 'Up the stair — the crown is above',
      seen: 'Seen',
      heard: 'Heard',
      radio: 'Radioing',
      radioLine: 'Spotted — silence him!',
      alarm: 'Alarm',
      alarmSub: 'lanes sealed · turrets up · a drop inbound',
      alarmSeen: 'you were seen',
      alarmRadio: 'a trooper called it in',
      alarmHint: 'Alarm · kill the drop, then reset',
      resetHint: 'Reset the alarm at a console',
      resetVerb: 'reset the alarm',
      resetLabel: 'an alarm console',
      reset: 'Alarm reset',
      resetSub: 'the yard settles — back to the dark',
      boothVerb: 'kill the searchlights',
      lightsOut: 'Lights out',
      lightsOutSub: 'the searchlights are dark for ten seconds',
      lightsBack: 'Lights',
      boothCharging: 'Booth',
      takedown: 'Silent takedown',
      inLight: 'In the light — move',
      inSensor: 'In a sensor beam — move',
    },
    'hold-the-forge': {
      stage: 'the covert forge', title: 'Hold the Forge',
      sub: 'the beskar is on the fire — hold them off her',
      prep: 'Raise shields · hold Y',
      socketVerb: 'raise a shield',
      socketBar: 'Shield',
      bellowsVerb: 'mend the bellows',
      bellowsBar: 'Mending',
      forge: 'the forge',
      armorer: 'Armorer',
      armorerDown: 'Rising',
      forging: 'Forging',
      stalled: 'Stalled',
      hold: 'Keep them off the Armorer',
      holdStalled: 'Stalled · clear her dais',
      bellowsBroken: 'Bellows broken · hold Y there',
      bellowsHint: 'Mend the bellows · hold Y',
      bellowsDown: 'A bellows is broken',
      bellowsDownSub: 'the fire is starving — mend it (hold Y)',
      wave: (pass: string) => `Alamites in the ${pass} tunnel`,
      waveSub: 'they are coming for the Armorer',
      passes: ['north', 'east', 'west'] as readonly string[],
      finalWave: 'The chieftain comes',
      finalSub: 'all three tunnels — hold the dais',
      chieftain: 'Alamite Chieftain',
      armorerFell: 'The Armorer is down',
      armorerFellSub: 'the forging slips back — she will rise',
      armorerUp: 'The Armorer rises',
      mark: (pct: number) => `The forging · ${pct}%`,
      quench: 'Finish the chieftain',
      giftTitle: 'This is the Way',
      giftSub: 'beskar for each of you: +25 max health for the run',
      boosters: 'The boosters are forged',
      boostersSub: 'flight-rated — the shaft is the way out',
      shaftLabel: 'the shaft',
      shaftHint: 'Gather at the forge',
      shields: (n: number, of: number) => `Beskar shields up · ${n} of ${of}`,
    },
    'covert-sky': {
      stage: 'the sky over the city', title: 'Covert Sky',
      sub: "the Armorer's boosters burn free — fly",
      teach: 'Hold A to fly · LB boost · Y dive',
      teachTitle: 'Fly',
      ring: 'the next ring',
      ringHint: 'Fly the rings to the dome',
      flak: 'the flak gun',
      flakHint: 'Land on the flak · hold Y',
      flakVerb: 'plant the charge',
      charged: 'Charge set — clear the tower!',
      flakDown: 'Flak gun silenced',
      flakDownSub: 'the sky ahead is open',
      screen: 'Flak screen',
      screenSub: 'silence the gun on the tower first',
      updraft: 'Caught by the updraft',
      updraftSub: 'below the rooftops the city throws you back up',
      breach: 'the breach',
      breachHint: 'Dive through the breach',
      breachOpen: 'The breach is open',
      breachOpenSub: 'dive into the dome',
      rings: (n: number, of: number) => `Ring ${n} of ${of}`,
      flakBar: 'Flak towers',
      shieldBar: 'Breech',
    },
    'tram-top': {
      stage: 'the tram', title: 'Tram Top',
      sub: 'ride the roof to the terminus',
      // hints (the merged rail HUD has the whole width, but keep them short)
      hintBoard: 'Get aboard the tram',
      hintRoof: 'Hold the roof',
      hintDuck: 'Duck! Hold Y',
      hintStation: 'Hold the doors',
      hintInside: 'Tunnel! Get inside',
      hintTunnel: 'Fight through the cars',
      hintUp: 'Back up top',
      hintRival: 'Clear it or cut it loose',
      hintOff: 'Off at the terminus',
      // objective labels
      tram: 'the tram', front: 'the front car', hatch: 'a roof hatch', coupling: 'its coupling',
      gate: 'the terminus gate', rival: 'the pirate tram',
      // the HUD panel
      line: 'The line',
      next: (what: string, m: number) => `${what} in ${m} m`,
      gantry: 'Gantry', station: 'Station', tunnel: 'Tunnel', terminus: 'Terminus',
      ducking: 'Ducking',
      stopLeft: (s: number) => `Doors close in ${Math.ceil(s)} s`,
      rivalBar: 'Pirate tram',
      // banners
      departs: 'All aboard', departsSub: 'hold the roof — mind the gantries',
      gantryWarn: 'Gantry!', gantryWarnSub: 'duck (hold Y) or jump it',
      swept: 'Swept off', sweptSub: 'back on the rear car',
      stationIn: 'The station', stationInSub: 'they are boarding — hold the doors',
      stationOut: 'Doors closing', stationOutSub: 'next stop: the tunnel',
      tunnelWarn: 'Tunnel!', tunnelWarnSub: 'one metre of clearance — drop through the hatches',
      tunnelOut: 'Daylight', tunnelOutSub: 'back up through the hatches',
      rivalIn: 'Pirate tram', rivalInSub: 'jump across and clear it, or shoot its coupling',
      rivalCut: 'Cut loose', rivalClear: 'Cleared', rivalOffSub: 'it peels off at the junction',
      terminusIn: 'The terminus', terminusInSub: 'off the tram — the gate is the way on',
      leftBehind: 'Back aboard', leftBehindSub: 'the pirate tram peeled off',
    },
    'one-way-out': {
      stage: 'the cell blocks', title: 'One Way Out',
      sub: 'free the blocks · lead them out',
      stair: 'the stair core',
      stairShut: (n: number) => `Stairs shut · take ${n} more desk${n === 1 ? '' : 's'}`,
      stairOpen: 'Stairs open · bring them out',
      stairHeld: 'Clear the stairwell squad',
      stairOpened: 'The stair core is open',
      stairOpenedSub: 'bring every prisoner you can',
      desk: 'the control desk',
      deskVerb: 'take the desk',
      deskGuarded: 'Guards hold the desk · clear them',
      deskTaken: 'Desk taken',
      deskTakenSub: (side: string) => `the ${side} tiles are dead`,
      sides: { west: 'west', east: 'east', north: 'north' },
      block: 'the cell block',
      blockVerb: 'open the block',
      blockOpen: (n: number) => `${n} prisoners are out`,
      blockOpenSub: 'they follow the nearest of you',
      free: 'Free the blocks · take a desk',
      grid: 'Grid',
      gridCharging: 'the floor is charging',
      gridLive: 'the floor is live',
      gridSafe: 'the floor is quiet',
      headcount: 'Prisoners',
      headline: (n: number) => `${n} prisoners with you`,
      armed: 'a prisoner took a rifle',
      score: (n: number) => `${n} brought out`,
      scoreBonus: (n: number) => `${n} brought out — they hold the stairs`,
      scoreSub: 'up to the work floor',
    },
    'the-lift': {
      stage: 'the lift', title: 'The Lift',
      sub: 'hold the platform to the top',
      top: 'the top decks',
      ride: (m: number) => `Hold the lift · ${m} m to go`,
      cut: 'Power cut',
      cutSub: 'fight onto the landing — the breaker',
      breaker: 'the breaker',
      breakerVerb: 'reset the breaker',
      breakerHint: 'Power cut · Y at the breaker',
      restart: 'Power back',
      restartSub: 'get back aboard!',
      aboard: (s: number) => `Back aboard · ${s} s`,
      debris: 'Debris — watch the shadows',
      jumpers: 'Jet troopers above',
      breakout: 'Breakout',
      breakoutSub: 'the top decks — clear the gate',
      gateHint: 'Clear the gate squad',
      gateOpen: 'Through the gate',
      gate: 'the deck gate',
      height: 'Climb',
      landing: (n: number) => `Landing ${n}`,
    },
    'mark-runs': {
      stage: 'the rooftops', title: 'The Mark Runs',
      sub: 'the paymaster bolts — bring him in alive',
      mark: 'the mark',
      markName: 'The Paymaster',
      stair: 'the stair down',
      rack: 'the net launcher',
      // hints: the HUD line is upper-case and wraps past ~20 characters in a
      // quarter of the screen (the panel's own line says the rest)
      hintRack: 'Grab the launcher',
      hintChase: 'Keep him in reach',
      hintFork: 'Split up at the fork',
      hintEscaping: "He's getting away!",
      hintDuel: 'Wear him down',
      hintNetNow: 'Net him now!',
      hintStair: 'Take the stair down',
      // the HUD panel
      lead: (m: number) => `Lead ${m} m`,
      escaping: (s: number) => `Escaping · ${s.toFixed(1)} s`,
      bounty: 'Bounty value',
      his: 'The Paymaster',
      fight: 'Fight in him',
      nets: (n: number) => (n > 0 ? `Nets ×${n} · B / Q fires` : 'No nets · refill at a checkpoint'),
      noLauncher: 'Net launcher on the first roof',
      // banners
      armed: 'Net launcher', armedSub: 'B / Q fires a net · takes him alive',
      resupply: 'nets refilled',
      fork: 'He is choosing a way', forkSub: 'split up — he runs from the crowd',
      called: 'His pirates', calledSub: 'the next roof is waiting for you',
      kick: 'Crates!',
      sign: 'The sign!', signSub: 'he shot it loose — go over',
      escaped: 'He got away', escapedSub: 'back to the last roof — after him',
      regroup: 'Regroup', regroupSub: 'he is still out there',
      turns: 'Cornered', turnsSub: 'wear him down, then net him',
      netted: 'Netted', nettedSub: 'he is down — not for long',
      taken: (pct: number) => `Taken alive · bounty ${pct}%`,
      killed: (pct: number) => `Dead · bounty ${pct}%`,
      takenSub: 'the stair down is the way on',
      fullBounty: 'Full bounty', fullBountySub: 'rockets recharged',
    },
  },
} as const;

export type GameText = typeof TEXT;
