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
    }
  | { kind: 'toggle'; id: string; label: string; get: () => boolean; set: (v: boolean) => void; hint?: string }
  | { kind: 'choice'; id: string; label: string; options: readonly string[]; get: () => number; set: (i: number) => void; hint?: string }
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

  get size() {
    const h = this.widgets.reduce((s, w) => s + rowHeight(w), 0) + (this.o.footer ? 12 : 0) + 6;
    return { w: this.o.width ?? 200, h };
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

  draw(ui: UiCanvas, r: Rect): void {
    if (this.source) {
      const id = this.widgets[this.focus]?.id;
      this.widgets = this.source();
      const again = this.widgets.findIndex((w) => w.id === id);
      this.focus = again >= 0 ? again : Math.min(this.focus, this.widgets.length - 1);
    }
    this.rects.clear();
    const labelW = this.o.labelWidth ?? Math.floor(r.w * 0.45);
    let y = r.y + 3;
    this.widgets.forEach((w, i) => {
      const focus = i === this.focus;
      const h = rowHeight(w);
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
      y += h;
    });
    const hint = (this.widgets[this.focus] as { hint?: string } | undefined)?.hint;
    const foot = hint ?? this.o.footer?.();
    if (foot) ui.text(r.x + r.w / 2, r.y + r.h - 10, foot.toUpperCase(), { align: 'center', color: 'slate' });
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
      return was !== null;
    }
    if (this.dragging) {
      const w = this.widgets.find((v) => v.id === this.dragging);
      const t = this.rects.get(`${this.dragging}:track`);
      if (w?.kind === 'slider' && t) w.set(Math.min(1, Math.max(0, (x - t.x - 2) / (t.w - 4))));
      return true;
    }
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

const focusable = (w: Widget) => w.kind !== 'label' && w.kind !== 'gap' && !(w.kind === 'button' && w.disabled);
const rowHeight = (w: Widget) => (w.kind === 'gap' ? (w.h ?? 6) : w.kind === 'button' ? BUTTON_H + 3 : w.kind === 'label' ? 12 : ROW);
