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
    if (!d) throw new Error(`no ${this.kind} "${id}" (${this.defs.size} known${this.tool ? `; find them with \`${this.tool} -- find\`; with the kit, LIBRARY.md` : ''})`);
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

  /** Defs ranked by how well they match `text`, best first (`searchDefs`). */
  search(text: string, o: SearchOptions = {}): T[] {
    return searchDefs(this.all(), text, o);
  }
}

export interface SearchOptions {
  /** Only defs with every one of these tags. */
  readonly tags?: readonly string[];
  /** At most this many (default: every match). */
  readonly limit?: number;
}

/** Lower-case words of letters and digits: `bookcaseClosed_wide-2` → bookcase, closed, wide, 2. */
export function searchWords(text: string): string[] {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** A word without its plural ending: trees → tree, benches → bench, berries → berry. */
export function stemWord(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(sh|ch|x|ss|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/**
 * The forms a word may take in a name: itself, `stemWord`'s, and the irregular plurals it can't
 * tell apart (shelves → shelf, knives → knife, cookies → cookie; stoves keeps stove).
 */
export function wordForms(w: string): string[] {
  const out = [w, stemWord(w)];
  if (w.length > 3 && w.endsWith('s')) out.push(w.slice(0, -1));
  if (w.length > 4 && w.endsWith('ves')) out.push(`${w.slice(0, -3)}f`, `${w.slice(0, -3)}fe`);
  return [...new Set(out)];
}

/**
 * Defs ranked by how well they match `text` (any order; plurals and partial words count), best
 * first. Each word scores most when it names a part of the id (4) or a tag (3), less in `about`
 * (2), least as the start (1) or the inside (0.5) of a longer word. Every word must match; when
 * no def matches them all, the defs matching the most words come back instead, so a search for
 * "oak tree stump" still finds the stumps. Empty text: every def (after `tags`). Ties keep the
 * defs' own order.
 */
export function searchDefs<T extends CatalogEntry>(defs: readonly T[], text: string, o: SearchOptions = {}): T[] {
  return searchHits(defs, text, o).map((h) => h.def);
}

/** One result of `searchHits`: the def, its score, and whether it matched every word. */
export interface SearchHit<T> {
  readonly def: T;
  readonly score: number;
  readonly full: boolean;
}

/** `searchDefs` with each def's score, and whether it matched every word (false: the fallback). */
export function searchHits<T extends CatalogEntry>(defs: readonly T[], text: string, o: SearchOptions = {}): SearchHit<T>[] {
  const pool = o.tags ? defs.filter((d) => o.tags!.every((t) => d.tags.includes(t))) : [...defs];
  const raw = searchWords(text);
  const words = [...new Set(raw.map(stemWord))].map((w) => ({ w, forms: [...new Set(raw.filter((x) => stemWord(x) === w).flatMap(wordForms))] }));
  const cut = <X>(xs: X[]) => (o.limit === undefined ? xs : xs.slice(0, o.limit));
  if (!words.length) return cut(pool.map((def) => ({ def, score: 0, full: true })));
  // each word of a name as it is and as `stemWord` makes it; a query word matches either
  const forms = (text: string) => new Set(searchWords(text).flatMap((x) => [x, stemWord(x)]));
  const scored = pool.map((def, order) => {
    const id = forms(def.id);
    const tags = forms(def.tags.join(' '));
    const about = forms(def.about);
    const all = [...id, ...tags, ...about];
    let score = 0;
    let matched = 0;
    for (const { w, forms: f } of words) {
      const has = (set: Set<string>) => f.some((x) => set.has(x));
      const s = has(id) ? 4 : has(tags) ? 3 : has(about) ? 2 : w.length >= 3 && all.some((x) => x.startsWith(w)) ? 1 : w.length >= 3 && all.some((x) => x.includes(w)) ? 0.5 : 0;
      score += s;
      if (s > 0) matched++;
    }
    return { def, score, matched, order };
  });
  const full = scored.filter((s) => s.matched === words.length);
  const hits = full.length ? full : scored.filter((s) => s.matched > 0);
  hits.sort((a, b) => b.matched - a.matched || b.score - a.score || a.order - b.order);
  return cut(hits.map((h) => ({ def: h.def, score: h.score, full: h.matched === words.length })));
}
