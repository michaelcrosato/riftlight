/**
 * What the controller says back during play: short, distinct rumbles on the moments that matter
 * (any pad that rumbles: `input.rumble`), the DualSense's light bar (`ctx.dualsense.light`) and
 * R2's latch (`ctx.dualsense.trigger`). Outputs only, never recorded: the engine plays nothing
 * headless, during a replay or off the pad, scales rumbles by the player's vibration (the AI Hub by
 * its own on top), lights the bar and pushes the triggers back only while the player lets games.
 * Nothing here rumbles in menus: the shell calls it from play's events.
 */
import { type GameContext, PALETTE, type Rumble, type TriggerEffect } from '../../engine';

/** Each moment's rumble: `strong` the heavy low motor, `weak` the light buzz (0..1), `ms` how long. */
export const RUMBLE = {
  /** The hero is hit: harder and longer the bigger the share of its life the hit took. */
  hurt(share: number): Rumble {
    const k = Math.min(1, Math.max(0, share) * 3);
    return { strong: 0.2 + 0.6 * k, weak: 0.25 + 0.2 * k, ms: Math.round(60 + 80 * k) };
  },
  /** A crit the hero dealt: a quick light tick. */
  crit: { strong: 0, weak: 0.45, ms: 40 },
  /** A level gained: two pulses, the second stronger (`LEVEL_GAP` seconds apart). */
  levelUp: [
    { strong: 0.25, weak: 0.55, ms: 90 },
    { strong: 0.5, weak: 0.8, ms: 120 },
  ],
  /** A rare item lands in view; a loud one (a unique, valuable currency) harder. */
  rare: { strong: 0.1, weak: 0.5, ms: 60 },
  loud: { strong: 0.45, weak: 0.9, ms: 140 },
  /** The level's portal opens (the level is clear). */
  portal: { strong: 0.55, weak: 0.3, ms: 220 },
  /** The hero falls: one long, low rumble. */
  death: { strong: 0.9, weak: 0.1, ms: 650 },
} as const satisfies Record<string, Rumble | readonly Rumble[] | ((share: number) => Rumble)>;

/** Seconds between a level-up's two pulses. */
export const LEVEL_GAP = 0.18;

/** What the light bar shows, as the shell sees play (`lightFor`). */
export interface LightState {
  /** 'off': the title, a showcase mode, nothing of the hero to say (the hub's own colour). */
  readonly where: 'off' | 'town' | 'level';
  readonly dead: boolean;
  /** Life over max life, 0..1. */
  readonly life: number;
  /** A boss is alive and close (its music plays). */
  readonly boss: boolean;
  /** Seconds (presentation's clock): the pulse under a quarter of life. */
  readonly time: number;
}

/** The hero's life below this share pulses the light bar. */
export const LIGHT_LOW = 0.25;
/** Life at or above this share is green; below, amber until `LIGHT_LOW`. */
export const LIGHT_OK = 0.6;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The light bar's colour for `s`, or null to give it back to the hub (the title, a showcase mode):
 * the town glows in the game's own colour (the rift's orange, its cabinet's); in a level it is the
 * hero's life, green, amber, then red pulsing under a quarter; a boss fight is steady red until then;
 * a fallen hero dim plum.
 */
export function lightFor(s: LightState): string | null {
  if (s.where === 'off') return null;
  if (s.where === 'town') return hex(PALETTE.orange);
  if (s.dead) return hex(PALETTE.plum);
  if (s.life < LIGHT_LOW) return hex(s.time % 0.6 < 0.3 ? PALETTE.red : PALETTE.plum);
  if (s.boss) return hex(PALETTE.red);
  return hex(s.life >= LIGHT_OK ? PALETTE.green : PALETTE.sand);
}

/**
 * Where a browser says an analog trigger is pressed, of its travel (Chrome: past 30/255). R2's
 * press registers there, as on any pad.
 */
export const PRESS = 30 / 255;

/**
 * R2 is interact: while it would take, talk to, open or go through something, a DualSense's R2
 * works a latch (an adaptive trigger). It pushes back from just before the browser's press point
 * (`PRESS`), so the press lands in the push back, and gives way with a click halfway down. The
 * press fires before the click, so the shell keeps the latch through the pull that used it
 * (`PadFeel.latched`) and lets go once R2 is up.
 */
export const LATCH = { kind: 'weapon', from: 0.1, to: 0.5, strength: 0.5 } as const satisfies TriggerEffect;

/**
 * The pad's rumbles (some a beat later: a level-up's second pulse), the light bar and R2's latch.
 * The colour is asked for every frame: the engine's `ctx.dualsense` sends only changes, and drops
 * what is asked while a replay plays, so the frame after one hands control back puts the right
 * colour on. The latch too, though it calls the engine only when it changes.
 */
export class PadFeel {
  private readonly later: { at: number; r: Rumble }[] = [];
  private time = 0;
  private on = false;

  constructor(private readonly ctx: GameContext) {}

  /** Rumble now, or `delay` seconds from now. */
  rumble(r: Rumble, delay = 0): void {
    if (delay > 0) this.later.push({ at: this.time + delay, r });
    else this.ctx.input.rumble(r);
  }

  /** Two or more pulses, `gap` seconds apart. */
  pulses(rs: readonly Rumble[], gap: number): void {
    rs.forEach((r, i) => this.rumble(r, i * gap));
  }

  /** The light bar's colour (null: the hub's), every frame (the engine sends it when it changed). */
  light(colour: string | null): void {
    this.ctx.dualsense.light(colour);
  }

  /**
   * R2's latch (`LATCH`) on or let go, every frame; letting go lets both triggers go (nothing else
   * of Riftlight's pushes back). The engine is called only when it changes, and not while a replay
   * plays (it would drop the call), so the frame after one hands control back sets it right.
   */
  latch(on: boolean): void {
    if (on === this.on || this.ctx.input.playing) return;
    this.on = on;
    if (on) this.ctx.dualsense.trigger('right', LATCH);
    else this.ctx.dualsense.trigger('both', null);
  }

  /** R2's latch as last asked of the engine (live: never during a replay). */
  get latched(): boolean {
    return this.on;
  }

  /** Pulses still to come (tests). */
  get pending(): number {
    return this.later.length;
  }

  /** Each frame: the rumbles due now. */
  update(dt: number): void {
    this.time += dt;
    for (let i = this.later.length - 1; i >= 0; i--) {
      const x = this.later[i]!;
      if (x.at > this.time) continue;
      this.later.splice(i, 1);
      this.ctx.input.rumble(x.r);
    }
  }

  /** A pulse still to come is dropped (the shell calls it on the title, a new run and leaving a level): nothing rumbles out of its moment. */
  cancel(): void {
    this.later.length = 0;
  }
}
