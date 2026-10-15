import { Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { decodeState, encodeState } from '../../engine/snapshot';
import { inc, more } from '../core/mods';
import type { Hit } from '../core/types';
import { Actor, setActorIds } from './Actor';
import { ActorManager } from './ActorManager';

// Save-states (docs/GAME.md): an actor saved mid-fight and loaded into one made the same way
// plays on exactly as the original did.

const DT = 1 / 60;
const hit = (h: Partial<Hit>): Hit => ({ source: null, tags: ['spell'], damage: {}, crit: false, ...h });
/** Through JSON the way `engine.snapshot()` keeps it. */
const kept = <T>(v: T): T => decodeState(JSON.parse(JSON.stringify(encodeState(v)))) as T;

/** A hero and a monster in a manager, ids from 1, the same every time. */
function pair() {
  setActorIds(1);
  const m = new ActorManager();
  const hero = m.add(new Actor({ faction: 'hero', at: [0, 0, 0], base: { life: 300, 'life.regen': 0 } }));
  const mon = m.add(new Actor({ faction: 'monster', at: [2, 0, 1], base: { life: 900, 'life.regen': 2, 'move.speed': 3 } }));
  const index = (id: number | null) => [hero, mon].find((a) => a.id === id) ?? null;
  return { m, hero, mon, index };
}

/** Hit and step a pair the same way (what each side plays after the snapshot). */
function play(p: ReturnType<typeof pair>, frames: number): void {
  for (let i = 0; i < frames; i++) {
    if (i % 20 === 0) p.mon.takeHit(hit({ source: p.hero, damage: { fire: 25, physical: 10 }, ailments: { ignite: 1 } }));
    p.mon.push(new Vector3(0.5, 0, 0.25));
    p.m.fixedUpdate(DT);
  }
}

const look = (p: ReturnType<typeof pair>) => ({ life: p.mon.life, at: p.mon.position.toArray(), buffs: [...p.mon.buffs], ailments: p.mon.ailments.map((a) => [a.id, a.remaining, a.source?.id ?? null]), damage: p.mon.stats.get('damage'), speed: p.mon.stats.get('move.speed') });

describe('Actor save-state', () => {
  it('comes back as it was: life, stat sources in order, a buff that never ends, ailments and their source, timers', () => {
    const a = pair();
    a.mon.addBuff('forever', [inc('damage', 0.2)], 0); // expires at Infinity
    a.mon.addBuff('haste', [more('move.speed', 0.3)], 2);
    a.mon.stats.set('gear', [inc('damage', 0.1)]);
    play(a, 50);
    const s = kept({ hero: a.hero.save(), mon: a.mon.save(), m: a.m.save() });
    expect(s.mon.buffs.find(([k]) => k === 'forever')![1]).toBe(Infinity);
    play(a, 150);
    const went = look(a);

    const b = pair();
    b.hero.load(s.hero, b.index);
    b.mon.load(s.mon, b.index);
    b.m.load(s.m);
    for (const x of [b.hero, b.mon]) x.mover.teleport(x.position.x, x.position.y, x.position.z); // the mover is its owner's to place
    expect(kept(b.mon.save())).toEqual(s.mon);
    expect(b.mon.ailments.some((x) => x.source === b.hero)).toBe(true); // the source found again by id
    play(b, 150);
    expect(look(b)).toEqual(went);
  });

  it('the spatial hash keeps only actors still here: one that left this step is not saved, so a load gives the same save', () => {
    const a = pair();
    a.m.fixedUpdate(DT); // the cells are built with both in them
    a.m.remove(a.mon);
    const s = kept(a.m.save());
    expect(s.cells.flatMap(([, ids]) => ids)).not.toContain(a.mon.id);
    const b = pair();
    b.m.remove(b.mon);
    b.m.load(s);
    expect(kept(b.m.save())).toEqual(s);
  });

  it('a load replaces: a buff and an actor that came after the snapshot are gone', () => {
    const a = pair();
    const s = kept({ mon: a.mon.save(), m: a.m.save() });
    a.mon.addBuff('late', [inc('move.speed', 1)], 0);
    const extra = a.m.add(new Actor({ faction: 'monster', at: [5, 0, 5] }));
    a.mon.load(s.mon, a.index);
    a.m.load(s.m);
    expect([a.mon.hasBuff('late'), a.mon.stats.get('move.speed'), a.m.actors.includes(extra)]).toEqual([false, 3, false]);
  });
});
