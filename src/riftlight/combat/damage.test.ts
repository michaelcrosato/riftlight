import { describe, expect, it } from 'vitest';
import { flag, flat, inc, more, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import type { Hit } from '../core/types';
import {
  armourReduction,
  baseRanges,
  convert,
  critChance,
  expectedHit,
  hitChance,
  mitigate,
  mitigateDot,
  resistance,
  rollHit,
  scaleDamage,
  sumDamage,
  type DamageSpec,
  type Defender,
} from './damage';
import { StatQuery } from './stats';

/** An Rng that always returns `v` (0.5 = middle of every range, chance(p) = p > 0.5). */
class Fixed extends Rng {
  constructor(private readonly v: number) {
    super(1);
  }
  override next(): number {
    return this.v;
  }
}

const spell = (base: DamageSpec['base'], extra: Partial<DamageSpec> = {}): DamageSpec => ({
  tags: ['spell', 'projectile', 'fire'],
  base,
  effectiveness: 1,
  crit: 0.06,
  ailments: {},
  knockback: 0,
  ...extra,
});
const attack = (extra: Partial<DamageSpec> = {}): DamageSpec => ({ tags: ['attack', 'melee'], base: {}, effectiveness: 1, crit: 0, ailments: {}, knockback: 2, ...extra });
const sheet = (mods: Parameters<StatSheet['set']>[1] = [], base: Record<string, number> = {}) => {
  const s = new StatSheet(base);
  s.set('test', mods);
  return s;
};
const q = (mods: Parameters<StatSheet['set']>[1] = [], extra: Parameters<StatSheet['set']>[1] = []) => new StatQuery(sheet(mods), extra);
const target = (base: Record<string, number> = {}, over: Partial<Defender> = {}): Defender => ({
  stats: new StatSheet(base),
  life: 100,
  maxLife: 100,
  es: 0,
  shock: 0,
  ...over,
});
const hit = (h: Partial<Hit>): Hit => ({ source: null, tags: ['spell'], damage: {}, crit: false, ...h });

describe('base damage', () => {
  it('spells: skill base plus added damage × effectiveness', () => {
    const r = baseRanges(q([flat('added.fire.min', 10), flat('added.fire.max', 20)]), spell({ fire: [8, 12] }, { effectiveness: 0.5 }));
    expect(r.fire).toEqual([13, 22]);
  });
  it('attacks: (weapon + skill + added) × effectiveness', () => {
    const r = baseRanges(q([flat('weapon.physical.min', 10), flat('weapon.physical.max', 20), flat('added.fire.min', 2), flat('added.fire.max', 4)]), attack({ effectiveness: 1.5 }));
    expect(r.physical).toEqual([15, 30]);
    expect(r.fire).toEqual([3, 6]);
  });
  it('attacks with no weapon and no skill damage punch for UNARMED', () => {
    expect(baseRanges(q(), attack()).physical).toEqual([2, 6]);
  });
  it('added damage scoped by tags only applies to matching skills', () => {
    const s = q([flat('added.cold.min', 5, ['attack']), flat('added.cold.max', 5, ['attack'])]);
    expect(baseRanges(s, spell({ fire: [1, 1] })).cold).toBeUndefined();
    expect(baseRanges(s, attack()).cold).toEqual([5, 5]);
  });
});

describe('conversion', () => {
  it('converts a fraction and remembers where damage came from', () => {
    const p = convert(q([flat('convert.physical.fire', 0.5)]), { physical: 100 }, []);
    expect(p).toEqual([
      { type: 'fire', amount: 50, history: ['physical', 'fire'] },
      { type: 'physical', amount: 50, history: ['physical'] },
    ]);
  });
  it('more than 100% from one type is scaled down to 100%', () => {
    const p = convert(q([flat('convert.physical.fire', 0.8), flat('convert.physical.cold', 0.8)]), { physical: 100 }, []);
    expect(p.find((x) => x.type === 'physical')).toBeUndefined();
    expect(p.find((x) => x.type === 'fire')!.amount).toBeCloseTo(50);
    expect(p.find((x) => x.type === 'cold')!.amount).toBeCloseTo(50);
  });
  it('chains forward only (physical → lightning → fire)', () => {
    const p = convert(q([flat('convert.physical.lightning', 1), flat('convert.lightning.fire', 1), flat('convert.fire.physical', 1)]), { physical: 10 }, []);
    expect(p).toEqual([{ type: 'fire', amount: 10, history: ['physical', 'lightning', 'fire'] }]);
  });
  it('converted damage is scaled by modifiers to every type it has been', () => {
    const s = q([flat('convert.physical.fire', 1), inc('damage', 0.5, ['physical']), inc('fire.damage', 0.5)]);
    const d = scaleDamage(s, convert(s, { physical: 100 }, ['attack']), ['attack']);
    expect(d.fire).toBeCloseTo(200);
    expect(d.physical).toBeUndefined();
  });
});

describe('increased and more', () => {
  it('increases add up across damage stats, mores multiply', () => {
    const s = q([inc('damage', 0.2), inc('fire.damage', 0.3), inc('elemental.damage', 0.5), more('damage', 0.5), more('damage', 0.2, ['spell'])]);
    const d = scaleDamage(s, convert(s, { fire: 100 }, ['spell']), ['spell']);
    expect(d.fire).toBeCloseTo(100 * 2 * 1.5 * 1.2);
  });
  it('tag-scoped mods only touch matching hits', () => {
    const s = q([inc('damage', 1, ['melee']), inc('damage', 1, ['spell'])]);
    expect(scaleDamage(s, convert(s, { physical: 10 }, ['attack', 'melee']), ['attack', 'melee']).physical).toBeCloseTo(20);
  });
  it('the skill-only extra mods (supports) stack with the sheet', () => {
    const s = q([inc('damage', 0.5)], [more('damage', 0.3), inc('damage', 0.5, ['fire'])]);
    expect(scaleDamage(s, convert(s, { fire: 10 }, []), []).fire).toBeCloseTo(10 * 2 * 1.3);
  });
  it('conditional mods apply only while the condition is set', () => {
    const sh = sheet([inc('damage', 1, undefined, 'lowLife')]);
    const s = new StatQuery(sh);
    expect(scaleDamage(s, convert(s, { fire: 10 }, []), []).fire).toBeCloseTo(10);
    sh.setCondition('lowLife', true);
    expect(scaleDamage(s, convert(s, { fire: 10 }, []), []).fire).toBeCloseTo(20);
  });
});

describe('crits', () => {
  it('attacks use weapon crit, scaled by increased crit chance', () => {
    expect(critChance(q([flat('weapon.crit', 0.1), inc('crit.chance', 1)]), attack())).toBeCloseTo(0.2);
    expect(critChance(q(), attack())).toBeCloseTo(0.05);
    expect(critChance(q([inc('crit.chance', 0.5)]), spell({ fire: [1, 1] }))).toBeCloseTo(0.09);
  });
  it('a crit multiplies damage by 150% plus added multiplier', () => {
    const s = q([flat('crit.multiplier', 0.5)]);
    const h = rollHit(s, spell({ fire: [10, 10] }), new Fixed(0.5), { crit: true });
    expect(h.damage.fire).toBeCloseTo(20);
    expect(h.crit).toBe(true);
  });
  it('rolls the crit with the attacker rng', () => {
    const s = q([flat('crit.chance', 1)]);
    expect(rollHit(s, spell({ fire: [10, 10] }), new Rng(3)).crit).toBe(true);
    expect(rollHit(q(), spell({ fire: [10, 10] }, { crit: 0 }), new Rng(3)).crit).toBe(false);
  });
  it('elemental crits always apply ignite / freeze / shock', () => {
    const h = rollHit(q(), spell({ fire: [10, 10], cold: [5, 5] }), new Fixed(0.5), { crit: true });
    expect(h.ailments).toMatchObject({ ignite: 1, freeze: 1 });
    expect(h.ailments!.shock).toBeUndefined();
  });
});

describe('the rolled hit', () => {
  it('rolls each type inside its range', () => {
    const r = new Rng('rolls');
    for (let i = 0; i < 50; i++) {
      const h = rollHit(q(), spell({ fire: [10, 20] }, { crit: 0 }), r);
      expect(h.damage.fire).toBeGreaterThanOrEqual(10);
      expect(h.damage.fire).toBeLessThanOrEqual(20);
    }
  });
  it('carries accuracy (attacks only), penetration, knockback, cull and ailment scaling', () => {
    const s = q([flat('accuracy', 300), flat('pen.fire', 0.1), flat('knockback', 1), inc('ailment.effect', 0.5), flag('cull')]);
    const a = rollHit(s, attack(), new Fixed(0.5));
    expect(a.accuracy).toBe(300);
    expect(a.knockback).toBe(3);
    expect(a.ailmentEffect).toBeCloseTo(1.5);
    expect(a.cull).toBe(0.1);
    const b = rollHit(s, spell({ fire: [1, 1] }), new Fixed(0.5));
    expect(b.accuracy).toBeUndefined();
    expect(b.penetration).toEqual({ fire: 0.1 });
  });
  it('bleed only comes from attacks', () => {
    const s = q([flat('bleed.chance', 1)]);
    expect(rollHit(s, attack(), new Fixed(0.9)).ailments!.bleed).toBe(1);
    expect(rollHit(s, spell({ physical: [5, 5] }), new Fixed(0.9)).ailments!.bleed).toBeUndefined();
  });
  it('melee hits get hit-stop, crits more', () => {
    const a = rollHit(q(), attack(), new Fixed(0.5), { crit: false });
    const b = rollHit(q(), attack(), new Fixed(0.5), { crit: true });
    expect(a.hitStop).toBeGreaterThan(0);
    expect(b.hitStop).toBeGreaterThan(a.hitStop!);
  });
});

describe('mitigation', () => {
  it('armour has diminishing returns: big hits get through more, capped at 90%', () => {
    expect(armourReduction(1000, 40)).toBeCloseTo(1000 / 1200);
    expect(armourReduction(1000, 200)).toBeCloseTo(0.5);
    expect(armourReduction(1000, 2000)).toBeLessThan(armourReduction(1000, 200));
    expect(armourReduction(1e9, 1)).toBe(0.9);
    const m = mitigate(hit({ tags: ['attack'], damage: { physical: 200 } }), target({ armour: 1000 }, { life: 1000, maxLife: 1000 }), new Fixed(0.5));
    expect(m.result.total).toBeCloseTo(100);
  });
  it('resistances are capped at res.max (75%), raised by res.max.<type>', () => {
    expect(resistance(new StatSheet({ 'res.fire': 0.9 }), 'fire')).toBeCloseTo(0.75);
    expect(resistance(new StatSheet({ 'res.fire': 0.9, 'res.max.fire': 0.8 }), 'fire')).toBeCloseTo(0.8);
    expect(resistance(new StatSheet({ 'res.cold': -0.5 }), 'cold')).toBeCloseTo(-0.5);
    expect(resistance(new StatSheet({ 'res.chaos': 0.3 }), 'chaos', 0.4)).toBeCloseTo(-0.1);
    const m = mitigate(hit({ damage: { fire: 100, chaos: 100 } }), target({ 'res.fire': 0.9, 'res.chaos': 0.2 }, { life: 1000, maxLife: 1000 }), new Fixed(0.5));
    expect(m.result.byType.fire).toBeCloseTo(25);
    expect(m.result.byType.chaos).toBeCloseTo(80);
  });
  it('penetration lowers the resistance the hit sees', () => {
    const m = mitigate(hit({ damage: { cold: 100 }, penetration: { cold: 0.25 } }), target({ 'res.cold': 0.75 }, { life: 1000, maxLife: 1000 }), new Fixed(0.5));
    expect(m.result.byType.cold).toBeCloseTo(50);
  });
  it('evasion: accuracy vs evasion decides the chance to hit; spells always land', () => {
    expect(hitChance(1000, 0)).toBe(1);
    expect(hitChance(undefined, 5000)).toBe(1);
    expect(hitChance(100, 1e6)).toBe(0.05);
    expect(hitChance(500, 500)).toBeGreaterThan(hitChance(500, 2000));
    const d = target({ evasion: 1e6 });
    expect(mitigate(hit({ tags: ['attack'], damage: { physical: 10 }, accuracy: 100 }), d, new Fixed(0.5)).result.evaded).toBe(true);
    expect(mitigate(hit({ tags: ['spell'], damage: { physical: 10 } }), d, new Fixed(0.5)).result.evaded).toBeUndefined();
  });
  it('block negates attacks (capped at 75%); spells need spell block', () => {
    const d = target({ 'block.chance': 1 });
    expect(mitigate(hit({ tags: ['attack'], damage: { physical: 10 } }), d, new Fixed(0.7)).result.blocked).toBe(true);
    expect(mitigate(hit({ tags: ['attack'], damage: { physical: 10 } }), d, new Fixed(0.8)).result.blocked).toBeUndefined();
    expect(mitigate(hit({ tags: ['spell'], damage: { physical: 10 } }), d, new Fixed(0.1)).result.blocked).toBeUndefined();
  });
  it('shock and damage.taken increase damage taken', () => {
    const m = mitigate(hit({ damage: { fire: 100 } }), target({ 'damage.taken': 1.2 }, { shock: 0.25, life: 1000, maxLife: 1000 }), new Fixed(0.5));
    expect(m.result.total).toBeCloseTo(150);
  });
  it('energy shield absorbs damage before life', () => {
    const m = mitigate(hit({ damage: { fire: 50 } }), target({}, { es: 30 }), new Fixed(0.5));
    expect(m.toEs).toBe(30);
    expect(m.toLife).toBe(20);
    expect(m.result.killed).toBe(false);
  });
  it('kills, and culling strike finishes a target below 10%', () => {
    expect(mitigate(hit({ damage: { fire: 100 } }), target(), new Fixed(0.5)).result.killed).toBe(true);
    const culled = mitigate(hit({ damage: { fire: 91 }, cull: 0.1 }), target(), new Fixed(0.5));
    expect(culled.result.killed).toBe(true);
    expect(culled.toLife).toBeCloseTo(100);
    expect(mitigate(hit({ damage: { fire: 89 }, cull: 0.1 }), target(), new Fixed(0.5)).result.killed).toBe(false);
  });
  it('dead targets take nothing', () => {
    expect(mitigate(hit({ damage: { fire: 100 } }), target({}, { life: 0 }), new Fixed(0.5)).result.total).toBe(0);
  });
});

describe('ailments', () => {
  const big = { life: 1000, maxLife: 1000 };
  it('cold always chills, scaled by damage vs max life (10%..30%)', () => {
    const small = mitigate(hit({ damage: { cold: 1 } }), target({}, big), new Fixed(0.5)).apply.find((a) => a.id === 'chill')!;
    const large = mitigate(hit({ damage: { cold: 400 } }), target({}, big), new Fixed(0.5)).apply.find((a) => a.id === 'chill')!;
    expect(small.magnitude).toBeCloseTo(0.1);
    expect(large.magnitude).toBeCloseTo(0.3);
  });
  it('freeze, shock and ignite roll their chances; ignite deals 50% of the fire hit per second', () => {
    const m = mitigate(hit({ damage: { fire: 100, lightning: 50, cold: 20 }, ailments: { ignite: 1, shock: 0.6, freeze: 0.4 } }), target({}, big), new Fixed(0.5));
    const ids = m.apply.map((a) => a.id).sort();
    expect(ids).toEqual(['chill', 'ignite', 'shock']);
    expect(m.apply.find((a) => a.id === 'ignite')!.magnitude).toBeCloseTo(50);
    expect(m.apply.find((a) => a.id === 'ignite')!.duration).toBe(4);
  });
  it('ailment effect and duration multipliers from the hit', () => {
    const m = mitigate(hit({ damage: { fire: 100 }, ailments: { ignite: 1 }, ailmentEffect: 2, ailmentDuration: 1.5 }), target({}, big), new Fixed(0.5));
    expect(m.apply[0]).toEqual({ id: 'ignite', magnitude: 100, duration: 6 });
  });
  it('stun comes from big physical hits only (threshold 12% of max life)', () => {
    const small = mitigate(hit({ tags: ['attack'], damage: { physical: 100 } }), target({}, big), new Fixed(0.5));
    const large = mitigate(hit({ tags: ['attack'], damage: { physical: 300 } }), target({}, big), new Fixed(0.5));
    expect(small.apply.map((a) => a.id)).not.toContain('stun');
    const stun = large.apply.find((a) => a.id === 'stun')!;
    expect(stun.duration).toBeGreaterThan(0.35);
  });
  it('avoid.<ailment> 100% makes a target immune', () => {
    const m = mitigate(hit({ damage: { cold: 400 } }), target({ 'avoid.chill': 1 }, big), new Fixed(0.5));
    expect(m.apply).toEqual([]);
  });
  it('damage over time ignores armour but not resistance', () => {
    const d = target({ armour: 1e6, 'res.fire': 0.5 });
    expect(mitigateDot(d, 'physical', 10)).toBeCloseTo(10);
    expect(mitigateDot(d, 'fire', 10)).toBeCloseTo(5);
  });
});

describe('expected values', () => {
  it('match the mean of many rolled hits', () => {
    const s = q([flat('weapon.physical.min', 10), flat('weapon.physical.max', 30), flat('weapon.crit', 0.2), inc('damage', 0.5), flat('convert.physical.cold', 0.25)]);
    const spec = attack();
    const e = expectedHit(s, spec);
    const r = new Rng('mean');
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += sumDamage(rollHit(s, spec, r).damage);
    expect(sum / n).toBeCloseTo(sumDamage(e.damage), -0.5);
    expect(e.critChance).toBeCloseTo(0.2);
    expect(e.ailments.freeze).toBeCloseTo(0.2);
  });
  it('apply the target defences', () => {
    const e = expectedHit(q(), spell({ fire: [100, 100] }, { crit: 0 }), target({ 'res.fire': 0.5, 'spell.block': 0.25 }));
    expect(e.mitigated.fire).toBeCloseTo(50);
    expect(e.landChance).toBeCloseTo(0.75);
  });
});
