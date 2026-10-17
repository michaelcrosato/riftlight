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
import { Engine, type Viewport } from '../engine';
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

/** A Riftlight that keeps its saves in memory (what headless tools load, a replay's too). */
export function makeRiftlight(): Riftlight {
  return new Riftlight({}, { store: new SaveStore(null) });
}

/** The agent API of the Riftlight that runs now (`rl` goes stale when another one is loaded: a replay's). */
export function currentRiftlightApi(): RiftlightApi | null {
  return (globalThis as { __RIFTLIGHT__?: RiftlightApi }).__RIFTLIGHT__ ?? null;
}

/** Boot Riftlight headless: `seed` is the engine's (`?seed=`), `viewport` the page's it stands for (default 960×540). */
export async function headlessRiftlight(o: { seed?: number; viewport?: Viewport; game?: Riftlight } = {}): Promise<HeadlessRiftlight> {
  const game = o.game ?? makeRiftlight();
  const engine = await Engine.headless(game, { ...RIFTLIGHT_OPTIONS, seed: o.seed, viewport: o.viewport, assets: nodeAssets(PUBLIC_DIR) });
  const rl = currentRiftlightApi();
  if (!rl) throw new Error('headlessRiftlight: the game did not install its API (Riftlight.ready)');
  return { engine, game, rl };
}
