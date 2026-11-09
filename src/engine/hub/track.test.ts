import { describe, expect, it } from 'vitest';
import { lerpAngle, RemoteTrack } from './track';

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

describe('RemoteTrack', () => {
  it('is null before anything arrived', () => {
    expect(new RemoteTrack<number>().sample(1, lerp)).toBeNull();
  });

  it('draws a steady line from snapshots that arrive late and unevenly', () => {
    const track = new RemoteTrack<number>({ delay: 0.1 });
    // The sender moves 1 unit/s and sends every 0.1 s; each takes 0.15–0.2 s to arrive.
    const sent = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const late = [0.15, 0.2, 0.15, 0.18, 0.15, 0.2];
    const arrivals = sent.map((t, i) => ({ t, at: 10 + t + late[i]! })).sort((a, b) => a.at - b.at);
    const drawn: number[] = [];
    let next = 0;
    for (let now = 10.15; now <= 10.7; now += 1 / 60) {
      while (next < arrivals.length && arrivals[next]!.at <= now) track.push(arrivals[next]!.t, now, arrivals[next++]!.t);
      const v = track.sample(now, lerp);
      if (v !== null) drawn.push(v);
    }
    // Every frame moves forward by about one frame's worth: no jumps, no stalls.
    const steps = drawn.slice(10).map((v, i) => v - drawn[9 + i]!);
    for (const step of steps) {
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(0.05);
    }
    expect(drawn.at(-1)!).toBeGreaterThan(0.25);
  });

  it('drops snapshots older than the newest, and starts over when the sender does', () => {
    const track = new RemoteTrack<number>();
    track.push(5, 6, 5);
    track.push(4, 6.1, 4); // late
    expect(track.size).toBe(1);
    track.push(0, 7, 0); // a new level: its clock started again
    expect(track.size).toBe(1);
    expect(track.latest).toBe(0);
  });

  it('runs on a little past the newest snapshot, then holds', () => {
    const track = new RemoteTrack<number>({ delay: 0, extrapolate: 0.2 });
    track.push(0, 0, 0);
    track.push(1, 1, 1);
    expect(track.sample(1.1, lerp)).toBeCloseTo(1.1);
    expect(track.sample(5, lerp)).toBeCloseTo(1.2);
  });
});

describe('lerpAngle', () => {
  it('turns the short way round', () => {
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(lerpAngle(0.1, -0.1, 0.5)).toBeCloseTo(0);
  });
});
