import { describe, expect, it } from 'vitest';
import { ADAPTIVE_ASPECT, RESOLUTIONS, type Resolution, computeFraming, snapToGrid, worldUnitsPerPixel } from './framing';

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

describe('computeFraming (adaptive aspect)', () => {
  const adaptive = (w: number, h: number, dpr: number, res: Resolution = RESOLUTIONS.default) => computeFraming(w, h, dpr, res, 'adaptive');

  it('matches fixed framing on 16:9 screens', () => {
    for (const [w, h] of [[960, 540], [1920, 1080], [1280, 720]] as const) {
      for (const res of Object.values(RESOLUTIONS)) expect(adaptive(w, h, 1, res)).toEqual(computeFraming(w, h, 1, res));
    }
  });

  it('keeps the art height and widens the art to the screen (landscape phone)', () => {
    const f = adaptive(844, 390, 3); // 2532×1170 device pixels
    expect(f).toMatchObject({ scale: 4, integer: true, artHeight: 270, artWidth: 584, canvasWidth: 2336, canvasHeight: 1080 });
  });

  it('narrows the art for a portrait phone and fills most of the screen', () => {
    const f = adaptive(390, 844, 3); // 1170×2532 device pixels
    expect(f).toMatchObject({ scale: 9, integer: true, artHeight: 270, artWidth: 124 });
    expect((f.cssWidth * f.cssHeight) / (390 * 844)).toBeGreaterThan(0.9);
    // Fixed 16:9 shows a thin strip on the same screen.
    const fixed = computeFraming(390, 844, 3, RESOLUTIONS.default);
    expect((fixed.cssWidth * fixed.cssHeight) / (390 * 844)).toBeLessThan(0.2);
  });

  it('clamps extreme aspect ratios and letterboxes beyond them', () => {
    const wide = adaptive(3440, 540, 1);
    expect(wide.artWidth).toBeLessThanOrEqual(270 * ADAPTIVE_ASPECT.max);
    expect(wide.cssWidth).toBeLessThan(3440);
    const tall = adaptive(200, 1080, 1);
    expect(tall.artWidth / tall.artHeight).toBeGreaterThanOrEqual(ADAPTIVE_ASPECT.min);
    expect(tall.canvasWidth).toBeLessThanOrEqual(200);
    expect(tall.integer).toBe(true);
  });

  it('is integer-scaled, even-width and never larger than the viewport', () => {
    for (const [w, h, dpr] of [[1366, 768, 1], [390, 844, 3], [844, 390, 3], [2560, 1440, 1.25], [800, 450, 1], [1024, 1366, 2], [360, 740, 4]] as const) {
      for (const res of Object.values(RESOLUTIONS)) {
        const f = adaptive(w, h, dpr, res);
        expect(f.cssWidth).toBeLessThanOrEqual(w);
        expect(f.cssHeight).toBeLessThanOrEqual(h);
        expect(f.artHeight).toBe(res.height);
        expect(f.artWidth % 2).toBe(0);
        expect(f.canvasWidth).toBe(f.artWidth * f.scale);
        expect(f.canvasHeight).toBe(f.artHeight * f.scale);
        expect(f.integer && Number.isInteger(f.scale)).toBe(true);
      }
    }
  });

  it('falls back to a downscale with the screen aspect when the viewport is tiny', () => {
    const f = adaptive(240, 200, 1);
    expect(f).toMatchObject({ scale: 1, integer: false, artHeight: 270, artWidth: 324 });
    expect(f.cssWidth).toBeCloseTo(240);
    expect(f.cssHeight).toBeCloseTo(200);
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
