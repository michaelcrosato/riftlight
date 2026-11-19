// A DualSense's touchpad in Riftlight, headless, through a fake 52in1 whose touchpad the test
// strokes (`input.touchpad`, the engine's gestures: docs/engine/hub.md *Motion and the touchpad*):
// on a character screen a swipe right or left pages the ring as R1 / L1 do, recorded; in play a
// swipe does nothing and the pad's press still opens the map; the legend and the strip draw the
// swipes beside L1 / R1 on the pad while 52in1 lets the game read the touchpad, and neither the
// swipes nor their glyphs once 52in1's touchpad is off (its press still reaches the game, as a
// browser reports it); in the stash, the vendor and the bench the swipes are their tabs, drawn so;
// a couch guest's DualSense swipes for that guest alone, never paging player 1's screens, and player
// 1's prompts then draw no swipe. One engine, tests in order.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubSettingsSource } from '../../engine';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import type { RealLoot } from '../wire/loot';
import type { TreePanel } from '../wire/tree';
import { pagePad, touchpadSwipes } from './controls';

const T = 60_000;
let h: HeadlessRiftlight;

/** A 52in1 whose DualSense's touchpad the test strokes (`touches`: x, y 0..1 from its top left), open to games. */
function strokedHub() {
  const now = { touches: [] as { id: number; x: number; y: number }[] };
  const dualsense = { connected: true, lightbar: false, triggers: false, motion: false, touchpad: true, speaker: false, aim: false };
  Object.defineProperty(dualsense, 'touches', { enumerable: true, get: () => now.touches });
  Object.defineProperty(dualsense, 'gyro', { enumerable: true, get: () => ({ x: 0, y: 0, z: 0 }) });
  const target = Object.assign(new EventTarget(), { dualsense });
  return { source: target as HubSettingsSource, target, now, dualsense };
}
const hub = strokedHub();
let finger = 0;

/** One finger across the touchpad from x `from` to `to`, quickly (a swipe), then off it. */
const swipe = (from: number, to: number) => {
  const id = ++finger;
  for (let k = 0; k <= 3; k++) {
    hub.now.touches = [{ id, x: from + ((to - from) * k) / 3, y: 0.5 }];
    h.engine.step(1);
  }
  hub.now.touches = [];
  h.engine.step(1);
};
/** A pad in the standard layout with `pressed` buttons down. */
const pad = (pressed: number[] = []) => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
/** Pad button `b` pressed for a frame and let go. */
const tap = (b: number) => {
  h.engine.input.setGamepads([pad([b])]);
  h.engine.step(1);
  h.engine.input.setGamepads([pad()]);
  h.engine.step(1);
};
const stack = () => h.rl.state().ui;
const mapOpen = () => (h.game as unknown as { mapOpen: boolean }).mapOpen;
/** The controls the UI draws as glyphs in the next frame (the legend under a panel, the ring's strip). */
const glyphs = () => {
  const spy = vi.spyOn(h.game.ui, 'glyph');
  try {
    h.engine.step(1);
    return spy.mock.calls.map((c) => c[2]);
  } finally {
    spy.mockRestore();
  }
};

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 515, options: { hubSettings: hub.source } });
  h.rl.newRun({ seed: 515 });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('a DualSense’s touchpad in Riftlight', () => {
  beforeEach(() => {
    h.game.layer.closeAll();
    h.engine.input.noteDevice('keyboard');
    h.engine.step(1);
  });

  it('reads the touchpad’s gestures: a swipe right or left pages the character screens as R1 / L1 do, recorded', () => {
    const { rl, engine } = h;
    expect(engine.input.touchpad, 'the game reads the gestures').toBe(true);
    engine.input.setGamepads([pad()]);
    engine.step(1);
    expect(rl.press('KeyI').ui).toEqual(['inventory']);
    swipe(0.2, 0.8);
    expect([stack(), engine.input.device], 'a swipe right: the next screen, as R1; a use of the pad').toEqual([['skills'], 'pad']);
    swipe(0.8, 0.2);
    expect(stack(), 'a swipe left: the one before, as L1').toEqual(['inventory']);
    swipe(0.8, 0.2);
    expect(stack(), 'round the ring').toEqual(['codex']);
    tap(5); // R1
    expect(stack(), 'R1 does the same').toEqual(['inventory']);
    const pressed = engine.recording()!.frames.flatMap((f) => f.pressed ?? []).filter((c) => c.startsWith('PadTouchpad'));
    expect(pressed, 'the swipes are input, recorded').toEqual(['PadTouchpadRight', 'PadTouchpadLeft', 'PadTouchpadLeft']);
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  }, T);

  it('on the pad, the legend and the ring’s strip draw the swipes beside L1 / R1, and the tree’s bar names them', () => {
    const { rl, engine } = h;
    rl.press('KeyC');
    engine.step(10); // it opens (the legend shows once it has)
    engine.input.noteDevice('pad');
    const drawn = glyphs();
    expect(drawn.filter((a) => a.startsWith('page_')), 'the legend (L1 R1, the swipes: Screens), then the strip ([swipe] L1 … R1 [swipe])').toEqual(['page_prev', 'page_next', 'page_swipe_prev', 'page_swipe_next', 'page_swipe_prev', 'page_prev', 'page_next', 'page_swipe_next']);
    expect(pagePad(true), 'the tree’s bar: L1 R1, then the swipes').toEqual(['PadLB', 'PadRB', 'PadTouchpadLeft', 'PadTouchpadRight']);
    engine.input.noteDevice('keyboard');
    expect(glyphs().filter((a) => a.startsWith('page_')), 'on the keyboard Q and E alone').toEqual(['page_prev', 'page_next', 'page_prev', 'page_next']);
    rl.press('Escape');
  }, T);

  it('in the stash a swipe switches its tab as L1 / R1 do, and its legend draws the swipes beside them while 52in1 lets the game read them', () => {
    const { rl, engine } = h;
    engine.input.setGamepads([pad()]);
    engine.step(1);
    expect(rl.talkTo('stash').state.ui).toEqual(['stash']);
    const items = (h.game.ports.loot as RealLoot).ui!;
    expect(items.stashTab).toBe(0);
    swipe(0.2, 0.8);
    expect([stack(), items.stashTab, engine.input.device], 'a swipe right: the next tab, as R1').toEqual([['stash'], 1, 'pad']);
    swipe(0.8, 0.2);
    expect([stack(), items.stashTab], 'a swipe left: the one before, as L1').toEqual([['stash'], 0]);
    engine.step(10); // the legend shows once the windows have opened
    expect(glyphs().filter((a) => a.startsWith('page_')), 'the legend: L1 R1, the swipes (Tabs)').toEqual(['page_prev', 'page_next', 'page_swipe_prev', 'page_swipe_next']);
    hub.dualsense.touchpad = false;
    hub.target.dispatchEvent(new Event('change'));
    expect(glyphs().filter((a) => a.startsWith('page_')), '52in1’s touchpad off: L1 and R1 alone').toEqual(['page_prev', 'page_next']);
    hub.dualsense.touchpad = true;
    hub.target.dispatchEvent(new Event('change'));
    rl.press('Escape');
    expect([stack(), engine.errors]).toEqual([[], []]);
  }, T);

  it('the open tree’s bar follows 52in1’s touchpad setting as it changes: the swipes go when it turns off, and come back', () => {
    const { rl, engine } = h;
    expect(rl.press('KeyP').ui).toEqual(['tree']);
    const tree = h.game.layer.find('tree') as TreePanel;
    /** The glyphs the bar draws for the screens on a pad (L1 R1, and the swipes while they page). */
    const screens = () => tree.hints('pad').find((x) => x.id === 'screens')?.glyphs.length;
    expect([screens(), tree.pages?.pad], 'L1 R1 and the swipes').toEqual([4, pagePad(true)]);
    hub.dualsense.touchpad = false;
    hub.target.dispatchEvent(new Event('change'));
    engine.step(1);
    expect([screens(), tree.pages?.pad], 'off: L1 R1 alone').toEqual([2, pagePad(false)]);
    hub.dualsense.touchpad = true;
    hub.target.dispatchEvent(new Event('change'));
    engine.step(1);
    expect(screens(), 'on again').toBe(4);
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  }, T);

  it('in play a swipe does nothing; the touchpad’s press opens the level’s map', async () => {
    const { rl, engine } = h;
    await rl.enterDepth(1);
    engine.step(3);
    swipe(0.2, 0.8);
    expect([stack(), mapOpen(), engine.errors], 'nothing opens').toEqual([[], false, []]);
    tap(17); // the touchpad's press
    expect(mapOpen(), 'the map').toBe(true);
    tap(17);
    expect(mapOpen()).toBe(false);
  }, T);

  it('with 52in1’s touchpad off: no swipe pages and none is drawn; the press still opens the level’s map', () => {
    const { rl, engine } = h;
    hub.dualsense.touchpad = false;
    hub.target.dispatchEvent(new Event('change'));
    engine.step(1);
    rl.press('KeyI');
    engine.step(10);
    swipe(0.2, 0.8);
    expect(stack(), 'no swipe reaches the game').toEqual(['inventory']);
    engine.input.noteDevice('pad');
    expect(glyphs().filter((a) => a.startsWith('page_')), 'L1 and R1 alone').toEqual(['page_prev', 'page_next', 'page_prev', 'page_next']);
    expect(pagePad(false)).toEqual(['PadLB', 'PadRB']);
    rl.press('Escape');
    engine.step(1);
    tap(17);
    expect(mapOpen(), 'the press is a button: the map').toBe(true);
    tap(17);
    hub.dualsense.touchpad = true;
    hub.target.dispatchEvent(new Event('change'));
    expect(engine.errors).toEqual([]);
  }, T);

  it('a couch guest’s DualSense swipes for that guest alone: player 1’s screen never pages, nor turns to the pad, nor draws a swipe', () => {
    const { rl, engine, game } = h;
    const xbox = { ...pad(), index: 0, id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)' };
    const sense = { ...pad(), index: 1, id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' };
    engine.input.setGamepads([xbox, sense]);
    engine.step(1);
    expect(game.coop.join(1), 'the DualSense sits down as player 2').not.toBeNull();
    engine.step(2);
    engine.input.noteDevice('keyboard');
    expect(rl.press('KeyI').ui).toEqual(['inventory']);
    const from = engine.recording()!.frames.length;
    swipe(0.2, 0.8);
    expect([stack(), engine.input.device], 'player 1’s inventory, on the keyboard').toEqual([['inventory'], 'keyboard']);
    const frames = engine.recording()!.frames.slice(from);
    expect(
      [frames.flatMap((f) => f.padPressed ?? []), frames.flatMap((f) => f.pressed ?? []).filter((c) => c.startsWith('PadTouchpad'))],
      'the guest’s swipe, recorded on its pad',
    ).toEqual([[[1, 'PadTouchpadRight']], []]);
    // player 1 on its Xbox pad: no swipe drawn in its legend, strip or tree bar (the swipes are the guest's)
    engine.input.setGamepads([{ ...xbox, ...pad([12]), index: 0 }, sense]); // the d-pad on player 1's pad: the pad is the device
    engine.step(1);
    engine.input.setGamepads([xbox, sense]);
    engine.step(10);
    expect([engine.input.device, engine.input.dualSenseGuest, touchpadSwipes(engine)], 'the DualSense is the guest’s').toEqual(['pad', true, false]);
    expect(glyphs().filter((a) => a.startsWith('page_')), 'L1 and R1 alone').toEqual(['page_prev', 'page_next', 'page_prev', 'page_next']);
    engine.input.noteDevice('keyboard');
    game.coop.leaveAll();
    swipe(0.2, 0.8);
    expect([stack(), engine.input.device], 'gone home: the DualSense is player 1’s again').toEqual([['skills'], 'pad']);
    expect([engine.input.dualSenseGuest, touchpadSwipes(engine)], 'its swipes are player 1’s: drawn again').toEqual([false, true]);
    rl.press('Escape');
    engine.input.setGamepads([pad()]);
    expect(engine.errors).toEqual([]);
  }, T);
});
