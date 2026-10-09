import { describe, expect, it } from 'vitest';
import { gaitPartners, LegStepper, SpringChain, Squash, twoBoneIK } from './procedural';

type V = [number, number, number];
const BASIS: [V, V, V] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

describe('SpringChain', () => {
  it('keeps its segment lengths and trails behind a moving root', () => {
    const c = new SpringChain({ segments: 5, length: 0.2, rest: [0, 0, -1], gravity: 0 });
    c.reset([0, 1, 0], BASIS);
    // the root runs along +X: the tail lags behind (−X side)
    for (let i = 0; i < 30; i++) c.update(1 / 60, [i * 0.05, 1, 0], BASIS);
    for (let i = 1; i < c.points.length; i++) {
      const a = c.points[i - 1]!;
      const b = c.points[i]!;
      expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(0.2, 5);
    }
    const tip = c.points.at(-1)!;
    expect(tip[0]).toBeLessThan(c.points[0]![0] - 0.02);
    expect(c.swing(BASIS)).toBeGreaterThan(0.05);
  });

  it('settles back to its rest pose when the root stops', () => {
    const c = new SpringChain({ segments: 4, length: 0.25, gravity: 0, stiffness: 12 });
    c.reset([0, 0, 0], BASIS);
    for (let i = 0; i < 20; i++) c.update(1 / 60, [i * 0.1, 0, 0], BASIS);
    const moving = c.swing(BASIS);
    for (let i = 0; i < 400; i++) c.update(1 / 60, [2, 0, 0], BASIS);
    expect(c.swing(BASIS)).toBeLessThan(moving * 0.05 + 1e-3);
  });

  it('swings the same at any frame rate', () => {
    // the scarf's settings, run for a second and a half, root moving then stopping
    const tips = [30, 60, 144, 240].map((hz) => {
      const c = new SpringChain({ segments: 7, length: 0.13, rest: [0, -0.25, -1], stiffness: 6, keep: 0.93, gravity: 9 });
      c.reset([0, 1, 0], BASIS);
      for (let i = 1; i <= hz * 1.5; i++) c.update(1 / hz, [Math.min(i / hz, 0.6) * 4, 1, 0], BASIS); // the root where it is at the frame's end
      return c.points.at(-1)!;
    });
    for (const t of tips) for (let k = 0; k < 3; k++) expect(Math.abs(t[k]! - tips[1]![k]!)).toBeLessThan(0.03);
  });

  it('treats its rest direction as a direction (any length)', () => {
    const a = new SpringChain({ segments: 3, length: 0.2, rest: [0, 0, -4], gravity: 0 });
    a.reset([0, 0, 0], BASIS);
    expect(a.points.at(-1)![2]).toBeCloseTo(-0.6, 6);
    expect(a.swing(BASIS)).toBeCloseTo(0, 6);
  });

  it('a floppy chain sags more than a stiff one', () => {
    const sag = (stiffness: number) => {
      const c = new SpringChain({ segments: 6, length: 0.2, stiffness, gravity: 9.8 });
      c.reset([0, 2, 0], BASIS);
      for (let i = 0; i < 240; i++) c.update(1 / 60, [0, 2, 0], BASIS);
      return 2 - c.points.at(-1)![1];
    };
    expect(sag(1)).toBeGreaterThan(sag(30));
  });
});

describe('Squash', () => {
  it('springs back to rest and keeps the volume', () => {
    const s = new Squash();
    s.kick(-6);
    s.update(0.05);
    const [xz, y] = s.scale();
    expect(y).toBeLessThan(1);
    expect(xz * xz * y).toBeCloseTo(1, 6);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(Math.abs(s.value)).toBeLessThan(1e-3);
  });
});

describe('LegStepper', () => {
  const legs = (n: number) => {
    const partners = gaitPartners(n);
    return Array.from({ length: n }, (_, i) => ({ rest: [(i % 2 ? 1 : -1) * 0.5, 0.6 - Math.floor(i / 2) * 0.6] as const, partners: partners[i] }));
  };

  it('feet stay planted while the body stands still', () => {
    const l = new LegStepper({ legs: legs(4) });
    for (let i = 0; i < 60; i++) l.update(1 / 60, [0, 0.5, 0], 0, [0, 0, 0], () => 0);
    expect(l.steps).toBe(0);
    expect(l.planted()).toBe(4);
  });

  it('walking steps every foot forward, never lifting partners together', () => {
    const l = new LegStepper({ legs: legs(6), threshold: 0.25 });
    const partners = gaitPartners(6);
    let z = 0;
    for (let i = 0; i < 180; i++) {
      z += 1.2 / 60;
      l.update(1 / 60, [0, 0.5, z], 0, [0, 0, 1.2], () => 0);
      l.feet.forEach((f, k) => {
        if (f.t >= 0) for (const p of partners[k]!) expect(l.feet[p]!.t, `${k} lifted with ${p}`).toBeLessThan(0);
      });
    }
    expect(l.steps).toBeGreaterThan(12);
    // every foot kept up with the body
    for (const f of l.feet) expect(Math.abs(f.at[2] - z)).toBeLessThan(1.2);
  });

  it('reset plants every foot on its rest spot', () => {
    const l = new LegStepper({ legs: legs(4) });
    l.reset([5, 0, 1], Math.PI / 2, () => 0.25);
    const t = l.target(0, [5, 0, 1], Math.PI / 2, [0, 0, 0], () => 0.25);
    expect(l.feet[0]!.at).toEqual(t);
    expect(l.planted()).toBe(4);
    l.update(1 / 60, [5, 0, 1], Math.PI / 2, [0, 0, 0], () => 0.25);
    expect(l.feet[0]!.at).toEqual(t); // nothing moves while the body stands
  });

  it('partners are mutual: listed one way, neither lifts while the other does', () => {
    const l = new LegStepper({ legs: [{ rest: [-0.5, 0], partners: [1] }, { rest: [0.5, 0] }], threshold: 0.1 });
    for (let i = 0; i < 120; i++) {
      l.update(1 / 60, [0, 0.5, i * 0.03], 0, [0, 0, 1.8], () => 0);
      expect(l.feet[0]!.t >= 0 && l.feet[1]!.t >= 0).toBe(false);
    }
    expect(l.steps).toBeGreaterThan(4);
  });

  it('feet land on the ground height', () => {
    const l = new LegStepper({ legs: legs(2) });
    for (let i = 0; i < 120; i++) l.update(1 / 60, [i * 0.02, 1, 0], Math.PI / 2, [1.2, 0, 0], (x) => x * 0.1);
    for (const f of l.feet) if (f.t < 0) expect(f.at[1]).toBeCloseTo(f.at[0] * 0.1, 5);
  });
});

describe('twoBoneIK', () => {
  it('puts the knee where both bones keep their length, bent toward the pole', () => {
    const root: [number, number, number] = [0, 1, 0];
    const target: [number, number, number] = [0.6, 0, 0];
    const knee = twoBoneIK(root, target, 0.6, 0.6, [0, 1, 2]);
    expect(Math.hypot(knee[0] - root[0], knee[1] - root[1], knee[2] - root[2])).toBeCloseTo(0.6, 5);
    expect(Math.hypot(knee[0] - target[0], knee[1] - target[1], knee[2] - target[2])).toBeCloseTo(0.6, 5);
    expect(knee[2]).toBeGreaterThan(0.1); // toward the pole
  });

  it('folds as far as it goes toward a target too close (unequal bones)', () => {
    for (const d of [0.1, 0.01, 0.002]) {
      const knee = twoBoneIK([0, 0, 0], [0, -d, 0], 0.75, 0.85, [0, 0, 1]);
      expect(Math.hypot(...knee)).toBeCloseTo(0.75, 5); // the thigh keeps its length
    }
  });

  it('straightens toward a target out of reach', () => {
    const knee = twoBoneIK([0, 0, 0], [0, -5, 0], 1, 1, [0, 0, 1]);
    expect(knee[1]).toBeCloseTo(-1, 2);
    expect(Math.abs(knee[2])).toBeLessThan(0.05);
  });
});
