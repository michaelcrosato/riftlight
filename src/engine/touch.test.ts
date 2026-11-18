// Touch as an add-on, headless: the touch controls step aside when a pad or the keyboard is picked up
// and come back on the next touch, following the recorded device (so a replay agrees); a phone's
// touch density gives fewer, bigger art pixels without changing the world in view; and a legend
// names the buttons on the device in use.
import { OrthographicCamera, Vector3 } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { Controls } from './controls';
import { DEFAULT_TOUCH_DENSITY, Engine, type Game, type GameContext } from './Engine';
import { Hud } from './hud/Hud';
import { Input, type InputDevice } from './input';
import type { Recording } from './replay';
import type { PlayerSettings } from './settings';
import { type TouchControls, TouchFollow, zonePath } from './TouchControls';

describe('touch controls follow the device in use (TouchFollow)', () => {
  it('step aside when a pad or the keyboard is picked up, and come back on the next touch; a device that only stays moves nothing', () => {
    const f = new TouchFollow('keyboard'); // a page that starts on the keyboard with ?touch=1
    expect([f.follow('keyboard'), f.away]).toEqual([false, false]);
    expect([f.follow('touch'), f.away]).toEqual([false, false]);
    expect([f.follow('pad'), f.away]).toEqual([true, true]);
    expect([f.follow('keyboard'), f.away]).toEqual([false, true]);
    expect([f.follow('touch'), f.away]).toEqual([true, false]);
  });

  it('the engine has them follow the device every frame, live and in a replay (recorded), so a replay shows and hides them as the player saw', async () => {
    class Watch implements Game {
      readonly name = 'Watch';
      devices: InputDevice[] = [];
      setup(): void {}
      update(ctx: GameContext): void {
        this.devices.push(ctx.input.device);
      }
      cameraTarget() {
        return new Vector3();
      }
    }
    let game = new Watch();
    const engine = await Engine.headless(game, { touch: true });
    // headless has no controls on a page: a stand-in hears what the engine tells them
    const follow = vi.fn<(device: InputDevice) => void>();
    engine.touch = { follow, root: { remove() {} } } as unknown as TouchControls;
    engine.input.noteDevice('touch');
    await engine.loadGame(game);
    follow.mockClear();
    const plan: InputDevice[] = ['touch', 'touch', 'pad', 'pad', 'touch', 'keyboard', 'keyboard', 'touch'];
    for (const d of plan) {
      engine.input.noteDevice(d);
      engine.step(1);
    }
    expect(follow.mock.calls.map(([d]) => d), 'live: every frame, the device in use').toEqual(plan);
    const shown = (devices: readonly InputDevice[]) => {
      const f = new TouchFollow(devices[0]!);
      return devices.map((d) => (f.follow(d), !f.away));
    };
    const live = game.devices.slice();
    expect(live).toEqual(plan);
    expect(shown(live)).toEqual([true, true, false, false, true, false, false, true]);
    const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
    engine.input.noteDevice('keyboard'); // live, before the replay: never what the replay shows
    follow.mockClear();
    await engine.replay(rec, () => engine.loadGame((game = new Watch())));
    expect(follow.mock.calls.map(([d]) => d), 'the replay: the recorded device, frame by frame').toEqual(plan);
    expect(game.devices).toEqual(live);
    engine.dispose();
  });
});

describe("a floating stick's zone gives way to a panel open over it (TouchControls.giveWay)", () => {
  /** The squares a clip path of `zonePath` is made of, and whether a point is inside one: where the zone still takes touches. */
  const squares = (d: string) => [...d.matchAll(/M([\d.]+) ([\d.]+)H([\d.]+)V([\d.]+)H[\d.]+Z/g)].map((m) => m.slice(1).map(Number));
  const takes = (d: string, x: number, y: number) => squares(d).some(([x0, y0, x1, y1]) => x > x0! && x < x1! && y > y0! && y < y1!);

  it('cuts the panels out of the zone (their touches reach the game) and keeps the rest of it the stick\'s', () => {
    expect(zonePath(100, 200, [])).toBe('M0 0H100V200H0Z');
    // a panel across the zone's top right (photo mode's, held sideways), and a small one low on the left
    const d = zonePath(100, 200, [
      { x0: 40, y0: 0, x1: 100, y1: 120 },
      { x0: 10, y0: 150, x1: 30, y1: 170 },
    ]);
    for (const [x, y] of [[50, 60], [99, 1], [41, 119], [20, 160]] as const) expect(takes(d, x, y), `${x},${y} given way`).toBe(false);
    for (const [x, y] of [[20, 60], [39, 1], [50, 130], [5, 160], [20, 190], [99, 199]] as const) expect(takes(d, x, y), `${x},${y} still the stick's`).toBe(true);
    // a zone wholly given way: nothing of it takes a touch
    expect(squares(zonePath(100, 200, [{ x0: 0, y0: 0, x1: 100, y1: 200 }]))).toEqual([]);
  });
});

describe('touch density on a phone (EngineOptions.touchDensity)', () => {
  class Still implements Game {
    readonly name = 'Still';
    setup(): void {}
    cameraTarget() {
      return new Vector3();
    }
  }
  const frame = async (o: { touch?: boolean; touchDensity?: number }, viewport = { width: 844, height: 390, dpr: 2 }) => {
    const e = await Engine.headless(new Still(), { viewport, ...o });
    const cam = e.camera.camera as OrthographicCamera;
    const out = { art: { ...e.renderer.resolution }, css: e.renderer.framing.scale / viewport.dpr, viewHeight: cam.top - cam.bottom, aspect: (cam.right - cam.left) / (cam.top - cam.bottom) };
    e.dispose();
    return out;
  };

  it('a game that opts in (touchDensity: 2) draws a landscape phone with touch controls at 2 CSS pixels an art pixel or more; the world in view is the same', async () => {
    const plain = await frame({});
    expect(plain.art).toEqual({ width: 563, height: 260 });
    expect((await frame({ touch: true })).art).toEqual(plain.art); // off unless the game asks (DEFAULT_TOUCH_DENSITY 0)
    expect(DEFAULT_TOUCH_DENSITY).toBe(0);
    const touch = await frame({ touch: true, touchDensity: 2 });
    expect([touch.art, touch.css >= 2]).toEqual([{ width: 422, height: 195 }, true]);
    expect(touch.viewHeight).toBeCloseTo(plain.viewHeight, 6);
    expect(touch.aspect).toBeCloseTo(plain.aspect, 2);
    expect((await frame({ touchDensity: 2 })).art).toEqual(plain.art); // no touch controls: none
    expect((await frame({ touch: true, touchDensity: 3 })).css).toBeGreaterThanOrEqual(3);
    // a portrait phone already is; a laptop is not a phone
    expect((await frame({ touch: true, touchDensity: 2 }, { width: 390, height: 844, dpr: 3 })).art).toEqual((await frame({}, { width: 390, height: 844, dpr: 3 })).art);
    expect((await frame({ touch: true, touchDensity: 2 }, { width: 1280, height: 720, dpr: 1 })).art).toEqual({ width: 427, height: 240 });
  });

  it('a recording keeps it, and a headless replay frames with it (pointer aim and the HUD match the phone)', async () => {
    const viewport = { width: 844, height: 390, dpr: 3 };
    const phone = await Engine.headless(new Still(), { viewport, touch: true, touchDensity: 2 });
    phone.step(2);
    const rec = JSON.parse(JSON.stringify(phone.recording())) as Recording;
    phone.dispose();
    expect([rec.density, rec.view]).toEqual([2, viewport]);
    const tool = await Engine.headless(new Still()); // npm run replay: no touch option
    await tool.replay(rec, () => tool.loadGame(new Still()));
    expect(tool.renderer.resolution).toEqual({ width: 422, height: 195 });
    const plain = { ...rec, density: undefined }; // a recording without touch controls
    await tool.replay(plain, () => tool.loadGame(new Still()));
    expect(tool.renderer.resolution).toEqual({ width: 633, height: 293 });
    tool.dispose();
  });

  it('a recording keeps whether the page had touch controls, and a headless replay has them too (prompts name them, a HUD lays out around them), at any touch density', async () => {
    class Prompt implements Game {
      readonly name = 'Prompt';
      readonly controls = { jump: { key: 'Space', pad: 'PadA', touch: 'B' } };
      seen: string[] = [];
      setup(): void {}
      update(ctx: GameContext): void {
        this.seen.push(ctx.engine.controls.label('jump'));
      }
      cameraTarget() {
        return new Vector3();
      }
    }
    const viewport = { width: 390, height: 844, dpr: 3 };
    // a game that keeps the art size the viewport gives on a phone (no touchDensity, as Engine World)
    const phone = await Engine.headless(new Prompt(), { viewport, touch: true });
    phone.input.noteTouch();
    phone.step(2);
    const rec = JSON.parse(JSON.stringify(phone.recording())) as Recording;
    const live = (phone.game as Prompt).seen;
    phone.dispose();
    expect([rec.touch, rec.density, live.at(-1)]).toEqual([true, undefined, 'B']);
    const tool = await Engine.headless(new Prompt()); // npm run replay: no touch option
    expect(tool.controls.touch).toBe(false);
    let game = new Prompt();
    await tool.replay(rec, () => tool.loadGame(game));
    expect([tool.controls.touch, game.seen]).toEqual([true, live]);
    // a recording made without them (a desktop, a touch-screen laptop's tap): a finger names the keys
    const desk = { ...rec, touch: undefined };
    await tool.replay(desk, () => tool.loadGame((game = new Prompt())));
    expect([tool.controls.touch, game.seen.at(-1)]).toEqual([false, 'Space']);
    tool.dispose();
  });
});

describe('hud.legend', () => {
  const TABLE = {
    confirm: { key: 'Enter', pad: 'PadA', touch: 'TouchTap' },
    back: { key: 'Escape', pad: 'PadB', touch: 'TouchSwipe' },
    reset: { key: 'KeyR', pad: 'PadY' },
  };
  /** What the HUD holds (test access to its retained items). */
  const items = (hud: Hud) => (hud as unknown as { items: { kind: string; text?: string; x: number; colors?: Record<string, string> }[] }).items;
  const make = () => {
    const input = new Input(null);
    const values: PlayerSettings = {};
    const hud = new Hud(null);
    hud.controls = new Controls(input, { values });
    hud.controls.table = TABLE;
    return { input, values, hud, controls: hud.controls };
  };
  const legend: readonly (readonly [string, string])[] = [
    ['confirm', 'SELECT'],
    ['back', 'BACK'],
    ['reset', 'RESET'],
  ];

  it("lays out each button's glyph and words for the device in use, one way for every game", () => {
    const { input, values, hud, controls } = make();
    const w = hud.legend(200, 100, legend, { align: 'center' });
    expect(w).toBe(hud.legendWidth(legend));
    expect(items(hud).filter((i) => i.kind === 'text').map((i) => i.text)).toEqual(['Enter', 'SELECT', 'Esc', 'BACK', 'R', 'RESET']); // key caps, then words
    expect(items(hud)[0]!.x).toBe(200 - Math.floor(w / 2));
    hud.clear();
    input.noteDevice('pad');
    hud.legend(0, 0, legend);
    expect(items(hud).filter((i) => i.kind === 'sprite').map((i) => i.colors!.s)).toEqual(['blue', 'red', 'teal']); // ✕ ○ △
    hud.clear();
    values.padGlyphs = 'xbox';
    hud.legend(0, 0, legend);
    expect(items(hud).filter((i) => i.kind === 'sprite').map((i) => i.colors!.f)).toEqual(['green', 'red', 'sand']); // A B Y
    hud.clear();
    input.noteDevice('touch');
    controls.touch = true; // the engine shows touch controls
    hud.legend(0, 0, legend);
    // touch words; Reset has no gesture: its words alone (a button the game puts a tap on)
    expect(items(hud).filter((i) => i.kind === 'text').map((i) => i.text)).toEqual(['Tap', 'SELECT', 'Swipe', 'BACK', 'RESET']);
    expect(hud.legend(0, 0, [])).toBe(0);
  });
});
