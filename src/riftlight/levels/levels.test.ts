import { Color, type Mesh, type MeshToonNodeMaterial, SRGBColorSpace, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { DESIGNED_LEVELS, resolveTheme } from './designed';
import { generateLayout } from './layout/generate';
import { FLOOR, Layout, LAYOUT_STYLES, WALL } from './layout/grid';
import { ROOM_TEMPLATES, stencil } from './layout/templates';
import { DEFAULT_TEXEL } from '../../engine/model';
import { bakeTexture, type BakedTexture, TEXTURE_LIBRARY } from '../../engine/texture';
import { buildGeometry, toneOf } from './layout/geometry';
import { compatible, compatibleSet, MECHANIC_ORDER, MECHANICS } from './mechanics';
import { Placement } from './mechanics/common';
import { LevelNav } from './nav';
import { riftSpec } from './rift';
import { riftShift, shiftTheme } from './themes/palette';
import { THEMES } from './themes/themes';
import { planLevel } from './plan';
import { validateSpec } from './validate';
import { clearance } from './layout/grid';

/** The share of texel pairs, across and down (wrapped, as the texture tiles), that differ in colour. */
function edgeShare({ width: w, height: h, rgba }: BakedTexture): number {
  const at = (x: number, y: number) => {
    const k = ((y % h) * w + (x % w)) * 4;
    return (rgba[k]! << 16) | (rgba[k + 1]! << 8) | rgba[k + 2]!;
  };
  let differ = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (at(x, y) !== at(x + 1, y)) differ++;
      if (at(x, y) !== at(x, y + 1)) differ++;
    }
  return differ / (2 * w * h);
}

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
    // Builds and validates 24 full levels (~2 s alone, several times that on a loaded CI box).
  }, 60_000);
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

describe('theme surfaces', () => {
  it('bind every slot of a library texture to a theme tone, and bake clean', () => {
    for (const t of THEMES.all()) {
      for (const [where, s] of Object.entries(t.surfaces ?? {})) {
        const def = TEXTURE_LIBRARY.get(s.texture);
        expect(Object.keys(s.slots).sort(), `${t.id} ${where}`).toEqual(Object.keys(def.palette).sort());
        const palette = Object.fromEntries(Object.entries(s.slots).map(([k, tone]) => [k, toneOf(t, tone)]));
        expect(bakeTexture(def, { palette }).problems, `${t.id} ${where}`).toEqual([]);
      }
    }
  });

  // Gate B (docs/ASSETS.md, *Texel density*): how much a surface shimmers as the camera zooms
  // tracks the share of neighbouring texels that differ in colour (the worst step ≈ 0.166 × it,
  // so the line is a share of about 36%), not their contrast. A floor fills most of the frame, so
  // every theme's floor stays under 33%, in its own tones and in a rift's shifts of them. Walls
  // are a small part of the frame and Gate B judged them by its filmstrips, where bricks (42%)
  // passed: they stay under 45%, so a busier wall can't creep in.
  it('keep floors under the Gate B line (33% of neighbouring texels differ) and walls under 45%', () => {
    const bound = { floor: 0.33, wall: 0.45 };
    const rng = new Rng(4);
    for (const t of THEMES.all()) {
      const shifted = Array.from({ length: 6 }, (_, i) => shiftTheme(t, riftShift(rng, 13 + i * 8)));
      for (const where of ['floor', 'wall'] as const) {
        const s = t.surfaces?.[where];
        if (!s) continue;
        const def = TEXTURE_LIBRARY.get(s.texture);
        for (const theme of [t, ...shifted]) {
          const palette = Object.fromEntries(Object.entries(s.slots).map(([k, tone]) => [k, toneOf(theme, tone)]));
          expect(edgeShare(bakeTexture(def, { palette })), `${theme.id}: its ${s.texture} ${where}`).toBeLessThan(bound[where]);
        }
      }
    }
  });

  it('texture floors and walls in world space at the engine texel density', () => {
    const plan = planLevel(DESIGNED_LEVELS[0]!);
    const { surfaces } = plan.theme;
    const { root } = buildGeometry(plan);
    const textured = (id: string) => root.children.filter((o): o is Mesh => (o as Mesh).isMesh && ((o as Mesh).material as MeshToonNodeMaterial).map?.name === `tex:${id}`);
    const [floor] = textured(surfaces!.floor!.texture);
    const [wall] = textured(surfaces!.wall!.texture);
    expect(floor && wall).toBeTruthy();
    for (const [mesh, id] of [[floor!, surfaces!.floor!.texture], [wall!, surfaces!.wall!.texture]] as const) {
      const [w, h] = TEXTURE_LIBRARY.get(id).size;
      const pos = mesh.geometry.getAttribute('position');
      const nor = mesh.geometry.getAttribute('normal');
      const uv = mesh.geometry.getAttribute('uv');
      expect(uv.count).toBe(pos.count);
      for (let i = 0; i < pos.count; i += 7) {
        const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        // tops: (x, −z); walls: the run along the face (left to right seen from outside) and y
        const run = nor.getY(i) !== 0 ? x : (x - z) * (nor.getX(i) + nor.getZ(i));
        expect(uv.getX(i)).toBeCloseTo((run * DEFAULT_TEXEL) / w, 5);
        expect(uv.getY(i)).toBeCloseTo(((nor.getY(i) !== 0 ? -z : y) * DEFAULT_TEXEL) / h, 5);
      }
    }
  });

  it('run the wall texture on round the corners: u reads left to right and meets itself there', () => {
    for (const depth of [1, 4, 8]) {
      const plan = planLevel(DESIGNED_LEVELS[depth - 1]!);
      const id = plan.theme.surfaces!.wall!.texture;
      const wall = buildGeometry(plan).root.children.find((o): o is Mesh => (o as Mesh).isMesh && ((o as Mesh).material as MeshToonNodeMaterial).map?.name === `tex:${id}`)!;
      const pos = wall.geometry.getAttribute('position');
      const nor = wall.geometry.getAttribute('normal');
      const uv = wall.geometry.getAttribute('uv');
      // Each vertex's u by the edge it stands on, per face direction. Faces toward +x and +z are
      // the ones the camera sees, and they meet each other at corners; so do −x and −z.
      const at = new Map<string, Partial<Record<'x' | 'z', number>>>();
      for (let i = 0; i < pos.count; i++) {
        const [nx, nz] = [nor.getX(i), nor.getZ(i)];
        const key = `${nx + nz}:${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
        at.set(key, { ...at.get(key), [nx !== 0 ? 'x' : 'z']: uv.getX(i) });
        // across its face, u grows to the right of someone facing it
        if (i % 6 === 0) {
          const j = [i + 1, i + 2].find((k) => pos.getY(k) === pos.getY(i))!;
          const right = (pos.getX(j) - pos.getX(i)) * nz - (pos.getZ(j) - pos.getZ(i)) * nx;
          expect(Math.sign(uv.getX(j) - uv.getX(i)), `L${depth} wall quad at ${key}`).toBe(Math.sign(right));
        }
      }
      let corners = 0;
      for (const [key, u] of at) {
        if (u.x === undefined || u.z === undefined) continue;
        corners++;
        // the same texel column on both faces (a whole number of repeats apart)
        const off = u.x - u.z;
        expect(Math.abs(off - Math.round(off)), `L${depth} (${id}) corner at ${key}`).toBeLessThan(1e-6);
      }
      expect(corners, `L${depth} corners checked`).toBeGreaterThan(20);
    }
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
