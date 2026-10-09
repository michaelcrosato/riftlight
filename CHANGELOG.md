# Changelog

What changed in Pixel Engine for a game built on it, newest first. The version is
`package.json`'s; a game reads it as `ENGINE_VERSION`, `Engine.version` or
`engine.state().version`. The engine kit (`npm run bundle`, docs/GUIDE.md) ships this file.

When a change alters the public API (`src/bundle.ts` exports) or something a game can see,
bump the version (minor while it is 0.x) and add its section here; `npm test` fails when
`package.json`'s version has no section.

## 0.3.0

- **Game feel**: `engine.timeScale` (slow motion, fast forward, 0 to freeze) scales game time
  for physics, animation, particles, tweens and the camera (at 0, presses are dropped like a
  pause); `engine.hitstop(seconds)` freezes the game for real seconds while rendering, shake and
  transitions go on. Both work with `engine.step()`; `loadGame` resets the speed.
- **Screen shake in the engine**: `engine.shake.add(trauma)` (`CameraShake`, trauma squared,
  deterministic), added to the camera after the rig, by whole art pixels on ortho presets.
- **Screen effects** (`engine.screen`, `render/screenFx.ts`): nine transitions (`TRANSITIONS`:
  fade, iris, diamonds, dissolve, dither, blinds, wipe, curtain, mosaic) with `cover`, `reveal`
  and `transition` (they resolve `true` when they ran to the end), a `flash`, and up to four
  `shockwave` rings. Uniforms at the end of every output graph: no shader compiles, every look,
  Pixel and Raw mode, almost free while nothing runs; real time and across `loadGame`.
  Colours are display colours (palette names or hex). `coversPixel` mirrors the patterns.
- **Tweens**: `ctx.tweens.to / value / call` with 22 eases (`EASES`, including stepped ones),
  yoyo, repeat, delays and takeover; on game time, cleared on unload (`done` resolves `false`).
- `engine.setSunDirection(dir)` and `engine.sunDir`: point the sun and its shadows (reset on
  unload).
- `input.preventKeys`: keys whose browser default is blocked (a game's F1 / Tab panels).
- `loadGame` also clears a TSL `scene.fogNode`, and a light with an unknown flicker preset is a
  steady light instead of a NaN that blacked out every lit pixel.
- The 5×7 font has `{ } ; & | \ ~ ^ $` and the backtick.
- `state()` reports `timeScale`, `hitstop` and `screen`.

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
