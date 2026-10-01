/**
 * A fixed pool of point lights shared by every stage. Toon materials compile one shader
 * per light count, so adding or removing lights recompiles every material on screen (a
 * hitch on stage swaps). The pool keeps the count constant: stages borrow lights and set
 * their colour, intensity and range; free lights sit at intensity 0.
 */
import { PointLight, type Scene, Vector3 } from 'three/webgpu';
import type { LightPoolLike, PooledLight } from './ports';

export const LIGHT_POOL_SIZE = 8;

class Slot implements PooledLight {
  inUse = false;
  constructor(readonly light: PointLight) {}
  get position(): Vector3 {
    return this.light.position;
  }
  get color(): number {
    return this.light.color.getHex();
  }
  set color(c: number) {
    this.light.color.setHex(c);
  }
  get intensity(): number {
    return this.light.intensity;
  }
  set intensity(v: number) {
    this.light.intensity = this.inUse ? v : 0;
  }
  get distance(): number {
    return this.light.distance;
  }
  set distance(v: number) {
    this.light.distance = v;
  }
}

export class LightPool implements LightPoolLike {
  private readonly slots: Slot[] = [];

  constructor(scene: Scene, size = LIGHT_POOL_SIZE) {
    for (let i = 0; i < size; i++) {
      const l = new PointLight(0xffffff, 0, 8, 1.6);
      l.castShadow = false;
      l.name = `pool-light-${i}`;
      l.position.set(0, -50, 0);
      scene.add(l);
      this.slots.push(new Slot(l));
    }
  }

  acquire(color: number, intensity: number, distance: number, at: Vector3 | readonly [number, number, number]): PooledLight | null {
    const s = this.slots.find((x) => !x.inUse);
    if (!s) return null;
    s.inUse = true;
    s.color = color;
    s.distance = distance;
    s.intensity = intensity;
    if (at instanceof Vector3) s.position.copy(at);
    else s.position.set(at[0], at[1], at[2]);
    return s;
  }

  release(light: PooledLight): void {
    const s = light as Slot;
    s.intensity = 0;
    s.inUse = false;
    s.light.intensity = 0;
    s.position.set(0, -50, 0);
  }

  releaseAll(): void {
    for (const s of this.slots) this.release(s);
  }

  get used(): number {
    return this.slots.filter((s) => s.inUse).length;
  }
}
