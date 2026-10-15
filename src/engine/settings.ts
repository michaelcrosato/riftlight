import { RESOLUTIONS, type Resolution } from './framing';
import type { QualityOption } from './quality';
import { LOOK_PRESETS, type Look } from './render/look';
import type { RenderMode } from './render/PixelRenderer';

/**
 * The player's settings: the standard picture and engine options every game gets, as plain data
 * (sound is the AudioManager's, which keeps its own volumes). A field left out is the game's own
 * choice; a field set is the player's and wins over it. `engine.settings` holds them, applies
 * them, saves them per game and shows them in the settings panel (the ⚙ button).
 */
export interface PlayerSettings {
  /** A LOOK_PRESETS name. Left out: the look the game gives each level. */
  look?: string;
  /** Pixel art (the pixel pass), or false for smooth 3D (render mode `raw`). */
  pixelArt?: boolean;
  /** The art resolution: `fine` (the game's, 480×270 by default) or `chunky` (two thirds of it: bigger pixels). */
  pixelSize?: 'fine' | 'chunky';
  /** Shadow and light quality: a level, or `auto` (the device's). */
  quality?: QualityOption;
  /** Frame cap: 60, 30, or 0 for the display's own rate. */
  fps?: number;
  /** The debug panel: frame rate, camera, GPU errors and the game's status. */
  debugInfo?: boolean;
}

const SETTING_FIELDS = ['look', 'pixelArt', 'pixelSize', 'quality', 'fps', 'debugInfo'] as const satisfies readonly (keyof PlayerSettings)[];
export const PIXEL_SIZES = ['fine', 'chunky'] as const;
export const QUALITY_OPTIONS: readonly QualityOption[] = ['auto', 'low', 'medium', 'high'];
export const FPS_OPTIONS: readonly number[] = [60, 30, 0];

/** Keep only fields with a valid value: what storage or a caller handed over may be anything. */
export function normalizeSettings(raw: unknown): PlayerSettings {
  const out: PlayerSettings = {};
  if (!raw || typeof raw !== 'object') return out;
  const v = raw as Record<string, unknown>;
  if (typeof v.look === 'string' && Object.hasOwn(LOOK_PRESETS, v.look)) out.look = v.look;
  if (typeof v.pixelArt === 'boolean') out.pixelArt = v.pixelArt;
  if (v.pixelSize === 'fine' || v.pixelSize === 'chunky') out.pixelSize = v.pixelSize;
  if (QUALITY_OPTIONS.includes(v.quality as QualityOption)) out.quality = v.quality as QualityOption;
  if (typeof v.fps === 'number' && FPS_OPTIONS.includes(v.fps)) out.fps = v.fps;
  if (typeof v.debugInfo === 'boolean') out.debugInfo = v.debugInfo;
  return out;
}

const storageKey = (key: string) => `pixel-engine:settings:${key}`;

/** The settings saved under `key` ({} when there are none, or storage is blocked or holds junk). */
export function loadSettings(key: string): PlayerSettings {
  try {
    return normalizeSettings(JSON.parse(globalThis.localStorage?.getItem(storageKey(key)) ?? 'null'));
  } catch {
    return {};
  }
}

export function storeSettings(key: string, settings: PlayerSettings): void {
  try {
    if (Object.keys(settings).length) globalThis.localStorage?.setItem(storageKey(key), JSON.stringify(settings));
    else globalThis.localStorage?.removeItem(storageKey(key));
  } catch {
    /* storage blocked: the settings last for this session */
  }
}

/** The engine options a page URL's review flags set (what `optionsFromUrl` gives). */
export type UrlFlags = { look?: unknown; filters?: unknown; mode?: unknown; resolution?: unknown; quality?: unknown; maxFps?: unknown; debugUI?: unknown };

/**
 * The settings a page URL's review flags set (`?look=`, `?filters=`, `?mode=`, `?res=`,
 * `?quality=`, `?fps=`, `?debug=`): the fields `url` (optionsFromUrl) holds that the game's
 * `options` took (`withUrlOptions`). They win over the saved ones at start.
 */
export function urlSettings(url: UrlFlags, options: UrlFlags = url): Set<keyof PlayerSettings> {
  const took = (k: keyof UrlFlags) => url[k] !== undefined && JSON.stringify(options[k]) === JSON.stringify(url[k]);
  const out = new Set<keyof PlayerSettings>();
  if (took('look') || took('filters')) out.add('look');
  if (took('mode')) out.add('pixelArt');
  if (took('resolution')) out.add('pixelSize');
  if (took('quality')) out.add('quality');
  if (took('maxFps')) out.add('fps');
  if (took('debugUI')) out.add('debugInfo');
  return out;
}

/** Chunky pixels for a resolution: the engine's 320×180 for its 480×270, else two thirds of it. */
export function chunkyResolution(base: Resolution): Resolution {
  if (base.width === RESOLUTIONS.default.width && base.height === RESOLUTIONS.default.height) return RESOLUTIONS.compare;
  return { width: Math.round((base.width * 2) / 3), height: Math.round((base.height * 2) / 3) };
}

/** What the settings change in the engine (Engine implements it; tests pass a fake). */
export interface SettingsHost {
  readonly look: Look;
  setLook(look: Look): void;
  readonly renderer: { readonly mode: RenderMode; readonly baseResolution: Resolution; readonly lookVersion: number; setMode(mode: RenderMode): void; setResolution(resolution: Resolution): void };
  maxFps: number;
  readonly qualityOption: QualityOption;
  useQuality(option: QualityOption): void;
  readonly debugShown: boolean;
  showDebug(on: boolean): void;
}

/** The game's own choices, which a field left out (or reset) gives back. */
interface GameChoices {
  look: Look;
  mode: RenderMode;
  resolution: Resolution;
  quality: QualityOption;
  fps: number;
  debug: boolean;
}

/**
 * `engine.settings`: the player's settings, applied to the engine and saved. A field the page URL
 * sets (`?look=`, `?mode=`, `?res=`, `?quality=`, `?fps=`, `?debug=`: review flags) wins over a
 * saved one at start (which stays saved). `open`, `close` and `toggle` show and hide the
 * settings panel.
 */
export class Settings {
  /** The player's choices: the saved ones from the start, and a game's `set()` before it. */
  private current: PlayerSettings;
  /** Saved choices a review flag in the URL overrides: not applied, still saved. */
  private held: PlayerSettings = {};
  private game: GameChoices | null = null;
  private readonly listeners = new Set<(values: Readonly<PlayerSettings>) => void>();
  private shown = false;
  /** `host.renderer.lookVersion` once the settings last set the look: unchanged, nothing else did since. */
  private lookShown = -1;
  /**
   * @internal Changes are saved. The engine turns this off while a replay plays: the recording
   * sets what it set, nothing is written, and the player's settings come back after (`replace`).
   */
  persist = true;
  /**
   * @internal The panel's hooks, which the engine wires (until then the settings stay shut).
   * `onOpen` returning false keeps them shut: the engine does while a replay plays.
   */
  onOpen: () => boolean | void = () => false;
  /** @internal */
  onClose: () => void = () => {};

  /** `key`: where they are saved (`pixel-engine:settings:<key>`), or null for nowhere. */
  constructor(
    private readonly host: SettingsHost,
    readonly key: string | null,
  ) {
    this.current = key === null ? {} : loadSettings(key);
  }

  /** The player's choices in effect: fields left out are the game's (or a review flag's). */
  get values(): Readonly<PlayerSettings> {
    return { ...this.current };
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /**
   * @internal Engine, once the first level is set up: note the game's own choices, then apply the
   * player's, except the fields `skip` names (the ones the URL set: held aside, still saved).
   */
  start(skip: ReadonlySet<keyof PlayerSettings> = new Set()): void {
    const h = this.host;
    this.game = { look: h.look, mode: h.renderer.mode, resolution: h.renderer.baseResolution, quality: h.qualityOption, fps: h.maxFps, debug: h.debugShown };
    for (const field of skip) {
      if (!(field in this.current)) continue;
      Object.assign(this.held, { [field]: this.current[field] });
      delete this.current[field];
    }
    this.apply(this.current);
  }

  /**
   * @internal Engine, after each new level's setup: a look the level set is the game's now, and a
   * chosen look wins over it again. The look carries over between levels, so a level that set none
   * still shows the chosen one, and the game's stays what it was.
   */
  levelStarted(): void {
    if (!this.game) return;
    if (this.current.look && this.host.renderer.lookVersion === this.lookShown) return; // nothing set a look since the player's
    this.game.look = this.host.look;
    if (this.current.look) this.apply(this.current, ['look']);
  }

  /** Change some settings: applied at once and saved. A field set to `undefined` goes back to the game's. */
  set(patch: PlayerSettings): void {
    const valid = normalizeSettings(patch);
    const next: PlayerSettings = { ...this.current };
    const touched: (keyof PlayerSettings)[] = [];
    for (const field of Object.keys(patch) as (keyof PlayerSettings)[]) {
      if (field in valid) Object.assign(next, { [field]: valid[field] });
      else if (patch[field] === undefined) {
        if (!(field in next)) continue; // already the game's
        delete next[field];
      } else continue; // an invalid value changes nothing
      touched.push(field);
    }
    if (!touched.length) return;
    this.current = next;
    if (this.persist) for (const field of touched) delete this.held[field]; // a new choice replaces a held one
    if (this.game) this.apply(next, touched); // before the start, start() applies them
    this.save();
    for (const fn of this.listeners) fn(this.values);
  }

  /** Forget every choice, the held ones too: the game's own picture again. */
  reset(): void {
    if (this.persist) this.held = {};
    this.replace({});
    this.save();
  }

  /** Make `values` the settings, changing only the fields that differ: the ones it leaves out go back to the game's. */
  replace(values: PlayerSettings): void {
    const v = normalizeSettings(values);
    const patch = Object.fromEntries(SETTING_FIELDS.filter((f) => v[f] !== this.current[f]).map((f) => [f, v[f]]));
    if (Object.keys(patch).length) this.set(patch as PlayerSettings);
  }

  /** Called with the values after every change; returns the unsubscribe. */
  onChange(fn: (values: Readonly<PlayerSettings>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  open(): void {
    if (this.shown || this.onOpen() === false) return;
    this.shown = true;
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.onClose();
  }

  toggle(): void {
    if (this.shown) this.close();
    else this.open();
  }

  private save(): void {
    if (this.key !== null && this.persist) storeSettings(this.key, { ...this.held, ...this.current });
  }

  /** Put each field of `s` into the engine; `fields` also lists cleared ones (back to the game's). */
  private apply(s: PlayerSettings, fields: (keyof PlayerSettings)[] = Object.keys(s) as (keyof PlayerSettings)[]): void {
    const h = this.host;
    const g = this.game!;
    for (const field of fields) {
      switch (field) {
        case 'look':
          h.setLook(s.look ? LOOK_PRESETS[s.look]! : g.look);
          this.lookShown = h.renderer.lookVersion;
          break;
        case 'pixelArt':
          h.renderer.setMode(s.pixelArt === undefined ? g.mode : s.pixelArt ? 'pixel' : 'raw');
          break;
        case 'pixelSize':
          h.renderer.setResolution(s.pixelSize === 'chunky' ? chunkyResolution(g.resolution) : g.resolution);
          break;
        case 'quality':
          h.useQuality(s.quality ?? g.quality);
          break;
        case 'fps':
          h.maxFps = s.fps ?? g.fps;
          break;
        case 'debugInfo':
          h.showDebug(s.debugInfo ?? g.debug);
          break;
      }
    }
  }
}
