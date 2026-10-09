/**
 * A swarm simulated on the GPU: every particle's position and velocity live in GPU storage
 * buffers, and a TSL compute shader moves them all each frame (pulled toward an attractor,
 * swirled round it, stirred by a noise flow, bounced off a floor). The CPU never touches a
 * particle; drawing is one instanced sprite draw reading the same buffer. On the WebGL 2
 * fallback three runs the same compute shader with transform feedback.
 *
 *   const swarm = new GpuSwarm({ count: 32768, center: [0, 2, 0] });
 *   scene.add(swarm.mesh);
 *   swarm.update(engine.renderer.renderer, dt);   // per frame
 *   swarm.attractor.value.set(x, y, z);           // uniforms: change them live
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- TSL node graphs are dynamically typed */
import { Sprite, SpriteNodeMaterial, Vector3, type WebGPURenderer } from 'three/webgpu';
import { color, cos, float, Fn, hash, If, instancedArray, instanceIndex, mix, mx_noise_vec3, sin, sqrt, uniform, vec3 } from 'three/tsl';

export interface GpuSwarmOptions {
  count: number;
  /** Middle of the ball it starts in. Default [0, 2, 0]. */
  center?: readonly [number, number, number];
  /** Radius of that ball (m). Default 6. */
  radius?: number;
  /** Particle size (m). Default 0.08. */
  size?: number;
  /** Colours: slow, fast. */
  colors?: readonly [number, number];
  /** Height of the floor they bounce off. Default 0. */
  floor?: number;
  /** Varies the starting layout and the flow. Default: a new one per swarm. */
  seed?: number;
}

let serial = 0;

export class GpuSwarm {
  readonly count: number;
  readonly mesh: Sprite;
  /** Storage buffers (vec3 per particle): `renderer.getArrayBufferAsync(swarm.positions.value)` reads them back. */
  readonly positions: any;
  readonly velocities: any;
  /** Where they are pulled to (and swirl round). */
  readonly attractor: any = uniform(new Vector3());
  /** Spring toward the attractor (m/s² per metre away). */
  readonly pull: any = uniform(2.5);
  /** Swirl round its vertical axis. */
  readonly swirl: any = uniform(5);
  /** Strength of the noise flow that stirs them. */
  readonly turbulence: any = uniform(10);
  /** Velocity lost per second (0..1). */
  readonly drag: any = uniform(0.6);
  /** Compute dispatches so far. */
  steps = 0;
  private readonly time: any = uniform(0);
  private readonly dt: any = uniform(0);
  private readonly init: any;
  private readonly step: any;
  private needsInit = true;
  private renderer: WebGPURenderer | null = null;
  private disposed = false;

  constructor(o: GpuSwarmOptions) {
    this.count = o.count;
    const [cx, cy, cz] = o.center ?? [0, 2, 0];
    const radius = o.radius ?? 6;
    const floor = float(o.floor ?? 0);
    const id = ++serial;
    const seed = o.seed !== undefined && Number.isFinite(o.seed) ? Math.abs(Math.round(o.seed)) : id;
    const offset = (seed * 7919) % 1048576; // a different stretch of the hash per seed (small: a uint literal)
    const flow = (seed % 1000) * 0.731; // and of the noise (small: float precision)
    // A literal only this swarm's shaders carry (times zero: it changes nothing but the source),
    // so two swarms never share a compiled program, whatever their seeds and options: the WebGL 2
    // fallback caches a compute program by its source, transform-feedback buffers and all.
    const own = float(id).mul(0);
    const [slow, fast] = o.colors ?? [0x41a6f6, 0xf4f4f4];
    this.positions = instancedArray(o.count, 'vec3');
    this.velocities = instancedArray(o.count, 'vec3');
    const positions = this.positions;
    const velocities = this.velocities;
    this.attractor.value.set(cx, cy, cz);

    // a random point in the ball for each particle (hash of its index: no CPU data at all)
    this.init = Fn(() => {
      const i = instanceIndex.add(offset);
      const u = hash(i.add(1));
      const theta = hash(i.add(2)).mul(Math.PI * 2);
      const z = hash(i.add(3)).mul(2).sub(1);
      const r = u.pow(1 / 3).mul(radius);
      const s = sqrt(float(1).sub(z.mul(z)));
      positions.element(instanceIndex).assign(vec3(s.mul(cos(theta)), z, s.mul(sin(theta))).mul(r).add(vec3(cx, cy, cz)).add(own));
      velocities.element(instanceIndex).assign(vec3(0, 0, 0));
    })().compute(o.count);

    const { attractor, pull, swirl, turbulence, drag, time, dt } = this;
    this.step = Fn(() => {
      const p = positions.element(instanceIndex);
      const v = velocities.element(instanceIndex);
      const toward = attractor.sub(p);
      const dist = toward.length().max(0.5);
      const dir = toward.div(dist);
      // pulled in like a spring (harder the further out), swirled round (less near the middle),
      // stirred by a flowing noise field. The spin and the spring settle into an orbit about
      // swirl / drag / sqrt(pull) metres out: a strong swirl on a weak pull circles wide.
      const acc = toward
        .mul(pull)
        .add(vec3(dir.z, 0, dir.x.negate()).mul(swirl.mul(dist.div(dist.add(1)))))
        .add(mx_noise_vec3(p.mul(0.3).add(vec3(flow, time.mul(0.25), own))).mul(turbulence));
      v.addAssign(acc.mul(dt));
      v.mulAssign(float(1).sub(drag.mul(dt)).max(0));
      p.addAssign(v.mul(dt));
      If(p.y.lessThan(floor), () => {
        p.y.assign(floor);
        v.y.assign(v.y.abs().mul(0.5));
      });
    })().compute(o.count);

    const material = new SpriteNodeMaterial();
    material.positionNode = positions.toAttribute();
    const speed = velocities.toAttribute().length();
    material.colorNode = mix(color(slow), color(fast), speed.div(10).min(1));
    material.scaleNode = float(o.size ?? 0.08);
    material.depthWrite = true;
    this.mesh = new Sprite(material);
    this.mesh.count = o.count;
    this.mesh.frustumCulled = false;
    // freed with the material too (a level unloading clears the scene without calling dispose)
    material.addEventListener('dispose', () => this.freeCompute());
  }

  /** One frame: (the first time, place them all), then one compute dispatch moving every particle. */
  update(renderer: WebGPURenderer, dt: number): void {
    // a new renderer (a lost GPU device recovered) starts with empty buffers: place them again
    if (renderer !== this.renderer) {
      this.renderer = renderer;
      this.needsInit = true;
    }
    if (this.needsInit) {
      renderer.compute(this.init);
      this.needsInit = false;
    }
    this.dt.value = Math.min(dt, 1 / 30);
    this.time.value += dt;
    renderer.compute(this.step);
    this.steps++;
  }

  /** Scatter them back into the ball they started in (next update). */
  reset(): void {
    this.needsInit = true;
  }

  /**
   * Positions read back from the GPU (x, y, z per particle, padded to 4 on WebGPU). For tests and
   * tools: slow, async, and WebGPU only: on the WebGL 2 fallback, reading a transform-feedback
   * buffer back while it is being written has lost the whole context on software renderers.
   */
  async read(renderer: WebGPURenderer): Promise<Float32Array> {
    if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) throw new Error('GpuSwarm.read: WebGPU only (the WebGL 2 fallback can lose its context reading compute buffers back)');
    return new Float32Array(await renderer.getArrayBufferAsync(this.positions.value));
  }

  /** Remove it and free the material and both compute shaders (the storage buffers go with garbage collection). */
  dispose(): void {
    this.mesh.removeFromParent();
    (this.mesh.material as SpriteNodeMaterial).dispose();
    this.freeCompute();
  }

  private freeCompute(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.init.dispose();
    this.step.dispose();
  }
}
