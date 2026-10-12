import { ModelCatalog } from '../catalog';
import { CONTAINERS } from './containers';
import { LIGHTING } from './lighting';
import { NATURE } from './nature';
import { TOWN } from './town';
import { WEAPONS } from './weapons';

/**
 * The engine's built-in models (src/engine/model/library/<family>.ts). Games add their own
 * (`MODEL_LIBRARY.add(def)`) or build a catalog on top of it; `npm run model -- find` lists them.
 */
export const MODEL_LIBRARY = new ModelCatalog([...CONTAINERS, ...LIGHTING, ...NATURE, ...TOWN, ...WEAPONS]);
