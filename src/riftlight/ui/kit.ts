/**
 * Riftlight's pixel UI kit on top of the engine Hud (a 2D canvas at the art resolution,
 * one HUD pixel = one art pixel). Everything is placed in absolute art pixels from the
 * top-left; panels, buttons, bars, a 3×5 mini font for numbers and input glyphs (keys,
 * mouse buttons, controller buttons).
 *
 * Input reaches panels as `UiEvent`s that the shell builds from keyboard, mouse, touch and
 * gamepad alike (see game/controls.ts), so every view works with all four.
 */
import type { Hud, HudColor, PaletteColor } from '../../engine';

export type UiEvent =
  | { readonly kind: 'nav'; readonly dir: 'up' | 'down' | 'left' | 'right' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'back' }
  | { readonly kind: 'tab'; readonly dir: 1 | -1 }
  | { readonly kind: 'pointer'; readonly type: 'move' | 'down' | 'up'; readonly x: number; readonly y: number }
  | { readonly kind: 'wheel'; readonly dy: number }
  | { readonly kind: 'key'; readonly code: string };

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
};

/** Mini-font sprite rows for `text` (3×5 glyphs, 1 px gap). */
export function miniRows(text: string): string[] {
  const rows = ['', '', '', '', ''];
  const chars = [...text];
  chars.forEach((ch, i) => {
    const g = MINI[ch] ?? MINI[ch.toUpperCase()] ?? MINI['?']!;
    for (let r = 0; r < 5; r++) rows[r] += g.slice(r * 3, r * 3 + 3).replace(/1/g, 'c').replace(/0/g, '.') + (i < chars.length - 1 ? '.' : '');
  });
  return rows;
}

export const miniWidth = (text: string) => Math.max(0, [...text].length * 4 - 1);

/**
 * Drawing helpers over `Hud` in absolute art pixels, plus the pointer in art pixels.
 * One instance per frame of drawing; it does not own the Hud's lifecycle.
 */
export class UiCanvas {
  /** Pointer position in art pixels (−1 when unknown) and button state. */
  readonly pointer = { x: -1, y: -1, down: false, used: false };
  /** Animation clock for blinking carets, glints... (seconds). */
  time = 0;
  /** Controller glyphs instead of keys in prompts. */
  pad = false;

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

  /** 3×5 mini font. */
  mini(x: number, y: number, s: string, color: HudColor = UI.text, align: Align = 'left', shadow: HudColor | false = false): number {
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

  /** A button; focus/hover draws it highlighted. Returns its rect. */
  button(r: Rect, label: string, state: { focus?: boolean; disabled?: boolean; accent?: HudColor } = {}): Rect {
    const hot = state.focus || this.hover(r);
    const fill: HudColor = state.disabled ? 'ink' : hot ? (state.accent ?? 'slate') : 'night';
    this.rect(r.x + 1, r.y, r.w - 2, r.h, 'ink');
    this.rect(r.x, r.y + 1, r.w, r.h - 2, 'ink');
    this.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, hot && !state.disabled ? UI.focus : 'slate');
    this.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, fill);
    this.text(r.x + r.w / 2, r.y + Math.floor((r.h - 7) / 2), label.toUpperCase(), { align: 'center', color: state.disabled ? 'slate' : hot ? 'white' : 'mist' });
    return r;
  }

  /**
   * An input glyph: a key cap ("F", "ESC"), a mouse button ("LMB", "RMB") or, with
   * `pad`, a controller button ("A", "B", "X", "Y", "LB", "RB", "START"). Returns the width.
   */
  glyph(x: number, y: number, key: string, padButton?: string): number {
    if (this.pad && padButton) return this.padGlyph(x, y, padButton);
    if (key === 'LMB' || key === 'RMB') {
      const rows = key === 'LMB' ? MOUSE_L : MOUSE_R;
      this.sprite(x, y - 1, rows, { o: 'ink', w: 'white', f: 'sand', g: 'mist' });
      return 7;
    }
    const w = miniWidth(key) + 4;
    this.rect(x, y, w, 8, 'ink');
    this.rect(x, y - 1, w, 8, 'mist');
    this.rect(x + 1, y, w - 2, 6, 'white');
    this.mini(x + 2, y, key, 'ink');
    return w;
  }

  private padGlyph(x: number, y: number, b: string): number {
    const face: Record<string, PaletteColor> = { A: 'green', B: 'red', X: 'blue', Y: 'sand' };
    const c = face[b];
    if (c) {
      this.sprite(x, y - 1, PAD_ROUND, { o: 'ink', c, w: 'white' });
      this.mini(x + 2, y, b, 'white');
      return 7;
    }
    const w = miniWidth(b) + 4;
    this.rect(x + 1, y - 1, w - 2, 8, 'ink');
    this.rect(x, y, w, 6, 'ink');
    this.rect(x + 1, y, w - 2, 6, 'slate');
    this.mini(x + 2, y, b, 'white');
    return w;
  }

  /** "[glyph] LABEL" prompt; returns its width. */
  prompt(x: number, y: number, key: string, pad: string | undefined, label: string, color: HudColor = 'white', align: Align = 'left'): number {
    const gw = this.pad && pad ? (['A', 'B', 'X', 'Y'].includes(pad) ? 7 : miniWidth(pad) + 4) : key === 'LMB' || key === 'RMB' ? 7 : miniWidth(key) + 4;
    const total = gw + 3 + this.measure(label);
    const left = align === 'center' ? x - Math.floor(total / 2) : align === 'right' ? x - total : x;
    this.glyph(left, y, key, pad);
    this.text(left + gw + 3, y, label, { color });
    return total;
  }
}

const MOUSE_L = ['.ooooo.', 'offowwo', 'offowwo', 'ooooooo', 'owwwwwo', 'owwwwwo', '.ooooo.'];
const MOUSE_R = ['.ooooo.', 'owwoffo', 'owwoffo', 'ooooooo', 'owwwwwo', 'owwwwwo', '.ooooo.'];
const PAD_ROUND = ['.ooooo.', 'occccco', 'occccco', 'occccco', 'occccco', 'occccco', '.ooooo.'];

/** Wrap text to lines of at most `width` art pixels (5×7 font). */
export function wrap(text: string, width: number, scale = 1): string[] {
  const max = Math.max(1, Math.floor((width + scale) / (6 * scale)));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > max) {
        out.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    out.push(line);
  }
  return out;
}
