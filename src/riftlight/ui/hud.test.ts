import { describe, expect, it } from 'vitest';
import { computeFraming, RESOLUTIONS } from '../../engine/framing';
import { RIFTLIGHT_TOUCH_BUTTONS } from '../game/touch';
import { hudGeometry } from './hud';
import { type Box, overlaps } from './layout';

/**
 * The touch controls of a phone screen in art pixels, from the button data and the engine's
 * CSS (stick 128 px + 2 px border, 16 px from the corner; placed buttons from an 8 px safe
 * margin). The e2e `phone` suite checks the same thing against the real DOM rects.
 */
function controlsFor(vw: number, vh: number, dpr: number): { W: number; H: number; boxes: Box[] } {
  const f = computeFraming(vw, vh, dpr, RESOLUTIONS.default, 'adaptive');
  const k = f.artWidth / f.cssWidth; // art pixels per CSS pixel
  const toArt = (x: number, y: number, w: number, h: number): Box => {
    const ax = Math.floor((x - f.offsetX) * k);
    const ay = Math.floor((y - f.offsetY) * k);
    return { x: ax, y: ay, w: Math.floor((x + w - f.offsetX) * k) - ax + 1, h: Math.floor((y + h - f.offsetY) * k) - ay + 1 };
  };
  const boxes = [toArt(16, vh - 16 - 132, 132, 132)];
  for (const b of RIFTLIGHT_TOUCH_BUTTONS) {
    const at = b.at!;
    const size = at.size ?? 58;
    const corner = at.corner ?? 'bottom-right';
    const left = corner.endsWith('left') ? 8 + at.x - size / 2 : vw - 8 - at.x - size / 2;
    const top = corner.startsWith('top') ? 8 + at.y - size / 2 : vh - 8 - at.y - size / 2;
    boxes.push(toArt(left, top, size, size));
  }
  return { W: f.artWidth, H: f.artHeight, boxes };
}

const orbBox = (o: { x: number; y: number }, r: number): Box => ({ x: o.x - r - 2, y: o.y - r - 2, w: 2 * r + 5, h: 2 * r + 5 });

describe('hudGeometry with touch controls', () => {
  for (const [name, vw, vh, dpr] of [
    ['portrait phone', 390, 844, 2],
    ['portrait phone dpr 3', 390, 844, 3],
    ['landscape phone', 844, 390, 2],
    ['landscape phone dpr 3', 844, 390, 3],
    ['small portrait phone', 360, 740, 2],
  ] as const) {
    it(`${name}: no skill bar, orbs and the XP bar clear of every control and on screen`, () => {
      const { W, H, boxes } = controlsFor(vw, vh, dpr);
      const g = hudGeometry(W, H, boxes);
      expect(g.touch).toBe(true);
      const hud = [orbBox(g.life, g.orbR), orbBox(g.mana, g.orbR), { x: g.xp.x, y: g.xp.y, w: g.xp.w, h: 3 }, { x: g.levelAt.x - 12, y: g.levelAt.y, w: 24, h: 5 }];
      for (const h of hud) {
        expect(h.x).toBeGreaterThanOrEqual(0);
        expect(h.y).toBeGreaterThanOrEqual(0);
        expect(h.x + h.w).toBeLessThanOrEqual(W);
        expect(h.y + h.h).toBeLessThanOrEqual(H);
        for (const c of boxes) expect(overlaps(h, c, 0), `${JSON.stringify(h)} overlaps control ${JSON.stringify(c)}`).toBe(false);
      }
      // life on the left, mana on the right, in the bottom half
      expect(g.life.x).toBeLessThan(W / 2);
      expect(g.mana.x).toBeGreaterThan(W / 2);
      expect(Math.min(g.life.y, g.mana.y)).toBeGreaterThan(H / 2);
    });
  }

  it('landscape: the orbs sit beside the controls on the bottom row with the XP bar between them', () => {
    const { W, H, boxes } = controlsFor(844, 390, 3);
    const g = hudGeometry(W, H, boxes);
    expect(g.life.y).toBe(g.mana.y);
    expect(g.life.y + g.orbR).toBeGreaterThan(H - 12);
    expect(g.xp.x).toBeGreaterThan(g.life.x + g.orbR);
    expect(g.xp.x + g.xp.w).toBeLessThan(g.mana.x - g.orbR);
  });

  it('portrait: the top-left text starts right of the ≡ button', () => {
    const { W, H, boxes } = controlsFor(390, 844, 2);
    const g = hudGeometry(W, H, boxes);
    const menu = boxes[boxes.length - 1]!;
    expect(g.textX).toBeGreaterThan(menu.x + menu.w);
  });

  it('without controls it is the desktop / compact layout', () => {
    const g = hudGeometry(480, 270);
    expect(g.touch).toBe(false);
    expect(g.life).toEqual({ x: g.orbX, y: g.orbY });
    expect(g.mana).toEqual({ x: 480 - g.orbX, y: g.orbY });
    expect(g.xp).toEqual({ x: g.bx - 4, y: g.by - 8, w: g.barW + 2 });
  });
});
