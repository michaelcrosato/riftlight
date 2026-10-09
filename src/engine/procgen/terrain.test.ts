import { describe, expect, it } from 'vitest';
import { Physics } from '../physics/Physics';
import { createNoise } from './noise';
import { Terrain } from './terrain';

const hills = (seed = 3) => {
  const n = createNoise(seed);
  return (x: number, z: number) => 4 * n.fbm2(x * 0.08, z * 0.08, { octaves: 4 });
};

describe('Terrain', () => {
  it('has the heights the function gave at its grid points', () => {
    const f = hills();
    const t = new Terrain({ size: [20, 12], cells: [20, 24], at: [3, 1, -2] }).generate(f);
    for (const [ix, iz] of [
      [0, 0],
      [20, 24],
      [7, 13],
    ] as const) {
      const x = t.pointX(ix);
      const z = t.pointZ(iz);
      expect(t.heightAt(x, z)).toBeCloseTo(1 + f(x, z), 4);
    }
    expect(t.pointX(0)).toBeCloseTo(3 - 10);
    expect(t.pointZ(24)).toBeCloseTo(-2 + 6);
  });

  it('heightAt is where the collider is, between the grid points too', async () => {
    const p = await Physics.create();
    const t = new Terrain({ size: [24, 16], cells: [30, 20], at: [2, 0.5, -1] }).generate(hills(9));
    t.attach(p);
    p.update(1 / 60 + 1e-9); // the query pipeline sees new colliders after a step
    const hit = { y: 0, nx: 0, ny: 0, nz: 0, id: 0 };
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const x = 2 - 11.9 + ((i * 7.31) % 23.8);
      const z = -1 - 7.9 + ((i * 3.77) % 15.8);
      expect(p.castDown(x, 50, z, 100, hit)).toBe(true);
      worst = Math.max(worst, Math.abs(hit.y - t.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(2e-3);
  });

  it('draws flat-shaded faces facing up, coloured by height, steep ones as rock', () => {
    const t = new Terrain({ size: [10, 10], cells: [10, 10] }).generate((x) => (x < 0 ? -2 : 6)); // a cliff in the middle
    const g = t.mesh.geometry;
    expect(g.getAttribute('position').count).toBe(10 * 10 * 6);
    const N = g.getAttribute('normal').array;
    for (let i = 1; i < N.length; i += 3) expect(N[i]!).toBeGreaterThan(0);
    const colors = new Set<string>();
    const C = g.getAttribute('color').array;
    for (let i = 0; i < C.length; i += 3) colors.add(`${C[i]!.toFixed(3)},${C[i + 1]!.toFixed(3)},${C[i + 2]!.toFixed(3)}`);
    expect(colors.size).toBe(3); // sea (−2), snow (6), and the cliff's rock between them
  });

  it('erosion carves: the same for a seed, lower peaks, steep slopes gentler', () => {
    const make = () => new Terrain({ size: [32, 32], cells: [48, 48] }).generate((x, z) => 6 * createNoise(5).ridged2(x * 0.06, z * 0.06));
    const a = make();
    const b = make();
    const before = Float32Array.from(a.heights);
    const steepest = (t: Terrain) => {
      let m = 0;
      for (let iz = 0; iz < t.nz; iz++) for (let ix = 0; ix < t.nx; ix++) m = Math.max(m, Math.abs(t.heights[ix + 1 + iz * (t.nx + 1)]! - t.heights[ix + iz * (t.nx + 1)]!));
      return m;
    };
    const steep0 = steepest(a);
    a.erode({ droplets: 2400, seed: 2 }); // about one drop per grid point
    b.erode({ droplets: 2400, seed: 2 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Math.max(...a.heights)).toBeLessThan(Math.max(...before));
    expect(steepest(a)).toBeLessThan(steep0);
    let moved = 0;
    for (let i = 0; i < before.length; i++) moved = Math.max(moved, Math.abs(a.heights[i]! - before[i]!));
    expect(moved).toBeGreaterThan(0.05);
    expect(a.heights.every(Number.isFinite)).toBe(true);
  });

  it('erosion moves soil, it does not make or lose it, where none can run off the edge', () => {
    // a bowl: every drop runs inward, so all it digs it lays down again
    const n = createNoise(5);
    const t = new Terrain({ size: [32, 32], cells: [48, 48] }).generate((x, z) => 0.02 * (x * x + z * z) + 1.5 * n.fbm2(x * 0.1, z * 0.1));
    const sum = (h: Float32Array) => h.reduce((s, v) => s + v, 0);
    const before = sum(t.heights);
    const low = Math.min(...t.heights);
    t.erode({ droplets: 4000, seed: 3 });
    expect(Math.abs(sum(t.heights) - before) / before).toBeLessThan(0.002);
    expect(Math.min(...t.heights)).toBeGreaterThan(low); // the bottom silts up
  });

  it('attach replaces its collider; dispose removes it', async () => {
    const p = await Physics.create();
    const t = new Terrain({ size: [8, 8], cells: [8, 8] }).generate(() => 1);
    const base = p.counts().colliders;
    t.attach(p);
    t.generate(() => 2);
    t.attach(p);
    expect(p.counts().colliders).toBe(base + 1);
    t.dispose();
    expect(p.counts()).toMatchObject({ colliders: base, bodies: 0 });
  });
});
