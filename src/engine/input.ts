/** Minimal keyboard input: held state plus edge-triggered presses consumed once per frame. */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly queued = new Set<string>();

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
    target.addEventListener('blur', () => this.held.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** True once per physical key press. */
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

  /** -1..1 on each axis from WASD / arrow keys (x = right, y = forward). */
  moveAxis(): { x: number; y: number } {
    const x = (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  /** Call at the end of each rendered frame. */
  endFrame(): void {
    this.pressed.clear();
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
}

function isGameKey(code: string): boolean {
  return code.startsWith('Arrow') || code === 'Space';
}
