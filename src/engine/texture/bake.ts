/**
 * TextureDef → texels. `bakeTexture` draws the layers in order onto a grid of palette indices
 * (0 = transparent) and resolves them to RGBA, with no DOM and no GPU, so tools, tests and the
 * game all see the same texels. Everything that stops a texture baking right (a malformed def or
 * layer, an unknown slot or colour, a pixel missing from its legend, ragged rows, a bad pattern
 * parameter, frames that don't divide the width) is collected as a problem, not thrown;
 * `validateTexture` reports them with the warnings, and the converters refuse a texture that has
 * any.
 */
import { isPaletteName, PALETTE, type PaletteColor } from '../palette';
import { svgOutlines } from '../model/prims';
import { PATTERNS, type PatternParams } from './patterns';
import type { Layer, OutlineLayer, PathLayer, PatternLayer, PixelsLayer, TexSlot, TextureDef } from './types';

export interface BakedTexture {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Per texel, row by row from the top: the slot's index in `slots` + 1, or 0 (transparent). */
  readonly indices: Uint8Array;
  /** The palette's slots, in order. */
  readonly slots: readonly TexSlot[];
  /** RGBA per texel (sRGB), row by row from the top; transparent texels are 0, 0, 0, 0. */
  readonly rgba: Uint8Array;
  readonly problems: readonly string[];
}

export interface BakeOptions {
  /** Re-bind slots to other PALETTE colours or hex numbers (a theme's tint). */
  readonly palette?: Readonly<Record<TexSlot, PaletteColor | number>>;
}

/** 4×4 ordered dither thresholds (Bayer), 0..1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16);
export const isPattern = (l: Layer): l is PatternLayer => 'pattern' in l;
export const isPixels = (l: Layer): l is PixelsLayer => 'pixels' in l;

/** The keys each kind of layer takes (a pattern layer also takes its pattern's params). */
const LAYER_KEYS = {
  pixels: ['pixels', 'legend', 'at', 'mirror'],
  pattern: ['pattern', 'colors', 'seed', 'dither'],
  path: ['path', 'fill', 'stroke'],
  outline: ['outline'],
} as const;
/** Slots a texture may have: indices are bytes, 0 is transparent. */
const MAX_SLOTS = 255;

/** The params a pattern layer sets, checked against the pattern's own, defaults filled in. */
function patternParams(layer: PatternLayer, at: string, problems: string[]): PatternParams | null {
  const spec = Object.hasOwn(PATTERNS, layer.pattern) ? PATTERNS[layer.pattern] : undefined;
  if (!spec) {
    problems.push(`${at} uses pattern ${JSON.stringify(layer.pattern)}, which doesn't exist: use one of ${Object.keys(PATTERNS).join(', ')}`);
    return null;
  }
  const out: Record<string, number | string> = {};
  for (const [k, s] of Object.entries(spec.params)) {
    const v = layer[k];
    if (typeof s[0] === 'number') {
      const [def, min, max, whole] = s as readonly [number, number, number, 'whole'?];
      if (v === undefined) out[k] = def;
      else if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) problems.push(`${at} sets ${layer.pattern} ${k} = ${JSON.stringify(v)}: use a ${whole ? 'whole number' : 'number'} from ${min} to ${max}`);
      else out[k] = v;
    } else {
      const options = s as readonly string[];
      if (v === undefined) out[k] = options[0]!;
      else if (typeof v !== 'string' || !options.includes(v)) problems.push(`${at} sets ${layer.pattern} ${k} = ${JSON.stringify(v)}: use one of ${options.join(', ')}`);
      else out[k] = v;
    }
  }
  const known = new Set([...LAYER_KEYS.pattern, ...Object.keys(spec.params)]);
  for (const k of Object.keys(layer)) if (!known.has(k)) problems.push(`${at} sets '${k}', which ${layer.pattern} doesn't take (${Object.keys(spec.params).join(', ') || 'no params'})`);
  if (layer.seed !== undefined && !Number.isInteger(layer.seed)) problems.push(`${at} has seed ${JSON.stringify(layer.seed)}: use a whole number`);
  if (layer.dither !== undefined && typeof layer.dither !== 'boolean') problems.push(`${at} has dither ${JSON.stringify(layer.dither)}: use true or false`);
  return out;
}

/** Which kind a layer is, or a problem when it is none or several. */
function kindOf(layer: unknown, at: string, problems: string[]): keyof typeof LAYER_KEYS | null {
  if (typeof layer !== 'object' || layer === null) {
    problems.push(`${at} is ${JSON.stringify(layer)}, not a layer: use { pixels }, { pattern }, { path } or { outline }`);
    return null;
  }
  const kinds = (Object.keys(LAYER_KEYS) as (keyof typeof LAYER_KEYS)[]).filter((k) => k in layer);
  if (kinds.length !== 1) {
    problems.push(`${at} ${kinds.length ? `is ${kinds.join(' and ')} at once` : `is not a layer (keys: ${Object.keys(layer).join(', ')})`}: a layer is one of pixels, pattern, path or outline`);
    return null;
  }
  const kind = kinds[0]!;
  if (kind !== 'pattern') {
    const known: readonly string[] = LAYER_KEYS[kind];
    for (const k of Object.keys(layer)) if (!known.includes(k)) problems.push(`${at} sets '${k}', which a ${kind} layer doesn't take (${known.join(', ')})`);
  }
  return kind;
}

/** Points inside the closed outlines (even-odd across all of them), at texel centres. */
function inside(shapes: readonly (readonly [number, number][])[], px: number, py: number): boolean {
  let hit = false;
  for (const s of shapes) {
    for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
      const [xi, yi] = s[i]!;
      const [xj, yj] = s[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

export function bakeTexture(def: TextureDef, opts: BakeOptions = {}): BakedTexture {
  const problems: string[] = [];
  const [w, h] = Array.isArray(def.size) ? def.size : [Number.NaN, Number.NaN];
  const palette: Readonly<Record<TexSlot, PaletteColor>> = typeof def.palette === 'object' && def.palette !== null ? def.palette : {};
  const layers: readonly Layer[] = Array.isArray(def.layers) ? def.layers : [];
  const slots = Object.keys(palette);
  const width = Number.isInteger(w) && w > 0 && w <= 1024 ? w : 1;
  const height = Number.isInteger(h) && h > 0 && h <= 1024 ? h : 1;
  if (width !== w || height !== h || !Array.isArray(def.size) || def.size.length !== 2) problems.push(`its size ${JSON.stringify(def.size)} isn't [width, height], two whole numbers from 1 to 1024`);
  if (!slots.length) problems.push(`it has no palette: declare its slots, e.g. palette: { stone: 'slate' }`);
  if (slots.length > MAX_SLOTS) problems.push(`its palette has ${slots.length} slots: at most ${MAX_SLOTS}`);
  if (!layers.length) problems.push(`it has no layers: add a pattern, pixels, a path or an outline`);
  for (const s of Object.keys(opts.palette ?? {})) if (!slots.includes(s)) problems.push(`the bake re-binds slot '${s}', which the palette does not declare (${slots.join(', ')})`);
  const frames = def.frames ?? 1;
  if (!(Number.isInteger(frames) && frames > 0 && width % frames === 0)) problems.push(`its ${JSON.stringify(def.frames)} frames don't divide its width ${width}: frames are equal slices, left to right`);
  // a frame's own width: outlines stay inside their frame
  const frameW = Number.isInteger(frames) && frames > 1 && width % frames === 0 ? width / frames : width;
  const tile = def.tile === true;
  const indices = new Uint8Array(width * height);
  const slotIndex = (slot: TexSlot, at: string): number => {
    const i = slots.indexOf(slot);
    if (i < 0) problems.push(`${at} uses slot '${slot}', which the palette does not declare: add it to \`palette\` or use one of ${slots.join(', ')}`);
    return i + 1;
  };
  const put = (x: number, y: number, v: number) => {
    if (tile) {
      x = ((x % width) + width) % width;
      y = ((y % height) + height) % height;
    }
    if (x >= 0 && y >= 0 && x < width && y < height) indices[y * width + x] = v;
  };

  layers.forEach((layer, li) => {
    const at = `layers[${li}]`;
    const kind = kindOf(layer, at, problems);
    if (kind === 'pixels' && isPixels(layer)) {
      if (!Array.isArray(layer.pixels) || !layer.pixels.every((r) => typeof r === 'string')) return void problems.push(`${at}'s pixels aren't a list of strings, one per row`);
      if (typeof layer.legend !== 'object' || layer.legend === null) return void problems.push(`${at} has no legend: map each character to a slot, e.g. legend: { s: 'stone' }`);
      const widths = new Set(layer.pixels.map((r) => r.length));
      if (widths.size > 1) problems.push(`${at} has ragged rows (lengths ${[...widths].join(', ')}): pad every row to the same width with '.'`);
      if (layer.mirror !== undefined && layer.mirror !== 'x' && layer.mirror !== 'y') problems.push(`${at} has mirror ${JSON.stringify(layer.mirror)}: use 'x' (rows mirrored to the right) or 'y' (below)`);
      if (layer.at !== undefined && !(Array.isArray(layer.at) && layer.at.length === 2 && layer.at.every(Number.isInteger))) problems.push(`${at} has at ${JSON.stringify(layer.at)}: use [x, y] in whole texels`);
      const [ox, oy] = Array.isArray(layer.at) && layer.at.every(Number.isInteger) ? layer.at : [0, 0];
      const rowsW = Math.max(0, ...layer.pixels.map((r) => r.length));
      const missing = new Set<string>();
      layer.pixels.forEach((row, ry) => {
        [...row].forEach((ch, rx) => {
          if (ch === '.' || ch === ' ') return;
          const slot = layer.legend[ch];
          if (slot === undefined) return void missing.add(ch);
          const v = slotIndex(slot, `${at} legend '${ch}'`);
          if (!v) return;
          put(ox + rx, oy + ry, v);
          if (layer.mirror === 'x') put(ox + 2 * rowsW - 1 - rx, oy + ry, v);
          if (layer.mirror === 'y') put(ox + rx, oy + 2 * layer.pixels.length - 1 - ry, v);
        });
      });
      for (const ch of missing) problems.push(`${at} has pixel '${ch}', which its legend doesn't name: add it to \`legend\`, or use '.' for transparent`);
    } else if (kind === 'pattern' && isPattern(layer)) {
      const ramp = (Array.isArray(layer.colors) ? layer.colors : layer.colors === undefined ? [] : [layer.colors]) as readonly TexSlot[];
      if (!ramp.length) problems.push(`${at} has no colors: give its ramp one slot or more, dark to light`);
      const ids = ramp.map((s, k) => slotIndex(s, `${at} colors[${k}]`));
      const p = patternParams(layer, at, problems);
      if (!p || !ids.length || ids.some((v) => !v)) return;
      // the layer's own seed alone: adding or removing another layer changes nothing else
      const field = PATTERNS[layer.pattern]!.field({ w: width, h: height, tile, n: ids.length, seed: Math.imul(Number.isInteger(layer.seed) ? layer.seed! : 1, 7919), p });
      const n = ids.length;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const v = field[y * width + x]!;
          if (Number.isNaN(v)) continue;
          const t = Math.min(1, Math.max(0, v)) * (n - 1);
          let i = Math.round(t);
          if (layer.dither) {
            const lo = Math.floor(t);
            i = t - lo > BAYER[(y & 3) * 4 + (x & 3)]! ? lo + 1 : lo;
          }
          indices[y * width + x] = ids[Math.min(n - 1, Math.max(0, i))]!;
        }
      }
    } else if (kind === 'path') {
      const path = layer as PathLayer;
      if (typeof path.path !== 'string') return void problems.push(`${at}'s path is ${JSON.stringify(path.path)}: write it as an SVG path string ('M 0 0 L 8 0 L 4 8 Z')`);
      let shapes: [number, number][][];
      try {
        shapes = svgOutlines(path.path);
      } catch (e) {
        problems.push(`${at} has a malformed path: ${(e as Error).message}`);
        return;
      }
      if (!shapes.length) problems.push(`${at}'s path draws no closed shape (it needs 3 or more points)`);
      if (path.fill !== undefined) {
        const v = slotIndex(path.fill, `${at} fill`);
        if (v) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (inside(shapes, x + 0.5, y + 0.5)) indices[y * width + x] = v;
      }
      if (path.stroke !== undefined) {
        const v = slotIndex(path.stroke, `${at} stroke`);
        if (v) {
          for (const s of shapes) {
            for (let i = 0; i < s.length; i++) {
              const [x0, y0] = s[i]!;
              const [x1, y1] = s[(i + 1) % s.length]!;
              const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
              for (let k = 0; k <= steps; k++) put(Math.floor(x0 + ((x1 - x0) * k) / steps), Math.floor(y0 + ((y1 - y0) * k) / steps), v);
            }
          }
        }
      }
      if (path.fill === undefined && path.stroke === undefined) problems.push(`${at}'s path has neither \`fill\` nor \`stroke\``);
    } else if (kind === 'outline') {
      const v = slotIndex((layer as OutlineLayer).outline, `${at} outline`);
      if (!v) return;
      // neighbours within the texel's own frame (a sprite sheet's frames don't touch), wrapping when it tiles
      const opaque = (x: number, y: number, from: number) => {
        if (tile && frameW === width) x = (x + width) % width;
        if (tile) y = (y + height) % height;
        return x >= 0 && y >= 0 && x < width && y < height && Math.floor(x / frameW) === Math.floor(from / frameW) && indices[y * width + x]! > 0;
      };
      const ring: number[] = [];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!indices[y * width + x] && (opaque(x - 1, y, x) || opaque(x + 1, y, x) || opaque(x, y - 1, x) || opaque(x, y + 1, x))) ring.push(y * width + x);
      for (const k of ring) indices[k] = v;
    }
  });

  // colours: PALETTE names, or the build's re-bindings
  const hex = slots.map((s) => {
    const b: unknown = opts.palette?.[s] ?? palette[s];
    if (typeof b === 'number') {
      if (Number.isInteger(b) && b >= 0 && b <= 0xffffff) return b;
      problems.push(`slot '${s}' is re-bound to ${b}, not a colour: use 0x000000 to 0xffffff or a PALETTE name`);
      return 0xff00ff;
    }
    if (!isPaletteName(b)) {
      problems.push(`palette slot '${s}' is ${JSON.stringify(b)}, not a PALETTE colour: use one of ${Object.keys(PALETTE).join(', ')}`);
      return 0xff00ff;
    }
    return PALETTE[b];
  });
  const rgba = new Uint8Array(width * height * 4);
  for (let k = 0; k < indices.length; k++) {
    const v = indices[k]!;
    if (!v) continue;
    const c = hex[v - 1]!;
    rgba.set([(c >> 16) & 255, (c >> 8) & 255, c & 255, 255], k * 4);
  }
  return { id: def.id, width, height, indices, slots, rgba, problems };
}

/** The mean colour of the opaque texels (0xrrggbb, sRGB): what a textured surface reads as from afar. */
export function meanColour(b: BakedTexture): number {
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  for (let i = 0; i < b.rgba.length; i += 4) {
    if (!b.rgba[i + 3]) continue;
    r += b.rgba[i]!;
    g += b.rgba[i + 1]!;
    bl += b.rgba[i + 2]!;
    n++;
  }
  return n ? (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(bl / n) : 0;
}
