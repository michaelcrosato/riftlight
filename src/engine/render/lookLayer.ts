/**
 * Which look layer an object is on (render/look.ts): `actors` (characters and objects) or
 * `environment` (everything untagged). Kept free of rendering imports, so gameplay code
 * and headless simulations can tag objects without pulling in shaders.
 */
import type { Object3D } from 'three/webgpu';

/** The two parts of a frame that can carry their own look. */
export type LookLayer = 'actors' | 'environment';

/** userData key holding an object's layer. */
export const LOOK_LAYER_KEY = 'lookLayer';

/**
 * Put an object (and everything under it that has no layer of its own) on a look layer.
 * Untagged objects are environment. Tag a character's root once: parts attached later
 * (weapons, effects) follow it.
 */
export function setLookLayer(object: Object3D, layer: LookLayer): void {
  object.userData[LOOK_LAYER_KEY] = layer;
}

/** The look layer of an object: its own tag or its nearest tagged ancestor's, else environment. */
export function lookLayerOf(object: Object3D): LookLayer {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const l = o.userData[LOOK_LAYER_KEY] as LookLayer | undefined;
    if (l !== undefined) return l;
  }
  return 'environment';
}
