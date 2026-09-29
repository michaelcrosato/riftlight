import { describe, expect, it } from 'vitest';
import { RESOLUTIONS, computeFraming, snapToGrid, worldUnitsPerPixel } from './framing';

describe('computeFraming', () => {
  it('uses the largest integer scale that fits (1080p, dpr 1)', () => {
    const f = computeFraming(1920, 1080, 1, RESOLUTIONS.default);
    expect(f).toMatchObject({ scale: 4, integer: true, canvasWidth: 1920, canvasHeight: 1080, offsetX: 0, offsetY: 0 });
  });

  it('keeps the same on-screen framing for both resolutions at 1080p', () => {
    const a = computeFraming(1920, 1080, 1, RESOLUTIONS.default);
    const b = computeFraming(1920, 1080, 1, RESOLUTIONS.compare);
    expect(b.scale).toBe(6);
    expect([b.cssWidth, b.cssHeight]).toEqual([a.cssWidth, a.cssHeight]);
  });

  it('letterboxes instead of stretching', () => {
    const f = computeFraming(1000, 1000, 1, RESOLUTIONS.default);
    expect(f.scale).toBe(2);
    expect([f.canvasWidth, f.canvasHeight]).toEqual([960, 540]);
    expect([f.offsetX, f.offsetY]).toEqual([20, 230]);
  });

  it('works in device pixels on HiDPI screens', () => {
    const f = computeFraming(1280, 720, 2, RESOLUTIONS.default);
    expect(f.scale).toBe(5); // 2560/480 = 5.33
    expect(f.canvasWidth).toBe(2400);
    expect(f.cssWidth).toBe(1200);
    expect(f.offsetX).toBe(40);
  });

  it('never has a canvas larger than the viewport', () => {
    for (const [w, h, dpr] of [[1366, 768, 1], [390, 844, 3], [2560, 1440, 1.25], [800, 450, 1]] as const) {
      for (const res of Object.values(RESOLUTIONS)) {
        const f = computeFraming(w, h, dpr, res);
        expect(f.cssWidth).toBeLessThanOrEqual(w);
        expect(f.cssHeight).toBeLessThanOrEqual(h);
        expect(f.canvasWidth / f.canvasHeight).toBeCloseTo(res.width / res.height, 5);
        if (f.integer) expect(Number.isInteger(f.scale)).toBe(true);
      }
    }
  });

  it('falls back to a letterboxed downscale when the viewport is tiny', () => {
    const f = computeFraming(240, 200, 1, RESOLUTIONS.default);
    expect(f).toMatchObject({ scale: 1, integer: false, canvasWidth: 480, canvasHeight: 270 });
    expect(f.cssWidth).toBe(240);
    expect(f.cssHeight).toBe(135);
  });
});

describe('pixel grid helpers', () => {
  it('computes world units per art pixel', () => {
    expect(worldUnitsPerPixel(13.5, RESOLUTIONS.default)).toBeCloseTo(0.05);
  });
  it('snaps to the nearest grid step', () => {
    expect(snapToGrid(1.26, 0.05)).toBeCloseTo(1.25);
    expect(snapToGrid(-0.024, 0.05)).toBeCloseTo(0);
  });
});
