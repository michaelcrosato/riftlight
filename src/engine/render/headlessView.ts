/**
 * The view `Engine.headless` runs with (docs/engine/headless.md): no GPU and no DOM. It keeps what
 * gameplay reads from a view as data, the same as PixelRenderer's: the art resolution and framing
 * of a viewport (`frameView`, the one function both call), the look, mode and filters, and a real
 * `ScreenFx` whose transitions advance with `engine.step()`. It draws nothing: `render`,
 * `precompile` and the animation loop do nothing, `onBeforeRender` keeps its hooks without
 * calling them, and `capture()` rejects (pictures need the browser: `npm run look`, `npm run film`).
 */
import type { Camera } from 'three/webgpu';
import { type AspectMode, type Framing, type Resolution, RESOLUTIONS, type Viewport, frameView } from '../framing';
import { cloneLook, type Look, lookFromFilters, normalizeLook, planLook, startingLook } from './look';
import { type BackendName, type CapturedFrame, DEFAULT_EDGES, type EdgeSettings, type GpuErrorRecord, type RenderMode } from './PixelRenderer';
import { ScreenFx } from './screenFx';
import type { View } from './view';
import { getFilter } from './filters';

/** The viewport a headless view frames by default: the riftlight-replay page's (Riftlight's `fill` gives 480×270). */
export const HEADLESS_VIEWPORT: Viewport = { width: 960, height: 540, dpr: 1 };

export interface HeadlessViewOptions {
  camera: Camera;
  viewport?: Viewport;
  resolution?: Resolution;
  aspect?: AspectMode;
  mode?: RenderMode;
  edges?: EdgeSettings;
  filters?: readonly string[];
  look?: Look;
}

export class HeadlessView implements View {
  readonly container = null;
  readonly backend: BackendName = 'headless';
  readonly gpuErrors: readonly GpuErrorRecord[] = [];
  readonly recoveries = 0;
  lookVersion = 0;
  readonly screen = new ScreenFx();
  onRecovered: ((canvas: HTMLCanvasElement) => void) | null = null;
  onError: ((e: unknown) => void) | null = null;
  framing!: Framing;
  private _viewport: Viewport;
  private _baseResolution: Resolution;
  private _resolution: Resolution;
  private _aspect: AspectMode;
  private _mode: RenderMode;
  private _look: Look;
  private _filters: readonly string[] = [];
  private camera: Camera;
  private readonly beforeRender = new Set<() => void>();

  constructor(options: HeadlessViewOptions) {
    this.camera = options.camera;
    this._viewport = { ...(options.viewport ?? HEADLESS_VIEWPORT) };
    this._baseResolution = options.resolution ?? RESOLUTIONS.default;
    this._resolution = this._baseResolution;
    this._aspect = options.aspect ?? 'adaptive';
    this._mode = options.mode ?? 'pixel';
    this._look = startingLook({ look: options.look, filters: options.filters, edges: options.edges ?? DEFAULT_EDGES });
    this.syncFilters();
    this.layout();
  }

  get viewport(): Viewport {
    return this._viewport;
  }

  /** Frame for another viewport (a recording's: `Recording.view`). */
  setViewport(viewport: Viewport): void {
    this._viewport = { width: viewport.width, height: viewport.height, dpr: viewport.dpr };
    this.layout();
  }

  layout(): void {
    const { framing, resolution } = frameView(this._viewport, this._baseResolution, this._aspect, this._resolution);
    this.framing = framing;
    this._resolution = resolution;
  }

  get resolution(): Resolution {
    return this._resolution;
  }

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

  get mode(): RenderMode {
    return this._mode;
  }

  setMode(mode: RenderMode): void {
    this._mode = mode;
  }

  toggleMode(): RenderMode {
    this._mode = this._mode === 'pixel' ? 'raw' : 'pixel';
    return this._mode;
  }

  get look(): Look {
    return cloneLook(this._look);
  }

  setLook(look: Look): void {
    this._look = normalizeLook(look);
    this.lookVersion++;
    this.syncFilters();
  }

  private syncFilters(): void {
    const ids = this._look.scene.map((f) => f.id);
    if (ids.join() !== this._filters.join()) this._filters = ids;
  }

  /** The whole-scene filter ids (the same array until they change, as PixelRenderer's). */
  get filters(): readonly string[] {
    return this._filters;
  }

  setFilters(ids: readonly string[]): void {
    const next = ids.filter((id) => getFilter(id));
    if (next.join() === this.filters.join()) return;
    this.setLook(lookFromFilters(next, this._look));
  }

  get split(): boolean {
    return planLook(this._look).split;
  }

  get edges(): EdgeSettings {
    const p = this._look.environment.pixel ?? this._look.actors.pixel;
    return { depth: p?.outline ?? 0, normal: p?.crease ?? 0 };
  }

  setEdges(edges: Partial<EdgeSettings>): void {
    const look = this.look;
    for (const l of [look.actors, look.environment]) {
      if (!l.pixel) continue;
      if (edges.depth !== undefined) l.pixel.outline = edges.depth;
      if (edges.normal !== undefined) l.pixel.crease = edges.normal;
    }
    this.setLook(look);
  }

  get activeCamera(): Camera {
    return this.camera;
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
  }

  onBeforeRender(f: () => void): () => void {
    this.beforeRender.add(f);
    return () => this.beforeRender.delete(f);
  }

  clearBeforeRender(): void {
    this.beforeRender.clear();
  }

  async precompile(): Promise<void> {}

  render(): void {}

  capture(): Promise<CapturedFrame> {
    return Promise.reject(new Error('headless: no pictures (npm run look, npm run film)'));
  }

  setAnimationLoop(): void {}

  dispose(): void {
    this.beforeRender.clear();
  }
}
