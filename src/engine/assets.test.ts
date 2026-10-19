// What the engine kit needs to run in Node from its folder alone (docs/engine/headless.md): data:
// URLs decode without fetch (Rapier's inlined wasm, the embedded models), and a reader never sees
// a file the build embedded in `__PIXEL_ASSETS__` (the kit's built-in models), as a page doesn't.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadModel, setAssetReader } from './assets';
import { dataUrlBytes } from './dataUrl';

const g = globalThis as { __PIXEL_ASSETS__?: Record<string, string> };

afterEach(() => {
  setAssetReader(null);
  delete g.__PIXEL_ASSETS__?.['assets/embedded-coin.glb'];
});

describe('assets without a page', () => {
  it('decodes base64 and percent-encoded data: URLs', () => {
    expect([...new Uint8Array(dataUrlBytes('data:application/octet-stream;base64,AAEC/w=='))]).toEqual([0, 1, 2, 255]);
    expect(new TextDecoder().decode(dataUrlBytes('data:application/json,%7B%22a%22%3A1%7D'))).toBe('{"a":1}');
    expect([...new Uint8Array(dataUrlBytes('data:application/octet-stream,%FF%00a'))], 'percent-encoded bytes, as fetch gives them').toEqual([255, 0, 97]);
  });

  it("loads a model the build embedded without asking the reader, and the rest through it", async () => {
    const coin = readFileSync(new URL('../../public/assets/coin.glb', import.meta.url));
    g.__PIXEL_ASSETS__ = { ...g.__PIXEL_ASSETS__, 'assets/embedded-coin.glb': `data:model/gltf-binary;base64,${coin.toString('base64')}` };
    const asked: string[] = [];
    setAssetReader(async (path) => {
      asked.push(path);
      return coin.buffer.slice(coin.byteOffset, coin.byteOffset + coin.byteLength);
    });
    const embedded = await loadModel('assets/embedded-coin.glb');
    expect(embedded.scene.children.length).toBeGreaterThan(0);
    expect(asked, 'the reader is not asked for an embedded file').toEqual([]);
    await loadModel('assets/coin.glb');
    expect(asked).toEqual(['assets/coin.glb']);
  });
});
