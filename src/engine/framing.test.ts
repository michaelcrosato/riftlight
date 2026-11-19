import { describe, expect, it } from 'vitest';
import { ADAPTIVE_ASPECT, RESOLUTIONS, type Resolution, computeFraming, frameView, snapToGrid, touchScale, worldUnitsPerPixel } from './framing';

describe('computeFraming', () => {
  it('fills by default: the whole window at every shape (52in1), as EngineOptions.aspect', () => {
    for (const [w, h] of [[1600, 900], [2100, 900], [1200, 900], [390, 844]] as const) {
      const f = computeFraming(w, h, 1, RESOLUTIONS.default);
      expect(f).toEqual(computeFraming(w, h, 1, RESOLUTIONS.default, 'fill'));
      expect([f.offsetX <= 0, f.offsetY <= 0, f.offsetX + f.cssWidth >= w, f.offsetY + f.cssHeight >= h], `${w}×${h}`).toEqual([true, true, true, true]);
    }
  });

  it('uses the largest integer scale that fits (1080p, dpr 1)', () => {
    const f = computeFraming(1920, 1080, 1, RESOLUTIONS.default, 'fixed');
    expect(f).toMatchObject({ scale: 4, integer: true, canvasWidth: 1920, canvasHeight: 1080, offsetX: 0, offsetY: 0 });
  });

  it('keeps the same on-screen framing for both resolutions at 1080p', () => {
    const a = computeFraming(1920, 1080, 1, RESOLUTIONS.default, 'fixed');
    const b = computeFraming(1920, 1080, 1, RESOLUTIONS.compare, 'fixed');
    expect(b.scale).toBe(6);
    expect([b.cssWidth, b.cssHeight]).toEqual([a.cssWidth, a.cssHeight]);
  });

  it('letterboxes instead of stretching', () => {
    const f = computeFraming(1000, 1000, 1, RESOLUTIONS.default, 'fixed');
    expect(f.scale).toBe(2);
    expect([f.canvasWidth, f.canvasHeight]).toEqual([960, 540]);
    expect([f.offsetX, f.offsetY]).toEqual([20, 230]);
  });

  it('works in device pixels on HiDPI screens', () => {
    const f = computeFraming(1280, 720, 2, RESOLUTIONS.default, 'fixed');
    expect(f.scale).toBe(5); // 2560/480 = 5.33
    expect(f.canvasWidth).toBe(2400);
    expect(f.cssWidth).toBe(1200);
    expect(f.offsetX).toBe(40);
  });

  it('never has a canvas larger than the viewport', () => {
    for (const [w, h, dpr] of [[1366, 768, 1], [390, 844, 3], [2560, 1440, 1.25], [800, 450, 1]] as const) {
      for (const res of Object.values(RESOLUTIONS)) {
        const f = computeFraming(w, h, dpr, res, 'fixed');
        expect(f.cssWidth).toBeLessThanOrEqual(w);
        expect(f.cssHeight).toBeLessThanOrEqual(h);
        expect(f.canvasWidth / f.canvasHeight).toBeCloseTo(res.width / res.height, 5);
        if (f.integer) expect(Number.isInteger(f.scale)).toBe(true);
      }
    }
  });

  it('falls back to a letterboxed downscale when the viewport is tiny', () => {
    const f = computeFraming(240, 200, 1, RESOLUTIONS.default, 'fixed');
    expect(f).toMatchObject({ scale: 1, integer: false, canvasWidth: 480, canvasHeight: 270 });
    expect(f.cssWidth).toBe(240);
    expect(f.cssHeight).toBe(135);
  });
});

describe('computeFraming (adaptive aspect)', () => {
  const adaptive = (w: number, h: number, dpr: number, res: Resolution = RESOLUTIONS.default) => computeFraming(w, h, dpr, res, 'adaptive');

  it('matches fixed framing on 16:9 screens', () => {
    for (const [w, h] of [[960, 540], [1920, 1080], [1280, 720]] as const) {
      for (const res of Object.values(RESOLUTIONS)) expect(adaptive(w, h, 1, res)).toEqual(computeFraming(w, h, 1, res, 'fixed'));
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
    const fixed = computeFraming(390, 844, 3, RESOLUTIONS.default, 'fixed');
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

describe('computeFraming (fill)', () => {
  it('fills a 1440p desktop instead of leaving the 80px/45px border', () => {
    expect(computeFraming(2560, 1440, 1, RESOLUTIONS.default, 'fill')).toMatchObject({
      artWidth: 512, artHeight: 288, scale: 5, integer: true,
      canvasWidth: 2560, canvasHeight: 1440, offsetX: 0, offsetY: 0,
    });
  });

  it('preserves exact pixel blocks and covers every viewport edge for both presets', () => {
    for (const [w, h, dpr] of [[1366, 768, 1], [1920, 1080, 1], [2560, 1440, 1], [2560, 1600, 1], [3440, 1440, 1], [3840, 1080, 1], [1280, 720, 2], [1536, 864, 1.25], [1365, 767, 1.25], [390, 844, 3], [844, 390, 3], [240, 200, 1]] as const) {
      for (const res of Object.values(RESOLUTIONS)) {
        const f = computeFraming(w, h, dpr, res, 'fill');
        const dw = Math.ceil(w * dpr), dh = Math.ceil(h * dpr);
        expect(f.integer && Number.isInteger(f.scale)).toBe(true);
        expect(f.canvasWidth).toBe(f.artWidth * f.scale);
        expect(f.canvasHeight).toBe(f.artHeight * f.scale);
        expect(f.cssWidth / f.artWidth).toBeCloseTo(f.cssHeight / f.artHeight, 10);
        expect(f.offsetX).toBeLessThanOrEqual(0);
        expect(f.offsetY).toBeLessThanOrEqual(0);
        expect(f.offsetX + f.cssWidth).toBeGreaterThanOrEqual(w);
        expect(f.offsetY + f.cssHeight).toBeGreaterThanOrEqual(h);
        expect(f.canvasWidth - dw).toBeLessThan(f.scale);
        expect(f.canvasHeight - dh).toBeLessThan(f.scale);
        expect(Number.isInteger(f.offsetX * dpr)).toBe(true);
        expect(Number.isInteger(f.offsetY * dpr)).toBe(true);
      }
    }
  });

  it('keeps exact 1080p framing and resolution switching unchanged', () => {
    for (const res of Object.values(RESOLUTIONS)) {
      expect(computeFraming(1920, 1080, 1, res, 'fill')).toEqual(computeFraming(1920, 1080, 1, res, 'fixed'));
    }
  });
});

describe('frameView (both views: PixelRenderer and HeadlessView)', () => {
  const D = RESOLUTIONS.default;
  const C = RESOLUTIONS.compare;
  const art = (v: { width: number; height: number; dpr: number }, base: Resolution, aspect: 'fill' | 'adaptive' | 'fixed', current: Resolution = base) => frameView(v, base, aspect, current);

  it('fill: the art follows the viewport at the integer scale nearest the preset height', () => {
    expect(art({ width: 960, height: 540, dpr: 1 }, D, 'fill').framing).toMatchObject({ artWidth: 480, artHeight: 270, scale: 2 });
    expect(art({ width: 1000, height: 540, dpr: 1 }, D, 'fill').resolution).toEqual({ width: 500, height: 270 });
    expect(art({ width: 960, height: 540, dpr: 2 }, D, 'fill').framing).toMatchObject({ artWidth: 480, artHeight: 270, scale: 4, canvasWidth: 1920 });
    // the chunkier pixel size: 180 art rows at 3 device pixels each
    expect(art({ width: 960, height: 540, dpr: 1 }, C, 'fill').framing).toMatchObject({ artWidth: 320, artHeight: 180, scale: 3 });
    expect(art({ width: 1000, height: 540, dpr: 1 }, C, 'fill').resolution).toEqual({ width: 334, height: 180 });
  });

  it('adaptive: the art height stays, its width follows the screen', () => {
    expect(art({ width: 1280, height: 540, dpr: 1 }, D, 'adaptive').framing).toMatchObject({ artWidth: 640, artHeight: 270, scale: 2 });
    expect(art({ width: 640, height: 270, dpr: 2 }, C, 'adaptive').framing).toMatchObject({ artWidth: 426, artHeight: 180, scale: 3 });
  });

  it('fixed: exactly the preset, letterboxed in whole device pixels', () => {
    expect(art({ width: 1000, height: 600, dpr: 1 }, D, 'fixed').framing).toMatchObject({ artWidth: 480, artHeight: 270, scale: 2, canvasWidth: 960, offsetX: 20, offsetY: 30 });
    expect(art({ width: 1000, height: 600, dpr: 2 }, D, 'fixed').framing).toMatchObject({ scale: 4, canvasWidth: 1920, canvasHeight: 1080, offsetX: 20, offsetY: 30 });
  });

  it("keeps identity: the preset itself when the art equals it, the current size while it stays", () => {
    const own = { width: 480, height: 270 };
    expect(art({ width: 960, height: 540, dpr: 1 }, own, 'fill').resolution).toBe(own); // the base, not a copy
    const current = { width: 500, height: 270 };
    expect(art({ width: 1000, height: 540, dpr: 1 }, D, 'fill', current).resolution).toBe(current);
    const changed = art({ width: 1000, height: 540, dpr: 1 }, D, 'fill', { width: 480, height: 270 }).resolution;
    expect(changed).not.toBe(D);
    expect(changed).toEqual({ width: 500, height: 270 });
    expect(art({ width: 960, height: 540, dpr: 1 }, D, 'fill', current).resolution).toBe(D); // back to the preset: the preset object
  });
});

describe('touch density on a phone (touchScale, EngineOptions.touchDensity)', () => {
  const css = (f: { scale: number }, dpr: number) => f.scale / dpr;

  it('a landscape phone gets fewer, bigger art pixels: at least 2 CSS pixels each, at DPR 2 and 3', () => {
    const base = RESOLUTIONS.default;
    for (const dpr of [2, 3]) {
      const v = { width: 844, height: 390, dpr };
      const before = frameView(v, base, 'fill', base).framing;
      const after = frameView(v, base, 'fill', base, touchScale(v, 2)).framing;
      expect(css(before, dpr), `DPR ${dpr} before`).toBeLessThan(2);
      expect(css(after, dpr), `DPR ${dpr}`).toBeGreaterThanOrEqual(2);
      expect([after.artWidth, after.artHeight, after.integer]).toEqual([422, 195, true]);
      // still the whole window, edge to edge
      expect([after.offsetX <= 0, after.offsetY <= 0, after.offsetX + after.cssWidth >= 844, after.offsetY + after.cssHeight >= 390]).toEqual([true, true, true, true]);
    }
  });

  it('at a fractional DPR, the whole number of device pixels nearest the density (a tie the bigger): a Pixel (DPR 2.625) held sideways keeps about the rows a DPR 2 or 3 phone of its size draws', () => {
    const base = RESOLUTIONS.default;
    // [DPR, device px per art px, CSS px per art px about]: 2 × 2.625 = 5.25 → 5 (1.9 CSS px), not 6
    // (2.3: 17% fewer rows than asked); 2 × 2.75 = 5.5, a tie → 6; 2 × 2.25 = 4.5 → 5; 2 × 2.2 = 4.4 → 4
    for (const [dpr, scale] of [
      [1, 2],
      [1.5, 3],
      [1.75, 4],
      [2, 4],
      [2.2, 4],
      [2.25, 5],
      [2.5, 5],
      [2.625, 5],
      [2.75, 6],
      [3, 6],
      [3.5, 7],
      [4, 8],
    ] as const) {
      const v = { width: 863, height: 360, dpr };
      expect(touchScale(v, 2), `DPR ${dpr}`).toBe(scale);
      expect(Math.abs(scale / dpr - 2), `DPR ${dpr}: about 2 CSS px an art pixel`).toBeLessThanOrEqual(0.5 / dpr + 1e-9);
    }
    // the art rows held sideways at DPR 2.625 (a Pixel 7: 863×360, 923×340 under Chrome's bar, 882×344,
    // its full 915×412) are about those of a DPR 2 or 3 phone of the same CSS size (180, 170, 172, 206),
    // never 15% fewer (they were 158, 149, 151, 181 at 6 device px)
    for (const [w, hgt, rows] of [
      [863, 360, 189],
      [923, 340, 179],
      [882, 344, 181],
      [915, 412, 217],
    ] as const) {
      const v = { width: w, height: hgt, dpr: 2.625 };
      const f = frameView(v, base, 'fill', base, touchScale(v, 2)).framing;
      expect([f.artHeight, f.scale, f.integer], `${w}×${hgt} at DPR 2.625`).toEqual([rows, 5, true]);
      for (const dpr of [2, 3]) {
        const at = frameView({ ...v, dpr }, base, 'fill', base, touchScale({ ...v, dpr }, 2)).framing.artHeight;
        expect(Math.abs(f.artHeight - at) / at, `${w}×${hgt}: rows at 2.625 (${f.artHeight}) vs at DPR ${dpr} (${at})`).toBeLessThanOrEqual(0.06);
      }
    }
  });

  it('a portrait phone already is (3 CSS pixels an art pixel): unchanged; so are tablets, laptops, TVs, and a density of 0', () => {
    const base = RESOLUTIONS.default;
    for (const v of [
      { width: 390, height: 844, dpr: 3 },
      { width: 390, height: 844, dpr: 1 },
    ]) {
      expect(touchScale(v, 2)).toBe(Math.ceil(2 * v.dpr));
      expect(frameView(v, base, 'fill', base, touchScale(v, 2)).framing).toEqual(frameView(v, base, 'fill', base).framing);
    }
    for (const v of [
      { width: 1024, height: 768, dpr: 2 },
      { width: 1280, height: 720, dpr: 1 },
      { width: 1920, height: 1080, dpr: 1 },
    ])
      expect(touchScale(v, 2), `${v.width}×${v.height}`).toBe(1);
    expect(touchScale({ width: 844, height: 390, dpr: 2 }, 0)).toBe(1);
  });

  it('follows a rotation, and only fill changes its art size (fixed and adaptive keep theirs)', () => {
    const base = RESOLUTIONS.default;
    const land = { width: 844, height: 390, dpr: 3 };
    const port = { width: 390, height: 844, dpr: 3 };
    expect(frameView(land, base, 'fill', base, touchScale(land, 2)).resolution).toEqual({ width: 422, height: 195 });
    expect(frameView(port, base, 'fill', base, touchScale(port, 2)).resolution).toEqual({ width: 130, height: 282 });
    expect(computeFraming(844, 390, 2, base, 'fixed', 4)).toEqual(computeFraming(844, 390, 2, base, 'fixed'));
    expect(computeFraming(844, 390, 2, base, 'adaptive', 4)).toEqual(computeFraming(844, 390, 2, base, 'adaptive'));
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
