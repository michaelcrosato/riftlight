import { describe, expect, it } from 'vitest';
import { bakeTexture } from '../engine/texture';
import { BAD, CALM } from './gateB';

/** Each slot's share of the texels. */
function shares(id: 'bad' | 'calm'): number[] {
  const b = bakeTexture(id === 'bad' ? BAD : CALM);
  expect(b.problems).toEqual([]);
  const counts = b.slots.map((_, i) => b.indices.filter((v) => v === i + 1).length);
  return counts.map((c) => c / b.indices.length);
}

describe('Gate B calibration textures', () => {
  it('the calm one is two-colour blobs: both colours, neither under a quarter', () => {
    for (const s of shares('calm')) expect(s).toBeGreaterThan(0.25);
  });

  it('the bad one is a 1-texel checker: every texel differs from its right and lower neighbours', () => {
    const b = bakeTexture(BAD);
    for (let y = 0; y < b.height - 1; y++)
      for (let x = 0; x < b.width - 1; x++) {
        const i = y * b.width + x;
        expect(b.indices[i]).not.toBe(b.indices[i + 1]);
        expect(b.indices[i]).not.toBe(b.indices[i + b.width]);
      }
    expect(shares('bad')).toEqual([0.5, 0.5]);
  });
});
