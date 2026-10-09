/**
 * A scrolling page of text in the pixel font: the station guides and the field guide.
 * Headings, paragraphs, bullets and code (the 3×5 mini font), wrapped to the panel's
 * width. Up / down / wheel / drag scroll it; tab jumps between headings.
 */
import type { HudColor } from '../../engine';
import type { Panel } from '../../riftlight/game/ports';
import { type Rect, type UiCanvas, type UiEvent, wrap } from '../../riftlight/ui/kit';

export type Block =
  | { readonly kind: 'h'; readonly text: string; readonly color?: HudColor }
  | { readonly kind: 'p'; readonly text: string; readonly color?: HudColor }
  | { readonly kind: 'li'; readonly text: string; readonly bullet?: string; readonly color?: HudColor }
  | { readonly kind: 'code'; readonly title: string; readonly file: string; readonly src: string }
  | { readonly kind: 'gap'; readonly h?: number };

interface Line {
  readonly y: number;
  readonly h: number;
  readonly draw: (ui: UiCanvas, x: number, y: number) => void;
  readonly heading?: boolean;
}

const LINE = 9;
const MINI = 7;

export class Reader implements Panel {
  readonly overlay = false;
  private scroll = 0;
  private lines: Line[] = [];
  private total = 0;
  private laidFor = -1;
  private drag: { y: number; scroll: number } | null = null;
  private width: number;
  private height: number;

  constructor(
    readonly id: string,
    public title: string,
    private blocks: readonly Block[],
    o: { width?: number; height?: number } = {},
  ) {
    this.width = o.width ?? 236;
    this.height = o.height ?? 230;
  }

  get size() {
    return { w: this.width, h: this.height };
  }

  /** Lines laid out (tests, agents). */
  get lineCount(): number {
    return this.lines.length;
  }

  fit(w: number, h: number): void {
    this.width = Math.min(this.width, w);
    this.height = Math.min(this.height, h);
  }

  setBlocks(blocks: readonly Block[], title?: string): void {
    this.blocks = blocks;
    if (title) this.title = title;
    this.laidFor = -1;
    this.scroll = 0;
  }

  /** Scroll to the first heading containing `text` (agents, links). */
  jump(text: string): boolean {
    const want = text.toUpperCase();
    const i = this.headings().find((l) => (l as Line & { text?: string }).text?.includes(want));
    if (!i) return false;
    this.scroll = i.y;
    return true;
  }

  draw(ui: UiCanvas, r: Rect): void {
    if (this.laidFor !== r.w) this.layout(r.w);
    const view = r.h - 4;
    this.scroll = Math.max(0, Math.min(Math.max(0, this.total - view), this.scroll));
    for (const l of this.lines) {
      const y = r.y + 2 + l.y - this.scroll;
      if (y < r.y || y + l.h > r.y + view + 2) continue;
      l.draw(ui, r.x, y);
    }
    // the scroll bar
    if (this.total > view) {
      const bh = Math.max(10, Math.round((view / this.total) * view));
      const by = r.y + 2 + Math.round((this.scroll / (this.total - view)) * (view - bh));
      ui.rect(r.x + r.w - 2, r.y + 2, 1, view, 'night');
      ui.rect(r.x + r.w - 3, by, 3, bh, 'slate');
    }
  }

  input(e: UiEvent): boolean {
    switch (e.kind) {
      case 'nav':
        if (e.dir === 'up' || e.dir === 'down') {
          this.scroll += (e.dir === 'up' ? -1 : 1) * LINE * 2;
          return true;
        }
        if (e.dir === 'left' || e.dir === 'right') {
          this.scroll += (e.dir === 'left' ? -1 : 1) * LINE * 12;
          return true;
        }
        return false;
      case 'wheel':
        this.scroll += Math.sign(e.dy) * LINE * 3;
        return true;
      case 'tab': {
        const hs = this.headings();
        const next = e.dir > 0 ? hs.find((h) => h.y > this.scroll + 1) : [...hs].reverse().find((h) => h.y < this.scroll - 1);
        this.scroll = next ? next.y : e.dir > 0 ? this.total : 0;
        return true;
      }
      case 'pointer':
        if (e.type === 'down') this.drag = { y: e.y, scroll: this.scroll };
        else if (e.type === 'move' && this.drag) this.scroll = this.drag.scroll - (e.y - this.drag.y);
        else if (e.type === 'up') {
          const was = this.drag !== null;
          this.drag = null;
          return was;
        }
        return this.drag !== null;
      default:
        return false;
    }
  }

  private headings(): Line[] {
    return this.lines.filter((l) => l.heading);
  }

  private layout(w: number): void {
    this.laidFor = w;
    const lines: Line[] = [];
    let y = 0;
    const inner = w - 8;
    for (const b of this.blocks) {
      if (b.kind === 'gap') {
        y += b.h ?? 4;
        continue;
      }
      if (b.kind === 'h') {
        if (y > 0) y += 4;
        const text = b.text.toUpperCase();
        const color = b.color ?? 'sand';
        const line: Line & { text: string } = {
          y,
          h: LINE + 2,
          heading: true,
          text,
          draw: (ui, x, yy) => {
            ui.text(x + 2, yy + 1, text, { color });
            ui.rect(x + 2, yy + LINE + 1, Math.min(inner, ui.measure(text)), 1, 'navy');
          },
        };
        lines.push(line);
        y += LINE + 4;
        continue;
      }
      if (b.kind === 'code') {
        const title = `${b.title}`.toUpperCase();
        const file = b.file.toUpperCase();
        lines.push({ y, h: LINE, draw: (ui, x, yy) => ui.text(x + 2, yy, title, { color: 'white' }) });
        y += LINE;
        lines.push({ y, h: MINI, draw: (ui, x, yy) => ui.mini(x + 2, yy, file, 'slate') });
        y += MINI;
        const maxChars = Math.max(8, Math.floor((inner - 4) / 4));
        const src: string[] = [];
        for (const raw of b.src.replace(/\t/g, '  ').split('\n')) {
          let rest = raw.replace(/\s+$/, '');
          if (!rest) src.push('');
          while (rest.length > 0) {
            src.push(rest.slice(0, maxChars));
            rest = rest.length > maxChars ? '  ' + rest.slice(maxChars) : '';
          }
        }
        const top = y;
        const h = src.length * MINI + 4;
        lines.push({ y: top, h: 0, draw: () => {} });
        src.forEach((s, i) => {
          const upper = s.toUpperCase();
          lines.push({
            y: top + 2 + i * MINI,
            h: MINI,
            draw: (ui, x, yy) => {
              ui.rect(x + 1, yy - 1, inner + 2, MINI, 'ink');
              ui.mini(x + 4, yy, upper, 'lime');
            },
          });
        });
        y = top + h + 2;
        continue;
      }
      const bullet = b.kind === 'li' ? (b.bullet ?? '-') : '';
      const indent = bullet ? 6 * (bullet.length + 1) : 0;
      const color: HudColor = b.color ?? (b.kind === 'li' ? 'white' : 'mist');
      wrap(b.text.toUpperCase(), inner - indent).forEach((text, i) => {
        lines.push({
          y,
          h: LINE,
          draw: (ui, x, yy) => {
            if (i === 0 && bullet) ui.text(x + 2, yy, bullet.toUpperCase(), { color: 'sand' });
            ui.text(x + 2 + indent, yy, text, { color });
          },
        });
        y += LINE;
      });
      y += 2;
    }
    this.lines = lines;
    this.total = y;
  }
}
