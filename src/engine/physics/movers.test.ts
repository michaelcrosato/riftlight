import { describe, expect, it } from 'vitest';
import { Movers, moverRotation, orbit, pathPoint, pendulum } from './movers';

describe('pathPoint', () => {
  const lift = { path: [[0, 0, 0], [0, 4, 0]] as const, speed: 2, hold: 1, ease: 'linear' as const };
  const at = (t: number) => pathPoint(lift, t, [0, 0, 0]);
  it('holds, travels, holds, comes back (ping-pong)', () => {
    expect(at(0.5)).toEqual([0, 0, 0]); // holding at the bottom
    expect(at(2)[1]).toBeCloseTo(2); // 1 s of travel at 2 m/s
    expect(at(3.5)[1]).toBeCloseTo(4); // holding at the top
    expect(at(5)[1]).toBeCloseTo(2); // on the way down
    expect(at(6)[1]).toBeCloseTo(0, 5); // cycle is 6 s
    expect(at(8)[1]).toBeCloseTo(at(2)[1]);
  });
  it('loops back to the first point', () => {
    const o = { path: [[0, 0, 0], [2, 0, 0], [2, 0, 2]] as const, speed: 1, mode: 'loop' as const, ease: 'linear' as const };
    const total = 2 + 2 + Math.hypot(2, 2);
    expect(pathPoint(o, 1, [0, 0, 0])[0]).toBeCloseTo(1);
    expect(pathPoint(o, total - 0.001, [0, 0, 0])[0]).toBeCloseTo(0, 2);
  });
  it('phase shifts the clock', () => {
    expect(pathPoint({ ...lift, phase: 1 }, 1, [0, 0, 0])).toEqual(at(2));
  });
});

describe('moverRotation', () => {
  it('spins at its rate', () => {
    const q = moverRotation({ spin: [0, Math.PI, 0] }, 0.5, [0, 0, 0, 1]); // 90° about Y
    expect(q[1]).toBeCloseTo(Math.SQRT1_2);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2);
  });
  it('swings between ± its angle', () => {
    const o = { swing: { axis: [0, 0, 1] as const, angle: 60, period: 2 } };
    const q = moverRotation(o, 0.5, [0, 0, 0, 1]); // a quarter period: the full 60°
    expect(2 * Math.asin(q[2])).toBeCloseTo(Math.PI / 3);
    expect(moverRotation(o, 1, [0, 0, 0, 1])[3]).toBeCloseTo(1);
  });
});

describe('Movers', () => {
  it('sets each body\'s next pose', () => {
    const calls: unknown[] = [];
    const body = { setNextKinematicTranslation: (t: object) => calls.push({ ...t }), setNextKinematicRotation: (r: object) => calls.push({ ...r }) };
    const m = new Movers();
    const h = m.add(body, { path: [[0, 0, 0], [0, 2, 0]], speed: 1, ease: 'linear', spin: [0, 1, 0] });
    m.step(1);
    expect(calls).toHaveLength(2);
    expect((calls[0] as { y: number }).y).toBeCloseTo(1);
    h.remove();
    m.step(2);
    expect(calls).toHaveLength(2);
    expect(m.count).toBe(0);
  });
});

describe('curves', () => {
  it('orbit: a level seat round a circle, one turn per period', () => {
    const f = orbit([0, 3, 0], 2, 8);
    const p: [number, number, number] = [0, 0, 0];
    f(0, p);
    expect(p).toEqual([2, 3, 0]);
    f(2, p); // a quarter turn: the top
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(5);
    f(8, p);
    expect(p[0]).toBeCloseTo(2);
    orbit([0, 0, 0], 1, 4, { axis: 'x' })(0, p);
    expect(p).toEqual([0, 0, 1]);
  });

  it('pendulum: hangs below the pivot, swings to ± the angle', () => {
    const f = pendulum([0, 10, 0], 5, 30, 4);
    const p: [number, number, number] = [0, 0, 0];
    f(0, p);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(5);
    f(1, p); // a quarter period: the far end
    expect(p[0]).toBeCloseTo(2.5);
    expect(p[1]).toBeCloseTo(10 - 5 * Math.cos(Math.PI / 6));
  });

  it('a mover with a curve follows it (with its phase)', () => {
    const at: { x: number; y: number; z: number }[] = [];
    const m = new Movers();
    m.add({ setNextKinematicTranslation: (t) => at.push({ ...t }), setNextKinematicRotation: () => {} }, { curve: orbit([0, 0, 0], 1, 4), phase: 1 });
    m.step(0);
    expect(at[0]!.x).toBeCloseTo(0);
    expect(at[0]!.y).toBeCloseTo(1);
  });
});
