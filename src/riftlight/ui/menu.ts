/**
 * A vertical menu of widgets as data (buttons, sliders, toggles, choices, labels) that
 * works the same with a mouse, touch, keyboard and a gamepad:
 *   pointer: hover focuses, click / tap activates, drag a slider's track;
 *   keys / d-pad: up/down move focus, left/right change sliders and choices, confirm activates.
 * Every Riftlight menu (title, pause, tuning, settings, slots, dev) is one of these.
 */
import type { HudColor } from '../../engine';
import type { Panel } from '../game/ports';
import { inside, type Rect, UI, type UiCanvas, type UiEvent } from './kit';

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
      hint?: string;
      /** What the control is, on its own (the focus line while its menu is hidden); default: the label. */
      name?: string;
    }
  | { kind: 'toggle'; id: string; label: string; get: () => boolean; set: (v: boolean) => void; hint?: string; name?: string }
  | { kind: 'choice'; id: string; label: string; options: readonly string[]; get: () => number; set: (i: number) => void; hint?: string; name?: string }
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
  onBack?: () => void;
  onSound?: (s: 'click' | 'move') => void;
}

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
  private press: { x: number; y: number; scroll: number; moved: boolean } | null = null;
  /** Width the shell has room for (`fit`); below the menu's width it lays out narrow. */
  private room = Infinity;

  /** Narrow: sliders, toggles and choices put their label above the control. */
  get narrow(): boolean {
    return this.room < (this.o.width ?? 200) && this.room < 180;
  }

  fit(w: number): void {
    this.room = w;
  }

  get size() {
    // room for the hint / footer line under the widgets
    const narrow = this.narrow;
    const h = this.widgets.reduce((s, w) => s + rowHeight(w) + (narrow && isControl(w) ? NARROW_EXTRA : 0), 0) + 14;
    return { w: Math.min(this.o.width ?? 200, this.room), h };
  }

  /** The widget list (rebuilt from the factory, if any, on every draw). */
  items(): readonly Widget[] {
    return this.widgets;
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
    const id = this.widgets[this.focus]?.id;
    this.widgets = this.source();
    const again = this.widgets.findIndex((w) => w.id === id);
    this.focus = again >= 0 ? again : Math.min(this.focus, this.widgets.length - 1);
  }

  /** The focused control and its value ("Game Boy dither 0.9"), for when the menu is hidden. */
  focusLine(): string {
    const w = this.widgets[this.focus];
    if (!w || w.kind === 'gap') return '';
    const name = ('name' in w && w.name) || w.label.trim();
    if (w.kind === 'slider') return `${name} ${w.format()}`;
    if (w.kind === 'toggle') return `${name} ${w.get() ? 'on' : 'off'}`;
    if (w.kind === 'choice') return `${name} ${w.options[w.get()] ?? ''}`;
    return name;
  }

  draw(ui: UiCanvas, r: Rect): void {
    this.refresh();
    this.rects.clear();
    const narrow = this.narrow;
    const labelW = narrow ? 4 : (this.o.labelWidth ?? Math.floor(r.w * 0.45));
    // more rows than the screen has room for (a phone): the list scrolls to keep the focus in view
    const heights = this.widgets.map((w) => rowHeight(w) + (narrow && isControl(w) ? NARROW_EXTRA : 0));
    const total = heights.reduce((a, b) => a + b, 0);
    const view = r.h - 14; // the footer line
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
        ui.text(r.x + r.w / 2, y + 2, w.label.toUpperCase(), { align: 'center', color: w.color ?? UI.accent });
      } else if (w.kind === 'gap') {
        /* spacing */
      } else {
        this.rects.set(w.id, row);
        if (focus || ui.hover(row)) ui.rect(row.x, row.y, row.w, row.h, 'night');
        if (focus) ui.rect(row.x, row.y, 2, row.h, UI.focus);
        const color = focus ? 'white' : 'mist';
        ui.text(r.x + 5, y + 3, w.label.toUpperCase(), { color });
        const cx = r.x + labelW;
        const cw = r.w - labelW - 4;
        // narrow: the control sits on its own line under the label
        if (narrow) y += NARROW_EXTRA;
        if (w.kind === 'slider') {
          const value = w.format();
          const vw = 34;
          const tw = cw - vw - 4;
          const track: Rect = { x: cx, y: y + 5, w: tw, h: 3 };
          this.rects.set(`${w.id}:track`, { x: cx - 2, y: y, w: tw + 4, h: row.h });
          ui.rect(track.x, track.y, track.w, track.h, 'ink');
          const u = Math.min(1, Math.max(0, w.get()));
          ui.rect(track.x, track.y + 1, Math.round(track.w * u), 1, w.changed?.() ? UI.accent : 'sky');
          ui.rect(track.x + Math.round(track.w / 2), track.y - 1, 1, 5, 'slate'); // centre (default) mark
          const kx = track.x + Math.round(track.w * u);
          ui.rect(kx - 2, track.y - 3, 5, 9, 'ink');
          ui.rect(kx - 1, track.y - 2, 3, 7, focus ? UI.focus : 'white');
          ui.text(r.x + r.w - 4, y + 3, value, { align: 'right', color: w.changed?.() ? UI.accent : color });
        } else if (w.kind === 'toggle') {
          const on = w.get();
          ui.rect(cx, y + 2, 17, 9, 'ink');
          ui.rect(cx + 1, y + 3, 15, 7, on ? 'green' : 'night');
          ui.rect(on ? cx + 9 : cx + 1, y + 3, 7, 7, focus ? UI.focus : 'white');
          ui.text(cx + 22, y + 3, on ? 'ON' : 'OFF', { color: on ? UI.good : 'slate' });
        } else if (w.kind === 'choice') {
          const label = w.options[w.get()] ?? '?';
          ui.text(cx, y + 3, '<', { color: focus ? UI.focus : 'slate' });
          ui.text(cx + Math.floor(cw / 2), y + 3, label.toUpperCase(), { align: 'center', color });
          ui.text(cx + cw - 5, y + 3, '>', { color: focus ? UI.focus : 'slate' });
        }
      }
      y = y0 + h;
    });
    // more above / below: a small arrow at the right edge
    if (this.scroll > 0) for (let k = 0; k < 3; k++) ui.rect(r.x + r.w - 6 - k, r.y + k, 1 + 2 * k, 1, 'sand');
    if (this.scroll < total - view) for (let k = 0; k < 3; k++) ui.rect(r.x + r.w - 6 - k, r.y + view + 4 - k, 1 + 2 * k, 1, 'sand');
    const hint = (this.widgets[this.focus] as { hint?: string } | undefined)?.hint;
    const foot = hint ?? this.o.footer?.();
    if (foot) {
      // a narrow menu (a phone) falls back to the mini font, cut to the width
      const text = foot.toUpperCase();
      if (ui.measure(text) <= r.w - 2) ui.text(r.x + r.w / 2, r.y + r.h - 10, text, { align: 'center', color: 'slate' });
      else ui.mini(r.x + r.w / 2, r.y + r.h - 9, text.slice(0, Math.floor((r.w + 1) / 4)), 'slate', 'center');
    }
  }

  input(e: UiEvent): boolean {
    const w = this.widgets[this.focus];
    switch (e.kind) {
      case 'nav':
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
        return this.pointer(e.type, e.x, e.y);
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
      w.set(w.step(w.get(), dir));
      this.o.onSound?.('move');
      return true;
    }
    if (w.kind === 'toggle') {
      w.set(!w.get());
      this.o.onSound?.('click');
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

  private pointer(type: 'move' | 'down' | 'up', x: number, y: number): boolean {
    if (type === 'up') {
      const was = this.dragging;
      this.dragging = null;
      // a menu that scrolls acts on release, unless the finger dragged the list
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
      if (Math.abs(dy) > 3) this.press.moved = true;
      if (this.press.moved) {
        this.scroll = this.press.scroll - dy;
        this.follow = false;
      }
      return true;
    }
    if (type === 'down' && this.scrolls) {
      // a slider's track still drags at once; anything else waits to see a tap or a drag
      const onTrack = this.widgets.some((w) => {
        const t = this.rects.get(`${w.id}:track`);
        return w.kind === 'slider' && t && inside(t, x, y);
      });
      if (!onTrack) {
        this.press = { x, y, scroll: this.scroll, moved: false };
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
const rowHeight = (w: Widget) => (w.kind === 'gap' ? (w.h ?? 6) : w.kind === 'button' ? BUTTON_H + 3 : w.kind === 'label' ? 12 : ROW);
