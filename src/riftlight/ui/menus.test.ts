import { describe, expect, it } from 'vitest';
import { pauseMenu } from '../../world/ui/panels';
import { defaultLook, Lang, normalizeLook, RESOLUTIONS, textWidthPx, type PlayerSettings, wrapText } from '../../engine';
import { languageName } from '../../engine';
import { installLanguage, riftlightLines, t } from '../lang';
import { skillName } from '../lang/skills';
import { riftlightTranslations } from '../lang/translations';
import { SHOUT_SKILL } from '../game/controls';
import { DIFFICULTY_KEYS, NORMAL } from '../game/difficulty';
import { miniCovers, type Rect, UiCanvas } from './kit';
import { type OpenOptions, UiLayer } from './layer';
import { LEGEND_ROOM } from './legend';
import { lookStudio } from './lookStudio';
import { Menu, type Widget } from './menu';
import { controllerMenu, coopMenu, engineMenu, languageMenu, pauseMenu as riftPauseMenu, settingsMenu, slotsMenu, tuningMenu } from './menus';
import { titleMenu } from './menus';

const host = (more: object = {}) => ({ saves: { last: null, slots: [], volatile: false, lastError: '' }, sound: () => {}, ...more }) as never;

/** `text` drawn whole: on one row, or on rows one after another (a footer wrapped where the language breaks it), none cut. */
const whole = (drawn: readonly string[], text: string): boolean =>
  drawn.some((_, i) =>
    [1, 2, 3].some((n) => {
      const rows = drawn.slice(i, i + n);
      return rows.length === n && (rows.join(' ') === text || rows.join('') === text);
    }),
  );

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

describe('the save slots (title → Load / Import)', () => {
  /** The slots menu's rows with `device` in use, in 52in1 (`hub`) or not. */
  const rows = (device: string, hub = false) => {
    const slots = [0, 1, 2].map((slot) => ({ slot, empty: slot !== 0, error: false, level: 3, deepest: 2 }));
    const h = host({ slot: 0, saves: { last: 0, slots, volatile: false, lastError: '' }, engine: { controls: { device }, hubSettings: { present: hub } } });
    return slotsMenu(h, 'load').items().map((w) => w.id);
  };

  it('export and import as JSON only with the keyboard and mouse outside 52in1 (a download and the browser’s file chooser); load and delete on every device', () => {
    expect(rows('keyboard'), 'the keyboard and mouse').toEqual(['slot0', 'slot1', 'slot2', 'g', 'target', 'export', 'import', 'delete']);
    for (const [device, hub] of [['pad', false], ['touch', false], ['keyboard', true], ['pad', true]] as const) {
      expect(rows(device, hub), `${device}${hub ? ' in 52in1' : ''}`).toEqual(['slot0', 'slot1', 'slot2', 'g', 'target', 'delete']);
    }
  });

  it('the pad picked up on Export or Import: the focus goes up to the slot choice, never down onto Delete', () => {
    const engine = { controls: { device: 'keyboard' }, hubSettings: { present: false } };
    const menu = slotsMenu(host({ slot: 0, saves: { last: null, slots: [], volatile: false, lastError: '' }, engine }), 'load');
    expect(menu.focusId('import')).toBe(true);
    engine.controls.device = 'pad';
    menu.refresh();
    expect(menu.items()[menu.focus]?.id).toBe('target');
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
    /** 52in1's microphone: in 52in1 at all, allowed to games, allowed since the game opened. */
    const mic = { present: true, micAllowed: false, micLater: false };
    /** What the engine's microphone hears (`input.shoutMeter`): null, nothing. */
    const heard = { meter: null as { level: number; loud: number; shouted: boolean } | null };
    const engine = {
      settings: { values: chosen, set: (p: PlayerSettings) => Object.assign(chosen, p) },
      input: { rumble: (r: unknown) => rumbles.push(r), get shoutMeter() { return heard.meter; } },
      hubSettings: Object.assign(mic, { values: { dualsense } }),
      get motionOn() { return dualsense.motion && chosen.motion !== false; },
      get voiceOn() { return mic.micAllowed && chosen.voice !== false; },
      renderer: { get mode() { return chosen.pixelArt === false ? 'raw' : 'pixel'; }, get baseResolution() { return chosen.pixelSize === 'chunky' ? RESOLUTIONS.compare : RESOLUTIONS.default; } },
      get maxFps() { return chosen.fps ?? 60; },
      get debugShown() { return chosen.debugInfo ?? false; },
    };
    return { chosen, audio, rumbles, dualsense, mic, heard, h: host({ engine, audio, settings: { look: '', quality: 'auto', zoom: 1, screenShake: 0.7, damageNumbers: true, lootFilter: 0 } }) };
  };
  type Row = { id: string; kind: string; get?: () => unknown; set?: (v: never) => void; hint?: string; disabled?: boolean; step?: (u: number, d: 1 | -1) => number; format?: () => string };
  const row = (menu: { items(): readonly unknown[] }, id: string) => menu.items().find((w) => (w as Row).id === id) as Row;

  it("the settings open the controller's page: button prompts (PlayStation or Xbox) and vibration, the engine's own settings", () => {
    const { chosen, rumbles, h } = engineHost();
    let opened: ReturnType<typeof controllerMenu> | null = null;
    const settings = settingsMenu({ ...(h as object), openMenu: (m: never) => (opened = m), applySettings: () => {} } as never);
    expect(settings.items().map((w) => (w as Row).id), 'Settings: the Controller page, its rows not').toEqual(expect.arrayContaining(['controller', 'engine']));
    expect(settings.items().map((w) => (w as Row).id)).not.toContain('padGlyphs');
    expect(settings.activate('controller')).toBe(true);
    const menu = opened as unknown as ReturnType<typeof controllerMenu>;
    expect(menu.id).toBe('controller');
    const ids = menu.items().map((w) => (w as Row).id);
    expect(ids).toEqual(['padGlyphs', 'vibration', 'voice', 'voiceSensitivity']);
    expect(ids).not.toContain('glyphs'); // prompts follow the device used last by themselves
    expect(row(menu, 'padGlyphs').get!()).toBe(0); // PlayStation unless chosen
    row(menu, 'padGlyphs').set!(1 as never);
    expect([chosen.padGlyphs, row(menu, 'padGlyphs').get!()]).toEqual(['xbox', 1]);
    expect(row(menu, 'vibration').get!()).toBe(1);
    row(menu, 'vibration').set!(0.42 as never);
    expect([chosen.vibration, rumbles.length]).toEqual([0.4, 1]); // in steps of 0.05, and a pulse to feel it
  });

  it('motion aim and its sensitivity are on the Controller page while 52in1 lets games read a DualSense’s motion, as the engine’s settings', () => {
    const { chosen, dualsense, h } = engineHost();
    const menu = () => controllerMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
    const ids = () => menu().items().map((w) => (w as Row).id);
    expect(ids()).not.toContain('motion');
    dualsense.motion = true;
    expect(ids()).toEqual(['padGlyphs', 'vibration', 'motion', 'motionSensitivity', 'voice', 'voiceSensitivity']);
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

  it('the Voice row (a shout uses War Cry) is off, and stays off, with 52in1’s line until 52in1 allows the microphone; then on with its hint, and it turns off', () => {
    const { chosen, mic, h } = engineHost();
    const voice = () => row(controllerMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never), 'voice');
    const seen = () => [voice().get!(), voice().disabled, voice().hint];
    expect(seen(), 'not allowed: where 52in1 allows it').toEqual([false, true, t('menu.settings.voice.allow')]);
    voice().set!(true as never);
    expect([chosen.voice, voice().get!()], 'it doesn’t change').toEqual([undefined, false]);
    mic.micLater = true;
    expect(seen(), 'allowed since the game opened: open it again').toEqual([false, true, t('menu.settings.voice.later')]);
    Object.assign(mic, { micLater: false, micAllowed: true });
    expect(seen(), 'allowed: on, its hint').toEqual([true, false, t('menu.settings.voice.hint', { skill: skillName(SHOUT_SKILL) })]);
    expect(voice().hint).toBe('Shout to use War Cry');
    voice().set!(false as never);
    expect([chosen.voice, voice().get!()]).toEqual([false, false]);
    voice().set!(true as never);
    expect([chosen.voice, voice().get!()]).toEqual([true, true]);
  });

  it('Shout sensitivity, under Voice, is dimmed with 52in1’s line and doesn’t move until 52in1 allows the microphone; then 50% to 300% in steps of 50%, the engine’s voiceSensitivity', () => {
    const { chosen, mic, h } = engineHost();
    const menu = () => controllerMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
    const s = () => row(menu(), 'voiceSensitivity');
    const seen = () => [s().get!(), s().format!(), s().disabled, s().hint];
    expect(seen(), 'not allowed: where 52in1 allows it').toEqual([0.2, '100%', true, t('menu.settings.voice.allow')]);
    s().set!(1 as never);
    const m = menu();
    m.focusId('voiceSensitivity');
    m.input({ kind: 'nav', dir: 'right' });
    expect([chosen.voiceSensitivity, s().format!()], 'it doesn’t move').toEqual([undefined, '100%']);
    mic.micLater = true;
    expect(seen(), 'allowed since the game opened: open it again').toEqual([0.2, '100%', true, t('menu.settings.voice.later')]);
    Object.assign(mic, { micLater: false, micAllowed: true });
    expect(seen(), 'allowed: its hint').toEqual([0.2, '100%', false, t('menu.settings.voice_sensitivity.hint')]);
    s().set!(s().step!(s().get!() as number, 1) as never);
    expect(chosen.voiceSensitivity).toBe(1.5);
    s().set!(1 as never);
    expect([chosen.voiceSensitivity, s().format!()]).toEqual([3, '300%']);
    s().set!(s().step!(1, 1) as never); // past the end: held to it
    expect(chosen.voiceSensitivity).toBe(3);
    s().set!(0 as never);
    expect(chosen.voiceSensitivity).toBe(0.5);
    s().set!(0.45 as never); // a drag: in its steps (0.5 + 0.45 × 2.5 = 1.625)
    expect(chosen.voiceSensitivity).toBe(1.5);
  });

  it('Shout sensitivity is dimmed while Voice is off, as on the engine’s panel, with a hint to turn Voice on; turned on in the same menu, it moves at once', () => {
    const { chosen, mic, h } = engineHost();
    Object.assign(mic, { micAllowed: true });
    chosen.voice = false;
    const menu = controllerMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
    const s = () => row(menu, 'voiceSensitivity');
    expect([s().disabled, s().hint], 'Voice off').toEqual([true, t('menu.settings.voice_sensitivity.off')]);
    menu.focusId('voiceSensitivity');
    menu.input({ kind: 'nav', dir: 'right' });
    s().set!(1 as never);
    expect(chosen.voiceSensitivity, 'it doesn’t move').toBeUndefined();
    // Voice turned on from the menu, then straight down and right: no frame drawn between
    menu.focusId('voice');
    menu.input({ kind: 'nav', dir: 'right' });
    menu.input({ kind: 'nav', dir: 'down' });
    menu.input({ kind: 'nav', dir: 'right' });
    expect([chosen.voice, chosen.voiceSensitivity, s().disabled, s().hint]).toEqual([true, 1.5, false, t('menu.settings.voice_sensitivity.hint')]);
  });

  it('the Voice row’s meter: none while nothing is heard; the level against a mark where a shout counts, lit once a shout has counted', () => {
    const { mic, heard, h } = engineHost();
    Object.assign(mic, { micAllowed: true });
    const menu = controllerMenu({ ...(h as object), openMenu: () => {}, applySettings: () => {} } as never);
    /** The menu drawn: the meter's rect, and the rects drawn inside it (x, w, colour). */
    const draw = () => {
      const rects: { x: number; y: number; w: number; h: number; c: string }[] = [];
      const hud = { width: 480, height: 270, rect: (x: number, y: number, w: number, hh: number, c: string) => rects.push({ x, y, w, h: hh, c }), sprite() {}, text() {}, measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
      menu.refresh();
      menu.draw(new UiCanvas(hud as never), { x: 0, y: 0, ...menu.size });
      const at = menu.rects.get('voice:meter');
      return { at, inside: at ? rects.filter((r) => r.x >= at.x && r.x + r.w <= at.x + at.w && r.y >= at.y && r.y + r.h <= at.y + at.h) : [] };
    };
    expect(draw().at, 'nothing heard').toBeUndefined();
    heard.meter = { level: 0.1, loud: 0.2, shouted: false };
    const half = draw();
    expect(half.at, 'heard: a meter in the rest of the row').toBeDefined();
    const [frame, range, fill, mark] = half.inside;
    const inner = half.at!.w - 2;
    expect([frame!.w, range!.w, range!.c, fill!.w, mark!.x - half.at!.x - 1, fill!.c, mark!.c], 'half a shout: filled to half its mark').toEqual([half.at!.w, inner, 'slate', Math.round(inner / 3), Math.round((inner * 2) / 3), 'sky', 'white']);
    heard.meter = { level: 0.5, loud: 0.2, shouted: true };
    const [, , full, lit] = draw().inside;
    expect([full!.w, full!.c, lit!.c], 'a shout counted: full, lit').toEqual([inner, 'lime', 'lime']);
  });

  it('a slider draws its default’s mark where its default sits (`mark`), and none without one', () => {
    /** Where the slider's 1-pixel marks are drawn, as 0..1 along its track. */
    const marks = (mark?: number) => {
      const menu = new Menu([{ kind: 'slider', id: 's', label: 'Shout', get: () => 0.6, set: () => {}, step: (u) => u, format: () => '', mark }], { id: 'm', title: '', width: 240, labelWidth: 104 });
      const rects: { x: number; y: number; w: number; h: number }[] = [];
      const hud = { width: 480, height: 270, rect: (x: number, y: number, w: number, hh: number) => rects.push({ x, y, w, h: hh }), sprite() {}, text() {}, measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
      menu.draw(new UiCanvas(hud as never), { x: 0, y: 0, ...menu.size });
      const t = menu.rects.get('s:track')!;
      const track = { x: t.x + 2, w: t.w - 4 };
      return rects.filter((r) => r.w === 1 && r.h === 5).map((r) => Math.round(((r.x - track.x) / track.w) * 100) / 100);
    };
    expect([marks(0.2), marks(1), marks(undefined)]).toEqual([[0.2], [1], []]);
  });

  it('every slider of the settings, the Controller page and the tuning page sits on its mark at its default', () => {
    const { dualsense, mic, h } = engineHost();
    Object.assign(mic, { micAllowed: true });
    dualsense.motion = true;
    const host = { ...(h as object), openMenu: () => {}, applySettings: () => {}, difficulty: () => ({ ...NORMAL }), setDifficulty: () => {} } as never;
    const sliders = [settingsMenu(host), controllerMenu(host), tuningMenu(host)].flatMap((m) => m.items().filter((w): w is Extract<Widget, { kind: 'slider' }> => w.kind === 'slider'));
    const off = sliders.filter((w) => !w.id.startsWith('vol.')).map((w) => [w.id, w.mark === undefined ? 'no mark' : Math.abs(w.get() - w.mark) < 1e-9 ? 'on it' : `knob ${w.get()}, mark ${w.mark}`]);
    expect(off.filter(([, at]) => at !== 'on it'), 'a slider at its default off its mark').toEqual([]);
    expect(off.map(([id]) => id), 'every one').toEqual(['zoom', 'shake', 'vibration', 'motionSensitivity', 'voiceSensitivity', ...DIFFICULTY_KEYS]);
    // the volumes have no default the page shows (their own, the engine audio's): no mark
    expect(sliders.filter((w) => w.id.startsWith('vol.')).map((w) => w.mark)).toEqual([undefined, undefined, undefined]);
  });

  it('a disabled slider takes the focus, drawn dimmed, and moves for no key, button, click or drag', () => {
    const sets: number[] = [];
    const slider = (disabled: boolean): Widget => ({ kind: 'slider', id: 's', label: 'Shout', get: () => 0.5, set: (u) => sets.push(u), step: (u, d) => u + d * 0.1, format: () => '50%', disabled });
    const menu = new Menu([slider(true)], { id: 'm', title: '', width: 240, labelWidth: 104 });
    const drawn: string[] = [];
    const hud = { width: 480, height: 270, rect: (_x: number, _y: number, _w: number, _h: number, c: string) => drawn.push(c), sprite() {}, text: (_x: number, _y: number, _s: string, o?: { color?: string }) => drawn.push(`text:${o?.color}`), measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
    menu.draw(new UiCanvas(hud as never), { x: 0, y: 0, ...menu.size });
    const track = menu.rects.get('s:track')!;
    expect([menu.focus, drawn.includes('text:slate'), drawn.includes('sky')], 'focused, its words and fill slate').toEqual([0, true, false]);
    menu.input({ kind: 'nav', dir: 'right' });
    menu.input({ kind: 'nav', dir: 'left' });
    menu.input({ kind: 'confirm' });
    menu.input({ kind: 'pointer', type: 'down', x: track.x + track.w - 3, y: track.y + track.h / 2 });
    menu.input({ kind: 'pointer', type: 'move', x: track.x + 3, y: track.y + track.h / 2 });
    menu.input({ kind: 'pointer', type: 'up', x: track.x + 3, y: track.y + track.h / 2 });
    expect(sets).toEqual([]);
    const live = new Menu([slider(false)], { id: 'm', title: '', width: 240, labelWidth: 104 });
    live.input({ kind: 'nav', dir: 'right' });
    expect(sets, 'enabled, it moves').toEqual([0.6]);
  });

  it('outside 52in1 the Controller page has no Voice row, as it has no motion rows; the Controller button says what its page holds', () => {
    const { dualsense, mic, h } = engineHost();
    const host = { ...(h as object), openMenu: () => {}, applySettings: () => {} } as never;
    const page = () => [controllerMenu(host).items().map((w) => (w as Row).id), row(settingsMenu(host), 'controller').hint];
    expect(page(), 'in 52in1: the voice').toEqual([['padGlyphs', 'vibration', 'voice', 'voiceSensitivity'], 'Button prompts, vibration, voice']);
    dualsense.motion = true;
    expect(page(), 'and motion aim').toEqual([['padGlyphs', 'vibration', 'motion', 'motionSensitivity', 'voice', 'voiceSensitivity'], 'Button prompts, vibration, motion aim, voice']);
    Object.assign(dualsense, { motion: false });
    Object.assign(mic, { present: false });
    expect(page(), 'outside 52in1: neither').toEqual([['padGlyphs', 'vibration'], 'Button prompts, vibration']);
  });

  it('in every stored language the motion rows fit the Controller page, and the Controller button its Settings: each label whole in its column, each hint whole on its rows', () => {
    const translations = riftlightTranslations();
    /** Lines the menu cut short. */
    const cut: string[] = [];
    try {
      for (const code of ['en', ...Object.keys(translations)]) {
        installLanguage(new Lang(riftlightLines(), translations, { code }));
        const { dualsense, mic, h } = engineHost();
        const host = { ...(h as object), openMenu: () => {}, applySettings: () => {} } as never;
        // the Voice row's hint: its own while allowed, else 52in1's line (where it allows it, open the
        // game again); the Controller button's: with motion aim and the voice, the voice, neither (outside 52in1)
        const voice = { allowed: { micAllowed: true }, allow: {}, later: { micLater: true }, hub: { present: false } };
        const cases = [['motion', true], ['motionSensitivity', true], ['controller', true], ['controller', false], ['controller', false, 'hub'], ...['allowed', 'allow', 'later'].flatMap((k) => [['voice', true, k], ['voiceSensitivity', true, k]])] as [string, boolean, keyof typeof voice | undefined][];
        for (const [id, motion, hub] of cases) {
          dualsense.motion = motion;
          Object.assign(mic, { present: true, micAllowed: false, micLater: false }, hub ? voice[hub] : {});
          const menu = id === 'controller' ? settingsMenu(host) : controllerMenu(host);
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
          if (!whole(drawn, shown.hint)) cut.push(`${code} ${id}'s hint${motion ? '' : ' without motion'}${hub ? ` (${hub})` : ''}: ${shown.hint}`);
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
          if (!whole(drawn, hint)) cut.push(`${code} ${id}'s hint: ${hint}`);
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

describe('a menu footer on a desktop and a TV, with a pad', () => {
  /** Screens and their art (`computeFraming`): 427×240, 456×256 and 480×270. */
  const SCREENS = [
    ['1280×720', 427, 240],
    ['1366×768', 456, 256],
    ['1920×1080', 480, 270],
  ] as const;
  /** The shell's host in a level: couch co-op only while another player may join. */
  const shell = (couch: boolean) => {
    let look = normalizeLook(defaultLook());
    return host({
      ...(couch ? { couch: () => ({ seats: [], leave: () => {} }) } : {}),
      resume: () => {},
      openMenu: () => {},
      openPanel: () => {},
      saveAndQuit: () => {},
      photoMode: () => {},
      lookStudio: () => {},
      difficulty: () => NORMAL,
      setDifficulty: () => {},
      applySettings: () => {},
      audio: { muted: false, setMuted: () => {}, volume: { master: 1, music: 1, sfx: 1 }, setVolume: () => {} },
      engine: { settings: { values: {} }, hubSettings: { values: { dualsense: { motion: false } } } },
      settings: { look: '', quality: 'auto', zoom: 1, screenShake: 0.7, damageNumbers: true, lootFilter: 0 },
      // the look studio's (`LookHost`): its Hide panel row too, as the game opens it
      look: () => look,
      setLook: (l: never) => (look = normalizeLook(l)),
      openStudioPage: () => {},
      peek: () => {},
    });
  };
  /** The menus, opened as the shell opens them (the look studio docked right, hideable). */
  const MENUS: [string, (h: never) => Menu, OpenOptions][] = [
    ['pause', (h) => riftPauseMenu(h), {}],
    ['settings', (h) => settingsMenu(h), {}],
    ['tuning', (h) => tuningMenu(h), {}],
    ['look studio', (h) => lookStudio(h), { dock: 'right', dim: false, solo: true, peek: 'H shows the panel' }],
  ];
  /** A canvas recording each text drawn, its top row and whether in the mini font. */
  const canvas = (W: number, H: number) => {
    const drawn: { y: number; s: string; mini: boolean }[] = [];
    const hud = { width: W, height: H, rect() {}, sprite() {}, text: (_x: number, y: number, s: string) => drawn.push({ y, s, mini: false }), measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }) };
    const ui = new UiCanvas(hud as never);
    const mini = ui.mini.bind(ui);
    ui.mini = (x, y, s, ...more) => (miniCovers(s) && drawn.push({ y, s, mini: true }), mini(x, y, s, ...more));
    ui.device = 'pad';
    return { ui, drawn };
  };

  it('never makes a menu scroll: pause, settings, tuning and the look studio fit wherever their rows and one footer row do, in every stored language, the hint under the rows; at 1920×1080 every hint is whole', () => {
    const translations = riftlightTranslations();
    /** What went wrong. */
    const bad: string[] = [];
    /** The menus that fit their screen without scrolling, per language. */
    const fit = new Map<string, Set<string>>();
    try {
      for (const code of ['en', ...Object.keys(translations)]) {
        installLanguage(new Lang(riftlightLines(), translations, { code }));
        fit.set(code, new Set());
        for (const [screen, W, H] of SCREENS)
          for (const couch of [false, true])
            for (const [name, make, open] of MENUS) {
              if (couch && name !== 'pause') continue;
              const what = `${code} ${name}${couch ? ' with couch co-op' : ''} at ${screen}`;
              const menu = make(shell(couch));
              const layer = new UiLayer();
              layer.legends = true;
              layer.open(menu, { modal: true, ...open });
              for (let i = 0; i < 10; i++) layer.update(0.05); // opened, where it stays
              const draw = () => {
                const c = canvas(W, H);
                layer.draw(c.ui, 0);
                return c.drawn;
              };
              draw();
              // the room the shell gives a framed menu over its legend (`UiLayer.draw`), and the
              // rows' own height with one footer row: what fitted before footers wrapped
              const room = { w: W - 12, h: H - 26 - LEGEND_ROOM };
              const rows = new Menu(menu.items().map((w) => ({ ...w, hint: undefined }) as Widget), { id: 'rows', title: '', width: menu.size.w });
              rows.fit(room.w, room.h, 0);
              const scrolls = menu.swipes('up', 0, 0);
              if (rows.size.h <= room.h && (scrolls || menu.size.h > room.h)) bad.push(`${what}: ${menu.size.h} rows tall in ${room.h}, its rows ${rows.size.h - 14}: it scrolls`);
              if (!scrolls) fit.get(code)!.add(`${name}${couch ? '+couch' : ''}@${screen}`);
              // each hint (the footer's place) under the rows, inside the menu; whole at 1920×1080
              const r: Rect = layer.top!.rect;
              for (const w of menu.items()) {
                const hint = (w as { hint?: string }).hint;
                if (!hint || !menu.focusId(w.id)) continue;
                const texts = draw();
                const shown = [...menu.rects.values()];
                const under = Math.max(...shown.map((x) => x.y + x.h));
                const foot = texts.filter((x) => x.y >= under && x.y < r.y + r.h);
                // its rows as written (a language without spaces, a word broken at its hyphen: compared without them)
                const said = foot.map((x) => x.s).join(' ');
                const bare = (s: string) => s.replace(/\s/g, '');
                if (!foot.length || foot.some((x) => x.y + 7 > r.y + r.h)) bad.push(`${what}, ${w.id}'s hint: not under the rows inside the menu (${JSON.stringify(foot)})`);
                else if (W === 480 ? bare(said) !== bare(hint) : !bare(hint).startsWith(bare(said.replace(/\.$/, '')))) bad.push(`${what}, ${w.id}'s hint: "${said}" for "${hint}"`);
              }
            }
      }
    } finally {
      installLanguage(new Lang(riftlightLines()));
    }
    expect(bad).toEqual([]);
    // what fitted with a one-row footer fits still, in every language: the pause menu, the settings and
    // the tuning on all three, the pause menu with couch co-op from 1366×768. (Its rows at 1280×720,
    // and the look studio's with its Hide panel row on all three, are taller than the room: they
    // scroll as they did, their hints whole at 1920×1080.)
    const fits = [...['pause', 'settings', 'tuning'].flatMap((n) => SCREENS.map(([screen]) => `${n}@${screen}`)), 'pause+couch@1366×768', 'pause+couch@1920×1080'];
    for (const [code, did] of fit) expect(fits.filter((x) => !did.has(x)), `${code}: these scroll`).toEqual([]);
  });

  it("the look studio scrolls on a TV: its footer takes the rows its longest hint needs at the panel's width and no more, so its view holds as many rows (English at 1920×1080: down to Clear), and the arrows at its scroll bar's ends never cover the footer's words, in every stored language", () => {
    const translations = riftlightTranslations();
    /** What went wrong. */
    const bad: string[] = [];
    try {
      for (const code of ['en', ...Object.keys(translations)]) {
        installLanguage(new Lang(riftlightLines(), translations, { code }));
        for (const [screen, W, H] of SCREENS) {
          const what = `${code} at ${screen}`;
          const menu = lookStudio(shell(false));
          const layer = new UiLayer();
          layer.legends = true;
          layer.open(menu, { modal: true, ...MENUS.find(([name]) => name === 'look studio')![2] });
          for (let i = 0; i < 10; i++) layer.update(0.05); // opened, where it stays
          /** The frame drawn: its rects, and each text where it starts and how wide. */
          const draw = () => {
            const rects: { x: number; y: number; w: number; h: number; color: string }[] = [];
            const texts: { x: number; y: number; w: number; s: string }[] = [];
            const hud = {
              width: W,
              height: H,
              rect: (x: number, y: number, w: number, h: number, color: string) => rects.push({ x, y, w, h, color }),
              sprite() {},
              text: (x: number, y: number, s: string) => texts.push({ x, y, w: textWidthPx(s), s }),
              measure: (s: string, scale = 1) => ({ width: textWidthPx(s, scale), height: 7 * scale }),
            };
            const ui = new UiCanvas(hud as never);
            ui.device = 'pad';
            layer.draw(ui, 0);
            return { rects, texts };
          };
          draw();
          const r: Rect = layer.top!.rect;
          // the footer's rows: those of the longest of it and the hints wrapped at the panel's
          // width (each whole on three at most), none taken for the arrows
          const texts = [menu.footer() ?? '', ...menu.items().map((w) => (w as { hint?: string }).hint ?? '')].filter((x) => x);
          const rows = Math.max(...texts.map((x) => wrapText(x, r.w - 2).length));
          if (rows > 3) bad.push(`${what}: a hint on ${rows} rows`);
          const foot = 14 + 9 * (Math.min(3, rows) - 1);
          /** The scroll bar's track beside the rows: as tall as the view. */
          const trackOf = (drawn: { x: number; w: number; color: string }[]) => drawn.find((x) => x.color === 'night' && x.w === 2 && x.x >= r.x + r.w) as Rect | undefined;
          const first = trackOf(draw().rects);
          if (!first) bad.push(`${what}: no scroll bar`);
          else if (first.h !== r.h - foot) bad.push(`${what}: a view ${first.h} tall over a footer ${r.h - first.h} tall (its longest takes ${rows} rows: ${foot})`);
          // English at 1920×1080, the focus on the first row: the rows down to Clear in view
          if (code === 'en' && screen === '1920×1080' && !menu.rects.has('clear')) bad.push(`${what}: Clear out of view with the focus on the first row`);
          const last = menu.items().at(-1)!.id;
          for (const w of menu.items()) {
            if (!('hint' in w) || !w.hint || !menu.focusId(w.id)) continue;
            const { rects, texts: drawn } = draw();
            const track = trackOf(rects);
            if (!track) continue;
            // the footer's words (under the view, inside the panel), each with its shadow; the
            // arrows: the sand over the track (more above) and under it (more below)
            const end = track.y + track.h;
            const words = drawn.filter((x) => x.y >= end && x.y < r.y + r.h);
            if (!words.length) bad.push(`${what}, ${w.id}: no footer`);
            const above = rects.filter((x) => x.color === 'sand' && x.y + x.h <= track.y && x.y >= r.y - 2);
            const below = rects.filter((x) => x.color === 'sand' && x.y >= end && x.y < r.y + r.h);
            if (!below.length && !menu.rects.has(last)) bad.push(`${what}, ${w.id}: more below, and no arrow says so`);
            for (const a of [...above, ...below])
              for (const t of words)
                if (a.x < t.x + t.w + 1 && t.x < a.x + a.w && a.y < t.y + 8 && t.y < a.y + a.h) bad.push(`${what}, ${w.id}: an arrow at ${a.x},${a.y} over "${t.s}" (${t.x}..${t.x + t.w}, ${t.y})`);
          }
        }
      }
    } finally {
      installLanguage(new Lang(riftlightLines()));
    }
    expect(bad).toEqual([]);
  });
});
