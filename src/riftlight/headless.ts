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
import { Engine, type EngineOptions, type Game, type HeadlessOptions, hudPlace, type HubResult, HubSession, LocalHub, type Viewport } from '../engine';
import { nodeAssets, settle } from '../engine/node';

export { settle, stepUntil } from '../engine/node';
import { Riftlight, RIFTLIGHT_OPTIONS } from './index';
import { type RiftlightApi } from './game/api';
import { SaveStore } from './game/save';
import type { MomentSpec } from './session/moments';

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

/** Every online mode the hand-over page offers (a moment's copy joins with them all; the hub picks moments). */
const OFFERED = ['shared-world', 'ghost', 'parallel', 'moments'] as const;

/** A moment headless: its one copy, the hub in memory behind it, and a frame of both. */
export interface HeadlessMoment extends HeadlessRiftlight {
  hub: LocalHub;
  session: HubSession;
  /** One frame of the game (`step`: how it moves; default one engine step) and of the hub's clock. */
  frame(step?: () => void): Promise<void>;
}

/**
 * The real game as the one copy of moment `m` against the hub in memory (engine `LocalHub`, round
 * seed `seed`), loaded and ready: start it with `hub.start()` (docs/game/session.md, *Moments*).
 * `viewport` and `options` as `headlessRiftlight`'s (a phone: its size and `touch`).
 */
export async function headlessMoment(m: MomentSpec, o: { seed?: number; store?: SaveStore; viewport?: Viewport; options?: Partial<EngineOptions> } = {}): Promise<HeadlessMoment> {
  const hub = new LocalHub({ mode: 'moments', moment: { id: m.id, seconds: m.seconds }, players: 1, seed: o.seed ?? 4242 });
  const session = (await HubSession.join({ mode: OFFERED, seats: [1, 4], client: hub.client(0), autoFlush: false, clock: () => hub.now }))!;
  const game = new Riftlight({}, { store: o.store ?? new SaveStore(null), session });
  const h = await headlessRiftlight({ game, seed: session.info.seed, viewport: o.viewport, options: o.options });
  session.attach(h.engine);
  const frame = async (step = () => h.engine.step(1)): Promise<void> => {
    step();
    hub.advance(1000 / 60);
    session.flush();
    await settle();
  };
  for (let f = 0; f < 600 && !hub.allReady; f++) await frame();
  if (!hub.allReady) {
    h.engine.dispose();
    throw new Error(`headlessMoment: ${m.id} never got ready`);
  }
  return { ...h, hub, session, frame };
}

/** Frames a player takes to react to Go (0.4 s). */
const REACT = 24;

/**
 * Start moment `r` and play it until the hub has the player's result (or the moment ended): `decent`
 * plays it as the playtest bot (an escape: a run for the spot, a beat after Go), `idle` stands still.
 */
export async function playMoment(r: HeadlessMoment, how: 'decent' | 'idle'): Promise<HubResult | undefined> {
  const m = r.game.round!.moment!;
  r.hub.start();
  for (let f = 0; f < 400 && !r.game.round!.playing; f++) await r.frame();
  r.rl.bot.start();
  const spot = r.game.momentAim?.spot;
  let frames = 0;
  const step =
    how === 'idle'
      ? undefined
      : m.clear === 'escape'
        ? () => void (frames++ < REACT ? r.engine.step(1) : r.rl.moveTo(spot!.x, spot!.z, { radius: 1, maxFrames: 1 })) // run for it, a beat after Go
        : () => void r.rl.bot.advance(1); // fight it out
  for (let f = 0; f < (m.seconds + 4) * 60 && !r.hub.results.has(0) && !r.hub.endReason; f++) await r.frame(step);
  return r.hub.results.get(0);
}
