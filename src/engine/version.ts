/**
 * The engine's version: package.json's, injected at build time (`vite.config.ts` `define`).
 * `dev` where nothing injects it (scripts run through tsx).
 */
declare const __ENGINE_VERSION__: string | undefined;

export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ === 'string' ? __ENGINE_VERSION__ : 'dev';
