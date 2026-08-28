/**
 * The controls reference: an Xbox pad drawn to scale with its bindings called
 * out, and the keyboard equivalents beside it.
 *
 * Bindings are transcribed from `src/core/input.ts` — if a binding moves there,
 * it moves here. The diagram is inline SVG so it stays sharp at any size and
 * needs no asset.
 */

/** label rows for the keyboard/mouse column, kept next to the pad art */
const KEYBOARD: Array<[string, string]> = [
  ['Move', 'W A S D'],
  ['Look / aim', 'Mouse'],
  ['Jump → hold to jetpack', 'Space'],
  ['Sprint (hold) · dash (tap, in air)', 'Shift'],
  ['Fire blaster', 'Left mouse'],
  ['Aim — zoom', 'Right mouse'],
  ['Melee combo (gaffi stick)', 'F · Middle mouse'],
  ['Wrist rocket', 'Q'],
  ['Dead Eye', 'V'],
  ['Ground slam (in air)', 'Ctrl · C'],
  ['Switch weapon', 'E · 1 · 2'],
  ['Pause', 'Esc'],
  ['Fullscreen', 'Alt + F'],
];

/**
 * Controller diagram.
 *
 * Coordinates are laid out once here rather than computed: the pad sits in the
 * middle of a wide viewBox so the callouts have room either side, and the four
 * face buttons share one leader line to a legend instead of four crossing ones.
 */
function padSvg(): string {
  const label = (x: number, y: number, anchor: 'start' | 'end', lines: Array<[string, string]>): string =>
    lines.map(([key, text], i) =>
      `<text class="cl-label" x="${x}" y="${y + i * 22}" text-anchor="${anchor}">` +
      `<tspan class="cl-key">${key}</tspan>${text ? `<tspan class="cl-sep"> — </tspan>${text}` : ''}</text>`
    ).join('');
  const lead = (pts: string): string => `<polyline class="cl-lead" points="${pts}"/>`;
  const dot = (x: number, y: number): string => `<circle class="cl-dot" cx="${x}" cy="${y}" r="3.5"/>`;

  return `<svg class="pad-art" viewBox="0 0 980 470" role="img"
      aria-label="Xbox controller with the game's button bindings labelled">
    <defs>
      <linearGradient id="padBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3b3f47"/><stop offset="1" stop-color="#22252b"/>
      </linearGradient>
      <linearGradient id="padFace" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4a4f58"/><stop offset="1" stop-color="#31353d"/>
      </linearGradient>
    </defs>

    <!-- Triggers and bumpers are drawn before the body and overlap its top
         edge, so the body crops them and only the shoulder lip shows. -->
    <g class="cl-trigger">
      <rect x="352" y="38" width="78" height="46" rx="18"/>
      <rect x="550" y="38" width="78" height="46" rx="18"/>
    </g>
    <g class="cl-bumper">
      <rect x="338" y="68" width="104" height="38" rx="17"/>
      <rect x="538" y="68" width="104" height="38" rx="17"/>
    </g>

    <path class="cl-body" d="M325 96 C355 78 415 74 490 74 C565 74 625 78 655 96
      C685 114 701 150 701 186 C701 236 685 286 661 312 C643 332 617 334 601 316
      C579 292 559 258 535 246 C521 239 459 239 445 246 C421 258 401 292 379 316
      C363 334 337 332 319 312 C295 286 279 236 279 186 C279 150 295 114 325 96 Z"/>

    <!-- sticks -->
    <g class="cl-stick">
      <circle class="cl-well" cx="375" cy="150" r="34"/>
      <circle class="cl-cap"  cx="375" cy="150" r="25"/>
      <circle class="cl-well" cx="605" cy="222" r="34"/>
      <circle class="cl-cap"  cx="605" cy="222" r="25"/>
    </g>

    <!-- d-pad -->
    <g class="cl-dpad">
      <circle class="cl-well" cx="430" cy="222" r="30"/>
      <path d="M422 200 h16 v14 h14 v16 h-14 v14 h-16 v-14 h-14 v-16 h14 z"/>
    </g>

    <!-- face buttons -->
    <g class="cl-face">
      <circle cx="590" cy="122" r="17"/><text x="590" y="128" text-anchor="middle">Y</text>
      <circle cx="562" cy="150" r="17"/><text x="562" y="156" text-anchor="middle">X</text>
      <circle cx="618" cy="150" r="17"/><text x="618" y="156" text-anchor="middle">B</text>
      <circle cx="590" cy="178" r="17"/><text x="590" y="184" text-anchor="middle">A</text>
    </g>

    <!-- view / guide / menu -->
    <g class="cl-small">
      <circle cx="457" cy="140" r="10"/>
      <circle cx="523" cy="140" r="10"/>
      <circle class="cl-guide" cx="490" cy="126" r="15"/>
    </g>

    <!-- callouts: left -->
    ${lead('252,44 330,44 372,50')}${dot(391, 52)}
    ${label(244, 45, 'end', [['LT', 'Aim (zoom)']])}
    ${lead('252,112 316,112 356,90')}${dot(376, 86)}
    ${label(244, 113, 'end', [['LB', 'Switch weapon']])}
    ${lead('252,176 318,176 350,156')}${dot(375, 150)}
    ${label(244, 181, 'end', [['Left stick', 'Move']])}
    ${lead('252,272 356,272 404,234')}${dot(430, 222)}
    ${label(244, 277, 'end', [['D-pad', 'Navigate menus']])}

    <!-- callouts: right -->
    ${lead('728,44 650,44 608,50')}${dot(589, 52)}
    ${label(736, 45, 'start', [['RT', 'Fire blaster']])}
    ${lead('728,112 664,112 624,90')}${dot(604, 86)}
    ${label(736, 113, 'start', [['RB', 'Ground slam (in air)']])}
    ${lead('728,176 692,176 640,152')}${dot(618, 150)}
    ${label(736, 158, 'start', [
      ['Y', 'Wrist rocket'],
      ['B', 'Sprint (hold) · dash (tap)'],
      ['A', 'Jump → hold to jetpack'],
      ['X', 'Melee combo (gaffi)'],
    ])}
    ${lead('728,300 686,300 634,238')}${dot(605, 222)}
    ${label(736, 296, 'start', [
      ['Right stick', 'Look &amp; aim'],
      ['Click', 'Dead Eye'],
    ])}

    <!-- View and Menu: routed down through the gap between the grips, which is
         the only clear line out of the middle of the pad -->
    ${lead('457,148 457,178 474,244 490,352')}${dot(457, 140)}
    ${lead('523,148 523,178 506,244 490,352')}${dot(523, 140)}
    <text class="cl-label" x="490" y="378" text-anchor="middle">
      <tspan class="cl-key">View</tspan><tspan class="cl-sep"> — </tspan>Fullscreen
      <tspan class="cl-sep"> · </tspan>
      <tspan class="cl-key">Menu</tspan><tspan class="cl-sep"> — </tspan>Pause
    </text>
  </svg>`;
}

export function controlsMarkup(): string {
  return `<div class="controls-page">
    ${padSvg()}
    <div class="controls-keys">
      <div class="controls-keys-title">Keyboard &amp; mouse</div>
      <dl>${KEYBOARD.map(([what, keys]) =>
        `<dt>${what}</dt><dd>${keys.split(' · ').map((k) => `<kbd>${k}</kbd>`).join('<i>·</i>')}</dd>`
      ).join('')}</dl>
    </div>
  </div>`;
}
