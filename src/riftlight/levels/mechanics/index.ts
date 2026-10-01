import { Registry } from '../../core/registry';
import type { Rng } from '../../core/rng';
import { BLOODMOON } from './bloodmoon';
import { COLLAPSE } from './collapse';
import { ECHOES } from './echoes';
import { EMBERS } from './embers';
import { FROSTGLASS } from './frostglass';
import { GALE } from './gale';
import { GLOOM } from './gloom';
import { GRAVEWELL } from './gravewell';
import { MIRE } from './mire';
import { RIFTGATES } from './riftgates';
import { STORMSPIRE } from './stormspire';
import { THORNWEAVE } from './thornweave';
import type { LevelMechanicDef } from './types';

/**
 * The 12 level mechanics, in designed-level order (level N introduces MECHANIC_ORDER[N-1]).
 * Add a mechanic by writing a `LevelMechanicDef` (see docs/GAME.md, "Levels, mechanics &
 * lighting") and adding it here; rifts pick it up automatically.
 */
export const MECHANIC_ORDER = ['embers', 'gloom', 'gale', 'frostglass', 'thornweave', 'stormspire', 'mire', 'echoes', 'riftgates', 'bloodmoon', 'gravewell', 'collapse'] as const;

export const MECHANICS = new Registry<LevelMechanicDef>('mechanic', [EMBERS, GLOOM, GALE, FROSTGLASS, THORNWEAVE, STORMSPIRE, MIRE, ECHOES, RIFTGATES, BLOODMOON, GRAVEWELL, COLLAPSE]);

/** True when `a` and `b` may share a level (either side's `excludes` forbids it). */
export function compatible(a: string, b: string): boolean {
  if (a === b) return false;
  const da = MECHANICS.get(a);
  const db = MECHANICS.get(b);
  return !(da.excludes?.includes(b) || db.excludes?.includes(a));
}

/** All pairwise compatible. */
export function compatibleSet(ids: readonly string[]): boolean {
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (!compatible(ids[i]!, ids[j]!)) return false;
  return true;
}

/** Pick `n` mutually compatible mechanics by weight (rifts). */
export function pickCompatible(rng: Rng, n: number, required: readonly string[] = []): string[] {
  const out = [...required];
  const pool = MECHANICS.all().filter((m) => !out.includes(m.id));
  while (out.length < n) {
    const ok = pool.filter((m) => out.every((o) => compatible(o, m.id)));
    if (!ok.length) break;
    const m = rng.weighted(ok, (e) => e.weight ?? 1);
    out.push(m.id);
    pool.splice(pool.indexOf(m), 1);
  }
  return out;
}

export { BLOODMOON, COLLAPSE, ECHOES, EMBERS, FROSTGLASS, GALE, GLOOM, GRAVEWELL, MIRE, RIFTGATES, STORMSPIRE, THORNWEAVE };
export type { LevelMechanicDef } from './types';
