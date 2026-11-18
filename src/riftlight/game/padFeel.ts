/**
 * What the controller says back during play: short, distinct rumbles on the moments that matter
 * (any pad that rumbles: `input.rumble`) and the DualSense's light bar (`ctx.dualsense.light`).
 * Outputs only, never recorded: the engine plays nothing headless, during a replay or off the pad,
 * scales rumbles by the player's vibration (the AI Hub by its own on top) and lights the bar only
 * while the player lets games colour it. Nothing here rumbles in menus: the shell calls it from
 * play's events.
 */
import { type GameContext, PALETTE, type Rumble } from '../../engine';

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

/** The pad's rumbles (some a beat later: a level-up's second pulse) and the light bar, sent only when its colour changes. */
export class PadFeel {
  private readonly later: { at: number; r: Rumble }[] = [];
  private time = 0;
  /** The colour last sent (undefined: none yet). */
  private shown: string | null | undefined = undefined;

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

  /** The light bar's colour (null: the hub's), sent when it changed. */
  light(colour: string | null): void {
    if (colour === this.shown) return;
    this.shown = colour;
    this.ctx.dualsense.light(colour);
  }

  /** The colour sent last (tests). */
  get lit(): string | null | undefined {
    return this.shown;
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

  /** A pulse still to come is dropped (the title, a new run): nothing rumbles out of its moment. */
  cancel(): void {
    this.later.length = 0;
  }
}
