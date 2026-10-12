import { TextureCatalog } from '../catalog';
import { setDefaultTextureCatalog } from '../convert';
import { SPRITES } from './sprites';
import { SURFACES } from './surfaces';

/**
 * The engine's built-in textures (src/engine/texture/library/<family>.ts). Games add their own
 * (`TEXTURE_LIBRARY.add(def)`) or build a catalog of their own; `npm run tex -- find` lists them.
 */
export const TEXTURE_LIBRARY = new TextureCatalog([...SURFACES, ...SPRITES]);
setDefaultTextureCatalog(TEXTURE_LIBRARY);
