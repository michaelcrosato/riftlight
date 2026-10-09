/**
 * Drawing Verlet soft bodies (physics/verlet.ts): `SoftMesh` for cloth and blobs (a mesh over
 * the body's triangles, rebuilt from its particles each frame), `RopeMesh` for ropes (one
 * instanced box per segment, one draw call). Both use toon materials, so they shade, outline
 * and filter like everything else.
 *
 *   const flag = clothGrid({ ... });
 *   const mesh = new SoftMesh(flag, toonMaterial(PALETTE.red));   // double-sided copy
 *   scene.add(mesh);
 *   // per frame (after flag.step): mesh.sync();
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  BoxGeometry,
  Vector3,
} from 'three/webgpu';
import type { VerletBody } from '../physics/verlet';

/** A room-owned, double-sided copy of a material (cloth shows both faces). */
function twoSided(material: Material): Material {
  const m = material.clone();
  m.side = DoubleSide;
  m.userData.shared = false;
  return m;
}

export class SoftMesh extends Mesh<BufferGeometry, Material> {
  readonly body: VerletBody;
  private readonly positions: BufferAttribute;

  constructor(body: VerletBody, material: Material, o: { uv?: Float32Array; doubleSided?: boolean } = {}) {
    const geometry = new BufferGeometry();
    const positions = new BufferAttribute(new Float32Array(body.count * 3), 3);
    geometry.setAttribute('position', positions);
    if (o.uv) geometry.setAttribute('uv', new BufferAttribute(o.uv, 2));
    geometry.setIndex(new BufferAttribute(body.tris, 1));
    super(geometry, o.doubleSided === false ? material : twoSided(material));
    this.body = body;
    this.positions = positions;
    this.castShadow = true;
    this.receiveShadow = true;
    this.frustumCulled = false; // it moves every frame; its bounds would go stale
    this.sync();
  }

  /** Copy the particles into the mesh (call once per frame after stepping the body). */
  sync(): void {
    (this.positions.array as Float32Array).set(this.body.pos);
    this.positions.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

const UP = new Vector3(0, 1, 0);

export class RopeMesh extends InstancedMesh {
  readonly body: VerletBody;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly d = new Vector3();
  private readonly s = new Vector3();

  /** One box per segment (particle i to i + 1), `thickness` metres across. */
  constructor(body: VerletBody, material: Material, thickness = 0.06) {
    super(new BoxGeometry(thickness, 1, thickness), material, Math.max(1, body.count - 1));
    this.body = body;
    this.castShadow = true;
    this.frustumCulled = false;
    this.sync();
  }

  sync(): void {
    const p = this.body.pos;
    for (let i = 0; i + 1 < this.body.count; i++) {
      this.a.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
      this.b.set(p[i * 3 + 3]!, p[i * 3 + 4]!, p[i * 3 + 5]!);
      this.d.subVectors(this.b, this.a);
      const len = this.d.length();
      this.q.setFromUnitVectors(UP, len > 1e-6 ? this.d.divideScalar(len) : UP);
      this.s.set(1, len + 0.01, 1);
      this.m.compose(this.a.add(this.b).multiplyScalar(0.5), this.q, this.s);
      this.setMatrixAt(i, this.m);
    }
    this.instanceMatrix.needsUpdate = true;
  }
}
