/**
 * A second camera's view rendered into a texture: security monitors, a minimap, a scope, the
 * far side of a portal. Each frame (or every few) the view draws the scene from its own camera
 * into a small render target before the main frame renders; any material can show
 * `view.texture`, and the pixel pass then pixelates the screen like everything else.
 *
 *   const cam = new RenderView({ size: [160, 90], fov: 60, every: 2 });
 *   cam.camera.position.set(4, 3, 4); cam.camera.lookAt(0, 1, 0);
 *   const stop = cam.attach(engine.renderer, scene);   // renders before each frame
 *   screen.material = cam.screenMaterial();             // and screen.layers.set(SCREEN_LAYER)
 *
 * Screens (and mirrors) go on `SCREEN_LAYER`: the main camera always sees it, views never
 * do, so a texture is never sampled while it is being drawn (and views don't recurse).
 */
import { HalfFloatType, MeshBasicNodeMaterial, NearestFilter, type Object3D, PerspectiveCamera, RenderTarget, type Scene, type Texture, type WebGPURenderer } from 'three/webgpu';
import { texture } from 'three/tsl';

/** The layer for screens and mirrors: drawn by the main camera, never by a RenderView. */
export const SCREEN_LAYER = 2;

export interface RenderViewOptions {
  /** Texture size in pixels (default [160, 90]). */
  size?: readonly [number, number];
  /** Vertical field of view, degrees (default 60). */
  fov?: number;
  near?: number;
  far?: number;
  /** Render every nth frame (default 1): a slow refresh costs less. */
  every?: number;
}

export class RenderView {
  readonly target: RenderTarget;
  readonly camera: PerspectiveCamera;
  /** Render every nth frame. */
  every: number;
  /** Times it has rendered. */
  renders = 0;
  enabled = true;
  private frame = 0;

  constructor(o: RenderViewOptions = {}) {
    const [w, h] = o.size ?? [160, 90];
    this.target = new RenderTarget(w, h, { depthBuffer: true, type: HalfFloatType }); // linear colour: 8 bits would band the darks
    this.target.texture.minFilter = this.target.texture.magFilter = NearestFilter; // pixels, not blur
    this.camera = new PerspectiveCamera(o.fov ?? 60, w / h, o.near ?? 0.1, o.far ?? 200);
    this.camera.layers.set(0); // never the screens' layer
    this.every = Math.max(1, Math.round(o.every ?? 1));
  }

  get texture(): Texture {
    return this.target.texture;
  }

  /** Resize the texture (the camera's aspect follows). */
  setSize(w: number, h: number): void {
    this.target.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draw `scene` from the view's camera into its texture, if this is one of its frames. True if it drew. */
  render(renderer: WebGPURenderer, scene: Scene): boolean {
    if (!this.enabled || this.frame++ % this.every !== 0) return false;
    const previous = renderer.getRenderTarget();
    this.camera.updateMatrixWorld();
    renderer.setRenderTarget(this.target);
    try {
      renderer.render(scene, this.camera);
    } finally {
      renderer.setRenderTarget(previous); // even if it threw: the frame must not draw into the view
    }
    this.renders++;
    return true;
  }

  /** Render before every frame of `pixel` (the engine's PixelRenderer). Returns a stop. */
  attach(pixel: { onBeforeRender(f: () => void): () => void; renderer: WebGPURenderer }, scene: Scene): () => void {
    return pixel.onBeforeRender(() => this.render(pixel.renderer, scene));
  }

  /** An unlit material showing the view (a new one each call: tint it as you like). */
  screenMaterial(): MeshBasicNodeMaterial {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = texture(this.target.texture);
    return m;
  }

  /** Put `object` (and its children) on the screens' layer. */
  static screen(object: Object3D): void {
    object.traverse((o) => o.layers.set(SCREEN_LAYER));
  }

  dispose(): void {
    this.target.dispose();
  }
}
