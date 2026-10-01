/**
 * Run progression the shell owns: XP and character level, gold, the deepest depth, the
 * death penalty and per-slot stats. Pure functions over SaveData so they are unit-tested
 * and the bot / agent API can reason about them.
 */
import { SCALING } from '../core/scaling';
import type { SaveData, SaveStats } from '../core/types';

/** Designed levels; deeper is a rift. */
export const DESIGNED_LEVELS = 12;
export const MAX_LEVEL = 100;

/**
 * Death penalty (tunable): a share of the progress into the current level's XP and of the
 * gold carried. You never lose a level.
 */
export const DEATH_PENALTY = { xp: 0.1, gold: 0.15 } as const;

export function emptyStats(): SaveStats {
  return { runs: 0, clears: 0, deaths: 0, kills: 0, playtime: 0, best: {} };
}

/** Add XP; returns the levels gained (0 when none). Mutates `hero`. */
export function addXp(hero: SaveData['hero'], amount: number): number {
  if (!(amount > 0)) return 0;
  hero.xp += Math.round(amount);
  let gained = 0;
  while (hero.level < MAX_LEVEL && hero.xp >= SCALING.xpToNext(hero.level)) {
    hero.xp -= SCALING.xpToNext(hero.level);
    hero.level++;
    gained++;
  }
  if (hero.level >= MAX_LEVEL) hero.xp = 0;
  return gained;
}

/** 0..1 progress into the current level. */
export function xpFraction(hero: SaveData['hero']): number {
  if (hero.level >= MAX_LEVEL) return 1;
  return Math.min(1, Math.max(0, hero.xp / SCALING.xpToNext(hero.level)));
}

/**
 * XP for a kill of a monster of `level` and `rank` multiplier; with the killer's level, a
 * hero who has outlevelled the area gets less (`SCALING.xpPenalty`).
 */
export function killXp(monsterLevel: number, rankXp: number, heroLevel?: number): number {
  const penalty = heroLevel === undefined ? 1 : SCALING.xpPenalty(heroLevel, monsterLevel);
  return Math.round(SCALING.monsterXp(monsterLevel) * rankXp * penalty);
}

export interface Penalty {
  xp: number;
  gold: number;
}

/** What dying costs right now (not applied). */
export function deathPenalty(save: SaveData): Penalty {
  return { xp: Math.floor(save.hero.xp * DEATH_PENALTY.xp), gold: Math.floor(save.hero.gold * DEATH_PENALTY.gold) };
}

/** Apply the death penalty; returns what was lost. */
export function applyDeath(save: SaveData): Penalty {
  const p = deathPenalty(save);
  save.hero.xp -= p.xp;
  save.hero.gold -= p.gold;
  const stats = (save.stats ??= emptyStats());
  stats.deaths++;
  return p;
}

/** Record a cleared depth: deepest and best time. Returns true on a new deepest. */
export function recordClear(save: SaveData, depth: number, seconds: number): boolean {
  const stats = (save.stats ??= emptyStats());
  stats.clears++;
  const key = String(depth);
  const best = stats.best[key];
  if (best === undefined || seconds < best) stats.best[key] = Math.round(seconds * 10) / 10;
  if (depth > save.deepest) {
    save.deepest = depth;
    return true;
  }
  return false;
}

/** Depths the rift keeper offers: every cleared depth plus the next one. */
export function unlockedDepths(save: SaveData): number[] {
  return Array.from({ length: save.deepest + 1 }, (_, i) => i + 1);
}

export function isRift(depth: number): boolean {
  return depth > DESIGNED_LEVELS;
}

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n: number): string {
  let out = '';
  let v = Math.max(1, Math.floor(n));
  for (const [k, s] of ROMAN) while (v >= k) {
    out += s;
    v -= k;
  }
  return out;
}

/** "III · GALE" for designed levels, "RIFT 37 · FROSTGLASS GRAVEWELL" after. */
export function levelTitle(depth: number, name: string): string {
  return isRift(depth) ? `RIFT ${depth} · ${name.toUpperCase()}` : `${roman(depth)} · ${name.toUpperCase()}`;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
