// Panels a thumb can use on a phone (`UiLayer.tap`, `tapArt`): on a page with touch controls every
// row, button and tab is about 44 CSS px tall at the art's density (22 art rows on a landscape
// phone, 15 in portrait); the pause and title menus lay their buttons out as two columns of tiles
// where one column would scroll (a landscape phone); a menu whose thumb-tall rows would scroll
// shrinks them to its room where that keeps every row in view, and one that scrolls anyway shows a
// scroll bar; a narrow character sheet turns its pages with a pager instead of cutting their
// names; a mouse's or a pad's screen keeps its layout.
import { describe, expect, it } from 'vitest';
import { textWidthPx } from '../../engine';
import { computeFraming, RESOLUTIONS, touchScale } from '../../engine/framing';
import { StatSheet } from '../core/mods';
import { RIFTLIGHT_OPTIONS } from '../index';
import { t } from '../lang';
import { type Rect, UiCanvas } from './kit';
import { tapArt, TAP_CSS } from './layer';
import { Menu, type Widget } from './menu';
import { pauseMenu, slotsMenu, titleMenu } from './menus';
import { CharacterSheet, SHEET_PAGES } from './panels';
import { NORMAL } from '../game/difficulty';

/** The renderer's view on a page: its framing at Riftlight's density, touch controls or not. */
function view(width: number, height: number, dpr: number, touch: boolean) {
  const density = touch ? (RIFTLIGHT_OPTIONS.touchDensity ?? 0) : 0;
  return { touchDensity: density, framing: computeFraming(width, height, dpr, RESOLUTIONS.default, 'fill', touchScale({ width, height, dpr }, density)) };
}

/** A canvas that records the texts drawn (their left edge, width and words) and the rects. */
function canvas(W: number, H: number) {
  const texts: { x: number; y: number; w: number; s: string }[] = [];
  const rects: (Rect & { color: string })[] = [];
  const hud = {
    width: W,
    height: H,
    rect(x: number, y: number, w: number, h: number, color: string) {
      rects.push({ x, y, w, h, color });
    },
    sprite() {},
    text(x: number, y: number, s: string, o: { scale?: number } = {}) {
      texts.push({ x, y, w: textWidthPx(s, o.scale ?? 1), s });
    },
    measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
  };
  return { ui: new UiCanvas(hud as never), texts, rects };
}

const host = (o: { last?: number | null; languages?: number; opened?: string[]; device?: string } = {}) =>
  ({
    saves: { last: o.last ?? null, slots: [0, 1, 2].map((slot) => ({ slot, empty: slot !== 0, error: false, level: 3, deepest: 2 })), volatile: false, lastError: '' },
    slot: 0,
    sound: () => {},
    resume: () => {},
    openPanel: (id: string) => o.opened?.push(id),
    openMenu: (m: Menu) => o.opened?.push(m.id),
    difficulty: () => NORMAL,
    photoMode: () => {},
    lookStudio: () => {},
    engineWorld: () => {},
    language: o.languages ? { available: ['en', 'de', 'fr', 'ja'].slice(0, o.languages), current: 'en', asked: false, choose: () => {} } : undefined,
    // the device in use (the slots' export and import are the keyboard's: `slotFiles`)
    engine: { controls: { device: o.device ?? 'keyboard' }, hubSettings: { present: false } },
  }) as never;

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

  it('the pause menu: two columns of thumb-tall tiles on a landscape phone (no scrolling), one column elsewhere; the d-pad moves through the grid, a tap acts on a tile', () => {
    const opened: string[] = [];
    const menu = pauseMenu(host({ opened }));
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
    // a tap on a tile acts on it (Tuning opens its menu)
    const tuning = menu.rects.get('tuning')!;
    menu.input({ kind: 'pointer', type: 'down', x: tuning.x + 4, y: tuning.y + 4 });
    menu.input({ kind: 'pointer', type: 'up', x: tuning.x + 4, y: tuning.y + 4 });
    expect(opened, 'the tap on Tuning opened the tuning menu').toEqual(['tuning']);
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

  it('a small landscape phone (568×320: 284×160 art, a room 272 wide) gets the pause menu\'s grid too, its tiles narrowed to the room: every entry in view', () => {
    const v = view(568, 320, 2, true);
    expect([v.framing.artWidth, v.framing.artHeight]).toEqual([284, 160]);
    const tap = tapArt(v);
    const menu = pauseMenu(host());
    // the room inside the frame, the legend's rows under it (`UiLayer.draw`)
    menu.fit(272, 123, tap);
    expect(menu.columns, 'two columns of tiles narrower than the menu').toBe(2);
    expect(menu.size.w).toBeLessThanOrEqual(272);
    expect(menu.size.h).toBeLessThanOrEqual(123);
    const r = { x: 6, y: 16, w: menu.size.w, h: menu.size.h };
    const { ui, texts } = canvas(284, 160);
    menu.draw(ui, r);
    const buttons = menu.items().filter((w) => w.kind === 'button');
    for (const b of buttons) {
      const rect = menu.rects.get(b.id);
      expect(rect, `${b.id}: shown, nothing scrolled away`).toBeDefined();
      expect(inside(rect!, r), `${b.id} ${JSON.stringify(rect)} inside the menu`).toBe(true);
      expect(texts.map((x) => x.s), `${b.id}: its label whole`).toContain(b.label);
    }
    expect(new Set(buttons.map((b) => menu.rects.get(b.id)!.x)).size, 'two columns').toBe(2);
    // a room too narrow for two tiles that hold the labels stays one column
    menu.fit(120, 123, tap);
    expect(menu.columns).toBe(1);
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

  it('the title menu on a landscape phone: two columns of tiles under the logo, every entry in view with a save or without, a language menu or not', () => {
    // the room a bare panel has under the logo on a 422×195 phone (`UiLayer.draw`: 418 × 107)
    for (const o of [{}, { last: 0 }, { languages: 4 }, { last: 0, languages: 4 }]) {
      const menu = titleMenu(host(o));
      menu.fit(418, 107, 22);
      expect(menu.columns, JSON.stringify(o)).toBe(2);
      expect(menu.size.h).toBeLessThanOrEqual(107);
      const r = { x: 79, y: 91, w: menu.size.w, h: menu.size.h };
      menu.draw(canvas(422, 195).ui, r);
      const buttons = menu.items().filter((w) => w.kind === 'button');
      for (const b of buttons) {
        const at = menu.rects.get(b.id);
        expect(at, `${b.id} shows (${JSON.stringify(o)})`).toBeDefined();
        expect(inside(at!, r)).toBe(true);
        expect(at!.h, `${b.id}: near a thumb tall`).toBeGreaterThanOrEqual(20);
      }
    }
    // a portrait phone and a desktop keep one column
    const menu = titleMenu(host({ last: 0, languages: 4 }));
    menu.fit(126, 190, 15);
    expect(menu.columns).toBe(1);
    menu.fit(423, 140, 0);
    expect(menu.columns).toBe(1);
    expect(menu.size, 'a desktop\'s title menu as it always was').toEqual({ w: 130, h: 7 * 16 + 14 });
  });

  it('a menu whose thumb-tall rows would scroll shrinks them to its room where they then all show (the keyboard\'s slots in a landscape phone\'s room); a mouse\'s keeps its rows', () => {
    // a phone's own slots (no export or import there) fit its room at a thumb's height
    const phone = slotsMenu(host({ last: 0, device: 'touch' }), 'load');
    phone.fit(410, 169, 22);
    expect(phone.size.h).toBe(4 * 24 + 6 + 24 + 14);
    const menu = slotsMenu(host({ last: 0 }), 'load');
    // a landscape phone's room inside a frame (422×195: 410×169, less the legend's row)
    menu.fit(410, 158, 22);
    expect(menu.columns).toBe(1);
    expect(menu.size.h).toBeLessThanOrEqual(158);
    const r = { x: 101, y: 25, w: menu.size.w, h: menu.size.h };
    menu.draw(canvas(422, 195).ui, r);
    for (const w of menu.items().filter((x) => x.kind === 'button' || x.kind === 'choice')) expect(menu.rects.get(w.id), `${w.id} shows`).toBeDefined();
    const tallest = Math.min(...menu.items().flatMap((w) => (w.kind === 'button' ? [menu.rects.get(w.id)!.h] : [])));
    expect(tallest, 'as tall as the room lets them be: taller than a mouse\'s').toBeGreaterThan(14);
    // where they fit at a thumb's height, they keep it
    menu.fit(410, 400, 22);
    expect(menu.size.h).toBe(6 * 24 + 6 + 24 + 14);
    // a mouse's screen: as it always was
    menu.fit(410, 158, 0);
    expect(menu.size.h).toBe(6 * 16 + 6 + 15 + 14);
  });

  it('a menu that scrolls anyway (the settings on a landscape phone) keeps its thumb-tall rows and shows a scroll bar beside them', () => {
    const widgets: Widget[] = Array.from({ length: 14 }, (_, i) => ({ kind: 'toggle', id: `t${i}`, label: `Toggle ${i}`, get: () => false, set: () => {} }));
    const menu = new Menu(widgets, { id: 'many', title: 'Many', width: 200 });
    menu.fit(410, 158, 22);
    const r = { x: 100, y: 25, w: menu.size.w, h: 158 };
    const { ui, rects } = canvas(422, 195);
    menu.draw(ui, r);
    const shown = widgets.filter((w) => menu.rects.get(w.id));
    expect(shown.length).toBeLessThan(widgets.length);
    for (const w of shown) expect(menu.rects.get(w.id)!.h).toBeGreaterThanOrEqual(22);
    const bar = rects.filter((x) => x.x === r.x + r.w + 1 && x.w === 2);
    expect(bar.map((x) => x.color), 'a track and its thumb in the gutter').toEqual(['night', 'sand']);
    expect(bar[1]!.y, 'the thumb at the top').toBe(r.y + 2);
    // scrolled to the end: the thumb at the bottom of its track
    for (let i = 0; i < widgets.length; i++) menu.input({ kind: 'nav', dir: 'down' });
    menu.focusId('t13');
    const again = canvas(422, 195);
    menu.draw(again.ui, r);
    const [track, thumb] = again.rects.filter((x) => x.x === r.x + r.w + 1 && x.w === 2);
    expect(thumb!.y + thumb!.h).toBe(track!.y + track!.h);
    // a menu that fits draws none
    const few = new Menu(widgets.slice(0, 3), { id: 'few', title: 'Few', width: 200 });
    few.fit(410, 158, 22);
    const plain = canvas(422, 195);
    few.draw(plain.ui, { x: 100, y: 25, w: few.size.w, h: few.size.h });
    expect(plain.rects.filter((x) => x.x === 100 + few.size.w + 1)).toEqual([]);
  });

  it('in a grid the d-pad passes over a tile it can\'t focus (disabled), wrapping, in the direction it was going', () => {
    const b = (id: string, disabled = false): Widget => ({ kind: 'button', id, label: id.toUpperCase(), onClick: () => {}, disabled });
    // two columns: a b / c d / e f
    const menu = new Menu([b('a'), b('b', true), b('c', true), b('d'), b('e'), b('f', true)], { id: 'grid', title: 'Grid', width: 120, grid: true });
    menu.fit(300, 90, 22);
    expect(menu.columns).toBe(2);
    const at = () => menu.items()[menu.focus]!.id;
    expect(at()).toBe('a');
    menu.input({ kind: 'nav', dir: 'right' }); // b is disabled: on to c (disabled), then d
    expect(at()).toBe('d');
    menu.input({ kind: 'nav', dir: 'right' });
    expect(at()).toBe('e');
    menu.input({ kind: 'nav', dir: 'right' }); // f is disabled: around to a
    expect(at()).toBe('a');
    menu.input({ kind: 'nav', dir: 'down' }); // c is disabled: on down its column to e
    expect(at()).toBe('e');
    menu.input({ kind: 'nav', dir: 'down' }); // past the bottom: the top of its column
    expect(at()).toBe('a');
    menu.input({ kind: 'nav', dir: 'left' }); // f disabled: e
    expect(at()).toBe('e');
    menu.focusId('d');
    menu.input({ kind: 'nav', dir: 'up' }); // b is disabled, and so is f below: back to d, no move
    expect(at()).toBe('d');
  });

  it('a scrolling menu: a mouse\'s click that drifts sideways still clicks; a finger that slides sideways is a swipe and presses nothing', () => {
    let clicked = 0;
    const widgets: Widget[] = Array.from({ length: 14 }, (_, i) => ({ kind: 'button', id: `b${i}`, label: `Button ${i}`, onClick: () => clicked++ }));
    const menu = new Menu(widgets, { id: 'long', title: 'Long', width: 200 });
    menu.fit(410, 120, 0); // a laptop's small window: it scrolls
    const r = { x: 100, y: 25, w: menu.size.w, h: 120 };
    menu.draw(canvas(422, 195).ui, r);
    const b = menu.rects.get('b0')!;
    const press = (touch: boolean, dx: number) => {
      menu.input({ kind: 'pointer', type: 'down', x: b.x + 20, y: b.y + 4, touch });
      menu.input({ kind: 'pointer', type: 'move', x: b.x + 20 + dx, y: b.y + 4, touch });
      menu.input({ kind: 'pointer', type: 'up', x: b.x + 20 + dx, y: b.y + 4, touch });
    };
    press(false, 6);
    expect(clicked, 'the mouse: clicked').toBe(1);
    press(true, 6);
    expect(clicked, 'a finger sliding sideways: nothing').toBe(1);
    press(true, 1);
    expect(clicked, 'a finger\'s tap').toBe(2);
  });
});
