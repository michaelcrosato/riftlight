/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are dynamically typed */
import {
  abs,
  clamp,
  convertToTexture,
  dot,
  float,
  floor,
  fract,
  hash,
  luminance,
  max,
  min,
  mix,
  mod,
  screenCoordinate,
  screenSize,
  screenUV,
  select,
  sin,
  smoothstep,
  step,
  time,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { barrelMask, barrelUV, colorBleeding, vignette as crtVignette } from 'three/addons/tsl/display/CRT.js';
import { sepia } from 'three/addons/tsl/display/Sepia.js';
import { bleach } from 'three/addons/tsl/display/BleachBypass.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dotScreen } from 'three/addons/tsl/display/DotScreenNode.js';
import { sobel } from 'three/addons/tsl/display/SobelOperatorNode.js';
import { PALETTE } from '../palette';
import { vertexSnap } from './toon';

/**
 * Post-processing filters, all TSL, applied in display (sRGB) space after the pipeline's
 * output color transform and before presentation. Stackable in any order; pixel-space
 * filters (dithering, palettes, LCD grid, grain) work per *art pixel*, so they stay
 * authentic at any integer scale. Raw 3D mode bypasses all of them.
 *
 * Every filter declares the resolution it runs at (`space`):
 * - `art`: one result per art pixel (palettes, dither, colour grades, grain, …). These run
 *   in the art-resolution stage, before the single nearest-neighbour upscale, so they cost
 *   1/scale² of a device-resolution pass (1/16 at 4×).
 * - `display`: needs sub-art-pixel detail (scanlines, LCD gaps, CRT mask/curvature, VHS
 *   wobble, chromatic split, bloom, halftone dots, ink lines). Runs per device pixel.
 * A stack runs its leading `art` filters at art resolution and everything from the first
 * `display` filter on at device resolution (so the order you asked for is kept exactly).
 */

type N = any;

export interface FilterContext {
  /** Device pixels per art pixel (uniform). 1 in the art-resolution stage. */
  pixelSize: N;
  /**
   * Render a node into a texture at the current stage's resolution (art-sized in the art
   * stage). Defaults to `convertToTexture` (drawing-buffer sized).
   */
  texture?(node: N): N;
  /**
   * A filter parameter's value as a node. The renderer hands out one uniform per layer,
   * filter and parameter, so moving a slider never rebuilds or recompiles a graph.
   * Without it every parameter is its default, as a constant.
   */
  param?(id: string, key: string): N;
  /** Scene depth (0 near … 1 far) at a screen uv, where the stage has one (the cel filter's ink). */
  depth?(uv: N): N;
}

export type FilterSpace = 'art' | 'display';

export type FilterGroup = 'shading' | 'era' | 'palette' | 'color' | 'display' | 'signal' | 'stylize';

/** A tunable number of a filter (a slider in a look editor). */
export interface FilterParam {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** How a value reads: `%` (0..1 as a percentage), `x` (a multiplier), `px` (art pixels). */
  readonly unit?: '%' | 'x' | 'px';
}

/** Reads one of the filter's own parameters (by key) as a node. */
export type ParamReader = (key: string) => N;

export interface FilterDef {
  readonly id: string;
  readonly label: string;
  readonly group: FilterGroup;
  /** Resolution the filter runs at (see the module comment). */
  readonly space: FilterSpace;
  /** Tunable numbers besides `amount` (every filter has that one: see `filterParams`). */
  readonly params?: readonly FilterParam[];
  /** Named parameter sets ("subtle", "heavy", …). Missing keys keep their defaults. */
  readonly presets?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  apply(color: N, fx: FilterContext, p: ParamReader): N;
  /**
   * Moves pixels (curves, splits, smears): runs on the whole scene only. A layer's filters
   * run before the layers are composed by depth, so a warp there would no longer line up
   * with the other layer (render/look.ts drops these from layer stacks).
   */
  readonly sceneOnly?: boolean;
  /** Side effects outside the post pass (e.g. PS1 vertex snapping), toggled with the filter. */
  setActive?(active: boolean): void;
}

/** Every filter's strength: the filtered colour mixed over the input (0 = off, 1 = full). */
export const AMOUNT: FilterParam = { key: 'amount', label: 'Strength', min: 0, max: 1, step: 0.05, default: 1, unit: '%' };

// float() on every channel: an all-integer vec3 (e.g. pure white) would otherwise be int-typed.
const hex = (h: number) => vec3(float(((h >> 16) & 255) / 255), float(((h >> 8) & 255) / 255), float((h & 255) / 255));

const toTexture = (c: N, fx: FilterContext): N => (fx.texture ? fx.texture(c) : convertToTexture(c));

/** Integer art-pixel coordinate of the current fragment. */
const artCoord = (fx: FilterContext): N => floor(screenCoordinate.xy.div(fx.pixelSize));

/** Ordered-dither threshold in [0,1) from a 4×4 Bayer matrix, per art pixel. */
const bayer2 = (a: N): N => fract(a.x.div(2).add(a.y.mul(a.y).mul(0.75)));
const bayer4 = (a: N): N => bayer2(floor(a.mul(0.5))).mul(0.25).add(bayer2(a));
const ditherOffset = (fx: FilterContext, spread: N): N => bayer4(artCoord(fx)).sub(0.5).mul(spread);

/** Nearest color in `colors` (weighted RGB distance). */
function nearest(rgb: N, colors: readonly number[]): N {
  const w = vec3(0.3, 0.59, 0.11);
  let best: N = hex(colors[0]!);
  let bestD: N = dot(rgb.sub(best).mul(rgb.sub(best)), w);
  for (const c of colors.slice(1)) {
    const cv = hex(c);
    const d = dot(rgb.sub(cv).mul(rgb.sub(cv)), w);
    best = select(d.lessThan(bestD), cv, best);
    bestD = min(d, bestD);
  }
  return best;
}

/** Dither presets shared by the palette filters, relative to each palette's own default. */
const ditherPresets = (spread: number) => ({ smooth: { dither: 0 }, light: { dither: round2(spread / 2) }, classic: { dither: spread }, heavy: { dither: round2(Math.min(0.5, spread * 2.5)) } });
const round2 = (v: number) => Math.round(v * 100) / 100;
/** On a 0.05 grid (the ramp sliders' step). */
const snap = (v: number) => Math.round(v * 20) / 20;

const paletteFilter = (id: string, label: string, colors: readonly number[], spread = 0.12): FilterDef => ({
  id,
  label,
  group: 'palette',
  space: 'art',
  params: [{ key: 'dither', label: 'Dither', min: 0, max: 0.5, step: 0.01, default: spread }],
  presets: ditherPresets(spread),
  apply: (c, fx, p) => vec4(nearest(clamp(c.rgb.add(ditherOffset(fx, p('dither'))), 0, 1), colors), c.a),
});

/** Map luminance onto a ramp of colors (dark → light) with ordered dithering. */
const rampFilter = (id: string, label: string, ramp: readonly number[], spread = 0.9, contrast = 1): FilterDef => ({
  id,
  label,
  group: 'palette',
  space: 'art',
  params: [
    { key: 'dither', label: 'Dither', min: 0, max: 1.5, step: 0.05, default: spread },
    { key: 'contrast', label: 'Contrast', min: 0.5, max: 3, step: 0.05, default: contrast, unit: 'x' },
  ],
  presets: { smooth: { dither: 0 }, classic: { dither: spread, contrast }, punchy: { dither: snap(spread * 0.6), contrast: snap(contrast * 1.6) }, soft: { dither: snap(Math.min(1.5, spread * 1.4)), contrast: snap(contrast * 0.75) } },
  apply: (c, fx, p) => {
    const steps = float(ramp.length - 1);
    const lum: N = clamp(luminance(c.rgb).sub(0.5).mul(p('contrast')).add(0.5), float(0), float(1));
    const l = clamp(lum.mul(steps).add(ditherOffset(fx, p('dither'))), float(0), steps);
    const i = floor(l.add(0.5));
    let out: N = hex(ramp[0]!);
    ramp.forEach((col, k) => {
      if (k > 0) out = select(i.greaterThanEqual(float(k)), hex(col), out);
    });
    return vec4(out, c.a);
  },
});

export const PALETTES = {
  sweetie16: Object.values(PALETTE),
  pico8: [0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8, 0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa],
  c64: [0x000000, 0xffffff, 0x880000, 0xaaffee, 0xcc44cc, 0x00cc55, 0x0000aa, 0xeeee77, 0xdd8855, 0x664400, 0xff7777, 0x333333, 0x777777, 0xaaff66, 0x0088ff, 0xbbbbbb],
  zx: [0x000000, 0x0000d7, 0xd70000, 0xd700d7, 0x00d700, 0x00d7d7, 0xd7d700, 0xd7d7d7, 0x0000ff, 0xff0000, 0xff00ff, 0x00ff00, 0x00ffff, 0xffff00, 0xffffff],
  ega: [0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa, 0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff],
  cga: [0x000000, 0x55ffff, 0xff55ff, 0xffffff],
  nes: [0x000000, 0xfcfcfc, 0xbcbcbc, 0x7c7c7c, 0xa4e4fc, 0x3cbcfc, 0x0078f8, 0x0000fc, 0xb8b8f8, 0x6888fc, 0x0058f8, 0x0000bc, 0xd8b8f8, 0x9878f8, 0x6844fc, 0x4428bc, 0xf8b8f8, 0xf878f8, 0xd800cc, 0x940084, 0xf8a4c0, 0xf85898, 0xe40058, 0xa80020, 0xf0d0b0, 0xf87858, 0xf83800, 0xa81000, 0xfce0a8, 0xfca044, 0xe45c10, 0x881400, 0xf8d878, 0xf8b800, 0xac7c00, 0x503000, 0xd8f878, 0xb8f818, 0x00b800, 0x007800, 0xb8f8b8, 0x58d854, 0x00a800, 0x006800, 0xb8f8d8, 0x58f898, 0x00a844, 0x005800, 0x00fcfc, 0x00e8d8, 0x008888, 0x004058],
} as const;

/** PlayStation 1 4×4 dither table, in 8-bit color units (psx-spx). */
const PS1_DITHER = [
  [-4, 0, -3, 1],
  [2, -2, 3, -1],
  [-3, 1, -4, 0],
  [3, -1, 2, -2],
];

const ps1Dither = (fx: FilterContext): N => {
  const a = artCoord(fx);
  const x = mod(a.x, 4);
  const y = mod(a.y, 4);
  const rowVec = (r: number): N => (vec4 as N)(...PS1_DITHER[r]!.map((v) => float(v)));
  let row: N = rowVec(0);
  for (let r = 1; r < 4; r++) row = select(y.equal(float(r)), rowVec(r), row);
  const oneHot = vec4(
    select(x.equal(float(0)), float(1), float(0)),
    select(x.equal(float(1)), float(1), float(0)),
    select(x.equal(float(2)), float(1), float(0)),
    select(x.equal(float(3)), float(1), float(0)),
  );
  return dot(row, oneHot);
};

/** Sample the frame at the centre of `factor`×`factor` art-pixel blocks (lower effective res). */
const blockSample = (c: N, fx: FilterContext, factor: number): N => {
  const tex = toTexture(c, fx);
  const block = fx.pixelSize.mul(float(factor));
  const centre = floor(screenCoordinate.xy.div(block)).add(0.5).mul(block);
  return tex.sample(centre.div(screenSize));
};

/** How strongly the cel filter's ink reacts to a depth step (the pixel pass's edge test). */
const inkEdge = (fx: FilterContext, width: N): N => {
  if (!fx.depth) return float(0);
  const d = vec2(width.mul(fx.pixelSize)).div(screenSize);
  const d0 = fx.depth(screenUV);
  const rise = (o: N): N => clamp(fx.depth!(screenUV.add(o)).sub(d0), 0, 1);
  const diff = rise(vec2(d.x, 0)).add(rise(vec2(d.x.negate(), 0))).add(rise(vec2(0, d.y))).add(rise(vec2(0, d.y.negate())));
  return smoothstep(0.01, 0.02, diff);
};

export const FILTERS: readonly FilterDef[] = [
  // ---- shading ----
  {
    id: 'cel',
    label: 'Cel shading',
    group: 'shading',
    space: 'art',
    // Flat light bands (luminance quantised, hue kept), a saturation lift and ink lines where
    // the depth jumps (silhouettes), like hand-inked animation cels.
    params: [
      { key: 'bands', label: 'Bands', min: 2, max: 8, step: 1, default: 3 },
      { key: 'ink', label: 'Ink lines', min: 0, max: 1, step: 0.05, default: 0.85, unit: '%' },
      { key: 'width', label: 'Line width', min: 1, max: 4, step: 1, default: 1, unit: 'px' },
      { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.05, default: 1.2, unit: 'x' },
    ],
    presets: {
      anime: { bands: 3, ink: 0.85, width: 1, saturation: 1.2 },
      comic: { bands: 2, ink: 1, width: 2, saturation: 1.4 },
      soft: { bands: 5, ink: 0.45, width: 1, saturation: 1.05 },
      poster: { bands: 4, ink: 0, width: 1, saturation: 1.5 },
    },
    apply: (c, fx, p) => {
      const l = luminance(c.rgb);
      const bands = p('bands');
      const q = floor(l.mul(bands)).add(0.5).div(bands);
      const flat = clamp(c.rgb.mul(q.div(max(l, 0.002))), 0, 1);
      const rich = clamp(mix(vec3(luminance(flat)), flat, p('saturation')), 0, 1);
      return vec4(rich.mul(float(1).sub(inkEdge(fx, p('width')).mul(p('ink')))), c.a);
    },
  },

  // ---- console eras ----
  {
    id: '8bit',
    label: '8-bit console (NES era)',
    group: 'era',
    space: 'art',
    params: [{ key: 'dither', label: 'Dither', min: 0, max: 0.3, step: 0.01, default: 0.05 }],
    presets: { clean: { dither: 0 }, classic: { dither: 0.05 }, grainy: { dither: 0.15 } },
    // Half the art resolution (2×2 art pixels per dot), NES palette, light ordered dither.
    apply: (c, fx, p) => {
      const low = blockSample(c, fx, 2);
      const a = floor(screenCoordinate.xy.div(fx.pixelSize.mul(2)));
      const d = bayer4(a).sub(0.5).mul(p('dither'));
      return vec4(nearest(clamp(low.rgb.add(d), 0, 1), PALETTES.nes), 1);
    },
  },
  {
    id: '16bit',
    label: '16-bit console (Mega Drive / SNES era)',
    group: 'era',
    space: 'art',
    params: [
      { key: 'levels', label: 'Levels', min: 2, max: 16, step: 1, default: 7 },
      // in steps between levels (1 = one level of spread)
      { key: 'dither', label: 'Dither', min: 0, max: 2, step: 0.05, default: 1, unit: 'x' },
    ],
    presets: { 'mega drive': { levels: 7, dither: 1 }, snes: { levels: 15, dither: 1 }, 'low colour': { levels: 3, dither: 1 }, smooth: { levels: 7, dither: 0 } },
    // 9-bit color (8 levels per channel, 512 colors) with ordered dither per art pixel.
    apply: (c, fx, p) => vec4(floor(clamp(c.rgb.add(ditherOffset(fx, p('dither').div(p('levels')))), 0, 1).mul(p('levels')).add(0.5)).div(p('levels')), c.a),
  },
  {
    id: 'ps1',
    label: 'PS1 (15-bit dither + vertex wobble)',
    group: 'era',
    space: 'art',
    params: [{ key: 'dither', label: 'Dither', min: 0, max: 2, step: 0.1, default: 1, unit: 'x' }],
    presets: { authentic: { dither: 1 }, clean: { dither: 0 }, crunchy: { dither: 2 } },
    // 15-bit color with the PlayStation's 4×4 dither table; also snaps vertices to the
    // pixel grid (the classic PS1 wobble) while active.
    apply: (c, fx, p) => {
      const v = clamp(c.rgb.mul(255).add(ps1Dither(fx).mul(p('dither'))), float(0), float(255));
      return vec4(floor(v.div(8)).mul(8).div(255), c.a);
    },
    setActive: (active) => {
      vertexSnap.enabled.value = active ? 1 : 0;
    },
  },

  // ---- palette / hardware looks ----
  paletteFilter('sweetie16', 'Sweetie 16 palette', PALETTES.sweetie16, 0.08),
  paletteFilter('pico8', 'PICO-8', PALETTES.pico8),
  paletteFilter('nes', 'NES', PALETTES.nes, 0.08),
  paletteFilter('c64', 'Commodore 64', PALETTES.c64),
  paletteFilter('zx', 'ZX Spectrum', PALETTES.zx, 0.2),
  paletteFilter('ega', 'EGA', PALETTES.ega, 0.18),
  paletteFilter('cga', 'CGA (cyan/magenta)', PALETTES.cga, 0.35),
  rampFilter('gameboy', 'Game Boy', [0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f]),
  rampFilter('gbpocket', 'Game Boy Pocket', [0x000000, 0x555555, 0xaaaaaa, 0xffffff]),
  rampFilter('virtualboy', 'Virtual Boy', [0x000000, 0x550000, 0xaa0000, 0xff0000]),
  rampFilter('onebit', '1-bit Mac', [0x000000, 0xffffff], 1, 1.8),
  {
    id: 'dither',
    label: 'Ordered dither (64 colors)',
    group: 'palette',
    space: 'art',
    params: [{ key: 'levels', label: 'Levels', min: 1, max: 8, step: 1, default: 3 }],
    presets: { '8 colours': { levels: 1 }, '64 colours': { levels: 3 }, '512 colours': { levels: 7 } },
    apply: (c, fx, p) => vec4(floor(clamp(c.rgb.add(ditherOffset(fx, float(1).div(p('levels')))), 0, 1).mul(p('levels')).add(0.5)).div(p('levels')), c.a),
  },
  {
    id: 'posterize',
    label: 'Posterize',
    group: 'palette',
    space: 'art',
    params: [{ key: 'levels', label: 'Levels', min: 2, max: 16, step: 1, default: 5 }],
    presets: { bold: { levels: 3 }, classic: { levels: 5 }, subtle: { levels: 10 } },
    apply: (c, _fx, p) => vec4(floor(c.rgb.mul(p('levels')).add(0.5)).div(p('levels')), c.a),
  },

  // ---- color grading ----
  { id: 'grayscale', label: 'Grayscale', group: 'color', space: 'art', apply: (c) => vec4(vec3(luminance(c.rgb)), c.a) },
  { id: 'sepia', label: 'Sepia', group: 'color', space: 'art', apply: (c) => sepia(c) },
  { id: 'invert', label: 'Invert', group: 'color', space: 'art', apply: (c) => vec4(c.rgb.oneMinus(), c.a) },
  { id: 'bleach', label: 'Bleach bypass', group: 'color', space: 'art', apply: (c) => bleach(c) },
  {
    id: 'sunset',
    label: 'Sunset grade',
    group: 'color',
    space: 'art',
    apply: (c) => vec4(mix(c.rgb, c.rgb.mul(vec3(1.15, 0.92, 0.78)).add(vec3(0.04, 0.0, 0.03)), 0.8), c.a),
  },
  {
    id: 'moonlight',
    label: 'Moonlight grade',
    group: 'color',
    space: 'art',
    apply: (c) => vec4(mix(vec3(luminance(c.rgb)), c.rgb, 0.4).mul(vec3(0.75, 0.85, 1.15)), c.a),
  },
  {
    id: 'thermal',
    label: 'Thermal',
    group: 'color',
    space: 'art',
    apply: (c) => {
      const l = luminance(c.rgb);
      const cold = mix(vec3(0, 0, 0.3), vec3(0.6, 0, 0.6), smoothstep(0, 0.35, l));
      const warm = mix(vec3(1, 0.3, 0), vec3(1, 1, 0.6), smoothstep(0.65, 1, l));
      return vec4(mix(cold, warm, smoothstep(0.3, 0.7, l)), c.a);
    },
  },
  {
    id: 'nightvision',
    label: 'Night vision',
    group: 'color',
    space: 'art',
    params: [
      { key: 'gain', label: 'Gain', min: 0.5, max: 3, step: 0.1, default: 1.6, unit: 'x' },
      { key: 'noise', label: 'Noise', min: 0, max: 0.4, step: 0.01, default: 0.15 },
    ],
    presets: { goggles: { gain: 1.6, noise: 0.15 }, starlight: { gain: 2.6, noise: 0.3 }, clear: { gain: 1.3, noise: 0.03 } },
    apply: (c, fx, p) => {
      const noise = hash(artCoord(fx).x.add(artCoord(fx).y.mul(977)).add(floor(time.mul(24)).mul(131))).sub(0.5).mul(p('noise'));
      const l = luminance(c.rgb).mul(p('gain')).add(noise);
      return vec4(vec3(0.1, 1, 0.2).mul(l), c.a);
    },
  },

  // ---- display hardware ----
  {
    id: 'scanlines',
    label: 'Scanlines',
    group: 'display',
    space: 'display',
    params: [{ key: 'darkness', label: 'Darkness', min: 0, max: 1, step: 0.01, default: 0.28, unit: '%' }],
    presets: { soft: { darkness: 0.15 }, classic: { darkness: 0.28 }, heavy: { darkness: 0.55 } },
    apply: (c, fx, p) => {
      // Darken the lower half of every art-pixel row (visible from 2× scale up).
      const inRow = fract(screenCoordinate.y.div(fx.pixelSize));
      return vec4(c.rgb.mul(select(inRow.greaterThanEqual(0.5), float(1).sub(p('darkness')), float(1))), c.a);
    },
  },
  {
    id: 'lcd',
    label: 'LCD grid',
    group: 'display',
    space: 'display',
    params: [{ key: 'gap', label: 'Grid', min: 0, max: 1, step: 0.02, default: 0.22, unit: '%' }],
    presets: { faint: { gap: 0.1 }, classic: { gap: 0.22 }, chunky: { gap: 0.5 } },
    apply: (c, fx, p) => {
      // Thin gaps between art pixels, like a handheld's LCD (needs ≥ 3× scale to read well).
      const f = fract(screenCoordinate.xy.div(fx.pixelSize));
      const edge = max(step(f.x, float(1).div(fx.pixelSize)), step(f.y, float(1).div(fx.pixelSize)));
      return vec4(mix(c.rgb, c.rgb.mul(float(1).sub(p('gap'))).add(0.03), edge), c.a);
    },
  },
  {
    id: 'crt',
    label: 'CRT (curved, masked)',
    group: 'display',
    space: 'display',
    sceneOnly: true,
    params: [
      { key: 'curve', label: 'Curvature', min: 0, max: 0.2, step: 0.01, default: 0.06 },
      { key: 'scan', label: 'Scanlines', min: 0, max: 0.8, step: 0.01, default: 0.3, unit: '%' },
      { key: 'mask', label: 'Shadow mask', min: 0, max: 0.3, step: 0.01, default: 0.08, unit: '%' },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.45, unit: '%' },
    ],
    presets: {
      'pc monitor': { curve: 0.02, scan: 0.15, mask: 0.04, vignette: 0.25 },
      arcade: { curve: 0.06, scan: 0.3, mask: 0.08, vignette: 0.45 },
      'old tv': { curve: 0.12, scan: 0.45, mask: 0.14, vignette: 0.7 },
    },
    apply: (c, fx, p) => {
      const tex = toTexture(c, fx);
      const uv = barrelUV(p('curve'), screenUV);
      const base = tex.sample(uv).rgb.mul(barrelMask(uv));
      const row = fract(screenCoordinate.y.div(fx.pixelSize));
      const scan = mix(float(1), float(1).sub(p('scan')), smoothstep(0.35, 0.95, row));
      const triad = mod(floor(screenCoordinate.x), 3);
      const hi = float(1).add(p('mask'));
      const lo = float(1).sub(p('mask'));
      const mask = vec3(select(triad.equal(0), hi, lo), select(triad.equal(1), hi, lo), select(triad.equal(2), hi, lo));
      return crtVignette(vec4(base.mul(scan).mul(mask).mul(1.12), 1) as N, p('vignette'), float(0.55), screenUV);
    },
  },
  {
    id: 'vignette',
    label: 'Vignette',
    group: 'display',
    space: 'art',
    params: [
      { key: 'intensity', label: 'Darkness', min: 0, max: 1, step: 0.05, default: 0.45, unit: '%' },
      { key: 'softness', label: 'Softness', min: 0.1, max: 1, step: 0.05, default: 0.6, unit: '%' },
    ],
    presets: { subtle: { intensity: 0.25, softness: 0.8 }, classic: { intensity: 0.45, softness: 0.6 }, tunnel: { intensity: 0.85, softness: 0.35 } },
    apply: (c, _fx, p) => crtVignette(c, p('intensity'), p('softness'), screenUV),
  },

  // ---- analog signal ----
  {
    id: 'chromatic',
    label: 'Chromatic aberration',
    group: 'signal',
    space: 'display',
    sceneOnly: true,
    params: [{ key: 'spread', label: 'Spread', min: 0, max: 6, step: 0.25, default: 1.5, unit: 'px' }],
    presets: { subtle: { spread: 0.75 }, classic: { spread: 1.5 }, broken: { spread: 4 } },
    apply: (c, fx, p) => {
      const tex = toTexture(c, fx);
      // Up to `spread` art pixels of red/blue split, growing toward the screen edges.
      const off = vec2(fx.pixelSize.div(screenSize.x).mul(screenUV.x.sub(0.5).mul(p('spread').mul(2))), 0);
      return vec4(tex.sample(screenUV.add(off)).r, c.g, tex.sample(screenUV.sub(off)).b, c.a);
    },
  },
  {
    id: 'grain',
    label: 'Film grain',
    group: 'signal',
    space: 'art',
    params: [{ key: 'noise', label: 'Grain', min: 0, max: 0.4, step: 0.01, default: 0.12 }],
    presets: { fine: { noise: 0.06 }, classic: { noise: 0.12 }, heavy: { noise: 0.25 } },
    apply: (c, fx, p) => {
      const a = artCoord(fx);
      const n = hash(a.x.add(a.y.mul(1291)).add(floor(time.mul(24)).mul(7919))).sub(0.5).mul(p('noise'));
      return vec4(clamp(c.rgb.add(n), 0, 1), c.a);
    },
  },
  {
    id: 'vhs',
    label: 'VHS tape',
    group: 'signal',
    space: 'display',
    sceneOnly: true,
    params: [
      { key: 'wobble', label: 'Wobble', min: 0, max: 3, step: 0.1, default: 1, unit: 'x' },
      { key: 'bleed', label: 'Colour bleed', min: 0, max: 3, step: 0.1, default: 1, unit: 'x' },
      { key: 'noise', label: 'Noise', min: 0, max: 0.2, step: 0.01, default: 0.06 },
    ],
    presets: { 'new tape': { wobble: 0.4, bleed: 0.6, noise: 0.02 }, rental: { wobble: 1, bleed: 1, noise: 0.06 }, 'worn out': { wobble: 2.4, bleed: 2.2, noise: 0.14 } },
    apply: (c, fx, p) => {
      const tex = toTexture(c, fx);
      const y = screenUV.y;
      const wobble: N = sin(y.mul(90).add(time.mul(9))).mul(0.0015).add(sin(y.mul(7).sub(time.mul(1.3))).mul(0.002)).mul(p('wobble'));
      const band: N = smoothstep(0.0, 0.02, abs(fract(time.mul(0.15)).sub(y))).oneMinus().mul(0.012).mul(p('wobble'));
      const uv = vec2(screenUV.x.add(wobble).add(band), y);
      const split = vec2(p('bleed').mul(0.003), 0);
      const r = tex.sample(uv.add(split)).r;
      const g = tex.sample(uv).g;
      const b = tex.sample(uv.sub(split)).b;
      const noise = hash(floor(screenCoordinate.y).add(floor(time.mul(30)).mul(613))).sub(0.5).mul(p('noise'));
      return vec4(clamp(vec3(r, g, b).mul(vec3(1.05, 0.98, 1.02)).add(noise), 0, 1), 1);
    },
  },
  {
    id: 'ntsc',
    label: 'NTSC color bleed',
    group: 'signal',
    space: 'display',
    sceneOnly: true,
    // bleed in thousandths of the screen width
    params: [{ key: 'bleed', label: 'Bleed', min: 0, max: 10, step: 0.5, default: 2.5 }],
    presets: { light: { bleed: 1 }, classic: { bleed: 2.5 }, smeared: { bleed: 7 } },
    apply: (c, _fx, p) => vec4(colorBleeding(c, p('bleed').mul(0.001)), c.a),
  },

  // ---- stylize ----
  {
    id: 'bloom',
    label: 'Bloom glow',
    group: 'stylize',
    space: 'display',
    params: [
      { key: 'strength', label: 'Glow', min: 0, max: 2, step: 0.05, default: 0.55, unit: 'x' },
      { key: 'radius', label: 'Radius', min: 0, max: 1, step: 0.05, default: 0.35, unit: '%' },
      { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.72, unit: '%' },
    ],
    presets: { soft: { strength: 0.35, radius: 0.5, threshold: 0.8 }, classic: { strength: 0.55, radius: 0.35, threshold: 0.72 }, neon: { strength: 1.4, radius: 0.2, threshold: 0.45 }, dreamy: { strength: 0.9, radius: 0.85, threshold: 0.3 } },
    apply: (c, fx, p) => {
      const tex = toTexture(c, fx);
      return vec4(tex.rgb.add(bloom(tex, p('strength'), p('radius'), p('threshold')).rgb), c.a);
    },
  },
  {
    id: 'halftone',
    label: 'Halftone dots',
    group: 'stylize',
    space: 'display',
    params: [
      { key: 'size', label: 'Dot size', min: 0.5, max: 4, step: 0.25, default: 1, unit: 'x' },
      { key: 'ink', label: 'Ink', min: 0, max: 1, step: 0.05, default: 0.45, unit: '%' },
    ],
    presets: { fine: { size: 0.5, ink: 0.35 }, comic: { size: 1, ink: 0.45 }, 'pop art': { size: 2.25, ink: 0.7 } },
    // Comic-print look: color modulated by a halftone dot screen.
    // Dot period ≈ 4 art pixels at any scale (× size).
    apply: (c, fx, p) => {
      const dots = luminance((dotScreen(c, 0.8, float(1.57).div(fx.pixelSize.mul(p('size')))) as N).rgb);
      return vec4(c.rgb.mul(mix(float(1).sub(p('ink')), float(1.08), dots)), c.a);
    },
  },
  {
    id: 'sketch',
    label: 'Ink sketch',
    group: 'stylize',
    space: 'display',
    params: [{ key: 'threshold', label: 'Line threshold', min: 0.02, max: 0.5, step: 0.01, default: 0.08 }],
    presets: { detailed: { threshold: 0.04 }, classic: { threshold: 0.08 }, bold: { threshold: 0.2 } },
    apply: (c, _fx, p) => {
      const edges = luminance((sobel(c) as N).rgb);
      return vec4(vec3(0.96, 0.93, 0.85).mul(float(1).sub(smoothstep(p('threshold'), p('threshold').add(0.22), edges))), c.a);
    },
  },
];

export const FILTER_IDS = FILTERS.map((f) => f.id);

export function getFilter(id: string): FilterDef | undefined {
  return FILTERS.find((f) => f.id === id);
}

/** A filter's parameters: its own, then `amount` (strength), which every filter has. */
export function filterParams(def: FilterDef): readonly FilterParam[] {
  return [...(def.params ?? []), AMOUNT];
}

/** Every parameter of a filter at its default. */
export function defaultParams(def: FilterDef): Record<string, number> {
  return Object.fromEntries(filterParams(def).map((p) => [p.key, p.default]));
}

/** Named parameter sets of a filter: its own presets, or strengths for filters with none. */
export function filterPresets(def: FilterDef): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return def.presets ?? { subtle: { amount: 0.35 }, half: { amount: 0.65 }, full: { amount: 1 } };
}

/** Clamp a value into a parameter's range, on its step. */
export function clampParam(p: FilterParam, v: number): number {
  if (!Number.isFinite(v)) return p.default;
  const stepped = Math.round((v - p.min) / p.step) * p.step + p.min;
  return Math.min(p.max, Math.max(p.min, Math.round(stepped * 1e4) / 1e4));
}

/** Named stacks that read well together. */
export const FILTER_PRESETS: Record<string, readonly string[]> = {
  none: [],
  eight_bit: ['8bit'],
  sixteen_bit: ['16bit', 'scanlines'],
  playstation: ['ps1'],
  arcade: ['crt'],
  handheld: ['gameboy', 'lcd'],
  famicom: ['nes', 'scanlines'],
  home_computer: ['c64', 'ntsc', 'vignette'],
  vhs_rental: ['vhs', 'grain', 'vignette'],
  spectrum: ['zx'],
  mac_classic: ['onebit'],
  pico: ['pico8'],
  dream: ['bloom', 'sunset', 'vignette'],
  spooky: ['moonlight', 'grain', 'vignette'],
};

/**
 * Split a stack into the part that runs at art resolution (its leading `art` filters) and
 * the part that runs per device pixel (from the first `display` filter on, in order).
 * Unknown ids are dropped.
 */
export function splitFilters(ids: readonly string[]): { art: string[]; display: string[] } {
  const known = ids.filter((id) => getFilter(id));
  const cut = known.findIndex((id) => getFilter(id)!.space === 'display');
  return cut < 0 ? { art: known, display: [] } : { art: known.slice(0, cut), display: known.slice(cut) };
}

/**
 * Apply one filter: its parameters come from `fx.param` (defaults without it), and the
 * result is mixed over the input by its `amount`. Unknown ids return the input.
 */
export function applyFilter(color: N, id: string, fx: FilterContext): N {
  const f = getFilter(id);
  if (!f) return color;
  const params = filterParams(f);
  const p: ParamReader = (key) => fx.param?.(id, key) ?? float(params.find((q) => q.key === key)?.default ?? 0);
  // A filter that renders its input to a texture mixes over that texture, so the input chain
  // is evaluated once, not again for the mix.
  const toTex = fx.texture ?? ((n: N) => convertToTexture(n));
  let input: N = null;
  const own: FilterContext = { ...fx, texture: (n) => (n === color ? (input ??= toTex(n)) : toTex(n)) };
  const out = f.apply(color, own, p);
  return mix(input ?? color, out, p('amount'));
}

/** Apply filters in order. Unknown ids are skipped. */
export function applyFilters(color: N, ids: readonly string[], fx: FilterContext): N {
  return ids.reduce((c, id) => applyFilter(c, id, fx), color);
}
