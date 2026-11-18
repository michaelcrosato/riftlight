import { describe, expect, it } from 'vitest';
import { pauseMenu } from '../../world/ui/panels';
import { Lang, RESOLUTIONS, textWidthPx, type PlayerSettings } from '../../engine';
import { languageName } from '../../engine';
import { installLanguage, riftlightLines } from '../lang';
import { riftlightTranslations } from '../lang/translations';
import { UiCanvas } from './kit';
import { coopMenu, engineMenu, languageMenu, pauseMenu as riftPauseMenu, settingsMenu } from './menus';
import { titleMenu } from './menus';

const host = (more: object = {}) => ({ saves: { last: null, slots: [], volatile: false, lastError: '' }, sound: () => {}, ...more }) as never;

describe('links between Riftlight and Engine World', () => {
  it('the title offers Engine World when the host can open it, and opens it', () => {
    let opened = 0;
    const menu = titleMenu(host({ engineWorld: () => opened++ }));
    expect(menu.items().map((w) => w.id)).toContain('world');
    menu.activate('world');
    expect(opened).toBe(1);
    expect(titleMenu(host()).items().map((w) => w.id)).not.toContain('world'); // a host without it
  });

  it('the title opens the Asset Gallery room of Engine World', () => {
    const rooms: (string | undefined)[] = [];
    const menu = titleMenu(host({ engineWorld: (room?: string) => rooms.push(room) }));
    menu.activate('gallery');
    menu.activate('world');
    expect(rooms).toEqual(['gallery', undefined]);
    expect(titleMenu(host()).items().map((w) => w.id)).not.toContain('gallery');
  });

  it('with the language in the address (the AI Hub), Engine World and the Asset Gallery stay; the Language menu is the hub\'s', () => {
    const language = { available: ['en', 'fr'], current: 'en', asked: true, choose: () => {} };
    const ids = titleMenu(host({ engineWorld: () => {}, language })).items().map((w) => w.id);
    expect(ids).toContain('world');
    expect(ids).toContain('gallery');
    expect(ids).not.toContain('language');
  });

  it('Engine World\'s pause menu leaves for Riftlight', () => {
    let left = 0;
    const none = () => {};
    const menu = pauseMenu(false, { resume: none, guide: none, tweak: none, rooms: none, glossary: none, atrium: none, reset: none, riftlight: () => left++ });
    expect(menu.activate('riftlight')).toBe(true);
    expect(left).toBe(1);
  });
});

describe('the Language menu', () => {
  it('shows on the title only when the address names no language; lists each language in itself; choosing one chooses it', () => {
    const chosen: string[] = [];
    const language = { available: ['en', 'es-419', 'zh-Hant'], current: 'en', asked: false, choose: (c: string) => chosen.push(c) };
    let opened: { items(): readonly { id: string; label?: string }[]; activate(id: string): boolean } | null = null;
    const title = titleMenu(host({ language, openMenu: (m: never) => (opened = m) }));
    expect(title.items().map((w) => w.id)).toContain('language');
    expect(titleMenu(host()).items().map((w) => w.id)).not.toContain('language'); // a host without languages
    const english = { ...language, available: ['en'] }; // a development build: no translations, nothing to choose
    expect(titleMenu(host({ language: english })).items().map((w) => w.id)).not.toContain('language');
    title.activate('language');
    const menu = opened as unknown as ReturnType<typeof languageMenu>;
    expect(menu.items().map((w) => (w as { label: string }).label)).toEqual(['English', languageName('es-419'), '繁體中文']);
    menu.activate('lang.es-419');
    expect(chosen).toEqual(['es-419']);
  });
});

describe("the settings' engine page", () => {
  // a stand-in engine: its settings record what the menu asks for, and what the rows show follows them
  const engineHost = () => {
    const chosen: PlayerSettings = {};
    const audio = { muted: false, setMuted: (m: boolean) => (audio.muted = m), volume: { master: 1, music: 1, sfx: 1 }, setVolume: () => {} };
    const rumbles: unknown[] = [];
    /** 52in1's DualSense: whether games may read its motion (the motion aim rows show then). */
    const dualsense = { motion: false };
    const engine = {
      settings: { values: chosen, set: (p: PlayerSettings) => Object.assign(chosen, p) },
      input: { rumble: (r: unknown) => rumbles.push(r) },
      hubSettings: { values: { dualsense } },
      get motionOn() { return dualsense.motion && chosen.motion !== false; },
      renderer: { get mode() { return chosen.pixelArt === false ? 'raw' : 'pixel'; }, get baseResolution() { return chosen.pixelSize === 'chunky' ? RESOLUTIONS.compare : RESOLUTIONS.default; } },
      get maxFps() { return chosen.fps ?? 60; },
      get debugShown() { return chosen.debugInfo ?? false; },
    };
    return { chosen, audio, rumbles, dualsense, h: host({ engine, audio, settings: { look: '', quality: 'auto', zoom: 1, screenShake: 0.7, damageNumbers: true, lootFilter: 0 } }) };
  };
  type Row = { id: string; kind: string; get?: () => unknown; set?: (v: never) => void };
  const row = (menu: { items(): readonly unknown[] }, id: string) => menu.items().find((w) => (w as Row).id === id) as Row;

  it("the settings page holds the controller's: button prompts (PlayStation or Xbox) and vibration, the engine's own settings", () => {
    const { chosen, rumbles, h } = engineHost();
    const menu = settingsMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
    const ids = menu.items().map((w) => (w as Row).id);
    expect(ids).toContain('padGlyphs');
    expect(ids).toContain('vibration');
    expect(ids).not.toContain('glyphs'); // prompts follow the device used last by themselves
    expect(row(menu, 'padGlyphs').get!()).toBe(0); // PlayStation unless chosen
    row(menu, 'padGlyphs').set!(1 as never);
    expect([chosen.padGlyphs, row(menu, 'padGlyphs').get!()]).toEqual(['xbox', 1]);
    expect(row(menu, 'vibration').get!()).toBe(1);
    row(menu, 'vibration').set!(0.42 as never);
    expect([chosen.vibration, rumbles.length]).toEqual([0.4, 1]); // in steps of 0.05, and a pulse to feel it
  });

  it('motion aim and its sensitivity are there while 52in1 lets games read a DualSense’s motion, as the engine’s settings', () => {
    const { chosen, dualsense, h } = engineHost();
    const menu = () => settingsMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
    const ids = () => menu().items().map((w) => (w as Row).id);
    expect(ids()).not.toContain('motion');
    dualsense.motion = true;
    expect(ids()).toEqual(expect.arrayContaining(['vibration', 'motion', 'motionSensitivity']));
    expect(row(menu(), 'motion').get!()).toBe(true); // on by default (the engine's motionOn)
    row(menu(), 'motion').set!(false as never);
    expect([chosen.motion, row(menu(), 'motion').get!()]).toEqual([false, false]);
    const s = row(menu(), 'motionSensitivity') as Row & { step: (u: number, d: 1 | -1) => number; format: () => string };
    expect(s.get!()).toBeCloseTo((1 - 0.25) / 2.75, 9);
    s.set!(s.step(s.get!() as number, 1) as never);
    expect(chosen.motionSensitivity).toBe(1.25);
    s.set!(1 as never);
    expect(chosen.motionSensitivity).toBe(3);
    s.set!(s.step(1, 1) as never); // past the end: held to it
    expect(chosen.motionSensitivity).toBe(3);
    s.set!(0.3 as never); // a drag: in its steps
    expect(chosen.motionSensitivity).toBe(1);
  });

  it('in every stored language the motion rows fit the Settings menu: each label whole in its column, each hint whole on its line', () => {
    const translations = riftlightTranslations();
    /** Lines the menu cut short. */
    const cut: string[] = [];
    try {
      for (const code of ['en', ...Object.keys(translations)]) {
        installLanguage(new Lang(riftlightLines(), translations, { code }));
        const { dualsense, h } = engineHost();
        dualsense.motion = true;
        const menu = settingsMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
        for (const id of ['motion', 'motionSensitivity']) {
          menu.focusId(id); // its hint shows under the rows
          /** What the menu writes, as written (cut with a "." where it didn't fit). */
          const drawn: string[] = [];
          const hud = { width: 480, height: 270, rect() {}, sprite() {}, text: (_x: number, _y: number, s: string) => drawn.push(s), measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
          const ui = new UiCanvas(hud as never);
          const mini = ui.mini.bind(ui);
          ui.mini = (x, y, s, ...more) => (drawn.push(s), mini(x, y, s, ...more));
          const { w, h: height } = menu.size; // its own width (240), as at 1920×1080 and on a phone held sideways
          menu.draw(ui, { x: 0, y: 0, w, h: height });
          const shown = row(menu, id) as Row & { label: string; hint: string };
          if (!drawn.includes(shown.label)) cut.push(`${code} ${id}: ${shown.label}`);
          if (!drawn.includes(shown.hint)) cut.push(`${code} ${id}'s hint: ${shown.hint}`);
        }
      }
    } finally {
      installLanguage(new Lang(riftlightLines()));
    }
    expect(cut).toEqual([]);
  });

  it('the settings open it', () => {
    let opened = '';
    const { h } = engineHost();
    const menu = settingsMenu({ ...(h as object), openMenu: (m: { id?: string; options?: { id?: string } }) => (opened = m.options?.id ?? m.id ?? 'menu'), applySettings: () => {} } as never);
    expect(menu.activate('engine')).toBe(true);
    expect(opened).toBe('engine');
  });

  it('holds what the hotkeys did, and each row changes the engine', () => {
    const { chosen, audio, h } = engineHost();
    const menu = engineMenu(h);
    expect(menu.items().map((w) => (w as Row).id)).toEqual(['pixelArt', 'pixelSize', 'fps', 'sound', 'debugInfo']);
    expect(row(menu, 'pixelArt').get!()).toBe(true);
    row(menu, 'pixelArt').set!(false as never);
    expect(chosen.pixelArt).toBe(false);
    expect(row(menu, 'pixelArt').get!()).toBe(false);
    expect(row(menu, 'pixelSize').get!()).toBe(0);
    row(menu, 'pixelSize').set!(1 as never);
    expect(chosen.pixelSize).toBe('chunky');
    expect(row(menu, 'pixelSize').get!()).toBe(1);
    row(menu, 'fps').set!(1 as never);
    expect(chosen.fps).toBe(30);
    expect(row(menu, 'fps').get!()).toBe(1);
    row(menu, 'sound').set!(false as never);
    expect(audio.muted).toBe(true);
    row(menu, 'debugInfo').set!(true as never);
    expect(chosen.debugInfo).toBe(true);
  });
});

describe('the pause menu', () => {
  it('reaches every screen a pad has no button for (the codex too); Dev only with the developer tools on', () => {
    const opened: string[] = [];
    const ids = (more: object = {}) => riftPauseMenu(host({ openPanel: (id: string) => opened.push(id), ...more })).items().map((w) => w.id);
    expect(ids()).toEqual(expect.arrayContaining(['resume', 'inventory', 'skills', 'tree', 'character', 'codex', 'settings', 'quit']));
    expect(ids(), 'players see no developer tools').not.toContain('dev');
    expect(ids({ devTools: true }), 'the dev server or ?debug=1').toContain('dev');
    riftPauseMenu(host({ openPanel: (id: string) => opened.push(id) })).activate('codex');
    expect(opened).toEqual(['codex']);
  });
});

describe('the Couch co-op hints', () => {
  it('fit their menus in every stored language: the pause menu’s Couch co-op, the Couch co-op menu’s Leave', () => {
    const translations = riftlightTranslations();
    const cut: string[] = [];
    try {
      for (const code of ['en', ...Object.keys(translations)]) {
        installLanguage(new Lang(riftlightLines(), translations, { code }));
        const h = host({ couch: () => ({ seats: [2], leave: () => {} }), openMenu: () => {}, openPanel: () => {}, resume: () => {}, saveAndQuit: () => {} });
        for (const [menu, id] of [[riftPauseMenu(h), 'coop'], [coopMenu(h), 'leave2']] as const) {
          menu.focusId(id);
          const drawn: string[] = [];
          const hud = { width: 480, height: 270, rect() {}, sprite() {}, text: (_x: number, _y: number, s: string) => drawn.push(s), measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
          const ui = new UiCanvas(hud as never);
          const mini = ui.mini.bind(ui);
          ui.mini = (x, y, s, ...more) => (drawn.push(s), mini(x, y, s, ...more));
          const { w, h: height } = menu.size; // their own widths, as on a TV and a phone held sideways
          menu.draw(ui, { x: 0, y: 0, w, h: height });
          const hint = (menu.items().find((x) => x.id === id) as { hint: string }).hint;
          if (!drawn.includes(hint)) cut.push(`${code} ${id}'s hint: ${hint}`);
        }
      }
    } finally {
      installLanguage(new Lang(riftlightLines()));
    }
    expect(cut).toEqual([]);
  });
});

describe('the Couch co-op entry', () => {
  it('is in the pause menu, with the line saying how to join, only while another player may join (never in a 52in1 round or the showcase)', () => {
    const left: number[] = [];
    let couch: { seats: number[]; leave(seat: number): void } | null = { seats: [2], leave: (seat) => left.push(seat) };
    const h = host({ couch: () => couch, openMenu: () => {}, openPanel: () => {}, resume: () => {}, saveAndQuit: () => {} });
    const ids = (m: { items(): readonly unknown[] }) => m.items().map((w) => (w as { id: string }).id);
    expect(ids(riftPauseMenu(h))).toContain('coop');
    const menu = coopMenu(h);
    expect(ids(menu)).toEqual(['seat1', 'leave2', 'seat3', 'seat4', 'g', 'join']);
    menu.activate('leave2');
    expect(left).toEqual([2]);
    couch = null; // a round, the showcase
    expect(ids(riftPauseMenu(h))).not.toContain('coop');
    menu.refresh();
    expect(ids(menu)).not.toContain('join');
    expect(ids(riftPauseMenu(host({ openMenu: () => {} })))).not.toContain('coop'); // a host without couch co-op
  });
});
