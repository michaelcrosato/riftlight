import type { ModelDef } from './types';

/**
 * Models by id: the engine's built-in library (`MODEL_LIBRARY`) or a game's own. `use` parts
 * and `buildModel('id')` resolve ids through one (the library unless a build passes another);
 * a game adds its models to the library, or builds a catalog of its own on top of it.
 */
export class ModelCatalog {
  private readonly defs = new Map<string, ModelDef>();

  constructor(defs: readonly ModelDef[] = []) {
    this.add(...defs);
  }

  /** Add models; an id that is already taken throws (ids are how parts and saves refer to them). */
  add(...defs: readonly ModelDef[]): this {
    for (const d of defs) {
      if (this.defs.has(d.id) && this.defs.get(d.id) !== d) throw new Error(`model id "${d.id}" is already in this catalog`);
      this.defs.set(d.id, d);
    }
    return this;
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get(id: string): ModelDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(`no model "${id}" (${this.defs.size} known; find them with \`npm run model -- find\`)`);
    return d;
  }

  all(): ModelDef[] {
    return [...this.defs.values()];
  }

  /** Models with every tag in `tags` whose id, about or tags contain every word of `text`. */
  find(q: { tags?: readonly string[]; text?: string } = {}): ModelDef[] {
    const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return this.all().filter((d) => {
      if (q.tags && !q.tags.every((t) => d.tags.includes(t))) return false;
      const hay = `${d.id} ${d.about} ${d.tags.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
}
