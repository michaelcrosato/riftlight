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
