/**
 * A conveyor belt's look: stripes across the belt that scroll along it at the belt's speed, so
 * it reads as moving while the mesh stays put (`physics.conveyor` moves what is on it). A
 * room-owned copy of the toon material: shading, outlines and filters as usual.
 *
 *   const mat = beltMaterial(PALETTE.slate, PALETTE.sand, { length: 8, speed: 2 });
 *   // per frame: mat.advance(dt)     (game time: a hitstop or slow motion slows it too)
 */
import { type MeshToonNodeMaterial } from 'three/webgpu';
import { color, fract, mix, step, uniform, uv } from 'three/tsl';
import { toonMaterial } from './toon';

export type BeltMaterial = MeshToonNodeMaterial & {
  /** Belt speed (m/s along +u; negative runs back). */
  speed: number;
  /** Move the stripes on by `dt` seconds of game time. */
  advance(dt: number): void;
};

export function beltMaterial(base: number, stripe: number, o: { length: number; speed: number; pitch?: number; along?: 'u' | 'v' }): BeltMaterial {
  const m = toonMaterial(base).clone() as BeltMaterial;
  m.userData.shared = false; // freed with the level
  const pitch = o.pitch ?? 0.5;
  const offset = uniform(0);
  const along = o.along === 'v' ? uv().y : uv().x;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node
  const u: any = fract(along.mul(o.length / pitch).sub(offset));
  m.colorNode = mix(color(base), color(stripe), step(0.5, u));
  m.speed = o.speed;
  m.advance = (dt) => {
    offset.value = (offset.value + (dt * m.speed) / pitch) % 1;
  };
  return m;
}
