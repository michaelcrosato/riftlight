// Riftlight's touch buttons in 52in1: ≡ below the hub's wake band (a touch above 90 CSS px brings
// the hub's bar over the game), the page's and the data's layout alike; hidden in a 52in1 round,
// which has no pause menu (the hub's bar is the menu there), the Map button in its place where the
// corner map takes no tap. On its own page ≡ stays in the corner, and there is no Map button.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Engine, TouchButtonState } from '../../engine';
import { KEYS } from './controls';
import type { Box } from '../ui/layout';
import { HUB_WAKE, MAP_ICON, RIFTLIGHT_HUB_TOUCH_BUTTONS, RIFTLIGHT_TOUCH_BUTTONS, TOUCH_CODES, TouchPad, touchLayout } from './touch';

/** An engine with touch controls that records what the pad sets on them (and where the stick's zone gives way: `ways`), in 52in1 (`hub`) or not. */
function fakeEngine(hub: boolean) {
  const set = new Map<string, TouchButtonState>();
  const ways: Box[][] = [];
  const viewport = { width: 390, height: 844, dpr: 3 };
  const engine = {
    hubSettings: { present: hub },
    input: { device: 'touch' },
    renderer: { viewport, touchDensity: 2, resolution: { width: 195, height: 422 }, framing: { offsetX: 0, offsetY: 0, cssWidth: 390, cssHeight: 844, artWidth: 195, artHeight: 422 } },
    // the page's canvas: two CSS px an art pixel, 10 px down the page
    gpu: { renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 10, width: 390, height: 844 }) } } },
    touch: {
      visible: true,
      show() {},
      giveWay: (rects: readonly Box[]) => void ways.push(rects.map((r) => ({ ...r }))),
      set: (code: string, s: TouchButtonState) => set.set(code, { ...set.get(code), ...s }),
    },
  };
  return { engine: engine as unknown as Engine, set, ways };
}

describe('≡ in 52in1', () => {
  it('sits below the hub’s wake band there (its centre 112 CSS px down), in the corner on its own page; the data lays it where the page does', () => {
    const menu = (buttons = RIFTLIGHT_TOUCH_BUTTONS) => touchLayout(390, 844, buttons).at(-1)!;
    expect(RIFTLIGHT_HUB_TOUCH_BUTTONS.at(-1)!.code).toBe(TOUCH_CODES.menu);
    expect(menu(RIFTLIGHT_HUB_TOUCH_BUTTONS).y, 'its top on the wake band').toBeGreaterThanOrEqual(HUB_WAKE);
    expect(menu(RIFTLIGHT_HUB_TOUCH_BUTTONS).y + menu(RIFTLIGHT_HUB_TOUCH_BUTTONS).h / 2).toBeGreaterThanOrEqual(112);
    expect(menu().y + menu().h, 'on its own page: in the corner').toBeLessThan(HUB_WAKE);
    // the rest of the cluster is the same either way (52in1's has the Map button too)
    expect(RIFTLIGHT_HUB_TOUCH_BUTTONS.slice(0, -1).filter((b) => b.code !== TOUCH_CODES.map)).toEqual(RIFTLIGHT_TOUCH_BUTTONS.slice(0, -1));
    // where there is no page (headless, a replay) the data lays the controls out as the page would
    const inHub = new TouchPad(fakeEngine(true).engine).dataLayout().at(-1)!;
    const alone = new TouchPad(fakeEngine(false).engine).dataLayout().at(-1)!;
    expect(inHub.y * 2, 'in art pixels: the hub’s place').toBeGreaterThanOrEqual(HUB_WAKE - 2);
    expect(alone.y * 2 + alone.h * 2).toBeLessThan(HUB_WAKE);
  });

  it('is hidden in a 52in1 round (no pause menu there) and shows out of one', () => {
    const { engine, set } = fakeEngine(true);
    const pad = new TouchPad(engine);
    pad.sync({ playing: true, round: true, skills: [], interact: null });
    expect(set.get(TOUCH_CODES.menu)?.hidden, 'in a round').toBe(true);
    pad.sync({ playing: true, skills: [], interact: null });
    expect(set.get(TOUCH_CODES.menu)?.hidden, 'out of one').toBe(false);
  });
});

describe('the Map button in 52in1', () => {
  afterEach(() => void vi.unstubAllGlobals());

  it('sits where ≡ does, below the hub’s wake band and a thumb across, pressing the map’s key; none on the game’s own page', () => {
    const at = (code: string) => touchLayout(390, 844, RIFTLIGHT_HUB_TOUCH_BUTTONS)[1 + RIFTLIGHT_HUB_TOUCH_BUTTONS.findIndex((b) => b.code === code)]!;
    const map = RIFTLIGHT_HUB_TOUCH_BUTTONS.find((b) => b.code === TOUCH_CODES.map);
    expect(map, '52in1 has a Map button').toBeDefined();
    expect(KEYS.map as readonly string[], 'it presses a key the map opens with').toContain(map!.code);
    expect(at(TOUCH_CODES.map), 'in ≡’s place').toEqual(at(TOUCH_CODES.menu));
    expect(at(TOUCH_CODES.map).y, 'below the wake band').toBeGreaterThanOrEqual(HUB_WAKE);
    expect(Math.min(at(TOUCH_CODES.map).w, at(TOUCH_CODES.map).h), 'a thumb across').toBeGreaterThanOrEqual(44);
    expect(RIFTLIGHT_HUB_TOUCH_BUTTONS.at(-1)!.code, '≡ still last').toBe(TOUCH_CODES.menu);
    expect(RIFTLIGHT_TOUCH_BUTTONS.map((b) => b.code), 'none on its own page').not.toContain(TOUCH_CODES.map);
  });

  it('shows, drawn as a map, only in a round where the corner map takes no tap; hidden out of one, where the map takes a tap and in the showcase', () => {
    // the icon's canvas (the page's), as a stand-in that draws nothing
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
    const { engine, set } = fakeEngine(true);
    const pad = new TouchPad(engine);
    pad.sync({ playing: true, round: true, map: true, skills: [], interact: null });
    expect(set.get(TOUCH_CODES.map)?.hidden, 'a round, the corner map no tap target').toBe(false);
    expect(set.get(TOUCH_CODES.map)?.icon, 'drawn as a map').toBeTruthy();
    expect(set.get(TOUCH_CODES.menu)?.hidden, '≡ hidden under it').toBe(true);
    pad.sync({ playing: true, round: true, skills: [], interact: null });
    expect(set.get(TOUCH_CODES.map)?.hidden, 'a round where the corner map takes a tap').toBe(true);
    pad.sync({ playing: true, map: true, showcase: true, skills: [], interact: null });
    expect(set.get(TOUCH_CODES.map)?.hidden, 'the showcase').toBe(true);
    pad.sync({ playing: true, skills: [], interact: null });
    expect(set.get(TOUCH_CODES.map)?.hidden, 'out of a round: ≡, whose pause menu has Map').toBe(true);
    expect(MAP_ICON.rows.every((r) => r.length === MAP_ICON.rows[0]!.length), 'a rectangle of pixels').toBe(true);
  });
});

describe("the floating stick's zone", () => {
  it('gives way to what a finger taps while you play (the loot labels, in client CSS px), to a showcase panel in a showcase, and to nothing else', () => {
    const { engine, ways } = fakeEngine(false);
    const pad = new TouchPad(engine);
    const label = { x: 10, y: 300, w: 40, h: 10 };
    pad.sync({ playing: true, skills: [], interact: null, giveWay: [label] });
    expect(ways.at(-1), 'the label, in client CSS px').toEqual([{ x: 20, y: 610, w: 80, h: 20 }]);
    pad.sync({ playing: true, skills: [], interact: null });
    expect(ways.at(-1), 'none drawn: the whole zone the stick’s').toEqual([]);
    const panel = { x: 0, y: 200, w: 100, h: 100 };
    pad.sync({ playing: true, showcase: { interact: null, giveWay: [panel] }, skills: [], interact: null, giveWay: [label] });
    expect(ways.at(-1), 'a showcase panel, not the labels').toEqual([{ x: 0, y: 410, w: 200, h: 200 }]);
    pad.sync({ playing: true, showcase: true, skills: [], interact: null, giveWay: [label] });
    expect(ways.at(-1), 'a showcase mode with no panel: none').toEqual([]);
  });
});
