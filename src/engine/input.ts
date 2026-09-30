/**
 * Keyboard + pointer input.
 * - Keys: held state, per-frame presses (`wasPressed`) and queued presses for fixed-step
 *   code (`consumePress`).
 * - Pointer: accumulated movement per frame (while a button is held or the pointer is
 *   locked), wheel delta per frame, optional pointer lock (first-person).
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly queued = new Set<string>();
  /** Pointer movement this frame, in CSS pixels (drag or pointer lock). */
  readonly mouseDelta = { x: 0, y: 0 };
  /** Wheel ticks this frame (+1 = scroll down / zoom out). */
  wheel = 0;
  mouseButtons = 0;
  private lockTarget: HTMLElement | null = null;
  /** When true, clicking the canvas requests pointer lock (first-person / free camera). */
  wantsPointerLock = false;
  /** Analog stick (touch joystick / gamepad), -1..1 per axis; overrides keys when active. */
  readonly analog = { x: 0, y: 0 };

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (isGameKey(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        this.queued.add(e.code);
      }
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.code));
    target.addEventListener('blur', () => {
      this.held.clear();
      this.mouseButtons = 0;
    });
  }

  /**
   * Listen for pointer input on the game canvas. Only pointers that went down on the
   * canvas drive the camera (so a touch joystick doesn't orbit it). Two canvas touches
   * pinch to zoom (emitted as wheel ticks).
   */
  attachPointer(el: HTMLElement): void {
    this.lockTarget = el;
    const active = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const spread = () => {
      const [a, b] = [...active.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capture(el, e.pointerId);
      this.mouseButtons = e.buttons || 1;
      pinch = spread();
      if (this.wantsPointerLock && e.pointerType === 'mouse' && document.pointerLockElement !== el) void el.requestPointerLock?.();
    });
    const end = (e: PointerEvent) => {
      active.delete(e.pointerId);
      pinch = spread();
      if (active.size === 0) this.mouseButtons = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('pointermove', (e) => {
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
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  get pointerLocked(): boolean {
    return this.lockTarget !== null && document.pointerLockElement === this.lockTarget;
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** True once per physical key press (valid for the current render frame). */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /**
   * True once per physical key press, kept until consumed. Use from fixed-step code
   * (which may run zero or several times per frame) so no press is ever dropped.
   */
  consumePress(...codes: string[]): boolean {
    let hit = false;
    for (const c of codes) if (this.queued.delete(c)) hit = true;
    return hit;
  }

  /** Drop queued presses (e.g. when a menu or mode swallows input). */
  clearQueued(...codes: string[]): void {
    if (codes.length === 0) this.queued.clear();
    for (const c of codes) this.queued.delete(c);
  }

  /** -1..1 on each axis from WASD / arrow keys (x = right, y = forward). */
  moveAxis(): { x: number; y: number } {
    if (Math.hypot(this.analog.x, this.analog.y) > 0.12) {
      const len = Math.hypot(this.analog.x, this.analog.y);
      return len > 1 ? { x: this.analog.x / len, y: this.analog.y / len } : { ...this.analog };
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
      if (!this.held.has(code)) {
        this.pressed.add(code);
        this.queued.add(code);
      }
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
