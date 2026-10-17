/**
 * Node only (tests and tools): Riftlight's packs (packs.ts) read from `public/packs/` and added
 * to `MODEL_LIBRARY`, as `loadRiftlightPacks` does in the browser. Idempotent, and the same defs as
 * `loadPack` gives (a headless Riftlight loads them that way): one parse per pack (`settlePack`).
 */
import { readFileSync } from 'node:fs';
import { parsedPack, settlePack } from '../engine/assets';
import { MODEL_LIBRARY } from '../engine/model';
import { RIFTLIGHT_PACKS } from './packs';

export function loadPacksSync(urls: readonly string[] = RIFTLIGHT_PACKS): void {
  for (const url of urls) {
    const read = () => JSON.parse(readFileSync(new URL(`../../public/${url}`, import.meta.url), 'utf8')) as unknown;
    MODEL_LIBRARY.add(...(parsedPack(url) ?? settlePack(url, read())).models.all());
  }
}
