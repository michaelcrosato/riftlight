/**
 * Every menu in the shell, as widget data (ui/menu.ts): title, pause, tuning (the
 * difficulty sliders), settings and their engine page, save slots, dev tools and the rift
 * keeper's depth list.
 * They talk to the game through `MenuHost`, which `Riftlight` implements.
 */
import { FPS_OPTIONS, LOOK_PRESETS, lookPresetLabel, PIXEL_SIZES, type AudioManager, type Engine, type QualityLevel } from '../../engine';
import type { DifficultyTuning } from '../core/types';
import {
  DIFFICULTY_KEYS,
  DIFFICULTY_LABELS,
  DIFFICULTY_PRESETS,
  type DifficultyPreset,
  multiplierToSlider,
  NORMAL,
  nudge,
  presetOf,
  sliderToMultiplier,
} from '../game/difficulty';
import type { DevFlags } from '../game/ports';
import type { SavesView } from '../game/save';
import type { Settings } from '../game/settings';
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
  engineWorld?(room?: string): void;
}

const sound = (h: MenuHost) => (s: 'click' | 'move') => h.sound(s);

export function titleMenu(h: MenuHost): Menu {
  return new Menu(
    () => {
      const last = h.saves.last;
      const w: Widget[] = [];
      if (last !== null) w.push({ kind: 'button', id: 'continue', label: 'Continue', onClick: () => h.play({ kind: 'continue' }), accent: 'teal' });
      w.push({ kind: 'button', id: 'new', label: 'New Run', onClick: () => h.openMenu(slotsMenu(h, 'new')) });
      w.push({ kind: 'button', id: 'load', label: 'Load / Import', onClick: () => h.openMenu(slotsMenu(h, 'load')) });
      w.push({ kind: 'button', id: 'settings', label: 'Settings', onClick: () => h.openMenu(settingsMenu(h)) });
      if (h.engineWorld) w.push({ kind: 'button', id: 'world', label: 'Engine World', onClick: () => h.engineWorld!(), hint: 'the engine\'s tech demo: a room per technique' });
      if (h.engineWorld) w.push({ kind: 'button', id: 'gallery', label: 'Asset Gallery', onClick: () => h.engineWorld!('gallery'), hint: 'every model and texture, one at a time' });
      return w;
    },
    { id: 'title', title: 'Riftlight', width: 130, onSound: sound(h) },
  );
}

export function pauseMenu(h: MenuHost): Menu {
  return new Menu(
    [
      { kind: 'button', id: 'resume', label: 'Resume', onClick: () => h.resume() },
      { kind: 'button', id: 'tuning', label: 'Tuning', onClick: () => h.openMenu(tuningMenu(h)), hint: 'difficulty sliders' },
      { kind: 'button', id: 'inventory', label: 'Inventory', onClick: () => h.openPanel('inventory'), hint: 'items and gear (I)' },
      { kind: 'button', id: 'skills', label: 'Skills', onClick: () => h.openPanel('skills'), hint: 'gems in the skill slots (G)' },
      { kind: 'button', id: 'tree', label: 'Passive tree', onClick: () => h.openPanel('tree'), hint: 'spend passive points (P)' },
      { kind: 'button', id: 'character', label: 'Character', onClick: () => h.openPanel('character'), hint: 'stats and where they come from (C)' },
      { kind: 'button', id: 'settings', label: 'Settings', onClick: () => h.openMenu(settingsMenu(h)) },
      ...(h.lookStudio ? [{ kind: 'button' as const, id: 'look', label: 'Look studio', onClick: () => h.lookStudio!(), hint: 'pixel, cel, palettes... per layer (L)' }] : []),
      ...(h.photoMode ? [{ kind: 'button' as const, id: 'photo', label: 'Photo mode', onClick: () => h.photoMode!(), hint: 'free camera, filters, save a PNG (O)' }] : []),
      { kind: 'button', id: 'dev', label: 'Dev', onClick: () => h.openMenu(devMenu(h)), hint: 'debug and agent tools' },
      { kind: 'gap', id: 'g' },
      { kind: 'button', id: 'quit', label: 'Save & Quit', onClick: () => h.saveAndQuit(), accent: 'plum' },
    ],
    { id: 'pause', title: 'Paused', width: 140, onBack: () => h.resume(), onSound: sound(h) },
  );
}

const PRESETS: DifficultyPreset[] = ['story', 'normal', 'hard', 'nightmare'];

export function tuningMenu(h: MenuHost): Menu {
  const set = (k: (typeof DIFFICULTY_KEYS)[number], v: number) => h.setDifficulty({ ...h.difficulty(), [k]: v });
  return new Menu(
    () => {
      const t = h.difficulty();
      const preset = presetOf(t);
      const w: Widget[] = [
        {
          kind: 'choice',
          id: 'preset',
          label: 'Preset',
          options: [...PRESETS.map((p) => p), 'custom'],
          get: () => (preset ? PRESETS.indexOf(preset) : PRESETS.length),
          set: (i) => i < PRESETS.length && h.setDifficulty({ ...DIFFICULTY_PRESETS[PRESETS[i]!] }),
          hint: 'story / normal / hard / nightmare',
        },
        { kind: 'gap', id: 'g1', h: 3 },
      ];
      for (const k of DIFFICULTY_KEYS) {
        if (k === 'enemyDamage') w.push({ kind: 'gap', id: 'g2', h: 4 });
        w.push({
          kind: 'slider',
          id: k,
          label: DIFFICULTY_LABELS[k],
          get: () => multiplierToSlider(h.difficulty()[k]),
          set: (u) => set(k, sliderToMultiplier(u)),
          step: (_u, dir) => multiplierToSlider(nudge(h.difficulty()[k], dir)),
          format: () => `${h.difficulty()[k].toFixed(2)}x`,
          changed: () => h.difficulty()[k] !== 1,
          hint: '0.25x to 4x, applied as a difficulty mod',
        });
      }
      w.push({ kind: 'gap', id: 'g3', h: 4 }, { kind: 'button', id: 'reset', label: 'Reset to 1.0', onClick: () => h.setDifficulty({ ...NORMAL }) });
      return w;
    },
    { id: 'tuning', title: 'Tuning', width: 230, labelWidth: 96, onSound: sound(h) },
  );
}

/** The settings' looks: the default, every named look, and the studio's custom one once there is one. */
const looks = (s: Settings) => ['', ...Object.keys(LOOK_PRESETS).filter((n) => n !== 'none'), ...(s.customLook ? ['custom'] : [])];
const lookLabel = (l: string) => (l ? lookPresetLabel(l) : 'default');
const QUALITIES: (QualityLevel | 'auto')[] = ['auto', 'low', 'medium', 'high'];
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function settingsMenu(h: MenuHost): Menu {
  const s = h.settings;
  const vol = (ch: 'master' | 'music' | 'sfx', label: string): Widget => ({
    kind: 'slider',
    id: `vol.${ch}`,
    label,
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
      vol('master', 'Master volume'),
      vol('music', 'Music'),
      vol('sfx', 'Sound effects'),
      { kind: 'choice', id: 'quality', label: 'Quality', options: QUALITIES, get: () => QUALITIES.indexOf(s.quality), set: (i) => change(() => (s.quality = QUALITIES[i]!))() },
      { kind: 'choice', id: 'look', label: 'Look', options: looks(s).map(lookLabel), get: () => Math.max(0, looks(s).indexOf(s.look)), set: (i) => change(() => (s.look = looks(s)[i]!))(), hint: 'pixel art and filters' },
      ...(h.lookStudio ? [{ kind: 'button' as const, id: 'studio', label: 'Look studio', onClick: () => h.lookStudio!(), hint: 'filters per layer, presets and sliders' }] : []),
      {
        kind: 'slider',
        id: 'zoom',
        label: 'Camera zoom',
        get: () => (s.zoom - 0.6) / 1,
        set: (u) => change(() => (s.zoom = Math.round((0.6 + u) * 20) / 20))(),
        step: (u, d) => Math.min(1, Math.max(0, u + d * 0.05)),
        format: () => `${s.zoom.toFixed(2)}x`,
        changed: () => s.zoom !== 1,
      },
      { kind: 'toggle', id: 'numbers', label: 'Damage numbers', get: () => s.damageNumbers, set: (v) => change(() => (s.damageNumbers = v))() },
      { kind: 'choice', id: 'filter', label: 'Loot filter', options: ['show all', 'hide normal', 'rares only'], get: () => s.lootFilter, set: (i) => change(() => (s.lootFilter = i))() },
      { kind: 'slider', id: 'shake', label: 'Screen shake', get: () => s.screenShake, set: (u) => change(() => (s.screenShake = Math.round(u * 20) / 20))(), step: (u, d) => Math.min(1, Math.max(0, u + d * 0.1)), format: () => pct(s.screenShake) },
      { kind: 'choice', id: 'glyphs', label: 'Prompts', options: ['auto', 'keyboard', 'controller'], get: () => ['auto', 'keyboard', 'controller'].indexOf(s.glyphs), set: (i) => change(() => (s.glyphs = (['auto', 'keyboard', 'controller'] as const)[i]!))() },
      { kind: 'button', id: 'engine', label: 'Engine', onClick: () => h.openMenu(engineMenu(h)), hint: 'pixel art, pixel size, frame rate, sound, debug info' },
    ],
    { id: 'settings', title: 'Settings', width: 240, labelWidth: 104, onSound: sound(h) },
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
      { kind: 'toggle', id: 'pixelArt', label: 'Pixel art', get: () => e.renderer.mode === 'pixel', set: (v) => e.settings.set({ pixelArt: v }), hint: 'off: smooth 3D, without the look' },
      { kind: 'choice', id: 'pixelSize', label: 'Pixel size', options: [...PIXEL_SIZES], get: () => PIXEL_SIZES.indexOf(size()), set: (i) => e.settings.set({ pixelSize: PIXEL_SIZES[i] }) },
      { kind: 'choice', id: 'fps', label: 'Frame rate', options: FPS_OPTIONS.map((f) => (f ? `${f} fps` : 'screen')), get: () => Math.max(0, FPS_OPTIONS.indexOf(e.maxFps)), set: (i) => e.settings.set({ fps: FPS_OPTIONS[i] }) },
      { kind: 'toggle', id: 'sound', label: 'Sound', get: () => !h.audio.muted, set: (v) => h.audio.setMuted(!v) },
      { kind: 'toggle', id: 'debugInfo', label: 'Debug info', get: () => e.debugShown, set: (v) => e.settings.set({ debugInfo: v }), hint: 'frame rate, camera, GPU errors' },
    ],
    { id: 'engine', title: 'Engine', width: 240, labelWidth: 104, onSound: sound(h) },
  );
}

export function slotsMenu(h: MenuHost, mode: 'new' | 'load'): Menu {
  return new Menu(
    () => {
      const w: Widget[] = [];
      for (const s of h.saves.slots) {
        const label = s.empty ? `Slot ${s.slot + 1}: empty` : s.error ? `Slot ${s.slot + 1}: unreadable` : `Slot ${s.slot + 1}: lv ${s.level} deepest ${s.deepest}`;
        w.push({
          kind: 'button',
          id: `slot${s.slot}`,
          label,
          onClick: () => h.play({ kind: mode === 'new' || s.empty ? 'new' : 'load', slot: s.slot }),
          accent: mode === 'new' && !s.empty ? 'plum' : 'teal',
          hint: mode === 'new' ? (s.empty ? 'start a new run here' : 'overwrites this save!') : s.empty ? 'start a new run here' : `load slot ${s.slot + 1}`,
        });
      }
      w.push({ kind: 'gap', id: 'g' });
      w.push({ kind: 'choice', id: 'target', label: 'Slot', options: ['1', '2', '3'], get: () => h.slot, set: (i) => (h.slot = i), hint: 'slot for export / import / delete' });
      w.push({ kind: 'button', id: 'export', label: 'Export slot as JSON', onClick: () => h.exportSlot(h.slot) });
      w.push({ kind: 'button', id: 'import', label: 'Import JSON into slot', onClick: () => h.importSlot(h.slot) });
      w.push({ kind: 'button', id: 'delete', label: 'Delete slot', onClick: () => h.deleteSlot(h.slot), accent: 'plum' });
      if (h.saves.volatile) w.push({ kind: 'label', id: 'vol', label: 'storage blocked: saves last this session', color: 'orange' });
      if (h.saves.lastError) w.push({ kind: 'label', id: 'err', label: h.saves.lastError.slice(0, 40), color: 'red' });
      return w;
    },
    { id: 'slots', title: mode === 'new' ? 'New run: pick a slot' : 'Save slots', width: 220, onSound: sound(h) },
  );
}

export function devMenu(h: MenuHost): Menu {
  let depth = 1;
  return new Menu(
    () => [
      { kind: 'choice', id: 'depth', label: 'Depth', options: Array.from({ length: 30 }, (_, i) => String(i + 1)), get: () => depth - 1, set: (i) => (depth = i + 1) },
      { kind: 'button', id: 'teleport', label: 'Teleport to depth', onClick: () => h.devTeleport(depth) },
      { kind: 'button', id: 'xp', label: 'Give XP', onClick: () => h.devGive('xp') },
      { kind: 'button', id: 'level', label: 'Give a level', onClick: () => h.devGive('level') },
      { kind: 'button', id: 'gold', label: 'Give 500 gold', onClick: () => h.devGive('gold') },
      { kind: 'button', id: 'item', label: 'Give an item', onClick: () => h.devGive('item') },
      { kind: 'button', id: 'killall', label: 'Kill all', onClick: () => h.devKillAll() },
      { kind: 'button', id: 'spawn', label: 'Spawn monster', onClick: () => h.devSpawn() },
      { kind: 'toggle', id: 'god', label: 'God mode', get: () => h.dev.god, set: (v) => (h.dev.god = v) },
      { kind: 'toggle', id: 'ai', label: 'Monster AI', get: () => h.dev.ai, set: (v) => (h.dev.ai = v) },
      { kind: 'toggle', id: 'hitboxes', label: 'Hitboxes', get: () => h.dev.hitboxes, set: (v) => (h.dev.hitboxes = v) },
      {
        kind: 'slider',
        id: 'tod',
        label: 'Time of day',
        get: () => h.timeOfDay(),
        set: (u) => h.setTimeOfDay(u),
        step: (u, d) => (u + d * 0.05 + 1) % 1,
        format: () => `${Math.floor(((h.timeOfDay() * 24 + 6) % 24))}H`,
      },
    ],
    { id: 'dev', title: 'Dev tools', width: 210, labelWidth: 96, footer: () => 'window.__RIFTLIGHT__ for agents', onSound: sound(h) },
  );
}

export function riftMenu(h: MenuHost): Menu {
  return new Menu(
    () => {
      const list = h.depths();
      const next = list.find((d) => d.next);
      const done = list.filter((d) => !d.next).reverse().slice(0, 7);
      const w: Widget[] = [];
      if (next) w.push({ kind: 'button', id: `depth${next.depth}`, label: `${next.title}`, onClick: () => h.enterDepth(next.depth), accent: 'teal', hint: 'deeper: new territory' });
      if (done.length) w.push({ kind: 'label', id: 'cleared', label: 'cleared', color: 'slate' });
      for (const d of done) w.push({ kind: 'button', id: `depth${d.depth}`, label: `${d.title}${d.best ? `  ${fmt(d.best)}` : ''}`, onClick: () => h.enterDepth(d.depth), hint: 'replay for loot and xp' });
      return w;
    },
    { id: 'rift', title: 'The Rift Obelisk', width: 230, onSound: sound(h) },
  );
}

function fmt(s: number): string {
  const v = Math.round(s);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
