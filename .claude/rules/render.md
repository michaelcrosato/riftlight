---
paths:
  - "src/engine/render/**"
  - "src/engine/camera.ts"
  - "src/engine/framing.ts"
  - "src/engine/shake.ts"
  - "src/engine/quality.ts"
  - "scripts/forbidden-apis.mjs"
---
# Rendering (auto-loaded when you open these files)

Must not break (`npm run lint` runs `scripts/forbidden-apis.mjs`):
- One `WebGPURenderer` and one `RenderPipeline` (`PixelRenderer`), WebGPU only: no WebGL 2
  fallback; without WebGPU, `PixelRenderer.create` throws `NO_WEBGPU`.
- No `WebGLRenderer`, `EffectComposer`, `ShaderPass`, `RenderPixelatedPass`, `(Raw)ShaderMaterial`,
  `onBeforeCompile`, GLSL, bare `'three'` imports or WebGL post-processing addons. All shader logic
  is TSL (`three/tsl`); import three from `three/webgpu`.
- Pixel snapping is camera/presentation only, never physics (Rapier bodies are never snapped).
- Art-pixel work runs at the art resolution, upscaled once; only `display` filters run per device pixel.
- Changing a light, look parameter or screen effect must not recompile shaders: uniforms, fixed
  light pool, cached graphs. `renderer.gpuErrors` stays empty.
- Look at frames, not only numbers: `renderer.capture()`, `npm run film`, e2e frames in `.scratch/e2e/`.

Docs: pipeline, materials, render-to-texture, mirrors → docs/engine/render.md; `lights.ts` →
docs/engine/lights.md; `filters.ts`, `look.ts` → docs/engine/looks.md; `camera.ts`, `shake.ts` →
docs/engine/camera.md; `screenFx.ts`, particles, sky, grass, trails, sprites → docs/engine/effects.md.
