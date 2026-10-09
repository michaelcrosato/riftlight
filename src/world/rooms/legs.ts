/**
 * Procedural Legs: creatures whose feet are worked out, not keyed. A six-legged walker follows
 * the hero over steps and ramps, a crab scuttles sideways along a wall, a four-legged robot
 * patrols: each foot stays planted until it is too far from where it should be, then steps
 * there in an arc while its neighbours hold; knees come from two-bone IK.
 */
import { BoxGeometry, Group, Mesh, Vector3 } from 'three/webgpu';
import { gaitPartners, LegStepper, PALETTE, type PaletteColor, setLookLayer, toonMaterial, twoBoneIK } from '../../engine';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];

interface Walker {
  body: Group;
  pos: Vector3;
  vel: Vector3;
  yaw: number;
  height: number;
  stepper: LegStepper;
  hips: V3[];
  bones: { thigh: Mesh; shin: Mesh }[];
  upper: number;
  lower: number;
}

const UP = new Vector3(0, 1, 0);
/** The robot's square patrol, a corner every 4 s. */
const PATROL = [new Vector3(6, 0, -1), new Vector3(9, 0, -1), new Vector3(9, 0, 3), new Vector3(6, 0, 3)];
const along = new Vector3();

/** Draw a bone (a thin box) from a to b. */
function placeBone(m: Mesh, a: V3, b: V3): void {
  const d = along.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  m.scale.set(1, Math.max(0.01, len), 1);
  m.quaternion.setFromUnitVectors(UP, len > 1e-6 ? d.divideScalar(len) : UP);
}

export const LEGS: RoomDef = {
  id: 'legs',
  title: 'Procedural Legs',
  wing: 'animation',
  about:
    'Creatures whose walk is worked out every frame instead of keyed: a six-legged walker that follows you over steps and ramps, a crab and a four-legged robot. Each foot stays planted until it falls too far behind, then steps ahead in an arc while its neighbours hold; the knees come from two-bone IK.',
  try: ['Walk around: the walker follows you, feet planted', 'Lead it up the steps', 'Make the steps longer or quicker (T)', 'Watch a foot: it never slides'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'A yard with steps and a ramp, a six-legged walker that follows the hero, a crab on a patrol and a four-legged robot, with live settings for the step length, speed and height.',
    how: [
      'Each leg has a rest spot around the body. The foot\'s target is that spot, moved ahead by where the body is going (its velocity times a lead time), dropped onto the ground with a ray.',
      'A foot stays exactly where it is in the world (planted: it never slides) until it is too far from its target. Then it steps: from where it is to the target, along an arc, in a fraction of a second.',
      'Gait: a leg may only start a step while its neighbours (the legs beside and opposite it) are planted. Six legs then fall into the insect\'s alternating tripod on their own, four into a trot.',
      'Knees come from two-bone IK: given the hip, the foot and the two bone lengths, the law of cosines gives how far along the hip-to-foot line the knee is and how far out, bent toward a pole (up and outward).',
      'The body bobs with how many feet are down and leans into its motion: small touches that sell the weight.',
    ],
    uses: [
      'Procedural spiders and mechs: Rain World, Spore, the Titanfall titans\' foot placement.',
      'Creatures that walk on any terrain without animations per slope: Shadow of the Colossus\' colossi, Horizon\'s machines.',
      'Two-bone IK: feet on stairs, hands on ledges and weapons in almost every 3D game.',
    ],
    ask: ['a spider that walks on uneven ground', 'legs that plant and step procedurally', 'IK for knees and elbows', 'a robot that follows the player'],
    cost: 'A ray down per foot per frame and a little math: microseconds per creature. Bones are plain boxes moved each frame.',
    code: [
      {
        title: 'Step when the foot falls too far behind, if the neighbours are down',
        file: 'src/engine/animation/procedural.ts',
        src: `if (f.t >= 0 || behind[i]! < this.o.threshold) continue;
if (this.partners[i]!.some((p) => this.feet[p]!.t >= 0)) continue;`,
      },
      {
        title: 'Two-bone IK: the law of cosines',
        file: 'src/engine/animation/procedural.ts',
        src: `const along = (a * a - b * b + dist * dist) / (2 * dist);
const off = Math.sqrt(Math.max(0, a * a - along * along));`,
      },
    ],
    words: ['procedural animation', 'IK', 'gait', 'raycast'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(26, 22, { floor: ['mist', 'slate'], wall: { color: 'blue', side: 'navy' } });
    // terrain to walk over: four steps up to a deck 1.2 m high, a ramp back down
    for (let i = 0; i < 4; i++) kit.box([-7 + i * 1.2, 0.15 + i * 0.15, -5], [1.2, 0.3 + i * 0.3, 4], 'sky', { side: 'blue' });
    kit.box([-1.6, 0.6, -5], [3.6, 1.2, 4], 'sky', { side: 'blue' });
    const slope = (15 * Math.PI) / 180;
    const run = 1.2 / Math.tan(slope);
    kit.box([0.2 + run / 2 - Math.sin(slope) * 0.15, 0.6 - Math.cos(slope) * 0.15, -5], [1.2 / Math.sin(slope), 0.3, 4], 'sky', { side: 'blue', rotZ: -15 });
    const hit = { y: 0, nx: 0, ny: 0, nz: 0, id: 0 };
    const NOT_HERO = ['character'];
    const ground = (x: number, z: number) => (ctx.physics.castDown(x, 6, z, 12, hit, NOT_HERO) ? hit.y : 0);

    const make = (o: { legs: number; spread: number; length: number; height: number; color: PaletteColor; leg: PaletteColor; size: V3; at: V3; upper: number; lower: number; sideways?: boolean }): Walker => {
      const body = new Group();
      const shell = new Mesh(new BoxGeometry(...o.size), toonMaterial(PALETTE[o.color]));
      shell.castShadow = true;
      setLookLayer(shell, 'actors');
      body.add(shell);
      const eye = new Mesh(new BoxGeometry(0.12, 0.12, 0.05), kit.glow('sand', 1));
      eye.position.set(0, o.size[1] * 0.2, o.size[2] / 2 + 0.02);
      body.add(eye);
      ctx.scene.add(body);
      const n = o.legs;
      const partners = gaitPartners(n);
      const hips: V3[] = [];
      const legs = Array.from({ length: n }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        const rows = n / 2;
        const z = rows === 1 ? 0 : (0.5 - row / (rows - 1)) * o.length;
        hips.push([side * o.size[0] * 0.45, 0, z]);
        return { rest: [side * o.spread, z * 1.2] as [number, number], partners: partners[i] };
      });
      const legMat = toonMaterial(PALETTE[o.leg]);
      const bones = legs.map(() => {
        const thigh = new Mesh(new BoxGeometry(0.07, 1, 0.07), legMat);
        const shin = new Mesh(new BoxGeometry(0.05, 1, 0.05), legMat);
        for (const m of [thigh, shin]) {
          m.castShadow = true;
          setLookLayer(m, 'actors');
          ctx.scene.add(m);
        }
        return { thigh, shin };
      });
      const stepper = new LegStepper({ legs, threshold: 0.35, stepTime: 0.16, lift: 0.18, lead: 0.2 });
      stepper.reset([o.at[0], 0, o.at[2]], o.sideways ? Math.PI / 2 : 0, ground);
      return { body, pos: new Vector3(...o.at), vel: new Vector3(), yaw: o.sideways ? Math.PI / 2 : 0, height: o.height, stepper, hips, bones, upper: o.upper, lower: o.lower };
    };
    const walker = make({ legs: 6, spread: 1.1, length: 1.2, height: 0.7, color: 'plum', leg: 'sand', size: [0.9, 0.35, 1.3], at: [3, 0, 3], upper: 0.75, lower: 0.85 });
    const crab = make({ legs: 6, spread: 0.8, length: 0.6, height: 0.4, color: 'red', leg: 'orange', size: [0.8, 0.25, 0.5], at: [-6, 0, 3], upper: 0.5, lower: 0.55, sideways: true });
    const robot = make({ legs: 4, spread: 0.9, length: 1.1, height: 0.9, color: 'navy', leg: 'white', size: [0.8, 0.5, 1.2], at: [6, 0, -1], upper: 0.75, lower: 0.8 });
    const walkers = [walker, crab, robot];
    kit.label([-1.6, 3, -7], 'STEPS AND A RAMP', { color: 'sky', range: 10 });
    kit.light({ position: [0, 5, 0], color: PALETTE.white, intensity: 4, radius: 16, flicker: 'none' });

    let speedK = 1;
    const knobs: Knob[] = [
      { id: 'threshold', label: 'Step when this far behind', min: 0.1, max: 1, step: 0.05, get: () => walker.stepper.o.threshold, set: (v) => walkers.forEach((w) => (w.stepper.o.threshold = v)), format: (v) => `${v} m`, initial: 0.35 },
      { id: 'step-time', label: 'Step time', min: 0.06, max: 0.5, step: 0.02, get: () => walker.stepper.o.stepTime, set: (v) => walkers.forEach((w) => (w.stepper.o.stepTime = v)), format: (v) => `${v} s`, initial: 0.16 },
      { id: 'lift', label: 'Step height', min: 0, max: 0.6, step: 0.02, get: () => walker.stepper.o.lift, set: (v) => walkers.forEach((w) => (w.stepper.o.lift = v)), format: (v) => `${v} m`, initial: 0.18 },
      { id: 'speed', label: 'Walking speed', min: 0.3, max: 2.5, step: 0.1, get: () => speedK, set: (v) => (speedK = v), format: (v) => `${v}x`, initial: 1 },
    ];
    const tmp = new Vector3();
    const knee: V3 = [0, 0, 0];
    let t = 0;
    const steer = (w: Walker, goal: Vector3, speed: number, dt: number, sideways = false, stop = 0.3) => {
      tmp.subVectors(goal, w.pos).setY(0);
      const d = tmp.length();
      const want = d > stop ? speed * speedK : 0;
      const dir = d > 1e-3 ? tmp.divideScalar(d) : tmp.set(0, 0, 0);
      w.vel.x += (dir.x * want - w.vel.x) * Math.min(1, dt * 3);
      w.vel.z += (dir.z * want - w.vel.z) * Math.min(1, dt * 3);
      w.pos.addScaledVector(w.vel, dt);
      if (w.vel.lengthSq() > 0.01) {
        const target = Math.atan2(w.vel.x, w.vel.z) + (sideways ? Math.PI / 2 : 0);
        let dy = target - w.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        w.yaw += dy * Math.min(1, dt * 4);
      }
    };
    let slide = 0; // the farthest a planted foot has moved in one frame (m): it should stay 0
    const before: V3[] = Array.from({ length: 6 }, () => [NaN, NaN, NaN] as V3);
    const body: V3 = [0, 0, 0];
    const vel: V3 = [0, 0, 0];
    const hip: V3 = [0, 0, 0];
    const pole: V3 = [0, 0, 0];
    const pose = (w: Walker, dt: number) => {
      body[0] = w.pos.x;
      body[2] = w.pos.z;
      vel[0] = w.vel.x;
      vel[2] = w.vel.z;
      w.stepper.feet.forEach((f, i) => {
        for (let k = 0; k < 3; k++) before[i]![k] = f.t < 0 ? f.at[k]! : NaN;
      });
      w.stepper.update(dt, body, w.yaw, vel, ground);
      w.stepper.feet.forEach((f, i) => {
        const b = before[i]!;
        if (f.t < 0 && !Number.isNaN(b[0])) slide = Math.max(slide, Math.hypot(f.at[0] - b[0], f.at[1] - b[1], f.at[2] - b[2]));
      });
      // the body rides above the feet, a little lower while some are up, leaning into its motion
      const feetY = w.stepper.feet.reduce((s, f) => s + f.at[1], 0) / w.stepper.feet.length;
      const bob = (w.stepper.feet.length - w.stepper.planted()) * 0.015;
      w.pos.y += (feetY + w.height - bob - w.pos.y) * Math.min(1, dt * 10);
      w.body.position.copy(w.pos);
      w.body.rotation.set(-w.vel.z * 0.02 * Math.cos(w.yaw) - w.vel.x * 0.02 * Math.sin(w.yaw), w.yaw, 0, 'YXZ');
      const c = Math.cos(w.yaw);
      const s = Math.sin(w.yaw);
      w.stepper.feet.forEach((f, i) => {
        const [hx, hy, hz] = w.hips[i]!;
        hip[0] = w.pos.x + hx * c + hz * s;
        hip[1] = w.pos.y + hy;
        hip[2] = w.pos.z - hx * s + hz * c;
        // knees bend up and out, away from the body
        const out = Math.sign(hx) || 1;
        pole[0] = hip[0] + out * c * 2;
        pole[1] = hip[1] + 2;
        pole[2] = hip[2] - out * s * 2;
        twoBoneIK(hip, f.at as V3, w.upper, w.lower, pole, knee);
        placeBone(w.bones[i]!.thigh, hip, knee);
        placeBone(w.bones[i]!.shin, knee, f.at as V3);
      });
    };
    return {
      knobs,
      update(dt) {
        t += dt;
        const h = room.hero?.position;
        if (h) steer(walker, h, 2.6, dt, false, 2.6); // follows, but keeps out of your way
        // the crab: back and forth along the south wall; the robot: a square patrol
        steer(crab, tmp.set(-6 + Math.sin(t * 0.4) * 5, 0, 8.5), 1.6, dt, true);
        steer(robot, PATROL[Math.floor(t / 4) % 4]!, 1.4, dt);
        for (const w of walkers) pose(w, dt);
      },
      status: () => `walker steps ${walker.stepper.steps} planted ${walker.stepper.planted()}/6`,
      api: {
        steps: () => walkers.map((w) => w.stepper.steps),
        planted: () => walkers.map((w) => w.stepper.planted()),
        walker: () => walker.pos.toArray(),
        feet: () => walker.stepper.feet.map((f) => [...f.at]),
        /** The farthest a planted foot has moved in one frame (m): 0 means feet never slide. */
        slide: () => slide,
      },
    };
  },
};
