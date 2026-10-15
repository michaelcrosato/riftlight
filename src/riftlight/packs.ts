/**
 * The imported packs (docs/ASSETS.md, *Importing*) Riftlight builds with: Emberfall's outskirts
 * (town/outskirts.ts) and the level props' variants (levels/themes/props.ts) name their models
 * (`kenney-nature/tree-oak`), so the packs join `MODEL_LIBRARY` before the town or a level is built
 * (`Riftlight.setup`, the level lab). They load at runtime, never
 * bundled; the single-file build embeds what the game uses of them (scripts/build-single.mjs finds
 * the `packs/<id>.json` paths below in the built code, so keep them literal). Node tests and tools
 * load them from `public/packs/` with `loadPacksSync` (nodePacks.ts).
 */
import { loadPack } from '../engine/assets';
import { MODEL_LIBRARY } from '../engine/model';

export const RIFTLIGHT_PACKS = ['packs/kenney-castle.json', 'packs/kenney-nature.json', 'packs/kenney-furniture.json', 'packs/kenney-mini-dungeon.json'] as const;

/**
 * Every pack Riftlight uses, into `MODEL_LIBRARY` (each fetched once; again is free). One that
 * fails to load is left out with a warning, and the game goes on without its models (the town
 * leaves them out, a level prop wears its own): the URLs of those that failed.
 */
export async function loadRiftlightPacks(): Promise<string[]> {
  const loaded = await Promise.allSettled(RIFTLIGHT_PACKS.map((url) => loadPack(url, { into: MODEL_LIBRARY })));
  const failed = RIFTLIGHT_PACKS.filter((_, i) => loaded[i]!.status === 'rejected');
  for (const url of failed) console.warn(`[riftlight] pack ${url} did not load; going on without its models`, (loaded[RIFTLIGHT_PACKS.indexOf(url)] as PromiseRejectedResult).reason);
  return failed;
}
