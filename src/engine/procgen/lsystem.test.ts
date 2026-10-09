import { describe, expect, it } from 'vitest';
import { expand, PLANTS, turtle } from './lsystem';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));

describe('expand', () => {
  it('rewrites every symbol at once each generation (Lindenmayer\'s algae)', () => {
    const algae = { axiom: 'A', rules: { A: 'AB', B: 'A' } };
    expect(expand(algae, 0)).toBe('A');
    expect(expand(algae, 5)).toBe('ABAABABAABAAB');
    // lengths are Fibonacci numbers
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => expand(algae, n).length)).toEqual([2, 3, 5, 8, 13, 21, 34]);
  });

  it('chooses among stochastic rules by probability, the same for a seed', () => {
    const sys = { axiom: 'X'.repeat(4000), rules: { X: [{ to: 'a', p: 3 }, { to: 'b', p: 1 }] } };
    const s = expand(sys, 1, 5);
    expect(expand(sys, 1, 5)).toBe(s);
    expect(expand(sys, 1, 6)).not.toBe(s);
    const share = [...s].filter((c) => c === 'a').length / s.length;
    expect(share).toBeGreaterThan(0.7);
    expect(share).toBeLessThan(0.8);
  });

  it('stops at the last whole generation before it grows past the limit', () => {
    const doubling = { axiom: 'F', rules: { F: 'FF' } };
    expect(expand(doubling, 20, 1, 1000).length).toBe(512);
  });
});

describe('turtle', () => {
  it('draws forward from the origin, turns, and returns to branch points', () => {
    const { branches } = turtle('F[+F]F', { angle: 90, length: 1, lengthScale: 0.5, radius: 0.1, radiusScale: 0.5 });
    expect(branches.length).toBe(3);
    close(branches[0]!.from, [0, 0, 0]);
    close(branches[0]!.to, [0, 1, 0]);
    // the branch: half as long, half as thick, turned 90° about the turtle's up (+z): toward −x
    close(branches[1]!.from, [0, 1, 0]);
    close(branches[1]!.to, [-0.5, 1, 0]);
    expect(branches[1]!.radius).toBeCloseTo(0.05);
    expect(branches[1]!.depth).toBe(1);
    // back at the fork, on up the trunk at full size
    close(branches[2]!.from, [0, 1, 0]);
    close(branches[2]!.to, [0, 2, 0]);
    expect(branches[2]!.depth).toBe(0);
  });

  it('pitches with & ^, rolls with \\ /, turns round with |, moves without drawing on f, and puts leaves', () => {
    const t = turtle('&F', { angle: 90 });
    close(t.branches[0]!.to, [0, 0, 1]); // pitched about left (+x): heading +y → +z
    const r = turtle('/+F', { angle: 90 });
    close(r.branches[0]!.to, [0, 0, -1]); // rolled first, so the turn swings into −z
    expect(turtle('|F').branches[0]!.to[1]).toBeCloseTo(-1);
    const m = turtle('fFL', { length: 2 });
    expect(m.branches.length).toBe(1);
    close(m.branches[0]!.from, [0, 2, 0]);
    close(m.leaves[0]!.at, [0, 4, 0]);
    close(m.leaves[0]!.dir, [0, 1, 0]);
  });

  it('bends toward its tropism', () => {
    const straight = turtle('FFFFF');
    const droop = turtle('FFFFF', { tropism: { dir: [1, 0, 0], amount: 0.3 } });
    expect(straight.branches.at(-1)!.to[0]).toBeCloseTo(0);
    expect(droop.branches.at(-1)!.to[0]).toBeGreaterThan(0.5);
  });

  it('grows the plant presets into branches and leaves, finite, rising from the ground', () => {
    for (const [name, plant] of Object.entries(PLANTS)) {
      const { branches, leaves } = turtle(expand(plant.system, plant.iterations, 3), plant.turtle);
      expect(branches.length, name).toBeGreaterThan(20);
      expect(leaves.length, name).toBeGreaterThan(5);
      const top = Math.max(...branches.map((b) => b.to[1]));
      expect(top, name).toBeGreaterThan(0.5);
      expect(branches.every((b) => [...b.from, ...b.to, b.radius].every(Number.isFinite)), name).toBe(true);
    }
  });
});
