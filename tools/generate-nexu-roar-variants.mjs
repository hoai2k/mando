// Generate audition candidates without replacing the in-game Nexu roar.
import { mkdir, writeFile } from 'node:fs/promises';

const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is required');
const candidates = [
  ['throaty', 'Close dry recording of a large wild leopard giving one forceful throaty territorial roar, a rough exhaled chest rumble with natural breath and a brief gravelly tail. Real animal vocalization, no music, no processing.', 3.2],
  ['snarling', 'A large angry wild cat gives a short guttural snarl that rises into one explosive rasping roar, then stops. Intimate wildlife field recording, natural uneven breath and throat texture, no music.', 3.0],
  ['deep', 'A massive leopard-like predator gives a low resonant warning growl followed by one raw open-mouth roar. Organic wildlife recording with chest resonance and ragged breath, no electronic effects or music.', 3.5],
];
const out = new URL('../reference/audio/', import.meta.url);
await mkdir(out, { recursive: true });
for (const [name, prompt, duration_seconds] of candidates) {
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds, prompt_influence: 0.25, model_id: 'eleven_text_to_sound_v2' }),
  });
  if (!response.ok) throw new Error(`${name}: ElevenLabs HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(`nexu_roar_${name}.mp3`, out), data);
  console.log(`${name}: ${data.length} bytes`);
}
