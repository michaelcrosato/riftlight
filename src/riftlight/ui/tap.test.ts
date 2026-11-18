// Panels a thumb can use on a phone (`UiLayer.tap`, `tapArt`): on a page with touch controls every
// row, button and tab is about 44 CSS px tall at the art's density (22 art rows on a landscape
// phone, 15 in portrait); the pause menu lays its buttons out as two columns of tiles where one
// column would scroll (a landscape phone); a narrow character sheet turns its pages with a pager
// instead of cutting their names; a mouse's or a pad's screen keeps its layout.
import { describe, expect, it } from 'vitest';
import { textWidthPx } from '../../engine';
import { computeFraming, RESOLUTIONS, touchScale } from '../../engine/framing';
import { StatSheet } from '../core/mods';
import { RIFTLIGHT_OPTIONS } from '../index';
import { t } from '../lang';
import { type Rect, UiCanvas } from './kit';
import { tapArt, TAP_CSS } from './layer';
import { pauseMenu } from './menus';
import { CharacterSheet, SHEET_PAGES } from './panels';

/** The renderer's view on a page: its framing at Riftlight's density, touch controls or not. */
function view(width: number, height: number, dpr: number, touch: boolean) {
  const density = touch ? (RIFTLIGHT_OPTIONS.touchDensity ?? 0) : 0;
  return { touchDensity: density, framing: computeFraming(width, height, dpr, RESOLUTIONS.default, 'fill', touchScale({ width, height, dpr }, density)) };
}

/** A canvas that records the texts drawn (their left edge, width and words). */
function canvas(W: number, H: number) {
  const texts: { x: number; y: number; w: number; s: string }[] = [];
  const hud = {
    width: W,
    height: H,
    rect() {},
    sprite() {},
    text(x: number, y: number, s: string, o: { scale?: number } = {}) {
      texts.push({ x, y, w: textWidthPx(s, o.scale ?? 1), s });
    },
    measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
  };
  return { ui: new UiCanvas(hud as never), texts };
}

const host = () => ({ saves: { last: null, slots: [], volatile: false, lastError: '' }, sound: () => {}, resume: () => {}, openPanel: () => {}, photoMode: () => {}, lookStudio: () => {} }) as never;

const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('a thumb on the panels', () => {
  it('a target is about 44 CSS px on a page with touch controls, in either orientation; none elsewhere', () => {
    const landscape = view(844, 390, 2, true);
    expect(landscape.framing.artHeight, 'a landscape phone draws about 195 rows').toBeLessThanOrEqual(200);
    expect(tapArt(landscape)).toBe(22);
    expect(tapArt(view(844, 390, 3, true))).toBe(22);
    expect(tapArt(view(390, 844, 3, true))).toBe(15);
    for (const v of [landscape, view(390, 844, 2, true)]) expect(tapArt(v) * (v.framing.cssWidth / v.framing.artWidth)).toBeGreaterThanOrEqual(TAP_CSS);
    // a mouse's or a pad's screen (no touch controls) keeps its layout
    expect(tapArt(view(1920, 1080, 1, false))).toBe(0);
    expect(tapArt(view(844, 390, 2, false))).toBe(0);
  });

  it('the pause menu: two columns of thumb-tall tiles on a landscape phone (no scrolling), one column elsewhere; the d-pad moves through the grid', () => {
    const menu = pauseMenu(host());
    // a landscape phone's room inside the frame (422×195 art: 410×169)
    menu.fit(410, 169, 22);
    expect(menu.columns).toBe(2);
    const r = { x: 6, y: 16, w: menu.size.w, h: menu.size.h };
    expect(r.h).toBeLessThanOrEqual(169);
    menu.draw(canvas(422, 195).ui, r);
    const buttons = menu.items().filter((w) => w.kind === 'button');
    const rects = buttons.map((b) => menu.rects.get(b.id)!);
    expect(rects.every(Boolean), 'every button shows: nothing scrolled away').toBe(true);
    for (const b of rects) {
      expect(b.h, 'a thumb tall').toBeGreaterThanOrEqual(22);
      expect(inside(b, r), `${JSON.stringify(b)} inside the menu`).toBe(true);
    }
    expect(new Set(rects.map((b) => b.x)).size, 'two columns').toBe(2);
    // down goes a row, right the tile beside it
    const at = () => buttons.findIndex((b) => b.id === menu.items()[menu.focus]!.id);
    expect(at()).toBe(0);
    menu.input({ kind: 'nav', dir: 'down' });
    expect(at()).toBe(2);
    menu.input({ kind: 'nav', dir: 'right' });
    expect(at()).toBe(3);
    menu.input({ kind: 'nav', dir: 'up' });
    expect(at()).toBe(1);
    // a tap on a tile acts on it
    menu.focusId('resume');
    // a portrait phone: one column of rows a thumb tall
    menu.fit(118, 256, 15);
    expect(menu.columns).toBe(1);
    const p = { x: 6, y: 16, w: menu.size.w, h: Math.min(256, menu.size.h) };
    menu.draw(canvas(130, 282).ui, p);
    const shown = [...menu.rects.values()];
    expect(shown.length).toBeGreaterThan(4);
    for (const b of shown) expect(b.h).toBeGreaterThanOrEqual(15);
    // a desktop (no thumb): one column, as before
    menu.fit(468, 244, 0);
    expect(menu.columns).toBe(1);
    menu.draw(canvas(480, 270).ui, { x: 170, y: 30, w: menu.size.w, h: menu.size.h });
    expect(menu.rects.get('resume')!.h).toBe(14);
  });

  it('the character sheet on a phone in portrait turns its pages with a pager: every page name whole, its tabs and rows a thumb tall', () => {
    const sheet = new CharacterSheet(() => new StatSheet(), () => 'Level 1 · Deepest 0');
    sheet.fit(118, 256, 15);
    const r = { x: 6, y: 16, w: sheet.size.w, h: sheet.size.h };
    for (const [i, page] of SHEET_PAGES.entries()) {
      const { ui, texts } = canvas(130, 282);
      sheet.page = i;
      sheet.draw(ui, r);
      const name = t(`panel.character.page.${page.id}`);
      expect(texts.map((x) => x.s), `${page.id}: its name whole`).toContain(name);
      expect(texts.some((x) => x.s.endsWith('.') && name.startsWith(x.s.slice(0, -1))), `${page.id}: no name cut`).toBe(false);
    }
    // a tap on the pager's right half turns on, on its left half back
    sheet.page = 0;
    const y = r.y + 12 + 7;
    sheet.input({ kind: 'pointer', type: 'down', x: r.x + r.w - 10, y });
    expect(sheet.page).toBe(1);
    sheet.input({ kind: 'pointer', type: 'down', x: r.x + 10, y });
    sheet.input({ kind: 'pointer', type: 'down', x: r.x + 10, y });
    expect(sheet.page).toBe(SHEET_PAGES.length - 1);
    // a wide screen keeps its tabs
    const wide = new CharacterSheet(() => new StatSheet(), () => 'Level 1');
    wide.fit(410, 169, 22);
    const { ui, texts } = canvas(422, 195);
    wide.draw(ui, { x: 6, y: 16, w: wide.size.w, h: Math.min(169, wide.size.h) });
    for (const p of SHEET_PAGES) expect(texts.map((x) => x.s)).toContain(t(`panel.character.page.${p.id}`));
    expect(wide.size.h, 'its thumb-tall rows fit a landscape phone').toBeLessThanOrEqual(169);
  });
});
