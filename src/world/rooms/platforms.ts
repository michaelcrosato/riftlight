/**
 * Moving Platforms: a little course of things that move and carry you. A Ferris wheel up to a
 * ledge, a pendulum platform across a pit, a lift back down, a shuttle across, a turntable
 * with crates, and conveyor belts. Every mover is a kinematic body whose pose is a pure
 * function of physics time; the hero (and crates) ride whatever is under them.
 */
import { BoxGeometry, CylinderGeometry, Group, Mesh } from 'three/webgpu';
import { beltMaterial, orbit, PALETTE, type PaletteColor, pendulum, RAPIER, toonMaterial } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const W = 32;
const D = 26;
/** The pit: x within ±4, z from -12.5 to -1.5. */
const PIT = { x: 4, z0: -12.5, z1: -1.5 };
const LEDGE_Y = 5.4;
const WHEEL: Vec3 = [-11.5, 2.95, -8.4];
const WHEEL_R = 2.6;
const WHEEL_PERIOD = 14;
const PIVOT: Vec3 = [0, 9.73, -11];
const SWING_LEN = 5;
const SWING_PERIOD = 6;
const LIFT: Vec3 = [10, 0, -8.5]; // its north edge meets the ledge
const TURNTABLE: Vec3 = [-9, 0, 6.5];

function rows(): string[] {
  return Array.from({ length: D }, (_, r) =>
    Array.from({ length: W }, (_, c) => {
      const x = c - W / 2 + 0.5;
      const z = r - D / 2 + 0.5;
      if (r === 0 || c === 0) return '#';
      if (r === D - 1 || c === W - 1) return '=';
      if (Math.abs(x) < PIT.x && z > PIT.z0 && z < PIT.z1) return ' ';
      return '.';
    }).join(''),
  );
}

export const PLATFORMS: RoomDef = {
  id: 'platforms',
  title: 'Moving Platforms',
  wing: 'physics',
  about:
    'A loop of things that move and carry you: ride the Ferris wheel up to the ledge, jump on the pendulum platform across the pit, take the lift down and the shuttle back. Then stand on the turntable and the conveyor belts. The hero rides them exactly, frame after frame.',
  try: ['The loop: Ferris wheel, pendulum, lift, shuttle', 'Stand still on the turntable: you turn with it', 'Ride a conveyor belt, then walk against it', 'Slow the game down (T): the platforms slow down with everything else'],
  spawn: [0, 0, 8],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A pit with a platform course around it (a Ferris wheel, a pendulum platform, a lift, a shuttle), a turntable with crates, and two conveyor belts carrying crates.',
    how: [
      'Every platform is a kinematic body: code moves it, physics pushes nothing back. Its pose is a pure function of physics time (a path with easing and holds, a spin, a circle, a pendulum\'s arc), so it moves the same at any frame rate and in replays.',
      'Before every fixed step the engine sets each mover\'s next pose. The character then reads where the platform under its feet goes this step (next pose times this pose inverted) and moves its feet by the same amount: lifts, shuttles and the wheel carry it without sliding or jitter.',
      'A platform that turns (the turntable) also turns the character, and its velocity: you face the way you were facing relative to the disc.',
      'Crates ride the turntable by friction: a kinematic body moving under a dynamic one drags it along through their contact.',
      'A conveyor belt doesn\'t move at all: physics.conveyor(collider, velocity) pulls whatever touches it toward the belt\'s speed (crates), and the character standing on it is carried by it. The stripes scroll in the material at the same speed.',
    ],
    uses: [
      'Moving platforms in every 3D platformer: Mario 64\'s Whomp\'s Fortress, Crash Bandicoot, A Hat in Time.',
      'Conveyor belts and turntables in factory levels: Mega Man, Super Mario Odyssey\'s Bowser\'s Kingdom.',
      'Lifts, trams and ferries: any game with levels that move.',
    ],
    ask: ['a platform that moves back and forth', 'a lift that waits at the top', 'a rotating platform the player stands on', 'a conveyor belt that carries the player and boxes', 'platforms on a Ferris wheel'],
    cost: 'Nothing measurable: each mover is a few lines of math per step; the character casts two short rays a step while standing (what is under its feet, what is coming down on its head).',
    code: [
      {
        title: 'Riding: where this point of the platform goes this step',
        file: 'src/engine/character/PlatformerCharacter.ts',
        src: `const q = this.rideQ.set(nr.x, nr.y, nr.z, nr.w).multiply(this.rideQ2.set(r.x, r.y, r.z, r.w).invert());
const rel = this.rideRel.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(q);
c.x += nt.x + rel.x - p.x;`,
      },
      {
        title: 'Movers: a pose for every physics time',
        file: 'src/engine/physics/Physics.ts',
        src: `// movers first: whoever stands on one reads where it goes this step
this.movers.step((this.steps + 1) * FIXED_DT);`,
      },
    ],
    words: ['kinematic body', 'mover', 'conveyor', 'fixed timestep', 'interpolation', 'friction', 'character controller', 'time scale'],
  },
  build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    const world = physics.world;
    kit.room(W, D, { rows: rows(), floor: ['mist', 'white'], wall: { color: 'blue', side: 'navy' } });
    kit.box([0, -10, (PIT.z0 + PIT.z1) / 2], [PIT.x * 2, 0.5, PIT.z1 - PIT.z0], 'ink', { ghost: true, castShadow: false });

    /** A kinematic platform (top at `at`'s y + h/2), drawn bound to its body. */
    const platform = (at: Vec3, size: Vec3, color: PaletteColor) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...at));
      world.createCollider(RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setFriction(1), body);
      const top = toonMaterial(PALETTE[color]);
      const side = toonMaterial(PALETTE.night);
      const mesh = new Mesh(new BoxGeometry(...size), [side, side, top, side, side, side]);
      mesh.castShadow = mesh.receiveShadow = true;
      ctx.scene.add(mesh);
      physics.bind(body, mesh);
      return { body, mesh };
    };

    // ---------------------------------------------------------------- ledges
    kit.box([-(PIT.x + W / 2 - 1) / 2, LEDGE_Y / 2, -11], [W / 2 - 1 - PIT.x, LEDGE_Y, 3], 'sky', { side: 'blue' });
    kit.box([(PIT.x + W / 2 - 1) / 2, LEDGE_Y / 2, -11], [W / 2 - 1 - PIT.x, LEDGE_Y, 3], 'sky', { side: 'blue' });

    // ---------------------------------------------------------------- Ferris wheel (west): up to the ledge
    const hub = new Group();
    hub.position.set(...WHEEL);
    const spokeMat = toonMaterial(PALETTE.slate);
    for (let i = 0; i < 4; i++) {
      const spoke = new Mesh(new BoxGeometry(WHEEL_R * 2, 0.14, 0.14), spokeMat);
      spoke.rotation.z = (i * Math.PI) / 4;
      spoke.castShadow = true;
      hub.add(spoke);
    }
    hub.position.z = WHEEL[2] - 0.95; // behind the seats, in front of the ledge
    ctx.scene.add(hub);
    kit.box([WHEEL[0], WHEEL[1] / 2, WHEEL[2] - 0.95], [0.4, WHEEL[1], 0.12], 'slate', { ghost: true });
    const seats = [0, 1, 2, 3].map((i) => {
      const s = platform([WHEEL[0], WHEEL[1], WHEEL[2]], [1.7, 0.3, 1.7], 'orange');
      const mover = physics.addMover(s.body, { curve: orbit(WHEEL, WHEEL_R, WHEEL_PERIOD, { start: (i * Math.PI) / 2 }) });
      return { ...s, mover };
    });
    kit.label([WHEEL[0], WHEEL[1] + WHEEL_R + 1.4, WHEEL[2]], 'FERRIS WHEEL · A CIRCLE', { color: 'orange', range: 10 });

    // ---------------------------------------------------------------- pendulum (across the pit, up high)
    const swing = platform([PIVOT[0], PIVOT[1] - SWING_LEN, PIVOT[2]], [2.6, 0.3, 2], 'lime');
    physics.addMover(swing.body, { curve: pendulum(PIVOT, SWING_LEN, 30, SWING_PERIOD) });
    kit.box([PIVOT[0], PIVOT[1] + 0.2, PIVOT[2] - 0.6], [3, 0.4, 0.4], 'night', { ghost: true });
    const rods = new Mesh(new BoxGeometry(0.08, SWING_LEN, 0.08), toonMaterial(PALETTE.slate));
    rods.castShadow = true;
    ctx.scene.add(rods);
    kit.label([PIVOT[0], PIVOT[1] + 1, PIVOT[2]], 'PENDULUM · AN ARC', { color: 'lime', range: 12 });

    // ---------------------------------------------------------------- lift (east): down to the floor
    const lift = platform([LIFT[0], 0.15, LIFT[2]], [2.4, 0.3, 2], 'sand');
    let liftHold = 1.5;
    const liftOptions = () => ({ path: [[LIFT[0], 0.15, LIFT[2]], [LIFT[0], LEDGE_Y - 0.15, LIFT[2]]] as Vec3[], speed: 1.8, hold: liftHold });
    const liftMover = physics.addMover(lift.body, liftOptions());
    kit.label([LIFT[0], 1.2, LIFT[2] + 1.4], 'LIFT · A PATH WITH HOLDS', { color: 'sand', range: 9 });

    // ---------------------------------------------------------------- shuttle (across the pit, on the floor)
    const shuttle = platform([-PIT.x - 1.2, 0.15, -4], [2.4, 0.3, 2.2], 'cyan');
    physics.addMover(shuttle.body, { path: [[-PIT.x - 1.2, 0.15, -4], [PIT.x + 1.2, 0.15, -4]], speed: 2.2, hold: 1.2 });
    kit.label([0, 1.2, -4], 'SHUTTLE', { color: 'cyan', range: 8 });

    // ---------------------------------------------------------------- turntable with crates (south-west)
    const discBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(TURNTABLE[0], 0.15, TURNTABLE[2]));
    world.createCollider(RAPIER.ColliderDesc.cylinder(0.15, 3).setFriction(1.2), discBody);
    const disc = new Mesh(new CylinderGeometry(3, 3, 0.3, 24), toonMaterial(PALETTE.plum));
    disc.castShadow = disc.receiveShadow = true;
    for (let i = 0; i < 4; i++) {
      const stripe = new Mesh(new BoxGeometry(2.8, 0.02, 0.3), toonMaterial(PALETTE.sand));
      stripe.position.set(Math.cos((i * Math.PI) / 2) * 1.5, 0.16, Math.sin((i * Math.PI) / 2) * 1.5);
      stripe.rotation.y = -(i * Math.PI) / 2;
      disc.add(stripe);
    }
    ctx.scene.add(disc);
    physics.bind(discBody, disc);
    let spin = 0.6;
    const spinMover = physics.addMover(discBody, { spin: [0, spin, 0] });
    for (const [dx, dz] of [[1.8, 0], [-1.2, 1.4], [0, -2]] as const) kit.crate([TURNTABLE[0] + dx, 0.75, TURNTABLE[2] + dz], { size: 0.8, color: 'red', side: 'sand' });
    kit.label([TURNTABLE[0], 1.4, TURNTABLE[2]], 'TURNTABLE · A SPIN', { color: 'plum', range: 9 });

    // ---------------------------------------------------------------- conveyor belts (south-east)
    let beltSpeed = 2;
    const belts = ([6, 9] as const).map((z, i) => {
      const dir = i === 0 ? 1 : -1;
      const mat = beltMaterial(PALETTE.slate, PALETTE.night, { length: 10, speed: beltSpeed * dir });
      const mesh = new Mesh(new BoxGeometry(10, 0.2, 1.8), mat);
      mesh.position.set(9, 0.1, z);
      mesh.receiveShadow = true;
      ctx.scene.add(mesh);
      const col = kit.solid([9, 0.1, z], [10, 0.2, 1.8]);
      physics.conveyor(col, [beltSpeed * dir, 0, 0]);
      return { col, mat, dir, z };
    });
    const setBelts = () => {
      for (const b of belts) {
        physics.conveyor(b.col, [beltSpeed * b.dir, 0, 0]);
        b.mat.speed = beltSpeed * b.dir;
      }
    };
    const beltCrates = [0, 1, 2, 3].map((i) => kit.crate([4.6 + i * 2.4, 0.7, i % 2 ? 9 : 6], { size: 0.7, color: i % 2 ? 'sky' : 'orange', side: 'white' }));
    kit.label([9, 1.3, 7.5], 'CONVEYORS', { color: 'sand', range: 9 });
    kit.pad([9, 0, 11.4], {
      label: 'BELTS: REVERSE',
      color: 'slate',
      note: 'physics.conveyor(collider, velocity): the belts never move, they set what touches them moving.',
      apply: () => {
        for (const b of belts) b.dir = -b.dir;
        setBelts();
      },
    });
    kit.pad([-9, 0, 11.4], {
      label: 'SPIN: REVERSE',
      color: 'plum',
      note: 'The turntable turns the other way (its angle stays continuous).',
      apply: () => {
        // keep the angle where it is: a new spin from now (the pose is a function of its clock)
        const t = spinMover.time;
        const angle = spin * (t + (spinMover.options.phase ?? 0));
        spin = -spin;
        spinMover.set({ spin: [0, spin, 0], phase: angle / spin - t });
      },
    });

    kit.light({ position: [0, 7, -6], color: PALETTE.sky, intensity: 5, radius: 16, flicker: 'none' });
    kit.light({ position: [0, 4, 6], color: PALETTE.sand, intensity: 4, radius: 14, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'belt', label: 'Belt speed', min: 0, max: 6, step: 0.25, get: () => beltSpeed, set: (v) => ((beltSpeed = v), setBelts()), format: (v) => `${v} m/s`, initial: 2 },
      { id: 'lift-hold', label: 'Lift wait', min: 0, max: 4, step: 0.25, get: () => liftHold, set: (v) => ((liftHold = v), liftMover.set(liftOptions())), format: (v) => `${v} s`, initial: 1.5 },
    ];
    let falls = 0;
    return {
      knobs,
      fixedUpdate() {
        // crates that ran off the belts' ends come back to their starts
        for (const c of beltCrates) {
          const p = c.body.translation();
          if (p.x > 14.2 || p.x < 3.8 || p.y < -2) {
            const b = belts.find((x) => Math.abs(x.z - p.z) < 1.2) ?? belts[0]!;
            c.body.setTranslation({ x: b.dir > 0 ? 4.4 : 13.6, y: 1, z: b.z }, true);
            c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
        const h = room.hero?.hero;
        if (h && h.feet.y < -3) {
          falls++;
          room.respawn();
          room.toast('Into the pit! The shuttle crosses it on the floor; the pendulum, up on the ledges.');
          ctx.audio.play('hurt');
        }
      },
      update(dt) {
        for (const b of belts) b.mat.advance(dt);
        // the wheel's spokes turn with its seats' clock; the pendulum's rod follows its platform
        hub.rotation.z = (seats[0]!.mover.time * 2 * Math.PI) / WHEEL_PERIOD;
        const p = swing.mesh.position;
        rods.position.set((p.x + PIVOT[0]) / 2, (p.y + PIVOT[1]) / 2, p.z);
        rods.rotation.z = Math.atan2(p.x - PIVOT[0], PIVOT[1] - p.y);
      },
      status: () => `riding ${room.hero?.hero?.groundCollider ?? -1} belts ${beltSpeed}`,
      api: {
        /** What the hero stands on: a mover's name, 'belt', 'floor' or 'air'. */
        standingOn: () => {
          const g = room.hero?.hero?.groundCollider ?? -1;
          if (g < 0) return 'air';
          const of = (b: RAPIER.RigidBody) => b.collider(0).handle === g;
          if (seats.some((s) => of(s.body))) return 'wheel';
          if (of(swing.body)) return 'pendulum';
          if (of(lift.body)) return 'lift';
          if (of(shuttle.body)) return 'shuttle';
          if (of(discBody)) return 'turntable';
          if (belts.some((b) => b.col.handle === g)) return 'belt';
          return 'floor';
        },
        lift: () => lift.body.translation().y,
        /** Start the lift's cycle over: at the bottom, waiting (tests). */
        restartLift: () => liftMover.set({ ...liftOptions(), phase: -liftMover.time }),
        shuttle: () => shuttle.body.translation().x,
        seats: () => seats.map((s) => s.body.translation().y),
        crates: () => beltCrates.map((c) => c.body.translation().x),
        falls: () => falls,
      },
    };
  },
};
