/** Shorthands for writing tree content as data (clusters, notables). */
import type { Mod } from '../../core/mods';
import type { ClusterTemplate, NotableDef } from '../types';

/** A notable: N(id, name, mods, flavour). Ids are global (the node id is `n:<id>`). */
export const N = (id: string, name: string, mods: readonly Mod[], flavour: string, lines?: readonly string[]): NotableDef => ({
  id,
  name,
  mods,
  flavour,
  ...(lines ? { lines } : {}),
});

/** A cluster template (identity function, for type checking and readable data). */
export const T = (t: ClusterTemplate): ClusterTemplate => t;
