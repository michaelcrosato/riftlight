import { describe, expect, it } from 'vitest';
import { RippleField, WAVES_CALM, WAVES_CHOPPY, waterHeight } from './water';

describe('waterHeight', () => {
  it('stays within the sum of the amplitudes and moves with time', () => {
    const max = WAVES_CHOPPY.reduce((s, w) => s + w.amplitude, 0);
    for (let i = 0; i < 200; i++) {
      const h = waterHeight(WAVES_CHOPPY, i * 0.37, i * 0.21, i * 0.05);
      expect(Math.abs(h)).toBeLessThanOrEqual(max + 1e-9);
    }
    expect(waterHeight(WAVES_CALM, 1, 2, 0)).not.toBe(waterHeight(WAVES_CALM, 1, 2, 0.5));
    expect(waterHeight(WAVES_CALM, 1, 2, 3)).toBe(waterHeight(WAVES_CALM, 1, 2, 3));
  });
});

describe('RippleField', () => {
  it('a splash spreads as a ring and dies away', () => {
    const f = new RippleField({ size: [8, 8], cells: [64, 64], speed: 2, damping: 0.3 });
    f.splash(0, 0, 0.4, 0.5);
    expect(f.heightAt(0, 0)).toBeLessThan(-0.3);
    const e0 = f.energy();
    for (let i = 0; i < 30; i++) f.step(1 / 60);
    // the dent has moved outward: something at 1 m from the middle now
    expect(Math.abs(f.heightAt(1, 0))).toBeGreaterThan(0.005);
    for (let i = 0; i < 600; i++) f.step(1 / 60);
    expect(f.energy()).toBeLessThan(e0 * 0.2);
  });

  it('stays stable with a long step (it substeps)', () => {
    const f = new RippleField({ size: [4, 4], cells: [80, 80], speed: 4 });
    f.splash(0, 0, 0.3, 0.4);
    for (let i = 0; i < 20; i++) f.step(0.1);
    expect(Number.isFinite(f.energy())).toBe(true);
    expect(f.energy()).toBeLessThan(1e4);
  });

  it('is zero outside the water', () => {
    const f = new RippleField({ size: [2, 2], cells: [8, 8], center: [10, 10] });
    expect(f.contains(10, 10)).toBe(true);
    expect(f.contains(0, 0)).toBe(false);
    expect(f.heightAt(0, 0)).toBe(0);
  });
});
