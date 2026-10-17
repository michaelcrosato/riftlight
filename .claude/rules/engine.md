---
paths:
  - "src/engine/**"
  - "src/game/**"
  - "src/bundle.ts"
  - "scripts/bundle.mjs"
---
# Engine (auto-loaded when you open these files)

Must not break:
- WebGPU only, TSL only (docs/engine/render.md); version pins exact; no React or external engines.
- Gameplay state is plain, serializable data (docs/DOCTRINE.md principle 1): randomness from
  `ctx.random` / `Rng`, never `Math.random`; `Date.now()` / `performance.now()` only with a
  `// real time: <why>` comment (lint enforces both).
- Movement and forces in `fixedUpdate` (fixed 60 Hz); presentation in `update`. Pixel snapping is
  presentation only, never physics.
- Lights come from `ctx.lights`, never a runtime `PointLight`; colours from `PALETTE`.
- A change a game can see: export it from `src/engine/index.ts`, bump `package.json`'s version, add
  a `CHANGELOG.md` section. docs/GUIDE.md and docs/GUIDE-ASSETS.md ship in the kit; their named
  code blocks are pinned by `src/guide.test.ts` / `src/guide-assets.test.ts`.

Docs for a folder (read the one you need; docs/ENGINE.md is the index):
- `render/` → docs/engine/render.md, `render/lights.ts` → lights.md, `render/filters.ts`, `look.ts` → looks.md
- `camera.ts`, `shake.ts` → camera.md · `character/` → character.md · `physics/` → physics.md, physics-soft.md
- `audio/` → audio.md · `particles/`, `hud/`, sky, grass, trails, sprites, `screenFx`, `tween.ts` → effects.md
- `ai/` → ai.md · `cinematic/` → cinematic.md · `procgen/` → procgen.md · `random.ts`, `replay.ts`,
  `snapshot.ts`, `physics/rewind.ts` → determinism.md
- `Engine.ts`, `input.ts`, `lifecycle.ts`, `settings.ts`, `clock.ts` → game-api.md
- `animation/procedural.ts` → procedural-motion.md; the rest of `animation/` → docs/ANIMATION.md
- `render/headlessView.ts`, `render/view.ts`, `node.ts`, `Engine.headless` → headless.md
- `inspect/` → tooling.md · `model/`, `texture/` → docs/ASSETS.md · `src/bundle.ts` → kit.md
