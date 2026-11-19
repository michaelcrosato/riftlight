// Riftlight's screens at ten feet, headless: L1 / R1 (Q / E) page round the character screens and
// the strip's names are buttons; every framed panel says what the controls do for the device in
// use; the character sheet in pages; the death recap's summary first and its tables behind Details;
// the mouse in the world (a click on a townsperson walks there and talks, no swing, after the
// mouse came to rest there too: hit-tested where it was pressed); the pad's focus framed round a
// whole item; the item windows' tooltips off the other window's title bar, one taller than the
// screen scrolled by the right stick or the wheel (desktop sizes: `setViewport`); the HUD's clock
// and counts in the normal font. One engine for
// the file, tests in order. `rl.press` is the engine's input, not the page's: the tree's view
// takes the page's keyboard, so real Q / E through the tree are scripts/e2e-riftlight-items.mjs'.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADLESS_VIEWPORT, type HeadlessView, type Snapshot } from '../../engine';
import type { Item } from '../core/types';
import type { Interactable } from '../town/Town';
import { type HeadlessRiftlight, headlessRiftlight, hudTexts, pointAtArt } from '../headless';
import { t } from '../lang';
import { CELL, FOCUS, HEADER } from '../ui/items/ItemsUi';
import { type Painter, textWidth } from '../ui/items/paint';
import { RARITY_COLOURS } from '../loot/filter';
import { SKILLS } from '../skills/actives';
import { PALETTE } from '../../engine/palette';
import type { CharacterSheet, DeathRecap } from '../ui/panels';
import type { RealHero } from '../wire/hero';
import type { RealLoot } from '../wire/loot';
import { MENU_BINDINGS, SHELL_MENU_BINDINGS } from './controls';
import { bfs } from './nav';
import { UiLayer } from '../ui/layer';
import { WorldShell } from '../../world/shell';
import { HudLayout, overlaps } from '../ui/layout';
import { thingLabel } from '../ui/world';
import { thingBox } from './Riftlight';

const T = 30_000;
let h: HeadlessRiftlight;

/** A pad in the standard layout with `pressed` buttons down (and its sticks at `axes`). */
const pad = (pressed: number[] = [], axes = [0, 0, 0, 0]) => ({ connected: true, mapping: 'standard', index: 0, axes, buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
/** Pad button `b` pressed for a frame and let go. */
const tap = (b: number) => {
  h.engine.input.setGamepads([pad([b])]);
  h.engine.step(1);
  h.engine.input.setGamepads([pad()]);
  h.engine.step(1);
};
const stack = () => h.rl.state().ui;
/** The headless page (its size: `setViewport`). */
const view = () => h.engine.renderer as HeadlessView;
const texts = () => hudTexts(h.engine, 1).map((x) => x.text);
const loot = () => h.game.ports.loot as RealLoot;
/** The item windows last used with the mouse (their cursor is kept while they are shut). */
const mouseLast = () => loot().itemsUi().setViewState({ ...loot().itemsUi().viewState(), cursorMode: 'pointer' });
/** What the item windows draw now (headless nothing is painted): each rect, and each text in the normal font (the mini font is rects). */
const drawn = () => {
  const rects: { x: number; y: number; w: number; h: number; color: number }[] = [];
  const texts: { x: number; y: number; text: string }[] = [];
  const p: Painter = {
    rect: (x, y, w, h, color) => void rects.push({ x, y, w, h, color }),
    text: (x, y, text) => (texts.push({ x, y, text }), textWidth(text)),
  };
  loot().ui!.drawOn(p);
  return { rects, texts };
};

beforeAll(async () => {
  h = await headlessRiftlight({ seed: 616 });
  h.rl.newRun({ seed: 616 });
  h.rl.give({ levels: 3 });
  h.engine.step(2);
}, T);
afterAll(() => h?.engine.dispose());

describe('Riftlight at ten feet', () => {
  it('Q / E and L1 / R1 page round the character screens; under the pause menu it stays; the stash keeps them for its tabs', () => {
    const { rl, engine } = h;
    expect(rl.press('KeyI').ui).toEqual(['inventory']);
    const ring = ['skills', 'tree', 'character', 'codex', 'inventory'];
    for (const page of ring) expect(rl.press('KeyE').ui, `E → ${page}`).toEqual([page]);
    expect(rl.press('KeyQ').ui, 'Q: the one before').toEqual(['codex']);
    engine.input.setGamepads([pad()]);
    engine.step(1);
    tap(5); // R1
    expect(stack(), 'R1').toEqual(['inventory']);
    tap(4); // L1
    expect(stack(), 'L1').toEqual(['codex']);
    tap(9); // Options: over a screen it pauses
    rl.ui.click('character');
    expect(stack()).toEqual(['pause', 'character']);
    tap(5);
    expect(stack(), 'the pause menu stays under the ring').toEqual(['pause', 'codex']);
    tap(9);
    expect(stack()).toEqual([]);
    // the strip's names are buttons
    rl.press('KeyC');
    engine.step(1);
    const strip = (h.game as unknown as { pageStrip: { x: number; y: number; w: number; h: number; page: string }[] }).pageStrip;
    const skills = strip.find((r) => r.page === 'skills')!;
    engine.input.setGamepads(null);
    pointAtArt(engine, skills.x + skills.w / 2, skills.y + skills.h / 2);
    engine.step(1);
    engine.input.setButtons(1);
    engine.step(1);
    engine.input.setButtons(0);
    engine.step(1);
    expect(stack(), 'a click on the strip').toEqual(['skills']);
    rl.press('Escape');
    // the stash: not a page of the ring, so L1 / R1 and Q / E are its tabs
    expect(rl.talkTo('stash').state.ui).toEqual(['stash']);
    const items = loot().ui!;
    expect(items.stashTab).toBe(0);
    rl.press('KeyE');
    expect([stack(), items.stashTab]).toEqual([['stash'], 1]);
    tap(4);
    expect([stack(), items.stashTab]).toEqual([['stash'], 0]);
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  });

  beforeEach(() => {
    h.game.layer.closeAll();
    h.engine.input.setGamepads(null);
    h.engine.input.noteDevice('keyboard');
    h.engine.step(1);
  });

  it('a framed panel says what the controls do on the device in use: none on a touch screen', () => {
    const { rl, engine } = h;
    engine.input.noteDevice('keyboard');
    rl.ui.open('pause');
    engine.step(10); // it opens (the legend shows once it has)
    expect(texts(), 'the pause menu').toEqual(expect.arrayContaining([t('legend.select'), t('legend.back')]));
    rl.ui.close();
    rl.press('KeyC');
    engine.step(10);
    expect(texts(), 'the character sheet: its pages, back, the ring').toEqual(expect.arrayContaining([t('legend.pages'), t('legend.back'), t('legend.screens')]));
    engine.controls.touch = true; // a phone: the engine shows touch controls, so a touch is theirs (headless has none)
    engine.input.noteDevice('touch');
    engine.step(1);
    expect(texts()).not.toContain(t('legend.back'));
    engine.controls.touch = false;
    engine.input.noteDevice('keyboard');
    rl.press('Escape');
  });

  it('the hosts of the UI kit draw legends naming their controls (Engine World’s too: src/world/devices.headless.test.ts), and L1 / R1 are the World’s headings', () => {
    const { game, engine } = h;
    engine.input.noteDevice('pad');
    const drawn = (layer: UiLayer) => {
      const panel = { id: 'reader', title: 'Field guide', size: { w: 80, h: 40 }, draw: () => {} };
      layer.open(panel);
      layer.update(1); // opened
      const text = vi.spyOn(game.ui, 'text');
      try {
        layer.draw(game.ui, 1);
        return text.mock.calls.map((c) => c[2]);
      } finally {
        text.mockRestore();
      }
    };
    expect(drawn(game.layer), 'the shell').toContain(t('legend.select'));
    game.layer.closeAll();
    expect(drawn(new WorldShell().layer), 'Engine World').toContain(t('legend.select'));
    expect(drawn(new UiLayer()), 'a layer no host has turned them on for: none').not.toContain(t('legend.select'));
    expect([MENU_BINDINGS.tabNext, MENU_BINDINGS.tabPrev], 'the World’s reader jumps headings on L1 / R1').toEqual([expect.arrayContaining(['PadRB']), expect.arrayContaining(['PadLB'])]);
    expect(SHELL_MENU_BINDINGS.keys, 'the shell pages its screens with them').toEqual(expect.arrayContaining(['PadLB', 'PadRB', 'KeyQ', 'KeyE']));
    engine.input.noteDevice('keyboard');
  });

  it('the character sheet is pages (Offence, Defence, Resistances): Tab, the arrows, L2 / R2 or a click turn them', () => {
    const { rl, game, engine } = h;
    rl.press('KeyC');
    const sheet = game.layer.top!.panel as CharacterSheet;
    const shown = () => texts();
    expect(sheet.page).toBe(0);
    expect(shown(), 'Offence lists the damage').toContain(t('panel.character.stat.damage'));
    expect(shown(), 'not the resistances').not.toContain(t('panel.character.stat.res_fire'));
    rl.press('Tab');
    expect(sheet.page, 'Tab').toBe(1);
    rl.press('ArrowRight');
    expect(sheet.page, '→').toBe(2);
    expect(shown()).toContain(t('panel.character.stat.res_fire'));
    engine.input.setGamepads([pad()]);
    engine.step(1);
    tap(7); // R2
    expect(sheet.page, 'R2 turns past the last to the first').toBe(0);
    tap(6); // L2
    expect(sheet.page, 'L2').toBe(2);
    expect(stack(), 'R2 is not interact while a panel is open').toEqual(['character']);
    engine.input.setGamepads(null);
    engine.input.noteDevice('keyboard');
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  });

  it('the pad’s focus in the item windows frames the whole item under it, a thick frame read from the couch', () => {
    const { rl, engine } = h;
    loot().add({ uid: 'tv-sword', base: 'arming-sword', rarity: 'normal', level: 1, name: 'Arming Sword', affixes: [] } as unknown as Item);
    mouseLast();
    rl.press('KeyI');
    const ui = loot().ui!;
    rl.press('Enter'); // the keys and the pad take over the cursor
    expect(ui.cursorMode).toBe('pad');
    ui.cursor = { ...ui.itemCenter('tv-sword')! };
    const r = ui.focusRect()!;
    expect(r.h, 'a sword is taller than a cell: the frame takes all of it').toBeGreaterThan(CELL);
    expect(r.w).toBe(CELL - 1);
    // its shape sets it apart, not its colour: a double frame (white, ink, white) where an item's is
    // one pixel, a rare's sand as every rare's around it, some skill gems' white (Cleave's)
    const framed = (own: number, what: string) => {
      const f = ui.focusRect()!;
      const { rects } = drawn();
      /** The colour of the last left edge drawn `d` pixels outside the focused box. */
      const edge = (d: number) => rects.filter((q) => q.x === f.x - d && q.y === f.y - d && q.w === 1 && q.h === f.h + 2 * d).at(-1)?.color;
      expect(edge(0), `${what}: its own frame`).toBe(own);
      expect([edge(1), edge(2), edge(3)], `${what}: white, ink, white`).toEqual([FOCUS, PALETTE.ink, FOCUS]);
      // every double frame drawn (a 1-px white left edge with an ink one a pixel inside it): the focus's alone
      const doubles = rects.filter((a) => a.w === 1 && a.color === FOCUS && rects.some((b) => b.w === 1 && b.color === PALETTE.ink && b.x === a.x + 1 && b.y === a.y + 1 && b.h === a.h - 2));
      expect(
        doubles.map((a) => [a.x, a.y]),
        `${what}: no item’s frame is double`,
      ).toEqual([[f.x - 3, f.y - 3]]);
    };
    const rare = loot().give(h.game.services.rng, 10, 'rare')!;
    expect(rare, 'a rare in the bag').not.toBeNull();
    for (let k = 0; k < 4; k++) expect(loot().give(h.game.services.rng, 10, 'rare'), 'more rares round it').not.toBeNull();
    ui.cursor = { ...ui.itemCenter(rare.uid)! };
    framed(RARITY_COLOURS.rare, 'a rare in a bag of rares');
    rl.press('Tab'); // the skill panel beside the bag, the focus on its selected skill's gem
    expect(ui.left).toBe('skills');
    const white = loot().store.skills.findIndex((s) => s.gem && SKILLS.has(s.gem.gem!.id) && SKILLS.get(s.gem.gem!.id).look.color === 'white');
    expect(white, 'a skill gem framed white (Cleave’s)').toBeGreaterThanOrEqual(0);
    ui.cursor = { ...ui.socketCenter(white, -1) };
    framed(FOCUS, 'a skill gem framed white');
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  });

  it('at ten feet the skill panel’s rows are in the normal font, names and costs whole (the window wider for them)', () => {
    const { rl, engine } = h;
    mouseLast();
    expect(rl.ui.open('skills')).toBe(true);
    engine.step(2);
    const ui = loot().ui!;
    expect(ui.tenFoot(), 'a desktop’s screen, no touch controls').toBe(true);
    const win = ui.leftRect();
    const { texts } = drawn();
    const rows = ui.numbers();
    expect(rows.filter(Boolean).length, 'the starter gems').toBe(4);
    for (const n of rows) {
      if (!n) continue;
      const name = texts.find((x) => x.text === n.name);
      expect(name, `${n.name}: in the normal font, whole`).toBeDefined();
      expect(name!.x + textWidth(n.name), `${n.name}: inside the window`).toBeLessThanOrEqual(win.x + win.w - 3);
      const costs = texts.filter((x) => x.y === name!.y + 9 && x.x === name!.x).map((x) => x.text);
      expect(costs, `${n.name}: its cost under it in the normal font`).toEqual([expect.stringMatching(/ MP/)]);
      expect(costs[0]!.endsWith('.'), `${costs[0]}: whole, not clipped`).toBe(false);
    }
    // the pad's focus round a skill's gem keeps clear of the slot's number (the sockets further in)
    ui.cursorMode = 'pad';
    for (let s = 0; s < 4; s++) {
      ui.cursor = { ...ui.socketCenter(s, -1) };
      const f = ui.focusRect()!;
      const key = drawn().texts.find((x) => x.text === String(s + 1) && x.x < f.x && x.y >= f.y - 3 && x.y < f.y + f.h);
      expect(key, `slot ${s + 1}: its number`).toBeDefined();
      expect(f.x - 3, `slot ${s + 1}: the focus right of its number`).toBeGreaterThanOrEqual(key!.x + textWidth(key!.text));
    }
    rl.ui.close();
    engine.step(1);
    expect(engine.errors).toEqual([]);
  });

  it('the item windows a pad opens (Create, R2 at Ilsa’s) open with the pad’s focus and its hints, as do open ones once the pad is picked up', () => {
    const { rl, game, engine } = h;
    const ui = loot().itemsUi();
    mouseLast();
    engine.input.setGamepads([pad()]);
    engine.step(1);
    tap(8); // Create: the inventory, with the pad in use
    expect(stack()).toEqual(['inventory']);
    expect([ui.cursorMode, ui.hintMode()], 'the pad’s focus at once, and its hints').toEqual(['pad', 'pad']);
    expect(ui.focusRect(), 'framed on the first cell').not.toBeNull();
    const first = { ...ui.cursor };
    tap(15); // the d-pad: the first press moves the focus, none is spent placing it
    expect(ui.cursor.x, 'one cell right').toBe(first.x + CELL);
    tap(1);
    expect(stack()).toEqual([]);
    mouseLast();
    const ilsa = game.town.interactables.find((x) => x.id === 'ilsa')!;
    game.hero.enter(game.town, ilsa.position.clone(), 0);
    engine.step(2);
    tap(7); // R2: talk to her
    expect(stack()).toEqual(['vendor']);
    expect([ui.cursorMode, ui.hintMode()], 'the vendor: the pad’s focus and hints (Triangle: buy / sell)').toEqual(['pad', 'pad']);
    tap(1);
    // the keyboard opens them as the mouse's; the pad picked up while they are open takes the focus
    mouseLast();
    engine.input.noteDevice('keyboard');
    expect(rl.press('KeyI').ui).toEqual(['inventory']);
    expect([ui.cursorMode, ui.hintMode()], 'the keyboard and mouse').toEqual(['pointer', 'mouse']);
    engine.input.noteDevice('pad');
    engine.step(1);
    expect([ui.cursorMode, ui.hintMode()], 'the pad picked up').toEqual(['pad', 'pad']);
    tap(1);
    expect(stack()).toEqual([]);
    engine.input.setGamepads(null);
    engine.input.noteDevice('keyboard');
    expect(engine.errors).toEqual([]);
  });

  it('the item windows say what the controls do too, clear of the windows: the stash and the vendor name the controls that switch their tabs', () => {
    const { rl, engine } = h;
    engine.input.setGamepads([pad()]);
    engine.step(1);
    tap(8); // Create: the inventory, with the pad in use
    expect(stack()).toEqual(['inventory']);
    const boxes = () => hudTexts(engine, 2);
    const at = (label: string) => boxes().find((b) => b.text === label);
    const windows = () => loot().ui!.rects();
    const clear = (label: string) => {
      const b = at(label)!;
      return windows().every((r) => b.x + b.w <= r.x || r.x + r.w <= b.x || b.y + b.h <= r.y || r.y + r.h <= b.y);
    };
    expect(at(t('legend.select')), 'the inventory: select').toBeDefined();
    expect(at(t('legend.screens')), 'and the screens’ ring').toBeDefined();
    expect(clear(t('legend.select')), 'not under a window').toBe(true);
    expect(at(t('legend.tabs'))).toBeUndefined();
    rl.press('Escape');
    rl.talkTo('stash');
    engine.input.setGamepads([pad()]);
    tap(12); // the d-pad: the pad is the device again
    expect(stack()).toEqual(['stash']);
    expect(at(t('legend.tabs')), 'the stash: its tabs').toBeDefined();
    expect(clear(t('legend.tabs'))).toBe(true);
    expect(at(t('legend.screens')), 'no ring: L1 / R1 are its tabs').toBeUndefined();
    tap(1);
    expect(stack()).toEqual([]);
    engine.input.setGamepads(null);
    engine.input.noteDevice('keyboard');
    expect(engine.errors).toEqual([]);
  });

  it('a window that gains focus takes the pad’s: R1 from a bag item to Skills puts it in the skill panel and the item’s tooltip goes; L1, Tab and the stash do the same', () => {
    const { rl, engine } = h;
    const ui = loot().itemsUi();
    /** The pad's focus is inside window `r`. */
    const focusIn = (r: { x: number; y: number; w: number; h: number }) => {
      const f = ui.focusRect();
      return !!f && f.x >= r.x && f.y >= r.y && f.x + f.w <= r.x + r.w && f.y + f.h <= r.y + r.h;
    };
    mouseLast();
    engine.input.setGamepads([pad()]);
    engine.step(1);
    tap(8); // Create: the inventory, with the pad in use
    expect(stack()).toEqual(['inventory']);
    ui.cursor = { ...ui.itemCenter('tv-sword')! }; // the focus on a bag item: its tooltip shows
    engine.step(1);
    const sword = ui.tipText();
    expect(sword?.[0], 'the sword’s tooltip').toBe('Arming Sword');
    tap(5); // R1: the next screen, Skills
    expect(stack()).toEqual(['skills']);
    expect(focusIn(ui.leftRect()), 'the focus in the skill panel').toBe(true);
    expect(ui.cursor, 'on the selected skill’s gem').toEqual(ui.socketCenter(ui.skillSlot, -1));
    expect(ui.tipText()?.[0], 'its gem’s tooltip, not the bag item’s over the skills').not.toBe(sword![0]);
    tap(4); // L1: back to the inventory
    expect(stack()).toEqual(['inventory']);
    expect(focusIn(ui.rightRect()), 'the focus back in the bag').toBe(true);
    // the keys drive the same focus: Tab shows the skill panel beside the bag (the focus goes in), Tab again hides it
    engine.input.setGamepads(null);
    engine.input.noteDevice('keyboard');
    rl.press('Tab');
    expect(ui.left).toBe('skills');
    expect(focusIn(ui.leftRect()), 'Tab: the focus in the skill panel').toBe(true);
    rl.press('Tab');
    expect(ui.left).toBeNull();
    expect(focusIn(ui.rightRect()), 'Tab again: back in the bag').toBe(true);
    rl.press('Escape');
    expect(stack()).toEqual([]);
    // the stash opens with the focus in it, not on the bag item it was last on
    ui.cursor = { ...ui.itemCenter('tv-sword')! };
    rl.talkTo('stash');
    expect(stack()).toEqual(['stash']);
    expect(focusIn(ui.leftRect()), 'the stash window has the focus').toBe(true);
    rl.press('Escape');
    expect(stack()).toEqual([]);
    expect(engine.errors).toEqual([]);
  });

  it('R1 to Skills on a desktop: the focused gem’s tooltip, beside the wide skill panel and over the bag, keeps off the bag’s title bar (its name, the Gems button)', () => {
    const { engine } = h;
    const ui = loot().itemsUi();
    try {
      for (const viewport of [
        { width: 1280, height: 720, dpr: 1 },
        { width: 1920, height: 1080, dpr: 1 },
      ]) {
        const where = `${viewport.width}×${viewport.height}`;
        view().setViewport(viewport);
        mouseLast();
        engine.input.setGamepads([pad()]);
        engine.step(1);
        tap(8); // Create: the inventory, with the pad in use
        tap(5); // R1: Skills, the focus on the selected skill's gem
        expect(stack()).toEqual(['skills']);
        const tip = ui.cursorTip();
        expect(tip?.lines[0], `${where}: the gem’s tooltip`).toBe(ui.tipText()?.[0]);
        const bag = ui.rightRect();
        const bar = { ...bag, h: HEADER };
        expect(overlaps(tip!.rect, bag, 0), `${where}: it reaches over the bag`).toBe(true);
        expect(overlaps(tip!.rect, bar, 0), `${where}: clear of the bag’s title bar`).toBe(false);
        expect(tip!.max, `${where}: whole`).toBe(0);
        tap(1);
        expect(stack()).toEqual([]);
      }
    } finally {
      view().setViewport(HEADLESS_VIEWPORT);
      engine.input.setGamepads(null);
      engine.input.noteDevice('keyboard');
      engine.step(1);
    }
    expect(engine.errors).toEqual([]);
  });

  it('a tooltip taller than a desktop’s screen (a vendor’s rare at 1280×720) shows what fits and scrolls: by the right stick on the pad, the wheel with the mouse', () => {
    const { game, engine } = h;
    const ui = loot().itemsUi();
    try {
      view().setViewport({ width: 1280, height: 720, dpr: 1 });
      mouseLast();
      engine.input.setGamepads([pad()]);
      engine.step(1);
      const ilsa = game.town.interactables.find((x) => x.id === 'ilsa')!;
      game.hero.enter(game.town, ilsa.position.clone(), 0);
      engine.step(2);
      tap(7); // R2: Ilsa's wares, with the pad's focus
      expect(stack()).toEqual(['vendor']);
      expect(ui.cursorMode).toBe('pad');
      // her wares' tallest tooltip (a rare's: its stats, the price, the comparison with the gear, the hint)
      const over = (i: Item) => {
        ui.cursor = { ...ui.itemCenter(i.uid)! };
        return ui.cursorTip()?.max ?? 0;
      };
      const tall = loot().store.vendor.stock.reduce((a, b) => (over(b) > over(a) ? b : a));
      ui.cursor = { ...ui.itemCenter(tall.uid)! };
      engine.step(1);
      const all = ui.tipText()!;
      const before = ui.cursorTip()!;
      expect(before.max, 'taller than the screen').toBeGreaterThan(0);
      expect(before.rect.y + before.rect.h, 'what fits, above the screen’s bottom').toBeLessThanOrEqual(engine.renderer.resolution.height - 2);
      expect([before.scroll, before.lines[0]], 'from its top: its name').toEqual([0, all[0]]);
      expect(before.lines, 'its last line (the hint) cut off').not.toContain(all.at(-1));
      // the right stick down: its last lines come up; up: back to its top
      const stick = (y: number, frames: number) => {
        engine.input.setGamepads([pad([], [0, 0, 0, y])]);
        engine.step(frames);
        engine.input.setGamepads([pad()]);
        engine.step(1);
      };
      expect(before.max, 'more than two lines over').toBeGreaterThan(18);
      stick(1, 6);
      const part = ui.cursorTip()!.scroll;
      expect(part, 'a moment’s tilt: some of the way').toBeGreaterThan(0);
      expect(part).toBeLessThan(before.max);
      stick(1, 120);
      const end = ui.cursorTip()!;
      expect([end.scroll, end.lines.at(-1)], 'the stick: to its end, the hint in view').toEqual([before.max, all.at(-1)]);
      expect(ui.cursorMode, 'still the pad’s focus').toBe('pad');
      expect(stack()).toEqual(['vendor']);
      stick(-1, 120);
      expect(ui.cursorTip()!.scroll, 'up: its top').toBe(0);
      // the focus leaves it and comes back: it shows from its top again
      stick(1, 120);
      ui.cursor = { ...ui.cellCenter('inventory', 0, 0) };
      engine.step(1);
      ui.cursor = { ...ui.itemCenter(tall.uid)! };
      engine.step(1);
      expect(ui.cursorTip()!.scroll, 'left and back: from its top').toBe(0);
      // the mouse over it: the wheel scrolls its tooltip (beside the window), and nothing else
      engine.input.setGamepads(null);
      engine.input.noteDevice('keyboard');
      const at = ui.itemCenter(tall.uid)!;
      pointAtArt(engine, at.x, at.y);
      engine.step(2);
      expect(ui.cursorMode).toBe('pointer');
      const zoom = (game as unknown as { settings: { zoom: number } }).settings.zoom;
      const wheel = (ticks: number) => {
        engine.input.addPointer(0, 0, ticks);
        engine.step(1);
      };
      const hover = ui.cursorTip()!;
      const words = ui.tipText()!; // its hints the mouse's
      expect([hover.scroll, hover.lines[0]], 'the mouse’s tooltip from its top').toEqual([0, words[0]]);
      expect(hover.max).toBeGreaterThan(0);
      wheel(1);
      expect(ui.cursorTip()!.scroll, 'a tick: two lines').toBe(18);
      for (let k = 0; k < 20; k++) wheel(1);
      const down = ui.cursorTip()!;
      expect([down.scroll, down.lines.at(-1)], 'the wheel: to its end, the hint in view').toEqual([hover.max, words.at(-1)]);
      for (let k = 0; k < 20; k++) wheel(-1);
      expect(ui.cursorTip()!.scroll, 'back up: its top').toBe(0);
      expect((game as unknown as { settings: { zoom: number } }).settings.zoom, 'the camera never zoomed').toBe(zoom);
      expect(stack()).toEqual(['vendor']);
      h.rl.press('Escape');
      expect(stack()).toEqual([]);
    } finally {
      view().setViewport(HEADLESS_VIEWPORT);
      engine.input.setGamepads(null);
      engine.input.noteDevice('keyboard');
      engine.step(1);
    }
    expect(engine.errors).toEqual([]);
  });

  it('the mouse in town: a townsperson under it says what a click does; a click walks there and talks, with no swing', () => {
    const { rl, game, engine } = h;
    engine.input.noteDevice('keyboard');
    const brann = game.town.interactables.find((x) => x.id === 'brann')!;
    game.hero.enter(game.town, game.town.spawn, 0);
    engine.step(30);
    expect(brann.position.distanceTo(game.hero.actor.position), 'out of reach').toBeGreaterThan(brann.radius + 1);
    const box = thingBox(brann, engine.camera.camera, game.ui)!;
    pointAtArt(engine, box.x + box.w / 2, box.y + box.h / 2);
    engine.step(2);
    expect(game.worldFocus).toEqual({ kind: 'it', id: 'brann' });
    expect(texts(), 'its prompt').toContain(brann.prompt);
    const hc = (game.hero as RealHero).hc;
    const states = new Set<string>();
    engine.input.setButtons(1);
    engine.step(1);
    engine.input.setButtons(0);
    expect(game.walkTo?.target).toEqual({ kind: 'it', id: 'brann' });
    for (let i = 0; i < 360 && !stack().includes('crafting'); i++) {
      engine.step(1);
      states.add(hc.state);
    }
    expect(stack(), 'walked there and talked').toContain('crafting');
    expect(states.has('attack'), 'no swing').toBe(false);
    expect(game.walkTo).toBeNull();
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  });

  it('a click where the mouse came to rest on a thing (its label gone four seconds on) still walks there and does it, with no swing', () => {
    const { rl, game, engine } = h;
    engine.input.noteDevice('keyboard');
    const stash = game.town.interactables.find((x) => x.id === 'stash')!;
    game.hero.enter(game.town, game.town.spawn, 0);
    engine.step(30);
    expect(stash.position.distanceTo(game.hero.actor.position), 'out of reach').toBeGreaterThan(stash.radius + 1);
    const box = thingBox(stash, engine.camera.camera, game.ui)!;
    pointAtArt(engine, box.x + box.w / 2, box.y + box.h / 2);
    engine.step(2);
    expect(game.worldFocus, 'hovered: its label').toEqual({ kind: 'it', id: 'stash' });
    engine.step(5 * 60); // the mouse at rest: the label goes (a keyboard or pad player's screen)
    expect(game.worldFocus, 'no label after a rest').toBeNull();
    expect(texts()).not.toContain(stash.prompt);
    const hc = (game.hero as RealHero).hc;
    const states = new Set<string>();
    // the camera eased back as the mouse's aim let go: the click lands where the stash shows now,
    // pressed in the frame the mouse got there (no hover drawn there yet)
    const now = thingBox(stash, engine.camera.camera, game.ui)!;
    pointAtArt(engine, now.x + now.w / 2, now.y + now.h / 2, true);
    engine.step(1);
    engine.input.setButtons(0);
    expect(game.walkTo?.target, 'the click went where it was pressed').toEqual({ kind: 'it', id: 'stash' });
    for (let i = 0; i < 360 && !stack().includes('stash'); i++) {
      engine.step(1);
      states.add(hc.state);
    }
    expect(stack(), 'walked there and opened it').toContain('stash');
    expect(states.has('attack'), 'no swing').toBe(false);
    rl.press('Escape');
    expect(engine.errors).toEqual([]);
  });

  it('a thing near the top of the screen gets its label under it, never over the HUD’s place name', () => {
    const { game, engine } = h;
    const ui = game.ui;
    const layout = new HudLayout();
    layout.clear(ui.w, ui.h);
    const where = { x: 4, y: 3, w: 120, h: 30 }; // the place name, the clock and the count (top left)
    layout.reserve(where);
    const head = { x: 40, y: 6, w: 16, h: 40 }; // a townsperson at the top of the screen
    const r = thingLabel(ui, head, 'Talk to Brann', 'attack', layout);
    expect(overlaps(r, where, 0), `not over the place name: ${JSON.stringify(r)}`).toBe(false);
    expect(r.y, 'under the head').toBeGreaterThanOrEqual(head.y + head.h);
    expect(r.y + r.h).toBeLessThanOrEqual(ui.h);
    // the rows under it taken for a while (labels, a banner): the first free row further down
    layout.taken.splice(1);
    const busy = { x: 0, y: head.y + head.h, w: ui.w, h: 120 };
    layout.reserve(busy);
    const r2 = thingLabel(ui, head, 'Talk to Brann', 'attack', layout);
    expect(overlaps(r2, where, 0) || overlaps(r2, busy, 0), `clear of the HUD: ${JSON.stringify(r2)}`).toBe(false);
    expect(r2.y + r2.h).toBeLessThanOrEqual(ui.h);
    engine.step(1);
  });

  it(
    'a click on a thing far away walks the way round (the town’s walkable grid) and does it once the F rule picks it: every thing in town, from the spawn and two districts',
    () => {
      const { game, engine } = h;
      const town = game.town;
      const done: { id: string; nearest: string | null; d: number }[] = [];
      // what a click on it does, without doing it (a panel, a showcase piece, Engine World's page)
      const spy = vi.spyOn(game as unknown as { interactWith: (it: Interactable) => boolean }, 'interactWith').mockImplementation((it) => {
        const p = game.hero.actor.position;
        done.push({ id: it.id, nearest: town.nearest(p)?.id ?? null, d: Math.hypot(it.position.x - p.x, it.position.z - p.z) });
        return true;
      });
      const missed: string[] = [];
      try {
        for (const [from, at] of [['spawn', town.spawn], ['tavern', town.districts.tavern], ['bridge', town.districts.bridge]] as const) {
          for (const it of town.interactables) {
            game.hero.enter(town, at, 0);
            engine.step(2);
            const before = done.length;
            game.goTo({ kind: 'it', id: it.id });
            for (let f = 0; f < 60 * 20 && game.walkTo; f++) engine.step(1);
            const got = done.slice(before);
            if (got.length !== 1 || got[0]!.id !== it.id) missed.push(`${it.id} from ${from}: ${got.length ? got.map((x) => x.id).join() : 'nothing'}`);
            else if (got[0]!.nearest !== it.id && got[0]!.d >= it.radius) missed.push(`${it.id} from ${from}: out of reach (${got[0]!.d.toFixed(1)} m)`);
          }
        }
      } finally {
        spy.mockRestore();
      }
      expect(town.interactables.map((x) => x.id), 'the pieces the verifier walked to').toEqual(expect.arrayContaining(['world', 'gallery', 'ilsa', 'oru', 'stash', 'bestiary', 'arcade']));
      expect(missed, 'every walk arrived and did its thing').toEqual([]);
      expect(game.walkTo).toBeNull();
      game.hero.enter(town, town.spawn, 0);
      engine.step(2);
      expect(engine.errors).toEqual([]);
    },
    120_000,
  );

  it(
    'a walk in progress is in a snapshot: restored, it goes on the same way',
    async () => {
      const { rl, game, engine } = h;
      const town = game.town;
      game.hero.enter(town, town.districts.tavern, 0);
      engine.step(2);
      game.goTo({ kind: 'it', id: 'stash' });
      engine.step(45);
      expect(game.walkTo, 'on the way').not.toBeNull();
      const snap = JSON.parse(JSON.stringify(await engine.snapshot())) as Snapshot; // as JSON, as kept on disk
      engine.step(30);
      const ahead = { print: engine.fingerprint(), at: game.hero.actor.position.toArray().join() };
      await engine.restore(snap);
      expect(game.walkTo?.target).toEqual({ kind: 'it', id: 'stash' });
      engine.step(30);
      expect({ print: engine.fingerprint(), at: game.hero.actor.position.toArray().join() }, 'the same steps').toEqual(ahead);
      game.walkTo = null;
      rl.ui.close();
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'in a level a click on loot walks the bot’s grid route there and picks it up',
    async () => {
      const { rl, game, engine } = h;
      await rl.enterDepth(1);
      engine.step(3);
      game.dev.ai = false;
      game.dev.god = true;
      const level = game.level!;
      // two open cells 6-8 m apart with a wall between, the way round it the longest of any such
      // (a straight walk stops at the wall): the drop at one, the hero at the other
      const L = level.layout;
      const o = level.origin;
      const centre = (x: number, z: number) => new Vector3(x + 0.5 + o.x, 0, z + 0.5 + o.z);
      const walled = (a: Vector3, b: Vector3) => {
        const n = Math.ceil(a.distanceTo(b) * 4);
        for (let k = 1; k < n; k++) if (L.cell(Math.floor(a.x + ((b.x - a.x) * k) / n - o.x), Math.floor(a.z + ((b.z - a.z) * k) / n - o.z)) !== 1) return true;
        return false;
      };
      let pair: [Vector3, Vector3] | null = null;
      let bestRatio = 0;
      for (let z = 0; z < L.height; z += 2)
        for (let x = 0; x < L.width; x += 2) {
          if (L.cell(x, z) !== 1) continue;
          for (const [dx, dz] of [[6, 0], [0, 6], [-6, 0], [0, -6], [8, 0], [0, 8], [-8, 0], [0, -8], [5, 5], [5, -5], [-5, 5], [-5, -5]] as const) {
            if (L.cell(x + dx, z + dz) !== 1) continue;
            const a = centre(x, z);
            const b = centre(x + dx, z + dz);
            if (!walled(a, b)) continue;
            const way = bfs(L, { x: x + dx, z: z + dz }, { x, z }).length;
            const ratio = way / a.distanceTo(b);
            if (way > 0 && ratio > bestRatio) {
              bestRatio = ratio;
              pair = [a, b];
            }
          }
        }
      expect(bestRatio, 'two spots with a wall between, the way round it twice as long or more').toBeGreaterThan(2);
      const [at, from] = pair!;
      game.hero.enter(level, at, 0);
      engine.step(2);
      const [drop] = loot().spawn([{ kind: 'item', item: { uid: 'walk-belt', base: 'leather-belt', rarity: 'rare', level: 1, name: 'Belt', affixes: [] } as unknown as Item }], at.clone(), level, game.services.rng);
      engine.step(60);
      game.hero.enter(level, from, 0);
      engine.step(2);
      expect(loot().ground().some((l) => l.id === drop!.id), 'on the ground').toBe(true);
      expect(game.hero.actor.position.distanceTo(drop!.position), 'out of reach').toBeGreaterThan(3);
      game.goTo({ kind: 'loot', id: drop!.id });
      expect(game.walkTo, 'on the way').not.toBeNull();
      for (let f = 0; f < 60 * 15 && game.walkTo; f++) engine.step(1);
      expect(loot().ground().some((l) => l.id === drop!.id), 'picked up').toBe(false);
      expect(loot().owned().some((i) => i.uid === 'walk-belt')).toBe(true);
      game.dev.ai = true;
      game.dev.god = false;
      expect(engine.errors).toEqual([]);
    },
    T,
  );

  it(
    'the death recap opens with what matters; △ or Tab shows the tables (and the summary again)',
    async () => {
      const { rl, game, engine } = h;
      await rl.enterDepth(1);
      engine.step(10);
      expect(texts().some((s) => /^\d+:\d\d$/.test(s)), 'the clock in the normal font').toBe(true);
      expect(texts().some((s) => s.includes(t('hud.slain', { killed: 0, total: 1 }).split(' ').at(-1)!)), 'the kills too').toBe(true);
      const foe = game.level!.monsters()[0]!.actor;
      for (let k = 0; k < 20 && !game.dead; k++) {
        (game.hero.actor as unknown as { iframes: number }).iframes = 0;
        game.hero.actor.takeHit({ source: foe, tags: ['test'], damage: { physical: 1e6 }, crit: false });
        engine.step(2);
      }
      engine.step(120);
      expect(stack()).toEqual(['death']);
      const recap = game.layer.top!.panel as DeathRecap;
      expect(recap.details).toBe(false);
      expect(texts(), 'the summary: no tables').not.toContain(t('panel.death.worst_enemies'));
      expect(texts(), 'what △ does').toContain(t('legend.details'));
      rl.press('Tab');
      expect(texts(), 'Tab: the tables').toContain(t('panel.death.worst_enemies'));
      engine.input.setGamepads([pad()]);
      engine.step(1);
      tap(3); // Triangle
      expect(recap.details, '△: the summary again').toBe(false);
      tap(0); // Cross: back to town
      expect(rl.state().screen).toBe('town');
      engine.input.setGamepads(null);
      expect(engine.errors).toEqual([]);
    },
    T,
  );
});
