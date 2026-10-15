/**
 * Node only (tests and tools): Riftlight's packs (packs.ts) read from `public/packs/` and added
 * to `MODEL_LIBRARY`, as `loadRiftlightPacks` does in the browser. Idempotent.
 */
import { readFileSync } from 'node:fs';
import { MODEL_LIBRARY, packCatalog, parsePack } from '../engine/model';
import { RIFTLIGHT_PACKS } from './packs';

const loaded = new Set<string>();

export function loadPacksSync(urls: readonly string[] = RIFTLIGHT_PACKS): void {
  for (const url of urls) {
    if (loaded.has(url)) continue;
    const file = new URL(`../../public/${url}`, import.meta.url);
    MODEL_LIBRARY.add(...packCatalog(parsePack(JSON.parse(readFileSync(file, 'utf8')) as unknown, url)).all());
    loaded.add(url);
  }
}
