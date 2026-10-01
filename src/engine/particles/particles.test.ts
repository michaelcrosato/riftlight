import { describe, expect, it } from 'vitest';
import { rng } from '../audio/synth';
import { PALETTE } from '../palette';
import { ParticlePool, type ParticlePreset } from './pool';
import { PARTICLES } from './presets';

const base: ParticlePreset = { count: 10, life: 1, speed: 2, size: [4, 0], colors: ['white', 'mist', 'slate', 'night'] };

describe('ParticlePool', () => {
  it('spawns, ages, steps colors and sizes in whole pixels, then frees the slots', () => {
    const pool = new ParticlePool(base);
    expect(pool.spawn([0, 0, 0], {}, rng(3))).toBe(10);
    expect(pool.alive).toBe(10);
    expect(pool.colorAt(0)).toBe('white');
    expect(pool.sizeAt(0)).toBe(4);
    pool.step(0.6);
    expect(pool.colorAt(0)).toBe('slate');
    expect(Number.isInteger(pool.sizeAt(0))).toBe(true);
    expect(pool.sizeAt(0)).toBe(2);
    pool.step(0.5);
    expect(pool.alive).toBe(0);
  });

  it('keeps alive particles packed when lifetimes differ', () => {
    const pool = new ParticlePool({ ...base, life: [0.1, 1] });
    pool.spawn([0, 0, 0], { count: 50 }, rng(7));
    pool.step(0.5);
    for (let i = 0; i < pool.alive; i++) expect(pool.age[i]!).toBeLessThan(pool.life[i]!);
    expect(pool.alive).toBeGreaterThan(0);
    expect(pool.alive).toBeLessThan(50);
  });

  it('respects the cone, flatten, gravity and the pool limit', () => {
    const pool = new ParticlePool({ ...base, count: 400, max: 64, spread: 30, direction: [1, 0, 0], gravity: 10, flatten: 1 });
    expect(pool.spawn([0, 0, 0], {}, rng(1))).toBe(64);
    expect(pool.spawn([0, 0, 0], {}, rng(1))).toBe(0); // full
    for (let i = 0; i < pool.alive; i++) {
      const [vx, vy, vz] = [pool.vel[i * 3]!, pool.vel[i * 3 + 1]!, pool.vel[i * 3 + 2]!];
      expect(vx / Math.hypot(vx, vy, vz)).toBeGreaterThan(Math.cos((30 * Math.PI) / 180) - 1e-6);
    }
    const vy0 = pool.vel[1]!;
    pool.step(0.1);
    expect(pool.vel[1]!).toBeCloseTo(vy0 - 1);
  });

  it('per-burst colors and scale', () => {
    const pool = new ParticlePool(base);
    pool.spawn([0, 0, 0], { count: 1, colors: ['red'], scale: 2 }, rng(2));
    expect(pool.colorAt(0)).toBe('red');
    expect(pool.sizeAt(0)).toBe(8);
  });

  it('built-in presets only use palette colors and whole-pixel sizes', () => {
    for (const [name, p] of Object.entries(PARTICLES) as [string, ParticlePreset][]) {
      for (const c of p.colors) expect(PALETTE, name).toHaveProperty(c);
      expect(p.size.every((s) => Number.isInteger(s) && s >= 0), name).toBe(true);
    }
  });
});
