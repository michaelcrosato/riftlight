import { describe, expect, it } from 'vitest';
import { EventBus } from './events';
import { describeMod, flag, flat, inc, more, override, StatSheet } from './mods';
import { Registry } from './registry';
import { Rng } from './rng';
import { SCALING } from './scaling';

describe('Rng', () => {
  it('is deterministic per seed and forks independently of draw count', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    const c = new Rng('run');
    const forkBefore = c.fork('level:1').next();
    const d = new Rng('run');
    d.next();
    d.next();
    // fork depends on state; same state → same fork
    expect(new Rng('run').fork('level:1').next()).toBe(forkBefore);
  });

  it('weighted picks respect weights and skip zero', () => {
    const r = new Rng(1);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 4000; i++) counts[r.weighted(['a', 'b', 'c'] as const, (x) => ({ a: 1, b: 3, c: 0 })[x])]++;
    expect(counts.c).toBe(0);
    expect(counts.b / counts.a).toBeGreaterThan(2.5);
  });
});

describe('Registry', () => {
  const reg = new Registry<{ id: string; tags?: string[]; weight?: number }>('test', [
    { id: 'fire-bolt', tags: ['spell', 'fire', 'projectile'] },
    { id: 'ice-nova', tags: ['spell', 'cold', 'area'] },
    { id: 'cleave', tags: ['attack', 'melee', 'area'], weight: 0 },
  ]);
  it('queries by tags', () => {
    expect(reg.query({ all: ['spell'] }).map((e) => e.id)).toEqual(['fire-bolt', 'ice-nova']);
    expect(reg.query({ any: ['area'], none: ['cold'] }).map((e) => e.id)).toEqual(['cleave']);
  });
  it('never picks weight-0 entries at random', () => {
    const r = new Rng(3);
    for (let i = 0; i < 200; i++) expect(reg.pick(r, { any: ['area'] }).id).toBe('ice-nova');
  });
  it('rejects duplicate ids', () => {
    expect(() => reg.add({ id: 'cleave' })).toThrow(/duplicate/);
  });
});

describe('StatSheet', () => {
  it('computes (base + flat) × (1 + inc) × Π(1 + more), scoped by tags and conditions', () => {
    const s = new StatSheet({ damage: 10 });
    s.set('tree', [flat('damage', 5), inc('damage', 0.5), inc('damage', 0.3, ['melee']), more('damage', 0.2, ['fire'])]);
    s.set('buff', [more('damage', 0.5, undefined, 'lowLife')]);
    expect(s.get('damage')).toBeCloseTo(15 * 1.5);
    expect(s.get('damage', ['melee'])).toBeCloseTo(15 * 1.8);
    expect(s.get('damage', ['melee', 'fire'])).toBeCloseTo(15 * 1.8 * 1.2);
    s.setCondition('lowLife', true);
    expect(s.get('damage')).toBeCloseTo(15 * 1.5 * 1.5);
    s.remove('buff');
    expect(s.get('damage')).toBeCloseTo(15 * 1.5);
  });

  it('clones base, sources and conditions independently', () => {
    const s = new StatSheet({ life: 50 });
    s.set('tree', [flat('life', 10), more('life', 0.5, undefined, 'lowLife')]);
    s.setCondition('lowLife', true);
    const c = s.clone();
    expect(c.get('life')).toBeCloseTo(90);
    expect(c.sourceKeys()).toEqual(['tree']);
    c.set('tree', []);
    c.setCondition('lowLife', false);
    c.setBase('life', 1);
    expect(s.get('life')).toBeCloseTo(90);
    expect(c.get('life')).toBe(1);
  });

  it('overrides win, flags read as booleans, explain lists sources', () => {
    const s = new StatSheet();
    s.set('keystone', [flag('cannotCrit'), override('crit.chance', 0)]);
    s.set('item', [flat('crit.chance', 0.05)]);
    expect(s.has('cannotCrit')).toBe(true);
    expect(s.get('crit.chance')).toBe(0);
    expect(s.explain('crit.chance').map((e) => e.source).sort()).toEqual(['item', 'keystone']);
  });

  it('describes mods for tooltips', () => {
    expect(describeMod(inc('damage', 0.2, ['melee']))).toBe('20% increased damage with melee');
    expect(describeMod(more('attack.speed', -0.1))).toBe('10% less attack speed');
    expect(describeMod(flat('life', 25))).toBe('+25 life');
  });
});

describe('scaling', () => {
  it('is monotonic and uncapped', () => {
    for (const f of [SCALING.monsterLife, SCALING.monsterDamage, SCALING.xpToNext, SCALING.gold]) {
      let prev = f(1);
      for (let d = 2; d < 300; d++) {
        const v = f(d);
        expect(v).toBeGreaterThan(prev);
        prev = v;
      }
      expect(Number.isFinite(f(1000))).toBe(true);
    }
  });
});

describe('EventBus', () => {
  it('delivers typed events and supports unsubscribe', () => {
    const bus = new EventBus<{ ping: number }>();
    const got: number[] = [];
    const off = bus.on('ping', (n) => got.push(n));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(got).toEqual([1]);
  });
});
