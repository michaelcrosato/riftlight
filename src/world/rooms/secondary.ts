/**
 * Secondary Motion: things that move because something else moved. The hero gets a scarf, a
 * tail and an antenna (spring chains on its bones), slimes hop around squashing and
 * stretching, and pads switch each piece off to show what it adds.
 */
import { BoxGeometry, InstancedMesh, Matrix4, Mesh, type Object3D, Quaternion, SphereGeometry, Vector3 } from 'three/webgpu';
import { PALETTE, type PaletteColor, setLookLayer, SpringChain, Squash, toonMaterial } from '../../engine';
import { WORLD_CAMERA } from '../shell';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];

/** Boxes between a chain's points (one instanced draw), `width` × `thick` across. */
function chainMesh(segments: number, color: PaletteColor, width: number, thick: number) {
  const mesh = new InstancedMesh(new BoxGeometry(width, 1, thick), toonMaterial(PALETTE[color]), segments);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  setLookLayer(mesh, 'actors');
  const m = new Matrix4();
  const q = new Quaternion();
  const a = new Vector3();
  const b = new Vector3();
  const d = new Vector3();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);
  return {
    mesh,
    sync(points: readonly V3[]) {
      for (let i = 0; i + 1 < points.length; i++) {
        a.set(...points[i]!);
        b.set(...points[i + 1]!);
        d.subVectors(b, a);
        const len = d.length();
        q.setFromUnitVectors(up, len > 1e-6 ? d.divideScalar(len) : up);
        m.compose(a.add(b).multiplyScalar(0.5), q, s.set(1, len + 0.02, 1));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export const SECONDARY: RoomDef = {
  id: 'secondary',
  title: 'Secondary Motion',
  wing: 'animation',
  about:
    'The motion that follows motion: a scarf that streams behind you, a tail that swings, an antenna that wobbles when you stop, and slimes that squash when they land and stretch when they jump. None of it is keyed: springs work it out every frame. Switch each off to see what it adds.',
  try: ['Run, stop, turn: watch the scarf and the antenna', 'Jump and land', 'Switch them OFF one by one', 'Make them floppy or stiff (T)'],
  spawn: [0, 0, 4],
  facing: Math.PI,
  background: 'navy',
  camera: { ...WORLD_CAMERA, viewHeight: 9 }, // close: the scarf and the antenna are small
  guide: {
    what: 'The hero with a scarf, a tail and an antenna on their bones, five slimes hopping about, and pads to switch each effect and to change how springy they are.',
    how: [
      'A spring chain is a row of points hanging off a bone. Every frame each point keeps most of its velocity (it has momentum), sags a little under gravity, and is pulled toward where it would be if the chain stuck straight out (its rest direction in the bone\'s own axes): the stiffness.',
      'Then each segment is put back to its length, from the root out, so the chain swings and trails but never stretches. A box drawn between each pair of points makes the scarf, the tail and the antenna.',
      'Because the rest direction turns with the bone, the chain lags when the hero turns and swings past when they stop: follow-through and overlapping action, two of animation\'s twelve principles, for free.',
      'Squash and stretch is a damped spring on one number: a landing kicks it negative (squash), a jump positive (stretch). It is drawn as a scale that keeps the volume: taller is thinner.',
    ],
    uses: [
      'Hair, capes, scarves and tails: Journey, Spyro, Ratchet & Clank, every character with a ponytail.',
      'Antennae and ears that wobble: Pikmin, Crash Bandicoot.',
      'Squash and stretch on jumps and hits: Celeste, Kirby, Super Meat Boy.',
    ],
    ask: ['a scarf that trails behind the player', 'a tail that swings when the character turns', 'jelly enemies that squash when they land', 'antennae that wobble'],
    cost: 'A few points per chain and one number per squash: microseconds a frame. Each chain is one instanced draw.',
    code: [
      {
        title: 'A spring chain point: momentum, gravity, pull toward rest',
        file: 'src/engine/animation/procedural.ts',
        src: `const v = (p[c]! - q[c]!) * keep;
p[1] = p[1]! - sag;
for (let c = 0; c < 3; c++) p[c] = p[c]! + (parent[c]! + d[c]! * o.length - p[c]!) * pull;`,
      },
      {
        title: 'Squash that keeps the volume',
        file: 'src/engine/animation/procedural.ts',
        src: `out[1] = 1 + s;
out[0] = 1 / Math.sqrt(1 + s);`,
      },
    ],
    words: ['secondary motion', 'squash and stretch', 'rig', 'instancing'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(24, 20, { floor: ['slate', 'night'], wall: { color: 'plum', side: 'night' } });
    // a little course: a step, a ramp, posts to run round
    kit.box([-6, 0.3, -4], [4, 0.6, 3], 'sky', { side: 'blue' });
    kit.box([-3.2, 0.3, -4], [1.6, 0.6, 3], 'sky', { side: 'blue', rotZ: 20, ghost: true });
    for (const [x, z] of [[3, -3], [6, -5], [5, 0]] as const) kit.cylinder([x, 0.75, z], 0.3, 1.5, 'plum');

    const on = { scarf: true, tail: true, antenna: true, squash: true };
    let stiffness = 1;
    const scarf = new SpringChain({ segments: 7, length: 0.13, rest: [0, -0.25, -1], stiffness: 6, keep: 0.93, gravity: 9 });
    const tail = new SpringChain({ segments: 6, length: 0.12, rest: [0, -0.3, -1], stiffness: 10, keep: 0.9, gravity: 5 });
    const antenna = new SpringChain({ segments: 4, length: 0.1, rest: [0, 1, 0], stiffness: 24, keep: 0.95, gravity: 2 });
    const base = { scarf: scarf.o.stiffness, tail: tail.o.stiffness, antenna: antenna.o.stiffness };
    const meshes = {
      scarf: chainMesh(7, 'red', 0.16, 0.04),
      tail: chainMesh(6, 'orange', 0.08, 0.08),
      antenna: chainMesh(4, 'night', 0.03, 0.03),
    };
    const bulb = new Mesh(new SphereGeometry(0.06, 8, 6), kit.glow('sand', 1));
    for (const m of Object.values(meshes)) ctx.scene.add(m.mesh);
    ctx.scene.add(bulb);

    // slimes: hop around a circle, squash on landing, stretch on take-off
    const slimes = (['lime', 'cyan', 'plum', 'red', 'sand'] as const).map((color, i) => {
      // a squat dome with two eyes; scaling the mesh squashes the eyes with it
      const mesh = new Mesh(new SphereGeometry(0.42, 14, 10).scale(1, 0.8, 1).translate(0, 0.34, 0), toonMaterial(PALETTE[color]));
      for (const side of [-1, 1]) {
        const eye = new Mesh(new BoxGeometry(0.08, 0.12, 0.04), toonMaterial(PALETTE.ink));
        eye.position.set(side * 0.13, 0.42, 0.38);
        mesh.add(eye);
      }
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      ctx.scene.add(mesh);
      return { mesh, squash: new Squash(), t: i * 0.37, x: 4 + (i % 3) * 2.2, z: i < 3 ? 2.5 : 5, air: false };
    });
    kit.label([6.2, 2, 3.7], 'SLIMES · SQUASH AND STRETCH', { color: 'lime', range: 10 });

    const toggle = (key: keyof typeof on, label: string, note: string, x: number) =>
      kit.pad([x, 0, 7.6], {
        label,
        color: 'sky',
        initial: true,
        note,
        apply: (_r, p) => {
          on[key] = !on[key];
          kit.lightPad(p, on[key]);
        },
      });
    toggle('scarf', 'SCARF', 'A spring chain on the torso: it trails when you run and swings past when you stop.', -6);
    toggle('tail', 'TAIL', 'A stiffer chain on the hips.', -3.8);
    toggle('antenna', 'ANTENNA', 'A short, stiff chain pointing up: it wobbles when you stop or land.', -1.6);
    toggle('squash', 'SQUASH', 'The slimes\' squash and stretch (off: rigid balls that hop).', 0.6);

    const knobs: Knob[] = [
      {
        id: 'stiffness',
        label: 'Springiness',
        min: 0.2,
        max: 3,
        step: 0.1,
        get: () => stiffness,
        set: (v) => {
          stiffness = v;
          scarf.o.stiffness = base.scarf * v;
          tail.o.stiffness = base.tail * v;
          antenna.o.stiffness = base.antenna * v;
        },
        format: (v) => `${v.toFixed(1)}x stiff`,
        initial: 1,
        hint: 'Low: floppy, lazy follow-through. High: stiff, quick to settle.',
      },
      { id: 'squash', label: 'Squash amount', min: 0, max: 2.5, step: 0.1, get: () => slimes[0]!.squash.amount, set: (v) => slimes.forEach((s) => (s.squash.amount = v)), initial: 1 },
    ];

    // bones (found once the hero exists)
    let bones: { torso: Object3D; pelvis: Object3D; head: Object3D } | null = null;
    const p = new Vector3();
    const q = new Quaternion();
    const v = new Vector3();
    // a bone's axes and a point on it in the world, into arrays reused every frame (one set per chain)
    const bases = { scarf: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], tail: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], antenna: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] } as Record<'scarf' | 'tail' | 'antenna', [V3, V3, V3]>;
    const roots = { scarf: [0, 0, 0], tail: [0, 0, 0], antenna: [0, 0, 0] } as Record<'scarf' | 'tail' | 'antenna', V3>;
    const basisOf = (o: Object3D, out: [V3, V3, V3]): [V3, V3, V3] => {
      o.getWorldQuaternion(q);
      v.set(1, 0, 0).applyQuaternion(q).toArray(out[0]);
      v.set(0, 1, 0).applyQuaternion(q).toArray(out[1]);
      v.set(0, 0, 1).applyQuaternion(q).toArray(out[2]);
      return out;
    };
    const at = (o: Object3D, dx: number, dy: number, dz: number, out: V3): V3 => {
      o.getWorldQuaternion(q);
      o.getWorldPosition(p).add(v.set(dx, dy, dz).applyQuaternion(q)).toArray(out);
      return out;
    };
    const sq: [number, number] = [1, 1];
    let landings = 0;
    return {
      knobs,
      update(dt) {
        const model = room.hero?.model;
        if (!bones && model) {
          const torso = model.getObjectByName('Torso');
          const pelvis = model.getObjectByName('Pelvis');
          const head = model.getObjectByName('Head');
          if (torso && pelvis && head) bones = { torso, pelvis, head };
        }
        if (bones) {
          scarf.update(dt, at(bones.torso, 0, 0.42, -0.1, roots.scarf), basisOf(bones.torso, bases.scarf));
          tail.update(dt, at(bones.pelvis, 0, 0, -0.16, roots.tail), basisOf(bones.pelvis, bases.tail));
          antenna.update(dt, at(bones.head, 0.05, 0.3, 0, roots.antenna), basisOf(bones.head, bases.antenna));
          meshes.scarf.mesh.visible = on.scarf;
          meshes.tail.mesh.visible = on.tail;
          meshes.antenna.mesh.visible = bulb.visible = on.antenna;
          meshes.scarf.sync(scarf.points);
          meshes.tail.sync(tail.points);
          meshes.antenna.sync(antenna.points);
          bulb.position.set(...antenna.points[antenna.points.length - 1]!);
        }
        // slimes: a hop every 1.1 s along a little circle
        for (const s of slimes) {
          s.t += dt;
          const period = 1.1;
          const u = (s.t % period) / period;
          const hop = u < 0.6 ? Math.sin((u / 0.6) * Math.PI) : 0;
          const air = u < 0.6;
          if (air && !s.air) s.squash.kick(on.squash ? 3.2 : 0); // take-off: stretch
          if (!air && s.air) {
            s.squash.kick(on.squash ? -5.5 : 0); // landing: squash
            landings++;
          }
          s.air = air;
          s.squash.update(dt);
          const a = s.t * 0.4;
          s.mesh.position.set(s.x + Math.cos(a) * 0.8, hop * 1.1, s.z + Math.sin(a) * 0.8);
          s.mesh.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)); // facing along the circle
          s.squash.scale(sq);
          s.mesh.scale.set(sq[0], sq[1], sq[0]);
        }
      },
      status: () => `scarf swing ${scarf.swing(bases.scarf).toFixed(2)} landings ${landings}`,
      api: {
        on: () => ({ ...on }),
        tip: () => scarf.points[scarf.points.length - 1],
        swing: () => (bones ? scarf.swing(bases.scarf) : 0),
        landings: () => landings,
        squash: () => slimes.map((s) => s.squash.value),
      },
    };
  },
};
