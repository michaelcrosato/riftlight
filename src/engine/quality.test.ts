import { describe, expect, it } from 'vitest';
import { FrameLimiter, QUALITY, QUALITY_LEVELS, defaultQuality, qualityForFps } from './quality';

/** Run a limiter against a display refreshing at `hz` for `seconds`; returns frames run. */
function simulate(limiter: FrameLimiter, hz: number, seconds: number, jitterMs = 0): number {
  let ran = 0;
  for (let i = 0; i < hz * seconds; i++) {
    const jitter = jitterMs ? Math.sin(i * 12.9898) * jitterMs : 0;
    if (limiter.shouldRun((i * 1000) / hz + jitter)) ran++;
  }
  return ran;
}

describe('quality presets', () => {
  it('shadow maps grow with quality, 512² by default on desktop', () => {
    const sizes = QUALITY_LEVELS.map((l) => QUALITY[l].shadowMapSize);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(QUALITY[defaultQuality({ coarsePointer: false })].shadowMapSize).toBe(512);
    expect(defaultQuality({ coarsePointer: true })).toBe('low');
  });

  it('lowers quality once on a slow start, never raises it', () => {
    expect(qualityForFps('medium', 58, 60)).toBe('medium');
    expect(qualityForFps('high', 40, 60)).toBe('medium');
    expect(qualityForFps('high', 12, 60)).toBe('low');
    expect(qualityForFps('low', 5, 60)).toBe('low');
    expect(qualityForFps('low', 60, 60)).toBe('low');
  });
});

describe('FrameLimiter', () => {
  it('runs every frame of a 60 Hz display, even with jitter', () => {
    expect(simulate(new FrameLimiter(60), 60, 10)).toBe(600);
    expect(simulate(new FrameLimiter(60), 60, 10, 1)).toBe(600);
  });

  it('halves a 120 Hz display and caps 90 / 144 Hz near 60', () => {
    expect(simulate(new FrameLimiter(60), 120, 10)).toBe(600);
    for (const hz of [90, 144, 165]) {
      const ran = simulate(new FrameLimiter(60), hz, 10, 0.5);
      expect(ran).toBeGreaterThanOrEqual(585);
      expect(ran).toBeLessThanOrEqual(605);
    }
  });

  it('can cap lower (30) or not at all (0)', () => {
    expect(simulate(new FrameLimiter(30), 60, 10)).toBe(300);
    expect(simulate(new FrameLimiter(0), 144, 1)).toBe(144);
  });

  it('restarts after a stall instead of bursting to catch up', () => {
    const l = new FrameLimiter(60);
    expect(l.shouldRun(0)).toBe(true);
    expect(l.shouldRun(5000)).toBe(true); // tab was hidden
    expect(l.shouldRun(5008)).toBe(false);
    expect(l.shouldRun(5016.7)).toBe(true);
  });
});
