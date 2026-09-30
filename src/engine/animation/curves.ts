import type { AnimationClip, Object3D } from 'three/webgpu';
import { GLYPH_H, textWidth } from './font';
import { sampleFrames } from './metrics';
import { sampleClip } from './pose';
import { BAD, Canvas, CELL_BG, CONTACT, DIM, GRID, GROUND, LEFT, RIGHT, TEXT, WARN, type RGB, type SheetImage } from './raster';
import type { ClipDef, RigSpec } from './types';

/**
 * Motion curves — the animator's graph editor, as a PNG. Contact sheets show *poses*;
 * curves show *timing*: where a move eases in and out, whether it anticipates and
 * overshoots, holds that read as dead, pops and snaps, and how the loop wraps.
 *
 *   HEIGHTS   world height of the feet, hands, head and pelvis (the bouncing-ball view:
 *             arcs, contacts, hang time); the floor is the grey line at 0
 *   ROOT      pelvis offset (x/y/z) and squash, as authored
 *   <joint>   one panel per moving joint: X red, Y green, Z blue (degrees, as authored);
 *             red ticks underneath mark frames where it turns faster than 1200°/s
 *   SPEED     fastest joint rotation per frame (°/s) — spikes are pops
 *
 * Dashed verticals are keys (numbered). Loops are drawn twice so the wrap is visible.
 * `compare` draws a previous version of the clip in grey underneath.
 */
export interface CurveOptions {
  /** Cycles to draw (default 2 for loops, 1 otherwise). */
  cycles?: number;
  /** Joints to plot (default: every joint that moves more than 1°). */
  joints?: readonly string[];
  /** Plot width in pixels (default: 24 px per frame, 640..1400). */
  width?: number;
  /** Previous version of the clip, drawn in grey under the current curves. */
  compare?: { def: ClipDef; clip: AnimationClip };
}

const X_COL: RGB = [255, 96, 96];
const Y_COL: RGB = [110, 230, 120];
const Z_COL: RGB = [110, 160, 255];
const S_COL: RGB = [255, 205, 117];
const OLD: RGB = [120, 124, 140];
const SNAP = 1200;

interface Series {
  label: string;
  color: RGB;
  values: number[];
  old?: number[];
}

interface Panel {
  title: string;
  series: Series[];
  height: number;
  /** Minimum vertical span, in the panel's units. */
  minSpan: number;
  unit: string;
  floor?: number;
  threshold?: number;
  ticks?: boolean[];
}

export function renderCurves(model: Object3D, rig: RigSpec, def: ClipDef, clip: AnimationClip, options: CurveOptions = {}): SheetImage {
  const cycles = options.cycles ?? (def.loop ? 2 : 1);
  const span = def.frames * cycles;
  const step = 0.5;
  const times = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => i * step);
  const wrap = (f: number) => (def.loop ? f % def.frames : Math.min(f, def.frames));

  // ---- data
  const authored = times.map((f) => sampleClip(def, f, rig));
  const world = sampleFrames(model, rig, clip, times.map(wrap));
  const old = options.compare;
  const oldAuthored = old ? times.map((f) => sampleClip(old.def, f, rig)) : null;
  const oldWorld = old ? sampleFrames(model, rig, old.clip, times.map((f) => (old.def.loop ? f % old.def.frames : Math.min(f, old.def.frames)))) : null;

  const panels: Panel[] = [];
  const heightSeries = (w: typeof world): Series[] => [
    { label: 'FOOT R', color: RIGHT, values: w.map((s) => s.soles[rig.soles[0]!]!.minY) },
    { label: 'FOOT L', color: LEFT, values: w.map((s) => s.soles[rig.soles[1]!]!.minY) },
    ...rig.trace
      .filter((t) => !rig.soles.includes(t))
      .map((t): Series => ({ label: shortName(t), color: /R$/.test(t) ? dim(RIGHT) : /L$/.test(t) ? dim(LEFT) : S_COL, values: w.map((s) => s.trace[t]!.y) })),
    { label: 'PELVIS', color: [230, 232, 240], values: w.map((s) => s.joints[rig.root]!.y) },
  ];
  const hs = heightSeries(world);
  if (oldWorld) heightSeries(oldWorld).forEach((s, i) => (hs[i]!.old = s.values));
  panels.push({ title: 'HEIGHTS', series: hs, height: 130, minSpan: 0.5, unit: 'M', floor: 0 });

  const root = authored.map((p) => p[rig.root]!);
  const rootOld = oldAuthored?.map((p) => p[rig.root]!);
  const rootSeries: Series[] = [
    { label: 'X', color: X_COL, values: root.map((j) => j.p[0]), old: rootOld?.map((j) => j.p[0]) },
    { label: 'Y', color: Y_COL, values: root.map((j) => j.p[1]), old: rootOld?.map((j) => j.p[1]) },
    { label: 'Z', color: Z_COL, values: root.map((j) => j.p[2]), old: rootOld?.map((j) => j.p[2]) },
    { label: 'SQUASH', color: S_COL, values: root.map((j) => j.s[1] - 1), old: rootOld?.map((j) => j.s[1] - 1) },
  ];
  if (rootSeries.some((s) => range(s.values) > 0.005 || (s.old && range(s.old) > 0.005))) panels.push({ title: 'ROOT', series: rootSeries, height: 80, minSpan: 0.1, unit: 'M' });

  const moving = options.joints ?? rig.joints.filter((j) => [0, 1, 2].some((k) => range(authored.map((p) => p[j]!.r[k]!)) > 1 || (oldAuthored && range(oldAuthored.map((p) => p[j]!.r[k]!)) > 1)));
  const speeds = new Array<number>(times.length).fill(0);
  for (const j of moving) {
    const series: Series[] = [X_COL, Y_COL, Z_COL].map((color, k) => ({
      label: 'XYZ'[k]!,
      color,
      values: authored.map((p) => p[j]!.r[k]!),
      old: oldAuthored?.map((p) => p[j]!.r[k]!),
    }));
    const ticks = times.map((_, i) => {
      if (!i) return false;
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(wrapDeg(authored[i]![j]!.r[k]! - authored[i - 1]![j]!.r[k]!)))) * (rig.fps / step);
      speeds[i] = Math.max(speeds[i]!, d);
      return d > SNAP;
    });
    panels.push({ title: j, series, height: 64, minSpan: 20, unit: '°', ticks: def.fast ? undefined : ticks });
  }
  // speeds of joints not plotted still count
  for (let i = 1; i < times.length; i++) {
    for (const j of rig.joints) {
      if (moving.includes(j)) continue;
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(wrapDeg(authored[i]![j]!.r[k]! - authored[i - 1]![j]!.r[k]!)))) * (rig.fps / step);
      speeds[i] = Math.max(speeds[i]!, d);
    }
  }
  panels.push({ title: 'SPEED', series: [{ label: 'MAX °/S', color: [230, 232, 240], values: speeds }], height: 64, minSpan: 600, unit: '°/S', floor: 0, threshold: def.fast ? undefined : SNAP });

  // ---- layout
  const M = 8;
  const labelW = 76;
  const plotW = options.width ?? Math.min(1400, Math.max(640, Math.round(span * 24)));
  const header = 2 * GLYPH_H + 16 + 4 + GLYPH_H + 4;
  // legend entries (label + range), wrapped into rows under each panel
  const legends = panels.map((p) =>
    p.series
      .filter((s) => range(s.values) >= 1e-3 || p.series.length === 1)
      .map((s) => ({ color: s.color, text: `${s.label} ${fmt(Math.min(...s.values), p.unit)}..${fmt(Math.max(...s.values), p.unit)}` })),
  );
  const legendRows = legends.map((items) => {
    const rows: { color: RGB; text: string; x: number }[][] = [[]];
    let lx = 0;
    for (const it of items) {
      const w = textWidth(it.text) + 22;
      if (lx && lx + w > plotW) {
        rows.push([]);
        lx = 0;
      }
      rows.at(-1)!.push({ ...it, x: lx });
      lx += w;
    }
    return rows;
  });
  const gapOf = (i: number) => Math.max(1, legendRows[i]!.length) * (GLYPH_H + 3) + 4;
  const width = M * 2 + labelW + plotW + 8;
  const height = M * 2 + header + panels.reduce((s, p, i) => s + p.height + gapOf(i), 0) + GLYPH_H + 6;
  const cv = new Canvas(width, height);
  const x0 = M + labelW;
  const xOf = (f: number) => x0 + (f / span) * plotW;

  cv.text(`${def.name}  CURVES`, M, M, TEXT, 2);
  cv.text(
    [`${def.frames} F @${rig.fps}FPS`, def.loop ? `LOOP x${cycles}` : 'ONCE', def.speed ? `SPEED ${def.speed} M/S` : '', 'X=RED Y=GREEN Z=BLUE', old ? 'GREY = PREVIOUS VERSION' : ''].filter(Boolean).join('  '),
    M,
    M + 2 * GLYPH_H + 4,
    DIM,
  );
  // key labels
  const keyFrames = [...new Set(def.keys.map((k) => k[0]))];
  const keyTimes: number[] = [];
  for (let c = 0; c < cycles; c++) for (const k of keyFrames) if (!def.loop || k < def.frames || c === cycles - 1) keyTimes.push(k + c * def.frames);
  let lastLabelX = -Infinity;
  const labelY = M + 2 * GLYPH_H + 4 + GLYPH_H + 4;
  for (const t of keyTimes) {
    if (t > span + 1e-6) continue;
    const x = Math.round(xOf(t));
    const s = `${round1(t % def.frames === 0 && t > 0 && def.loop ? def.frames : t)}`;
    if (x - lastLabelX < textWidth(s) + 4) continue;
    cv.text(s, x - Math.floor(textWidth(s) / 2), labelY, DIM);
    lastLabelX = x;
  }

  let y = M + header;
  for (const [pi, p] of panels.entries()) {
    const all = p.series.flatMap((s) => [...s.values, ...(s.old ?? [])]);
    if (p.floor !== undefined) all.push(p.floor);
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    if (hi - lo < p.minSpan) {
      const c = (lo + hi) / 2;
      lo = c - p.minSpan / 2;
      hi = c + p.minSpan / 2;
      // nothing below the floor: keep it at the bottom instead of centring
      if (p.floor !== undefined && lo < p.floor && Math.min(...all) >= p.floor) {
        hi += p.floor - lo;
        lo = p.floor;
      }
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const yOf = (v: number) => y + p.height - 1 - ((v - lo) / (hi - lo)) * (p.height - 1);
    cv.rect(x0, y, plotW, p.height, CELL_BG);
    // zero / floor line and loop boundaries
    if (lo < 0 && hi > 0) hline(cv, x0, plotW, Math.round(yOf(0)), p.floor === 0 ? GROUND : GRID);
    if (p.threshold !== undefined && p.threshold < hi) hline(cv, x0, plotW, Math.round(yOf(p.threshold)), BAD, 0.6);
    for (let c = 1; c < cycles; c++) cv.line(xOf(c * def.frames), y, xOf(c * def.frames), y + p.height - 1, DIM, 0.8);
    for (const t of keyTimes) dashed(cv, Math.round(xOf(t)), y, p.height, GRID);
    // curves: previous version first, then current
    for (const s of p.series) if (s.old) polyline(cv, s.old, times, xOf, yOf, OLD, 1);
    for (const s of p.series) polyline(cv, s.values, times, xOf, yOf, s.color, s.color === OLD ? 1 : 2);
    if (p.ticks) p.ticks.forEach((t, i) => t && cv.rect(Math.round(xOf(times[i]!)) - 1, y + p.height - 4, 3, 4, BAD));
    // labels
    cv.text(shortName(p.title), M, y + 2, TEXT);
    cv.text(`${fmt(hi, p.unit)}`, M, y + 2 + GLYPH_H + 2, DIM);
    cv.text(`${fmt(lo, p.unit)}`, M, y + p.height - GLYPH_H, DIM);
    // legend under the panel, with each series' range
    legendRows[pi]!.forEach((row, ri) => {
      const ly = y + p.height + 2 + ri * (GLYPH_H + 3);
      for (const it of row) {
        cv.rect(x0 + it.x, ly + 1, 6, 6, it.color);
        cv.text(it.text, x0 + it.x + 9, ly, DIM);
      }
    });
    y += p.height + gapOf(pi);
  }
  const maxSpeed = Math.max(...speeds);
  cv.text(
    `FASTEST ${maxSpeed.toFixed(0)}°/S${!def.fast && maxSpeed > SNAP ? '  (RED TICKS: FASTER THAN 1200°/S)' : ''}`,
    M,
    y,
    !def.fast && maxSpeed > SNAP ? WARN : CONTACT,
  );
  return { width, height, data: cv.data };
}

function polyline(cv: Canvas, values: number[], times: number[], xOf: (f: number) => number, yOf: (v: number) => number, color: RGB, thick: number): void {
  for (let i = 1; i < values.length; i++) cv.line(xOf(times[i - 1]!), yOf(values[i - 1]!), xOf(times[i]!), yOf(values[i]!), color, 1, thick);
}

function hline(cv: Canvas, x: number, w: number, y: number, c: RGB, a = 1): void {
  for (let i = 0; i < w; i++) cv.set(x + i, y, c, a);
}

function dashed(cv: Canvas, x: number, y: number, h: number, c: RGB): void {
  for (let i = 0; i < h; i++) if (i % 4 < 2) cv.set(x, y + i, c);
}

function range(v: number[]): number {
  return Math.max(...v) - Math.min(...v);
}

function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function dim(c: RGB): RGB {
  return [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7];
}

function shortName(s: string): string {
  return s.length > 12 ? s.slice(0, 12) : s;
}

function fmt(v: number, unit: string): string {
  if (unit === 'M') return `${(v * 100).toFixed(0)}CM`;
  if (unit === '°/S') return `${v.toFixed(0)}`;
  return `${v.toFixed(0)}${unit}`;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
