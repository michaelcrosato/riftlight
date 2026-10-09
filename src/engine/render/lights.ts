import { Color, type ColorRepresentation, Group, type Object3D, PointLight, Vector3 } from 'three/webgpu';

/**
 * Dynamic lighting: a fixed pool of real `PointLight`s shared by any number of *light
 * requests* (torches, spells, projectiles, loot beams, glowing monsters...).
 *
 * Every light the toon material sees is part of its compiled shader, so changing the number
 * of lights recompiles every material. The pool therefore never adds or removes lights: it
 * keeps `size` lights in the scene at all times (unused ones at intensity 0) and, every
 * frame, hands them to the most important requests: intensity × priority × proximity to the
 * camera focus. Requests that hold a light get a hysteresis bonus, and every switch fades
 * (the old owner out, then the new one in), so lights never pop. Moving a light or changing
 * its colour, intensity or radius only updates uniforms: no shader work at all.
 *
 *   const torch = ctx.lights.request({ position: [3, 1.6, 4], color: 0xffa040, intensity: 6, radius: 7, flicker: 'torch' });
 *   torch.update({ intensity: 9 });          // or torch.position.set(...)
 *   torch.release();                          // fades out, frees its light
 *
 * The assignment itself is pure (`LightAssigner`, unit-tested); `LightPool` adds the
 * three.js lights, flicker and following.
 */

// ------------------------------------------------------------------ flicker

/** Flicker presets: intensity multipliers over time (deterministic per request seed). */
export type FlickerPreset = 'none' | 'torch' | 'candle' | 'brazier' | 'pulse' | 'strobe' | 'spell';

export const FLICKER_PRESETS: readonly FlickerPreset[] = ['none', 'torch', 'candle', 'brazier', 'pulse', 'strobe', 'spell'];

/** Smooth 1D value noise in [-1, 1]. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    let t = Math.imul((n + seed * 374761393) | 0, 668265263);
    t = Math.imul(t ^ (t >>> 13), 1274126177);
    return ((t ^ (t >>> 16)) >>> 0) / 4294967295;
  };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}

/**
 * Intensity multiplier of a flicker preset at time `t` (seconds). Averages ~1, stays within
 * roughly 0.6..1.25 for fire so a torch never goes dark.
 */
export function flicker(preset: FlickerPreset, t: number, seed = 0): number {
  switch (preset) {
    case 'none':
      return 1;
    case 'torch':
      return 1 + 0.16 * noise1(t * 7, seed) + 0.08 * noise1(t * 17, seed + 7);
    case 'candle':
      return 1 + 0.07 * noise1(t * 5, seed) + 0.05 * noise1(t * 23, seed + 3);
    case 'brazier':
      return 1 + 0.22 * noise1(t * 4, seed) + 0.1 * noise1(t * 13, seed + 5);
    case 'pulse':
      return 0.8 + 0.2 * Math.sin(t * 2.4 + seed);
    case 'strobe': {
      // Mostly dim, with short irregular bright crackles (lightning, sparks).
      const n = noise1(t * 9, seed);
      return n > 0.55 ? 1.6 : 0.55 + 0.15 * noise1(t * 3, seed + 11);
    }
    case 'spell':
      return 1 + 0.12 * Math.sin(t * 11 + seed) + 0.06 * noise1(t * 19, seed);
    default:
      // an unknown preset (untyped data) is a steady light: one NaN intensity would black out every lit pixel
      return 1;
  }
}

// ------------------------------------------------------------------ assignment (pure)

/** One request as the assigner sees it. `slot`/`level` are owned by the assigner. */
export interface AssignItem {
  /** Importance this frame (≥ 0); 0 = not wanted (out of range, off). */
  score: number;
  /** False once released: fades out, then leaves. */
  alive: boolean;
  /** Seconds to fade in / out. */
  fadeIn: number;
  fadeOut: number;
  /** Pool slot held, or -1. */
  slot: number;
  /** Shown fraction 0..1 (fades). */
  level: number;
}

export interface AssignStats {
  /** Requests that got a slot this step. */
  assigned: number;
  /** Requests that lost their slot (faded to 0) this step. */
  freed: number;
  /** Requests wanted but waiting for a slot to fade out. */
  waiting: number;
}

/**
 * Pure light assignment: `capacity` slots, many items. Each step picks the `capacity`
 * highest-scoring live items (items already holding a slot score × `hysteresis`, so two
 * similar requests don't trade a light back and forth), fades winners in and losers out,
 * and moves a slot to a new owner only once the old one has faded to 0. A fade changes a
 * level by at most `dt / fade` per step: nothing ever pops.
 */
export class LightAssigner<T extends AssignItem> {
  /** Slot → item holding it. */
  readonly slots: (T | null)[];
  hysteresis = 1.35;
  private readonly ranked: T[] = [];
  private readonly wanted = new Set<T>();

  constructor(capacity: number) {
    this.slots = new Array<T | null>(capacity).fill(null);
  }

  get capacity(): number {
    return this.slots.length;
  }

  /** Change the slot count (the pool's lights are rebuilt: a one-off shader recompile). */
  resize(capacity: number, items: Iterable<T>): void {
    for (const it of items) {
      if (it.slot >= capacity) {
        it.slot = -1;
        it.level = 0;
      }
    }
    this.slots.length = capacity;
    for (let i = 0; i < capacity; i++) if (this.slots[i] === undefined) this.slots[i] = null;
  }

  /** Effective rank of an item (score with the hysteresis bonus for holders). */
  rank(it: T): number {
    if (!it.alive || !(it.score > 0)) return 0;
    return it.slot >= 0 && it.level > 0 ? it.score * this.hysteresis : it.score;
  }

  step(dt: number, items: readonly T[]): AssignStats {
    const stats: AssignStats = { assigned: 0, freed: 0, waiting: 0 };
    // 1. Who should be lit: the top `capacity` by rank.
    const ranked = this.ranked;
    ranked.length = 0;
    for (const it of items) if (this.rank(it) > 0) ranked.push(it);
    ranked.sort((a, b) => this.rank(b) - this.rank(a));
    const wanted = this.wanted;
    wanted.clear();
    for (let i = 0; i < ranked.length && i < this.capacity; i++) wanted.add(ranked[i]!);
    // Requests that want a light but hold none: their slots must free up faster.
    let pending = 0;
    for (const it of wanted) if (it.slot < 0) pending++;

    // 2. Fade holders: winners in, losers out; a slot whose owner reached 0 is free.
    for (let s = 0; s < this.slots.length; s++) {
      const it = this.slots[s];
      if (!it) continue;
      if (wanted.has(it)) {
        it.level = Math.min(1, it.level + dt / Math.max(1e-3, it.fadeIn));
      } else {
        const speed = pending > 0 ? 2 : 1; // someone is waiting: hand over sooner
        it.level = Math.max(0, it.level - (speed * dt) / Math.max(1e-3, it.fadeOut));
        if (it.level <= 0) {
          it.slot = -1;
          this.slots[s] = null;
          stats.freed++;
        }
      }
    }

    // 3. Winners without a slot take a free one (they start dark and fade in).
    for (const it of ranked) {
      if (!wanted.has(it) || it.slot >= 0) continue;
      const free = this.slots.indexOf(null);
      if (free < 0) {
        stats.waiting++;
        continue;
      }
      this.slots[free] = it;
      it.slot = free;
      it.level = Math.min(1, dt / Math.max(1e-3, it.fadeIn));
      stats.assigned++;
    }
    return stats;
  }
}

// ------------------------------------------------------------------ the pool

export interface LightRequestOptions {
  /** World position (copied). Ignored while `follow` is set (then it is `follow` + `offset`). */
  position?: Vector3 | readonly [number, number, number];
  /** Follow an object's world position every frame (a projectile, a monster, the hero). */
  follow?: Object3D | null;
  /** Offset from `follow` (world axes). */
  offset?: readonly [number, number, number];
  color?: ColorRepresentation;
  /** Point light intensity at full strength (before flicker and fades). Default 4. */
  intensity?: number;
  /** Reach in metres (PointLight.distance: light is 0 beyond it). Default 6. */
  radius?: number;
  /** Distance falloff exponent (PointLight.decay; a uniform, free to change). Default 1.2. */
  decay?: number;
  flicker?: FlickerPreset;
  /** Importance multiplier: the hero's light 4, a loot beam 2, a torch 1 (default). */
  priority?: number;
  /** Fade times in seconds (defaults 0.25 in, 0.2 out). */
  fadeIn?: number;
  fadeOut?: number;
  /** Release automatically after this many seconds (spell flashes, explosions). */
  lifetime?: number;
  /** Optional label for debugging (`pool.describe()`). */
  name?: string;
}

/** A light request. Change it freely; the pool decides whether it currently owns a real light. */
export interface LightHandle {
  readonly id: number;
  /** World position (mutable; ignored while following). */
  readonly position: Vector3;
  /** Colour (mutable). */
  readonly color: Color;
  intensity: number;
  radius: number;
  decay: number;
  flicker: FlickerPreset;
  priority: number;
  follow: Object3D | null;
  readonly offset: Vector3;
  name: string;
  /** Seconds left before auto-release (Infinity = until `release()`). */
  lifetime: number;
  /** Set several fields at once. */
  update(options: LightRequestOptions): this;
  /** Fade out and give the light back. Safe to call twice. */
  release(): void;
  readonly alive: boolean;
  /** Whether it holds one of the pool's real lights right now. */
  readonly lit: boolean;
  /** 0..1: how much of it is shown (fades). */
  readonly level: number;
}

/** Pool sizes by quality level (`QUALITY[level].lights`). */
export const LIGHT_POOL_SIZES = { low: 4, medium: 8, high: 16 } as const;

class Request implements LightHandle, AssignItem {
  readonly position = new Vector3();
  readonly color = new Color(0xffffff);
  readonly offset = new Vector3();
  intensity = 4;
  radius = 6;
  decay = 1.2;
  flicker: FlickerPreset = 'none';
  priority = 1;
  follow: Object3D | null = null;
  name = '';
  lifetime = Infinity;
  fadeIn = 0.25;
  fadeOut = 0.2;
  // AssignItem
  score = 0;
  alive = true;
  slot = -1;
  level = 0;
  constructor(
    readonly id: number,
    private readonly pool: LightPool,
  ) {}

  update(o: LightRequestOptions): this {
    if (o.position) {
      if (o.position instanceof Vector3) this.position.copy(o.position);
      else this.position.set(o.position[0], o.position[1], o.position[2]);
    }
    if (o.follow !== undefined) this.follow = o.follow;
    if (o.offset) this.offset.set(o.offset[0], o.offset[1], o.offset[2]);
    if (o.color !== undefined) this.color.set(o.color);
    if (o.intensity !== undefined) this.intensity = o.intensity;
    if (o.radius !== undefined) this.radius = o.radius;
    if (o.decay !== undefined) this.decay = o.decay;
    if (o.flicker !== undefined) this.flicker = o.flicker;
    if (o.priority !== undefined) this.priority = o.priority;
    if (o.fadeIn !== undefined) this.fadeIn = o.fadeIn;
    if (o.fadeOut !== undefined) this.fadeOut = o.fadeOut;
    if (o.lifetime !== undefined) this.lifetime = o.lifetime;
    if (o.name !== undefined) this.name = o.name;
    return this;
  }

  release(): void {
    if (!this.alive) return;
    this.alive = false;
    this.pool.onRelease(this);
  }

  get lit(): boolean {
    return this.slot >= 0 && this.level > 0;
  }
}

export interface LightPoolOptions {
  /** Real lights in the pool (constant: changing it recompiles materials). Default 8. */
  size?: number;
  /** Parent for the pool's lights (added to it). Usually the scene. */
  parent?: Object3D;
}

export interface LightPoolStats {
  size: number;
  requests: number;
  lit: number;
  /** Slot hand-overs since creation (a request got a light). */
  assignments: number;
  /** Requests that wanted a light but had to wait last frame. */
  waiting: number;
  /** Milliseconds spent in the last update (CPU). */
  updateMs: number;
}

/**
 * A fixed pool of point lights shared by many requests (see the file comment). Available
 * to games as `ctx.lights` (sized by quality: low 4, medium 8, high 16), or create your
 * own with `new LightPool({ size, parent: scene })` and call `update` every frame.
 */
export class LightPool {
  readonly group = new Group();
  readonly lights: PointLight[] = [];
  private readonly requests: Request[] = [];
  private readonly assigner: LightAssigner<Request>;
  private nextId = 1;
  private time = 0;
  private assignments = 0;
  private waiting = 0;
  private updateMs = 0;
  private readonly tmp = new Vector3();

  constructor(options: LightPoolOptions = {}) {
    const size = Math.max(0, Math.floor(options.size ?? LIGHT_POOL_SIZES.medium));
    this.group.name = 'light-pool';
    this.assigner = new LightAssigner<Request>(size);
    this.build(size);
    options.parent?.add(this.group);
  }

  /** Number of real lights (constant unless `resize`d). */
  get size(): number {
    return this.lights.length;
  }

  /** Ask for a light. Returns a handle to move, recolour or release. */
  request(options: LightRequestOptions = {}): LightHandle {
    const r = new Request(this.nextId++, this);
    r.update(options);
    this.requests.push(r);
    return r;
  }

  /**
   * Assign lights for this frame. `focus` is what the camera looks at; requests further
   * than `range` + their radius from it are not lit. Call once per rendered frame.
   */
  update(dt: number, focus: Vector3, range = 18): void {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0; // real time: update timing for the debug panel
    this.time += dt;
    const reqs = this.requests;
    for (const r of reqs) {
      if (r.alive && r.lifetime !== Infinity) {
        r.lifetime -= dt;
        if (r.lifetime <= 0) r.release();
      }
      const p = this.worldPosition(r);
      const d = p.distanceTo(focus);
      const reach = range + r.radius;
      if (!r.alive || d > reach || r.intensity <= 0 || r.radius <= 0) {
        r.score = 0;
        continue;
      }
      // Bright, close to the focus and important first; smooth so ranks don't jump.
      const near = 1 / (1 + (d / Math.max(4, r.radius)) ** 2);
      const edge = Math.min(1, (reach - d) / 3); // eases out at the range edge
      r.score = r.intensity * r.priority * near * edge;
    }
    const s = this.assigner.step(dt, reqs);
    this.assignments += s.assigned;
    this.waiting = s.waiting;
    // Drop released requests once they hold nothing.
    for (let i = reqs.length - 1; i >= 0; i--) {
      const r = reqs[i]!;
      if (!r.alive && r.slot < 0) reqs.splice(i, 1);
    }
    // Drive the real lights: only uniforms change (position, colour, intensity, distance, decay).
    const slots = this.assigner.slots;
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i]!;
      const r = slots[i];
      if (!r || r.level <= 0) {
        light.intensity = 0;
        continue;
      }
      light.position.copy(this.worldPosition(r));
      light.color.copy(r.color);
      light.distance = r.radius;
      light.decay = r.decay;
      light.intensity = r.intensity * flicker(r.flicker, this.time, r.id) * smooth(r.level);
    }
    this.updateMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0; // real time: update timing for the debug panel
  }

  /** Release every request at once and darken the lights (level unload). */
  clear(): void {
    for (const r of this.requests) {
      r.alive = false;
      r.slot = -1;
      r.level = 0;
    }
    this.requests.length = 0;
    this.assigner.slots.fill(null);
    for (const l of this.lights) l.intensity = 0;
  }

  /**
   * Change the number of real lights. Every material using lights recompiles once, so do it
   * rarely (a quality change), never per frame.
   */
  resize(size: number): void {
    size = Math.max(0, Math.floor(size));
    if (size === this.lights.length) return;
    this.assigner.resize(size, this.requests);
    for (const l of this.lights) {
      this.group.remove(l);
      l.dispose();
    }
    this.lights.length = 0;
    this.build(size);
  }

  stats(): LightPoolStats {
    let lit = 0;
    for (const r of this.requests) if (r.lit) lit++;
    return { size: this.lights.length, requests: this.requests.length, lit, assignments: this.assignments, waiting: this.waiting, updateMs: this.updateMs };
  }

  /** Every live request with its score and slot (debugging, inspectors). */
  describe(): { id: number; name: string; score: number; slot: number; level: number; alive: boolean }[] {
    return this.requests.map((r) => ({ id: r.id, name: r.name, score: +r.score.toFixed(3), slot: r.slot, level: +r.level.toFixed(3), alive: r.alive }));
  }

  dispose(): void {
    this.clear();
    for (const l of this.lights) l.dispose();
    this.group.removeFromParent();
  }

  /** @internal Request → pool: a release fades out at the next update. */
  onRelease(r: Request): void {
    r.score = 0;
  }

  private worldPosition(r: Request): Vector3 {
    if (!r.follow) return r.position;
    r.follow.getWorldPosition(this.tmp).add(r.offset);
    r.position.copy(this.tmp);
    return r.position;
  }

  private build(size: number): void {
    for (let i = 0; i < size; i++) {
      // Always visible, never casting shadows: a hidden light would change the light count
      // (and recompile every lit material). Unused lights simply have intensity 0.
      const light = new PointLight(0xffffff, 0, 6, 1.2);
      light.castShadow = false;
      light.name = `pool-light-${i}`;
      this.lights.push(light);
      this.group.add(light);
    }
  }
}

/** Ease the fade so lights swell in and out instead of ramping linearly. */
function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}
