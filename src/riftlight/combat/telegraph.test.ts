import type { Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createTelegraph, TELEGRAPH_COLORS, telegraphType } from './telegraph';

describe('telegraph decals', () => {
  it('cones open toward +Z (the monster faces +Z), lines run from the caster along +Z', () => {
    const cone = createTelegraph({ shape: 'cone', size: 3, width: 60 });
    const g = (cone.object.children[0] as Mesh).geometry;
    g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeGreaterThan(0.95);
    expect(g.boundingBox!.min.z).toBeGreaterThan(-0.01);
    const line = createTelegraph({ shape: 'line', size: 8, width: 1.2 });
    const lg = (line.object.children[0] as Mesh).geometry;
    lg.computeBoundingBox();
    expect(lg.boundingBox!.min.z).toBeCloseTo(0, 5);
    expect(lg.boundingBox!.max.z).toBeCloseTo(1, 5);
  });

  it('the sweep reaches the rim on the hit, and the rim turns hot near the end', () => {
    const t = createTelegraph({ shape: 'circle', size: 4 }, 'fire');
    const [rim, sweep] = t.object.children as Mesh[];
    t.update(0.5);
    expect(sweep!.scale.x).toBeCloseTo(2, 5);
    const calm = rim!.material;
    t.update(1);
    expect(sweep!.scale.x).toBeCloseTo(rim!.scale.x, 5);
    expect(rim!.material).not.toBe(calm);
  });

  it('is coloured by damage type, and recolours with tint', () => {
    const t = createTelegraph({ shape: 'circle', size: 2 }, 'physical');
    const rim = t.object.children[0] as Mesh;
    const before = rim.material;
    t.tint!('cold');
    expect(rim.material).not.toBe(before);
    expect(TELEGRAPH_COLORS.cold.rim).not.toBe(TELEGRAPH_COLORS.fire.rim);
    expect(telegraphType(['spell', 'cold', 'area'])).toBe('cold');
    expect(telegraphType(['attack', 'melee'])).toBe('physical');
  });

  it('a zone shows its whole area and never counts down', () => {
    const z = createTelegraph({ shape: 'circle', size: 3 }, 'chaos', 1, { zone: true });
    const [rim, sweep] = z.object.children as Mesh[];
    const calm = rim!.material;
    z.update(0);
    expect(sweep!.scale.x).toBeCloseTo(3, 5);
    z.update(1);
    expect(rim!.material).toBe(calm);
  });
});
