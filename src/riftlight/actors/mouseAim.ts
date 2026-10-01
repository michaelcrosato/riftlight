import { type Camera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { MOUSE_LEFT, MOUSE_RIGHT } from './controls';

/** The parts of the engine's Input this needs. */
interface KeySink {
  setKey(code: string, down: boolean): void;
}

/**
 * Mouse aiming for the ARPG controller: tracks the cursor over the game canvas (the engine's
 * Input only tracks drags) and turns it into a point on the ground plane under the cursor.
 * Mouse buttons become the virtual keys MOUSE_LEFT / MOUSE_RIGHT on `ctx.input`, so they
 * buffer and combine exactly like keyboard keys (and scripts can press them with setKey).
 */
export class MouseAim {
  /** Cursor in normalized device coordinates (−1..1), and whether it has been used. */
  readonly ndc = new Vector2();
  active = false;
  /** Game-time of the last mouse movement or click (aim falls back to auto-aim after a while). */
  lastUsed = -Infinity;
  private readonly ray = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly abort = new AbortController();
  private now = 0;

  constructor(
    canvas: HTMLElement | null,
    private readonly input: KeySink,
  ) {
    if (!canvas || typeof window === 'undefined') return;
    const signal = this.abort.signal;
    const move = (e: PointerEvent | MouseEvent) => {
      if ('pointerType' in e && e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      this.active = true;
      this.lastUsed = this.now;
    };
    window.addEventListener('pointermove', move, { signal });
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        move(e);
        if (e.button === 0) this.input.setKey(MOUSE_LEFT, true);
        if (e.button === 2) this.input.setKey(MOUSE_RIGHT, true);
      },
      { signal },
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        if (e.button === 0) this.input.setKey(MOUSE_LEFT, false);
        if (e.button === 2) this.input.setKey(MOUSE_RIGHT, false);
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        this.input.setKey(MOUSE_LEFT, false);
        this.input.setKey(MOUSE_RIGHT, false);
      },
      { signal },
    );
  }

  /** Tell it the game time (for `recent`). */
  tick(now: number): void {
    this.now = now;
  }

  /** The mouse was used in the last `seconds`. */
  recent(seconds = 4): boolean {
    return this.active && this.now - this.lastUsed <= seconds;
  }

  /** Point on the horizontal plane at height `y` under the cursor, or null. */
  ground(camera: Camera, y: number, out = new Vector3()): Vector3 | null {
    if (!this.active) return null;
    camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, camera);
    this.plane.constant = -y;
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  dispose(): void {
    this.abort.abort();
  }
}
