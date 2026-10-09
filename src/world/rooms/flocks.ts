/**
 * Flocks & Herds: Reynolds' boids three ways. Birds wheel over a meadow, fish school in a
 * pond and scatter when you wade in, sheep graze in a pen and bolt from the hero. Each flock
 * is one Boids simulation (typed arrays, a spatial hash) drawn as one instanced mesh.
 */
import { ConeGeometry, Euler, InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three/webgpu';
import { Boids, PALETTE, setLookLayer, toonMaterial, WaterSurface, WAVES_CALM } from '../../engine';
import type { Knob, RoomDef } from '../types';

type V3 = [number, number, number];

export const FLOCKS: RoomDef = {
  id: 'flocks',
  title: 'Flocks & Herds',
  wing: 'genres',
  about:
    'Birds wheeling over a meadow, fish schooling in a pond and sheep grazing in a pen. Nobody tells them where to go: each one only looks at its neighbours (keep your distance, go where they go, stay with them) and that is enough for a flock. Walk into them and they scatter.',
  try: ['Walk into the sheep pen', 'Wade into the pond: the school splits round you', 'Make them tighter or looser (T)', 'BIRDS HOME calls the flock to a point'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'sky',
  guide: {
    what: 'A meadow with a flock of birds overhead, a pond with a school of fish, a pen of sheep, and settings for the three rules.',
    how: [
      'Every agent looks at the neighbours within a few metres (found through a spatial hash: a grid of buckets, so it checks only nearby cells, not everyone) and steers by three rules: separation (move away from those too close), alignment (turn toward their average heading) and cohesion (move toward their average position).',
      'Each rule gives a desired velocity; steering is the desired velocity minus the current one, capped, and the weighted sum is the acceleration. Speed is kept between a minimum and a maximum.',
      'Goals are more of the same: seek a point (BIRDS HOME), flee a threat (the hero, stronger the closer), keep inside bounds (pushed back near the walls), and steer round obstacles (the rocks in the pond).',
      'Fish and sheep are flat flocks (they keep their height); birds fly in 3D. Each flock is drawn as one instanced mesh, turned to face along its velocity.',
    ],
    uses: [
      'Crowds and wildlife: birds in Assassin\'s Creed and Red Dead Redemption 2, fish in Subnautica and Abzu, the bats of Batman Returns (the first film use of boids).',
      'RTS unit groups and swarms: Pikmin, the zombie hordes of World War Z, Planet Zoo\'s herds.',
    ],
    ask: ['a flock of birds that circles overhead', 'fish that school and scatter', 'sheep that run from the player', 'hundreds of creatures that move as a group'],
    cost: 'Each agent checks only its neighbours through the spatial hash: a few hundred agents in well under a millisecond. Drawing is one instanced draw per flock.',
    code: [
      {
        title: 'The three rules, each a steering force',
        file: 'src/engine/ai/boids.ts',
        src: `this.steer(ax / n, ay / n, az / n, k, o.alignment);
this.steer(cx, cy, cz, k, o.cohesion);
this.steer(sx, sy, sz, k, o.separation);`,
      },
      {
        title: 'Steering: desired velocity minus current, capped',
        file: 'src/engine/ai/boids.ts',
        src: `f[0] += Math.max(-m, Math.min(m, dx * s - this.vel[k]!)) * w;`,
      },
    ],
    words: ['boids', 'steering', 'spatial hash', 'instancing'],
  },
  build(room) {
    const { kit, ctx } = room;
    // a 28 × 22 m meadow (tall walls north and west, low ones south and east) with a pond dug
    // into it: the 'p' cells' floor is 0.6 m down
    const rows = Array.from({ length: 22 }, (_, r) =>
      Array.from({ length: 28 }, (_, c) => (r === 0 || c === 0 ? '#' : r === 21 || c === 27 ? '=' : c >= 17 && c <= 25 && r >= 5 && r <= 11 ? 'p' : '.')).join(''),
    );
    kit.room(28, 22, { rows, floor: ['green', 'lime'], wall: { color: 'teal', side: 'navy' }, legend: { p: { floor: -0.6, floorColor: 'navy' } } });
    // the sheep pen (a fence of low blocks) on the left, the pond on the right
    for (const [x, z, w, d] of [
      [-8, -6, 8, 0.3],
      [-8, 2, 8, 0.3],
      [-12, -2, 0.3, 8],
    ] as const)
      kit.box([x, 0.4, z], [w, 0.8, d], 'sand', { side: 'orange' });
    kit.label([-8, 1.6, -2], 'SHEEP', { color: 'white', range: 10 });
    const pond = new WaterSurface({ size: [9, 7], at: [7.5, -0.15, -2.5], waves: WAVES_CALM, segments: [36, 28], foamAt: 1, opacity: 0.75 }); // a still pond: no foam, see the fish
    ctx.scene.add(pond);
    const rocks: { x: number; y: number; z: number; r: number }[] = [
      { x: 6, y: -0.45, z: -1.5, r: 0.7 },
      { x: 9.5, y: -0.45, z: -4, r: 0.6 },
    ];
    for (const r of rocks) kit.cylinder([r.x, -0.3, r.z], r.r, 0.9, 'slate');
    kit.label([7.5, 1.4, -6.5], 'POND', { color: 'sky', range: 12 });

    // the flocks
    const birds = new Boids(90, { bounds: { min: [-12, 3, -9], max: [12, 8, 9] }, view: 2.5, space: 0.9, maxSpeed: 6, minSpeed: 3, seed: 3 });
    const fish = new Boids(70, { bounds: { min: [3.4, -0.4, -5.6], max: [11.6, -0.4, 0.6] }, view: 1.4, space: 0.45, maxSpeed: 2.4, minSpeed: 0.8, flat: true, seed: 5 });
    fish.obstacles = rocks;
    const sheep = new Boids(20, { bounds: { min: [-11.5, 0, -5.5], max: [-4.5, 0, 1.5] }, view: 2.2, space: 1.3, maxSpeed: 3.2, minSpeed: 0.15, separation: 3, cohesion: 0.25, alignment: 0.3, flat: true, margin: 0.6, seed: 7 });
    const mesh = (geometry: ConstructorParameters<typeof InstancedMesh>[0], color: number, n: number) => {
      const m = new InstancedMesh(geometry, toonMaterial(color), n);
      m.castShadow = true;
      m.frustumCulled = false;
      setLookLayer(m, 'actors');
      ctx.scene.add(m);
      return m;
    };
    const birdMesh = mesh(new ConeGeometry(0.12, 0.45, 4).rotateX(Math.PI / 2), PALETTE.white, birds.count);
    const fishMesh = mesh(new ConeGeometry(0.1, 0.4, 4).rotateX(Math.PI / 2), PALETTE.orange, fish.count);
    const sheepMesh = mesh(new SphereGeometry(0.4, 10, 8).scale(0.9, 0.75, 1.25).translate(0, 0.45, 0), PALETTE.white, sheep.count);

    let home = false;
    kit.pad([0, 0, 3], { label: 'BIRDS HOME', color: 'sky', note: 'The flock seeks a point over the middle: a fourth steering force added to the three.', apply: (_r, p) => ((home = !home), (birds.seek = home ? [0, 5, 0] : null), kit.lightPad(p, home)) });
    const knobs: Knob[] = [
      {
        id: 'separation',
        label: 'Separation',
        min: 0,
        max: 4,
        step: 0.1,
        get: () => birds.o.separation,
        set: (v) => [birds, fish].forEach((b) => (b.o.separation = v)),
        initial: 1.6,
        hint: 'How hard they keep their distance. 0: they bunch into a ball.',
      },
      { id: 'alignment', label: 'Alignment', min: 0, max: 3, step: 0.1, get: () => birds.o.alignment, set: (v) => [birds, fish].forEach((b) => (b.o.alignment = v)), initial: 1, hint: '0: no common heading, a swarm of gnats.' },
      { id: 'cohesion', label: 'Cohesion', min: 0, max: 3, step: 0.1, get: () => birds.o.cohesion, set: (v) => [birds, fish].forEach((b) => (b.o.cohesion = v)), initial: 0.8, hint: '0: they drift apart.' },
    ];
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    const sync = (b: Boids, im: InstancedMesh, flat: boolean) => {
      for (let i = 0; i < b.count; i++) {
        const k = i * 3;
        const vx = b.vel[k]!;
        const vy = b.vel[k + 1]!;
        const vz = b.vel[k + 2]!;
        e.set(flat ? 0 : -Math.atan2(vy, Math.hypot(vx, vz)), Math.atan2(vx, vz), 0, 'YXZ');
        m.compose(p.set(b.pos[k]!, b.pos[k + 1]!, b.pos[k + 2]!), q.setFromEuler(e), s);
        im.setMatrixAt(i, m);
      }
      im.instanceMatrix.needsUpdate = true;
    };
    let scattered = 0;
    // threats, moved each step (the flocks keep these objects)
    const threat: V3 = [0, 0, 0];
    sheep.flee = { at: threat, radius: 4 };
    fish.flee = { at: [0, -0.4, 0], radius: 2.2 };
    birds.flee = { at: [0, 0, 0], radius: 2.5 };
    return {
      knobs,
      fixedUpdate(dt) {
        const h = room.hero?.hero;
        if (h) {
          h.feetInto(p);
          threat[0] = p.x;
          threat[1] = p.y;
          threat[2] = p.z;
          fish.flee!.at[0] = birds.flee!.at[0] = p.x;
          fish.flee!.at[2] = birds.flee!.at[2] = p.z;
          birds.flee!.at[1] = p.y + 1.5;
        }
        birds.step(dt);
        fish.step(dt);
        sheep.step(dt);
        // sheep graze: they slow right down when nothing frightens them
        for (let i = 0; i < sheep.count; i++) {
          const k = i * 3;
          const d = Math.hypot(sheep.pos[k]! - threat[0], sheep.pos[k + 2]! - threat[2]);
          if (d > 4) {
            sheep.vel[k] = sheep.vel[k]! * 0.98;
            sheep.vel[k + 2] = sheep.vel[k + 2]! * 0.98;
          } else scattered += dt;
        }
      },
      update() {
        sync(birds, birdMesh, false);
        sync(fish, fishMesh, true);
        sync(sheep, sheepMesh, true);
      },
      status: () => `birds ${birds.order().alignment.toFixed(2)} fish ${fish.order().alignment.toFixed(2)}`,
      api: {
        order: () => ({ birds: birds.order(), fish: fish.order(), sheep: sheep.order() }),
        spacing: () => ({ birds: birds.spacing(), fish: fish.spacing() }),
        sheep: () => Array.from({ length: sheep.count }, (_, i) => [sheep.pos[i * 3]!, sheep.pos[i * 3 + 2]!]),
        scattered: () => scattered,
      },
    };
  },
};
