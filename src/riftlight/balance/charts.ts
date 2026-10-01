/**
 * Balance charts on the engine's software canvas (no DOM, no GPU): line charts over depth
 * with the designed levels (1–12) given 40% of the width, log axes for times, one colour
 * per build (solid = geared, dotted = naked), and a dashboard that stacks everything with
 * the top outliers. The CLI encodes them to PNG.
 */
import { Canvas, type RGB, type SheetImage } from '../../engine/animation/raster';
import type { BuildArchetype } from './builds';
import { findOutliers } from './outliers';
import type { BalanceResult, Row } from './sim';

const BG: RGB = [28, 31, 44];
const PANEL: RGB = [36, 40, 56];
const GRID: RGB = [52, 58, 80];
const AXIS: RGB = [90, 98, 128];
const TEXT: RGB = [230, 232, 240];
const DIM: RGB = [150, 156, 180];
const WARN: RGB = [255, 205, 117];

export interface Series {
  label: string;
  color: RGB;
  xs: readonly number[];
  ys: readonly number[];
  dotted?: boolean;
  /** Write the label at the line's end. */
  endLabel?: boolean;
}

export interface LineChartOptions {
  title: string;
  series: readonly Series[];
  log?: boolean;
  /** Fixed y range (else from the data). */
  yMin?: number;
  yMax?: number;
  unit?: (v: number) => string;
  width?: number;
  height?: number;
  /** Depth axis: last designed level (gets 40% of the width) and the deepest depth. */
  split?: number;
  maxX?: number;
  /** Tick values (default: 1-2-5 on log axes). */
  ticks?: (lo: number, hi: number) => number[];
  /** Horizontal reference line (e.g. 1 hit). */
  ref?: { y: number; label: string };
}

const niceLog = (lo: number, hi: number): number[] => {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 2, 5]) out.push(m * 10 ** e);
  const inside = out.filter((v) => v >= lo * 0.999 && v <= hi * 1.001);
  return inside.length > 7 ? inside.filter((v) => String(v).startsWith('1')) : inside;
};
const niceLinear = (lo: number, hi: number): number[] => {
  const span = hi - lo || 1;
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].map((s) => s * 10 ** Math.floor(Math.log10(span / 50))).find((s) => span / s <= 6) ?? span / 5;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
};
/** Log ticks that read as times: 1 s, 10 s, 1 min, 10 min, 1 h, 10 h, 100 h ... */
export const timeTicks = (lo: number, hi: number): number[] => {
  const base = [0.1, 1, 10, 60, 600, 3600, 36000];
  for (let h = 360000; h < hi * 10; h *= 10) base.push(h);
  const out = base.filter((v) => v >= lo * 0.999 && v <= hi * 1.001);
  return out.length > 7 ? out.filter((_, i) => i % 2 === out.length % 2) : out;
};
export const fmtNum = (v: number): string => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : v >= 10 ? v.toFixed(0) : v >= 1 ? `${+v.toFixed(1)}` : `${+v.toFixed(2)}`);
export const fmtSecs = (v: number): string => (v >= 3600 ? `${fmtNum(v / 3600)}H` : v >= 60 ? `${fmtNum(v / 60)}M` : `${fmtNum(v)}S`);

/** A line chart over depth. */
export function lineChart(o: LineChartOptions): SheetImage {
  const W = o.width ?? 470;
  const H = o.height ?? 240;
  const L = 46;
  const T = 24;
  const R = 58;
  const B = 22;
  const pw = W - L - R;
  const ph = H - T - B;
  const c = new Canvas(W, H);
  c.rect(0, 0, W, H, PANEL);
  c.text(o.title, 8, 8, TEXT);
  const all = o.series.flatMap((s) => s.ys).filter((v) => Number.isFinite(v) && (!o.log || v > 0));
  let lo = o.yMin ?? (all.length ? Math.min(...all) : 0);
  let hi = o.yMax ?? (all.length ? Math.max(...all) : 1);
  if (o.ref) {
    lo = Math.min(lo, o.ref.y);
    hi = Math.max(hi, o.ref.y);
  }
  if (o.log) {
    lo = Math.max(1e-3, lo);
    if (hi <= lo) hi = lo * 10;
    lo = 10 ** (Math.floor(Math.log10(lo) * 2) / 2);
    hi = 10 ** (Math.ceil(Math.log10(hi) * 2) / 2);
  } else {
    if (o.yMin === undefined) lo = Math.min(0, lo);
    if (hi <= lo) hi = lo + 1;
    hi *= 1.05;
  }
  const split = o.split ?? 12;
  const maxX = o.maxX ?? Math.max(split + 1, ...o.series.flatMap((s) => s.xs));
  const px = (x: number) => Math.round(L + (x <= split ? ((x - 1) / Math.max(1, split - 1)) * 0.4 * pw : 0.4 * pw + ((x - split) / Math.max(1, maxX - split)) * 0.6 * pw));
  const py = (v: number) => {
    const k = o.log ? (Math.log(Math.max(lo, Math.min(hi, v))) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo);
    return Math.round(T + ph - k * ph);
  };
  // grid + y labels
  const unit = o.unit ?? fmtNum;
  for (const v of o.ticks ? o.ticks(lo, hi) : o.log ? niceLog(lo, hi) : niceLinear(lo, hi)) {
    const y = py(v);
    c.rect(L, y, pw, 1, GRID);
    const s = unit(v);
    c.text(s, L - 4 - s.length * 6, y - 3, DIM);
  }
  // x: designed | rifts
  c.rect(L, T + ph, pw, 1, AXIS);
  const xs = [1, 4, 8, split, ...[0.25, 0.5, 0.75, 1].map((k) => Math.round(split + k * (maxX - split)))].filter((x, i, a) => a.indexOf(x) === i && x <= maxX);
  for (const x of xs) {
    c.rect(px(x), T + ph, 1, 3, AXIS);
    const s = String(x);
    c.text(s, px(x) - s.length * 3, T + ph + 6, DIM);
  }
  c.rect(px(split + 0.5), T, 1, ph, AXIS, 0.6);
  c.text('RIFTS', px(split + 0.5) + 4, T + 2, DIM);
  if (o.ref) {
    const y = py(o.ref.y);
    for (let x = L; x < L + pw; x += 4) c.rect(x, y, 2, 1, WARN);
    c.text(o.ref.label, L + 4, y - 9, WARN);
  }
  // series: naked first (underneath)
  const order = [...o.series].sort((a, b) => Number(!!b.dotted) - Number(!!a.dotted));
  for (const s of order) {
    let prev: [number, number] | null = null;
    for (let i = 0; i < s.xs.length; i++) {
      const v = s.ys[i]!;
      if (!Number.isFinite(v) || (o.log && v <= 0)) {
        prev = null;
        continue;
      }
      const p: [number, number] = [px(s.xs[i]!), py(v)];
      if (prev) {
        if (s.dotted) {
          const n = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 3));
          for (let k = 0; k < n; k += 2) c.rect(Math.round(prev[0] + ((p[0] - prev[0]) * k) / n), Math.round(prev[1] + ((p[1] - prev[1]) * k) / n), 1, 1, s.color);
        } else c.line(prev[0], prev[1], p[0], p[1], s.color, 1, 2);
      }
      if (!s.dotted) c.rect(p[0] - 1, p[1] - 1, 3, 3, s.color);
      prev = p;
    }
  }
  // end labels, pushed apart
  const ends = o.series
    .filter((s) => s.endLabel)
    .map((s) => {
      let i = s.ys.length - 1;
      while (i >= 0 && !Number.isFinite(s.ys[i]!)) i--;
      return i < 0 ? null : { s, y: py(s.ys[i]!) - 3 };
    })
    .filter((e): e is { s: Series; y: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i]!.y = Math.max(ends[i]!.y, ends[i - 1]!.y + 9);
  for (const e of ends) c.text(e.s.label, L + pw + 5, Math.min(H - 10, e.y), e.s.color);
  return { width: W, height: H, data: c.data };
}

/** Lay images out left to right, wrapping after `cols`. */
export function tile(images: readonly SheetImage[], cols: number, gap = 6, bg: RGB = BG): SheetImage {
  const cw = Math.max(...images.map((i) => i.width));
  const ch = Math.max(...images.map((i) => i.height));
  const rows = Math.ceil(images.length / cols);
  const width = cols * cw + (cols + 1) * gap;
  const height = rows * ch + (rows + 1) * gap;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([bg[0], bg[1], bg[2], 255], i * 4);
  images.forEach((img, i) => {
    const x0 = gap + (i % cols) * (cw + gap);
    const y0 = gap + Math.floor(i / cols) * (ch + gap);
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y0 + y) * width + x0) * 4);
  });
  return { width, height, data };
}

/** Text block: a title and lines (wrapped to the width). */
export function textPanel(title: string, lines: readonly { text: string; color?: RGB }[], width: number): SheetImage {
  const per = Math.floor((width - 20) / 6);
  const wrapped: { text: string; color: RGB }[] = [];
  for (const l of lines) {
    let s = l.text;
    let first = true;
    while (s.length) {
      let cut = s.length <= per - (first ? 0 : 2) ? s.length : s.lastIndexOf(' ', per - (first ? 0 : 2));
      if (cut <= 0) cut = per - 2;
      wrapped.push({ text: (first ? '' : '  ') + s.slice(0, cut), color: l.color ?? DIM });
      s = s.slice(cut).trimStart();
      first = false;
    }
  }
  const H = 26 + wrapped.length * 10 + 6;
  const c = new Canvas(width, H);
  c.rect(0, 0, width, H, PANEL);
  c.text(title, 8, 8, TEXT);
  wrapped.forEach((l, i) => c.text(l.text, 10, 24 + i * 10, l.color));
  return { width, height: H, data: c.data };
}

function stackImages(images: readonly SheetImage[], gap = 6): SheetImage {
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((s, i) => s + i.height + gap, gap);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([BG[0], BG[1], BG[2], 255], i * 4);
  let y = gap;
  for (const img of images) {
    for (let r = 0; r < img.height; r++) data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * width + Math.floor((width - img.width) / 2)) * 4);
    y += img.height + gap;
  }
  return { width, height, data };
}

function legend(builds: readonly BuildArchetype[], width: number, note: string): SheetImage {
  const c = new Canvas(width, 24);
  c.rect(0, 0, width, 24, BG);
  let x = 8;
  for (const b of builds) {
    c.rect(x, 9, 14, 3, b.color as RGB);
    c.text(b.name, x + 18, 8, TEXT);
    x += 18 + b.name.length * 6 + 16;
  }
  c.text(note, Math.max(x, width - note.length * 6 - 8), 8, DIM);
  return { width, height: 24, data: c.data };
}

/** ttk / survival / clear charts and the dashboard (`balance`). */
export function renderBalanceCharts(r: BalanceResult, builds: readonly BuildArchetype[], meta: { seed: number; raw?: boolean }): Record<string, SheetImage> {
  const depths = [...new Set(r.rows.map((x) => x.depth))].sort((a, b) => a - b);
  const maxX = Math.max(13, ...depths, ...r.xp.map((x) => x.depth));
  const series = (get: (row: Row) => number, label = true): Series[] =>
    builds.flatMap((b) =>
      (['naked', 'geared'] as const)
        .map((v) => {
          const rows = r.rows.filter((x) => x.build === b.id && x.variant === v).sort((p, q) => p.depth - q.depth);
          if (!rows.length) return null;
          return { label: b.id.toUpperCase(), color: b.color as RGB, xs: rows.map((x) => x.depth), ys: rows.map(get), dotted: v === 'naked', endLabel: label && v === 'geared' } satisfies Series;
        })
        .filter((s): s is NonNullable<typeof s> => s !== null),
    );
  const chart = (title: string, get: (row: Row) => number, extra: Partial<LineChartOptions> = {}) => lineChart({ title, series: series(get), log: true, unit: fmtSecs, ticks: timeTicks, maxX, ...extra });
  const note = 'SOLID = GEARED  DOTTED = NAKED  X = DEPTH';
  const ttk = tile([chart('TIME TO KILL: NORMAL', (x) => x.ttk.normal), chart('TIME TO KILL: MAGIC', (x) => x.ttk.magic), chart('TIME TO KILL: RARE', (x) => x.ttk.rare), chart('TIME TO KILL: BOSS', (x) => x.ttk.boss)], 2);
  const survival = tile(
    [
      chart('HITS TO DIE: BOSS BIGGEST HIT', (x) => x.hitsToDie.boss, { unit: fmtNum, ticks: undefined, ref: { y: 1, label: 'ONE-SHOT' } }),
      chart('HITS TO DIE: RARE BIGGEST HIT', (x) => x.hitsToDie.rare, { unit: fmtNum, ticks: undefined, ref: { y: 1, label: 'ONE-SHOT' } }),
      chart('DAMAGE TAKEN/S FROM THE BOSS (% LIFE+ES)', (x) => (100 * x.dtps.boss) / Math.max(1, x.life + x.es), { unit: (v) => `${fmtNum(v)}%`, ticks: undefined }),
      chart('TIME TO DIE VS BOSS, NO POTIONS (CAP 1H)', (x) => Math.min(3600, x.timeToDie.boss)),
    ],
    2,
  );
  const levels: Series = { label: 'LEVEL', color: [244, 244, 244], xs: r.xp.map((x) => x.depth), ys: r.xp.map((x) => x.levelAfter), endLabel: true };
  const clear = tile(
    [
      chart('CLEAR TIME PER LEVEL', (x) => x.clear.total),
      chart('DPS VS A NORMAL MONSTER', (x) => x.dps, { unit: fmtNum, ticks: undefined }),
      lineChart({ title: 'HERO LEVEL AFTER EACH DEPTH (XP CURVE)', series: [levels], maxX, unit: fmtNum, yMin: 0 }),
      chart('MAIN SKILL AFFORDABLE (MANA SUSTAIN %)', (x) => 100 * x.sustain, { log: false, yMin: 0, yMax: 100, unit: (v) => `${v.toFixed(0)}%`, ticks: undefined }),
    ],
    2,
  );
  const wide = ttk.width;
  const head = legend(builds, wide, note);
  const outliers = findOutliers(r.rows).slice(0, 8);
  const summary = textPanel(
    `BALANCE  SEED ${meta.seed}${meta.raw ? '  RAW STATS' : ''}  ${depths.length} DEPTHS  ${builds.length} BUILDS: WORST OUTLIERS`,
    outliers.length ? outliers.map((o) => ({ text: `! ${o.text.replace(/×/g, 'x').replace(/→/g, '>')}`, color: o.severity >= 1.5 ? WARN : TEXT })) : [{ text: 'no outliers' }],
    wide - 12,
  );
  return {
    ttk: stackImages([head, ttk]),
    survival: stackImages([head, survival]),
    clear: stackImages([head, clear]),
    balance: stackImages([summary, head, ttk, survival, clear]),
  };
}
