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
