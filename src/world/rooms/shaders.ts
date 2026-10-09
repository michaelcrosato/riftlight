/**
 * Shader Gallery: six materials written as TSL node graphs, each on a pedestal. No textures:
 * every pixel's colour is computed from its position, its normal and the time. The see-through
 * ones dither instead of blending, so they stay crisp pixel art.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are dynamically typed */
import { BoxGeometry, CylinderGeometry, IcosahedronGeometry, type Material, Mesh, SphereGeometry, TorusKnotGeometry } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { crystalMaterial, forceFieldMaterial, hologramMaterial, lavaMaterial, marbleMaterial, PALETTE, setLookLayer, toonMaterial, woodMaterial } from '../../engine';
import type { Knob, RoomDef } from '../types';

export const SHADERS: RoomDef = {
  id: 'shaders',
  title: 'Shader Gallery',
  wing: 'rendering',
  about:
    'Six materials and not one texture among them: every pixel\'s colour is worked out from where it is, which way it faces and what time it is, in TSL (three.js\'s shader language, written as JavaScript). A hologram, a force field, lava, marble, wood and crystal.',
  try: ['Walk round the hologram: its rim glows', 'Stand inside the force field', 'Speed time up or freeze it (T)', 'Look closely: the see-through ones dither'],
  spawn: [0, 0, 5],
  facing: Math.PI,
  background: 'ink',
  guide: {
    what: 'Six pedestals, each with an object wearing a shader: hologram, force field, lava, marble, wood, crystal.',
    how: [
      'A TSL material is a graph of nodes (position, normal, time, noise, maths) built in JavaScript and compiled to WGSL for WebGPU or GLSL for the WebGL 2 fallback. The engine never writes shader text.',
      'Procedural textures: marble is a sine wave bent by fractal noise (veins); wood is rings round the trunk\'s axis, wobbled by noise; crystal and the force field are Worley noise (the distance to the nearest of scattered points: cells); lava is fractal noise drifting with time.',
      'Each is cut into a few bands of palette colours (the way the toon light has three steps) so it looks drawn, not airbrushed. Marble, wood and crystal are still toon-lit.',
      'The rim is where the surface turns edge-on to the camera (1 minus the facing, from the view-space normal): holograms and force fields glow there.',
      'See-through without blending: a 4 x 4 ordered dither per art pixel keeps a share of the pixels and drops the rest, more where it should be more opaque. No sorting, sharp pixels, and the outline pass still sees a shape.',
    ],
    uses: [
      'Holograms and shields in nearly every sci-fi game (Halo\'s overshields, Mass Effect\'s barriers); lava and magma everywhere.',
      'Procedural materials in Substance Designer and Blender\'s shader nodes: the same noises, the same graphs.',
    ],
    ask: ['a hologram shader in TSL', 'a force field bubble effect', 'animated lava without a texture', 'procedural marble or wood material', 'see-through without transparency sorting'],
    cost: 'Per pixel: a handful of noise lookups (fractal noise is a few octaves of it) on the GPU. Six objects cost about nothing; covering the screen in lava is still cheap at the art resolution.',
    code: [
      {
        title: 'Marble: a sine wave bent by noise, cut into bands',
        file: 'src/engine/render/shaders.ts',
        src: `const v = sin(p.x.mul(5).add(mx_fractal_noise_float(p.mul(1.8), 4).mul(5))).mul(0.5).add(0.5);`,
      },
      {
        title: 'See-through by dither: keep a share of the pixels',
        file: 'src/engine/render/shaders.ts',
        src: `m.maskNode = bayer4().lessThan(opacity);`,
      },
    ],
    words: ['TSL', 'gradient noise', 'fractal noise', 'dither', 'toon shading'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(26, 18, { floor: ['night', 'ink'], wall: { color: 'plum', side: 'ink' } });
    const t = uniform(0) as any;
    let speed = 1;
    const pieces: { mesh: Mesh; spin: number; name: string }[] = [];
    const show = (x: number, z: number, name: string, geo: ConstructorParameters<typeof Mesh>[0], material: Material, spin = 0.3, y = 1.9) => {
      kit.box([x, 0.5, z], [1.8, 1, 1.8], 'slate', { side: 'night' });
      kit.label([x, 0.4, z + 1.25], name, { color: 'white', range: 8 });
      const mesh = new Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      setLookLayer(mesh, 'actors');
      ctx.scene.add(mesh);
      pieces.push({ mesh, spin, name });
      return mesh;
    };
    show(-8, -3, 'HOLOGRAM', new TorusKnotGeometry(0.55, 0.18, 80, 10), hologramMaterial({ color: PALETTE.cyan, time: t }));
    // the force field: a bubble round a crate, big enough to stand in
    kit.box([-1.5, 0.4, -3], [0.8, 0.8, 0.8], 'orange', { side: 'red' });
    const field = new Mesh(new SphereGeometry(2, 24, 16), forceFieldMaterial({ color: PALETTE.sky, time: t }));
    field.position.set(-1.5, 0.2, -3);
    setLookLayer(field, 'actors');
    ctx.scene.add(field);
    kit.label([-1.5, 0.4, -0.6], 'FORCE FIELD', { color: 'white', range: 8 });
    show(5, -3, 'LAVA', new SphereGeometry(0.85, 20, 14), lavaMaterial({ time: t }), 0.1);
    show(-8, 3, 'MARBLE', new CylinderGeometry(0.45, 0.55, 2.2, 16), marbleMaterial(), 0.15, 2.1);
    show(-1.5, 3.5, 'WOOD', new CylinderGeometry(0.6, 0.6, 1.4, 16), woodMaterial(), 0.2);
    show(5, 3, 'CRYSTAL', new IcosahedronGeometry(0.85, 0), crystalMaterial({ time: t }), 0.25);
    // a plain toon cube for comparison
    show(10, 0, 'PLAIN TOON', new BoxGeometry(1, 1, 1), toonMaterial(PALETTE.lime), 0.4);
    let frozen = false;
    kit.pad([0, 0, 7], { label: 'FREEZE TIME', color: 'sky', note: 'Every shader here animates from one clock (a uniform): stop it and they all hold still.', apply: (_r, pad) => ((frozen = !frozen), kit.lightPad(pad, frozen)) });
    const knobs: Knob[] = [{ id: 'speed', label: 'Time', min: 0, max: 4, step: 0.25, get: () => speed, set: (v) => (speed = v), format: (v) => `${v}x`, initial: 1, hint: 'How fast the shaders\' clock runs: it is just a number sent to the GPU each frame.' }];
    let clock = 0;
    return {
      knobs,
      update(dt) {
        if (!frozen) clock += dt * speed;
        t.value = clock;
        for (const p of pieces) p.mesh.rotation.y = clock * p.spin;
      },
      status: () => `clock ${clock.toFixed(1)} frozen ${frozen}`,
      api: {
        clock: () => clock,
        freeze: (on: boolean) => (frozen = on),
        pieces: () => pieces.map((p) => p.name),
      },
    };
  },
};
