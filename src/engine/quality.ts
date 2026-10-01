/**
 * Render quality presets. Pure data + decisions (no DOM, no three.js): unit-tested.
 *
 * The pixel pipeline is cheap by design (the scene and every art-pixel filter render at
 * the art resolution), so quality only trades the shadow map size. `auto` picks `low` on
 * phones/tablets and `medium` elsewhere, then lowers it once if the first seconds of play
 * run well below the frame-rate target.
 */
export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityOption = QualityLevel | 'auto';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualitySettings {
  /** Directional-light shadow map size (texels per side). */
  readonly shadowMapSize: number;
}

/**
 * At the iso preset's default zoom the shadow box spans ~30 world units, i.e. ~600 art
 * pixels: 512² is about one shadow texel per art pixel, 1024² is finer than the art can show.
 */
export const QUALITY: Readonly<Record<QualityLevel, QualitySettings>> = {
  low: { shadowMapSize: 256 },
  medium: { shadowMapSize: 512 },
  high: { shadowMapSize: 1024 },
};

/** Starting level for `auto`: phones and tablets (coarse pointer, no hover) start low. */
export function defaultQuality(env: { coarsePointer: boolean }): QualityLevel {
  return env.coarsePointer ? 'low' : 'medium';
}

/**
 * The one-shot `auto` adjustment after the startup measurement: one level down below 75%
 * of the target frame rate, straight to `low` below 40%. Never raises quality.
 */
export function qualityForFps(level: QualityLevel, fps: number, targetFps: number): QualityLevel {
  const i = QUALITY_LEVELS.indexOf(level);
  if (fps < 0.4 * targetFps) return 'low';
  if (fps < 0.75 * targetFps) return QUALITY_LEVELS[Math.max(0, i - 1)]!;
  return level;
}

/**
 * Frame cap for `requestAnimationFrame` loops. Returns whether the frame at `now` (ms)
 * should run, and advances the schedule so the long-run rate is `maxFps` even when the
 * display rate isn't a multiple of it (90 Hz, 144 Hz) and timestamps jitter.
 */
export class FrameLimiter {
  private next = -1;

  constructor(public maxFps: number) {}

  shouldRun(now: number): boolean {
    if (!(this.maxFps > 0)) return true;
    const interval = 1000 / this.maxFps;
    // Small tolerance: a 60 Hz display's timestamps jitter around 16.67 ms.
    if (this.next >= 0 && now < this.next - 2) return false;
    // Schedule the next slot on the fixed grid; after a long stall, restart from now.
    this.next = this.next < 0 || now - this.next > interval ? now + interval : this.next + interval;
    return true;
  }
}
