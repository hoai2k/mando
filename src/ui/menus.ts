import { audio } from '../core/audio';
import type { MenuAction } from '../core/input';

/**
 * DOM menu system, fully navigable with keyboard AND Xbox controller
 * (d-pad / left stick to move, A to confirm, B to back).
 */

/**
 * Menus follow the mouse, but a screen opening under a stationary cursor also
 * fires mouseenter — which would drag focus onto whatever happens to be under
 * the pointer, usually the button just clicked, so the next Enter or A fires it
 * again instead of the top item. Hover only counts once the pointer has really
 * moved since the screen appeared.
 */
let pointerMoved = false;
addEventListener('pointermove', () => { pointerMoved = true; }, { passive: true });

interface Focusable {
  el: HTMLElement;
  action: () => void;
  /** set on rows that consume left/right themselves, e.g. a volume slider */
  adjust?: (dir: -1 | 1) => void;
}

export class MenuScreen {
  root: HTMLElement;
  private focusables: Focusable[] = [];
  private focusIndex = 0;
  private sliders: Array<() => void> = [];
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement, className = 'menu-screen') {
    this.root = document.createElement('div');
    this.root.className = className;
    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  addTitle(text: string, sub?: string): void {
    const t = document.createElement('div');
    t.className = 'menu-title';
    t.textContent = text;
    this.root.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'menu-subtitle';
      s.textContent = sub;
      this.root.appendChild(s);
    }
  }

  addButtons(container: HTMLElement | null, defs: Array<{ label: string; action: () => void; el?: HTMLElement }>): HTMLElement[] {
    const box = container ?? (() => {
      const b = document.createElement('div');
      b.className = 'menu-buttons';
      this.root.appendChild(b);
      return b;
    })();
    return defs.map((d) => {
      const el = d.el ?? (() => {
        const b = document.createElement('button');
        b.className = 'menu-btn';
        b.textContent = d.label;
        box.appendChild(b);
        return b;
      })();
      el.addEventListener('click', () => {
        audio.uiConfirm();
        // A clicked <button> keeps DOM focus, and the browser then fires it
        // again on the next Enter — so a mouse click would hijack the keyboard
        // and controller selection from here on. Hand focus back to the menu.
        el.blur();
        d.action();
      });
      el.addEventListener('mouseenter', () => { if (pointerMoved) this.focusEl(el); });
      this.focusables.push({ el, action: d.action });
      return el;
    });
  }

  /**
   * A labelled 0–1 slider. Left/right adjust it instead of moving the focus,
   * which is the only way a stick or d-pad can change a value; the mouse gets
   * the same control through a range input.
   */
  addSlider(label: string, get: () => number, set: (v: number) => void, step = 0.05): HTMLElement {
    const row = document.createElement('label');
    row.className = 'menu-slider';
    const name = document.createElement('span');
    name.className = 'slider-label';
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = String(step);
    const value = document.createElement('span');
    value.className = 'slider-value';
    row.append(name, input, value);
    this.root.appendChild(row);

    const paint = () => {
      const v = get();
      input.value = String(v);
      value.textContent = `${Math.round(v * 100)}%`;
      row.style.setProperty('--fill', `${v * 100}%`);
    };
    const apply = (v: number) => { set(Math.min(1, Math.max(0, +v.toFixed(3)))); paint(); };
    input.addEventListener('input', () => apply(parseFloat(input.value)));
    // Same reason as the buttons: a focused range would also consume the arrow
    // keys natively and move twice per press. Dragging still works.
    input.tabIndex = -1;
    input.addEventListener('pointerup', () => input.blur());
    row.addEventListener('mouseenter', () => { if (pointerMoved) this.focusEl(row); });

    this.focusables.push({
      el: row,
      action: () => {},                                  // nothing to confirm
      adjust: (dir) => { audio.uiMove(); apply(get() + dir * step); },
    });
    paint();
    this.sliders.push(paint);
    return row;
  }

  /** Re-read every slider from its source — call when a screen is shown. */
  refreshSliders(): void { for (const paint of this.sliders) paint(); }

  addHint(html: string): void {
    const h = document.createElement('div');
    h.className = 'menu-hint';
    h.innerHTML = html;
    this.root.appendChild(h);
  }

  private focusEl(el: HTMLElement): void {
    const idx = this.focusables.findIndex((f) => f.el === el);
    if (idx >= 0) this.setFocus(idx);
  }

  setFocus(idx: number): void {
    this.focusables.forEach((f, i) => f.el.classList.toggle('focused', i === idx));
    this.focusIndex = idx;
  }

  show(): void {
    this.root.style.display = '';
    this.refreshSliders();
    pointerMoved = false;
    this.setFocus(0);
  }
  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }

  handle(action: MenuAction): void {
    const n = this.focusables.length;
    if (n === 0) return;
    switch (action) {
      case 'left': case 'right': {
        const dir = action === 'left' ? -1 : 1;
        const focused = this.focusables[this.focusIndex];
        if (focused.adjust) { focused.adjust(dir); break; }
        audio.uiMove();
        this.setFocus((this.focusIndex + dir + n) % n);
        break;
      }
      case 'up':
        audio.uiMove();
        this.setFocus((this.focusIndex - 1 + n) % n);
        break;
      case 'down':
        audio.uiMove();
        this.setFocus((this.focusIndex + 1) % n);
        break;
      case 'confirm':
        audio.uiConfirm();
        this.focusables[this.focusIndex].action();
        break;
      case 'back':
        if (this.onBack) { audio.uiBack(); this.onBack(); }
        break;
    }
  }
}
