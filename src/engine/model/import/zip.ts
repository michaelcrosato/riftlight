/**
 * A zip reader for pack downloads (`npm run model -- import-pack`): kits ship as zip archives.
 * Stored and deflated entries only (what kit archives use); no encryption, no ZIP64.
 * Decompression is injected, like the PNG decoder's: tools pass `node:zlib`'s `inflateRawSync`.
 */

/** Raw deflate (no zlib header) → bytes. */
export type Inflate = (bytes: Uint8Array) => Uint8Array;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Every file in a zip archive: path → bytes (folders left out). Throws on what it can't read. */
export function unzip(bytes: Uint8Array, inflateRaw: Inflate): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = dv.getUint16(end + 10, true);
  let at = dv.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  const files = new Map<string, Uint8Array>();
  const utf8 = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(at, true) !== CENTRAL) throw new Error(`entry ${k}: bad central directory record`);
    const flags = dv.getUint16(at + 8, true);
    const method = dv.getUint16(at + 10, true);
    const size = dv.getUint32(at + 20, true);
    const nameLen = dv.getUint16(at + 28, true);
    const extraLen = dv.getUint16(at + 30, true);
    const commentLen = dv.getUint16(at + 32, true);
    const local = dv.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`'${name}' is encrypted`);
    if (dv.getUint32(local, true) !== LOCAL) throw new Error(`'${name}': bad local header`);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRaw(data));
    else throw new Error(`'${name}' uses compression method ${method}: only stored (0) and deflate (8) are supported`);
  }
  return files;
}
