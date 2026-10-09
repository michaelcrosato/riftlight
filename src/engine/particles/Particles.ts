import {
  type Camera,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from 'three/webgpu';
import { instancedBufferAttribute, uniform } from 'three/tsl';
import { PALETTE } from '../palette';
import { type BurstOptions, ParticlePool, type ParticlePreset } from './pool';
import { PARTICLES } from './presets';
import { Rng } from '../random';

/** What the particle system needs to size particles in art pixels. */
export interface ParticleView {
  camera: Camera;
  /** Point the camera looks at (sizes are exact there). */
  focus: Vector3;
  /** Internal (art) resolution height. */
  height: number;
}

interface Emitter {
  pool: ParticlePool;
  sprite: Sprite;
  offset: InstancedBufferAttribute;
  color: InstancedBufferAttribute;
  size: InstancedBufferAttribute;
  material: SpriteNodeMaterial;
}

const linear = new Map<string, Color>();
const paletteColor = (name: string) => {
  let c = linear.get(name);
  if (!c) linear.set(name, (c = new Color(PALETTE[name as keyof typeof PALETTE] ?? 0xffffff)));
  return c;
};

/**
 * Pixel-art particles: CPU-simulated pools, drawn as camera-facing square sprites in flat
 * palette colors. One emitter (one instanced draw call, one pooled instance buffer) per
 * preset; sizes are whole art pixels, so in Pixel mode a particle is a crisp N×N block.
 * Available as `ctx.particles`; emitters are created on first use and freed by `clear()`
 * (the engine calls it when a level unloads).
 *
 *   ctx.particles.burst('dust', hero.feet);
 *   ctx.particles.burst('skid', feet, { direction: [-vx, 0.3, -vz], count: 2 });
 */
export class Particles {
  /** Engine-owned group holding every emitter. */
  readonly group = new Group();
  /** Preset registry: the built-ins plus anything registered. */
  readonly presets = new Map<string, ParticlePreset>(Object.entries(PARTICLES) as [string, ParticlePreset][]);
  /** World units per art pixel at the camera focus (updated every frame). */
  readonly pixelWorld = uniform(0.05);
  /** Emitters by key: `@name` for registered presets, `#<json>` for inline preset objects. */
  private readonly emitters = new Map<string, Emitter>();
  private readonly inlineKeys = new WeakMap<ParticlePreset, string>();
  private readonly geometry = new PlaneGeometry(1, 1);
  private warnedMany = false;
  /** Where bursts get their randomness: the level's stream (the engine reseeds it per level). */
  private rng = new Rng('particles');
  private readonly random = () => this.rng.next();

  constructor(private readonly view: () => ParticleView) {
    this.group.name = 'particles';
    this.group.userData.engineOwned = true;
  }

  /** Add or replace a named preset. Replacing frees the old preset's emitter. */
  register(name: string, preset: ParticlePreset): void {
    this.presets.set(name, preset);
    const key = `@${name}`;
    const old = this.emitters.get(key);
    if (old && old.pool.preset !== preset) this.free(key, old);
  }

  /**
   * Spawn a burst of `preset` (a name or a ParticlePreset) at `at`. Returns the number of
   * particles spawned (fewer when the pool is full, 0 for an unknown preset). Inline
   * preset objects share one emitter per distinct content, so `burst({ ...literal }, at)`
   * every frame stays one pool and one draw call; prefer `register` + a name, and vary a
   * burst with `options` (count, direction, speed, scale, colors).
   */
  burst(preset: string | ParticlePreset, at: Vector3 | readonly [number, number, number], options: BurstOptions = {}): number {
    const def = typeof preset === 'string' ? this.presets.get(preset) : preset;
    if (!def) {
      console.warn(`[particles] unknown preset "${String(preset)}"`);
      return 0;
    }
    const key = typeof preset === 'string' ? `@${preset}` : this.inlineKey(preset);
    const p: [number, number, number] = at instanceof Vector3 ? [at.x, at.y, at.z] : [at[0], at[1], at[2]];
    return this.emitter(key, def).pool.spawn(p, options, this.random);
  }

  /** Particles alive right now, over all emitters. */
  get alive(): number {
    let n = 0;
    for (const e of this.emitters.values()) n += e.pool.alive;
    return n;
  }

  /** Emitters (= draw calls at most) currently allocated. */
  get emitterCount(): number {
    return this.emitters.size;
  }

  /** Simulate and upload. Called by the engine every frame (frozen while paused). */
  update(dt: number): void {
    this.updatePixelSize();
    for (const e of this.emitters.values()) {
      const { pool } = e;
      if (dt > 0) pool.step(dt);
      const n = pool.alive;
      e.sprite.visible = n > 0;
      if (n === 0) continue;
      const off = e.offset.array as Float32Array;
      const col = e.color.array as Float32Array;
      const size = e.size.array as Float32Array;
      off.set(pool.pos.subarray(0, n * 3));
      for (let i = 0; i < n; i++) {
        const c = paletteColor(pool.colorAt(i));
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        size[i] = pool.sizeAt(i);
      }
      // Keep at least 2 instances: three keys its render cache on count > 1, and an
      // instance of size 0 draws nothing.
      if (n === 1) size[1] = 0;
      e.sprite.count = Math.max(2, n);
      e.offset.needsUpdate = e.color.needsUpdate = e.size.needsUpdate = true;
    }
  }

  /** Kill every particle and free the emitters (GPU buffers, materials). */
  /** Take bursts' randomness from `rng` (the engine passes each level's `ctx.random` fork). */
  reseed(rng: Rng): void {
    this.rng = rng;
  }

  clear(): void {
    for (const [key, e] of [...this.emitters]) this.free(key, e);
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    this.group.removeFromParent();
  }

  private inlineKey(preset: ParticlePreset): string {
    let key = this.inlineKeys.get(preset);
    if (!key) this.inlineKeys.set(preset, (key = `#${JSON.stringify(preset)}`));
    return key;
  }

  private free(key: string, e: Emitter): void {
    e.sprite.removeFromParent();
    e.material.dispose();
    this.emitters.delete(key);
  }

  private emitter(key: string, def: ParticlePreset): Emitter {
    let e = this.emitters.get(key);
    if (e) return e;
    if (this.emitters.size >= 32 && !this.warnedMany) {
      this.warnedMany = true;
      console.warn('[particles] 32+ emitters (one draw call each): register presets and vary bursts with options instead of building new presets');
    }
    const pool = new ParticlePool(def);
    const attr = (size: number) => new InstancedBufferAttribute(new Float32Array(pool.max * size), size).setUsage(DynamicDrawUsage);
    const offset = attr(3);
    const color = attr(3);
    const size = attr(1);
    const material = new SpriteNodeMaterial();
    material.positionNode = instancedBufferAttribute(offset, 'vec3');
    material.colorNode = instancedBufferAttribute(color, 'vec3');
    material.scaleNode = this.pixelWorld.mul(instancedBufferAttribute(size, 'float'));
    material.name = 'particles';
    const sprite = new Sprite(material);
    sprite.geometry = this.geometry; // with normals, for the pixelation pass's normal buffer
    sprite.frustumCulled = false;
    sprite.visible = false;
    sprite.name = 'particle-emitter';
    this.group.add(sprite);
    e = { pool, sprite, offset, color, size, material };
    this.emitters.set(key, e);
    return e;
  }

  private updatePixelSize(): void {
    const { camera, focus, height } = this.view();
    if (camera instanceof OrthographicCamera) {
      this.pixelWorld.value = (camera.top - camera.bottom) / camera.zoom / height;
    } else if (camera instanceof PerspectiveCamera) {
      const dist = Math.max(0.5, camera.position.distanceTo(focus));
      this.pixelWorld.value = (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / camera.zoom / height;
    }
  }
}
