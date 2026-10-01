import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three/webgpu';
import { type AssignItem, FLICKER_PRESETS, LightAssigner, LightPool, flicker } from './lights';
import { QUALITY } from '../quality';

const item = (score: number, fade = 0.2): AssignItem => ({ score, alive: true, fadeIn: fade, fadeOut: fade, slot: -1, level: 0 });
const DT = 1 / 60;

function run<T extends AssignItem>(a: LightAssigner<T>, items: T[], seconds: number, each?: (t: number) => void): void {
  for (let t = 0; t < seconds; t += DT) {
    each?.(t);
    a.step(DT, items);
  }
}

describe('LightAssigner', () => {
  it('lights the most important requests, never more than its capacity', () => {
    const a = new LightAssigner<AssignItem>(3);
    const items = [1, 9, 3, 7, 5, 2].map((s) => item(s));
    run(a, items, 1);
    const lit = items.filter((i) => i.slot >= 0).map((i) => i.score).sort((x, y) => y - x);
    expect(lit).toEqual([9, 7, 5]);
    expect(items.filter((i) => i.level === 1)).toHaveLength(3);
    expect(new Set(items.filter((i) => i.slot >= 0).map((i) => i.slot)).size).toBe(3);
  });

  it('fades: levels never jump by more than dt / fade per step', () => {
    const a = new LightAssigner<AssignItem>(2);
    const items = [item(5), item(4), item(1)];
    let prev = items.map((i) => i.level);
    let maxDelta = 0;
    run(a, items, 3, (t) => {
      // Mid-way the third one becomes the most important: a hand-over must fade.
      if (t > 1) items[2]!.score = 20;
      const now = items.map((i) => i.level);
      for (let k = 0; k < now.length; k++) maxDelta = Math.max(maxDelta, Math.abs(now[k]! - prev[k]!));
      prev = now;
    });
    // Fade-outs run at 2× while someone waits: ≤ 2·dt/fade.
    expect(maxDelta).toBeLessThanOrEqual((2 * DT) / 0.2 + 1e-9);
    expect(items[2]!.slot).toBeGreaterThanOrEqual(0);
    expect(items[2]!.level).toBe(1);
    expect(items[1]!.slot).toBe(-1); // the weakest holder gave its light away
  });

  it('hysteresis: two near-equal requests do not trade the light back and forth', () => {
    const a = new LightAssigner<AssignItem>(1);
    const x = item(10);
    const y = item(9.5);
    let swaps = 0;
    let owner: AssignItem | null = null;
    run(a, [x, y], 4, (t) => {
      // Scores wobble around each other (a flickering torch pair, a moving camera).
      x.score = 10 + Math.sin(t * 9);
      y.score = 10 + Math.cos(t * 9);
      const o = a.slots[0] ?? null;
      if (o !== owner) {
        swaps++;
        owner = o;
      }
    });
    expect(swaps).toBeLessThanOrEqual(1); // only the initial assignment
  });

  it('released requests fade out and give their slot to the next one', () => {
    const a = new LightAssigner<AssignItem>(1);
    const x = item(10);
    const y = item(2);
    run(a, [x, y], 0.5);
    expect(x.slot).toBe(0);
    x.alive = false;
    a.step(DT, [x, y]);
    expect(x.level).toBeGreaterThan(0); // still fading, no pop
    run(a, [x, y], 1);
    expect(x.slot).toBe(-1);
    expect(y.slot).toBe(0);
    expect(y.level).toBe(1);
  });

  it('zero-score (out of range) requests are never lit', () => {
    const a = new LightAssigner<AssignItem>(4);
    const items = [item(0), item(0), item(3)];
    run(a, items, 0.5);
    expect(items.map((i) => i.slot >= 0)).toEqual([false, false, true]);
  });
});

describe('LightPool', () => {
  it('keeps a constant number of real lights, sized by quality', () => {
    expect([QUALITY.low.lights, QUALITY.medium.lights, QUALITY.high.lights]).toEqual([4, 8, 16]);
    const parent = new Object3D();
    const pool = new LightPool({ size: 4, parent });
    const focus = new Vector3();
    const handles = Array.from({ length: 30 }, (_, i) => pool.request({ position: [i * 2, 1.5, 0], intensity: 5, radius: 6, flicker: 'torch' }));
    for (let i = 0; i < 120; i++) {
      focus.x = i * 0.5; // the camera walks along the row of torches
      pool.update(DT, focus, 12);
      expect(pool.lights).toHaveLength(4);
      expect(parent.children[0]!.children).toHaveLength(4);
      for (const l of pool.lights) expect(l.visible).toBe(true);
    }
    const s = pool.stats();
    expect(s.lit).toBeLessThanOrEqual(4);
    expect(s.assignments).toBeGreaterThan(4); // lights moved with the camera
    // The lit ones are the torches closest to the focus.
    const lit = handles.filter((h) => h.lit).map((h) => h.position.x);
    for (const x of lit) expect(Math.abs(x - focus.x)).toBeLessThan(10);
    handles.forEach((h) => h.release());
    for (let i = 0; i < 60; i++) pool.update(DT, focus, 12);
    expect(pool.stats().requests).toBe(0);
    for (const l of pool.lights) expect(l.intensity).toBe(0);
  });

  it('follows objects, auto-releases after a lifetime, and resizes', () => {
    const pool = new LightPool({ size: 2 });
    const target = new Object3D();
    target.position.set(3, 0, 4);
    target.updateMatrixWorld();
    const h = pool.request({ follow: target, offset: [0, 1, 0], intensity: 3, lifetime: 0.5 });
    pool.update(DT, new Vector3(), 20);
    expect(h.position.toArray()).toEqual([3, 1, 4]);
    expect(pool.lights[h.lit ? 0 : 1]!.position.toArray()).toEqual([3, 1, 4]);
    for (let i = 0; i < 60; i++) pool.update(DT, new Vector3(), 20);
    expect(h.alive).toBe(false);
    pool.resize(5);
    expect(pool.size).toBe(5);
    expect(pool.group.children).toHaveLength(5);
  });

  it('flicker presets stay bright and deterministic', () => {
    for (const p of FLICKER_PRESETS) {
      let min = Infinity;
      let max = -Infinity;
      for (let t = 0; t < 10; t += 0.01) {
        const f = flicker(p, t, 7);
        min = Math.min(min, f);
        max = Math.max(max, f);
      }
      expect(min, p).toBeGreaterThan(0.3);
      expect(max, p).toBeLessThan(1.8);
      expect(flicker(p, 1.234, 3)).toBe(flicker(p, 1.234, 3));
    }
  });
});
