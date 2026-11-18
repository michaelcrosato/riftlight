// Engine World on a phone held either way, headless: what every room draws on the HUD itself (its
// line of counts, the Time Lab's prompt and bar, the mixer, the robots' tree, the Gallery's and the
// Workshop's panels) lies inside the screen, under none of the phone's controls (the joystick, the
// hero's buttons, the room's own, ≡ GO ?), where the page lays them out from their data
// (`worldTouchLayout`, which a page without its DOM, a replay, follows too), and clear of the
// room's title; a replay of a phone's recording without a page (`npm run replay`, which boots
// with no touch option) lays it out as the phone did. With a mouse and a keyboard the rooms' lines
// and panels stay where they always were. Every room's card fits a phone held either way and a
// desktop window: inside the screen, clear of the controls, its paragraph in whole sentences (or
// the words before its colon) and its tries whole, one at least. The frames stay in the e2e suite
// `world`. One engine for the file (the shell is one per process).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Engine, HeadlessView, hudPlace, type Recording } from '../engine';
import { touchStates, worldTouchLayout } from './controls';
import { type worldApi, worldGame } from './index';
import { shell } from './shell';
import { headlessWorld, roomApi, roomGame, WORLD_T } from './testWorld';

let engine: Engine;
let w: typeof worldApi;

beforeAll(async () => {
  ({ engine, w } = await headlessWorld('atrium', 1, { touch: true, viewport: { width: 390, height: 844, dpr: 2 } }));
}, WORLD_T);
afterAll(() => engine?.dispose());

interface Box {
  what: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The phone's controls this room shows, in art pixels, from their data on the page's viewport (CSS px). */
function controls(): Box[] {
  const { width, height } = engine.renderer.viewport;
  const f = engine.renderer.framing;
  const ax = (x: number) => Math.floor(((x - f.offsetX) / f.cssWidth) * f.artWidth);
  const ay = (y: number) => Math.floor(((y - f.offsetY) / f.cssHeight) * f.artHeight);
  return worldTouchLayout(width, height, touchStates(roomGame(engine).logic.touch?.() ?? {})).map((c, i) => ({ what: i === 0 ? 'the joystick' : `button ${i}`, x: ax(c.x), y: ay(c.y), w: ax(c.x + c.w) - ax(c.x) + 1, h: ay(c.y + c.h) - ay(c.y) + 1 }));
}

/** The texts and panels the room's own `draw` puts on the HUD next frame, placed as the HUD places them. */
function roomHud(): Box[] {
  const hud = engine.hud;
  const logic = roomGame(engine).logic;
  const own = logic.draw;
  const text = hud.text;
  const rect = hud.rect;
  const seen: Box[] = [];
  let inside = false;
  const size = () => ({ width: hud.width, height: hud.height });
  hud.text = (x, y, s, o = {}) => {
    if (inside) {
      const k = Math.max(1, Math.round(o.scale ?? 1));
      const m = hud.measure(s, k);
      const [px, py] = hudPlace(x, y, m.width, m.height, o.anchor ?? 'top-left', size());
      seen.push({ what: s, x: px, y: py, w: m.width + (o.shadow === false ? 0 : k), h: m.height + (o.shadow === false ? 0 : k) });
    }
    text.call(hud, x, y, s, o);
  };
  hud.rect = (x, y, rw, rh, color, anchor = 'top-left') => {
    if (inside) {
      const [px, py] = hudPlace(x, y, rw, rh, anchor, size());
      seen.push({ what: `a ${rw}x${rh} panel`, x: px, y: py, w: rw, h: rh });
    }
    rect.call(hud, x, y, rw, rh, color, anchor);
  };
  logic.draw = own
    ? () => {
        inside = true;
        try {
          own.call(logic);
        } finally {
          inside = false;
        }
      }
    : undefined;
  try {
    engine.step(1);
  } finally {
    hud.text = text;
    hud.rect = rect;
    logic.draw = own;
  }
  return seen;
}

it(
  'every room draws its own HUD inside the screen and clear of the phone\'s controls, held upright and sideways',
  async () => {
    const amiss: string[] = [];
    let drawn = 0;
    for (const viewport of [
      { width: 390, height: 844, dpr: 2 },
      { width: 844, height: 390, dpr: 2 },
    ]) {
      (engine.renderer as HeadlessView).setViewport(viewport);
      for (const r of w.rooms()) {
        await w.goto(r.id, { instant: true });
        engine.input.noteTouch();
        engine.step(20);
        if (w.state().card) {
          // the card away (it covers the top left a while, over everything): the room's title shows
          engine.input.setKey('KeyI', true);
          engine.step(1);
          engine.input.setKey('KeyI', false);
          engine.step(1);
        }
        expect(w.state().card).toBe(false);
        const at = `${r.id} at ${viewport.width}x${viewport.height} (${engine.hud.width}x${engine.hud.height})`;
        const pads = [...controls(), { what: 'the room\'s title', ...shell.titleRect(roomGame(engine).def) }];
        expect(pads.length, `${at}: the joystick and the buttons`).toBeGreaterThan(5);
        const boxes = roomHud();
        drawn += boxes.length;
        for (const b of boxes) {
          if (b.x < 0 || b.y < 0 || b.x + b.w > engine.hud.width || b.y + b.h > engine.hud.height) amiss.push(`${at}: ${b.what} off the screen (${b.x},${b.y} ${b.w}x${b.h})`);
          for (const c of pads) if (overlaps(b, c)) amiss.push(`${at}: ${b.what} (${b.x},${b.y} ${b.w}x${b.h}) under ${c.what} (${c.x},${c.y} ${c.w}x${c.h})`);
        }
      }
    }
    expect(amiss).toEqual([]);
    expect(drawn, 'the rooms drew their lines').toBeGreaterThan(30);
    expect(engine.state().errors).toEqual([]);
  },
  240_000,
);

/** A card's text read without the spaces its wrap broke at (MID-SWING, F[-F]F). */
const flat = (t: string) => t.replace(/\s+/g, '');

/** The room card the next frame draws (null: none): its rect and the texts in it, placed as the HUD places them. */
function card(): { rect: Box; texts: Box[] } | null {
  const s = shell as unknown as { drawCard: (...a: unknown[]) => Box };
  const own = s.drawCard;
  const hud = engine.hud;
  const text = hud.text;
  const texts: Box[] = [];
  let rect: Box | null = null;
  let inside = false;
  hud.text = (x, y, t, o = {}) => {
    if (inside && t.trim()) {
      const k = Math.max(1, Math.round(o.scale ?? 1));
      const m = hud.measure(t, k);
      const [px, py] = hudPlace(x, y, m.width, m.height, o.anchor ?? 'top-left', { width: hud.width, height: hud.height });
      texts.push({ what: t, x: px, y: py, w: m.width + (o.shadow === false ? 0 : k), h: m.height + (o.shadow === false ? 0 : k) });
    }
    text.call(hud, x, y, t, o);
  };
  s.drawCard = function (this: unknown, ...a: unknown[]) {
    inside = true;
    try {
      return (rect = { ...own.apply(this, a), what: 'the card' });
    } finally {
      inside = false;
    }
  };
  try {
    engine.step(1);
  } finally {
    hud.text = text;
    delete (s as Partial<typeof s>).drawCard; // the prototype's again
  }
  return rect && { rect, texts };
}

it(
  'every room\'s card fits a phone held upright and sideways and a desktop window: inside the screen and clear of the controls, its paragraph in whole sentences (or the words before its colon), its tries whole, one at least',
  async () => {
    const amiss: string[] = [];
    let summaries = 0;
    try {
      for (const [viewport, phone] of [
        [{ width: 390, height: 844, dpr: 2 }, true],
        [{ width: 844, height: 390, dpr: 2 }, true],
        [{ width: 1280, height: 720, dpr: 1 }, false],
      ] as const) {
        (engine.renderer as HeadlessView).setViewport(viewport);
        engine.controls.touch = phone; // a desktop: a mouse and a keyboard, no touch controls
        for (const r of w.rooms()) {
          await w.goto(r.id, { instant: true });
          if (phone) engine.input.noteTouch();
          else engine.input.noteDevice('keyboard');
          engine.step(5);
          const at = `${r.id}'s card at ${viewport.width}x${viewport.height} (${engine.hud.width}x${engine.hud.height})`;
          const drawn = card();
          if (!drawn) {
            amiss.push(`${at}: not shown`);
            continue;
          }
          const { rect } = drawn;
          if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > engine.hud.width || rect.y + rect.h > engine.hud.height) amiss.push(`${at}: off the screen ${JSON.stringify(rect)}`);
          for (const c of shell.touchBoxes()) if (overlaps(rect, c)) amiss.push(`${at}: ${JSON.stringify(rect)} over a control ${JSON.stringify(c)}`);
          for (const b of drawn.texts) if (b.x < rect.x || b.y < rect.y || b.x + b.w > rect.x + rect.w || b.y + b.h > rect.y + rect.h) amiss.push(`${at}: ${b.what} over its edge`);
          // its body: the rows under the title and the wing, over the footer's prompts
          const body = drawn.texts.filter((b) => b.y >= rect.y + 26 && b.y < rect.y + rect.h - 12).map((b) => b.what);
          const first = body.findIndex((l) => l.startsWith('- '));
          const def = roomGame(engine).def;
          const about = shell.keys(def.about).toUpperCase();
          const shown = flat((first < 0 ? body : body.slice(0, first)).join(''));
          // whole: its first sentences (all of them, or fewer), or the words before the first one's colon
          const sentences = about.split(/(?<=[.!?])\s+/);
          const colon = sentences[0]!.search(/:\s/);
          const whole = [...sentences.map((_, k) => sentences.slice(0, k + 1).join(' ')), ...(colon > 0 ? [`${sentences[0]!.slice(0, colon)}.`] : [])].map(flat);
          if (!whole.includes(shown)) amiss.push(`${at}: its paragraph cut short: ${body.slice(0, first < 0 ? undefined : first).join(' ')}`);
          if (shown !== flat(about)) summaries += phone ? 1 : 0;
          const tries = def.try.slice(0, 2).map((t) => `- ${shell.keys(t)}`.toUpperCase());
          const bullets = first < 0 ? [] : body.slice(first).reduce<string[]>((out, row) => (row.startsWith('- ') ? [...out, row] : [...out.slice(0, -1), `${out.at(-1)} ${row}`]), []);
          if (!bullets.length || bullets.some((b, i) => flat(b) !== flat(tries[i] ?? ''))) amiss.push(`${at}: its tries ${JSON.stringify(bullets)}, not whole ones of ${JSON.stringify(tries)}`);
        }
      }
    } finally {
      engine.controls.touch = true;
    }
    expect(amiss).toEqual([]);
    expect(summaries, 'some cards a summary on a phone').toBeGreaterThan(10);
    expect(engine.state().errors).toEqual([]);
  },
  240_000,
);

it(
  'a replay of a phone\'s recording, booted with no touch option as `npm run replay` is, lays the HUD out around the phone\'s controls as the phone did',
  async () => {
    (engine.renderer as HeadlessView).setViewport({ width: 390, height: 844, dpr: 2 });
    await w.goto('bullets', { instant: true }); // its line of counts over the joystick
    engine.input.noteTouch();
    const hudLine = shell.hudLine;
    let tops: number[] = [];
    shell.hudLine = (text, color) => {
      const top = hudLine.call(shell, text, color);
      tops.push(top);
      return top;
    };
    try {
      engine.step(30);
      const live = tops;
      const boxes = shell.touchBoxes();
      expect(boxes.length, 'the phone\'s controls').toBeGreaterThan(5);
      expect(live.at(-1), 'the line over them').toBeLessThan(engine.hud.height - 25);
      const rec = JSON.parse(JSON.stringify(engine.recording())) as Recording;
      const replay = async (r: Recording) => {
        engine.controls.touch = false; // a tool's engine: no page, no touch option
        tops = [];
        await engine.replay(r, () => engine.loadGame(worldGame(r.args as { room: string; from: string | null })));
        return { tops, boxes: shell.touchBoxes() };
      };
      expect(await replay(rec)).toEqual({ tops: live, boxes });
      // what the recording keeps decides it: one made without touch controls lays out for the keys
      const desk = await replay({ ...rec, touch: undefined });
      expect(desk.boxes).toEqual([]);
      expect(desk.tops.at(-1), 'lower, over the shell\'s prompts only').toBeGreaterThan(live.at(-1)!);
    } finally {
      shell.hudLine = hudLine;
      engine.controls.touch = true;
    }
    expect(engine.state().errors).toEqual([]);
  },
  120_000,
);

it(
  'on a desktop (no touch controls) every room\'s line stays where it always was, and the Robot Yard\'s tree keeps every branch: whole where it fits, the ones that didn\'t run folded where not',
  async () => {
    const lines: { at: string; top: number; want: number }[] = [];
    const hudLine = shell.hudLine;
    engine.controls.touch = false; // a page without touch controls: a mouse and a keyboard
    engine.input.noteDevice('keyboard');
    let nodes = 0;
    shell.hudLine = (text, color) => {
      const top = hudLine.call(shell, text, color);
      // one row, at the bottom left over the shell's prompts: anchored 18 rows up from the bottom, 7 tall
      if (engine.hud.measure(text).width <= engine.hud.width - 8) lines.push({ at: `${roomGame(engine).def.id} at ${engine.hud.width}x${engine.hud.height}: ${text}`, top, want: engine.hud.height - 25 });
      return top;
    };
    try {
      const trees: Record<string, string[]> = {};
      const under: string[] = [];
      for (const viewport of [
        { width: 1920, height: 1080, dpr: 1 },
        { width: 1280, height: 720, dpr: 1 },
      ]) {
        (engine.renderer as HeadlessView).setViewport(viewport);
        for (const r of w.rooms()) {
          await w.goto(r.id, { instant: true });
          engine.input.noteDevice('keyboard');
          engine.step(20);
          if (w.state().card) {
            engine.input.setKey('KeyI', true);
            engine.step(1);
            engine.input.setKey('KeyI', false);
            engine.step(1);
          }
          if (r.id === 'robots') {
            const drawn = roomHud();
            const line = drawn.find((b) => b.what.startsWith('DELIVERED'))!;
            const panel = drawn.find((b) => b.what.includes('panel'))!;
            if (panel.y + panel.h > line.y) under.push(`the tree's panel ${JSON.stringify(panel)} over the room's line ${JSON.stringify(line)} at ${viewport.width}x${viewport.height}`);
            trees[`${viewport.width}x${viewport.height}`] = drawn.filter((b) => b !== line && b !== panel).map((b) => b.what.slice(2).trim());
            nodes = (roomApi(w).trace() as unknown[]).length;
          } else engine.step(1);
        }
      }
      expect(lines.length, 'the rooms drew their lines').toBeGreaterThan(10);
      expect(lines.filter((l) => l.top !== l.want)).toEqual([]);
      // the tree over the room's line: its root and every branch under it, whole at 1920x1080; at
      // 1280x720 what this tick never reached folded to its name, the whole tree doesn't fit
      expect(under).toEqual([]);
      const branches = ['ROBOT', 'FLEE', 'RECHARGE', 'DELIVER', 'COLLECT', 'WANDER'];
      expect(trees['1920x1080']!.length, `the whole tree at 1920x1080: ${trees['1920x1080']!.join(', ')}`).toBe(1 + nodes); // the robot's name, then every node
      for (const [at, rows] of Object.entries(trees)) for (const b of branches) expect(rows, `${b} in the tree at ${at}`).toContain(b);
    } finally {
      shell.hudLine = hudLine;
      engine.controls.touch = true;
    }
    expect(engine.state().errors).toEqual([]);
  },
  240_000,
);
