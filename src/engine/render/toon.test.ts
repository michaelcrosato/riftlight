import { describe, expect, it } from 'vitest';
import {
  BufferAttribute,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  MeshToonNodeMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
} from 'three/webgpu';
import { pixelTexture, toonify, toonMaterial } from './toon';

/** A generated 2×2 checkerboard texture with smooth (linear, mipmapped) filtering, as GLTFLoader sets up. */
function checker(): DataTexture {
  const tex = new DataTexture(new Uint8Array([255, 205, 117, 255, 41, 54, 111, 255, 41, 54, 111, 255, 255, 205, 117, 255]), 2, 2, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

describe('toonify', () => {
  it('keeps a textured quad’s map, nearest-filtered', () => {
    const map = checker();
    const quad = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: 0xffffff, map }));
    toonify(quad);
    const mat = quad.material as unknown as MeshToonNodeMaterial;
    expect(mat).toBeInstanceOf(MeshToonNodeMaterial);
    expect(mat.map).toBe(map);
    expect(map.magFilter).toBe(NearestFilter);
    expect(map.minFilter).toBe(NearestFilter);
    expect(map.generateMipmaps).toBe(false);
    // The level's own texture: the material goes with the level (and leaves the cache).
    expect(mat.userData.shared).toBe(false);
    mat.dispose();
    expect(toonMaterial(0xffffff, { map })).not.toBe(mat);
  });

  it('keeps materials of shared (cached GLB) textures and untextured ones across unloads', () => {
    const map = checker();
    map.userData.shared = true;
    expect(toonMaterial(0x41a6f6, { map }).userData.shared).toBe(true);
    expect(toonMaterial(0x41a6f6).userData.shared).toBe(true);
  });

  it('keeps vertex colors when the geometry has them', () => {
    const geo = new PlaneGeometry(1, 1);
    geo.setAttribute('color', new BufferAttribute(new Float32Array(4 * 3).fill(0.5), 3));
    const colored = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true }));
    toonify(colored);
    expect((colored.material as unknown as MeshToonNodeMaterial).vertexColors).toBe(true);
    // A material asking for vertex colors on geometry without them gets a plain material.
    const plain = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ vertexColors: true }));
    toonify(plain);
    expect((plain.material as unknown as MeshToonNodeMaterial).vertexColors).toBe(false);
  });

  it('shares one material per color + texture + vertex-color combination', () => {
    const map = checker();
    expect(toonMaterial(0x38b764)).toBe(toonMaterial('#38b764'));
    expect(toonMaterial(0x38b764, { map })).toBe(toonMaterial(0x38b764, { map }));
    expect(toonMaterial(0x38b764, { map })).not.toBe(toonMaterial(0x38b764));
    expect(toonMaterial(0x38b764, { vertexColors: true })).not.toBe(toonMaterial(0x38b764));
    expect(pixelTexture(map).magFilter).toBe(NearestFilter);
  });
});
