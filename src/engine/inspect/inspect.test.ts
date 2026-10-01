import { describe, expect, it } from 'vitest';
import { Bone, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three/webgpu';
import { diffReports, inspectObject, renderInspection, renderTurntable, renderView } from './index';

const box = (w: number, h: number, d: number, color = 0x3b5dc9) => {
  const m = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color }));
  m.position.y = h / 2;
  return m;
};

/** Pixels within a small distance of `colour`. */
const inked = (img: { data: Uint8ClampedArray }, colour: [number, number, number]) => {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (Math.abs(img.data[i]! - colour[0]) + Math.abs(img.data[i + 1]! - colour[1]) + Math.abs(img.data[i + 2]! - colour[2]) < 40) n++;
  return n;
};

describe('inspect: report', () => {
  it('counts triangles, vertices, draw calls, materials and bounds', () => {
    const g = new Group();
    g.name = 'crate';
    g.add(box(1, 2, 1), box(0.5, 0.5, 0.5, 0xef7d57));
    const r = inspectObject(g);
    expect(r.triangles).toBe(24);
    expect(r.vertices).toBe(48);
    expect(r.meshes).toBe(2);
    expect(r.drawCalls).toBe(2); // a BoxGeometry's groups don't split a single material
    expect(r.materials).toHaveLength(2);
    expect(r.bounds.size).toEqual([1, 2, 1]);
    expect(r.warnings).toEqual([]);
  });

  it('warns about degenerate triangles, missing normals, scale, floor and heavy assets', () => {
    const g = new Group();
    const flat = new BufferGeometry();
    flat.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, -1, 0, 1, -1, 0, 0, -1, 1], 3));
    g.add(new Mesh(flat, new MeshBasicMaterial()));
    const squashed = new Group();
    squashed.scale.set(1, 2, 1);
    squashed.add(box(1, 1, 1));
    g.add(squashed);
    const r = inspectObject(g, { limits: { maxTriangles: 5 } });
    const text = r.warnings.join('\n');
    expect(text).toMatch(/1 degenerate/);
    expect(text).toMatch(/missing normals/);
    expect(text).toMatch(/non-uniform scale/);
    expect(text).toMatch(/below the floor/);
    expect(text).toMatch(/triangles \(> 5\)/);
  });

  it('finds joints that drive nothing: unweighted bones and rig joints with no mesh', () => {
    const root = new Bone();
    root.name = 'Root';
    const tip = new Bone();
    tip.name = 'Tip';
    root.add(tip);
    const geo = new BoxGeometry(1, 1, 1);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4));
    const sm = new SkinnedMesh(geo, new MeshStandardMaterial());
    sm.add(root);
    sm.bind(new Skeleton([root, tip]));
    const r = inspectObject(sm);
    expect(r.skinned).toBe(true);
    expect(r.joints).toEqual(['Root', 'Tip']);
    expect(r.warnings.join()).toMatch(/1 joints with no vertex weights \(Tip\)/);

    const rig = new Group();
    const arm = new Group();
    arm.name = 'Arm';
    const jaw = new Group();
    jaw.name = 'Jaw';
    arm.add(box(0.2, 1, 0.2));
    rig.add(arm, jaw);
    expect(inspectObject(rig, { joints: ['Arm', 'Jaw'] }).warnings.join()).toMatch(/no mesh under them \(Jaw\)/);
  });

  it('lists clips and diffs two versions', () => {
    const a = new Group();
    a.add(box(1, 1, 1));
    const b = new Group();
    b.add(box(1, 1, 1), box(1, 3, 1, 0xff0000));
    const ra = inspectObject(a, { name: 'a', clips: [{ name: 'Idle', duration: 2 }] });
    const rb = inspectObject(b, { name: 'b', clips: [{ name: 'Idle', duration: 2.5 }, { name: 'Run', duration: 0.4 }] });
    expect(ra.fingerprint).not.toBe(rb.fingerprint);
    expect(inspectObject(a, { name: 'a', clips: [{ name: 'Idle', duration: 2 }] }).fingerprint).toBe(ra.fingerprint);
    const d = diffReports(ra, rb);
    expect(d.same).toBe(false);
    expect(d.counts.triangles).toEqual([12, 24, 12]);
    expect(d.counts['size.y']).toEqual([1, 3, 2]);
    expect(d.clips.added).toEqual(['Run']);
    expect(d.clips.changed).toEqual(['Idle 2s → 2.5s']);
  });
});

describe('inspect: render', () => {
  it('draws a turntable at one scale: a tall box is as tall from every side', () => {
    const g = new Group();
    g.add(box(0.5, 2, 0.5, 0xff0000));
    const views = renderTurntable(g, { angles: 8, size: 120 });
    expect(views).toHaveLength(8);
    const counts = views.map((v) => inked(v, [255, 0, 0]) + inked(v, [184, 0, 0]) + inked(v, [107, 0, 0]));
    for (const c of counts) expect(c).toBeGreaterThan(200);
    // a square column: front and side views cover about the same area
    expect(Math.abs(counts[0]! - counts[2]!) / counts[0]!).toBeLessThan(0.15);
  });

  it('overlays joints and composes the sheet', () => {
    const g = new Group();
    const arm = new Group();
    arm.name = 'ArmR';
    arm.position.set(-0.4, 1, 0);
    arm.add(box(0.2, 0.6, 0.2));
    g.add(box(0.6, 1.2, 0.4), arm);
    const v = renderView(g, { width: 160, height: 160, joints: ['ArmR'], names: true, dim: 0.6 });
    expect(inked(v, [239, 125, 87])).toBeGreaterThan(3); // the right-side joint colour
    const sheet = renderInspection(g, inspectObject(g, { joints: ['ArmR'] }), { angles: 4, size: 100 });
    expect(sheet.width).toBeGreaterThan(400);
    expect(sheet.height).toBeGreaterThan(300);
  });
});
