import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three/webgpu';
import { PlatformerCharacter } from '../character/PlatformerCharacter';
import { FIXED_DT, Physics, RAPIER } from './Physics';

const baseline = { bodies: 0, colliders: 0, tags: 0, bindings: 0, triggers: 0, controllers: 0 };

describe('Physics lifecycle', () => {
  it('remove() drops a body with its colliders, tags and binding', async () => {
    const p = await Physics.create();
    const body = p.addDynamicBox({ position: [0, 2, 0], halfExtents: [0.5, 0.5, 0.5] });
    p.tag(body.collider(0), 'pushable');
    p.bind(body, new Object3D());
    expect(p.counts()).toMatchObject({ bodies: 1, colliders: 1, tags: 1, bindings: 1 });
    p.remove(body);
    expect(p.counts()).toEqual(baseline);
    p.remove(body); // twice is harmless
  });

  it('remove(collider) of a static box also removes its now-empty fixed body', async () => {
    const p = await Physics.create();
    const c = p.tag(p.addStaticBox({ position: [0, 0, 0], halfExtents: [1, 1, 1] }), 'climbable');
    p.remove(c);
    expect(p.counts()).toEqual(baseline);
    // Handles are recycled by Rapier: a new collider must not inherit the old tags.
    const fresh = p.addStaticBox({ position: [0, 0, 0], halfExtents: [1, 1, 1] });
    expect(p.hasTag(fresh, 'climbable')).toBe(false);
  });

  it('clear() empties the world, including character controllers and triggers', async () => {
    const p = await Physics.create();
    for (let i = 0; i < 3; i++) {
      p.tag(p.addStaticBox({ position: [i, 0, 0], halfExtents: [1, 1, 1] }), 'noLedge');
      p.bind(p.addDynamicBox({ position: [i, 3, 0], halfExtents: [0.4, 0.4, 0.4] }), new Object3D());
      p.trigger({ sphere: 1 }, [i, 5, 0]);
    }
    new PlatformerCharacter(p, { position: [0, 2, 4] });
    const full = p.counts();
    expect(full.controllers).toBe(1);
    expect(full.bodies).toBe(7);
    p.update(0.1);
    p.clear();
    expect(p.counts()).toEqual(baseline);
    // The world is still usable afterwards.
    p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [5, 0.5, 5] });
    p.update(0.1);
    expect(p.counts().bodies).toBe(1);
  });
});

describe('Physics triggers', () => {
  it('fires enter once and exit once for a falling body, ignoring static geometry', async () => {
    const p = await Physics.create();
    p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
    const events: string[] = [];
    // The zone overlaps the floor: static colliders must not count.
    p.trigger({ box: [1, 1, 1] }, [0, 0.5, 0], {
      onEnter: () => events.push('enter'),
      onExit: () => events.push('exit'),
    });
    const box = p.addDynamicBox({ position: [0, 6, 0], halfExtents: [0.25, 0.25, 0.25] });
    for (let i = 0; i < 120; i++) p.update(FIXED_DT);
    expect(events).toEqual(['enter']);
    box.setTranslation({ x: 5, y: 1, z: 0 }, true);
    p.update(FIXED_DT);
    expect(events).toEqual(['enter', 'exit']);
  });

  it('filters by tag, removes itself with once, and reports exits of removed colliders', async () => {
    const p = await Physics.create();
    const hits: number[] = [];
    const pickup = p.trigger({ sphere: 1 }, [0, 0, 0], { tag: 'character', once: true, onEnter: (c) => hits.push(c.handle) });
    const zone = p.trigger({ box: [2, 2, 2] }, [0, 0, 0], { onExit: () => hits.push(-1) });
    const crate = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
    p.world.createCollider(RAPIER.ColliderDesc.ball(0.3), crate);
    p.update(FIXED_DT);
    expect(hits).toEqual([]); // untagged: the pickup ignores it
    expect(zone.inside.size).toBe(1);
    const hero = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.5, 0));
    const heroCol = p.tag(p.world.createCollider(RAPIER.ColliderDesc.ball(0.3), hero), 'character');
    p.update(FIXED_DT);
    expect(hits).toEqual([heroCol.handle]);
    expect(pickup.removed).toBe(true);
    expect(p.counts().triggers).toBe(1);
    p.remove(crate);
    expect(hits).toEqual([heroCol.handle, -1]);
    zone.remove();
    expect(p.counts().triggers).toBe(0);
  });

  it('detects the PlatformerCharacter walking into it', async () => {
    const p = await Physics.create();
    p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [20, 0.5, 20] });
    const hero = new PlatformerCharacter(p, { position: [0, 0, 0] });
    let entered = 0;
    p.trigger({ sphere: 0.5 }, [0, 0.6, 3], { tag: 'character', onEnter: () => entered++ });
    const move = { move: new Vector3(0, 0, 1), jump: false, jumpHeld: false, crouch: false };
    for (let i = 0; i < 90; i++) p.update(FIXED_DT, (dt) => hero.fixedUpdate(dt, move));
    expect(hero.feet.z).toBeGreaterThan(3);
    expect(entered).toBe(1);
  });
});

describe('Physics.clear() from inside a step (level unloads from game code)', () => {
  it('a trigger callback that clears the world stops the other triggers and the step loop', async () => {
    const p = await Physics.create();
    const fired: string[] = [];
    const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
    p.world.createCollider(RAPIER.ColliderDesc.ball(0.3), body);
    const first = p.trigger({ sphere: 1 }, [0, 0, 0], { onEnter: () => (fired.push('door'), p.clear()) });
    const second = p.trigger({ sphere: 1 }, [0, 0, 0], { onEnter: () => fired.push('second') });
    const steps0 = p.steps;
    p.update(FIXED_DT * 4); // 4 steps due, the first one clears the world
    expect(fired).toEqual(['door']);
    expect(first.removed && second.removed).toBe(true);
    expect(p.steps - steps0).toBe(1);
    expect(p.counts()).toEqual(baseline);
  });

  it('fixedUpdate that clears the world ends the frame without stepping a stale world', async () => {
    const p = await Physics.create();
    p.addDynamicBox({ position: [0, 3, 0], halfExtents: [0.5, 0.5, 0.5] });
    let calls = 0;
    p.update(FIXED_DT * 3, () => {
      calls++;
      p.clear();
    });
    expect(calls).toBe(1);
    expect(p.counts()).toEqual(baseline);
  });
});
