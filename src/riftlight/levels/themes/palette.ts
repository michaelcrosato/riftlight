import { Color, SRGBColorSpace } from 'three/webgpu';
import type { Rng } from '../../core/rng';
import type { LevelTheme } from './themes';

/**
 * Rift palette shifting: rotate a theme's hues and adjust contrast/saturation, then clamp
 * everything back into **readability bounds** so a shifted theme still reads in pixel art:
 *
 *  - floors keep a lightness in [0.16, 0.5] (actors and effects must read on them);
 *  - walls stay ≥ 0.07 darker than floors (silhouettes) and the floor/floorAlt pair keeps a
 *    visible but quiet step;
 *  - accent, trim and light stay saturated and bright (they carry the theme's identity);
 *  - fog/sky stay dark when the theme was dark (no washed-out voids).
 */
export interface PaletteShift {
  /** Hue rotation in degrees. */
  readonly hue: number;
  /** Contrast around mid-grey lightness (1 = unchanged). */
  readonly contrast: number;
  /** Saturation multiplier (1 = unchanged). */
  readonly saturation: number;
}

const tmp = new Color();
// HSL in sRGB (what the eye and the palette see), not three's linear working space.
const hsl = { h: 0, s: 0, l: 0 };

function shift(hex: number, s: PaletteShift, lMin = 0, lMax = 1, sMin = 0): number {
  tmp.setHex(hex);
  tmp.getHSL(hsl, SRGBColorSpace);
  const h = (((hsl.h + s.hue / 360) % 1) + 1) % 1;
  const sat = Math.min(1, Math.max(sMin, hsl.s * s.saturation));
  const l = Math.min(lMax, Math.max(lMin, 0.5 + (hsl.l - 0.5) * s.contrast));
  tmp.setHSL(h, sat, l, SRGBColorSpace);
  return tmp.getHex();
}

function lightness(hex: number): number {
  tmp.setHex(hex);
  tmp.getHSL(hsl, SRGBColorSpace);
  return hsl.l;
}

function withLightness(hex: number, l: number): number {
  tmp.setHex(hex);
  tmp.getHSL(hsl, SRGBColorSpace);
  tmp.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, l)), SRGBColorSpace);
  return tmp.getHex();
}

/** A shifted copy of `theme` (id gets a `~shift` suffix), clamped to readability bounds. */
export function shiftTheme(theme: LevelTheme, s: PaletteShift): LevelTheme {
  const p = theme.palette;
  const floor = shift(p.floor, s, 0.16, 0.5);
  let wall = shift(p.wall, s, 0.05, 0.4);
  if (lightness(wall) > lightness(floor) - 0.07) wall = withLightness(wall, lightness(floor) - 0.07);
  let floorAlt = shift(theme.floorAlt, s, 0.14, 0.48);
  const step = lightness(floor) - lightness(floorAlt);
  if (Math.abs(step) < 0.025 || Math.abs(step) > 0.08) floorAlt = withLightness(floorAlt, lightness(floor) - 0.04);
  const dark = lightness(p.sky) < 0.2;
  return {
    ...theme,
    id: `${theme.id}~${Math.round(s.hue)}`,
    name: theme.name,
    palette: {
      floor,
      wall,
      accent: shift(p.accent, s, 0.45, 0.8, 0.45),
      fog: shift(p.fog, s, 0, dark ? 0.14 : 0.8),
      sky: shift(p.sky, s, 0, dark ? 0.1 : 0.8),
      light: shift(p.light, s, 0.6, 0.9, 0.3),
    },
    floorAlt,
    trim: shift(theme.trim, s, 0.3, 0.75, 0.25),
    cliff: shift(theme.cliff, s, 0.04, 0.25),
    ambient: shift(theme.ambient, s, 0.2, 0.7),
    sun: shift(theme.sun, s, 0.6, 0.95),
  };
}

/** A random shift for a rift (bigger swings deeper, contrast within ±20%). */
export function riftShift(rng: Rng, depth: number): PaletteShift {
  const swing = Math.min(180, 40 + depth * 3);
  return {
    hue: Math.round(rng.range(-swing, swing)),
    contrast: rng.range(0.85, 1.2),
    saturation: rng.range(0.85, 1.25),
  };
}

/** WCAG-style relative luminance (0..1), used by tests and the theme swatch sheet. */
export function luminance(hex: number): number {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
