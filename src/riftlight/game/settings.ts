/**
 * Player settings that belong to the device, not the save slot: look (a preset or the look
 * studio's custom one), quality, camera zoom, damage numbers, loot filter, screen shake,
 * prompt glyphs. Volumes live in the engine's AudioManager (it persists them itself).
 * Stored in localStorage under `riftlight:settings`.
 */
import type { QualityLevel } from '../../engine';
import { type Look, LOOK_PRESETS, normalizeLook } from '../../engine/render/look';
import type { ShellSettings } from './ports';

export interface Settings extends ShellSettings {
  /** LOOK_PRESETS name, `custom` (the look studio's `customLook`), or '' for the default. */
  look: string;
  /** The look built in the look studio (per-layer pixel art and filters). */
  customLook: Look | null;
  quality: QualityLevel | 'auto';
  /** Multiplies the stage zoom (0.6..1.6). */
  zoom: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  damageNumbers: true,
  lootFilter: 0,
  screenShake: 0.7,
  glyphs: 'auto',
  look: '',
  customLook: null,
  quality: 'auto',
  zoom: 1,
};

const KEY = 'riftlight:settings';

export function loadSettings(): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    if (raw && typeof raw === 'object') {
      if (typeof raw.damageNumbers === 'boolean') out.damageNumbers = raw.damageNumbers;
      if (typeof raw.lootFilter === 'number') out.lootFilter = Math.max(0, Math.min(2, Math.round(raw.lootFilter)));
      if (typeof raw.screenShake === 'number') out.screenShake = Math.max(0, Math.min(1, raw.screenShake));
      if (raw.glyphs === 'auto' || raw.glyphs === 'keyboard' || raw.glyphs === 'controller') out.glyphs = raw.glyphs;
      if (raw.customLook && typeof raw.customLook === 'object') out.customLook = normalizeLook(raw.customLook);
      if (typeof raw.look === 'string' && (raw.look === '' || Object.hasOwn(LOOK_PRESETS, raw.look) || (raw.look === 'custom' && out.customLook))) out.look = raw.look;
      if (raw.quality === 'auto' || raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high') out.quality = raw.quality;
      if (typeof raw.zoom === 'number') out.zoom = Math.max(0.6, Math.min(1.6, raw.zoom));
    }
  } catch {
    /* storage blocked or corrupt: defaults */
  }
  return out;
}

export function storeSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for the session */
  }
}
