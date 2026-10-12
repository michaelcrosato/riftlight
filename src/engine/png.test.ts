import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, pngChunk } from '../../scripts/png';
import { decodePng, PngError } from './png';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** Scanlines (already packed samples) filtered by the encoder's rules, each row with its type. */
function filtered(rows: readonly Uint8Array[], bpp: number, types: readonly number[]): Uint8Array {
  const stride = rows[0]!.length;
  const out = new Uint8Array((stride + 1) * rows.length);
  rows.forEach((cur, y) => {
    const prev = y > 0 ? rows[y - 1]! : new Uint8Array(stride);
    const t = types[y % types.length]!;
    out[y * (stride + 1)] = t;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][t]!;
      out[y * (stride + 1) + 1 + x] = (cur[x]! - pred) & 255;
    }
  });
  return out;
}

/** A PNG file from its header fields, raw (filtered) data and extra chunks before IDAT. */
function png(o: { width: number; height: number; depth: number; type: number; interlace?: number }, raw: Uint8Array, extra: [string, Uint8Array][] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, o.width);
  new DataView(ihdr.buffer).setUint32(4, o.height);
  ihdr.set([o.depth, o.type, 0, 0, o.interlace ?? 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from(SIG), pngChunk('IHDR', ihdr), ...extra.map(([t, d]) => pngChunk(t, d)), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', new Uint8Array(0))]));
}

/** A deterministic busy pattern: every filter has something to predict. */
const value = (x: number, y: number, c: number) => (x * 37 + y * 91 + c * 53 + ((x * y) % 7) * 29) & 255;
const decode = (bytes: Uint8Array) => decodePng(bytes, inflateSync);
const ALL_FILTERS = [0, 1, 2, 3, 4];

describe('decodePng', () => {
  it('round-trips encodePng output (RGBA, filter 0)', () => {
    const width = 13;
    const height = 9;
    const data = new Uint8ClampedArray(width * height * 4).map((_, i) => value(i >> 2, Math.floor(i / (width * 4)), i & 3));
    const img = decode(new Uint8Array(encodePng({ width, height, data })));
    expect([img.width, img.height]).toEqual([width, height]);
    expect(Array.from(img.data)).toEqual(Array.from(data));
  });

  it('undoes all five filters, for every 8-bit colour type', () => {
    const width = 11;
    const height = 10;
    for (const [type, channels] of [[0, 1], [2, 3], [4, 2], [6, 4]] as const) {
      const rows = Array.from({ length: height }, (_, y) => Uint8Array.from({ length: width * channels }, (_, i) => value(Math.floor(i / channels), y, i % channels)));
      const img = decode(png({ width, height, depth: 8, type }, filtered(rows, channels, ALL_FILTERS)));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const got = Array.from(img.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
          const s = (c: number) => rows[y]![x * channels + c]!;
          const want = type === 0 ? [s(0), s(0), s(0), 255] : type === 4 ? [s(0), s(0), s(0), s(1)] : type === 2 ? [s(0), s(1), s(2), 255] : [s(0), s(1), s(2), s(3)];
          expect(got, `type ${type} at ${x},${y}`).toEqual(want);
        }
      }
    }
  });

  it('reads palette images at 8, 4, 2 and 1 bits, with tRNS alpha', () => {
    const plte = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 250, 250, 250]);
    const trns = Uint8Array.from([255, 128, 0]); // entry 3 has none: opaque
    const width = 7; // not a whole number of bytes at 1, 2 or 4 bits: rows are padded
    const height = 3;
    for (const depth of [8, 4, 2, 1]) {
      const n = Math.min(4, 1 << depth);
      const idx = (x: number, y: number) => (x + y * 3) % n;
      const stride = Math.ceil((width * depth) / 8);
      const rows = Array.from({ length: height }, (_, y) => {
        const row = new Uint8Array(stride);
        for (let x = 0; x < width; x++) row[(x * depth) >> 3]! |= idx(x, y) << (8 - depth - ((x * depth) & 7));
        return row;
      });
      const img = decode(png({ width, height, depth, type: 3 }, filtered(rows, 1, ALL_FILTERS), [['PLTE', plte], ['tRNS', trns]]));
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const k = idx(x, y);
          expect(Array.from(img.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)), `${depth} bits at ${x},${y}`).toEqual([...plte.subarray(k * 3, k * 3 + 3), k < trns.length ? trns[k]! : 255]);
        }
      }
    }
  });

  it('scales sub-byte greys, keeps 16-bit high bytes and keys tRNS colours out', () => {
    // 2-bit grey: 0..3 → 0, 85, 170, 255
    const grey = decode(png({ width: 4, height: 1, depth: 2, type: 0 }, Uint8Array.from([0, 0b00011011])));
    expect(Array.from(grey.data).filter((_, i) => i % 4 === 0)).toEqual([0, 85, 170, 255]);
    // 16-bit RGB with a tRNS key colour: the high byte of each sample, the keyed pixel transparent
    const rgb16 = Uint8Array.from([0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
    const img = decode(png({ width: 2, height: 1, depth: 16, type: 2 }, rgb16, [['tRNS', Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])]]));
    expect(Array.from(img.data)).toEqual([0x12, 0x56, 0x9a, 255, 0x01, 0x03, 0x05, 0]);
    // 8-bit grey keyed by tRNS
    const keyed = decode(png({ width: 2, height: 1, depth: 8, type: 0 }, Uint8Array.from([0, 7, 9]), [['tRNS', Uint8Array.from([0, 9])]]));
    expect(Array.from(keyed.data)).toEqual([7, 7, 7, 255, 9, 9, 9, 0]);
  });

  it('refuses what it cannot read, saying why', () => {
    expect(() => decode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/not a PNG file/);
    const raw = filtered([Uint8Array.from([1, 2, 3])], 3, [0]);
    expect(() => decode(png({ width: 1, height: 1, depth: 8, type: 2, interlace: 1 }, raw))).toThrow(/interlaced \(Adam7\) images are not supported/);
    expect(() => decode(png({ width: 1, height: 1, depth: 4, type: 2 }, raw))).toThrow(/RGB at 4 bits is not a valid PNG/);
    expect(() => decode(png({ width: 1, height: 1, depth: 8, type: 3 }, Uint8Array.from([0, 0])))).toThrow(/without a PLTE chunk/);
    const whole = png({ width: 1, height: 1, depth: 8, type: 2 }, raw);
    expect(() => decode(whole.subarray(0, whole.length - 20))).toThrow(PngError);
    expect(() => decode(png({ width: 1, height: 1, depth: 8, type: 2 }, Uint8Array.from([7, 1, 2, 3])))).toThrow(/filter type 7/);
  });
});
