// Riftlight's touch buttons in 52in1: ≡ below the hub's wake band (a touch above 90 CSS px brings
// the hub's bar over the game), the page's and the data's layout alike; hidden in a 52in1 round,
// which has no pause menu (the hub's bar is the menu there). On its own page ≡ stays in the corner.
import { describe, expect, it } from 'vitest';
import type { Engine, TouchButtonState } from '../../engine';
import { HUB_WAKE, RIFTLIGHT_HUB_TOUCH_BUTTONS, RIFTLIGHT_TOUCH_BUTTONS, TOUCH_CODES, TouchPad, touchLayout } from './touch';

/** An engine with touch controls that records what the pad sets on them, in 52in1 (`hub`) or not. */
function fakeEngine(hub: boolean) {
  const set = new Map<string, TouchButtonState>();
  const viewport = { width: 390, height: 844, dpr: 3 };
  const engine = {
    hubSettings: { present: hub },
    input: { device: 'touch' },
    renderer: { viewport, touchDensity: 2, framing: { offsetX: 0, offsetY: 0, cssWidth: 390, cssHeight: 844, artWidth: 195, artHeight: 422 } },
    touch: {
      visible: true,
      show() {},
      set: (code: string, s: TouchButtonState) => set.set(code, { ...set.get(code), ...s }),
    },
  };
  return { engine: engine as unknown as Engine, set };
}

describe('≡ in 52in1', () => {
  it('sits below the hub’s wake band there (its centre 112 CSS px down), in the corner on its own page; the data lays it where the page does', () => {
    const menu = (buttons = RIFTLIGHT_TOUCH_BUTTONS) => touchLayout(390, 844, buttons).at(-1)!;
    expect(RIFTLIGHT_HUB_TOUCH_BUTTONS.at(-1)!.code).toBe(TOUCH_CODES.menu);
    expect(menu(RIFTLIGHT_HUB_TOUCH_BUTTONS).y, 'its top on the wake band').toBeGreaterThanOrEqual(HUB_WAKE);
    expect(menu(RIFTLIGHT_HUB_TOUCH_BUTTONS).y + menu(RIFTLIGHT_HUB_TOUCH_BUTTONS).h / 2).toBeGreaterThanOrEqual(112);
    expect(menu().y + menu().h, 'on its own page: in the corner').toBeLessThan(HUB_WAKE);
    // the rest of the cluster is the same either way
    expect(RIFTLIGHT_HUB_TOUCH_BUTTONS.slice(0, -1)).toEqual(RIFTLIGHT_TOUCH_BUTTONS.slice(0, -1));
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
