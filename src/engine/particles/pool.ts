import type { PaletteColor } from '../palette';
import { Rng } from '../random';


type Vec3 = readonly [number, number, number];
type Range = number | readonly [number, number];

/**
 * A particle effect as data. Sizes are in art pixels (whole pixels, so particles stay crisp
 * squares), colors are palette names stepped over each particle's life (no blending).
 */
export interface ParticlePreset {
  /** Particles per burst. */
  count: Range;
  /** Seconds each particle lives. */
  life: Range;
  /** Launch speed, world units / s. */
  speed: Range;
  /** Main launch direction (default straight up). */
  direction?: Vec3;
  /** Cone half-angle around `direction`, degrees (180 = every direction). Default 180. */
  spread?: number;
  /** Multiply vertical launch speed (0.2 = dust that hugs the ground). Default 1. */
  flatten?: number;
  /** Downward acceleration, world units / s² (negative floats up). Default 0. */
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  /** Size in art pixels at birth and at death (rounded to whole pixels). */
  size: readonly [number, number];
  /** Palette colors stepped through over the lifetime. */
  colors: readonly PaletteColor[];
  /** Random spawn offset radius, world units. */
  radius?: number;
  /** Pool size (max alive at once). Default 256. */
  max?: number;
}

export interface BurstOptions {
  /** Override the particle count. */
  count?: number;
  /** Override the launch direction (e.g. opposite to a skid). */
  direction?: Vec3;
  /** Multiply launch speed. */
  speed?: number;
  /** Multiply size. */
  scale?: number;
  /** Override the colors for this burst. */
  colors?: readonly PaletteColor[];
}

const pick = (r: Range, random: () => number) => (typeof r === 'number' ? r : r[0] + (r[1] - r[0]) * random());

/**
 * Fixed-size particle storage with CPU simulation. Alive particles are packed at the
 * front (swap-remove), so the GPU draws exactly `alive` instances from one buffer.
 * Pure (no three.js): unit-tested.
 */
export class ParticlePool {
  readonly max: number;
  alive = 0;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size0: Float32Array;
  readonly size1: Float32Array;
  /** Index into `colorSets` per particle. */
  readonly colorSet: Uint8Array;
  /** Color lists in use: [0] is the preset's, bursts with custom colors add more. */
  readonly colorSets: (readonly PaletteColor[])[];

  constructor(readonly preset: ParticlePreset) {
    this.max = preset.max ?? 256;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.age = new Float32Array(this.max);
    this.life = new Float32Array(this.max);
    this.size0 = new Float32Array(this.max);
    this.size1 = new Float32Array(this.max);
    this.colorSet = new Uint8Array(this.max);
    this.colorSets = [preset.colors];
  }

  /** Bursts spawned without a random source draw from the pool's own seeded stream. */
  private readonly own = new Rng('particles');
  private readonly ownRandom = () => this.own.next();

  /** Spawn a burst at `at`. Returns how many particles were spawned (the pool may be full). `random` in [0, 1): seeded, so bursts repeat. */
  spawn(at: Vec3, o: BurstOptions = {}, random: () => number = this.ownRandom): number {
    const p = this.preset;
    const want = Math.round(o.count ?? pick(p.count, random));
    const n = Math.max(0, Math.min(want, this.max - this.alive));
    const dir = normalize(o.direction ?? p.direction ?? [0, 1, 0]);
    const cosSpread = Math.cos(((p.spread ?? 180) * Math.PI) / 180);
    const set = o.colors ? this.colorSetIndex(o.colors) : 0;
    const scale = o.scale ?? 1;
    for (let k = 0; k < n; k++) {
      const i = this.alive++;
      const r = p.radius ?? 0;
      const off = randomInSphere(random);
      this.pos[i * 3] = at[0] + off[0] * r;
      this.pos[i * 3 + 1] = at[1] + Math.abs(off[1]) * r * 0.5;
      this.pos[i * 3 + 2] = at[2] + off[2] * r;
      const d = randomInCone(dir, cosSpread, random);
      const speed = pick(p.speed, random) * (o.speed ?? 1);
      this.vel[i * 3] = d[0] * speed;
      this.vel[i * 3 + 1] = d[1] * speed * (p.flatten ?? 1);
      this.vel[i * 3 + 2] = d[2] * speed;
      this.age[i] = 0;
      this.life[i] = Math.max(1e-3, pick(p.life, random));
      this.size0[i] = p.size[0] * scale;
      this.size1[i] = p.size[1] * scale;
      this.colorSet[i] = set;
    }
    return n;
  }

  /** Advance every particle by `dt` seconds and drop the dead ones. */
  step(dt: number): void {
    const g = this.preset.gravity ?? 0;
    const damp = Math.exp(-(this.preset.drag ?? 0) * dt);
    for (let i = 0; i < this.alive; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.kill(i);
        continue; // the last particle moved into slot i
      }
      const j = i * 3;
      this.vel[j + 1]! -= g * dt;
      this.vel[j]! *= damp;
      this.vel[j + 1]! *= damp;
      this.vel[j + 2]! *= damp;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      i++;
    }
  }

  /** Life fraction 0..1 of particle `i`. */
  t(i: number): number {
    return Math.min(1, this.age[i]! / this.life[i]!);
  }

  /** Size in whole art pixels (0 = invisible). */
  sizeAt(i: number): number {
    const t = this.t(i);
    return Math.max(0, Math.round(this.size0[i]! + (this.size1[i]! - this.size0[i]!) * t));
  }

  /** Current palette color name: stepped through the particle's color list. */
  colorAt(i: number): PaletteColor {
    const colors = this.colorSets[this.colorSet[i]!]!;
    return colors[Math.min(colors.length - 1, Math.floor(this.t(i) * colors.length))]!;
  }

  clear(): void {
    this.alive = 0;
    this.colorSets.length = 1;
  }

  private kill(i: number): void {
    const last = --this.alive;
    if (i === last) return;
    for (const a of [this.pos, this.vel]) {
      a[i * 3] = a[last * 3]!;
      a[i * 3 + 1] = a[last * 3 + 1]!;
      a[i * 3 + 2] = a[last * 3 + 2]!;
    }
    for (const a of [this.age, this.life, this.size0, this.size1, this.colorSet]) a[i] = a[last]!;
  }

  private colorSetIndex(colors: readonly PaletteColor[]): number {
    const key = colors.join();
    const found = this.colorSets.findIndex((c) => c.join() === key);
    if (found >= 0) return found;
    if (this.colorSets.length >= 255) return 0;
    this.colorSets.push([...colors]);
    return this.colorSets.length - 1;
  }
}

function normalize(v: Vec3): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function randomInSphere(random: () => number): [number, number, number] {
  for (;;) {
    const x = random() * 2 - 1;
    const y = random() * 2 - 1;
    const z = random() * 2 - 1;
    if (x * x + y * y + z * z <= 1) return [x, y, z];
  }
}

/** Uniform random unit vector within `acos(cosSpread)` of `dir`. */
function randomInCone(dir: readonly [number, number, number], cosSpread: number, random: () => number): [number, number, number] {
  const z = cosSpread + (1 - cosSpread) * random(); // cos of the angle from the axis
  const phi = random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  const local: [number, number, number] = [s * Math.cos(phi), s * Math.sin(phi), z];
  // Basis with `dir` as the local +Z axis.
  const up: [number, number, number] = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const a = normalize(cross(up, dir));
  const b = cross(dir, a);
  return [
    a[0] * local[0] + b[0] * local[1] + dir[0] * local[2],
    a[1] * local[0] + b[1] * local[1] + dir[1] * local[2],
    a[2] * local[0] + b[2] * local[1] + dir[2] * local[2],
  ];
}

function cross(u: readonly number[], v: readonly number[]): [number, number, number] {
  return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
}
