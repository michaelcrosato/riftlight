/**
 * Textures as data (docs/ASSETS.md *Textures*): `TextureDef` layers baked headless to palette
 * texels, then a toon `textureMap`, a `spriteSheet` or `hudSprite` rows. `importSheet` slices a
 * pixel-art PNG sheet into defs (docs/ASSETS.md *Importing*).
 */
export type { Layer, OutlineLayer, PathLayer, PatternId, PatternLayer, PixelsLayer, TexSlot, TextureDef } from './types';
export { textureDef } from './helpers';
export { bakeTexture, meanColour, type BakedTexture, type BakeOptions } from './bake';
export { PATTERNS, type PatternSpec } from './patterns';
export { validateTexture, textureMetrics, MAX_ISOLATED, MAX_SEAM_EXCESS, type TextureCheck, type TextureMetrics } from './validate';
export { textureMap, spriteSheet, hudSprite, TextureError, type TextureOptions } from './convert';
export { TextureCatalog } from './catalog';
export { importSheet, ALPHA_THRESHOLD, LEGEND_CHARS, SHEET_IMPORT_TOOL, type SheetCell, type SheetColour, type SheetImport, type SheetImportOptions, type SheetMerge } from './import';
export { TEXTURE_LIBRARY } from './library';
