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
 * What the game could read from input in one frame (a recorded frame, see src/engine/replay.ts).
 * Optional fields are left out when empty or zero; `held` and `pointer` also when unchanged
 * from the frame before.
 */
export interface InputFrame {
  /** Real seconds this frame lasted (game time follows from it). */
  dt: number;
  /** Keys held, keyboard and gamepad buttons together, sorted. */
  held?: string[];
  /** Keys pressed since the frame before (a tap can be pressed and not held). */
  pressed?: string[];
  /** The touch joystick and the gamepad's left stick (after its deadzone). */
  analog?: [number, number];
  pad?: [number, number];
  /** Pointer movement (CSS pixels) and wheel ticks this frame. */
  delta?: [number, number];
  wheel?: number;
  /** Pointer position (normalised device coordinates), over the canvas (1/0), buttons. */
  pointer?: [number, number, number, number];
  /** Whether a gamepad is connected (`gamepadConnected`), when that changes. */
  gamepad?: boolean;
  /**
   * Ran in the same task as the frame before (frames of one `step(n)` call): no promise
   * callbacks ran between them. A replay waits for them before every other frame.
   */
  sync?: true;
}

/** What the frame before held, for `snapshot()` to leave out what did not change. */
export interface SnapshotMemory {
  held: string;
  pointer: string;
  gamepad?: boolean;
}

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
  /**
   * Where the pointer last was over the canvas, in normalised device coordinates (−1..1, y up:
   * `camera.rayAt(pointer.x, pointer.y, …)` turns it into a ray), and whether it is over it now.
   * Under pointer lock it is the screen's centre (the crosshair).
   */
  readonly pointer = { x: 0, y: 0, over: false };
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
  /**
   * True while a replay drives input (`engine.replay()`): keyboard, pointer and wheel events
   * are ignored, and `playBefore` / `playAfter` set everything.
   */
  get playing(): boolean {
    return this._playing;
  }
  set playing(on: boolean) {
    this._playing = on;
    this.playedPad = false;
  }
  private _playing = false;
  private playedPad = false;
  /** Queued presses older than this many seconds of game time are dropped. */
  pressWindow = PRESS_WINDOW;

  constructor(private readonly target: Window = window) {
    const signal = this.listeners.signal;
    target.addEventListener(
      'keydown',
      (e) => {
        if (isGameKey(e.code) || this.preventKeys.has(e.code)) e.preventDefault();
        if (this._playing) return;
        if (!e.repeat) this.press(e.code);
        this.held.add(e.code);
      },
      { signal },
    );
    target.addEventListener('keyup', (e) => !this._playing && this.held.delete(e.code), { signal });
    target.addEventListener(
      'blur',
      () => {
        if (this._playing) return;
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
    const place = (e: PointerEvent) => {
      if (this._playing) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      // under pointer lock (first person) the cursor is hidden and frozen: point at the crosshair
      const locked = document.pointerLockElement === el;
      this.pointer.x = locked ? 0 : ((e.clientX - r.left) / r.width) * 2 - 1;
      this.pointer.y = locked ? 0 : 1 - ((e.clientY - r.top) / r.height) * 2;
      this.pointer.over = true;
    };
    el.addEventListener('pointermove', place, { signal });
    el.addEventListener('pointerdown', place, { signal });
    // locked by the click that asked for it: point at the crosshair from now, not where it clicked
    document.addEventListener(
      'pointerlockchange',
      () => {
        if (document.pointerLockElement !== el || this._playing) return;
        this.pointer.x = this.pointer.y = 0;
        this.pointer.over = true;
      },
      { signal },
    );
    el.addEventListener('pointerleave', () => !this._playing && (this.pointer.over = false), { signal });
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (this._playing) return;
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
      if (active.size === 0 && !this._playing) this.mouseButtons = 0;
    };
    el.addEventListener('pointerup', end, { signal });
    el.addEventListener('pointercancel', end, { signal });
    this.target.addEventListener(
      'pointermove',
      (e) => {
        if (this._playing) return;
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
        if (!this._playing) this.wheel += Math.sign(e.deltaY);
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

  /** Let go of everything held (keys, gamepad buttons, sticks, pointer buttons); queued presses stay. */
  release(): void {
    this.held.clear();
    this.padHeld.clear();
    this.analog.x = this.analog.y = 0;
    this.padAxis.x = this.padAxis.y = 0;
    this.mouseButtons = 0;
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
    // gamepad presses queue at the frame before's time, like keys pressed since then (so a
    // recording, which replays every press that way, gives them the same expiry)
    this.pollGamepads(dt, pads);
    this.now = now;
    // no negative zeros (a stick at rest reads -0): JSON writes them as 0, so a recording would
    // replay a different number, and atan2(-0, x) is not atan2(0, x)
    this.analog.x += 0;
    this.analog.y += 0;
    this.padAxis.x += 0;
    this.padAxis.y += 0;
    this.mouseDelta.x += 0;
    this.mouseDelta.y += 0;
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

  /** Test hook: put the pointer at (x, y) in normalised device coordinates, pressed or not. */
  setPointer(x: number, y: number, down?: boolean): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.over = true;
    if (down !== undefined) this.mouseButtons = down ? 1 : 0;
  }

  /** Test hook: inject pointer movement / wheel for the next frame. */
  addPointer(dx: number, dy: number, wheel = 0): void {
    this.mouseDelta.x += dx;
    this.mouseDelta.y += dy;
    this.wheel += wheel;
  }

  /**
   * This frame's input as data (after `beginFrame`), for a recording. `last` is the frame
   * before: unchanged held keys, pointer and gamepad connection are left out.
   */
  snapshot(dt: number, last?: SnapshotMemory): InputFrame {
    const f: InputFrame = { dt };
    const held = [...new Set([...this.held, ...this.padHeld])].sort();
    const heldKey = held.join(',');
    if (!last || heldKey !== last.held) f.held = held;
    if (this.pressed.size) f.pressed = [...this.pressed].sort();
    if (this.analog.x || this.analog.y) f.analog = [this.analog.x, this.analog.y];
    if (this.padAxis.x || this.padAxis.y) f.pad = [this.padAxis.x, this.padAxis.y];
    if (this.mouseDelta.x || this.mouseDelta.y) f.delta = [this.mouseDelta.x, this.mouseDelta.y];
    if (this.wheel) f.wheel = this.wheel;
    const pointer: [number, number, number, number] = [this.pointer.x, this.pointer.y, this.pointer.over ? 1 : 0, this.mouseButtons];
    const pointerKey = pointer.join(',');
    if (!last || pointerKey !== last.pointer) f.pointer = pointer;
    if (!last || this.gamepadConnected !== last.gamepad) f.gamepad = this.gamepadConnected;
    if (last) {
      last.held = heldKey;
      last.pointer = pointerKey;
      last.gamepad = this.gamepadConnected;
    }
    return f;
  }

  /**
   * Replay, before the engine's `beginFrame`: the frame's held keys and presses (presses queue
   * at the time they would have arrived, the frame before's game time).
   */
  playBefore(f: InputFrame): void {
    if (f.held) {
      this.held.clear();
      for (const c of f.held) this.held.add(c);
    }
    this.padHeld.clear(); // gamepad buttons were recorded as held keys
    for (const c of f.pressed ?? []) this.press(c);
  }

  /** Replay, after `beginFrame` (which polled no gamepads): sticks, pointer, wheel, gamepad connection. */
  playAfter(f: InputFrame): void {
    if (f.gamepad !== undefined) this.playedPad = f.gamepad;
    this.gamepadConnected = this.playedPad;
    [this.analog.x, this.analog.y] = f.analog ?? [0, 0];
    [this.padAxis.x, this.padAxis.y] = f.pad ?? [0, 0];
    [this.mouseDelta.x, this.mouseDelta.y] = f.delta ?? [0, 0];
    this.wheel = f.wheel ?? 0;
    if (f.pointer) {
      [this.pointer.x, this.pointer.y] = f.pointer;
      this.pointer.over = f.pointer[2] === 1;
      this.mouseButtons = f.pointer[3];
    }
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
