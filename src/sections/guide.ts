import type { SectionId } from '../world/mission';

/**
 * The pause menu's "how this section works" page: one card per gameplay
 * section, for a player who is stuck. Every line is written against the
 * section's own rules in `src/sections/<id>.ts` and uses the in-game names
 * from `TEXT.sections[id]` — change a rule there, change its line here.
 *
 * Controls are named pad-first, keyboard second (Y · C, RT · left mouse…).
 */
export interface SectionGuide { title: string; goal: string; steps: string[]; tips: string[]; }

export const SECTION_GUIDE: Record<SectionId, SectionGuide> = {
  'barge-run': {
    title: 'The Barge Run',
    goal: 'Board the sail barge, burn both Tusken skiffs with its heavy gun, and kill the helmsman.',
    steps: [
      'Get aboard the skiff. She casts off once everyone is on (or shortly after the first of you).',
      'In the broadside, shoot the gunner on the barge\'s upper deck: while he lives, shells keep coming.',
      'A shell lands where its red ring is, a second and a half after the ring appears. Step out of it.',
      'When the skiff closes in, cross the planks or jump across, then clear the cargo deck. Two waves.',
      'Up top, man the heavy gun (Y · C), burn both Tusken skiffs, then kill the helmsman.',
    ],
    tips: [
      'Y · C mans the skiff\'s deck gun. Left empty, it fires on its own at half rate. Mind the heat bar.',
      'The Skiff bar is her hull. If it empties she breaks up and the broadside starts again on a fresh one.',
      'Fall to the sand or go down and you come back on the skiff\'s deck.',
    ],
  },

  'worm-sign': {
    title: 'Worm Sign',
    goal: 'Cross worm country island to island and reach the pit rim.',
    steps: [
      'Rock is silent, sand is not. Walking, sprinting, shooting and jetting on sand all fill your Noise bar.',
      'Everyone\'s noise adds up to the Worm bar. When it fills, the worm comes for the loudest body on sand.',
      'A ring of rippling sand under you is worm sign. Get onto rock before it closes. It follows you.',
      'Hold Y · C at a thumper post to pull it, then hold Y · C on open sand to plant it.',
      'A planted thumper holds the worm for about fifteen seconds. Run the open sand while it pounds.',
    ],
    tips: [
      'If everyone is on rock when the worm is hungry, it circles. Wait for the meters to drain.',
      'Carrying a thumper fills your hands: no gun, no blade, no shield until you plant it.',
      'Blades are quiet, blasters are loud. The camps\' own fire makes you louder on the sand.',
      'The fallen come back on the furthest checkpoint island reached. A dropped thumper returns to its post.',
    ],
  },

  'frigate-guns': {
    title: 'Guns of the Frigate',
    goal: 'Hold the frigate through four waves and the pirate corvette, then drop down the forward hatch.',
    steps: [
      'Man a quad gun with Y · C. RT · left mouse fires, Y · C steps off. The radar calls each contact\'s bearing.',
      'The guns cannot aim down at the deck. When a boarding tube latches, someone has to leave a gun.',
      'Cut the boarding latch with melee or a rocket. Bolts spark off it, and while it holds it drains the hull.',
      'The corvette: shoot out its three shield domes, then its bridge. A manned gun hits them hardest.',
      'When she docks, the forward hatch opens. Drop into it.',
    ],
    tips: [
      'A red line across the deck means the spinal gun. You have 2.5 s to get off it, gunners included.',
      'If the hull bar empties, the wave starts again with the hull as it was when that wave began.',
      'Over the side is the void. Fall or go down and you come back up through the nearest hatch.',
      'An empty gun fires on its own, but it barely scratches armour and locks onto boarders it cannot hit.',
    ],
  },

  'ring-walk': {
    title: 'The Ring Walk',
    goal: 'Walk a quarter of the station\'s outer ring and reach the crew airlock.',
    steps: [
      'One camera holds the whole party. On a pad the right stick points your gun. Keep up with the shot.',
      'Vent run: a grate glows red before it fires plasma. Cross between bursts. Jump the missing plates.',
      'At each lock the camera stops and a fence goes up. Clear every wave to move on.',
      'At the spoke junction, a gun hatch rises out of the hull. Shoot its open eye or club it shut.',
      'Sensor booms sweep at knee height. Jump the beam or keep the conduit between you and the boom.',
    ],
    tips: [
      'Gravity is 0.45 g here. Jumps carry a long way.',
      'A boom that catches you calls drones up over the hull\'s edge.',
      'Off the edge is the void. You re-form at the last rail gate, or at the back of the shot.',
    ],
  },

  'magma-run': {
    title: 'The Magma Run',
    goal: 'Steal a bike, ride two kilometres of lava river, sink the gun barge, and pull up at the landing.',
    steps: [
      'Press Y · C at a moored bike to take it. The crew gives chase the moment one goes.',
      'The stick sets your line in the lane and your speed. Pull back to slow. LB boosts, A hops.',
      'RT · left mouse fires the nose cannons. X · F swings at a rider alongside and knocks him into the lava.',
      'A cracking column falls across the river. Geysers glow before they erupt. At the falls, jump the lip.',
      'At the chamber mouth, sink the gun barge: kill the gunner and helmsman or all the crew, or ram it.',
    ],
    tips: [
      'A teammate can mount your bike as pillion and work the weapons while you drive.',
      'RB raises the ride\'s deflector shield, drawing on your shield gauge.',
      'Lose your bike on the lava and you get a fresh one at the last gate. On crust, you get one where you stand.',
      'The run ends once the barge is gone and every living hunter is standing on the landing.',
      'If everyone goes down, the party re-forms at the last gate and that stretch plays again.',
    ],
  },

  chimney: {
    title: 'The Chimney',
    goal: 'Climb the flooding shaft floor by floor and get out over the chimney lip.',
    steps: [
      'Each floor has one hole up, under a shut shutter. Find the valve on your floor.',
      'Hold Y · C at the valve for four seconds (three alone). The shutter above opens and the magma pauses.',
      'Cross the floor, through its squad, to the hole on the far side, and climb to the next floor.',
      'The top valve surges the vent as it opens the lip. Go straight up.',
    ],
    tips: [
      'Within six metres of the magma the heat stops a jetpack refilling. Rest on the wall ledges, higher up.',
      'A shadow on the floor under a hole is a boulder about to land. Step clear.',
      'The fallen come back on the highest safe floor or ledge. If everyone goes down, the magma drops back.',
      'Two hunters holding one valve turn it faster. Letting go only drains it a little.',
    ],
  },

  'glacier-chute': {
    title: 'The Glacier Chute',
    goal: 'Slide the chute to the snowbank at the bottom, ahead of the avalanche.',
    steps: [
      'Walk into the tunnel. The floor gives way and you are sliding.',
      'Steer with the stick. Pull back to dig in, which slows you but never stops you.',
      'Jump the crevasses. At the fork, left is short with big jumps and right is long with spiders.',
      'Webs in the lane slow you. Shoot them, or kick them with the slide kick (X · F).',
      'Ride into the snowbank and regroup. The run ends when every hunter still standing is down; the fallen come back with you.',
    ],
    tips: [
      'The avalanche gains on anyone who stalls. If it catches you, you are dug out at a gate further down.',
      'Fall down a crevasse and you are hauled out at the next flag gate. You never go back uphill.',
      'Sliding into a body at speed hurts you both. Clear the lane ahead.',
    ],
  },

  lamplight: {
    title: 'Lamplight',
    goal: 'Light all three braziers in each chamber and get through the burning web to the queen tunnel.',
    steps: [
      'The brood fears your helmet lamp. You see what you point at.',
      'Hold aim (LT · right mouse) to focus the beam. A spider held in it is dazzled and takes double damage.',
      'Hold Y · C at a brazier to light it. Its pool of light keeps the brood out and becomes your checkpoint.',
      'Light all three in a chamber and the webs on the way on shrink back.',
      'The last brazier sets the web wall burning. Hold the lit chamber against the whole brood until it opens.',
    ],
    tips: [
      'Stay dark too long without lighting a brazier and the brood grows bold. Light one to push them back.',
      'B · Q throws a flare, a red light that burns for twenty seconds, instead of a rocket.',
      'The focused beam runs on a battery that recharges when you let go of aim.',
      'The fallen re-form at the last lit brazier.',
    ],
  },

  squall: {
    title: 'The Squall',
    goal: 'Hold the trawler\'s deck through three waves of boarders, then step ashore on the far pier.',
    steps: [
      'The deck rolls on the swell, and loose bodies and fuel barrels drift toward the low side.',
      'Rogue wave: five seconds of horn. Tap Y · C at a rail, winch, crate or the deckhouse wall to brace.',
      'Green water washes anyone unbraced over the far rail. Boarders too, so a wave can fight for you.',
      'From the second wave, the net boom swings loose across the after deck, and lightning hits the mast.',
      'After the third wave the trawler comes alongside. Step through the starboard gate onto the pier.',
    ],
    tips: [
      'The deckhouse roof and the air are safe from green water. So is the deckhouse\'s lee.',
      'When the mast crackles blue, get off the deckhouse roof. The strike hits whoever is up there.',
      'Over the side costs a little health and puts you back on the deckhouse roof.',
      'If everyone goes down, the wave in progress starts again after a breather.',
    ],
  },

  'run-the-pier': {
    title: 'Run the Pier',
    goal: 'Outrun the mamacore down six hundred metres of pier and get through the pier heads door.',
    steps: [
      'Run at the camera. The mamacore eats the pier behind you, a little faster than you run.',
      'Sprint (LB · Shift) to gain ground, but the sprint gauge runs out. Hop or go round the crates and racks.',
      'Time the crane\'s swinging load, which knocks you back. Jump the gaps, and jet or leap the collapsed pier.',
      'Quarren surface in the lane. Dash into one to shoulder it flat.',
      'Run through the warehouse, then through the pier heads door at the end.',
    ],
    tips: [
      'Pour fire into its mouth. Enough damage staggers it and drops it back. It buys the others time.',
      'Caught, you are dragged under and re-form at the front a moment later, short on health.',
      'Only when everyone is caught does the pier reset, back to the last gate.',
      'Reaching a gate gives you two seconds it will not take you.',
    ],
  },

  'the-line': {
    title: 'The Line',
    goal: 'Ride the processing line past the presses and the smelter, open the plant door, and get through it.',
    steps: [
      'The belts carry you toward the smelter at different speeds. Crates are cover. Barrels explode.',
      'Presses slam each belt\'s opening. A hiss and a red strip warn you a second before. Pass when it\'s up.',
      'Welding arms turn full circle at head height over the belts. Time them, fly over, or walk the floor lanes.',
      'At the slag pit, get off the belts onto the door deck, the only ground left.',
      'Hold Y · C at the door release for four seconds (three alone). A squad drops in halfway: hold on.',
    ],
    tips: [
      'Hold Y · C at a catwalk belt switch to brake the machines ahead: 15 s (25 alone). Never required.',
      'A press that catches you hurts and throws you back upstream on the belt.',
      'Ride into the smelter or drop into the slag pit and you re-form at the last station reached.',
    ],
  },

  'lights-out': {
    title: 'Lights Out',
    goal: 'Cross the tank farm unseen and climb the lit stair to the top of the reactor crown.',
    steps: [
      'Searchlights and sensor beams fill your Seen bar. So does noise near a trooper. Full means the alarm.',
      'Melee a trooper from behind before he clocks you: a silent takedown, one blow.',
      'A trooper who sees you starts radioing. Kill him before the Radioing bar fills.',
      'Hold Y · C at the control booth to kill the searchlights for ten seconds. It needs twenty to recharge.',
      'Take the stair guards, or kill the lights and run it. Climb to the top of the crown.',
    ],
    tips: [
      'The alarm is not a fail. It seals the lanes, raises turrets and calls a drop.',
      'Kill the drop, then hold Y · C at an alarm console for three seconds to put the yard back in the dark.',
      'If the drop cannot be finished, the consoles work anyway 45 seconds after the alarm.',
      'Venting steam blocks the beams and swallows noise while it blows.',
      'The fallen come back at the last dark corner the party reached.',
    ],
  },

  'hold-the-forge': {
    title: 'Hold the Forge',
    goal: 'Keep the Armorer working until the forging is full and the Alamite Chieftain is down.',
    steps: [
      'Before the first wave, hold Y · C at the sockets round the dais to raise beskar shields. Three can stand.',
      'The forging stalls while any hostile is within six metres of the Armorer. Fight at the dais.',
      'Waves come down the north, east and west tunnels. The tunnel burns red just before they come.',
      'A hostile at a bellows breaks it and halves the forging. Hold Y · C there to mend it.',
      'The last wave brings the chieftain. Kill him, then gather on the dais under the shaft.',
    ],
    tips: [
      'It cannot be lost. If the Armorer falls, the forging slips back to its last quarter and she rises.',
      'Raising a fourth shield folds the oldest one. Put them where the tunnels are.',
      'A raised shield is cover: press Y · C behind it to put your back to it.',
      'Reward: beskar for each of you, +25 max health for the rest of the run.',
      'The fallen re-form on the dais.',
    ],
  },

  'covert-sky': {
    title: 'Covert Sky',
    goal: 'Fly the rings across the city, silence all three flak guns, and dive through the breach.',
    steps: [
      'Hold A · Space to fly. It never runs dry. Let go to glide. LB · Shift boosts, Y · C dives.',
      'Fly through each ring for a checkpoint and a boost. Rings past a live flak gun stay dark.',
      'A flak screen blocks the sky past each gun. Silence the gun on its tower first.',
      'Land on the gun\'s stone slab and hold Y · C at the glowing mark for three seconds to plant a charge, then clear off.',
      'Once the last gun is down, the breach opens. Dive into the dome through it.',
    ],
    tips: [
      'Two rockets into a gun\'s breech (B · Q) also silence it. Blaster bolts do nothing to it.',
      'Cross a live flak screen and it hurts you and throws you back a ring.',
      'Sink below the rooftops and the updraft throws you back up at the last ring.',
      'Everyone flies here. Super-jumpers are fitted with the same boosters.',
    ],
  },

  'tram-top': {
    title: 'Tram Top',
    goal: 'Ride the tram roof to the terminus and go through the terminus gate.',
    steps: [
      'Get the whole party aboard. The tram leaves only when everyone is on.',
      'Gantry: a horn and a red lamp three seconds out. Hold Y · C to duck, or jump it.',
      'At the station, hold the doors for thirty seconds while a squad boards and snipers work the canopy.',
      'Tunnel: one metre of clearance. Drop through the roof hatches, fight inside, climb back up after.',
      'Pirate tram: jump across and clear its gunners, or shoot out its coupling once it is alongside and lit. Then off at the terminus.',
    ],
    tips: [
      'On the flank camera the stick is turned to the screen. Stick right runs along the train.',
      'Swept or knocked off, you re-form on the rear car\'s roof, or inside it if the roof is not safe.',
      'Still on the pirate tram when it peels off? You are put back aboard.',
      'Anything standing when a gantry passes is swept off, pirates included.',
    ],
  },

  'mark-runs': {
    title: 'The Mark Runs',
    goal: 'Chase the Paymaster across the rooftops, take him on the landing pad, and take the stair down.',
    steps: [
      'Grab the net launcher on the first roof. B · Q fires a net. You carry three.',
      'Keep him in reach. Drop too far behind for too long and he escapes back to the last checkpoint roof.',
      'At a fork he takes the way with the fewest hunters on it. Split up.',
      'On the pad he turns and fights. Wear him under half, then net him, or beat him down with melee.',
      'Once he is taken, the stair down is the way on.',
    ],
    tips: [
      'Blaster hits stagger him but cost bounty, at any range. Melee blows and nets are free. Nets stop him longest.',
      'Shoot him dead and it still counts, at half the bounty. Take him alive at 85% or more for a rocket recharge.',
      'Nets refill at checkpoint roofs, at the resupply crates, and every time you respawn.',
      'Fall off and you re-form on the most advanced roof a hunter stands on.',
    ],
  },

  'one-way-out': {
    title: 'One Way Out',
    goal: 'Take the control desks to open the stair core, then lead the prisoners out through it.',
    steps: [
      'Tiles flash for a second and a half before going live. Live tiles hit hard. The Grid bar warns you.',
      'Hold Y · C at a block\'s release panel to free its prisoners. They follow the nearest of you.',
      'Climb to a gantry, clear the guards near its control desk, and hold Y · C there. That third goes dead.',
      'Two desks down (one alone) opens the stair core. The floor still live overloads.',
      'Clear the stairwell squad and step into the stair core. Everyone with you then counts.',
    ],
    tips: [
      'Prisoners will not step onto a charging or live tile. Walk them across, don\'t fly, or they stay behind.',
      'A downed guard drops his rifle, and an empty-handed prisoner runs to pick it up.',
      'Prisoners who die are gone. You re-form beside a teammate, or at the pool if nobody is standing.',
      'Prisoners are optional: you can leave with none. Bring ten or more and they hold the stairs, so the supervisor deck\'s lieutenant calls for backup and nobody comes.',
    ],
  },

  'the-lift': {
    title: 'The Lift',
    goal: 'Hold the lift platform to the top decks, clear the gate squad, and go through the deck gate.',
    steps: [
      'Fight off guards on the landings and jet troopers dropping in from above.',
      'A shadow on the deck means debris is coming down. Step out of it.',
      'Power cut: fight onto the landing and hold Y · C at the breaker for four seconds (three alone).',
      'Power back: get back aboard within five seconds.',
      'At the top, clear the gate squad and go through the deck gate.',
    ],
    tips: [
      'Left behind on a landing? After the five seconds you are put back on the platform. No other cost.',
      'The platform is the checkpoint. The fallen always come back on it.',
      'The far side and the landing side have no rail. Mind the gap when you cross to a landing.',
    ],
  },
};
