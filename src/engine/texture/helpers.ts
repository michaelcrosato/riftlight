import type { TextureDef } from './types';

/**
 * Returns the def as written, typed, so tuples and literals don't widen (as `model` does). Not
 * `texture`: TSL's `texture()` samples a map, and games import both.
 */
export function textureDef<const T extends TextureDef>(def: T): T {
  return def;
}
