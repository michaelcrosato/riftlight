import { describe, expect, it } from 'vitest';
import { Scene } from 'three/webgpu';
import type { Particles } from '../particles';
import { Breakables } from './breakable';
import { Physics } from './Physics';

const DT = 1 / 60;

async function setup() {
  const physics = await Physics.create();
  physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [20, 0.5, 20] });
  const bursts: string[] = [];
  const particles = { burst: (name: string) => void bursts.push(name) } as unknown as Particles;
  const ctx = { physics, scene: new Scene(), particles };
  return { ctx, bursts, b: new Breakables(ctx) };
}

describe('Breakables', () => {
  it('a block shatters into its cut pieces, which fly from the hit and then dissolve away', async () => {
    const { ctx, bursts, b } = await setup();
    const wall = b.add({ at: [0, 1.5, 0], size: [3, 3, 0.4], color: 'sand', cuts: [3, 2, 1], linger: 1 });
    expect(b.near([0, 1.5, 1], 1)).toBe(wall);
    expect(b.near([0, 1.5, 3], 1)).toBeUndefined();
    expect(b.byCollider(wall.collider!.handle)).toBe(wall);
    const before = ctx.physics.counts().bodies;
    b.break(wall, [0, 1.5, -1], 6);
    expect(wall.broken).toBe(true);
    expect(b.chunks).toBe(6);
    expect(ctx.physics.counts().bodies).toBe(before - 1 + 6);
    expect(bursts).toContain('impact');
    for (let k = 0; k < 30; k++) {
      ctx.physics.update(DT + 1e-9);
      b.update(DT);
    }
    // pushed away from the hit (behind the wall), toward +z
    let z = 0;
    ctx.physics.world.bodies.forEach((body) => {
      if (body.isDynamic()) z += body.translation().z;
    });
    expect(z / 6).toBeGreaterThan(0.3);
    b.break(wall); // twice is harmless
    // linger 1 s, then a 0.6 s dissolve
    for (let k = 0; k < 90; k++) {
      ctx.physics.update(DT + 1e-9);
      b.update(DT);
    }
    expect(b.chunks).toBe(0);
    expect(ctx.physics.counts().bodies).toBe(before - 1);
    expect(ctx.scene.children.length).toBe(0);
    b.restore(wall);
    expect(wall.broken).toBe(false);
    expect(ctx.physics.counts().bodies).toBe(before);
    expect(ctx.scene.children).toContain(wall.mesh);
    b.restore(wall); // whole already: nothing happens
    expect(ctx.physics.counts().bodies).toBe(before);
  });

  it('a crumbling tile shakes while stood on, drops, and grows back', async () => {
    const { ctx, b } = await setup();
    const tile = b.crumble({ at: [0, 3, 0], size: [1, 0.4, 1], color: 'mist', delay: 0.5, regrow: 3 });
    const standing = tile.collider!.handle;
    b.update(DT, standing);
    expect(tile.state).toBe('shaking');
    for (let k = 0; k < 40; k++) b.update(DT, standing);
    expect(tile.state).toBe('falling');
    expect(tile.collider).toBeNull();
    for (let k = 0; k < 60; k++) {
      ctx.physics.update(DT + 1e-9);
      b.update(DT, -1);
    }
    expect(tile.mesh.position.y).toBeLessThan(2.5); // it fell
    for (let k = 0; k < 150; k++) {
      ctx.physics.update(DT + 1e-9);
      b.update(DT, -1);
    }
    expect(tile.state).toBe('solid');
    expect(tile.collider).not.toBeNull();
    expect(tile.mesh.position.y).toBe(3);
    expect(ctx.physics.counts().bodies).toBe(2); // the floor and the tile
  });
});
