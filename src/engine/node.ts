/**
 * Node only (headless tests and tools, docs/engine/headless.md): what the engine needs from Node.
 * The page never imports this module (it would bring `node:fs` into the page), and the engine
 * index doesn't export it: import it from `src/engine/node.ts` where the process is Node.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetReader } from './assets';

/**
 * Assets read from disk: `assets/hero.glb` is `<root>/assets/hero.glb`. Pass it to
 * `Engine.headless(game, { assets: nodeAssets() })`. `root` is relative to the working directory
 * (default `public`, the site's assets).
 */
export function nodeAssets(root = 'public'): AssetReader {
  return async (path) => {
    if (/^(https?:|data:|blob:)/.test(path)) throw new Error(`nodeAssets: ${path} is not a file under ${root}/`);
    const buf = await readFile(join(root, path.replace(/^\/+/, '')));
    // a Buffer may share a larger pool: GLTFLoader.parseAsync wants exactly its bytes, as an ArrayBuffer
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
}
