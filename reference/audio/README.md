# Nexu roar audition

Three ElevenLabs sound-effects candidates generated on 2026-09-23. The live game still uses `public/assets/audio/nexu_roar.mp3` until a candidate is chosen.

| File | Direction |
|---|---|
| `nexu_roar_throaty.mp3` | Close, dry leopard roar with a rough breathy tail |
| `nexu_roar_snarling.mp3` | Short snarl rising into a rasping roar |
| `nexu_roar_deep.mp3` | Low warning growl followed by a raw roar |

Run `node tools/generate-nexu-roar-variants.mjs` with `ELEVENLABS_API_KEY` set to create a new set. It overwrites these audition files, not the live game sound.
