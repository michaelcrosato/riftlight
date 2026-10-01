import { describe, expect, it } from 'vitest';
import { flat, inc, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import { expectedHit, rollHit, sumDamage } from '../combat/damage';
import { StatQuery } from '../combat/stats';
import { ACTIVE_SKILLS, SKILLS } from './actives';
import { buildSkill, supportFits, supportsFor } from './build';
import { SUPPORT_GEMS, SUPPORTS } from './supports';

const hero = () => new StatSheet();

describe('gem data', () => {
  it('has the skills and supports the game needs', () => {
    expect(ACTIVE_SKILLS.length).toBeGreaterThanOrEqual(28);
    expect(SUPPORT_GEMS.length).toBeGreaterThanOrEqual(30);
    for (const id of ['cleave', 'heavy-strike', 'whirlwind', 'leap-slam', 'shield-charge', 'ground-slam', 'frenzy', 'split-arrow', 'rain-of-arrows', 'explosive-arrow', 'lightning-arrow', 'fireball', 'frost-nova', 'arc', 'ice-spear', 'flame-wall', 'meteor', 'storm-call', 'chaos-bolt', 'dodge-roll', 'blink', 'dash', 'summon-skeletons', 'raise-spectre', 'haste-aura', 'molten-shell', 'war-cry', 'fire-trap', 'frost-mine']) {
      expect(SKILLS.has(id), id).toBe(true);
    }
    for (const id of ['added-fire', 'melee-physical', 'multistrike', 'gmp', 'chain', 'pierce', 'increased-area', 'concentrated-effect', 'faster-attacks', 'faster-casting', 'elemental-focus', 'brutality', 'increased-crit', 'life-leech', 'culling-strike', 'knockback', 'fork', 'spell-echo', 'minion-damage']) {
      expect(SUPPORTS.has(id), id).toBe(true);
    }
  });
  it('every delivery kind is used by at least one skill', () => {
    const kinds = new Set(ACTIVE_SKILLS.map((s) => s.delivery.kind));
    expect([...kinds].sort()).toEqual(['aura', 'beam', 'curse', 'dash', 'nova', 'projectile', 'slam', 'strike', 'summon', 'trap']);
  });
  it("a skill is tagged 'damage' exactly when it has a damage effect, and 'attack' or 'spell' when it scales", () => {
    for (const s of ACTIVE_SKILLS) {
      const hasDamage = s.effects.some((e) => e.kind === 'damage');
      if (s.tags!.includes('minion')) continue; // the damage effect is the minions'
      expect(s.tags!.includes('damage'), s.id).toBe(hasDamage);
      if (hasDamage) expect(s.tags!.includes('attack') || s.tags!.includes('spell'), s.id).toBe(true);
    }
  });
  it('every support fits at least one skill', () => {
    for (const s of SUPPORT_GEMS) expect(ACTIVE_SKILLS.some((a) => supportFits(s, a.tags!)), s.id).toBe(true);
  });
  it('every damaging skill deals damage at level 1 and more at level 20', () => {
    for (const s of ACTIVE_SKILLS) {
      const r = buildSkill(s, [], hero());
      if (!r.damage || r.tags.includes('minion')) continue;
      const q1 = new StatQuery(hero(), r.mods);
      const q20 = new StatQuery(hero(), buildSkill(s, [], hero(), { level: 20 }).mods);
      const d1 = sumDamage(expectedHit(q1, r.damage).damage);
      expect(d1, s.id).toBeGreaterThan(0);
      expect(sumDamage(expectedHit(q20, r.damage).damage), s.id).toBeGreaterThan(d1 * 1.5);
    }
  });
});

describe('buildSkill', () => {
  it('is pure: the character sheet is not touched', () => {
    const sheet = new StatSheet();
    sheet.set('tree', [inc('cast.speed', 0.2)]);
    const v = sheet.version;
    const a = buildSkill('fireball', ['gmp', 'added-fire'], sheet, { level: 4 });
    const b = buildSkill('fireball', ['gmp', 'added-fire'], sheet, { level: 4 });
    expect(sheet.version).toBe(v);
    expect(a).toEqual(b);
  });
  it('applies matching supports and lists the ones that do not fit', () => {
    const r = buildSkill('fireball', ['gmp', 'melee-physical', 'faster-casting', 'gmp'], hero());
    expect(r.supports).toEqual(['gmp', 'faster-casting']);
    expect(r.unsupported).toEqual(['melee-physical', 'gmp']);
  });
  it('projectile supports change the delivery', () => {
    const r = buildSkill('fireball', ['gmp', 'chain', 'pierce', 'fork'], hero());
    expect(r.delivery).toMatchObject({ kind: 'projectile', count: 5, chain: 2, pierce: 3, fork: 1 });
    expect(r.delivery.kind === 'projectile' && r.delivery.spread).toBeGreaterThanOrEqual(40);
  });
  it('character stats add projectiles, chains and projectile speed', () => {
    const sheet = new StatSheet();
    sheet.set('item', [flat('projectiles', 1, ['projectile']), inc('projectile.speed', 0.5)]);
    const r = buildSkill('ice-spear', [], sheet);
    expect(r.delivery).toMatchObject({ count: 2, speed: 36 });
  });
  it('area scales radii by the square root of the area multiplier', () => {
    const plain = buildSkill('frost-nova', [], hero());
    const big = buildSkill('frost-nova', ['increased-area'], hero());
    const small = buildSkill('frost-nova', ['concentrated-effect'], hero());
    expect(plain.delivery).toMatchObject({ radius: 4 });
    expect(big.area).toBeCloseTo(1.45);
    expect(big.delivery.kind === 'nova' && big.delivery.radius).toBeCloseTo(4 * Math.sqrt(1.45));
    expect(small.delivery.kind === 'nova' && small.delivery.radius).toBeCloseTo(4 * Math.sqrt(0.7));
  });
  it('strikes only grow with area when they are area skills', () => {
    expect(buildSkill('slash', [], hero()).delivery).toMatchObject({ range: 2.3 });
    const cleave = buildSkill('cleave', ['increased-area'], hero());
    expect(cleave.delivery.kind === 'strike' && cleave.delivery.range).toBeGreaterThan(2.8);
  });
  it('attack and cast speed shorten the cast time', () => {
    const sheet = new StatSheet();
    sheet.set('tree', [inc('attack.speed', 0.5)]);
    expect(buildSkill('cleave', [], sheet).castTime).toBeCloseTo(0.55 / 1.5);
    expect(buildSkill('fireball', [], sheet).castTime).toBeCloseTo(0.6);
    const ms = buildSkill('cleave', ['multistrike'], hero());
    expect(ms.repeats).toBe(3);
    expect(ms.castTime).toBeCloseTo(0.55 / 1.6);
    expect(ms.speed).toBeCloseTo(1.6);
  });
  it('tag-scoped speed only applies to matching skills', () => {
    const sheet = new StatSheet();
    sheet.set('tree', [inc('attack.speed', 1, ['bow'])]);
    expect(buildSkill('split-arrow', [], sheet).speed).toBeCloseTo(2);
    expect(buildSkill('cleave', [], sheet).speed).toBeCloseTo(1);
  });
  it('cost grows with gem level and support multipliers', () => {
    expect(buildSkill('fireball', [], hero()).cost).toBe(6);
    expect(buildSkill('fireball', ['gmp'], hero()).cost).toBe(9);
    expect(buildSkill('fireball', [], hero(), { level: 11 }).cost).toBeCloseTo(6 * 1.8);
    const sheet = new StatSheet();
    sheet.set('tree', [inc('cost', -0.5)]);
    expect(buildSkill('fireball', [], sheet).cost).toBe(3);
  });
  it('gem levels add their perLevel mods, supports too', () => {
    const r = buildSkill('fireball', [{ gem: 'faster-casting', level: 11 }], hero(), { level: 6 });
    expect(r.level).toBe(6);
    expect(r.mods).toContainEqual({ stat: 'damage', kind: 'more', value: expect.closeTo(0.3, 5) as number, tags: undefined, when: undefined });
    expect(r.speed).toBeCloseTo(1 + 0.3 + 0.1);
    expect(buildSkill('fireball', [], hero(), { level: 99 }).level).toBe(20);
  });
  it('support mods apply to the linked skill only', () => {
    const sheet = hero();
    const fb = buildSkill('fireball', ['controlled-destruction'], sheet);
    const plain = buildSkill('fireball', [], sheet);
    const a = expectedHit(new StatQuery(sheet, fb.mods), fb.damage!);
    const b = expectedHit(new StatQuery(sheet, plain.mods), plain.damage!);
    expect(a.damage.fire! / (b.damage.fire! / (1 + b.critChance * 0.5))).toBeCloseTo(1.3 * (1 + a.critChance * 0.5), 2);
    expect(sheet.explain('damage')).toEqual([]);
  });
  it('excluded supports do not fit (multistrike on a channel, spell echo on a movement skill)', () => {
    expect(buildSkill('whirlwind', ['multistrike'], hero()).unsupported).toEqual(['multistrike']);
    expect(buildSkill('blink', ['spell-echo'], hero()).unsupported).toEqual(['spell-echo']);
    expect(supportsFor('blink').map((s) => s.id)).not.toContain('spell-echo');
  });
  it('added tags let later supports fit', () => {
    expect(buildSkill('heavy-strike', ['stun'], hero()).tags).toContain('stun');
  });
  it('durations scale buff effects, traps and summons', () => {
    const r = buildSkill('molten-shell', ['increased-duration'], hero());
    expect(r.duration).toBeCloseTo(1.5);
    expect(r.effects.find((e) => e.kind === 'buff')).toMatchObject({ duration: 12 });
    expect(buildSkill('fire-trap', ['increased-duration'], hero()).delivery).toMatchObject({ duration: 15 });
    expect(buildSkill('summon-skeletons', ['increased-duration'], hero()).delivery).toMatchObject({ duration: 30 });
  });
  it('the resolved damage rolls through the pipeline with support mods', () => {
    const r = buildSkill('fireball', ['added-fire', 'elemental-focus'], hero());
    const hit = rollHit(new StatQuery(hero(), r.mods), r.damage!, new Rng(1), { crit: true });
    expect(hit.damage.fire).toBeGreaterThan(0);
    expect(hit.ailments).toEqual({});
    expect(hit.ailmentEffect).toBe(0);
  });
  it('brutality removes non-physical damage', () => {
    const sheet = new StatSheet();
    sheet.set('item', [flat('added.fire.min', 10), flat('added.fire.max', 10)]);
    const r = buildSkill('cleave', ['brutality'], sheet);
    const e = expectedHit(new StatQuery(sheet, r.mods), r.damage!);
    expect(e.damage.fire).toBeUndefined();
    expect(e.damage.physical).toBeGreaterThan(0);
  });
  it('combo skills list one clip per step', () => {
    expect(buildSkill('slash', [], hero()).anims).toEqual(['Slash1', 'Slash2', 'Slash3']);
    expect(buildSkill('fireball', [], hero()).anims).toEqual(['Cast']);
  });
});
