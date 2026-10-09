/**
 * Time Lab: knock things down, then hold R and watch it all un-happen. A line of dominoes, a
 * crate pyramid and a ball on a ramp, recorded every physics step for six seconds; rewinding
 * plays the record backwards (the hero too) and letting go carries on from there.
 */
import { Mesh, SphereGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor, RAPIER, Rewind, setLookLayer, toonMaterial } from '../../engine';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];

export const REWIND: RoomDef = {
  id: 'rewind',
  title: 'Time Lab',
  wing: 'workshop',
  about:
    'Knock things down, then hold R: everything plays backwards, for up to six seconds, and the hero glides back along the way it came. Let go and time runs forward again from there, the bodies carrying on with the speeds they had. A line of dominoes, a crate pyramid and a ball on a ramp to try it on.',
  try: ['Step on DOMINOES, then hold R', 'Wreck the pyramid, rewind, wreck it differently', 'Rewind halfway and walk somewhere else'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A domino line, a crate pyramid and a ramp with a ball, a history meter on the HUD, and pads that start each one.',
    how: [
      'Every physics step the lab records, for every body, where it is, how it is turned, how it moves and whether it sleeps (position, rotation, linear and angular velocity, asleep: 14 numbers), into a ring buffer six seconds long. The hero\'s position and facing ride along, so the hero glides back along the way it came (standing: its animation is not recorded).',
      'Holding R, each step takes the newest record off the end and puts every body back exactly there instead of moving it forward, so the world plays backwards at the same speed it went forward. That runs before anything else reads the bodies after the step, so whatever draws them draws the rewound pose.',
      'Letting go keeps that moment\'s velocities, so the world simply carries on from there: a domino caught mid-fall keeps falling. The record keeps going too, so you can rewind again.',
      'Physics engines are deterministic only with the same steps in the same order, so this records states rather than replaying inputs: it works whatever you did in between.',
    ],
    uses: [
      'Braid, Prince of Persia: The Sands of Time, Forza and Grid\'s rewinds, Life is Strange.',
      'Kill cams and instant replays; undo in physics puzzles; debugging a simulation backwards.',
    ],
    ask: ['a time rewind button', 'record and replay a physics scene', 'undo the last few seconds', 'a kill cam'],
    cost: '14 numbers per body per step: 6 s of 40 bodies is about 800 KB, written once a step. Rewinding costs the same as recording.',
    code: [
      {
        title: 'One step back: the newest record off the end, every body put there',
        file: 'src/engine/physics/rewind.ts',
        src: `this.head = (this.head - 1 + this.capacity) % this.capacity;
b.setTranslation({ x: f[k]!, y: f[k + 1]!, z: f[k + 2]! }, true);
b.setLinvel({ x: f[k + 7]!, y: f[k + 8]!, z: f[k + 9]! }, true);`,
      },
    ],
    words: ['ring buffer', 'rigid body', 'determinism'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(26, 22, { floor: ['slate', 'night'], wall: { color: 'sky', side: 'navy' } });
    const world = ctx.physics.world;
    const box = (at: V3, half: V3, color: PaletteColor, density = 1) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...at));
      world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setDensity(density).setFriction(0.6), body);
      const mesh = kit.box(at, [half[0] * 2, half[1] * 2, half[2] * 2], color, { ghost: true, own: true });
      setLookLayer(mesh, 'actors');
      ctx.physics.bind(body, mesh);
      return body;
    };
    // dominoes in an arc
    const dominoes: RAPIER.RigidBody[] = [];
    for (let i = 0; i < 22; i++) {
      const a = -0.9 + (i / 21) * 1.8;
      const at: V3 = [-4 + Math.sin(a) * 5, 0.5, 1 - Math.cos(a) * 5];
      const d = box(at, [0.05, 0.5, 0.25], i % 2 ? 'sand' : 'orange');
      // the thin side along the arc (its tangent is (cos a, sin a)), so each one falls onto the next
      d.setRotation({ x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) }, true);
      dominoes.push(d);
    }
    // a crate pyramid
    const crates: RAPIER.RigidBody[] = [];
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) crates.push(box([5 + (i - (3 - row) / 2) * 0.82, 0.4 + row * 0.8, -3], [0.4, 0.4, 0.4], 'plum'));
    // a ramp and a ball
    kit.box([6, 1, 3.5], [5, 0.3, 2], 'sky', { side: 'blue', rotZ: 14 });
    const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(8.2, 2.13, 3.5).setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.ball(0.4).setDensity(3).setRestitution(0.2), ball);
    const ballMesh = new Mesh(new SphereGeometry(0.4, 14, 10), toonMaterial(PALETTE.red));
    ballMesh.castShadow = true;
    setLookLayer(ballMesh, 'actors');
    ctx.scene.add(ballMesh);
    ctx.physics.bind(ball, ballMesh);
    let parked = 2; // the ball sleeps on the ramp until ROLL (a new body is woken by its first step, so after that)

    const rewind = new Rewind(ctx.physics, { seconds: 6 });
    rewind.trackAll();
    const hero = new Vector3();
    rewind.extra(
      () => {
        const h = room.hero?.hero;
        if (!h) return [];
        h.feetInto(hero);
        return [hero.x, hero.y, hero.z, h.facing];
      },
      (v) => room.hero?.teleport([v[0]!, v[1]!, v[2]!], v[3]),
    );
    let scripted = 0; // steps of rewind asked for by a pad or a test
    let rewound = 0;
    // R is the rewind here: the engine's resolution hotkey moves to F7 while in the lab
    const keys = e.debugKeys;
    e.debugKeys = { ...keys, resolution: ['F7'] };
    // pads do nothing while time runs backwards (the hero gliding back over one would set it off again)
    const live = (f: () => void) => () => {
      if (!rewind.rewinding) f();
    };
    const nudge = () => dominoes[0]!.applyImpulse({ x: 0.15, y: 0, z: 0.05 }, true);
    kit.pad([-4, 0, 3.5], { label: 'DOMINOES', color: 'orange', note: 'A nudge to the first domino.', apply: live(nudge) });
    kit.pad([5, 0, 0.2], { label: 'BLAST', color: 'red', note: 'A blast at the pyramid\'s foot.', apply: live(() => ctx.physics.explode([5, 0.2, -2.2], { radius: 3, impulse: 6 })) });
    kit.pad([9.5, 0, 6], { label: 'ROLL', color: 'sky', note: 'The ball rolls down the ramp.', apply: live(() => ball.wakeUp()) });
    kit.pad([0, 0, 8.5], { label: 'REWIND 3 S', color: 'plum', note: 'Three seconds back, hands-free (or hold R as long as you like).', apply: live(() => (scripted = 180)) });
    kit.light({ position: [0, 5, 0], color: PALETTE.white, intensity: 4, radius: 16, flicker: 'none' });
    const knobs: Knob[] = [];
    return {
      knobs,
      fixedUpdate() {
        if (parked > 0 && --parked === 0) {
          ball.sleep();
          rewind.reset(); // history starts with the ball asleep
        }
        const held = room.inputFree && e.input.isDown('KeyR');
        rewind.rewinding = (held || scripted > 0) && rewind.length > 0;
        if (scripted > 0) scripted--;
        if (rewind.rewinding) rewound++;
      },
      update() {
        if (rewind.rewinding) e.screen.flash(0x41a6f6, { duration: 0.08, strength: 0.18 });
      },
      draw() {
        const bars = Math.round(rewind.fill * 20);
        ctx.hud.text(4, 18, `${rewind.rewinding ? '<< REWIND' : 'HOLD R TO REWIND'}  ${'#'.repeat(bars)}${'.'.repeat(20 - bars)}`, { anchor: 'bottom-left', color: rewind.rewinding ? 'sky' : 'mist' });
      },
      dispose() {
        rewind.dispose();
        e.debugKeys = keys;
      },
      status: () => `history ${(rewind.fill * 100).toFixed(0)}% rewinding ${rewind.rewinding}`,
      api: {
        rewind: (steps: number) => (scripted = steps),
        rewinding: () => rewind.rewinding,
        fill: () => rewind.fill,
        rewound: () => rewound,
        standing: () => dominoes.filter((d) => d.translation().y > 0.45).length,
        nudge,
        roll: () => ball.wakeUp(),
        ball: () => {
          const t = ball.translation();
          return { at: [t.x, t.y, t.z], asleep: ball.isSleeping() };
        },
      },
    };
  },
};
