# Pixel Engine: index

A WebGPU-only 3D engine (`src/engine/`, public API in `src/engine/index.ts`) that renders 2D pixel
art. Read only the topic file you need. Stack and hard constraints: AGENTS.md.

| File | Answers |
| --- | --- |
| docs/engine/render.md | the pipeline contract: art resolution, aspect, quality, frame cap, draw calls, lost devices, toon materials (rim, dissolve), render-to-texture, mirrors, GPU compute, TSL materials, the sun |
| docs/engine/lights.md | `ctx.lights`: the fixed pool of point lights shared by any number of requests |
| docs/engine/looks.md | filters (art vs display space, parameters, presets) and per-layer looks |
| docs/engine/camera.md | camera presets, free → fixed workflow, `CameraConfig`, screen shake |
| docs/engine/character.md | `PlatformerCharacter`: the moveset, touch controls, states, tuning, hurt, teleport |
| docs/engine/game-api.md | `Game` and `Engine.start`, `loadGame` and unloading, `?game=` ids, shipping options, player settings, mouse picking, gamepads and press timing, game speed and hitstop |
| docs/engine/physics.md | triggers, movers and conveyors, force fields, joints, destruction, `InstancedBodies`, vehicles, bullets |
| docs/engine/physics-soft.md | cloth, ropes, jelly, ragdolls, water and buoyancy |
| docs/engine/audio.md | sound effects and songs as data, audio unlock, spatial sound and looping voices |
| docs/engine/effects.md | particles, the pixel HUD, weather and fog, grass, trails and decals, pixel sprites, screen transitions, tweens |
| docs/engine/ai.md | `NavGrid`, flow fields, boids, behaviour trees |
| docs/engine/cinematic.md | `Timeline` cutscenes |
| docs/engine/determinism.md | `ctx.random`, recording and replay, `ctx.input.send`, fingerprints, save-states, time rewind |
| docs/engine/procgen.md | noise, terrain and erosion, wave function collapse, L-systems |
| docs/engine/procedural-motion.md | spring chains, squash, leg steppers, two-bone IK |
| docs/engine/tooling.md | `window.__PIXEL_ENGINE__`, the CLIs, browser e2e, how to build an agent tool |
| docs/engine/kit.md | the engine kit for outside agents (`npm run bundle`), its diagnostics, build size |

Elsewhere: models and textures as data, docs/ASSETS.md; clips, foot IK and the animation tools,
docs/ANIMATION.md; Engine World, docs/WORLD.md; Riftlight, docs/GAME.md; principles and
escalation, docs/DOCTRINE.md.
