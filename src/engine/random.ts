/**
 * Seeded randomness. Everything random in a game comes from an `Rng`, so the same seed always
 * gives the same result (docs/DOCTRINE.md, principle 1). Each level gets one, `ctx.random`,
 * seeded from the engine's seed and the game's name; fork it by purpose so streams stay
 * independent of how many numbers each one drew:
 *
 *   const level = ctx.random.fork(`level:${n}`);
 *   const room = level.fork(`room:${i}`);   // independent of how many numbers `level` drew
 *
 * Never use Math.random in game or engine code (the lint refuses it).
 */
export class Rng {
  private s: number;

  constructor(seed: number | string) {
    this.s = typeof seed === 'number' ? seed >>> 0 || 0x9e3779b9 : hashString(seed);
  }

  /** Uniform in [0, 1). mulberry32. */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A child generator for one purpose; does not advance this one. */
  fork(purpose: string | number): Rng {
    return new Rng(hashString(`${this.s}:${purpose}`));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('Rng.pick: empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Pick by weight; entries with weight <= 0 never come up. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) throw new Error('Rng.weighted: no positive weights');
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1]!;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }

  /** Normal distribution (Box–Muller). */
  gaussian(mean = 0, sd = 1): number {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** FNV-1a, 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 0x9e3779b9;
}
