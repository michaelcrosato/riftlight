/**
 * HUD layout and priority: what the screen shows when everything happens at once.
 *
 * - **`HudLayout`**: the rects already taken this frame. The fixed HUD (orbs, skill bar,
 *   minimap, boss bar, the banner, the loot feed, the prompt) reserves its zones first; world
 *   overlays then `place` themselves around them, most important first: the focused loot
 *   label, the other labels, then damage numbers. Something that finds no free spot within a
 *   few steps is skipped for the frame (a label 3 rows up a pile is no use to anyone).
 * - **`BannerQueue`**: one centre banner at a time (the level card, LEVEL CLEAR, a level-up,
 *   a codex unlock). Banners queue instead of stacking; a repeat of the same kind merges into
 *   the one showing (two level-ups in a row read "LEVEL 5" then update to "LEVEL 6"); higher
 *   priority cuts a lower one short.
 *
 * Pure (no DOM, no three): unit-tested in `layout.test.ts`.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box, pad = 1): boolean => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export class HudLayout {
  readonly taken: Box[] = [];
  /** Screen size (art pixels): placed rects stay inside it. */
  w = 480;
  h = 270;

  clear(w: number, h: number): void {
    this.taken.length = 0;
    this.w = w;
    this.h = h;
  }

  reserve(r: Box | null | undefined): void {
    if (r && r.w > 0 && r.h > 0) this.taken.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }

  free(r: Box, pad = 1): boolean {
    for (const t of this.taken) if (overlaps(r, t, pad)) return false;
    return true;
  }

  /**
   * Find a free spot for `r`: first where it is, then stepping up (`dir` −1) or down by `step`
   * up to `tries` times; also nudged sideways into the screen. Reserves and returns the spot,
   * or null when there is none.
   */
  place(r: Box, o: { dir?: -1 | 1; step?: number; tries?: number; pad?: number } = {}): Box | null {
    const dir = o.dir ?? -1;
    const step = o.step ?? r.h + 1;
    const tries = o.tries ?? 6;
    const pad = o.pad ?? 1;
    const x = Math.max(1, Math.min(this.w - r.w - 1, r.x));
    for (let i = 0; i <= tries; i++) {
      const c = { x, y: r.y + dir * step * i, w: r.w, h: r.h };
      if (c.y < 1 || c.y + c.h > this.h - 1) break;
      if (this.free(c, pad)) {
        this.taken.push(c);
        return c;
      }
    }
    return null;
  }
}

export type BannerKind = 'card' | 'clear' | 'levelup' | 'notice';

export interface Banner {
  kind: BannerKind;
  title: string;
  subtitle: string;
  /** Seconds shown so far. */
  age: number;
  /** Seconds it stays. */
  duration: number;
}

/** Higher first: a level clear cuts a level-up short, a level-up waits for the level card. */
const PRIORITY: Readonly<Record<BannerKind, number>> = { clear: 3, card: 2, levelup: 1, notice: 0 };
const DURATION: Readonly<Record<BannerKind, number>> = { card: 3.2, clear: 4, levelup: 2.4, notice: 2 };

export class BannerQueue {
  current: Banner | null = null;
  readonly queue: Banner[] = [];

  /** Show a banner now, after the current one, or merged into the current one of the same kind. */
  push(kind: BannerKind, title: string, subtitle = '', o: { duration?: number; age?: number } = {}): Banner {
    const b: Banner = { kind, title, subtitle, age: o.age ?? 0, duration: o.duration ?? DURATION[kind] };
    const cur = this.current;
    if (cur && cur.kind === kind && kind === 'levelup') {
      // a second level-up while the first shows: update it in place and keep it a little longer
      cur.title = title;
      cur.subtitle = subtitle;
      cur.age = Math.min(cur.age, 0.3);
      return cur;
    }
    const queued = this.queue.find((q) => q.kind === kind && kind === 'levelup');
    if (queued) {
      queued.title = title;
      queued.subtitle = subtitle;
      return queued;
    }
    if (!cur) this.current = b;
    else if (PRIORITY[kind] > PRIORITY[cur.kind]) {
      // cut the lower one short, but let it come back if it has time left
      if (cur.duration - cur.age > 1 && cur.kind !== 'card') this.queue.unshift(cur);
      this.current = b;
    } else {
      this.queue.push(b);
      this.queue.sort((a, c) => PRIORITY[c.kind] - PRIORITY[a.kind]);
    }
    return b;
  }

  update(dt: number): void {
    if (!this.current) return;
    this.current.age += dt;
    if (this.current.age >= this.current.duration) {
      this.current = this.queue.shift() ?? null;
      // a queued banner opens fresh (its open animation)
      if (this.current) this.current.age = Math.min(this.current.age, 0);
    }
  }

  clear(): void {
    this.current = null;
    this.queue.length = 0;
  }
}
