/**
 * The sound button in the corner, and a controller press starting the sound.
 *
 *  - before anything is pressed the button reads "off" (nothing may play yet)
 *  - a controller button on the title builds the engine and starts the score
 *  - the button then reads "on"; pressing it mutes (master bus to zero, the
 *    volume setting untouched) and it reads "muted"; pressing it again unmutes
 *  - the mute is remembered across a reload
 *
 * Run:  node tools/test-sound-button.mjs   (HARNESS_PORT, CHROMIUM_PATH as usual)
 */
import { launch } from './harness.mjs';

const failures = [];
const check = (n, ok, d) => { console.log(`${ok ? '  ok  ' : ' FAIL '} ${n}: ${JSON.stringify(d)}`); if (!ok) failures.push(n); };
const h = await launch();
const { page } = h;
await h.waitForTitle();
await page.evaluate(() => { try { localStorage.removeItem('mando.muted'); } catch { /* */ } });

const read = () => page.evaluate(() => {
  const b = document.querySelector('.sound-btn');
  const a = window.__audio;
  return {
    title: b?.title, pressed: b?.getAttribute('aria-pressed'), waiting: b?.classList.contains('waiting'),
    ready: a.ready, audible: a.audible, muted: a.muted, music: a.musicOn, master: a.volumes.master,
  };
});

const cold = await read();
check('before any press the button reads off, and asks to be pressed', cold.pressed === 'true' && cold.waiting && !cold.ready, cold);

// a controller press on the title (a shoulder button: nothing else to do there)
const pad = h.pad;
await pad.connect();
await pad.tap(4);
await page.waitForTimeout(600);
const padOn = await read();
check('a controller press starts the sound and the title score', padOn.ready && padOn.audible && padOn.music, padOn);
check('and the button reads on', padOn.pressed === 'false' && !padOn.waiting && /on/i.test(padOn.title), padOn);

await page.click('.sound-btn');
await page.waitForTimeout(100);
const muted = await read();
const bus = await page.evaluate(() => window.__audio.master.gain.value);
check('pressing it mutes', muted.muted && !muted.audible && muted.pressed === 'true' && !muted.waiting && /muted/i.test(muted.title), muted);
check('by zeroing the bus, not the volume setting', bus === 0 && muted.master > 0, { bus, master: muted.master });

await page.reload();
await h.waitForTitle();
const again = await read();
check('the mute survives a reload', again.muted, again);

await page.click('.sound-btn');
await page.waitForTimeout(300);
const unmuted = await read();
check('pressing it again turns the sound on, score and all', !unmuted.muted && unmuted.audible && unmuted.music && unmuted.pressed === 'false', unmuted);

const errs = h.errors.filter((e) => !/Couldn't load texture blob:/.test(String(e)));
check('no page errors', errs.length === 0, errs.slice(0, 3));
await h.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
