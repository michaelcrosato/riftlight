/**
 * Keeps procedural corrections from popping. Each channel follows its target with the
 * target's own velocity, up to `maxSpeed`: a correction that tracks something steadily (a
 * locked foot against a moving body) follows it exactly, with no lag. Whatever the target
 * moves beyond that in a frame (it switched on, re-targeted, hit a constraint) becomes an
 * error that decays like a critically damped spring, so it eases over in a few frames
 * instead of jumping in one.
 *
 * One instance guards `n` scalar channels (joint angles in radians, offsets in metres).
 */
export class PopGuard {
  private readonly last: Float64Array;
  /** Output minus target, and its rate of change. */
  private readonly err: Float64Array;
  private readonly errVel: Float64Array;
  private fresh = true;

  /**
   * @param n channels
   * @param omega how fast an absorbed jump eases out (rad/s; settled in about 5/omega s)
   * @param maxSpeed per channel: the fastest the target is followed as it is (units/s)
   */
  constructor(
    readonly n: number,
    private readonly omega: number,
    private readonly maxSpeed: number[],
  ) {
    this.last = new Float64Array(n);
    this.err = new Float64Array(n);
    this.errVel = new Float64Array(n);
  }

  /** Forget everything (teleports): the next targets are taken as they are. */
  reset(): void {
    this.fresh = true;
    this.err.fill(0);
    this.errVel.fill(0);
  }

  /** Change channel `i`'s speed limit (units/s), e.g. while a deliberate fast move runs. */
  setMaxSpeed(i: number, v: number): void {
    this.maxSpeed[i] = v;
  }

  /** Is a jump still easing out? */
  active(): boolean {
    for (let i = 0; i < this.n; i++) if (Math.abs(this.err[i]!) > 1e-5 || Math.abs(this.errVel[i]!) > 1e-4) return true;
    return false;
  }

  /** Current error (output − target) of channel `i`. */
  error(i: number): number {
    return this.err[i]!;
  }

  /** Feed this frame's targets (`values`, length n); they are replaced by the guarded values. */
  apply(values: number[], dt: number): number[] {
    if (this.fresh || dt <= 0) {
      for (let i = 0; i < this.n; i++) {
        this.last[i] = values[i]!;
        values[i] = values[i]! + this.err[i]!;
      }
      this.fresh = false;
      return values;
    }
    const w = this.omega;
    const e = Math.exp(-w * dt);
    for (let i = 0; i < this.n; i++) {
      const t = values[i]!;
      const moved = t - this.last[i]!;
      const lim = this.maxSpeed[i]! * dt;
      // the part of this frame's move beyond the speed limit is a jump: the output doesn't take it
      const jump = moved - Math.max(-lim, Math.min(lim, moved));
      // the error eases toward 0 (critically damped), then takes the jump
      const x = this.err[i]!;
      const v = this.errVel[i]!;
      const j0 = v + w * x;
      this.err[i] = (x + j0 * dt) * e - jump;
      this.errVel[i] = (v - w * j0 * dt) * e;
      this.last[i] = t;
      values[i] = t + this.err[i]!;
    }
    return values;
  }
}
