// Engine World on a phone held either way, headless: what every room draws on the HUD itself (its
// line of counts, the Time Lab's prompt and bar, the mixer, the robots' tree, the Gallery's and the
// Workshop's panels) lies inside the screen, under none of the phone's controls (the joystick, the
// hero's buttons, the room's own, ≡ GO ?), where the page lays them out from their data
// (`worldTouchLayout`, which a page without its DOM, a replay, follows too), and clear of the
// room's title. The frames stay in the e2e suite `world`. One engine for the file (the shell is
// one per process).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Engine, HeadlessView, hudPlace } from '../engine';
import { touchStates, worldTouchLayout } from './controls';
import type { worldApi } from './index';
import { shell } from './shell';
import { headlessWorld, roomGame, WORLD_T } from './testWorld';

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
