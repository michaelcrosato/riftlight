import {
  BasicShadowMap,
  type Camera,
  HalfFloatType,
  NearestFilter,
  Node,
  NoToneMapping,
  type PassNode,
  RenderPipeline,
  RenderTarget,
  type RTTNode,
  type Scene,
  SRGBColorSpace,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';
import { convertToTexture, float, pass, renderOutput, rtt, uniform } from 'three/tsl';
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js';
import { type AspectMode, type Framing, type Resolution, RESOLUTIONS, computeFraming } from '../framing';
import { FILTERS, type FilterContext, applyFilters, getFilter, splitFilters } from './filters';
import { vertexSnap } from './toon';
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
  /** `adaptive` (default): the art width follows the screen's aspect. `fixed`: always `resolution`. */
  aspect?: AspectMode;
  mode?: RenderMode;
  edges?: EdgeSettings;
  /** Post filters (ids from FILTERS), applied in order in Pixel mode. */
  filters?: readonly string[];
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

/** A built output graph plus the GPU resources only it owns (disposed on eviction). */
interface OutputEntry {
  node: Node;
  /** Art-resolution render targets of this graph (resized on layout). */
  artTargets: RTTNode[];
}

const OUTPUT_CACHE_SIZE = 8;

/**
 * One WebGPURenderer, one RenderPipeline, two output nodes.
 *
 * Pixel mode:  toon/node scene → scene pass at the art resolution (nearest-filtered MRT:
 *              color + normal + depth) → art-resolution stage: depth/normal edges, output
 *              color transform, then every *art-pixel* filter (palettes, dither, colour
 *              grades…) into one art-sized target → ONE nearest-neighbour upscale to the
 *              canvas (an integer multiple of the art resolution) → *display* filters
 *              (scanlines, LCD grid, CRT…) at device resolution, only when there are any.
 * Raw mode:    the same scene/camera through a plain full-resolution `pass()` and the
 *              output color transform only; same pipeline, same canvas size, same
 *              framing. Only `outputNode` changes.
 *
 * So the per-fragment cost at device resolution is one texture read unless a display
 * filter is active; the edge detection (~10 reads) and palette searches run 1/scale² as
 * often as they used to.
 *
 * Native WebGPU is always attempted first; WebGPURenderer falls back to its built-in
 * WebGL 2 backend when WebGPU is unavailable. There is no second renderer, except that a
 * lost GPU device (mobile browsers drop it after backgrounding or under memory pressure)
 * is replaced by a fresh renderer + pipeline on a fresh canvas (`recoveries` counts them).
 */
export class PixelRenderer {
  readonly container: HTMLElement;
  readonly gpuErrors: GpuErrorRecord[] = [];
  backend: BackendName = 'WebGPU';
  /** Why the WebGL 2 backend is active, when it is. */
  fallbackReason: string | null = null;
  framing!: Framing;
  /** How many times a lost GPU device / WebGL context was recovered from. */
  recoveries = 0;
  /** Called after a lost device was recovered with a new renderer and canvas. */
  onRecovered: ((canvas: HTMLCanvasElement) => void) | null = null;

  private _renderer!: WebGPURenderer;
  private _pipeline!: RenderPipeline;
  private pixelNode!: PassNode;
  private rawNode!: PassNode;
  private readonly scene: Scene;
  private camera: Camera;
  private readonly forceWebGL: boolean;
  private _mode: RenderMode;
  private _baseResolution: Resolution;
  private _resolution: Resolution;
  private _aspect: AspectMode;
  private readonly pixelSize = uniform(1);
  private readonly depthEdge = uniform(DEFAULT_EDGES.depth);
  private readonly normalEdge = uniform(DEFAULT_EDGES.normal);
  private _filters: string[];
  private readonly outputCache = new Map<string, OutputEntry>();
  private readonly onResize = () => this.layout();
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private captureTarget: RenderTarget | null = null;
  private loop: ((time: number) => void) | null = null;
  private disposed = false;
  private recovering = false;
  private lossTimes: number[] = [];

  private constructor(options: PixelRendererOptions) {
    installWebGPUCompat();
    this.container = options.container;
    this.scene = options.scene;
    this.camera = options.camera;
    this.forceWebGL = options.forceWebGL === true;
    this._mode = options.mode ?? 'pixel';
    this._baseResolution = options.resolution ?? RESOLUTIONS.default;
    this._resolution = this._baseResolution;
    this._aspect = options.aspect ?? 'adaptive';
    const edges = options.edges ?? DEFAULT_EDGES;
    this.depthEdge.value = edges.depth;
    this.normalEdge.value = edges.normal;
    this._filters = (options.filters ?? []).filter((id) => getFilter(id));
    this.createRenderer();
  }

  static async create(options: PixelRendererOptions): Promise<PixelRenderer> {
    const pr = new PixelRenderer(options);
    await pr.initRenderer();
    pr.observeLayout();
    pr.syncFilterEffects();
    return pr;
  }

  /** The one WebGPURenderer (replaced only when a lost GPU device is recovered). */
  get renderer(): WebGPURenderer {
    return this._renderer;
  }

  get pipeline(): RenderPipeline {
    return this._pipeline;
  }

  /** Renderer, canvas, scene passes and pipeline. Called once, and again after device loss. */
  private createRenderer(): void {
    const renderer = new WebGPURenderer({
      antialias: false,
      forceWebGL: this.forceWebGL,
      powerPreference: 'high-performance',
    });
    renderer.toneMapping = NoToneMapping; // flat palette colors, not photographic
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = BasicShadowMap; // hard-edged shadows suit pixel art
    renderer.setPixelRatio(1); // framing works in device pixels itself
    renderer.onError = ((info: unknown) => this.recordGpuError(info)) as never;
    renderer.onDeviceLost = ((info: { message?: string }) => this.handleDeviceLoss(renderer, info?.message)) as never;

    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.imageRendering = 'pixelated';
    canvas.dataset.engineCanvas = 'true';

    this._renderer = renderer;
    this.pixelNode = pixelationPass(this.scene, this.camera, this.pixelSize, this.normalEdge, this.depthEdge) as unknown as PassNode;
    this.rawNode = pass(this.scene, this.camera);
    this._pipeline = new RenderPipeline(renderer);
    // The output color transform is applied explicitly (renderOutput) so filters can run
    // after it, in display space.
    this._pipeline.outputColorTransform = false;
  }

  /** Initialise the backend, attach the canvas, lay out and build the output graph. */
  private async initRenderer(): Promise<void> {
    const renderer = this._renderer;
    const gpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
    await renderer.init();
    const backend = renderer.backend as { isWebGPUBackend?: boolean; device?: GPUDevice };
    this.backend = backend.isWebGPUBackend === true ? 'WebGPU' : 'WebGL 2 fallback';
    this.fallbackReason =
      this.backend === 'WebGPU'
        ? null
        : this.forceWebGL
          ? 'forced by ?backend=webgl'
          : gpuAvailable
            ? 'WebGPU adapter/device request failed'
            : 'navigator.gpu unavailable';
    // three ignores a device lost with reason 'destroyed'; we want to know about every loss
    // that we didn't cause ourselves (dispose).
    void backend.device?.lost.then((info) => this.handleDeviceLoss(renderer, info.message));
    this.container.appendChild(renderer.domElement);
    this.layout();
    this._pipeline.outputNode = this.outputFor(this._mode);
    this._pipeline.needsUpdate = true;
  }

  /**
   * Compile the scene's shaders for both scene passes without blocking (`compileAsync`),
   * then build the post-processing quads with one offscreen render. Call after the scene
   * is built and before the first visible frame, so the first frames don't stall.
   */
  async precompile(): Promise<void> {
    const r = this._renderer;
    try {
      // The pixel pass renders to an MRT target (color + normal); register its attachments
      // before compiling so the compiled pipelines match the real ones.
      this.pixelNode.getTextureNode('normal');
      this.pixelNode.getTextureNode('depth');
      await this.pixelNode.compileAsync(r);
      await this.rawNode.compileAsync(r);
    } catch (e) {
      console.info('[PixelRenderer] precompile skipped:', e);
    }
  }

  get mode(): RenderMode {
    return this._mode;
  }

  setMode(mode: RenderMode): void {
    if (mode === this._mode) return;
    this._mode = mode;
    this.rebuildOutput();
  }

  get filters(): readonly string[] {
    return this._filters;
  }

  /** Replace the filter stack (ids from FILTERS, applied in order; Pixel mode only). */
  setFilters(ids: readonly string[]): void {
    const next = ids.filter((id) => getFilter(id));
    if (next.join() === this._filters.join()) return;
    this._filters = next;
    this.rebuildOutput();
  }

  private rebuildOutput(): void {
    this._pipeline.outputNode = this.outputFor(this._mode);
    this._pipeline.needsUpdate = true;
    this.syncFilterEffects();
  }

  /** Filters with effects outside the post pass (PS1 vertex snap) follow the active stack. */
  private syncFilterEffects(): void {
    for (const f of FILTERS) f.setActive?.(this._mode === 'pixel' && this._filters.includes(f.id));
  }

  toggleMode(): RenderMode {
    this.setMode(this._mode === 'pixel' ? 'raw' : 'pixel');
    return this._mode;
  }

  /** The art resolution actually rendered (in adaptive mode its width follows the screen). */
  get resolution(): Resolution {
    return this._resolution;
  }

  /** The configured resolution preset (RESOLUTIONS.default or .compare). */
  get baseResolution(): Resolution {
    return this._baseResolution;
  }

  setResolution(resolution: Resolution): void {
    this._baseResolution = resolution;
    this.layout();
  }

  get aspect(): AspectMode {
    return this._aspect;
  }

  setAspect(aspect: AspectMode): void {
    this._aspect = aspect;
    this.layout();
  }

  /**
   * Point both passes at a different camera (camera preset hot-swap). The pipeline,
   * canvas and all nodes stay the same; only the camera the scene is rendered with changes.
   */
  setCamera(camera: Camera): void {
    this.camera = camera;
    (this.pixelNode as unknown as { camera: Camera }).camera = camera;
    (this.rawNode as unknown as { camera: Camera }).camera = camera;
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
    const f = computeFraming(rect.width, rect.height, window.devicePixelRatio, this._baseResolution, this._aspect);
    this.framing = f;
    const res = this._resolution;
    if (res.width !== f.artWidth || res.height !== f.artHeight) {
      this._resolution =
        f.artWidth === this._baseResolution.width && f.artHeight === this._baseResolution.height
          ? this._baseResolution
          : { width: f.artWidth, height: f.artHeight };
    }
    this.pixelSize.value = f.scale; // the scene pass renders at canvas / scale = art res
    vertexSnap.resolution.value.set(f.artWidth, f.artHeight);
    for (const entry of this.outputCache.values()) for (const t of entry.artTargets) this.sizeArtTarget(t);
    this._renderer.setSize(f.canvasWidth, f.canvasHeight, false);
    const style = this._renderer.domElement.style;
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
    this._pipeline.render();
  }

  /**
   * Render the current frame through the full pipeline into an offscreen target and read
   * it back. Output is identical to what the canvas presents (same pipeline, same size),
   * so tests and agents can inspect frames even where canvas screenshots don't work.
   */
  async capture(): Promise<CapturedFrame> {
    const { canvasWidth: width, canvasHeight: height } = this.framing;
    const r = this._renderer;
    const target = (this.captureTarget ??= new RenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false }));
    target.setSize(width, height);
    const previous = r.getRenderTarget();
    r.setRenderTarget(target);
    this._pipeline.render();
    r.setRenderTarget(previous);
    const raw = (await r.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Uint8Array;

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
    this.loop = callback;
    void this._renderer.setAnimationLoop(callback);
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    this.dprQuery = null;
    this._renderer.setAnimationLoop(null);
    for (const key of [...this.outputCache.keys()]) this.evict(key);
    this._pipeline.dispose();
    this.captureTarget?.dispose();
    this._renderer.dispose();
    this._renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- output graphs

  private outputFor(mode: RenderMode): Node {
    const key = mode === 'pixel' ? `pixel:${this._filters.join(',')}` : 'raw';
    let entry = this.outputCache.get(key);
    if (entry) {
      // Most recently used goes last (eviction order).
      this.outputCache.delete(key);
      this.outputCache.set(key, entry);
      return entry.node;
    }
    entry = mode === 'pixel' ? this.buildPixelOutput() : { node: this.buildRawOutput(), artTargets: [] };
    this.outputCache.set(key, entry);
    // Bound the cache; evicted graphs free their render targets.
    for (const k of this.outputCache.keys()) {
      if (this.outputCache.size <= OUTPUT_CACHE_SIZE) break;
      if (k !== key) this.evict(k);
    }
    return entry.node;
  }

  private buildRawOutput(): Node {
    return renderOutput(this.rawNode, this._renderer.toneMapping, this._renderer.outputColorSpace) as unknown as Node;
  }

  private buildPixelOutput(): OutputEntry {
    const artTargets: RTTNode[] = [];
    const artTexture = (node: Node): RTTNode => {
      const t = rtt(node, this._resolution.width, this._resolution.height, {
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        type: HalfFloatType,
        depthBuffer: false,
      });
      this.sizeArtTarget(t);
      artTargets.push(t);
      return t;
    };
    const { art, display } = splitFilters(this._filters);
    // Art stage: rendered into an art-resolution target, one fragment per art pixel.
    const artFx: FilterContext = { pixelSize: float(1), texture: artTexture };
    const scene = renderOutput(this.pixelNode, this._renderer.toneMapping, this._renderer.outputColorSpace);
    const artImage = artTexture(applyFilters(scene, art, artFx));
    // Display stage: the nearest-neighbour upscale (sampling the art target at the quad's
    // uv) plus display-resolution filters, if any.
    const displayFx: FilterContext = { pixelSize: this.pixelSize, texture: (node: Node) => convertToTexture(node) as unknown as RTTNode };
    return { node: applyFilters(artImage, display, displayFx) as Node, artTargets };
  }

  private sizeArtTarget(t: RTTNode): void {
    const { width, height } = this._resolution;
    if (t.width === width && t.height === height) return;
    t.width = width;
    t.height = height;
    t.setSize(width, height);
  }

  /** Drop a cached output graph and free the render targets only it owns. */
  private evict(key: string): void {
    const entry = this.outputCache.get(key);
    if (!entry) return;
    this.outputCache.delete(key);
    if (entry.node === this._pipeline.outputNode) return; // still on screen (raw ↔ pixel race)
    // RTTs (art targets, convertToTexture) and TSL display nodes with their own targets
    // (bloom, …) override Node.dispose; the shared scene passes must survive. Iterative
    // with a visited set: filter graphs share sub-nodes heavily (palette searches).
    const shared = new Set<Node>([this.pixelNode, this.rawNode]);
    const seen = new Set<Node>();
    const stack: Node[] = [entry.node];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n) || shared.has(n)) continue;
      seen.add(n);
      if (n.dispose !== Node.prototype.dispose) n.dispose();
      for (const child of n.getChildren()) stack.push(child);
    }
  }

  // ---------------------------------------------------------------- device loss

  private handleDeviceLoss(renderer: WebGPURenderer, message = 'unknown reason'): void {
    if (this.disposed || this.recovering || renderer !== this._renderer) return;
    this.recovering = true;
    console.info(`[PixelRenderer] GPU device lost (${message}); recreating the renderer`);
    void renderer.setAnimationLoop(null);
    void this.recover().finally(() => (this.recovering = false));
  }

  /**
   * Replace a lost renderer: new WebGPURenderer, canvas, scene passes and pipeline, same
   * scene/camera/filters/framing. Scene objects re-upload themselves to the new device.
   * If that fails (or keeps failing), show a "tap to reload" overlay.
   */
  private async recover(): Promise<void> {
    const now = performance.now();
    this.lossTimes = [...this.lossTimes.filter((t) => now - t < 30000), now];
    if (this.lossTimes.length > 3) return this.showReloadOverlay();
    if (document.hidden) await new Promise<void>((resolve) => document.addEventListener('visibilitychange', () => resolve(), { once: true }));
    const old = this._renderer;
    const oldCanvas = old.domElement;
    // The old graphs' GPU resources died with the device: drop them, don't dispose them.
    this.outputCache.clear();
    this.captureTarget = null;
    try {
      this.createRenderer();
      await this.initRenderer();
      oldCanvas.remove();
      this.syncFilterEffects();
      await this.precompile();
      void this._renderer.setAnimationLoop(this.loop);
      this.recoveries++;
      this.onRecovered?.(this._renderer.domElement);
      console.info(`[PixelRenderer] recovered on ${this.backend}`);
    } catch (e) {
      console.error('[PixelRenderer] could not recover from GPU device loss', e);
      this.showReloadOverlay();
    }
  }

  private showReloadOverlay(): void {
    if (this.container.querySelector('.gpu-lost')) return;
    const el = document.createElement('button');
    el.className = 'gpu-lost';
    el.textContent = 'Graphics were reset. Tap to reload.';
    el.addEventListener('click', () => location.reload());
    this.container.appendChild(el);
  }

  private recordGpuError(info: unknown): void {
    const i = (info ?? {}) as Partial<GpuErrorRecord>;
    const record = { api: i.api ?? 'unknown', type: i.type ?? 'error', message: i.message ?? String(info) };
    this.gpuErrors.push(record);
    console.error(`[PixelRenderer] ${record.api} ${record.type}: ${record.message}`);
  }
}
