/**
 * Cloth & Soft Bodies: Verlet particles held together by constraints. Flags in the wind (calm,
 * breeze, gale; let them go), a curtain the hero walks through, sheets that drape over a table
 * and a ball, ropes to brush past, and jelly blobs that keep their volume.
 */
import { Mesh, SphereGeometry } from 'three/webgpu';
import { clothGrid, PALETTE, type PaletteColor, RAPIER, RopeMesh, ropeLine, SoftMesh, softBlob, toonMaterial, type VerletBody } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const WINDS: { label: string; speed: number }[] = [
  { label: 'CALM', speed: 0 },
  { label: 'BREEZE', speed: 4 },
  { label: 'GALE', speed: 11 },
];

/** A body's starting shape, to put it back (RESET). */
function snapshot(b: VerletBody): () => void {
  const pos = b.pos.slice();
  const pins = b.invMass.slice();
  const at = b.pinAt.slice();
  return () => {
    b.pos.set(pos);
    b.prev.set(pos);
    b.invMass.set(pins);
    b.pinAt.set(at);
  };
}

export const SOFT: RoomDef = {
  id: 'soft',
  title: 'Cloth & Soft Bodies',
  wing: 'physics',
  about:
    'Things that bend: flags flapping in the wind, a curtain you walk through, sheets that drape over a table, ropes that swing as you brush past and jelly blobs that wobble back into shape. All particles and constraints (Verlet integration), drawn as ordinary toon meshes.',
  try: ['Step on GALE, then RELEASE: the flags blow away', 'Walk through the curtain', 'DROP SHEETS onto the table and the ball', 'Walk into the jelly blobs, then JIGGLE them'],
  spawn: [0, 0, 2],
  facing: Math.PI,
  background: 'teal',
  guide: {
    what: 'Three flags on poles with wind pads, a curtain in a frame, a table and a ball for sheets to fall on, six hanging ropes and three jelly blobs.',
    how: [
      'Every soft thing is a set of particles. Each step a particle keeps moving by how far it moved last step (position minus previous position: Verlet integration), plus gravity and wind.',
      'Then constraints pull the shape back, a few passes per step: each edge back to its rest length (cloth has edges along its threads, across its squares for shear, and two apart for bending), pinned particles back to their pins, and particles out of colliders (the floor, the table, the hero).',
      'Wind pushes each triangle by how much it faces the wind, relative to how the cloth already moves, with gusts that vary in time and along the cloth: flags ripple instead of standing stiff.',
      'Jelly blobs are closed surfaces with a pressure constraint: after the edges, the surface is pushed out along its normals toward the volume it started with, so a squashed blob bulges back.',
      'The hero is two spheres (legs and chest) that every soft body collides with. Soft bodies don\'t push the hero back: they are scenery that reacts.',
      'Drawing: a SoftMesh copies the particles into a mesh each frame and recomputes its normals, so cloth shades, outlines and filters like everything else. Ropes are one instanced box per segment.',
    ],
    uses: [
      'Capes, flags and banners: Journey\'s scarf, Assassin\'s Creed flags, Hollow Knight\'s cloak (2D).',
      'Ropes and vines to swing past, curtains and bead strings: Uncharted, Tomb Raider.',
      'Jelly and slime enemies that squish: Slime Rancher, Kirby, LocoRoco.',
    ],
    ask: ['a flag that flaps in the wind', 'a curtain the player can walk through', 'a cape on the hero', 'a jelly blob that wobbles when hit', 'ropes hanging from the ceiling that sway'],
    cost: 'About 1500 particles and 6000 constraints here, at 8 to 16 passes: around 1 ms of JavaScript per step. Each soft mesh re-uploads its vertices every frame (a few KB).',
    code: [
      {
        title: 'Verlet: the velocity is how far it moved last step',
        file: 'src/engine/physics/verlet.ts',
        src: `const x = pos[k + c]!;
const v = (x - prev[k + c]!) * d;
prev[k + c] = x;
pos[k + c] = x + v + (this.gravity[c]! + acc[k + c]!) * dt2;`,
      },
      {
        title: 'Cloth: structure, shear and bend edges',
        file: 'src/engine/physics/verlet.ts',
        src: `if (c + 1 < cols) edges.push([id(c, r), id(c + 1, r)]);
edges.push([id(c, r), id(c + 1, r + 1), shear]);
if (c + 2 < cols) edges.push([id(c, r), id(c + 2, r), bend]);`,
      },
    ],
    words: ['soft body', 'Verlet integration', 'constraint', 'cloth', 'pressure', 'collider', 'fixed timestep', 'instancing'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(30, 22, { floor: ['mist', 'sky'], wall: { color: 'teal', side: 'navy' } });
    const bodies: VerletBody[] = [];
    const meshes: (SoftMesh | RopeMesh)[] = [];
    const resets: (() => void)[] = [];
    // the hero, as two spheres every soft body pushes away from
    const legs = { x: 0, y: -10, z: 0, r: 0.38 };
    const chest = { x: 0, y: -10, z: 0, r: 0.42 };
    const add = <T extends VerletBody>(b: T, color: PaletteColor | null, o: { doubleSided?: boolean; uv?: Float32Array; rope?: number } = {}): T => {
      b.floor = 0.02;
      b.spheres.push(legs, chest);
      bodies.push(b);
      resets.push(snapshot(b));
      if (color) {
        const mat = toonMaterial(PALETTE[color]);
        const mesh = o.rope ? new RopeMesh(b, mat, o.rope) : new SoftMesh(b, mat, { uv: o.uv, doubleSided: o.doubleSided });
        ctx.scene.add(mesh);
        meshes.push(mesh);
      }
      return b;
    };

    // ---------------------------------------------------------------- flags
    let wind = 4;
    let windDir = 0.25; // radians from +X toward +Z
    const flags = (['red', 'sand', 'sky'] as const).map((color, i) => {
      const x = -10 + i * 4;
      kit.cylinder([x, 2.1, -7], 0.07, 4.2, 'slate');
      kit.cylinder([x, 4.25, -7], 0.12, 0.12, 'sand', { ghost: true });
      const f = clothGrid({ width: 2.4, height: 1.5, cols: 14, rows: 9, origin: [x + 0.08, 4.05, -7], pin: 'left', bend: 0.2 });
      add(f, color, { uv: f.uv });
      return f;
    });
    const setWind = () => {
      for (const f of flags) f.wind = [Math.cos(windDir) * wind, 0, Math.sin(windDir) * wind];
    };
    setWind();
    WINDS.forEach((w, i) =>
      kit.pad([-11 + i * 2.2, 0, -3.4], { label: w.label, color: 'sky', group: 'wind', initial: w.speed === 4, note: `Wind at ${w.speed} m/s: every triangle is pushed by how much it faces the wind, with gusts.`, apply: () => ((wind = w.speed), setWind()) }),
    );
    kit.pad([-4.4, 0, -3.4], {
      label: 'RELEASE',
      color: 'red',
      note: 'The flags\' pins let go: nothing holds them but the wind and the floor.',
      apply: () => {
        for (const f of flags) for (let i = 0; i < f.count; i++) f.unpin(i);
      },
    });
    kit.pad([-2.2, 0, -3.4], { label: 'RESET', color: 'sand', note: 'Everything soft back where it started.', apply: () => resets.forEach((r) => r()) });

    // ---------------------------------------------------------------- the curtain
    const cx = 4;
    kit.box([cx - 0.15, 1.5, -4], [0.2, 3, 0.2], 'plum');
    kit.box([cx + 3.55, 1.5, -4], [0.2, 3, 0.2], 'plum');
    kit.box([cx + 1.7, 3.05, -4], [3.9, 0.2, 0.3], 'plum', { side: 'night' });
    const curtain = add(clothGrid({ width: 3.3, height: 2.6, cols: 18, rows: 14, origin: [cx + 0.05, 2.95, -4], pin: 'top', bend: 0.1, shear: 0.6 }), 'plum');
    curtain.wind = [0, 0, 0.6];
    curtain.gust = 0.8;
    kit.label([cx + 1.7, 3.6, -4], 'CURTAIN · WALK THROUGH', { color: 'plum', range: 9 });

    // ---------------------------------------------------------------- sheets on a table and a ball
    kit.box([-8, 0.55, 5], [2.2, 1.1, 1.6], 'orange', { side: 'red' });
    const ballMesh = new Mesh(new SphereGeometry(0.9, 16, 12), toonMaterial(PALETTE.slate));
    ballMesh.position.set(-4, 0.9, 5);
    ballMesh.castShadow = ballMesh.receiveShadow = true;
    kit.decorate(ballMesh);
    ctx.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.9), ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-4, 0.9, 5)));
    const sheets = (['white', 'lime'] as const).map((color, i) => {
      const x = i === 0 ? -8 : -4;
      const s = clothGrid({ width: 2.8, height: 2.8, cols: 15, rows: 15, origin: [x - 1.4, -20, 5 - 1.4], down: [0, 0, 1], pin: 'none', bend: 0.15 });
      add(s, color, { uv: s.uv });
      // a little bigger than the props: the sheet rests just above them, not in their faces
      s.boxes.push({ x: -8, y: 0.55, z: 5, hx: 1.14, hy: 0.6, hz: 0.84 });
      s.spheres.push({ x: -4, y: 0.9, z: 5, r: 0.96 });
      return { s, x };
    });
    const drop = () => {
      for (const { s, x } of sheets) {
        for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) s.set(r * 15 + c, x - 1.4 + (c / 14) * 2.8, 3.2, 5 - 1.4 + (r / 14) * 2.8);
      }
    };
    kit.pad([-6, 0, 8.4], { label: 'DROP SHEETS', color: 'lime', note: 'Two loose sheets fall: their particles collide with the table (a box) and the ball (a sphere) and the edges drape them.', apply: drop });

    // ---------------------------------------------------------------- ropes
    kit.box([6, 3.5, 5], [6.4, 0.25, 0.25], 'night');
    const ropes = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5].map((x, i) => add(ropeLine([x, 3.4, 5], [x, 0.7, 5], 12), i % 2 ? 'orange' : 'sand', { rope: 0.07 }));
    kit.pad([6, 0, 8.4], {
      label: 'SWING ROPES',
      color: 'orange',
      note: 'A push to every rope particle (each by how far down the rope it is): ropes are particle chains with a distance constraint per segment.',
      apply: () => ropes.forEach((r, i) => r.impulse(0, 0, i % 2 ? 4 : -4, 1 / 60)),
    });

    // ---------------------------------------------------------------- jelly
    let pressure = 0.6;
    const blobs = (
      [
        [11, 0.85, -6.5, 0.85, 'lime'],
        [13, 0.75, -3.5, 0.75, 'green'],
        [10.4, 0.6, -2.2, 0.6, 'cyan'],
      ] as const
    ).map(([x, y, z, r, color]) => add(softBlob([x, y, z], r, { rings: 7, segments: 12, pressure }), color, { doubleSided: false }));
    kit.pad([12.5, 0, 0.6], {
      label: 'JIGGLE',
      color: 'lime',
      note: 'An upward kick to every blob particle: the pressure constraint keeps the volume while the edges wobble.',
      apply: () => blobs.forEach((b) => b.impulse(0, 6, 0, 1 / 60)),
    });
    kit.label([11.5, 2.6, -4.5], 'JELLY · PRESSURE BLOBS', { color: 'lime', range: 10 });

    kit.light({ position: [0, 5, -2], color: PALETTE.white, intensity: 4, radius: 16, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'wind', label: 'Wind speed', min: 0, max: 16, step: 0.5, get: () => wind, set: (v) => ((wind = v), setWind()), format: (v) => `${v} m/s`, initial: 4 },
      { id: 'wind-dir', label: 'Wind direction', min: -180, max: 180, step: 5, get: () => Math.round((windDir * 180) / Math.PI), set: (v) => ((windDir = (v * Math.PI) / 180), setWind()), format: (v) => `${v}°`, initial: 15 },
      { id: 'gust', label: 'Gustiness', min: 0, max: 1, step: 0.05, get: () => flags[0]!.gust, set: (v) => flags.forEach((f) => (f.gust = v)), initial: 0.4 },
      { id: 'passes', label: 'Constraint passes', min: 1, max: 24, step: 1, get: () => flags[0]!.iterations, set: (v) => bodies.forEach((b) => (b.iterations = v)), initial: 10, hint: 'Few passes: stretchy cloth and ropes. Many: stiff, and slower.' },
      { id: 'pressure', label: 'Jelly pressure', min: 0, max: 1, step: 0.05, get: () => pressure, set: (v) => ((pressure = v), blobs.forEach((b) => (b.pressure = v))), initial: 0.6 },
    ];
    let dust = 0;
    return {
      knobs,
      fixedUpdate(dt) {
        const h = room.hero?.hero;
        if (h) {
          const f = h.feet;
          legs.x = chest.x = f.x;
          legs.z = chest.z = f.z;
          legs.y = f.y + 0.4;
          chest.y = f.y + 1.1;
        }
        for (const b of bodies) b.step(dt);
        // a few motes ride the wind
        dust += dt * wind;
        if (dust > 6) {
          dust = 0;
          const k = wind * 0.15;
          ctx.particles.burst('dust', [-12, 2 + Math.sin(ctx.physics.time) * 1.5, -7], { count: 2, direction: [Math.cos(windDir) * k, 0, Math.sin(windDir) * k], speed: wind * 0.6 });
        }
      },
      update() {
        for (const m of meshes) m.sync();
      },
      status: () => `wind ${wind} particles ${bodies.reduce((n, b) => n + b.count, 0)}`,
      api: {
        drop,
        release: () => flags.forEach((f) => { for (let i = 0; i < f.count; i++) f.unpin(i); }),
        reset: () => resets.forEach((r) => r()),
        particles: () => bodies.reduce((n, b) => n + b.count, 0),
        /** Where each flag's free corner is (x, y, z). */
        flags: () => flags.map((f) => [f.pos[(f.cols - 1) * 3]!, f.pos[(f.cols - 1) * 3 + 1]!, f.pos[(f.cols - 1) * 3 + 2]!] as Vec3),
        /** The centre of each sheet (draped: about the table's and the ball's tops, a little lower). */
        sheets: () => sheets.map(({ s }) => s.center()),
        curtain: () => curtain.center(),
        blobs: () => blobs.map((b) => ({ volume: b.volume(), rest: b.restVolume })),
      },
    };
  },
};
