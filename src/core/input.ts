/**
 * Input: keyboard+mouse and up to two Xbox-style gamepads (standard mapping),
 * merged into per-player FrameInput, plus a menu-navigation event stream that
 * aggregates keyboard and ALL gamepads so menus are controller-navigable.
 */

export interface FrameInput {
  moveX: number; // -1..1 (right+)
  moveY: number; // -1..1 (forward+)
  lookX: number; // radians of yaw delta this frame
  lookY: number; // radians of pitch delta this frame
  jumpHeld: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  sprintHeld: boolean;
  shootHeld: boolean;
  aimHeld: boolean;
  meleePressed: boolean;
  rocketPressed: boolean;
  /** Dead Eye toggle — V on keyboard, right-stick click on pad */
  deadeyePressed: boolean;
  /** hold to raise the block shield */
  blockHeld: boolean;
  slamPressed: boolean;
  switchPressed: boolean;
  pausePressed: boolean;
}

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'fullscreen';

/** A menu action plus where it came from: -1 = keyboard/mouse, else gamepad index. */
export interface MenuEvent { action: MenuAction; source: number; }

const DEADZONE = 0.18;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));

// Xbox standard-mapping button indices
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, LS: 10, RS: 11, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15 } as const;

function blankInput(): FrameInput {
  return {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0,
    jumpHeld: false, jumpPressed: false, dashPressed: false, sprintHeld: false, shootHeld: false,
    aimHeld: false, meleePressed: false, rocketPressed: false, slamPressed: false,
    deadeyePressed: false, blockHeld: false, switchPressed: false, pausePressed: false,
  };
}

interface PadState { prev: boolean[]; repeatTimer: Map<string, number>; }

export class InputManager {
  private padStates = new Map<number, PadState>();
  private menuQueue: MenuEvent[] = [];
  /** gamepad index assigned to each player slot; -1 = none */
  padForPlayer: number[] = [-1, -1];
  stickSensitivity = 2.6; // rad/s at full deflection
  pointerLocked = false;
  /** set true while in menus so gameplay ignores input & pads emit menu events */
  menuMode = true;
  onFullscreenToggle: (() => void) | null = null;

  constructor(private canvas: HTMLElement) {
    // The keyboard is a menu device only: gameplay is controller-only, so
    // nothing here feeds FrameInput.
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const map: Record<string, MenuAction> = {
        ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
        ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
        Enter: 'confirm', Space: 'confirm', Escape: 'back',
      };
      if (this.menuMode && map[e.code]) this.menuQueue.push({ action: map[e.code], source: -1 });
      if (!this.menuMode && e.code === 'Escape') this.menuQueue.push({ action: 'pause', source: -1 });
      if (e.code === 'KeyF' && e.altKey) this.menuQueue.push({ action: 'fullscreen', source: -1 });
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock(): void {
    if (!this.pointerLocked) this.canvas.requestPointerLock?.();
  }
  releasePointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

  /**
   * Connected gamepads with standard mapping, sorted by index.
   *
   * The mapping check is not optional: everything below reads Xbox standard
   * button indices, and browsers expose plenty of other HID devices as
   * gamepads — joysticks, wheels, D-input pads, adapters. On those the indices
   * mean something else entirely, and a switch that happens to sit latched at
   * index 7 reads as a held right trigger, so player one fires forever without
   * anyone touching anything.
   */
  private pads(): Gamepad[] {
    const out: Gamepad[] = [];
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected && p.mapping === 'standard') out.push(p);
    return out;
  }

  /** Assign pads to player slots: P1 gets the first pad (shared with KB/M), P2 the second. */
  private assignPads(): void {
    const pads = this.pads();
    this.padForPlayer[0] = pads[0]?.index ?? -1;
    this.padForPlayer[1] = pads[1]?.index ?? -1;
  }

  /** True if a second controller is available for split-screen join. */
  hasSecondPad(): boolean { return this.pads().length >= 2; }
  padCount(): number { return this.pads().length; }

  private padState(idx: number): PadState {
    let s = this.padStates.get(idx);
    if (!s) { s = { prev: new Array(17).fill(false), repeatTimer: new Map() }; this.padStates.set(idx, s); }
    return s;
  }

  private padPressed(pad: Gamepad, btn: number, state: PadState): boolean {
    const now = !!pad.buttons[btn]?.pressed;
    return now && !state.prev[btn];
  }

  /**
   * Poll gamepads: emit menu events (in menu mode) and fullscreen toggles.
   * Call once per frame BEFORE reading per-player input.
   */
  poll(dt: number): void {
    this.assignPads();
    for (const pad of this.pads()) {
      const st = this.padState(pad.index);
      // fullscreen on View button, any mode
      if (this.padPressed(pad, BTN.VIEW, st)) this.menuQueue.push({ action: 'fullscreen', source: pad.index });
      if (this.menuMode) {
        const dirs: Array<[string, boolean, MenuAction]> = [
          ['up', !!pad.buttons[BTN.DUP]?.pressed || dz(pad.axes[1] ?? 0) < -0.55, 'up'],
          ['down', !!pad.buttons[BTN.DDOWN]?.pressed || dz(pad.axes[1] ?? 0) > 0.55, 'down'],
          ['left', !!pad.buttons[BTN.DLEFT]?.pressed || dz(pad.axes[0] ?? 0) < -0.55, 'left'],
          ['right', !!pad.buttons[BTN.DRIGHT]?.pressed || dz(pad.axes[0] ?? 0) > 0.55, 'right'],
        ];
        for (const [key, held, action] of dirs) {
          const t = st.repeatTimer.get(key) ?? 0;
          if (held) {
            if (t <= 0) { this.menuQueue.push({ action, source: pad.index }); st.repeatTimer.set(key, t <= -0.001 ? 0.16 : 0.42); }
            else st.repeatTimer.set(key, t - dt);
          } else st.repeatTimer.set(key, 0);
        }
        if (this.padPressed(pad, BTN.A, st)) this.menuQueue.push({ action: 'confirm', source: pad.index });
        if (this.padPressed(pad, BTN.B, st)) this.menuQueue.push({ action: 'back', source: pad.index });
        if (this.padPressed(pad, BTN.START, st)) this.menuQueue.push({ action: 'confirm', source: pad.index });
      } else {
        if (this.padPressed(pad, BTN.START, st)) this.menuQueue.push({ action: 'pause', source: pad.index });
      }
      for (let i = 0; i < pad.buttons.length && i < 17; i++) st.prev[i] = !!pad.buttons[i]?.pressed;
    }
    for (const e of this.menuQueue) {
      if (e.action === 'fullscreen') this.onFullscreenToggle?.();
    }
    this.menuQueue = this.menuQueue.filter((e) => e.action !== 'fullscreen');
  }

  /** Drain queued menu navigation events, with their input source attached. */
  drainMenuEvents(): MenuEvent[] {
    const q = this.menuQueue;
    this.menuQueue = [];
    return q;
  }

  /**
   * Read gameplay input for a player slot (0 or 1) and clear per-frame edges.
   * Gameplay is controller-only — the keyboard drives menus and nothing else.
   */
  read(slot: number, dt: number): FrameInput {
    const inp = blankInput();
    if (this.menuMode) { this.endFrame(); return inp; }

    const padIdx = this.padForPlayer[slot];
    if (padIdx >= 0) {
      const pad = (navigator.getGamepads?.() ?? [])[padIdx];
      if (pad) {
        const st = this.padState(pad.index);
        inp.moveX += dz(pad.axes[0] ?? 0);
        inp.moveY += -dz(pad.axes[1] ?? 0);
        inp.lookX += -dz(pad.axes[2] ?? 0) * this.stickSensitivity * dt;
        inp.lookY += -dz(pad.axes[3] ?? 0) * this.stickSensitivity * dt * 0.75;
        const b = (i: number) => !!pad.buttons[i]?.pressed;
        // edges were captured in poll(); re-derive pressed via stored prev-of-last-frame is
        // already updated, so track pressed separately here using a shadow set:
        inp.jumpHeld ||= b(BTN.A);
        inp.jumpPressed ||= this.edge(pad, BTN.A);
        // RB is the movement button: the player controller decides between a
        // dash and a sprint from whether the stick was already pushed.
        inp.dashPressed ||= this.edge(pad, BTN.RB);
        inp.sprintHeld ||= b(BTN.RB);
        inp.blockHeld ||= b(BTN.B);
        inp.slamPressed ||= this.edge(pad, BTN.LB);
        inp.shootHeld ||= (pad.buttons[BTN.RT]?.value ?? 0) > 0.4 || b(BTN.RT);
        inp.aimHeld ||= (pad.buttons[BTN.LT]?.value ?? 0) > 0.4 || b(BTN.LT);
        inp.meleePressed ||= this.edge(pad, BTN.X);
        inp.rocketPressed ||= this.edge(pad, BTN.Y);
        inp.deadeyePressed ||= this.edge(pad, BTN.RS);
        inp.switchPressed ||= this.edge(pad, BTN.DRIGHT);
      }
    }
    inp.moveX = Math.max(-1, Math.min(1, inp.moveX));
    inp.moveY = Math.max(-1, Math.min(1, inp.moveY));
    return inp;
  }

  // Gameplay edge detection: compare against a per-frame snapshot taken in poll()
  private edgeSnapshots = new Map<number, boolean[]>();
  private edge(pad: Gamepad, btn: number): boolean {
    let snap = this.edgeSnapshots.get(pad.index);
    if (!snap) { snap = new Array(17).fill(false); this.edgeSnapshots.set(pad.index, snap); }
    const now = !!pad.buttons[btn]?.pressed;
    const was = snap[btn];
    snap[btn] = now;
    return now && !was;
  }

  /** Clear per-frame edges/deltas — call once per frame after all read() calls. */
  endFrame(): void {
    // gamepad edges are snapshot-based, so there is no per-frame state left to
    // clear; kept as the loop's explicit end-of-frame hook
  }
}
