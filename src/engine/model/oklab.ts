/**
 * OKLab (Björn Ottosson's perceptual colour space) for comparing palette colours: lightness
 * L in 0..1, a and b around 0. Model checks use L (do two touching masses read apart?); the
 * importer's palette mapper (docs/assets/importing.md *Colours*) uses all three.
 */
export interface OkLab {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** An sRGB colour (0xrrggbb) in OKLab. */
export function oklab(hex: number): OkLab {
  const r = toLinear(((hex >> 16) & 255) / 255);
  const g = toLinear(((hex >> 8) & 255) / 255);
  const b = toLinear((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** An OKLab colour back in sRGB (0xrrggbb), clamped to the gamut. */
export function oklabHex({ L, a, b }: OkLab): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return rgb.reduce((hex, c) => (hex << 8) | Math.round(Math.min(1, Math.max(0, toSrgb(c))) * 255), 0);
}

/** Lightness, chroma and hue (radians) of an OKLab colour. */
export function lch(c: OkLab): { readonly L: number; readonly C: number; readonly h: number } {
  return { L: c.L, C: Math.hypot(c.a, c.b), h: Math.atan2(c.b, c.a) };
}

/** Euclidean distance in OKLab (about 0.02 is a just-noticeable step). */
export const oklabDistance = (p: OkLab, q: OkLab) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
