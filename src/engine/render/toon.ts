import {
  Color,
  type ColorRepresentation,
  DataTexture,
  type Material,
  type Mesh,
  MeshToonNodeMaterial,
  NearestFilter,
  type Object3D,
  RedFormat,
} from 'three/webgpu';

/**
 * 3-band toon ramp (shadow / mid / lit). Sampled with NearestFilter so light falls
 * off in hard bands, the way hand-shaded sprites look. Values are 0..255 intensity.
 */
export const TOON_BANDS = [96, 176, 255] as const;

let sharedGradient: DataTexture | null = null;

export function toonGradient(): DataTexture {
  if (sharedGradient) return sharedGradient;
  const tex = new DataTexture(new Uint8Array(TOON_BANDS), TOON_BANDS.length, 1, RedFormat);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  sharedGradient = tex;
  return tex;
}

const materialCache = new Map<number, MeshToonNodeMaterial>();

/** Shared 3-band toon node material for a palette color. */
export function toonMaterial(color: ColorRepresentation): MeshToonNodeMaterial {
  const key = new Color(color).getHex();
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new MeshToonNodeMaterial({ color: key, gradientMap: toonGradient() });
    mat.name = `toon-${key.toString(16).padStart(6, '0')}`;
    materialCache.set(key, mat);
  }
  return mat;
}

export interface ToonifyOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Replace every mesh material under `root` with the shared toon material of the same base
 * color. Makes any GLB (or hand-built mesh) match the engine's look without per-asset work.
 */
export function toonify(root: Object3D, options: ToonifyOptions = {}): Object3D {
  const { castShadow = true, receiveShadow = true } = options;
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: Material) => {
      const color = (m as Material & { color?: Color }).color ?? new Color(0xffffff);
      return toonMaterial(color);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
  });
  return root;
}
