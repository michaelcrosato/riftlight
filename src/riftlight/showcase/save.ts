/**
 * What the showcase keeps in a save slot (`SaveData.showcase`): the arcade's records and the
 * bestiary (one entry per species the hero has killed, with the genome to rebuild it from).
 * Pure data and pure functions (no three.js), so the save module, the unit tests and node
 * tools can use it.
 *
 *   const sc = showcaseOf(save);                      // created on first use
 *   recordKill(sc.bestiary, genome, { name, rank, depth });
 *   recordArcadeRun(sc.arcade, { time, coins, total }); // → { best, reward }
 */
import type { Genome, SaveData } from '../core/types';
import type { Rank } from '../core/scaling';

/** One species in the bestiary: the first genome seen and how often it died. */
export interface BestiaryEntry {
  /** Species key (`speciesKey`): plan, archetype and parts; bosses by name. */
  key: string;
  name: string;
  rank: Rank;
  kills: number;
  /** Depth of the first and the latest kill. */
  first: number;
  last: number;
  genome: Genome;
}

export interface ArcadeRecord {
  /** Fastest finish in seconds (0 = never finished). */
  best: number;
  /** Most coins in one finished run. */
  coins: number;
  plays: number;
  clears: number;
  /** Gold the arcade has paid out, all time. */
  paid: number;
}

export interface ShowcaseSave {
  arcade: ArcadeRecord;
  bestiary: BestiaryEntry[];
  /** Children bred at the bestiary altar (a counter: every breed gets a fresh, reproducible seed). */
  bred: number;
}

/** Most species the save keeps (the least-killed normal ones make room; bosses stay). */
export const BESTIARY_LIMIT = 64;

/** Gold for a finished arcade run: a little for finishing, a coin per coin, more for a new best. */
export const ARCADE_REWARD = { finish: 10, perCoin: 1, newBest: 25 } as const;

export function emptyShowcase(): ShowcaseSave {
  return { arcade: { best: 0, coins: 0, plays: 0, clears: 0, paid: 0 }, bestiary: [], bred: 0 };
}

/** The save's showcase section, created on first use. */
export function showcaseOf(save: SaveData): ShowcaseSave {
  return (save.showcase ??= emptyShowcase());
}

/**
 * The species a genome belongs to: pack mates share a body shape (plan + parts) and an
 * archetype, so they count as one; bosses are one of a kind and go by name.
 */
export function speciesKey(g: Genome, name?: string): string {
  if (g.rank === 'boss' && name) return `boss:${name}`;
  const parts = g.parts
    .map((p) => `${p.socket}=${p.part}`)
    .sort()
    .join(',');
  return `${g.plan}:${g.archetype}:${parts}`;
}

/** Count a kill. Returns the entry (new or updated). */
export function recordKill(list: BestiaryEntry[], genome: Genome, o: { name: string; rank: Rank; depth: number }): BestiaryEntry {
  const key = speciesKey(genome, o.name);
  let e = list.find((x) => x.key === key);
  if (e) {
    e.kills++;
    e.last = o.depth;
    // a tougher specimen replaces the exhibit (a rare's elite glow beats a normal)
    if (RANK_ORDER[o.rank] > RANK_ORDER[e.rank]) {
      e.rank = o.rank;
      e.genome = genome;
      e.name = o.name;
    }
    return e;
  }
  e = { key, name: o.name, rank: o.rank, kills: 1, first: o.depth, last: o.depth, genome };
  list.push(e);
  if (list.length > BESTIARY_LIMIT) {
    // make room: the least-killed non-boss entry that is not the one just added
    let worst = -1;
    for (let i = 0; i < list.length; i++) {
      const x = list[i]!;
      if (x === e || x.rank === 'boss') continue;
      if (worst < 0 || x.kills < list[worst]!.kills) worst = i;
    }
    if (worst >= 0) list.splice(worst, 1);
  }
  return e;
}

const RANK_ORDER: Record<Rank, number> = { normal: 0, magic: 1, rare: 2, boss: 3 };

/** Exhibit order: bosses first (by depth), then by kills, most first. */
export function exhibitOrder(list: readonly BestiaryEntry[]): BestiaryEntry[] {
  return [...list].sort((a, b) => {
    const boss = Number(b.rank === 'boss') - Number(a.rank === 'boss');
    if (boss) return boss;
    if (a.rank === 'boss') return a.first - b.first;
    return b.kills - a.kills || a.first - b.first || a.key.localeCompare(b.key);
  });
}

/**
 * A finished arcade run: updates the record and returns the gold it pays and whether it was
 * a new best. `time` in seconds.
 */
export function recordArcadeRun(r: ArcadeRecord, run: { time: number; coins: number }): { reward: number; newBest: boolean } {
  r.clears++;
  const newBest = r.best <= 0 || run.time < r.best;
  if (newBest) r.best = +run.time.toFixed(3);
  r.coins = Math.max(r.coins, run.coins);
  const reward = ARCADE_REWARD.finish + ARCADE_REWARD.perCoin * run.coins + (newBest ? ARCADE_REWARD.newBest : 0);
  r.paid += reward;
  return { reward, newBest };
}

/** Clean a showcase section read from a save (any shape) into a valid one. */
export function sanitizeShowcase(raw: unknown): ShowcaseSave {
  const out = emptyShowcase();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const a = (r.arcade && typeof r.arcade === 'object' ? r.arcade : {}) as Record<string, unknown>;
  out.arcade = { best: num(a.best), coins: Math.floor(num(a.coins)), plays: Math.floor(num(a.plays)), clears: Math.floor(num(a.clears)), paid: Math.floor(num(a.paid)) };
  out.bred = Math.floor(num(r.bred));
  if (Array.isArray(r.bestiary)) {
    for (const e of r.bestiary as Record<string, unknown>[]) {
      const g = e?.genome as Genome | undefined;
      if (!e || typeof e.key !== 'string' || !g || typeof g !== 'object' || typeof g.plan !== 'string' || !Array.isArray(g.parts)) continue;
      const rank = (['normal', 'magic', 'rare', 'boss'] as const).includes(e.rank as Rank) ? (e.rank as Rank) : 'normal';
      out.bestiary.push({ key: e.key, name: typeof e.name === 'string' ? e.name : 'Unknown', rank, kills: Math.max(1, Math.floor(num(e.kills))), first: Math.floor(num(e.first)), last: Math.floor(num(e.last)), genome: g });
      if (out.bestiary.length >= BESTIARY_LIMIT) break;
    }
  }
  return out;
}
