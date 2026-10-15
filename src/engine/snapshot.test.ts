import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, snapshotProblem } from './snapshot';

describe('save-state data', () => {
  it('survives JSON exactly: -0, Infinity and NaN come back as they were', () => {
    const state = { at: [-0, 0, 1.25], until: Infinity, low: -Infinity, odd: NaN, deep: { v: [{ x: -0 }] }, name: 'hero', tiny: 5e-324 };
    const back = decodeState(JSON.parse(JSON.stringify(encodeState(state)))) as typeof state;
    expect(Object.is(back.at[0], -0) && Object.is(back.at[1], 0) && Object.is(back.deep.v[0]!.x, -0)).toBe(true);
    expect([back.until, back.low, Number.isNaN(back.odd), back.name, back.tiny, back.at[2]]).toEqual([Infinity, -Infinity, true, 'hero', 5e-324, 1.25]);
    // without it, JSON loses them: what the encoding is for
    const plain = JSON.parse(JSON.stringify(state)) as typeof state;
    expect([Object.is(plain.at[0], -0), plain.until]).toEqual([false, null]);
  });

  it("a game's own strings come back as strings, even ones that look like marks", () => {
    const state = { a: '@-0', b: '@NaN', c: '@@x', d: '@', e: 'mail@home', n: -0 };
    const back = decodeState(JSON.parse(JSON.stringify(encodeState(state)))) as typeof state;
    expect(back).toEqual({ a: '@-0', b: '@NaN', c: '@@x', d: '@', e: 'mail@home', n: -0 });
    expect(Object.is(back.n, -0)).toBe(true);
  });

  it('says why a value is not a snapshot', () => {
    expect(snapshotProblem(null)).toBe('not an object');
    expect(snapshotProblem({ format: 2 })).toMatch(/format 2/);
    expect(snapshotProblem({ format: 1, game: 'g', seed: 1, time: 0, random: 1, clock: {}, physics: {}, camera: {}, shake: {}, input: {} })).toBe('no physics world');
  });
});
