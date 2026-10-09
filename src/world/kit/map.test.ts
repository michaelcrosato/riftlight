import { describe, expect, it } from 'vitest';
import { Grid, mergeCells } from './map';

describe('mergeCells', () => {
  it('merges a full grid into one rectangle', () => {
    const r = mergeCells(5, 4, () => 'a');
    expect(r).toEqual([{ col: 0, row: 0, cols: 5, rows: 4, key: 'a' }]);
  });

  it('covers every cell exactly once', () => {
    const rows = ['aab.b', 'aab.b', 'ccccb', '..ccb'];
    const g = new Grid(rows);
    const rects = g.merge((ch) => (ch === '.' ? null : ch));
    const seen = new Map<string, string>();
    for (const r of rects) {
      for (let y = r.row; y < r.row + r.rows; y++)
        for (let x = r.col; x < r.col + r.cols; x++) {
          expect(seen.has(`${x},${y}`)).toBe(false);
          seen.set(`${x},${y}`, r.key);
          expect(g.at(x, y)).toBe(r.key);
        }
    }
    const filled = rows.join('').replace(/\./g, '').length;
    expect(seen.size).toBe(filled);
    expect(rects.length).toBeLessThanOrEqual(5);
  });

  it('skips null cells', () => {
    expect(mergeCells(3, 3, () => null)).toEqual([]);
  });
});

describe('Grid', () => {
  it('centres the map on the origin', () => {
    const g = new Grid(['....', '....'], 2);
    expect(g.center(0, 0)).toEqual([-3, -1]);
    expect(g.center(3, 1)).toEqual([3, 1]);
    expect(g.rect({ col: 0, row: 0, cols: 4, rows: 2, key: '.' })).toEqual({ x: 0, z: 0, w: 8, d: 4 });
  });

  it('reads short rows as empty and finds markers', () => {
    const g = new Grid(['#S#', '#']);
    expect(g.width).toBe(3);
    expect(g.at(2, 1)).toBe(' ');
    expect(g.find('S')).toEqual([[0, -0.5]]);
  });
});
