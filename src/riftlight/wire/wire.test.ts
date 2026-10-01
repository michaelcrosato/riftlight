import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { parseSong } from '../../engine/audio/music';
import { Actor } from '../actors/Actor';
import { payCost } from '../actors/HeroController';
import { mitigate, rollHit, type DamageSpec } from '../combat/damage';
import { ownerMinionMods } from '../combat/minions';
import { StatQuery } from '../combat/stats';
import { REFERENCE_APS } from '../combat/tuning';
import { flag, flat, inc, StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import { RANK } from '../core/scaling';
import { canonicalMods, canonicalStat } from '../core/stats';
import { PlaytestBot } from '../game/bot';
import { BOSSES, buildMonster } from '../monsters';
import { buildSkill } from '../skills/build';
import { GEM_ALIASES, levelMods, slotsFromSave, starterWeapon, usesDefaultGems } from './hero';
import { bossBudget, monsterGem, monsterName, translateMods } from './monsters';
import { themeSongs, transposeNote } from './music';
import { StageMover } from './stage';
import { WIRE_TUNING } from './tuning';
import { MONSTER_SKILLS } from '../monsters';
import { SKILLS } from '../skills';

class Fixed extends Rng {
  constructor(private readonly v: number) {
    super(1);
  }
  override next(): number {
    return this.v;
  }
}

const sheet = (...mods: Parameters<StatSheet['set']>[1][]) => {
  const s = new StatSheet();
  mods.forEach((m, i) => s.set(`s${i}`, m));
  return s;
};
const attack = (extra: Partial<DamageSpec> = {}): DamageSpec => ({ tags: ['attack', 'melee'], base: { physical: [10, 10] }, effectiveness: 1, crit: 0, ailments: {}, knockback: 0, ...extra });

describe('canonical stat names (core/stats.ts)', () => {
  it('renames aliases on the way in and on the way out', () => {
    const s = sheet([flat('energy.shield', 20), flat('crit.multi', 0.1), flat('life.leech', 0.02), inc('mana.cost', -0.1), flat('chance.poison', 0.3)]);
    expect(s.get('es')).toBe(20);
    expect(s.get('energy.shield')).toBe(20); // old name still answers
    expect(s.get('leech.life')).toBeCloseTo(0.02);
    expect(s.get('poison.chance')).toBeCloseTo(0.3);
    expect(new StatQuery(s).scale('cost')).toBeCloseTo(0.9);
    expect(s.stats()).toContain('crit.multiplier');
    expect(s.stats()).not.toContain('crit.multi');
  });

  it('expands res.elemental into the three elements', () => {
    const s = sheet([flat('res.elemental', 0.1)]);
    expect(s.get('res.fire')).toBeCloseTo(0.1);
    expect(s.get('res.cold')).toBeCloseTo(0.1);
    expect(s.get('res.lightning')).toBeCloseTo(0.1);
    expect(canonicalMods([flat('life', 1)])).toHaveLength(1);
    expect(canonicalStat('block')).toBe('block.chance');
  });

  it('weapon attacks per second time attack skills; minions read their owner', () => {
    const fast = buildSkill('slash', [], sheet([flat('attack.speed.base', REFERENCE_APS * 1.5)]));
    const ref = buildSkill('slash', [], sheet([flat('attack.speed.base', REFERENCE_APS)]));
    expect(fast.castTime).toBeCloseTo(ref.castTime / 1.5);
    const owner = sheet([inc('minion.damage', 0.3), inc('damage', 0.2, ['minion', 'melee']), inc('damage', 0.5)]);
    const forwarded = ownerMinionMods(owner);
    expect(forwarded).toContainEqual(expect.objectContaining({ stat: 'damage', value: 0.3, kind: 'inc' }));
    expect(forwarded).toContainEqual(expect.objectContaining({ stat: 'damage', value: 0.2, tags: ['melee'] }));
    expect(forwarded.some((m) => m.value === 0.5)).toBe(false);
    expect(SKILLS.get('summon-skeletons').tags).toContain('damage');
  });

  it('ailment damage and effect scale per ailment; block.spells blocks spells', () => {
    const h = rollHit(new StatQuery(sheet([inc('bleed.damage', 0.5), inc('chill.effect', 0.2)])), attack(), new Fixed(0.5));
    expect(h.ailmentEffects?.bleed).toBeCloseTo(1.5);
    expect(h.ailmentEffects?.chill).toBeCloseTo(1.2);
    const d = { stats: sheet([flat('block', 0.7), flag('block.spells')]), life: 100, maxLife: 100, es: 0, shock: 0 };
    expect(mitigate({ source: null, tags: ['spell'], damage: { fire: 10 }, crit: false }, d, new Fixed(0.1)).result.blocked).toBe(true);
  });
});

describe('keystones reach combat', () => {
  const q = (...mods: Parameters<StatSheet['set']>[1]) => new StatQuery(sheet(mods));
  const def = (mods: Parameters<StatSheet['set']>[1] = [], life = 100) => ({ stats: sheet(mods), life, maxLife: life, es: 30, shock: 0 });

  it('attacker flags: no crits, no multiplier, unevadable, all fire', () => {
    expect(rollHit(q(flag('cannotCrit'), flat('crit.chance', 1)), attack(), new Fixed(0)).crit).toBe(false);
    const crit = rollHit(q(flag('crit.noMultiplier')), attack(), new Fixed(0.5), { crit: true });
    expect(crit.damage.physical).toBeCloseTo(10);
    expect(rollHit(q(flag('hits.cannotBeEvaded'), flat('accuracy', 500)), attack(), new Fixed(0.5)).accuracy).toBeUndefined();
    const fire = rollHit(q(flat('convert.toFire', 1), flag('nonFireDamage.none')), attack({ base: { physical: [10, 10], cold: [5, 5] } }), new Fixed(0.5));
    expect(fire.damage.fire).toBeCloseTo(15);
    expect(fire.damage.physical ?? 0).toBe(0);
  });

  it('defender flags: chaos immunity, dodge, evasion as armour, shield that guards mana', () => {
    expect(mitigate({ source: null, tags: ['spell'], damage: { chaos: 50 }, crit: false }, def([flag('immune.chaos')]), new Fixed(0.9)).result.total).toBe(0);
    expect(mitigate({ source: null, tags: ['spell'], damage: { fire: 50 }, crit: false }, def([flat('dodge.chance', 0.5)]), new Fixed(0.1)).result.evaded).toBe(true);
    const armoured = mitigate({ source: null, tags: ['attack'], damage: { physical: 20 }, crit: false, accuracy: 100 }, def([flat('evasion', 1000), flag('evasion.toArmour')]), new Fixed(0.99));
    expect(armoured.result.evaded).toBeFalsy();
    expect(armoured.result.total).toBeLessThan(20);
    const guarded = mitigate({ source: null, tags: ['spell'], damage: { fire: 20 }, crit: false }, def([flag('es.protectsMana')]), new Fixed(0.9));
    expect(guarded.toEs).toBe(0);
  });

  it('actor flags: mind over matter, rampage, instant leech, unstunnable, costs from life', () => {
    const a = new Actor({ faction: 'hero', base: { life: 100, mana: 100 } });
    a.stats.set('k', [flat('damage.toMana', 0.5)]);
    a.takeHit({ source: null, tags: ['spell'], damage: { fire: 40 }, crit: false });
    expect(a.life).toBeCloseTo(80);
    expect(a.mana).toBeCloseTo(80);
    a.stats.set('k', [flag('rampage'), flag('leech.instant'), flag('cannotBeStunned'), flag('skills.costLife')]);
    a.onKill();
    a.onKill();
    expect(a.rampage).toBe(2);
    expect(a.hasBuff('rampage')).toBe(true);
    a.leech(10);
    expect(a.life).toBeCloseTo(90);
    a.applyAilment({ id: 'stun', magnitude: 1, duration: 1 }, null);
    expect(a.stopped).toBe(false);
    expect(payCost(a, 20)).toBe(true);
    expect(a.life).toBeCloseTo(70);
    expect(payCost(a, 500)).toBe(false);
  });

  it('gear and tree recovery: life / mana / shield on kill, life.recovery, regenPct', () => {
    const a = new Actor({ faction: 'hero', base: { life: 100, mana: 50 } });
    a.stats.set('gear', [flat('life.onKill', 10), flat('mana.onKill', 5), inc('life.recovery', 1), flat('life.regenPct', 0.01)]);
    a.life = 50;
    a.mana = 10;
    a.onKill();
    expect(a.life).toBeCloseTo(70); // 10 × (1 + 100%)
    expect(a.mana).toBeCloseTo(15);
    expect(a.stats.get('life.regen.pct')).toBeCloseTo(0.01);
    a.fixedUpdate(1);
    expect(a.life).toBeGreaterThan(70 + 1.9); // 1% of 100 per second, doubled
  });

  it('tree conditions: hitRecently / notHitRecently', () => {
    const a = new Actor({ faction: 'hero' });
    a.fixedUpdate(1 / 60);
    expect(a.stats.hasCondition('notHitRecently')).toBe(true);
    a.takeHit({ source: null, tags: ['spell'], damage: { fire: 1 }, crit: false });
    a.fixedUpdate(1 / 60);
    expect(a.stats.hasCondition('hitRecently')).toBe(true);
    expect(a.stats.hasCondition('notHitRecently')).toBe(false);
  });
});

describe('hero wiring', () => {
  it('builds the bar from the sockets (old gem ids mapped, gear skill levels); defaults only for a bar with nothing socketed', () => {
    const save = { level: 1, xp: 0, gold: 0, allocated: [], equipment: {}, inventory: [], skills: [] };
    expect(slotsFromSave(save, 1).map((s) => s?.skill)).toEqual(WIRE_TUNING.defaultSkills);
    expect(usesDefaultGems(save.skills)).toBe(true);
    const gem = (id: string) => ({ uid: id, base: 'skill-gem', rarity: 'normal' as const, level: 1, name: id, affixes: [], gem: { id, level: 4, support: false } });
    const custom = { ...save, skills: [{ slot: 1, gem: gem('ice-nova'), supports: [{ ...gem('multiple-projectiles'), gem: { id: 'multiple-projectiles', level: 2, support: true } }] }] };
    const slots = slotsFromSave(custom, 1);
    expect(slots[1]).toEqual({ skill: GEM_ALIASES['ice-nova'], supports: [{ gem: 'gmp', level: 2 }], level: 4 });
    expect(slots.filter(Boolean)).toHaveLength(1); // an emptied slot stays empty
    expect(usesDefaultGems(custom.skills)).toBe(false);
    const gear = new StatSheet();
    gear.set('item:amulet', [flat('skill.level', 2)]);
    expect(slotsFromSave(custom, 1, gear)[1]!.level).toBe(6);
  });

  it('grows with its level and carries a starter sword', () => {
    const s = sheet(levelMods(5), starterWeapon());
    expect(s.get('life')).toBeCloseTo(WIRE_TUNING.hero.perLevel.life * 4);
    expect(s.get('weapon.physical.max')).toBeGreaterThan(0);
    expect(levelMods(1)).toHaveLength(0);
  });
});

describe('monster wiring', () => {
  it('monster skills become combat gems: leaps leap, looks by element', () => {
    const leap = monsterGem(MONSTER_SKILLS.get('leap'));
    expect(leap.leap).toBeDefined();
    expect(monsterGem(MONSTER_SKILLS.get('firebolt')).look.color).toBe('orange');
    const r = buildSkill(monsterGem(MONSTER_SKILLS.get('bite')), [], new StatSheet());
    expect(r.damage?.base.physical).toBeDefined();
  });

  it('names come from the theme and the body; flags become combat mods', () => {
    const b = BOSSES.all()[0]!;
    expect(monsterName({ ...b.genome, rank: 'normal' })).toMatch(/\w+ \w+/);
    expect(translateMods([flag('knockbackImmune')])[0]).toEqual(expect.objectContaining({ stat: 'mass' }));
  });

  it('every designed boss lands on the same life and damage budget whatever its parts', () => {
    const lifes: number[] = [];
    for (const def of BOSSES.all()) {
      const m = buildMonster(def.genome);
      const s = new StatSheet();
      s.set('genome', translateMods(m.stats));
      s.set('boss', bossBudget(translateMods(m.stats)));
      const q = new StatQuery(s);
      lifes.push(q.scale('life'));
      expect(q.scale('damage')).toBeCloseTo(RANK.boss.damage * WIRE_TUNING.monster.bossDamage, 5);
    }
    for (const l of lifes) expect(l).toBeCloseTo(RANK.boss.life * WIRE_TUNING.monster.bossLife, 5);
  });

  it('the first bosses ramp in: depth 1 has bossLifeEarly of the life budget, depth 5 and deeper all of it', () => {
    const m = buildMonster(BOSSES.all()[0]!.genome);
    const life = (depth: number) => {
      const s = new StatSheet();
      s.set('genome', translateMods(m.stats));
      s.set('boss', bossBudget(translateMods(m.stats), depth));
      return new StatQuery(s).scale('life');
    };
    const full = RANK.boss.life * WIRE_TUNING.monster.bossLife;
    expect(life(1)).toBeCloseTo(full * WIRE_TUNING.monster.bossLifeEarly, 5);
    expect(life(3)).toBeGreaterThan(life(1));
    expect(life(5)).toBeCloseTo(full, 5);
    expect(life(40)).toBeCloseTo(full, 5);
  });
});

describe('theme music', () => {
  it('transposes and still parses', () => {
    expect(transposeNote('B4', 1)).toBe('C5');
    expect(transposeNote('C5', -1)).toBe('B4');
    expect(transposeNote('.', 3)).toBe('.');
    const s = themeSongs('forge')!;
    for (const song of [s.level, s.combat, s.boss]) expect(() => parseSong(song)).not.toThrow();
    expect(themeSongs(undefined)).toBeUndefined();
  });
});

describe('the bot reads telegraph shapes', () => {
  const view = (tel: object[], hp = new Vector3(0, 0, 0)) => {
    const hero = { actor: { position: hp, radius: 0.35 }, skills: () => [{ slot: 'dodge', id: 'roll', remaining: 0, usable: true }] };
    const layout = { width: 20, height: 20, cell: () => 1, rooms: [], start: { x: 0, z: 0 }, exit: { x: 10, z: 10 }, path: [] };
    const level = { layout, origin: { x: -10, z: -10 }, exit: new Vector3(5, 0, 5), exitOpen: false, telegraphs: () => tel, monsters: () => [] };
    return { hero, level, loot: [], frame: 0 } as unknown as Parameters<PlaytestBot['decide']>[0];
  };

  it('steps sideways out of a line and ignores one it is not in', () => {
    const line = { at: new Vector3(0, 0, 3), radius: 3, remaining: 0.2, kind: 'line', dir: { x: 0, z: 1 }, length: 6, width: 1 };
    const d = new PlaytestBot().decide(view([line], new Vector3(0.1, 0, 2)));
    expect(Math.abs(d.move.x)).toBeGreaterThan(0.9);
    expect(d.dodge).toBe(true);
    const clear = new PlaytestBot().decide(view([line], new Vector3(3, 0, 2)));
    expect(clear.dodge).toBe(false);
  });

  it('trades blows with a plain swing at good life', () => {
    const swing = { at: new Vector3(0.5, 0, 0), radius: 1.5, remaining: 0.2, kind: 'circle', soft: true };
    expect(new PlaytestBot().decide(view([swing])).dodge).toBe(false);
  });
});

describe('StageMover on a grid', () => {
  // floor for z >= 10, and a one-cell corridor at x = 5 going -z from there
  const stage = {
    kind: 'level',
    walkable: (x: number, z: number) => (z >= 10 && z < 20 && x >= 0 && x < 12) || (Math.floor(x) === 5 && z >= 0 && z < 10),
    groundY: () => 0,
    collide: () => {},
  } as unknown as ConstructorParameters<typeof StageMover>[0];

  it('rounds the corner into a corridor it is pressed against a little off-centre', () => {
    const m = new StageMover(stage, [5.99, 0, 10.01], 0.35);
    for (let i = 0; i < 60; i++) m.move(0, -5.6, 1 / 60);
    expect(m.position.z).toBeLessThan(7);
    expect(m.position.x).toBeGreaterThan(5.34);
    expect(m.position.x).toBeLessThan(5.66);
  });

  it('still stops at a flat wall and slides along it', () => {
    const m = new StageMover(stage, [2, 0, 12], 0.35);
    for (let i = 0; i < 60; i++) m.move(0, -5.6, 1 / 60);
    expect(m.position.z).toBeGreaterThanOrEqual(10.35);
    expect(m.position.x).toBeCloseTo(2, 3);
    for (let i = 0; i < 30; i++) m.move(4, -4, 1 / 60);
    expect(m.position.x).toBeGreaterThan(3.5);
    expect(m.position.z).toBeGreaterThanOrEqual(10.35);
  });
});
