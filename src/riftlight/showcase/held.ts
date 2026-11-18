/**
 * Presses a menu, a card or a panel took, kept from the hero while they stay held: the showcase's
 * pause, the Hall's card and photo mode, the arcade's pause, Engine World's panels. The Circle that
 * closed one never crouches the hero, and the Cross or Space that chose a row never jumps.
 *
 *   presses.take(input)                 every frame one of them owned (its presses are its own)
 *   presses.mask(input, move, KEYMAP)   the hero's move input, before the hero steps
 *   presses.held(input, codes)          any other held read (the car's handbrake)
 *
 * State is input-derived only (the codes still held), so a replay rebuilds it from its frames.
 */
import type { Input, MoveInput } from '../../engine';

/** The codes of the held moves `mask` reads again (`KEYMAP`, `ARCADE_KEYS`). */
export interface HeldKeys {
  readonly walk: readonly string[];
  readonly crouch: readonly string[];
  readonly jump: readonly string[];
  readonly grab?: readonly string[];
}

export class HeldPresses {
  private readonly codes = new Set<string>();
  private readonly watch: Set<string>;

  /** `watch`: the codes the hero (or the game under the menu) reads held; `held` adds the ones it is asked about. */
  constructor(watch: readonly string[]) {
    this.watch = new Set(watch);
  }

  /** A frame something on top owned: its presses are its own (queued ones dropped, held ones kept from the hero until they let go). */
  take(input: Input): void {
    for (const c of this.watch) if (input.wasPressed(c) && input.isDown(c)) this.codes.add(c);
    input.clearQueued();
  }

  /** Any of `codes` held, but not one still held from a press something on top took (`codes` are watched from now on). */
  held(input: Input, codes: readonly string[]): boolean {
    this.free(input);
    let down = false;
    for (const c of codes) {
      this.watch.add(c);
      if (!down && !this.codes.has(c) && input.isDown(c)) down = true;
    }
    return down;
  }

  /**
   * The hero's held moves without a taken press: walk, crouch, grab and a held jump are read again
   * from `keys` (one held for another reason, a stick pushed down, stays).
   */
  mask(input: Input, m: MoveInput, keys: HeldKeys): MoveInput {
    this.free(input);
    if (this.codes.size === 0) return m;
    const again = (on: boolean | undefined, codes: readonly string[]) => !!on && (this.held(input, codes) || !input.anyDown(codes));
    m.walk = again(m.walk, keys.walk);
    m.crouch = again(m.crouch, keys.crouch);
    m.jumpHeld = again(m.jumpHeld, keys.jump);
    if (keys.grab) m.grab = again(m.grab, keys.grab);
    return m;
  }

  /** Nothing taken any more: a level that starts (a replay's too) starts from nothing held. */
  clear(): void {
    this.codes.clear();
  }

  /** A taken press still held. */
  get size(): number {
    return this.codes.size;
  }

  /** The ones let go are the hero's again. */
  private free(input: Input): void {
    for (const c of this.codes) if (!input.isDown(c)) this.codes.delete(c);
  }
}
