/**
 * A DualSense's outputs through 52in1 (`ctx.dualsense`): the light bar and the adaptive triggers,
 * each only while the player lets games use it (`AIHubSettings.dualsense`, catalogue *The
 * DualSense*), and the controller's speaker for the AudioManager's `speaker` bus. They are extras:
 * a game plays the same without them. The engine never opens the controller itself
 * (`navigator.hid`): the hub holds it.
 *
 * A game says what it wants, whenever it likes (every frame is fine): the controller is sent only
 * what changed, only while the player allows it, and what was wanted is sent again (a let-go too)
 * when the player turns the extra back on. Letting go is sent even while an extra is off (it is
 * harmless), so a light or trigger given back then is never left stale. Outside 52in1, headless
 * and during a replay nothing is sent (outputs are not recorded). The engine lets the triggers go
 * while it is paused, lets both go and gives the light back when a level unloads, and for good
 * when a round ends or the engine is disposed.
 */
import type { DualSenseFlags, HubSettings, TriggerEffect, TriggerSide } from './settings';

/** What the controller was last sent: null where the hub has it (the light) or a trigger is let go. */
export interface DualSenseSent {
  readonly light: string | null;
  readonly left: TriggerEffect | null;
  readonly right: TriggerEffect | null;
}

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];
type Output = 'light' | Side;

/** `colour` as '#rrggbb' (a '#RRGGBB' string or a 0xRRGGBB number, as PALETTE holds), null for none, undefined when it is neither. */
export function lightColour(colour: string | number | null): string | null | undefined {
  if (colour === null) return null;
  if (typeof colour === 'number') return Number.isInteger(colour) && colour >= 0 && colour <= 0xffffff ? `#${colour.toString(16).padStart(6, '0')}` : undefined;
  return typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : undefined;
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback);

/** `effect` with its numbers in range (null lets go; an unknown kind is undefined). */
export function triggerEffect(effect: TriggerEffect | null): TriggerEffect | null | undefined {
  if (effect === null) return null;
  if (!effect || typeof effect !== 'object') return undefined;
  const from = clamp(effect.from, 0, 1, 0);
  const strength = clamp(effect.strength, 0, 1, 1);
  if (effect.kind === 'resist') return { kind: 'resist', from, strength };
  if (effect.kind === 'weapon') return { kind: 'weapon', from, to: clamp(effect.to, from, 1, 1), strength };
  if (effect.kind === 'vibrate') return { kind: 'vibrate', from, strength, frequency: Math.round(clamp(effect.frequency, 1, 255, 30)) };
  return undefined;
}

const key = (e: TriggerEffect | null): string => (e ? JSON.stringify(e) : '');

export class DualSense {
  /** What the game asked for last. */
  private readonly want: { light: string | null; left: TriggerEffect | null; right: TriggerEffect | null } = { light: null, left: null, right: null };
  private readonly out: { light: string | null; left: TriggerEffect | null; right: TriggerEffect | null } = { light: null, left: null, right: null };
  /**
   * The outputs the hub had since they were last sent (the player had the extra off, or no DualSense
   * was connected): what the controller shows there is not known, so `want` is sent again once
   * the extra is back on, even when it is null.
   */
  private readonly gated = new Set<Output>();
  private held = false;
  private closed = false;
  private readonly warned = new Set<string>();

  /** `live`: false while a replay plays (the engine's): the game's calls are dropped then. */
  constructor(
    private readonly hub: HubSettings,
    private readonly live: () => boolean = () => true,
  ) {
    hub.onChange(() => this.sync());
  }

  /** The extras the player allows games now (all false outside 52in1 or with no DualSense). */
  get flags(): DualSenseFlags {
    return this.hub.values.dualsense;
  }

  /** A DualSense is connected and the player has its extras on for games. */
  get connected(): boolean {
    return this.flags.connected;
  }

  /** What the controller was last sent (tests and tools). */
  get sent(): DualSenseSent {
    return { ...this.out };
  }

  /**
   * Colour the light bar: '#RRGGBB' or a 0xRRGGBB number (`PALETTE.red`); null gives it back to
   * the hub, which glows it in the game's cabinet colour. It should say something: health, the
   * team, a warning. Sent only while the player lets games colour it (giving it back always), and
   * only when it changes.
   */
  light(colour: string | number | null): void {
    if (this.closed || !this.live()) return;
    const c = lightColour(colour);
    if (c === undefined) return this.warn(`light: ${String(colour)} is not '#RRGGBB' or a 0xRRGGBB number`);
    this.want.light = c;
    this.sync();
  }

  /**
   * Push back on L2 (`left`), R2 (`right`) or `both` (`TriggerEffect`); null lets it go. Let a
   * trigger go when its use ends. Sent only while the player has trigger effects on (letting go
   * always; the hub scales `strength` by the player's setting), and only when it changes.
   */
  trigger(which: TriggerSide, effect: TriggerEffect | null): void {
    if (this.closed || !this.live()) return;
    const sides = which === 'both' ? SIDES : which === 'left' || which === 'right' ? [which] : null;
    if (!sides) return this.warn(`trigger: "${String(which)}" is not 'left', 'right' or 'both'`);
    const e = triggerEffect(effect);
    if (e === undefined) return this.warn(`trigger: ${JSON.stringify(effect)} is not a resist, weapon or vibrate effect`);
    for (const side of sides) this.want[side] = e;
    this.sync();
  }

  /**
   * A node in `context` that plays from the controller's speaker while the player allows it, else
   * null (the AudioManager's `speaker` bus then plays with the other sounds).
   */
  async openSpeaker(context: AudioContext): Promise<AudioNode | null> {
    const ds = this.hub.source?.dualsense;
    if (this.closed || !this.flags.speaker || typeof ds?.openSpeaker !== 'function') return null;
    try {
      return (await ds.openSpeaker(context)) ?? null;
    } catch {
      return null;
    }
  }

  /** Let both triggers go and give the light back; what was asked is forgotten (a level unloading). */
  release(): void {
    this.want.light = this.want.left = this.want.right = null;
    this.sync();
  }

  /** Release, and take no more calls (a round's end, the engine's dispose). */
  close(): void {
    this.release();
    this.closed = true;
  }

  /** @internal The engine pauses: the triggers let go until it runs again (the light stays). */
  hold(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    this.sync();
  }

  /**
   * Send the controller what changed between what is wanted (and allowed) and what it has. While an
   * extra is off only a let-go goes (harmless, and the hub may keep what it was sent last); once it
   * is on again what is wanted is sent whatever was sent before.
   */
  private sync(): void {
    const flags = this.flags;
    const ds = this.hub.source?.dualsense;
    if (typeof ds?.light === 'function') {
      const want = this.want.light;
      let send: boolean;
      if (!flags.lightbar) {
        this.gated.add('light'); // the hub has it while games may not colour it: only a let-go goes
        send = want === null && this.out.light !== null;
      } else send = this.gated.delete('light') || want !== this.out.light;
      if (send && this.call('light', () => ds.light!(want))) this.out.light = want;
    }
    if (typeof ds?.trigger !== 'function') return;
    const target = (side: Side) => (this.held ? null : this.want[side]);
    let sides: Side[];
    if (!flags.triggers) {
      for (const side of SIDES) this.gated.add(side);
      sides = SIDES.filter((side) => target(side) === null && this.out[side] !== null);
    } else sides = SIDES.filter((side) => this.gated.delete(side) || key(target(side)) !== key(this.out[side]));
    if (sides.length === 2 && key(target('left')) === key(target('right'))) {
      if (this.call('trigger', () => ds.trigger!('both', target('left')))) this.out.left = this.out.right = target('left');
      return;
    }
    for (const side of sides) {
      if (this.call('trigger', () => ds.trigger!(side, target(side)))) this.out[side] = target(side);
    }
  }

  /**
   * One call into the hub's controller. A hub callback that throws must not leave the engine code
   * that synced (a level unload, `dispose`, the pause setter, a settings change) half done: the error
   * is a warning, and what it would have sent is not recorded as sent, so the next change tries again.
   */
  private call(what: 'light' | 'trigger', send: () => void): boolean {
    try {
      send();
      return true;
    } catch (error) {
      this.warn(`the hub's ${what}() threw: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private warn(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    console.warn(`[dualsense] ${message}`);
  }
}
