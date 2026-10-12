/**
 * Defs by id: the engine's built-in libraries (`MODEL_LIBRARY`, `TEXTURE_LIBRARY`) and a game's
 * own. Ids are how parts, layers and saves refer to defs, so an id names one def per catalog.
 */
export interface CatalogEntry {
  readonly id: string;
  readonly about: string;
  readonly tags: readonly string[];
}

export class Catalog<T extends CatalogEntry> {
  private readonly defs = new Map<string, T>();

  /** `kind` names the defs in messages ("model", "texture"); `tool` is the CLI that finds them. */
  constructor(
    defs: readonly T[] = [],
    private readonly kind = 'def',
    private readonly tool = '',
  ) {
    this.add(...defs);
  }

  /** Add defs; an id that is already taken throws. */
  add(...defs: readonly T[]): this {
    for (const d of defs) {
      if (this.defs.has(d.id) && this.defs.get(d.id) !== d) throw new Error(`${this.kind} id "${d.id}" is already in this catalog`);
      this.defs.set(d.id, d);
    }
    return this;
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  get(id: string): T {
    const d = this.defs.get(id);
    if (!d) throw new Error(`no ${this.kind} "${id}" (${this.defs.size} known${this.tool ? `; find them with \`${this.tool} -- find\`` : ''})`);
    return d;
  }

  all(): T[] {
    return [...this.defs.values()];
  }

  /** Defs with every tag in `tags` whose id, about or tags contain every word of `text`. */
  find(q: { tags?: readonly string[]; text?: string } = {}): T[] {
    const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return this.all().filter((d) => {
      if (q.tags && !q.tags.every((t) => d.tags.includes(t))) return false;
      const hay = `${d.id} ${d.about} ${d.tags.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
}
