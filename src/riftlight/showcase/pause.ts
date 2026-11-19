/**
 * The showcase's pause: Options, Esc or ≡ in the arcade (Riftlight's cabinet and `?game=arcade`)
 * and the Hall of Beasts. The stage stands still behind a short menu (Resume, Restart, Photo mode,
 * Leave; standalone Rift Runner's Settings, the engine's panel), on every device: the d-pad or the stick and Cross, Circle, Options again or a sideways
 * swipe to resume, hover and click, a tap; its legend names Select and Back on the device in use, as
 * every shell menu's does. Reads only `ctx.input` (the engine's `MenuInput` events and `FocusList`),
 * so a recording replays it.
 */
import { FocusList, type FocusRect, type Input, type MenuEvent } from '../../engine';
import { t } from '../lang';
import { clip, type UiCanvas } from '../ui/kit';
import { drawLegend, menuLegend } from '../ui/legend';

/** A row of the pause. */
export type PauseItem = 'resume' | 'restart' | 'photo' | 'settings' | 'leave';

/** A row's words (lines: `menu.pause.*`, `showcase.pause.*`). */
export function pauseLabel(item: PauseItem): string {
  return t(item === 'resume' || item === 'photo' || item === 'settings' ? `menu.pause.${item}` : `showcase.pause.${item}`);
}

export class StagePause {
  readonly list: FocusList;
  /** Each row's box as last drawn (hover and taps). */
  private rects: FocusRect[] = [];

  constructor(readonly items: readonly PauseItem[]) {
    this.list = new FocusList(items.length);
  }

  /**
   * One frame of input: the row chosen (Resume for back, a dismissing swipe or Options again), or
   * null; `moved` when the focus moved (a tick).
   */
  update(events: readonly MenuEvent[], input: Input, hud: { readonly width: number; readonly height: number }): { pick: PauseItem | null; moved: boolean } {
    input.wantsPointerLock = false; // a first-person mouse look lets go: the pointer clicks the menu
    input.wheel = 0;
    const r = this.list.update(events, input, hud, this.rects);
    if (input.wasPressed('PadStart') || r.back) return { pick: 'resume', moved: r.moved };
    return { pick: r.confirm >= 0 ? (this.items[r.confirm] ?? null) : null, moved: r.moved };
  }

  /** The menu over the dimmed stage, centred, with the shell's menus' legend under it (✕ Select · ○ Back; none on a touch screen). */
  draw(ui: UiCanvas): void {
    const title = t('menu.pause.title');
    const measure = (s: string) => ui.measure(s);
    const w = Math.min(ui.w - 12, Math.max(120, ...this.items.map((i) => measure(pauseLabel(i)) + 24), measure(title) + 16));
    const h = 22 + this.items.length * 15;
    const x = Math.floor((ui.w - w) / 2);
    const y = Math.floor((ui.h - h) / 2);
    for (let row = 0; row < ui.h; row += 2) ui.rect(0, row, ui.w, 1, 'ink'); // the stage dimmed behind
    ui.panel(x, y, w, h, 'ink', 'slate');
    ui.text(ui.w / 2, y + 5, clip(title, w - 8, measure), { align: 'center', color: 'sand' });
    this.rects = this.items.map((item, i) => {
      const r = { x: x + 6, y: y + 18 + i * 15, w: w - 12, h: 13 };
      const focus = i === this.list.index;
      ui.button(r, pauseLabel(item), { focus, accent: item === 'leave' ? 'plum' : undefined, glyph: focus ? 'confirm' : undefined });
      return r;
    });
    drawLegend(ui, menuLegend(), ui.w / 2, y + h + 4, ui.w - 4);
  }
}
