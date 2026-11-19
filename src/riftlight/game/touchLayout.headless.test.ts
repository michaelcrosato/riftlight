// Riftlight's screens laid out for the device and the screen, headless:
// - the item windows' hints name the device in use, never the screen's width (a landscape phone
//   says "tap", a narrow desktop window "click"), and on a phone the vendor window keeps its size
//   whichever device it names (a tap lands where it was aimed), while a desktop's keeps main's
//   (the mouse's hint alone: touch never changes a mouse's or a pad's layout);
// - the item windows' button legend keeps clear of the HUD (at 960×540 the inventory's would sit
//   over the mana orb, the skill bar and the minimap);
// - a landscape phone draws Riftlight's denser art (about two CSS pixels per art pixel);
// - the Arena (?game=arena) gets Riftlight's touch buttons, each naming a control it has;
// - a phone in 52in1, held either way, has the whole corner map (a tap target) and the gold below the
//   hub's wake band, over no control and none of the HUD, couch guests and a boss's bar too; one held
//   sideways too short for a map a thumb across there has it at the top still, drawn in the band (a
//   touch there is the hub's), shrunk to clear the controls, taking no tap, and its pause menu opens
//   the map; in a round there (no pause menu, no ≡) the Map button in ≡'s place opens it, recorded;
// - a phone in 52in1: a finger held in the hub's wake band is the hub's, no swing (on its own page,
//   and under the band, it swings);
// - a phone's recording (and save-state) made in 52in1 replays with ≡ where 52in1 put it, below the
//   hub's wake band, with no hub behind the replay: the HUD it lays out, and a tap lands on, is the
//   recorded one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lang } from '../../engine';
import { gameById } from '../../games';
import { type HeadlessMoment, type HeadlessRiftlight, headlessMoment, headlessRiftlight, makeRiftlight } from '../headless';
import { Riftlight } from '../index';
import { momentById } from '../session/moments';
import { installLanguage, riftlightLines, t } from '../lang';
import { riftlightTranslations } from '../lang/translations';
import type { Box } from '../ui/layout';
import { mapView } from '../ui/hud';
import type { RealLoot } from '../wire/loot';
import { CONTROLS, KEYS } from './controls';
import { ARENA_TOUCH_BUTTONS } from '../combat/arena';
import { HUB_WAKE, RIFTLIGHT_TOUCH_BUTTONS, TOUCH_CODES, touchLayout } from './touch';
import type { HeroIntent } from './ports';
import { SaveStore } from './save';

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
    tabRect(i: number): Box;
    vendorTabs(): readonly unknown[];
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
      // its tabs (wares, gems, gamble) inside the window, clear of its frame
      const tabs = ui.vendorTabs().map((_, i) => ui.tabRect(i));
      expect(tabs.length, 'three tabs').toBe(3);
      for (const tab of tabs) expect(tab.x + tab.w, `a tab ${JSON.stringify(tab)} inside the window ${JSON.stringify(touchRect)}`).toBeLessThanOrEqual(touchRect.x + touchRect.w - 4);
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

describe('a phone at DPR 2.625 (a Pixel), and phones held sideways under a browser\'s bar', () => {
  // a Pixel 7 held sideways (863×360), under Chrome's bar (923×340), a Fold's cover screen at its own
  // DPR (882×344) and upright (412×839); phones 340 CSS px tall at DPR 3 (an iPhone in Safari, 800×340)
  for (const viewport of [
    { width: 863, height: 360, dpr: 2.625 },
    { width: 923, height: 340, dpr: 2.625 },
    { width: 882, height: 344, dpr: 2.625 },
    { width: 412, height: 839, dpr: 2.625 },
    { width: 800, height: 340, dpr: 3 },
  ] as const) {
    const sideways = viewport.width > viewport.height;
    it(
      `${viewport.width}×${viewport.height} at DPR ${viewport.dpr}: ${sideways ? 'about two CSS px an art pixel, about 180 rows' : 'its art as dense as a DPR 2 or 3 phone’s'}; every title entry in view, a thumb tall; every item window on screen (the bag, the vendor, the stash, the bench, the skills); in a level no HUD under a control`,
      async () => {
        h = await headlessRiftlight({ seed: 7, viewport, options: { touch: true } });
        const { engine, rl, game } = h;
        engine.input.noteTouch();
        engine.step(3);
        const { width: W, height: H } = engine.renderer.resolution;
        const css = engine.renderer.framing.cssWidth / W;
        // upright the art is already denser (three CSS px at DPR 2.625: 136×276)
        if (sideways) expect(Math.abs(css - 2), `${W}×${H}: about two CSS px an art pixel (${css.toFixed(3)})`).toBeLessThanOrEqual(0.1);
        else expect(css, `${W}×${H}: two CSS px an art pixel or more (${css.toFixed(3)})`).toBeGreaterThanOrEqual(1.9);
        if (sideways) expect(H, 'the rows a sideways phone of its size draws at DPR 2 or 3, about').toBeGreaterThanOrEqual(viewport.dpr === 3 ? 170 : 179);
        // the title: every entry in view (none scrolled off), a thumb tall
        const title = rl.ui.widgets().filter((w) => w.kind === 'button');
        expect(title.filter((w) => !w.rect).map((w) => w.id), 'every title entry in view').toEqual([]);
        expect(Math.min(...title.map((w) => w.rect!.h)) * css, 'a thumb tall').toBeGreaterThanOrEqual(40);
        for (const w of title) expect(w.rect!.y >= 0 && w.rect!.y + w.rect!.h <= H, `${w.id} ${JSON.stringify(w.rect)} on screen`).toBe(true);
        rl.newRun({ slot: 1, seed: 7 });
        engine.step(3);
        for (const [view, open] of [
          ['inventory', () => rl.ui.open('inventory')],
          ['vendor', () => rl.ui.open('vendor')],
          ['stash', () => rl.ui.open('stash')],
          ['crafting', () => rl.ui.open('crafting')],
          ['skills', () => rl.ui.open('skills')],
        ] as const) {
          expect(open(), view).toBe(true);
          engine.step(3);
          for (const r of itemsUi(h).rects()) expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, `the ${view}'s window ${JSON.stringify(r)} on the ${W}×${H} screen`).toBe(true);
          // the vendor's window holds a finger's hint in rows: in every language
          if (view === 'vendor') {
            try {
              for (const code of Object.keys(riftlightTranslations())) {
                installLanguage(new Lang(riftlightLines(), riftlightTranslations(), { code }));
                const r = itemsUi(h).leftRect();
                expect(r.y >= 0 && r.y + r.h <= H, `${code}: the vendor's window ${JSON.stringify(r)} on the ${W}×${H} screen`).toBe(true);
              }
            } finally {
              installLanguage(new Lang(riftlightLines()));
            }
          }
          rl.ui.close();
          engine.step(2);
        }
        // a level: no zone of the HUD under a control (the data's layout: the page's, the phone e2e checks)
        await rl.enterDepth(1);
        rl.dev.ai = false;
        engine.step(30);
        const r = game.hudRects();
        expect(r.touch && r.controls.length, 'the touch layout').toBeGreaterThanOrEqual(7);
        for (const z of r.zones.filter((z) => z.id !== 'control')) for (const c of r.controls) expect(overlaps(z, c), `the ${z.id} ${JSON.stringify(z)} under a control ${JSON.stringify(c)}`).toBe(false);
        expect(engine.errors).toEqual([]);
      },
      T,
    );
  }
});

describe('the menus on a desktop', () => {
  it(
    'lay out as they always did, the same for the keys, a pad and a touch (a touchscreen laptop): one column, rows a mouse\'s height, no grid (a pad\'s slots without the files\' rows)',
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
        // the same, but for the slots' export and import as JSON (the keyboard's: `slotFiles`)
        type Shown = { widgets: { id: string; kind: string; rect: Box | null }[] };
        const { slots: padSlots, ...pad } = menus();
        const { slots: keySlots, ...rest } = keys;
        expect(pad, `${viewport.width}×${viewport.height}: a pad's menus are the keys'`).toEqual(rest);
        const rows = (m: unknown) => (m as Shown).widgets.map((w) => [w.id, w.kind, w.rect?.x, w.rect?.w, w.rect?.h]);
        expect(rows(padSlots), 'its slots: the keys\' rows less the files\'').toEqual(rows(keySlots).filter(([id]) => id !== 'export' && id !== 'import'));
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
    // the labels are the controls' touch names (A attack, 1-4 the skills); B the dodge, which a line
    // names on a phone (`key.touch.dodge`: in Riftlight's play the button draws an icon, no letter)
    const labels = Object.fromEntries(ARENA_TOUCH_BUTTONS.map((b) => [b.code, b.label]));
    expect(labels[TOUCH_CODES.attack]).toBe(CONTROLS.attack.touch);
    expect([labels[TOUCH_CODES.dodge], CONTROLS.dodge.touch]).toEqual(['B', 'TouchDodge']);
    TOUCH_CODES.skills.forEach((c, i) => expect(labels[c]).toBe(CONTROLS[`skill${i + 1}` as 'skill1'].touch));
    expect(ARENA_TOUCH_BUTTONS.length).toBe(RIFTLIGHT_TOUCH_BUTTONS.length - 2);
  });
});

describe('a phone in 52in1: the corner map', () => {
  /** A finger's tap at art pixel (x, y), as the page's canvas tells the engine. */
  const tap = (g: HeadlessRiftlight, x: number, y: number) => {
    const { width, height } = g.engine.renderer.resolution;
    for (const down of [true, false]) {
      g.engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2);
      (g.engine.input.pointer as { touch: boolean }).touch = true;
      (g.engine.input as unknown as { button(code: string, down: boolean): void }).button('Touch', down);
      g.engine.step(1);
    }
  };
  for (const viewport of [
    { width: 390, height: 844, dpr: 3 },
    { width: 360, height: 800, dpr: 3 },
    // on its side the skills' arc is under the corner: the map shrinks to fit above it, the gold beside it
    { width: 740, height: 360, dpr: 2 },
    { width: 844, height: 390, dpr: 2 },
    { width: 915, height: 412, dpr: 2.625 },
    { width: 812, height: 375, dpr: 3 },
  ] as const) {
    const sideways = viewport.width > viewport.height;
    it(
      `${viewport.width}×${viewport.height}: a tap target, the whole of it sits below the hub’s wake band as ≡ does, the gold ${sideways ? 'beside' : 'under'} it, over no control and none of the HUD, with couch guests and a boss's bar too (on its own page at the top, over no control); a tap on it opens the level's map, one in the band nothing`,
      async () => {
        const top = async (hubSettings?: object) => {
          h?.engine.dispose();
          h = await headlessRiftlight({ seed: 12, viewport, options: { touch: true, ...(hubSettings ? { hubSettings } : {}) } });
          h.engine.input.send({ rl: 'run', slot: 0, seed: 12 });
          h.engine.input.noteTouch();
          h.engine.step(30);
          await h.rl.enterDepth(1);
          h.engine.step(30);
          const f = h.engine.renderer.framing;
          const r = h.game.hudRects();
          const map = r.zones.find((z) => z.id === 'minimap')!;
          expect(map, 'a corner map in a level').toBeDefined();
          return { map, r, css: (y: number) => f.offsetY + (y / f.artHeight) * f.cssHeight };
        };
        const alone = await top();
        // its full size where it and the gold under it clear the controls (844×390, 915×412, upright),
        // else shrunk to (a hidden interact button's place too: it shows by a chest)
        expect([alone.map.y, alone.map.h <= (sideways ? 68 : 38)], 'on its own page: at the top, its full size or shrunk').toEqual([2, true]);
        if (viewport.width === 844 || viewport.width === 915 || !sideways) expect(alone.map.h, 'its full size').toBe(sideways ? 68 : 38);
        for (const z of alone.r.zones.filter((z) => z.id !== 'control')) for (const c of alone.r.controls) expect(overlaps(z, c), `on its own page: the ${z.id} ${JSON.stringify(z)} under a control ${JSON.stringify(c)}`).toBe(false);
        const hub = await top({});
        const g = h!.game;
        const wake = g.touchPad.wakeArt();
        expect(hub.css(wake), 'the band in art pixels').toBeGreaterThanOrEqual(HUB_WAKE);
        /** The corner map and the gold: below the band, over no control and none of the rest of the HUD (the level's banner too). */
        const clear = (where: string) => {
          const r = g.hudRects();
          const map = r.zones.find((z) => z.id === 'minimap')!;
          const gold = r.zones.find((z) => z.id === 'gold')!;
          for (const own of [map, gold]) {
            expect(own.y, `${where}: the ${own.id} ${JSON.stringify(own)} below the wake band (${wake} rows)`).toBeGreaterThanOrEqual(wake);
            for (const z of [...r.controls, ...r.zones.filter((z) => z !== map && z !== gold)]) expect(overlaps(own, z), `${where}: the ${own.id} ${JSON.stringify(own)} over ${JSON.stringify(z)}`).toBe(false);
          }
          if (sideways) expect(gold.x + gold.w <= map.x && gold.y < map.y + 10, `${where}: the gold ${JSON.stringify(gold)} beside the map ${JSON.stringify(map)}`).toBe(true);
          else expect(gold.y, `${where}: the gold under the map`).toBeGreaterThanOrEqual(map.y + map.h - 1);
          return map;
        };
        const map = clear('a level, its banner up');
        expect(map).toEqual(hub.map);
        // couch guests (players 2 to 4) and a boss's bar: the map stays put, they keep off it and the gold
        const boss = (g.level as unknown as { bossUnit: { actor: { life: number; maxLife: number } } }).bossUnit;
        boss.actor.life = boss.actor.maxLife * 0.8; // its bar shows
        for (const slot of [1, 2, 3]) {
          expect(g.coop.join(slot), `a guest on pad ${slot}`).not.toBeNull();
          h!.engine.step(2);
          expect(g.hudRects().zones.filter((z) => z.id === 'boss' || z.id === 'guests').length, "the boss's bar and the strips").toBe(2);
          expect(clear(`${slot} guest(s) and a boss`), 'where it was').toEqual(map);
        }
        // what takes a tap: all of it, a thumb tall at least (44 CSS px)
        expect(hub.css(map.y + map.h) - hub.css(map.y), 'a thumb tall').toBeGreaterThanOrEqual(44);
        // a tap in the band above it is the hub's: no map
        tap(h!, map.x + map.w / 2, Math.floor(wake / 2));
        expect(g.mapOpen, 'a tap in the wake band opens nothing').toBe(false);
        tap(h!, map.x + map.w / 2, map.y + map.h / 2);
        expect(g.mapOpen, 'a tap on the corner map opens the map').toBe(true);
        expect(h!.engine.errors).toEqual([]);
      },
      T,
    );
  }
});

describe('a phone in 52in1 held sideways too short for a corner map below the hub’s wake band', () => {
  /** A finger's tap at art pixel (x, y), as the page's canvas tells the engine. */
  const tap = (g: HeadlessRiftlight, x: number, y: number) => {
    const { width, height } = g.engine.renderer.resolution;
    for (const down of [true, false]) {
      g.engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2);
      (g.engine.input.pointer as { touch: boolean }).touch = true;
      (g.engine.input as unknown as { button(code: string, down: boolean): void }).button('Touch', down);
      g.engine.step(1);
    }
  };
  // an iPhone 14 or 15 held sideways in Safari, a Pixel 5, a Galaxy Z Fold's cover screen and an
  // iPhone SE (1st): no room for a map a thumb across between the band and the skills' arc
  for (const viewport of [
    { width: 734, height: 343, dpr: 3 },
    { width: 802, height: 294, dpr: 2.75 },
    { width: 882, height: 344, dpr: 2.625 },
    { width: 568, height: 320, dpr: 2 },
  ] as const) {
    it(
      `${viewport.width}×${viewport.height}: the corner map stays, drawn at the top in the band (shrunk to clear the controls, the gold under it) over no control and none of the HUD, and takes no tap: one on it, in the band or under it, opens nothing (on its own page it does, at the top shrunk the same way); the pause menu’s Map opens the level's map (none on its own page), a tap on it closes it`,
      async () => {
        const boot = async (hubSettings?: object) => {
          h?.engine.dispose();
          h = await headlessRiftlight({ seed: 12, viewport, options: { touch: true, ...(hubSettings ? { hubSettings } : {}) } });
          h.engine.input.send({ rl: 'run', slot: 0, seed: 12 });
          h.engine.input.noteTouch();
          h.engine.step(30);
          await h.rl.enterDepth(1);
          h.engine.step(30);
          return h.game;
        };
        /** The pause menu's entries. */
        const pause = (g: HeadlessRiftlight['game']) => {
          expect(g.openPanel('pause'), 'the pause menu').not.toBeNull();
          h!.engine.step(2);
          return h!.rl.ui.widgets();
        };
        let g = await boot();
        const full = viewport.width < 600 ? { w: 48, h: 38 } : { w: 88, h: 68 };
        const own = g.hudRects();
        const alone = own.zones.find((z) => z.id === 'minimap')!;
        // the skills' arc under the corner: shrunk to clear the controls, the gold under it, as in 52in1
        // (an SE's 568×320, whose compact map is smaller: its full size)
        expect([alone.y, alone.w <= full.w && alone.h <= full.h && (alone.h < full.h || viewport.width < 600)], `on its own page: the corner map ${JSON.stringify(alone)} at the top, shrunk`).toEqual([2, true]);
        for (const z of own.zones.filter((z) => z.id !== 'control')) for (const c of own.controls) expect(overlaps(z, c), `on its own page: the ${z.id} ${JSON.stringify(z)} under a control ${JSON.stringify(c)}`).toBe(false);
        tap(h!, alone.x + alone.w / 2, alone.y + alone.h / 2);
        expect(g.mapOpen, 'on its own page a tap on the corner map opens the map').toBe(true);
        tap(h!, Math.floor(h!.engine.renderer.resolution.width / 2), Math.floor(h!.engine.renderer.resolution.height / 2));
        expect(g.mapOpen, 'a tap on the map closes it').toBe(false);
        expect(pause(g).map((w) => w.id), 'on its own page no Map entry: a tap on the corner map opens it').not.toContain('map');
        h!.rl.ui.close();
        g = await boot({});
        const wake = g.touchPad.wakeArt();
        expect(wake, 'in 52in1: the wake band').toBeGreaterThan(0);
        const f = h!.engine.renderer.framing;
        const css = (y: number) => f.offsetY + (y / f.artHeight) * f.cssHeight;
        const r = g.hudRects();
        const map = r.zones.find((z) => z.id === 'minimap')!;
        const gold = r.zones.find((z) => z.id === 'gold')!;
        // drawn: the map never goes (drawing in the band is fine; only a tap there is the hub's)
        expect(map, 'in 52in1: the corner map, drawn').toBeDefined();
        expect([map.y, css(map.y) < HUB_WAKE], 'at the top, in the band').toEqual([2, true]);
        expect(map.w <= full.w && map.h <= full.h && map.w >= 48 && map.h >= 20, `the map ${JSON.stringify(map)} shrunk to clear the controls, no less than 44×16 inside its frame`).toBe(true);
        expect(gold.y, `the gold ${JSON.stringify(gold)} under the map ${JSON.stringify(map)}`).toBeGreaterThanOrEqual(map.y + map.h - 1);
        for (const own of [map, gold]) for (const z of [...r.controls, ...r.zones.filter((z) => z !== map && z !== gold)]) expect(overlaps(own, z), `the ${own.id} ${JSON.stringify(own)} over ${JSON.stringify(z)}`).toBe(false);
        // no tap on it: in the band (a touch there is the hub's) nor on its rows under the band
        for (const x of [map.x + 3, map.x + map.w / 2, map.x + map.w - 3]) {
          for (const y of [map.y + 3, Math.min(wake, map.y + map.h) - 2, map.y + map.h - 2]) {
            tap(h!, x, y);
            expect(g.mapOpen, `a tap on the corner map at (${x}, ${y}) opens nothing`).toBe(false);
          }
        }
        // the pause menu's Map: the pause closes, the level's map opens; a tap on it closes it
        const entry = pause(g).find((w) => w.id === 'map');
        expect(entry?.rect, 'the pause menu has Map').toBeDefined();
        tap(h!, entry!.rect!.x + entry!.rect!.w / 2, entry!.rect!.y + entry!.rect!.h / 2);
        h!.engine.step(2);
        expect([h!.rl.state().ui, g.mapOpen], 'the pause gone, the map open').toEqual([[], true]);
        const { width, height } = h!.engine.renderer.resolution;
        tap(h!, Math.floor(width / 2), Math.floor(height / 2));
        expect(g.mapOpen, 'a tap on the map closes it').toBe(false);
        expect(h!.engine.errors).toEqual([]);
      },
      T,
    );
  }
});

describe('a 52in1 round on a phone held sideways with no room for a corner map below the hub’s wake band', () => {
  // a round has no pause menu (no ≡, no Map entry) and its corner map takes no tap: the Map button.
  // 600×428 has room for a map there, but not for the mana orb beside one: at the top too, the orb
  // climbed beside the controls (where it is on the game's own page)
  for (const viewport of [
    { width: 734, height: 343, dpr: 3 },
    { width: 882, height: 344, dpr: 2.625 },
    { width: 600, height: 428, dpr: 3 },
  ] as const) {
    it(
      `${viewport.width}×${viewport.height}: the Map button in ≡'s place, below the band and a thumb across, opens the level's map by touch during the round and closes it; recorded, a replay with no hub behind it opens it too`,
      async () => {
        let r: HeadlessMoment | null = null;
        try {
          r = await headlessMoment(momentById('gale-escape')!, { seed: 1, viewport, options: { touch: true, hubSettings: {} } });
          const { engine, game: g } = r;
          engine.input.noteTouch();
          r.hub.start();
          for (let f = 0; f < 400 && !g.round!.playing; f++) await r.frame();
          for (let f = 0; f < 30; f++) await r.frame();
          expect(g.round!.phase, 'the round is on').toBe('playing');
          // the corner map is drawn at the top, in the band: a tap on it is the hub's, it opens nothing
          const corner = g.hudRects().zones.find((z) => z.id === 'minimap')!;
          expect(corner.y, 'the corner map at the top, in the band').toBe(2);
          const { width, height } = engine.renderer.resolution;
          for (const down of [true, false]) {
            engine.input.setPointer(((corner.x + corner.w / 2 + 0.5) / width) * 2 - 1, 1 - ((corner.y + corner.h - 2.5) / height) * 2);
            (engine.input.pointer as { touch: boolean }).touch = true;
            (engine.input as unknown as { button(code: string, down: boolean): void }).button('Touch', down);
            await r.frame();
          }
          expect(g.mapOpen, 'a tap on the corner map opens nothing').toBe(false);
          // no ≡ in a round; the Map button in its place, below the band, a thumb across
          const frame = g.touchFrame();
          expect([frame.round, frame.map], 'a round: the Map button shows').toEqual([true, true]);
          const buttons = g.touchPad.buttons;
          const map = buttons.find((b) => b.code === TOUCH_CODES.map);
          expect(map, 'the Map button').toBeDefined();
          const css = touchLayout(viewport.width, viewport.height, buttons);
          const rect = css[1 + buttons.indexOf(map!)]!;
          expect(rect, 'in ≡’s place').toEqual(css[1 + buttons.findIndex((b) => b.code === TOUCH_CODES.menu)]);
          expect(rect.y, 'below the wake band').toBeGreaterThanOrEqual(HUB_WAKE);
          expect(Math.min(rect.w, rect.h), 'a thumb across').toBeGreaterThanOrEqual(44);
          // the HUD lays out around it (the data's controls, the button among them)
          const art = g.touchPad.dataLayout()[1 + buttons.indexOf(map!)]!;
          expect(g.hudRects().controls, 'the HUD around it').toContainEqual(art);
          for (const z of g.hudRects().zones.filter((z) => z.id !== 'control')) expect(overlaps(z, art), `the HUD's ${z.id} ${JSON.stringify(z)} under the Map button ${JSON.stringify(art)}`).toBe(false);
          /** A finger on the button, as the page's button presses its key. */
          const press = async () => {
            engine.input.noteTouch();
            engine.input.setKey(map!.code, true);
            await r!.frame();
            engine.input.setKey(map!.code, false);
            await r!.frame();
          };
          await press();
          expect(g.mapOpen, 'the Map button opens the level’s map in the round').toBe(true);
          // a room of its own: not a sliver above an orb that climbed beside the controls (600×428)
          const room = (g as unknown as { mapRoom(): Box }).mapRoom();
          expect(room.h, `the map's room ${JSON.stringify(room)}`).toBeGreaterThanOrEqual(engine.renderer.resolution.height * 0.4);
          for (const orb of g.hudRects().zones.filter((z) => z.id === 'life' || z.id === 'mana')) expect(overlaps(room, orb), `the map's room ${JSON.stringify(room)} over the ${orb.id} orb ${JSON.stringify(orb)}`).toBe(false);
          // the map as drawn in it (its frame too) is clear of the HUD's top-left block (the level, the
          // clock, the kills) and the round's seconds
          const v = mapView(room, (g as unknown as { minimapModel(): Parameters<typeof mapView>[1] }).minimapModel());
          const drawn = { x: v.x - 3, y: v.y - 3, w: v.w + 6, h: v.h + 6 };
          for (const z of g.hudRects().zones.filter((z) => z.id === 'where' || z.id === 'time')) expect(overlaps(drawn, z), `the map ${JSON.stringify(drawn)} over the HUD's ${z.id} ${JSON.stringify(z)}`).toBe(false);
          expect(g.touchFrame().map, 'and stays to close it').toBe(true);
          await press();
          expect(g.mapOpen, 'again: it closes').toBe(false);
          await press();
          expect(g.mapOpen).toBe(true);
          expect(engine.errors).toEqual([]);
          // recorded: a replay with no hub behind it opens the map as the round did
          const rec = engine.recording()!;
          await engine.replay(rec, () => engine.loadGame(new Riftlight({}, { store: new SaveStore(null) })));
          const again = engine.game as Riftlight;
          expect([again.round?.moment?.id, again.mapOpen], 'replayed: the round, its map open').toEqual(['gale-escape', true]);
          expect(engine.errors).toEqual([]);
        } finally {
          r?.engine.dispose();
        }
      },
      T,
    );
  }
});

describe('a phone in 52in1, replayed without the hub', () => {
  it(
    'lays the touch controls out as the recorded page had them: ≡ below the wake band, the HUD around it the recorded one (a replay and a save-state)',
    async () => {
      const viewport = { width: 390, height: 844, dpr: 3 };
      const store = new SaveStore(null);
      // in 52in1 (the hub's settings on the page): ≡ below the hub's wake band
      h = await headlessRiftlight({ seed: 9, viewport, store, options: { touch: true, hubSettings: {} } });
      h.engine.input.send({ rl: 'run', slot: 0, seed: 9 }); // a new run, as the title's menu starts one (recorded)
      h.engine.input.noteTouch();
      h.engine.step(30);
      expect(h.game.screen).toBe('town');
      const live = h.game.hudRects();
      const menu = live.controls.at(-1)!;
      const css = h.engine.renderer.framing.cssWidth / h.engine.renderer.framing.artWidth; // CSS px per art pixel
      expect(live.touch, 'the touch layout').toBe(true);
      expect(menu.y * css, '≡ below the wake band').toBeGreaterThanOrEqual(HUB_WAKE - css);
      const snap = await h.engine.snapshot();
      const rec = JSON.parse(JSON.stringify(h.engine.recording())) as Parameters<typeof h.engine.replay>[0];
      h.engine.dispose();
      // no hub behind it (a bug report replayed in Node): the recorded page's layout all the same
      h = await headlessRiftlight({ seed: 9, viewport, store: new SaveStore(null), options: { touch: true } });
      expect(h.game.touchPad.dataLayout().at(-1)!.y, 'on its own page ≡ is in the corner').toBeLessThan(menu.y);
      const again = makeRiftlight(store, 9);
      await h.engine.replay(rec, () => h!.engine.loadGame(again));
      expect(again.hudRects().controls, 'replayed: the recorded controls').toEqual(live.controls);
      expect(again.hudRects().zones, 'replayed: the HUD around them').toEqual(live.zones);
      expect(h.engine.errors).toEqual([]);
      h.engine.dispose();
      // a save-state taken in 52in1, restored with no hub behind it
      h = await headlessRiftlight({ seed: 9, viewport, store: new SaveStore(null), options: { touch: true } });
      await h.engine.restore(snap);
      h.engine.step(1);
      expect(h.game.hudRects().controls, 'restored: the controls as they were').toEqual(live.controls);
      expect(h.engine.errors).toEqual([]);
    },
    T,
  );
});

describe('a phone in 52in1: a finger in the hub’s wake band', () => {
  it(
    'is the hub’s (its companion brings the bar back): held there it never swings, on its own page at the same height it does, and under the band too',
    async () => {
      const viewport = { width: 390, height: 844, dpr: 3 } as const;
      /** Riftlight in a level by touch (in 52in1 with `hubSettings`), its auto attack off: only a finger swings. */
      const boot = async (hubSettings?: object) => {
        h?.engine.dispose();
        h = await headlessRiftlight({ seed: 12, viewport, options: { touch: true, ...(hubSettings ? { hubSettings } : {}) } });
        h.engine.input.send({ rl: 'run', slot: 0, seed: 12 });
        h.engine.input.noteTouch();
        h.engine.step(30);
        await h.rl.enterDepth(1);
        h.rl.dev.ai = false;
        h.engine.step(240); // the level's banner gone (a finger on it is no swing either)
        h.game.settings.touchAutoAttack = false;
        return h;
      };
      /** The fixed steps' attack intents while a finger stays down at art pixel (x, y) a fifth of a second, then lifts. */
      const held = (g: HeadlessRiftlight, x: number, y: number): boolean[] => {
        const out: boolean[] = [];
        const step = g.game.hero.fixedUpdate.bind(g.game.hero);
        const spy = vi.spyOn(g.game.hero, 'fixedUpdate').mockImplementation((dt: number, i: HeroIntent) => (out.push(i.attack), step(dt, i)));
        const { width, height } = g.engine.renderer.resolution;
        try {
          for (const down of [true, false]) {
            g.engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2);
            (g.engine.input.pointer as { touch: boolean }).touch = true;
            (g.engine.input as unknown as { button(code: string, down: boolean): void }).button('Touch', down);
            g.engine.step(down ? 12 : 30); // then the swing's end
          }
        } finally {
          spy.mockRestore();
        }
        return out;
      };
      let g = await boot({});
      const wake = g.game.touchPad.wakeArt();
      const { width, height } = g.engine.renderer.resolution;
      const mid = Math.floor(width / 2);
      expect(wake, 'in 52in1: the wake band').toBeGreaterThan(0);
      const band = held(g, mid, Math.floor(wake / 2));
      expect(band.length, 'steps ran').toBeGreaterThan(10);
      expect(band.filter(Boolean).length, 'a finger held in the wake band: no swing').toBe(0);
      expect([g.game.mapOpen, g.rl.state().ui], 'nor anything else').toEqual([false, []]);
      expect(held(g, mid, Math.floor(height / 3)).some(Boolean), 'under the band it swings').toBe(true);
      /** What a tap at (x, y) does with a loot label drawn there (as the last frame's `touchable`). */
      const tapOn = (r: HeadlessRiftlight, x: number, y: number) => {
        const game = r.game as unknown as { touchable: { loot: { id: number; rect: Box }[] }; touchTarget(x: number, y: number): unknown };
        game.touchable.loot = [{ id: 7, rect: { x: x - 10, y: y - 4, w: 20, h: 8 } }];
        return game.touchTarget(x, y);
      };
      expect(tapOn(g, mid, Math.floor(wake / 2)), 'a loot label in the band: the hub’s, no pick-up').toBeNull();
      expect(tapOn(g, mid, Math.floor(height / 3)), 'under the band it is a label').toEqual({ loot: 7 });
      expect(g.engine.errors).toEqual([]);
      g = await boot();
      expect(g.game.touchPad.wakeArt(), 'on its own page: no band').toBe(0);
      expect(held(g, mid, Math.floor(wake / 2)).some(Boolean), 'on its own page a finger there swings').toBe(true);
      expect(tapOn(g, mid, Math.floor(wake / 2)), 'on its own page a label there is tapped').toEqual({ loot: 7 });
      expect(g.engine.errors).toEqual([]);
    },
    T,
  );
});

describe('the page’s touch controls are made after setup', () => {
  it(
    'so ready() syncs them: shown as they are made, they step aside at once off play (the title; a 52in1 round loading its level, ≡ included)',
    async () => {
      h?.engine.dispose();
      h = await headlessRiftlight({ seed: 3, viewport: { width: 390, height: 844, dpr: 3 }, options: { touch: true } });
      // as Engine.start makes them after setup: shown, until the game says otherwise
      const shown: boolean[] = [];
      const touch = { visible: true, show: (on: boolean) => void shown.push(on), set: () => {}, giveWay: () => {} };
      (h.engine as unknown as { touch: typeof touch }).touch = touch;
      expect(h.game.screen, 'off play').not.toBe('level');
      h.game.ready();
      expect(shown, 'ready() hides them off play').toEqual([false]);
      (h.engine as unknown as { touch: null }).touch = null;
    },
    T,
  );
});
