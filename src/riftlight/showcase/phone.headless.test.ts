// The Hall of Beasts and photo mode on a phone held either way (390×844 and 844×390, touch),
// headless, where the HUD lays itself out around the controls from their data as a replay of a
// phone's recording does (`TouchPad.zones`): the Hall's hints and its inspect prompt along the
// bottom clear of the stick and the buttons and of the exhibits' plaques; the inspect card short
// enough that the exhibit shows above it (or beside it), inside the screen; photo mode's panel
// inside the screen with its title clear of the ≡ and its rows, the hints and the controls apart.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { type HeadlessView, hudPlace } from '../../engine';
import { RIFTLIGHT_TOUCH_BUTTONS, touchLayout } from '../game/touch';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { miniCovers, miniWidth, UiCanvas } from '../ui/kit';
import { t } from '../lang';
import type { Box } from '../ui/layout';

const T = 90_000;
let h: HeadlessRiftlight;

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 777, viewport: { width: 390, height: 844, dpr: 2 }, options: { touch: true } });
  const { rl, engine } = h;
  rl.newRun({ slot: 0, seed: 777 });
  engine.step(10);
  await rl.enterDepth(1);
  engine.step(5);
  rl.killAll();
  engine.step(5);
  rl.toTown();
  engine.step(5);
}, T);
afterAll(() => h?.engine.dispose());

const PHONES = [
  { width: 390, height: 844, dpr: 2 },
  { width: 844, height: 390, dpr: 2 },
] as const;

interface Drawn extends Box {
  what: string;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every text the next frame draws on the HUD (its own font and the mini font), where it lands, its shadow included. */
function texts(): Drawn[] {
  const hud = h.engine.hud;
  const seen: Drawn[] = [];
  const text = hud.text;
  const mini = UiCanvas.prototype.mini;
  const clear = hud.clear;
  hud.clear = () => {
    seen.length = 0;
    clear.call(hud);
  };
  hud.text = (x, y, s, o = {}) => {
    const k = Math.max(1, Math.round(o.scale ?? 1));
    const m = hud.measure(s, k);
    const [px, py] = hudPlace(x, y, m.width, m.height, o.anchor ?? 'top-left', { width: hud.width, height: hud.height });
    const sh = o.shadow === false ? 0 : k;
    if (s.trim()) seen.push({ what: s, x: px, y: py, w: m.width + sh, h: m.height + sh });
    text.call(hud, x, y, s, o);
  };
  UiCanvas.prototype.mini = function (x, y, s, color, align = 'left', shadow = false) {
    const w = miniWidth(s);
    const drawn = mini.call(this, x, y, s, color, align, shadow);
    if (w && s.trim() && miniCovers(s)) {
      const left = Math.round(align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x);
      seen.push({ what: s, x: left, y: Math.round(y), w: w + (shadow === false ? 0 : 1), h: 5 + (shadow === false ? 0 : 1) });
    }
    return drawn;
  };
  try {
    h.engine.step(1);
  } finally {
    hud.text = text;
    hud.clear = clear;
    UiCanvas.prototype.mini = mini;
  }
  return seen;
}

/** The phone's controls a showcase screen shows, in art pixels, where their data puts them on this viewport: the stick, A, B, ≡ and the interact button while there is something to look at. */
function controls(): Drawn[] {
  const { engine, game } = h;
  const { width, height } = engine.renderer.viewport;
  const f = engine.renderer.framing;
  const ax = (x: number) => Math.floor(((x - f.offsetX) / f.cssWidth) * f.artWidth);
  const ay = (y: number) => Math.floor(((y - f.offsetY) / f.cssHeight) * f.artHeight);
  const shown = new Set(['KeyJ', 'Space', 'Escape', ...(game.showcase.touch().interact ? ['KeyF'] : [])]);
  const what = ['the joystick', ...RIFTLIGHT_TOUCH_BUTTONS.map((b) => b.label)];
  return touchLayout(width, height)
    .map((c, i) => ({ what: what[i]!, x: ax(c.x), y: ay(c.y), w: ax(c.x + c.w) - ax(c.x) + 1, h: ay(c.y + c.h) - ay(c.y) + 1 }))
    .filter((_, i) => i === 0 || shown.has(RIFTLIGHT_TOUCH_BUTTONS[i - 1]!.code));
}

/** What is amiss with `drawn` on this screen: a text off it or under a control. */
function amiss(where: string, drawn: readonly Drawn[], pads: readonly Drawn[]): string[] {
  const { width, height } = h.engine.hud;
  const at = `${where} at ${width}x${height}`;
  return [
    ...drawn.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > width || b.y + b.h > height).map((b) => `${at}: ${b.what} off the screen (${b.x},${b.y} ${b.w}x${b.h})`),
    ...drawn.flatMap((b) => pads.filter((c) => overlaps(b, c)).map((c) => `${at}: ${b.what} (${b.x},${b.y} ${b.w}x${b.h}) under ${c.what} (${c.x},${c.y} ${c.w}x${c.h})`)),
  ];
}

describe('the Hall of Beasts and photo mode on a phone held either way', () => {
  it(
    'the Hall\'s hints and its prompt sit along the bottom clear of the stick, the buttons and the exhibits\' plaques',
    async () => {
      const { rl, game, engine } = h;
      const out: string[] = [];
      for (const viewport of PHONES) {
        (engine.renderer as HeadlessView).setViewport(viewport);
        await rl.bestiary.open();
        try {
          engine.input.noteTouch();
          const m = game.showcase.bestiary;
          m.goTo(m.hall!.pedestals[2]!);
          engine.step(5);
          expect(game.showcase.touch().interact, 'an exhibit to look at').not.toBeNull();
          const drawn = texts();
          const pads = controls();
          out.push(...amiss('the Hall', drawn, pads));
          // the hints (the mini font's rows, and a row it can't draw) against everything else drawn
          const hint = drawn.filter((b) => /move|look|photo|leave/i.test(b.what) && !/inspect|action/i.test(b.what));
          expect(hint.length, 'the hints are drawn').toBeGreaterThan(0);
          for (const a of hint) for (const b of drawn) if (!hint.includes(b) && overlaps(a, b)) out.push(`the Hall at ${engine.hud.width}x${engine.hud.height}: the hints' ${a.what} over ${b.what}`);
          // as low as the controls let them: at the bottom on a phone held sideways (room between the stick and the buttons)
          if (viewport.width > viewport.height) expect(Math.max(...hint.map((b) => b.y + b.h)), 'along the bottom').toBeGreaterThan(engine.hud.height - 20);
        } finally {
          rl.bestiary.close();
        }
      }
      expect(out).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'with a mouse and a keyboard (no phone controls) the Hall\'s inspect prompt sits where it always has: 37 rows up from the bottom, over the hints',
    async () => {
      const { rl, game, engine } = h;
      const lead = t('showcase.bestiary.prompt.inspect', { name: '' }).trim();
      for (const viewport of [
        { width: 1920, height: 1080, dpr: 1 },
        { width: 1280, height: 720, dpr: 1 },
      ]) {
        (engine.renderer as HeadlessView).setViewport(viewport);
        await rl.bestiary.open();
        try {
          engine.input.noteDevice('keyboard');
          const m = game.showcase.bestiary;
          m.goTo(m.hall!.pedestals[2]!);
          engine.step(5);
          const prompt = texts().filter((b) => b.what.startsWith(lead));
          expect(prompt.map((b) => b.y), `the prompt at ${engine.hud.width}x${engine.hud.height}`).toEqual([engine.hud.height - 37]);
        } finally {
          rl.bestiary.close();
          engine.input.noteTouch();
        }
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the card folded for a phone: its clip row names the clip a clip\'s id or an agent played, and a rotation that folds it keeps the cursor on its button',
    async () => {
      const { rl, game, engine } = h;
      const m = game.showcase.bestiary;
      const card = () => m as unknown as { compact: boolean; cursor: number; buttons: readonly { id: string; label: string }[] };
      const focused = () => card().buttons[card().cursor]?.id;
      const row = () => card().buttons.find((b) => b.id === 'clips')?.label;
      (engine.renderer as HeadlessView).setViewport({ width: 1920, height: 1080, dpr: 1 });
      await rl.bestiary.open();
      try {
        rl.bestiary.inspect(0);
        engine.step(2);
        expect(card().compact, 'a button per clip on a wide screen').toBe(false);
        const names = Object.fromEntries(card().buttons.map((b) => [b.id, b.label]));
        const clips = m.focus!.built.clipNames;
        expect(clips.length).toBeGreaterThan(2);
        // the cursor down to the turntable (past every clip), then the phone held upright: the clips fold into one row
        card().cursor = card().buttons.findIndex((b) => b.id === 'turntable');
        (engine.renderer as HeadlessView).setViewport(PHONES[0]);
        engine.step(2);
        expect(card().compact, 'the clips one row on a phone').toBe(true);
        expect(focused(), 'the cursor still on the turntable').toBe('turntable');
        // a clip by its id (an agent, a hook): the row names it, and the row's next step goes on from it
        const last = clips.at(-1)!;
        expect(m.activate(`clip:${last}`)).toBe(true);
        engine.step(1);
        expect(row()).toBe(names[`clip:${last}`]);
        m.activate('clips');
        engine.step(1);
        expect(row(), 'the next clip after it (round to the first)').toBe(names[`clip:${clips[0]}`]);
        // the agents' play: the row follows it too
        rl.bestiary.play(clips[1]!);
        expect(row()).toBe(names[`clip:${clips[1]}`]);
        // the cursor on the clips row, then a wide screen again: on the clip it names
        card().cursor = 0;
        (engine.renderer as HeadlessView).setViewport({ width: 1920, height: 1080, dpr: 1 });
        engine.step(2);
        expect(card().compact).toBe(false);
        expect(focused()).toBe(`clip:${clips[1]}`);
      } finally {
        rl.bestiary.close();
      }
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the inspect card fits the screen and leaves the exhibit in view: beside it held sideways, above it held upright',
    async () => {
      const { rl, game, engine } = h;
      const out: string[] = [];
      for (const viewport of PHONES) {
        (engine.renderer as HeadlessView).setViewport(viewport);
        await rl.bestiary.open();
        try {
          engine.input.noteTouch();
          for (const i of [0, 1]) {
            rl.bestiary.inspect(i); // the boss first, the tallest
            engine.step(10);
            const drawn = texts();
            out.push(...amiss(`the card of exhibit ${i}`, drawn, []));
            const m = game.showcase.bestiary;
            const card = (m as unknown as { cardRect: Box }).cardRect;
            const { width, height } = engine.hud;
            expect(card.y + card.h, 'the card inside the screen').toBeLessThanOrEqual(height);
            expect(card.x + card.w).toBeLessThanOrEqual(width);
            // the exhibit's foot, middle and head on screen, none under the card
            const ex = m.focus!;
            const tall = ex.built.height * ex.fit;
            const cam = engine.camera.camera;
            cam.updateMatrixWorld();
            for (const [part, dy] of [['foot', 0.1], ['middle', tall / 2], ['head', tall * 0.9]] as const) {
              const p = new Vector3(ex.at.x, ex.at.y + dy, ex.at.z).project(cam);
              const x = ((p.x + 1) / 2) * width;
              const y = ((1 - p.y) / 2) * height;
              const where = `exhibit ${i}'s ${part} at ${width}x${height} (${x.toFixed(0)},${y.toFixed(0)})`;
              if (p.z > 1 || x < 0 || x > width || y < 0 || y > height) out.push(`${where}: off the screen`);
              else if (overlaps({ x, y, w: 1, h: 1 }, card)) out.push(`${where}: under the card ${JSON.stringify(card)}`);
            }
          }
        } finally {
          rl.bestiary.close();
        }
      }
      expect(out).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'photo mode\'s panel fits the screen, its title clear of the ≡, its rows clear of the hints and every text clear of the controls',
    async () => {
      const { rl, game, engine } = h;
      const out: string[] = [];
      for (const viewport of PHONES) {
        (engine.renderer as HeadlessView).setViewport(viewport);
        rl.photo.open();
        try {
          engine.input.noteTouch();
          engine.step(2);
          const drawn = texts();
          out.push(...amiss('photo mode', drawn, controls()));
          const panel = (game.showcase.photo as unknown as { panelRect: Box }).panelRect;
          expect(panel.x + panel.w, 'the panel inside the HUD').toBeLessThanOrEqual(engine.hud.width);
          const within = (b: Box) => b.x >= panel.x && b.y >= panel.y && b.x + b.w <= panel.x + panel.w && b.y + b.h <= panel.y + panel.h;
          const rows = drawn.filter(within);
          const hint = drawn.filter((b) => !overlaps(b, panel));
          for (const b of drawn) if (!within(b) && overlaps(b, panel)) out.push(`photo mode at ${engine.hud.width}x${engine.hud.height}: ${b.what} over the panel's edge ${JSON.stringify(panel)}`);
          expect(rows.some((b) => b.what === t('showcase.photo.title')), 'the title').toBe(true);
          expect(hint.length, 'the hints').toBeGreaterThan(0);
          for (const a of rows) for (const b of drawn) if (a !== b && overlaps(a, b)) out.push(`photo mode at ${engine.hud.width}x${engine.hud.height}: ${a.what} over ${b.what}`);
          // every value whole (none cut short with a '.')
          expect(rows.filter((b) => /\.$/.test(b.what)).map((b) => b.what)).toEqual([]);
        } finally {
          rl.photo.close();
        }
      }
      expect(out).toEqual([]);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
