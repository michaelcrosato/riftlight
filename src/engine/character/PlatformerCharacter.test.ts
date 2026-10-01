import { describe, expect, it } from 'vitest';
import { AnimationClip, Object3D, Vector3, VectorKeyframeTrack } from 'three/webgpu';
import { Physics, RAPIER } from '../physics/Physics';
import { type MoveInput, PlatformerCharacter } from './PlatformerCharacter';

// Deterministic fixed-step simulations of the real controller on Rapier (no renderer).

const DT = 1 / 60;
const inp = (o: Partial<MoveInput> = {}): MoveInput => ({ move: new Vector3(), jump: false, jumpHeld: false, crouch: false, ...o });

function box(p: Physics, at: [number, number, number], half: [number, number, number], tags: string[] = []) {
  const b = p.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...at));
  const c = p.world.createCollider(RAPIER.ColliderDesc.cuboid(...half), b);
  if (tags.length) p.tag(c, ...tags);
  return c;
}
function run(p: Physics, h: PlatformerCharacter, i: MoveInput | (() => MoveInput), n: number): Set<string> {
  const seen = new Set<string>();
  for (let k = 0; k < n; k++) {
    h.fixedUpdate(DT, typeof i === 'function' ? i() : i);
    p.world.step();
    seen.add(h.state);
  }
  return seen;
}
async function setup(): Promise<Physics> {
  const p = await Physics.create();
  box(p, [0, -0.5, 0], [40, 0.5, 40]);
  return p;
}

describe('PlatformerCharacter', () => {
  it('walks, runs and jumps', async () => {
    const p = await setup();
    const h = new PlatformerCharacter(p, { position: [0, 0, 0] });
    const seen = run(p, h, inp({ move: new Vector3(0, 0, 1) }), 90);
    expect(seen).toContain('run');
    expect(h.feet.z).toBeGreaterThan(3);
    let first = true;
    const air = run(p, h, () => { const j = first; first = false; return inp({ jump: j, jumpHeld: true }); }, 120);
    expect(air).toContain('jump');
    expect(h.grounded).toBe(true);
  });

  it('crouch slide and crouch use the crouch collider', async () => {
    const p = await setup();
    const h = new PlatformerCharacter(p, { position: [0, 0, 0] });
    run(p, h, inp({ move: new Vector3(0, 0, 1) }), 90);
    const seen = run(p, h, inp({ crouch: true }), 120);
    expect(seen).toContain('crouchSlide');
    expect(h.state).toBe('crouch');
    expect(h.stance).toBe('crouch');
    expect(h.collider.halfHeight()).toBeCloseTo(0.2);
  });

  it('does not backflip into a low ceiling', async () => {
    const p = await setup();
    box(p, [0, 1.35, -3], [3, 0.15, 2]); // underside at 1.2
    const h = new PlatformerCharacter(p, { position: [0, 0, -3] });
    run(p, h, inp({ crouch: true }), 20);
    expect(h.stance).toBe('crouch');
    run(p, h, inp({ crouch: true, jump: true, jumpHeld: true }), 1);
    run(p, h, inp({ crouch: true }), 30);
    const top = h.body.translation().y + h.collider.halfHeight() + 0.3;
    expect(top).toBeLessThanOrEqual(1.21);
    expect(h.state).not.toBe('jump');
  });

  it('no false hard landing after a ground pound onto a platform', async () => {
    const p = await setup();
    box(p, [0, 0.7, 0], [2, 0.7, 2]); // platform top 1.4
    const h = new PlatformerCharacter(p, { position: [0, 8, 0] });
    run(p, h, inp(), 20);
    run(p, h, inp({ crouch: true, crouchPressed: true }), 1);
    const pound = run(p, h, inp(), 120);
    expect(pound).toContain('groundPound');
    expect(h.feet.y).toBeCloseTo(1.4, 1);
    const off = run(p, h, inp({ move: new Vector3(1, 0, 0) }), 90);
    expect(off).toContain('fall');
    expect(off).not.toContain('hardLand');
  });

  it('does not pull up into an overhang', async () => {
    const p = await setup();
    box(p, [0, 0.9, -2], [2, 0.9, 0.5]); // ledge top 1.8, face at z = -1.5
    box(p, [0, 2.3, -2.2], [2, 0.2, 1]); // slab 2.1–2.5 above the ledge
    const h = new PlatformerCharacter(p, { position: [0, 0, -1.1] });
    h.facing = Math.PI;
    let first = true;
    const seen = run(p, h, () => { const j = first; first = false; return inp({ move: new Vector3(0, 0, -1), jump: j, jumpHeld: true }); }, 150);
    expect(seen).not.toContain('pullUp');
    expect(h.feet.y).toBeLessThan(0.5);
  });

  it('grabs a clear ledge and pulls up onto it', async () => {
    const p = await setup();
    box(p, [0, 1.2, -2], [2, 1.2, 0.5]); // ledge top 2.4
    const h = new PlatformerCharacter(p, { position: [0, 0, -1.1] });
    h.facing = Math.PI;
    let first = true;
    let pulled = false;
    const seen = run(p, h, () => {
      const j = first;
      first = false;
      pulled ||= h.state === 'pullUp';
      return inp({ move: pulled ? new Vector3() : new Vector3(0, 0, -1), jump: j, jumpHeld: true });
    }, 200);
    expect(seen).toContain('hang');
    expect(seen).toContain('pullUp');
    expect(h.feet.y).toBeCloseTo(2.4, 1);
  });

  it('first person: looking away while climbing keeps climbing', async () => {
    const p = await setup();
    box(p, [0, 3, -2], [2, 3, 0.5], ['climbable']);
    const h = new PlatformerCharacter(p, { position: [0, 0, -1.1] });
    const fwd = new Vector3(0, 0, -1);
    run(p, h, inp({ move: fwd, face: fwd }), 40);
    expect(h.state).toBe('climb');
    const side = new Vector3(-Math.sin(1.25), 0, -Math.cos(1.25));
    const seen = run(p, h, inp({ face: side }), 20);
    expect(seen).not.toContain('fall');
    expect(h.state).toBe('climb');
  });

  it('pushes and stops a pushable block', async () => {
    const p = await setup();
    const body = p.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, -2).enabledRotations(false, false, false));
    p.tag(p.world.createCollider(RAPIER.ColliderDesc.cuboid(0.49, 0.49, 0.49).setFriction(0.1).setDensity(8), body), 'pushable');
    const h = new PlatformerCharacter(p, { position: [0, 0, -0.9] });
    h.facing = Math.PI;
    const seen = run(p, h, inp({ move: new Vector3(0, 0, -1) }), 120);
    expect(seen).toContain('push');
    expect(body.translation().z).toBeLessThan(-3);
    run(p, h, inp(), 2);
    expect(Math.abs(body.linvel().z)).toBeLessThan(0.5);
  });

  it('brakes (skids) to a stop when the stick is let go at a run', async () => {
    const p = await setup();
    const h = new PlatformerCharacter(p, { position: [0, 0, 0] });
    run(p, h, inp({ move: new Vector3(0, 0, 1) }), 60);
    const z0 = h.feet.z;
    const seen = run(p, h, inp(), 90);
    expect(seen).toContain('skid');
    expect(h.state).toBe('idle');
    expect(h.feet.z - z0).toBeLessThan(1.2);
  });

  it('turn-around skid + jump is a side flip; brake + jump is a normal jump', async () => {
    for (const [move, kind] of [[new Vector3(0, 0, -1), 'SideFlip'], [new Vector3(), 'Jump']] as const) {
      const p = await setup();
      const h = new PlatformerCharacter(p, { position: [0, 0, 0] });
      run(p, h, inp({ move: new Vector3(0, 0, 1) }), 60);
      run(p, h, inp({ move }), 4);
      expect(h.state).toBe('skid');
      run(p, h, inp({ move, jump: true, jumpHeld: true }), 1);
      expect(h.jumpKind).toBe(kind);
    }
  });

  it('never brakes off a ledge, and never jumps from mid-air after running off one', async () => {
    let braked = 0;
    for (const release of [0.4, 0.8, 1.2, 1.6, 2.2]) {
      const p = await Physics.create();
      box(p, [0, -0.5, 0], [2, 0.5, 4]); // platform ends at z = 4
      box(p, [0, -10.5, 0], [40, 0.5, 40]);
      const h = new PlatformerCharacter(p, { position: [0, 0, -3.5] });
      run(p, h, inp(), 10);
      let k = 0;
      while (h.feet.z < 4 - release && k++ < 300) run(p, h, inp({ move: new Vector3(0, 0, 1) }), 1);
      const seen = run(p, h, inp(), 120);
      if (seen.has('fall')) expect(seen).not.toContain('skid'); // too close to stop: run off, don't skid off
      else expect(h.feet.y).toBeGreaterThan(-0.05);
      if (seen.has('skid')) braked++;
    }
    expect(braked).toBeGreaterThan(0); // far enough from the edge, it does brake
    // off the edge at a run: a late jump press does nothing
    const p = await Physics.create();
    box(p, [0, -0.5, 0], [2, 0.5, 4]);
    box(p, [0, -10.5, 0], [40, 0.5, 40]);
    const h = new PlatformerCharacter(p, { position: [0, 0, -3.5] });
    run(p, h, inp(), 10); // settle onto the platform
    let k = 0;
    while (h.grounded && k++ < 300) run(p, h, inp({ move: new Vector3(0, 0, 1) }), 1);
    run(p, h, inp(), 12); // past the coyote time
    expect(h.grounded).toBe(false);
    const air = run(p, h, inp({ jump: true, jumpHeld: true }), 2);
    expect(air).not.toContain('jump');
  });

  it('blend weights stay finite and complete through fast state changes, even with dt = 0', async () => {
    const p = await setup();
    const h = new PlatformerCharacter(p, { position: [0, 0, 0] });
    const model = new Object3D();
    const joint = new Object3D();
    joint.name = 'J';
    model.add(joint);
    const clip = (name: string, y: number) => new AnimationClip(name, 1, [new VectorKeyframeTrack('J.position', [0, 1], [0, y, 0, 0, y, 0])]);
    h.attachModel(model, ['Idle', 'Fall', 'Land', 'Run', 'Walk'].map((n, i) => clip(n, i)));
    const states = ['fall', 'land', 'fall', 'fall', 'idle', 'run', 'fall', 'land', 'idle'] as const;
    for (const [i, st] of states.entries()) {
      for (const dt of [0, 0, DT, i % 2 ? 0 : DT / 3]) {
        h.state = st;
        h.updateVisual(model, dt, 1);
        const mix = h.animationMix();
        expect(mix.every((m) => Number.isFinite(m.weight))).toBe(true);
        expect(Number.isFinite(joint.position.y)).toBe(true);
        expect(mix.reduce((sum, m) => sum + m.weight, 0)).toBeGreaterThan(0.99);
      }
    }
  });
});
