/**
 * Generate the game's sound effects with the ElevenLabs sound-generation API.
 *
 * Usage:  ELEVENLABS_API_KEY=... node tools/generate-sfx.mjs [name ...]
 *
 * Writes public/assets/audio/<name>.mp3 for every sample the audio engine
 * consumes (see SampleName in src/core/audio.ts). Existing files are skipped
 * unless names are passed explicitly. Never commit an API key to this file.
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';

// Key comes from the env or from an untracked local file (.elevenlabs_key,
// listed in .gitignore) — never hardcode it here.
let KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  const keyFile = new URL('../.elevenlabs_key', import.meta.url).pathname;
  if (existsSync(keyFile)) KEY = readFileSync(keyFile, 'utf8').trim();
}
if (!KEY) {
  console.error('Set ELEVENLABS_API_KEY or create .elevenlabs_key');
  process.exit(1);
}

const OUT = new URL('../public/assets/audio/', import.meta.url).pathname;

// name -> [prompt, durationSeconds, loop]
const SFX = {
  blaster_shot: ['Sci-fi laser blaster single shot: sharp percussive attack, fast descending pitch zap, slight metallic ring tail, punchy, retro space western character, single shot only', 0.7],
  enemy_blaster: ['Sci-fi enemy blaster single shot, lower and rounder than a hero blaster: hollow low pulse zap, slightly detuned, single shot only', 0.7],
  blaster_impact: ['Small energy bolt impact on rock and metal: short crackle spark burst, bright transient with tiny debris fizz, single impact', 0.6],
  melee_whoosh: ['Heavy metal staff swing whoosh, low airy sweep, fast, single swing, no impact', 0.6],
  melee_hit: ['Blunt heavy melee staff impact on armor: deep thud with metallic clank overtone, satisfying crunch, single hit', 0.6],
  // hunter roster signature weapons
  crossbow_shot: ['Sci-fi energy crossbow single shot: taut string release snap into a bright short bolt zap, twangy, single shot only', 0.7],
  pistol_shot: ['Sci-fi heavy blaster pistol single shot: sharp dry crack with a fast high zap and almost no tail, quick-draw snap, single shot only', 0.6],
  longrifle_shot: ['Long-barrelled sci-fi hunting rifle single shot: heavy deep percussive report, slower descending zap with low barrel resonance tail, single shot only', 0.9],
  saber_swing: ['Energy sword swing: smooth tonal hum sweeping with fast doppler, electric harmonic edge, no air whoosh, single swing, no impact', 0.7],
  saber_ignite: ['Twin energy blades igniting: sharp crackle snap into a fast rising hum that settles into a steady tone, single ignition', 0.8],
  saber_deflect: ['Energy blade parrying a blaster bolt: short bright metallic ping with an electric crackle and a fast sizzling tail, dry, no reverb', 0.5],
  boss_horn: ['Massive dark war horn call announcing a boss battle: deep brassy swell rising over two seconds into a huge percussive orchestral hit with a low drum boom, cinematic, dry tail', 3],
  saber_hum: ['Steady energy blade idle hum: low warm electrical drone with a slow beating pulse and faint high harmonic shimmer, constant level, no swings, no crackle, seamless continuous loop', 4, true],
  rocket_launch: ['Small missile launching from a shoulder rack: pressurized whoosh ignition then rising rocket hiss, single launch', 1.0],
  explosion: ['Medium sci-fi explosion: deep sub thump, fiery crackle body, metallic debris tail, single explosion', 1.5],
  hit_marker: ['Tiny arcade videogame hit confirm tick: single bright very short click blip, subtle, dry', 0.5],
  kill_confirm: ['Short arcade kill confirm sound: two-note descending metallic blip, understated, dry', 0.6],
  player_hurt: ['Muffled pained grunt of a man inside a helmet, short, no words', 0.6],
  // ---- playable character voices ----
  // One family per species, three hurt takes each so a firefight does not
  // repeat one sound, plus a death cry. Nothing here is shared between
  // families: the droid has no throat, and the reptile does not yelp.
  hurt_mando_m_1: ['Short muffled pained grunt of a man inside a sealed helmet, sharp exhale, no words, single grunt', 0.6],
  hurt_mando_m_2: ['Short muffled winded grunt of a man inside a sealed helmet, lower and heavier, no words, single grunt', 0.6],
  hurt_mando_m_3: ['Short muffled clipped grunt of a man inside a sealed helmet, teeth-gritted, no words, single grunt', 0.6],
  death_mando_m: ['Dying groan of a man inside a sealed helmet, breath failing into a rattling exhale, no words', 1.4],
  hurt_mando_f_1: ['Short muffled pained grunt of a woman inside a sealed helmet, sharp exhale, no words, single grunt', 0.6],
  hurt_mando_f_2: ['Short muffled winded gasp of a woman inside a sealed helmet, no words, single grunt', 0.6],
  hurt_mando_f_3: ['Short muffled clipped grunt of a woman inside a sealed helmet, teeth-gritted, no words, single grunt', 0.6],
  death_mando_f: ['Dying groan of a woman inside a sealed helmet, breath failing into a rattling exhale, no words', 1.4],
  hurt_human_f_1: ['Short sharp pained gasp of a woman taking a hit, unmasked and close, no words, single gasp', 0.6],
  hurt_human_f_2: ['Short pained grunt of a woman taking a body blow, winded, unmasked, no words, single grunt', 0.6],
  hurt_human_f_3: ['Short hissed pained intake of breath through clenched teeth, woman, unmasked, no words', 0.6],
  death_human_f: ['Dying cry of a woman, short falling wail collapsing into a last breath, unmasked, no words', 1.4],
  hurt_masked_1: ['Short pained grunt filtered through a heavy rebreather mask, valve hiss on the exhale, no words', 0.6],
  hurt_masked_2: ['Short muffled winded grunt behind a slatted breathing mask, air hissing through the filter, no words', 0.6],
  hurt_masked_3: ['Short clipped pained huff through a rebreather mask, mechanical air rasp, no words', 0.6],
  death_masked: ['Dying groan through a rebreather mask, breath failing as the filter hisses empty, no words', 1.4],
  hurt_reptile_1: ['Short pained snarl of a large reptilian creature, wet hiss with a guttural rasp, no words', 0.6],
  hurt_reptile_2: ['Short angry reptilian hiss of pain, sharp and spitting, no words', 0.6],
  hurt_reptile_3: ['Short low reptilian grunt of pain, throaty rumble ending in a hiss, no words', 0.6],
  death_reptile: ['Dying reptilian snarl, guttural roar collapsing into a long wet hiss, no words', 1.5],
  hurt_droid_1: ['Droid taking a hit: sharp electrical crackle with a servo motor stutter and a metallic clank, no voice', 0.6],
  hurt_droid_2: ['Droid damaged: brief buzzing short circuit and grinding actuator jolt, metallic, no voice', 0.6],
  hurt_droid_3: ['Droid struck: quick spark burst with a pitch-bent servo whine, metallic rattle, no voice', 0.6],
  death_droid: ['Droid destroyed: descending servo whine into sparking electrical fizzle and collapsing metal, power fading out, no voice', 1.6],
  hurt_alien_m_1: ['Short gravelly pained grunt of an alien man, dry rasping voice, no words, single grunt', 0.6],
  hurt_alien_m_2: ['Short low growled grunt of pain, gravelly alien male voice, winded, no words', 0.6],
  hurt_alien_m_3: ['Short sharp rasping hiss of pain, gravelly alien male voice, no words', 0.6],
  death_alien_m: ['Dying groan of a gravelly alien man, rasping growl falling away into silence, no words', 1.4],
  jetpack_loop: ['Jetpack thruster flame loop: tight roaring flame jet, filtered noise core with low turbine whine, steady continuous seamless loop', 2.0, true],
  dash: ['Short burst thruster dash: quick doppler whoosh with flame crackle, single burst', 0.6],
  land_hard: ['Armored boots heavy landing on ground, two-stage armored slam thump with dust, single landing', 0.6],
  ui_move: ['Minimal videogame UI navigation blip, single soft dry click tick, very short', 0.5],
  ui_confirm: ['Videogame UI confirm sound: warm two-tone mechanical latch chirp, short', 0.5],
  ui_back: ['Videogame UI back cancel sound: single low soft thunk, very short', 0.5],
  wave_start: ['Low alien war horn blast announcing an enemy wave, short, with metallic edge, ominous', 1.2],
  wave_clear: ['Positive wave-cleared fanfare sting, three ascending dark brass notes, restrained, short', 1.5],
  // movement extras
  jetpack_ignite: ['Jetpack ignition burst: sharp pressurized whump into flame roar onset, single short burst', 0.5],
  land_soft: ['Armored boots soft landing on packed sand, light crunch thump, single landing', 0.5],
  footstep_sand: ['Single armored boot footstep on packed desert sand, dry crunch, very short, one step only', 0.5],
  footstep_metal: ['Single armored boot footstep on hollow steel deck plate, dull clank, very short, one step only', 0.5],
  // enemy voices (original creature/character voices, no real-world references)
  tusken_cry: ['Aggressive alien desert nomad war cry: hoarse braying howl through a breathing mask, original creature voice', 1.0],
  pyke_chatter: ['Alien gangster radio chatter: burbling filtered vocalization through a rebreather, gurgly and nasal, short phrase, invented alien language', 0.8],
  pyke_death: ['Alien gangster defeated: short gurgling slump groan through a rebreather, original creature voice', 0.7],
  pirate_taunt: ['Gravelly alien pirate taunt bark, guttural growl-shout, short, invented alien language', 0.7],
  pirate_death: ['Gravelly alien pirate short death groan cut off abruptly', 0.6],
  droid_death: ['Robot destruction power-down: descending servo whine into sparking electrical fizzle and metal collapse', 1.0],
  // War massiff: a two-metre armoured quadruped predator, not a hound — the
  // voice has to come from a big chest, low and slow, or it reads as a dog
  massiff_growl: ['Huge armoured reptilian war beast snarl: chest-deep guttural growl building into a wet ragged bark, enormous lungs, slow and heavy, threatening, original creature voice, no dog yelps', 1.2],
  massiff_yelp: ['Huge armoured reptilian war beast death cry: pained roar dropping into a gurgling rattle and a heavy final exhale, enormous body, original creature voice', 1.2],
  swoop_pass: ['Fast hover bike flyby with doppler effect: whining repulsor engine sweep passing close', 1.0],
  imperial_bark: ['Soldier voice through a helmet radio filter shouting a short muffled command, clipped static edge, unintelligible', 0.7],
  imperial_death: ['Soldier death cry through a helmet radio filter, short, cut off with static', 0.6],
  // ---- the six new boards + the Prison Rig ----
  // Briefs are the canonical ones from docs/ASSETS_AUDIO.md; durations and the
  // loop flag are the only thing added here.
  thunder_crack: ['Close thunder crack rolling off into a long rumble', 3],
  geyser_blast: ['Volcanic steam geyser eruption: pressurized blast into a roaring column', 1.5],
  alarm_klaxon: ['Industrial two-tone alarm klaxon, one cycle, harsh and metallic', 0.9],
  ice_crack: ['Thick lake ice splitting: sharp crack then a deep resonant groan', 1.2],
  flame_burst: ['Flamethrower burst: ignition whump into a sustained roaring jet', 1.6],
  mythosaur_call: ['Colossal creature call from deep underwater, mournful sub-bass bellow, heavily muffled, felt more than heard', 4],
  splash_in: ['Armored body plunging into sea water: deep whump and spray, single splash', 0.9],
  splash_out: ['Water shedding off a surfacing body, light splash and drips', 0.7],
  mamacore_roar: ['Huge aquatic predator roar breaking the surface: wet bellow with a gurgling snap', 1.6],
  floor_charge: ['Electrical floor plate charging up: rising capacitor whine over a building hum', 1.1],
  // variation sets — the picker in audio.ts chooses among whichever landed
  footstep_sand_1: ['Single armored boot footstep on packed desert sand, dry crunch, very short, one step only', 0.5],
  footstep_sand_2: ['Single armored boot footstep on loose dry sand, softer scuffing crunch, very short, one step only', 0.5],
  footstep_sand_3: ['Single armored boot footstep on gritty sand over rock, crisp crunch with a faint grind, very short, one step only', 0.5],
  footstep_sand_4: ['Single armored boot footstep landing heavily in sand, deeper compacted crunch, very short, one step only', 0.5],
  footstep_metal_1: ['Single armored boot footstep on hollow steel deck plate, dull clank, very short, one step only', 0.5],
  footstep_metal_2: ['Single armored boot footstep on steel decking, brighter ringing clank, very short, one step only', 0.5],
  footstep_metal_3: ['Single armored boot footstep on loose metal grating, rattling clank, very short, one step only', 0.5],
  footstep_metal_4: ['Single armored boot footstep landing heavily on steel plate, deep resonant thud with a metallic ring, very short, one step only', 0.5],
  melee_whoosh_1: ['Heavy metal staff swing whoosh, low airy sweep, quick and light, single swing, no impact', 0.6],
  melee_whoosh_2: ['Heavy metal staff swing whoosh, stronger low air sweep with more weight behind it, single swing, no impact', 0.6],
  melee_whoosh_3: ['Heavy metal staff swing whoosh, hardest full-force sweep ending with a weighty grunt of effort, no words, single swing, no impact', 0.9],
  footstep_snow: ['Single armored footstep in dry packed snow, crisp crunch, one step only', 0.5],
  footstep_stone: ['Single armored footstep on solid volcanic stone, hard mineral tap with slight grit, one step only', 0.5],
  // new-board voices (original creature voices, no real-world references)
  spider_chitter: ['Large insectoid spider vocalization: rapid chitinous clicking rising to a hiss, unsettling, original creature voice', 1.1],
  quarren_bark: ['Gruff aquatic alien shout, wet gurgling undertone, aggressive challenge, invented alien language, no real words', 1.0],
  alamite_shriek: ['Feral humanoid cave-creature shriek, raspy and echoing, original creature voice', 1.0],
  drone_whine: ['Small aggressive drone spinning up: rising servo whine into an overdriven scream, piercing', 1.3],
  // vehicles
  speeder_loop: ['Repulsorlift speeder engine loop: steady turbine whine over a low hovering thrum, constant level, seamless continuous loop', 3, true],
  speeder_ignite: ['Repulsorlift speeder starting up: rising turbine spin-up with a pressurized whoosh, single start', 0.8],

  // ambience beds (seamless loops)
  amb_desert: ['Desert planet ambience: dry wind over open dunes, sparse distant sand hiss, lonely and vast, seamless continuous loop, no music', 18, true],
  amb_lava: ['Volcanic plain ambience: deep magma rumble, distant gas vents hissing, occasional rock pops and settling gravel, dry wind, seamless continuous loop, no music', 18, true],
  amb_ice: ['Glacial canyon ambience: thin whistling wind, deep distant ice groans and settling cracks, faint snow hiss, empty and cold, seamless continuous loop, no music', 18, true],
  amb_rain: ['Harbour storm ambience: steady heavy rain on metal decking, gusting wind, waves slapping pilings, creaking moored boats, distant gulls, seamless continuous loop, no music', 18, true],
  amb_refinery: ['Industrial plant interior ambience: deep machinery drone, cycling pumps, steam hisses, metallic clanks echoing in a large hall, seamless continuous loop, no music', 18, true],
  amb_forge: ['Dead-world ambience: hollow wind over glass dunes, faint electrical crackle on the horizon, occasional deep sub-bass earth groan, desolate, seamless continuous loop, no music', 18, true],
  amb_city: ['Quiet alien city-street ambience: low crowd murmur behind walls, neon buzz, distant tram hum, occasional door hiss, night-city calm, seamless continuous loop, no music', 18, true],
  amb_sea: ['Open-ocean facility ambience: steady sea swell against metal pylons, empty wind, faint sterile facility hum, distant intercom chime, seamless continuous loop, no music', 18, true],
  amb_station: ['Space station exterior ambience: deep hull hum, distant machinery clunks, occasional pressure hiss, cold industrial, seamless continuous loop, no music', 18, true],
  // music loops & stings
  music_title: ['Dark space western title theme: slow lone twangy electric guitar motif over a deep drone and sparse tribal percussion, moody mythic bounty hunter mood, instrumental, seamless loop', 20, true],
  music_combat_desert: ['Driving mid tempo desert western combat music: tribal drums, low staccato strings, brass stabs, tense and heroic, instrumental, seamless loop', 20, true],
  music_combat_station: ['Driving industrial sci-fi combat music: pulsing synth bass, metallic percussion, tense strings, dark noir energy, instrumental, seamless loop', 20, true],
  music_victory: ['Short triumphant dark western victory fanfare, brass and drums, resolving upward, instrumental sting', 6],
  music_defeat: ['Short somber defeat sting, low mournful brass and a fading drum hit, instrumental', 5],
};

await mkdir(OUT, { recursive: true });
const only = process.argv.slice(2);
let failures = 0;

for (const [name, [prompt, seconds, loop]] of Object.entries(SFX)) {
  if (only.length && !only.includes(name)) continue;
  const path = `${OUT}${name}.mp3`;
  if (!only.length && existsSync(path)) { console.log(`skip ${name} (exists)`); continue; }
  const body = { text: prompt, duration_seconds: seconds, prompt_influence: 0.6 };
  if (loop) body.loop = true;
  const res = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`FAIL ${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    failures++;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  console.log(`ok   ${name}.mp3  ${(buf.length / 1024).toFixed(0)} KB`);
}
process.exit(failures ? 1 : 0);
