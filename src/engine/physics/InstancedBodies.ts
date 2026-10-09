/**
 * Many dynamic bodies of one shape drawn as ONE instanced mesh: a stress test, a crate
 * shower, rubble, a ball pit. Each body is a Rapier rigid body; its instance matrix is
 * interpolated between the last two physics steps every frame, like `physics.bind`.
 *
 *   const balls = new InstancedBodies(ctx.physics, ctx.scene, { shape: 'ball', size: 0.3, capacity: 500, color: PALETTE.sky });
 *   balls.add([x, 8, z], { velocity: [0, -2, 0] });
 *   // per frame: balls.sync(ctx.physics.alpha)
 */
import { BoxGeometry, CapsuleGeometry, Color, type ColorRepresentation, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, type Scene, SphereGeometry, Vector3 } from 'three/webgpu';
import { setLookLayer } from '../render/lookLayer';
import { toonMaterial } from '../render/toon';
import { type Physics, RAPIER } from './Physics';

export type InstancedShape = 'box' | 'ball' | 'capsule';

export interface InstancedBodiesOptions {
  shape: InstancedShape;
  /** Box: edge length; ball: radius; capsule: radius (its height is 3 × radius). */
  size: number;
  /** Most bodies at once. */
  capacity: number;
  color?: ColorRepresentation;
  density?: number;
  friction?: number;
  restitution?: number;
  /** Sweep fast bodies so they can't skip through thin walls (default: only tiny ones). */
  ccd?: boolean;
}

export class InstancedBodies {
  readonly mesh: InstancedMesh;
  readonly bodies: RAPIER.RigidBody[] = [];
  private readonly prev: Float32Array;
  private readonly curr: Float32Array;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly one = new Vector3(1, 1, 1);
  private readonly unsubscribe: () => void;
  private readonly tint = new Color();
  /** The next body `spawn` reuses when full. */
  private oldest = 0;

  constructor(
    private readonly physics: Physics,
    scene: Scene,
    readonly o: InstancedBodiesOptions,
  ) {
    const s = o.size;
    const geometry = o.shape === 'box' ? new BoxGeometry(s, s, s) : o.shape === 'ball' ? new SphereGeometry(s, 10, 7) : new CapsuleGeometry(s, s, 3, 8);
    const material = toonMaterial(o.color ?? 0xffffff);
    this.mesh = new InstancedMesh(geometry, material, o.capacity);
    this.mesh.count = 0;
    // per-instance tint (white: the material's colour), there from the start so the shader never changes
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(o.capacity * 3).fill(1), 3);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    setLookLayer(this.mesh, 'actors');
    scene.add(this.mesh);
    // position (3) + rotation (4) per body, for the last two steps
    this.prev = new Float32Array(o.capacity * 7);
    this.curr = new Float32Array(o.capacity * 7);
    this.unsubscribe = physics.onStep(() => this.capture());
  }

  get count(): number {
    return this.bodies.length;
  }

  /** A new body at `at` (false when full). */
  add(at: readonly [number, number, number], o: { velocity?: readonly [number, number, number]; spin?: readonly [number, number, number]; color?: ColorRepresentation } = {}): RAPIER.RigidBody | null {
    if (this.bodies.length >= this.o.capacity) return null;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(at[0], at[1], at[2]).setCcdEnabled(this.o.ccd ?? this.o.size < 0.2);
    if (o.velocity) desc.setLinvel(o.velocity[0], o.velocity[1], o.velocity[2]);
    if (o.spin) desc.setAngvel({ x: o.spin[0], y: o.spin[1], z: o.spin[2] });
    const body = this.physics.world.createRigidBody(desc);
    const s = this.o.size;
    const shape = this.o.shape === 'box' ? RAPIER.ColliderDesc.cuboid(s / 2, s / 2, s / 2) : this.o.shape === 'ball' ? RAPIER.ColliderDesc.ball(s) : RAPIER.ColliderDesc.capsule(s / 2, s);
    this.physics.world.createCollider(shape.setDensity(this.o.density ?? 1).setFriction(this.o.friction ?? 0.6).setRestitution(this.o.restitution ?? 0.1), body);
    const i = this.bodies.length;
    this.bodies.push(body);
    this.write(i, body, this.prev);
    this.write(i, body, this.curr);
    this.mesh.setColorAt(i, o.color !== undefined ? this.tint.set(o.color) : this.tint.setRGB(1, 1, 1));
    this.mesh.instanceColor!.needsUpdate = true;
    this.mesh.count = this.bodies.length;
    return body;
  }

  /** Like `add`, but when full the oldest body is moved to `at` instead (a cannon's shots). */
  spawn(at: readonly [number, number, number], o: { velocity?: readonly [number, number, number]; spin?: readonly [number, number, number] } = {}): RAPIER.RigidBody {
    const added = this.add(at, o);
    if (added) return added;
    const i = this.oldest;
    this.oldest = (this.oldest + 1) % this.bodies.length;
    const body = this.bodies[i]!;
    const v = o.velocity ?? [0, 0, 0];
    const w = o.spin ?? [0, 0, 0];
    body.setTranslation({ x: at[0], y: at[1], z: at[2] }, true);
    body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
    body.setAngvel({ x: w[0], y: w[1], z: w[2] }, true);
    this.write(i, body, this.prev);
    this.write(i, body, this.curr);
    return body;
  }

  /** Remove every body (and stop drawing them). */
  clear(): void {
    for (const b of this.bodies) this.physics.remove(b);
    this.bodies.length = 0;
    this.mesh.count = 0;
    this.oldest = 0;
  }

  /** Remove the bodies and the mesh. */
  dispose(): void {
    this.clear();
    this.unsubscribe();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }

  /** Bodies that fell below `y` go back up to `to` (a fountain of crates). */
  recycle(y: number, to: (i: number) => readonly [number, number, number]): number {
    let n = 0;
    this.bodies.forEach((b, i) => {
      if (b.translation().y >= y) return;
      const p = to(i);
      b.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.write(i, b, this.prev);
      this.write(i, b, this.curr);
      n++;
    });
    return n;
  }

  /** Bodies asleep (resting: Rapier stops simulating them). */
  sleeping(): number {
    let n = 0;
    for (const b of this.bodies) if (b.isSleeping()) n++;
    return n;
  }

  /** Per frame: instance matrices between the last two steps (`alpha` = physics.alpha). */
  sync(alpha: number): void {
    const { prev, curr } = this;
    for (let i = 0; i < this.bodies.length; i++) {
      const k = i * 7;
      this.p.set(prev[k]! + (curr[k]! - prev[k]!) * alpha, prev[k + 1]! + (curr[k + 1]! - prev[k + 1]!) * alpha, prev[k + 2]! + (curr[k + 2]! - prev[k + 2]!) * alpha);
      this.q.set(prev[k + 3]!, prev[k + 4]!, prev[k + 5]!, prev[k + 6]!);
      this.q2.set(curr[k + 3]!, curr[k + 4]!, curr[k + 5]!, curr[k + 6]!);
      this.q.slerp(this.q2, alpha);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.one));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private capture(): void {
    this.prev.set(this.curr.subarray(0, this.bodies.length * 7));
    for (let i = 0; i < this.bodies.length; i++) this.write(i, this.bodies[i]!, this.curr);
  }

  private write(i: number, b: RAPIER.RigidBody, into: Float32Array): void {
    const t = b.translation();
    const r = b.rotation();
    const k = i * 7;
    into[k] = t.x;
    into[k + 1] = t.y;
    into[k + 2] = t.z;
    into[k + 3] = r.x;
    into[k + 4] = r.y;
    into[k + 5] = r.z;
    into[k + 6] = r.w;
  }
}
