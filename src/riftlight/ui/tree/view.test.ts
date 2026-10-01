import { describe, expect, it } from 'vitest';
import { clampZoom, PointIndex, stepToward, toScreen, toTree, zoomAt, ZOOM_LIMITS } from './camera';
import { pack, PixelBuffer, wrap } from './pixels';

describe('tree camera', () => {
  const cam = { x: 100, y: -50, zoom: 0.25 };

  it('maps tree ↔ screen and back', () => {
    expect(toScreen(cam, 480, 270, 100, -50)).toEqual([240, 135]);
    const [tx, ty] = toTree(cam, 480, 270, 300, 35);
    expect(toScreen(cam, 480, 270, tx, ty)).toEqual([300, 35]);
  });

  it('zooms about the cursor and clamps', () => {
    const z = zoomAt(cam, 480, 270, 400, 60, 2);
    expect(z.zoom).toBe(0.5);
    const before = toTree(cam, 480, 270, 400, 60);
    const after = toTree(z, 480, 270, 400, 60);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
    expect(clampZoom(100)).toBe(ZOOM_LIMITS.max);
    expect(zoomAt(cam, 480, 270, 0, 0, 0.0001).zoom).toBe(ZOOM_LIMITS.min);
  });

  it('picks the nearest node and steps along a direction', () => {
    const pts = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 60, y: 5 },
      { id: 'c', x: 0, y: 70 },
      { id: 'd', x: 500, y: 500 },
    ];
    const idx = new PointIndex(pts, 50);
    expect(idx.nearest(55, 0, 30)?.id).toBe('b');
    expect(idx.nearest(250, 250, 30)).toBeNull();
    expect(idx.nearest(2, 2, 30, (p) => p.id !== 'a')).toBeNull();
    expect(idx.inRect(-10, -10, 100, 100).map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(stepToward(pts[0]!, 1, 0, pts)?.id).toBe('b');
    expect(stepToward(pts[0]!, 0, 1, pts)?.id).toBe('c');
    expect(stepToward(pts[0]!, -1, 0, pts)).toBeNull();
  });
});

describe('pixel buffer', () => {
  it('draws crisp palette pixels', () => {
    const b = new PixelBuffer(16, 16);
    const red = pack('red');
    b.clear(pack('ink'));
    b.line(0, 0, 15, 15, red);
    for (let i = 0; i < 16; i++) expect(b.get(i, i)).toBe(red);
    b.disc(8, 8, 3, pack('sand'));
    expect(b.get(8, 5)).toBe(pack('sand'));
    expect(b.get(8, 4)).not.toBe(pack('sand'));
    expect(new Set(b.px).size).toBe(3);
  });

  it('wraps text to a column width', () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps']);
  });
});
