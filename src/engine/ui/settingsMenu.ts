/**
 * The engine's settings screen as data: pages of rows, one setting each, whose value steps
 * ◀ value ▶, driven by the engine's menu input (`MenuInput`, `FocusList`) from `ctx.input`: the
 * d-pad or the left stick (with repeat) moves, left / right change, Cross / Enter changes too,
 * L1 / R1 (Q / E) turn the page, Circle / Esc / Options close, Triangle / R resets. `SettingsPanel`
 * draws it in the DOM (legible at ten feet at any art size) and adds the pointer: hover moves the
 * focus, a click or a tap acts, a swipe closes. It reads no DOM, so it runs headless in tests.
 *
 * Words are lines (`SETTINGS_LINES`, English): a game with a line of the same id in its `Lang`
 * (`engine.controls.names = lang`) shows its own.
 */
import { type Control, controlGlyph, type Glyph, type LineSource } from '../controls';
import type { Engine } from '../Engine';
import type { Input } from '../input';
import { LOOK_PRESETS, lookPresetLabel } from '../render/look';
import { FPS_OPTIONS, MOTION_SENSITIVITY, PAD_GLYPHS, PIXEL_SIZES, QUALITY_OPTIONS } from '../settings';
import { FocusList, MenuInput } from './menu';

/** The settings screen's words, by line id (English). A game translates one by having a line of the same id. */
export const SETTINGS_LINES = {
  'settings.title': 'Settings',
  'settings.page.picture': 'Picture',
  'settings.page.sound': 'Sound',
  'settings.page.controls': 'Controls',
  'settings.on': 'On',
  'settings.off': 'Off',
  'settings.look': 'Look',
  'settings.look.game': "The game's",
  'settings.look.needs_pixel_art': 'Looks need pixel art.',
  'settings.pixel_art': 'Pixel art',
  'settings.pixel_size': 'Pixel size',
  'settings.pixel_size.fine': 'Fine',
  'settings.pixel_size.chunky': 'Chunky',
  'settings.quality': 'Quality',
  'settings.quality.auto': 'Auto',
  'settings.quality.low': 'Low',
  'settings.quality.medium': 'Medium',
  'settings.quality.high': 'High',
  'settings.fps': 'Frame rate',
  'settings.fps.unit': 'fps',
  'settings.fps.screen': 'Screen',
  'settings.debug': 'Debug info',
  'settings.sound': 'Sound',
  'settings.volume': 'Volume',
  'settings.music': 'Music',
  'settings.effects': 'Effects',
  'settings.voice': 'Microphone',
  'settings.voice.allow': '52in1 allows the microphone in its Settings, under Sound.',
  'settings.voice.later': 'Open the game again to use the microphone.',
  'settings.voice.hub': 'The microphone needs 52in1.',
  'settings.pad_glyphs': 'Button prompts',
  'settings.pad_glyphs.playstation': 'PlayStation',
  'settings.pad_glyphs.xbox': 'Xbox',
  'settings.vibration': 'Vibration',
  'settings.motion': 'Motion aim',
  'settings.motion.none': 'Motion aim needs a DualSense in 52in1.',
  'settings.motion_sensitivity': 'Motion sensitivity',
  'settings.change': 'Change',
  'settings.close': 'Close',
  'settings.reset': 'Reset',
} as const satisfies Readonly<Record<string, string>>;

export type SettingsLineId = keyof typeof SETTINGS_LINES;

/** The settings screen's pages, in order. */
export const SETTINGS_PAGES = ['picture', 'sound', 'controls'] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

/** The rows a game adds to the standard ones (`EngineOptions.settings`). */
export interface SettingsFeatures {
  /** A voice feature: a Microphone row (on only while 52in1 allows games the microphone). */
  readonly voice?: boolean;
  /** Motion aim: Motion aim and Motion sensitivity rows (a DualSense's motion through 52in1). */
  readonly motion?: boolean;
}

/** A row as it is drawn. */
export interface SettingsRow {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** It can be changed now; otherwise it is drawn dimmed, and `note` says why. */
  readonly enabled: boolean;
  /** A line under the row ('' for none). */
  readonly note: string;
  /** ◀ / ▶ can move from here (a number stops at its ends; a choice goes round). */
  readonly left: boolean;
  readonly right: boolean;
}

/** A button of the legend: what it does, the control that does it, and its words. */
export interface SettingsLegendItem {
  readonly action: 'change' | 'close' | 'reset';
  readonly control: Control;
  readonly label: string;
}

/** The legend's controls: Cross / Enter / a tap change, Circle / Esc / a swipe close, Triangle / R reset. */
export const SETTINGS_CONTROLS = {
  change: { key: 'Enter', pad: 'PadA', touch: 'TouchTap' },
  close: { key: 'Escape', pad: 'PadB', touch: 'TouchSwipe' },
  reset: { key: 'KeyR', pad: 'PadY' },
  pagePrev: { key: 'KeyQ', pad: 'PadLB' },
  pageNext: { key: 'KeyE', pad: 'PadRB' },
} as const satisfies Readonly<Record<string, Control>>;

/** What a frame of the settings screen did. */
export interface SettingsFrame {
  /** Close it (Circle, Esc, Options). */
  readonly close: boolean;
  /** A value, the focus or the page changed: draw it again. */
  readonly changed: boolean;
}

interface RowDef {
  readonly id: string;
  readonly page: SettingsPage;
  readonly label: SettingsLineId;
  /** Shown at all (a game's feature rows). */
  readonly shown?: () => boolean;
  /** How many values it steps through. */
  count(): number;
  /** The value in use (an index; the nearest step for a number between steps). */
  index(): number;
  text(i: number): string;
  set(i: number): void;
  /** A choice goes round at its ends; a number stops. */
  readonly round: boolean;
  enabled?(): boolean;
  note?(): string;
}

const PERCENT_STEPS = 10;

/**
 * The settings screen's state and rules (`engine`'s settings, sound and 52in1 gates), as data:
 * `page`, the focus (`list.index`), the rows of the page (`rows()`), the legend (`legend()`).
 * Feed it a frame of input with `update`; the pointer acts through `step`, `activate`, `turnPage`.
 */
export class SettingsMenu {
  readonly menu = new MenuInput({ keys: ['PadStart', SETTINGS_CONTROLS.reset.key, SETTINGS_CONTROLS.reset.pad] });
  /** The focus on the page's rows (no swipes here: the panel's own touch closes it). */
  readonly list = new FocusList(0, { dismiss: [] });
  private pageIndex = 0;
  private readonly defs: readonly RowDef[];

  constructor(
    private readonly engine: Engine,
    features: SettingsFeatures = {},
  ) {
    this.defs = rowDefs(engine, features, (id) => this.t(id));
    this.list.count = this.visible().length;
  }

  /** The pages, in order. */
  get pages(): readonly SettingsPage[] {
    return SETTINGS_PAGES;
  }

  get page(): SettingsPage {
    return SETTINGS_PAGES[this.pageIndex]!;
  }

  /** A line of the screen in the game's language (`engine.controls.names`), else English. */
  t(id: SettingsLineId): string {
    const names: LineSource | null = this.engine.controls.names;
    return names?.has(id) ? names.t(id) : SETTINGS_LINES[id];
  }

  /** The current page's rows. */
  rows(): SettingsRow[] {
    return this.visible().map((d) => {
      const i = d.index();
      const n = d.count();
      const enabled = d.enabled?.() ?? true;
      return {
        id: d.id,
        label: this.t(d.label),
        value: d.text(i),
        enabled,
        note: enabled ? '' : (d.note?.() ?? ''),
        left: enabled && (d.round ? n > 1 : i > 0),
        right: enabled && (d.round ? n > 1 : i < n - 1),
      };
    });
  }

  /** The legend's buttons, each with the control that does it on the device in use. */
  legend(): SettingsLegendItem[] {
    return (['change', 'close', 'reset'] as const).map((action) => ({ action, control: SETTINGS_CONTROLS[action], label: this.t(`settings.${action}`) }));
  }

  /** How `control` is drawn on the device in use, in the player's button style (null: on touch, a control with no touch gesture). */
  glyph(control: Control): Glyph | null {
    const c = this.engine.controls;
    if (c.device === 'touch' && !control.touch) return null;
    return controlGlyph(control, c.device, c.style, c.names);
  }

  /** Open on the first page's first row. */
  reset(): void {
    this.pageIndex = 0;
    this.list.count = this.visible().length;
    this.list.index = 0;
  }

  /** Show page `n` (wrapping), its first row focused. */
  turnPage(n: number): void {
    const count = SETTINGS_PAGES.length;
    this.pageIndex = (((this.pageIndex + n) % count) + count) % count;
    this.list.count = this.visible().length;
    this.list.index = 0;
  }

  /** Show `page`, its first row focused. */
  showPage(page: SettingsPage): void {
    const i = SETTINGS_PAGES.indexOf(page);
    if (i >= 0 && i !== this.pageIndex) this.turnPage(i - this.pageIndex);
  }

  /**
   * Change row `i` of the page by `dir` steps: a number stops at its ends, a choice goes round (and
   * `round` makes a number go round too: Cross on 100% gives 0%). False when nothing changed.
   */
  step(i: number, dir: 1 | -1, round = false): boolean {
    const d = this.visible()[i];
    if (!d || !(d.enabled?.() ?? true)) return false;
    const n = d.count();
    const at = d.index();
    let next = at + dir;
    if (d.round || round) next = ((next % n) + n) % n;
    else next = Math.max(0, Math.min(n - 1, next));
    if (next === at) return false;
    d.set(next);
    return true;
  }

  /** Cross / Enter / a click on row `i`: its next value, round from the last. */
  activate(i: number): boolean {
    return this.step(i, 1, true);
  }

  /** Forget the player's choices: the game's own picture and sound again (Triangle / R). */
  resetAll(): void {
    this.engine.settings.reset();
    this.engine.audio.resetVolumes();
  }

  /** One frame of keys and the pad while the screen is open (`dt`: the frame's seconds, for key repeat). */
  update(input: Input, dt: number): SettingsFrame {
    const events = this.menu.events(input, dt);
    const before = this.pageIndex;
    for (const e of events) if (e.kind === 'tab') this.turnPage(e.dir);
    const r = this.list.update(
      events.filter((e) => e.kind !== 'tab'),
      input,
      { width: 1, height: 1 },
    );
    let changed = r.moved || this.pageIndex !== before;
    if (r.adjust) changed = this.step(this.list.index, r.adjust) || changed;
    if (r.confirm >= 0) changed = this.activate(r.confirm) || changed;
    let close = r.back;
    for (const e of events) {
      if (e.kind !== 'key') continue;
      if (e.code === 'PadStart') close = true;
      else {
        this.resetAll();
        changed = true;
      }
    }
    return { close, changed };
  }

  private visible(): RowDef[] {
    const page = this.page;
    return this.defs.filter((d) => d.page === page && (d.shown?.() ?? true));
  }
}

/** Every row of the screen, on the engine. */
function rowDefs(e: Engine, features: SettingsFeatures, t: (id: SettingsLineId) => string): RowDef[] {
  const s = e.settings;
  const onOff = (on: boolean) => t(on ? 'settings.on' : 'settings.off');
  /** A choice among `values` (shown by `text`), the one in use from `get`. */
  const choice = <T>(id: string, page: SettingsPage, label: SettingsLineId, values: () => readonly T[], get: () => T, set: (v: T) => void, text: (v: T) => string, more: Partial<RowDef> = {}): RowDef => ({
    id,
    page,
    label,
    round: true,
    count: () => values().length,
    index: () => Math.max(0, values().indexOf(get())),
    text: (i) => text(values()[i]!),
    set: (i) => set(values()[i]!),
    ...more,
  });
  const toggle = (id: string, page: SettingsPage, label: SettingsLineId, get: () => boolean, set: (on: boolean) => void, more: Partial<RowDef> = {}) =>
    choice(id, page, label, () => [false, true], get, set, onOff, more);
  /** A share 0..1 in tenths, shown as a percentage. */
  const percent = (id: string, page: SettingsPage, label: SettingsLineId, get: () => number, set: (v: number) => void): RowDef => ({
    id,
    page,
    label,
    round: false,
    count: () => PERCENT_STEPS + 1,
    index: () => Math.round(Math.min(1, Math.max(0, get())) * PERCENT_STEPS),
    text: (i) => `${Math.round((i / PERCENT_STEPS) * 100)}%`,
    set: (i) => set(i / PERCENT_STEPS),
  });
  const audio = e.audio;
  const sound = (fn: () => void) => {
    audio.unlock(); // a click or a key in the panel is a user gesture (a pad's press is not, but costs nothing)
    fn();
  };
  const looks = ['', ...Object.keys(LOOK_PRESETS)];
  const lookName = (n: string) => {
    if (n === '') return t('settings.look.game');
    const names = e.controls.names;
    const id = `look.${n}`;
    if (names?.has(id)) return names.t(id);
    const label = n === 'none' ? 'plain' : lookPresetLabel(n);
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const fpsValues = () => (FPS_OPTIONS.includes(e.maxFps) ? FPS_OPTIONS : [e.maxFps, ...FPS_OPTIONS]);
  const hub = e.hubSettings;
  const motionOn = () => hub.values.dualsense.motion;
  const sensitivities = Array.from({ length: Math.round((MOTION_SENSITIVITY.max - MOTION_SENSITIVITY.min) / MOTION_SENSITIVITY.step) + 1 }, (_, i) => MOTION_SENSITIVITY.min + i * MOTION_SENSITIVITY.step);
  return [
    choice('look', 'picture', 'settings.look', () => looks, () => s.values.look ?? '', (look) => s.set({ look: look || undefined }), lookName, {
      enabled: () => e.renderer.mode === 'pixel', // a look is drawn by the pixel pass: smooth 3D shows none
      note: () => t('settings.look.needs_pixel_art'),
    }),
    toggle('pixelArt', 'picture', 'settings.pixel_art', () => e.renderer.mode === 'pixel', (on) => s.set({ pixelArt: on })),
    choice('pixelSize', 'picture', 'settings.pixel_size', () => PIXEL_SIZES, () => s.values.pixelSize ?? 'fine', (size) => s.set({ pixelSize: size }), (size) => t(`settings.pixel_size.${size}`)),
    choice('quality', 'picture', 'settings.quality', () => QUALITY_OPTIONS, () => s.values.quality ?? e.qualityOption, (quality) => s.set({ quality }), (q) => t(`settings.quality.${q}`)),
    // the game's own rate, when it is none of the choices, is its own: picking it clears the player's
    choice('fps', 'picture', 'settings.fps', fpsValues, () => e.maxFps, (fps) => s.set({ fps: FPS_OPTIONS.includes(fps) ? fps : undefined }), (fps) => (fps ? `${fps} ${t('settings.fps.unit')}` : t('settings.fps.screen'))),
    toggle('debugInfo', 'picture', 'settings.debug', () => e.debugShown, (on) => s.set({ debugInfo: on })),
    toggle('sound', 'sound', 'settings.sound', () => !audio.muted, (on) => sound(() => audio.setMuted(!on))),
    percent('master', 'sound', 'settings.volume', () => audio.volume.master, (v) => sound(() => audio.setVolume('master', v))),
    percent('music', 'sound', 'settings.music', () => audio.volume.music, (v) => sound(() => audio.setVolume('music', v))),
    percent('sfx', 'sound', 'settings.effects', () => audio.volume.sfx, (v) => sound(() => audio.setVolume('sfx', v))),
    toggle('voice', 'sound', 'settings.voice', () => e.voiceOn, (on) => s.set({ voice: on }), {
      shown: () => features.voice === true,
      enabled: () => hub.micAllowed,
      note: () => t(!hub.present ? 'settings.voice.hub' : hub.micLater ? 'settings.voice.later' : 'settings.voice.allow'),
    }),
    choice('padGlyphs', 'controls', 'settings.pad_glyphs', () => PAD_GLYPHS, () => s.values.padGlyphs ?? 'playstation', (padGlyphs) => s.set({ padGlyphs }), (g) => t(`settings.pad_glyphs.${g}`)),
    percent('vibration', 'controls', 'settings.vibration', () => s.values.vibration ?? 1, (vibration) => {
      s.set({ vibration });
      e.input.rumble({ strong: 0.7, weak: 0.7, ms: 160 }); // feel it (on a pad; scaled by the new setting)
    }),
    toggle('motion', 'controls', 'settings.motion', () => e.motionOn, (on) => s.set({ motion: on }), {
      shown: () => features.motion === true,
      enabled: motionOn,
      note: () => t('settings.motion.none'),
    }),
    choice('motionSensitivity', 'controls', 'settings.motion_sensitivity', () => sensitivities, () => nearest(sensitivities, s.values.motionSensitivity ?? 1), (motionSensitivity) => s.set({ motionSensitivity }), (v) => `${Math.round(v * 100)}%`, {
      round: false,
      shown: () => features.motion === true,
      enabled: () => motionOn() && e.motionOn,
      note: () => (motionOn() ? '' : t('settings.motion.none')), // motion aim is off: nothing to say
    }),
  ];
}

/** The value of `values` nearest to `v`. */
function nearest(values: readonly number[], v: number): number {
  return values.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), values[0]!);
}
