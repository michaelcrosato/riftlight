/**
 * Ragdolls: training dummies (clones of the hero) that go limp when you hit them, tumble down
 * stairs, get knocked over by cannonballs, and then get back up: the ragdoll's pose blends
 * into a get-up clip that matches how it landed (on its back or its front).
 */
import { Mesh, SphereGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, Ragdoll, RAPIER, sampleClip, setLookLayer, toonMaterial } from '../../engine';
import { HERO_CLIPS, HERO_RAGDOLL, HERO_RIG } from '../../game/hero';
import { type Mannequin, mannequin } from '../kit/mannequin';
import { Strikes } from '../kit/strike';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];

/** Where a get-up clip's first frame puts the pelvis (x, z under the model root). */
function startOffset(name: string): V3 {
  const clip = HERO_CLIPS.find((c) => c.name === name)!;
  const p = sampleClip(clip, 0, HERO_RIG).Pelvis!.p;
  return [p[0], 0, p[2]];
}

interface Dummy {
  man: Mannequin;
  doll: Ragdoll;
  home: V3;
  facing: number;
  /** 'stand' → 'limp' (ragdoll) → 'getUp' (blending into the clip) → 'stand'. */
  state: 'stand' | 'limp' | 'getUp';
  /** Seconds in the state, and seconds the ragdoll has been still. */
  t: number;
  still: number;
  blend: { apply(w: number): void } | null;
  /** How long the get-up clip runs (s). */
  getUpTime: number;
  falls: number;
  ups: number;
  /** Where the pelvis lay when it last got up, and whether it had come to rest (not timed out). */
  lay: V3;
  rested: boolean;
}

export const RAGDOLLS: RoomDef = {
  id: 'ragdolls',
  title: 'Ragdolls',
  wing: 'animation',
  about:
    'Training dummies that go limp when you hit them: their joints become physics bodies that fall, tumble down the stairs and get knocked about by cannonballs. When they come to rest, the ragdoll pose blends into a get-up animation that matches how they landed, on their back or their front.',
  try: ['Punch or kick a dummy (J, K)', 'PUSH the dummy at the top of the stairs', 'Fire the CANNON', 'Make them floppier (T)'],
  spawn: [0, 0, 5],
  facing: Math.PI,
  background: 'plum',
  guide: {
    what: 'Three dummies in the yard, one at the top of a staircase, a cannon, and settings for how floppy they are and how soon they get up.',
    how: [
      'A ragdoll is the character\'s joints turned into physics bodies: a capsule for the pelvis, the torso, the head, each upper and lower arm and leg (eleven in all), made at the pose the animation had that frame and moving as it was.',
      'Each part hangs from its parent by a joint at the real joint: knees and elbows are hinges with limits, bending only the way they bend; hips, shoulders, the spine and the neck are ball joints whose swing is held inside a cone (after every physics step a part that swung too far is turned back onto the cone\'s edge, with the limbs below it, so the joints stay together).',
      'Parts never collide with ragdoll parts (a collision group of their own), only with the world, so a limb can fold across the body without the solver fighting it.',
      'Every frame the bodies are written back into the joints (between the last two physics steps, so it is smooth at any frame rate): the same model, now driven by physics instead of a clip.',
      'Getting up: when it has been still for a moment the bodies are removed, the model is moved under the pelvis and turned the way it lies, and the pose blends over a third of a second into GetUp (on its back) or GetUpFront (on its front), following each joint as the clip moves it.',
    ],
    uses: [
      'Hit reactions and deaths: Hitman, GTA, Half-Life 2, Fall Guys, every shooter since the 2000s.',
      'Physics-driven characters: Gang Beasts, Human: Fall Flat, Totally Accurate Battle Simulator.',
      'Ragdoll to animation blending (get-up): GTA\'s and Red Dead\'s Euphoria-style recoveries.',
    ],
    ask: ['enemies that go ragdoll when they die', 'a character that tumbles down stairs', 'get back up after being knocked down', 'knock dummies over with a cannon'],
    cost: 'Eleven bodies and ten joints per ragdoll while it is limp (none while it stands), a cone check per ball joint per step, writing eleven joints per frame.',
    code: [
      {
        title: 'A part hangs from its parent: a hinge with limits, or a ball joint',
        file: 'src/engine/physics/ragdoll.ts',
        src: `const data = part.hinge ? RAPIER.JointData.revolute(anchor, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) : RAPIER.JointData.spherical(anchor, { x: 0, y: 0, z: 0 });`,
      },
      {
        title: 'A swing past the cone is turned back onto its edge, limbs below and all',
        file: 'src/engine/physics/ragdoll.ts',
        src: `const turn = this.q2.setFromAxisAngle(k, excess);
for (const s of b.subtree) {
t.set(p.x - px, p.y - py, p.z - pz).applyQuaternion(turn);
this.q.set(r.x, r.y, r.z, r.w).premultiply(turn);`,
      },
      {
        title: 'The hero as a ragdoll: hinges for knees, cones for hips',
        file: 'src/game/hero/ragdoll.ts',
        src: `{ bone: 'LegR', parent: 'Pelvis', to: [0, -0.3, 0], radius: 0.09, cone: 80 },
{ bone: 'ShinR', parent: 'LegR', to: [0, -0.28, 0], radius: 0.08, hinge: [0, 150] },`,
      },
    ],
    words: ['ragdoll', 'joint', 'collision groups', 'animation blending', 'rigid body'],
  },
  async build(room) {
    const { kit, ctx } = room;
    kit.room(24, 20, { floor: ['sand', 'orange'], wall: { color: 'plum', side: 'ink' } });
    // a staircase on the left, climbing away from the camera to a landing 2.8 m up
    const STEP = 0.4;
    for (let i = 0; i < 6; i++) kit.box([-6.5, (STEP * (i + 1)) / 2, -0.2 - i * 0.7], [3, STEP * (i + 1), 0.7], i % 2 ? 'sky' : 'blue', { side: 'navy' });
    kit.box([-6.5, 1.4, -5.05], [3, 2.8, 2], 'blue', { side: 'navy' });
    kit.label([-6.5, 4.6, -5.2], 'THE STAIRS', { color: 'sky', range: 12 });
    // the cannon on the right
    const barrel = new Mesh(new SphereGeometry(0.5, 12, 8), toonMaterial(PALETTE.ink));
    barrel.position.set(9, 0.8, -1);
    barrel.castShadow = true;
    setLookLayer(barrel, 'actors');
    ctx.scene.add(barrel);
    kit.solid([9, 0.5, -1], [1.2, 1, 1.2]);

    const getUpClip = (name: string) => ({ clip: name, offset: startOffset(name), time: HERO_CLIPS.find((c) => c.name === name)!.frames / HERO_RIG.fps });
    const GET_UP = { back: getUpClip('GetUp'), front: getUpClip('GetUpFront') };
    const spots: { at: V3; facing: number }[] = [
      { at: [-2, 0, -1], facing: 0 },
      { at: [1, 0, -1], facing: 0 },
      { at: [4, 0, -1], facing: 0 },
      { at: [-6.5, 2.8, -4.6], facing: 0 }, // on the landing's edge
    ];
    let floppy = 1;
    let patience = 1.2;
    const dummies: Dummy[] = [];
    for (const s of spots) {
      const man = await mannequin(ctx, 'Idle', s.at, s.facing);
      man.root.traverse((o) => (o.castShadow = true));
      const doll = new Ragdoll(ctx.physics, man.root, HERO_RAGDOLL);
      dummies.push({ man, doll, home: s.at, facing: s.facing, state: 'stand', t: 0, still: 0, blend: null, getUpTime: 0, falls: 0, ups: 0, lay: [0, 0, 0], rested: false });
    }
    const limp = (d: Dummy, velocity: V3 = [0, 0, 0]) => {
      if (d.state === 'limp') return;
      d.doll.enable({ velocity });
      d.doll.bodies.forEach((b) => b.setAngularDamping(1.5 / floppy));
      d.state = 'limp';
      d.t = 0;
      d.still = 0;
      d.falls++;
    };
    const hit = { y: 0, nx: 0, ny: 0, nz: 0, id: 0 };
    const getUp = (d: Dummy) => {
      const lying = d.doll.rootPose();
      d.lay = [lying.at.x, lying.at.y, lying.at.z];
      d.rested = d.still > patience;
      const how = lying.faceUp ? GET_UP.back : GET_UP.front;
      const top = lying.at.y + 0.5;
      d.blend = d.doll.release({ ground: (x, z) => (ctx.physics.castDown(x, top, z, 4, hit) ? hit.y : 0), offset: how.offset });
      d.man.play(how.clip, { once: true });
      d.getUpTime = how.time;
      d.state = 'getUp';
      d.t = 0;
      d.ups++;
    };

    // balls from the cannon
    const balls: RAPIER.RigidBody[] = [];
    const ballMeshes: Mesh[] = [];
    let shots = 0;
    const fire = () => {
      const target = dummies[shots++ % 3]!.man.root.position; // the three in the yard in turn
      // out of the muzzle, clear of the cannon's own solid (x 8.4 to 9.6)
      const body = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(7.9, 1, -1).setCcdEnabled(true));
      ctx.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.25).setDensity(8).setRestitution(0.3), body);
      const dx = target.x - 7.9;
      const dz = target.z + 1;
      const l = Math.hypot(dx, dz) || 1;
      body.setLinvel({ x: (dx / l) * 14, y: 2.5, z: (dz / l) * 14 }, true);
      const mesh = new Mesh(new SphereGeometry(0.25, 10, 8), toonMaterial(PALETTE.ink));
      mesh.castShadow = true;
      ctx.scene.add(mesh);
      ctx.physics.bind(body, mesh);
      balls.push(body);
      ballMeshes.push(mesh);
      ctx.particles.burst('smoke', [7.9, 1, -1], { count: 12 });
      ctx.audio.play('groundPound', { pitch: 6 });
      if (balls.length > 6) {
        ctx.physics.remove(balls.shift()!);
        const m = ballMeshes.shift()!;
        ctx.scene.remove(m);
        m.geometry.dispose();
      }
    };
    kit.pad([8, 0, 3], { label: 'CANNON', color: 'red', note: 'A heavy ball at a dummy: the ragdoll takes the hit where the ball lands.', apply: fire });
    kit.pad([-6.5, 0, 2.6], {
      label: 'PUSH',
      color: 'sky',
      note: 'Shove the dummy at the top of the stairs: down it tumbles, limbs folding on every step.',
      apply: () => {
        const d = dummies[3]!;
        if (d.state !== 'stand') return;
        // back up to the landing first (it got up wherever it stopped)
        d.man.root.position.set(...d.home);
        d.man.root.rotation.set(0, d.facing, 0);
        d.man.root.updateMatrixWorld(true);
        limp(d, [0, 1.5, 3.5]);
        d.doll.push([d.home[0], d.home[1] + 1.3, d.home[2]], [0, 0, 4]); // a shove at the chest
      },
    });
    kit.pad([-2, 0, 3.4], { label: 'ALL LIMP', color: 'plum', note: 'Every dummy drops where it stands: no push at all, just gravity.', apply: () => dummies.forEach((d) => limp(d)) });
    kit.light({ position: [0, 5, 0], color: PALETTE.sand, intensity: 4, radius: 16, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'floppy', label: 'Floppiness', min: 0.3, max: 3, step: 0.1, get: () => floppy, set: (v) => (floppy = v), format: (v) => `${v.toFixed(1)}x`, initial: 1, hint: 'Joint friction: low is stiff and slow to fold, high flops like a sack.' },
      { id: 'patience', label: 'Gets up after', min: 0.3, max: 5, step: 0.1, get: () => patience, set: (v) => (patience = v), format: (v) => `${v.toFixed(1)} s still`, initial: 1.2 },
    ];
    const strikes = new Strikes();
    const tmp = new Vector3();
    return {
      knobs,
      fixedUpdate() {
        const h = room.hero?.hero;
        if (h) {
          const s = strikes.poll(h, 0.7);
          if (s)
            for (const d of dummies) {
              if (d.state === 'getUp') continue;
              const pelvis = d.man.root.getObjectByName('Pelvis')!.getWorldPosition(tmp);
              if (Math.hypot(pelvis.x - s.at.x, pelvis.z - s.at.z) > 0.9 || Math.abs(pelvis.y + 0.4 - s.at.y) > 1.2) continue;
              limp(d, [s.dir.x * 1.5 * s.strength, 0.8 * s.strength, s.dir.z * 1.5 * s.strength]);
              d.doll.push(s.at, [s.dir.x * 3 * s.strength, 1, s.dir.z * 3 * s.strength]);
              ctx.particles.burst('impact', s.at, { count: 10 });
              ctx.audio.play('punch');
              ctx.engine.shake.add(0.2);
            }
        }
        // cannonballs: a ball close to a standing dummy knocks it down
        for (const b of balls) {
          const t = b.translation();
          const v = b.linvel();
          if (Math.hypot(v.x, v.z) < 4) continue;
          for (const d of dummies) {
            if (d.state !== 'stand') continue;
            const p = d.man.root.position;
            if (Math.hypot(t.x - p.x, t.z - p.z) < 0.6 && t.y < p.y + 1.8) {
              limp(d, [v.x * 0.25, 1, v.z * 0.25]);
              d.doll.push([t.x, t.y, t.z], [v.x * 0.4, 0.5, v.z * 0.4]);
              ctx.audio.play('hurt');
            }
          }
        }
      },
      update(dt) {
        for (const d of dummies) {
          d.t += dt;
          if (d.state === 'stand' || d.state === 'getUp') d.man.mixer.update(dt);
          if (d.state === 'limp') {
            d.doll.sync();
            d.still = d.doll.speed() < 0.3 ? d.still + dt : 0;
            if (d.still > patience || d.t > 12) getUp(d); // a long tumble can take a while to settle
          } else if (d.state === 'getUp') {
            d.blend?.apply(d.t / 0.35);
            if (d.t > d.getUpTime) {
              d.man.play('Idle', { fade: 0.25 });
              d.state = 'stand';
              d.blend = null;
            }
          }
        }
      },
      dispose() {
        for (const d of dummies) d.doll.disable();
      },
      status: () => `limp ${dummies.filter((d) => d.state === 'limp').length} falls ${dummies.reduce((s, d) => s + d.falls, 0)}`,
      api: {
        states: () => dummies.map((d) => d.state),
        falls: () => dummies.map((d) => d.falls),
        pelvis: () => dummies.map((d) => d.man.root.getObjectByName('Pelvis')!.getWorldPosition(new Vector3()).toArray()),
        ups: () => dummies.map((d) => d.ups),
        /** Where each lay when it last got up, and whether it had come to rest first. */
        lay: () => dummies.map((d) => ({ at: d.lay, rested: d.rested })),
        limp: (i: number) => limp(dummies[i]!),
        fire,
      },
    };
  },
};
