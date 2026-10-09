/**
 * Materials written as TSL node graphs: shaders computed per pixel from position, normal and
 * time, no textures. Holograms and force fields are see-through by ordered dither (no
 * blending, no sorting: pixel art friendly); lava, marble, wood and crystal are procedural
 * textures from noise, banded into a few palette colours like the toon light.
 *
 *   mesh.material = hologramMaterial({ color: PALETTE.cyan });
 *   mesh.material = lavaMaterial({ time: myClock });   // any float node; default three's `time`
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are dynamically typed */
import { MeshBasicNodeMaterial, type MeshToonNodeMaterial } from 'three/webgpu';
import {
  abs,
  color,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  normalView,
  positionLocal,
  positionWorld,
  screenCoordinate,
  sin,
  smoothstep,
  step,
  time as clock,
  vec3,
} from 'three/tsl';
import { snappedClipPosition, toonMaterial } from './toon';

export interface ShaderOptions {
  color?: number;
  /** The clock it animates by (a float node). Default three's `time`, in seconds. */
  time?: any;
}

/** A 4 x 4 ordered dither threshold per art pixel (0..1): keep a pixel where it is below its opacity. */
export function bayer4(): any {
  const a = floor(screenCoordinate.xy) as any;
  const b2 = (q: any) => fract(q.x.div(2).add(q.y.mul(q.y).mul(0.75)));
  return b2(floor(a.mul(0.5))).mul(0.25).add(b2(a));
}

/** Unlit, pixel-snapped, see-through where `opacity` (a node, 0..1) says, by dither. */
function seeThrough(colorNode: any, opacity: any): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.vertexNode = snappedClipPosition();
  m.colorNode = colorNode;
  m.maskNode = bayer4().lessThan(opacity);
  return m;
}

/** How edge-on the surface is to the camera (0 facing it, 1 at the rim). */
const rim = (): any => float(1).sub(abs(dot(normalView, vec3(0, 0, 1))));

/** Three bands of a value (0..1), like the toon light: pixel-art steps, not gradients. */
const bands = (v: any, n = 3): any => floor(v.clamp(0, 0.999).mul(n)).div(n - 1);

/**
 * A hologram: scanlines climbing the object, a bright rim where it turns away from you, a
 * flicker; the middle mostly see-through.
 */
export function hologramMaterial(o: ShaderOptions = {}): MeshBasicNodeMaterial {
  const t = o.time ?? clock;
  const c = color(o.color ?? 0x73eff7);
  const lines = step(0.55, fract(positionWorld.y.mul(9).sub(t.mul(1.5))));
  const edge = rim().pow(2);
  const flicker = sin(t.mul(37)).mul(0.04).add(sin(t.mul(3.1)).mul(0.04)).add(0.92);
  const opacity = edge.mul(0.9).add(lines.mul(0.35)).add(0.12).mul(flicker);
  return seeThrough(mix(c, color(0xf4f4f4), edge.mul(0.6)), opacity);
}

/**
 * A force field: a bubble of hexagonal-looking cells (Worley noise) that drift, brightest at
 * the rim and where cells meet, a pulse running up it.
 */
export function forceFieldMaterial(o: ShaderOptions = {}): MeshBasicNodeMaterial {
  const t = o.time ?? clock;
  const c = color(o.color ?? 0x41a6f6);
  const cells = mx_worley_noise_float(positionLocal.mul(3).add(vec3(0, t.mul(0.25), 0)));
  const seams = smoothstep(0.3, 0.5, cells); // Worley distance is 0 at a cell's centre, largest where cells meet
  const pulse = smoothstep(0.85, 1, sin(positionWorld.y.mul(3).sub(t.mul(2.5))).mul(0.5).add(0.5));
  const edge = rim().pow(3);
  const opacity = edge.add(seams.mul(0.3)).add(pulse.mul(0.35)).add(0.05);
  return seeThrough(mix(c, color(0xf4f4f4), edge.add(pulse).min(1).mul(0.5)), opacity);
}

/** Lava: slow churning fractal noise, banded dark crust to white-hot, unlit (it glows). */
export function lavaMaterial(o: ShaderOptions = {}): MeshBasicNodeMaterial {
  const t = o.time ?? clock;
  const n = mx_fractal_noise_float(positionLocal.mul(1.6).add(vec3(t.mul(0.07), t.mul(0.21), 0)), 4).mul(0.5).add(0.5);
  const v = bands(n.pow(1.4), 4);
  const m = new MeshBasicNodeMaterial();
  m.vertexNode = snappedClipPosition();
  m.colorNode = mix(mix(color(0x1a1c2c), color(0xb13e53), v.mul(3).min(1)), mix(color(0xef7d57), color(0xffcd75), v.mul(3).sub(2).max(0)), step(0.5, v));
  return m;
}

/** A toon-lit material whose colour is a node (a clone of the cached toon material, so it is its own). */
function toonWith(colorNode: any): MeshToonNodeMaterial {
  const m = toonMaterial(0xffffff).clone();
  m.userData.shared = false; // a clone, not the cached material: freed with the level
  m.colorNode = colorNode;
  return m;
}

/** Marble: veins (a sine bent by fractal noise) in three bands of white and grey, toon-lit. */
export function marbleMaterial(o: ShaderOptions = {}): MeshToonNodeMaterial {
  const p = positionLocal;
  const v = sin(p.x.mul(5).add(mx_fractal_noise_float(p.mul(1.8), 4).mul(5))).mul(0.5).add(0.5);
  return toonWith(mix(color(o.color ?? 0xf4f4f4), color(0x566c86), bands(v.pow(3))));
}

/** Wood: rings round the y axis, wobbled by noise, light and dark grain, toon-lit. */
export function woodMaterial(o: ShaderOptions = {}): MeshToonNodeMaterial {
  const p = positionLocal;
  const rings = fract(length(p.xz).mul(9).add(mx_fractal_noise_float(p.mul(vec3(1, 4, 1)), 3).mul(1.2)));
  return toonWith(mix(color(o.color ?? 0xef7d57), color(0xb13e53), step(0.6, rings)));
}

/** Crystal: Worley cells with bright seams, slowly shifting, toon-lit. */
export function crystalMaterial(o: ShaderOptions = {}): MeshToonNodeMaterial {
  const t = o.time ?? clock;
  const cells = mx_worley_noise_float(positionLocal.mul(2.2).add(vec3(0, t.mul(0.1), 0)));
  const seam = step(0.45, cells); // where cells meet
  return toonWith(mix(mix(color(o.color ?? 0x5d275d), color(0x41a6f6), bands(cells)), color(0x73eff7), seam));
}
