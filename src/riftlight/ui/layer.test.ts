import { describe, expect, it } from 'vitest';
import type { Panel } from '../game/ports';
import type { UiEvent } from './kit';
import { UiLayer } from './layer';
import { Menu } from './menu';

/** A menu with one slider (0..1 in tenths). */
function slider() {
  const state = { v: 0.5 };
  const menu = new Menu(
    () => [
      {
        kind: 'slider' as const,
        id: 'dither',
        label: '  Dither',
        name: 'Game Boy dither',
        get: () => state.v,
        set: (u: number) => (state.v = Math.round(u * 10) / 10),
        step: (u: number, d: 1 | -1) => Math.min(1, Math.max(0, u + d * 0.1)),
        format: () => state.v.toFixed(1),
      },
    ],
    { id: 'look.palette', title: 'Palettes' },
  );
  return { menu, state };
}

const nav = (dir: 'left' | 'right'): UiEvent => ({ kind: 'nav', dir });
const tap: UiEvent = { kind: 'pointer', type: 'down', x: 10, y: 10 };

describe('hiding a panel (peek)', () => {
  it('only a peek panel hides; keys still tweak it; a tap or back shows it again', () => {
    const layer = new UiLayer();
    const plain: Panel = { id: 'pause', title: 'Paused', size: { w: 100, h: 50 }, draw: () => {} };
    layer.open(plain);
    expect(layer.togglePeek()).toBe(false);
    const { menu, state } = slider();
    layer.open(menu, { peek: 'H shows' });
    expect(layer.togglePeek()).toBe(true);
    expect(layer.peeking).toBe(true);
    // the arrows still reach the hidden slider
    expect(layer.input(nav('right'))).toBe(true);
    expect(state.v).toBeCloseTo(0.6);
    expect(menu.focusLine()).toBe('Game Boy dither 0.6');
    // a tap anywhere shows it (and doesn't reach the world or the menu)
    expect(layer.input(tap)).toBe(true);
    expect(layer.peeking).toBe(false);
    // back shows it instead of closing it
    layer.togglePeek();
    expect(layer.input({ kind: 'back' })).toBe(true);
    expect(layer.peeking).toBe(false);
    expect(layer.top?.panel).toBe(menu);
    // back again (shown) closes it, and the pause menu under it never hides
    layer.input({ kind: 'back' });
    expect(layer.top?.panel).toBe(plain);
    expect(layer.togglePeek()).toBe(false);
  });

  it('a hidden panel is not hit; opening anything shows panels again', () => {
    const layer = new UiLayer();
    const { menu } = slider();
    layer.open(menu, { peek: 'H shows' });
    layer.top!.rect = { x: 20, y: 20, w: 80, h: 40 };
    expect(layer.covers(30, 30)).toBe(true);
    layer.togglePeek();
    expect(layer.covers(30, 30)).toBe(false);
    const other: Panel = { id: 'codex', title: 'Codex', size: { w: 50, h: 50 }, draw: () => {} };
    layer.open(other);
    expect(layer.peeking).toBe(false);
  });
});

describe('a bare panel under the title (below)', () => {
  /** A bare panel of `h` rows that remembers the rect it was drawn in. */
  const panel = (h: number) => {
    const p = { id: 'title', title: '', size: { w: 100, h }, drawn: null as null | { y: number; h: number }, draw: (_ui: unknown, r: { y: number; h: number }) => (p.drawn = { y: r.y, h: r.h }), handle: () => false };
    return p;
  };
  const ui = { w: 320, h: 240 } as unknown as Parameters<UiLayer['draw']>[0];

  it('centres as before when the logo leaves room, and starts under it when not', () => {
    const layer = new UiLayer();
    const p = panel(80);
    let below = 40;
    layer.open(p as unknown as Panel, { modal: false, bare: true, silent: true, below: () => below });
    for (let i = 0; i < 10; i++) layer.update?.(0.05);
    layer.draw(ui, 1);
    expect(p.drawn).toEqual({ y: 80, h: 80 }); // centred: (240 - 80) / 2
    below = 110; // a 4:3 screen: the logo and its tagline reach row 110
    layer.draw(ui, 1);
    expect(p.drawn!.y).toBe(110);
    expect(p.drawn!.y + p.drawn!.h).toBeLessThanOrEqual(240 - 2);
  });

  it('a menu taller than the room left under the logo gets only that room (it scrolls)', () => {
    const layer = new UiLayer();
    const p = panel(200);
    layer.open(p as unknown as Panel, { modal: false, bare: true, silent: true, below: () => 100 });
    for (let i = 0; i < 10; i++) layer.update?.(0.05);
    layer.draw(ui, 1);
    expect(p.drawn!.y).toBe(100);
    expect(p.drawn!.h).toBe(240 - 100 - 2);
  });
});
