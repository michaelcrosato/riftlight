import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeStaticMeshes } from './merge';

const top = new MeshBasicNodeMaterial({ name: 'top' });
const side = new MeshBasicNodeMaterial({ name: 'side' });
const box = (x: number, y = 0, z = 0) => {
  const m = new Mesh(new BoxGeometry(1, 2, 1), [side, side, top, side, side, side]);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const triangles = (m: Mesh) => m.geometry.getAttribute('position').count / 3;

describe('mergeStaticMeshes', () => {
  it('turns N multi-material boxes into one mesh per material', () => {
    const merged = mergeStaticMeshes([box(0), box(5), box(-5, 1, 2)]);
    expect(merged.map((m) => m.material)).toEqual([side, top]);
    const [s, t] = merged as [Mesh, Mesh];
    expect(triangles(t)).toBe(3 * 2); // one top face (2 triangles) per box
    expect(triangles(s)).toBe(3 * 10);
    expect(s.castShadow && s.receiveShadow).toBe(true);
  });

  it('bakes world transforms (including parents and rotation)', () => {
    const parent = new Group();
    parent.position.set(10, 0, 0);
    const b = box(1, 1, 0);
    b.rotation.z = Math.PI / 2; // 2 tall becomes 2 wide
    parent.add(b);
    const [s, t] = mergeStaticMeshes([parent]) as [Mesh, Mesh];
    const bounds = new Box3().setFromBufferAttribute(s.geometry.getAttribute('position') as never).union(
      new Box3().setFromBufferAttribute(t.geometry.getAttribute('position') as never),
    );
    expect(bounds.min.x).toBeCloseTo(10);
    expect(bounds.max.x).toBeCloseTo(12);
    expect(bounds.min.y).toBeCloseTo(0.5);
    expect(bounds.max.y).toBeCloseTo(1.5);
    // Normals are rotated too: the "top" face now points along -x.
    const n = t.geometry.getAttribute('normal');
    expect(n.getX(0)).toBeCloseTo(-1);
  });

  it('keeps meshes with different shadow flags apart', () => {
    const a = box(0);
    const b = box(2);
    b.castShadow = false;
    expect(mergeStaticMeshes([a, b])).toHaveLength(4);
    expect(mergeStaticMeshes([a, b], { castShadow: true })).toHaveLength(2);
  });
});
