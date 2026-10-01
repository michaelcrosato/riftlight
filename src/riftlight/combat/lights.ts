import { Color, type Object3D, PointLight, Vector3 } from 'three/webgpu';
import type { GameEventBus, LightRequest } from '../core/types';

interface Active {
  req: LightRequest;
  age: number;
  light: PointLight | null;
}

/**
 * Dynamic lights for projectiles, explosions and auras. A request goes out on the bus as a
 * `light` event; the level's light pool claims it (`req.claimed = true`) and drives a pooled
 * light. Unclaimed requests get one of a few fallback PointLights owned here. The fallback
 * lights are created once (`warm()`, or on the first unclaimed request) and then only
 * re-coloured and moved, so the light count — and the shaders — never change mid-fight.
 */
export class LightService {
  /** Fallback pool size. */
  static readonly POOL = 4;
  readonly active: Active[] = [];
  private pool: PointLight[] = [];
  private readonly tmp = new Vector3();

  constructor(
    private readonly events: GameEventBus | null,
    private readonly parent: Object3D | null,
  ) {}

  /** Create the fallback lights now (before a level's shaders are compiled). */
  warm(): void {
    if (this.pool.length || !this.parent) return;
    for (let i = 0; i < LightService.POOL; i++) {
      const l = new PointLight(0xffffff, 0, 1, 2);
      l.castShadow = false;
      l.name = `combat-light-${i}`;
      this.parent.add(l);
      this.pool.push(l);
    }
  }

  request(req: LightRequest): LightRequest {
    this.events?.emit('light', req);
    const a: Active = { req, age: 0, light: null };
    if (!req.claimed && this.parent) {
      this.warm();
      a.light = this.pool.find((l) => !this.active.some((x) => x.light === l)) ?? this.steal();
    }
    this.active.push(a);
    return req;
  }

  /** All fallback lights busy: take the one closest to finishing. */
  private steal(): PointLight | null {
    let best: Active | null = null;
    for (const a of this.active) if (a.light && (!best || remaining(a) < remaining(best))) best = a;
    if (!best) return null;
    const l = best.light;
    best.light = null;
    return l;
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]!;
      a.age += dt;
      const r = a.req;
      const done = (r.duration > 0 && a.age >= r.duration) || (r.alive ? !r.alive() : r.duration <= 0);
      if (done) {
        if (a.light) a.light.intensity = 0;
        this.active.splice(i, 1);
        continue;
      }
      if (!a.light) continue;
      const fade = r.duration > 0 ? Math.min(1, (r.duration - a.age) / (r.duration * 0.3)) : 1;
      a.light.color.copy(colorOf(r.color));
      a.light.intensity = r.intensity * fade;
      a.light.distance = r.radius;
      a.light.position.copy(r.position()).add(this.tmp.set(0, 0.8, 0));
    }
  }

  clear(): void {
    for (const a of this.active) if (a.light) a.light.intensity = 0;
    this.active.length = 0;
  }
}

const colors = new Map<number, Color>();
function colorOf(hex: number): Color {
  let c = colors.get(hex);
  if (!c) colors.set(hex, (c = new Color(hex)));
  return c;
}

function remaining(a: Active): number {
  return a.req.duration > 0 ? a.req.duration - a.age : Infinity;
}
