import { describe, expect, it } from 'vitest';
import { Floaters, measure } from './buoyancy';
import { Physics, RAPIER } from './Physics';

const DT = 1 / 60;

async function pool(density: number, at = 3) {
  const p = await Physics.create();
  p.addStaticBox({ position: [0, -5.5, 0], halfExtents: [20, 0.5, 20] }); // the bottom, 5 m down
  const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, at, 0));
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(density), body);
  const splashes: number[] = [];
  const floaters = new Floaters(p.world, (x) => (Math.abs(x) < 10 ? 0 : null), { onSplash: (_x, _y, _z, v) => splashes.push(v) });
  floaters.add(body);
  for (let k = 0; k < 600; k++) p.update(DT + 1e-9, (dt) => floaters.step(dt));
  return { body, floaters, splashes };
}

describe('Floaters', () => {
  it('a body half as dense as the water floats half under, after splashing in', async () => {
    const { body, floaters, splashes } = await pool(0.5);
    expect(body.translation().y).toBeGreaterThan(-0.15);
    expect(body.translation().y).toBeLessThan(0.15);
    expect(floaters.submerged(body)).toBeCloseTo(0.5, 1);
    expect(splashes[0]).toBeGreaterThan(5); // fell 3 m: a big splash (a bob back out and in may splash again)
    expect(Math.abs(body.linvel().y)).toBeLessThan(0.2); // settled
  });

  it('a light one rides high, a heavy one sinks', async () => {
    const light = await pool(0.2, 0);
    expect(light.floaters.submerged(light.body)).toBeLessThan(0.35);
    const heavy = await pool(2, 0);
    expect(heavy.body.translation().y).toBeLessThan(-4);
  });

  it('a tilted body rights itself', async () => {
    const p = await Physics.create();
    const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setRotation({ x: Math.sin(0.4), y: 0, z: 0, w: Math.cos(0.4) }));
    p.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.2, 1).setDensity(0.4), body);
    const floaters = new Floaters(p.world, () => 0);
    floaters.add(body);
    for (let k = 0; k < 600; k++) p.update(DT + 1e-9, (dt) => floaters.step(dt));
    const q = body.rotation();
    expect(Math.abs(q.x) + Math.abs(q.z)).toBeLessThan(0.08);
  });

  it('floats whichever way up it lands (an upside-down crate, a ball)', async () => {
    for (const [desc, rot] of [
      [RAPIER.ColliderDesc.cuboid(0.35, 0.35, 0.35), { x: 1, y: 0, z: 0, w: 0 }],
      [RAPIER.ColliderDesc.cuboid(0.35, 0.35, 0.35), { x: Math.sin(0.6), y: 0, z: 0, w: Math.cos(0.6) }],
      [RAPIER.ColliderDesc.ball(0.28), { x: 0, y: 0, z: 0, w: 1 }],
    ] as const) {
      const p = await Physics.create();
      p.addStaticBox({ position: [0, -1.15, 0], halfExtents: [10, 0.25, 10] }); // the floor, 0.7 m under the surface
      const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0).setRotation(rot));
      p.world.createCollider(desc.setDensity(0.5), body);
      const floaters = new Floaters(p.world, () => -0.2);
      floaters.add(body);
      for (let k = 0; k < 600; k++) p.update(DT + 1e-9, (dt) => floaters.step(dt));
      expect(body.translation().y).toBeGreaterThan(-0.4); // floating, not on the floor
      expect(floaters.submerged(body)).toBeGreaterThan(0.25);
      expect(floaters.submerged(body)).toBeLessThan(0.8);
    }
  });
});

describe('measure', () => {
  it('pushes aside the volume Rapier weighs (box, ball, capsule, cylinder, cone)', async () => {
    const p = await Physics.create();
    const shapes = [
      RAPIER.ColliderDesc.cuboid(0.5, 0.25, 1),
      RAPIER.ColliderDesc.ball(0.4),
      RAPIER.ColliderDesc.capsule(0.6, 0.3),
      RAPIER.ColliderDesc.cylinder(0.5, 0.4),
      RAPIER.ColliderDesc.cone(0.5, 0.4),
    ];
    for (const desc of shapes) {
      const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
      const col = p.world.createCollider(desc.setDensity(2), body);
      const [, hy, , volume] = measure(col);
      expect(volume * 2).toBeCloseTo(body.mass(), 3);
      expect(hy).toBeGreaterThan(0.24);
    }
    const capsule = p.world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.3), p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()));
    expect(measure(capsule)[1]).toBeCloseTo(0.9); // half height + the cap
  });
});
