import { describe, expect, it } from 'vitest';
import { createNoise } from './noise';

const grid = (f: (x: number, y: number) => number, n = 60, step = 0.37) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(f(i * step - 7.1, j * step + 3.3));
  return out;
};

describe('noise', () => {
  it('is the same for the same seed and different for another', () => {
    const a = createNoise(7);
    const b = createNoise(7);
    const c = createNoise(8);
    const pa = grid(a.n2);
    expect(grid(b.n2)).toEqual(pa);
    expect(grid(c.n2)).not.toEqual(pa);
    expect(a.n3(1.3, 2.7, 0.4)).toBe(b.n3(1.3, 2.7, 0.4));
  });

  it('stays within -1..1, uses the range, and averages near zero', () => {
    const n = createNoise(3);
    for (const v of [grid(n.n2), grid((x, y) => n.n3(x, y, 1.7))]) {
      const max = Math.max(...v);
      const min = Math.min(...v);
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      expect(max).toBeLessThanOrEqual(1);
      expect(min).toBeGreaterThanOrEqual(-1);
      expect(max - min).toBeGreaterThan(1.2); // not flat
      expect(Math.abs(mean)).toBeLessThan(0.1);
    }
  });

  it('is smooth: a small step moves it a little', () => {
    const n = createNoise(5);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.137;
      const y = i * 0.071;
      worst = Math.max(worst, Math.abs(n.n2(x + 0.005, y) - n.n2(x, y)), Math.abs(n.n3(x, y, 0.5 + 0.005) - n.n3(x, y, 0.5)));
    }
    expect(worst).toBeLessThan(0.05); // a slope under 10 per unit
  });

  it('does not repeat over short spans', () => {
    const n = createNoise(11);
    // shifting by a whole number of cells gives a different field (the permutation repeats only every 256)
    const a = grid((x, y) => n.n2(x, y), 20);
    const b = grid((x, y) => n.n2(x + 17, y), 20);
    expect(a).not.toEqual(b);
  });

  it('fBm adds finer layers: rougher with more octaves and higher gain, still within -1..1', () => {
    const n = createNoise(2);
    const rough = (o: { octaves: number; gain: number }) => {
      // mean absolute difference between neighbours a short step apart
      let s = 0;
      for (let i = 0; i < 1500; i++) s += Math.abs(n.fbm2(i * 0.05 + 0.02, 1.3, o) - n.fbm2(i * 0.05, 1.3, o));
      return s / 1500;
    };
    expect(rough({ octaves: 6, gain: 0.5 })).toBeGreaterThan(rough({ octaves: 1, gain: 0.5 }));
    expect(rough({ octaves: 6, gain: 0.7 })).toBeGreaterThan(rough({ octaves: 6, gain: 0.3 }));
    const v = grid((x, y) => n.fbm2(x, y, { octaves: 6 }));
    expect(Math.max(...v.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('ridged noise is 0..1 with sharp crests (its highs are narrow)', () => {
    const n = createNoise(4);
    const v = grid((x, y) => n.ridged2(x * 0.3, y * 0.3));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
    const high = v.filter((x) => x > 0.75).length / v.length;
    expect(high).toBeGreaterThan(0.01);
    expect(high).toBeLessThan(0.5);
  });
});
