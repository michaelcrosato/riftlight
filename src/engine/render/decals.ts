/**
 * Decals: marks left on surfaces (footprints, scorch marks, paint splats, cracks), each a
 * small flat quad laid on the surface along its normal, its shape cut out in the shader (no
 * texture), coloured per mark, and faded out at the end of its life by an ordered dither (no
 * blending). One instanced draw per shape, a fixed pool: when it is full the oldest mark goes.
 *
 *   const decals = new Decals(scene, { capacity: 256 });
 *   decals.add('scorch', hit.point, hit.normal, { size: 1.6, color: PALETTE.ink, life: 8 });
 *   decals.add('footprint', feet, UP, { size: 0.3, rotation: heading, color: PALETTE.slate });
 *   // per frame: decals.update(dt)
 */
import { Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, PlaneGeometry, Quaternion, type Scene, Vector3, type Vector3Like } from 'three/webgpu';
import { abs, attribute, float, floor, fract, length, max, min, screenCoordinate, sin, smoothstep, uv, vec2 } from 'three/tsl';

export const DECAL_SHAPES = ['footprint', 'scorch', 'splat', 'crack', 'ring'] as const;
export type DecalShape = (typeof DECAL_SHAPES)[number];

export interface DecalOptions {
  /** Width of the mark (m). Default 0.5. */
  size?: number;
  /** Turn about the normal (radians). Default random. */
  rotation?: number;
  /** Colour (hex). Default dark. */
  color?: number;
  /** Seconds before it starts to fade (0: forever). Default 10. */
  life?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TSL operators aren't typed on Node */
/** The shape's coverage at uv (centred): 1 inside, 0 outside. */
function shapeMask(shape: DecalShape): any {
  const p = uv().sub(0.5).mul(2) as any; // −1..1
  const r = length(p) as any;
  switch (shape) {
    case 'footprint': {
      // a sole and a heel: two ellipses
      const sole = length(vec2(p.x.mul(2.2), p.y.sub(0.25).mul(1.2))) as any;
      const heel = length(vec2(p.x.mul(2.6), p.y.add(0.55).mul(2.2))) as any;
      return float(1).sub(smoothstep(0.95, 1, min(sole, heel)));
    }
    case 'scorch': {
      // a ragged blob: the radius wobbles with the angle
      const a = (p.y as any).atan(p.x) as any;
      const edge = float(0.75).add(sin(a.mul(7)).mul(0.08)).add(sin(a.mul(13).add(1.3)).mul(0.06)) as any;
      return float(1).sub(smoothstep(edge.sub(0.05), edge, r));
    }
    case 'splat': {
      const a = (p.y as any).atan(p.x) as any;
      const edge = float(0.55).add(max(sin(a.mul(5)), 0).mul(0.35)).add(sin(a.mul(11)).mul(0.05)) as any;
      const drops = float(1).sub(smoothstep(0.08, 0.1, length(p.sub(vec2(0.78, 0.3))))).add(float(1).sub(smoothstep(0.06, 0.08, length(p.sub(vec2(-0.6, -0.7)))))) as any;
      return max(float(1).sub(smoothstep(edge.sub(0.04), edge, r)), drops);
    }
    case 'crack': {
      // jagged lines out from the middle
      const a = (p.y as any).atan(p.x) as any;
      const spoke = abs(fract(a.mul(6 / (2 * Math.PI)).add(sin(r.mul(9)).mul(0.04))).sub(0.5)) as any;
      return float(1).sub(smoothstep(0.02, 0.05, spoke.mul(r.add(0.2)))).mul(float(1).sub(smoothstep(0.85, 1, r)));
    }
    case 'ring':
      return float(1).sub(smoothstep(0.08, 0.12, abs(r.sub(0.8))));
  }
}

interface Slot {
  life: number;
  age: number;
}

const Z = new Vector3(0, 0, 1);

export class Decals {
  readonly meshes = new Map<DecalShape, InstancedMesh>();
  private readonly slots = new Map<DecalShape, Slot[]>();
  private readonly next = new Map<DecalShape, number>();
  private readonly fades = new Map<DecalShape, InstancedBufferAttribute>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly s = new Vector3();
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly c = new Color();
  private seed = 1;

  constructor(
    private readonly scene: Scene,
    readonly o: { capacity?: number } = {},
  ) {}

  private mesh(shape: DecalShape): InstancedMesh {
    let mesh = this.meshes.get(shape);
    if (mesh) return mesh;
    const cap = this.o.capacity ?? 128;
    const material = new MeshBasicNodeMaterial();
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    const fade = new InstancedBufferAttribute(new Float32Array(cap), 1);
    const geometry = new PlaneGeometry(1, 1);
    geometry.setAttribute('aFade', fade);
    // keep the shape's pixels, minus a growing share by a 4×4 Bayer pattern as it fades
    const a = floor(screenCoordinate.xy) as any;
    const b2 = (q: any) => fract(q.x.div(2).add(q.y.mul(q.y).mul(0.75)));
    const bayer = b2(floor(a.mul(0.5))).mul(0.25).add(b2(a)) as any;
    const keep = float(1).sub(attribute('aFade', 'float')) as any;
    material.maskNode = shapeMask(shape).greaterThan(0.5).and(bayer.lessThan(keep));
    mesh = new InstancedMesh(geometry, material, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.scene.add(mesh);
    this.meshes.set(shape, mesh);
    this.slots.set(shape, []);
    this.next.set(shape, 0);
    this.fades.set(shape, fade);
    return mesh;
  }

  /** Lay a mark at `at` on a surface facing `normal`. Returns its index in that shape's pool. */
  add(shape: DecalShape, at: Vector3Like, normal: Vector3Like, o: DecalOptions = {}): number {
    const mesh = this.mesh(shape);
    const slots = this.slots.get(shape)!;
    const cap = this.o.capacity ?? 128;
    let i: number;
    if (slots.length < cap) {
      i = slots.length;
      slots.push({ life: 0, age: 0 });
      mesh.count = slots.length;
    } else {
      i = this.next.get(shape)!;
      this.next.set(shape, (i + 1) % cap);
    }
    const slot = slots[i]!;
    slot.life = o.life ?? 10;
    slot.age = 0;
    this.n.set(normal.x, normal.y, normal.z).normalize();
    // the plane faces +Z: turn it to the normal, then about the normal
    this.q.setFromUnitVectors(Z, this.n);
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    const rot = o.rotation ?? (this.seed / 4294967296) * Math.PI * 2;
    this.q2.setFromAxisAngle(Z, rot);
    this.q.multiply(this.q2);
    const size = o.size ?? 0.5;
    this.p.set(at.x, at.y, at.z).addScaledVector(this.n, 0.012);
    this.m.compose(this.p, this.q, this.s.set(size, size, size));
    mesh.setMatrixAt(i, this.m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.setColorAt(i, this.c.setHex(o.color ?? 0x333c57));
    mesh.instanceColor!.needsUpdate = true;
    const fade = this.fades.get(shape)!;
    fade.setX(i, 0);
    fade.needsUpdate = true;
    return i;
  }

  /** Marks alive (per shape or all). */
  count(shape?: DecalShape): number {
    if (shape) return (this.slots.get(shape) ?? []).filter((s) => s.life === 0 || s.age < s.life + 1).length;
    return DECAL_SHAPES.reduce((n, s) => n + this.count(s), 0);
  }

  /** Per frame: age the marks; old ones dither away over a second. */
  update(dt: number): void {
    for (const [shape, slots] of this.slots) {
      const fade = this.fades.get(shape)!;
      let changed = false;
      slots.forEach((s, i) => {
        if (s.life === 0) return;
        const before = s.age;
        s.age += dt;
        if (s.age > s.life && before <= s.life + 1) {
          fade.setX(i, Math.min(1, s.age - s.life));
          changed = true;
        }
      });
      if (changed) fade.needsUpdate = true;
    }
  }

  /** Remove every mark (the meshes stay for reuse). */
  clear(): void {
    for (const [shape, mesh] of this.meshes) {
      mesh.count = 0;
      this.slots.set(shape, []);
      this.next.set(shape, 0);
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as MeshBasicNodeMaterial).dispose();
    }
    this.meshes.clear();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
