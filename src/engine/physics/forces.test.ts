import { describe, expect, it } from 'vitest';
import { fieldAcceleration, ForceFields } from './forces';

const at = (f: Parameters<typeof fieldAcceleration>[0], x: number, y: number, z: number) => {
  const out: [number, number, number] = [0, 0, 0];
  const inside = fieldAcceleration(f, x, y, z, out);
  return { inside, out };
};

describe('fieldAcceleration', () => {
  it('a box pushes inside only', () => {
    const fan = { box: [1, 2, 1] as const, at: [0, 2, 0] as const, force: [0, 20, 0] as const };
    expect(at(fan, 0, 1, 0)).toEqual({ inside: true, out: [0, 20, 0] });
    expect(at(fan, 1.5, 1, 0).inside).toBe(false);
  });
  it('a turned box turns its footprint', () => {
    const f = { box: [3, 1, 0.5] as const, at: [0, 0, 0] as const, rotationY: Math.PI / 2, force: [1, 0, 0] as const };
    expect(at(f, 0, 0, 2.5).inside).toBe(true);
    expect(at(f, 2.5, 0, 0).inside).toBe(false);
  });
  it('a well pulls toward its centre, weaker at the edge', () => {
    const well = { sphere: 4, at: [0, 0, 0] as const, radial: -10, falloff: true };
    const near = at(well, 1, 0, 0).out;
    const far = at(well, 3, 0, 0).out;
    expect(near[0]).toBeLessThan(0);
    expect(Math.abs(near[0])).toBeGreaterThan(Math.abs(far[0]));
  });
  it('a box with falloff fades with height', () => {
    const fan = { box: [1, 2, 1] as const, at: [0, 2, 0] as const, force: [0, 10, 0] as const, falloff: true };
    expect(at(fan, 0, 0.1, 0).out[1]).toBeGreaterThan(at(fan, 0, 3.9, 0).out[1]);
  });
});

describe('ForceFields', () => {
  it('adds up, skips disabled and character-free fields, removes', () => {
    const ff = new ForceFields();
    const a = ff.add({ sphere: 5, at: [0, 0, 0], force: [1, 0, 0] });
    ff.add({ sphere: 5, at: [0, 0, 0], force: [0, 2, 0], character: false });
    const out: [number, number, number] = [0, 0, 0];
    expect(ff.accelerationAt(0, 0, 0, out)).toEqual([1, 0, 0]);
    expect(ff.accelerationAt(0, 0, 0, out, 'bodies')).toEqual([1, 2, 0]);
    a.enabled = false;
    expect(ff.accelerationAt(0, 0, 0, out)).toEqual([0, 0, 0]);
    a.remove();
    expect(ff.count).toBe(1);
  });
  it('reports the strongest drag and its flow', () => {
    const ff = new ForceFields();
    ff.add({ box: [2, 1, 2], at: [0, 0, 0], drag: 0.5, force: [3, 0, 0] });
    ff.add({ box: [2, 1, 2], at: [0, 0, 0], drag: 0.9 });
    expect(ff.dragAt(0, 0, 0)?.drag).toBe(0.9);
    expect(ff.dragAt(9, 0, 0)).toBeNull();
  });
});
