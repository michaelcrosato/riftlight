/**
 * Grass & Wind: a meadow of thousands of blades that lean with the wind, ripple as gusts roll
 * across, and part around the hero (and a ball you can kick through it); trees and flowers
 * sway with the same wind.
 */
import { Mesh, SphereGeometry, Vector2, Vector3 } from 'three/webgpu';
import { GrassField, PALETTE, RAPIER, setLookLayer, swayObject, toonMaterial, WindUniforms } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const MEADOW = { w: 22, d: 16, at: [0, 0, -1] as Vec3 };
const WINDS: { label: string; speed: number }[] = [
  { label: 'CALM', speed: 0.3 },
  { label: 'BREEZE', speed: 1.8 },
  { label: 'GALE', speed: 4.5 },
];

export const FOLIAGE: RoomDef = {
  id: 'foliage',
  title: 'Grass & Wind',
  wing: 'effects',
  about:
    'A meadow of thousands of grass blades in one draw call: they lean with the wind, ripple as gusts roll across, and part around you as you walk through, and around the ball when you kick it. The trees and flowers sway with the same wind.',
  try: ['Run through the grass and look behind you', 'Kick the ball through the meadow (walk into it)', 'GALE, then turn the wind with the knob (T)', 'Fill the meadow: 12 000 blades'],
  spawn: [0, 0, 8],
  facing: Math.PI,
  background: 'sky',
  guide: {
    what: 'A walled meadow with grass, flowers, swaying trees and a ball, and pads for the wind and the number of blades.',
    how: [
      'Every blade is an instance of the same tiny mesh (two crossed triangles); thousands of them are one draw call. Each instance has its root position and height; nothing about it changes on the CPU after it is placed.',
      'The vertex shader bends each blade by its height squared (the root stays put, the tip moves): a steady lean along the wind, a flutter of its own, and gusts, a sine of the position along the wind minus time, so bands of bent grass roll across the meadow.',
      'Up to four pushers (the hero, the ball) are uniforms: blades within reach of one lean away from it and flatten, more the closer they are. It costs nothing per blade on the CPU.',
      'Blades are toon-lit as if they were the ground (their normal points up), so they take the floor\'s light bands and shadows, and their colour steps from root to tip in three bands.',
      'Trees and flowers sway with the same wind: a copy of their material leans every vertex above the trunk along the wind, by its height squared, with its own phase.',
    ],
    uses: [
      'Grass that parts around the player: Zelda: Breath of the Wild, Ghost of Tsushima\'s wind-swept fields, A Short Hike.',
      'Wind sway on trees and plants: almost every 3D game with foliage.',
      'Instanced foliage at scale: open-world games draw millions of blades this way.',
    ],
    ask: ['a field of grass that moves in the wind', 'grass that bends around the player', 'trees that sway', 'wind gusts you can see rolling across a field'],
    cost: 'GPU: every blade vertex runs the bend (a few sines); 6000 blades are 36 000 vertices, one draw call. CPU: nothing per blade; four pusher positions a frame.',
    code: [
      {
        title: 'Gusts that roll across the field',
        file: 'src/engine/render/grass.ts',
        src: `const gust = sin(dot(root.xy, windDir).mul(0.45).sub(this.uTime.mul(2.2))).mul(0.5).add(0.5) as any;`,
      },
      {
        title: 'Blades part around a pusher',
        file: 'src/engine/render/grass.ts',
        src: `const push = max(float(1).sub(dist.div(max(P.w, 1e-3))), 0) as any;
off = off.add(vec3(dir.x.mul(push).mul(0.5), push.mul(-0.55), dir.y.mul(push).mul(0.5)));`,
      },
    ],
    words: ['instancing', 'draw call', 'uniform', 'TSL', 'toon shading', 'wind sway'],
  },
  assets: ['assets/tree.glb'],
  async build(room) {
    const { kit, ctx } = room;
    const physics = ctx.physics;
    const world = physics.world;
    kit.room(26, 22, { floor: ['teal', 'teal'], wall: { color: 'navy', side: 'night' } });
    const windU = new WindUniforms();
    const wind = new Vector2();
    let speed = 1.8;
    let dir = 0.35; // radians from +x toward +z
    const inMeadow = (x: number, z: number) => Math.abs(x - MEADOW.at[0]) < MEADOW.w / 2 && Math.abs(z - MEADOW.at[2]) < MEADOW.d / 2;
    // keep a path free round the trees
    const trees: Vec3[] = [
      [-8, 0, -6],
      [7.5, 0, -5],
      [-3, 0, -7.5],
    ];
    const clear = (x: number, z: number) => trees.every((t) => Math.hypot(x - t[0], z - t[2]) > 1);
    let blades = 6000;
    let grass: GrassField | null = null;
    let flowers: GrassField | null = null;
    const plant = () => {
      grass?.removeFromParent();
      grass?.dispose();
      flowers?.removeFromParent();
      flowers?.dispose();
      grass = new GrassField({ area: [MEADOW.w, MEADOW.d], at: MEADOW.at, count: blades, height: [0.35, 0.8], width: 0.16, base: PALETTE.teal, tip: PALETTE.lime, mask: clear, seed: 5 });
      flowers = new GrassField({ area: [MEADOW.w, MEADOW.d], at: MEADOW.at, count: Math.round(blades / 30), height: [0.7, 0.95], width: 0.2, base: PALETTE.green, tip: PALETTE.red, mask: clear, seed: 9 });
      ctx.scene.add(grass, flowers);
    };
    plant();
    const tree = await ctx.loadModel('assets/tree.glb');
    trees.forEach((at, i) => {
      const t = tree.scene.clone(true);
      t.position.set(...at);
      t.scale.setScalar(1.6 - i * 0.2);
      t.rotation.y = i * 1.3;
      swayObject(t, windU, { height: 2.3, base: 0.7, amount: 0.12, phase: i * 2.1 });
      t.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = (o as Mesh).receiveShadow = true) : null));
      ctx.scene.add(t);
      physics.addStaticCylinder([at[0], 1, at[2]], 1, 0.3);
    });
    // a ball to kick through the grass (the hero shoves it)
    const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2, 0.5, 3).setLinearDamping(0.6).setAngularDamping(0.4));
    world.createCollider(RAPIER.ColliderDesc.ball(0.45).setDensity(0.4).setRestitution(0.4).setFriction(0.8), ballBody);
    const ball = new Mesh(new SphereGeometry(0.45, 14, 10), toonMaterial(PALETTE.orange));
    ball.castShadow = true;
    setLookLayer(ball, 'actors');
    ctx.scene.add(ball);
    physics.bind(ballBody, ball);

    const setWind = () => wind.set(Math.cos(dir) * speed, Math.sin(dir) * speed);
    setWind();
    WINDS.forEach((w, i) => kit.pad([-9 + i * 2.2, 0, 9.4], { label: w.label, color: 'sky', group: 'wind', initial: w.speed === 1.8, note: `Wind ${w.speed}: the lean, the flutter and the gusts all scale with it.`, apply: () => ((speed = w.speed), setWind()) }));
    for (const [i, n] of [2000, 6000, 12000].entries())
      kit.pad([3 + i * 2.2, 0, 9.4], { label: `${n / 1000}K BLADES`, color: 'lime', group: 'blades', initial: n === 6000, note: `${n} blades (and ${Math.round(n / 30)} flowers): still one draw call each.`, apply: () => ((blades = n), plant()) });
    kit.light({ position: [0, 5, 0], color: PALETTE.sand, intensity: 3, radius: 16, flicker: 'none' });

    const knobs: Knob[] = [
      { id: 'wind', label: 'Wind', min: 0, max: 8, step: 0.1, get: () => speed, set: (v) => ((speed = v), setWind()), initial: 1.8 },
      { id: 'wind-dir', label: 'Wind direction', min: -180, max: 180, step: 5, get: () => Math.round((dir * 180) / Math.PI), set: (v) => ((dir = (v * Math.PI) / 180), setWind()), format: (v) => `${v}°`, initial: 20 },
      { id: 'sway', label: 'Grass lean', min: 0, max: 0.4, step: 0.01, get: () => grass?.sway ?? 0.12, set: (v) => grass && (grass.sway = v), initial: 0.12 },
    ];
    const at = new Vector3();
    return {
      knobs,
      update() {
        const t = physics.time;
        windU.update(t, wind);
        for (const g of [grass, flowers]) {
          if (!g) continue;
          g.wind.copy(wind);
          g.update(t);
          const h = room.hero?.hero;
          g.push(0, h ? h.feetInto(at) : null, 0.85);
          const b = ballBody.translation();
          g.push(1, inMeadow(b.x, b.z) ? { x: b.x, y: b.y, z: b.z } : null, 0.75);
        }
        if (flowers && grass) flowers.sway = grass.sway * 1.3;
      },
      status: () => `blades ${grass?.blades ?? 0} wind ${speed.toFixed(1)}`,
      api: {
        blades: () => grass?.blades ?? 0,
        flowers: () => flowers?.blades ?? 0,
        ball: () => ballBody.translation(),
        wind: (s: number) => ((speed = s), setWind()),
      },
    };
  },
};
