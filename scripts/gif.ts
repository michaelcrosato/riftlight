// Tiny animated-GIF encoder (global palette, LZW), so filmstrips can also be watched as
// motion by a human. Frames are RGBA of identical size; colours beyond 256 are reduced.

export interface GifFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export function encodeGif(frames: GifFrame[], delayCs: number, scale = 1): Buffer {
  const w = frames[0]!.width * scale;
  const h = frames[0]!.height * scale;
  // palette: exact colours if they fit, otherwise drop low bits until they do
  let shift = 0;
  let palette: number[] = [];
  let lookup = new Map<number, number>();
  for (; shift < 8; shift++) {
    palette = [];
    lookup = new Map();
    const mask = (0xff << shift) & 0xff;
    let ok = true;
    for (const f of frames) {
      for (let i = 0; i < f.data.length && ok; i += 4) {
        const key = ((f.data[i]! & mask) << 16) | ((f.data[i + 1]! & mask) << 8) | (f.data[i + 2]! & mask);
        if (lookup.has(key)) continue;
        if (palette.length === 256) ok = false;
        else {
          lookup.set(key, palette.length);
          palette.push(key);
        }
      }
      if (!ok) break;
    }
    if (ok) break;
  }
  const mask = (0xff << shift) & 0xff;
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const u16 = (v: number) => push(v & 0xff, (v >> 8) & 0xff);
  push(...Buffer.from('GIF89a'));
  u16(w);
  u16(h);
  push(0xf7, 0, 0); // global colour table, 256 entries
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? 0;
    push((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
  }
  push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0); // loop forever
  for (const f of frames) {
    push(0x21, 0xf9, 4, 0, delayCs & 0xff, (delayCs >> 8) & 0xff, 0, 0);
    push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    push(0);
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (Math.floor(y / scale) * f.width + Math.floor(x / scale)) * 4;
        idx[y * w + x] = lookup.get(((f.data[i]! & mask) << 16) | ((f.data[i + 1]! & mask) << 8) | (f.data[i + 2]! & mask)) ?? 0;
      }
    }
    push(8);
    const lzw = compress(idx, 8);
    for (let i = 0; i < lzw.length; i += 255) {
      const block = lzw.subarray(i, i + 255);
      push(block.length, ...block);
    }
    push(0);
  }
  push(0x3b);
  return Buffer.from(bytes);
}

/** GIF-flavoured LZW (variable code size up to 12 bits, clear on a full table). */
function compress(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map<number, number>();
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  const emit = (code: number) => {
    buf |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(buf & 0xff);
      buf >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let cur = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const key = (cur << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      cur = hit;
      continue;
    }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minCodeSize + 1;
      table = new Map();
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (bits > 0) out.push(buf & 0xff);
  return Uint8Array.from(out);
}
