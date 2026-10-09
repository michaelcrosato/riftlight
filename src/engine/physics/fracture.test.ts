import { describe, expect, it } from 'vitest';
import { fractureBox } from './fracture';

describe('fractureBox', () => {
  const size = [2, 3, 0.5] as const;
  const chunks = fractureBox(size, { cuts: [3, 4, 2], jitter: 0.35, seed: 9 });

  it('makes cuts x cuts x cuts pieces', () => {
    expect(chunks).toHaveLength(24);
  });

  it('tiles the box exactly: the volumes add up and every piece is inside', () => {
    const volume = chunks.reduce((s, c) => s + c.size[0] * c.size[1] * c.size[2], 0);
    expect(volume).toBeCloseTo(size[0] * size[1] * size[2], 6);
    for (const c of chunks)
      for (let a = 0; a < 3; a++) {
        expect(c.size[a]).toBeGreaterThan(0);
        expect(Math.abs(c.center[a]!) + c.size[a]! / 2).toBeLessThanOrEqual(size[a]! / 2 + 1e-9);
      }
  });

  it('pieces never overlap', () => {
    for (let i = 0; i < chunks.length; i++)
      for (let j = i + 1; j < chunks.length; j++) {
        const a = chunks[i]!;
        const b = chunks[j]!;
        const overlap = [0, 1, 2].every((k) => Math.abs(a.center[k]! - b.center[k]!) < (a.size[k]! + b.size[k]!) / 2 - 1e-9);
        expect(overlap, `${i} / ${j}`).toBe(false);
      }
  });

  it('is seeded', () => {
    expect(fractureBox(size, { seed: 3 })).toEqual(fractureBox(size, { seed: 3 }));
    expect(fractureBox(size, { seed: 3 })).not.toEqual(fractureBox(size, { seed: 4 }));
  });
});
