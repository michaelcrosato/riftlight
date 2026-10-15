import type { Browser } from 'playwright-core';

/** WebGPU on SwiftShader's Vulkan; ANGLE on SwiftShader too, which the shell needs to present. */
export const WEBGPU_ARGS: string[];

/** A browser without WebGPU (the e2e `no-webgpu` suite: the engine says it needs it). */
export const WEBGL_ARGS: string[];

/** The browser's executable: CHROMIUM_PATH, else Playwright's own headless shell if installed (see browser.mjs). */
export function headlessShell(): string | undefined;

/** Launch the headless shell with WebGPU, plus any `args`. */
export function launchChromium(o?: { args?: string[] }): Promise<Browser>;
