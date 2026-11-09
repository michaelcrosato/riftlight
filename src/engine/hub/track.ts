/**
 * Another copy's state, drawn smoothly (docs/engine/hub.md): what arrives over the hub comes a
 * few times a second, late and unevenly. A `RemoteTrack` keeps the last snapshots, each stamped
 * with the sender's time, and samples them `delay` seconds behind the newest, so a ghost or a
 * shared world's monster moves evenly between them. Times are game time on both sides (the
 * sender's `ctx.time` in the message, the receiver's `ctx.time` when it arrived), so a session
 * replays exactly.
 *
 *   track.push(msg.t, ctx.time, msg.pos);                         // as a message arrives
 *   const pos = track.sample(ctx.time, (a, b, k) => lerp(a, b, k)); // every frame
 */
export interface RemoteTrackOptions {
  /** Seconds drawn behind the newest snapshot: covers the gaps between messages (default 0.12). */
  readonly delay?: number;
  /** Snapshots kept (default 32). */
  readonly keep?: number;
  /** Seconds past the newest snapshot it may run on before it holds still (default 0.25). */
  readonly extrapolate?: number;
}

interface Stamp<T> {
  readonly t: number;
  readonly value: T;
}

export class RemoteTrack<T> {
  private readonly delay: number;
  private readonly keep: number;
  private readonly ahead: number;
  private stamps: Stamp<T>[] = [];
  /** The receiver's clock minus the sender's, at the fastest arrival seen: this side's view of their time. */
  private offset: number | null = null;
  /** The receiver's time of the last arrival. */
  lastArrival = -Infinity;

  constructor(options: RemoteTrackOptions = {}) {
    this.delay = options.delay ?? 0.12;
    this.keep = options.keep ?? 32;
    this.ahead = options.extrapolate ?? 0.25;
  }

  /** Snapshots held. */
  get size(): number {
    return this.stamps.length;
  }

  /** The newest snapshot, as sent. */
  get latest(): T | null {
    return this.stamps.at(-1)?.value ?? null;
  }

  /** A snapshot taken at the sender's time `senderTime`, arriving at the receiver's time `now`. */
  push(senderTime: number, now: number, value: T): void {
    if (!Number.isFinite(senderTime)) return;
    const last = this.stamps.at(-1);
    if (last && senderTime <= last.t) {
      if (senderTime < last.t - 1) this.clear(); // the sender's clock went back: a new level, start over
      else return; // late or repeated: older than what we have
    }
    const gap = now - senderTime;
    // The fastest arrival is the least delayed: take it as the clock offset; let it drift up slowly.
    this.offset = this.offset === null ? gap : Math.min(gap, this.offset + 0.002);
    this.lastArrival = now;
    this.stamps.push({ t: senderTime, value });
    if (this.stamps.length > this.keep) this.stamps.splice(0, this.stamps.length - this.keep);
  }

  /** The value to draw at the receiver's time `now`; null before anything arrived. */
  sample(now: number, lerp: (a: T, b: T, k: number) => T): T | null {
    const s = this.stamps;
    if (!s.length || this.offset === null) return null;
    const at = now - this.offset - this.delay; // in the sender's time
    if (at <= s[0]!.t) return s[0]!.value;
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (at >= a.t && at <= b.t) return lerp(a.value, b.value, b.t > a.t ? (at - a.t) / (b.t - a.t) : 1);
    }
    // Past the newest: run on a little along the last step, then hold.
    const b = s.at(-1)!;
    const a = s.at(-2);
    if (!a || b.t <= a.t) return b.value;
    const over = Math.min(at - b.t, this.ahead);
    return lerp(a.value, b.value, 1 + over / (b.t - a.t));
  }

  /** Forget everything (the sender left, or a new level). */
  clear(): void {
    this.stamps = [];
    this.offset = null;
    this.lastArrival = -Infinity;
  }
}

/** Angles in radians, the short way round (for facings). */
export function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
