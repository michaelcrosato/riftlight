import { describe, expect, it } from 'vitest';
import { Physics, RAPIER } from './Physics';
import { Rewind } from './rewind';

const DT = 1 / 60;

async function drop() {
  const p = await Physics.create();
  p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
  const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
  p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3), body);
  body.setAngvel({ x: 2, y: 1, z: 0 }, true);
  return { p, body };
}
const step = (p: Physics, n: number) => {
  for (let i = 0; i < n; i++) p.update(DT + 1e-9);
};

describe('Rewind', () => {
  it('plays the record backwards, step for step', async () => {
    const { p, body } = await drop();
    const rewind = new Rewind(p, { seconds: 2 });
    rewind.track(body);
    const path: number[] = [];
    for (let i = 0; i < 40; i++) {
      step(p, 1);
      path.push(body.translation().y);
    }
    rewind.rewinding = true;
    step(p, 10); // ten steps back: where it was after step 30 (path[29])
    expect(body.translation().y).toBeCloseTo(path[29]!, 5);
    step(p, 20);
    expect(body.translation().y).toBeCloseTo(path[9]!, 5);
    expect(rewind.length).toBe(10);
  });

  it('carries on from the moment you let go, with that moment\'s velocity', async () => {
    const { p, body } = await drop();
    const rewind = new Rewind(p, { seconds: 2 });
    rewind.track(body);
    step(p, 30);
    const vy = body.linvel().y;
    step(p, 20);
    rewind.rewinding = true;
    step(p, 20);
    expect(body.linvel().y).toBeCloseTo(vy, 4);
    rewind.rewinding = false;
    const y = body.translation().y;
    step(p, 5);
    expect(body.translation().y).toBeLessThan(y); // still falling, and recording again
    expect(rewind.length).toBe(35);
  });

  it('stops at the oldest moment it has, and forgets past its length', async () => {
    const { p, body } = await drop();
    const rewind = new Rewind(p, { seconds: 0.5 });
    rewind.track(body);
    step(p, 60); // 1 s, only the last 0.5 s kept
    expect(rewind.fill).toBe(1);
    rewind.rewinding = true;
    step(p, 100);
    expect(rewind.length).toBe(1); // the oldest moment, held
    const y = body.translation().y;
    step(p, 10);
    expect(body.translation().y).toBeCloseTo(y, 2); // held at the oldest record (gravity undone each step)
  });

  it('rewinds extra state with it, and skips a body removed meanwhile', async () => {
    const { p, body } = await drop();
    const rewind = new Rewind(p, { seconds: 1 });
    let score = 0;
    rewind.extra(
      () => [score],
      (v) => (score = v[0]!),
    );
    rewind.track(body);
    for (let i = 0; i < 20; i++) {
      score = i;
      step(p, 1);
    }
    p.remove(body);
    rewind.rewinding = true;
    step(p, 5);
    expect(score).toBe(14); // five steps back from 19
    rewind.dispose();
    step(p, 5);
    expect(score).toBe(14);
  });

  it('bound meshes show the rewound pose (listeners run before bindings read their bodies)', async () => {
    const { p, body } = await drop();
    const { Object3D } = await import('three/webgpu');
    const mesh = new Object3D();
    p.bind(body, mesh);
    const rewind = new Rewind(p, { seconds: 1 });
    rewind.track(body);
    step(p, 30);
    rewind.rewinding = true;
    step(p, 9);
    const shown = body.translation().y; // the rewound pose one step ago…
    step(p, 1);
    // …is what the binding drew from (alpha ~0), not that pose stepped forward by the solver
    expect(mesh.position.y).toBeCloseTo(shown, 4);
  });

  it('never touches a newer body that took a removed one\'s slot', async () => {
    const { p, body } = await drop();
    const rewind = new Rewind(p, { seconds: 1 });
    rewind.track(body);
    step(p, 20);
    const slot = (h: number) => new Uint32Array(new Float64Array([h]).buffer)[0];
    const was = body.handle;
    p.remove(body);
    const other = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(4, 1, 4));
    p.world.createCollider(RAPIER.ColliderDesc.ball(0.3), other);
    expect(slot(other.handle)).toBe(slot(was)); // the same slot, a newer generation
    expect(p.world.bodies.contains(was)).toBe(true); // why a handle lookup is not enough
    step(p, 5); // recording: the dead body is skipped (reading it would crash)
    rewind.rewinding = true;
    step(p, 10); // and going back: the newer body is not put where the old one was
    expect(other.translation().x).toBeCloseTo(4, 5);
  });

  it('puts back sleep: a body that slept then sleeps again when you let go, even on a slope', async () => {
    const { p } = await drop();
    // a ramp, 14° up toward +x, and a ball 2 cm above it (as the Time Lab's: each time it is
    // woken it falls a step before it is put back to sleep)
    const tilt = (14 * Math.PI) / 180;
    const ramp = p.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(3, 0.5, 0).setRotation({ x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) }));
    p.world.createCollider(RAPIER.ColliderDesc.cuboid(2.5, 0.15, 1), ramp);
    const ball = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(4.5, 1.36, 0));
    p.world.createCollider(RAPIER.ColliderDesc.ball(0.3), ball);
    step(p, 1); // a new body is woken by its first step: put it to sleep after that
    ball.sleep();
    const rewind = new Rewind(p, { seconds: 1 });
    rewind.track(ball);
    step(p, 10);
    expect(ball.isSleeping()).toBe(true);
    const at = { ...ball.translation() };
    ball.wakeUp();
    step(p, 20);
    expect(ball.translation().x).toBeLessThan(at.x - 0.1); // it rolls down
    rewind.rewinding = true;
    step(p, 40); // all the way back, to before it rolled, and held there
    rewind.rewinding = false;
    step(p, 30);
    expect(ball.isSleeping()).toBe(true);
    expect(Math.hypot(ball.translation().x - at.x, ball.translation().y - at.y)).toBeLessThan(0.01);
  });

  it('a body put back asleep still takes a hit that comes right after letting go', async () => {
    // box a slides into box b, asleep; let go just before they meet: b is knocked on as before
    const setup = async () => {
      const p = await Physics.create();
      p.addStaticBox({ position: [0, -0.5, 0], halfExtents: [10, 0.5, 10] });
      const box = (x: number) => {
        const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 0.3, 0));
        p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3).setFriction(0.3), body);
        return body;
      };
      const a = box(-1.1); // the floor's friction stops it in about 0.6 m: close enough to reach b
      const b = box(0);
      step(p, 1);
      b.sleep();
      a.setLinvel({ x: 4, y: 0, z: 0 }, true);
      return { p, a, b };
    };
    const forward = await setup();
    const xs: number[] = [];
    for (let i = 0; i < 60; i++) {
      step(forward.p, 1);
      xs.push(forward.b.translation().x);
    }
    const hit = xs.findIndex((x) => x > 1e-3); // the step b starts moving
    expect(hit).toBeGreaterThan(5);
    const { p, b } = await setup();
    const rewind = new Rewind(p, { seconds: 2 });
    rewind.trackAll();
    step(p, hit + 20);
    rewind.rewinding = true;
    step(p, 21); // back to where the first run was at xs[hit - 2]: b still asleep, the hit one step off
    rewind.rewinding = false;
    step(p, 30); // as far on as xs[hit + 28]
    // most of the way it went the first time (the solver's warm start from contacts is not
    // recorded, so not all of it); a hit swallowed by putting b back to sleep leaves it under a tenth
    expect(b.translation().x).toBeGreaterThan(xs[hit + 28]! * 0.5);
  });

  it('goes back ahead of other step listeners, whenever they were added', async () => {
    const { p, body } = await drop();
    const seen: number[] = [];
    p.onStep(() => seen.push(body.translation().y)); // added before the rewind
    const rewind = new Rewind(p, { seconds: 1 });
    rewind.track(body);
    step(p, 20);
    rewind.rewinding = true;
    step(p, 1);
    expect(seen.at(-1)).toBeCloseTo(body.translation().y, 6); // it saw the rewound pose
    expect(seen.at(-1)).toBeCloseTo(seen.at(-3)!, 6); // one step back from the newest: the one before it
  });
});
