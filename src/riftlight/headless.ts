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
import { Engine, type EngineOptions, type Game, type HeadlessOptions, hudPlace, type Viewport } from '../engine';
import { nodeAssets } from '../engine/node';

export { settle, stepUntil } from '../engine/node';
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
export function makeRiftlight(store: SaveStore = new SaveStore(null), seed?: number): Riftlight {
  return new Riftlight({}, { store, seed });
}

/** The agent API of the Riftlight that runs now (`rl` goes stale when another one is loaded: a replay's). */
export function currentRiftlightApi(): RiftlightApi | null {
  return (globalThis as { __RIFTLIGHT__?: RiftlightApi }).__RIFTLIGHT__ ?? null;
}

/**
 * Boot Riftlight headless: `seed` is what `?seed=` is in a page (the engine's, and new runs' when
 * none is given), `viewport` the page's it stands for
 * (default 960×540), `store` the saves (a reload: dispose the engine, boot again on the same store),
 * `options` any other engine option a page's URL would set (`quality`, `debugKeys`, `touch`...).
 */
export async function headlessRiftlight(o: { seed?: number; viewport?: Viewport; game?: Riftlight; store?: SaveStore; options?: Partial<EngineOptions> } = {}): Promise<HeadlessRiftlight> {
  const game = o.game ?? makeRiftlight(o.store, o.seed);
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
 * The pointer over an art pixel (x, y), as the mouse over that pixel of the canvas would put it
 * (`engine.input.setPointer` takes device coordinates, -1..1). `down` presses or lets go of the
 * left button there.
 */
export function pointAtArt(engine: Engine, x: number, y: number, down?: boolean): void {
  const { width, height } = engine.renderer.resolution;
  engine.input.setPointer(((x + 0.5) / width) * 2 - 1, 1 - ((y + 0.5) / height) * 2, down);
}

/** A text the game put on the pixel HUD: where it lands on screen, its drop shadow included, in art pixels. */
export interface HudTextBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The texts the game draws on the pixel HUD over the next `frames` frames (the last frame's, since
 * a game clears and redraws it each frame), placed as the HUD places them: tests check that every
 * line fits the screen (`engine.hud.width`) and that none overlaps another.
 */
export function hudTexts(engine: Engine, frames = 1): HudTextBox[] {
  const hud = engine.hud;
  const own = hud.text;
  let seen: HudTextBox[] = [];
  const clear = hud.clear;
  hud.clear = () => {
    seen = [];
    clear.call(hud);
  };
  hud.text = (x, y, text, o = {}) => {
    const scale = Math.max(1, Math.round(o.scale ?? 1));
    const shadow = o.shadow === false ? 0 : scale;
    const m = hud.measure(text, scale);
    const [px, py] = hudPlace(x, y, m.width, m.height, o.anchor ?? 'top-left', { width: hud.width, height: hud.height });
    seen.push({ text, x: px, y: py, w: m.width + shadow, h: m.height + shadow });
    own.call(hud, x, y, text, o);
  };
  try {
    engine.step(frames);
  } finally {
    hud.text = own;
    hud.clear = clear;
  }
  return seen;
}

/** Two HUD boxes share a pixel. */
export const hudOverlap = (a: HudTextBox, b: HudTextBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
