/**
 * Riftlight's pixel UI kit on top of the engine Hud (a 2D canvas at the art resolution,
 * one HUD pixel = one art pixel). Everything is placed in absolute art pixels from the
 * top-left; panels, buttons, bars, a 3×5 mini font for numbers and input glyphs (keys,
 * mouse buttons, controller buttons).
 *
 * Input reaches panels as `UiEvent`s that the shell builds from keyboard, mouse, touch and
 * gamepad alike (see game/controls.ts), so every view works with all four.
 */
import { clusters, controlGlyph, fontCase, type Glyph, type Hud, type HudColor, type InputDevice, type MenuEvent, noteText, type PadGlyphs, type PaletteColor, pixelCovers, textWidthPx, wrapText } from '../../engine';
import { CONTROLS, type ControlAction } from '../game/controls';
import { lang } from '../lang';

/** The engine's menu events (`MenuInput`: nav, confirm, back, tab, wheel, key, swipe) and the pointer's, in art pixels. */
export type UiEvent = MenuEvent | { readonly kind: 'pointer'; readonly type: 'move' | 'down' | 'up'; readonly x: number; readonly y: number; readonly button?: number; readonly touch?: boolean };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** The UI's colours (all from the Sweetie 16 palette). */
export const UI = {
  bg: 'ink',
  panel: 'night',
  edge: 'slate',
  light: 'mist',
  text: 'white',
  dim: 'mist',
  accent: 'sand',
  gold: 'sand',
  good: 'lime',
  bad: 'red',
  focus: 'sand',
  life: 'red',
  mana: 'blue',
  es: 'cyan',
  xp: 'sand',
} as const satisfies Record<string, PaletteColor>;

export type Align = 'left' | 'center' | 'right';

export interface TextOptions {
  color?: HudColor;
  scale?: number;
  align?: Align;
  shadow?: HudColor | false;
}

/** 3×5 digits, letters and a few symbols, for compact numbers (cooldowns, costs, counters). */
const MINI: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', '.': '000000000000010', ':': '000010000010000', '-': '000000111000000', '+': '000010111010000',
  '/': '001001010100100', '%': '101001010100101', ' ': '000000000000000', x: '000101010101000', '!': '010010010000010', '?': '110001010000010',
  '(': '010100100100010', ')': '010001001001010', "'": '010010000000000', ',': '000000000010100', '·': '000000010000000', '#': '101111101111101',
  '=': '000111000111000', '[': '110100100100110', ']': '011001001001011', '<': '001010100010001', '>': '100010001010100', '{': '011010110010011',
  '}': '110010011010110', ';': '000010000010100', '&': '010101010101011', '|': '010010010010010', '_': '000000000000111', '*': '000101010101000',
  '"': '101101000000000', '$': '011110010011110', '~': '000011110000000', '^': '010101000000000', '\\': '100100010001001', '`': '100010000000000',
  '@': '111101111100011',
};

/**
 * Can the mini font draw `text`? It has capitals A–Z, digits and a few symbols: anything else
 * (accents, other writing systems, a language drawn in the device's font) is drawn with the
 * normal font instead (`UiCanvas.mini`), so every language reads.
 */
export function miniCovers(text: string): boolean {
  return pixelCovers(text) && [...fontCase(text)].every((ch) => ch in MINI);
}

/** Mini-font sprite rows for `text` (3×5 glyphs, 1 px gap; its capitals, as the font draws them). */
export function miniRows(text: string): string[] {
  const rows = ['', '', '', '', ''];
  const chars = [...fontCase(text)];
  chars.forEach((ch, i) => {
    const g = MINI[ch] ?? MINI['?']!;
    for (let r = 0; r < 5; r++) rows[r] += g.slice(r * 3, r * 3 + 3).replace(/1/g, 'c').replace(/0/g, '.') + (i < chars.length - 1 ? '.' : '');
  });
  return rows;
}

/** Width of `text` as `UiCanvas.mini` draws it: the mini font, or the normal font when it can't. */
export const miniWidth = (text: string): number => (miniCovers(text) ? Math.max(0, [...fontCase(text)].length * 4 - 1) : textWidthPx(text));

/**
 * `text` cut to `width` art pixels (whole letters, a `.` where it was cut): the last resort for
 * a line in a box that can't grow (a loot label on a phone, the feed).
 */
export function clip(text: string, width: number, measure: (s: string) => number): string {
  if (measure(text) <= width) return text;
  const letters = clusters(text);
  let n = letters.length;
  while (n > 1 && measure(letters.slice(0, n).join('') + '.') > width) n--;
  return letters.slice(0, n).join('').trimEnd() + '.';
}

/**
 * Drawing helpers over `Hud` in absolute art pixels, plus the pointer in art pixels.
 * One instance per frame of drawing; it does not own the Hud's lifecycle.
 */
export class UiCanvas {
  /** Pointer position in art pixels (−1 when unknown) and button state. */
  readonly pointer = { x: -1, y: -1, down: false, used: false };
  /** Animation clock for blinking carets, glints... (seconds). */
  time = 0;
  /** The device prompts are for (the engine's `controls.device`, the input used last): the shell sets it each frame. */
  device: InputDevice = 'keyboard';
  /** The pad's buttons prompts show (`settings.padGlyphs`): PlayStation's unless the player chose Xbox. */
  padStyle: PadGlyphs = 'playstation';
  /** A DualSense's touchpad swipes page the character screens (`touchpadSwipes`): prompts draw them beside L1 / R1. */
  touchpad = false;

  constructor(readonly hud: Hud) {}

  get w(): number {
    return this.hud.width;
  }

  get h(): number {
    return this.hud.height;
  }

  rect(x: number, y: number, w: number, h: number, color: HudColor): void {
    if (w <= 0 || h <= 0) return;
    this.hud.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), color);
  }

  /** 1-pixel outline. */
  outline(x: number, y: number, w: number, h: number, color: HudColor): void {
    this.rect(x, y, w, 1, color);
    this.rect(x, y + h - 1, w, 1, color);
    this.rect(x, y + 1, 1, h - 2, color);
    this.rect(x + w - 1, y + 1, 1, h - 2, color);
  }

  /** A framed panel: dark fill, ink outer line, bevelled inner edge. */
  panel(x: number, y: number, w: number, h: number, fill: HudColor = UI.bg, edge: HudColor = UI.edge): void {
    this.rect(x + 1, y, w - 2, h, 'ink');
    this.rect(x, y + 1, w, h - 2, 'ink');
    this.rect(x + 1, y + 1, w - 2, h - 2, edge);
    this.rect(x + 2, y + 2, w - 4, h - 4, fill);
    this.rect(x + 2, y + 2, w - 4, 1, edge === UI.edge ? 'night' : edge);
  }

  text(x: number, y: number, s: string, o: TextOptions = {}): number {
    const scale = o.scale ?? 1;
    const w = this.hud.measure(s, scale).width;
    const left = o.align === 'center' ? x - Math.floor(w / 2) : o.align === 'right' ? x - w : x;
    this.hud.text(Math.round(left), Math.round(y), s, { color: o.color ?? UI.text, scale, shadow: o.shadow ?? 'ink' });
    return w;
  }

  /** 3×5 mini font; text it can't draw (accents, other writing systems) in the normal font, a row higher. */
  mini(x: number, y: number, s: string, color: HudColor = UI.text, align: Align = 'left', shadow: HudColor | false = false): number {
    if (!miniCovers(s)) return s ? this.text(x, y - 1, s, { color, align, shadow }) : 0;
    noteText(s); // tools see the mini font's text too (docs/engine/lang.md)
    const w = miniWidth(s);
    if (!w) return 0;
    const left = Math.round(align === 'center' ? x - Math.floor(w / 2) : align === 'right' ? x - w : x);
    const rows = miniRows(s);
    if (shadow !== false) this.hud.sprite(left + 1, Math.round(y) + 1, rows, { c: shadow });
    this.hud.sprite(left, Math.round(y), rows, { c: color });
    return w;
  }

  sprite(x: number, y: number, rows: readonly string[], colors: Record<string, HudColor>, scale = 1): void {
    this.hud.sprite(Math.round(x), Math.round(y), rows, colors, { scale });
  }

  measure(s: string, scale = 1): number {
    return this.hud.measure(s, scale).width;
  }

  /** Horizontal fill bar with a 1-px ink frame. */
  bar(x: number, y: number, w: number, h: number, frac: number, color: HudColor, back: HudColor = 'ink', frame: HudColor | null = 'ink'): void {
    if (frame) this.rect(x - 1, y - 1, w + 2, h + 2, frame);
    this.rect(x, y, w, h, back);
    this.rect(x, y, Math.round(w * Math.min(1, Math.max(0, frac))), h, color);
  }

  hover(r: Rect): boolean {
    return this.pointer.used && inside(r, this.pointer.x, this.pointer.y);
  }

  /**
   * A button; focus/hover draws it highlighted. With `glyph`, the focused button shows the glyph of
   * what presses it before its label while a pad is in use (✕ Return to town). Returns its rect.
   */
  button(r: Rect, label: string, state: { focus?: boolean; disabled?: boolean; accent?: HudColor; glyph?: ControlAction } = {}): Rect {
    const hot = state.focus || this.hover(r);
    const fill: HudColor = state.disabled ? 'ink' : hot ? (state.accent ?? 'slate') : 'night';
    this.rect(r.x + 1, r.y, r.w - 2, r.h, 'ink');
    this.rect(r.x, r.y + 1, r.w, r.h - 2, 'ink');
    this.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, hot && !state.disabled ? UI.focus : 'slate');
    this.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, fill);
    const color = state.disabled ? 'slate' : hot ? 'white' : 'mist';
    const ty = r.y + Math.floor((r.h - 7) / 2);
    const glyph = state.glyph && state.focus && !state.disabled && this.pad ? state.glyph : null;
    if (!glyph) {
      this.text(r.x + r.w / 2, ty, clip(label, r.w - 6, (t) => this.measure(t)), { align: 'center', color });
      return r;
    }
    const gw = this.glyphWidth(glyph);
    const text = clip(label, r.w - 9 - gw, (t) => this.measure(t));
    const left = r.x + Math.floor((r.w - gw - 3 - this.measure(text)) / 2);
    this.glyph(left, ty, glyph);
    this.text(left + gw + 3, ty, text, { color });
    return r;
  }

  /** Controller glyphs in prompts: the pad is the device in use. */
  get pad(): boolean {
    return this.device === 'pad';
  }

  /** How `action` (game/controls.ts `CONTROLS`) is drawn on the device in use: the engine's glyph (`controlGlyph`), named in the game's language. */
  private glyphOf(action: ControlAction): Glyph {
    return controlGlyph(CONTROLS[action], this.device, this.padStyle, lang());
  }

  /**
   * The glyph of the control that does `action`: the engine's (`controlGlyph`) on the device in
   * use. On a pad PlayStation's Cross, Circle, Square, Triangle (or Xbox's A B X Y) as round
   * buttons in their colours, L1 / Options... as round caps; on the keyboard a key cap ("F",
   * "Esc") or a mouse button; on a phone the touch button's label. Returns the width.
   */
  glyph(x: number, y: number, action: ControlAction): number {
    const g = this.glyphOf(action);
    if (g.kind === 'sprite') {
      this.sprite(x, y - 1, g.rows, g.colors as Record<string, HudColor>);
      return 7;
    }
    const w = miniWidth(g.text) + 4;
    if (g.round) {
      this.rect(x + 1, y - 1, w - 2, 8, 'ink');
      this.rect(x, y, w, 6, 'ink');
      this.rect(x + 1, y, w - 2, 6, 'slate');
      this.mini(x + 2, y, g.text, 'white');
    } else {
      this.rect(x, y, w, 8, 'ink');
      this.rect(x, y - 1, w, 8, 'mist');
      this.rect(x + 1, y, w - 2, 6, 'white');
      this.mini(x + 2, y, g.text, 'ink');
    }
    return w;
  }

  /** The glyph's width (`glyph` draws it). */
  glyphWidth(action: ControlAction): number {
    const g = this.glyphOf(action);
    return g.kind === 'sprite' ? 7 : miniWidth(g.text) + 4;
  }

  /** "[glyph] label" prompt for `action`; returns its width. */
  prompt(x: number, y: number, action: ControlAction, label: string, color: HudColor = 'white', align: Align = 'left'): number {
    const gw = this.glyphWidth(action);
    const total = gw + 3 + this.measure(label);
    const left = align === 'center' ? x - Math.floor(total / 2) : align === 'right' ? x - total : x;
    this.glyph(left, y, action);
    this.text(left + gw + 3, y, label, { color });
    return total;
  }
}

/**
 * Wrap text to lines of at most `width` art pixels at `scale`, measured as it is drawn, broken
 * where the language breaks words (the engine's `wrapText`).
 */
export function wrap(text: string, width: number, scale = 1): string[] {
  return wrapText(text, width, (s) => textWidthPx(s, scale));
}

/**
 * A row of parts (control hints, a lab's key help) joined by `separator`, in lines of at most
 * `width` art pixels at `scale`: broken between parts, as many as fit on each line; a part wider
 * than a line wraps inside (`wrap`). A narrow screen (a phone in portrait) gets it on several lines.
 */
export function wrapRow(parts: readonly string[], width: number, separator = '  ', scale = 1): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    if (last !== undefined && textWidthPx(last + separator + part, scale) <= width) out[out.length - 1] = last + separator + part;
    else out.push(...wrap(part, width, scale));
  }
  return out;
}
