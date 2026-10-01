import { Group, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { flag, flat, inc, type Mod, override } from '../core/mods';
import { Actor } from '../actors/Actor';
import { ActorManager } from '../actors/ActorManager';
import { buildSkill } from '../skills/build';
import type { SupportLink } from '../skills/types';
import { CHARGE_TUNING } from './charges';
import { Combat } from './Combat';
import { Trap, TRAP_TUNING } from './deliveries/trap';
import { TotemEffect, TOTEM_TUNING } from './totems';
import { PLACEMENT } from './tuning';

/**
 * The build systems the tree and loot feed: charges, curses, totems, traps, aura
 * reservation, and the smaller stats (stun.duration, weapon class tags, thorns, aura.radius).
 */
const DT = 1 / 60;

function world(extra: Record<string, Mod[]> = {}) {
  const scene = new Group();
  const actors = new ActorManager(undefined, scene);
  const combat = new Combat({ actors });
  const hero = actors.add(
    new Actor({
      faction: 'hero',
      base: { mana: 500, 'mana.regen': 0, life: 500, 'life.regen': 0 },
      mods: { weapon: [flat('weapon.physical.min', 10), flat('weapon.physical.max', 10)], ...extra },
    }),
  );
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      actors.fixedUpdate(DT);
      combat.fixedUpdate(DT);
      actors.update(DT, 1);
      combat.update(DT);
    }
  };
  const dummy = (x: number, z: number, life = 1000, mods: Mod[] = []) =>
    actors.add(new Actor({ faction: 'monster', at: [x, 0, z], base: { life, 'life.regen': 0, evasion: 0, 'move.speed': 0 }, mods: { test: mods } }));
  const skill = (id: string, supports: SupportLink[] = []) => buildSkill(id, supports, hero.stats);
  return { scene, actors, combat, hero, run, dummy, skill };
}
const hurt = (a: Actor) => a.maxLife - a.life;
const ahead = new Vector3(0, 0, 5);

describe('charges', () => {
  it('kills grant the charge `charge.onKill` is scoped to, and each charge is a stat source', () => {
    const w = world({ tree: [flat('charge.onKill', 1, ['frenzy'])] });
    const d = w.dummy(0, 1.5, 1);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('slash'), ahead);
    expect(d.alive).toBe(false);
    expect(w.hero.charges.count).toEqual({ endurance: 0, frenzy: 1, power: 0 });
    expect(w.hero.stats.explain('damage').some((e) => e.source === 'charges' && e.mod.kind === 'more')).toBe(true);
    expect(w.hero.stats.get('attack.speed')).toBe(0); // inc only: the base comes from the weapon
    expect(w.hero.stats.explain('attack.speed').find((e) => e.source === 'charges')?.mod.value).toBeCloseTo(0.04);
  });

  it('caps at 3 + `<type>.max` and all drop when `charge.duration` runs out', () => {
    const w = world({ tree: [flat('frenzy.max', 1)], mastery: [inc('charge.duration', 0.5)] });
    for (let i = 0; i < 9; i++) w.hero.charges.gain('frenzy');
    expect(w.hero.charges.count.frenzy).toBe(CHARGE_TUNING.baseMax + 1);
    expect(w.hero.charges.left.frenzy).toBeCloseTo(CHARGE_TUNING.duration * 1.5);
    w.run(Math.round(CHARGE_TUNING.duration * 60));
    expect(w.hero.charges.count.frenzy).toBe(4);
    w.run(Math.round(CHARGE_TUNING.duration * 0.6 * 60));
    expect(w.hero.charges.count.frenzy).toBe(0);
    expect(w.hero.stats.hasSource('charges')).toBe(false);
  });

  it('endurance charges harden you; frenzy hits harder; power crits more', () => {
    const w = world();
    w.hero.charges.gain('endurance', 3);
    expect(w.hero.stats.get('res.physical')).toBeCloseTo(0.12);
    expect(w.hero.stats.get('res.fire')).toBeCloseTo(0.12);
    w.hero.charges.gain('power', 2);
    expect(w.hero.stats.explain('crit.chance').find((e) => e.source === 'charges')?.mod.value).toBeCloseTo(0.8);
  });

  it('Enduring Cry grants endurance; supports grant charges on hit, crit and stun', () => {
    const w = world();
    w.combat.cast(w.hero, w.skill('enduring-cry'), ahead);
    expect(w.hero.charges.count.endurance).toBe(2);
    // Frenzy Charge on Hit: 20% a hit
    const d = w.dummy(0, 1.5, 1e7);
    w.actors.rebuild();
    const s = w.skill('slash', ['frenzy-charge-on-hit']);
    for (let i = 0; i < 40 && !w.hero.charges.count.frenzy; i++) {
      w.combat.cast(w.hero, s, ahead);
      w.run(2);
    }
    expect(w.hero.charges.count.frenzy).toBeGreaterThan(0);
    // Power Charge on Critical with every hit a crit
    w.hero.stats.set('crit', [override('crit.chance', 1)]);
    w.combat.cast(w.hero, w.skill('slash', ['power-charge-on-crit']), ahead);
    w.run(2);
    expect(w.hero.charges.count.power).toBeGreaterThan(0);
    expect(hurt(d)).toBeGreaterThan(0);
  });

  it('Discharge spends every charge for much more damage', () => {
    const one = (charges: number) => {
      const w = world({ crit: [override('crit.chance', 0)] });
      const d = w.dummy(0, 1.5, 1e7, [override('res.lightning', 0), override('res.fire', 0)]);
      w.actors.rebuild();
      w.hero.charges.gain('frenzy', Math.min(3, charges));
      w.hero.charges.gain('power', Math.max(0, charges - 3));
      // the frenzy bonus itself shouldn't count: measure the spell with charges stripped first
      const s = w.skill('discharge');
      w.combat.cast(w.hero, s, ahead);
      return { dealt: hurt(d), left: w.hero.charges.total };
    };
    const none = one(0);
    const six = one(6);
    expect(six.left).toBe(0);
    // 1 + 0.6 × 6 = 4.6× (rolls vary a little): well over twice
    expect(six.dealt).toBeGreaterThan(none.dealt * 2.5);
  });
});

describe('curses', () => {
  it('a curse gem hexes every enemy in its circle and shows on them', () => {
    const w = world();
    const inside = [w.dummy(0, 5), w.dummy(1, 5.5), w.dummy(-1, 4.5)];
    const outside = w.dummy(0, 12);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('vulnerability'), ahead);
    for (const d of inside) {
      expect(d.curses.has('vulnerability')).toBe(true);
      expect(d.stats.get('damage.taken', ['physical'])).toBeCloseTo(1.3);
    }
    expect(outside.curses.list.length).toBe(0);
    w.run(1);
    expect(inside[0]!.status?.cursed).toBe(true);
    expect(inside[0]!.fx.tinted).toBe(true);
  });

  it('`curse.count` lets more curses stay; the oldest makes way', () => {
    const w = world();
    const d = w.dummy(0, 5);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('vulnerability'), ahead);
    w.combat.cast(w.hero, w.skill('enfeeble'), ahead);
    expect(d.curses.list.map((c) => c.id)).toEqual(['enfeeble']);
    w.hero.stats.set('tree', [flat('curse.count', 1)]);
    w.combat.cast(w.hero, w.skill('elemental-weakness'), ahead);
    expect(d.curses.list.map((c) => c.id)).toEqual(['enfeeble', 'elemental-weakness']);
  });

  it('`curse.effect` scales the mods, `curse.duration` the time', () => {
    const w = world({ tree: [inc('curse.effect', 0.5), inc('curse.duration', 1)] });
    const d = w.dummy(0, 5, 1000, [flat('res.fire', 0.4)]);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('elemental-weakness'), ahead);
    expect(d.stats.get('res.fire')).toBeCloseTo(0.4 - 0.25 * 1.5);
    w.run(60 * 11);
    expect(d.curses.has('elemental-weakness')).toBe(true);
    w.run(60 * 2);
    expect(d.curses.has('elemental-weakness')).toBe(false);
  });

  it('`curse.immune` shrugs curses off (elites, a corrupted body armour)', () => {
    const w = world();
    const d = w.dummy(0, 5, 1000, [flag('curse.immune')]);
    w.actors.rebuild();
    const outcomes: string[] = [];
    w.actors.events.on('curse', (e) => outcomes.push(e.outcome));
    w.combat.cast(w.hero, w.skill('temporal-chains'), ahead);
    expect(outcomes).toEqual(['immune']);
    expect(d.curses.list.length).toBe(0);
  });

  it('Temporal Chains slows actions; Enfeeble weakens hits', () => {
    const w = world();
    const d = w.dummy(0, 5);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('temporal-chains'), ahead);
    expect(d.actionSpeed).toBeCloseTo(0.7);
    w.combat.cast(w.hero, w.skill('enfeeble'), ahead);
    expect(d.stats.explain('damage').some((e) => e.source === 'curse:enfeeble')).toBe(true);
  });
});

describe('totems', () => {
  it('Spell Totem plants a totem that casts the skill at enemies, for its owner', () => {
    const w = world();
    const d = w.dummy(0, 7, 1e6);
    w.actors.rebuild();
    const s = w.skill('fireball', ['spell-totem']);
    expect(s.placement).toBe('totem');
    expect(s.tags).toContain('totem');
    expect(s.castTime).toBeCloseTo(PLACEMENT.totemTime);
    w.combat.cast(w.hero, s, ahead);
    const totem = w.actors.actors.find((a) => a.tags.includes('totem'))!;
    expect(totem.owner).toBe(w.hero);
    expect(totem.faction).toBe('hero');
    expect(totem.maxLife).toBeCloseTo(w.hero.maxLife * TOTEM_TUNING.life);
    w.run(120);
    expect(hurt(d)).toBeGreaterThan(0);
    expect(w.combat.active('totem')[0] instanceof TotemEffect && (w.combat.active('totem')[0] as TotemEffect).brain.casts).toBeGreaterThan(0);
  });

  it('`totem.count` keeps more; `totem.life` and `totem.speed` scale them; they expire', () => {
    const w = world();
    const s = () => w.skill('arc', ['spell-totem']);
    w.combat.cast(w.hero, s(), ahead);
    w.combat.cast(w.hero, s(), ahead);
    expect(w.actors.actors.filter((a) => a.tags.includes('totem') && a.alive).length).toBe(1);
    w.hero.stats.set('tree', [flat('totem.count', 1), inc('totem.life', 1), inc('totem.speed', 1)]);
    expect(s().castTime).toBeCloseTo(PLACEMENT.totemTime / 2);
    w.combat.cast(w.hero, s(), ahead);
    const alive = w.actors.actors.filter((a) => a.tags.includes('totem') && a.alive);
    expect(alive.length).toBe(2);
    expect(alive[1]!.maxLife).toBeCloseTo(w.hero.maxLife * TOTEM_TUNING.life * 2);
    w.run(Math.round(TOTEM_TUNING.duration * 60) + 5);
    expect(w.actors.actors.filter((a) => a.tags.includes('totem') && a.alive).length).toBe(0);
  });

  it("Ancestral Bond: the hero's own skills deal nothing, its totems still do; totem kills feed the owner's charges", () => {
    const w = world({ keystone: [flag('cannotDealDamage.self'), flat('charge.onKill', 1, ['power'])] });
    const d = w.dummy(0, 1.5, 1e6);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('slash'), ahead);
    expect(hurt(d)).toBe(0);
    const weak = w.dummy(0, 6, 5);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('arc', ['spell-totem']), new Vector3(0, 0, 6));
    w.run(120);
    expect(weak.alive).toBe(false);
    expect(w.hero.charges.count.power).toBeGreaterThan(0);
  });
});

describe('traps', () => {
  it('the Trap support throws the skill as a trap that releases it when an enemy comes near', () => {
    const w = world();
    const s = w.skill('fireball', ['trap-support']);
    expect(s.placement).toBe('trap');
    expect(s.tags).toContain('trap');
    w.combat.cast(w.hero, s, new Vector3(0, 0, 6));
    const trap = w.combat.active('trap')[0] as Trap;
    expect(trap.at.z).toBeCloseTo(6);
    w.run(60);
    expect(trap.sprung).toBe(false);
    const d = w.dummy(0, 6.4, 1e6);
    w.actors.rebuild();
    w.run(60);
    expect(trap.sprung).toBe(true);
    expect(hurt(d)).toBeGreaterThan(0);
  });

  it('`trap.count` limits armed traps (3 by default); `trap.speed` throws faster', () => {
    const w = world();
    for (let i = 0; i < 5; i++) w.combat.cast(w.hero, w.skill('fire-trap'), new Vector3(i - 2, 0, 6));
    w.run(2);
    expect(w.combat.active('trap').length).toBe(TRAP_TUNING.baseCount);
    const base = w.skill('fire-trap').castTime;
    w.hero.stats.set('tree', [flat('trap.count', 2), inc('trap.speed', 0.25)]);
    for (let i = 0; i < 5; i++) w.combat.cast(w.hero, w.skill('fire-trap'), new Vector3(i - 2, 0, 6));
    w.run(2);
    expect(w.combat.active('trap').length).toBe(TRAP_TUNING.baseCount + 2);
    expect(w.skill('fire-trap').castTime).toBeCloseTo(base / 1.25);
  });
});

describe('auras reserve mana', () => {
  it('an aura holds its reservation while on and gives it back when toggled off', () => {
    const w = world();
    const haste = w.skill('haste-aura');
    expect(haste.reservation).toBeCloseTo(0.25);
    w.combat.cast(w.hero, haste, ahead);
    expect(w.hero.reservedFraction).toBeCloseTo(0.25);
    expect(w.hero.mana).toBeCloseTo(375);
    w.run(30);
    expect(w.hero.mana).toBeLessThanOrEqual(375);
    w.combat.cast(w.hero, haste, ahead); // off
    expect(w.hero.reservedFraction).toBe(0);
  });

  it('`mana.reservation` and Enlighten shrink it; an aura that does not fit stays off', () => {
    const w = world({ tree: [inc('mana.reservation', -0.2)] });
    expect(w.skill('determination').reservation).toBeCloseTo(0.4 * 0.8);
    expect(w.skill('determination', ['enlighten']).reservation).toBeCloseTo(0.4 * 0.8 * 0.7);
    w.hero.stats.set('tree', []);
    for (const id of ['haste-aura', 'wrath', 'determination']) w.combat.cast(w.hero, w.skill(id), ahead);
    expect(w.hero.reservedFraction).toBeCloseTo(1);
    w.combat.cast(w.hero, w.skill('haste-aura'), ahead); // off
    w.hero.stats.set('more', [inc('mana.reservation', 1)]);
    expect(w.combat.cast(w.hero, w.skill('haste-aura'), ahead)).toBeNull(); // 50% doesn't fit in 25%
    expect(w.hero.reservedFraction).toBeCloseTo(0.75);
  });

  it('Blood Magic reserves life instead; `aura.radius` widens the aura', () => {
    const w = world({ keystone: [flag('skills.costLife')] });
    w.combat.cast(w.hero, w.skill('haste-aura'), ahead);
    expect(w.hero.life).toBeCloseTo(375);
    expect(w.hero.mana).toBe(500);
    const r = (s: ReturnType<typeof w.skill>) => (s.delivery.kind === 'aura' ? s.delivery.radius : 0);
    const base = r(w.skill('wrath'));
    w.hero.stats.set('tree', [inc('aura.radius', 0.2)]);
    expect(r(w.skill('wrath'))).toBeCloseTo(base * 1.2);
  });
});

describe('the rest of the stats', () => {
  it('`stun.duration` stretches stuns', () => {
    const stun = (mods: Mod[]) => {
      const w = world({ tree: mods, weapon: [flat('weapon.physical.min', 400), flat('weapon.physical.max', 400)] });
      const d = w.dummy(0, 1.5, 4000);
      w.actors.rebuild();
      w.combat.cast(w.hero, w.skill('heavy-strike'), ahead, { combo: 0 });
      return d.ailments.find((a) => a.id === 'stun')?.duration ?? 0;
    };
    const base = stun([]);
    expect(base).toBeGreaterThan(0);
    // the hit rolls a little differently each time; the duration doubles
    const ratio = stun([inc('stun.duration', 1)]) / base;
    expect(ratio).toBeGreaterThan(1.95);
    expect(ratio).toBeLessThan(2.05);
  });

  it('attacks carry the weapon class, so class-scoped mods reach them', () => {
    const w = world({ item: [flag('weapon.axe'), flag('weapon.twohand')] });
    const s = w.skill('cleave');
    expect(s.tags).toEqual(expect.arrayContaining(['axe', 'twohand']));
    expect(w.skill('fireball').tags).not.toContain('axe'); // spells don't
    const q = (mods: Mod[]) => {
      w.hero.stats.set('tree', mods);
      return w.hero.stats.get('damage', w.skill('cleave').tags);
    };
    expect(q([inc('damage', 0.5, ['twohand'])])).toBe(q([inc('damage', 0.5)]));
    expect(q([inc('damage', 0.5, ['sword'])])).toBe(q([]));
  });

  it('`thorns.reflect` hurts melee attackers', () => {
    const w = world({ item: [flat('thorns.reflect', 0.5)] });
    const d = w.dummy(0, 1.5, 1000);
    w.actors.rebuild();
    const swat = buildSkill('slash', [], d.stats);
    d.facing = Math.PI;
    w.combat.cast(d, swat, new Vector3(0, 0, 0));
    const taken = w.hero.maxLife - w.hero.life;
    expect(taken).toBeGreaterThan(0);
    expect(hurt(d)).toBeCloseTo(taken * 0.5, 0);
  });
});
