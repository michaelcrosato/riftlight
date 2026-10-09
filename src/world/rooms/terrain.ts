/**
 * Terrain Lab: a landscape grown from a seed. Fractal noise makes hills with detail on
 * detail, ridged noise makes crests, and droplet erosion carves gullies; the same grid of
 * heights is the Rapier heightfield the hero walks on. Trees are scattered by rule (grass,
 * gentle slopes, where a second noise says so).
 */
import { ConeGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { createNoise, PALETTE, setLookLayer, Terrain, toonMaterial, WaterSurface, WAVES_CALM } from '../../engine';
import type { Knob, RoomDef } from '../types';

/** The land's rectangle (x, z) inside the 40 x 34 m room; the plaza is south of it. */
const X0 = -19;
const X1 = 19;
const Z0 = -16;
const Z1 = 8;

export const TERRAIN: RoomDef = {
  id: 'terrain',
  title: 'Terrain Lab',
  wing: 'procedural',
  about:
    'A landscape grown from one number, the seed. Layers of noise make hills with detail on detail, ridged noise makes mountain crests, and simulated rain carves gullies down them. Walk on it: the same grid of heights is the ground you stand on. Another seed is another land; the same seed is always the same one.',
  try: ['NEW LAND, then climb a hill', 'RIDGES: crests instead of rolling hills', 'ERODE and watch the rain carve gullies', 'Height, scale and roughness (T)'],
  spawn: [0, 0, 10.5],
  facing: Math.PI,
  background: 'sky',
  guide: {
    what: 'A walled valley of procedural terrain north of a plaza, lakes where it dips, trees scattered on the gentle grass, and pads that remake it, change its kind of noise, and erode it.',
    how: [
      'Gradient noise gives a smooth random height anywhere: random slopes at the points of a grid, blended between them. One layer is a blob of hills.',
      'Fractal noise adds octaves: the same noise at twice the frequency and half the strength (the roughness), again and again. Big shapes keep their small detail, as real land does. Ridged noise folds each layer (1 - |noise|, squared), so its creases become sharp crests.',
      'The heights are sampled on a grid (two per metre here) and fade to the plaza\'s level near the walls. The mesh is that grid as flat-shaded triangles, coloured by height (beach, grass, forest, rock, snow) and slope (steep faces are rock).',
      'Collision is a Rapier heightfield of the same grid, split into triangles the same way, so what you see is what you stand on.',
      'Erosion drops rain at random points. Each drop rolls downhill, speeding up; while it is fast and falling it digs soil up to what it can carry, and where it slows or climbs it lays it down. Thousands of drops carve gullies and fill hollows.',
      'Trees are placed by rules, not by hand: every couple of metres (jittered), if the ground there is grass, not steep, and a second noise is high enough.',
    ],
    uses: [
      'Minecraft, No Man\'s Sky, Valheim and Terraria build their worlds from noise and a seed.',
      'Terrain tools (World Machine, Gaea, Unreal\'s landscapes) erode heightfields the same way; heightfields are the ground in most open-world games.',
    ],
    ask: ['procedural terrain from noise', 'a heightfield the player can walk on', 'erosion on a heightmap', 'scatter trees on terrain by rules', 'a world from a seed'],
    cost: 'Making the land is one noise sum per grid point (about 3,700 here), a millisecond or two; erosion is about 40 steps per drop, a few milliseconds per thousand drops. Drawing is one mesh; the heightfield collides as cheaply as a box.',
    code: [
      {
        title: 'Fractal noise: octaves of finer, fainter noise added up',
        file: 'src/engine/procgen/noise.ts',
        src: `sum += amp * n2(x * f + k * 17.31, y * f - k * 9.73);
amp *= gain;
f *= lacunarity;`,
      },
      {
        title: 'Erosion: a drop carries more the faster it falls',
        file: 'src/engine/procgen/terrain.ts',
        src: `const cap = Math.max(-dh * speed * water * capacity, minCapacity);
const amount = Math.min((cap - sediment) * erodeRate, -dh);`,
      },
      {
        title: 'The same heights as a Rapier heightfield',
        file: 'src/engine/procgen/terrain.ts',
        src: `this.collider = physics.world.createCollider(RAPIER.ColliderDesc.heightfield(this.nz, this.nx, h, { x: this.sizeX, y: 1, z: this.sizeZ }).setFriction(0.8), body);`,
      },
    ],
    words: ['procedural generation', 'seed', 'gradient noise', 'fractal noise', 'heightfield', 'hydraulic erosion'],
  },
  build(room) {
    const { kit, ctx } = room;
    // the yard: walls round a land with no floor of its own (the terrain is the floor), the plaza south
    const W = 40;
    const D = 34;
    const rows = Array.from({ length: D }, (_, r) =>
      Array.from({ length: W }, (_, c) => (r === 0 || c === 0 ? '#' : r === D - 1 || c === W - 1 ? '=' : r <= 24 ? 't' : '.')).join(''),
    );
    kit.room(W, D, { rows, floor: ['sand', 'orange'], wall: { color: 'teal', side: 'navy', height: 4 }, legend: { t: { floor: null } } });
    const land = new Terrain({ size: [X1 - X0, Z1 - Z0], cells: [76, 48], at: [(X0 + X1) / 2, 0, (Z0 + Z1) / 2] });
    ctx.scene.add(land.mesh);
    // lakes: still water where the land dips below it (the plaza and the walls hide the rest)
    ctx.scene.add(new WaterSurface({ size: [X1 - X0 - 0.4, Z1 - Z0 - 0.4], at: [(X0 + X1) / 2, -0.45, (Z0 + Z1) / 2], waves: WAVES_CALM, segments: [38, 24], foamAt: 1, opacity: 0.8 }));

    let seed = 7;
    let height = 5;
    let scale = 0.055;
    let gain = 0.5;
    let ridges = false;
    let drops = 0;
    let eroding = 0;
    let dirty = true;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const shape = (x: number, z: number, noise: ReturnType<typeof createNoise>) => {
      // 0 at the walls and the plaza's edge, the full height 4 m in
      const edge = smooth(Math.min(1, Math.max(0, Math.min(x - X0, X1 - x, z - Z0, Z1 - z) / 4)));
      const o = { octaves: 5, gain };
      const n = ridges ? noise.ridged2(x * scale, z * scale, o) * 1.25 - 0.2 : noise.fbm2(x * scale, z * scale, o) * 0.9 + 0.3;
      return height * edge * n;
    };

    // trees: cones where the rules allow
    const MAX_TREES = 260;
    const trees = new InstancedMesh(new ConeGeometry(0.45, 1.5, 6).translate(0, 0.75, 0), toonMaterial(PALETTE.teal), MAX_TREES);
    trees.castShadow = true;
    trees.frustumCulled = false;
    setLookLayer(trees, 'actors');
    ctx.scene.add(trees);
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3();
    const up = new Vector3();
    const scatter = () => {
      const pick = createNoise(seed + 101);
      let n = 0;
      for (let z = Z0 + 3; z < Z1 - 2 && n < MAX_TREES; z += 1.7) {
        for (let x = X0 + 3; x < X1 - 3 && n < MAX_TREES; x += 1.7) {
          // jitter the grid so it doesn't look planted, then ask the rules
          const jx = x + pick.n2(x * 3.1, z * 1.7) * 0.7;
          const jz = z + pick.n2(z * 2.3, x * 2.9) * 0.7;
          const y = land.heightAt(jx, jz);
          if (y < 0.25 || y > 2.6) continue; // grass and forest only
          if (land.normalAt(jx, jz, up).y < 0.86) continue; // not on steep ground
          if (pick.fbm2(jx * 0.12, jz * 0.12, { octaves: 2 }) < 0.12) continue; // woods, not a lawn
          m.compose(p.set(jx, y - 0.05, jz), q.identity(), s.setScalar(0.7 + 0.5 * (pick.n2(jx, jz) * 0.5 + 0.5)));
          trees.setMatrixAt(n++, m);
        }
      }
      trees.count = n;
      trees.instanceMatrix.needsUpdate = true;
    };
    trees.count = 0;

    const feet = new Vector3();
    /** After the land changes: anyone now inside it is lifted onto it. */
    const lift = () => {
      const h = room.hero?.hero;
      if (!h) return;
      h.feetInto(feet);
      if (feet.x <= X0 || feet.x >= X1 || feet.z <= Z0 || feet.z >= Z1) return;
      const y = land.heightAt(feet.x, feet.z);
      if (feet.y < y + 0.05) room.hero!.teleport([feet.x, y + 0.02, feet.z]);
    };
    const remake = () => {
      const noise = createNoise(seed);
      land.generate((x, z) => shape(x, z, noise));
      land.attach(ctx.physics);
      drops = 0;
      eroding = 0;
      scatter();
      lift();
      dirty = false;
    };
    const ERODE_CHUNKS = 8;
    const PER_CHUNK = 460; // 8 x 460: about one drop per grid point
    kit.pad([-6.75, 0, 13.5], { label: 'NEW LAND', color: 'green', note: 'A new seed: the same rules, another land (and this seed is always this land).', apply: () => ((seed = (seed % 97) + 1), (dirty = true)) });
    kit.pad([-2.25, 0, 13.5], {
      label: 'RIDGES',
      color: 'slate',
      note: 'Ridged noise: each layer folded (1 - |n|) squared, so its creases become crests. Step again for rolling hills.',
      apply: (_r, pad) => {
        ridges = !ridges;
        kit.lightPad(pad, ridges);
        dirty = true;
      },
    });
    kit.pad([2.25, 0, 13.5], { label: 'ERODE', color: 'sky', note: 'Rain: about 3,700 drops roll downhill, digging where they speed up, dropping soil where they slow.', apply: () => (eroding = ERODE_CHUNKS) });
    kit.pad([6.75, 0, 13.5], { label: 'UNERODE', color: 'orange', note: 'The land as the noise made it, before the rain.', apply: () => (dirty = true) });
    kit.label([0, 5.5, -16], 'SEED -> NOISE -> LAND', { color: 'white', range: 30 });
    const knobs: Knob[] = [
      { id: 'seed', label: 'Seed', min: 1, max: 97, step: 1, get: () => seed, set: (v) => ((seed = v), (dirty = true)), initial: 7, hint: 'The same seed always grows the same land.' },
      { id: 'height', label: 'Height', min: 1, max: 8, step: 0.5, get: () => height, set: (v) => ((height = v), (dirty = true)), format: (v) => `${v} m`, initial: 5 },
      { id: 'scale', label: 'Scale', min: 0.02, max: 0.12, step: 0.005, get: () => scale, set: (v) => ((scale = v), (dirty = true)), format: (v) => `${Math.round(1 / v)} m hills`, initial: 0.055, hint: 'The first octave\'s frequency: broad hills or many small ones.' },
      { id: 'roughness', label: 'Roughness', min: 0.25, max: 0.75, step: 0.05, get: () => gain, set: (v) => ((gain = v), (dirty = true)), initial: 0.5, hint: 'How strong each finer octave is: smooth, or rocky detail on detail.' },
    ];
    return {
      knobs,
      update() {
        if (dirty) remake();
        if (eroding > 0) {
          land.erode({ droplets: PER_CHUNK, seed: seed * 1000 + drops });
          drops += PER_CHUNK;
          if (--eroding === 0) scatter();
          land.attach(ctx.physics);
          lift();
        }
      },
      draw() {
        ctx.hud.text(4, 18, `SEED ${seed} · ${ridges ? 'RIDGES' : 'HILLS'} · ${drops ? `${drops} DROPS OF RAIN` : 'UNERODED'}`, { anchor: 'bottom-left', color: 'white' });
      },
      status: () => `seed ${seed} ridges ${ridges} drops ${drops} trees ${trees.count}`,
      api: {
        seed: (v?: number) => {
          if (v !== undefined) {
            seed = v;
            dirty = true;
          }
          return seed;
        },
        ridges: (on: boolean) => ((ridges = on), (dirty = true)),
        erode: () => (eroding = ERODE_CHUNKS),
        eroding: () => eroding > 0,
        drops: () => drops,
        trees: () => trees.count,
        /** The land at (x, z): the mesh's height and what a ray down hits (the collider). */
        probe: (x: number, z: number) => {
          const hit = { y: 0, nx: 0, ny: 0, nz: 0, id: 0 };
          return { mesh: land.heightAt(x, z), collider: ctx.physics.castDown(x, 30, z, 60, hit) ? hit.y : null };
        },
        heights: () => {
          let min = Infinity;
          let max = -Infinity;
          for (const h of land.heights) {
            min = Math.min(min, h);
            max = Math.max(max, h);
          }
          return { min, max };
        },
        bounds: () => ({ x: [X0, X1], z: [Z0, Z1] }),
      },
    };
  },
};
