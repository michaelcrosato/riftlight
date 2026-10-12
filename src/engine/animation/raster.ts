import { drawText } from './font';

/** Tiny RGBA software canvas shared by contact sheets, curve plots and filmstrips (no GPU, no DOM). */
export interface SheetImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const BG: RGB = [36, 40, 56];
export const CELL_BG: RGB = [44, 49, 68];
export const GRID: RGB = [58, 64, 88];
export const GROUND: RGB = [140, 146, 170];
export const TEXT: RGB = [230, 232, 240];
export const DIM: RGB = [150, 156, 180];
export const RIGHT: RGB = [239, 125, 87];
export const LEFT: RGB = [115, 239, 247];
export const CENTRE: RGB = [255, 205, 117];
export const CONTACT: RGB = [56, 183, 100];
export const BAD: RGB = [255, 70, 90];
export const WARN: RGB = [255, 205, 117];

export type RGB = [number, number, number];

/** A colour per pixel from its barycentric weights on the triangle's corners a, b and c. */
export type Shader = (wa: number, wb: number, wc: number) => RGB;

/** Reads a texture's colour (sRGB 0..255) at (u, v), nearest texel, v = 0 at the bottom row. */
export type TexelSampler = (u: number, v: number) => RGB;

/**
 * A nearest-texel sampler over RGBA bytes, as the GPU samples a pixel-art map: repeat-wrapped
 * (else clamped), and `bottomFirst` when row 0 of the data is the texture's bottom (a
 * `DataTexture` with `flipY` false), else its top (a baked texture, an image).
 */
export function texelSampler(data: ArrayLike<number>, width: number, height: number, o: { repeat: boolean; bottomFirst: boolean }): TexelSampler {
  const wrap = (t: number) => (o.repeat ? t - Math.floor(t) : Math.min(1, Math.max(0, t)));
  return (u, v) => {
    const x = Math.min(width - 1, Math.floor(wrap(u) * width));
    const y = Math.min(height - 1, Math.floor(wrap(v) * height));
    const i = ((o.bottomFirst ? y : height - 1 - y) * width + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
}

/** A shader that samples `sample` at the triangle's UVs (6 numbers: a, b, c) and tints it. */
export function texturedShader(uv: ArrayLike<number>, sample: TexelSampler, tint: RGB): Shader {
  return (wa, wb, wc) => {
    const t = sample(wa * uv[0]! + wb * uv[2]! + wc * uv[4]!, wa * uv[1]! + wb * uv[3]! + wc * uv[5]!);
    return [(t[0] * tint[0]) / 255, (t[1] * tint[1]) / 255, (t[2] * tint[2]) / 255];
  };
}

/**
 * Per-triangle preview colours for the software rasterizers (contact sheets, inspect,
 * portraits). A geometry whose shader colours it procedurally (vertex attributes, TSL
 * patterns) can carry `userData.triColors`: 4 bytes per triangle in draw order, sRGB r, g,
 * b and flags (bit 0 = unlit, bits 1..7 = which merged piece it came from, so outlines
 * still separate parts merged into one mesh). Returns null when the geometry has none, so
 * callers fall back to the material colour.
 */
export function presetTriangleColour(userData: { triColors?: Uint8Array } | undefined, triangle: number): { rgb: RGB; unlit: boolean; piece: number } | null {
  const c = userData?.triColors;
  if (!c || triangle * 4 + 3 >= c.length) return null;
  const i = triangle * 4;
  return { rgb: [c[i]!, c[i + 1]!, c[i + 2]!], unlit: (c[i + 3]! & 1) === 1, piece: c[i + 3]! >> 1 };
}

/** Outline id of a triangle: its mesh, and its merged piece when the mesh carries `triColors`. */
export function outlineId(mesh: number, preset: { piece: number } | null): number {
  return preset ? ((mesh * 128 + preset.piece) % 65535) + 1 : mesh;
}

export class Canvas {
  readonly data: Uint8ClampedArray;
  readonly depth: Float32Array;
  readonly ids: Uint16Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height).fill(-Infinity);
    this.ids = new Uint16Array(width * height);
    this.rect(0, 0, width, height, BG);
  }

  set(x: number, y: number, c: RGB, a = 1): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    d[i] = d[i]! + (c[0] - d[i]!) * a;
    d[i + 1] = d[i + 1]! + (c[1] - d[i + 1]!) * a;
    d[i + 2] = d[i + 2]! + (c[2] - d[i + 2]!) * a;
    d[i + 3] = 255;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) this.set(xx, yy, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1, thick = 1): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      if (thick <= 1) this.set(x, y, c, a);
      else this.rect(Math.round(x - thick / 2), Math.round(y - thick / 2), thick, thick, c, a);
    }
  }

  text(s: string, x: number, y: number, c: RGB, scale = 1): void {
    drawText(s, x, y, (px, py) => this.set(px, py, c), scale);
  }

  /** A depth-tested triangle in one colour, or a colour per pixel (`Shader`). */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: RGB | Shader, id: number, clip: Rect): void {
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const x0 = Math.max(clip.x, Math.floor(Math.min(ax, bx, cx)));
    const x1 = Math.min(clip.x + clip.w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(clip.y, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(clip.y + clip.h - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const k = y * this.width + x;
        if (z <= this.depth[k]!) continue;
        this.depth[k] = z;
        this.ids[k] = id;
        this.set(x, y, typeof c === 'function' ? c(w0, w1, w2) : c);
      }
    }
  }

  /** Cel outlines: darken covered pixels whose neighbour belongs to another mesh. */
  outline(clip: Rect): void {
    const edges: number[] = [];
    for (let y = clip.y; y < clip.y + clip.h; y++) {
      for (let x = clip.x; x < clip.x + clip.w; x++) {
        const k = y * this.width + x;
        const id = this.ids[k]!;
        if (!id) continue;
        const n = [x > clip.x ? this.ids[k - 1] : 0, x < clip.x + clip.w - 1 ? this.ids[k + 1] : 0, y > clip.y ? this.ids[k - this.width] : 0, y < clip.y + clip.h - 1 ? this.ids[k + this.width] : 0];
        if (n.some((v) => v !== id)) edges.push(k);
      }
    }
    for (const k of edges) {
      const i = k * 4;
      const outer = [k - 1, k + 1, k - this.width, k + this.width].some((q) => this.ids[q] === 0);
      const f = outer ? 0.25 : 0.6;
      this.data[i] = this.data[i]! * f;
      this.data[i + 1] = this.data[i + 1]! * f;
      this.data[i + 2] = this.data[i + 2]! * f;
    }
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

