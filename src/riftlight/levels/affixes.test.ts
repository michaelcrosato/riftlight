import { Group, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Actor } from '../actors/Actor';
import { EventBus } from '../core/events';
import { flag, flat, inc, type Mod } from '../core/mods';
import type { GameEvents } from '../core/types';
import { buildLevel, type Level } from './Level';
import type { LevelHooks, MechanicElement } from './mechanics/types';
import { levelSpec } from './rift';

/**
 * Loot that bends level mechanics: every mechanic affix and unique flag changes what its
 * mechanic does (the "power-levellers exploit mechanics" promise). Each case builds the real
 * designed level headless, puts a real hero `Actor` (and monsters) next to a mechanic element
 * and compares the mechanic with and without the stat on the hero's sheet.
 */
const DT = 1 / 60;

interface Rig {
  level: Level;
  events: EventBus<GameEvents>;
  hero: Actor;
  actors: Actor[];
  monster(x: number, z: number, life?: number): Actor;
  el(mechanic: string, kind?: string): MechanicElement;
  els(mechanic: string, kind?: string): MechanicElement[];
  step(seconds: number, each?: () => void): void;
  replays: { skill: string; at: number; damageScale: number }[];
  drops: { quantity: number; source: string }[];
}

function rig(depth: number, heroMods: Mod[] = [], hooks: Partial<LevelHooks> = {}): Rig {
  const events = new EventBus<GameEvents>();
  const actors: Actor[] = [];
  const replays: Rig['replays'] = [];
  const drops: Rig['drops'] = [];
  let time = 0;
  const level = buildLevel(
    levelSpec(depth, 7),
    { scene: new Group(), events, actors: () => actors.filter((a) => a.alive), activation: -1 },
    {
      spawnMonster: () => null,
      replaySkill: (_a, skill, o) => replays.push({ skill, at: time, damageScale: o.damageScale }),
      dropLoot: (_at, o) => drops.push({ quantity: o.quantity, source: o.source }),
      ...hooks,
    },
  );
  const hero = new Actor({ faction: 'hero', base: { life: 1e5, 'life.regen': 0, mana: 100 }, mods: { gear: heroMods }, at: [level.start.x, 0, level.start.z] });
  hero.events = events;
  actors.push(hero);
  const els = (mechanic: string, kind?: string) => level.plan.elements.filter((e) => e.mechanic === mechanic && (!kind || e.kind === kind));
  return {
    level,
    events,
    hero,
    actors,
    replays,
    drops,
    monster(x, z, life = 1e6) {
      const m = new Actor({ faction: 'monster', at: [x, 0, z], base: { life, 'life.regen': 0, 'move.speed': 0 } });
      m.events = events;
      actors.push(m);
      return m;
    },
    el: (mechanic, kind) => els(mechanic, kind)[0]!,
    els,
    step(seconds, each) {
      for (let t = 0; t < seconds; t += DT) {
        time += DT;
        each?.();
        level.fixedUpdate(DT);
        level.update(DT);
      }
    },
  };
}
const put = (a: Actor, x: number, z: number) => {
  a.mover.teleport(x, 0, z);
  a.position.copy(a.mover.position);
};
const lost = (a: Actor) => a.maxLife - a.life;
/** Total push an actor gets over `seconds` while held at (x, z). */
function pushed(r: Rig, a: Actor, x: number, z: number, seconds: number): number {
  let total = 0;
  const push = a.push.bind(a);
  a.push = (v: Vector3) => {
    total += v.length();
    push(v);
  };
  r.step(seconds, () => put(a, x, z));
  a.push = push;
  return total;
}

describe('Embers: brazier affixes', () => {
  const blast = (mods: Mod[], dx = 1.2) => {
    const r = rig(1, mods);
    const b = r.el('embers', 'brazier');
    put(r.hero, b.x, b.z + 1.5);
    const m = r.monster(b.x + dx, b.z);
    const target = r.level.targets().find((t) => Math.hypot(t.position.x - b.x, t.position.z - b.z) < 0.1)!;
    target.takeHit({ source: r.hero, tags: ['attack'], damage: { physical: 1 }, crit: false });
    r.step(0.3);
    return { monster: lost(m), hero: lost(r.hero), ignited: r.hero.stats.hasCondition('ignited') };
  };
  it('`brazier.damage` and `explosion.damage` make blasts hit monsters harder', () => {
    const base = blast([]).monster;
    expect(base).toBeGreaterThan(0);
    expect(blast([inc('brazier.damage', 1)]).monster).toBeCloseTo(base * 2, -1);
    expect(blast([inc('brazier.damage', 1), inc('explosion.damage', 0.5)]).monster).toBeCloseTo(base * 3, -1);
  });
  it('`brazier.area` reaches further', () => {
    expect(blast([], 4).monster).toBe(0);
    expect(blast([inc('brazier.area', 1)], 4).monster).toBeGreaterThan(0);
  });
  it('`brazier.selfIgnite`: blasts set the hero alight instead of hurting it', () => {
    expect(blast([]).hero).toBeGreaterThan(0);
    const lit = blast([flag('brazier.selfIgnite')]);
    expect(lit.hero).toBe(0);
    expect(lit.ignited).toBe(true);
  });
});

describe('Gloom: `lantern.duration`', () => {
  const shrine = (mods: Mod[]) => {
    const r = rig(2, mods);
    for (const l of r.els('gloom', 'lantern')) {
      put(r.hero, l.x + 1, l.z);
      r.step(0.1);
    }
    return r.level.timedBuffs(r.hero).find((b) => b.source === 'mechanic:gloom:shrine')?.remaining ?? 0;
  };
  it('lights every lantern for a shrine buff that lasts longer with the stat', () => {
    const base = shrine([]);
    expect(base).toBeGreaterThan(80);
    expect(shrine([inc('lantern.duration', 1)])).toBeCloseTo(base * 2, 0);
  });
});

describe('Gale: `wind.resist` and `inWind`', () => {
  const ride = (mods: Mod[]) => {
    const r = rig(3, mods);
    const lane = r.el('gale', 'lane');
    let inWind = false;
    const total = pushed(r, r.hero, lane.x, lane.z, 8);
    r.step(4, () => {
      put(r.hero, lane.x, lane.z);
      inWind ||= r.hero.stats.hasCondition('inWind');
    });
    return { total, inWind };
  };
  it('resisting the wind pushes the hero less; Galecaller lowers it to ride gusts harder', () => {
    const base = ride([]);
    expect(base.total).toBeGreaterThan(0);
    expect(base.inWind).toBe(true);
    expect(ride([inc('wind.resist', 0.5)]).total).toBeCloseTo(base.total * 0.5, 0);
    expect(ride([inc('wind.resist', -0.5)]).total).toBeCloseTo(base.total * 1.5, 0);
  });
});

describe('Frostglass: `shatter.chance`', () => {
  const kill = (mods: Mod[]) => {
    const r = rig(4, mods);
    // a spot off the ice: the start
    const at = r.level.start;
    const victim = r.monster(at.x + 1, at.z, 1);
    const near = r.monster(at.x + 2, at.z);
    victim.die(r.hero);
    r.step(0.1);
    return lost(near);
  };
  it("the hero's kills shatter off the ice too", () => {
    expect(kill([])).toBe(0);
    expect(kill([flat('shatter.chance', 1)])).toBeGreaterThan(0);
  });
});

describe('Thornweave: `thorns.immune` and `thorns.reflect`', () => {
  const walk = (mods: Mod[]) => {
    const r = rig(5, mods);
    const patch = r.el('thornweave');
    const cell = patch.cells[0]!;
    const x = (cell % r.level.layout.width) + 0.5;
    const z = Math.floor(cell / r.level.layout.width) + 0.5;
    const m = r.monster(x, z);
    let slowed = false;
    r.step(2, () => {
      put(r.hero, x, z);
      put(m, x, z);
      slowed ||= r.hero.stats.hasCondition('inThorns');
    });
    return { hero: lost(r.hero), monster: lost(m), slowed };
  };
  it('the vines part for an immune hero; reflect makes them savage on monsters', () => {
    const base = walk([]);
    expect(base.hero).toBeGreaterThan(0);
    expect(base.slowed).toBe(true);
    const immune = walk([flag('thorns.immune')]);
    expect(immune.hero).toBe(0);
    expect(immune.slowed).toBe(false);
    expect(walk([flat('thorns.reflect', 0.5)]).monster).toBeCloseTo(base.monster * 2.5, -1);
  });
});

describe('Stormspire: `pylon.chain` and `nearPylon`', () => {
  const arc = (mods: Mod[]) => {
    const r = rig(6, mods);
    const a = r.el('stormspire', 'arc');
    const struck = r.monster(a.x, a.z);
    // far enough from the arc's line, close enough to the struck monster
    const pa = r.level.plan.elements.find((e) => e.id === a.data.a)!;
    const dx = a.x - pa.x;
    const dz = a.z - pa.z;
    const n = Math.hypot(dx, dz) || 1;
    const bystander = r.monster(a.x - (dz / n) * 2.5, a.z + (dx / n) * 2.5);
    let near = false;
    r.step(4, () => {
      put(struck, a.x, a.z);
      put(r.hero, pa.x + 1.5, pa.z);
      near ||= r.hero.stats.hasCondition('nearPylon');
    });
    return { struck: lost(struck), bystander: lost(bystander), near };
  };
  it('arcs leap on to more monsters with the stat', () => {
    const base = arc([]);
    expect(base.struck).toBeGreaterThan(0);
    expect(base.bystander).toBe(0);
    expect(base.near).toBe(true);
    expect(arc([flat('pylon.chain', 2)]).bystander).toBeGreaterThan(0);
  });
});

describe('Mire: `mire.immune` and `haste.duration`', () => {
  it('mud never slows an immune hero; haste pads last longer', () => {
    const run = (mods: Mod[]) => {
      const r = rig(7, mods);
      const mud = r.el('mire', 'mud');
      const cell = mud.cells[0]!;
      put(r.hero, (cell % r.level.layout.width) + 0.5, Math.floor(cell / r.level.layout.width) + 0.5);
      r.step(0.05);
      const inMud = r.hero.stats.hasCondition('inMud');
      const pad = r.el('mire', 'haste');
      put(r.hero, pad.x, pad.z);
      r.step(0.05);
      return { inMud, haste: r.level.timedBuffs(r.hero).find((b) => b.source === 'mechanic:mire:haste')?.remaining ?? 0 };
    };
    const base = run([]);
    expect(base.inMud).toBe(true);
    expect(base.haste).toBeGreaterThan(2);
    const geared = run([flag('mire.immune'), inc('haste.duration', 1)]);
    expect(geared.inMud).toBe(false);
    expect(geared.haste).toBeCloseTo(base.haste * 2, 0);
  });
});

describe('Echoes: `echo.damage`, `echo.delay`, `echo.repeatsSkills`', () => {
  const echo = (mods: Mod[]) => {
    const r = rig(8, mods);
    r.events.emit('skill', { actor: r.hero, skill: 'fireball' });
    r.step(5);
    return r.replays;
  };
  it('echoes hit harder, come sooner, and twice', () => {
    const base = echo([]);
    expect(base.length).toBe(1);
    expect(base[0]!.at).toBeCloseTo(2, 1);
    const geared = echo([inc('echo.damage', 1), inc('echo.delay', -0.25), flag('echo.repeatsSkills')]);
    expect(geared.length).toBe(2);
    expect(geared[0]!.at).toBeCloseTo(1.5, 1);
    expect(geared[1]!.at).toBeCloseTo(3, 1);
    expect(geared[0]!.damageScale).toBeCloseTo(base[0]!.damageScale * 2);
  });
});

describe('Riftgates: `gate.damage`', () => {
  const gate = (mods: Mod[]) => {
    const r = rig(9, mods);
    const g = r.els('riftgates').find((e) => e.data.partner !== -1)!;
    const m = r.monster(g.x, g.z);
    put(r.hero, g.x, g.z);
    r.step(0.05, () => put(m, g.x, g.z));
    return { monster: lost(m), empowered: r.level.timedBuffs(r.hero).some((b) => b.source === 'mechanic:riftgates:empower'), gated: r.hero.stats.hasCondition('recentlyGated') };
  };
  it('gates tear at monsters and empower the hero', () => {
    const base = gate([]);
    expect(base.monster).toBe(0);
    expect(base.empowered).toBe(false);
    expect(base.gated).toBe(true);
    const geared = gate([inc('gate.damage', 0.5)]);
    expect(geared.monster).toBeGreaterThan(0);
    expect(geared.empowered).toBe(true);
  });
});

describe('Bloodmoon: `explosion.damage`', () => {
  const pop = (mods: Mod[]) => {
    const r = rig(10, mods);
    const at = r.level.start;
    const corpse = r.monster(at.x + 1, at.z, 1);
    const near = r.monster(at.x + 2, at.z);
    corpse.die(r.hero);
    r.step(1);
    return lost(near);
  };
  it('corpse explosions hit harder', () => {
    const base = pop([]);
    expect(base).toBeGreaterThan(0);
    expect(pop([inc('explosion.damage', 1)])).toBeCloseTo(base * 2, -1);
  });
});

describe('Gravewell: `well.immune` and `well.resist`', () => {
  const pull = (mods: Mod[]) => {
    const r = rig(11, mods);
    const w = r.el('gravewell');
    return pushed(r, r.hero, w.x + 1.2, w.z, 6);
  };
  it('anchored heroes are pulled less, or not at all', () => {
    const base = pull([]);
    expect(base).toBeGreaterThan(0);
    expect(pull([inc('well.resist', 0.4)])).toBeCloseTo(base * 0.6, 0);
    expect(pull([flag('well.immune')])).toBe(0);
  });
});

describe('Collapse: `collapse.bonusLoot` and `collapse.fallImmune`', () => {
  it('more bonus loot under par; falls stop hurting', () => {
    const run = (mods: Mod[]) => {
      const r = rig(12, mods);
      r.events.emit('levelClear', { depth: 12, time: 1 });
      // a void cell to fall into
      const L = r.level.layout;
      let fell = 0;
      for (let i = 0; i < L.width * L.height && !fell; i++) {
        const x = i % L.width;
        const z = Math.floor(i / L.width);
        if (L.cell(x, z) !== 0) continue;
        put(r.hero, x + 0.5, z + 0.5);
        r.level.fixedUpdate(DT);
        fell = 1;
      }
      return { bonus: r.drops.find((d) => d.source === 'collapse:bonus')?.quantity ?? 0, hurt: lost(r.hero) };
    };
    const base = run([]);
    expect(base.bonus).toBe(3);
    expect(base.hurt).toBeGreaterThan(0);
    const geared = run([inc('collapse.bonusLoot', 1), flag('collapse.fallImmune')]);
    expect(geared.bonus).toBe(6);
    expect(geared.hurt).toBe(0);
  });
});
