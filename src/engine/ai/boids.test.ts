import { describe, expect, it } from 'vitest';
import { Boids } from './boids';

const run = (b: Boids, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 30) b.step(1 / 30);
};

describe('Boids', () => {
  it('a scattered flock lines up and keeps its spacing', () => {
    const b = new Boids(60, { bounds: { min: [-12, 0, -12], max: [12, 6, 12] }, seed: 4 });
    const before = b.order().alignment;
    run(b, 12);
    const after = b.order();
    expect(after.alignment).toBeGreaterThan(before);
    expect(after.alignment).toBeGreaterThan(0.5);
    expect(b.spacing()).toBeGreaterThan(0.35); // nobody sits on top of a neighbour
  });

  it('stays inside its bounds, at a speed between its limits', () => {
    const b = new Boids(40, { bounds: { min: [-4, 0, -4], max: [4, 3, 4] }, seed: 2, maxSpeed: 5, minSpeed: 1 });
    run(b, 6);
    for (let i = 0; i < b.count; i++) {
      for (let c = 0; c < 3; c++) {
        expect(b.pos[i * 3 + c]).toBeGreaterThanOrEqual([-4, 0, -4][c]!);
        expect(b.pos[i * 3 + c]).toBeLessThanOrEqual([4, 3, 4][c]!);
      }
      const s = Math.hypot(b.vel[i * 3]!, b.vel[i * 3 + 1]!, b.vel[i * 3 + 2]!);
      expect(s).toBeLessThanOrEqual(5.0001);
      expect(s).toBeGreaterThanOrEqual(0.9999);
    }
  });

  it('flees a threat', () => {
    const b = new Boids(30, { bounds: { min: [-10, 0, -10], max: [10, 4, 10] }, seed: 7 });
    b.seek = [0, 2, 0];
    run(b, 6);
    const near = () => {
      let n = 0;
      for (let i = 0; i < b.count; i++) if (Math.hypot(b.pos[i * 3]!, b.pos[i * 3 + 2]!) < 3) n++;
      return n;
    };
    const gathered = near();
    b.seek = null;
    b.flee = { at: [0, 2, 0], radius: 6 };
    run(b, 3);
    expect(near()).toBeLessThan(gathered);
  });

  it('flat flocks stay on their plane and runs are seeded', () => {
    const a = new Boids(20, { bounds: { min: [-5, 1, -5], max: [5, 1, 5] }, flat: true, seed: 9 });
    const b = new Boids(20, { bounds: { min: [-5, 1, -5], max: [5, 1, 5] }, flat: true, seed: 9 });
    run(a, 2);
    run(b, 2);
    expect([...a.pos]).toEqual([...b.pos]);
    for (let i = 0; i < a.count; i++) expect(a.pos[i * 3 + 1]).toBe(1);
  });

  it('a small margin lets a herd use its whole pen when it flees', () => {
    const spread = (margin?: number) => {
      const b = new Boids(20, { bounds: { min: [-3.5, 0, -3.5], max: [3.5, 0, 3.5] }, view: 2.2, space: 1.3, minSpeed: 0.15, maxSpeed: 3.2, flat: true, margin, seed: 7 });
      b.flee = { at: [0, 0, 0], radius: 4 };
      run(b, 3);
      let near = 0;
      for (let i = 0; i < b.count; i++) if (Math.hypot(b.pos[i * 3]!, b.pos[i * 3 + 2]!) < 2) near++;
      return near;
    };
    expect(spread(0.6)).toBeLessThan(spread());
    expect(spread(0.6)).toBeLessThanOrEqual(2);
  });

  it('agents on the same spot move apart', () => {
    const b = new Boids(2, { seed: 1 });
    b.pos.set([0, 2, 0, 0, 2, 0]);
    b.vel.set([1, 0, 0, 1, 0, 0]);
    for (let i = 0; i < 30; i++) b.step(1 / 30);
    expect(Math.hypot(b.pos[0]! - b.pos[3]!, b.pos[2]! - b.pos[5]!)).toBeGreaterThan(0.3);
  });

  it('a flat flock steers as hard as a free one (its height costs it no force)', () => {
    const turn = (flat: boolean) => {
      const b = new Boids(1, { bounds: { min: [-50, 1, -50], max: [50, 1 + (flat ? 0 : 50), 50] }, flat, maxSpeed: 4, minSpeed: 4, seed: 2 });
      b.pos.set([0, 1 + (flat ? 0 : 25), 0]);
      b.vel.set([4, 0, 0]);
      b.seek = [0, b.pos[1]!, 20];
      b.step(1 / 60);
      return b.vel[2]!;
    };
    expect(turn(true)).toBeCloseTo(turn(false), 5);
  });

  it('a thin box pushes from both sides: the flock keeps to its middle', () => {
    const b = new Boids(30, { bounds: { min: [-10, 2, -10], max: [10, 5, 10] }, seed: 3 });
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 10; t += 1 / 30) {
      b.step(1 / 30);
      if (t <= 4) continue;
      for (let i = 0; i < b.count; i++) sum += b.pos[i * 3 + 1]!;
      n += b.count;
    }
    expect(Math.abs(sum / n - 3.5)).toBeLessThan(0.25);
  });
});
