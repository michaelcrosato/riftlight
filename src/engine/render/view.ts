/**
 * What the engine draws through (`engine.renderer`): the page's `PixelRenderer`, or a
 * `HeadlessView` in Node (`Engine.headless`), which keeps the same state as data and draws
 * nothing. Gameplay reads only this (the art resolution, the framing, the screen effects), so a
 * game runs the same in both. The GPU itself is `engine.gpu` (null headless).
 */
import type { Camera } from 'three/webgpu';
import type { AspectMode, Framing, Resolution, Viewport } from '../framing';
import type { Look } from './look';
import type { BackendName, CapturedFrame, EdgeSettings, GpuErrorRecord, RenderMode } from './PixelRenderer';
import type { ScreenFx } from './screenFx';

export interface View {
  /** The page element the canvas sits in; null headless. */
  readonly container: HTMLElement | null;
  readonly backend: BackendName;
  readonly gpuErrors: readonly GpuErrorRecord[];
  /** How many times a lost GPU device was recovered from (0 headless). */
  readonly recoveries: number;
  /** Counts look changes (UIs that mirror the look re-sync when it moves). */
  readonly lookVersion: number;
  /** Transitions, flashes and shockwaves (`engine.screen`). */
  readonly screen: ScreenFx;
  /** The viewport the view is framed for (the container's size and the device pixel ratio). */
  readonly viewport: Viewport;
  readonly framing: Framing;
  /** The actual art resolution; adaptive varies its width, fill varies both dimensions. */
  readonly resolution: Resolution;
  /** The configured resolution preset. */
  readonly baseResolution: Resolution;
  readonly aspect: AspectMode;
  readonly mode: RenderMode;
  readonly filters: readonly string[];
  /** The current look (a copy). */
  readonly look: Look;
  readonly split: boolean;
  readonly edges: EdgeSettings;
  readonly activeCamera: Camera;
  /** Called after a lost device was recovered with a new renderer and canvas. */
  onRecovered: ((canvas: HTMLCanvasElement) => void) | null;
  /** Where a throwing `onBeforeRender` listener is reported. */
  onError: ((e: unknown) => void) | null;
  setMode(mode: RenderMode): void;
  toggleMode(): RenderMode;
  setFilters(ids: readonly string[]): void;
  setLook(look: Look): void;
  setEdges(edges: Partial<EdgeSettings>): void;
  setResolution(resolution: Resolution): void;
  setAspect(aspect: AspectMode): void;
  setCamera(camera: Camera): void;
  layout(): void;
  /** Run `f` before every frame's render (render-to-texture views). Returns an unsubscribe. */
  onBeforeRender(f: () => void): () => void;
  clearBeforeRender(): void;
  precompile(): Promise<void>;
  render(): void;
  /** The frame as pixels; rejects headless. */
  capture(): Promise<CapturedFrame>;
  setAnimationLoop(callback: ((time: number) => void) | null): void;
  dispose(): void;
}
