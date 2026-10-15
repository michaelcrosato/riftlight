/**
 * Chromium for the agent tools (the e2e suites, film, playtest, gate-b): WebGPU, the engine's
 * only renderer, in headless Chromium, with no display (docs/DOCTRINE.md, principle 6). With
 * these flags any Chromium keeps a WebGPU device on SwiftShader's Vulkan and presents frames
 * headless; the flags the suites used before (no ANGLE on SwiftShader) lost the device as soon as
 * a canvas presented (issue #46), which is why they ran headful under Xvfb. The headless shell
 * (Playwright's `chromium-headless-shell`, its old headless mode) is the lightest, 1.6-3.5 times
 * faster than the full browser; `CHROMIUM_PATH` still picks another. `renderer.capture()` reads
 * frames back (a page screenshot can't see a WebGPU canvas).
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

/** WebGPU on SwiftShader's Vulkan; ANGLE on SwiftShader too, which the shell needs to present. */
export const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'];

/** A browser without WebGPU (the e2e `no-webgpu` suite: the engine says it needs it). */
export const WEBGL_ARGS = ['--disable-features=WebGPU', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/**
 * The browser's executable: `CHROMIUM_PATH` if set, else the headless shell this Playwright
 * installed (`npx playwright-core install chromium`), where Playwright itself says it is, if it is
 * there; else undefined, and Playwright launches its own.
 */
export function headlessShell() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const path = createRequire(import.meta.url)('playwright-core/lib/server').registry.findExecutable('chromium-headless-shell')?.executablePath();
    if (path && existsSync(path)) return path;
  } catch {
    /* an older or newer Playwright without that registry: let it find its own */
  }
  return undefined;
}

/** Launch the headless shell with WebGPU, plus any `args`. */
export function launchChromium({ args = [] } = {}) {
  return chromium.launch({ executablePath: headlessShell(), headless: true, args: [...WEBGPU_ARGS, ...args] });
}
