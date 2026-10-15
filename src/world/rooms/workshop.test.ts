import { describe, expect, it } from 'vitest';
import { buildModel, MODEL_LIBRARY, TEXTURE_LIBRARY } from '../../engine';
import { inside, type Rect } from '../../riftlight/ui/kit';
import { defLines, pickerLayout, shortTitle, usesOf, wrapParts } from './workshop';

const within = (outer: Rect, r: Rect) => r.x >= outer.x && r.y >= outer.y && r.x + r.w <= outer.x + outer.w && r.y + r.h <= outer.y + outer.h;

describe('Asset Workshop picker', () => {
  // landscape at the default and the compare art sizes, the widest adaptive screen, a phone in portrait (390 × 844 → 124 × 270)
  const screens = [
    [480, 270],
    [320, 180],
    [648, 270],
    [124, 270],
  ] as const;

  it('fits on every screen, its parts inside the panel and apart', () => {
    for (const [w, h] of screens) {
      const lay = pickerLayout(w, h);
      const at = `${w}x${h}`;
      expect(within({ x: 0, y: 0, w, h }, lay.panel), at).toBe(true);
      for (const r of [lay.prev, lay.next, lay.def, lay.list, lay.info]) expect(within(lay.panel, r), `${at} ${JSON.stringify(r)}`).toBe(true);
      expect(lay.rows, at).toBeGreaterThanOrEqual(3);
      expect(lay.list.y + lay.list.h, at).toBeLessThan(lay.info.y);
      // the hints (3×5 font, 7 px a line) go under the pick's lines and fit across the panel
      expect(lay.info.y + lay.info.h + lay.hints.length * 7, at).toBeLessThanOrEqual(lay.panel.y + lay.panel.h - 3);
      for (const t of lay.hints) expect(t.length * 4 - 1, `${at} ${t}`).toBeLessThanOrEqual(lay.panel.w - 10);
      expect(inside(lay.list, lay.list.x + 1, lay.list.y + (lay.rows - 1) * 9 + 4), at).toBe(true);
    }
  });

  it('keeps clear of the room title in landscape (top right) and of the scene’s middle in portrait', () => {
    expect(pickerLayout(480, 270).panel.y).toBeGreaterThanOrEqual(22);
    const tall = pickerLayout(124, 270);
    expect(tall.wide).toBe(false);
    expect(tall.panel.y).toBeGreaterThan(270 / 2);
  });

  it('stays between a phone’s touch bar and its controls, with fewer rows and lines but never under 3 rows', () => {
    // a phone in portrait (the bar down to art row 15, controls from 214) and in landscape (the bar to 30, buttons from 150)
    for (const [w, h, top, bottom] of [
      [130, 282, 15, 214],
      [584, 270, 30, 150],
    ] as const) {
      const lay = pickerLayout(w, h, { top, bottom, touch: true });
      expect(lay.panel.y + lay.panel.h, `${w}x${h}`).toBeLessThanOrEqual(bottom);
      expect(lay.panel.y, `${w}x${h}`).toBeGreaterThanOrEqual(Math.max(22, top));
      expect(lay.rows, `${w}x${h}`).toBeGreaterThanOrEqual(3);
      expect(lay.hints.every((t) => t.startsWith('TAP')), `${w}x${h}`).toBe(true);
    }
  });

  it('shortens a shelf’s title to fit the header, dropping what says least first', () => {
    expect(shortTitle('LIBRARY · architecture', 23)).toBe('LIBRARY · ARCHITECTURE');
    expect(shortTitle('PACK · Kenney Nature Kit 2.1', 23)).toBe('KENNEY NATURE KIT 2.1');
    expect(shortTitle('PACK · Kenney Tiny Town 1.1 · textures', 23)).toBe('TINY TOWN · TEXTURES');
    expect(shortTitle('PACK · Kenney Furniture Kit 2.0', 13)).toBe('FURNITURE KIT');
    expect(shortTitle('LIBRARY · architecture', 8)).toBe('ARCHITEC');
  });

  it('breaks a measure between its parts', () => {
    expect(wrapParts('1.48 X 2.2 X 0.32 M · 392 TRIS · 7 DRAWS', 26, 2)).toEqual(['1.48 X 2.2 X 0.32 M', '392 TRIS · 7 DRAWS']);
    expect(wrapParts('16 X 16 TEXELS · 2 M A TILE IN THE GAME', 40, 2)).toEqual(['16 X 16 TEXELS · 2 M A TILE IN THE GAME']);
  });
});

describe('Asset Workshop DEF view', () => {
  it('says what a model is made of: its parts, slots, params and the models it uses', () => {
    const campfire = MODEL_LIBRARY.get('campfire');
    const lines = defLines(campfire, buildModel(campfire));
    expect(lines[0]).toMatch(/^MODELDEF: PARTS FROM ITS PARAMS, \d+ PRIMITIVES$/);
    expect(lines.find((l) => l.startsWith('SLOTS'))).toContain('flame=orange');
    expect(usesOf(campfire).sort()).toEqual(['flame', 'stone-ring']);
    expect(lines).toContain('USES stone-ring, flame');
    expect(lines.find((l) => l.startsWith('LIGHT'))).toBe('LIGHT flame · 6 M · torch');
    expect(defLines(MODEL_LIBRARY.get('window'))).toContain('PARAMS width 0.8 (0.4-2), height 1 (0.5-1.8)');
    expect(defLines(MODEL_LIBRARY.get('crate'))).toContain('USES NONE');
  });

  it('says what a texture is made of: its size, layers and slots', () => {
    const lines = defLines(TEXTURE_LIBRARY.get('bricks'));
    expect(lines[0]).toBe('TEXTUREDEF: 16 X 16 TEXELS · TILES');
    expect(lines[1]).toBe('LAYERS PATTERN bricks');
    expect(lines[2]).toMatch(/^SLOTS mortar=\w+ stone=\w+/);
  });
});
