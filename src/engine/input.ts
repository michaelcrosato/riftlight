/**
 * Standard-mapping gamepad buttons → the key codes they press (see character/controls.ts
 * KEYMAP). Change `input.gamepadButtons` to remap. Indices follow the W3C "standard" layout:
 * 0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 Back · 9 Start · 12–15 d-pad.
 */
export const GAMEPAD_BUTTONS: Readonly<Record<number, string>> = {
  0: 'Space', // A: jump
  1: 'KeyC', // B: crouch (in the air: ground pound)
  2: 'KeyJ', // X: attack
  3: 'KeyF', // Y: grab / pull
  4: 'KeyZ', // LB: prone
  5: 'KeyX', // RB: lie down
  6: 'ShiftLeft', // LT: walk / tiptoe
  7: 'KeyC', // RT: crouch
  8: 'KeyV', // Back: wave
  9: 'KeyB', // Start: sit
  12: 'ArrowUp',
  13: 'ArrowDown',
  14: 'ArrowLeft',
  15: 'ArrowRight',
};

/** The parts of the Gamepad API that Input reads (tests can pass plain objects). */
export interface GamepadLike {
  readonly connected?: boolean;
  readonly mapping?: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
}

/**
 * Radial deadzone with rescaling: inside `deadzone` reads 0, the rim reads 1, and the
 * direction is kept (no square-gate snapping to the axes).
 */
export function applyDeadzone(x: number, y: number, deadzone = 0.2): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len <= deadzone || len === 0) return { x: 0, y: 0 };
  const k = Math.min(1, (len - deadzone) / (1 - deadzone)) / len;
  return { x: x * k, y: y * k };
}

/** How long a queued press stays consumable, in seconds of game time. */
export const PRESS_WINDOW = 0.15;

/**
 * Keyboard + pointer + gamepad input.
 * - Keys: held state, per-frame presses (`wasPressed`) and queued presses for fixed-step
 *   code (`consumePress`). Queued presses expire after `pressWindow` s of game time.
 * - Gamepads (standard mapping): the left stick feeds `moveAxis()` (radial deadzone), the
 *   right stick feeds the pointer delta (camera look), buttons press key codes
 *   (`gamepadButtons`). Polled once per frame by the engine (`beginFrame`).
 * - Pointer: accumulated movement per frame (while a button is held or the pointer is
 *   locked), wheel delta per frame, optional pointer lock (first-person).
 * - `dispose()` removes every listener it added.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  /** Queued presses → the game time they happened at. */
  private readonly queued = new Map<string, number>();
  /** Keys held through gamepad buttons (merged into isDown). */
  private readonly padHeld = new Set<string>();
  private readonly listeners = new AbortController();
  /** Pointer movement this frame, in CSS pixels (drag or pointer lock). */
  readonly mouseDelta = { x: 0, y: 0 };
  /** Wheel ticks this frame (+1 = scroll down / zoom out). */
  wheel = 0;
  mouseButtons = 0;
  private lockTarget: HTMLElement | null = null;
  /** When true, clicking the canvas requests pointer lock (first-person / free camera). */
  wantsPointerLock = false;
  /** Touch joystick, -1..1 per axis; overrides keys when active. */
  readonly analog = { x: 0, y: 0 };
  /** Gamepad left stick after the deadzone, -1..1 (y = forward). */
  readonly padAxis = { x: 0, y: 0 };
  /** True while any gamepad is connected. */
  gamepadConnected = false;
  /**
   * Extra key codes whose browser default is blocked (arrows and Space always are): a game's
   * own F1 / F2 / Tab panels, so the browser's help page or focus change doesn't fire.
   */
  readonly preventKeys = new Set<string>();
  /** Gamepad button index → key code (defaults: GAMEPAD_BUTTONS). */
  gamepadButtons: Record<number, string> = { ...GAMEPAD_BUTTONS };
  /** Stick deadzone (radial, 0..1). */
  gamepadDeadzone = 0.2;
  /** Right stick look speed: pointer pixels per second at full tilt. */
  gamepadLookSpeed = 500;
  /** Game time (s) of the current frame; set by the engine through `beginFrame`. */
  now = 0;
  /** Queued presses older than this many seconds of game time are dropped. */
  pressWindow = PRESS_WINDOW;

  constructor(private readonly target: Window = window) {
    const signal = this.listeners.signal;
    target.addEventListener(
      'keydown',
      (e) => {
        if (isGameKey(e.code) || this.preventKeys.has(e.code)) e.preventDefault();
        if (!e.repeat) this.press(e.code);
        this.held.add(e.code);
      },
      { signal },
    );
    target.addEventListener('keyup', (e) => this.held.delete(e.code), { signal });
    target.addEventListener(
      'blur',
      () => {
        this.held.clear();
        this.mouseButtons = 0;
      },
      { signal },
    );
  }

  /**
   * Listen for pointer input on the game canvas. Only pointers that went down on the
   * canvas drive the camera (so a touch joystick doesn't orbit it). Two canvas touches
   * pinch to zoom (emitted as wheel ticks).
   */
  attachPointer(el: HTMLElement): void {
    const signal = this.listeners.signal;
    this.lockTarget = el;
    const active = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...active.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    el.addEventListener(
      'pointerdown',
      (e) => {
        active.set(e.pointerId, { x: e.clientX, y: e.clientY });
        capture(el, e.pointerId);
        this.mouseButtons = e.buttons || 1;
        pinch = spread();
        if (this.wantsPointerLock && e.pointerType === 'mouse' && document.pointerLockElement !== el) void el.requestPointerLock?.();
      },
      { signal },
    );
    const end = (e: PointerEvent) => {
      active.delete(e.pointerId);
      pinch = spread();
      if (active.size === 0) this.mouseButtons = 0;
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
    this.target.addEventListener(
      'pointermove',
      (e) => {
        const locked = document.pointerLockElement === el;
        const p = active.get(e.pointerId);
        if (!p && !locked) return;
        if (p && active.size >= 2) {
          p.x = e.clientX;
          p.y = e.clientY;
          const d = spread();
          if (pinch > 0 && Math.abs(d - pinch) > 24) {
            this.wheel += d > pinch ? -1 : 1; // spread fingers = zoom in
            pinch = d;
          }
          return;
        }
        if (p) {
          // Positions, not movementX: movementX isn't reliable for touch on all mobile browsers.
          this.mouseDelta.x += e.clientX - p.x;
          this.mouseDelta.y += e.clientY - p.y;
          p.x = e.clientX;
          p.y = e.clientY;
        } else {
          this.mouseDelta.x += e.movementX;
          this.mouseDelta.y += e.movementY;
        }
      },
      { signal },
    );
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false, signal },
    );
  }

  /** Remove every listener this Input added (window and canvas). */
  dispose(): void {
    this.listeners.abort();
    if (this.lockTarget && typeof document !== 'undefined' && document.pointerLockElement === this.lockTarget) document.exitPointerLock?.();
    this.lockTarget = null;
    this.reset();
  }

  /** Forget held keys, presses, sticks and pointer movement (e.g. when a level loads). */
  reset(): void {
    this.held.clear();
    this.queued.clear();
    this.padHeld.clear();
    this.analog.x = this.analog.y = 0;
    this.padAxis.x = this.padAxis.y = 0;
    this.mouseButtons = 0;
    this.endFrame();
  }

  /**
   * Engine: begin a frame at game time `now` (seconds). Polls gamepads and drops expired
   * queued presses. `pads` defaults to `navigator.getGamepads()`; tests can pass fakes.
   */
  beginFrame(now: number, dt: number, pads?: readonly (GamepadLike | null)[]): void {
    this.now = now;
    this.pollGamepads(dt, pads);
    for (const [code, t] of this.queued) if (now - t > this.pressWindow) this.queued.delete(code);
  }

  get pointerLocked(): boolean {
    return this.lockTarget !== null && document.pointerLockElement === this.lockTarget;
  }

  isDown(...codes: string[]): boolean {
    return this.anyDown(codes);
  }

  /** `isDown` for a list of codes, without building a rest-argument array (fixed-step code). */
  anyDown(codes: readonly string[]): boolean {
    for (const c of codes) if (this.held.has(c) || this.padHeld.has(c)) return true;
    return false;
  }

  /** True once per physical key press (valid for the current render frame). */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /**
   * True once per physical key press, kept until consumed or until it is older than
   * `pressWindow` (150 ms of game time). Use from fixed-step code (which may run zero or
   * several times per frame) so no press is dropped, while a stale press (made during a
   * pause, a loading screen or a long hitch) never fires late.
   */
  consumePress(...codes: string[]): boolean {
    return this.consumeAny(codes);
  }

  /** `consumePress` for a list of codes, without building a rest-argument array. */
  consumeAny(codes: readonly string[]): boolean {
    let hit = false;
    for (const c of codes) {
      const t = this.queued.get(c);
      if (t === undefined) continue;
      this.queued.delete(c);
      if (this.now - t <= this.pressWindow) hit = true;
    }
    return hit;
  }

  /** Presses waiting to be consumed (tooling / tests). */
  get queuedPresses(): string[] {
    return [...this.queued.keys()];
  }

  /** Drop queued presses (e.g. when a menu or mode swallows input). */
  clearQueued(...codes: string[]): void {
    if (codes.length === 0) this.queued.clear();
    for (const c of codes) this.queued.delete(c);
  }

  /**
   * -1..1 on each axis (x = right, y = forward): the touch joystick or a gamepad's left
   * stick (whichever is tilted further), else WASD / arrow keys / d-pad.
   */
  moveAxis(): { x: number; y: number } {
    const touch = Math.hypot(this.analog.x, this.analog.y);
    const pad = Math.hypot(this.padAxis.x, this.padAxis.y);
    const stick = touch > 0.12 && touch >= pad ? this.analog : pad > 0 ? this.padAxis : null;
    if (stick) {
      const len = Math.hypot(stick.x, stick.y);
      return len > 1 ? { x: stick.x / len, y: stick.y / len } : { x: stick.x, y: stick.y };
    }
    const x = (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** Call at the end of each rendered frame. */
  endFrame(): void {
    this.pressed.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.wheel = 0;
  }

  /** Test hook: simulate a key being held (true) or released (false). */
  setKey(code: string, down: boolean): void {
    if (down) {
      if (!this.held.has(code)) this.press(code);
      this.held.add(code);
    } else {
      this.held.delete(code);
    }
  }

  /** Test hook: inject pointer movement / wheel for the next frame. */
  addPointer(dx: number, dy: number, wheel = 0): void {
    this.mouseDelta.x += dx;
    this.mouseDelta.y += dy;
    this.wheel += wheel;
  }

  private press(code: string): void {
    this.pressed.add(code);
    this.queued.set(code, this.now);
  }

  private pollGamepads(dt: number, pads?: readonly (GamepadLike | null)[]): void {
    let list: readonly (GamepadLike | null)[] = pads ?? [];
    if (!pads) {
      try {
        list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      } catch {
        list = []; // blocked by a permissions policy
      }
    }
    const down = new Set<string>();
    let stick = { x: 0, y: 0 };
    let connected = false;
    for (const pad of list) {
      if (!pad || pad.connected === false) continue;
      // Only the W3C "standard" layout has known button/axis meanings; other pads ('' mapping)
      // would press random actions. (Fakes without a mapping are treated as standard.)
      if (pad.mapping !== undefined && pad.mapping !== 'standard') continue;
      connected = true;
      pad.buttons.forEach((b, i) => {
        const code = this.gamepadButtons[i];
        if (code && (b.pressed || (b.value ?? 0) > 0.5)) down.add(code);
      });
      const left = applyDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), this.gamepadDeadzone);
      if (Math.hypot(left.x, left.y) > Math.hypot(stick.x, stick.y)) stick = left;
      const right = applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.gamepadDeadzone);
      this.mouseDelta.x += right.x * this.gamepadLookSpeed * dt;
      this.mouseDelta.y += right.y * this.gamepadLookSpeed * dt;
    }
    for (const code of down) if (!this.padHeld.has(code) && !this.held.has(code)) this.press(code);
    this.padHeld.clear();
    for (const code of down) this.padHeld.add(code);
    this.padAxis.x = stick.x;
    this.padAxis.y = stick.y;
    this.gamepadConnected = connected;
  }
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}

/** Pointer capture is best-effort: it throws if the pointer is already gone. */
function capture(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* pointer no longer active */
  }
}
