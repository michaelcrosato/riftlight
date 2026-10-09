/**
 * Water & Buoyancy: a pool you can wade into. The surface is travelling waves plus a ripple
 * field the hero, falling crates and rain dent; crates, balls and a raft float on the same
 * waves the shader draws (heavy things sink), carried round by a current. Stand on the raft.
 */
import { BoxGeometry, Mesh, SphereGeometry, Vector3 } from 'three/webgpu';
import { Floaters, PALETTE, Precipitation, RAPIER, RippleField, setLookLayer, toonMaterial, WAVES_CALM, WAVES_CHOPPY, WaterSurface } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const W = 26;
const D = 24;
/** The pool: x within ±7, z from -10 to -2; its floor 0.9 m down; the water 0.2 m below the deck. */
const POOL = { x0: -7, x1: 7, z0: -10, z1: -2, floor: -0.9, level: -0.2 };

function rows(): string[] {
  return Array.from({ length: D }, (_, r) =>
    Array.from({ length: W }, (_, c) => {
      const x = c - W / 2 + 0.5;
      const z = r - D / 2 + 0.5;
      if (r === 0 || c === 0) return '#';
      if (r === D - 1 || c === W - 1) return '=';
      if (x > POOL.x0 && x < POOL.x1 && z > POOL.z0 && z < POOL.z1) return 'w';
      if (x > POOL.x0 && x < POOL.x1 && z > POOL.z1 && z < POOL.z1 + 1) return 's';
      return '.';
    }).join(''),
  );
}

export const WATER: RoomDef = {
  id: 'water',
  title: 'Water & Buoyancy',
  wing: 'effects',
  about:
    'A pool you can wade into: the surface is a few travelling waves plus ripples that spread from your legs, from crates splashing in and from rain. Crates, balls and a raft float on exactly the waves you see, heavy things sink, and a current carries everything round. Stand on the raft and ride it.',
  try: ['Wade in: rings spread from your legs', 'DROP CRATES, then make it CHOPPY', 'Jump onto the raft and ride the current', 'RAIN, then SEE-THROUGH'],
  spawn: [0, 0, 3],
  facing: Math.PI,
  background: 'navy',
  guide: {
    what: 'A pool with steps in, floating crates, balls, a raft and one heavy anchor block, a current that circles the pool, and pads for the waves, rain and a see-through surface.',
    how: [
      'The surface is a grid of vertices moved by the vertex shader: the sum of four travelling waves (direction, wavelength, height, speed). The CPU sums the same waves at the same time, so anything floating bobs exactly on the drawn surface.',
      'Ripples are the 2D wave equation on a grid on the CPU: each cell is pulled toward the average of its neighbours, so a dent spreads as rings, bounces off the edges and dies away. The heights are uploaded each frame as a small float texture the vertex shader adds on.',
      'Normals come from the waves\' slopes (their derivatives), so the toon bands follow the waves; crests are lighter, the highest are foam, and sun glints are single hard pixels.',
      'Buoyancy: each floating body is split into eight octants. Each one under the surface pushes up, at its centre, by the weight of the water it displaces (how deep its own height is in, whichever way the body is turned), so bodies tilt with the waves, right themselves and float whichever way up they land; water drag slows them.',
      'See-through without blending: an ordered 4x4 dither drops a share of the water\'s pixels, so the pool floor shows through and no sorting is needed.',
      'The current is four force fields round the pool\'s edges; the hero standing on the raft rides it like any moving floor, pressing it down with its weight.',
    ],
    uses: [
      'Pixel-art water with dithered transparency: Sea of Stars, Eastward, A Link to the Past\'s shallow water.',
      'Floating crates and rafts: Raft, Zelda\'s rafts, Half-Life 2\'s buoyancy puzzles.',
      'Ripples where characters wade: Ori, Breath of the Wild, Unravel.',
    ],
    ask: ['a lake with waves and floating boxes', 'ripples where the player walks through water', 'a raft the player can stand on', 'rain that makes rings on the water', 'see-through water without transparency sorting'],
    cost: 'GPU: the water grid (one vertex per ripple cell, about 7 300) sums four waves per vertex and reads the ripple texture. CPU: the ripple grid (112 x 64 cells, a substep or two a frame) and eight samples per floating body, well under a millisecond.',
    code: [
      {
        title: 'The same waves on the CPU and the GPU',
        file: 'src/engine/physics/water.ts',
        src: `const k = (2 * Math.PI) / w.length;
h += w.amplitude * Math.sin(k * (w.dir[0] * x + w.dir[1] * z - w.speed * t));`,
      },
      {
        title: 'Ripples: the wave equation, one cell at a time',
        file: 'src/engine/physics/water.ts',
        src: `const lap = l + rt + u + d - 4 * cur[i]!;
nxt[i] = (2 * cur[i]! - old[i]! + k * lap) * keep;`,
      },
      {
        title: 'Buoyancy at each octant: how deep its own height is in',
        file: 'src/engine/physics/buoyancy.ts',
        src: `const depth = Math.min(1, (s - (wy - reach)) / (2 * reach));
const up = rho * g * f.share * depth * dt;`,
      },
    ],
    words: ['buoyancy', 'ripples', 'dither', 'force field', 'dynamic body', 'density', 'uniform'],
  },
  build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    const world = physics.world;
    const e = ctx.engine;
    kit.room(W, D, {
      rows: rows(),
      floor: ['sand', 'white'],
      wall: { color: 'teal', side: 'navy' },
      legend: { w: { floor: POOL.floor, floorColor: 'teal' }, s: { floor: -0.45, floorColor: 'sand' } },
    });
    // the pool's sides (the map floors are slabs: these hide the gaps between levels)
    const cx = (POOL.x0 + POOL.x1) / 2;
    const cz = (POOL.z0 + POOL.z1) / 2;
    const pw = POOL.x1 - POOL.x0;
    const pd = POOL.z1 - POOL.z0;

    // ---------------------------------------------------------------- the water
    const ripples = new RippleField({ size: [pw, pd], cells: [112, 64], center: [cx, cz], speed: 2.4, damping: 0.4 });
    const water = new WaterSurface({ size: [pw, pd], at: [cx, POOL.level, cz], waves: WAVES_CALM, ripples, deep: PALETTE.blue, shallow: PALETTE.sky, foam: PALETTE.white, opacity: 1 });
    ctx.scene.add(water);
    const surface = (x: number, z: number) => (water.covers(x, z) ? water.heightAt(x, z, physics.time) : null);
    ctx.particles.register('splash', { count: [8, 12], life: [0.3, 0.55], speed: [2, 3.5], spread: 35, gravity: 14, drag: 0.5, size: [2, 1], colors: ['white', 'sky', 'cyan'], radius: 0.15 });
    const floaters = new Floaters(world, surface, {
      onSplash: (x, y, z, speed) => {
        // a ring to look at, not a hole: a deep dent would throw the body back out (and again)
        ripples.splash(x, z, 0.5, Math.min(0.06, speed * 0.008));
        ctx.particles.burst('splash', [x, y + 0.2, z], { count: Math.min(16, Math.round(speed * 2)) });
        ctx.audio.play('land', { pitch: 6 });
      },
    });

    // ---------------------------------------------------------------- floating things
    const float = (at: Vec3, o: { size?: Vec3; ball?: number; density: number; color: keyof typeof PALETTE }) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(...at).setAngularDamping(0.4));
      const desc = o.ball ? RAPIER.ColliderDesc.ball(o.ball) : RAPIER.ColliderDesc.cuboid(o.size![0] / 2, o.size![1] / 2, o.size![2] / 2);
      world.createCollider(desc.setDensity(o.density).setFriction(1), body);
      if (o.ball) {
        const mesh = new Mesh(new SphereGeometry(o.ball, 12, 9), toonMaterial(PALETTE[o.color]));
        mesh.castShadow = true;
        setLookLayer(mesh, 'actors');
        ctx.scene.add(mesh);
        physics.bind(body, mesh);
      } else {
        const side = toonMaterial(PALETTE[o.color]);
        const top = toonMaterial(PALETTE.sand);
        const mesh = new Mesh(new BoxGeometry(...o.size!), [side, side, top, side, side, side]);
        mesh.castShadow = mesh.receiveShadow = true;
        setLookLayer(mesh, 'actors');
        ctx.scene.add(mesh);
        physics.bind(body, mesh);
      }
      floaters.add(body);
      return body;
    };
    const crates = [-4.5, -2, 1, 3.5].map((x, i) => float([x, 0.5, -7 + (i % 2) * 2.5], { size: [0.7, 0.7, 0.7], density: 0.5, color: 'orange' }));
    const balls = [-5.5, -3, 0, 2.5, 5].map((x, i) => float([x, 0.4, -4 - (i % 2) * 3], { ball: 0.28, density: 0.3, color: i % 2 ? 'red' : 'lime' }));
    const raft = float([-2, 0, -5.5], { size: [2.6, 0.4, 2], density: 0.35, color: 'plum' });
    const anchor = float([5, 0.5, -8], { size: [0.6, 0.6, 0.6], density: 2.5, color: 'slate' });
    kit.label([5, 0.6, -8], 'TOO HEAVY · DENSITY 2.5', { color: 'slate', range: 8, small: true });
    const dropAt = (i: number): Vec3 => [-3 + i * 2, 4 + i * 0.6, -6 + (i % 2)];
    let dropped: RAPIER.RigidBody[] = [];
    const drop = () => {
      // the first time four new crates; after that the same four, lifted back up
      if (!dropped.length) dropped = [0, 1, 2, 3].map((i) => float(dropAt(i), { size: [0.6, 0.6, 0.6], density: 0.45, color: 'sand' }));
      else
        dropped.forEach((b, i) => {
          const [x, y, z] = dropAt(i);
          b.setTranslation({ x, y, z }, true);
          b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          b.setLinvel({ x: 0, y: 0, z: 0 }, true);
          b.setAngvel({ x: 0, y: 0, z: 0 }, true);
        });
    };

    // ---------------------------------------------------------------- the current: four fields round the edges
    let current = 1.6;
    const edges = [
      { at: [cx, 0, POOL.z0 + 1.2] as Vec3, box: [pw / 2, 1.5, 1.2] as Vec3, dir: [1, 0, 0] },
      { at: [POOL.x1 - 1.2, 0, cz] as Vec3, box: [1.2, 1.5, pd / 2] as Vec3, dir: [0, 0, 1] },
      { at: [cx, 0, POOL.z1 - 1.2] as Vec3, box: [pw / 2, 1.5, 1.2] as Vec3, dir: [-1, 0, 0] },
      { at: [POOL.x0 + 1.2, 0, cz] as Vec3, box: [1.2, 1.5, pd / 2] as Vec3, dir: [0, 0, -1] },
    ].map((f) => ({ ...f, field: physics.fields.add({ name: 'current', box: f.box, at: f.at, force: [f.dir[0]! * current, 0, f.dir[2]! * current], character: false }) }));
    const setCurrent = () => edges.forEach((f) => (f.field.force = [f.dir[0]! * current, 0, f.dir[2]! * current]));

    // ---------------------------------------------------------------- rain
    const rain = new Precipitation({ kind: 'rain', count: 2500, area: [20, 12, 18] });
    rain.intensity = 0;
    ctx.scene.add(rain);

    // ---------------------------------------------------------------- pads
    kit.pad([-8, 0, 1.5], { label: 'CALM', color: 'sky', group: 'waves', initial: true, note: 'Three long, low waves: a pond.', apply: () => water.setWaves(WAVES_CALM) });
    kit.pad([-5.8, 0, 1.5], { label: 'CHOPPY', color: 'blue', group: 'waves', note: 'Higher, faster waves: the floaters ride them (the CPU sums the same waves).', apply: () => water.setWaves(WAVES_CHOPPY) });
    kit.pad([-3.6, 0, 1.5], { label: 'DROP CRATES', color: 'orange', note: 'Four crates from 4 m: splashes, ripples, then they bob up.', apply: drop });
    kit.pad([3.6, 0, 1.5], {
      label: 'RAIN',
      color: 'sky',
      note: 'Rain: one instanced draw of falling streaks; each drop that hits the pool dents the ripple field.',
      apply: (_r, p) => {
        rain.intensity = rain.intensity > 0 ? 0 : 1;
        kit.lightPad(p, rain.intensity > 0);
      },
    });
    kit.pad([5.8, 0, 1.5], {
      label: 'SEE-THROUGH',
      color: 'cyan',
      note: 'An ordered dither drops 45% of the water\'s pixels: the pool floor shows through, nothing is blended or sorted.',
      apply: (_r, p) => {
        water.uOpacity.value = water.uOpacity.value < 1 ? 1 : 0.55;
        kit.lightPad(p, water.uOpacity.value < 1);
      },
    });
    kit.pad([8, 0, 1.5], {
      label: 'CURRENT',
      color: 'teal',
      initial: true,
      note: 'Four force fields round the edges push the floaters round the pool.',
      apply: (_r, p) => {
        const on = !edges[0]!.field.enabled;
        edges.forEach((f) => (f.field.enabled = on));
        kit.lightPad(p, on);
      },
    });
    kit.label([0, 1.6, -10.4], 'THE POOL · WADE IN', { color: 'sky', range: 14 });
    kit.light({ position: [0, 4, -6], color: PALETTE.sky, intensity: 3, radius: 12, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'current', label: 'Current', min: 0, max: 5, step: 0.25, get: () => current, set: (v) => ((current = v), setCurrent()), format: (v) => `${v} m/s²`, initial: 1.6 },
      { id: 'ripple-speed', label: 'Ripple speed', min: 0.5, max: 5, step: 0.1, get: () => ripples.speed, set: (v) => (ripples.speed = v), format: (v) => `${v} m/s`, initial: 2.4 },
      { id: 'ripple-fade', label: 'Ripples kept per second', min: 0.05, max: 0.9, step: 0.05, get: () => ripples.damping, set: (v) => (ripples.damping = v), initial: 0.4 },
      { id: 'opacity', label: 'Water opacity', min: 0.2, max: 1, step: 0.05, get: () => water.uOpacity.value as number, set: (v) => (water.uOpacity.value = v), initial: 1 },
    ];
    let wade = 0;
    let wades = 0;
    const rnd = (() => {
      let s = 7;
      return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    })();
    const feet = new Vector3();
    return {
      knobs,
      fixedUpdate(dt) {
        floaters.step(dt);
        ripples.step(dt);
        const h = room.hero?.hero;
        if (h) {
          h.feetInto(feet);
          const s = surface(feet.x, feet.z);
          // wading: rings from the legs while moving, a splash on landing in it
          if (s !== null && feet.y < s) {
            wade += dt * Math.min(1, h.speed / 3);
            if (wade > 0.12) {
              wade = 0;
              wades++;
              ripples.splash(feet.x, feet.z, 0.4, 0.06);
            }
          }
        }
        // rain drops that land in the pool
        if (rain.intensity > 0) {
          const n = rain.splashes(dt) * ((pw * pd) / (rain.area[0] * rain.area[2]));
          for (let i = 0; i < Math.floor(n + rnd()); i++) ripples.splash(POOL.x0 + rnd() * pw, POOL.z0 + rnd() * pd, 0.15, 0.025);
        }
      },
      update(dt) {
        water.update(physics.time, e.sunDir);
        rain.update(dt, ctx.camera.focus);
      },
      status: () => `floating ${floaters.list.length} wades ${wades} raft ${floaters.submerged(raft).toFixed(2)}`,
      api: {
        drop,
        /** How deep each kind sits (0..1 of its height). */
        submerged: () => ({ crates: crates.map((b) => floaters.submerged(b)), balls: balls.map((b) => floaters.submerged(b)), raft: floaters.submerged(raft), anchor: anchor.translation().y }),
        ripples: () => ripples.energy(),
        wades: () => wades,
        raft: () => raft.translation(),
        waves: (kind: 'calm' | 'choppy') => water.setWaves(kind === 'calm' ? WAVES_CALM : WAVES_CHOPPY),
      },
    };
  },
};
