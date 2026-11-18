// The engine's menu helpers: MenuInput (keys, the pad, the stick, swipes → menu events, with key
// repeat) and FocusList (a list's focus, moved by those events and by the pointer). Both read only
// ctx.input, so what they do replays; their timers and focus are data (save-states).
import { describe, expect, it } from 'vitest';
import { type GamepadLike, Input, SWIPE_KEYS } from '../input';
import { FocusList, MENU_KEYS, MENU_REPEAT, type MenuEvent, MenuInput, ndcToHud } from './menu';

const target = () => new EventTarget() as unknown as Window;
const pad = (axes: number[] = [0, 0, 0, 0], pressed: number[] = []): GamepadLike => ({ connected: true, mapping: 'standard', axes, buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i) })) });

/** One frame of `dt` seconds: what happened before it (`act`), the pads, then the menu's events. */
function frames(menu: MenuInput, input: Input) {
  let now = 0;
  return (act: (i: Input) => void = () => {}, pads: GamepadLike[] = [], dt = 1 / 60): MenuEvent[] => {
    act(input);
    input.beginFrame((now += dt), dt, pads);
    const out = menu.events(input, dt);
    input.endFrame();
    return out;
  };
}

describe('MenuInput', () => {
  it('Cross confirms, Circle goes back, L1 / R1 change tabs, and so do Enter, Esc, Q and E', () => {
    const input = new Input(target());
    const step = frames(new MenuInput(), input);
    expect(step(() => {}, [pad([0, 0, 0, 0], [0])])).toEqual([{ kind: 'confirm' }]);
    expect(step(() => {}, [pad([0, 0, 0, 0], [1])])).toEqual([{ kind: 'back' }]);
    expect(step(() => {}, [pad([0, 0, 0, 0], [5])])).toEqual([{ kind: 'tab', dir: 1 }]);
    expect(step(() => {}, [pad([0, 0, 0, 0], [4])])).toEqual([{ kind: 'tab', dir: -1 }]);
    expect(step(() => {}, [pad([0, 0, 0, 0], [9])])).toEqual([]); // Options is the game's (a pause), not a menu event
    expect(step((i) => (i.setKey('Enter', true), i.setKey('Enter', false)))).toEqual([{ kind: 'confirm' }]);
    expect(step((i) => (i.setKey('Escape', true), i.setKey('Escape', false)))).toEqual([{ kind: 'back' }]);
    expect(step((i) => (i.setKey('KeyE', true), i.setKey('KeyE', false)))).toEqual([{ kind: 'tab', dir: 1 }]);
    expect(MENU_KEYS.confirm).toContain('PadA');
    expect(MENU_KEYS.back).toContain('PadB');
  });

  it('a held direction repeats after a pause, from the d-pad, the keys or the left stick', () => {
    const input = new Input(target());
    const step = frames(new MenuInput(), input);
    const down = pad([0, 0, 0, 0], [13]); // the d-pad presses the arrow keys
    expect(step(() => {}, [down])).toEqual([{ kind: 'nav', dir: 'down' }]);
    let early = 0;
    for (let f = 0; f < Math.floor(MENU_REPEAT.delay * 60); f++) early += step(() => {}, [down]).length;
    expect(early).toBe(0); // a pause before the first repeat
    let repeats = 0;
    for (let f = 0; f < 60; f++) repeats += step(() => {}, [down]).length;
    expect(repeats).toBeGreaterThanOrEqual(10); // then several a second
    expect(step()).toEqual([]); // let go
    // the left stick leaning far enough is a held direction (repeats only, after the pause)
    let stick = 0;
    for (let f = 0; f < 40; f++) stick += step(() => {}, [pad([-0.95, 0, 0, 0])]).filter((e) => e.kind === 'nav' && e.dir === 'left').length;
    expect(stick).toBeGreaterThan(0);
    expect(step((i) => (i.setKey('KeyW', true), i.setKey('KeyW', false)))).toEqual([{ kind: 'nav', dir: 'up' }]);
  });

  it('passes on its own shortcuts as keys, the wheel, and swipes', () => {
    const input = new Input(target());
    const step = frames(new MenuInput({ keys: ['KeyX', 'PadX'] }), input);
    expect(step(() => {}, [pad([0, 0, 0, 0], [2])])).toEqual([{ kind: 'key', code: 'PadX' }]);
    expect(step((i) => i.addPointer(0, 0, 1))).toEqual([{ kind: 'wheel', dy: 1 }]);
    // a swipe is a press the canvas makes (Input.attachPointer); recorded like any press
    expect(step((i) => (i.setKey(SWIPE_KEYS.right, true), i.setKey(SWIPE_KEYS.right, false)))).toEqual([{ kind: 'swipe', dir: 'right' }]);
  });

  it('a game changes the bindings it needs; the repeat timers are data', () => {
    const menu = new MenuInput({ confirm: ['KeyF'], tabNext: [], tabPrev: [] });
    const input = new Input(target());
    const step = frames(menu, input);
    expect(step((i) => (i.setKey('KeyF', true), i.setKey('KeyF', false)))).toEqual([{ kind: 'confirm' }]);
    expect(step((i) => (i.setKey('Enter', true), i.setKey('Enter', false)))).toEqual([]);
    expect(step((i) => (i.setKey('KeyE', true), i.setKey('KeyE', false)))).toEqual([]);
    step((i) => i.setKey('ArrowDown', true));
    const saved = JSON.parse(JSON.stringify(menu.save())) as ReturnType<MenuInput['save']>;
    const again = new MenuInput();
    again.load(saved);
    expect(again.save()).toEqual(menu.save());
  });
});

describe('FocusList', () => {
  const hud = { width: 480, height: 270 };
  const rects = [0, 1, 2].map((i) => ({ x: 100, y: 50 + i * 20, w: 80, h: 16 }));
  /** NDC of a HUD pixel (the pointer is recorded in NDC). */
  const ndc = (x: number, y: number) => [((x + 0.5) / hud.width) * 2 - 1, 1 - ((y + 0.5) / hud.height) * 2] as const;

  it('moves with the d-pad, wraps, confirms with Cross and goes back with Circle', () => {
    const input = new Input(target());
    const list = new FocusList(3);
    expect(list.update([{ kind: 'nav', dir: 'up' }], input, hud)).toEqual({ moved: true, confirm: -1, back: false, adjust: 0 });
    expect(list.index).toBe(2); // wrapped
    expect(list.update([{ kind: 'nav', dir: 'down' }, { kind: 'confirm' }], input, hud).confirm).toBe(0);
    expect(list.update([{ kind: 'nav', dir: 'right' }], input, hud).adjust).toBe(1); // one column: left / right change a value
    expect(list.update([{ kind: 'back' }], input, hud).back).toBe(true);
    const grid = new FocusList(6, { columns: 3, wrap: false });
    grid.update([{ kind: 'nav', dir: 'down' }, { kind: 'nav', dir: 'right' }, { kind: 'nav', dir: 'down' }], input, hud);
    expect(grid.index).toBe(4);
  });

  it('hover moves the focus when the pointer moves; a click or a tap on an item confirms it', () => {
    const input = new Input(target());
    const list = new FocusList(3);
    input.setPointer(...ndc(10, 10)); // resting off the items
    list.update([], input, hud, rects);
    const [x, y] = ndc(120, 75); // over item 1
    input.setPointer(x, y);
    expect(list.update([], input, hud, rects)).toMatchObject({ moved: true, confirm: -1 });
    expect(list.index).toBe(1);
    list.update([{ kind: 'nav', dir: 'down' }], input, hud, rects); // the pad moves on; the resting mouse doesn't pull it back
    expect(list.index).toBe(2);
    input.endFrame();
    input.setPointer(x, y, true);
    input.setPointer(x, y, false); // a click shorter than a frame
    expect(list.update([], input, hud, rects).confirm).toBe(1);
    input.endFrame();
    // pressed on one item and let go on another: no click
    input.setPointer(...ndc(120, 55), true);
    input.setPointer(...ndc(120, 95), false);
    expect(list.update([], input, hud, rects).confirm).toBe(-1);
  });

  it('a menu opened under a resting pointer keeps its focus until the pointer moves', () => {
    const input = new Input(target());
    input.setPointer(...ndc(120, 95)); // over item 2, where the mouse rests when the menu opens
    const list = new FocusList(3);
    expect(list.update([], input, hud, rects)).toMatchObject({ moved: false, confirm: -1 });
    expect(list.index).toBe(0);
    expect(list.update([], input, hud, rects).moved).toBe(false); // still resting
    input.setPointer(...ndc(121, 95)); // nudged: now it hovers
    expect(list.update([], input, hud, rects).moved).toBe(true);
    expect(list.index).toBe(2);
  });

  it('a list that shrank never focuses nor confirms past its end', () => {
    const input = new Input(target());
    const list = new FocusList(5, { index: 4 });
    list.count = 2;
    expect(list.update([{ kind: 'confirm' }], input, hud)).toMatchObject({ confirm: 1, moved: false });
    expect(list.index).toBe(1);
    list.count = 0;
    expect(list.update([{ kind: 'confirm' }], input, hud).confirm).toBe(-1);
    expect(list.index).toBe(0);
  });

  it('a swipe across an item is never a tap on it (a dismissing flick on Restart only closes the menu)', () => {
    const input = new Input(target());
    const list = new FocusList(3);
    // a finger down at item 2's left edge, a quick flick to its right edge: the swipe and the release land in one frame
    input.setPointer(...ndc(102, 95), true);
    input.setPointer(...ndc(178, 95), false);
    input.setKey(SWIPE_KEYS.right, true);
    expect(list.update([{ kind: 'swipe', dir: 'right' }], input, hud, rects)).toMatchObject({ confirm: -1, back: true });
    input.endFrame();
    input.setKey(SWIPE_KEYS.right, false);
    // a vertical flick along an item, with no menu events passed: no tap either
    input.setPointer(...ndc(120, 91), true);
    input.setPointer(...ndc(121, 99), false);
    input.setKey(SWIPE_KEYS.down, true);
    expect(list.update([], input, hud, rects).confirm).toBe(-1);
    input.endFrame();
    input.setKey(SWIPE_KEYS.down, false);
    // a tap still is one
    input.setPointer(...ndc(120, 95), true);
    input.setPointer(...ndc(120, 95), false);
    expect(list.update([], input, hud, rects).confirm).toBe(2);
  });

  it('a sideways swipe dismisses; vertical ones are left to scroll; its state is data', () => {
    const input = new Input(target());
    const list = new FocusList(3);
    expect(list.update([{ kind: 'swipe', dir: 'right' }], input, hud).back).toBe(true);
    expect(list.update([{ kind: 'swipe', dir: 'down' }], input, hud).back).toBe(false);
    expect(new FocusList(3, { dismiss: ['down'] }).update([{ kind: 'swipe', dir: 'down' }], input, hud).back).toBe(true);
    list.index = 2;
    const copy = new FocusList(3);
    copy.load(JSON.parse(JSON.stringify(list.save())));
    expect(copy.save()).toEqual(list.save());
  });

  it('turns NDC into HUD pixels as the HUD is laid over the canvas', () => {
    expect(ndcToHud(-1, 1, hud)).toEqual([0, 0]);
    expect(ndcToHud(1, -1, hud)).toEqual([479, 269]);
    expect(ndcToHud(...ndc(120, 75), hud)).toEqual([120, 75]);
  });
});
