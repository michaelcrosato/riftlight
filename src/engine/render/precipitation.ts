/**
 * Rain and snow: thousands of drops or flakes in one instanced draw, placed entirely by the
 * vertex shader. Each drop's start comes from a hash of its instance index; it falls through a
 * box of air around a centre (the camera's focus) whose x and z wrap in world space, so walking
 * through the weather doesn't drag the drops sideways (the box's height follows the centre). Rain falls fast and slants with the wind; snow
 * drifts and sways. `intensity` (0..1) shows that share of the drops: no buffers change, no
 * shader recompiles. Splashes are left to the game (`splashes(dt)` says how many this frame).
 *
 *   const rain = new Precipitation({ kind: 'rain', count: 3000, area: [24, 14, 24] });
 *   scene.add(rain);
 *   // per frame: rain.update(dt, camera.focus); rain.intensity = 0.7; rain.wind.set(3, 0)
 */
import { BoxGeometry, InstancedMesh, MeshBasicNodeMaterial, Vector2, Vector3 } from 'three/webgpu';
import { color, float, fract, hash, instanceIndex, mod, positionLocal, sin, uniform, vec3 } from 'three/tsl';

export type PrecipitationKind = 'rain' | 'snow';

export interface PrecipitationOptions {
  kind: PrecipitationKind;
  /** Most drops at once (the instance count). */
  count: number;
  /** Width, height and depth of the air the drops fall through, around the centre. */
  area?: readonly [number, number, number];
  /** Drop colour (hex). */
  color?: number;
  /** Fall speed (m/s). Rain 16, snow 1.4. */
  speed?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
export class Precipitation extends InstancedMesh {
  readonly kind: PrecipitationKind;
  readonly area: readonly [number, number, number];
  /** Wind (m/s along x and z): rain slants, snow drifts. */
  readonly wind = new Vector2(0, 0);
  private readonly uTime: any = uniform(0);
  private readonly uCenter = uniform(new Vector3());
  private readonly uWind = uniform(new Vector2());
  private readonly uIntensity = uniform(1);
  private readonly uSpeed: any;
  private t = 0;

  constructor(o: PrecipitationOptions) {
    const rain = o.kind === 'rain';
    const geometry = rain ? new BoxGeometry(0.035, 0.55, 0.035) : new BoxGeometry(0.08, 0.08, 0.08); // flakes: tiny cubes read from any side
    const material = new MeshBasicNodeMaterial();
    super(geometry, material, o.count);
    this.kind = o.kind;
    this.area = o.area ?? [24, 14, 24];
    this.frustumCulled = false;
    this.castShadow = false;
    this.uSpeed = uniform(o.speed ?? (rain ? 16 : 1.4));
    const [w, h, d] = this.area;
    const i = float(instanceIndex);
    const s1 = hash(i);
    const s2 = hash(i.add(7919));
    const s3 = hash(i.add(104729));
    const s4 = hash(i.add(1299709)) as any;
    // how far through its fall this drop is (each its own phase and a little speed jitter)
    const fall = fract(s3.add(this.uTime.mul(this.uSpeed).mul(s4.mul(0.3).add(0.85)).div(h))) as any;
    const y = float(h).mul(float(1).sub(fall)).sub(h * 0.25);
    // drifting: rain slants with the wind, snow also sways
    const age = fall.mul(h).div(this.uSpeed) as any;
    let dx: any = (this.uWind as any).x.mul(age);
    let dz: any = (this.uWind as any).y.mul(age);
    if (!rain) {
      dx = dx.add(sin(this.uTime.mul(1.3).add(s1.mul(40))).mul(0.35));
      dz = dz.add(sin(this.uTime.mul(1.1).add(s2.mul(40))).mul(0.35));
    }
    // a fixed spot in world space, wrapped into the box around the centre
    const c = this.uCenter as any;
    const wrap = (start: any, offset: any, centre: any, size: number) => mod(start.mul(size).add(offset).sub(centre).add(size / 2), size).add(centre).sub(size / 2);
    const x = wrap(s1, dx, c.x, w);
    const z = wrap(s2, dz, c.z, d);
    // drops beyond the intensity share are parked far below the world
    const hidden = s4.greaterThan(this.uIntensity).select(float(-1e4), float(0));
    material.positionNode = positionLocal.add(vec3(x, y.add(c.y).add(hidden), z));
    material.colorNode = color(o.color ?? (rain ? 0xa3d4f0 : 0xf4f4f4));
  }

  /** Share of the drops falling (0..1). */
  get intensity(): number {
    return this.uIntensity.value as number;
  }
  set intensity(v: number) {
    this.uIntensity.value = Math.min(1, Math.max(0, v));
    this.visible = (this.uIntensity.value as number) > 0; // no drops: no draw at all
  }

  /** Fall speed (m/s). */
  get speed(): number {
    return this.uSpeed.value as number;
  }
  set speed(v: number) {
    this.uSpeed.value = v;
  }

  /** Per frame (game time): advance the fall and follow `center`. */
  update(dt: number, center: Vector3): void {
    this.t += dt;
    this.uTime.value = this.t;
    (this.uCenter.value as Vector3).copy(center);
    (this.uWind.value as Vector2).copy(this.wind);
  }

  /** How many drops hit the ground in `dt` seconds at this intensity (for splash particles, ripples). */
  splashes(dt: number): number {
    return (this.count * this.intensity * dt * this.speed) / this.area[1];
  }

  dispose(): this {
    this.geometry.dispose();
    (this.material as MeshBasicNodeMaterial).dispose();
    return this;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
