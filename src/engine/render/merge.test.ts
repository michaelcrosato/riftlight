import { describe, expect, it } from 'vitest';
import { Box3, BoxGeometry, BufferAttribute, DataTexture, Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
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

  it('keeps uv under a textured material and color under a vertex-coloured one', () => {
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const textured = new MeshBasicNodeMaterial({ map });
    const painted = new MeshBasicNodeMaterial({ vertexColors: true });
    const geo = () => {
      const g = new BoxGeometry(1, 1, 1);
      g.setAttribute('color', new BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(0.5), 3));
      return g;
    };
    const a = new Mesh(geo(), textured);
    const b = new Mesh(geo(), textured);
    b.position.x = 3;
    const c = new Mesh(geo(), painted);
    const [t, p] = mergeStaticMeshes([a, b, c]) as [Mesh, Mesh];
    expect(t.material).toBe(textured);
    expect(Object.keys(t.geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    const uv = t.geometry.getAttribute('uv');
    expect(uv.count).toBe(t.geometry.getAttribute('position').count);
    // the second box's UVs are the first's (UVs don't move with the transform)
    expect(uv.getX(uv.count / 2)).toBe(uv.getX(0));
    expect(Object.keys(p.geometry.attributes).sort()).toEqual(['color', 'normal', 'position']);
    expect(p.geometry.getAttribute('color').getX(0)).toBe(0.5);
    // a textured material on geometry without uv merges apart instead of failing
    const bare = new Mesh(geo().deleteAttribute('uv'), textured);
    expect(mergeStaticMeshes([a, bare])).toHaveLength(2);
  });
});
