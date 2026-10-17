/**
 * Node only (headless tests and tools, docs/engine/headless.md): what the engine needs from Node.
 * The page never imports this module (it would bring `node:fs` into the page), and the engine
 * index doesn't export it: import it from `src/engine/node.ts` where the process is Node.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetReader } from './assets';
import type { Engine } from './Engine';

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

/**
 * Step until `done()` holds, at most `max` frames, `every` frames at a time, letting promise
 * callbacks run between (a level or a stage builds async, as a page's frames would let it): what a
 * page's `waitForFunction` waits for. The frames it took; throws when it never holds, naming `what`.
 */
export async function stepUntil(engine: Engine, done: () => boolean, o: { max?: number; every?: number; what?: string } = {}): Promise<number> {
  const { max = 600, every = 1, what = 'the condition' } = o;
  for (let f = 0; f <= max; f += every) {
    if (done()) return f;
    engine.step(every);
    await settle();
  }
  throw new Error(`stepUntil: ${what} did not hold within ${max} frames`);
}

/** Let promise callbacks run out (a task boundary), as a page does between two animation frames. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
