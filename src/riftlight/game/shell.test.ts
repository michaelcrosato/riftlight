import { describe, expect, it } from 'vitest';
import { parseSong } from '../../engine/audio/music';
import { StatSheet } from '../core/mods';
import { SCALING } from '../core/scaling';
import type { Hit, HitResult } from '../core/types';
import {
  changedSliders,
  DIFFICULTY_PRESETS,
  difficultyMods,
  multiplierToSlider,
  NORMAL,
  nudge,
  presetOf,
  sanitizeTuning,
  sliderToMultiplier,
} from './difficulty';
import { addXp, applyDeath, deathPenalty, levelTitle, recordClear, roman, unlockedDepths, xpFraction } from './progress';
import { RecapTracker } from './recap';
import { SONGS, SOUNDS } from './audio';
import { exportSave, type KeyValueStore, migrate, newSave, parseSave, SAVE_VERSION, SaveStore } from './save';

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    if (this.fail) throw new Error('blocked');
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new Error('quota');
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('difficulty', () => {
  it('applies sliders as more-mods on the difficulty source', () => {
    const sheet = new StatSheet({ life: 100, damage: 10, 'move.speed': 5 });
    sheet.set('difficulty', difficultyMods({ ...NORMAL, enemyLife: 2, enemyDamage: 0.5, enemySpeed: 1.2 }, 'enemy'));
    expect(sheet.get('life')).toBeCloseTo(200);
    expect(sheet.get('damage')).toBeCloseTo(5);
    expect(sheet.get('move.speed')).toBeCloseTo(6);
    expect(difficultyMods(NORMAL, 'hero')).toEqual([]);
    expect(difficultyMods({ ...NORMAL, enemyLife: 3 }, 'hero')).toEqual([]);
  });

  it('clamps to 0.25..4, sanitizes junk and maps sliders on a log scale', () => {
    expect(sanitizeTuning({ playerDamage: 99, enemyLife: 0, enemySpeed: 'x' })).toEqual({ ...NORMAL, playerDamage: 4, enemyLife: 0.25 });
    expect(sliderToMultiplier(0.5)).toBe(1);
    expect(sliderToMultiplier(0)).toBe(0.25);
    expect(sliderToMultiplier(1)).toBe(4);
    expect(multiplierToSlider(2)).toBeCloseTo(0.75);
    expect(nudge(1, 1)).toBe(1.1);
    expect(nudge(1, -1)).toBe(0.95);
    expect(nudge(4, 1)).toBe(4);
    expect(nudge(0.25, -1)).toBe(0.25);
  });

  it('knows its presets and which sliders moved', () => {
    expect(presetOf(DIFFICULTY_PRESETS.hard)).toBe('hard');
    expect(presetOf({ ...NORMAL, enemyLife: 1.3 })).toBe(null);
    expect(changedSliders({ ...NORMAL, enemyLife: 1.3 })).toEqual(['enemyLife']);
  });
});

describe('progress', () => {
  it('levels up across thresholds and keeps the remainder', () => {
    const hero = newSave(1).hero;
    const need = SCALING.xpToNext(1) + SCALING.xpToNext(2);
    expect(addXp(hero, need + 5)).toBe(2);
    expect(hero.level).toBe(3);
    expect(hero.xp).toBe(5);
    expect(xpFraction(hero)).toBeGreaterThan(0);
  });

  it('death costs a share of xp and gold, never a level', () => {
    const save = newSave(1);
    save.hero.level = 5;
    save.hero.xp = 100;
    save.hero.gold = 200;
    expect(deathPenalty(save)).toEqual({ xp: 10, gold: 30 });
    applyDeath(save);
    expect(save.hero).toMatchObject({ level: 5, xp: 90, gold: 170 });
    expect(save.stats?.deaths).toBe(1);
  });

  it('tracks the deepest depth and best times', () => {
    const save = newSave(1);
    expect(unlockedDepths(save)).toEqual([1]);
    expect(recordClear(save, 1, 80)).toBe(true);
    expect(recordClear(save, 1, 60)).toBe(false);
    expect(save.stats?.best['1']).toBe(60);
    expect(unlockedDepths(save)).toEqual([1, 2]);
  });

  it('names levels', () => {
    expect(roman(3)).toBe('III');
    expect(roman(12)).toBe('XII');
    expect(levelTitle(3, 'Gale')).toBe('III · GALE');
    expect(levelTitle(37, 'Frostglass Gravewell')).toBe('RIFT 37 · FROSTGLASS GRAVEWELL');
  });
});

describe('save', () => {
  it('round-trips slots and remembers the last one', () => {
    const store = new SaveStore(new MemoryStore());
    expect(store.lastSlot()).toBe(null);
    const save = newSave(42);
    save.hero.gold = 77;
    save.deepest = 3;
    expect(store.save(1, save)).toBe(true);
    expect(store.load(1)).toEqual(save);
    expect(store.lastSlot()).toBe(1);
    const sums = store.summaries();
    expect(sums.map((s) => s.empty)).toEqual([true, false, true]);
    expect(sums[1]).toMatchObject({ level: 1, deepest: 3, gold: 77 });
  });

  it('exports and imports JSON, and migrates v0 saves', () => {
    const save = newSave(7);
    save.codex = ['embers'];
    const text = exportSave(save, 0);
    expect(parseSave(text)).toEqual(save);
    const v0 = { hero: { level: 4, xp: 3 }, gold: 55, deepest: 2, seed: 9 };
    const up = migrate(v0);
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.hero).toMatchObject({ level: 4, xp: 3, gold: 55, allocated: [] });
    expect(up.difficulty).toEqual(NORMAL);
    expect(up.stats?.runs).toBe(0);
  });

  it('refuses newer versions and garbage with readable errors', () => {
    expect(() => parseSave('{oops')).toThrow('not JSON');
    expect(() => parseSave(JSON.stringify({ format: 'riftlight-save', version: 99, data: {} }))).toThrow(/newer/);
    const store = new SaveStore(new MemoryStore());
    expect(() => store.importSlot(0, '[]')).toThrow();
  });

  it('survives blocked storage (session memory)', () => {
    const mem = new MemoryStore();
    const store = new SaveStore(mem);
    mem.fail = true;
    expect(store.save(0, newSave(1))).toBe(false);
    expect(store.load(0)?.seed).toBe(1);
    expect(store.lastError).toMatch(/quota|blocked/);
  });
});

describe('recap', () => {
  it('sums damage by type and source and names the killer', () => {
    const r = new RecapTracker();
    const src = (name: string) => ({ name }) as unknown as Hit['source'];
    const hit = (name: string): Hit => ({ source: src(name), tags: [], damage: {}, crit: false });
    const res = (byType: HitResult['byType'], crit = false): HitResult => ({ total: Object.values(byType).reduce((a, b) => a + (b ?? 0), 0), byType, crit, killed: false, ailments: [] });
    r.record(hit('Ember Imp'), res({ fire: 20 }));
    r.record(hit('Brute'), res({ physical: 5 }));
    r.record(hit('Ember Imp'), res({ fire: 12, physical: 3 }, true));
    const out = r.recap();
    expect(out.byType.fire).toBe(32);
    expect(out.total).toBe(40);
    expect(out.sources[0]).toMatchObject({ name: 'Ember Imp', total: 35, hits: 2 });
    expect(out.killer).toBe('Ember Imp');
    expect(out.tip).toMatch(/critical/);
    expect(out.tip).toMatch(/fire/i);
  });
});

describe('audio data', () => {
  it('every song parses (no bad notes, even patterns) and the combat layer matches the level loop', () => {
    for (const [name, song] of Object.entries(SONGS)) expect(parseSong(song).notes.length, name).toBeGreaterThan(10);
    const level = parseSong(SONGS.level);
    const combat = parseSong(SONGS.combat);
    expect(combat.length).toBe(level.length);
    expect(combat.stepTime).toBe(level.stepTime);
  });

  it('has the UI sounds the shell plays', () => {
    for (const s of ['click', 'move', 'open', 'close', 'equip', 'error', 'buy', 'levelUp']) expect(SOUNDS).toHaveProperty(s);
  });
});
