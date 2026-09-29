/**
 * Restrained 16-color palette (Sweetie 16 by GrafxKid). Every color in a game should come
 * from here: authentic pixel art reads as "designed" because the palette is small.
 * Keep in sync with scripts/generate-assets.mjs.
 */
export const PALETTE = {
  ink: 0x1a1c2c,
  plum: 0x5d275d,
  red: 0xb13e53,
  orange: 0xef7d57,
  sand: 0xffcd75,
  lime: 0xa7f070,
  green: 0x38b764,
  teal: 0x257179,
  navy: 0x29366f,
  blue: 0x3b5dc9,
  sky: 0x41a6f6,
  cyan: 0x73eff7,
  white: 0xf4f4f4,
  mist: 0x94b0c2,
  slate: 0x566c86,
  night: 0x333c57,
} as const;

export type PaletteColor = keyof typeof PALETTE;
