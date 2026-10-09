import { describe, expect, it } from 'vitest';
import { EASE_NAMES, EASES, Tweens, ease } from './tween';

describe('eases', () => {
  it('start at 0 and end at 1', () => {
    for (const name of EASE_NAMES) {
      expect(EASES[name](0), name).toBeCloseTo(0, 6);
      expect(EASES[name](1), name).toBeCloseTo(1, 6);
    }
  });
  it('clamp the input', () => {
    expect(ease('linear', -1)).toBe(0);
    expect(ease('linear', 2)).toBe(1);
    expect(ease((u) => u * 0.5, 1)).toBe(0.5);
  });
  it('back overshoots, steps hold', () => {
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => EASES.outBack(i / 49)))).toBeGreaterThan(1.05);
    expect(EASES.steps4(0.3)).toBe(0.25);
    expect(EASES.steps4(0.49)).toBe(0.25);
    expect(EASES.steps4(0.5)).toBe(0.5);
  });
});

describe('Tweens', () => {
  it('moves properties over the duration and completes', async () => {
    const tw = new Tweens();
    const o = { x: 0, y: 10 };
    let completed = 0;
    const t = tw.to(o, { x: 4 }, { duration: 1, ease: 'linear', onComplete: () => completed++ });
    tw.update(0.25);
    expect(o.x).toBeCloseTo(1);
    expect(o.y).toBe(10);
    tw.update(0.75);
    expect(o.x).toBe(4);
    expect(t.active).toBe(false);
    expect(completed).toBe(1);
    expect(tw.count).toBe(0);
    expect(await t.done).toBe(true);
  });

  it('reads the start value after the delay', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    tw.to(o, { x: 10 }, { duration: 1, delay: 0.5, ease: 'linear' });
    o.x = 5; // changed before the tween starts
    tw.update(0.5);
    expect(o.x).toBe(5);
    tw.update(0.5);
    expect(o.x).toBeCloseTo(7.5);
  });

  it('uses the rest of a frame after a delay', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    tw.to(o, { x: 1 }, { duration: 1, delay: 0.25, ease: 'linear' });
    tw.update(0.5);
    expect(o.x).toBeCloseTo(0.25);
  });

  it('yoyos and repeats', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    tw.to(o, { x: 2 }, { duration: 1, yoyo: true, repeat: 1, ease: 'linear' });
    tw.update(1.5);
    expect(o.x).toBeCloseTo(1); // half way back
    tw.update(0.5);
    expect(o.x).toBe(0);
    expect(tw.count).toBe(0);
  });

  it('loops forever until cancelled', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    const t = tw.to(o, { x: 1 }, { duration: 0.1, repeat: Infinity });
    for (let i = 0; i < 100; i++) tw.update(1 / 60);
    expect(t.active).toBe(true);
    t.cancel(true);
    expect(o.x).toBe(1);
    expect(t.active).toBe(false);
  });

  it('a new tween takes over the same property', () => {
    const tw = new Tweens();
    const o = { x: 0, y: 0 };
    const a = tw.to(o, { x: 10, y: 10 }, { duration: 1, ease: 'linear' });
    tw.update(0.5);
    tw.to(o, { x: -10 }, { duration: 1, ease: 'linear' });
    tw.update(0.5);
    expect(o.y).toBe(10); // the first tween still owns y
    expect(o.x).toBeCloseTo(-2.5); // the second owns x: from 5 toward -10
    expect(a.active).toBe(false);
  });

  it('a takeover of every property stops the old tween', () => {
    const tw = new Tweens();
    const o = { x: 0 };
    let done = 0;
    const a = tw.to(o, { x: 10 }, { duration: 1, onComplete: () => done++ });
    tw.to(o, { x: 1 }, { duration: 1 });
    expect(a.active).toBe(false);
    tw.update(2);
    expect(done).toBe(0);
  });

  it('value() and call()', () => {
    const tw = new Tweens();
    const seen: number[] = [];
    let called = 0;
    tw.value(10, 20, { duration: 1, ease: 'linear' }, (v) => seen.push(v));
    tw.call(0.5, () => called++);
    tw.update(0.4);
    expect(called).toBe(0);
    tw.update(0.2);
    expect(called).toBe(1);
    tw.update(1);
    expect(seen.at(-1)).toBe(20);
    expect(seen[0]).toBeCloseTo(14);
  });

  it('clear() resolves pending tweens as not completed', async () => {
    const tw = new Tweens();
    const t = tw.to({ x: 0 }, { x: 1 }, { duration: 10 });
    tw.clear();
    expect(await t.done).toBe(false);
    expect(tw.count).toBe(0);
  });

  it('cancel(target) stops only that target', () => {
    const tw = new Tweens();
    const a = { x: 0 };
    const b = { x: 0 };
    tw.to(a, { x: 1 }, { duration: 1 });
    tw.to(b, { x: 1 }, { duration: 1 });
    tw.cancel(a);
    tw.update(1);
    expect(a.x).toBe(0);
    expect(b.x).toBe(1);
  });
});
