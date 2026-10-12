import { createHash } from 'node:crypto';
import type { BufferAttribute, Material, Mesh, Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { buildMonster, designedBoss, generateGenome } from '.';
import { buildBoss } from './bosses';

/**
 * Monster bodies, hashed: every mesh's attributes and indices, world matrix and material
 * colour, for the 12 designed bosses and 20 seeded monsters. Their unit geometry lives in
 * the engine (`src/engine/model/geometry.ts`); this proves a change there (or here) leaves
 * the bodies identical, or shows which ones moved. Floats are rounded to 1e-6 first, because
 * V8's Math functions differ in the last bit between Node versions.
 *
 * An intended change to how monsters look updates the snapshot: `npx vitest run -u` (and say
 * so in the PR).
 */
const round = (v: number) => Math.round(v * 1e6) + 0; // + 0 turns -0 into 0

function bodyHash(root: Object3D): string {
  root.updateMatrixWorld(true);
  const h = createHash('sha256');
  const floats = (values: ArrayLike<number>) => h.update(new Float64Array(Array.from(values, round)));
  root.traverse((o) => {
    h.update(`${o.name}|${o.type}|`);
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    floats(mesh.matrixWorld.elements);
    const g = mesh.geometry;
    for (const name of Object.keys(g.attributes).sort()) {
      const a = g.getAttribute(name) as BufferAttribute;
      h.update(`${name}:${a.itemSize}:${a.count}|`);
      floats(a.array as ArrayLike<number>);
    }
    const index = g.getIndex();
    if (index) h.update(new Float64Array(index.array as ArrayLike<number>));
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & { color?: { getHex(): number } })[]) {
      h.update(`${m.type}|${m.name}|${m.color?.getHex() ?? ''}|`);
    }
  });
  return h.digest('hex').slice(0, 16);
}

describe('monster bodies', () => {
  it('match their recorded hashes (bosses 1-12, 20 seeded monsters)', () => {
    const hashes: Record<string, string> = {};
    for (let level = 1; level <= 12; level++) hashes[`boss ${level}`] = bodyHash(buildBoss(designedBoss(level)).object);
    for (let i = 0; i < 20; i++) {
      const genome = generateGenome(new Rng(`body:${i}`), { depth: 1 + i * 3, rank: i % 5 === 4 ? 'rare' : i % 3 === 2 ? 'magic' : 'normal' });
      hashes[`monster ${i}`] = bodyHash(buildMonster(genome).object);
    }
    expect(hashes).toMatchSnapshot();
  });
});
