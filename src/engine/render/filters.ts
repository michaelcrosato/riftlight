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
 */

type N = any;

export interface FilterContext {
  /** Device pixels per art pixel (uniform). */
  pixelSize: N;
}

export interface FilterDef {
  readonly id: string;
  readonly label: string;
  readonly group: 'era' | 'palette' | 'color' | 'display' | 'signal' | 'stylize';
  apply(color: N, fx: FilterContext): N;
  /** Side effects outside the post pass (e.g. PS1 vertex snapping), toggled with the filter. */
  setActive?(active: boolean): void;
}

// float() on every channel: an all-integer vec3 (e.g. pure white) would otherwise be int-typed.
const hex = (h: number) => vec3(float(((h >> 16) & 255) / 255), float(((h >> 8) & 255) / 255), float((h & 255) / 255));

/** Integer art-pixel coordinate of the current fragment. */
const artCoord = (fx: FilterContext): N => floor(screenCoordinate.xy.div(fx.pixelSize));

/** Ordered-dither threshold in [0,1) from a 4×4 Bayer matrix, per art pixel. */
const bayer2 = (a: N): N => fract(a.x.div(2).add(a.y.mul(a.y).mul(0.75)));
const bayer4 = (a: N): N => bayer2(floor(a.mul(0.5))).mul(0.25).add(bayer2(a));
const ditherOffset = (fx: FilterContext, spread: number): N => bayer4(artCoord(fx)).sub(0.5).mul(float(spread));

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

const paletteFilter = (id: string, label: string, colors: readonly number[], spread = 0.12): FilterDef => ({
  id,
  label,
  group: 'palette',
  apply: (c, fx) => vec4(nearest(clamp(c.rgb.add(ditherOffset(fx, spread)), 0, 1), colors), c.a),
});

/** Map luminance onto a ramp of colors (dark → light) with ordered dithering. */
const rampFilter = (id: string, label: string, ramp: readonly number[], spread = 0.9, contrast = 1): FilterDef => ({
  id,
  label,
  group: 'palette',
  apply: (c, fx) => {
    const steps = float(ramp.length - 1);
    const lum = clamp(luminance(c.rgb).sub(0.5).mul(float(contrast)).add(0.5), float(0), float(1));
    const l = clamp(lum.mul(steps).add(ditherOffset(fx, spread)), float(0), steps);
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
  const tex = convertToTexture(c);
  const block = fx.pixelSize.mul(float(factor));
  const centre = floor(screenCoordinate.xy.div(block)).add(0.5).mul(block);
  return tex.sample(centre.div(screenSize));
};

export const FILTERS: readonly FilterDef[] = [
  // ---- console eras ----
  {
    id: '8bit',
    label: '8-bit console (NES era)',
    group: 'era',
    // Half the art resolution (2×2 art pixels per dot), NES palette, light ordered dither.
    apply: (c, fx) => {
      const low = blockSample(c, fx, 2);
      const a = floor(screenCoordinate.xy.div(fx.pixelSize.mul(2)));
      const d = bayer4(a).sub(0.5).mul(0.05);
      return vec4(nearest(clamp(low.rgb.add(d), 0, 1), PALETTES.nes), 1);
    },
  },
  {
    id: '16bit',
    label: '16-bit console (Mega Drive / SNES era)',
    group: 'era',
    // 9-bit color (8 levels per channel, 512 colors) with ordered dither per art pixel.
    apply: (c, fx) => vec4(floor(clamp(c.rgb.add(ditherOffset(fx, 1 / 7)), 0, 1).mul(7).add(0.5)).div(7), c.a),
  },
  {
    id: 'ps1',
    label: 'PS1 (15-bit dither + vertex wobble)',
    group: 'era',
    // 15-bit color with the PlayStation's 4×4 dither table; also snaps vertices to the
    // pixel grid (the classic PS1 wobble) while active.
    apply: (c, fx) => {
      const v = clamp(c.rgb.mul(255).add(ps1Dither(fx)), float(0), float(255));
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
    apply: (c, fx) => vec4(floor(clamp(c.rgb.add(ditherOffset(fx, 1 / 3)), 0, 1).mul(3).add(0.5)).div(3), c.a),
  },
  {
    id: 'posterize',
    label: 'Posterize',
    group: 'palette',
    apply: (c) => vec4(floor(c.rgb.mul(5).add(0.5)).div(5), c.a),
  },

  // ---- color grading ----
  { id: 'grayscale', label: 'Grayscale', group: 'color', apply: (c) => vec4(vec3(luminance(c.rgb)), c.a) },
  { id: 'sepia', label: 'Sepia', group: 'color', apply: (c) => sepia(c) },
  { id: 'invert', label: 'Invert', group: 'color', apply: (c) => vec4(c.rgb.oneMinus(), c.a) },
  { id: 'bleach', label: 'Bleach bypass', group: 'color', apply: (c) => bleach(c) },
  {
    id: 'sunset',
    label: 'Sunset grade',
    group: 'color',
    apply: (c) => vec4(mix(c.rgb, c.rgb.mul(vec3(1.15, 0.92, 0.78)).add(vec3(0.04, 0.0, 0.03)), 0.8), c.a),
  },
  {
    id: 'moonlight',
    label: 'Moonlight grade',
    group: 'color',
    apply: (c) => vec4(mix(vec3(luminance(c.rgb)), c.rgb, 0.4).mul(vec3(0.75, 0.85, 1.15)), c.a),
  },
  {
    id: 'thermal',
    label: 'Thermal',
    group: 'color',
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
    apply: (c, fx) => {
      const noise = hash(artCoord(fx).x.add(artCoord(fx).y.mul(977)).add(floor(time.mul(24)).mul(131))).sub(0.5).mul(0.15);
      const l = luminance(c.rgb).mul(1.6).add(noise);
      return vec4(vec3(0.1, 1, 0.2).mul(l), c.a);
    },
  },

  // ---- display hardware ----
  {
    id: 'scanlines',
    label: 'Scanlines',
    group: 'display',
    apply: (c, fx) => {
      // Darken the lower half of every art-pixel row (visible from 2× scale up).
      const inRow = fract(screenCoordinate.y.div(fx.pixelSize));
      return vec4(c.rgb.mul(select(inRow.greaterThanEqual(0.5), float(0.72), float(1))), c.a);
    },
  },
  {
    id: 'lcd',
    label: 'LCD grid',
    group: 'display',
    apply: (c, fx) => {
      // Thin gaps between art pixels, like a handheld's LCD (needs ≥ 3× scale to read well).
      const f = fract(screenCoordinate.xy.div(fx.pixelSize));
      const edge = max(step(f.x, float(1).div(fx.pixelSize)), step(f.y, float(1).div(fx.pixelSize)));
      return vec4(mix(c.rgb, c.rgb.mul(0.78).add(0.03), edge), c.a);
    },
  },
  {
    id: 'crt',
    label: 'CRT (curved, masked)',
    group: 'display',
    apply: (c, fx) => {
      const tex = convertToTexture(c);
      const uv = barrelUV(float(0.06), screenUV);
      const base = tex.sample(uv).rgb.mul(barrelMask(uv));
      const row = fract(screenCoordinate.y.div(fx.pixelSize));
      const scan = mix(float(1), float(0.7), smoothstep(0.35, 0.95, row));
      const triad = mod(floor(screenCoordinate.x), 3);
      const mask = vec3(
        select(triad.equal(0), float(1.08), float(0.92)),
        select(triad.equal(1), float(1.08), float(0.92)),
        select(triad.equal(2), float(1.08), float(0.92)),
      );
      return crtVignette(vec4(base.mul(scan).mul(mask).mul(1.12), 1) as N, float(0.45), float(0.55), screenUV);
    },
  },
  {
    id: 'vignette',
    label: 'Vignette',
    group: 'display',
    apply: (c) => crtVignette(c, float(0.45), float(0.6), screenUV),
  },

  // ---- analog signal ----
  {
    id: 'chromatic',
    label: 'Chromatic aberration',
    group: 'signal',
    apply: (c, fx) => {
      const tex = convertToTexture(c);
      // Up to ~1.5 art pixels of red/blue split, growing toward the screen edges.
      const off = vec2(fx.pixelSize.div(screenSize.x).mul(screenUV.x.sub(0.5).mul(3)), 0);
      return vec4(tex.sample(screenUV.add(off)).r, c.g, tex.sample(screenUV.sub(off)).b, c.a);
    },
  },
  {
    id: 'grain',
    label: 'Film grain',
    group: 'signal',
    apply: (c, fx) => {
      const a = artCoord(fx);
      const n = hash(a.x.add(a.y.mul(1291)).add(floor(time.mul(24)).mul(7919))).sub(0.5).mul(0.12);
      return vec4(clamp(c.rgb.add(n), 0, 1), c.a);
    },
  },
  {
    id: 'vhs',
    label: 'VHS tape',
    group: 'signal',
    apply: (c) => {
      const tex = convertToTexture(c);
      const y = screenUV.y;
      const wobble = sin(y.mul(90).add(time.mul(9))).mul(0.0015).add(sin(y.mul(7).sub(time.mul(1.3))).mul(0.002));
      const band = smoothstep(0.0, 0.02, abs(fract(time.mul(0.15)).sub(y))).oneMinus().mul(0.012);
      const uv = vec2(screenUV.x.add(wobble).add(band), y);
      const r = tex.sample(uv.add(vec2(0.003, 0))).r;
      const g = tex.sample(uv).g;
      const b = tex.sample(uv.sub(vec2(0.003, 0))).b;
      const noise = hash(floor(screenCoordinate.y).add(floor(time.mul(30)).mul(613))).sub(0.5).mul(0.06);
      return vec4(clamp(vec3(r, g, b).mul(vec3(1.05, 0.98, 1.02)).add(noise), 0, 1), 1);
    },
  },
  { id: 'ntsc', label: 'NTSC color bleed', group: 'signal', apply: (c) => vec4(colorBleeding(c, float(0.0025)), c.a) },

  // ---- stylize ----
  {
    id: 'bloom',
    label: 'Bloom glow',
    group: 'stylize',
    apply: (c) => {
      const tex = convertToTexture(c);
      return vec4(tex.rgb.add(bloom(tex, 0.55, 0.35, 0.72).rgb), c.a);
    },
  },
  {
    id: 'halftone',
    label: 'Halftone dots',
    group: 'stylize',
    // Comic-print look: color modulated by a halftone dot screen.
    // Dot period ≈ 4 art pixels at any scale.
    apply: (c, fx) => vec4(c.rgb.mul(mix(float(0.55), float(1.08), luminance((dotScreen(c, 0.8, float(1.57).div(fx.pixelSize)) as N).rgb))), c.a),
  },
  {
    id: 'sketch',
    label: 'Ink sketch',
    group: 'stylize',
    apply: (c) => {
      const edges = luminance((sobel(c) as N).rgb);
      return vec4(vec3(0.96, 0.93, 0.85).mul(float(1).sub(smoothstep(0.08, 0.3, edges))), c.a);
    },
  },
];

export const FILTER_IDS = FILTERS.map((f) => f.id);

export function getFilter(id: string): FilterDef | undefined {
  return FILTERS.find((f) => f.id === id);
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

/** Apply filters in order. Unknown ids are skipped. */
export function applyFilters(color: N, ids: readonly string[], fx: FilterContext): N {
  return ids.reduce((c, id) => {
    const f = getFilter(id);
    return f ? f.apply(c, fx) : c;
  }, color);
}
