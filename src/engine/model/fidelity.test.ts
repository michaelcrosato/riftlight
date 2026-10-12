import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { modelTriangles, renderFidelity, scoreFidelity, type ColouredTris } from './fidelity';

const moved = (t: ColouredTris, d: readonly [number, number, number]): ColouredTris => ({ positions: Array.from(t.positions, (v, i) => v + d[i % 3]!), colours: t.colours });

describe('scoreFidelity', () => {
  const crate = modelTriangles('crate');

  it('scores a model against itself as a perfect match', () => {
    const s = scoreFidelity(crate, crate);
    expect(s.views).toHaveLength(8);
    expect(s.views.map((v) => `${v.scale} ${v.yaw}`)).toEqual(['game 45', 'game 135', 'game 225', 'game 315', 'close 45', 'close 135', 'close 225', 'close 315']);
    expect([s.iou, s.iouClose, s.colour]).toEqual([1, 1, 0]);
    expect(s.bounds).toEqual([0, 0, 0]);
    for (const v of s.views) expect(v.pixels.both).toBe(v.pixels.source);
  });

  it('drops with a shifted silhouette, and the close views see it first', () => {
    const s = scoreFidelity(crate, moved(crate, [0.05, 0, 0]));
    expect(s.iouClose).toBeLessThan(0.95);
    expect(s.iou).toBeLessThan(1);
    expect(s.iouClose).toBeLessThanOrEqual(s.iou);
    const far = scoreFidelity(crate, moved(crate, [2, 0, 0]));
    expect(far.iou).toBe(0);
    expect(far.colour).toBe(0); // nothing overlaps: no colour to compare
  });

  it('measures colour where both cover a pixel, and the bounds delta', () => {
    const red = { positions: crate.positions, colours: Array.from(crate.colours, () => PALETTE.red) };
    const blue = { positions: crate.positions, colours: Array.from(crate.colours, () => PALETTE.blue) };
    const s = scoreFidelity(red, blue);
    expect(s.iou).toBe(1);
    expect(s.colour).toBeGreaterThan(0.2);
    const big = modelTriangles('barrel');
    const half = { positions: Array.from(big.positions, (v) => v * 0.5), colours: big.colours };
    const height = Math.max(...Array.from(big.positions).filter((_, i) => i % 3 === 1));
    expect(scoreFidelity(big, half).bounds[1]).toBeCloseTo(-height / 2, 3); // the barrel at half height
  });

  it('draws a sheet: 8 views, the scores and the swatches', () => {
    const s = scoreFidelity(crate, moved(crate, [0.05, 0, 0]));
    const img = renderFidelity(crate, moved(crate, [0.05, 0, 0]), s, { title: 'crate', threshold: 0.98, swatches: [{ slot: 'wood', source: 0xc8915c, mapped: PALETTE.orange, name: 'orange' }] });
    expect(img.width).toBeGreaterThan(1000);
    expect(img.data.length).toBe(img.width * img.height * 4);
  });
});
