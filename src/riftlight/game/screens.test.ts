// Riftlight's screens at ten feet, headless: L1 / R1 (Q / E) page round the character screens and
// the strip's names are buttons; every framed panel says what the controls do for the device in
// use; the character sheet in pages; the death recap's summary first and its tables behind Details;
// the mouse in the world (a click on a townsperson walks there and talks, no swing); the pad's
// focus framed round a whole item; the HUD's clock and counts in the normal font. One engine for
// the file, tests in order. `rl.press` is the engine's input, not the page's: the tree's view
// takes the page's keyboard, so real Q / E through the tree are scripts/e2e-riftlight-items.mjs'.
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Snapshot } from '../../engine';
import type { Item } from '../core/types';
import type { Interactable } from '../town/Town';
import { type HeadlessRiftlight, headlessRiftlight, hudTexts, pointAtArt } from '../headless';
import { t } from '../lang';
import { CELL } from '../ui/items/ItemsUi';
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

/** A pad in the standard layout with `pressed` buttons down. */
const pad = (pressed: number[] = []) => ({ connected: true, mapping: 'standard', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });
/** Pad button `b` pressed for a frame and let go. */
const tap = (b: number) => {
  h.engine.input.setGamepads([pad([b])]);
  h.engine.step(1);
  h.engine.input.setGamepads([pad()]);
  h.engine.step(1);
};
const stack = () => h.rl.state().ui;
const texts = () => hudTexts(h.engine, 1).map((x) => x.text);
const loot = () => h.game.ports.loot as RealLoot;
/** The item windows last used with the mouse (their cursor is kept while they are shut). */
const mouseLast = () => loot().itemsUi().setViewState({ ...loot().itemsUi().viewState(), cursorMode: 'pointer' });

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
    rl.press('Escape');
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
