/**
 * The texture format: a pixel-art texture as plain data (docs/plans/asset-system.md §5,
 * docs/ASSETS.md *Textures*). A def lists layers drawn in order onto a `size` grid of texels in
 * its palette's slots; `bakeTexture` turns it into palette indices and RGBA, headless and pure.
 *
 *   textureDef({ id: 'planks', about: 'Floor boards', tags: ['wood'], size: [16, 16], tile: true,
 *     palette: { gap: 'ink', wood: 'orange', wood2: 'red' },
 *     layers: [{ pattern: 'planks', colors: ['gap', 'wood', 'wood2'], seed: 2 }] });
 */
import type { PaletteColor } from '../palette';

/** A key of the def's palette. Layers never name PALETTE colours directly. */
export type TexSlot = string;

export type PatternId = 'noise' | 'bricks' | 'planks' | 'tiles' | 'cobbles' | 'stripes' | 'checker' | 'scatter' | 'cracks' | 'gradient';

/**
 * Rows of characters, one per texel, as `hud.sprite` draws them: each character is a legend key
 * (its slot), and `.` or a space is transparent. `at` offsets the rows; `mirror: 'x'` adds the rows
 * mirrored to their right (a symmetric sprite from its left half), `'y'` below.
 */
export interface PixelsLayer {
  readonly pixels: readonly string[];
  readonly legend: Readonly<Record<string, TexSlot>>;
  readonly at?: readonly [x: number, y: number];
  readonly mirror?: 'x' | 'y';
}

/**
 * A seeded generator painting a ramp of slots (`colors`, dark to light; one slot is a flat
 * fill). Periodic when the def `tile`s, so it wraps without a seam. Its own parameters are listed
 * by `PATTERNS` (patterns.ts); `dither` blends between ramp steps with a 4×4 ordered dither.
 */
export interface PatternLayer {
  readonly pattern: PatternId;
  readonly colors: TexSlot | readonly TexSlot[];
  readonly seed?: number;
  readonly dither?: boolean;
  readonly [param: string]: unknown;
}

/** An SVG path (M L H V C Q Z, the model `slab` subset) in texel units, no anti-aliasing. */
export interface PathLayer {
  readonly path: string;
  readonly fill?: TexSlot;
  readonly stroke?: TexSlot;
}

/**
 * A 1-texel outline in `outline`'s slot round every opaque texel (on the transparent side). On a
 * sprite sheet it stays inside each frame; patterns and paths don't know about frames.
 */
export interface OutlineLayer {
  readonly outline: TexSlot;
}

export type Layer = PixelsLayer | PatternLayer | PathLayer | OutlineLayer;

export interface TextureDef {
  readonly id: string;
  /** One line: what it is (`npm run tex -- find` searches it). */
  readonly about: string;
  readonly tags: readonly string[];
  /** Texels, width × height; powers of two for surfaces that tile. Sprite sheets: all frames. */
  readonly size: readonly [w: number, h: number];
  /** Slots → PALETTE names (at most 255). Layers name slots, never colours, so a bake can re-bind them. */
  readonly palette: Readonly<Record<TexSlot, PaletteColor>>;
  /** Seamless: patterns wrap by construction; the check measures the seam of pixels, paths and gradients. */
  readonly tile?: boolean;
  /** Sprite sheets: this many frames left to right; they must divide the width. */
  readonly frames?: number;
  readonly layers: readonly Layer[];
}
