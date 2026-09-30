import {
  BasicShadowMap,
  type Camera,
  NoToneMapping,
  RenderPipeline,
  RenderTarget,
  type Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js';
import { type Framing, type Resolution, RESOLUTIONS, computeFraming } from '../framing';
import { installWebGPUCompat } from './webgpuCompat';

export type BackendName = 'WebGPU' | 'WebGL 2 fallback';
export type RenderMode = 'pixel' | 'raw';

export interface EdgeSettings {
  /** Silhouette / depth-discontinuity outline darkening, 0..1. */
  depth: number;
  /** Internal crease highlight from normal discontinuities, 0..1. Keep weak. */
  normal: number;
}

export const DEFAULT_EDGES: EdgeSettings = { depth: 0.45, normal: 0.08 };

export interface PixelRendererOptions {
  container: HTMLElement;
  scene: Scene;
  camera: Camera;
  resolution?: Resolution;
  mode?: RenderMode;
  edges?: EdgeSettings;
  /** Debug/test override: skip native WebGPU and use WebGPURenderer's WebGL 2 backend. */
  forceWebGL?: boolean;
}

export interface CapturedFrame {
  width: number;
  height: number;
  /** Tightly packed RGBA8, top row first, sRGB-encoded (exactly what is presented). */
  pixels: Uint8Array;
}

export interface GpuErrorRecord {
  api: string;
  type: string;
  message: string;
}

/**
 * One WebGPURenderer, one RenderPipeline, two output nodes.
 *
 * Pixel mode:  toon/node scene → pixelationPass (scene pass at internal res into a
 *              nearest-filtered MRT target, then depth/normal edge detection in TSL)
 *              → RenderPipeline output color transform → nearest-neighbor presentation
 *              at an integer multiple of the internal resolution.
 * Raw mode:    the same scene/camera through a plain full-resolution `pass()`; same
 *              pipeline, same canvas size, same framing. Only `outputNode` changes.
 *
 * Native WebGPU is always attempted first; WebGPURenderer falls back to its built-in
 * WebGL 2 backend when WebGPU is unavailable. There is no second renderer.
 */
export class PixelRenderer {
  readonly renderer: WebGPURenderer;
  readonly pipeline: RenderPipeline;
  readonly container: HTMLElement;
  readonly gpuErrors: GpuErrorRecord[] = [];
  backend: BackendName = 'WebGPU';
  /** Why the WebGL 2 backend is active, when it is. */
  fallbackReason: string | null = null;
  framing!: Framing;

  private _mode: RenderMode;
  private _resolution: Resolution;
  private readonly pixelSize = uniform(1);
  private readonly depthEdge = uniform(DEFAULT_EDGES.depth);
  private readonly normalEdge = uniform(DEFAULT_EDGES.normal);
  private readonly pixelNode;
  private readonly rawNode;
  private readonly onResize = () => this.layout();
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private captureTarget: RenderTarget | null = null;

  private constructor(options: PixelRendererOptions) {
    installWebGPUCompat();
    this.container = options.container;
    this._mode = options.mode ?? 'pixel';
    this._resolution = options.resolution ?? RESOLUTIONS.default;
    const edges = options.edges ?? DEFAULT_EDGES;
    this.depthEdge.value = edges.depth;
    this.normalEdge.value = edges.normal;

    this.renderer = new WebGPURenderer({
      antialias: false,
      forceWebGL: options.forceWebGL === true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = NoToneMapping; // flat palette colors, not photographic
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = BasicShadowMap; // hard-edged shadows suit pixel art
    this.renderer.setPixelRatio(1); // framing works in device pixels itself
    this.renderer.onError = ((info: unknown) => this.recordGpuError(info)) as never;

    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.imageRendering = 'pixelated';
    canvas.dataset.engineCanvas = 'true';
    this.container.appendChild(canvas);

    this.pixelNode = pixelationPass(options.scene, options.camera, this.pixelSize, this.normalEdge, this.depthEdge);
    this.rawNode = pass(options.scene, options.camera);
    this.pipeline = new RenderPipeline(this.renderer, this.outputFor(this._mode));
    this.pipeline.outputColorTransform = true;
  }

  static async create(options: PixelRendererOptions): Promise<PixelRenderer> {
    const pr = new PixelRenderer(options);
    const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
    await pr.renderer.init();
    const backend = pr.renderer.backend as { isWebGPUBackend?: boolean };
    pr.backend = backend.isWebGPUBackend === true ? 'WebGPU' : 'WebGL 2 fallback';
    if (pr.backend !== 'WebGPU') {
      pr.fallbackReason = options.forceWebGL
        ? 'forced by ?backend=webgl'
        : gpuAvailable
          ? 'WebGPU adapter/device request failed'
          : 'navigator.gpu unavailable';
    }
    pr.layout();
    pr.observeLayout();
    return pr;
  }

  get mode(): RenderMode {
    return this._mode;
  }

  setMode(mode: RenderMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.pipeline.outputNode = this.outputFor(mode);
    this.pipeline.needsUpdate = true;
  }

  toggleMode(): RenderMode {
    this.setMode(this._mode === 'pixel' ? 'raw' : 'pixel');
    return this._mode;
  }

  get resolution(): Resolution {
    return this._resolution;
  }

  setResolution(resolution: Resolution): void {
    this._resolution = resolution;
    this.layout();
  }

  get edges(): EdgeSettings {
    return { depth: this.depthEdge.value, normal: this.normalEdge.value };
  }

  setEdges(edges: Partial<EdgeSettings>): void {
    if (edges.depth !== undefined) this.depthEdge.value = edges.depth;
    if (edges.normal !== undefined) this.normalEdge.value = edges.normal;
  }

  /** Recompute integer-scaled, letterboxed canvas layout for the current viewport. */
  layout(): void {
    const rect = this.container.getBoundingClientRect();
    const f = computeFraming(rect.width, rect.height, window.devicePixelRatio, this._resolution);
    this.framing = f;
    this.pixelSize.value = f.scale; // pixelation pass renders at canvas / scale = internal res
    this.renderer.setSize(f.canvasWidth, f.canvasHeight, false);
    const style = this.renderer.domElement.style;
    style.width = `${f.cssWidth}px`;
    style.height = `${f.cssHeight}px`;
    style.left = `${f.offsetX}px`;
    style.top = `${f.offsetY}px`;
  }

  /** Relayout when the container resizes or the device pixel ratio changes (zoom, monitor move). */
  private observeLayout(): void {
    window.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.onResize);
      this.resizeObserver.observe(this.container);
    }
    const watchDpr = () => {
      this.dprQuery?.removeEventListener('change', onDprChange);
      this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      this.dprQuery.addEventListener('change', onDprChange);
    };
    const onDprChange = () => {
      watchDpr();
      this.layout();
    };
    watchDpr();
  }

  render(): void {
    this.pipeline.render();
  }

  /**
   * Render the current frame through the full pipeline into an offscreen target and read
   * it back. Output is identical to what the canvas presents (same pipeline, same size),
   * so tests and agents can inspect frames even where canvas screenshots don't work.
   */
  async capture(): Promise<CapturedFrame> {
    const { canvasWidth: width, canvasHeight: height } = this.framing;
    const target = (this.captureTarget ??= new RenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false }));
    target.setSize(width, height);
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.pipeline.render();
    this.renderer.setRenderTarget(previous);
    const raw = (await this.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Uint8Array;

    // WebGPU pads rows to 256 bytes; WebGL returns rows bottom-up.
    const row = width * 4;
    const stride = raw.length >= (height - 1) * Math.ceil(row / 256) * 256 + row && row % 256 !== 0 ? Math.ceil(row / 256) * 256 : row;
    const flip = this.backend !== 'WebGPU';
    const pixels = new Uint8Array(row * height);
    for (let y = 0; y < height; y++) {
      const src = (flip ? height - 1 - y : y) * stride;
      pixels.set(raw.subarray(src, src + row), y * row);
    }
    return { width, height, pixels };
  }

  setAnimationLoop(callback: ((time: number) => void) | null): void {
    void this.renderer.setAnimationLoop(callback);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.dprQuery = null;
    this.renderer.setAnimationLoop(null);
    this.pipeline.dispose();
    this.captureTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private outputFor(mode: RenderMode) {
    return mode === 'pixel' ? this.pixelNode : this.rawNode;
  }

  private recordGpuError(info: unknown): void {
    const i = (info ?? {}) as Partial<GpuErrorRecord>;
    const record = { api: i.api ?? 'unknown', type: i.type ?? 'error', message: i.message ?? String(info) };
    this.gpuErrors.push(record);
    console.error(`[PixelRenderer] ${record.api} ${record.type}: ${record.message}`);
  }
}
