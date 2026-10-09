/**
 * Game time from real time: a speed (`engine.timeScale`: slow motion, fast forward, 0 to
 * freeze) and hitstops (the game freezes for a few real seconds when a hit lands). Pure; the
 * engine runs every frame's real `dt` through `delta()`.
 */
export class GameClock {
  private _scale = 1;
  private stop = 0;

  /** Game seconds per real second (≥ 0; anything not a number is ignored). */
  get scale(): number {
    return this._scale;
  }

  set scale(v: number) {
    if (Number.isFinite(v)) this._scale = Math.max(0, v);
  }

  /** Real seconds of hitstop left. */
  get hitstop(): number {
    return this.stop;
  }

  /** Game time can't move (speed 0): presses queued now must not fire later. */
  get frozen(): boolean {
    return this._scale <= 0;
  }

  /** Freeze for `seconds` of real time (overlapping freezes keep the longest). */
  freeze(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.stop = Math.max(this.stop, seconds);
  }

  /** Game seconds for `dt` real seconds (and the hitstop runs down). */
  delta(dt: number): number {
    if (this.stop > 0) {
      const frozen = Math.min(this.stop, dt);
      this.stop -= frozen;
      dt -= frozen;
    }
    return dt * this._scale;
  }

  reset(): void {
    this._scale = 1;
    this.stop = 0;
  }
}
