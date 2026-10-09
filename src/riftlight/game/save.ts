/**
 * Save slots in localStorage, versioned, every access in try/catch (private windows,
 * blocked storage and quota errors fall back to memory for the session).
 *
 *   riftlight:slot:<n>   { format: 'riftlight-save', version, slot, savedAt, data: SaveData }
 *   riftlight:meta       { last: <slot> }
 *
 * Versioning: `SAVE_VERSION` is the SaveData shape this build writes. `migrate()` upgrades
 * anything older step by step (v0 = pre-release saves without a version), fills fields a
 * save lacks with defaults, and refuses saves from a newer build instead of mangling them.
 * Export / import use the same envelope as JSON text, so a save can move between machines.
 */
import type { SaveData } from '../core/types';
import { NORMAL, sanitizeTuning } from './difficulty';
import { emptyStats } from './progress';
import { sanitizeShowcase } from '../showcase/save';

export const SAVE_VERSION = 1;
export const SAVE_FORMAT = 'riftlight-save';
export const SLOT_COUNT = 3;
const KEY = (slot: number) => `riftlight:slot:${slot}`;
const META = 'riftlight:meta';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  slot: number;
  /** ms since epoch */
  savedAt: number;
  data: SaveData;
}

/** A slot as the title screen lists it. */
export interface SlotSummary {
  slot: number;
  empty: boolean;
  level: number;
  deepest: number;
  gold: number;
  savedAt: number;
  playtime: number;
  /** Unreadable or from a newer build. */
  error?: string;
}

/** The storage this module needs (window.localStorage or a test double). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function newSave(seed: number): SaveData {
  return {
    version: 1,
    hero: { level: 1, xp: 0, gold: 0, allocated: [], equipment: {}, inventory: [], skills: [] },
    stash: [],
    deepest: 0,
    difficulty: { ...NORMAL },
    seed: seed >>> 0,
    settings: {},
    codex: [],
    stats: emptyStats(),
  };
}

/** Upgrade any older (or partial) save to the current shape. Throws on newer or garbage. */
export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a save');
  const r = raw as Record<string, unknown>;
  if (!r.hero || typeof r.hero !== 'object') throw new Error('not a save (no hero)');
  const version = typeof r.version === 'number' ? r.version : 0;
  if (version > SAVE_VERSION) throw new Error(`save is from a newer version (v${version}; this build reads up to v${SAVE_VERSION})`);
  const base = newSave(typeof r.seed === 'number' ? r.seed : 1);
  // v0 → v1: pre-release saves kept gold at the top level and had no difficulty.
  const heroIn = (r.hero && typeof r.hero === 'object' ? r.hero : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : d);
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const hero: SaveData['hero'] = {
    level: Math.min(100, Math.floor(num(heroIn.level, 1, 1))),
    xp: Math.floor(num(heroIn.xp, 0)),
    gold: Math.floor(num(heroIn.gold, num(r.gold, 0))),
    allocated: arr<string>(heroIn.allocated).filter((s) => typeof s === 'string'),
    equipment: heroIn.equipment && typeof heroIn.equipment === 'object' ? (heroIn.equipment as SaveData['hero']['equipment']) : {},
    inventory: arr(heroIn.inventory),
    skills: arr(heroIn.skills),
  };
  const statsIn = (r.stats && typeof r.stats === 'object' ? r.stats : {}) as Record<string, unknown>;
  const stats = emptyStats();
  for (const k of ['runs', 'clears', 'deaths', 'kills', 'playtime'] as const) stats[k] = num(statsIn[k], 0);
  if (statsIn.best && typeof statsIn.best === 'object') for (const [k, v] of Object.entries(statsIn.best)) if (typeof v === 'number') stats.best[k] = v;
  return {
    ...base,
    hero,
    stash: arr(r.stash),
    deepest: Math.floor(num(r.deepest, 0)),
    difficulty: sanitizeTuning(r.difficulty),
    settings: r.settings && typeof r.settings === 'object' ? (r.settings as Record<string, unknown>) : {},
    codex: arr<string>(r.codex).filter((s) => typeof s === 'string'),
    stats,
    // grid cells of the inventory and stash (loot keeps items where the player put them)
    ...(r.positions && typeof r.positions === 'object' && !Array.isArray(r.positions) ? { positions: r.positions as NonNullable<SaveData['positions']> } : {}),
    // the showcase's records (arcade times, the bestiary), cleaned
    ...(r.showcase ? { showcase: sanitizeShowcase(r.showcase) } : {}),
  };
}

/** Text for an export file. */
export function exportSave(data: SaveData, slot: number, now = Date.now()): string { // real time: the save's timestamp
  const env: SaveEnvelope = { format: SAVE_FORMAT, version: SAVE_VERSION, slot, savedAt: now, data };
  return JSON.stringify(env, null, 1);
}

/** Parse an export (an envelope, or a bare SaveData). Throws with a readable message. */
export function parseSave(text: string): SaveData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not JSON');
  }
  const env = raw as Partial<SaveEnvelope> | null;
  if (env && typeof env === 'object' && env.format === SAVE_FORMAT) {
    if (typeof env.version === 'number' && env.version > SAVE_VERSION) throw new Error(`save is from a newer version (v${env.version})`);
    return migrate(env.data);
  }
  return migrate(raw);
}

export class SaveStore {
  private readonly memory = new Map<string, string>();
  /** Last storage error (shown in the slots menu), or ''. */
  lastError = '';

  constructor(private readonly storage: KeyValueStore | null = defaultStorage()) {}

  /** True when saves only live for this session (storage blocked or `?save=memory`). */
  get volatile(): boolean {
    return this.storage === null;
  }

  private read(key: string): string | null {
    if (this.storage) {
      try {
        return this.storage.getItem(key);
      } catch (e) {
        this.lastError = String(e);
      }
    }
    return this.memory.get(key) ?? null;
  }

  private write(key: string, value: string): boolean {
    this.memory.set(key, value); // a session copy, whatever happens below
    if (!this.storage) return true;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch (e) {
      this.lastError = String(e);
      return false;
    }
  }

  private delete(key: string): void {
    this.memory.delete(key);
    try {
      this.storage?.removeItem(key);
    } catch (e) {
      this.lastError = String(e);
    }
  }

  load(slot: number): SaveData | null {
    const text = this.read(KEY(slot));
    if (!text) return null;
    try {
      return parseSave(text);
    } catch (e) {
      this.lastError = `slot ${slot + 1}: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }
  }

  save(slot: number, data: SaveData, now = Date.now()): boolean { // real time: the save's timestamp
    const ok = this.write(KEY(slot), exportSave(data, slot, now));
    this.write(META, JSON.stringify({ last: slot }));
    return ok;
  }

  remove(slot: number): void {
    this.delete(KEY(slot));
  }

  /** The slot played last (for Continue), or null. */
  lastSlot(): number | null {
    try {
      const meta = JSON.parse(this.read(META) ?? 'null') as { last?: unknown } | null;
      const last = meta?.last;
      if (typeof last === 'number' && last >= 0 && last < SLOT_COUNT && this.read(KEY(last))) return last;
    } catch {
      /* corrupt meta: fall through */
    }
    for (let s = 0; s < SLOT_COUNT; s++) if (this.read(KEY(s))) return s;
    return null;
  }

  summaries(): SlotSummary[] {
    return Array.from({ length: SLOT_COUNT }, (_, slot) => {
      const text = this.read(KEY(slot));
      const empty: SlotSummary = { slot, empty: true, level: 0, deepest: 0, gold: 0, savedAt: 0, playtime: 0 };
      if (!text) return empty;
      try {
        const env = JSON.parse(text) as Partial<SaveEnvelope>;
        const data = parseSave(text);
        return { slot, empty: false, level: data.hero.level, deepest: data.deepest, gold: data.hero.gold, savedAt: env.savedAt ?? 0, playtime: data.stats?.playtime ?? 0 };
      } catch (e) {
        return { ...empty, empty: false, error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  /** The slot's envelope as JSON text (export). */
  exportSlot(slot: number): string | null {
    const data = this.load(slot);
    return data ? exportSave(data, slot) : null;
  }

  /** Import JSON text into a slot. Throws with a readable message on a bad file. */
  importSlot(slot: number, text: string): SaveData {
    const data = parseSave(text);
    this.save(slot, data);
    return data;
  }
}

function defaultStorage(): KeyValueStore | null {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('save') === 'memory') return null;
    if (typeof localStorage === 'undefined') return null;
    const probe = 'riftlight:probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}
