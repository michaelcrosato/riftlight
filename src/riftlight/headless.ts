/**
 * Riftlight without a page (docs/engine/headless.md, docs/game/shell.md *Headless*): the one way
 * tests and tools boot the game in Node. The same game, options and agent API as the page's
 * (`rl` is what `window.__RIFTLIGHT__` holds there), saves in memory.
 *
 *   const { engine, rl } = await headlessRiftlight({ seed: 4242 });
 *   rl.newRun({ seed: 1 }); await rl.enterDepth(1); rl.bot.start(); rl.bot.advance(600);
 *
 * Node only: it reads the models and packs from `public/` (`nodeAssets`).
 */
import { fileURLToPath } from 'node:url';
import { Engine, type EngineOptions, type Game, type HeadlessOptions, type Viewport } from '../engine';
import { nodeAssets } from '../engine/node';
import { Riftlight, RIFTLIGHT_OPTIONS } from './index';
import { type RiftlightApi } from './game/api';
import { SaveStore } from './game/save';

/** Where the site's assets live, whatever the working directory. */
export const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));

export interface HeadlessRiftlight {
  engine: Engine;
  game: Riftlight;
  rl: RiftlightApi;
}

/** A Riftlight that keeps its saves in memory (what headless tools load, a replay's too); pass a store to share one (a page reload: the same saves, a new game). */
export function makeRiftlight(store: SaveStore = new SaveStore(null)): Riftlight {
  return new Riftlight({}, { store });
}

/** The agent API of the Riftlight that runs now (`rl` goes stale when another one is loaded: a replay's). */
export function currentRiftlightApi(): RiftlightApi | null {
  return (globalThis as { __RIFTLIGHT__?: RiftlightApi }).__RIFTLIGHT__ ?? null;
}

/**
 * Boot Riftlight headless: `seed` is the engine's (`?seed=`), `viewport` the page's it stands for
 * (default 960×540), `store` the saves (a reload: dispose the engine, boot again on the same store),
 * `options` any other engine option a page's URL would set (`quality`, `debugKeys`, `touch`...).
 */
export async function headlessRiftlight(o: { seed?: number; viewport?: Viewport; game?: Riftlight; store?: SaveStore; options?: Partial<EngineOptions> } = {}): Promise<HeadlessRiftlight> {
  const game = o.game ?? makeRiftlight(o.store);
  const engine = await Engine.headless(game, { ...RIFTLIGHT_OPTIONS, ...o.options, seed: o.seed, viewport: o.viewport, assets: nodeAssets(PUBLIC_DIR) });
  const rl = currentRiftlightApi();
  if (!rl) throw new Error('headlessRiftlight: the game did not install its API (Riftlight.ready)');
  return { engine, game, rl };
}

/** Any game of this repository headless (a lab, the arena, a room), with the site's assets. */
export function headlessGame(game: Game, options: HeadlessOptions = {}): Promise<Engine> {
  return Engine.headless(game, { assets: nodeAssets(PUBLIC_DIR), ...options });
}

/**
 * Step until `done()` holds (checked after each frame), at most `max` frames, as a page's
 * `waitForFunction` would wait: the frames it took. Throws when it never holds, naming `what`.
 */
export function stepUntil(engine: Engine, done: () => boolean, max = 600, what = 'the condition'): number {
  for (let f = 0; f <= max; f++) {
    if (done()) return f;
    engine.step(1);
  }
  throw new Error(`stepUntil: ${what} did not hold within ${max} frames`);
}

/** Let promise callbacks run out (a task boundary), as a page does between two animation frames. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The pointer over an art pixel (x, y), as the mouse over that pixel of the canvas would put it
 * (`engine.input.setPointer` takes device coordinates, -1..1). `down` presses or lets go of the
 * left button there.
 */
export function pointAtArt(engine: Engine, x: number, y: number, down?: boolean): void {
  const { width, height } = engine.renderer.resolution;
  engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2, down);
}
