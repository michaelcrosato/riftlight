import { describe, expect, it } from 'vitest';
import { skyAt } from './sky';

describe('skyAt', () => {
  it('the sun is high at noon, low and east at dawn, west at dusk; the moon at night', () => {
    const noon = skyAt(12);
    const dawn = skyAt(6.5);
    const dusk = skyAt(17.5);
    expect(noon.sunDir[1]).toBeGreaterThan(0.85);
    expect(dawn.sunDir[0]).toBeGreaterThan(0.8);
    expect(dusk.sunDir[0]).toBeLessThan(-0.6);
    expect(noon.night).toBe(0);
    expect(skyAt(23).night).toBe(1);
    expect(skyAt(2).sunIntensity).toBeLessThan(noon.sunIntensity / 3);
    for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
      const s = skyAt(h);
      expect(Math.hypot(...s.sunDir)).toBeCloseTo(1, 5);
      expect(s.sunDir[1]).toBeGreaterThan(0.1);
    }
  });

  it('wraps around midnight and changes smoothly', () => {
    expect(skyAt(24.5)).toEqual(skyAt(0.5));
    expect(skyAt(-1)).toEqual(skyAt(23));
    const a = skyAt(18);
    const b = skyAt(18.05);
    expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.1);
  });

  it('the light never jumps while it is bright: sun and moon hand over in the dark', () => {
    for (let h = 0; h < 24; h += 0.01) {
      const a = skyAt(h);
      const b = skyAt(h + 0.01);
      if (a.sunIntensity < 0.2 || b.sunIntensity < 0.2) continue;
      expect(Math.hypot(a.sunDir[0] - b.sunDir[0], a.sunDir[1] - b.sunDir[1], a.sunDir[2] - b.sunDir[2]), `at ${h.toFixed(2)}h`).toBeLessThan(0.05);
    }
  });
});
