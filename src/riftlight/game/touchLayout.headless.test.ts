// Riftlight's screens laid out for the device and the screen, headless:
// - the item windows' hints name the device in use, never the screen's width (a landscape phone
//   says "tap", a narrow desktop window "click"), and on a phone the vendor window keeps its size
//   whichever device it names (a tap lands where it was aimed), while a desktop's keeps main's
//   (the mouse's hint alone: touch never changes a mouse's or a pad's layout);
// - the item windows' button legend keeps clear of the HUD (at 960×540 the inventory's would sit
//   over the mana orb, the skill bar and the minimap);
// - a landscape phone draws Riftlight's denser art (two CSS pixels per art pixel at least);
// - the Arena (?game=arena) gets Riftlight's touch buttons, each naming a control it has;
// - a phone in 52in1, held either way, has the whole corner map (a tap target) and the gold below the
//   hub's wake band, over no control and none of the HUD, couch guests and a boss's bar too;
// - a phone's recording (and save-state) made in 52in1 replays with ≡ where 52in1 put it, below the
//   hub's wake band, with no hub behind the replay: the HUD it lays out, and a tap lands on, is the
//   recorded one.
import { afterEach, describe, expect, it } from 'vitest';
import { Lang } from '../../engine';
import { gameById } from '../../games';
import { type HeadlessRiftlight, headlessRiftlight, makeRiftlight } from '../headless';
import { installLanguage, riftlightLines, t } from '../lang';
import { riftlightTranslations } from '../lang/translations';
import type { Box } from '../ui/layout';
import type { RealLoot } from '../wire/loot';
import { CONTROLS, KEYS } from './controls';
import { ARENA_TOUCH_BUTTONS } from '../combat/arena';
import { HUB_WAKE, RIFTLIGHT_TOUCH_BUTTONS, TOUCH_CODES } from './touch';
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
      `${viewport.width}×${viewport.height}: a tap target, the whole of it sits below the hub’s wake band as ≡ does, the gold ${sideways ? 'beside' : 'under'} it, over no control and none of the HUD, with couch guests and a boss's bar too (on its own page at the top, its full size); a tap on it opens the level's map, one in the band nothing`,
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
          const map = h.game.hudRects().zones.find((z) => z.id === 'minimap')!;
          expect(map, 'a corner map in a level').toBeDefined();
          return { map, css: (y: number) => f.offsetY + (y / f.artHeight) * f.cssHeight };
        };
        const alone = await top();
        expect([alone.map.y, alone.map.h], 'on its own page: at the top, its full size').toEqual([2, sideways ? 68 : 38]);
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
