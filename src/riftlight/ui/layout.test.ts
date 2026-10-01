import { describe, expect, it } from 'vitest';
import { BannerQueue, HudLayout, overlaps } from './layout';

describe('HudLayout', () => {
  it('places a rect where it is when free, else steps it up past what is taken', () => {
    const l = new HudLayout();
    l.clear(480, 270);
    l.reserve({ x: 100, y: 100, w: 80, h: 30 });
    const free = l.place({ x: 300, y: 100, w: 40, h: 10 });
    expect(free).toEqual({ x: 300, y: 100, w: 40, h: 10 });
    const moved = l.place({ x: 120, y: 120, w: 40, h: 10 }, { step: 11 })!;
    expect(moved.y).toBeLessThan(100);
    expect(l.taken.filter((t) => t !== moved).some((t) => overlaps(t, moved))).toBe(false);
  });

  it('gives up (null) when there is no room within its tries, and keeps rects on screen', () => {
    const l = new HudLayout();
    l.clear(120, 270);
    l.reserve({ x: 0, y: 0, w: 120, h: 270 });
    expect(l.place({ x: 10, y: 100, w: 20, h: 8 })).toBeNull();
    l.clear(120, 270);
    const r = l.place({ x: 110, y: 50, w: 40, h: 8 })!;
    expect(r.x + r.w).toBeLessThanOrEqual(119);
  });

  it('labels that want the same spot stack instead of overlapping', () => {
    const l = new HudLayout();
    l.clear(480, 270);
    const a = l.place({ x: 200, y: 150, w: 60, h: 10 }, { step: 11 })!;
    const b = l.place({ x: 210, y: 150, w: 60, h: 10 }, { step: 11 })!;
    const c = l.place({ x: 190, y: 150, w: 60, h: 10 }, { step: 11 })!;
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, c)).toBe(false);
    expect(overlaps(a, c)).toBe(false);
  });
});

describe('BannerQueue', () => {
  it('shows one banner at a time and queues the rest', () => {
    const q = new BannerQueue();
    q.push('card', 'I · EMBERS', 'depth 1');
    q.push('levelup', 'LEVEL 2');
    expect(q.current?.title).toBe('I · EMBERS');
    expect(q.queue.length).toBe(1);
    for (let i = 0; i < 60 * 4; i++) q.update(1 / 60);
    expect(q.current?.title).toBe('LEVEL 2');
  });

  it('merges level-ups into the one showing', () => {
    const q = new BannerQueue();
    q.push('levelup', 'LEVEL 2');
    q.update(1);
    q.push('levelup', 'LEVEL 3');
    expect(q.current?.title).toBe('LEVEL 3');
    expect(q.queue.length).toBe(0);
    expect(q.current!.age).toBeLessThan(0.5);
  });

  it('lets a level clear cut a level-up short, and brings the level-up back after', () => {
    const q = new BannerQueue();
    q.push('levelup', 'LEVEL 4');
    q.update(0.2);
    q.push('clear', 'LEVEL CLEAR', '0:48');
    expect(q.current?.kind).toBe('clear');
    for (let i = 0; i < 60 * 5; i++) q.update(1 / 60);
    expect(q.current?.title).toBe('LEVEL 4');
    for (let i = 0; i < 60 * 3; i++) q.update(1 / 60);
    expect(q.current).toBeNull();
  });
});
