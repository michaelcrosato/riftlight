import type { Rng } from './rng';

/**
 * A registry of tagged content entries. Every kind of content in Riftlight lives in one:
 * affixes, skills, passive nodes, monster parts, archetypes, mechanics, themes...
 * Generators query by tags and pick by weight; they never name entries, so adding
 * content is adding an entry.
 */
export interface Entry {
  readonly id: string;
  readonly tags?: readonly string[];
  /** Relative pick weight (default 1). 0 = never picked at random, still gettable by id. */
  readonly weight?: number;
}

export interface Query {
  /** Every one of these tags. */
  all?: readonly string[];
  /** At least one of these tags. */
  any?: readonly string[];
  /** None of these tags. */
  none?: readonly string[];
  filter?: (e: Entry) => boolean;
}

export class Registry<T extends Entry> {
  private readonly byId = new Map<string, T>();

  constructor(
    readonly kind: string,
    entries: readonly T[] = [],
  ) {
    for (const e of entries) this.add(e);
  }

  add(entry: T): this {
    if (this.byId.has(entry.id)) throw new Error(`${this.kind}: duplicate id "${entry.id}"`);
    this.byId.set(entry.id, entry);
    return this;
  }

  get(id: string): T {
    const e = this.byId.get(id);
    if (!e) throw new Error(`${this.kind}: no entry "${id}"`);
    return e;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): T[] {
    return [...this.byId.values()];
  }

  query(q: Query = {}): T[] {
    return this.all().filter((e) => matches(e, q));
  }

  /** A weighted random pick among entries matching `q`. */
  pick(rng: Rng, q: Query = {}, weight: (e: T) => number = (e) => e.weight ?? 1): T {
    const found = this.query(q);
    if (!found.length) throw new Error(`${this.kind}: nothing matches ${JSON.stringify({ ...q, filter: q.filter ? 'fn' : undefined })}`);
    return rng.weighted(found, weight);
  }

  /** Up to `n` distinct weighted picks. */
  pickMany(rng: Rng, n: number, q: Query = {}, weight: (e: T) => number = (e) => e.weight ?? 1): T[] {
    const pool = this.query(q).filter((e) => weight(e) > 0);
    const out: T[] = [];
    while (out.length < n && pool.length) {
      const e = rng.weighted(pool, weight);
      out.push(e);
      pool.splice(pool.indexOf(e), 1);
    }
    return out;
  }

  get size(): number {
    return this.byId.size;
  }
}

export function matches(e: Entry, q: Query): boolean {
  const tags = e.tags ?? [];
  if (q.all && !q.all.every((t) => tags.includes(t))) return false;
  if (q.any && !q.any.some((t) => tags.includes(t))) return false;
  if (q.none && q.none.some((t) => tags.includes(t))) return false;
  if (q.filter && !q.filter(e)) return false;
  return true;
}
