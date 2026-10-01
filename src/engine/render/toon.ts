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
  type Texture,
  Vector2,
} from 'three/webgpu';
import { abs, floor, max, mix, modelViewProjection, sign, uniform, vec4 } from 'three/tsl';

/**
 * PS1-style vertex snapping ("wobble"): clip-space vertices snap to the internal pixel
 * grid. Off by default; the `ps1` filter switches it on (PixelRenderer drives these).
 */
export const vertexSnap = {
  enabled: uniform(0),
  /** Internal resolution (art pixels). */
  resolution: uniform(new Vector2(480, 270)),
};

function snappedClipPosition() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL swizzles aren't typed on Node
  const clip = modelViewProjection as any;
  const half = vertexSnap.resolution.mul(0.5) as typeof clip;
  // |w| ≥ 1e-5 (keeping its sign) so vertices at the eye plane can't turn into NaN.
  const w = max(abs(clip.w), 1e-5).mul(sign(sign(clip.w).add(0.5))) as typeof clip;
  const snapped: typeof clip = floor(clip.xy.div(w).mul(half).add(0.5)).div(half).mul(w);
  // Branch-free on purpose: a select() here let TSL scope `clip` inside one branch, which
  // collapsed every vertex whenever snapping was off.
  return vec4(mix(clip.xy, snapped, vertexSnap.enabled), clip.z, clip.w);
}

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

const materialCache = new Map<string, MeshToonNodeMaterial>();

export interface ToonMaterialOptions {
  /** Base color texture. Switched to nearest filtering (crisp texels, no mip blur). */
  map?: Texture | null;
  /** Multiply by the geometry's `color` attribute (vertex colors). */
  vertexColors?: boolean;
}

/**
 * Make a texture pixel-art friendly: nearest-neighbor sampling, no mipmaps. Returns it.
 */
export function pixelTexture<T extends Texture>(texture: T): T {
  if (texture.magFilter !== NearestFilter || texture.minFilter !== NearestFilter || texture.generateMipmaps) {
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }
  return texture;
}

/**
 * Shared 3-band toon node material for a palette color, optionally textured and/or
 * vertex-colored (color × map × vertex color). Materials are cached per combination and
 * marked `userData.shared` so level unloads never dispose them.
 */
export function toonMaterial(color: ColorRepresentation, options: ToonMaterialOptions = {}): MeshToonNodeMaterial {
  const hex = new Color(color).getHex();
  const map = options.map ?? null;
  const vertexColors = options.vertexColors === true;
  const key = `${hex}|${map?.uuid ?? ''}|${vertexColors ? 'vc' : ''}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new MeshToonNodeMaterial({ color: hex, gradientMap: toonGradient(), map: map ? pixelTexture(map) : null, vertexColors });
    mat.vertexNode = snappedClipPosition();
    mat.name = `toon-${hex.toString(16).padStart(6, '0')}${map ? '-tex' : ''}${vertexColors ? '-vc' : ''}`;
    mat.userData.shared = true;
    materialCache.set(key, mat);
  }
  return mat;
}

export interface ToonifyOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

type SourceMaterial = Material & { color?: Color; map?: Texture | null; vertexColors?: boolean };

/**
 * Replace every mesh material under `root` with the shared toon material of the same base
 * color, keeping its base color texture (`map`, nearest-filtered) and vertex colors. Makes
 * any GLB (or hand-built mesh) match the engine's look without per-asset work.
 */
export function toonify(root: Object3D, options: ToonifyOptions = {}): Object3D {
  const { castShadow = true, receiveShadow = true } = options;
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const hasColors = !!mesh.geometry?.getAttribute?.('color');
    const swap = (m: Material) => {
      const src = m as SourceMaterial;
      return toonMaterial(src.color ?? new Color(0xffffff), { map: src.map ?? null, vertexColors: src.vertexColors === true && hasColors });
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
  });
  return root;
}
