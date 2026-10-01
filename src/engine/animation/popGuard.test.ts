import { describe, expect, it } from 'vitest';
import { PopGuard } from './popGuard';

const DT = 1 / 60;

describe('PopGuard', () => {
  it('follows a target that moves within its speed limit exactly (no lag)', () => {
    const g = new PopGuard(1, 30, [2]);
    for (let i = 0; i < 120; i++) {
      const t = 1.5 * i * DT; // 1.5 /s, under the limit
      expect(g.apply([t], DT)[0]).toBeCloseTo(t, 9);
    }
  });

  it('eases a jump over several frames, with no frame moving much more than the limit', () => {
    const g = new PopGuard(1, 30, [2]);
    g.apply([0], DT);
    let last = 0;
    let biggest = 0;
    let out = 0;
    for (let i = 0; i < 40; i++) {
      out = g.apply([1], DT)[0]!; // a 1 m jump at once
      biggest = Math.max(biggest, Math.abs(out - last));
      last = out;
    }
    // the first frame takes only what the speed limit allows; the rest eases in
    expect(biggest).toBeLessThan(0.3);
    expect(out).toBeCloseTo(1, 2); // and it gets there within two thirds of a second
    expect(g.active()).toBe(false);
  });

  it('a raised limit lets a deliberate fast move through', () => {
    const g = new PopGuard(1, 30, [2]);
    g.apply([0], DT);
    g.setMaxSpeed(0, 1e3);
    expect(g.apply([0.5], DT)[0]).toBeCloseTo(0.5, 9);
  });

  it('reset takes the next target as it is', () => {
    const g = new PopGuard(2, 30, [1, 1]);
    g.apply([0, 0], DT);
    g.apply([5, -5], DT);
    g.reset();
    expect(g.apply([3, 4], DT)).toEqual([3, 4]);
  });
});
