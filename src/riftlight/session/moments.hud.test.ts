// A moment's words on screen in the real game, headless (session/moments.ts): its seconds left, the
// goal under 3-2-1-GO and an escape's way-out mark, on a phone held both ways, a laptop and the
// hub's frame of one player, each placed clear of the HUD (the label, the minimap and gold, a boss's
// bar, the touch controls) and of every other text. The pictures: docs/game/session.md, *Checking it*.
import { afterEach, describe, expect, it } from 'vitest';
import type { Viewport } from '../../engine';
import { type HeadlessMoment, headlessMoment, type HudTextBox, hudOverlap, hudTexts } from '../headless';
import { t } from '../lang';
import { hudGeometry, type HudModel, hudZones } from '../ui/hud';
import { miniCovers, miniWidth } from '../ui/kit';
import { type Box, overlaps } from '../ui/layout';
import { momentById, momentGoal } from './moments';

const SCREENS: readonly [string, Viewport, boolean][] = [
  ['390×844 phone', { width: 390, height: 844, dpr: 3 }, true],
  ['844×390 phone', { width: 844, height: 390, dpr: 2 }, true],
  ['1280×720', { width: 1280, height: 720, dpr: 1 }, false],
  ['the hub’s frame of one player, 1000×850', { width: 1000, height: 850, dpr: 1 }, false],
];

let open: HeadlessMoment | null = null;
afterEach(() => {
  open?.engine.dispose();
  open = null;
});

/** One frame's texts, in the normal font (`hudTexts`) and the mini font, and the way-out mark's pixels (cyan, but the ring's dots). */
function frameOf(r: HeadlessMoment): { texts: (HudTextBox & { mini: boolean })[]; mark: Box[] } {
  const ui = r.game.ui;
  const mini = ui.mini;
  const minis: (HudTextBox & { mini: boolean })[] = [];
  const mark: Box[] = [];
  ui.mini = (x, y, s, color, align = 'left', shadow) => {
    if (s && miniCovers(s)) {
      const w = miniWidth(s);
      minis.push({ text: s, x: Math.round(align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x), y: Math.round(y), w: w + 1, h: 6, mini: true });
    }
    return mini.call(ui, x, y, s, color, align, shadow);
  };
  const rect = ui.rect;
  ui.rect = (x, y, w, h, color) => {
    if (color === 'cyan' && !(w === 2 && h === 1)) mark.push({ x, y, w, h });
    return rect.call(ui, x, y, w, h, color);
  };
  try {
    minis.length = 0;
    const texts = hudTexts(r.engine).map((x) => ({ ...x, mini: false }));
    return { texts: [...texts, ...minis], mark };
  } finally {
    ui.mini = mini;
    ui.rect = rect;
  }
}

/** The zones the HUD reserves this frame (the label, minimap and gold, a boss's bar, the controls, the seconds left, the banner). */
function zonesOf(r: HeadlessMoment): Box[] {
  const model = (r.game as unknown as { hudModel(): HudModel }).hudModel();
  model.controls = r.game.hudRects().controls;
  return hudZones(r.game.ui.w, r.game.ui.h, model);
}

/** The seconds-left text drawn this frame, if any. */
const SECONDS = new Set(Array.from({ length: 31 }, (_, n) => t('round.moment_left', { count: n })));

function check(r: HeadlessMoment, where: string, frame: ReturnType<typeof frameOf>, goal: string | null): void {
  const W = r.game.ui.w;
  const H = r.game.ui.h;
  const hud = r.game.hudRects();
  const g = hudGeometry(W, H, hud.controls);
  const left = frame.texts.find((x) => SECONDS.has(x.text));
  expect(left, `${where}: the seconds left`).toBeDefined();
  expect(left!.x >= 0 && left!.y >= 0 && left!.x + left!.w <= W, `${where}: the seconds left on screen ${JSON.stringify(left)}`).toBe(true);
  for (const o of frame.texts) if (o !== left) expect(hudOverlap(left!, o), `${where}: "${left!.text}" over "${o.text}"`).toBe(false);
  // nor over the minimap, a boss's bar or a touch control
  const map = hud.zones.find((z) => z.id === 'minimap')!;
  expect(overlaps(left!, map, 0), `${where}: "${left!.text}" under the minimap`).toBe(false);
  if (r.game.level?.boss()) expect(overlaps(left!, { x: Math.floor((W - g.bossW) / 2) - 1, y: 16, w: g.bossW + 12, h: 10 }, 0), `${where}: over the boss's bar`).toBe(false);
  for (const c of hud.controls) expect(overlaps(left!, c, 0), `${where}: under a control`).toBe(false);
  if (goal) {
    // the goal under the countdown: every word of it, the rows clear of everything else
    const rows = frame.texts.filter((x) => x.y > left!.y && goal.toUpperCase().includes(x.text.toUpperCase()) && x.text.length > 3).sort((a, b) => a.y - b.y);
    expect(rows.map((x) => x.text).join(' '), `${where}: the goal whole under the countdown`).toBe(goal);
    for (const row of rows) for (const o of frame.texts) if (!rows.includes(o) && o.text !== '3' && o.text !== '2' && o.text !== '1') expect(hudOverlap(row, o), `${where}: "${row.text}" over "${o.text}"`).toBe(false);
  }
  // an escape's mark: on screen, clear of the HUD
  const zones = zonesOf(r);
  for (const p of frame.mark) {
    expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H, `${where}: the way-out mark on screen`).toBe(true);
    for (const z of zones) expect(overlaps(p, z, 0), `${where}: the way-out mark ${JSON.stringify(p)} under the HUD's ${JSON.stringify(z)}`).toBe(false);
    for (const o of frame.texts) expect(overlaps(p, o, 0), `${where}: the way-out mark over "${o.text}"`).toBe(false);
  }
}

describe('a moment’s words on screen', () => {
  for (const id of ['gale-escape', 'vorgath']) {
    it(
      `${id}: the seconds left, the goal under 3-2-1-GO and the way-out mark are clear of the HUD and each other on phones, a laptop and the hub's frame`,
      async () => {
        const m = momentById(id)!;
        for (const [name, viewport, touch] of SCREENS) {
          const r = (open = await headlessMoment(m, { seed: 1, viewport, options: { touch } }));
          const where = `${id}, ${name} (${r.game.ui.w}×${r.game.ui.h})`;
          r.hub.start();
          // the countdown, its number's plate open
          for (let f = 0; f < 400 && r.game.round!.phase !== 'countdown'; f++) await r.frame();
          for (let f = 0; f < 30; f++) await r.frame();
          check(r, `${where}, the countdown`, frameOf(r), momentGoal(m));
          // play, a second in (an escape's mark shows; idle, nobody has fallen yet)
          for (let f = 0; f < 400 && !r.game.round!.playing; f++) await r.frame();
          for (let f = 0; f < 60; f++) await r.frame();
          expect(r.game.round!.phase, where).toBe('playing');
          const play = frameOf(r);
          if (m.clear === 'escape') expect(play.mark.length, `${where}: the way-out mark shows (a chevron or an arrow)`).toBeGreaterThanOrEqual(5);
          check(r, `${where}, play`, play, null);
          expect(r.engine.errors, where).toEqual([]);
          r.engine.dispose();
          open = null;
        }
      },
      240_000,
    );
  }
});
