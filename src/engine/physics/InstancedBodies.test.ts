import { describe, expect, it } from 'vitest';
import { Matrix4, Scene, Vector3 } from 'three/webgpu';
import { InstancedBodies } from './InstancedBodies';
import { Physics } from './Physics';

const DT = 1 / 60;

describe('InstancedBodies', () => {
  it('draws every body as one instance, interpolated between steps, and falls asleep at rest', async () => {
    const p = await Physics.create();
    p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
    const scene = new Scene();
    const balls = new InstancedBodies(p, scene, { shape: 'ball', size: 0.25, capacity: 3 });
    expect(scene.children).toContain(balls.mesh);
    balls.add([0, 2, 0]);
    balls.add([1, 2, 0], { velocity: [0, 5, 0] });
    expect(balls.count).toBe(2);
    expect(balls.mesh.count).toBe(2);
    p.update(DT * 2 + 1e-9);
    balls.sync(0.5); // half way between the last two steps
    const m = new Matrix4();
    const at = new Vector3();
    balls.mesh.getMatrixAt(1, m);
    at.setFromMatrixPosition(m);
    expect(at.x).toBeCloseTo(1, 5);
    expect(at.y).toBeGreaterThan(2); // thrown up
    for (let k = 0; k < 600; k++) p.update(DT + 1e-9);
    expect(balls.sleeping()).toBe(2);
  });

  it('spawn() reuses the oldest body when full; recycle() and clear()', async () => {
    const p = await Physics.create();
    const scene = new Scene();
    const shots = new InstancedBodies(p, scene, { shape: 'box', size: 0.5, capacity: 2, ccd: true });
    const a = shots.spawn([0, 0, 0]);
    const b = shots.spawn([1, 0, 0]);
    expect(a.isCcdEnabled()).toBe(true);
    expect(shots.spawn([5, 5, 5], { velocity: [1, 0, 0] })).toBe(a);
    expect(a.translation().x).toBe(5);
    expect(shots.spawn([6, 6, 6])).toBe(b);
    expect(shots.count).toBe(2);
    for (let k = 0; k < 120; k++) p.update(DT + 1e-9); // falls: no floor
    expect(shots.recycle(0, (i) => [i, 10, 0])).toBe(2);
    expect(a.translation().y).toBe(10);
    shots.dispose();
    expect(p.counts().bodies).toBe(0);
    expect(scene.children).not.toContain(shots.mesh);
  });
});
