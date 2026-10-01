import { Vector3 } from 'three/webgpu';

/**
 * Screen shake as "trauma" (0..1): hits add trauma, it decays, and the camera offset is
 * maxOffset × trauma² × smooth noise. Deterministic (sums of sines of game time, no
 * Math.random), so films and tests see the same shake.
 *
 * Wire it in the game's `update`, before the engine's camera update:
 *
 *   combat.shake.apply(ctx.camera, dt);   // nudges the rig's focus; ortho rigs snap it to art pixels
 *
 * or read `shake.offset` and add it wherever the game builds its camera target.
 */
export class CameraShake {
  trauma = 0;
  /** World units at full trauma. */
  maxOffset = 0.35;
  /** Trauma lost per second. */
  decay = 1.6;
  /** Global multiplier (settings: 0 turns shake off). */
  strength = 1;
  readonly offset = new Vector3();
  private t = 0;
  private readonly applied = new Vector3();

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  /** Advance and compute `offset`. */
  update(dt: number): Vector3 {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const k = this.maxOffset * this.trauma * this.trauma * this.strength;
    const t = this.t;
    this.offset.set(
      k * (Math.sin(t * 41.3) * 0.6 + Math.sin(t * 73.7 + 1.3) * 0.4),
      k * 0.6 * (Math.sin(t * 37.1 + 2.1) * 0.6 + Math.sin(t * 89.9 + 0.7) * 0.4),
      k * (Math.sin(t * 47.9 + 4.2) * 0.6 + Math.sin(t * 67.3 + 3.1) * 0.4),
    );
    return this.offset;
  }

  /** Update and move a camera rig's focus by the change in offset since the last call. */
  apply(rig: { readonly focus: Vector3 }, dt: number): void {
    rig.focus.sub(this.applied);
    this.update(dt);
    rig.focus.add(this.offset);
    this.applied.copy(this.offset);
  }

  reset(): void {
    this.trauma = 0;
    this.offset.set(0, 0, 0);
    this.applied.set(0, 0, 0);
  }
}
