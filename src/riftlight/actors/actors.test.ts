import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { inc } from '../core/mods';
import { Rng } from '../core/rng';
import type { Hit } from '../core/types';
import { Actor } from './Actor';
import { ActorManager } from './ActorManager';
import { GridMover, openFloor } from './movers';

const DT = 1 / 60;
const hit = (h: Partial<Hit>): Hit => ({ source: null, tags: ['spell'], damage: {}, crit: false, ...h });
const monster = (at: [number, number, number] = [0, 0, 0], base: Record<string, number> = {}) => new Actor({ faction: 'monster', at, base });
const steps = (m: ActorManager, n: number) => {
  for (let i = 0; i < n; i++) m.fixedUpdate(DT);
};

describe('Actor', () => {
  it('starts full and regenerates life and mana', () => {
    const a = monster([0, 0, 0], { life: 200, 'life.regen': 10, mana: 40, 'mana.regen': 20 });
    expect(a.life).toBe(200);
    a.life = 100;
    a.mana = 0;
    for (let i = 0; i < 60; i++) a.fixedUpdate(DT);
    expect(a.life).toBeCloseTo(110, 0);
    expect(a.mana).toBeCloseTo(20, 0);
  });
  it('energy shield recharges after a delay without hits', () => {
    const a = monster([0, 0, 0], { es: 30, 'life.regen': 0 });
    a.takeHit(hit({ damage: { fire: 30 } }));
    expect(a.es).toBe(0);
    expect(a.life).toBe(100);
    for (let i = 0; i < 90; i++) a.fixedUpdate(DT);
    expect(a.es).toBe(0);
    for (let i = 0; i < 180; i++) a.fixedUpdate(DT);
    expect(a.es).toBeGreaterThan(20);
  });
  it('buffs are sheet sources that expire', () => {
    const a = monster();
    a.addBuff('haste', [inc('move.speed', 0.5)], 1);
    expect(a.moveSpeed).toBeCloseTo(7.5);
    for (let i = 0; i < 61; i++) a.fixedUpdate(DT);
    expect(a.hasBuff('haste')).toBe(false);
    expect(a.moveSpeed).toBeCloseTo(5);
  });
  it('conditions follow the actor state', () => {
    const a = monster([0, 0, 0], { 'life.regen': 0 });
    a.stats.set('tree', [inc('damage', 1, undefined, 'lowLife')]);
    a.takeHit(hit({ damage: { fire: 70 } }));
    a.fixedUpdate(DT);
    expect(a.stats.explain('damage').length).toBe(1);
    a.velocity.set(3, 0, 0);
    a.fixedUpdate(DT);
    expect(a.stats.explain('x').length).toBe(0);
  });
  it('ignite burns over time and can kill, crediting the source', () => {
    const m = new ActorManager();
    const killer = m.add(new Actor({ faction: 'hero' }));
    const a = m.add(monster([0, 0, 0], { life: 100, 'life.regen': 0 }));
    const kills: unknown[] = [];
    m.events.on('kill', (e) => kills.push(e.killer));
    a.takeHit(hit({ source: killer, damage: { fire: 60 }, ailments: { ignite: 1 } }));
    expect(a.life).toBeCloseTo(40);
    steps(m, 60);
    expect(a.life).toBeCloseTo(10, 0);
    steps(m, 60);
    expect(a.alive).toBe(false);
    expect(kills).toEqual([killer]);
    expect(killer.counters.kills).toBe(1);
  });
  it('chill slows movement and actions, freeze stops them', () => {
    const a = monster([0, 0, 0], { life: 1000 });
    a.takeHit(hit({ damage: { cold: 400 } }));
    expect(a.chill).toBeCloseTo(0.3);
    expect(a.moveSpeed).toBeCloseTo(3.5);
    expect(a.actionSpeed).toBeCloseTo(0.7);
    a.applyAilment({ id: 'freeze', magnitude: 1, duration: 0.5 }, null);
    expect(a.stopped).toBe(true);
    expect(a.actionSpeed).toBe(0);
    a.velocity.set(5, 0, 0);
    a.fixedUpdate(DT);
    expect(a.position.x).toBe(0);
    for (let i = 0; i < 40; i++) a.fixedUpdate(DT);
    expect(a.stopped).toBe(false);
  });
  it('shock increases the damage it takes', () => {
    const a = monster([0, 0, 0], { life: 10000 });
    a.applyAilment({ id: 'shock', magnitude: 0.5, duration: 2 }, null);
    a.takeHit(hit({ damage: { fire: 100 } }));
    expect(a.life).toBeCloseTo(10000 - 150);
  });
  it('i-frames make hits miss', () => {
    const a = monster();
    a.iframes = 0.3;
    const r = a.takeHit(hit({ damage: { fire: 1000 } }));
    expect(r.evaded).toBe(true);
    expect(a.life).toBe(100);
  });
  it('knockback pushes away from the hit and fades out', () => {
    const a = monster([2, 0, 0], { life: 1000 });
    a.takeHit(hit({ damage: { physical: 1 }, knockback: 6, from: new Vector3(0, 0, 0) }));
    expect(a.impulse.x).toBeCloseTo(6);
    for (let i = 0; i < 30; i++) a.fixedUpdate(DT);
    expect(a.position.x).toBeGreaterThan(2.4);
    expect(a.impulse.length()).toBeLessThan(0.1);
  });
  it('heavy actors are pushed less', () => {
    const a = monster([0, 0, 0], { mass: 4 });
    a.push(new Vector3(8, 0, 0));
    expect(a.impulse.x).toBe(2);
  });
  it('hit-stop freezes movement for N steps', () => {
    const a = monster([0, 0, 0], { life: 1000 });
    a.takeHit(hit({ damage: { physical: 5 }, hitStop: 3 }));
    a.velocity.set(6, 0, 0);
    for (let i = 0; i < 3; i++) a.fixedUpdate(DT);
    expect(a.position.x).toBe(0);
    a.fixedUpdate(DT);
    expect(a.position.x).toBeGreaterThan(0);
  });
  it('leech returns life over time at a capped rate', () => {
    const a = monster([0, 0, 0], { life: 100, 'life.regen': 0 });
    a.life = 10;
    a.leech(50);
    a.fixedUpdate(DT);
    expect(a.life).toBeCloseTo(10 + 100 * 0.2 * DT);
    for (let i = 0; i < 200; i++) a.fixedUpdate(DT);
    expect(a.life).toBeCloseTo(60);
  });
  it('emits hit, death and kill events', () => {
    const m = new ActorManager();
    m.depth = 7;
    const a = m.add(monster());
    const seen: string[] = [];
    m.events.onAny((t) => seen.push(String(t)));
    a.takeHit(hit({ damage: { fire: 30 } }));
    a.takeHit(hit({ damage: { fire: 300 } }));
    expect(seen).toEqual(['hit', 'hit', 'death', 'kill']);
    expect(a.alive).toBe(false);
    const kill: { depth: number }[] = [];
    m.events.on('kill', (e) => kill.push(e));
    const b = m.add(monster());
    b.takeHit(hit({ damage: { fire: 300 } }));
    expect(kill[0]!.depth).toBe(7);
  });
  it('ragdoll corpses are removed once their death visuals end', () => {
    const m = new ActorManager();
    const a = m.add(monster());
    const removed: number[] = [];
    m.onRemove = (x) => removed.push(x.id);
    a.die();
    for (let i = 0; i < 240; i++) {
      m.fixedUpdate(DT);
      m.update(DT, 1);
    }
    expect(removed).toEqual([a.id]);
    expect(m.actors).toEqual([]);
  });
});

describe('ActorManager', () => {
  it('updates in order: hero, minions, monsters', () => {
    const m = new ActorManager();
    const order: string[] = [];
    const brain = (name: string) => ({ think: () => order.push(name) });
    m.add(new Actor({ faction: 'monster', brain: brain('monster') }));
    m.add(new Actor({ faction: 'hero', order: 1, brain: brain('minion') }));
    m.add(new Actor({ faction: 'hero', brain: brain('hero') }));
    m.fixedUpdate(DT);
    expect(order).toEqual(['hero', 'minion', 'monster']);
  });
  it('spatial hash queries match brute force', () => {
    const m = new ActorManager();
    const r = new Rng('hash');
    for (let i = 0; i < 300; i++) m.add(monster([r.range(-40, 40), 0, r.range(-40, 40)]));
    m.rebuild();
    for (let k = 0; k < 30; k++) {
      const c = new Vector3(r.range(-40, 40), 0, r.range(-40, 40));
      const rad = r.range(0.5, 9);
      const got = m.query(c, rad).map((a) => a.id).sort();
      const want = m.actors.filter((a) => Math.hypot(a.position.x - c.x, a.position.z - c.z) <= rad + a.radius).map((a) => a.id).sort();
      expect(got).toEqual(want);
    }
  });
  it('queries return nearest first and filter', () => {
    const m = new ActorManager();
    const far = m.add(monster([3, 0, 0]));
    const near = m.add(monster([1, 0, 0]));
    m.add(new Actor({ faction: 'hero', at: [0.5, 0, 0] }));
    m.rebuild();
    expect(m.query(new Vector3(), 5, [], (a) => a.faction === 'monster')).toEqual([near, far]);
    expect(m.nearest(new Vector3(), 5, (a) => a.faction === 'monster')).toBe(near);
  });
});

describe('GridMover', () => {
  it('slides along walls and never leaves the walkable floor', () => {
    const mover = new GridMover(openFloor(2), [1.5, 0, 0], 0.4);
    for (let i = 0; i < 60; i++) mover.move(3, 3, DT);
    expect(mover.position.x).toBeLessThanOrEqual(1.6);
    expect(mover.position.z).toBeCloseTo(1.6, 1);
  });
  it('leaps with a vertical launch and lands', () => {
    const mover = new GridMover(openFloor(), [0, 0, 0]);
    mover.move(0, 0, DT, 6);
    let top = 0;
    for (let i = 0; i < 60; i++) {
      mover.move(0, 0, DT);
      top = Math.max(top, mover.position.y);
    }
    expect(top).toBeGreaterThan(0.4);
    expect(mover.position.y).toBe(0);
  });
});

describe('separation', () => {
  it('overlapping actors push apart, the lighter one more', () => {
    const m = new ActorManager();
    const heavy = m.add(new Actor({ faction: 'hero', at: [0, 0, 0], base: { mass: 3 } }));
    const light = m.add(new Actor({ faction: 'monster', at: [0.3, 0, 0] }));
    for (let i = 0; i < 30; i++) m.fixedUpdate(1 / 60);
    const gap = light.position.x - heavy.position.x;
    expect(gap).toBeGreaterThan(heavy.radius + light.radius - 0.05);
    expect(Math.abs(light.position.x - 0.3)).toBeGreaterThan(Math.abs(heavy.position.x));
  });
});
