/**
 * The panel stack: every open view (pause menu, tuning, inventory, tree, vendor, recap...)
 * framed with a title bar and a close box, the top one receiving input. Modal panels pause
 * the world and dim it; others (vendor, stash) leave the town running behind them.
 *
 * Overlay panels (the item windows, the passive tree: `Panel.overlay`) paint their own
 * canvas: the layer opens, routes input to and closes them like any panel, but draws no
 * frame. Panels in one `group` share an overlay, so opening one closes the others.
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
    if (panel.group) for (const other of this.stack.filter((x) => x.panel.group === panel.group)) this.close(other.panel.id, true);
    this.stack.push({ panel, modal: o.modal ?? true, onClose: o.onClose, age: 0, rect: { x: 0, y: 0, w: panel.size.w, h: panel.size.h }, bare: o.bare || panel.overlay, sticky: o.sticky });
    panel.open?.();
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
      // the close box is drawn 12 × 11; it takes presses around it too (a thumb on a phone)
      const closeBox = { x: r.x + r.w - 17, y: r.y - 17, w: 24, h: 17 };
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
    if (top.modal) return true;
    if (e.kind !== 'pointer') return false;
    return top.panel.overlay ? !!top.panel.covers?.(e.x, e.y) : inside(top.rect, e.x, e.y);
  }

  /** True when art pixel (x, y) is on an open panel (framed or overlay). */
  covers(x: number, y: number): boolean {
    return this.stack.some((o) => (o.panel.overlay ? !!o.panel.covers?.(x, y) : inside({ x: o.rect.x - 6, y: o.rect.y - 16, w: o.rect.w + 12, h: o.rect.h + 22 }, x, y)));
  }

  draw(ui: UiCanvas, time: number): void {
    this.stack.forEach((o, i) => {
      const last = i === this.stack.length - 1;
      if (o.modal && (last || this.stack.slice(i + 1).every((x) => !x.modal))) {
        // dim the world with a checker of ink (pixel "transparency")
        for (let y = 0; y < ui.h; y += 2) ui.rect(0, y, ui.w, 1, 'ink');
      }
      if (o.panel.overlay) {
        // its own canvas: the whole screen is its rect, the shell draws nothing around it
        o.rect = { x: 0, y: 0, w: ui.w, h: ui.h };
        o.panel.draw(ui, o.rect, time);
        return;
      }
      // the room inside a frame (a phone in portrait is 124 art pixels wide): panels that can
      // lay out narrower do (`fit`), and nothing is ever drawn wider than the screen
      const roomW = ui.w - (o.bare ? 4 : 12);
      const roomH = ui.h - (o.bare ? 4 : 26);
      o.panel.fit?.(roomW, roomH);
      const w = Math.min(o.panel.size.w, roomW);
      const h = Math.min(o.panel.size.h, roomH);
      const open = Math.min(1, o.age / 0.12);
      const x = Math.floor((ui.w - w) / 2);
      const y = Math.max(o.bare ? 2 : 16, Math.floor((ui.h - h) / 2) + (o.bare ? 0 : 6)) + Math.round((1 - open) * 8);
      o.rect = { x, y, w, h };
      if (!o.bare) {
        ui.panel(x - 6, y - 16, w + 12, h + 22, 'ink', last ? 'slate' : 'night');
        ui.rect(x - 3, y - 13, w + 6, 11, last ? 'navy' : 'night');
        const title = o.panel.title.toUpperCase();
        if (ui.measure(title) <= w - 14) ui.text(x, y - 11, title, { color: last ? 'sand' : 'slate' });
        else ui.mini(x, y - 10, title, last ? 'sand' : 'slate');
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
