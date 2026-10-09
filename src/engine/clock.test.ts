import { describe, expect, it } from 'vitest';
import { GameClock } from './clock';

describe('GameClock', () => {
  it('scales game time', () => {
    const c = new GameClock();
    expect(c.delta(0.1)).toBeCloseTo(0.1);
    c.scale = 0.25;
    expect(c.delta(0.1)).toBeCloseTo(0.025);
    c.scale = 0;
    expect(c.frozen).toBe(true);
    expect(c.delta(0.1)).toBe(0);
  });

  it('a hitstop freezes real seconds, then time runs again within the same frame', () => {
    const c = new GameClock();
    c.freeze(0.05);
    expect(c.delta(1 / 60)).toBe(0);
    expect(c.delta(1 / 60)).toBe(0);
    // 0.05 − 2/60 = 0.0167 left: the next 0.03 s frame keeps 0.0133 s
    expect(c.delta(0.03)).toBeCloseTo(0.03 - (0.05 - 2 / 60), 6);
    expect(c.hitstop).toBe(0);
  });

  it('overlapping hitstops keep the longest', () => {
    const c = new GameClock();
    c.freeze(0.1);
    c.freeze(0.03);
    expect(c.hitstop).toBe(0.1);
  });

  it('ignores NaN and negative values', () => {
    const c = new GameClock();
    c.freeze(Number.NaN);
    c.freeze(-1);
    c.scale = Number.NaN;
    expect(c.hitstop).toBe(0);
    expect(c.scale).toBe(1);
    c.scale = -3;
    expect(c.scale).toBe(0);
    c.reset();
    expect(c.delta(0.1)).toBeCloseTo(0.1);
  });
});
