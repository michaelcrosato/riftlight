/**
 * Time of day: a sun that rises in the east, crosses the sky and sets in the west, warm at
 * dawn and dusk, a dim blue moon at night, with the ambient light, the sky colour and the fog
 * colour following. `skyAt(hour)` is pure (keyframes interpolated, unit-tested); `applySky`
 * puts it on an engine (the sun, its direction and shadows, the ambient light, the
 * background). Levels unload back to the engine's defaults.
 *
 *   const s = skyAt(18.5);                 // 0..24
 *   applySky(engine, s);                   // or read s.night to light the lanterns
 */
import { Color, type Node } from 'three/webgpu';
import { fog, max, positionWorld, rangeFogFactor, smoothstep, uniform } from 'three/tsl';
import type { Engine } from '../Engine';

export interface SkyState {
  /** Unit vector toward the sun (or the moon, at night). */
  readonly sunDir: [number, number, number];
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly ambientColor: number;
  readonly ambientIntensity: number;
  /** Background (sky) and fog colour. */
  readonly sky: number;
  /** 0 by day, 1 deep at night: lanterns, stars, windows. */
  readonly night: number;
}

/** The sun's first and last light (the moon has the rest). */
const SUNRISE = 5.6;
const SUNSET = 19;

interface Key {
  hour: number;
  sun: number;
  sunI: number;
  amb: number;
  ambI: number;
  sky: number;
}

/**
 * The day as keyframes (hours, display colours). The light is the sun from 5.6 to 19 and the
 * moon from 19 to 5.6: both hand-overs sit at a dark keyframe, so the shadows never jump.
 */
const KEYS: readonly Key[] = [
  { hour: 0, sun: 0x5d75c4, sunI: 0.5, amb: 0x29366f, ambI: 0.55, sky: 0x10142e },
  { hour: 5, sun: 0x5d75c4, sunI: 0.5, amb: 0x29366f, ambI: 0.55, sky: 0x1a1c2c },
  { hour: SUNRISE, sun: 0x8a5a7f, sunI: 0.06, amb: 0x3b3a7a, ambI: 0.6, sky: 0x333c57 },
  { hour: 6.5, sun: 0xef7d57, sunI: 1.8, amb: 0x8a6a8f, ambI: 0.8, sky: 0xb86f71 },
  { hour: 8.5, sun: 0xffe2b5, sunI: 2.8, amb: 0x94b0c2, ambI: 1.0, sky: 0x73eff7 },
  { hour: 12, sun: 0xfff4e0, sunI: 3.2, amb: 0xa7c6d8, ambI: 1.1, sky: 0x41a6f6 },
  { hour: 16, sun: 0xffe2b5, sunI: 2.8, amb: 0x94b0c2, ambI: 1.0, sky: 0x73eff7 },
  { hour: 18.3, sun: 0xef7d57, sunI: 1.8, amb: 0x8a5a7f, ambI: 0.8, sky: 0xd27d6c },
  { hour: SUNSET, sun: 0x8a5a7f, sunI: 0.06, amb: 0x3b3a7a, ambI: 0.6, sky: 0x333c57 },
  { hour: 19.6, sun: 0x5d75c4, sunI: 0.5, amb: 0x29366f, ambI: 0.55, sky: 0x1a1c2c },
  { hour: 24, sun: 0x5d75c4, sunI: 0.5, amb: 0x29366f, ambI: 0.55, sky: 0x10142e },
];

const ca = new Color();
const cb = new Color();
function mixHex(a: number, b: number, t: number): number {
  return ca.setHex(a).lerp(cb.setHex(b), t).getHex();
}

/** The sky at `hour` (wraps around 24). */
export function skyAt(hour: number): SkyState {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.hour <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = (h - a.hour) / (b.hour - a.hour || 1);
  // the sun's arc: rises in the east (+x), noon high (tilted south, +z), sets in the west; at
  // night the moon makes the same arc
  const isDay = h >= SUNRISE && h <= SUNSET;
  const u = isDay ? (h - SUNRISE) / (SUNSET - SUNRISE) : (((h - SUNSET) % 24) + 24) % 24 / (24 - SUNSET + SUNRISE);
  const angle = u * Math.PI;
  const height = Math.max(0.12, Math.sin(angle) * 0.92);
  const dir: [number, number, number] = [Math.cos(angle), height, 0.35];
  const l = Math.hypot(...dir);
  const night = h < 6 ? Math.min(1, (6 - h) / 1) : h > 18.5 ? Math.min(1, (h - 18.5) / 1.2) : 0;
  return {
    sunDir: [dir[0] / l, dir[1] / l, dir[2] / l],
    sunColor: mixHex(a.sun, b.sun, t),
    sunIntensity: a.sunI + (b.sunI - a.sunI) * t,
    ambientColor: mixHex(a.amb, b.amb, t),
    ambientIntensity: a.ambI + (b.ambI - a.ambI) * t,
    sky: mixHex(a.sky, b.sky, t),
    night,
  };
}

/** Background colours `applySky` made (it never edits one it didn't: that may be the engine's default). */
const owned = new WeakSet<Color>();

/** Put a sky on the engine: sun direction, colour and strength, ambient light, background. */
export function applySky(engine: Pick<Engine, 'sun' | 'ambient' | 'scene' | 'setSunDirection'>, s: SkyState): void {
  engine.setSunDirection(s.sunDir);
  engine.sun.color.setHex(s.sunColor);
  engine.sun.intensity = s.sunIntensity;
  engine.ambient.color.setHex(s.ambientColor);
  engine.ambient.intensity = s.ambientIntensity;
  const bg = engine.scene.background;
  if (bg instanceof Color && owned.has(bg)) bg.setHex(s.sky);
  else {
    const c = new Color(s.sky);
    owned.add(c);
    engine.scene.background = c;
  }
}

/**
 * Fog for `scene.fogNode` with live settings (uniforms: changing them never recompiles):
 * ground mist that thickens below `top` (m) and a haze that grows with distance from the
 * camera, both up to `amount` (0..1), in `color` (match the sky).
 *
 *   const mist = groundFog({ color: s.sky, top: 1.5 });
 *   (scene as { fogNode: unknown }).fogNode = mist.node;
 *   mist.amount.value = 0.8; mist.color.value.setHex(s.sky);
 */
export function groundFog(o: { color?: number; top?: number; amount?: number; near?: number; far?: number } = {}) {
  const color = uniform(new Color(o.color ?? 0x94b0c2));
  const amount = uniform(o.amount ?? 0);
  const top = uniform(o.top ?? 1.5);
  const near = o.near ?? 40;
  const far = o.far ?? 80;
  const mist = smoothstep(top.mul(-0.5), top, positionWorld.y).oneMinus();
  const haze = rangeFogFactor(near, far).mul(0.6);
  const node = fog(color, max(mist, haze).mul(amount)) as unknown as Node;
  return { node, color, amount, top };
}
