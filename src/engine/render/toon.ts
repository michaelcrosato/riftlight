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
import { abs, clamp, float, floor, hash, materialEmissive, materialReference, max, mix, modelViewProjection, normalView, screenCoordinate, sign, step, uniform, vec4 } from 'three/tsl';

/**
 * PS1-style vertex snapping ("wobble"): clip-space vertices snap to the internal pixel
 * grid. Off by default; the `ps1` filter switches it on (PixelRenderer drives these).
 */
export const vertexSnap = {
  enabled: uniform(0),
  /** Internal resolution (art pixels). */
  resolution: uniform(new Vector2(480, 270)),
};

/**
 * The toon materials' vertex stage (clip position, snapped to the art grid while the `ps1`
 * filter is on). Exported so procedural toon materials (`colorNode` from attributes) keep
 * the same wobble as every other toon material.
 */
export function snappedClipPosition() {
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
  tex.userData.shared = true; // used by every toon material: never disposed by level unloads
  sharedGradient = tex;
  return tex;
}

const materialCache = new Map<string, MeshToonNodeMaterial>();

export interface ToonMaterialOptions {
  /** Base color texture. Switched to nearest filtering (crisp texels, no mip blur). */
  map?: Texture | null;
  /** Multiply by the geometry's `color` attribute (vertex colors). */
  vertexColors?: boolean;
  /**
   * A hard-banded rim light in this colour (hex) on grazing, upward-facing surfaces: a
   * silhouette that reads against dark floors (monsters in dark levels). Added to the
   * emissive, so `material.emissive` (hit flashes) still works on top. Same shader for
   * every rim colour (the colour is a uniform).
   */
  rim?: number;
  /**
   * Pixel dissolve: the material reads its own `dissolve` property (0 = solid, 1 = gone)
   * and discards a per-art-pixel noise pattern below it, with a 1-pixel glowing front in
   * the rim colour (or white). Set it on per-body clones (`material.dissolve = 0.4`), not on
   * the shared cached material.
   */
  dissolve?: boolean;
}

/** A toon material made with `dissolve: true` has this property. */
export type DissolvableMaterial = MeshToonNodeMaterial & { dissolve: number };

/** Rim band: surfaces whose view normal is this far from facing the camera light up. */
const RIM_THRESHOLD = 0.45;
const RIM_STRENGTH = 1;

function addRimAndDissolve(material: MeshToonNodeMaterial, rim: number | undefined, dissolve: boolean): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- node slots and TSL operators aren't typed on Node
  const mat = material as any;
  const rimColor = uniform(new Color(rim ?? 0xffffff));
  if (rim !== undefined) {
    // 1 − n·v in view space (orthographic and perspective alike: the view axis is +Z),
    // hard-banded like the toon ramp; only surfaces facing sideways or up (a back/top light)
    const nz = clamp(normalView.z, 0, 1);
    const band = step(RIM_THRESHOLD, float(1).sub(nz)).mul(step(-0.15, normalView.y));
    mat.emissiveNode = materialEmissive.add(rimColor.mul(band.mul(RIM_STRENGTH)));
  }
  if (dissolve) {
    (mat as DissolvableMaterial).dissolve = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TSL operators aren't typed on reference nodes
    const amount: any = materialReference('dissolve', 'float');
    const noise = hash(floor(screenCoordinate.x).add(floor(screenCoordinate.y).mul(1291)));
    mat.maskNode = noise.greaterThanEqual(amount);
    // the front: a pixel band just above the threshold glows
    const front = step(noise, amount.add(0.08)).mul(step(0.001, amount));
    mat.emissiveNode = (mat.emissiveNode ?? materialEmissive).add(rimColor.mul(front.mul(2)));
  }
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
 * vertex-colored (color × map × vertex color), cached per combination. Untextured ones
 * (and ones whose texture is itself shared, e.g. from a cached GLB) are marked
 * `userData.shared`, so level unloads keep them; a material with a level's own texture is
 * disposed with the level, and disposing it drops it from the cache.
 */
export function toonMaterial(color: ColorRepresentation, options: ToonMaterialOptions = {}): MeshToonNodeMaterial {
  const hex = new Color(color).getHex();
  const map = options.map ?? null;
  const vertexColors = options.vertexColors === true;
  const key = `${hex}|${map?.uuid ?? ''}|${vertexColors ? 'vc' : ''}|${options.rim ?? ''}|${options.dissolve ? 'd' : ''}`;
  let mat = materialCache.get(key);
  if (!mat) {
    mat = new MeshToonNodeMaterial({ color: hex, gradientMap: toonGradient(), map: map ? pixelTexture(map) : null, vertexColors });
    mat.vertexNode = snappedClipPosition();
    if (options.rim !== undefined || options.dissolve) addRimAndDissolve(mat, options.rim, options.dissolve === true);
    mat.name = `toon-${hex.toString(16).padStart(6, '0')}${map ? '-tex' : ''}${vertexColors ? '-vc' : ''}${options.rim !== undefined ? '-rim' : ''}${options.dissolve ? '-dis' : ''}`;
    mat.userData.shared = !map || map.userData.shared === true;
    materialCache.set(key, mat);
    const cached = mat;
    mat.addEventListener('dispose', () => {
      if (materialCache.get(key) === cached) materialCache.delete(key);
    });
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
