/**
 * The shell's `LightPoolLike` (borrow a light, set its colour / intensity / range, give it
 * back) as a thin adapter over the engine's light pool (`ctx.lights`, render/lights.ts).
 * There is exactly one light system: the engine's fixed set of point lights, shared by
 * every request, so stage swaps, spells and torches never change the light count (and never
 * recompile a toon material). A borrowed light is a request; the engine lights the ones that
 * matter most near the camera and fades the rest.
 */
import { Vector3 } from 'three/webgpu';
import type { LightHandle, LightPool as EngineLightPool } from '../../engine/render/lights';
import type { LightPoolLike, PooledLight } from './ports';

/** Light falloff the shell's lights were tuned with (PointLight.decay). */
const DECAY = 1.6;

class Borrowed implements PooledLight {
  private _color: number;
  private _intensity: number;
  private _distance: number;

  constructor(
    readonly handle: LightHandle,
    color: number,
    intensity: number,
    distance: number,
  ) {
    this._color = color;
    this._intensity = intensity;
    this._distance = distance;
  }

  /** Move it like a Vector3 (the request's position: uniforms only). */
  get position(): Vector3 {
    return this.handle.position;
  }
  get color(): number {
    return this._color;
  }
  set color(c: number) {
    if (c === this._color) return;
    this._color = c;
    this.handle.update({ color: c });
  }
  get intensity(): number {
    return this._intensity;
  }
  set intensity(v: number) {
    this._intensity = v;
    this.handle.update({ intensity: v });
  }
  get distance(): number {
    return this._distance;
  }
  set distance(v: number) {
    this._distance = v;
    this.handle.update({ radius: v });
  }
}

export class LightPool implements LightPoolLike {
  private readonly lent = new Set<Borrowed>();

  constructor(
    readonly pool: EngineLightPool,
    /** Importance of shell lights against effects (the hero's light is 8, a projectile 3). */
    readonly priority = 1.5,
  ) {}

  acquire(color: number, intensity: number, distance: number, at: Vector3 | readonly [number, number, number]): PooledLight {
    const position: [number, number, number] = at instanceof Vector3 ? [at.x, at.y, at.z] : [at[0], at[1], at[2]];
    const handle = this.pool.request({ position, color, intensity, radius: distance, decay: DECAY, priority: this.priority, fadeIn: 0.2, name: 'shell' });
    const b = new Borrowed(handle, color, intensity, distance);
    this.lent.add(b);
    return b;
  }

  release(light: PooledLight): void {
    const b = light as Borrowed;
    if (!this.lent.delete(b)) return;
    b.handle.release();
  }

  releaseAll(): void {
    for (const b of this.lent) b.handle.release();
    this.lent.clear();
  }

  /** Lights currently borrowed. */
  get used(): number {
    return this.lent.size;
  }
}
