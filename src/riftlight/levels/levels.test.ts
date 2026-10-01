import { Color, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { DESIGNED_LEVELS, resolveTheme } from './designed';
import { generateLayout } from './layout/generate';
import { FLOOR, Layout, LAYOUT_STYLES, WALL } from './layout/grid';
import { ROOM_TEMPLATES, stencil } from './layout/templates';
import { compatible, compatibleSet, MECHANIC_ORDER, MECHANICS } from './mechanics';
import { Placement } from './mechanics/common';
import { LevelNav } from './nav';
import { riftSpec } from './rift';
import { riftShift, shiftTheme } from './themes/palette';
import { THEMES } from './themes/themes';
import { validateSpec } from './validate';
import { clearance } from './layout/grid';

const hashCells = (l: Layout) => {
  let h = 0;
  for (let i = 0; i < l.cells.length; i++) h = (Math.imul(h, 31) + l.cells[i]! * (i + 1)) | 0;
  return h;
};

describe('layout generator', () => {
  it('every style builds a connected layout with a critical path, deterministically', () => {
    for (const style of LAYOUT_STYLES) {
      for (const seed of [1, 2, 3]) {
        const a = generateLayout({ style, rooms: 9, size: 90, seed });
        const b = generateLayout({ style, rooms: 9, size: 90, seed });
        expect(hashCells(a), style).toBe(hashCells(b));
        expect(a.path.length, style).toBeGreaterThan(5);
        expect(a.cell(a.start.x, a.start.z)).toBe(FLOOR);
        expect(a.cell(a.exit.x, a.exit.z)).toBe(FLOOR);
        expect(a.rooms.some((r) => r.tags.includes('boss')), style).toBe(true);
        // The path is walkable and 8-connected.
        for (let i = 1; i < a.path.length; i++) {
          const p = a.path[i]!;
          const q = a.path[i - 1]!;
          expect(a.cell(p.x, p.z)).toBe(FLOOR);
          expect(Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z))).toBe(1);
        }
      }
    }
  });

  it('room stencils rotate and mirror without losing cells or spots', () => {
    for (const t of ROOM_TEMPLATES.all()) {
      const base = stencil(t);
      const count = base.cells.filter(Boolean).length;
      for (let rot = 0; rot < 4; rot++)
        for (const mirror of [false, true]) {
          const s = stencil(t, rot, mirror);
          expect([s.w, s.h]).toEqual(rot % 2 ? [base.h, base.w] : [base.w, base.h]);
          expect(s.cells.filter(Boolean).length).toBe(count);
          expect(s.spots.length).toBe(base.spots.length);
        }
    }
  });
});

describe('the bypass guarantee', () => {
  it('refuses an element that would cut the only way to the exit', () => {
    // A 1-wide corridor from start to exit.
    const l = new Layout(12, 3, 'dungeon', 1);
    for (let x = 0; x < 12; x++) l.cells[12 + x] = FLOOR;
    l.start = { x: 0, z: 1 };
    l.exit = { x: 11, z: 1 };
    l.path = [];
    const p = new Placement(l, clearance(12, 3, (i) => l.cells[i] === FLOOR));
    expect(p.add('test', { kind: 'wall', x: 6.5, z: 1.5, cells: [12 + 6], block: 'hazard' })).toBeNull();
    expect(p.refused).toBe(1);
    expect(p.elements).toHaveLength(0);
  });

  it('holds for the 12 designed levels and the first rifts (the CLI checks 1..60)', () => {
    for (let d = 1; d <= 24; d++) {
      const spec = d <= 12 ? DESIGNED_LEVELS[d - 1]! : riftSpec(1, d);
      const { report } = validateSpec(spec, 5000);
      expect(report.problems, `${d} ${spec.name}`).toEqual([]);
    }
  });
});

describe('designed levels and rifts', () => {
  it('level N is named after mechanic N; 7-12 bring back the GAME.md combinations', () => {
    expect(MECHANIC_ORDER).toHaveLength(12);
    DESIGNED_LEVELS.forEach((s, i) => {
      expect(s.depth).toBe(i + 1);
      expect(s.mechanics[0]).toBe(MECHANIC_ORDER[i]);
      expect(s.name).toBe(MECHANICS.get(MECHANIC_ORDER[i]!).name);
      expect(compatibleSet(s.mechanics)).toBe(true);
      expect(THEMES.has(s.theme)).toBe(true);
    });
    expect(DESIGNED_LEVELS.slice(6).map((s) => s.mechanics[1])).toEqual(['gale', undefined, 'stormspire', 'embers', 'frostglass', 'gloom']);
  });

  it('rifts combine 2-4 compatible mechanics, a shifted theme and a name, deterministically', () => {
    for (let d = 13; d < 80; d += 3) {
      const a = riftSpec(42, d);
      expect(riftSpec(42, d)).toEqual(a);
      expect(a.mechanics.length).toBeGreaterThanOrEqual(2);
      expect(a.mechanics.length).toBeLessThanOrEqual(4);
      expect(compatibleSet(a.mechanics)).toBe(true);
      expect(a.name).toMatch(new RegExp(`^Rift ${d}: [A-Z][a-z]+( [A-Z][a-z]+){1,2}$`));
      expect(resolveTheme(a.theme).id).toBe(a.theme);
    }
  });

  it('excludes are respected both ways', () => {
    for (const m of MECHANICS.all()) for (const x of m.excludes ?? []) expect(compatible(x, m.id)).toBe(false);
    expect(compatible('mire', 'gale')).toBe(true);
  });
});

describe('palette shifter', () => {
  it('keeps shifted themes readable (floor lightness, walls darker than floors)', () => {
    const hsl = { h: 0, s: 0, l: 0 };
    const L = (hex: number) => new Color(hex).getHSL(hsl, SRGBColorSpace).l;
    const rng = new Rng(5);
    for (const t of THEMES.all())
      for (let k = 0; k < 10; k++) {
        const s = shiftTheme(t, riftShift(rng, 13 + k * 10));
        expect(L(s.palette.floor)).toBeGreaterThanOrEqual(0.15);
        expect(L(s.palette.floor)).toBeLessThanOrEqual(0.51);
        expect(L(s.palette.floor) - L(s.palette.wall)).toBeGreaterThanOrEqual(0.065);
        expect(L(s.palette.accent)).toBeGreaterThanOrEqual(0.44);
      }
  });
});

describe('navigation', () => {
  it('the flow field leads to the target around walls; rays stop at walls', () => {
    // 9×5 room with a wall in the middle column (gap at the bottom).
    const l = new Layout(9, 5, 'dungeon', 1);
    l.cells.fill(FLOOR);
    for (let z = 0; z < 4; z++) l.cells[z * 9 + 4] = WALL;
    const nav = new LevelNav(l);
    nav.setTarget({ x: 7.5, z: 0.5 });
    const p = new Vector3(1.5, 0, 0.5);
    const dir = new Vector3();
    for (let i = 0; i < 60 && p.distanceTo(new Vector3(7.5, 0, 0.5)) > 0.3; i++) {
      nav.direction(p.x, p.z, dir);
      p.addScaledVector(dir, 0.25);
      expect(nav.isWalkable(p.x, p.z)).toBe(true);
    }
    expect(p.distanceTo(new Vector3(7.5, 0, 0.5))).toBeLessThan(0.6);
    expect(nav.raycastWalls({ x: 1.5, z: 1.5 }, { x: 1, z: 0 }, 10)).toBeCloseTo(2.5);
    expect(nav.raycastWalls({ x: 1.5, z: 4.5 }, { x: 1, z: 0 }, 6)).toBeNull();
    expect(nav.rebuilds).toBe(1);
  });
});
