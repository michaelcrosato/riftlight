/**
 * Weather & Sky: a little square through a day and a night, in any weather. The sun crosses
 * the sky with its colour and shadows; lamps come on at dusk; rain (and a storm with
 * lightning), snow that settles on the ground, and ground fog, all live.
 */
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, Vector3 } from 'three/webgpu';
import { color, float, floor, fract, hash, positionWorld, screenCoordinate, uniform } from 'three/tsl';
import { applySky, groundFog, type LightHandle, PALETTE, Precipitation, skyAt } from '../../engine';
import type { Knob, RoomDef, Vec3 } from '../types';

const TIMES: { label: string; hour: number }[] = [
  { label: 'DAWN', hour: 6.6 },
  { label: 'NOON', hour: 12 },
  { label: 'DUSK', hour: 18.4 },
  { label: 'NIGHT', hour: 22.5 },
];
type Weather = 'clear' | 'rain' | 'storm' | 'snow';

/** 6.6 → "6:36". */
const clock = (h: number) => {
  const m = Math.round((h % 1) * 60);
  return `${Math.floor(h) + (m === 60 ? 1 : 0)}:${String(m % 60).padStart(2, '0')}`;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
/** A sheet over the ground that shows `amount` of its pixels: snow (speckled by world cell) or wet (by an ordered dither). */
function coverSheet(size: number, hex: number, kind: 'snow' | 'wet') {
  const amount = uniform(0);
  const m = new MeshBasicNodeMaterial();
  m.colorNode = color(hex);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -1;
  if (kind === 'snow') {
    // each 12 cm cell of ground whitens once the cover passes its own random threshold
    // (kept positive: a negative key would turn into the same hash for half the ground)
    const cell = floor(positionWorld.xz.mul(8)).add(4096) as any;
    m.maskNode = hash(cell.x.add(cell.y.mul(1291))).lessThan(amount);
  } else {
    const a = floor(screenCoordinate.xy) as any;
    const b2 = (q: any) => fract(q.x.div(2).add(q.y.mul(q.y).mul(0.75)));
    const bayer = b2(floor(a.mul(0.5))).mul(0.25).add(b2(a)) as any;
    m.maskNode = bayer.lessThan(float(amount).mul(0.4));
  }
  const mesh = new Mesh(new PlaneGeometry(size, size).rotateX(-Math.PI / 2), m);
  mesh.position.y = 0.01;
  return { mesh, amount };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const WEATHER: RoomDef = {
  id: 'weather',
  title: 'Weather & Sky',
  wing: 'effects',
  about:
    'A village square through a whole day: the sun rises in the east, warms at dusk and gives way to a dim blue moon while the lamps come on. Then the weather: rain, a storm with lightning, snow that settles on the ground and melts again, and ground fog.',
  try: ['CYCLE: a day in half a minute', 'STORM at NIGHT', 'SNOW: watch it settle, then CLEAR and it melts', 'FOG at DAWN'],
  spawn: [0, 0, 4],
  facing: Math.PI,
  background: 'sky',
  guide: {
    what: 'A square with houses, lamp posts and a well, pads for the time of day (and a running day), the weather (clear, rain, storm, snow) and fog.',
    how: [
      'The time of day is keyframes: for each hour, the sun\'s colour and strength, the ambient light and the sky colour, blended between hours. The sun follows an arc from east to west; at night the same light is a dim blue moon. The shadow box follows it.',
      'Rain and snow are one instanced draw each: every drop\'s place comes from a hash of its index, its fall from the time, all in the vertex shader. The drops fill a box of air around the camera that wraps in world space, so walking through the weather doesn\'t drag it along.',
      'Intensity is a uniform: a drop whose own random number is above it is parked out of sight. Starting a storm changes one number, no buffers and no shader compiles.',
      'Snow settles: a sheet over the ground shows a growing share of 12 cm cells (each with its own random threshold) while it snows, and fewer as it melts. Wet ground is the same trick with an ordered dither of a dark colour.',
      'Fog is a TSL node on the scene (scene.fogNode): ground mist below a height plus haze with distance, its colour and amount uniforms that follow the sky.',
      'Lightning is a flash on the screen, the sun turned up for a frame or two, a shake and a delayed rumble.',
    ],
    uses: [
      'Day and night cycles: Stardew Valley, Zelda: Breath of the Wild, Minecraft.',
      'Weather that changes the world: snow in Red Dead Redemption 2, rain in Sleeping Dogs, storms in Breath of the Wild.',
      'Ground fog for mood: Silent Hill, Inside, Limbo.',
    ],
    ask: ['a day and night cycle with lamps that turn on at night', 'rain with splashes', 'a thunderstorm with lightning', 'snow that piles up on the ground', 'ground fog'],
    cost: 'Rain and snow: a few thousand tiny boxes in one draw call, placed by the GPU (no CPU work per drop). The sky is a handful of numbers a frame; fog adds a few instructions per pixel.',
    code: [
      {
        title: 'Every drop from a hash of its index, falling with time',
        file: 'src/engine/render/precipitation.ts',
        src: `const s1 = hash(i);
const fall = fract(s3.add(this.uTime.mul(this.uSpeed).mul(s4.mul(0.3).add(0.85)).div(h))) as any;`,
      },
      {
        title: 'The sun\'s arc through the day',
        file: 'src/engine/render/sky.ts',
        src: `const angle = u * Math.PI;
const height = Math.max(0.12, Math.sin(angle) * 0.92);`,
      },
    ],
    words: ['day cycle', 'instancing', 'uniform', 'TSL', 'fog', 'dither', 'flash', 'shadow map'],
  },
  build(room) {
    const { kit, ctx } = room;
    const e = ctx.engine;
    kit.room(28, 24, { floor: ['mist', 'white'], wall: { color: 'slate', side: 'night' } });
    // houses round the square
    const house = (at: Vec3, w: number, d: number, wall: 'sand' | 'orange' | 'white', roof: 'red' | 'plum' | 'blue') => {
      kit.box([at[0], 1.3, at[2]], [w, 2.6, d], wall, { side: wall });
      kit.box([at[0], 2.9, at[2]], [w + 0.4, 0.6, d + 0.4], roof, { side: 'night' });
      kit.box([at[0], 2.5, at[2] + d / 2 + 0.01], [0.9, 0.7, 0.05], 'night', { ghost: true });
    };
    house([-8, 0, -7], 5, 4, 'sand', 'red');
    house([0, 0, -8], 4.5, 3.5, 'white', 'blue');
    house([8, 0, -7], 5, 4, 'orange', 'plum');
    kit.cylinder([0, 0.45, -2], 1, 0.9, 'slate');
    kit.label([0, 1.5, -2], 'THE WELL', { color: 'mist', range: 6, small: true });
    // lamp posts: lit by night
    const lamps: LightHandle[] = [];
    for (const [x, z] of [[-5, -3], [5, -3], [-5, 6], [5, 6]] as const) {
      kit.cylinder([x, 1.4, z], 0.08, 2.8, 'night');
      kit.box([x, 2.95, z], [0.35, 0.35, 0.35], 'sand', { ghost: true });
      lamps.push(kit.light({ position: [x, 2.9, z], color: PALETTE.sand, intensity: 0, radius: 7, flicker: 'candle' }));
    }
    const snow = coverSheet(26, PALETTE.white, 'snow');
    const wet = coverSheet(26, PALETTE.navy, 'wet');
    ctx.scene.add(snow.mesh, wet.mesh);
    const rain = new Precipitation({ kind: 'rain', count: 3500, area: [26, 14, 26] });
    const flakes = new Precipitation({ kind: 'snow', count: 3500, area: [26, 12, 26] });
    rain.intensity = flakes.intensity = 0;
    ctx.scene.add(rain, flakes);
    const mist = groundFog({ top: 1.4, near: 40, far: 75 });
    (ctx.scene as unknown as { fogNode: unknown }).fogNode = mist.node;
    ctx.particles.register('splash', { count: [3, 4], life: [0.2, 0.35], speed: [1.2, 2], spread: 30, gravity: 12, drag: 1, size: [1, 1], colors: ['white', 'sky'], radius: 0.05 });

    let hour = 12;
    let cycle = false;
    let weather: Weather = 'clear';
    let fogOn = false;
    let wind = 1.5;
    let flash = 0;
    let nextBolt = 3;
    let thunder = -1;
    let bolts = 0;
    const applyTime = () => {
      const s = skyAt(hour);
      applySky(e, s);
      if (flash > 0) e.sun.intensity += 6 * flash;
      for (const l of lamps) l.update({ intensity: 7 * s.night });
      mist.color.value.setHex(s.sky);
    };
    const setWeather = (w: Weather) => {
      weather = w;
      rain.intensity = w === 'rain' ? 0.6 : w === 'storm' ? 1 : 0;
      flakes.intensity = w === 'snow' ? 1 : 0;
      rain.speed = w === 'storm' ? 22 : 16;
    };
    TIMES.forEach((t) => kit.pad([-6 + TIMES.indexOf(t) * 2.2, 0, 8.5], { label: t.label, color: 'sand', group: 'time', initial: t.hour === 12, note: `${clock(t.hour)}: the sun's direction, colour and strength, the ambient light and the sky, blended from keyframes.`, apply: () => ((hour = t.hour), (cycle = false)) }));
    kit.pad([3, 0, 8.5], { label: 'CYCLE', color: 'orange', group: 'time', note: 'A day in about 30 seconds: one hour every 1.25 s.', apply: () => (cycle = true) });
    (['clear', 'rain', 'storm', 'snow'] as const).forEach((w, i) =>
      kit.pad([-6 + i * 2.2, 0, 10.6], { label: w.toUpperCase(), color: w === 'snow' ? 'white' : w === 'clear' ? 'sky' : 'blue', group: 'weather', initial: w === 'clear', note: w === 'clear' ? 'Clear skies: the snow melts and the ground dries.' : w === 'storm' ? 'Heavy rain, wind and lightning.' : w === 'rain' ? 'Rain: 3500 drops in one instanced draw, falling in the vertex shader.' : 'Snow: flakes drift and sway; the ground whitens cell by cell.', apply: () => setWeather(w) }),
    );
    kit.pad([3, 0, 10.6], {
      label: 'FOG',
      color: 'mist',
      note: 'Ground mist and distance haze in the sky\'s colour (scene.fogNode).',
      apply: (_r, p) => {
        fogOn = !fogOn;
        kit.lightPad(p, fogOn);
      },
    });
    applyTime();

    const knobs: Knob[] = [
      { id: 'hour', label: 'Time of day', min: 0, max: 24, step: 0.25, get: () => hour, set: (v) => ((hour = v), (cycle = false), applyTime()), format: clock, initial: 12 },
      { id: 'wind', label: 'Wind', min: -8, max: 8, step: 0.5, get: () => wind, set: (v) => (wind = v), format: (v) => `${v} m/s`, initial: 1.5 },
      { id: 'drops', label: 'Rain / snow amount', min: 0, max: 1, step: 0.05, get: () => Math.max(rain.intensity, flakes.intensity), set: (v) => (weather === 'snow' ? (flakes.intensity = v) : (rain.intensity = v)), initial: 0 },
    ];
    const splashAt = new Vector3();
    let rnd = 11;
    const rand = () => (rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0) / 4294967296;
    return {
      knobs,
      update(dt) {
        if (cycle) hour = (hour + dt * 0.8) % 24;
        // lightning in a storm: a flash now, the rumble a moment later
        if (weather === 'storm') {
          nextBolt -= dt;
          if (nextBolt <= 0) {
            nextBolt = 2.5 + rand() * 4;
            flash = 1;
            bolts++;
            e.screen.flash(0xf4f4f4, { duration: 0.12, strength: 0.7 });
            thunder = 0.4 + rand() * 0.8;
          }
        }
        if (thunder > 0 && (thunder -= dt) <= 0) {
          ctx.audio.play('groundPound', { pitch: -12 });
          e.shake.add(0.25);
        }
        flash = Math.max(0, flash - dt * 8);
        applyTime();
        const w = weather === 'storm' ? wind * 2.5 : wind;
        rain.wind.set(w, w * 0.3);
        flakes.wind.set(w * 0.6, w * 0.2);
        rain.update(dt, ctx.camera.focus);
        flakes.update(dt, ctx.camera.focus);
        // snow settles while it snows and melts otherwise; rain wets the ground and it dries
        snow.amount.value = Math.min(0.85, Math.max(0, (snow.amount.value as number) + dt * (flakes.intensity > 0 ? 0.05 * flakes.intensity : -0.08)));
        wet.amount.value = Math.min(1, Math.max(0, (wet.amount.value as number) + dt * (rain.intensity > 0 ? 0.3 : -0.06)));
        mist.amount.value = Math.max(0, Math.min(0.85, (mist.amount.value as number) + dt * (fogOn ? 0.6 : -0.6)));
        // splashes where rain lands near the camera (a few: one per ~20 drops)
        if (rain.intensity > 0) {
          const n = rain.splashes(dt) / 20;
          for (let i = 0; i < Math.floor(n + rand()); i++) {
            splashAt.set(ctx.camera.focus.x + (rand() - 0.5) * 18, 0.02, ctx.camera.focus.z + (rand() - 0.5) * 18);
            ctx.particles.burst('splash', splashAt);
          }
        }
      },
      dispose() {
        (ctx.scene as unknown as { fogNode: unknown }).fogNode = null;
      },
      status: () => `${hour.toFixed(1)}h ${weather} snow ${(snow.amount.value as number).toFixed(2)} bolts ${bolts}`,
      api: {
        time: (h: number) => ((hour = h), (cycle = false), applyTime()),
        weather: (w: Weather) => setWeather(w),
        fog: (on: boolean) => (fogOn = on),
        state: () => ({ hour, weather, snow: snow.amount.value as number, wet: wet.amount.value as number, fog: mist.amount.value as number, lamps: lamps.map((l) => l.intensity), sun: e.sun.intensity, bolts }),
      },
    };
  },
};
