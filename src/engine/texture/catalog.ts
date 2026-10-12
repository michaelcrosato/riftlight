import { Catalog } from '../catalog';
import type { TextureDef } from './types';

/** Textures by id: the built-in `TEXTURE_LIBRARY` or a game's own (as `ModelCatalog` is for models). */
export class TextureCatalog extends Catalog<TextureDef> {
  constructor(defs: readonly TextureDef[] = []) {
    super(defs, 'texture', 'npm run tex');
  }
}
