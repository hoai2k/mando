# Character reference sheets

Production inputs, **not** runtime assets: nothing here is copied into `dist/` or served
from the site. They are the canonical visual reference for the authored 3D models — model
from these, not from prose — and they drive image-to-3D generators as well as hand
modelling.

- `<id>_front.png`, `<id>_side.png`, `<id>_back.png` per character, 1024×1536, the same
  canvas for all three views so scale stays comparable between characters.
- Creatures use `_front` / `_side` / `_top` instead, since a rear view of a spider says
  little.
- Weapons and vehicles are a single side view at 1024×512 (`carbine.png`, `gaffi.png`,
  `saber_curved.png`, `crossbow.png`, `longrifle.png`).
- Ids match the model filenames in `public/models/`.

The recipe for making more — the shared A-pose preamble, the per-view swaps and the
working notes — is in [`docs/ASSETS_IMAGES.md`](../../docs/ASSETS_IMAGES.md); the prompt
behind every delivered sheet is recorded in
[`docs/ASSETS_COMPLETED.md`](../../docs/ASSETS_COMPLETED.md).

Some sheets outlive their character: `grogu_*` and the `mandalorian_lineup` are from
earlier passes and are kept as history rather than as briefs.
