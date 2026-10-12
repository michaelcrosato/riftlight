/**
 * Baked textures as the engine uses them: `textureMap` for a model's toon material (nearest
 * filtered, wrapped when the texture tiles, cached and shared), `spriteSheet` for `SpriteBatch`
 * (no DOM canvas), and `hudSprite` rows for `hud.sprite`. A texture with problems throws a
 * `TextureError` naming them all.
 */
import { ClampToEdgeWrapping, DataTexture, NearestFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three/webgpu';
import type { PaletteColor } from '../palette';
import type { SpriteSheet } from '../render/sprites';
import { bakeTexture, type BakedTexture, type BakeOptions } from './bake';
import type { TextureCatalog } from './catalog';
import type { TextureDef } from './types';

export class TextureError extends Error {
  constructor(
    readonly id: string,
    readonly problems: readonly string[],
  ) {
    super(`texture "${id}": ${problems.join('; ')}`);
    this.name = 'TextureError';
  }
}

export interface TextureOptions extends BakeOptions {
  /** Where an id resolves (default `TEXTURE_LIBRARY`). */
  readonly catalog?: TextureCatalog;
}

let library: TextureCatalog | null = null;
/** Set by the library module, so a bare id resolves without an import cycle. */
export function setDefaultTextureCatalog(c: TextureCatalog): void {
  library = c;
}

function defOf(idOrDef: string | TextureDef, catalog?: TextureCatalog): TextureDef {
  if (typeof idOrDef !== 'string') return idOrDef;
  const c = catalog ?? library;
  if (!c) throw new Error(`no texture catalog to find "${idOrDef}" in`);
  return c.get(idOrDef);
}

function baked(def: TextureDef, opts: BakeOptions): BakedTexture {
  const b = bakeTexture(def, opts);
  if (b.problems.length) throw new TextureError(def.id, b.problems);
  return b;
}

const maps = new WeakMap<TextureDef, Map<string, DataTexture>>();

/**
 * The texture as a map for `toonMaterial(0xffffff, { map })`: nearest, no mipmaps, sRGB,
 * repeat-wrapped when it tiles. Its rows are stored bottom first, so v = 0 is the texture's
 * bottom row (three's convention). Cached per def and palette and `userData.shared`, so level
 * unloads keep it and the toon material cache sees one texture.
 */
export function textureMap(idOrDef: string | TextureDef, opts: TextureOptions = {}): DataTexture {
  const def = defOf(idOrDef, opts.catalog);
  const key = JSON.stringify(Object.entries(opts.palette ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
  const perDef = maps.get(def) ?? new Map<string, DataTexture>();
  maps.set(def, perDef);
  const hit = perDef.get(key);
  if (hit) return hit;
  const b = baked(def, opts);
  const flipped = new Uint8Array(b.rgba.length);
  const row = b.width * 4;
  for (let y = 0; y < b.height; y++) flipped.set(b.rgba.subarray(y * row, (y + 1) * row), (b.height - 1 - y) * row);
  const tex = new DataTexture(flipped, b.width, b.height, RGBAFormat);
  tex.name = `tex:${def.id}`;
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = def.tile ? RepeatWrapping : ClampToEdgeWrapping;
  tex.userData.shared = true;
  tex.needsUpdate = true;
  perDef.set(key, tex);
  return tex;
}

/**
 * A sprite sheet for `SpriteBatch`: the def's frames left to right in one row, rows stored top
 * first (`flipY` false, which SpriteBatch reads). Not cached: a SpriteBatch disposes its sheet.
 */
export function spriteSheet(idOrDef: string | TextureDef, opts: TextureOptions = {}): SpriteSheet {
  const def = defOf(idOrDef, opts.catalog);
  const b = baked(def, opts);
  const frames = def.frames ?? 1;
  const tex = new DataTexture(b.rgba.slice(), b.width, b.height, RGBAFormat);
  tex.name = `sheet:${def.id}`;
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { texture: tex, frame: [b.width / frames, b.height], cols: frames, rows: 1, frames };
}

/**
 * One frame as `hud.sprite` rows and colours: a character per slot (a, b, c, … in palette order),
 * '.' for transparent.
 *
 *   const s = hudSprite('gem-icon'); hud.sprite(8, 8, s.rows, s.colors, { scale: 2 });
 */
export function hudSprite(idOrDef: string | TextureDef, o: TextureOptions & { frame?: number } = {}): { rows: string[]; colors: Record<string, PaletteColor | number> } {
  const def = defOf(idOrDef, o.catalog);
  const b = baked(def, o);
  const frames = def.frames ?? 1;
  const fw = Math.floor(b.width / frames);
  const f = Math.min(frames - 1, Math.max(0, Math.floor(o.frame ?? 0)));
  const chars = b.slots.map((_, i) => String.fromCharCode(97 + i));
  const rows: string[] = [];
  for (let y = 0; y < b.height; y++) {
    let r = '';
    for (let x = 0; x < fw; x++) {
      const v = b.indices[y * b.width + f * fw + x]!;
      r += v ? chars[v - 1] : '.';
    }
    rows.push(r);
  }
  const colors: Record<string, PaletteColor | number> = {};
  b.slots.forEach((s, i) => {
    colors[chars[i]!] = o.palette?.[s] ?? def.palette[s]!;
  });
  return { rows, colors };
}
