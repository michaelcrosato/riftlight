import { describe, expect, it } from 'vitest';
import { Scene, Vector3 } from 'three/webgpu';
import { type MoveInput, PlatformerCharacter } from '../character/PlatformerCharacter';
import { chain, hingeDoor, ropeBridge, seesaw, springPad } from './joints';
import { Physics, RAPIER } from './Physics';

const DT = 1 / 60;
const inp = (o: Partial<MoveInput> = {}): MoveInput => ({ move: new Vector3(), jump: false, jumpHeld: false, crouch: false, ...o });

async function setup(floor = true) {
  const physics = await Physics.create();
  if (floor) physics.addStaticBox({ position: [0, -0.5, 0], halfExtents: [40, 0.5, 40] });
  return { physics, scene: new Scene() };
}
function play(p: Physics, steps: number, h?: PlatformerCharacter, i: MoveInput = inp()) {
  for (let k = 0; k < steps; k++) p.update(DT + 1e-9, h ? () => h.fixedUpdate(DT, i) : undefined);
}

describe('joints', () => {
  it('a chain hangs its length below the anchor, and remove() frees it', async () => {
    const ctx = await setup(false);
    const c = chain(ctx, [0, 10, 0], { links: 6, linkLength: 0.4, end: { ball: 0.5, density: 6 } });
    play(ctx.physics, 120);
    const end = c.end!.translation();
    // a heavy end barely stretches it (links weigh 1/15 of the end, extra solver passes)
    expect(end.y).toBeGreaterThan(10 - 6 * 0.4 - 0.5 - 0.12);
    expect(end.y).toBeLessThan(10 - 6 * 0.4 - 0.5 + 0.02);
    expect(Math.abs(end.x)).toBeLessThan(0.1);
    // a punch moves it (impulses reach every link)
    c.end!.applyImpulse({ x: 0, y: 0, z: 5 * c.end!.mass() }, true);
    play(ctx.physics, 20);
    expect(c.end!.translation().z).toBeGreaterThan(0.5);
    expect(ctx.physics.counts().joints).toBe(7);
    c.remove();
    expect(ctx.physics.counts()).toMatchObject({ bodies: 0, joints: 0, bindings: 0 });
    expect(ctx.scene.children.length).toBe(0);
  });

  it('a rope bridge holds its sag, sinks where the hero stands, and the hero can cross it', async () => {
    const ctx = await setup(false);
    ctx.physics.addStaticBox({ position: [-6, -0.5, 0], halfExtents: [3, 0.5, 2] });
    ctx.physics.addStaticBox({ position: [6, -0.5, 0], halfExtents: [3, 0.5, 2] });
    const b = ropeBridge(ctx, [-3, 0, 0], [3, 0, 0], { planks: 10, sag: 0.3 });
    play(ctx.physics, 120);
    const mid = () => b.planks[5]!.translation().y;
    const rest = mid();
    expect(rest).toBeLessThan(-0.15);
    expect(rest).toBeGreaterThan(-0.8);
    // walk across
    const h = new PlatformerCharacter(ctx.physics, { position: [-5, 0, 0] });
    h.weight = 1;
    let lowest = 0;
    for (let k = 0; k < 600 && h.feet.x < 4.5; k++) {
      play(ctx.physics, 1, h, inp({ move: new Vector3(0.6, 0, 0) }));
      if (Math.abs(h.feet.x) < 0.6) lowest = Math.min(lowest, mid());
    }
    expect(h.feet.x).toBeGreaterThan(4.5);
    expect(h.feet.y).toBeGreaterThan(-0.2);
    expect(lowest).toBeLessThan(rest - 0.05); // the bridge sagged under the hero
  });

  it('a cut bridge swings down and hangs from the other end', async () => {
    const ctx = await setup(false);
    const b = ropeBridge(ctx, [-3, 0, 0], [3, 0, 0], { planks: 8 });
    play(ctx.physics, 30);
    b.cut('to');
    play(ctx.physics, 240);
    const last = b.planks[7]!.translation();
    // hanging from the far end: about its length below it, swinging out less and less
    expect(last.y).toBeLessThan(-3.5);
    expect(Math.abs(last.x + 3)).toBeLessThan(3);
  });

  it('a hinge door swings open when the hero walks into it (shove) and its motor closes it', async () => {
    const ctx = await setup();
    const d = hingeDoor(ctx, [-0.6, 0, 0], { width: 1.2 });
    play(ctx.physics, 30);
    const h = new PlatformerCharacter(ctx.physics, { position: [0, 0, -2] });
    h.shove = 1.5;
    const angle = () => Math.abs(2 * Math.atan2(d.door.rotation().y, d.door.rotation().w));
    let widest = 0;
    for (let k = 0; k < 400 && h.feet.z < 2.5; k++) {
      play(ctx.physics, 1, h, inp({ move: new Vector3(0, 0, 0.5) }));
      widest = Math.max(widest, angle());
    }
    expect(widest).toBeGreaterThan(0.8);
    expect(h.feet.z).toBeGreaterThan(2.5); // walked through
    play(ctx.physics, 300, h);
    expect(angle()).toBeLessThan(0.15); // swung shut
  });

  it('without shove, a door blocks the hero like a wall', async () => {
    const ctx = await setup();
    hingeDoor(ctx, [-0.6, 0, 0], { width: 1.2, closing: 0 });
    const h = new PlatformerCharacter(ctx.physics, { position: [0, 0, -2] });
    play(ctx.physics, 120, h, inp({ move: new Vector3(0, 0, 0.5) }));
    expect(h.feet.z).toBeLessThan(0);
  });

  it('a spring pad rests where it was put, sinks under the hero and comes back', async () => {
    const ctx = await setup();
    // raised: it needs room below to sink into (a pit, in a level)
    const s = springPad(ctx, [0, 1, 0], { stiffness: 40 });
    play(ctx.physics, 120);
    expect(s.pad.translation().y).toBeCloseTo(1, 1);
    const h = new PlatformerCharacter(ctx.physics, { position: [0, 1.15, 0] });
    h.weight = 1;
    play(ctx.physics, 120, h);
    const loaded = s.pad.translation().y;
    expect(loaded).toBeLessThan(0.8);
    expect(Math.abs(h.feet.y - (loaded + 0.15))).toBeLessThan(0.12); // riding it down
    h.teleport([4, 0, 0]);
    play(ctx.physics, 120, h);
    expect(s.pad.translation().y).toBeCloseTo(1, 1);
  });

  it('a seesaw tips toward the heavier end', async () => {
    const ctx = await setup();
    const s = seesaw(ctx, [0, 0, 0], { length: 5 });
    play(ctx.physics, 30);
    const crate = (x: number, density: number) => {
      const b = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 2, 0));
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3).setDensity(density), b);
    };
    crate(-2, 8);
    crate(2, 1);
    play(ctx.physics, 180);
    const r = s.plank.rotation();
    const tilt = 2 * Math.atan2(r.z, r.w); // about Z: positive lifts +X
    expect(tilt).toBeGreaterThan(0.2);
  });
});

describe('riding without weight', () => {
  it('a weightless hero (the default) rides a spring pad without sinking it', async () => {
    const ctx = await setup();
    const s = springPad(ctx, [0, 1, 0], { stiffness: 40 });
    const h = new PlatformerCharacter(ctx.physics, { position: [0, 1.15, 0] });
    play(ctx.physics, 120, h);
    expect(s.pad.translation().y).toBeCloseTo(1, 1);
    expect(h.feet.y).toBeGreaterThan(1.05);
  });
});
