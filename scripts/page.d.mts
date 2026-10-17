import type { ChildProcess } from 'node:child_process';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';

/** Software GL chatter from the rasterizer, not app output. */
export const ENVIRONMENT_NOISE: RegExp[];

export interface Server {
  port: number;
  /** `http://localhost:<port>/` */
  url: string;
  proc: ChildProcess;
  /** Stop the server (its whole process group); safe to call twice. */
  stop(): void;
}

/** Start vite (`dev`, or `preview` of dist/) on `port` with --strictPort; refuses a port that already answers (see page.mjs). */
export function startServer(o: { port: number; mode?: 'dev' | 'preview'; env?: Record<string, string>; probe?: string; timeout?: number; portEnv?: string }): Promise<Server>;

/** Collect a page's errors (and warnings, with `warnings`) as `error: …` / `pageerror: …` / `warning: …` lines. */
export function watchConsole(page: Page, o?: { warnings?: boolean; allow?: RegExp[]; fresh?: boolean }): string[];

/** Wait for window.__PIXEL_READY__; throws the start's reason if it rejects, or a clear error at the timeout. */
export function engineReady(page: Page, o?: { timeout?: number; logs?: string[] }): Promise<void>;

/** page.goto(url), then (unless `engine: false`) engineReady. */
export function gotoReady(page: Page, url: string, o?: { engine?: boolean; timeout?: number; logs?: string[] }): Promise<void>;

/** A new page with console errors collected, `url` opened and (unless `engine: false`) the engine ready. */
export function openPage(
  browser: Browser,
  url: string,
  o?: { engine?: boolean; timeout?: number; warnings?: boolean; allow?: RegExp[]; fresh?: boolean } & BrowserContextOptions,
): Promise<{ page: Page; logs: string[] }>;
