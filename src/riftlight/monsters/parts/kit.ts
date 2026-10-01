import type { Mesh } from 'three/webgpu';
import type { Vec3 } from '../../../engine/animation';
import type { Mod } from '../../core/mods';
import { arcHorn, extrude, lathe, limbGeometry, taperCyl, unitBlob, unitBox, unitCone, unitCyl, unitDisc, unitSphere, unitSphereLo, unitTooth, SMALL_SPHERE } from '../geometry';
import type { HeadAnchors, MonsterPartContext, MonsterPartDef, PaletteSlot, Slot } from '../types';

/**
 * Part-building kit. Every helper works in *socket units*: positions and sizes are
 * multiplied by the socket's size, so a part authored once fits a goblin's head and a
 * boss's alike. Parts are authored for the character's LEFT side (+X); right sockets are
 * mirrored automatically. Unit geometry is shared between all parts (one box, one sphere,
 * one cone...), so a whole zoo of monsters costs a few dozen buffers.
 */
type C = MonsterPartContext;
const mul = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

export interface Look {
  rot?: Vec3;
  glow?: boolean;
  joint?: string;
  /** Wears the body pattern (belly, stripes, spots). */
  pattern?: boolean;
}

const put = (c: C, key: string, make: Parameters<C['add']>[1], color: PaletteSlot, at: Vec3, size: Vec3, look: Look = {}): Mesh =>
  c.add(key, make, color, { at: mul(at, c.size), scale: mul(size, c.size), rot: look.rot, glow: look.glow, joint: look.joint, pattern: look.pattern });

export const box = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => put(c, 'u:box', unitBox, color, at, size, look);
export const ball = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) =>
  Math.max(...size) * c.size < SMALL_SPHERE ? put(c, 'u:sphere.lo', unitSphereLo, color, at, size, look) : put(c, 'u:sphere', unitSphere, color, at, size, look);
export const lump = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => put(c, 'u:blob', unitBlob, color, at, size, look);
export const cone = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => put(c, 'u:cone', unitCone, color, at, size, look);
/** A small four-sided spike (teeth, toe claws, quills). */
export const spike = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => put(c, 'u:tooth', unitTooth, color, at, size, look);
export const cyl = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => put(c, 'u:cyl', unitCyl, color, at, size, look);
export const disc = (c: C, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => put(c, 'u:disc', unitDisc, color, at, size, look);
export const taper = (c: C, ratio: number, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) =>
  put(c, `u:taper:${ratio.toFixed(2)}`, taperCyl(Math.round(ratio * 100) / 100), color, at, size, look);

/** A rounded limb segment along Y: bottom radius = `ratio` × top, muscle `bulge` (see `limbGeometry`). */
export const limb = (c: C, ratio: number, bulge: number, color: PaletteSlot, at: Vec3, size: Vec3, look?: Look) => {
  const r = Math.round(ratio * 20) / 20;
  const b = Math.round(bulge * 20) / 20;
  return put(c, `u:limb:${r}:${b}`, limbGeometry(r, b), color, at, size, look);
};

/** Curved horn of unit length (scaled by `len`), base at `at`, pointing +Y then curling towards +Z. */
export function horn(c: C, color: PaletteSlot, at: Vec3, len: number, thick: number, curl: number, look: Look = {}): Mesh {
  const t = Math.round(thick * 100) / 100;
  const k = Math.round(curl / 10) * 10;
  return put(c, `u:horn:${t}:${k}`, () => arcHorn(1, t, t * 0.12, k, 4, 5), color, at, [len, len, len], look);
}

/** A flat extruded outline (x, y) in unit space, `depth` thick. */
export function slab(c: C, key: string, points: readonly (readonly [number, number])[], depth: number, color: PaletteSlot, at: Vec3, scale: Vec3, look?: Look): Mesh {
  return put(c, `x:${key}`, () => extrude(points, depth), color, at, scale, look);
}

/** A lathe shape (radius, height)[] in unit space. */
export function turned(c: C, key: string, profile: readonly (readonly [number, number])[], color: PaletteSlot, at: Vec3, scale: Vec3, look?: Look): Mesh {
  return put(c, `l:${key}`, () => lathe(profile, 8), color, at, scale, look);
}

/** A part entry. Weight defaults to 1, cost to 1. */
export function part(
  id: string,
  name: string,
  fits: readonly Slot[],
  tags: readonly string[],
  cost: number,
  mods: readonly Mod[],
  build: (c: C) => void,
  extra: { anchors?: HeadAnchors; anims?: readonly string[]; plans?: readonly string[]; weight?: number } = {},
): MonsterPartDef {
  return { id, name, fits, tags: [...tags, ...fits], cost, mods, build, weight: extra.weight ?? 1, ...extra };
}

/** Mirror helper for centre sockets that build symmetric pairs themselves. */
export function pair(fn: (sx: 1 | -1) => void): void {
  fn(1);
  fn(-1);
}

/**
 * A row of `n` teeth (cones) from `a` to `b`, pointing down (upper jaw, `dir` −1) or up
 * (lower jaw, +1); the middle ones shorter, the ends fang-long when `fangs`.
 */
export function teeth(c: C, color: PaletteSlot, a: Vec3, b: Vec3, n: number, size: number, dir: 1 | -1, fangs = false): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const end = i === 0 || i === n - 1;
    const len = size * (fangs && end ? 2 : 1);
    const at: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + (dir * len) / 2, a[2] + (b[2] - a[2]) * t];
    put(c, 'u:tooth', unitTooth, color, at, [size * 0.7, len, size * 0.7], dir < 0 ? { rot: [180, 0, 0] } : undefined);
  }
}

