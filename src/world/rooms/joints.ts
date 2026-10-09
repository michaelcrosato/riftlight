/**
 * Joints & Ropes: bodies tied together. A rope bridge over a trench (walk it, cut it), a
 * wrecking ball on a chain, a seesaw, spring pads that sink under you, saloon doors that swing
 * when you walk through them, and bead curtains to brush past.
 */
import { Vector3 } from 'three/webgpu';
import { type Built, chain, hingeDoor, PALETTE, RAPIER, ropeBridge, seesaw, springPad } from '../../engine';
import { Strikes } from '../kit/strike';
import type { Knob, RoomDef, Vec3 } from '../types';

const W = 32;
const D = 24;
/** The trench: x from -3 to 3, all the way across. */
const TRENCH = 3;
const BALL: Vec3 = [-9, 6.4, -7];
const SEESAW: Vec3 = [-9, 0, 5];
const SPRINGS = [
  { x: 6, k: 15, name: 'SOFT 15' },
  { x: 9, k: 40, name: 'MEDIUM 40' },
  { x: 12, k: 120, name: 'FIRM 120' },
];
const DOORWAY = 9.5;

/** The room's map: walls, the trench (no floor), pits under the spring pads. */
function rows(): string[] {
  return Array.from({ length: D }, (_, r) =>
    Array.from({ length: W }, (_, c) => {
      const x = c - W / 2 + 0.5;
      const z = r - D / 2 + 0.5;
      if (r === 0 || c === 0) return '#';
      if (r === D - 1 || c === W - 1) return '=';
      if (Math.abs(x) < TRENCH) return ' ';
      if (SPRINGS.some((s) => Math.abs(x - s.x) < 1 && Math.abs(z + 7) < 1)) return 'p';
      return '.';
    }).join(''),
  );
}

export const JOINTS: RoomDef = {
  id: 'joints',
  title: 'Joints & Ropes',
  wing: 'physics',
  about:
    'Bodies tied together by joints: a rope bridge that sags where you stand (cut it!), a wrecking ball on a chain, a seesaw that tips toward the heavier crate, spring pads that sink under your weight, and saloon doors that swing open when you walk through.',
  try: ['Walk the bridge, then step on CUT and watch it swing down', 'SWING the wrecking ball into the crates, or punch it (J)', 'Stand on the SOFT, MEDIUM and FIRM spring pads', 'Walk through the saloon doors, then LOCK them'],
  spawn: [-6, 0, 0],
  facing: Math.PI / 2,
  background: 'night',
  guide: {
    what: 'A trench with a rope bridge, a wrecking ball on a chain over a crate wall, a seesaw, three spring pads in pits, swinging saloon doors and hanging bead curtains.',
    how: [
      'A joint ties two bodies: a ball joint keeps two points together (chains, bridge ropes), a hinge (revolute joint) allows turning about one axis (doors, the seesaw), a slider (prismatic joint) moves along one axis (spring pads).',
      'The bridge: planks joined edge to edge by two ball joints per seam, so each seam bends like a hinge. The hero stands on a dynamic plank: it is carried by the plank\'s velocity under its feet and presses the plank down with its weight, so the bridge sags where you stand.',
      'The wrecking ball\'s chain: the solver works in passes, and a light chain under a heavy ball would stretch like elastic. So its links weigh at least 1/15 of the ball and get four extra solver passes: it stretches by a few centimetres.',
      'Spring pads and the doors use a joint motor as a spring: it pushes toward a target position with a stiffness and damping per unit of mass, so a pad holds its own weight and sinks under yours.',
      'Walking into a loose dynamic body shoves it: the character controller reports what it bumped into, and the engine pushes the touched point toward the hero\'s speed (heavier bodies move less). That is how the doors and bead curtains swing.',
      'CUT removes the two joints at one end of the bridge: it swings down and hangs from the other end.',
    ],
    uses: [
      'Rope bridges and swinging platforms: Uncharted, Zelda: Tears of the Kingdom, Banjo-Kazooie.',
      'Wrecking balls and chains: Angry Birds, physics puzzles, boss arenas.',
      'Swing doors and hanging things you brush past: Half-Life 2, Red Dead Redemption saloons.',
    ],
    ask: ['a rope bridge the player can walk on that sags', 'a wrecking ball on a chain', 'saloon doors that swing when you walk through', 'a platform on a spring that sinks when you stand on it', 'a seesaw that tips with weight'],
    cost: 'A joint costs about as much as a contact: the bridge (10 planks, 22 joints), the chain (11 links) and everything else together take well under a millisecond per step.',
    code: [
      {
        title: 'Two ball joints per seam: the bridge bends like a hinge',
        file: 'src/engine/physics/joints.ts',
        src: `const join = (a: RAPIER.RigidBody, aAt: number, b: RAPIER.RigidBody, bAt: number, ay = 0, by = 0) =>
[-1, 1].map((s) => world.createImpulseJoint(RAPIER.JointData.spherical(v(aAt, ay, (s * w) / 2), v(bAt, by, (s * w) / 2)), a, b, true));`,
      },
      {
        title: 'Standing on a dynamic body: carried by it, pressing it down',
        file: 'src/engine/character/PlatformerCharacter.ts',
        src: `const v = body.velocityAtPoint(p);
c.x += v.x * dt;
if (this.weight > 0) body.applyImpulseAtPoint({ x: 0, y: this.physics.world.gravity.y * this.weight * dt, z: 0 }, p, true);`,
      },
      {
        title: 'A joint motor as a spring, per unit mass',
        file: 'src/engine/physics/joints.ts',
        src: `j.configureMotorModel(RAPIER.MotorModel.ForceBased);
j.configureMotorPosition(target, stiffness * mass, damping * mass);`,
      },
    ],
    words: ['joint', 'ball joint', 'hinge', 'slider', 'motor', 'solver', 'dynamic body', 'impulse', 'density', 'rigid body', 'character controller'],
  },
  build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    kit.room(W, D, { rows: rows(), floor: ['slate', 'night'], wall: { color: 'plum', side: 'night' }, legend: { p: { floor: -1, floorColor: 'night' } } });
    // the trench's far bottom (just a look: falling in puts you back)
    kit.box([0, -9, 0], [TRENCH * 2, 0.5, D], 'ink', { ghost: true, castShadow: false });

    // ---------------------------------------------------------------- the bridge
    let bridge = ropeBridge(ctx, [-TRENCH, 0, 0], [TRENCH, 0, 0], { planks: 10, width: 1.6, sag: 0.35 });
    let cut = false;
    const rebuild = () => {
      bridge.remove();
      bridge = ropeBridge(ctx, [-TRENCH, 0, 0], [TRENCH, 0, 0], { planks: 10, width: 1.6, sag: 0.35 });
      cut = false;
    };
    kit.pad([-5.2, 0, -2.6], {
      label: 'CUT',
      color: 'red',
      note: 'The two joints at the far end go: the bridge swings down and hangs from this side.',
      apply: () => {
        if (!cut) bridge.cut('to');
        cut = true;
      },
    });
    kit.pad([-5.2, 0, 2.6], { label: 'NEW BRIDGE', color: 'orange', note: 'A fresh bridge: 10 planks, two ball joints per seam.', apply: rebuild });

    // ---------------------------------------------------------------- the wrecking ball
    kit.box([BALL[0], 6.75, BALL[2]], [7, 0.5, 0.5], 'night', { side: 'ink' });
    for (const dx of [-3.3, 3.3]) kit.box([BALL[0] + dx, 3.3, BALL[2]], [0.4, 6.6, 0.4], 'night');
    const wrecker = chain(ctx, BALL, { links: 10, linkLength: 0.4, radius: 0.07, color: 'slate', end: { ball: 0.7, density: 6, color: 'ink' } });
    const ball = wrecker.end!;
    let crates: { mesh: import('three/webgpu').Mesh; body: RAPIER.RigidBody }[] = [];
    const stack = () => {
      for (const c of crates) {
        physics.remove(c.body);
        c.mesh.removeFromParent();
      }
      crates = [];
      for (let y = 0; y < 3; y++) for (let i = 0; i < 3; i++) crates.push(kit.crate([BALL[0] - 0.85 + i * 0.85, 0.4 + y * 0.8, -4.6], { size: 0.8, color: y % 2 ? 'orange' : 'red', side: 'sand' }));
    };
    stack();
    let swingSpeed = 9;
    const swing = () => {
      ball.setLinvel({ x: 0, y: 0, z: swingSpeed }, true);
      ctx.audio.play('whoosh');
    };
    kit.pad([-13, 0, -2.6], { label: 'SWING', color: 'red', note: 'The ball gets a push toward the crates: 11 bodies on ball joints swing as one.', apply: swing });
    kit.pad([-13, 0, 0], { label: 'STACK', color: 'sand', note: 'Nine crates again.', apply: stack });
    kit.label([BALL[0], 7.5, BALL[2]], 'WRECKING BALL · PUNCH IT', { color: 'sand', range: 12 });

    // ---------------------------------------------------------------- the seesaw
    const saw: Built & { plank: RAPIER.RigidBody } = seesaw(ctx, SEESAW, { length: 6, width: 1.6, tilt: 18 });
    let dropped: { mesh: import('three/webgpu').Mesh; body: RAPIER.RigidBody }[] = [];
    const dropCrate = (dx: number, density: number, color: 'red' | 'sky') => {
      const c = kit.crate([SEESAW[0] + dx, 4, SEESAW[2]], { size: 0.8, color, side: 'white', density });
      dropped.push(c);
      if (dropped.length > 6) {
        const old = dropped.shift()!;
        physics.remove(old.body);
        old.mesh.removeFromParent();
      }
    };
    kit.pad([-13.5, 0, 8.5], { label: 'HEAVY', color: 'red', note: 'A crate of density 8 (8 times the mass of the light one) onto the left end.', apply: () => dropCrate(-2.4, 8, 'red') });
    kit.pad([-4.8, 0, 8.5], { label: 'LIGHT', color: 'sky', note: 'A crate of density 1 onto the right end.', apply: () => dropCrate(2.4, 1, 'sky') });
    kit.pad([-9, 0, 9.6], {
      label: 'CLEAR',
      color: 'slate',
      note: 'The seesaw crates removed.',
      apply: () => {
        for (const c of dropped) {
          physics.remove(c.body);
          c.mesh.removeFromParent();
        }
        dropped = [];
      },
    });
    kit.label([SEESAW[0], 2.6, SEESAW[2]], 'SEESAW · A HINGE', { color: 'orange', range: 10 });

    // ---------------------------------------------------------------- spring pads
    const springs = SPRINGS.map((s) => {
      const built = springPad(ctx, [s.x, -0.15, -7], { size: [1.9, 0.3, 1.9], stiffness: s.k, travel: 0.7, color: 'lime' });
      kit.label([s.x, 1.2, -7], s.name, { color: 'lime', range: 9 });
      return { ...s, ...built };
    });
    kit.label([9, 2.2, -9.5], 'SPRING PADS · SLIDERS', { color: 'lime', range: 12 });

    // ---------------------------------------------------------------- saloon doors
    const wallH = 1.3; // low: the camera looks over it
    kit.box([(TRENCH + 0.5 + DOORWAY - 1.25) / 2, wallH / 2, 3], [DOORWAY - 1.25 - TRENCH - 0.5, wallH, 0.3], 'plum', { side: 'night' });
    kit.box([(DOORWAY + 1.25 + W / 2 - 1) / 2, wallH / 2, 3], [W / 2 - 1 - DOORWAY - 1.25, wallH, 0.3], 'plum', { side: 'night' });
    const doors = [hingeDoor(ctx, [DOORWAY - 1.2, 0.35, 3], { width: 1.15, height: 1.15, thickness: 0.08, color: 'orange' }), hingeDoor(ctx, [DOORWAY + 1.2, 0.35, 3], { width: 1.15, height: 1.15, thickness: 0.08, yaw: Math.PI, color: 'orange' })];
    let springy = true;
    let locked = false;
    const doorInertia = (d: (typeof doors)[number]) => (d.door.mass() * 1.15 * 1.15) / 3;
    const setDoors = () => {
      for (const d of doors) {
        d.hinge.setLimits(locked ? -0.001 : -1.92, locked ? 0.001 : 1.92);
        d.hinge.configureMotorPosition(0, springy ? 4 * doorInertia(d) : 0, springy ? 1.2 * doorInertia(d) : 0.05 * doorInertia(d));
        d.door.wakeUp();
      }
    };
    kit.pad([DOORWAY - 3.5, 0, 0.8], {
      label: 'DOOR SPRING',
      color: 'orange',
      note: 'The hinges\' motors swing the doors shut (a spring per unit of inertia). Off: they stay where you leave them.',
      apply: (_r, p) => {
        springy = !springy;
        setDoors();
        kit.lightPad(p, springy);
      },
      initial: true,
    });
    kit.pad([DOORWAY + 3.5, 0, 0.8], {
      label: 'LOCK',
      color: 'red',
      note: 'Hinge limits of zero: the doors are walls now.',
      apply: (_r, p) => {
        locked = !locked;
        setDoors();
        kit.lightPad(p, locked);
      },
    });
    kit.label([DOORWAY, 2.2, 3], 'SALOON', { color: 'orange', range: 10 });

    // ---------------------------------------------------------------- bead curtains
    kit.box([9.5, 3.1, 8], [7.5, 0.25, 0.25], 'night');
    const beads = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5].map((x, i) => chain(ctx, [x, 3, 8], { links: 6, linkLength: 0.35, radius: 0.05, color: i % 2 ? 'cyan' : 'sky', end: { ball: 0.14, density: 3, color: 'sand' } }));
    kit.label([9.5, 3.8, 8], 'BEAD CURTAIN · WALK THROUGH', { color: 'cyan', range: 9 });

    kit.light({ position: [-9, 4, -4], color: PALETTE.orange, intensity: 6, radius: 10, flicker: 'torch' });
    kit.light({ position: [9, 4, 0], color: PALETTE.sand, intensity: 6, radius: 12, flicker: 'none' });
    kit.light({ position: [0, 3, 0], color: PALETTE.sky, intensity: 4, radius: 8, flicker: 'none' });

    const strikes = new Strikes();
    const knobs: Knob[] = [
      { id: 'swing', label: 'Swing speed', min: 2, max: 16, step: 0.5, get: () => swingSpeed, set: (v) => (swingSpeed = v), format: (v) => `${v} m/s`, initial: 9 },
      { id: 'weight', label: 'Hero weight', min: 0, max: 6, step: 0.25, get: () => room.hero?.hero?.weight ?? 1, set: (v) => room.hero?.hero && (room.hero.hero.weight = v), initial: 1, hint: 'How hard the hero presses dynamic floors: the bridge, the spring pads.' },
      { id: 'shove', label: 'Hero shove', min: 0, max: 4, step: 0.25, get: () => room.hero?.hero?.shove ?? 0, set: (v) => room.hero?.hero && (room.hero.hero.shove = v), initial: 1.5, hint: 'The most mass the hero shoves at walking speed (0: dynamic bodies are walls).' },
    ];
    const tmp = new Vector3();
    let falls = 0;
    return {
      knobs,
      fixedUpdate() {
        const h = room.hero?.hero;
        if (!h) return;
        const s = strikes.poll(h);
        if (s) {
          const p = ball.translation();
          if (tmp.set(p.x, p.y, p.z).distanceTo(s.at) < 1.3) {
            ball.applyImpulse({ x: s.dir.x * 6 * s.strength * ball.mass() * 0.25, y: 0.5, z: s.dir.z * 6 * s.strength * ball.mass() * 0.25 }, true);
            ctx.engine.hitstop(0.06);
            ctx.engine.shake.add(0.3);
            ctx.particles.burst('impact', s.at, { direction: [s.dir.x, 0.2, s.dir.z] });
            ctx.audio.play('punch');
          }
        }
        if (h.feetInto(tmp).y < -3) {
          falls++;
          room.respawn();
          room.toast('Down the trench! The bridge is the way across (NEW BRIDGE if you cut it).');
          ctx.audio.play('hurt');
        }
      },
      status: () => `bridge ${cut ? 'cut' : 'whole'} crates ${crates.length} doors ${locked ? 'locked' : springy ? 'spring' : 'loose'}`,
      api: {
        cut: () => {
          bridge.cut('to');
          cut = true;
        },
        rebuild,
        swing,
        stack,
        bridge: () => bridge.planks.map((p) => p.translation().y),
        ball: () => ball.translation(),
        /** Crates still in the wall's spot (not knocked over or away). */
        standing: () => crates.filter((c) => Math.abs(c.body.translation().z + 4.6) < 0.5 && Math.abs(c.body.translation().x - BALL[0]) < 1.6).length,
        springs: () => springs.map((s) => s.pad.translation().y),
        doors: () => doors.map((d) => 2 * Math.atan2(d.door.rotation().y, d.door.rotation().w)),
        seesaw: () => 2 * Math.atan2(saw.plank.rotation().z, saw.plank.rotation().w),
        beads: () => beads.length,
        falls: () => falls,
      },
    };
  },
};
