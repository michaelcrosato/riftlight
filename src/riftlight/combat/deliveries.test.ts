import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { flat, inc } from '../core/mods';
import type { LightRequest } from '../core/types';
import { Actor } from '../actors/Actor';
import { ActorManager } from '../actors/ActorManager';
import { buildSkill } from '../skills/build';
import type { SupportLink } from '../skills/types';
import { Combat } from './Combat';

const DT = 1 / 60;

function world(o: { wallX?: number } = {}) {
  const actors = new ActorManager();
  const wall = o.wallX === undefined ? undefined : (a: Vector3, b: Vector3) => ((a.x - o.wallX!) * (b.x - o.wallX!) <= 0 && a.x !== b.x ? (o.wallX! - a.x) / (b.x - a.x) : null);
  const combat = new Combat({ actors, wall });
  // a hero with a sword and plenty of mana
  const hero = actors.add(new Actor({ faction: 'hero', base: { mana: 500, 'mana.regen': 0, life: 500 }, mods: { weapon: [flat('weapon.physical.min', 10), flat('weapon.physical.max', 10)] } }));
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      actors.fixedUpdate(DT);
      combat.fixedUpdate(DT);
      actors.update(DT, 1);
      combat.update(DT);
    }
  };
  const dummy = (x: number, z: number, life = 1000) => actors.add(new Actor({ faction: 'monster', at: [x, 0, z], base: { life, 'life.regen': 0, evasion: 0 } }));
  const skill = (id: string, supports: SupportLink[] = []) => buildSkill(id, supports, hero.stats);
  return { actors, combat, hero, run, dummy, skill };
}
const hurt = (a: Actor) => a.maxLife - a.life;

describe('strike', () => {
  it('hits enemies in the arc in front, not behind or out of reach', () => {
    const w = world();
    const front = w.dummy(0, 1.5);
    const side = w.dummy(1.2, 0.9);
    const behind = w.dummy(0, -1.5);
    const far = w.dummy(0, 4);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('slash'), new Vector3(0, 0, 5));
    expect(hurt(front)).toBeGreaterThan(0);
    expect(hurt(side)).toBeGreaterThan(0);
    expect(hurt(behind)).toBe(0);
    expect(hurt(far)).toBe(0);
  });
  it('the last combo step is a stronger finisher', () => {
    const w = world();
    const a = w.dummy(0, 1.5, 1e6);
    w.actors.rebuild();
    const s = w.skill('slash');
    w.combat.cast(w.hero, s, new Vector3(0, 0, 5), { combo: 0 });
    const first = hurt(a);
    w.run(20);
    w.combat.cast(w.hero, s, new Vector3(0, 0, 5), { combo: 2 });
    expect(hurt(a) - first).toBeGreaterThan(first * 1.3);
  });
  it('melee hits freeze attacker and target (hit-stop) and knock the target back', () => {
    const w = world();
    const a = w.dummy(0, 1.5);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('heavy-strike'), new Vector3(0, 0, 5));
    expect(w.hero.hitStop).toBeGreaterThan(0);
    expect(a.hitStop).toBeGreaterThan(0);
    w.run(30);
    expect(a.position.z).toBeGreaterThan(2);
  });
  it('multistrike repeats the strike', () => {
    const w = world();
    const a = w.dummy(0, 1.5, 1e6);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('cleave', ['multistrike']), new Vector3(0, 0, 5));
    w.run(40);
    expect(a.counters.hitsTaken).toBe(3);
  });
});

describe('projectile', () => {
  it('flies, hits the first enemy and stops', () => {
    const w = world();
    const a = w.dummy(0, 6);
    const b = w.dummy(0, 8);
    w.combat.cast(w.hero, w.skill('ice-spear', []), new Vector3(0, 0, 10));
    // ice spear pierces twice by default: use fireball for a plain projectile
    w.run(60);
    expect(hurt(a)).toBeGreaterThan(0);
    expect(hurt(b)).toBeGreaterThan(0);
    const w2 = world();
    const c = w2.dummy(0, 6);
    const d = w2.dummy(0, 8);
    w2.combat.cast(w2.hero, w2.skill('chaos-bolt'), new Vector3(0, 0, 10));
    w2.run(90);
    expect(hurt(c)).toBeGreaterThan(0);
    expect(hurt(d)).toBe(0);
  });
  it('several projectiles fan out', () => {
    const w = world();
    const left = w.dummy(-2, 6);
    const mid = w.dummy(0, 7);
    const right = w.dummy(2, 6);
    w.combat.cast(w.hero, w.skill('split-arrow'), new Vector3(0, 0, 10));
    w.run(60);
    expect([left, mid, right].every((a) => hurt(a) > 0)).toBe(true);
  });
  it('chains to the next enemy', () => {
    const w = world();
    const a = w.dummy(0, 5);
    const b = w.dummy(4, 7);
    w.combat.cast(w.hero, w.skill('arc'), new Vector3(0, 0, 10));
    w.run(60);
    expect(hurt(a)).toBeGreaterThan(0);
    expect(hurt(b)).toBeGreaterThan(0);
  });
  it('forks into two on the first hit', () => {
    const w = world();
    const a = w.dummy(0, 4);
    const l = w.dummy(-2.2, 8);
    const r = w.dummy(2.2, 8);
    w.combat.cast(w.hero, w.skill('chaos-bolt', ['fork']), new Vector3(0, 0, 10));
    w.run(120);
    expect(hurt(a)).toBeGreaterThan(0);
    expect(hurt(l) > 0 || hurt(r) > 0).toBe(true);
  });
  it('homing projectiles curve onto targets off their line', () => {
    const w = world();
    const a = w.dummy(3, 7);
    w.combat.cast(w.hero, w.skill('chaos-bolt'), new Vector3(0, 0, 10));
    w.run(120);
    expect(hurt(a)).toBeGreaterThan(0);
  });
  it('walls stop projectiles', () => {
    const w = world({ wallX: 2 });
    const a = w.dummy(4, 0);
    w.combat.cast(w.hero, w.skill('ice-spear'), new Vector3(10, 0, 0));
    w.run(60);
    expect(hurt(a)).toBe(0);
    expect(w.combat.active('projectile')).toEqual([]);
  });
  it('explosive projectiles splash around the impact', () => {
    const w = world();
    const a = w.dummy(0, 6);
    const near = w.dummy(1, 6.5);
    w.combat.cast(w.hero, w.skill('fireball'), new Vector3(0, 0, 10));
    w.run(60);
    expect(hurt(a)).toBeGreaterThan(0);
    expect(hurt(near)).toBeGreaterThan(0);
  });
  it('asks for a dynamic light while in flight; a light pool can claim it', () => {
    const w = world();
    const seen: LightRequest[] = [];
    w.actors.events.on('light', (r) => {
      seen.push(r);
      r.claimed = true;
    });
    w.combat.cast(w.hero, w.skill('fireball'), new Vector3(0, 0, 10));
    expect(seen.length).toBe(1);
    expect(seen[0]!.alive!()).toBe(true);
    w.run(120);
    expect(seen[0]!.alive!()).toBe(false);
  });
});

describe('slam', () => {
  it('waits for the telegraph, then hits the area', () => {
    const w = world();
    const a = w.dummy(0, 6);
    w.combat.cast(w.hero, w.skill('meteor'), new Vector3(0, 0, 6));
    w.run(30);
    expect(hurt(a)).toBe(0);
    w.run(40);
    expect(hurt(a)).toBeGreaterThan(0);
  });
  it('leap slam carries the caster to the target and hits where it lands', () => {
    const w = world();
    const a = w.dummy(0, 5.5);
    w.combat.cast(w.hero, w.skill('leap-slam'), new Vector3(0, 0, 5));
    let top = 0;
    for (let i = 0; i < 60; i++) {
      w.run(1);
      top = Math.max(top, w.hero.position.y);
    }
    expect(top).toBeGreaterThan(0.5);
    // lands in front of the enemy at the aim point, not on it
    expect(w.hero.position.z).toBeGreaterThan(4);
    expect(w.hero.position.z).toBeLessThan(5.5 - a.radius - w.hero.radius + 0.2);
    expect(w.hero.position.y).toBe(0);
    expect(hurt(a)).toBeGreaterThan(0);
  });
});

describe('nova', () => {
  it('hits everything around the caster once', () => {
    const w = world();
    const ring = [w.dummy(2, 0), w.dummy(-2, 0), w.dummy(0, 3)];
    const out = w.dummy(0, 6);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('frost-nova'), new Vector3(0, 0, 1));
    w.run(30);
    expect(ring.every((a) => a.counters.hitsTaken === 1)).toBe(true);
    expect(hurt(out)).toBe(0);
    expect(ring[0]!.chill).toBeGreaterThan(0);
  });
  it('a channel (whirlwind) pulses while held, pays mana, and stops on release', () => {
    const w = world();
    const a = w.dummy(1.5, 0, 1e6);
    w.actors.rebuild();
    let held = true;
    const mana = w.hero.mana;
    w.combat.cast(w.hero, w.skill('whirlwind'), new Vector3(0, 0, 1), { held: () => held });
    w.run(60);
    expect(a.counters.hitsTaken).toBeGreaterThanOrEqual(3);
    expect(w.hero.mana).toBeLessThan(mana - 7);
    held = false;
    w.run(2);
    const n = a.counters.hitsTaken;
    w.run(60);
    expect(a.counters.hitsTaken).toBe(n);
    expect(w.combat.active('nova')).toEqual([]);
  });
  it('war cry debuffs nearby enemies and buffs the caster', () => {
    const w = world();
    const a = w.dummy(2, 0);
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('war-cry'), new Vector3(0, 0, 1));
    expect(w.hero.hasBuff('war-cry')).toBe(true);
    expect(a.hasBuff('war-cry:debuff')).toBe(true);
  });
});

describe('beam', () => {
  it('hits everything along the line every tick while channelled', () => {
    const w = world();
    const a = w.dummy(0, 3, 1e6);
    const b = w.dummy(0.3, 6, 1e6);
    const off = w.dummy(3, 4, 1e6);
    w.actors.rebuild();
    let held = true;
    w.combat.cast(w.hero, w.skill('searing-beam'), new Vector3(0, 0, 9), { held: () => held, aimNow: () => new Vector3(0, 0, 9) });
    w.run(61);
    expect(a.counters.hitsTaken).toBeGreaterThanOrEqual(5);
    expect(b.counters.hitsTaken).toBeGreaterThanOrEqual(5);
    expect(off.counters.hitsTaken).toBe(0);
    held = false;
    w.run(5);
    expect(w.combat.active('beam')).toEqual([]);
  });
  it('is cut short by walls', () => {
    const w = world({ wallX: 2 });
    const a = w.dummy(4, 0, 1e6);
    w.combat.cast(w.hero, w.skill('searing-beam'), new Vector3(9, 0, 0), { held: () => true });
    w.run(30);
    expect(a.counters.hitsTaken).toBe(0);
  });
});

describe('dash', () => {
  it('dodge roll moves the caster with i-frames', () => {
    const w = world();
    w.combat.cast(w.hero, w.skill('dodge-roll'), new Vector3(5, 0, 0));
    expect(w.hero.iframes).toBeGreaterThan(0.2);
    w.run(40);
    expect(w.hero.position.x).toBeCloseTo(4.2, 0);
  });
  it('a dash hits enemies along its path', () => {
    const w = world();
    const a = w.dummy(3, 0.3);
    w.combat.cast(w.hero, w.skill('shield-charge'), new Vector3(10, 0, 0));
    w.run(40);
    expect(hurt(a)).toBeGreaterThan(0);
    expect(w.hero.position.x).toBeGreaterThan(6);
  });
  it('blink teleports toward the aim, stopping before walls', () => {
    const w = world({ wallX: 3 });
    w.combat.cast(w.hero, w.skill('blink'), new Vector3(6, 0, 0));
    expect(w.hero.position.x).toBeGreaterThan(2);
    expect(w.hero.position.x).toBeLessThan(3);
    const w2 = world();
    w2.combat.cast(w2.hero, w2.skill('blink'), new Vector3(0, 0, 4));
    expect(w2.hero.position.z).toBeCloseTo(4);
  });
});

describe('summon', () => {
  it('raises minions that fight enemies and expire', () => {
    const w = world();
    const foe = w.dummy(3, 4, 1e6);
    w.combat.cast(w.hero, w.skill('summon-skeletons'), new Vector3(0, 0, 3));
    const minions = w.actors.actors.filter((a) => a.tags.includes('minion'));
    expect(minions.length).toBe(3);
    expect(minions.every((m) => m.owner === w.hero && m.faction === 'hero')).toBe(true);
    w.run(240);
    expect(foe.counters.hitsTaken).toBeGreaterThan(0);
    w.run(60 * 20);
    expect(w.actors.actors.filter((a) => a.tags.includes('minion') && a.alive).length).toBe(0);
  });
  it('keeps at most two batches per owner', () => {
    const w = world();
    const s = w.skill('summon-skeletons');
    for (let i = 0; i < 4; i++) w.combat.cast(w.hero, s, new Vector3(0, 0, 3));
    expect(w.actors.actors.filter((a) => a.tags.includes('summon-skeletons') && a.alive).length).toBe(6);
  });
  it('minion supports reach the minions', () => {
    const w = world();
    w.combat.cast(w.hero, w.skill('summon-skeletons', ['minion-life']), new Vector3(0, 0, 3));
    const m = w.actors.actors.find((a) => a.tags.includes('minion'))!;
    expect(m.maxLife).toBeCloseTo(60 * 1.45);
  });
  it('a summon factory can replace the placeholder', () => {
    const w = world();
    const made: string[] = [];
    w.combat.summonFactory = (req) => {
      made.push(req.genome);
      return new Actor({ faction: req.owner.faction, at: req.at, tags: [req.skill.id] });
    };
    w.combat.cast(w.hero, w.skill('raise-spectre'), new Vector3(0, 0, 3));
    expect(made).toEqual(['spectre']);
  });
});

describe('aura', () => {
  it('buffs allies in range while on; casting again turns it off', () => {
    const w = world();
    const ally = w.actors.add(new Actor({ faction: 'hero', at: [2, 0, 0], order: 1 }));
    const s = w.skill('haste-aura');
    const speed = w.hero.moveSpeed;
    w.combat.cast(w.hero, s, new Vector3());
    w.run(2);
    expect(w.hero.moveSpeed).toBeCloseTo(speed * 1.12);
    expect(ally.hasBuff('aura:haste-aura')).toBe(true);
    w.combat.cast(w.hero, s, new Vector3());
    expect(w.combat.active('aura')).toEqual([]);
    expect(w.hero.hasBuff('aura:haste-aura')).toBe(false);
    w.run(60);
    expect(ally.hasBuff('aura:haste-aura')).toBe(false);
  });
});

describe('trap', () => {
  it('arms, then explodes when an enemy walks in', () => {
    const w = world();
    const t = w.skill('fire-trap');
    w.combat.cast(w.hero, t, new Vector3(0, 0, 5));
    const a = w.dummy(0, 9);
    w.run(60);
    expect(hurt(a)).toBe(0);
    a.mover.teleport(0, 0, 5.5);
    a.position.copy(a.mover.position);
    w.run(3);
    expect(hurt(a)).toBeGreaterThan(0);
  });
  it('flame wall burns whoever stands in it, tick after tick', () => {
    const w = world();
    const a = w.dummy(0.5, 5, 1e6);
    const off = w.dummy(4, 5, 1e6);
    w.combat.cast(w.hero, w.skill('flame-wall'), new Vector3(0, 0, 5));
    w.run(60);
    expect(a.counters.hitsTaken).toBeGreaterThanOrEqual(3);
    expect(off.counters.hitsTaken).toBe(0);
    w.run(60 * 4);
    expect(w.combat.active('zone')).toEqual([]);
  });
});

describe('combat runtime', () => {
  it('emits hit, kill and death on the bus and counts them', () => {
    const w = world();
    const a = w.dummy(0, 1.5, 5);
    w.actors.rebuild();
    const seen: string[] = [];
    w.actors.events.onAny((t) => seen.push(String(t)));
    w.combat.cast(w.hero, w.skill('heavy-strike'), new Vector3(0, 0, 5));
    expect(seen).toEqual(['skill', 'hit', 'death', 'kill']);
    expect(a.alive).toBe(false);
    expect(w.combat.stats.kills).toBe(1);
    expect(w.combat.numbers.floaters.length).toBe(1);
  });
  it('leech heals the caster from the damage dealt', () => {
    const w = world();
    w.hero.life = 100;
    const a = w.dummy(0, 1.5, 1e6);
    w.actors.rebuild();
    w.hero.stats.set('test', [flat('leech.life', 0.5), inc('damage', 5)]);
    w.combat.cast(w.hero, w.skill('heavy-strike'), new Vector3(0, 0, 5));
    const dealt = hurt(a);
    w.run(120);
    expect(w.hero.life).toBeGreaterThan(100 + Math.min(dealt * 0.5, 50) * 0.9);
  });
  it('allies are never hit', () => {
    const w = world();
    const ally = w.actors.add(new Actor({ faction: 'hero', at: [0, 0, 1.5] }));
    w.actors.rebuild();
    w.combat.cast(w.hero, w.skill('cleave'), new Vector3(0, 0, 5));
    expect(hurt(ally)).toBe(0);
  });
});
