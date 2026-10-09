import { describe, expect, it } from 'vitest';
import { BulletPool, emitter } from './bullets';

describe('BulletPool', () => {
  it('moves, ages and swaps dead bullets out', () => {
    const p = new BulletPool(8);
    p.fire(0, 0, 1, 0, { life: 1 });
    p.fire(0, 0, 0, 2, { life: 3 });
    p.step(0.5);
    expect(p.alive).toBe(2);
    expect(p.state[0]).toBeCloseTo(0.5);
    p.step(0.6);
    expect(p.alive).toBe(1);
    expect(p.state[1]).toBeCloseTo(2.2); // the survivor moved into slot 0
  });

  it('walls stop bullets and leave sparks', () => {
    const p = new BulletPool(4);
    p.fire(0, 0, 10, 0);
    p.step(0.2, (x) => x < 1);
    expect(p.alive).toBe(0);
    expect(p.sparks).toEqual([2, 0]);
  });

  it('hits are circles, by team', () => {
    const p = new BulletPool(4);
    p.fire(1, 0, 0, 0, { radius: 0.1 });
    p.fire(1, 0, 0, 0, { radius: 0.1, team: 'player' });
    expect(p.hits(1.15, 0, 0.1, 'enemy')).toEqual([0]);
    expect(p.hits(1.5, 0, 0.1, 'enemy')).toEqual([]);
    expect(p.hits(1, 0, 0.1, 'player')).toEqual([1]);
  });

  it('a full pool refuses more', () => {
    const p = new BulletPool(2);
    expect(p.fire(0, 0, 0, 0)).toBe(0);
    expect(p.fire(0, 0, 0, 0)).toBe(1);
    expect(p.fire(0, 0, 0, 0)).toBe(-1);
  });
});

describe('emitter', () => {
  it('fires on its timer, after its delay', () => {
    const p = new BulletPool(100);
    const e = emitter({ pattern: 'ring', every: 0.5, count: 8, delay: 0.25 });
    e.update(p, 0.5, [0, 0]);
    expect(p.alive).toBe(0);
    e.update(p, 0.3, [0, 0]);
    expect(p.alive).toBe(8);
    expect(e.volleys).toBe(1);
  });

  it('rings spread evenly; fans aim at the target', () => {
    const p = new BulletPool(100);
    emitter({ pattern: 'ring', every: 1, count: 4, speed: 1 }).update(p, 1, [0, 0]);
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < p.alive; i++) {
      sx += p.state[i * 4 + 2]!;
      sz += p.state[i * 4 + 3]!;
    }
    expect(Math.hypot(sx, sz)).toBeLessThan(1e-6);
    p.clear();
    emitter({ pattern: 'fan', every: 1, count: 3, spread: 40, speed: 2 }).update(p, 1, [0, 0], [10, 0]);
    expect(p.state[4 + 2]).toBeCloseTo(2); // the middle bullet heads straight at +X
  });

  it('a spiral turns between volleys; bursts are seeded', () => {
    const p = new BulletPool(100);
    const s = emitter({ pattern: 'spiral', every: 0.1, count: 1, turn: 90, speed: 1 });
    s.update(p, 0.2, [0, 0]);
    const a0 = Math.atan2(p.state[2]!, p.state[3]!);
    const a1 = Math.atan2(p.state[6]!, p.state[7]!);
    expect(Math.abs(a1 - a0)).toBeCloseTo(Math.PI / 2);
    const fire = () => {
      const q = new BulletPool(50);
      emitter({ pattern: 'burst', every: 1, count: 10, seed: 5 }).update(q, 1, [0, 0], [1, 0]);
      return [...q.state.slice(0, 40)];
    };
    expect(fire()).toEqual(fire());
  });

  it('killAll kills exactly the bullets it is given, whatever the order', () => {
    const pool = new BulletPool(10);
    for (let i = 0; i < 6; i++) pool.fire(i, 0, 0, 0, { kind: i });
    pool.killAll([0, 5, 3]); // ascending: a naive loop would kill the moved bullet instead
    expect([...pool.kind.slice(0, pool.alive)].sort()).toEqual([1, 2, 4]);
  });

  it('an aimed stream flies at the target, fastest first, never backwards', () => {
    const pool = new BulletPool(50);
    emitter({ pattern: 'aimed', every: 1, count: 12, speed: 6 }).update(pool, 1, [0, 0], [0, 10]);
    expect(pool.alive).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(pool.state[i * 4 + 3]).toBeGreaterThanOrEqual(3 - 1e-6); // vz: toward +Z, at least half speed
      expect(Math.abs(pool.state[i * 4 + 2]!)).toBeLessThan(1e-6);
    }
  });

  it('a wave sweeps back and forth', () => {
    const pool = new BulletPool(500);
    const em = emitter({ pattern: 'wave', every: 0.1, count: 1, speed: 5, sweep: 40, period: 2 });
    const angles: number[] = [];
    for (let k = 0; k < 20; k++) {
      em.update(pool, 0.1, [0, 0], [0, 10]);
      const i = pool.alive - 1;
      angles.push(Math.atan2(pool.state[i * 4 + 2]!, pool.state[i * 4 + 3]!));
    }
    expect(Math.max(...angles)).toBeGreaterThan(0.5);
    expect(Math.min(...angles)).toBeLessThan(-0.5);
  });

  it('never hangs or floods: every ≤ 0 and a long hitch fire a few volleys at most', () => {
    const pool = new BulletPool(10000);
    emitter({ pattern: 'ring', every: 0, count: 4 }).update(pool, 1, [0, 0]);
    emitter({ pattern: 'ring', every: 0.06, count: 4 }).update(pool, 5, [0, 0]);
    expect(pool.alive).toBeLessThanOrEqual(2 * 8 * 4);
  });

  it('near filters by team; graze counts each bullet once, never its own team', () => {
    const pool = new BulletPool(10);
    pool.fire(0.3, 0, 0, 0, { team: 'enemy' });
    pool.fire(0.2, 0, 0, 0, { team: 'player' });
    expect(pool.near(0, 0, 1)).toBe(2);
    expect(pool.near(0, 0, 1, 'enemy')).toBe(1);
    expect(pool.graze(0, 0, 1, 'enemy')).toBe(1);
    expect(pool.graze(0, 0, 1, 'enemy')).toBe(0);
  });

  it('kill ignores indices out of range; killAll kills a listed bullet once', () => {
    const pool = new BulletPool(10);
    pool.kill(0);
    expect(pool.alive).toBe(0);
    for (let i = 0; i < 4; i++) pool.fire(i, 0, 0, 0, { kind: i });
    pool.killAll([1, 1, 3]);
    expect([...pool.kind.slice(0, pool.alive)].sort()).toEqual([0, 2]);
  });
});
