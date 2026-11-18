// The Move Playground's controls on every device, headless: its `controls` table is the engine's
// key map (KEYMAP) and touch buttons, the engine's default touch buttons are named by their moves
// (never a pad letter that does another move there), and the legend along the bottom names every
// move on the keyboard and a pad (the pad's own buttons), inside the HUD at a TV's and a narrow
// window's size, and gives way to a phone's buttons, which say their moves themselves.
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TOUCH_BUTTONS, Engine, hudPlace, KEYMAP, type HeadlessOptions } from '../engine';
import { nodeAssets } from '../engine/node';
import { Playground, PLAYGROUND_CONTROLS } from './playground';

const T = 60_000;
let engine: Engine | null = null;
afterEach(() => {
  engine?.dispose();
  engine = null;
});

/** The pad's face buttons by the letter on an Xbox pad, and the move each does (KEYMAP). */
const FACE = Object.fromEntries((['A', 'B', 'X', 'Y'] as const).map((l) => [l, Object.entries(KEYMAP).find(([, codes]) => (codes as readonly string[]).includes(`Pad${l}`))?.[0]]));

describe('the Move Playground\'s controls', () => {
  it('its table is the engine\'s key map and touch buttons, and those buttons are named by their moves', () => {
    for (const [action, c] of Object.entries(PLAYGROUND_CONTROLS)) {
      const codes: readonly string[] = (KEYMAP as Record<string, readonly string[]>)[action] ?? [];
      if (!codes.length) continue; // move, settings: the engine's own
      expect(codes, action).toEqual(expect.arrayContaining([c.key, c.pad]));
      const button = DEFAULT_TOUCH_BUTTONS.find((b) => codes.includes(b.code));
      expect('touch' in c ? c.touch : undefined, `${action}'s touch button`).toBe(button?.label);
    }
    // every default button presses a move of the key map, and none carries a pad letter that does another move on the pad
    for (const b of DEFAULT_TOUCH_BUTTONS) {
      const move = Object.entries(KEYMAP).find(([, codes]) => (codes as readonly string[]).includes(b.code))?.[0];
      expect(move, b.code).toBeDefined();
      if (b.label in FACE) expect(FACE[b.label], `the touch button ${b.label} (${move}) is the pad's ${b.label}, which does ${FACE[b.label]}`).toBe(move);
    }
  });

  /** The playground on `viewport` (`touch`: a phone's controls), the device in use `device`. */
  async function boot(device: 'keyboard' | 'pad' | 'touch', viewport: HeadlessOptions['viewport'], touch = false) {
    engine = await Engine.headless(new Playground(), { seed: 1, assets: nodeAssets(), viewport, touch, settings: { padButton: true } });
    if (device === 'touch') engine.input.noteTouch();
    else engine.input.noteDevice(device);
    engine.step(2);
    return engine;
  }

  /** The texts the next frame draws on the HUD, where they land. */
  function texts(e: Engine) {
    const hud = e.hud;
    const own = hud.text;
    const clear = hud.clear;
    let seen: { text: string; x: number; y: number; w: number; h: number }[] = [];
    hud.clear = () => {
      seen = [];
      clear.call(hud);
    };
    hud.text = (x, y, text, o = {}) => {
      const m = hud.measure(text, Math.max(1, Math.round(o.scale ?? 1)));
      const [px, py] = hudPlace(x, y, m.width, m.height, o.anchor ?? 'top-left', { width: hud.width, height: hud.height });
      seen.push({ text, x: px, y: py, w: m.width, h: m.height });
      own.call(hud, x, y, text, o);
    };
    try {
      e.step(1);
    } finally {
      hud.text = own;
      hud.clear = clear;
    }
    return seen;
  }

  const MOVES = ['RUN', 'JUMP', 'HIT', 'GRAB', 'DUCK', 'TIPTOE', 'PRONE', 'LIE', 'WAVE', 'SIT', 'SETTINGS'];

  it(
    'a legend names every move on a pad at ten feet (the pad\'s buttons) and on the keyboard, inside the HUD; a narrow window keeps what fits',
    async () => {
      for (const [device, glyph] of [['pad', 'Cross'], ['keyboard', 'Space']] as const) {
        const e = await boot(device, { width: 1920, height: 1080, dpr: 1 });
        const drawn = texts(e);
        const words = drawn.map((t) => t.text);
        expect(words, `${device}: every move`).toEqual(expect.arrayContaining(MOVES));
        expect(e.controls.label('jump'), device).toBe(glyph);
        expect(e.controls.label('crouch'), device).toBe(device === 'pad' ? 'Circle' : 'C');
        const out = drawn.filter((t) => t.x < 0 || t.y < 0 || t.x + t.w > e.hud.width || t.y + t.h > e.hud.height);
        expect(out, `${device}: inside the HUD`).toEqual([]);
        e.dispose();
        engine = null;
      }
      const e = await boot('keyboard', { width: 390, height: 844, dpr: 2 });
      const drawn = texts(e);
      expect(drawn.filter((t) => t.x < 0 || t.x + t.w > e.hud.width).map((t) => t.text), 'nothing off a narrow window').toEqual([]);
      expect(drawn.map((t) => t.text)).toEqual(expect.arrayContaining(['RUN', 'JUMP']));
    },
    T,
  );

  it(
    'on a phone the buttons say the moves (prompts name them), and the legend gives way to them',
    async () => {
      const e = await boot('touch', { width: 844, height: 390, dpr: 2 }, true);
      expect(['jump', 'attack', 'crouch', 'grab', 'prone', 'lie'].map((a) => e.controls.label(a))).toEqual(['JUMP', 'HIT', 'DUCK', 'GRAB', 'PRONE', 'LIE']);
      const words = texts(e).map((t) => t.text);
      expect(words.filter((w) => MOVES.includes(w)), 'no legend over the buttons').toEqual([]);
      expect(words.some((w) => /\/12$/.test(w)), 'the coin count').toBe(true);
    },
    T,
  );
});
