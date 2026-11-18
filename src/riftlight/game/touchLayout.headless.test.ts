// Riftlight's screens laid out for the device and the screen, headless:
// - the item windows' hints name the device in use, never the screen's width (a landscape phone
//   says "tap", a narrow desktop window "click"), and the vendor window keeps its size whichever
//   device it names (a tap lands where it was aimed);
// - the item windows' button legend keeps clear of the HUD (at 960×540 the inventory's would sit
//   over the mana orb, the skill bar and the minimap);
// - a landscape phone draws Riftlight's denser art (two CSS pixels per art pixel at least);
// - the Arena (?game=arena) gets Riftlight's touch buttons, each naming a control it has.
import { afterEach, describe, expect, it } from 'vitest';
import { gameById } from '../../games';
import { type HeadlessRiftlight, headlessRiftlight } from '../headless';
import { t } from '../lang';
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
const itemsUi = (g: HeadlessRiftlight) => (g.game.ports.loot as RealLoot).ui! as unknown as { hint(id: string, pad: string): string; leftRect(): Box; legendAt(w: number, avoid: readonly Box[]): { x: number; y: number } | null; rects(): Box[] };

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the item windows on every screen', () => {
  it(
    'name the device in use, not the screen width: a phone held sideways says tap, a narrow window click; the vendor keeps its size',
    async () => {
      h = await headlessRiftlight({ seed: 5, viewport: { width: 844, height: 390, dpr: 2 }, options: { touch: true } });
      const { engine, rl } = h;
      expect(engine.renderer.resolution, 'a landscape phone at two CSS pixels per art pixel').toEqual({ width: 422, height: 195 });
      rl.newRun({ slot: 1, seed: 5 });
      engine.input.noteTouch();
      engine.step(2);
      expect(rl.ui.open('vendor')).toBe(true);
      engine.step(2);
      const ui = itemsUi(h);
      expect(ui.hint('item.vendor.hint', 'PadY'), 'a finger: the touch hint on a wide screen').toBe(t('item.vendor.hint_touch'));
      const touchRect = ui.leftRect();
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
