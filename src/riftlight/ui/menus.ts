/**
 * Every menu in the shell, as widget data (ui/menu.ts): title, pause, tuning (the
 * difficulty sliders), settings and their engine page, save slots, dev tools and the rift
 * keeper's depth list.
 * They talk to the game through `MenuHost`, which `Riftlight` implements.
 */
import { FPS_OPTIONS, languageName, LOOK_PRESETS, PIXEL_SIZES, type AudioManager, type Engine, type QualityLevel } from '../../engine';
import type { DifficultyTuning } from '../core/types';
import {
  DIFFICULTY_KEYS,
  DIFFICULTY_PRESETS,
  type DifficultyPreset,
  difficultyLineId,
  multiplierToSlider,
  NORMAL,
  nudge,
  presetOf,
  sliderToMultiplier,
} from '../game/difficulty';
import type { DevFlags } from '../game/ports';
import { formatTime } from '../game/progress';
import { lootFilterOptions } from '../loot/names';
import type { SavesView } from '../game/save';
import type { Settings } from '../game/settings';
import { lang, t } from '../lang';
import { lookName } from './lookStudio';
import { Menu, type Widget } from './menu';

export interface MenuHost {
  /** The save slots as the game knows them (`SavesView`): menus read these, never storage, so they replay. */
  readonly saves: SavesView;
  readonly settings: Settings;
  readonly dev: DevFlags;
  readonly audio: AudioManager;
  /** The engine's own player settings (pixel art, pixel size, frame rate, debug info: `engine.settings`, saved by the engine) and what they show. */
  readonly engine: Pick<Engine, 'settings' | 'renderer' | 'maxFps' | 'debugShown'>;
  slot: number;
  screen: string;
  difficulty(): DifficultyTuning;
  setDifficulty(t: DifficultyTuning): void;
  applySettings(): void;
  /** Start or load a run (the save it reads and a new run's seed are recorded: `Riftlight.play`). */
  play(choice: { readonly kind: 'new' | 'load' | 'continue'; readonly slot?: number }): void;
  resume(): void;
  saveAndQuit(): void;
  openMenu(menu: Menu, modal?: boolean): void;
  closeMenu(id?: string): void;
  exportSlot(slot: number): void;
  importSlot(slot: number): void;
  deleteSlot(slot: number): void;
  depths(): { depth: number; title: string; best?: number; next: boolean }[];
  enterDepth(depth: number): void;
  devGive(what: 'xp' | 'gold' | 'item' | 'level'): void;
  devKillAll(): void;
  devSpawn(): void;
  devTeleport(depth: number): void;
  setTimeOfDay(t: number): void;
  timeOfDay(): number;
  sound(s: 'click' | 'move'): void;
  /** Open a game view on top of the menu (pause → inventory, skills, tree: touch and pad players have no hotkeys). */
  openPanel(id: 'inventory' | 'skills' | 'tree' | 'character'): unknown;
  /** Photo mode (the showcase): optional, so other hosts can leave it out. */
  photoMode?(): void;
  /** The look studio (filters per layer): optional, so other hosts can leave it out. */
  lookStudio?(): void;
  /** Open Engine World (the engine's tech demo), at one of its rooms: optional, so other hosts can leave it out. */
  engineWorld?(room?: string): unknown;
  /**
   * The game's languages (docs/game/lang.md): those it has (its own first), the one shown, whether
   * the address names one (`?lang=`: the AI Hub always does; no Language menu then), and choosing
   * one (saved, then the game reloads in it). Optional: hosts without it have no Language menu.
   */
  readonly language?: { readonly available: readonly string[]; readonly current: string; readonly asked: boolean; choose(code: string): void };
}

const sound = (h: MenuHost) => (s: 'click' | 'move') => h.sound(s);

/** A number in the language's digits ("Slot 2", a frame rate). */
const num = (n: number, o?: Intl.NumberFormatOptions): string => lang().formatNumber(n, o);

export function titleMenu(h: MenuHost): Menu {
  return new Menu(
    () => {
      const last = h.saves.last;
      const w: Widget[] = [];
      // the hub names the language in the address (`?lang=`): its own menu is in charge
      const asked = !!h.language?.asked;
      if (last !== null) w.push({ kind: 'button', id: 'continue', label: t('menu.title.continue'), onClick: () => h.play({ kind: 'continue' }), accent: 'teal' });
      w.push({ kind: 'button', id: 'new', label: t('menu.title.new_run'), onClick: () => h.openMenu(slotsMenu(h, 'new')) });
      w.push({ kind: 'button', id: 'load', label: t('menu.title.load'), onClick: () => h.openMenu(slotsMenu(h, 'load')) });
      w.push({ kind: 'button', id: 'settings', label: t('menu.title.settings'), onClick: () => h.openMenu(settingsMenu(h)) });
      if (h.language && !asked && h.language.available.length > 1) w.push({ kind: 'button', id: 'language', label: t('menu.title.language'), onClick: () => h.openMenu(languageMenu(h)) });
      if (h.engineWorld) w.push({ kind: 'button', id: 'world', label: t('menu.title.world'), onClick: () => h.engineWorld!(), hint: t('menu.title.world.hint') });
      if (h.engineWorld) w.push({ kind: 'button', id: 'gallery', label: t('menu.title.gallery'), onClick: () => h.engineWorld!('gallery'), hint: t('menu.title.gallery.hint') });
      return w;
    },
    { id: 'title', title: 'Riftlight', width: 130, onSound: sound(h) },
  );
}

/**
 * The Language menu (title screen, only when the address names no language): every language the
 * game has, each named in itself (not lines); choosing one saves it and reloads the game in it.
 */
export function languageMenu(h: MenuHost): Menu {
  return new Menu(
    () => {
      const l = h.language;
      if (!l) return [];
      return l.available.map((code): Widget => ({ kind: 'button', id: `lang.${code}`, label: languageName(code), onClick: () => l.choose(code), accent: code === l.current ? 'teal' : undefined }));
    },
    { id: 'language', title: t('menu.language.title'), width: 150, onSound: sound(h) },
  );
}

export function pauseMenu(h: MenuHost): Menu {
  return new Menu(
    [
      { kind: 'button', id: 'resume', label: t('menu.pause.resume'), onClick: () => h.resume() },
      { kind: 'button', id: 'tuning', label: t('menu.pause.tuning'), onClick: () => h.openMenu(tuningMenu(h)), hint: t('menu.pause.tuning.hint') },
      { kind: 'button', id: 'inventory', label: t('menu.pause.inventory'), onClick: () => h.openPanel('inventory'), hint: t('menu.pause.inventory.hint') },
      { kind: 'button', id: 'skills', label: t('menu.pause.skills'), onClick: () => h.openPanel('skills'), hint: t('menu.pause.skills.hint') },
      { kind: 'button', id: 'tree', label: t('menu.pause.tree'), onClick: () => h.openPanel('tree'), hint: t('menu.pause.tree.hint') },
      { kind: 'button', id: 'character', label: t('menu.pause.character'), onClick: () => h.openPanel('character'), hint: t('menu.pause.character.hint') },
      { kind: 'button', id: 'settings', label: t('menu.pause.settings'), onClick: () => h.openMenu(settingsMenu(h)) },
      ...(h.lookStudio ? [{ kind: 'button' as const, id: 'look', label: t('menu.pause.look'), onClick: () => h.lookStudio!(), hint: t('menu.pause.look.hint') }] : []),
      ...(h.photoMode ? [{ kind: 'button' as const, id: 'photo', label: t('menu.pause.photo'), onClick: () => h.photoMode!(), hint: t('menu.pause.photo.hint') }] : []),
      { kind: 'button', id: 'dev', label: t('dev.pause.dev'), onClick: () => h.openMenu(devMenu(h)), hint: t('dev.pause.dev.hint') },
      { kind: 'gap', id: 'g' },
      { kind: 'button', id: 'quit', label: t('menu.pause.quit'), onClick: () => h.saveAndQuit(), accent: 'plum' },
    ],
    { id: 'pause', title: t('menu.pause.title'), width: 140, onBack: () => h.resume(), onSound: sound(h) },
  );
}

const PRESETS: DifficultyPreset[] = ['story', 'normal', 'hard', 'nightmare'];

/** A multiplier as the sliders show it, "1.50x" (developer screens). */
const times = (v: number) => t('menu.tuning.value', { value: num(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) });

export function tuningMenu(h: MenuHost): Menu {
  const set = (k: (typeof DIFFICULTY_KEYS)[number], v: number) => h.setDifficulty({ ...h.difficulty(), [k]: v });
  return new Menu(
    () => {
      const tuning = h.difficulty();
      const preset = presetOf(tuning);
      const w: Widget[] = [
        {
          kind: 'choice',
          id: 'preset',
          label: t('menu.tuning.preset'),
          options: [...PRESETS.map((p) => t(`menu.tuning.preset.${p}`)), t('menu.tuning.preset.custom')],
          get: () => (preset ? PRESETS.indexOf(preset) : PRESETS.length),
          set: (i) => i < PRESETS.length && h.setDifficulty({ ...DIFFICULTY_PRESETS[PRESETS[i]!] }),
          hint: t('menu.tuning.preset.hint'),
        },
        { kind: 'gap', id: 'g1', h: 3 },
      ];
      for (const k of DIFFICULTY_KEYS) {
        if (k === 'enemyDamage') w.push({ kind: 'gap', id: 'g2', h: 4 });
        w.push({
          kind: 'slider',
          id: k,
          label: t(`menu.tuning.${difficultyLineId(k)}`),
          get: () => multiplierToSlider(h.difficulty()[k]),
          set: (u) => set(k, sliderToMultiplier(u)),
          step: (_u, dir) => multiplierToSlider(nudge(h.difficulty()[k], dir)),
          format: () => times(h.difficulty()[k]),
          changed: () => h.difficulty()[k] !== 1,
          hint: t('menu.tuning.slider.hint'),
        });
      }
      w.push({ kind: 'gap', id: 'g3', h: 4 }, { kind: 'button', id: 'reset', label: t('menu.tuning.reset'), onClick: () => h.setDifficulty({ ...NORMAL }) });
      return w;
    },
    { id: 'tuning', title: t('menu.tuning.title'), width: 230, labelWidth: 96, onSound: sound(h) },
  );
}

/** The settings' looks: the default, every named look, and the studio's custom one once there is one. */
const looks = (s: Settings) => ['', ...Object.keys(LOOK_PRESETS).filter((n) => n !== 'none'), ...(s.customLook ? ['custom'] : [])];
const lookLabel = (l: string) => (l === 'custom' ? t('look.custom') : lookName(l || 'none'));
const QUALITIES: (QualityLevel | 'auto')[] = ['auto', 'low', 'medium', 'high'];
const GLYPHS = ['auto', 'keyboard', 'controller'] as const;
const pct = (v: number) => num(v, { style: 'percent' });

export function settingsMenu(h: MenuHost): Menu {
  const s = h.settings;
  const vol = (ch: 'master' | 'music' | 'sfx'): Widget => ({
    kind: 'slider',
    id: `vol.${ch}`,
    label: t(`menu.settings.volume.${ch}`),
    get: () => h.audio.volume[ch],
    set: (u) => h.audio.setVolume(ch, Math.round(u * 20) / 20),
    step: (u, d) => Math.min(1, Math.max(0, Math.round((u + d * 0.05) * 20) / 20)),
    format: () => pct(h.audio.volume[ch]),
  });
  const change = (fn: () => void) => () => {
    fn();
    h.applySettings();
  };
  return new Menu(
    () => [
      vol('master'),
      vol('music'),
      vol('sfx'),
      { kind: 'choice', id: 'quality', label: t('menu.settings.quality'), options: QUALITIES.map((q) => t(`menu.settings.quality.${q}`)), get: () => QUALITIES.indexOf(s.quality), set: (i) => change(() => (s.quality = QUALITIES[i]!))() },
      { kind: 'choice', id: 'look', label: t('menu.settings.look'), options: looks(s).map(lookLabel), get: () => Math.max(0, looks(s).indexOf(s.look)), set: (i) => change(() => (s.look = looks(s)[i]!))(), hint: t('menu.settings.look.hint') },
      ...(h.lookStudio ? [{ kind: 'button' as const, id: 'studio', label: t('menu.settings.studio'), onClick: () => h.lookStudio!(), hint: t('menu.settings.studio.hint') }] : []),
      {
        kind: 'slider',
        id: 'zoom',
        label: t('menu.settings.zoom'),
        get: () => (s.zoom - 0.6) / 1,
        set: (u) => change(() => (s.zoom = Math.round((0.6 + u) * 20) / 20))(),
        step: (u, d) => Math.min(1, Math.max(0, u + d * 0.05)),
        format: () => t('menu.settings.zoom.value', { value: num(s.zoom, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }),
        changed: () => s.zoom !== 1,
      },
      { kind: 'toggle', id: 'numbers', label: t('menu.settings.numbers'), get: () => s.damageNumbers, set: (v) => change(() => (s.damageNumbers = v))() },
      { kind: 'choice', id: 'filter', label: t('menu.settings.filter'), options: lootFilterOptions(), get: () => s.lootFilter, set: (i) => change(() => (s.lootFilter = i))() },
      { kind: 'slider', id: 'shake', label: t('menu.settings.shake'), get: () => s.screenShake, set: (u) => change(() => (s.screenShake = Math.round(u * 20) / 20))(), step: (u, d) => Math.min(1, Math.max(0, u + d * 0.1)), format: () => pct(s.screenShake) },
      { kind: 'choice', id: 'glyphs', label: t('menu.settings.glyphs'), options: GLYPHS.map((g) => t(`menu.settings.glyphs.${g}`)), get: () => GLYPHS.indexOf(s.glyphs), set: (i) => change(() => (s.glyphs = GLYPHS[i]!))(), hint: t('menu.settings.glyphs.hint') },
      { kind: 'button', id: 'engine', label: t('menu.settings.engine'), onClick: () => h.openMenu(engineMenu(h)), hint: t('menu.settings.engine.hint') },
    ],
    { id: 'settings', title: t('menu.settings.title'), width: 240, labelWidth: 104, onSound: sound(h) },
  );
}

/**
 * The engine's standard options (`engine.settings`, which saves them; sound is the audio's): what
 * the engine's hotkeys did, which a shipped game doesn't have. Riftlight keeps its own look and
 * quality on the settings page.
 */
export function engineMenu(h: MenuHost): Menu {
  const e = h.engine;
  const size = () => e.settings.values.pixelSize ?? 'fine'; // the game's own art resolution is fine
  return new Menu(
    () => [
      { kind: 'toggle', id: 'pixelArt', label: t('menu.engine.pixel_art'), get: () => e.renderer.mode === 'pixel', set: (v) => e.settings.set({ pixelArt: v }), hint: t('menu.engine.pixel_art.hint') },
      { kind: 'choice', id: 'pixelSize', label: t('menu.engine.pixel_size'), options: PIXEL_SIZES.map((p) => t(`menu.engine.pixel_size.${p}`)), get: () => PIXEL_SIZES.indexOf(size()), set: (i) => e.settings.set({ pixelSize: PIXEL_SIZES[i] }) },
      { kind: 'choice', id: 'fps', label: t('menu.engine.fps'), options: FPS_OPTIONS.map((f) => (f ? t('menu.engine.fps.value', { fps: f }) : t('menu.engine.fps.screen'))), get: () => Math.max(0, FPS_OPTIONS.indexOf(e.maxFps)), set: (i) => e.settings.set({ fps: FPS_OPTIONS[i] }) },
      { kind: 'toggle', id: 'sound', label: t('menu.engine.sound'), get: () => !h.audio.muted, set: (v) => h.audio.setMuted(!v) },
      { kind: 'toggle', id: 'debugInfo', label: t('menu.engine.debug'), get: () => e.debugShown, set: (v) => e.settings.set({ debugInfo: v }), hint: t('menu.engine.debug.hint') },
    ],
    { id: 'engine', title: t('menu.engine.title'), width: 240, labelWidth: 104, onSound: sound(h) },
  );
}

export function slotsMenu(h: MenuHost, mode: 'new' | 'load'): Menu {
  return new Menu(
    () => {
      const w: Widget[] = [];
      for (const s of h.saves.slots) {
        const slot = s.slot + 1;
        const label = s.empty ? t('menu.slots.empty', { slot }) : s.error ? t('menu.slots.unreadable', { slot }) : t('menu.slots.saved', { slot, level: s.level, depth: s.deepest });
        w.push({
          kind: 'button',
          id: `slot${s.slot}`,
          label,
          onClick: () => h.play({ kind: mode === 'new' || s.empty ? 'new' : 'load', slot: s.slot }),
          accent: mode === 'new' && !s.empty ? 'plum' : 'teal',
          hint: s.empty ? t('menu.slots.hint.start') : mode === 'new' ? t('menu.slots.hint.overwrite') : t('menu.slots.hint.load', { slot }),
        });
      }
      w.push({ kind: 'gap', id: 'g' });
      w.push({ kind: 'choice', id: 'target', label: t('menu.slots.target'), options: [1, 2, 3].map((n) => num(n)), get: () => h.slot, set: (i) => (h.slot = i), hint: t('menu.slots.target.hint') });
      w.push({ kind: 'button', id: 'export', label: t('menu.slots.export'), onClick: () => h.exportSlot(h.slot) });
      w.push({ kind: 'button', id: 'import', label: t('menu.slots.import'), onClick: () => h.importSlot(h.slot) });
      w.push({ kind: 'button', id: 'delete', label: t('menu.slots.delete'), onClick: () => h.deleteSlot(h.slot), accent: 'plum' });
      if (h.saves.volatile) w.push({ kind: 'label', id: 'vol', label: t('menu.slots.volatile'), color: 'orange' });
      // what the browser said (its own words: not a line), in a line
      if (h.saves.lastError) w.push({ kind: 'label', id: 'err', label: t('menu.slots.error', { error: h.saves.lastError }), color: 'red' });
      return w;
    },
    { id: 'slots', title: mode === 'new' ? t('menu.slots.title.new') : t('menu.slots.title.load'), width: 220, onSound: sound(h) },
  );
}

export function devMenu(h: MenuHost): Menu {
  let depth = 1;
  return new Menu(
    () => [
      { kind: 'choice', id: 'depth', label: t('dev.menu.depth'), options: Array.from({ length: 30 }, (_, i) => num(i + 1)), get: () => depth - 1, set: (i) => (depth = i + 1) },
      { kind: 'button', id: 'teleport', label: t('dev.menu.teleport'), onClick: () => h.devTeleport(depth) },
      { kind: 'button', id: 'xp', label: t('dev.menu.xp'), onClick: () => h.devGive('xp') },
      { kind: 'button', id: 'level', label: t('dev.menu.level'), onClick: () => h.devGive('level') },
      { kind: 'button', id: 'gold', label: t('dev.menu.gold', { gold: 500 }), onClick: () => h.devGive('gold') },
      { kind: 'button', id: 'item', label: t('dev.menu.item'), onClick: () => h.devGive('item') },
      { kind: 'button', id: 'killall', label: t('dev.menu.kill_all'), onClick: () => h.devKillAll() },
      { kind: 'button', id: 'spawn', label: t('dev.menu.spawn'), onClick: () => h.devSpawn() },
      { kind: 'toggle', id: 'god', label: t('dev.menu.god'), get: () => h.dev.god, set: (v) => (h.dev.god = v) },
      { kind: 'toggle', id: 'ai', label: t('dev.menu.ai'), get: () => h.dev.ai, set: (v) => (h.dev.ai = v) },
      { kind: 'toggle', id: 'hitboxes', label: t('dev.menu.hitboxes'), get: () => h.dev.hitboxes, set: (v) => (h.dev.hitboxes = v) },
      {
        kind: 'slider',
        id: 'tod',
        label: t('dev.menu.time_of_day'),
        get: () => h.timeOfDay(),
        set: (u) => h.setTimeOfDay(u),
        step: (u, d) => (u + d * 0.05 + 1) % 1,
        format: () => t('dev.menu.time_of_day.value', { hour: Math.floor((h.timeOfDay() * 24 + 6) % 24) }),
      },
    ],
    { id: 'dev', title: t('dev.menu.title'), width: 210, labelWidth: 96, footer: () => t('dev.menu.footer'), onSound: sound(h) },
  );
}

export function riftMenu(h: MenuHost): Menu {
  return new Menu(
    () => {
      const list = h.depths();
      const next = list.find((d) => d.next);
      const done = list.filter((d) => !d.next).reverse().slice(0, 7);
      const w: Widget[] = [];
      if (next) w.push({ kind: 'button', id: `depth${next.depth}`, label: next.title, onClick: () => h.enterDepth(next.depth), accent: 'teal', hint: t('menu.rift.next.hint') });
      if (done.length) w.push({ kind: 'label', id: 'cleared', label: t('menu.rift.cleared'), color: 'slate' });
      for (const d of done) w.push({ kind: 'button', id: `depth${d.depth}`, label: d.best ? t('menu.rift.best', { level: d.title, time: formatTime(d.best) }) : d.title, onClick: () => h.enterDepth(d.depth), hint: t('menu.rift.done.hint') });
      return w;
    },
    { id: 'rift', title: t('menu.rift.title'), width: 230, onSound: sound(h) },
  );
}
