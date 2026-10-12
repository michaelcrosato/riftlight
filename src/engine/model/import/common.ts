/**
 * What the importers (mesh and 2D) share, in a module of its own so the 2D importer can use it
 * without pulling in three's `GLTFLoader`: their error and the ids they take.
 */

/** A file the importer can't read, with what is wrong and what to do. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Ids an import may take (`chair`, `kit/chair`): they name files, so nothing else. */
export const IMPORT_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/;
