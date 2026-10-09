/**
 * Moveset: the playground's stations (stairs, crawl tunnel, ledges, vines, ice slope,
 * chimney, tower, crates, grab nook, ramp, spikes) as a room: the engine's Mario-64-style
 * character controller on Rapier, every move it has.
 */
import { AnimationMixer, ConeGeometry, Mesh, Vector3 } from 'three/webgpu';
import { PALETTE, setLookLayer, toonMaterial } from '../../engine';
import { LEVEL } from '../../game/playground';
import type { RoomDef, Vec3 } from '../types';

const STATIONS: { at: Vec3; text: string }[] = [
  { at: [-6, 2.2, 0], text: 'STAIRS · TEETER AT THE EDGE' },
  { at: [-8, 1.8, 7], text: 'CRAWL TUNNEL · Z' },
  { at: [6.5, 3.6, 0], text: 'LEDGE · JUMP, HANG, PULL UP' },
  { at: [8, 5.6, -9], text: 'VINES · CLIMB OVER' },
  { at: [12.5, 3.4, -9], text: 'ICE SLOPE · SLIDE' },
  { at: [-5.6, 5.8, -9], text: 'CHIMNEY · WALL KICKS' },
  { at: [-12, 8.2, -9], text: 'TOWER · CLIMB, DIVE OFF' },
  { at: [2.5, 1.8, 0], text: 'CRATE · PUSH' },
  { at: [11.5, 2.6, 6], text: 'NOOK · F GRAB + PULL' },
  { at: [8.5, 2.2, 10], text: 'RAMP · FEET ON SLOPES' },
  { at: [9, 1.2, 14], text: 'SPIKES · KNOCKBACK' },
];

export const MOVES: RoomDef = {
  id: 'moves',
  title: 'Moveset Playground',
  wing: 'movement',
  about:
    'A station for every move of the platformer controller: steps and teetering, crawling, ledge hangs, climbing, slope slides, wall kicks, dives, pushing and pulling crates, knockback. Twelve coins hide around it.',
  try: [
    'Run, skid, then jump during the skid for a side flip',
    'Jump three times in a row for the triple jump; C + Space while running is a long jump',
    'Wall-kick up the chimney: jump into a wall, then Space again',
    'Grab the crate in the nook with F and pull it out',
  ],
  spawn: [0, 0, 3],
  facing: Math.PI,
  background: 'navy',
  assets: ['assets/coin.glb', 'assets/tree.glb'],
  guide: {
    what: 'The movement playground as a room. Each station isolates a move: stairs and a plateau edge (step up, step down, teeter), a 0.75 m crawl tunnel, ledges to hang from, a climbable vine block, a 38 degree ice slope, a wall-kick chimney, a tower with a ladder, pushable crates, a nook with a crate to pull out, a 15 degree ramp and a spike pad.',
    how: [
      'The hero is a capsule moved by Rapier\'s kinematic character controller: every fixed step (1/60 s) the controller sweeps it along the wanted motion, slides it along walls and steps it over small risers. Walls take away the speed that runs into them.',
      'What the hero does is a state machine, one table entry per state (idle, run, skid, jump, hang, climb, crawl, push...) with its step function, animation, stance and foot mode. Moves are transitions: a jump pressed during a skid becomes a side flip.',
      'Probes find what is around: rays find ledges (a wall with a flat top within reach), climbable colliders are tagged "climbable", crates "pushable" or "grabbable", the slope "slippery".',
      'Every number (accelerations, jump heights, timings) lives in TUNING with the reasoning next to it: speed builds over about 0.65 s, turns widen with speed, uphill slows the run.',
      'Animation follows the state: clips cross-fade without flipping joints, walk and run blend by speed, and foot IK puts the feet on the real ground (watch the ramp and the stairs).',
    ],
    uses: [
      'Super Mario 64 and Odyssey: the triple jump, side flip, long jump, wall kick and ground pound are this moveset\'s ancestors.',
      'Tomb Raider and Uncharted: ledge detection by probes and climbing tagged surfaces.',
      'Every 3D platformer: a kinematic capsule controller rather than a physics-driven body, so movement is exact and tunable.',
    ],
    ask: ['a Mario 64 style moveset with triple jumps and wall kicks', 'ledge grabs and shimmying on any wall with a flat top', 'tag a wall climbable so the hero can climb it', 'feet that stay on stairs and slopes'],
    cost: 'One character: a capsule sweep plus a handful of ray casts per fixed step, well under 0.1 ms. Animation blends a few clips and solves two-bone IK per leg each frame.',
    code: [
      {
        title: 'A state is a table entry',
        file: 'src/engine/character/states.ts',
        src: `skid: { step: stepSkid, anim: () => ({ name: 'Skid', once: true }), stance: 'stand', feet: 'ik' },
...
jump: {
  step: stepAir,
  anim: (c) => ({ name: c.jumpKind, once: true, fade: c.jumpKind === 'JumpKick' ? 0.05 : 0.08 }),
  stance: 'stand',
  airborne: true,
  snapToGround: false,`,
      },
      {
        title: 'The sweep: walls take away speed',
        file: 'src/engine/character/PlatformerCharacter.ts',
        src: `this.kcc.computeColliderMovement(this.collider, desired,
  RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, predicate);
const m = this.kcc.computedMovement();
this.grounded = this.kcc.computedGrounded();
this.loseSpeedToWalls();`,
      },
    ],
    words: ['character controller', 'fixed timestep', 'interpolation', 'raycast', 'collider', 'trigger', 'cross-fade', 'blend space', 'foot IK', 'coyote time', 'jump buffer'],
  },
  async build(room) {
    const { kit, ctx } = room;
    for (const b of LEVEL.blocks) kit.box(b.at, b.size, b.color, { side: b.side, tags: b.tags, rotZ: b.tiltZ });
    for (const c of LEVEL.crates) {
      const { body } = kit.crate(c.at, { tags: c.tags, lockRotation: true, damping: 4, density: 8 });
      body.collider(0).setFriction(0.1);
    }
    // spike pad
    const red = toonMaterial(PALETTE.red);
    const cone = new ConeGeometry(0.09, 0.22, 5);
    for (const h of LEVEL.hazards) {
      kit.box([h.at[0], 0.03, h.at[1]], [h.half * 2, 0.06, h.half * 2], 'plum', { ghost: true });
      for (let i = 0; i < 9; i++) {
        const s = new Mesh(cone, red);
        s.position.set(h.at[0] + ((i % 3) - 1) * h.half * 0.6, 0.15, h.at[1] + (Math.floor(i / 3) - 1) * h.half * 0.6);
        s.castShadow = true;
        kit.decorate(s);
      }
    }
    for (const s of STATIONS) kit.label(s.at, s.text, { color: 'sand', range: 7 });
    const [coinModel, treeModel] = await Promise.all([ctx.loadModel('assets/coin.glb', { castShadow: false }), ctx.loadModel('assets/tree.glb')]);
    for (const [i, [x, y, z]] of LEVEL.trees.entries()) {
      const t = treeModel.scene.clone(true);
      t.position.set(x, y, z);
      t.rotation.y = i * 1.3;
      kit.decorate(t);
      ctx.physics.addStaticCylinder([x, y + 1, z], 1, 0.3);
    }
    const coins: { mixer: AnimationMixer; root: typeof coinModel.scene; got: boolean }[] = [];
    let got = 0;
    for (const [x, y, z] of LEVEL.coins) {
      const root = coinModel.scene.clone(true);
      root.position.set(x, y, z);
      setLookLayer(root, 'actors');
      ctx.scene.add(root);
      const mixer = new AnimationMixer(root);
      const clip = coinModel.animations[0];
      if (clip) mixer.clipAction(clip).play();
      mixer.setTime(x * 0.37 + z * 0.21);
      const c = { mixer, root, got: false };
      coins.push(c);
      ctx.physics.trigger({ cylinder: { halfHeight: 0.6, radius: 0.45 } }, [x, y + 0.5, z], {
        tag: 'character',
        once: true,
        onEnter: () => {
          c.got = true;
          root.visible = false;
          got++;
          ctx.audio.play('coin');
          ctx.particles.burst('sparkle', [x, y + 0.6, z]);
          if (got === coins.length) {
            room.hero?.hero?.celebrate();
            ctx.audio.play('fanfare');
            room.toast('All twelve coins!');
          }
        },
      });
    }
    const feet = new Vector3();
    return {
      fixedUpdate() {
        const h = room.hero?.hero;
        if (!h) return;
        h.feetInto(feet);
        for (const hz of LEVEL.hazards) {
          const dx = feet.x - hz.at[0];
          const dz = feet.z - hz.at[1];
          if (Math.abs(dx) < hz.half + 0.25 && Math.abs(dz) < hz.half + 0.25 && feet.y < 0.4 && h.hurt(new Vector3(-dx, 0, -dz))) ctx.audio.play('hurt');
        }
      },
      update(dt) {
        for (const c of coins) if (!c.got) c.mixer.update(dt);
      },
      draw() {
        ctx.hud.text(4, 18, `COINS ${got}/${coins.length}`, { color: 'sand', anchor: 'bottom-left' });
      },
      status: () => `coins ${got}/${coins.length}`,
      api: { coins: () => ({ got, total: coins.length }) },
    };
  },
};
