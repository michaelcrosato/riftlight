/** The bytes of a data: URL (base64 or percent-encoded): what a page fetches from one, with no fetch. */
export function dataUrlBytes(url: string): ArrayBuffer {
  const comma = url.indexOf(',');
  const body = url.slice(comma + 1);
  // base64, or each character a byte with %XX as the byte it names (not text: `%FF%00` is two bytes)
  const bin = /;base64$/i.test(url.slice(0, comma)) ? atob(body) : body.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
