import { ModelCatalog } from '../catalog';
import { ARCHITECTURE } from './architecture';
import { CONTAINERS } from './containers';
import { DRESSING } from './dressing';
import { DUNGEON } from './dungeon';
import { FURNITURE } from './furniture';
import { LIGHTING } from './lighting';
import { NATURE } from './nature';
import { PROPS } from './props';
import { TOWN } from './town';
import { WEAPONS } from './weapons';

/**
 * The engine's built-in models (src/engine/model/library/<family>.ts). Games add their own
 * (`MODEL_LIBRARY.add(def)`) or build a catalog on top of it; `npm run model -- find` lists them.
 */
export const MODEL_LIBRARY = new ModelCatalog([...ARCHITECTURE, ...CONTAINERS, ...DRESSING, ...DUNGEON, ...FURNITURE, ...LIGHTING, ...NATURE, ...PROPS, ...TOWN, ...WEAPONS]);

/**
 * The library's families (one file each, src/engine/model/library/<family>.ts) in order: each
 * family's model ids. Browse by family (the Asset Gallery's shelves, LIBRARY.md's sections).
 */
export const MODEL_FAMILIES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries({ architecture: ARCHITECTURE, containers: CONTAINERS, dressing: DRESSING, dungeon: DUNGEON, furniture: FURNITURE, lighting: LIGHTING, nature: NATURE, props: PROPS, town: TOWN, weapons: WEAPONS }).map(([family, defs]) => [family, defs.map((d) => d.id)]),
);
