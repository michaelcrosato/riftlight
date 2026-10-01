/**
 * The panel stack: every open view (pause menu, tuning, inventory, tree, vendor, recap...)
 * framed with a title bar and a close box, the top one receiving input. Modal panels pause
 * the world and dim it; others (vendor, stash) leave the town running behind them.
 */
import type { Panel } from '../game/ports';
import { inside, type Rect, type UiCanvas, type UiEvent } from './kit';

export interface Open {
  panel: Panel;
  modal: boolean;
  onClose?: () => void;
  /** Seconds since opened (open animation). */
  age: number;
  rect: Rect;
  /** No frame / title bar (full-screen views like the title menu). */
  bare?: boolean;
  /** Can't be closed with back (the death recap). */
  sticky?: boolean;
}

export class UiLayer {
  readonly stack: Open[] = [];
  onSound?: (s: 'open' | 'close') => void;

  get top(): Open | undefined {
    return this.stack[this.stack.length - 1];
  }

  get modal(): boolean {
    return this.stack.some((o) => o.modal);
  }

  has(id: string): boolean {
    return this.stack.some((o) => o.panel.id === id);
  }

  find(id: string): Panel | undefined {
    return this.stack.find((o) => o.panel.id === id)?.panel;
  }

  open(panel: Panel, o: { modal?: boolean; onClose?: () => void; bare?: boolean; sticky?: boolean; silent?: boolean } = {}): Panel {
    this.close(panel.id, true);
    this.stack.push({ panel, modal: o.modal ?? true, onClose: o.onClose, age: 0, rect: { x: 0, y: 0, w: panel.size.w, h: panel.size.h }, bare: o.bare, sticky: o.sticky });
    if (!o.silent) this.onSound?.('open');
    return panel;
  }

  /** Close one panel by id, or the top one. */
  close(id?: string, silent = false): boolean {
    const i = id ? this.stack.findIndex((o) => o.panel.id === id) : this.stack.length - 1;
    if (i < 0) return false;
    const [o] = this.stack.splice(i, 1);
    o!.panel.close?.();
    o!.onClose?.();
    if (!silent) this.onSound?.('close');
    return true;
  }

  closeAll(): void {
    while (this.stack.length) this.close(undefined, true);
  }

  update(dt: number): void {
    for (const o of this.stack) o.age += dt;
  }

  /** Route one event to the top panel. Returns true when used. */
  input(e: UiEvent): boolean {
    const top = this.top;
    if (!top) return false;
    if (e.kind === 'pointer' && e.type === 'down' && !top.bare) {
      const r = top.rect;
      const closeBox = { x: r.x + r.w - 13, y: r.y - 13, w: 12, h: 11 };
      if (inside(closeBox, e.x, e.y) && !top.sticky) {
        this.close();
        return true;
      }
    }
    if (top.panel.input?.(e)) return true;
    if (e.kind === 'back' && !top.sticky) {
      this.close();
      return true;
    }
    // swallow pointer presses on modal panels so they don't attack the world behind
    return top.modal || (e.kind === 'pointer' && inside(top.rect, e.x, e.y));
  }

  draw(ui: UiCanvas, time: number): void {
    this.stack.forEach((o, i) => {
      const last = i === this.stack.length - 1;
      if (o.modal && (last || this.stack.slice(i + 1).every((x) => !x.modal))) {
        // dim the world with a checker of ink (pixel "transparency")
        for (let y = 0; y < ui.h; y += 2) ui.rect(0, y, ui.w, 1, 'ink');
      }
      const { w, h } = o.panel.size;
      const open = Math.min(1, o.age / 0.12);
      const x = Math.floor((ui.w - w) / 2);
      const y = Math.floor((ui.h - h) / 2) + (o.bare ? 0 : 6) + Math.round((1 - open) * 8);
      o.rect = { x, y, w, h };
      if (!o.bare) {
        ui.panel(x - 6, y - 16, w + 12, h + 22, 'ink', last ? 'slate' : 'night');
        ui.rect(x - 3, y - 13, w + 6, 11, last ? 'navy' : 'night');
        ui.text(x, y - 11, o.panel.title.toUpperCase(), { color: last ? 'sand' : 'slate' });
        if (!o.sticky) {
          const cx = x + w - 13;
          const hot = ui.hover({ x: cx, y: y - 13, w: 12, h: 11 });
          ui.rect(cx, y - 13, 12, 11, hot ? 'red' : 'plum');
          ui.text(cx + 3, y - 11, 'X', { color: 'white' });
        }
      }
      o.panel.draw(ui, o.rect, time);
    });
  }
}
