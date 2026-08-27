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
  rocket_launch: ['Small missile launching from a shoulder rack: pressurized whoosh ignition then rising rocket hiss, single launch', 1.0],
  explosion: ['Medium sci-fi explosion: deep sub thump, fiery crackle body, metallic debris tail, single explosion', 1.5],
  hit_marker: ['Tiny arcade videogame hit confirm tick: single bright very short click blip, subtle, dry', 0.5],
  kill_confirm: ['Short arcade kill confirm sound: two-note descending metallic blip, understated, dry', 0.6],
  player_hurt: ['Muffled pained grunt of a man inside a helmet, short, no words', 0.6],
  jetpack_loop: ['Jetpack thruster flame loop: tight roaring flame jet, filtered noise core with low turbine whine, steady continuous seamless loop', 2.0, true],
  dash: ['Short burst thruster dash: quick doppler whoosh with flame crackle, single burst', 0.6],
  land_hard: ['Armored boots heavy landing on ground, two-stage armored slam thump with dust, single landing', 0.6],
  ui_move: ['Minimal videogame UI navigation blip, single soft dry click tick, very short', 0.5],
  ui_confirm: ['Videogame UI confirm sound: warm two-tone mechanical latch chirp, short', 0.5],
  ui_back: ['Videogame UI back cancel sound: single low soft thunk, very short', 0.5],
  wave_start: ['Low alien war horn blast announcing an enemy wave, short, with metallic edge, ominous', 1.2],
  wave_clear: ['Positive wave-cleared fanfare sting, three ascending dark brass notes, restrained, short', 1.5],
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
