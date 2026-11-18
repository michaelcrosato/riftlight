/**
 * Menus on every device, from `ctx.input` alone (so a recording replays them): `MenuInput` turns
 * keys, the pad, the left stick and swipes into menu events with key repeat, and `FocusList`
 * keeps a list's focus, moved by those events and by the pointer (hover moves the focus, a click
 * or a tap on an item confirms it). The same screen works with a DualSense on a TV, a keyboard
 * and mouse, and a phone.
 *
 *   const menu = new MenuInput();                // in the game, kept across frames
 *   const list = new FocusList(3);
 *   // update(ctx, dt):
 *   const events = menu.events(ctx.input, dt);
 *   const r = list.update(events, ctx.input, ctx.hud, rects); // rects: each item's box in HUD pixels
 *   if (r.confirm >= 0) choose(r.confirm);
 *   if (r.back) close();
 *   // draw: list.index is the focused item
 */
import { type Input, SWIPE_KEYS, type SwipeDirection } from '../input';

export type MenuDirection = 'up' | 'down' | 'left' | 'right';

/** What a menu hears this frame (`MenuInput.events`). */
export type MenuEvent =
  | { readonly kind: 'nav'; readonly dir: MenuDirection }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'back' }
  | { readonly kind: 'tab'; readonly dir: 1 | -1 }
  | { readonly kind: 'wheel'; readonly dy: number }
  /** One of `MenuKeys.keys`, pressed. */
  | { readonly kind: 'key'; readonly code: string }
  /** A quick one-finger swipe on the canvas (`SWIPE_KEYS`): dismiss a dialogue, a notification, a menu. */
  | { readonly kind: 'swipe'; readonly dir: SwipeDirection };

/** The codes each menu event comes from. */
export interface MenuKeys {
  readonly confirm: readonly string[];
  readonly back: readonly string[];
  readonly up: readonly string[];
  readonly down: readonly string[];
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly tabNext: readonly string[];
  readonly tabPrev: readonly string[];
  /** Codes passed on as `key` events when pressed (a menu's own shortcuts: X equips, V sells). */
  readonly keys: readonly string[];
}

/**
 * The engine's menu bindings: Enter / Space / Cross (A) confirm, Esc / Backspace / Circle (B) go
 * back, the arrows / WASD / the d-pad (and the left stick) move, Q / E and L1 / R1 (LB / RB)
 * change tabs.
 */
export const MENU_KEYS: MenuKeys = {
  confirm: ['Enter', 'NumpadEnter', 'Space', 'PadA'],
  back: ['Escape', 'Backspace', 'PadB'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  tabNext: ['KeyE', 'PadRB'],
  tabPrev: ['KeyQ', 'PadLB'],
  keys: [],
};

/** Key repeat for a held direction: the first repeat after `delay` s, then one every `rate` s. */
export const MENU_REPEAT = { delay: 0.35, rate: 0.07 } as const;
/** How far the left stick must lean (after its deadzone) to count as a held direction. */
const STICK_NAV = 0.6;
const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const SWIPES = Object.keys(SWIPE_KEYS) as SwipeDirection[];

/**
 * Builds menu events from keys, the pad and the left stick, with key repeat for held directions,
 * and from swipes. Read it once per rendered frame, in `update` (`wasPressed`: this frame's
 * presses). Its repeat timers are data (`save` / `load`, for save-states).
 */
export class MenuInput {
  readonly keys: MenuKeys;
  private held = new Map<string, number>();

  /** `keys`: bindings to change (the rest are `MENU_KEYS`'). */
  constructor(keys: Partial<MenuKeys> = {}) {
    this.keys = { ...MENU_KEYS, ...keys };
  }

  /** Directions held and for how long (key repeat), as data (save-states). */
  save(): (readonly [string, number])[] {
    return [...this.held];
  }

  load(held: readonly (readonly [string, number])[]): void {
    this.held = new Map(held);
  }

  /** This frame's events (`dt`: the frame's seconds, for the repeat). */
  events(input: Input, dt: number): MenuEvent[] {
    const out: MenuEvent[] = [];
    const k = this.keys;
    const pressed = (codes: readonly string[]) => codes.length > 0 && input.wasPressed(...codes);
    for (const dir of DIRECTIONS) {
      const codes = k[dir];
      if (pressed(codes)) {
        out.push({ kind: 'nav', dir });
        this.held.set(dir, -MENU_REPEAT.delay);
      } else if (input.anyDown(codes) || stickHeld(input, dir)) {
        const t = (this.held.get(dir) ?? -MENU_REPEAT.delay) + dt;
        if (t >= MENU_REPEAT.rate) {
          out.push({ kind: 'nav', dir });
          this.held.set(dir, 0);
        } else this.held.set(dir, t);
      } else this.held.delete(dir);
    }
    if (pressed(k.confirm)) out.push({ kind: 'confirm' });
    if (pressed(k.back)) out.push({ kind: 'back' });
    if (pressed(k.tabNext)) out.push({ kind: 'tab', dir: 1 });
    if (pressed(k.tabPrev)) out.push({ kind: 'tab', dir: -1 });
    for (const code of new Set(k.keys)) if (input.wasPressed(code)) out.push({ kind: 'key', code });
    if (input.wheel) out.push({ kind: 'wheel', dy: input.wheel });
    for (const dir of SWIPES) if (input.wasPressed(SWIPE_KEYS[dir])) out.push({ kind: 'swipe', dir });
    return out;
  }
}

/** The left stick as a held direction (menus with a pad). */
function stickHeld(input: Input, dir: MenuDirection): boolean {
  const a = input.padAxis;
  return dir === 'up' ? a.y > STICK_NAV : dir === 'down' ? a.y < -STICK_NAV : dir === 'left' ? a.x < -STICK_NAV : a.x > STICK_NAV;
}

/** An item's box on the HUD, in art pixels from its top-left (what `ctx.hud` draws in). */
export interface FocusRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What a frame did to a `FocusList`. */
export interface FocusResult {
  /** The focus moved (play a tick). */
  readonly moved: boolean;
  /** The item chosen this frame (Enter / Cross, or a click or tap on it), or -1. */
  readonly confirm: number;
  /** Back (Esc / Circle) or a dismissing swipe. */
  readonly back: boolean;
  /** Left / right on a one-column list: change the focused item's value (a slider, a choice), -1, 0 or 1. */
  readonly adjust: -1 | 0 | 1;
}

/** `FocusList.save`. */
export interface FocusListState {
  readonly index: number;
  /** Where the pointer was over the HUD the frame before (hover moves the focus only when it moves), or null. */
  readonly at: readonly [number, number] | null;
  /** The item a pointer button went down on (a click is a press and a release on the same item), or -1. */
  readonly down: number;
}

/**
 * A menu's focus: which of `count` items is chosen, moved by `MenuInput`'s events (up / down;
 * left / right too in a grid of `columns`) and by the pointer: hovering an item focuses it (only
 * when the pointer moves, so a resting mouse never fights the d-pad), and a click or a tap on an
 * item focuses and confirms it. Back comes from Esc / Circle and from a swipe in one of
 * `dismiss`'s directions (default left and right, so vertical swipes can scroll). Plain data:
 * `save` / `load` for save-states.
 */
export class FocusList {
  index = 0;
  private at: [number, number] | null = null;
  private down = -1;
  readonly wrap: boolean;
  readonly columns: number;
  readonly dismiss: readonly SwipeDirection[];

  constructor(
    public count: number,
    o: { wrap?: boolean; columns?: number; dismiss?: readonly SwipeDirection[]; index?: number } = {},
  ) {
    this.wrap = o.wrap ?? true;
    this.columns = Math.max(1, Math.floor(o.columns ?? 1));
    this.dismiss = o.dismiss ?? ['left', 'right'];
    this.index = Math.min(Math.max(0, o.index ?? 0), Math.max(0, count - 1));
  }

  /**
   * One frame: `events` from `MenuInput`, the pointer from `input` (its position and clicks, in
   * HUD pixels of `hud`'s size) over `rects` (each item's box, by index; left out: no pointer).
   */
  update(events: readonly MenuEvent[], input: Input, hud: { readonly width: number; readonly height: number }, rects: readonly FocusRect[] = []): FocusResult {
    const before = this.index;
    let confirm = -1;
    let back = false;
    let adjust: -1 | 0 | 1 = 0;
    for (const e of events) {
      if (e.kind === 'nav') {
        const step = e.dir === 'up' ? -this.columns : e.dir === 'down' ? this.columns : e.dir === 'left' ? -1 : 1;
        if (this.columns === 1 && (e.dir === 'left' || e.dir === 'right')) adjust = e.dir === 'left' ? -1 : 1;
        else this.step(step);
      } else if (e.kind === 'confirm') confirm = this.count > 0 ? this.index : -1;
      else if (e.kind === 'back') back = true;
      else if (e.kind === 'swipe' && this.dismiss.includes(e.dir)) back = true;
    }
    if (rects.length) {
      const hit = (x: number, y: number) => rects.findIndex((r, i) => i < this.count && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);
      const p = input.pointer;
      if (p.over) {
        const here = ndcToHud(p.x, p.y, hud);
        const moved = !this.at || this.at[0] !== here[0] || this.at[1] !== here[1];
        this.at = here;
        const i = moved ? hit(here[0], here[1]) : -1;
        if (i >= 0) this.index = i;
      }
      for (const b of input.buttonEvents) {
        if (b.code !== 'MouseLeft' && b.code !== 'Touch') continue;
        const [x, y] = ndcToHud(b.x, b.y, hud);
        const i = hit(x, y);
        if (b.down) {
          this.down = i;
          if (i >= 0) this.index = i;
        } else {
          if (i >= 0 && i === this.down) confirm = i;
          this.down = -1;
        }
      }
    }
    return { moved: this.index !== before, confirm, back, adjust };
  }

  /** Move the focus by `n` items: round to the other end when `wrap`, else it stays at the edge. */
  step(n: number): void {
    if (this.count <= 0) return;
    const next = this.index + n;
    if (this.wrap) this.index = ((next % this.count) + this.count) % this.count;
    else if (next >= 0 && next < this.count) this.index = next;
  }

  save(): FocusListState {
    return { index: this.index, at: this.at ? [this.at[0], this.at[1]] : null, down: this.down };
  }

  load(s: FocusListState): void {
    this.index = s.index;
    this.at = s.at ? [s.at[0], s.at[1]] : null;
    this.down = s.down;
  }
}

/** A point in normalised device coordinates over the canvas → HUD art pixels (the HUD lies over the canvas, framed the same). */
export function ndcToHud(x: number, y: number, hud: { readonly width: number; readonly height: number }): [number, number] {
  return [Math.min(hud.width - 1, Math.max(0, Math.floor(((x + 1) / 2) * hud.width))), Math.min(hud.height - 1, Math.max(0, Math.floor(((1 - y) / 2) * hud.height)))];
}
