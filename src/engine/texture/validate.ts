/**
 * Texture checks (`npm run tex -- check`), the textures' counterpart of `validateModel`.
 * Problems: `bakeTexture`'s (everything that stops it baking right, so the converters refuse it)
 * plus a missing `about` or `tags`, and an imported texture's `source` without a url or a licence,
 * or with one `LICENCES` doesn't allow (the models' rule). Warnings are what won't read at 480×270: a seam where a
 * tiling texture's drawn layers (pixels, paths, a gradient) wrap, salt-and-pepper texels (too
 * many single texels to read at 1:1; they shimmer as the camera zooms), a size that isn't a power
 * of two on a tiling surface, legend keys and palette slots nobody uses. Patterns other than
 * `gradient` wrap by construction (patterns.ts), so their seams are tested, not measured.
 */
import { licenceProblem } from '../model/packs/licences';
import { bakeTexture, isPattern, isPixels, type BakedTexture } from './bake';
import { PATTERNS } from './patterns';
import type { TextureDef } from './types';

/** Share of opaque texels with no same-coloured 4-neighbour above which a texture reads as noise. */
export const MAX_ISOLATED = 0.15;
/** How much further (0..1 of the largest colour distance) a tiling texture's wrap may jump than any line inside it. */
export const MAX_SEAM_EXCESS = 0.08;

export interface TextureMetrics {
  readonly width: number;
  readonly height: number;
  readonly colours: number;
  readonly transparent: number;
  /** Opaque texels with no 4-neighbour of their colour, as a share of the opaque ones. */
  readonly isolated: number;
  /** Tiling textures with drawn layers: the mean colour jump across the wrap line, and across the line inside that jumps most (0..1). */
  readonly seam: { readonly wrap: number; readonly inside: number } | null;
}

export interface TextureCheck {
  readonly id: string;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  readonly metrics: TextureMetrics | null;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const pow2 = (v: number) => v > 0 && (v & (v - 1)) === 0;

/** Isolated texels, and (when tiling) how often neighbours differ across the wrap vs inside. */
export function textureMetrics(b: BakedTexture, tile: boolean): TextureMetrics {
  const { width: w, height: h, indices } = b;
  const at = (x: number, y: number) => indices[(((y % h) + h) % h) * w + (((x % w) + w) % w)]!;
  let opaque = 0;
  let isolated = 0;
  const used = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = indices[y * w + x]!;
      if (!v) continue;
      opaque++;
      used.add(v);
      const n = [x > 0 || tile ? at(x - 1, y) : -1, x < w - 1 || tile ? at(x + 1, y) : -1, y > 0 || tile ? at(x, y - 1) : -1, y < h - 1 || tile ? at(x, y + 1) : -1].filter((u) => u >= 0);
      if (n.length && !n.includes(v)) isolated++;
    }
  }
  // A seam is a wrap line where the colour jumps further, on average, than across any line
  // inside. Joints that land on the wrap (bricks, tiles) jump as far as the joints inside, so
  // they pass; a gradient's wrap jumps from its lightest to its darkest, so it doesn't.
  let seam: TextureMetrics['seam'] = null;
  if (tile && w > 2 && h > 2) {
    const k = (x: number, y: number) => ((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4;
    const dist = (p: number, q: number) => Math.hypot(b.rgba[p]! - b.rgba[q]!, b.rgba[p + 1]! - b.rgba[q + 1]!, b.rgba[p + 2]! - b.rgba[q + 2]!, b.rgba[p + 3]! - b.rgba[q + 3]!) / 510;
    const cols = Array.from({ length: w }, (_, x) => {
      let d = 0;
      for (let y = 0; y < h; y++) d += dist(k(x, y), k(x + 1, y));
      return d / h;
    });
    const rows = Array.from({ length: h }, (_, y) => {
      let d = 0;
      for (let x = 0; x < w; x++) d += dist(k(x, y), k(x, y + 1));
      return d / w;
    });
    const wrapX = cols[w - 1]!;
    const wrapY = rows[h - 1]!;
    const insideX = Math.max(...cols.slice(0, -1));
    const insideY = Math.max(...rows.slice(0, -1));
    seam = wrapX - insideX >= wrapY - insideY ? { wrap: wrapX, inside: insideX } : { wrap: wrapY, inside: insideY };
  }
  return { width: w, height: h, colours: used.size, transparent: w * h - opaque, isolated: opaque ? isolated / opaque : 0, seam };
}

export function validateTexture(def: TextureDef): TextureCheck {
  const baked = bakeTexture(def);
  const problems = [...baked.problems];
  const warnings: string[] = [];
  if (typeof def.about !== 'string') problems.push(`it has no \`about\`: one line saying what it is (\`find\` searches it)`);
  if (!Array.isArray(def.tags)) problems.push(`it has no \`tags\`: a list of words for \`find\` (may be empty)`);
  const licence = def.source ? licenceProblem(def.source) : null;
  if (licence) problems.push(licence);
  if (problems.length) return { id: def.id, problems, warnings, metrics: null };
  // drawn layers can break at the wrap; the other patterns are periodic by construction, so the
  // seam is measured on a bake of the drawn layers alone
  const isDrawn = (l: TextureDef['layers'][number]) => (isPattern(l) ? !PATTERNS[l.pattern]!.periodic : !('outline' in l));
  const all = textureMetrics(baked, def.tile === true);
  const drawnLayers = def.layers.filter(isDrawn);
  const metrics = { ...all, seam: drawnLayers.length ? textureMetrics(bakeTexture({ ...def, layers: drawnLayers }), def.tile === true).seam : null };
  if (def.tile && !(pow2(baked.width) && pow2(baked.height))) warnings.push(`it tiles but its size ${baked.width} × ${baked.height} isn't a power of two: use 8, 16, 32 or 64 texels`);
  if (metrics.seam && metrics.seam.wrap > metrics.seam.inside + MAX_SEAM_EXCESS) warnings.push(`its edges don't meet: the colour jumps ${pct(metrics.seam.wrap)} across the wrap, more than across any line inside (${pct(metrics.seam.inside)}), so every tile shows a seam; draw the pixels or path so the right edge leads into the left and the bottom into the top (a gradient never does), or drop \`tile\``);
  if (metrics.isolated > MAX_ISOLATED) warnings.push(`${pct(metrics.isolated)} of its texels have no neighbour of their colour (over ${pct(MAX_ISOLATED)}): single texels read as noise at 480×270 and shimmer as the camera zooms; use bigger shapes, fewer ramp steps, or drop \`dither\``);
  // legend keys and slots never drawn
  const drawn = new Set<number>();
  for (const v of baked.indices) if (v) drawn.add(v);
  const unusedSlots = baked.slots.filter((_, i) => !drawn.has(i + 1));
  if (unusedSlots.length) warnings.push(`palette slot${unusedSlots.length > 1 ? 's' : ''} ${unusedSlots.map((s) => `'${s}'`).join(', ')} never drawn: remove ${unusedSlots.length > 1 ? 'them' : 'it'} or use ${unusedSlots.length > 1 ? 'them' : 'it'}`);
  def.layers.forEach((l, i) => {
    if (!isPixels(l)) return;
    const chars = new Set(l.pixels.join(''));
    const unused = Object.keys(l.legend).filter((k) => !chars.has(k));
    if (unused.length) warnings.push(`layers[${i}]'s legend names ${unused.map((k) => `'${k}'`).join(', ')}, which no row uses: drop ${unused.length > 1 ? 'them' : 'it'}`);
  });
  return { id: def.id, problems, warnings, metrics };
}
