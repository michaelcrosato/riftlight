/**
 * Effects wing (first rooms): Lights & Shadows, the Particle Garden.
 */
import { Color, Mesh, SphereGeometry, Vector3 } from 'three/webgpu';
import { FLICKER_PRESETS, type FlickerPreset, type LightHandle, PALETTE, PARTICLES, type ParticlePreset, setLookLayer } from '../../engine';
import type { RoomDef } from '../types';

const SUN: Record<string, { dir: [number, number, number]; color: number; sun: number; ambient: number; ambientColor: number; sky: number; note: string }> = {
  DAWN: { dir: [1, 0.25, 0.3], color: PALETTE.orange, sun: 1.8, ambient: 0.9, ambientColor: PALETTE.plum, sky: PALETTE.plum, note: 'Low in the east, orange: long shadows reaching west.' },
  NOON: { dir: [-0.55, 1, 0.35], color: PALETTE.white, sun: 3.2, ambient: 1.1, ambientColor: PALETTE.mist, sky: PALETTE.sky, note: 'The engine default: high and white, short shadows.' },
  DUSK: { dir: [-1, 0.22, -0.4], color: PALETTE.red, sun: 1.6, ambient: 0.8, ambientColor: PALETTE.navy, sky: PALETTE.orange, note: 'Low in the west, red: the lamps start to matter.' },
  NIGHT: { dir: [0.3, 1, -0.6], color: PALETTE.sky, sun: 0.35, ambient: 0.7, ambientColor: PALETTE.navy, sky: PALETTE.ink, note: 'Moonlight: a dim blue sun. Only the light pool lights the room.' },
};

export const LIGHTS: RoomDef = {
  id: 'lights',
  title: 'Lights & Shadows',
  wing: 'effects',
  about:
    'Torches, candles, braziers and spells, a lantern that circles a pillar, three coloured lights mixing on a white plate, and a swarm of fireflies: dozens of light requests sharing a fixed pool of real lights. Sun dial pads move the sun and its hard shadows.',
  try: ['NIGHT, then walk the flicker row: each lamp has its own rhythm', 'FIREFLIES: 40 lights, only the nearest get a real light, and they hand over without popping', 'DAWN, NOON, DUSK: the shadow box follows the sun'],
  spawn: [0, 0, 7],
  facing: Math.PI,
  background: 'ink',
  guide: {
    what: 'A room lit like a night scene: six lamps with the six flicker presets, an RGB plate, a lantern on a moving path, pillars and crates that cast shadows, and pads for the sun, shadow quality and a swarm of 40 fireflies.',
    how: [
      'Every light a toon material sees is compiled into its shader: adding a light would recompile every lit material. So the engine keeps a fixed pool of real point lights (4, 8 or 16 by quality) and lends them each frame to the most important "light requests".',
      'A request scores intensity x priority x closeness to the camera focus. The top ones get a light; a request that already has one scores 35% more (hysteresis) so two equal torches never trade a light back and forth.',
      'A light changes hands only after its old owner has faded out (0.2 s) and the new one fades in (0.25 s): no pops. Flicker presets (sums of sines and noise) only change the intensity uniform.',
      'The sun is one directional light with a hard shadow map. Its shadow box follows the camera and covers what is on screen, moving in whole shadow texels so edges never crawl; a slope-scaled bias keeps surfaces free of acne.',
      'engine.setSunDirection(dir) points the sun; its colour and intensity are plain light properties. The next room starts from the engine default again.',
    ],
    uses: [
      'Light pools / clustered lighting: Diablo III and Hades have hundreds of light sources but only a handful of real lights near the camera.',
      'Flicker: every torch in a dungeon crawler; the strobe and pulse of alarms and spells.',
      'Hard pixel shadows: Eastward, Octopath Traveler, Sea of Stars.',
    ],
    ask: ['torches that flicker without recompiling shaders', 'fireflies that are real lights', 'a day and night cycle that moves the sun', 'hard pixel-art shadows'],
    cost: 'CPU: one pass over the requests a frame (about 0.05 ms for 60). GPU: every lit pixel loops over the pool, so cost grows with the pool size, not with the number of requests. The sun\'s shadow map is 256 to 1024 square by quality.',
    code: [
      {
        title: 'Ask for a light; the pool decides who gets one',
        file: 'src/engine/render/lights.ts',
        src: `const torch = ctx.lights.request({ position: [3, 1.6, 4], color: 0xffa040, intensity: 6, radius: 7, flicker: 'torch' });
torch.update({ intensity: 9 });          // or torch.position.set(...)
torch.release();                          // fades out, frees its light`,
      },
      {
        title: 'Shadows that do not crawl',
        file: 'src/engine/Engine.ts',
        src: `const texel = (2 * radius) / this.sun.shadow.mapSize.x;
const r = snapToGrid(center.dot(this.sunRight), texel);
const u = snapToGrid(center.dot(this.sunUp), texel);`,
      },
    ],
    words: ['point light', 'light pool', 'hysteresis', 'flicker', 'shadow map', 'texel snapping', 'uniform'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(26, 22, { floor: ['slate', 'night'], wall: { color: 'night', side: 'ink' } });
    const setSun = (k: keyof typeof SUN) => {
      const s = SUN[k]!;
      e.setSunDirection(s.dir);
      e.sun.color.setHex(s.color);
      e.sun.intensity = s.sun;
      e.ambient.color.setHex(s.ambientColor);
      e.ambient.intensity = s.ambient;
      ctx.scene.background = new Color(s.sky);
    };
    setSun('NIGHT');
    // the flicker row along the back wall
    const flickers = FLICKER_PRESETS.filter((f) => f !== 'none');
    const colors: Partial<Record<FlickerPreset, number>> = { torch: PALETTE.orange, candle: PALETTE.sand, brazier: PALETTE.red, pulse: PALETTE.cyan, strobe: PALETTE.white, spell: PALETTE.plum };
    flickers.forEach((f, i) => {
      const x = -10 + i * 4;
      kit.cylinder([x, 0.9, -8.5], 0.12, 1.8, 'night', { segments: 6 });
      kit.box([x, 1.95, -8.5], [0.35, 0.3, 0.35], f === 'spell' ? 'plum' : 'sand', { ghost: true, castShadow: false });
      kit.light({ position: [x, 2.3, -8.3], color: colors[f] ?? PALETTE.white, intensity: 7, radius: 6, flicker: f, name: f });
      kit.label([x, 2.9, -8.5], f.toUpperCase(), { color: 'sand', range: 8 });
    });
    // RGB plate
    kit.box([7, 0.05, 2], [5, 0.1, 5], 'white', { side: 'mist' });
    const rgb: [number, number][] = [
      [PALETTE.red, -1],
      [PALETTE.green, 0],
      [PALETTE.blue, 1],
    ];
    rgb.forEach(([c, k]) => kit.light({ position: [7 + k * 1.2, 1.6, 2 + (k === 0 ? -1 : 0.6)], color: c, intensity: 9, radius: 4.5, priority: 2 }));
    kit.label([7, 1.5, 4.8], 'RGB MIXING', { color: 'white', range: 8 });
    // pillars and crates for shadows
    for (const [x, z] of [[-5, -2], [-2, -4], [1, -2]] as const) kit.cylinder([x, 1.5, z], 0.45, 3, 'mist', { segments: 10 });
    for (const [x, z] of [[-7, 1], [-6, 2.5], [3, 0]] as const) kit.crate([x, 0.5, z], { tags: ['pushable'] });
    // the lantern on its path
    const lantern = new Mesh(new SphereGeometry(0.22, 10, 8), kit.glow('sand'));
    setLookLayer(lantern, 'actors');
    ctx.scene.add(lantern);
    kit.cylinder([-2, 1.5, 3], 0.5, 3, 'slate', { segments: 10 });
    kit.light({ follow: lantern, color: PALETTE.sand, intensity: 8, radius: 7, priority: 3, name: 'lantern' });
    // pads: the sun, quality and fireflies
    (Object.keys(SUN) as (keyof typeof SUN)[]).forEach((k, i) =>
      kit.pad([-9 + i * 2.6, 0, 6.5], { label: k, color: 'orange', group: 'sun', initial: k === 'NIGHT', note: SUN[k]!.note, apply: () => setSun(k) }),
    );
    (['low', 'medium', 'high'] as const).forEach((q, i) =>
      kit.pad([2 + i * 2.6, 0, 7.5], {
        label: `${q} quality`,
        color: 'teal',
        group: 'quality',
        initial: q === e.quality,
        note: `engine.setQuality('${q}'): a ${q === 'low' ? 256 : q === 'medium' ? 512 : 1024} square shadow map and a pool of ${q === 'low' ? 4 : q === 'medium' ? 8 : 16} real lights.`,
        apply: () => e.setQuality(q),
      }),
    );
    let flies: { h: LightHandle; seed: number }[] = [];
    kit.pad([-9 + 4 * 2.6, 0, 6.5], {
      label: 'FIREFLIES',
      color: 'lime',
      note: '40 more light requests drifting around: the pool lends its real lights to the nearest ones; watch them hand over as you walk.',
      apply: (_r, pad) => {
        if (flies.length) {
          for (const f of flies) f.h.release();
          flies = [];
          kit.lightPad(pad, false);
          return;
        }
        kit.lightPad(pad, true);
        for (let i = 0; i < 40; i++) flies.push({ h: ctx.lights.request({ position: [0, 1.5, 0], color: i % 3 ? PALETTE.lime : PALETTE.cyan, intensity: 3, radius: 3, priority: 0.6, name: `fly${i}` }), seed: i * 1.37 });
      },
    });
    let t = 0;
    let speed = 1;
    return {
      knobs: [
        { id: 'sunIntensity', label: 'Sun', min: 0, max: 5, step: 0.1, get: () => e.sun.intensity, set: (v) => (e.sun.intensity = v) },
        { id: 'ambient', label: 'Ambient', min: 0, max: 3, step: 0.1, get: () => e.ambient.intensity, set: (v) => (e.ambient.intensity = v) },
        { id: 'lantern', label: 'Lantern speed', min: 0, max: 3, step: 0.1, get: () => speed, set: (v) => (speed = v), initial: 1 },
      ],
      update(dt) {
        t += dt * speed;
        lantern.position.set(-2 + Math.cos(t) * 2.4, 1.2 + Math.sin(t * 2) * 0.3, 3 + Math.sin(t) * 2.4);
        for (const f of flies) {
          const a = ctx.time * 0.4 + f.seed;
          f.h.position.set(Math.sin(a * 1.3) * 10, 0.8 + Math.sin(a * 2.1) * 0.6, Math.cos(a * 0.9) * 7 - 1);
        }
      },
      draw() {
        const s = ctx.lights.stats();
        ctx.hud.text(4, 18, `LIGHT POOL ${s.lit}/${s.size} LIT · ${s.requests} REQUESTS`, { anchor: 'bottom-left', color: 'sand' });
      },
      status: () => JSON.stringify(ctx.lights.stats()),
      api: { stats: () => ctx.lights.stats(), sun: () => e.sunDir.toArray() },
    };
  },
};

/** Extra particle effects the garden registers (data, like the built-in ones). */
const GARDEN: Record<string, ParticlePreset> = {
  confetti: { count: [24, 32], life: [0.8, 1.4], speed: [3, 5], direction: [0, 1, 0], spread: 35, gravity: 6, drag: 1.2, size: [2, 2], colors: ['red', 'sand', 'lime', 'sky', 'plum'] },
  fire: { count: [10, 14], life: [0.35, 0.7], speed: [0.8, 1.6], direction: [0, 1, 0], spread: 18, gravity: -2.5, drag: 1, size: [3, 1], colors: ['sand', 'orange', 'red', 'plum'], radius: 0.18 },
  snow: { count: [14, 20], life: [1.6, 2.4], speed: [0.1, 0.4], spread: 180, gravity: 0.6, drag: 0.6, size: [1, 1], colors: ['white', 'mist'], radius: 1.2 },
  bubbles: { count: [6, 9], life: [0.8, 1.4], speed: [0.4, 0.9], direction: [0, 1, 0], spread: 25, gravity: -1.5, drag: 0.8, size: [2, 2], colors: ['cyan', 'sky', 'white'], radius: 0.25 },
  embers: { count: [8, 12], life: [0.8, 1.6], speed: [0.6, 1.4], direction: [0, 1, 0], spread: 40, gravity: -0.8, drag: 0.5, size: [1, 1], colors: ['sand', 'orange', 'red'], radius: 0.3 },
  sparks: { count: [16, 22], life: [0.25, 0.5], speed: [4, 7], direction: [0, 1, 0], spread: 70, gravity: 14, drag: 0.4, size: [1, 1], colors: ['white', 'sand', 'orange'] },
};

export const PARTICLE_GARDEN: RoomDef = {
  id: 'particles',
  title: 'Particle Garden',
  wing: 'effects',
  about: 'Every particle effect on its own plinth, bursting every second: the five built in (dust, skid, sparkle, smoke, impact) and six the room registers as plain data (confetti, fire, snow, bubbles, embers, sparks). Step on a plinth\'s pad for a big burst.',
  try: ['FIRE and EMBERS together over the brazier', 'Change the burst size with T and watch the pixels stay whole art pixels', 'Ground pound next to a plinth: the playground\'s own dust and impact'],
  spawn: [0, 0, 6],
  facing: Math.PI,
  background: 'night',
  guide: {
    what: 'Eleven plinths in two rows, each bursting one particle effect every second, with a pad in front for a burst three times as big.',
    how: [
      'An effect is data: how many particles, their life, speed, direction and spread, gravity, drag, size in art pixels and a list of palette colours.',
      'Each effect is one pool simulated on the CPU (position, velocity, age per particle) in plain arrays, so a burst allocates nothing.',
      'All live particles of an effect draw as one instanced sprite draw call: a reused instance buffer holds their positions, sizes and colours.',
      'Sizes are whole art pixels, converted with the camera\'s world size of one art pixel at its focus, so a 2-pixel spark is 2 art pixels at any zoom.',
      'Colours step through the palette list over a particle\'s life (white, then sand, then orange...) and never blend: no in-between colours that are not in the palette.',
    ],
    uses: ['Dust on landing and skids: every platformer since Mario 64.', 'Hit sparks and impacts: Hades, Dead Cells.', 'Weather and ambience: snow, embers, fireflies (Stardew Valley, Celeste).'],
    ask: ['a confetti burst when the player wins', 'fire and embers over a brazier', 'pixel particles that stay crisp at any zoom', 'register a new particle effect as data'],
    cost: 'CPU: a loop over live particles per effect per frame (a few thousand is fine). GPU: one draw call per effect, however many particles.',
    code: [
      {
        title: 'An effect is data',
        file: 'src/world/rooms/effects.ts',
        src: `fire: { count: [10, 14], life: [0.35, 0.7], speed: [0.8, 1.6],
  direction: [0, 1, 0], spread: 18, gravity: -2.5, drag: 1,
  size: [3, 1], colors: ['sand', 'orange', 'red', 'plum'] },`,
      },
      {
        title: 'Register and burst',
        file: 'src/world/rooms/effects.ts',
        src: `for (const [name, preset] of Object.entries(GARDEN)) ctx.particles.register(name, preset);
...
ctx.particles.burst(name, at, { scale: size * (k > 1 ? 1.5 : 1), count, direction: name === 'skid' ? [1, 0.6, 0] : undefined });`,
      },
    ],
    words: ['particle', 'instancing', 'draw call', 'art pixel', 'palette'],
  },
  build(room) {
    const { kit, ctx } = room;
    kit.room(26, 18, { floor: ['green', 'teal'] });
    for (const [name, preset] of Object.entries(GARDEN)) ctx.particles.register(name, preset);
    const names = [...Object.keys(PARTICLES), ...Object.keys(GARDEN)];
    let size = 1;
    let rate = 1;
    const spots = names.map((name, i) => {
      const row = i < 6 ? 0 : 1;
      const col = row === 0 ? i : i - 6;
      const x = -10 + col * 4 + row * 2;
      const z = -5 + row * 6;
      kit.cylinder([x, 0.5, z], 0.7, 1, row ? 'slate' : 'mist', { segments: 10 });
      kit.label([x, 2.4, z], name.toUpperCase(), { color: 'sand', range: 10 });
      kit.pad([x, 0, z + 2.2], { label: `BIG ${name}`, color: 'orange', note: `particles.burst('${name}', at, { scale: 1.5, count: 3x }).`, apply: () => burst(name, new Vector3(x, 1.1, z), 3) }, [1.8, 1.2]);
      return { name, at: new Vector3(x, 1.1, z), t: i * 0.09 };
    });
    const burst = (name: string, at: Vector3, k = 1) => {
      const p = (PARTICLES as Record<string, ParticlePreset>)[name] ?? GARDEN[name]!;
      const c = p.count;
      const count = Math.round((typeof c === 'number' ? c : (c[0] + c[1]) / 2) * k);
      ctx.particles.burst(name, at, { scale: size * (k > 1 ? 1.5 : 1), count, direction: name === 'skid' ? [1, 0.6, 0] : undefined });
    };
    kit.light({ position: [0, 4, 0], color: PALETTE.sand, intensity: 6, radius: 14, flicker: 'none' });
    return {
      knobs: [
        { id: 'size', label: 'Particle size', min: 0.5, max: 3, step: 0.25, get: () => size, set: (v) => (size = v), format: (v) => `${v}x`, initial: 1 },
        { id: 'rate', label: 'Bursts / second', min: 0.25, max: 4, step: 0.25, get: () => rate, set: (v) => (rate = v), initial: 1 },
      ],
      update(dt) {
        for (const s of spots) {
          s.t += dt * rate;
          if (s.t >= 1) {
            s.t -= 1;
            burst(s.name, s.at);
          }
        }
      },
      draw() {
        ctx.hud.text(4, 18, `PARTICLES ALIVE ${ctx.particles.alive}`, { anchor: 'bottom-left', color: 'sand' });
      },
      status: () => `alive ${ctx.particles.alive}`,
      api: { alive: () => ctx.particles.alive, burst: (name: string) => burst(name, new Vector3(0, 1, 0), 2) },
    };
  },
};
