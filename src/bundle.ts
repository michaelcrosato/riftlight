/**
 * The engine bundle's entry: `npm run bundle` builds this into `pixel-engine.js`, one
 * self-contained ES module for games that live outside this repo (docs/GUIDE.md):
 *
 *   import { Engine, THREE, toonMaterial, PlatformerCharacter, HERO_MODEL } from './pixel-engine.js';
 *
 * It carries the whole public engine API (src/engine/index.ts), three.js as `THREE`
 * (`three/webgpu`) and `TSL` (`three/tsl`) so a game never loads a second copy of three,
 * Rapier with its wasm inlined, the hero kit (model, rig and every clip as data), the
 * engine's built-in models (`assets/hero.glb`, `coin.glb`, `tree.glb`) and its CSS (the
 * loading bar, debug panel and touch controls style themselves on import).
 */
import css from './style.css?inline';

/** The built-in models as data URLs, put in by the bundle build (scripts/bundle.mjs). */
declare const __PIXEL_BUILTINS__: Record<string, string> | undefined;

export * from './engine';
export * as THREE from 'three/webgpu';
export * as TSL from 'three/tsl';
export { HERO_CLIPS, HERO_MODEL, HERO_RAGDOLL, HERO_RIG } from './game/hero';

const builtins: Record<string, string> = typeof __PIXEL_BUILTINS__ === 'object' ? __PIXEL_BUILTINS__ : {};

/** Models every bundle carries: `ctx.loadModel('assets/hero.glb')` works with no files next to it. */
export const BUILTIN_MODELS: readonly string[] = Object.keys(builtins);

const g = globalThis as { __PIXEL_ASSETS__?: Record<string, string>; document?: Document };
// A page can still override a built-in by putting its own data URL in the map first.
g.__PIXEL_ASSETS__ = { ...builtins, ...g.__PIXEL_ASSETS__ };

if (g.document && !g.document.querySelector('style[data-pixel-engine]')) {
  const style = g.document.createElement('style');
  style.dataset.pixelEngine = 'true';
  style.textContent = css;
  g.document.head.prepend(style); // first, so a page's own CSS wins
}
