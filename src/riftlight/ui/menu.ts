/**
 * A vertical menu of widgets as data (buttons, sliders, toggles, choices, labels) that
 * works the same with a mouse, touch, keyboard and a gamepad:
 *   pointer: hover focuses, click / tap activates, drag a slider's track;
 *   keys / d-pad: up/down move focus, left/right change sliders and choices, confirm activates.
 * Every Riftlight menu (title, pause, tuning, settings, slots, dev) is one of these.
 */
import { type HudColor, textWidthPx, wrapText } from '../../engine';
import type { Panel } from '../game/ports';
import { t } from '../lang';
import { BUTTON_TWO_ROWS, clip, inside, miniCovers, miniWidth, type Rect, UI, type UiCanvas, type UiEvent, wrapTo } from './kit';

export type Widget =
  | { kind: 'button'; id: string; label: string; onClick: () => void; disabled?: boolean; hint?: string; accent?: HudColor }
  | {
      kind: 'slider';
      id: string;
      label: string;
      /** 0..1 position of the knob. */
      get: () => number;
      set: (u: number) => void;
      /** Left / right notch: returns the new 0..1 position. */
      step: (u: number, dir: 1 | -1) => number;
      /** Value text shown on the right. */
      format: () => string;
      /** Highlight when not default. */
      changed?: () => boolean;
      /** Where its default sits (0..1, as `get` gives it): a mark on the track there; none without one. */
      mark?: number;
      hint?: string;
      /** What the control is, on its own (the focus line while its menu is hidden); default: the label. */
      name?: string;
      /** Drawn indented, under the row it belongs to (a filter's preset and sliders). */
      indent?: boolean;
      /** Shown dimmed and it doesn't move, though it takes the focus (its hint says why: Shout sensitivity while Voice is off). */
      disabled?: boolean;
    }
  | {
      kind: 'toggle';
      id: string;
      label: string;
      get: () => boolean;
      set: (v: boolean) => void;
      hint?: string;
      name?: string;
      indent?: boolean;
      /** Shown dimmed and it doesn't change, though it takes the focus (its hint says why: the voice before 52in1 allows the microphone). */
      disabled?: boolean;
      /**
       * A level meter after On / Off (presentation: what it reads is never recorded): `level` filled
       * from the left, a mark at `mark` (both 0..1 of its width), drawn lit while `lit`; null: none.
       */
      meter?: () => { level: number; mark: number; lit: boolean } | null;
    }
  | { kind: 'choice'; id: string; label: string; options: readonly string[]; get: () => number; set: (i: number) => void; hint?: string; name?: string; indent?: boolean }
  | { kind: 'label'; id: string; label: string; color?: HudColor }
  | { kind: 'gap'; id: string; h?: number };

const ROW = 15;
const BUTTON_H = 13;

export interface MenuOptions {
  id: string;
  title: string;
  width?: number;
  /** Where the label column ends and the control column starts (sliders). */
  labelWidth?: number;
  /** Footer text (hints). */
  footer?: () => string;
  /**
   * How wide the footer (and a hint in its place) may run where the menu is narrower, up to its
   * room: a bare menu's, which no frame holds in (the title's, under the logo).
   */
  footWidth?: number;
  onBack?: () => void;
  onSound?: (s: 'click' | 'move') => void;
  /**
   * A menu of buttons only (the pause menu, the title menu) may lay them out as tiles in two
   * columns on a page with touch controls (`fit`'s `tap`) where one column of rows that tall would
   * scroll or shrink more than the tiles: a landscape phone, whose screen is wide and short.
   * Elsewhere one column (`plan`).
   */
  grid?: boolean;
}

/** Art pixels between the two columns of a grid menu (`MenuOptions.grid`). */
const GRID_GAP = 4;

/** A grid's tile holds its label and this much more: its frame and the button's margin (`UiCanvas.button` cuts a label 6 short of its width), and some air. */
const TILE_PAD = 12;

export class Menu implements Panel {
  readonly id: string;
  readonly title: string;
  focus = 0;
  /** Widget rects from the last draw (pointer hit tests, agent API). */
  readonly rects = new Map<string, Rect>();
  private dragging: string | null = null;
  private widgets: Widget[];

  constructor(
    widgets: Widget[] | (() => Widget[]),
    private readonly o: MenuOptions,
  ) {
    this.id = o.id;
    this.title = o.title;
    this.source = typeof widgets === 'function' ? widgets : null;
    this.widgets = typeof widgets === 'function' ? widgets() : widgets;
    this.focus = this.widgets.findIndex(focusable);
  }

  private readonly source: (() => Widget[]) | null;
  /** Rows scrolled off the top (art pixels) when the menu is taller than its room. */
  private scroll = 0;
  /** The menu is taller than its room (last draw): touch drags scroll it, taps act on release. */
  private scrolls = false;
  /** Keep the focused row in view (keys, pad, wheel); a finger's drag turns it off. */
  private follow = true;
  /** A press waiting to see a tap or a drag (`pointer`): where, the scroll then, whether it moved, and whether a finger made it. */
  private press: { x: number; y: number; scroll: number; moved: boolean; touch: boolean } | null = null;
  /** Width the shell has room for (`fit`); below the menu's width it lays out narrow. */
  private room = Infinity;
  /** Height the shell has room for (`fit`): a grid menu takes two columns when one would be taller. */
  private roomH = Infinity;
  /** The least height of a row a finger presses, art pixels (`fit`; 0: none, a mouse's or a pad's screen). */
  private tap = 0;

  /** Narrow: sliders, toggles and choices put their label above the control. */
  get narrow(): boolean {
    return this.room < (this.o.width ?? 200) && this.room < 180;
  }

  fit(w: number, h = Infinity, tap = 0): void {
    this.room = w;
    this.roomH = h;
    this.tap = tap;
  }

  /**
   * A widget's row, art pixels: a button or a control at least `tap` + 2 tall (a thumb's), the
   * control's label over it when narrow, and a narrow button's label too wide for it on two rows.
   */
  private rowH(w: Widget, width: number, tap: number): number {
    const base = rowHeight(w, width);
    if (w.kind === 'button') return Math.max(this.narrow && textWidthPx(w.label) > width - 6 ? BUTTON_TWO_ROWS + 3 : base, tap + 2);
    if (isControl(w)) return Math.max(base, tap + 2) + (this.narrow ? NARROW_EXTRA : 0);
    return base;
  }

  /** One column's width. */
  private get colW(): number {
    return Math.min(this.o.width ?? 200, this.room);
  }

  /** One column's height with rows `tap` + 2 tall, its footer's rows included (`footH`). */
  private columnH(tap: number): number {
    const rows = this.widgets.reduce((s, x) => s + this.rowH(x, this.colW, tap), 0);
    return rows + this.footH(this.footW(this.colW), this.roomH - rows);
  }

  /** A grid's height with tiles `tap` + 2 tall, its footer's rows included (`footH`). */
  private gridH(tap: number): number {
    const rows = this.gridRows() * this.tileH(tap);
    return rows + this.footH(this.footW(2 * this.tileW + GRID_GAP), this.roomH - rows);
  }

  /**
   * A footer (or a hint in its place) as drawn `width` wide in a footer `h` tall (`footH`): one row
   * of the normal font where it fits; else on a mouse's or a pad's screen (a TV's) the normal font
   * on as many rows as `h` holds (at most `FOOT_ROWS`) where they hold it whole, and on a phone's
   * layout (narrow, or touch: `tap`) or where they don't, the mini font on as many rows as `h`
   * holds of it (at most `FOOT_ROWS`), cut on the last.
   */
  private footLines(text: string, width: number, h = Infinity): { lines: string[]; mini: boolean } {
    if (textWidthPx(text) <= width) return { lines: [text], mini: false };
    const rows = (step: number) => Math.min(FOOT_ROWS, 1 + Math.max(0, Math.floor((h - FOOT_H) / step)));
    const mini = miniCovers(text);
    if (!mini || (!this.narrow && this.tap <= 0 && wrapText(text, width).length <= rows(LABEL_LINE))) return { lines: wrapTo(text, width, rows(LABEL_LINE)), mini: false };
    return { lines: wrapTo(text, width, rows(MINI_LINE), miniWidth), mini: true };
  }

  /** The footer's width under a menu `w` wide: the menu's, or its `footWidth` up to its room. */
  private footW(w: number): number {
    return Math.max(w, Math.min(this.o.footWidth ?? 0, this.room));
  }

  /**
   * The rows under the widgets for the footer, art pixels, `width` wide (`footW`), where the
   * widgets leave `free` of the menu's room: room for the longest of it and every hint (so the
   * menu never jumps as the focus moves), but never so much that a menu whose rows fit over one
   * footer row scrolls: then only what they leave (`footLines` wraps or cuts the footer into it).
   * A list that scrolls all the same (a phone's settings, World's room list, the look studio: less
   * than a footer row free) gives its view's last rows to its longest, whole where `FOOT_ROWS` rows
   * hold it (a TV's normal font: the look studio's French hints at 1920×1080 take three), and none
   * to its scroll's arrows (`draw`: at its scroll bar's ends).
   */
  private footH(width: number, free: number): number {
    const texts = [this.o.footer?.(), ...this.widgets.map((w) => (w as { hint?: string }).hint)].filter((x): x is string => !!x);
    // the layout asks often (`plan` tries row heights): wrapped again only when what it wraps changed
    const key = `${width} ${this.narrow || this.tap > 0}\n${texts.join('\n')}`;
    if (this.foot?.key !== key) this.foot = { key, h: FOOT_H + Math.max(0, ...texts.map((x) => this.footLines(x, width - 2)).map((f) => (f.lines.length - 1) * (f.mini ? MINI_LINE : LABEL_LINE))) };
    return free >= FOOT_H ? Math.min(this.foot.h, free) : this.foot.h;
  }

  /** `footH`'s longest footer and what it was for. */
  private foot: { key: string; h: number } | null = null;

  /**
   * How the menu lays out in its room (`fit`), on a page with touch controls (`tap` > 0; elsewhere
   * one column, as it always was): one column of rows a thumb tall where they fit; else whichever
   * of one column or a grid's two (`MenuOptions.grid`) keeps its rows tallest without scrolling, its
   * rows shrunk to the room (never under a mouse's); and when nothing fits, one column of
   * thumb-tall rows that scrolls (a phone's settings), its scroll bar showing there is more.
   */
  private plan(): { cols: 1 | 2; tap: number } {
    const tap = this.tap;
    if (tap <= 0 || this.columnH(tap) <= this.roomH) return { cols: 1, tap };
    // the tallest rows that fit (-1: none do)
    const tallest = (height: (t: number) => number) => {
      for (let t = tap; t >= 0; t--) if (height(t) <= this.roomH) return t;
      return -1;
    };
    const one = tallest((t) => this.columnH(t));
    const grid = this.gridable ? tallest((t) => this.gridH(t)) : -1;
    if (grid >= 0 && grid > one) return { cols: 2, tap: grid };
    return { cols: 1, tap: one >= 0 ? one : tap };
  }

  /** A grid's tile width: two in the room side by side, each at most the menu's width (`colW`). */
  private get tileW(): number {
    return Math.min(this.colW, Math.floor((this.room - GRID_GAP) / 2));
  }

  /**
   * The menu can lay out as a grid (`MenuOptions.grid`): buttons only, and two columns fit its
   * width, the tiles narrower than the menu (a small landscape phone's 272 columns) while each still
   * holds the widest label and its room around it (`TILE_PAD`).
   */
  private get gridable(): boolean {
    if (!this.o.grid || !this.widgets.every((w) => w.kind === 'button' || w.kind === 'gap')) return false;
    const widest = Math.max(0, ...this.tiles().map(({ w }) => textWidthPx(w.label)));
    return this.tileW >= widest + TILE_PAD;
  }

  /** Two columns of tiles (`MenuOptions.grid`, `plan`) or one. */
  get columns(): 1 | 2 {
    return this.plan().cols;
  }

  /** The buttons a grid lays out as tiles, in order (its gaps are dropped). */
  private tiles(): { w: Extract<Widget, { kind: 'button' }>; i: number }[] {
    return this.widgets.flatMap((w, i) => (w.kind === 'button' ? [{ w, i }] : []));
  }

  private gridRows(): number {
    return Math.ceil(this.tiles().length / 2);
  }

  /** A tile's row in a grid: a button's, at least `tap` + 2. */
  private tileH(tap: number): number {
    return Math.max(BUTTON_H + 3, tap + 2);
  }

  get size() {
    // room for the hint / footer line under the widgets
    const plan = this.plan();
    if (plan.cols === 2) return { w: 2 * this.tileW + GRID_GAP, h: this.gridH(plan.tap) };
    return { w: this.colW, h: this.columnH(plan.tap) };
  }

  /** The widget list (rebuilt from the factory, if any, on every draw). */
  items(): readonly Widget[] {
    return this.widgets;
  }

  /** The footer line as it reads now (the focused widget's hint shows in its place): tools and tests. */
  footer(): string | null {
    return this.o.footer?.() ?? null;
  }

  /** Focus a widget by id (agent API, menus that open on a sub-item). */
  focusId(id: string): boolean {
    const i = this.widgets.findIndex((w) => w.id === id);
    if (i >= 0 && focusable(this.widgets[i]!)) this.focus = i;
    return i >= 0;
  }

  /** Activate a widget by id as if clicked (agent API). */
  activate(id: string): boolean {
    const i = this.widgets.findIndex((w) => w.id === id);
    if (i < 0) return false;
    this.focus = i;
    return this.confirm();
  }

  /** Rebuild the widgets from the factory (if any), keeping the focus on the same widget. */
  refresh(): void {
    if (!this.source) return;
    const was = this.widgets;
    const at = (id: string | undefined) => this.widgets.findIndex((w) => w.id === id && focusable(w));
    const id = was[this.focus]?.id;
    this.widgets = this.source();
    const again = this.widgets.findIndex((w) => w.id === id);
    if (again >= 0) return void (this.focus = again);
    // the focused row went (the slots' files on a pad): the row above it that is still there, never
    // the one that slid up into its place (a Delete)
    for (let i = this.focus - 1; i >= 0; i--) if (at(was[i]?.id) >= 0) return void (this.focus = at(was[i]?.id));
    this.focus = Math.min(this.focus, this.widgets.length - 1);
  }

  /** A list that scrolls moves with a swipe up or down, a slider with one sideways from its track: not a swipe that closes the menu (`UiLayer.swipe`). */
  swipes(dir: 'left' | 'right' | 'up' | 'down', x: number, y: number): boolean {
    if (dir === 'up' || dir === 'down') return this.scrolls;
    return this.widgets.some((w) => {
      const t = this.rects.get(`${w.id}:track`);
      return w.kind === 'slider' && !!t && inside(t, x, y);
    });
  }

  /** The focused control and its value ("Game Boy dither 0.9"), for when the menu is hidden. */
  focusLine(): string {
    const w = this.widgets[this.focus];
    if (!w || w.kind === 'gap') return '';
    const name = ('name' in w && w.name) || w.label.trim();
    if (w.kind === 'slider') return t('menu.focus_line', { control: name, value: w.format() });
    if (w.kind === 'toggle') return t('menu.focus_line', { control: name, value: t(w.get() ? 'menu.on' : 'menu.off') });
    if (w.kind === 'choice') return t('menu.focus_line', { control: name, value: w.options[w.get()] ?? '' });
    return name;
  }

  draw(ui: UiCanvas, r: Rect): void {
    this.refresh();
    this.rects.clear();
    const plan = this.plan();
    if (plan.cols === 2) {
      this.drawGrid(ui, r, plan.tap);
      return;
    }
    const narrow = this.narrow;
    // the label column: as wide as the menu asks, wider for longer labels (another language's), up to 3/5 of the row
    const widest = Math.max(0, ...this.widgets.filter(isControl).map((w) => ui.measure((w as { label: string }).label) + ((w as { indent?: boolean }).indent ? 12 : 0) + 9));
    const labelW = narrow ? 4 : Math.max(this.o.labelWidth ?? Math.floor(r.w * 0.45), Math.min(widest, Math.floor(r.w * 0.6)));
    // more rows than the screen has room for (a phone): the list scrolls to keep the focus in view
    const heights = this.widgets.map((w) => this.rowH(w, r.w, plan.tap));
    const total = heights.reduce((a, b) => a + b, 0);
    const foot = this.footH(this.footW(r.w), r.h - total); // the footer's rows
    const view = r.h - foot;
    this.scrolls = total > view;
    if (this.scrolls) {
      const fy = heights.slice(0, Math.max(0, this.focus)).reduce((a, b) => a + b, 0);
      const fh = heights[this.focus] ?? 0;
      if (this.follow && fy < this.scroll) this.scroll = fy;
      if (this.follow && fy + fh > this.scroll + view) this.scroll = fy + fh - view;
      this.scroll = Math.max(0, Math.min(total - view, this.scroll));
    } else this.scroll = 0;
    let y = r.y + 3 - this.scroll;
    this.widgets.forEach((w, i) => {
      const focus = i === this.focus;
      const h = heights[i]!;
      const y0 = y;
      // rows cut by the edges of the view are skipped (no rect: they can't be tapped half-seen)
      if (y0 < r.y || y0 + h - 2 > r.y + view + 3) {
        y = y0 + h;
        return;
      }
      const row: Rect = { x: r.x, y, w: r.w, h: h - 2 };
      if (w.kind === 'button') {
        this.rects.set(w.id, ui.button(row, w.label, { focus, disabled: w.disabled, accent: w.accent }));
      } else if (w.kind === 'label') {
        labelLines(w.label, r.w).forEach((line, k) => ui.text(r.x + r.w / 2, y + 2 + k * LABEL_LINE, clip(line, r.w - 4, (s) => ui.measure(s)), { align: 'center', color: w.color ?? UI.accent }));
      } else if (w.kind === 'gap') {
        /* spacing */
      } else {
        this.rects.set(w.id, row);
        if (focus || ui.hover(row)) ui.rect(row.x, row.y, row.w, row.h, 'night');
        if (focus) ui.rect(row.x, row.y, 2, row.h, UI.focus);
        const off = (w.kind === 'toggle' || w.kind === 'slider') && w.disabled === true;
        const color = off ? 'slate' : focus ? 'white' : 'mist';
        const cx = r.x + labelW;
        const cw = r.w - labelW - 4;
        // a row a thumb tall (`tap`): its words and control in the middle of it
        y += Math.floor((h - (narrow ? NARROW_EXTRA : 0) - ROW) / 2);
        // the label in its column (the whole row when narrow), indented under its parent row
        const lx = r.x + 5 + (w.indent ? 12 : 0);
        ui.text(lx, y + 3, clip(w.label, (narrow ? r.x + r.w - 4 : cx - 3) - lx, (s) => ui.measure(s)), { color });
        // narrow: the control sits on its own line under the label
        if (narrow) y += NARROW_EXTRA;
        if (w.kind === 'slider') {
          const value = w.format();
          const vw = 34;
          const tw = cw - vw - 4;
          const track: Rect = { x: cx, y: y + 5, w: tw, h: 3 };
          this.rects.set(`${w.id}:track`, { x: cx - 2, y: narrow ? y : row.y, w: tw + 4, h: row.h });
          ui.rect(track.x, track.y, track.w, track.h, 'ink');
          const u = Math.min(1, Math.max(0, w.get()));
          const changed = !off && w.changed?.() === true;
          ui.rect(track.x, track.y + 1, Math.round(track.w * u), 1, off ? 'slate' : changed ? UI.accent : 'sky');
          if (w.mark !== undefined) ui.rect(track.x + Math.round(track.w * Math.min(1, Math.max(0, w.mark))), track.y - 1, 1, 5, 'slate'); // the default's mark
          const kx = track.x + Math.round(track.w * u);
          ui.rect(kx - 2, track.y - 3, 5, 9, 'ink');
          ui.rect(kx - 1, track.y - 2, 3, 7, off ? 'slate' : focus ? UI.focus : 'white');
          ui.text(r.x + r.w - 4, y + 3, value, { align: 'right', color: changed ? UI.accent : color });
        } else if (w.kind === 'toggle') {
          const on = w.get();
          ui.rect(cx, y + 2, 17, 9, 'ink');
          ui.rect(cx + 1, y + 3, 15, 7, on ? 'green' : 'night');
          ui.rect(on ? cx + 9 : cx + 1, y + 3, 7, 7, off ? 'slate' : focus ? UI.focus : 'white');
          const word = t(on ? 'menu.on' : 'menu.off');
          ui.text(cx + 22, y + 3, word, { color: on ? UI.good : 'slate' });
          // a meter in the rest of the row: what the microphone hears, a mark where a shout counts
          const m = w.meter?.();
          const mx = cx + 22 + ui.measure(word) + 6;
          const mw = r.x + r.w - 5 - mx;
          if (m && mw >= 16) {
            const at = (u: number) => Math.round((mw - 2) * Math.min(1, Math.max(0, u)));
            ui.rect(mx, y + 4, mw, 5, 'ink');
            ui.rect(mx + 1, y + 6, mw - 2, 1, 'slate'); // its range, empty
            ui.rect(mx + 1, y + 5, at(m.level), 3, m.lit ? UI.good : 'sky');
            ui.rect(mx + 1 + at(m.mark), y + 2, 1, 9, m.lit ? UI.good : 'white');
            this.rects.set(`${w.id}:meter`, { x: mx, y: y + 2, w: mw, h: 9 });
          }
        } else if (w.kind === 'choice') {
          const label = w.options[w.get()] ?? '?';
          ui.text(cx, y + 3, '<', { color: focus ? UI.focus : 'slate' });
          ui.text(cx + Math.floor(cw / 2), y + 3, clip(label, cw - 14, (s) => ui.measure(s)), { align: 'center', color });
          ui.text(cx + cw - 5, y + 3, '>', { color: focus ? UI.focus : 'slate' });
        }
      }
      y = y0 + h;
    });
    // a scroll bar in the gutter beside the rows (inside a panel's frame): how much more there is,
    // and where the view is; a small arrow over its top while there is more above, under its foot
    // while there is more below (in the gutter too, beside the footer's rows: never over their words)
    if (this.scrolls) {
      const bx = Math.min(r.x + r.w + 1, ui.w - 3);
      const th = Math.max(6, Math.round((view * view) / total));
      ui.rect(bx, r.y + 2, 2, view, 'night');
      ui.rect(bx, r.y + 2 + Math.round(((view - th) * this.scroll) / Math.max(1, total - view)), 2, th, 'sand');
      if (this.scroll > 0) {
        ui.rect(bx, r.y - 1, 2, 1, 'sand');
        ui.rect(bx - 1, r.y, 4, 1, 'sand');
      }
      if (this.scroll < total - view) {
        ui.rect(bx - 1, r.y + view + 3, 4, 1, 'sand');
        ui.rect(bx, r.y + view + 4, 2, 1, 'sand');
      }
    }
    this.drawFooter(ui, r, foot);
  }

  /** The focused widget's hint, else the menu's footer, on the last rows, `h` of them (`footLines`: wrapped, cut only where they can't hold it). */
  private drawFooter(ui: UiCanvas, r: Rect, h: number): void {
    const hint = (this.widgets[this.focus] as { hint?: string } | undefined)?.hint;
    const foot = hint ?? this.o.footer?.();
    if (!foot) return;
    const { lines, mini } = this.footLines(foot, this.footW(r.w) - 2, h);
    const step = mini ? MINI_LINE : LABEL_LINE;
    lines.forEach((line, i) => {
      const y = r.y + r.h - (mini ? 9 : 10) - (lines.length - 1 - i) * step;
      if (mini) ui.mini(r.x + r.w / 2, y, line, 'slate', 'center');
      else ui.text(r.x + r.w / 2, y, line, { align: 'center', color: 'slate' });
    });
  }

  /** Two columns of tiles, row by row (`columns`). */
  private drawGrid(ui: UiCanvas, r: Rect, tap: number): void {
    this.scrolls = false;
    this.scroll = 0;
    const w = Math.floor((r.w - GRID_GAP) / 2);
    const h = this.tileH(tap);
    this.tiles().forEach(({ w: b, i }, k) => {
      const row: Rect = { x: r.x + (k % 2) * (r.w - w), y: r.y + 3 + Math.floor(k / 2) * h, w, h: h - 2 };
      this.rects.set(b.id, ui.button(row, b.label, { focus: i === this.focus, disabled: b.disabled, accent: b.accent }));
    });
    this.drawFooter(ui, r, this.footH(this.footW(r.w), r.h - this.gridRows() * h));
  }

  /**
   * In a grid: up and down go a row (two tiles), left and right the tile beside, wrapping around;
   * a tile that can't be focused (disabled) is passed over in the same direction.
   */
  private moveTile(by: number): void {
    const tiles = this.tiles();
    const n = tiles.length;
    if (!n) return;
    const at = Math.max(0, tiles.findIndex((x) => x.i === this.focus));
    const next = (k: number): number => {
      let j = k + by;
      if (Math.abs(by) === 1) j = (j + n) % n;
      else if (j >= n) j = k % 2; // past the last row: the top of its column
      else if (j < 0) j = (n - 1) % 2 === k % 2 ? n - 1 : n - 2; // above the first: the bottom of its column
      return Math.max(0, Math.min(n - 1, j));
    };
    let k = at;
    for (let step = 0; step < n; step++) {
      k = next(k);
      if (k === at) return;
      if (focusable(tiles[k]!.w)) {
        this.follow = true;
        this.focus = tiles[k]!.i;
        this.o.onSound?.('move');
        return;
      }
    }
  }

  input(e: UiEvent): boolean {
    const w = this.widgets[this.focus];
    switch (e.kind) {
      case 'nav':
        if (this.columns === 2) {
          this.moveTile(e.dir === 'up' ? -2 : e.dir === 'down' ? 2 : e.dir === 'left' ? -1 : 1);
          return true;
        }
        if (e.dir === 'up' || e.dir === 'down') {
          this.move(e.dir === 'up' ? -1 : 1);
          return true;
        }
        return w ? this.adjust(w, e.dir === 'left' ? -1 : 1) : false;
      case 'confirm':
        return this.confirm();
      case 'back':
        if (this.o.onBack) {
          this.o.onBack();
          return true;
        }
        return false;
      case 'pointer':
        return this.pointer(e.type, e.x, e.y, !!e.touch);
      case 'wheel':
        this.move(e.dy > 0 ? 1 : -1);
        return true;
      default:
        return false;
    }
  }

  private move(dir: number): void {
    this.follow = true;
    const n = this.widgets.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.focus + dir * k + n * k) % n;
      if (focusable(this.widgets[i]!)) {
        this.focus = i;
        this.o.onSound?.('move');
        return;
      }
    }
  }

  private adjust(w: Widget, dir: 1 | -1): boolean {
    if (w.kind === 'slider') {
      if (w.disabled) return true;
      w.set(w.step(w.get(), dir));
      this.o.onSound?.('move');
      return true;
    }
    if (w.kind === 'toggle') {
      if (w.disabled) return true;
      w.set(!w.get());
      this.o.onSound?.('click');
      this.refresh(); // the rows it shows or enables (Voice: Shout sensitivity) are right before the next input
      return true;
    }
    if (w.kind === 'choice') {
      const n = w.options.length;
      w.set((w.get() + dir + n) % n);
      this.o.onSound?.('click');
      return true;
    }
    return false;
  }

  private confirm(): boolean {
    const w = this.widgets[this.focus];
    if (!w) return false;
    if (w.kind === 'button') {
      if (w.disabled) return true;
      this.o.onSound?.('click');
      w.onClick();
      return true;
    }
    return this.adjust(w, 1);
  }

  private pointer(type: 'move' | 'down' | 'up', x: number, y: number, touch = false): boolean {
    if (type === 'up') {
      const was = this.dragging;
      this.dragging = null;
      // a menu that scrolls, or a finger, acts on release, unless it dragged the list (or swiped)
      const p = this.press;
      this.press = null;
      if (p && !p.moved) return this.hit('down', p.x, p.y) || true;
      return was !== null || p !== null;
    }
    if (this.dragging) {
      const w = this.widgets.find((v) => v.id === this.dragging);
      const t = this.rects.get(`${this.dragging}:track`);
      if (w?.kind === 'slider' && t) w.set(Math.min(1, Math.max(0, (x - t.x - 2) / (t.w - 4))));
      return true;
    }
    if (this.press && type === 'move') {
      const dy = y - this.press.y;
      // a finger that slides sideways is a swipe, not a tap; a mouse's click keeps its sideways drift
      if (Math.abs(dy) > 3 || (this.press.touch && Math.abs(x - this.press.x) > 3)) this.press.moved = true;
      if (this.press.moved && this.scrolls) {
        this.scroll = this.press.scroll - dy;
        this.follow = false;
      }
      return true;
    }
    // a finger acts as it lets go, where it went down (a swipe across the menu presses nothing)
    if (type === 'down' && (this.scrolls || touch)) {
      // a slider's track still drags at once; anything else waits to see a tap or a drag
      const onTrack = this.widgets.some((w) => {
        const t = this.rects.get(`${w.id}:track`);
        return w.kind === 'slider' && t && inside(t, x, y);
      });
      if (!onTrack) {
        this.press = { x, y, scroll: this.scroll, moved: false, touch };
        return true;
      }
    }
    return this.hit(type, x, y);
  }

  /** The widget under (x, y): hover focuses it, a press acts on it. */
  private hit(type: 'move' | 'down', x: number, y: number): boolean {
    for (const [i, w] of this.widgets.entries()) {
      const r = this.rects.get(w.id);
      if (!r || !inside(r, x, y) || !focusable(w)) continue;
      if (type === 'move') {
        this.focus = i;
        return true;
      }
      this.focus = i;
      const t = this.rects.get(`${w.id}:track`);
      if (w.kind === 'slider' && t && inside(t, x, y)) {
        if (w.disabled) return true;
        this.dragging = w.id;
        w.set(Math.min(1, Math.max(0, (x - t.x - 2) / (t.w - 4))));
        return true;
      }
      if (w.kind === 'choice') return this.adjust(w, x > r.x + r.w * 0.75 ? 1 : x < r.x + r.w * 0.6 ? -1 : 1);
      return this.confirm();
    }
    return false;
  }
}

const NARROW_EXTRA = 10;
const isControl = (w: Widget) => w.kind === 'slider' || w.kind === 'toggle' || w.kind === 'choice';
const focusable = (w: Widget) => w.kind !== 'label' && w.kind !== 'gap' && !(w.kind === 'button' && w.disabled);
/** A label's rows: wrapped to the menu's width (a long notice, a longer language). */
const LABEL_LINE = 9;
/** A footer's one row, its rows in the mini font (a phone's), and how many rows a footer takes at most. */
const FOOT_H = 14;
const MINI_LINE = 7;
const FOOT_ROWS = 3;
const labelLines = (label: string, width: number): string[] => wrapText(label, width - 4);
const rowHeight = (w: Widget, width: number) => (w.kind === 'gap' ? (w.h ?? 6) : w.kind === 'button' ? BUTTON_H + 3 : w.kind === 'label' ? 12 + (labelLines(w.label, width).length - 1) * LABEL_LINE : ROW);
