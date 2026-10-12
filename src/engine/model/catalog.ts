import { Catalog } from '../catalog';
import type { ModelDef } from './types';

/**
 * Models by id: the engine's built-in library (`MODEL_LIBRARY`) or a game's own. `use` parts
 * and `buildModel('id')` resolve ids through one (the library unless a build passes another);
 * a game adds its models to the library, or builds a catalog of its own on top of it.
 */
export class ModelCatalog extends Catalog<ModelDef> {
  constructor(defs: readonly ModelDef[] = []) {
    super(defs, 'model', 'npm run model');
  }
}
