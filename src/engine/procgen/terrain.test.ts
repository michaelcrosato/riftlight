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

  it('heavy rain never digs a runaway pit: ten drops per point stay within the land\'s own range', () => {
    const n = createNoise(3);
    for (const make of [
      () => new Terrain({ size: [40, 30] }).generate((x, z) => 4 * n.fbm2(x * 0.05, z * 0.05)), // the guide's recipe
      () => new Terrain({ size: [32, 32], cells: [48, 48] }).generate((x, z) => 6 * n.ridged2(x * 0.06, z * 0.06)),
    ]) {
      const t = make();
      const min0 = Math.min(...t.heights);
      const max0 = Math.max(...t.heights);
      const range = max0 - min0;
      t.erode({ droplets: t.heights.length * 10, seed: 4 });
      expect(Math.min(...t.heights)).toBeGreaterThan(min0 - 0.1 * range);
      expect(Math.max(...t.heights)).toBeLessThan(max0 + 0.1 * range);
    }
  });

  it('erosion leaves a margin of edge points exactly as they were', () => {
    const t = new Terrain({ size: [20, 20], cells: [30, 30] }).generate((x, z) => 3 * createNoise(8).ridged2(x * 0.1, z * 0.1));
    const before = Float32Array.from(t.heights);
    t.erode({ droplets: 3000, seed: 1, margin: 2 });
    let edgeMoved = 0;
    let innerMoved = 0;
    for (let iz = 0; iz <= t.nz; iz++) {
      for (let ix = 0; ix <= t.nx; ix++) {
        const i = ix + iz * (t.nx + 1);
        const d = Math.abs(t.heights[i]! - before[i]!);
        if (ix < 2 || iz < 2 || ix > t.nx - 2 || iz > t.nz - 2) edgeMoved = Math.max(edgeMoved, d);
        else innerMoved = Math.max(innerMoved, d);
      }
    }
    expect(edgeMoved).toBe(0);
    expect(innerMoved).toBeGreaterThan(0.01);
  });

  it('a drop\'s radius is whole cells: a fractional one makes no soil either', () => {
    const n = createNoise(5);
    const sum = (h: Float32Array) => h.reduce((s, v) => s + v, 0);
    for (const radius of [1.5, 2.5]) {
      const t = new Terrain({ size: [32, 32], cells: [48, 48] }).generate((x, z) => 0.02 * (x * x + z * z) + 1.5 * n.fbm2(x * 0.1, z * 0.1));
      const before = sum(t.heights);
      t.erode({ droplets: 4000, seed: 3, radius });
      expect(Math.abs(sum(t.heights) - before) / before).toBeLessThan(0.002);
    }
  });

  it('the mesh is the surface heightAt describes: every triangle\'s centre lies on it', () => {
    const t = new Terrain({ size: [12, 9], cells: [8, 6], at: [1, 0.5, -2] }).generate(hills(4));
    const P = t.mesh.geometry.getAttribute('position').array;
    for (let k = 0; k < P.length; k += 9) {
      const cx = (P[k]! + P[k + 3]! + P[k + 6]!) / 3;
      const cy = (P[k + 1]! + P[k + 4]! + P[k + 7]!) / 3;
      const cz = (P[k + 2]! + P[k + 5]! + P[k + 8]!) / 3;
      expect(t.heightAt(cx + 1, cz - 2)).toBeCloseTo(cy + 0.5, 4);
    }
  });
});
