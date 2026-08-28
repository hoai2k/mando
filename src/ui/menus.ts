import { audio } from '../core/audio';
import type { MenuAction } from '../core/input';

/**
 * DOM menu system, fully navigable with keyboard AND Xbox controller
 * (d-pad / left stick to move, A to confirm, B to back).
 */

interface Focusable { el: HTMLElement; action: () => void; }

export class MenuScreen {
  root: HTMLElement;
  private focusables: Focusable[] = [];
  private focusIndex = 0;
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
      el.addEventListener('click', () => { audio.uiConfirm(); d.action(); });
      el.addEventListener('mouseenter', () => this.focusEl(el));
      this.focusables.push({ el, action: d.action });
      return el;
    });
  }

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
    this.setFocus(0);
  }
  hide(): void { this.root.style.display = 'none'; }
  get visible(): boolean { return this.root.style.display !== 'none'; }

  handle(action: MenuAction): void {
    const n = this.focusables.length;
    if (n === 0) return;
    switch (action) {
      case 'up': case 'left':
        audio.uiMove();
        this.setFocus((this.focusIndex - 1 + n) % n);
        break;
      case 'down': case 'right':
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
