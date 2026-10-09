import { describe, expect, it } from 'vitest';
import { NavGrid } from './navgrid';

const MAZE = [
  '##########',
  '#........#',
  '#.######.#',
  '#.#....#.#',
  '#.#.##.#.#',
  '#...#..#.#',
  '#####.##.#',
  '#........#',
  '##########',
];

describe('NavGrid', () => {
  const nav = NavGrid.fromRows(MAZE, { cell: 1, origin: [0, 0, 0] });
  const c = (col: number, row: number): [number, number, number] => [col + 0.5, 0, row + 0.5];

  it('reads walls and open cells', () => {
    expect(nav.width).toBe(10);
    expect(nav.isOpen(0, 0)).toBe(false);
    expect(nav.walkable(1.5, 1.5)).toBe(true);
    expect(nav.walkable(-1, 1)).toBe(false);
  });

  it('finds the shortest path around walls, only through open cells', () => {
    const p = nav.path(c(3, 3), c(8, 7))!;
    expect(p).not.toBeNull();
    expect(p[0]).toEqual(c(3, 3));
    expect(p.at(-1)).toEqual(c(8, 7));
    // every straight leg of the smoothed path is walkable
    for (let i = 0; i + 1 < p.length; i++) expect(nav.lineOfSight(p[i]![0], p[i]![2], p[i + 1]![0], p[i + 1]![2])).toBe(true);
  });

  it('returns null when there is no way', () => {
    const closed = NavGrid.fromRows(['#####', '#.#.#', '#####'], { origin: [0, 0, 0] });
    expect(closed.path([1.5, 0, 1.5], [3.5, 0, 1.5])).toBeNull();
  });

  it('does not cut corners', () => {
    const g = NavGrid.fromRows(['....', '.#..', '..#.', '....'], { origin: [0, 0, 0] });
    // (1,2) → (2,1) diagonally squeezes between two walls: not allowed, so the path is longer than one diagonal step
    const p = g.path([1.5, 0, 2.5], [2.5, 0, 1.5])!;
    expect(p.length).toBeGreaterThan(2);
  });

  it('line of sight: walls block, open corridors do not', () => {
    expect(nav.lineOfSight(1.5, 1.5, 8.5, 1.5)).toBe(true);
    expect(nav.lineOfSight(1.5, 1.5, 1.5, 7.5)).toBe(false); // row 6 is wall
    expect(nav.castWall(1.5, 1.5, 1, 0, 20)).toBeGreaterThan(6.5);
  });

  it('flow field: every open cell points downhill to the target, rebuilt only on change', () => {
    expect(nav.flowTo(8.5, 7.5)).toBe(true);
    expect(nav.flowTo(8.6, 7.4)).toBe(false); // same cell
    expect(nav.flowBuilds).toBe(1);
    const dir: [number, number] = [0, 0];
    // walk the field from (1,1): it reaches the target
    let x = 1.5;
    let z = 1.5;
    for (let i = 0; i < 400 && nav.flowDistance(x, z) > 0; i++) {
      expect(nav.flowDirection(x, z, dir)).toBe(true);
      x += dir[0] * 0.25;
      z += dir[1] * 0.25;
      expect(nav.walkable(x, z)).toBe(true);
    }
    expect(nav.flowDistance(x, z)).toBe(0);
    nav.setOpen(5, 6, false);
    expect(nav.flowTo(8.5, 7.5)).toBe(true); // the grid changed
  });

  it('a path inside one cell is still from → to', () => {
    const nav = NavGrid.fromRows(['#####', '#...#', '#####']);
    const p = nav.path([-1.3, 0, 0.1], [-0.8, 0, -0.2])!;
    expect(p).toEqual([
      [-1.3, 0, 0.1],
      [-0.8, 0, -0.2],
    ]);
  });

  it('castWall stops exactly where lineOfSight starts failing (corners and cracks too)', () => {
    const nav = NavGrid.fromRows(['#########', '#.......#', '#..#.#..#', '#...#...#', '#..#.#..#', '#.......#', '#########']);
    let seed = 5;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    for (let k = 0; k < 400; k++) {
      const ax = -3.4 + rnd() * 6.8;
      const az = -2.4 + rnd() * 4.8;
      if (!nav.walkable(ax, az)) continue;
      const a = rnd() * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const d = nav.castWall(ax, az, dx, dz, 8);
      expect(nav.lineOfSight(ax, az, ax + dx * (d - 1e-4), az + dz * (d - 1e-4))).toBe(true);
      if (d < 8) expect(nav.lineOfSight(ax, az, ax + dx * (d + 1e-4), az + dz * (d + 1e-4))).toBe(false);
    }
  });

  it('a target inside a wall snaps to the nearest reachable side', () => {
    const nav = NavGrid.fromRows(['#######', '#.....#', '###.###', '#.....#', '#######']);
    // the wall cell (col 1, row 2) is right above a reachable floor cell (col 1, row 3)
    const p = nav.path([2, 0, 1], [-2.5, 0, 0])!;
    expect(p).not.toBeNull();
    const end = p.at(-1)!;
    expect(nav.walkable(end[0], end[2])).toBe(true);
    expect(Math.hypot(end[0] + 2.5, end[2])).toBeLessThan(1.2);
  });

  it('pits are closed by default', () => {
    const nav = NavGrid.fromRows(['#####', '#. .#', '#####']);
    expect(nav.walkable(0, 0)).toBe(false);
    expect(nav.path([-1, 0, 0], [1, 0, 0])).toBeNull();
  });

  it('flow fields fill each cell about once', () => {
    const rows = Array.from({ length: 60 }, (_, r) => Array.from({ length: 60 }, (_, c) => (r === 0 || c === 0 || r === 59 || c === 59 || (c % 7 === 3 && r % 9 !== 4) ? '#' : '.')).join(''));
    const nav = NavGrid.fromRows(rows);
    nav.flowTo(0.5, 0.5);
    const out: [number, number] = [0, 0];
    expect(nav.flowDirection(-25, -25, out)).toBe(true);
    expect(nav.flowDistance(-25, -25)).toBeGreaterThan(30);
  });
});
