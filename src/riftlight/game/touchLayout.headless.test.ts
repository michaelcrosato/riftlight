// Riftlight's screens laid out for the device and the screen, headless:
// - the item windows' hints name the device in use, never the screen's width (a landscape phone
//   says "tap", a narrow desktop window "click"), and on a phone the vendor window keeps its size
//   whichever device it names (a tap lands where it was aimed), while a desktop's keeps main's
//   (the mouse's hint alone: touch never changes a mouse's or a pad's layout);
// - the item windows' button legend keeps clear of the HUD (at 960×540 the inventory's would sit
//   over the mana orb, the skill bar and the minimap);
// - a landscape phone draws Riftlight's denser art (two CSS pixels per art pixel at least);
// - the Arena (?game=arena) gets Riftlight's touch buttons, each naming a control it has.
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { gameById } from '../../games';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { installLanguage, riftlightLines, t } from '../lang';
import { riftlightTranslations } from '../lang/translations';
import type { Box } from '../ui/layout';
import type { RealLoot } from '../wire/loot';
import { CONTROLS, KEYS } from './controls';
import { ARENA_TOUCH_BUTTONS } from '../combat/arena';
import { RIFTLIGHT_TOUCH_BUTTONS, TOUCH_CODES } from './touch';

const T = 60_000;
let h: HeadlessRiftlight | null = null;
afterEach(() => {
  h?.engine.dispose();
  h = null;
});

/** The item windows' view (the real loot port's). */
const itemsUi = (g: HeadlessRiftlight) =>
  (g.game.ports.loot as RealLoot).ui! as unknown as {
    hint(id: string, pad: string): string;
    vendorHint(mode: 'pad' | 'touch' | 'mouse'): { mini: boolean; rows: string[] };
    leftRect(): Box;
    legendAt(w: number, avoid: readonly Box[]): { x: number; y: number } | null;
    rects(): Box[];
  };

/** The vendor window's height with no hint row beyond the first (ItemsUi's VENDOR_H). */
const VENDOR_H = 148;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the item windows on every screen', () => {
  afterEach(() => void installLanguage(new Lang(riftlightLines())));

  it(
    'name the device in use, not the screen width: a phone held sideways says tap, a narrow window click; the vendor keeps its size',
    async () => {
      // German: a finger's hint wraps to three rows, the mouse's to two (in English both take two)
      installLanguage(new Lang(riftlightLines(), riftlightTranslations(), { code: 'de' }));
      h = await headlessRiftlight({ seed: 5, viewport: { width: 844, height: 390, dpr: 2 }, options: { touch: true } });
      const { engine, rl } = h;
      expect(engine.renderer.resolution, 'a landscape phone at two CSS pixels per art pixel').toEqual({ width: 422, height: 195 });
      rl.newRun({ slot: 1, seed: 5 });
      engine.input.noteTouch();
      engine.step(2);
      expect(rl.ui.open('vendor')).toBe(true);
      engine.step(2);
      const ui = itemsUi(h);
      expect(ui.vendorHint('touch').rows.length, 'a finger\'s hint is the taller here').toBeGreaterThan(ui.vendorHint('mouse').rows.length);
      expect(ui.hint('item.vendor.hint', 'PadY'), 'a finger: the touch hint on a wide screen').toBe(t('item.vendor.hint_touch'));
      const touchRect = ui.leftRect();
      expect(touchRect.h, 'the window holds a finger\'s hint').toBe(VENDOR_H + (ui.vendorHint('touch').rows.length - 1) * 9 + 1);
      // the keyboard picked up: its hint, the window where it was
      engine.input.noteDevice('keyboard');
      engine.step(2);
      expect(ui.hint('item.vendor.hint', 'PadY')).toBe(t('item.vendor.hint'));
      expect(ui.leftRect(), 'the vendor window keeps its size and place whichever device its hint names').toEqual(touchRect);
      expect(engine.errors).toEqual([]);
      engine.dispose();

      // a narrow desktop window (no touch controls): the mouse's words
      h = await headlessRiftlight({ seed: 5, viewport: { width: 390, height: 844, dpr: 1 } });
      h.rl.newRun({ slot: 1, seed: 5 });
      h.engine.input.noteDevice('keyboard');
      expect(h.rl.ui.open('vendor')).toBe(true);
      h.engine.step(2);
      expect(itemsUi(h).hint('item.vendor.hint', 'PadY'), 'a narrow window with a mouse: click').toBe(t('item.vendor.hint'));
    },
    T,
  );

  it(
    'a desktop with no touch controls keeps its vendor window: as tall as the mouse\'s hint (de, 1920×1080), however tall a finger\'s would be',
    async () => {
      installLanguage(new Lang(riftlightLines(), riftlightTranslations(), { code: 'de' }));
      for (const viewport of [
        { width: 1920, height: 1080, dpr: 1 },
        { width: 1280, height: 720, dpr: 1 },
      ]) {
        h = await headlessRiftlight({ seed: 5, viewport });
        const { engine, rl } = h;
        expect(engine.renderer.touchDensity, 'no touch controls').toBe(0);
        rl.newRun({ slot: 1, seed: 5 });
        engine.input.noteDevice('keyboard');
        expect(rl.ui.open('vendor')).toBe(true);
        engine.step(2);
        const ui = itemsUi(h);
        const mouse = ui.vendorHint('mouse').rows.length;
        expect(ui.vendorHint('touch').rows.length, 'a finger\'s hint would take a row more').toBeGreaterThan(mouse);
        // main's height: 158 in German (the mouse's two rows), never a finger's 167
        expect(ui.leftRect().h, `${viewport.width}×${viewport.height}`).toBe(VENDOR_H + (mouse - 1) * 9 + 1);
        // a pad's cursor: the pad's hint alone, as before
        (ui as unknown as { cursorMode: string }).cursorMode = 'pad';
        expect(ui.leftRect().h).toBe(VENDOR_H + (ui.vendorHint('pad').rows.length - 1) * 9 + 1);
        engine.dispose();
        h = null;
      }
    },
    T,
  );

  it(
    'their button legend keeps clear of the HUD: at 960×540 the inventory\'s would sit over the mana orb and the skill bar',
    async () => {
      h = await headlessRiftlight({ seed: 6, viewport: { width: 960, height: 540, dpr: 1 } });
      const { engine, rl, game } = h;
      rl.newRun({ slot: 1, seed: 6 });
      await rl.enterDepth(1);
      rl.dev.ai = false;
      engine.step(330); // the level's card has gone: the fixed HUD alone
      engine.input.noteDevice('keyboard');
      expect(rl.ui.open('inventory')).toBe(true);
      engine.step(3);
      const zones = (game as unknown as { hudZonesShown: (Box & { weight: number })[] }).hudZonesShown;
      expect(zones.length).toBeGreaterThan(4);
      const ui = itemsUi(h);
      const w = 120; // Select, Back and L1 R1 Screens with the keyboard's caps
      // where the shell's layer asks the open view (the inventory's panel) to put it
      const at = game.layer.top!.panel.legendAt!(w, zones)!;
      expect(at).not.toBeNull();
      const plate = { x: at.x - Math.ceil(w / 2), y: at.y - 2, w, h: 11 };
      for (const z of zones) expect(overlaps(plate, z), `the legend ${JSON.stringify(plate)} over the HUD's ${JSON.stringify(z)}`).toBe(false);
      for (const r of ui.rects()) expect(overlaps(plate, r), 'over a window').toBe(false);
      expect(plate.x >= 0 && plate.x + plate.w <= engine.renderer.resolution.width).toBe(true);
      // a laptop's 427×240 with a boss's bar and the level's card up has no clear spot: it covers
      // as little of the HUD as it can, never an orb
      engine.dispose();
      h = await headlessRiftlight({ seed: 6, viewport: { width: 1280, height: 720, dpr: 1 } });
      h.rl.newRun({ slot: 1, seed: 6 });
      await h.rl.enterDepth(1);
      const boss = (h.game.level as unknown as { bossUnit: { actor: { life: number; maxLife: number } } }).bossUnit;
      boss.actor.life = boss.actor.maxLife * 0.8; // its bar shows
      h.engine.input.noteDevice('keyboard');
      expect(h.rl.ui.open('inventory')).toBe(true);
      h.engine.step(3);
      const busy = (h.game as unknown as { hudZonesShown: (Box & { weight: number })[] }).hudZonesShown;
      const at2 = h.game.layer.top!.panel.legendAt!(w, busy)!;
      const plate2 = { x: at2.x - Math.ceil(w / 2), y: at2.y - 2, w, h: 11 };
      for (const orb of h.game.hudRects().zones.filter((z) => z.id === 'life' || z.id === 'mana')) expect(overlaps(plate2, orb), `the legend ${JSON.stringify(plate2)} over the ${orb.id} orb`).toBe(false);
    },
    T,
  );
});

describe('the menus on a desktop', () => {
  it(
    'lay out as they always did, the same for the keys, a pad and a touch (a touchscreen laptop): one column, rows a mouse\'s height, no grid',
    async () => {
      for (const viewport of [
        { width: 1920, height: 1080, dpr: 1 },
        { width: 1280, height: 720, dpr: 1 },
      ]) {
        h = await headlessRiftlight({ seed: 5, viewport });
        const { engine, rl, game } = h;
        expect(game.layer.tap, 'no thumb on a page without touch controls').toBe(0);
        const menus = () => {
          const out: Record<string, unknown> = {};
          const top = game.layer.top!;
          out.title = { rect: top.rect, widgets: rl.ui.widgets() };
          for (const id of ['settings', 'slots'] as const) {
            rl.ui.open(id);
            engine.step(12); // opened (their 0.12 s slide)
            out[id] = { rect: game.layer.top!.rect, widgets: rl.ui.widgets() };
            rl.ui.close();
            engine.step(1);
          }
          return out;
        };
        engine.input.noteDevice('keyboard');
        engine.step(12);
        const keys = menus();
        const title = keys.title as { rect: Box; widgets: { id: string; kind: string; rect: Box | null }[] };
        const buttons = title.widgets.filter((w) => w.kind === 'button');
        expect(buttons.every((w) => w.rect && w.rect.h === 14 && w.rect.x === buttons[0]!.rect!.x), 'one column of a mouse\'s rows').toBe(true);
        engine.input.noteDevice('pad');
        engine.step(2);
        expect(menus(), `${viewport.width}×${viewport.height}: a pad's menus are the keys'`).toEqual(keys);
        engine.input.noteTouch();
        engine.step(2);
        expect(menus(), `${viewport.width}×${viewport.height}: a touch moves nothing`).toEqual(keys);
        engine.dispose();
        h = null;
      }
    },
    T,
  );
});

describe('the Arena on a phone', () => {
  it('gets Riftlight\'s cluster: each button presses a key one of its controls has, with no pause button it has no menu for and no F', () => {
    expect(gameById('arena')!.options.touchButtons).toBe(ARENA_TOUCH_BUTTONS);
    const codes = ARENA_TOUCH_BUTTONS.map((b) => b.code);
    expect(codes).not.toContain(TOUCH_CODES.menu);
    // the skill bar's fifth slot has no phone button
    expect(codes).not.toContain(TOUCH_CODES.interact);
    const keys = new Set<string>([...KEYS.attack, ...KEYS.dodge, ...KEYS.skill.flat()]);
    for (const b of ARENA_TOUCH_BUTTONS) expect(keys.has(b.code), `${b.label} presses ${b.code}`).toBe(true);
    // the labels are the controls' touch names (A attack, B dodge, 1-4 the skills)
    const labels = Object.fromEntries(ARENA_TOUCH_BUTTONS.map((b) => [b.code, b.label]));
    expect(labels[TOUCH_CODES.attack]).toBe(CONTROLS.attack.touch);
    expect(labels[TOUCH_CODES.dodge]).toBe(CONTROLS.dodge.touch);
    TOUCH_CODES.skills.forEach((c, i) => expect(labels[c]).toBe(CONTROLS[`skill${i + 1}` as 'skill1'].touch));
    expect(ARENA_TOUCH_BUTTONS.length).toBe(RIFTLIGHT_TOUCH_BUTTONS.length - 2);
  });
});
