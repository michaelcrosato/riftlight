/**
 * A PNG decoder in plain TypeScript (no DOM, no Node), for tools that read images headless: the
 * model importer's texture atlases (docs/plans/asset-system.md §7.2) and, later, `tex -- import`.
 * It reads greyscale, RGB, palette, grey + alpha and RGBA images at 8 bits a channel (and the
 * 1, 2, 4 and 16-bit depths those types allow), the five scanline filters, and `tRNS`
 * transparency. Adam7-interlaced images are refused. Decompression is injected (`inflate`), so
 * browser code never pulls in a Node module: tools pass `node:zlib`'s `inflateSync`.
 *
 *   const img = decodePng(readFileSync('colormap.png'), inflateSync);
 */

/** zlib inflate: the IDAT stream (zlib header included) → raw bytes. */
export type Inflate = (bytes: Uint8Array) => Uint8Array;

/** RGBA, 4 bytes a pixel, row by row from the top (the shape `encodePng` takes). */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A PNG the decoder can't read, with what is wrong. */
export class PngError extends Error {
  constructor(message: string) {
    super(`PNG: ${message}`);
    this.name = 'PngError';
  }
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Channels per colour type (0 grey, 2 RGB, 3 palette, 4 grey + alpha, 6 RGBA) and the depths it allows. */
const TYPES: Readonly<Record<number, { channels: number; depths: readonly number[]; name: string }>> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16], name: 'greyscale' },
  2: { channels: 3, depths: [8, 16], name: 'RGB' },
  3: { channels: 1, depths: [1, 2, 4, 8], name: 'palette' },
  4: { channels: 2, depths: [8, 16], name: 'grey + alpha' },
  6: { channels: 4, depths: [8, 16], name: 'RGBA' },
};

const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

/** The Paeth predictor (filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo the per-scanline filters in place: `raw` holds a filter byte then `stride` bytes per row. */
function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp]! : 0;
      const b = y > 0 ? out[up + x]! : 0;
      const c = x >= bpp && y > 0 ? out[up + x - bpp]! : 0;
      const v = raw[src + x]!;
      let p: number;
      if (type === 0) p = 0;
      else if (type === 1) p = a;
      else if (type === 2) p = b;
      else if (type === 3) p = (a + b) >> 1;
      else if (type === 4) p = paeth(a, b, c);
      else throw new PngError(`row ${y} has filter type ${type}; the format has 0–4`);
      out[row + x] = (v + p) & 255;
    }
  }
  return out;
}

/** Decode a PNG file's bytes to RGBA (see the file comment for what it reads). */
export function decodePng(bytes: Uint8Array, inflate: Inflate): RgbaImage {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new PngError('not a PNG file (bad signature)');
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let at = 8; ; ) {
    if (at + 8 > bytes.length) throw new PngError('file ends before IEND (truncated)');
    const len = u32(bytes, at);
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + len);
    if (data.length !== len) throw new PngError(`chunk ${name} runs past the end of the file (truncated)`);
    at += 12 + len;
    if (name === 'IHDR') {
      width = u32(data, 0);
      height = u32(data, 4);
      depth = data[8]!;
      type = data[9]!;
      const spec = TYPES[type];
      if (!spec) throw new PngError(`colour type ${type} is not one of 0, 2, 3, 4, 6`);
      if (!spec.depths.includes(depth)) throw new PngError(`${spec.name} at ${depth} bits is not a valid PNG (depths ${spec.depths.join(', ')})`);
      if (data[10] !== 0 || data[11] !== 0) throw new PngError('unknown compression or filter method');
      if (data[12] !== 0) throw new PngError('interlaced (Adam7) images are not supported: save it without interlacing');
      if (!width || !height) throw new PngError(`size ${width}×${height} is empty`);
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') trns = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
  }
  if (type < 0) throw new PngError('no IHDR chunk');
  if (!idat.length) throw new PngError('no image data (IDAT)');
  if (type === 3 && !palette) throw new PngError('a palette image without a PLTE chunk');

  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  idat.reduce((o, c) => (joined.set(c, o), o + c.length), 0);
  const channels = TYPES[type]!.channels;
  const bits = channels * depth;
  const stride = Math.ceil((width * bits) / 8);
  const raw = inflate(joined);
  if (raw.length < (stride + 1) * height) throw new PngError(`image data is ${raw.length} bytes, ${(stride + 1) * height} expected for ${width}×${height}`);
  const px = unfilter(raw, height, stride, Math.max(1, bits >> 3));

  // samples → RGBA: sub-byte depths unpacked, 16-bit samples keep their high byte
  const out = new Uint8ClampedArray(width * height * 4);
  const max = (1 << Math.min(depth, 8)) - 1;
  const sample = (row: number, i: number): number => {
    if (depth === 8) return px[row + i]!;
    if (depth === 16) return px[row + i * 2]!;
    const bit = i * depth;
    return (px[row + (bit >> 3)]! >> (8 - depth - (bit & 7))) & max;
  };
  const key16 = (i: number) => (trns && trns.length >= i * 2 + 2 ? (trns[i * 2]! << 8) | trns[i * 2 + 1]! : -1);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = (c: number) => sample(row, x * channels + c);
      if (type === 3) {
        const k = s(0);
        if (k * 3 + 2 >= palette!.length) throw new PngError(`pixel (${x}, ${y}) uses palette entry ${k}; PLTE has ${palette!.length / 3}`);
        out[o] = palette![k * 3]!;
        out[o + 1] = palette![k * 3 + 1]!;
        out[o + 2] = palette![k * 3 + 2]!;
        out[o + 3] = trns && k < trns.length ? trns[k]! : 255;
      } else if (type === 0 || type === 4) {
        const g = depth < 8 ? Math.round((s(0) * 255) / max) : s(0);
        out[o] = out[o + 1] = out[o + 2] = g;
        // a tRNS grey key is compared at the image's own depth
        const raw16 = depth === 16 ? (px[row + x * 2 * channels]! << 8) | px[row + x * 2 * channels + 1]! : s(0);
        out[o + 3] = type === 4 ? s(1) : raw16 === key16(0) ? 0 : 255;
      } else {
        out[o] = s(0);
        out[o + 1] = s(1);
        out[o + 2] = s(2);
        if (type === 6) out[o + 3] = s(3);
        else {
          const full = depth === 16 ? [0, 1, 2].map((c) => (px[row + (x * 3 + c) * 2]! << 8) | px[row + (x * 3 + c) * 2 + 1]!) : [s(0), s(1), s(2)];
          out[o + 3] = trns && full.every((v, c) => v === key16(c)) ? 0 : 255;
        }
      }
    }
  }
  return { width, height, data: out };
}
