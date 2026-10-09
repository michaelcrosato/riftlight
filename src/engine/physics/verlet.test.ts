import { describe, expect, it } from 'vitest';
import { clothGrid, ropeLine, softBlob, VerletBody } from './verlet';

const run = (b: VerletBody, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) b.step(dt);
};
const y = (b: VerletBody, i: number) => b.pos[i * 3 + 1]!;

describe('VerletBody', () => {
  it('falls under gravity and stops on the floor', () => {
    const b = new VerletBody(1);
    b.set(0, 0, 5, 0);
    b.floor = 0;
    run(b, 0.5);
    expect(y(b, 0)).toBeLessThan(5 - 0.5 * 9.8 * 0.25 * 0.8);
    run(b, 3);
    expect(y(b, 0)).toBeCloseTo(0, 5);
  });

  it('pinned particles follow their pin', () => {
    const b = new VerletBody(1);
    b.set(0, 0, 1, 0);
    b.pin(0, 2, 3, 4);
    run(b, 0.2);
    expect([...b.pos]).toEqual([2, 3, 4]);
  });

  it('a sphere pushes particles out', () => {
    const b = new VerletBody(1);
    b.set(0, 0.1, 0, 0);
    b.gravity = [0, 0, 0];
    b.spheres.push({ x: 0, y: 0, z: 0, r: 1 });
    b.step(1 / 60);
    expect(Math.hypot(b.pos[0]!, b.pos[1]!, b.pos[2]!)).toBeCloseTo(1, 4);
  });

  it('a box pushes particles out along the shallowest side', () => {
    const b = new VerletBody(1);
    b.set(0, 0.9, 0, 0);
    b.gravity = [0, 0, 0];
    b.boxes.push({ x: 0, y: 0, z: 0, hx: 1, hy: 2, hz: 2 });
    b.step(1 / 60);
    expect(b.pos[0]).toBeCloseTo(1, 5);
  });
});

describe('ropeLine', () => {
  it('hangs from its pin, about its length, swinging to rest', () => {
    const r = ropeLine([0, 5, 0], [3, 5, 0], 12);
    run(r, 20);
    const last = r.count - 1;
    expect(r.pos[0]).toBe(0);
    expect(y(r, 0)).toBe(5);
    // it hangs below the pin, at most its length (it stretches only a little)
    const len = 5 - y(r, last);
    expect(len).toBeGreaterThan(2.7);
    expect(len).toBeLessThan(3.3);
    expect(Math.abs(r.pos[last * 3]!)).toBeLessThan(0.4);
  });

  it('wind blows it sideways', () => {
    const r = ropeLine([0, 5, 0], [0, 2, 0], 10);
    r.wind = [8, 0, 0];
    r.gust = 0;
    run(r, 3);
    expect(r.pos[(r.count - 1) * 3]!).toBeGreaterThan(0.3);
  });
});

describe('clothGrid', () => {
  it('hangs from its top edge without tearing or collapsing', () => {
    const c = clothGrid({ width: 2, height: 1.5, cols: 9, rows: 7, origin: [0, 3, 0], pin: 'top' });
    run(c, 3);
    for (let i = 0; i < c.cols; i++) expect(y(c, i)).toBe(3);
    const bottom = y(c, (c.rows - 1) * c.cols + 4);
    expect(bottom).toBeLessThan(3 - 1.3);
    expect(bottom).toBeGreaterThan(3 - 1.8);
    expect(c.tris.length).toBe((c.cols - 1) * (c.rows - 1) * 6);
  });

  it('a flag pinned on its left edge streams out in the wind', () => {
    const c = clothGrid({ width: 2, height: 1, cols: 10, rows: 6, origin: [0, 3, 0], across: [0, 0, 1], pin: 'left' });
    c.wind = [0, 0, 10];
    run(c, 4);
    const tip = (c.rows >> 1) * c.cols + c.cols - 1;
    expect(c.pos[tip * 3 + 2]!).toBeGreaterThan(1.2);
  });
});

describe('softBlob', () => {
  it('rests on the floor keeping most of its volume', () => {
    const b = softBlob([0, 2, 0], 0.6, { pressure: 0.8 });
    b.floor = 0;
    const v0 = b.restVolume;
    expect(v0).toBeGreaterThan(0.5);
    run(b, 4);
    const c = b.center();
    expect(c[1]).toBeGreaterThan(0.25);
    expect(c[1]).toBeLessThan(0.75);
    expect(Math.abs(b.volume())).toBeGreaterThan(v0 * 0.7);
  });
});
