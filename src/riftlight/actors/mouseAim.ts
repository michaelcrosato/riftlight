import { type Camera, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu';

/** The parts of the engine's Input this reads. */
export interface PointerSource {
  readonly pointer: { readonly x: number; readonly y: number; readonly over: boolean; readonly touch: boolean };
  isDown(...codes: string[]): boolean;
}

/**
 * Mouse aiming for the ARPG controller: the cursor over the game canvas (`ctx.input.pointer`)
 * as a point on the ground plane under it. The mouse buttons are the engine's keys
 * (`MouseLeft` / `MouseRight`, HERO_KEYS), so they buffer and combine exactly like keyboard
 * keys, and a recording replays the aim and the clicks alike.
 */
export class MouseAim {
  /** Cursor in normalized device coordinates (−1..1), and whether it has been used. */
  readonly ndc = new Vector2();
  active = false;
  /** Game-time of the last mouse movement or click (aim falls back to auto-aim after a while). */
  lastUsed = -Infinity;
  private readonly ray = new Raycaster();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private now = 0;

  constructor(private readonly input: PointerSource | null) {}

  /** Tell it the game time (for `recent`) and read where the mouse is. */
  tick(now: number): void {
    this.now = now;
    const p = this.input?.pointer;
    if (!p?.over || p.touch) return;
    const moved = !this.active || p.x !== this.ndc.x || p.y !== this.ndc.y;
    if (moved || this.input!.isDown('MouseLeft', 'MouseRight')) {
      this.ndc.set(p.x, p.y);
      this.active = true;
      this.lastUsed = now;
    }
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

  /** Nothing to let go of: the pointer is the engine's. */
  dispose(): void {}
}
