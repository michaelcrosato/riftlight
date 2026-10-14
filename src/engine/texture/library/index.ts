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

/** The texture library's families (src/engine/texture/library/<family>.ts): each one's texture ids. */
export const TEXTURE_FAMILIES: Readonly<Record<string, readonly string[]>> = { surfaces: SURFACES.map((d) => d.id), sprites: SPRITES.map((d) => d.id) };
