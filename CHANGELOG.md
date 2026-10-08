# Changelog

What changed in Pixel Engine for a game built on it, newest first. The version is
`package.json`'s; a game reads it as `ENGINE_VERSION`, `Engine.version` or
`engine.state().version`. The engine kit (`npm run bundle`, docs/GUIDE.md) ships this file.

When a change alters the public API (`src/bundle.ts` exports) or something a game can see,
bump the version (minor while it is 0.x) and add its section here; `npm test` fails when
`package.json`'s version has no section.

## 0.2.0

- **The engine kit**: `npm run bundle` builds `pixel-engine.js`, one self-contained ES module
  (engine, three.js as `THREE` and `TSL`, Rapier with its wasm, the hero kit, the built-in
  models and the CSS), with `GUIDE.md` (how to build a game on it), a generated `API.md`,
  TypeScript declarations, a starter game, the guide's recipes as pages, and `check.mjs` (plays
  a page in a browser and fails on any error). `npm run build` also writes it to `dist/engine/`
  and `dist/engine.zip`.
- **Errors are reported, not just logged**: an exception in a game hook is caught, kept in
  `engine.errors` (and `state().errors`), shown in a box on screen, and the loop keeps running.
  A `setup()` that throws shows "Failed to start: ...".
- `Engine.start` sets `window.__PIXEL_ENGINE__` itself, so every page has the tooling handle
  (only this repo's `main.ts` used to set it); `dispose()` clears it.
- `withUrlOptions(options)`: a game's options with the URL's review flags on top (`?zoom=`
  keeps the game's camera preset, `?filters=` replaces its look).
- `ENGINE_VERSION`, `Engine.version`, `state().version`.
- Looks: filters per layer (characters & objects vs environment) with parameters and presets,
  38 named looks (`LOOK_PRESETS`) including `no_filters`, the `cel` and `adjust` filters.

## 0.1.0

The engine before versions: the WebGPU-first pixel pipeline with the WebGL 2 fallback, camera
presets, Rapier physics and triggers, `PlatformerCharacter` with the hero's moveset and clips,
audio, particles, the pixel HUD, the dynamic light pool, post filters and the agent tooling.
