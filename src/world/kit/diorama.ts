/**
 * A little village to look at: houses with roofs, trees, a pond, fences, a lamp, crates and
 * townsfolk (hero mannequins). The look rooms build one so every filter has something to
 * chew on: flat walls, foliage, water, characters, light and shadow.
 */
import { ConeGeometry, Mesh, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor, setLookLayer, toonMaterial } from '../../engine';
import type { Vec3 } from '../types';
import { type Mannequin, mannequin } from './mannequin';
import type { RoomKit } from './RoomKit';

export async function diorama(kit: RoomKit, at: Vec3 = [0, 0, 0]): Promise<{ folk: Mannequin[] }> {
  const ctx = kit.ctx;
  const [ox, oy, oz] = at;
  const p = (x: number, y: number, z: number): Vec3 => [ox + x, oy + y, oz + z];
  // grass base and a path
  kit.box(p(0, 0.1, 0), [14, 0.2, 10], 'green', { side: 'teal' });
  kit.box(p(0, 0.21, 2.2), [14, 0.02, 1.6], 'sand', { ghost: true });
  // houses: walls, a roof (a 4-sided cone), a door and a window
  const houses: { at: Vec3; w: number; d: number; h: number; wall: PaletteColor; roof: PaletteColor }[] = [
    { at: [-4.5, 0, -2.2], w: 3, d: 2.6, h: 2, wall: 'white', roof: 'red' },
    { at: [0.2, 0, -2.6], w: 3.6, d: 2.4, h: 2.6, wall: 'sand', roof: 'blue' },
    { at: [4.6, 0, -2], w: 2.6, d: 2.6, h: 1.8, wall: 'mist', roof: 'plum' },
  ];
  for (const h of houses) {
    const [x, , z] = h.at;
    kit.box(p(x, 0.2 + h.h / 2, z), [h.w, h.h, h.d], h.wall, { side: h.wall });
    const roof = new Mesh(new ConeGeometry(Math.max(h.w, h.d) * 0.78, 1.4, 4), toonMaterial(PALETTE[h.roof]));
    roof.position.set(ox + x, oy + 0.2 + h.h + 0.7, oz + z);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = roof.receiveShadow = true;
    kit.decorate(roof);
    kit.box(p(x, 0.2 + 0.55, z + h.d / 2 + 0.01), [0.6, 1.1, 0.04], 'orange', { ghost: true, castShadow: false });
    kit.box(p(x + h.w / 4 + 0.2, 0.2 + h.h * 0.62, z + h.d / 2 + 0.01), [0.5, 0.45, 0.04], 'cyan', { ghost: true, castShadow: false });
  }
  // pond
  kit.box(p(4.2, 0.22, 3.2), [3, 0.04, 2.2], 'sky', { ghost: true, castShadow: false });
  kit.box(p(4.2, 0.215, 3.2), [3.4, 0.03, 2.6], 'blue', { ghost: true, castShadow: false });
  // fence
  for (let i = 0; i < 7; i++) kit.box(p(-6.6 + i * 0.6, 0.55, 4.5), [0.12, 0.7, 0.12], 'orange', { side: 'plum' });
  kit.box(p(-4.8, 0.7, 4.5), [3.8, 0.1, 0.08], 'orange', { ghost: true });
  // crates (actors: they get the characters' look)
  for (const [x, z, s] of [[-1.8, 0.8, 0.7], [-1.2, 1.1, 0.5], [2.4, 0.9, 0.6]] as const) {
    const c = kit.box(p(x, 0.2 + s / 2, z), [s, s, s], 'orange', { side: 'sand', own: true });
    setLookLayer(c, 'actors');
  }
  // a lamp
  kit.cylinder(p(-2.6, 1.2, 2.8), 0.08, 2, 'night', { segments: 6 });
  kit.box(p(-2.6, 2.3, 2.8), [0.3, 0.3, 0.3], 'sand', { ghost: true, castShadow: false });
  kit.light({ position: p(-2.6, 2.4, 2.8), color: PALETTE.sand, intensity: 6, radius: 6, flicker: 'candle' });
  // trees
  const tree = await ctx.loadModel('assets/tree.glb');
  for (const [i, [x, z, s]] of ([[-6, -4, 1], [6.2, -4.2, 0.9], [-6.2, 1.2, 1.15], [6.4, 1, 0.8], [-3, 4.4, 0.75]] as const).entries()) {
    const t = tree.scene.clone(true);
    t.position.set(ox + x, oy + 0.2, oz + z);
    t.scale.setScalar(s);
    t.rotation.y = i * 1.7;
    kit.decorate(t);
    ctx.physics.addStaticCylinder(p(x, 1, z), 0.8, 0.25);
  }
  // townsfolk
  const folk = await Promise.all([
    mannequin(ctx, 'Wave', p(-0.8, 0.2, 1.8), 0.4),
    mannequin(ctx, 'IdleLook', p(1.6, 0.2, 2.4), -0.6),
    mannequin(ctx, 'Sit', p(-4.2, 0.2, -0.4), 0.2),
  ]);
  return { folk };
}

/** Keep mannequins animating (call from the room's update). */
export function animate(folk: readonly Mannequin[], dt: number): void {
  for (const m of folk) m.mixer.update(dt);
}

export const DIORAMA_CENTER = new Vector3(0, 0, 0);
