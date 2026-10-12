import { describe, expect, it } from 'vitest';
import type { Part } from '../engine/model';
import { bakeTexture, meanColour, TEXTURE_LIBRARY, textureDef } from '../engine/texture';
import { BAD, CALM, floorDef, gateBTextures, PINNED, sceneDef, sceneSurfaces } from './gateB';

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

describe('Gate B scene floors', () => {
  const catalog = gateBTextures();
  const mean = (id: string) => meanColour(bakeTexture(catalog.get(id)));
  const texOf = (set: Parameters<typeof sceneDef>[0], surfaces?: Parameters<typeof sceneDef>[2]) => (sceneDef(set, 8, surfaces).parts as readonly Part[]).map((p) => ('tex' in p ? p.tex : 'c' in p ? p.c : null));

  it('by default is the scene Gate B was measured with: the pinned surfaces, flat in their mean colours', () => {
    expect(texOf('library')).toEqual(['gate-b-cobbles', 'gate-b-bricks', 'gate-b-planks', 'gate-b-planks']);
    expect(texOf('flat')).toEqual(['floor', 'wall', 'crate', 'crate']);
    expect(sceneSurfaces('flat')).toEqual({ floor: mean('gate-b-cobbles'), wall: mean('gate-b-bricks'), crate: mean('gate-b-planks') });
    expect(floorDef(undefined, catalog)).toBe(PINNED.floor);
  });

  it('a floor changes the floor alone: textured, and flat in its own mean colour', () => {
    const grass = floorDef('grass', catalog);
    expect(grass).toBe(TEXTURE_LIBRARY.get('grass'));
    expect(sceneSurfaces('library', grass)).toEqual({ floor: 'grass', wall: 'gate-b-bricks', crate: 'gate-b-planks' });
    expect(texOf('library', sceneSurfaces('library', grass))).toEqual(['grass', 'gate-b-bricks', 'gate-b-planks', 'gate-b-planks']);
    expect(sceneSurfaces('flat', grass)).toEqual({ floor: mean('grass'), wall: mean('gate-b-bricks'), crate: mean('gate-b-planks') });
    expect(mean('grass')).not.toBe(mean('gate-b-cobbles'));
  });

  it('calibration ignores the floor', () => {
    const grass = floorDef('grass', catalog);
    expect(sceneSurfaces('calm', grass)).toEqual({ floor: CALM.id, wall: CALM.id, crate: CALM.id });
    expect(sceneSurfaces('bad', grass)).toEqual({ floor: BAD.id, wall: BAD.id, crate: BAD.id });
  });

  it('takes library and pinned ids, and variant defs under ids of their own', () => {
    expect(floorDef('gate-b-cobbles', catalog)).toBe(PINNED.floor);
    expect(() => floorDef('no-such-floor', catalog)).toThrow(/no texture "no-such-floor"/);
    const variant = textureDef({ ...TEXTURE_LIBRARY.get('cobbles'), id: 'cobbles-calm' });
    expect(floorDef(variant, catalog)).toBe(variant);
    expect(() => floorDef({ ...variant, id: 'cobbles' }, catalog)).toThrow(/id is taken/);
  });
});
