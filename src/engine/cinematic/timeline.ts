/**
 * Cutscenes as data: camera keys the camera glides through on a smooth curve (or cuts to),
 * cues that fire once when the playhead passes them (an actor starts walking, a door opens, a
 * sound), subtitles, and letterbox bars that slide in and out. The timeline only keeps time
 * and answers "where is the camera now, what line is showing": the game puts the camera
 * there and draws the bars, so it works with any camera and any HUD.
 *
 *   const scene = new Timeline({
 *     shots: [
 *       { at: 0, position: [0, 2, 9], target: [0, 1, 0] },
 *       { at: 4, position: [6, 3, 4], target: [0, 1, 0] },   // a glide from the first key
 *       { at: 4, position: [1, 1.6, 2], target: [0, 1.5, 0], cut: true },  // a cut
 *     ],
 *     cues: [{ at: 1, name: 'wave', run: () => actor.play('Wave') }],
 *     lines: [{ at: 0.5, until: 3, who: 'GUIDE', text: 'Welcome.' }],
 *   });
 *   scene.play();
 *   scene.update(dt);                       // per frame: fires the cues it passes
 *   const shot = scene.camera();            // { position, target, fov }
 *   scene.skip();                           // to the end: cues that matter still fire
 *
 * Pure (no three.js): unit-tested.
 */

export type V3 = readonly [number, number, number];

export interface CameraKey {
  /** Time (s) the camera is exactly here. */
  at: number;
  position: V3;
  /** The point it looks at. */
  target: V3;
  /** Vertical field of view (degrees); default the previous key's, or 50. */
  fov?: number;
  /** Jump here instead of gliding from the key before (a cut to a new shot). */
  cut?: boolean;
}

export interface Cue {
  at: number;
  name?: string;
  run: () => void;
  /**
   * Cosmetic (a sound, a puff of dust): not run when the scene is skipped past it. Cues that
   * change the world (a door left open, an item given) are run on skip so the world ends up
   * the same either way.
   */
  cosmetic?: boolean;
}

export interface Line {
  at: number;
  until: number;
  text: string;
  /** Who is speaking (shown before the text). */
  who?: string;
}

export interface CameraShot {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface TimelineOptions {
  shots?: readonly CameraKey[];
  cues?: readonly Cue[];
  lines?: readonly Line[];
  /** Length (s); default the last key, cue or line. */
  duration?: number;
  /** Seconds the letterbox bars take to slide in and out (default 0.6; 0: no bars). */
  bars?: number;
  /** Called once when the playhead reaches the end (or the scene is skipped). */
  onEnd?: () => void;
}

/** Hermite between a and b with tangents ma, mb (per unit u) at u in 0..1. */
const hermite = (a: number, b: number, ma: number, mb: number, u: number) => {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * ma + (-2 * u3 + 3 * u2) * b + (u3 - u2) * mb;
};

export class Timeline {
  readonly duration: number;
  /** The playhead (s). */
  time = 0;
  playing = false;
  /** Playback rate (1: real time, 0.5: slow motion). */
  speed = 1;
  /** True once the end has been reached (by playing or skipping). */
  ended = false;
  /** Cue names in the order they fired (tests and tools). */
  readonly fired: string[] = [];
  private readonly keys: (CameraKey & { fov: number })[];
  private readonly cues: Cue[];
  private readonly lines: readonly Line[];
  private readonly barTime: number;
  private readonly onEnd?: () => void;
  /** How many cues (in time order) have fired. */
  private next = 0;
  /** Bumped by every seek and skip: a cue that moves the playhead stops the cues after it. */
  private jumps = 0;
  /** Inside skip(): cues run to the end whatever they do to the playhead. */
  private skipping = false;

  constructor(o: TimelineOptions) {
    let fov = 50;
    this.keys = [...(o.shots ?? [])]
      .map((k, i) => ({ k, i }))
      .sort((a, b) => a.k.at - b.k.at || a.i - b.i)
      .map(({ k }) => ({ ...k, fov: (fov = k.fov ?? fov) }));
    this.cues = [...(o.cues ?? [])].sort((a, b) => a.at - b.at);
    this.lines = o.lines ?? [];
    const ends = [...this.keys.map((k) => k.at), ...this.cues.map((c) => c.at), ...this.lines.map((l) => l.until)];
    this.duration = o.duration ?? Math.max(0, ...ends);
    this.barTime = o.bars ?? 0.6;
    this.onEnd = o.onEnd;
  }

  play(): void {
    if (this.ended) this.seek(0);
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** Advance by `dt` seconds of game time (times `speed`) while playing, firing the cues passed. */
  update(dt: number): void {
    if (!this.playing || this.ended) return;
    this.time = Math.min(this.duration, this.time + dt * this.speed);
    this.fireUpTo(this.time, false);
    if (!this.ended && this.playing && this.time >= this.duration) this.finish(); // a cue may have skipped or paused
  }

  /**
   * Move the playhead to `t` without firing the cues in between (scrubbing). Cues before `t`
   * count as done and cues after it will fire again (going back re-arms them). Ignored while
   * skipping (a cue that loops back cannot undo a skip).
   */
  seek(t: number): void {
    if (this.skipping) return;
    this.jumps++;
    this.time = Math.max(0, Math.min(this.duration, t));
    this.ended = false;
    this.next = 0;
    while (this.next < this.cues.length && this.cues[this.next]!.at < this.time) this.next++;
  }

  /**
   * Jump to the end: the cues not yet fired run (except the cosmetic ones), then `onEnd`. Cues
   * after `duration` never fire, played or skipped.
   */
  skip(): void {
    if (this.ended || this.skipping) return;
    this.jumps++;
    this.time = this.duration;
    this.skipping = true;
    try {
      this.fireUpTo(this.duration, true);
    } finally {
      this.skipping = false;
    }
    this.time = this.duration;
    this.finish();
  }

  private fireUpTo(t: number, skipping: boolean): void {
    const jumps = this.jumps;
    while (this.next < this.cues.length && this.cues[this.next]!.at <= t) {
      const c = this.cues[this.next++]!;
      if (skipping && c.cosmetic) continue;
      this.fired.push(c.name ?? `cue@${c.at}`);
      c.run();
      // played: a cue that moved the playhead (seek, skip) or paused decides what fires next
      if (!skipping && (this.jumps !== jumps || !this.playing)) return;
    }
  }

  private finish(): void {
    if (this.ended) return;
    this.playing = false;
    this.ended = true;
    this.onEnd?.();
  }

  /**
   * Where the camera is at `t` (default now): on each key at its time, gliding between keys
   * on a smooth curve (Catmull-Rom tangents, so the speed has no jolt at a key; the first and
   * last key of each shot ease in and out). A `cut` key starts a new shot. Null without keys.
   */
  camera(t = this.time): CameraShot | null {
    const k = this.keys;
    if (k.length === 0) return null;
    // the last key at or before t (cuts at the same time: the later one wins)
    let i = 0;
    while (i + 1 < k.length && k[i + 1]!.at <= t) i++;
    const a = k[i]!;
    const b = k[i + 1];
    if (t <= a.at || !b || b.cut) return { position: [...a.position], target: [...a.target], fov: a.fov };
    // the shot this segment belongs to: keys from the last cut to the next one
    const prev = i > 0 && !a.cut ? k[i - 1]! : null;
    const after = k[i + 2] && !k[i + 2]!.cut ? k[i + 2]! : null;
    const span = b.at - a.at;
    const u = (t - a.at) / span;
    // tangents per second (finite differences across the neighbouring keys), times span
    const slope = (p: number, q: number, tp: number, tq: number) => ((q - p) / (tq - tp)) * span;
    const lerp = (get: (key: CameraKey & { fov: number }) => number) => {
      const ma = prev ? slope(get(prev), get(b), prev.at, b.at) : 0;
      const mb = after ? slope(get(a), get(after), a.at, after.at) : 0;
      return hermite(get(a), get(b), ma, mb, u);
    };
    const v = (f: 'position' | 'target'): [number, number, number] => [lerp((x) => x[f][0]), lerp((x) => x[f][1]), lerp((x) => x[f][2])];
    return { position: v('position'), target: v('target'), fov: lerp((x) => x.fov) };
  }

  /** The subtitle showing at `t` (default now), or null. */
  line(t = this.time): Line | null {
    let found: Line | null = null;
    for (const l of this.lines) if (t >= l.at && t < l.until) found = l;
    return found;
  }

  /** How far the letterbox bars are in (0..1) at `t` (default now): sliding in at the start, out at the end. */
  bars(t = this.time): number {
    if (this.barTime <= 0) return 0;
    const s = Math.max(0, Math.min(1, t / this.barTime, (this.duration - t) / this.barTime));
    return s * s * (3 - 2 * s);
  }
}
