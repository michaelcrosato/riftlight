import { describe, expect, it } from 'vitest';
import { Color } from 'three/webgpu';
import { PALETTE } from '../palette';
import { ScreenFx, TRANSITIONS, coversPixel, displayColor } from './screenFx';

const W = 120;
const H = 68;
/** Covered share of the screen for a transition at `p` (CPU mirror of the shader). */
const coverage = (kind: (typeof TRANSITIONS)[number], p: number) => {
  let sum = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum += coversPixel(kind, p, x, y, W, H);
  return sum / (W * H);
};

describe('transition patterns', () => {
  it('cover nothing at 0 and everything at 1', () => {
    for (const kind of TRANSITIONS) {
      expect(coverage(kind, 0), kind).toBe(0);
      expect(coverage(kind, 1), kind).toBe(1);
    }
  });
  it('cover more as they progress', () => {
    for (const kind of TRANSITIONS) {
      const a = coverage(kind, 0.3);
      const b = coverage(kind, 0.7);
      expect(b, kind).toBeGreaterThanOrEqual(a);
    }
  });
  it('an iris closes on its centre', () => {
    expect(coversPixel('iris', 0.5, 60, 34, W, H)).toBe(0);
    expect(coversPixel('iris', 0.5, 0, 0, W, H)).toBe(1);
    // off-centre: the far corner is covered first
    expect(coversPixel('iris', 0.4, W - 1, H - 1, W, H, [0.1, 0.1])).toBe(1);
    expect(coversPixel('iris', 0.4, 8, 5, W, H, [0.1, 0.1])).toBe(0);
  });
  it('diamonds sweep from the left', () => {
    expect(coversPixel('diamonds', 0.4, 8, 8, W, H)).toBe(1);
    expect(coversPixel('diamonds', 0.4, W - 8, 8, W, H)).toBe(0);
  });
});

describe('ScreenFx', () => {
  it('covers, then reveals, on its own clock', async () => {
    const fx = new ScreenFx();
    let covered: boolean | null = null;
    const p = fx.cover('iris', { duration: 0.5 }).then((ok) => (covered = ok));
    expect(fx.state()).toMatchObject({ transition: 'iris', moving: true });
    for (let i = 0; i < 20; i++) fx.update(0.02, null);
    expect(fx.state().progress).toBeGreaterThan(0.5);
    expect(fx.state().progress).toBeLessThan(1);
    for (let i = 0; i < 20; i++) fx.update(0.02, null);
    await p;
    expect(covered).toBe(true);
    expect(fx.state()).toMatchObject({ progress: 1, moving: false });
    const r = fx.reveal(undefined, { duration: 0.2 });
    for (let i = 0; i < 20; i++) fx.update(0.02, null);
    await r;
    expect(fx.state()).toMatchObject({ transition: null, progress: 0 });
  });

  it('a new cover resolves the one it replaces, as not completed', async () => {
    const fx = new ScreenFx();
    const first = fx.cover('fade', { duration: 1 });
    const second = fx.cover('blinds', { duration: 1 });
    expect(await first).toBe(false); // taken over
    expect(fx.state().transition).toBe('blinds');
    fx.update(1, null);
    expect(await second).toBe(true);
    expect(fx.state().progress).toBe(1);
  });

  it('transition() reveals even when the work in between throws', async () => {
    const fx = new ScreenFx();
    const run = fx.transition(
      'fade',
      () => {
        throw new Error('load failed');
      },
      { duration: 0 },
    );
    await expect(run).rejects.toThrow('load failed');
    expect(fx.state().progress).toBe(0);
  });

  it('colours are display colours: hex / 255, palette names allowed', () => {
    const c = displayColor(new Color(), 0x1a1c2c);
    expect([c.r, c.g, c.b].map((v) => Math.round(v * 255))).toEqual([0x1a, 0x1c, 0x2c]);
    const w = displayColor(new Color(), 'white');
    expect(Math.round(w.r * 255)).toBe((PALETTE.white >> 16) & 255);
    const css = displayColor(new Color(), '#ff8000');
    expect([css.r, css.g, css.b].map((v) => Math.round(v * 255))).toEqual([255, 128, 0]);
  });

  it('duration 0 jumps', async () => {
    const fx = new ScreenFx();
    await fx.cover('dither', { duration: 0 });
    expect(fx.state().progress).toBe(1);
    fx.set(null, 0);
    expect(fx.state()).toMatchObject({ transition: null, progress: 0 });
  });

  it('flashes fade in steps and shockwaves expire', () => {
    const fx = new ScreenFx();
    fx.flash('white', { duration: 0.2, strength: 1 });
    expect(fx.state().flash).toBe(1);
    fx.update(0.1, null);
    expect(fx.state().flash).toBe(0.5);
    fx.update(0.2, null);
    expect(fx.state().flash).toBe(0);
    for (let i = 0; i < 6; i++) fx.shockwave([0.5, 0.5], { duration: 0.5 });
    expect(fx.state().shockwaves).toBe(4);
    fx.update(0.6, null);
    expect(fx.state().shockwaves).toBe(0);
  });
});
