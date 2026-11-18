// Riftlight's screens at ten feet, headless: L1 / R1 (Q / E) page round the character screens and
// the strip's names are buttons; every framed panel says what the controls do for the device in
// use; the character sheet in pages; the death recap's summary first and its tables behind Details;
// the mouse in the world (a click on a townsperson walks there and talks, no swing); the pad's
// focus framed round a whole item; the HUD's clock and counts in the normal font. One engine for
// the file, tests in order.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Item } from '../core/types';
import { type HeadlessRiftlight, headlessRiftlight, hudTexts, pointAtArt } from '../headless';
import { t } from '../lang';
import { CELL } from '../ui/items/ItemsUi';
import type { CharacterSheet, DeathRecap } from '../ui/panels';
import type { RealHero } from '../wire/hero';
import type { RealLoot } from '../wire/loot';
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
