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
  },

  // ---------- board / territory select ----------
  boardSelect: {
    title: 'Choose Territory',
  },

  // ---------- mission (campaign) select ----------
  planets: {
    title: 'Missions',
    sub: 'Nine territories to liberate, one warlord at a time',
    hint: '<b>◀ ▶</b> travel the sector · <b>A</b>/<b>Enter</b>/<b>click</b> begin the mission · <b>B</b>/<b>Esc</b> back',
  },

  // ---------- character select ----------
  charSelect: {
    /** the standard line-up's heading */
    title: 'Choose Your Bounty Hunter',
    /** PvP's, where the roster widens to the whole cast */
    titlePvp: 'Choose Your Fighter',
    start: 'Start Game',
    hint: '<b>◀ ▶</b> switch · <b>A</b>/<b>Enter</b>/<b>click</b> select · <b>B</b>/<b>Esc</b> back · <b>right stick</b> or <b>drag</b> to turn',
    player: (n: number) => `Player ${n}`,
    join: 'Press <b>A</b> to join',
    /** the second line of the invitation, where the mode has bots */
    joinBot: 'Press <b>Y</b> for Bot',
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
    skip: 'A · drop in now',
  },

  // ---------- the VS splash ----------
  vs: {
    player: (n: number) => `P${n}`,
    bot: 'BOT',
    squad: (n: number) => ` · squad ×${n}`,
  },

  // ---------- heads-up display ----------
  hud: {
    bars: { health: 'HP', fuel: 'JET', energy: 'ENERGY', heat: 'HEAT' },
    newContact: '◢ New contact',
    newContacts: '◢ New contacts',
    /** the kicker over a boss's name card */
    lieutenant: 'Lieutenant',
    warlord: 'Warlord',
    inCover: 'IN COVER · hold aim to peek',
    firingFromCover: 'FIRING FROM COVER',
    takeCover: 'C / RB — take cover',
    rideVehicle: (name: string) => `C / RB — ride the ${name}`,
    driving: (name: string, hp: number, maxHp: number) =>
      `${name} ${hp}/${maxHp} · A gas · B brake · RB off`,
    /** a living mount is ridden, not driven: it charges, and your gun hand is free */
    riding: (name: string, hp: number, maxHp: number, charge: string) =>
      `${name} ${hp}/${maxHp} · A go · B stop · X ${charge} · RT fire · RB off`,
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
    hold: (where: string) => `hold ${where}`,
    waveOf: (n: number, of: number) => `Wave ${n} of ${of}`,
    checkpoint: 'Checkpoint',
    pushOn: (where: string) => `push on to ${where}`,
    bacta: { title: 'Bacta canister', sub: '+45 health' },
    offPath: { title: 'Off the path', sub: 'back to the last checkpoint' },
    tookYou: { title: 'The water took you', sub: 'back to the last checkpoint' },
    ceilingHit: (line: string) => line,
    ceilingSub: 'nothing flies over the rim',
    transport: (where: string) => `Making for ${where}`,
    transportSub: 'the party goes together',
    steppedOut: { title: 'Standing in the transport', sub: 'everyone aboard before it goes back' },
    lieutenantFallsMission: { title: 'The lieutenant falls', sub: 'the warlord waits at the end' },
  },

  // ---------- pause ----------
  pause: {
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
    retry: 'Retry Board',
    quit: 'Quit to Title',
    championTag: (slot: string, kills: number) => `Champion · ${slot} · ${kills} kills`,
    playerKills: (who: string, kills: number) => `<b>${who}</b> ${kills} kills`,
    /** the wave counter runs one past the last while the warlord is fought */
    warlordDown: 'warlord down',
    waveNote: (wave: number) => `wave ${wave}`,
    noteAndTime: (note: string, time: string) => ` · ${note} · ${time}`,
    time: (time: string) => ` · ${time}`,
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
    lookSensitivity: 'Look sensitivity',
    invertY: 'Invert look (Y)',
    keyboardMouse: 'Keyboard & mouse',
    back: 'Back',
    hint: 'Saved on this device. Gamepad: <b>left / right</b> to adjust.<br/>'
      + '<b>Dynamic camera</b> — the chase camera closes in when you are still and opens out when you sprint, '
      + 'dash or fly. Off, it holds the one distance the right stick dials in.<br/>'
      + '<b>Split screen</b> — which way co-op divides the window: <b>stacked</b> gives each player a wide strip, '
      + '<b>side by side</b> turns the same layout on its side. Four players get a quadrant either way.<br/>'
      + '<b>Keyboard &amp; mouse</b> — adds WASD and mouse aiming; while it is off the cursor stays free during play.',
  },

  // ---------- the corner buttons and the controls sheet ----------
  controls: {
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
      ['Wrist rocket', 'Q'],
      ['Camera distance', 'Mouse wheel'],
      ['Take cover · ground slam · mount a ride', 'C · Ctrl'],
      ['Next blade carried', '1'],
      ['Next gun carried', '2 · E'],
    ] as Array<[string, string]>,
    driving: [
      ['Mount a parked ride · get off', 'RB · C'],
      ['Accelerate', 'A · W'],
      ['Brake, then reverse', 'B · S'],
      ['Steer', 'Left stick · A · D'],
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
      rb: ['RB', 'Take cover (on ground)'],
      rbAir: ['', 'Ground slam (in air)'],
      y: ['Y', 'Wrist rocket'],
      b: ['B', 'Block — raise shield'],
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
    ventress: { name: 'Asajj Ventress', desc: 'Twin red blades and a dancer\u2019s patience \u2014 the assassin of the outer dark.' },
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
    officer: 'The darksaber does the talking.',
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
    melee: { gaffi: 'Gaffi Stick', sabers: 'Twin Sabers' },
    /** what a playable NPC's slots are called, built from its own name */
    npcRifle: (name: string) => `${name} Rifle`,
    npcBlaster: (name: string) => `${name} Blaster`,
    npcClaws: 'Claws & Steel',
    npcRifleButt: 'Rifle Butt',
  },

  // ---------- boards, as the territory select and the drop screen name them ----------
  //
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
      refinery: 'The Darksaber Officer',
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
    desert: ['the trailhead flats', 'the dune road', 'the ravine', 'the cistern approach', 'the cistern court', 'the fighting pit', 'the dune gate', 'the caravan graves', "the Old One's hollow"],
    station: ['the docking bay', 'the cargo gantries', 'the outer yard', 'the spice vault', 'the loading gantry', 'the crew catwalks', 'the reactor ring', 'the hold of the prize'],
    nevarro: ['the ash flats', 'the crust causeway', 'the town gate', 'the garrison yard', 'the magistrate court', 'the crossing', 'the cantina row', 'the rancor pen'],
    crevasse: ['the rim shelf', 'the frozen gallery', 'the nest mouth', 'the queen tunnel', 'the hatchery', 'the cracked lake', 'the ice chimney', 'the breaker deep'],
    trask: ['the quay steps', 'the fish market', 'the net lofts', 'the freighter hold', 'the cold stores', 'the trawler deck', 'the pier heads', 'the mamacore pool'],
    refinery: ['the tanker yard', 'the pipe run', 'the intake ramp', 'the barrel stores', 'the reactor floor', 'the pump hall', 'the reactor crown', 'the loading field'],
    forge: ['the glassed plain', 'the glass highway', 'the shattered gate', 'the dome undercroft', 'the armoury vault', 'the glassed court', 'the forge steps', "the sleeper's basin"],
    ringworld: ['the tram stop', 'the market arcade', 'the night-side row', 'the terminus', 'the sentinel walk', 'the plaza', 'the service spine', 'the high street terrace'],
    narkina: ['the landing deck', 'the gantry run', 'the kelp forest', 'the moon pool shaft', 'the work floor', 'the supervisor deck', 'the assembly deck', 'the discharge gantry', 'the moon pool deck'],
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
      trask: ['the harbour'],
      refinery: ['the yard', 'the plant', 'the loading field'],
      forge: ['the plain', 'the undercroft', 'the dome'],
      ringworld: ['the high street'],
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
    bringDownLieutenant: 'Bring down the lieutenant',
    bringDownWarlord: 'Bring down the warlord',
    pushThrough: (where: string, metres: number) => `Push through ${where} · ${metres} m`,
    ride: (where: string, metres: number) => `Ride for ${where} · ${metres} m`,
    clearTheWay: 'Break through the barricade',
    /** the transport door, and the wait to go back through one */
    boarding: (where: string) => `Transport · ${where}`,
    exited: 'You have exited · B to cancel',
    waitingOn: (name: string, n: number) => `${name} has stepped out — waiting on ${n} more`,
    arrivedAt: (where: string) => `Arrived · ${where}`,
  },
} as const;

export type GameText = typeof TEXT;
