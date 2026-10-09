import { describe, expect, it } from 'vitest';
import { type CameraKey, Timeline } from './timeline';

const KEYS: CameraKey[] = [
  { at: 0, position: [0, 2, 10], target: [0, 1, 0], fov: 40 },
  { at: 2, position: [5, 3, 5], target: [0, 1, 0] },
  { at: 5, position: [8, 2, -2], target: [1, 1, 0], fov: 60 },
  { at: 5, position: [0, 1.6, 2], target: [0, 1.5, 0], cut: true },
  { at: 7, position: [0, 1.6, 4], target: [0, 1.5, 0] },
];

describe('Timeline', () => {
  it('puts the camera on each key at its time; fov carries over until a key changes it', () => {
    const tl = new Timeline({ shots: KEYS });
    expect(tl.duration).toBe(7);
    expect(tl.camera(0)).toEqual({ position: [0, 2, 10], target: [0, 1, 0], fov: 40 });
    expect(tl.camera(2)!.position).toEqual([5, 3, 5]);
    expect(tl.camera(2)!.fov).toBe(40);
    expect(tl.camera(7)!.position).toEqual([0, 1.6, 4]);
    expect(tl.camera(-1)!.position).toEqual([0, 2, 10]);
    expect(tl.camera(99)!.position).toEqual([0, 1.6, 4]);
    expect(new Timeline({}).camera(1)).toBeNull();
  });

  it('glides without a jolt through a key and eases in and out at the ends of a shot', () => {
    const tl = new Timeline({ shots: KEYS });
    const x = (t: number) => tl.camera(t)!.position[0];
    const h = 1e-4;
    // through key 2 (t = 2): the speed just before equals the speed just after, and it is moving
    const before = (x(2) - x(2 - h)) / h;
    const after = (x(2 + h) - x(2)) / h;
    expect(Math.abs(before - after)).toBeLessThan(1e-2);
    expect(before).toBeGreaterThan(0.5);
    // at the start of the shot (t = 0) and its end (t = 5): standing still
    expect(Math.abs((x(h) - x(0)) / h)).toBeLessThan(1e-2);
    expect(Math.abs((x(5 - 1e-6) - x(5 - 1e-6 - h)) / h)).toBeLessThan(1e-2);
  });

  it('cuts: the frame before is the end of one shot, the frame after the start of the next', () => {
    const tl = new Timeline({ shots: KEYS });
    expect(tl.camera(5 - 1e-9)!.position[0]).toBeCloseTo(8, 5);
    expect(tl.camera(5)!.position).toEqual([0, 1.6, 2]);
    // the second shot does not borrow a tangent from the first: it eases out of its cut
    const z = (t: number) => tl.camera(t)!.position[2];
    expect(Math.abs((z(5 + 1e-4) - z(5)) / 1e-4)).toBeLessThan(1e-2);
  });

  it('fires each cue once, in order, even when one step passes several', () => {
    const log: string[] = [];
    const tl = new Timeline({
      cues: [
        { at: 1, name: 'b', run: () => log.push('b') },
        { at: 0.5, name: 'a', run: () => log.push('a') },
        { at: 3, name: 'c', run: () => log.push('c') },
      ],
      duration: 4,
    });
    tl.update(1); // not playing yet
    expect(log).toEqual([]);
    tl.play();
    tl.update(0.4);
    expect(log).toEqual([]);
    tl.update(2); // crosses 0.5 and 1
    expect(log).toEqual(['a', 'b']);
    tl.update(0.01);
    expect(log).toEqual(['a', 'b']);
    tl.update(5);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(tl.ended).toBe(true);
    expect(tl.playing).toBe(false);
  });

  it('seeking skips the cues it jumps over; going back arms them again; play after the end starts over', () => {
    const log: string[] = [];
    const tl = new Timeline({ cues: [1, 2, 3].map((at) => ({ at, name: `c${at}`, run: () => log.push(`c${at}`) })), duration: 4 });
    tl.play();
    tl.seek(1.5);
    tl.update(1);
    expect(log).toEqual(['c2']);
    tl.seek(0.5);
    tl.update(1);
    expect(log).toEqual(['c2', 'c1']);
    tl.update(10);
    tl.play();
    expect(tl.time).toBe(0);
    tl.update(1.2);
    expect(log.at(-1)).toBe('c1');
  });

  it('skip runs the cues that change the world but not the cosmetic ones, then ends once', () => {
    const log: string[] = [];
    let ends = 0;
    const tl = new Timeline({
      cues: [
        { at: 1, name: 'door', run: () => log.push('door') },
        { at: 2, name: 'thud', cosmetic: true, run: () => log.push('thud') },
        { at: 3, name: 'give key', run: () => log.push('give key') },
      ],
      onEnd: () => ends++,
    });
    tl.play();
    tl.update(1.5);
    tl.skip();
    tl.skip();
    expect(log).toEqual(['door', 'give key']);
    expect(ends).toBe(1);
    expect(tl.time).toBe(3);
  });

  it('shows the line whose time it is, and slides the bars in and out', () => {
    const tl = new Timeline({
      lines: [
        { at: 0.5, until: 2, who: 'A', text: 'Hello.' },
        { at: 2, until: 4, text: 'Goodbye.' },
      ],
      bars: 0.5,
    });
    expect(tl.line(0.2)).toBeNull();
    expect(tl.line(1)!.text).toBe('Hello.');
    expect(tl.line(2)!.text).toBe('Goodbye.');
    expect(tl.line(4)).toBeNull();
    expect(tl.bars(0)).toBe(0);
    expect(tl.bars(0.25)).toBeCloseTo(0.5, 5);
    expect(tl.bars(2)).toBe(1);
    expect(tl.bars(4)).toBe(0);
    expect(new Timeline({ duration: 3, bars: 0 }).bars(1)).toBe(0);
  });

  it('speed scales time (slow motion)', () => {
    const tl = new Timeline({ duration: 10 });
    tl.speed = 0.5;
    tl.play();
    tl.update(1);
    expect(tl.time).toBeCloseTo(0.5);
  });

  it('survives cues that move the playhead: a skip ends it once, a seek back does not loop within a frame', () => {
    let ends = 0;
    const skipper: Timeline = new Timeline({ cues: [{ at: 1, run: () => skipper.skip() }], duration: 3, onEnd: () => ends++ });
    skipper.play();
    skipper.update(2);
    expect(ends).toBe(1);
    expect(skipper.ended).toBe(true);
    let loops = 0;
    const looper: Timeline = new Timeline({ cues: [{ at: 1, run: () => (loops++, looper.seek(0)) }], duration: 3 });
    looper.play();
    looper.update(2); // passes 1: back to 0
    expect([loops, looper.time]).toEqual([1, 0]);
    looper.update(1.5); // passes 1 again: once more
    expect(loops).toBe(2);
  });

  it('never fires a cue after the end, played or skipped', () => {
    const log: string[] = [];
    const played = new Timeline({ cues: [{ at: 5, run: () => log.push('late') }], duration: 2 });
    played.play();
    played.update(10);
    const skipped = new Timeline({ cues: [{ at: 5, run: () => log.push('late') }], duration: 2 });
    skipped.skip();
    expect(log).toEqual([]);
  });

  it('a skip runs every cue that matters even when one of them seeks back, and ends at the end', () => {
    const log: string[] = [];
    const tl: Timeline = new Timeline({
      cues: [
        { at: 2, name: 'loop', run: () => (log.push('loop'), tl.seek(1)) },
        { at: 5, name: 'gate', run: () => log.push('gate') },
      ],
      duration: 6,
      lines: [{ at: 1, until: 3, text: 'MID-SCENE' }],
      onEnd: () => log.push('end'),
    });
    tl.play();
    tl.update(0.5);
    tl.skip();
    expect(log).toEqual(['loop', 'gate', 'end']);
    expect([tl.time, tl.ended, tl.line()]).toEqual([6, true, null]);
  });

  it('a cue that pauses stops the ones after it in the same frame', () => {
    const log: string[] = [];
    const tl: Timeline = new Timeline({ cues: [{ at: 1, run: () => (log.push('pause'), tl.pause()) }, { at: 1.5, run: () => log.push('after') }], duration: 4 });
    tl.play();
    tl.update(2);
    expect(log).toEqual(['pause']);
    tl.play();
    tl.update(0.1);
    expect(log).toEqual(['pause', 'after']);
  });
});
