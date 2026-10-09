import { describe, expect, it } from 'vitest';
import { Matrix4, MeshBasicNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { clothGrid, ropeLine } from '../physics/verlet';
import { RopeMesh, SoftMesh } from './softMesh';

describe('soft body meshes', () => {
  it('SoftMesh follows the cloth particles and owns a two-sided copy of the material', () => {
    const cloth = clothGrid({ width: 2, height: 1, cols: 5, rows: 3, origin: [0, 3, 0] });
    const material = new MeshBasicNodeMaterial();
    const mesh = new SoftMesh(cloth, material, { uv: cloth.uv });
    expect(mesh.material).not.toBe(material);
    expect(mesh.material.side).toBe(2); // DoubleSide
    expect(mesh.geometry.index!.count).toBe(cloth.tris.length);
    for (let k = 0; k < 30; k++) cloth.step(1 / 60);
    mesh.sync();
    const pos = mesh.geometry.getAttribute('position');
    const last = cloth.count - 1;
    expect(pos.getY(last)).toBeCloseTo(cloth.pos[last * 3 + 1]!, 6);
  });

  it('RopeMesh puts one box on every segment, end to end', () => {
    const rope = ropeLine([0, 4, 0], [0, 0, 0], 4);
    const mesh = new RopeMesh(rope, new MeshBasicNodeMaterial(), 0.05);
    expect(mesh.count).toBe(rope.count - 1);
    const m = new Matrix4();
    const at = new Vector3();
    const scale = new Vector3();
    mesh.getMatrixAt(0, m);
    m.decompose(at, new Quaternion(), scale);
    expect(at.y).toBeCloseTo(3.5, 1); // between particles 0 (y 4) and 1 (y 3)
    expect(scale.y).toBeCloseTo(1, 1); // one metre long
  });
});
