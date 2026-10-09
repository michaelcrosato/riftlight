/**
 * Rigid Body Yard: dynamic bodies at work. A crate tower to blast or shoot down, ramps of ice,
 * wood and rubber, balls that thud or bounce, and a pit for the stress test: hundreds of
 * bodies drawn as one instanced mesh, falling asleep as they settle.
 */
import { CylinderGeometry, Mesh, SphereGeometry, Vector3 } from 'three/webgpu';
import { InstancedBodies, PALETTE, type PaletteColor, RAPIER, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const TOWER: Vec3 = [-8, 0, -6];
const CANNON: Vec3 = [-1.5, 0, -4.8]; // in line with the pyramid
const PIT: Vec3 = [8, 0, -6];
const PIT_HALF = 3.4;
const RAMPS: { name: string; friction: number; color: PaletteColor; z: number }[] = [
  { name: 'ICE 0.0', friction: 0, color: 'cyan', z: 3.2 },
  { name: 'WOOD 0.5', friction: 0.5, color: 'orange', z: 5.8 },
  { name: 'RUBBER 1.2', friction: 1.2, color: 'red', z: 8.4 },
];
const BALLS: { name: string; restitution: number; color: PaletteColor; x: number }[] = [
  { name: 'THUD 0.0', restitution: 0, color: 'slate', x: 5 },
  { name: 'HOP 0.5', restitution: 0.5, color: 'lime', x: 8 },
  { name: 'BOUNCE 0.95', restitution: 0.95, color: 'sand', x: 11 },
];

export const BODIES: RoomDef = {
  id: 'bodies',
  title: 'Rigid Body Yard',
  wing: 'physics',
  about:
    'Crates, balls and ramps on a real physics engine (Rapier): a tower to knock down with a blast or a cannon, three ramps that differ only in friction, three balls that differ only in bounciness, and a pit for a stress test of a thousand bodies in one draw call.',
  try: ['Step on BLAST, then REBUILD and FIRE the cannon at the tower', 'SLIDE: the same crate on ice, wood and rubber', 'Fill the pit with 1000 bodies and watch them fall asleep'],
  spawn: [0, 0, 1.5],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A yard of rigid bodies: a crate tower with a blast pad and a cannon, friction ramps, bouncing balls, and a walled pit for a stress test with hundreds of instanced bodies.',
    how: [
      'Every crate and ball is a dynamic rigid body in Rapier, stepped 60 times a second (fixed timestep). Its mesh is drawn between the last two steps (interpolation), so motion is smooth at any frame rate.',
      'BLAST calls physics.explode(at): every dynamic body within the radius gets an impulse away from the centre, fading with distance, with an upward share and a little tumble.',
      'The cannon fires heavy balls with CCD on: a fast ball is swept along its path, so it cannot pass through a crate between two steps.',
      'The ramps differ only in friction (0, 0.5, 1.2), the balls only in restitution (0, 0.5, 0.95). Each collider says how its value combines with the other surface (min for the ramps, max for the balls).',
      'The stress test draws every body as one InstancedMesh (one draw call per shape): each step, the bodies\' poses are copied into a buffer; each frame, instance matrices are blended between the last two.',
      'Bodies that stay still for a moment fall asleep: Rapier stops simulating them until something touches them. The HUD counts them and shows how long a physics step takes.',
    ],
    uses: [
      'Physics toys and destruction: Angry Birds towers, Totally Accurate Battle Simulator, Teardown.',
      'Piles of loot and debris in action games (Diablo\'s gold, Control\'s office chaos), with sleeping keeping them cheap.',
      'Ice and rubber floors in platformers and racing games.',
    ],
    ask: ['a crate tower that falls over when hit', 'an explosion that throws nearby crates', 'a cannon that fires heavy balls', 'an ice floor where crates keep sliding', 'hundreds of physics balls in one draw call'],
    cost: 'Rapier steps on the CPU: about 0.1 ms for a few dozen bodies, a few ms for a thousand awake ones, almost nothing once they sleep. Drawing: one draw call per instanced shape, whatever the count.',
    code: [
      {
        title: 'An explosion: a speed change away from the centre',
        file: 'src/engine/physics/forces.ts',
        src: `const k = (1 - d / r) * dv * b.mass();
const l = d || 1;
b.applyImpulse({ x: (dx / l) * k, y: (dy / l) * k + k * up, z: (dz / l) * k }, true);`,
      },
      {
        title: 'Instanced bodies: blend the last two steps',
        file: 'src/engine/physics/InstancedBodies.ts',
        src: `this.q.slerp(this.q2, alpha);
this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.one));`,
      },
    ],
    words: ['rigid body', 'dynamic body', 'fixed timestep', 'interpolation', 'impulse', 'CCD', 'friction', 'restitution', 'density', 'sleeping', 'solver', 'instancing', 'draw call'],
  },
  build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    const world = physics.world;
    kit.room(32, 26, { floor: ['mist', 'white'], wall: { color: 'slate', side: 'night' } });

    // ---------------------------------------------------------------- the tower
    let crates: { mesh: Mesh; body: RAPIER.RigidBody }[] = [];
    const s = 0.8;
    const build = () => {
      for (const c of crates) {
        physics.remove(c.body);
        c.mesh.removeFromParent();
      }
      crates = [];
      // a pyramid in front, a column behind it
      for (let row = 0; row < 4; row++)
        for (let i = 0; i < 4 - row; i++)
          crates.push(kit.crate([TOWER[0] + (i - (3 - row) / 2) * (s + 0.02), s / 2 + row * s, TOWER[2] + 1.2], { size: s, color: row % 2 ? 'orange' : 'red', side: 'sand' }));
      for (let row = 0; row < 7; row++) crates.push(kit.crate([TOWER[0], s / 2 + row * s, TOWER[2] - 0.6], { size: s, color: row % 2 ? 'blue' : 'sky', side: 'white' }));
    };
    build();
    kit.label([TOWER[0], 6.4, TOWER[2]], 'THE TOWER', { color: 'sand', range: 14 });
    let blastStrength = 12;
    const blast = () => {
      const at: Vec3 = [TOWER[0] + 0.4, 0.4, TOWER[2] + 2.4];
      const hit = physics.explode(at, { radius: 5, impulse: blastStrength });
      ctx.engine.screen.shockwave(new Vector3(...at), { radius: 0.5, strength: 1.2 });
      ctx.engine.shake.add(0.5);
      ctx.particles.burst('smoke', at, { count: 30, scale: 2 });
      ctx.particles.burst('impact', at, { count: 20, speed: 6 });
      ctx.audio.play('punch', { pitch: -6 });
      return hit;
    };
    // ---------------------------------------------------------------- the cannon
    const iron = toonMaterial(PALETTE.night);
    const barrel = new Mesh(new CylinderGeometry(0.32, 0.4, 1.8, 10), iron);
    barrel.rotation.z = Math.PI / 2 - 0.12;
    barrel.position.set(CANNON[0], 1.05, CANNON[2]);
    kit.decorate(barrel);
    const wheelGeo = new CylinderGeometry(0.45, 0.45, 0.14, 12);
    for (const dz of [-0.48, 0.48]) {
      const wheel = new Mesh(wheelGeo, toonMaterial(PALETTE.orange));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(CANNON[0] + 0.3, 0.45, CANNON[2] + dz);
      kit.decorate(wheel);
    }
    kit.solid([CANNON[0], 0.7, CANNON[2]], [1.8, 1.4, 1.1]);
    let power = 24;
    const shots = new InstancedBodies(physics, ctx.scene, { shape: 'ball', size: 0.32, capacity: 8, color: PALETTE.night, density: 8, ccd: true, restitution: 0.1 });
    const fire = () => {
      shots.spawn([CANNON[0] - 1.1, 1.2, CANNON[2]], { velocity: [-power, 2.5, 0] });
      ctx.particles.burst('smoke', [CANNON[0] - 1.2, 1.2, CANNON[2]], { count: 12 });
      ctx.engine.shake.add(0.25);
      ctx.audio.play('punch', { pitch: 4 });
    };
    // ---------------------------------------------------------------- pads
    kit.pad([-11, 0, -1.5], { label: 'REBUILD', color: 'sand', note: 'The tower again: 17 crates, each a dynamic body with a box collider.', apply: build });
    kit.pad([-8, 0, -1.5], { label: 'BLAST', color: 'red', note: 'physics.explode: a speed change away from the centre, fading out at 5 m, with an upward share.', apply: () => void blast() });
    kit.pad([-1.5, 0, -2.2], { label: 'FIRE', color: 'night', note: 'A heavy ball (density 8) with CCD: swept along its path, it cannot tunnel through a crate.', apply: fire });

    // ---------------------------------------------------------------- the stress pit
    const wall = (at: Vec3, size: Vec3) => kit.box(at, size, 'slate', { side: 'night' });
    wall([PIT[0], 0.6, PIT[2] - PIT_HALF - 0.2], [PIT_HALF * 2 + 0.8, 1.2, 0.4]);
    wall([PIT[0], 0.6, PIT[2] + PIT_HALF + 0.2], [PIT_HALF * 2 + 0.8, 1.2, 0.4]);
    wall([PIT[0] - PIT_HALF - 0.2, 0.6, PIT[2]], [0.4, 1.2, PIT_HALF * 2]);
    wall([PIT[0] + PIT_HALF + 0.2, 0.6, PIT[2]], [0.4, 1.2, PIT_HALF * 2]);
    kit.label([PIT[0], 2.6, PIT[2]], 'STRESS TEST', { color: 'sand', range: 14 });
    const boxes = new InstancedBodies(physics, ctx.scene, { shape: 'box', size: 0.42, capacity: 600, color: 0xffffff, density: 1 });
    const balls = new InstancedBodies(physics, ctx.scene, { shape: 'ball', size: 0.22, capacity: 600, color: 0xffffff, density: 1, restitution: 0.3 });
    const tints = [PALETTE.red, PALETTE.orange, PALETTE.sand, PALETTE.lime, PALETTE.sky, PALETTE.plum];
    let seed = 1;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let pending = 0;
    const fill = (n: number) => {
      boxes.clear();
      balls.clear();
      seed = 1;
      pending = n;
    };
    for (const [i, n] of [100, 400, 1000].entries())
      kit.pad([PIT[0] - 3.3 + i * 2.2, 0, -1.5], { label: `${n} BODIES`, color: 'lime', group: 'stress', note: `${n} bodies rain into the pit: two InstancedMeshes (boxes, balls), two draw calls whatever the count.`, apply: () => fill(n) });
    kit.pad([PIT[0] + 3.3, 0, -1.5], { label: 'CLEAR', color: 'slate', group: 'stress', note: 'Every stress body removed.', apply: () => fill(0) });

    // ---------------------------------------------------------------- ramps
    const rampLen = 6.4;
    const angle = 28; // tan 28° = 0.53: wood (0.5) just slides, rubber (1.2) holds
    const rad = (angle * Math.PI) / 180;
    const ramps = RAMPS.map((r) => {
      const cx = -10;
      const top = Math.sin(rad) * rampLen;
      kit.box([cx, top / 2, r.z], [rampLen, 0.3, 2], r.color, { side: 'night', rotZ: -angle, ghost: true });
      const col = kit.solid([cx, top / 2, r.z], [rampLen, 0.3, 2], { rotZ: -angle, friction: r.friction });
      col.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      kit.box([cx - rampLen / 2 * Math.cos(rad) - 0.6, top / 2 + 0.2, r.z], [1.2, top + 0.4, 2.2], 'slate', { side: 'night' });
      kit.label([cx - 2.6, top + 1.2, r.z], r.name, { color: r.color, range: 12 });
      return { ...r, start: [cx - rampLen / 2 * Math.cos(rad) + 0.6, top + 0.15, r.z] as Vec3, crate: null as { mesh: Mesh; body: RAPIER.RigidBody } | null };
    });
    const slide = () => {
      for (const r of ramps) {
        if (r.crate) {
          physics.remove(r.crate.body);
          r.crate.mesh.removeFromParent();
        }
        const c = kit.crate([r.start[0], r.start[1] + 0.4, r.start[2]], { size: 0.7, color: r.color, side: 'white', damping: 0.12 });
        const col = c.body.collider(0);
        col.setFriction(r.friction);
        col.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
        // tilt it onto the slope
        c.body.setRotation({ x: 0, y: 0, z: -Math.sin(rad / 2), w: Math.cos(rad / 2) }, true);
        r.crate = c;
      }
    };
    kit.pad([-4.5, 0, 10.4], { label: 'SLIDE', color: 'cyan', note: 'The same crate on three ramps: friction 0, 0.5 and 1.2 (the lower of the two surfaces counts).', apply: slide });

    // ---------------------------------------------------------------- bouncing balls
    const ballGeo = new SphereGeometry(0.4, 14, 10);
    const drops = BALLS.map((b) => {
      const mesh = new Mesh(ballGeo, toonMaterial(PALETTE[b.color]));
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      ctx.scene.add(mesh);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(b.x, 6, 6.5).lockRotations());
      const col = world.createCollider(RAPIER.ColliderDesc.ball(0.4).setRestitution(b.restitution).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max), body);
      void col;
      physics.bind(body, mesh);
      kit.label([b.x, 0.4, 8], b.name, { color: b.color, range: 12 });
      return { ...b, body, top: 0 };
    });
    const drop = () => {
      for (const d of drops) {
        d.body.setTranslation({ x: d.x, y: 6, z: 6.5 }, true);
        d.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    };
    kit.pad([8, 0, 10.4], { label: 'DROP', color: 'sand', note: 'Three balls from 6 m: restitution 0 thuds, 0.5 hops, 0.95 keeps bouncing (the higher of the two surfaces counts).', apply: drop });

    kit.light({ position: [0, 6, 0], color: PALETTE.white, intensity: 4, radius: 18, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'gravity', label: 'Gravity (bodies)', min: -40, max: 0, step: 1, get: () => world.gravity.y, set: (v) => (world.gravity = { x: 0, y: v, z: 0 }), format: (v) => `${v} m/s²`, initial: -24, hint: 'The hero keeps their own gravity: only bodies change.' },
      { id: 'solver', label: 'Solver passes', min: 1, max: 12, step: 1, get: () => world.numSolverIterations, set: (v) => (world.numSolverIterations = v), initial: world.numSolverIterations, hint: 'Fewer passes: wobbly, sinking stacks. More: stiffer, slower.' },
      { id: 'blast', label: 'Blast strength', min: 2, max: 30, step: 1, get: () => blastStrength, set: (v) => (blastStrength = v), format: (v) => `${v} m/s`, initial: 12 },
      { id: 'cannon', label: 'Cannon speed', min: 6, max: 50, step: 1, get: () => power, set: (v) => (power = v), format: (v) => `${v} m/s`, initial: 24 },
    ];
    return {
      knobs,
      fixedUpdate() {
        // rain the stress bodies in, a few per step
        for (let k = 0; k < 8 && pending > 0; k++, pending--) {
          const at: Vec3 = [PIT[0] + (rnd() - 0.5) * (PIT_HALF * 2 - 0.6), 5 + rnd() * 3, PIT[2] + (rnd() - 0.5) * (PIT_HALF * 2 - 0.6)];
          const tint = tints[Math.floor(rnd() * tints.length)]!;
          if (pending % 2) boxes.add(at, { color: tint, spin: [rnd() * 4, rnd() * 4, 0] });
          else balls.add(at, { color: tint });
        }
      },
      update() {
        boxes.sync(physics.alpha);
        balls.sync(physics.alpha);
        shots.sync(physics.alpha);
        for (const d of drops) d.top = Math.max(d.top, d.body.translation().y);
      },
      draw() {
        const n = boxes.count + balls.count;
        if (n === 0) return;
        ctx.hud.text(4, 18, `BODIES ${n} · ASLEEP ${boxes.sleeping() + balls.sleeping()} · STEP ${physics.stepMs.toFixed(2)} MS`, { anchor: 'bottom-left', color: 'sand' });
      },
      status: () => `crates ${crates.length} stress ${boxes.count + balls.count} asleep ${boxes.sleeping() + balls.sleeping()} step ${physics.stepMs.toFixed(2)}ms`,
      api: {
        blast,
        fire,
        build,
        slide,
        drop,
        fill,
        /** Crates still standing near the tower's spot (within 1.5 m, above the floor). */
        standing: () => crates.filter((c) => Math.hypot(c.body.translation().x - TOWER[0], c.body.translation().z - TOWER[2] - 0.3) < 1.5 && c.body.translation().y > s).length,
        stress: () => ({ bodies: boxes.count + balls.count, asleep: boxes.sleeping() + balls.sleeping(), pending, stepMs: physics.stepMs }),
        slid: () => ramps.map((r) => (r.crate ? r.crate.body.translation().x - r.start[0] : 0)),
        bounces: () => drops.map((d) => d.body.translation().y),
      },
    };
  },
};
