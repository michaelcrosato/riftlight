import type { Rng } from '../core/rng';
import type { Palette } from '../core/types';

/**
 * Monster palettes: a theme gives the base hue, a harmony gives the second colour, and
 * every colour is quantised (24 hues × 5 saturations × 9 lightness steps) so toon
 * materials stay a bounded, shared set. Primary colours are pushed away from the floor's
 * lightness so monsters read against the ground at 480×270.
 */
export interface ThemeColour {
  /** Base hue (degrees) and spread around it. */
  readonly hue: number;
  readonly spread: number;
  readonly sat: number;
  readonly light: number;
  /** Glow hue (degrees): eyes, cores, auras. */
  readonly glow: number;
}

/** Theme tag → colouring. Unknown tags fall back to 'beast'. */
export const THEME_COLOURS: Readonly<Record<string, ThemeColour>> = {
  fire: { hue: 12, spread: 18, sat: 0.75, light: 0.5, glow: 40 },
  ice: { hue: 195, spread: 20, sat: 0.55, light: 0.68, glow: 185 },
  undead: { hue: 60, spread: 30, sat: 0.18, light: 0.72, glow: 120 },
  insect: { hue: 95, spread: 40, sat: 0.55, light: 0.42, glow: 70 },
  beast: { hue: 28, spread: 22, sat: 0.45, light: 0.45, glow: 50 },
  construct: { hue: 35, spread: 20, sat: 0.25, light: 0.55, glow: 190 },
  void: { hue: 275, spread: 25, sat: 0.5, light: 0.35, glow: 300 },
  storm: { hue: 220, spread: 20, sat: 0.55, light: 0.5, glow: 55 },
  poison: { hue: 110, spread: 25, sat: 0.6, light: 0.45, glow: 90 },
  nature: { hue: 130, spread: 30, sat: 0.45, light: 0.42, glow: 75 },
  blood: { hue: 352, spread: 12, sat: 0.65, light: 0.38, glow: 0 },
  earth: { hue: 30, spread: 15, sat: 0.3, light: 0.4, glow: 30 },
  shadow: { hue: 250, spread: 20, sat: 0.25, light: 0.26, glow: 270 },
  crystal: { hue: 175, spread: 40, sat: 0.6, light: 0.6, glow: 170 },
  arcane: { hue: 260, spread: 30, sat: 0.6, light: 0.55, glow: 285 },
  water: { hue: 205, spread: 20, sat: 0.6, light: 0.45, glow: 180 },
};

export type Harmony = 'analogous' | 'complementary' | 'triadic' | 'split' | 'mono';
const HARMONY_OFFSET: Record<Harmony, number[]> = {
  analogous: [30, -30],
  complementary: [180],
  triadic: [120, -120],
  split: [150, -150],
  mono: [0],
};

export interface PaletteOptions {
  /** Floor colour to stay readable against (default: a dark dungeon slate). */
  floor?: number;
  harmony?: Harmony;
  /** Bosses and elites: richer saturation. */
  vivid?: boolean;
}

/** A palette from theme tags (first known tag wins; a second known tag tints the accent). */
export function generatePalette(rng: Rng, tags: readonly string[], options: PaletteOptions = {}): Palette {
  const known = tags.filter((t) => THEME_COLOURS[t]);
  const theme = THEME_COLOURS[known[0] ?? 'beast']!;
  const second = known[1] ? THEME_COLOURS[known[1]]! : null;
  const harmony = options.harmony ?? rng.pick<Harmony>(['analogous', 'analogous', 'complementary', 'triadic', 'split', 'mono']);
  const hue = theme.hue + rng.range(-theme.spread, theme.spread);
  const sat = clamp01(theme.sat + rng.range(-0.12, 0.12) + (options.vivid ? 0.15 : 0));
  let light = clamp(theme.light + rng.range(-0.1, 0.1), 0.2, 0.8);
  // Readability: keep the body's lightness well away from the floor's.
  const floorL = hexToHsl(options.floor ?? 0x333c57)[2];
  if (Math.abs(light - floorL) < 0.22) light = floorL < 0.5 ? Math.min(0.85, floorL + 0.24) : Math.max(0.15, floorL - 0.24);
  const offset = rng.pick(HARMONY_OFFSET[harmony]);
  const secHue = harmony === 'mono' ? hue + rng.range(-10, 10) : hue + offset;
  const secLight = harmony === 'mono' ? clamp(light + (light > 0.5 ? -0.18 : 0.18), 0.15, 0.85) : clamp(light + rng.range(-0.12, 0.08), 0.18, 0.8);
  const accentHue = second ? second.hue : hue + (harmony === 'complementary' ? offset * 0.5 : 180);
  return {
    primary: hslHex(hue, sat, light),
    secondary: hslHex(secHue, clamp01(sat * rng.range(0.6, 1.1)), secLight),
    accent: hslHex(accentHue, clamp01(0.45 + rng.range(0, 0.35)), clamp(light > 0.55 ? 0.35 : 0.72, 0.2, 0.85)),
    glow: hslHex((second?.glow ?? theme.glow) + rng.range(-10, 10), 0.95, 0.7),
    dark: hslHex(hue + rng.range(-15, 15), clamp01(sat * 0.6), clamp(Math.min(light, floorL) * 0.45, 0.06, 0.2)),
  };
}

/** Shift every colour's hue (mutation) and re-quantise. */
export function shiftPalette(p: Palette, degrees: number, lightness = 0): Palette {
  const shift = (hex: number) => {
    const [h, s, l] = hexToHsl(hex);
    return hslHex(h + degrees, s, clamp(l + lightness, 0.05, 0.9));
  };
  return { primary: shift(p.primary), secondary: shift(p.secondary), accent: shift(p.accent), glow: shift(p.glow), dark: shift(p.dark) };
}

/** Mix two palettes per colour (crossover). */
export function mixPalettes(a: Palette, b: Palette, rng: Rng): Palette {
  const keys = ['primary', 'secondary', 'accent', 'glow', 'dark'] as const;
  const out = {} as Record<(typeof keys)[number], number>;
  for (const k of keys) out[k] = rng.chance(0.5) ? a[k] : b[k];
  return out;
}

// ---------------------------------------------------------------- colour maths

/** Quantised HSL → hex (h degrees, s and l 0..1). */
export function hslHex(h: number, s: number, l: number): number {
  const hq = ((Math.round((((h % 360) + 360) % 360) / 15) * 15) % 360) / 360;
  const sq = Math.round(clamp01(s) * 4) / 4;
  const lq = Math.round(clamp01(l) * 20) / 20;
  const q = lq < 0.5 ? lq * (1 + sq) : lq + sq - lq * sq;
  const p = 2 * lq - q;
  const ch = (t: number) => {
    t = ((t % 1) + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(clamp01(v) * 255);
  };
  return (ch(hq + 1 / 3) << 16) | (ch(hq) << 8) | ch(hq - 1 / 3);
}

export function hexToHsl(hex: number): [number, number, number] {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Relative luminance (WCAG) of a hex colour. */
export function luminance(hex: number): number {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrast(a: number, b: number): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
