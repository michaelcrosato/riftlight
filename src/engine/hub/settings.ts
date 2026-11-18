/**
 * The player's 52in1 settings: `window.AIHubSettings`, which the hub's companion script puts in a
 * game's page from its first script on (AI Hub Catalogue v1, *Settings and the DualSense*). Outside
 * 52in1, headless and in Node there is none, and every value is its default (`NO_HUB_SETTINGS`): the
 * game plays as it does on its own page.
 *
 * The engine applies the volumes itself (`AudioManager.setHubVolumes`: music × `music`, every other
 * sound × `effects`, never a master volume of the hub's, nothing stored) and hands a game the rest
 * as `engine.hubSettings` (the microphone's gate, the vibration) and `ctx.dualsense` (the
 * controller's extras, src/engine/hub/dualsense.ts). docs/engine/hub.md *The player's settings*.
 *
 * Never read `dualsense.gyro`, `accel` or `touches` here. They are input, and input reaches a game
 * through `ctx.input` (recorded): `hubPadInput` hands them to `input.dualsense`, which reads them only
 * while a game asks (its motion aim on, its touchpad on). Reading the gyro or `accel` also holds the
 * hub's own Motion aim off the right stick until half a second after the last read, and any of the
 * three has the hub send the controller's motion every frame; reading `touches` takes nothing from
 * the hub's Motion aim.
 */
import type { DualSenseInput } from '../input';

/** The DualSense's extras the player allows games (all false while none is connected). */
export interface DualSenseFlags {
  /** A DualSense is connected and the player has its extras on for games. */
  readonly connected: boolean;
  /** The game may colour the light bar (`ctx.dualsense.light`). */
  readonly lightbar: boolean;
  /** The adaptive triggers push back (`ctx.dualsense.trigger`). */
  readonly triggers: boolean;
  /** `gyro` and `accel` move. */
  readonly motion: boolean;
  /** `touches` holds the fingers on the touchpad. */
  readonly touchpad: boolean;
  /** The controller's speaker can play sounds (the `speaker` bus, `AudioManager`). */
  readonly speaker: boolean;
  /** The hub's Motion aim adds the controller's turns to the right stick (no code needed). */
  readonly aim: boolean;
}

/** The player's settings, as plain data (`readHubSettings`). */
export interface HubSettingsValues {
  /** The player's music volume, 0..1: the engine multiplies the music bus by it. */
  readonly music: number;
  /** The volume of every other sound, voices included, 0..1: the sfx bus. */
  readonly effects: number;
  /** How strongly the controller vibrates, 0 (off) to 1: the hub scales every rumble by it itself. */
  readonly vibration: number;
  /** The player has allowed games the microphone (before this game was opened). */
  readonly mic: boolean;
  /** The player allowed it after this game was opened: it reaches the game once it is opened again. */
  readonly micLater: boolean;
  /** The DualSense's mute button has the microphone off. */
  readonly muted: boolean;
  readonly dualsense: DualSenseFlags;
}

/** The two trigger sides, or both at once. */
export type TriggerSide = 'left' | 'right' | 'both';

/**
 * An adaptive trigger effect (catalogue *The DualSense*), its numbers 0..1 of the trigger's travel
 * and force: `resist` pushes back from `from` to the end (a pedal, a bowstring), `weapon` pushes
 * back from `from` and gives way at `to` (a gun's trigger), `vibrate` buzzes from `from` on,
 * `frequency` times a second (1..255: a machine gun, rough ground).
 */
export type TriggerEffect =
  | { readonly kind: 'resist'; readonly from: number; readonly strength: number }
  | { readonly kind: 'weapon'; readonly from: number; readonly to: number; readonly strength: number }
  | { readonly kind: 'vibrate'; readonly from: number; readonly strength: number; readonly frequency: number };

/** `AIHubSettings.dualsense` as the hub gives it: the parts the engine uses. */
export interface HubDualSenseSource extends Partial<DualSenseFlags> {
  /**
   * How fast the controller turns, degrees a second. While a game reads it (every poll), the hub's own
   * Motion aim leaves the stick alone; half a second after the reads stop it has the stick back
   * (`hubPadInput` only).
   */
  readonly gyro?: { readonly x: number; readonly y: number; readonly z: number };
  /** The fingers on the touchpad, at most two, `x` and `y` 0..1 from its top left; reading them takes nothing from the hub's Motion aim (`hubPadInput` only). */
  readonly touches?: readonly { readonly id: number; readonly x: number; readonly y: number }[];
  light?(colour: string | null): void;
  trigger?(which: TriggerSide, effect: TriggerEffect | null): void;
  /** A node in `context` that plays from the controller's speaker, or null. */
  openSpeaker?(context: AudioContext): Promise<AudioNode | null>;
}

/** `window.AIHubSettings` as the hub gives it (tests pass a plain object or an `EventTarget`). */
export interface HubSettingsSource {
  readonly music?: number;
  readonly effects?: number;
  readonly vibration?: number;
  readonly mic?: boolean;
  readonly micLater?: boolean;
  readonly muted?: boolean;
  readonly dualsense?: HubDualSenseSource | null;
  /** A microphone stream once the player allowed games the microphone, else null. */
  openMicrophone?(): Promise<MediaStream | null>;
  addEventListener?(type: 'change', fn: () => void): void;
  removeEventListener?(type: 'change', fn: () => void): void;
}

const NO_DUALSENSE: DualSenseFlags = Object.freeze({ connected: false, lightbar: false, triggers: false, motion: false, touchpad: false, speaker: false, aim: false });

/** The settings outside 52in1: full volumes, full vibration, no microphone, no DualSense extras. */
export const NO_HUB_SETTINGS: HubSettingsValues = Object.freeze({ music: 1, effects: 1, vibration: 1, mic: false, micLater: false, muted: false, dualsense: NO_DUALSENSE });

/** The page's `window.AIHubSettings`, or null (outside 52in1, headless, in Node). */
export function hubSettingsSource(): HubSettingsSource | null {
  const s = (globalThis as { AIHubSettings?: unknown }).AIHubSettings;
  return s && typeof s === 'object' ? (s as HubSettingsSource) : null;
}

/** A volume held to 0..1; anything that is not a number is `fallback`. */
const unit = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);

/**
 * The player's settings from `source` as plain data, each missing or broken value its default
 * (`NO_HUB_SETTINGS`). Reads only the named flags of `dualsense`, never its motion or touches.
 */
export function readHubSettings(source: HubSettingsSource | null | undefined = hubSettingsSource()): HubSettingsValues {
  if (!source) return NO_HUB_SETTINGS;
  const d = source.dualsense && typeof source.dualsense === 'object' ? source.dualsense : null;
  const connected = d?.connected === true;
  const flag = (v: unknown) => connected && v === true;
  return {
    music: unit(source.music, 1),
    effects: unit(source.effects, 1),
    vibration: unit(source.vibration, 1),
    mic: source.mic === true,
    micLater: source.micLater === true,
    muted: source.muted === true,
    dualsense: connected
      ? { connected, lightbar: flag(d.lightbar), triggers: flag(d.triggers), motion: flag(d.motion), touchpad: flag(d.touchpad), speaker: flag(d.speaker), aim: flag(d.aim) }
      : NO_DUALSENSE,
  };
}

/**
 * The player's 52in1 settings while the game runs (`engine.hubSettings`): read once at start and
 * again on the hub's `change` event (the player can open the hub's Settings over the game). Never
 * stored and never recorded: they are the player's, outside the game.
 */
export class HubSettings {
  private current: HubSettingsValues;
  private readonly listeners = new Set<(values: HubSettingsValues) => void>();
  private readonly onSourceChange = () => this.refresh();
  private disposed = false;

  /**
   * `source`: default the page's `window.AIHubSettings` (null outside 52in1). `live`: false while
   * a replay plays (the engine's), when nothing is opened for the game.
   */
  constructor(
    readonly source: HubSettingsSource | null = hubSettingsSource(),
    private readonly live: () => boolean = () => true,
  ) {
    this.current = readHubSettings(source);
    source?.addEventListener?.('change', this.onSourceChange);
  }

  /** Inside 52in1: the hub gave the page its settings. */
  get present(): boolean {
    return this.source !== null;
  }

  /** The settings now, as plain data. */
  get values(): HubSettingsValues {
    return this.current;
  }

  /** The player has allowed games the microphone: a voice feature may be turned on. */
  get micAllowed(): boolean {
    return this.current.mic;
  }

  /** Allowed after the game was opened: say to open the game again (the microphone reaches it then). */
  get micLater(): boolean {
    return this.current.micLater;
  }

  /** The DualSense's mute button has the microphone off: a stream is silent. */
  get micMuted(): boolean {
    return this.current.muted;
  }

  /**
   * A microphone stream (the DualSense's when one is plugged in by USB), only once the player has
   * allowed games the microphone in 52in1's Settings; else null, and never asked for: outside
   * 52in1, headless and during a replay too. A voice feature's own setting starts off until then.
   */
  async openMicrophone(): Promise<MediaStream | null> {
    const open = this.source?.openMicrophone;
    if (this.disposed || !this.current.mic || !this.live() || typeof open !== 'function') return null;
    try {
      return (await open.call(this.source)) ?? null;
    } catch {
      return null;
    }
  }

  /** Call `fn` with the new values whenever they change; returns a function that stops it. */
  onChange(fn: (values: HubSettingsValues) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Read the source again and tell the listeners (the hub's `change` event does this). */
  refresh(): void {
    if (this.disposed) return;
    this.current = readHubSettings(this.source);
    for (const fn of [...this.listeners]) fn(this.current);
  }

  /** Stop listening to the hub (the engine's dispose). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.source?.removeEventListener?.('change', this.onSourceChange);
    this.listeners.clear();
  }
}

/** A number, or 0. */
const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/**
 * A DualSense's motion and touchpad from 52in1 (`window.AIHubSettings.dualsense`) for
 * `input.dualsense`: `motion` / `touchpad` say whether the player lets games read them, and
 * `gyro()` / `touches()` read them, only when called (Input calls them on every poll while a game
 * has its motion aim or its touchpad on, and never otherwise: while a game reads the gyro, 52in1's
 * own Motion aim leaves the stick alone, and half a second after it stops it has the stick back).
 * Null values where the hub gives nothing usable.
 */
export function hubPadInput(hub: HubSettings): DualSenseInput {
  const pad = () => {
    const d = hub.source?.dualsense;
    return d && typeof d === 'object' ? d : null;
  };
  return {
    get motion() {
      return hub.values.dualsense.motion;
    },
    get touchpad() {
      return hub.values.dualsense.touchpad;
    },
    gyro: () => {
      const g = pad()?.gyro;
      return g && typeof g === 'object' ? { x: num(g.x), y: num(g.y), z: num(g.z) } : null;
    },
    touches: () => {
      const t = pad()?.touches;
      return Array.isArray(t) ? t.slice(0, 2).map((f) => ({ id: num(f?.id), x: Math.min(1, Math.max(0, num(f?.x))), y: Math.min(1, Math.max(0, num(f?.y))) })) : null;
    },
  };
}
