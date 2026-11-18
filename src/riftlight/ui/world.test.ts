// The way-out mark of a moment's escape (`beacon`): a ring and chevron where the spot is in view, an
// arrow pointing the way where it isn't, always clear of the HUD's zones and taking its place in the
// layout, so labels and damage numbers keep off it. Drawn on a stand-in canvas under a camera
// looking straight down: 10 art pixels a metre, +x right, +z down the screen.
import { OrthographicCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { PaletteColor } from '../../engine';
import type { UiCanvas } from './kit';
import { type Box, HudLayout, overlaps } from './layout';
import { beacon } from './world';

const W = 334;
const H = 284;
/** The HUD's zones at the top of a narrow wide screen: the label (top-left), the minimap and gold (top-right). */
const ZONES: Box[] = [
  { x: 4, y: 4, w: 90, h: 26 },
  { x: W - 90, y: 2, w: 90, h: 82 },
];

function camera(): OrthographicCamera {
  const cam = new OrthographicCamera(-W / 20, W / 20, H / 20, -H / 20, 0.1, 100);
  cam.position.set(0, 10, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** Where a world point lands (art pixels) under `camera()`. */
const art = (x: number, z: number) => ({ x: W / 2 + x * 10, y: H / 2 + z * 10 });

/** The beacon for `spot` drawn at `time` over a layout holding the HUD's zones: what it drew, and the layout after. */
function draw(spot: Vector3, time: number) {
  const rects: (Box & { color: PaletteColor })[] = [];
  const ui = { w: W, h: H, rect: (x: number, y: number, w: number, h: number, color: PaletteColor) => void rects.push({ x, y, w, h, color }) };
  const layout = new HudLayout();
  layout.clear(W, H);
  for (const z of ZONES) layout.reserve(z);
  beacon(ui as unknown as UiCanvas, camera(), spot, 1.5, 'cyan', time, layout);
  return { rects, layout, mark: rects.filter((r) => !(r.color === 'cyan' && r.w === 2 && r.h === 1)) }; // the ring's dots lie on the ground, under the HUD
}

const TIMES = [0, 0.13, 0.26, 0.4, 0.55, 0.7, 0.9];

describe('beacon: the way to a moment’s spot', () => {
  it('off screen: an arrow at the edge toward the spot, stepped clear of the minimap and the label, longer than wide', () => {
    const spot = new Vector3(30, 0, -20); // far up and to the right: the edge there is under the minimap
    const want = art(30, -20);
    for (const time of TIMES) {
      const { mark, layout } = draw(spot, time);
      expect(mark.length, `${time}: an arrow`).toBeGreaterThan(20);
      for (const r of mark) {
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `${time}: on screen ${JSON.stringify(r)}`).toBe(true);
        for (const z of ZONES) expect(overlaps(r, z, 0), `${time}: ${JSON.stringify(r)} under the HUD zone ${JSON.stringify(z)}`).toBe(false);
      }
      // it points the way: from its middle to its tip (its farthest pixel along the way) toward the spot
      const cyan = mark.filter((r) => r.color === 'cyan');
      const mid = { x: cyan.reduce((s, r) => s + r.x + 1, 0) / cyan.length, y: cyan.reduce((s, r) => s + r.y + 1, 0) / cyan.length };
      const way = { x: want.x - mid.x, y: want.y - mid.y };
      const len = Math.hypot(way.x, way.y);
      const d = { x: way.x / len, y: way.y / len };
      const along = cyan.map((r) => (r.x + 1 - mid.x) * d.x + (r.y + 1 - mid.y) * d.y);
      const across = cyan.map((r) => -(r.x + 1 - mid.x) * d.y + (r.y + 1 - mid.y) * d.x);
      const tip = cyan[along.indexOf(Math.max(...along))]!;
      expect(Math.abs(across[cyan.indexOf(tip)]!), `${time}: its tip is on the line to the spot`).toBeLessThanOrEqual(1.5);
      const length = Math.max(...along) - Math.min(...along);
      const width = Math.max(...across) - Math.min(...across);
      expect(length, `${time}: an arrow reads as pointing: longer (${length}) than wide (${width})`).toBeGreaterThan(width * 1.25);
      // its place is taken: a label that wants it moves off
      const box = { x: Math.min(...mark.map((r) => r.x)), y: Math.min(...mark.map((r) => r.y)), w: 4, h: 4 };
      expect(layout.free(box), `${time}: the arrow's place is taken`).toBe(false);
    }
  });

  it('on screen but under the HUD: no chevron hidden under it; an arrow beside it points there', () => {
    const spot = new Vector3(13, 0, -9); // under the minimap
    const at = art(13, -9);
    expect(overlaps({ x: at.x, y: at.y, w: 1, h: 1 }, ZONES[1]!, 0)).toBe(true);
    for (const time of TIMES) {
      const { mark } = draw(spot, time);
      expect(mark.length).toBeGreaterThan(20);
      for (const r of mark) for (const z of ZONES) expect(overlaps(r, z, 0), `${time}: ${JSON.stringify(r)} under ${JSON.stringify(z)}`).toBe(false);
    }
  });

  it('on screen in the open: the ring on the ground and the chevron over it, its place taken', () => {
    const spot = new Vector3(0, 0, 3);
    const at = art(0, 3);
    for (const time of TIMES) {
      const { rects, mark, layout } = draw(spot, time);
      const ring = rects.filter((r) => r.color === 'cyan' && r.w === 2 && r.h === 1);
      expect(ring.length, 'the ring').toBeGreaterThan(30);
      for (const r of ring) expect(Math.hypot(r.x - at.x, r.y - at.y)).toBeLessThanOrEqual(16);
      const chevron = mark.filter((r) => r.color === 'cyan');
      expect(chevron.map((r) => r.w)).toEqual([11, 9, 7, 5, 3]);
      for (const r of chevron) {
        expect(r.y).toBeLessThan(at.y - 12); // over the spot
        expect(Math.abs(r.x + r.w / 2 - (at.x + 0.5))).toBeLessThanOrEqual(1);
      }
      expect(layout.free({ x: at.x - 2, y: chevron[0]!.y, w: 4, h: 4 }), 'the chevron’s place is taken').toBe(false);
    }
  });
});
