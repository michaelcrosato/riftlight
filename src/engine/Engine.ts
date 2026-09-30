import { AmbientLight, Color, DirectionalLight, Scene, Vector3 } from 'three/webgpu';
import { loadModel } from './assets';
import { CAMERA_PRESETS, type CameraConfig, type CameraPreset, type CameraRig, FreeRig, OrthoRig, createCameraRig } from './camera';
import { DebugUI } from './DebugUI';
import { RESOLUTIONS, type Resolution, snapToGrid } from './framing';
import { Input } from './input';
import { PALETTE } from './palette';
import { Physics } from './physics/Physics';
import { FILTER_IDS, FILTER_PRESETS, getFilter } from './render/filters';
import { type EdgeSettings, PixelRenderer, type RenderMode } from './render/PixelRenderer';

export interface GameContext {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly physics: Physics;
  readonly input: Input;
  readonly camera: CameraRig;
  readonly loadModel: typeof loadModel;
  readonly palette: typeof PALETTE;
  /** Seconds since start (render clock). */
  readonly time: number;
}

/**
 * A game is a plain object. The engine owns rendering, physics stepping, camera,
 * lighting and debug UI; the game only builds its world and reacts to input.
 */
export interface Game {
  readonly name: string;
  /** Build the level: load models, add colliders, spawn entities. */
  setup(ctx: GameContext): Promise<void> | void;
  /** Runs before every fixed 60 Hz physics step. Move characters/apply forces here. */
  fixedUpdate?(ctx: GameContext, dt: number): void;
  /** Runs once per rendered frame after physics (animation, pickups, UI state). */
  update?(ctx: GameContext, dt: number): void;
  /** World position the camera follows. */
  cameraTarget(ctx: GameContext): Vector3;
  /** First-person eye position (defaults to cameraTarget + 0.7 up). */
  eyePosition?(ctx: GameContext): Vector3;
  /** One-line status for the debug UI (score, lives...). */
  status?(ctx: GameContext): string;
}

export interface EngineOptions {
  container?: HTMLElement;
  resolution?: Resolution;
  mode?: RenderMode;
  edges?: EdgeSettings;
  /** Camera preset + parameters. Pick one per game; not meant to change during play. */
  camera?: CameraConfig;
  /** Post filters (ids from FILTERS) applied in Pixel mode, in order. */
  filters?: readonly string[];
  /** Debug/test only: use WebGPURenderer's WebGL 2 backend without trying WebGPU. */
  forceWebGL?: boolean;
  debugUI?: boolean;
  background?: number;
}

/**
 * Read engine options from the URL:
 *   ?backend=webgl  ?mode=raw  ?res=320  ?debug=0
 *   ?camera=iso|topdown|side|third|first|free|fixed  ?zoom=1.5
 *   ?cam=<JSON CameraConfig>   (e.g. the config printed by the free camera)
 *   ?filters=crt,lcd  or  ?look=handheld (a FILTER_PRESETS name)
 */
export function optionsFromUrl(search = location.search): Partial<EngineOptions> {
  const p = new URLSearchParams(search);
  const opts: Partial<EngineOptions> = {};
  if (p.get('backend') === 'webgl') opts.forceWebGL = true;
  if (p.get('mode') === 'raw') opts.mode = 'raw';
  if (p.get('res') === '320') opts.resolution = RESOLUTIONS.compare;
  if (p.get('debug') === '0') opts.debugUI = false;
  let camera: CameraConfig = {};
  const cam = p.get('cam');
  if (cam) {
    try {
      camera = JSON.parse(cam) as CameraConfig;
    } catch {
      console.warn('Ignoring invalid ?cam= JSON');
    }
  }
  const preset = p.get('camera');
  if (preset && (CAMERA_PRESETS as readonly string[]).includes(preset)) camera.preset = preset as CameraPreset;
  const zoom = Number(p.get('zoom'));
  if (zoom > 0) camera.zoom = zoom;
  if (Object.keys(camera).length) opts.camera = camera;
  const look = p.get('look');
  if (look && FILTER_PRESETS[look]) opts.filters = FILTER_PRESETS[look];
  const filters = p.get('filters');
  if (filters) opts.filters = filters.split(',').filter((id) => getFilter(id));
  return opts;
}

export class Engine {
  readonly input = new Input();
  readonly sun: DirectionalLight;
  readonly ambient: AmbientLight;
  readonly context: GameContext;
  debug: DebugUI | null = null;
  /** Freeze simulation, animation and camera (rendering continues). For tooling, capture and pause menus. */
  paused = false;
  frame = 0;
  time = 0;
  private lastTime = -1;
  private readonly sunDirection = new Vector3(-0.55, 1, 0.35).normalize();
  // Light-space axes perpendicular to the sun, for snapping the shadow frustum to texels.
  private readonly sunRight = new Vector3().crossVectors(new Vector3(0, 1, 0), this.sunDirection).normalize();
  private readonly sunUp = new Vector3().crossVectors(this.sunDirection, this.sunRight).normalize();
  private readonly sunFocus = new Vector3();

  private constructor(
    readonly game: Game,
    readonly renderer: PixelRenderer,
    readonly physics: Physics,
    readonly camera: CameraRig,
    readonly scene: Scene,
  ) {
    const clock = () => this.time;
    this.context = {
      engine: this,
      scene,
      physics,
      input: this.input,
      camera,
      loadModel,
      palette: PALETTE,
      get time() {
        return clock();
      },
    };

    // One directional light (with hard shadow map) + modest ambient fill.
    this.sun = new DirectionalLight(new Color(PALETTE.white), 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0015;
    this.sun.shadow.normalBias = 0.02;
    const s = this.sun.shadow.camera;
    s.left = -14;
    s.right = 14;
    s.top = 14;
    s.bottom = -14;
    s.near = 1;
    s.far = 60;
    this.ambient = new AmbientLight(new Color(PALETTE.mist), 1.1);
    this.scene.add(this.sun, this.sun.target, this.ambient);
  }

  static async start(game: Game, options: EngineOptions = {}): Promise<Engine> {
    const container = options.container ?? document.body;
    const camera = createCameraRig(options.camera);
    const scene = new Scene();
    const [renderer, physics] = await Promise.all([
      PixelRenderer.create({
        container,
        scene,
        camera: camera.camera,
        resolution: options.resolution,
        mode: options.mode,
        edges: options.edges,
        filters: options.filters,
        forceWebGL: options.forceWebGL,
      }),
      Physics.create(),
    ]);
    const engine = new Engine(game, renderer, physics, camera, scene);
    scene.background = new Color(options.background ?? PALETTE.night);

    engine.input.attachPointer(renderer.renderer.domElement);
    if (camera instanceof FreeRig) {
      camera.onFix = (config) => {
        const json = JSON.stringify(config);
        console.info(`[camera] fixed. Use: camera: ${json}  or  ?cam=${encodeURIComponent(json)}`);
        void navigator.clipboard?.writeText(json).catch(() => {});
      };
    }

    await game.setup(engine.context);
    camera.teleport(game.cameraTarget(engine.context));
    if (options.debugUI !== false) engine.debug = new DebugUI(engine);

    renderer.setAnimationLoop((t) => engine.tick(t));
    return engine;
  }

  toggleMode(): RenderMode {
    return this.renderer.toggleMode();
  }

  toggleResolution(): Resolution {
    const next = this.renderer.resolution === RESOLUTIONS.default ? RESOLUTIONS.compare : RESOLUTIONS.default;
    this.renderer.setResolution(next);
    return next;
  }

  /** Every filter id the engine ships (see render/filters.ts). */
  get availableFilters(): readonly string[] {
    return FILTER_IDS;
  }

  get filters(): readonly string[] {
    return this.renderer.filters;
  }

  setFilters(ids: readonly string[]): void {
    this.renderer.setFilters(ids);
  }

  /** Cycle through FILTER_PRESETS ([ and ] keys). */
  cycleLook(step: 1 | -1): string {
    const names = Object.keys(FILTER_PRESETS);
    const current = names.findIndex((n) => FILTER_PRESETS[n]!.join() === this.renderer.filters.join());
    const next = names[(current + step + names.length) % names.length]!;
    this.renderer.setFilters(FILTER_PRESETS[next]!);
    return next;
  }

  /** Snapshot for tests, tooling and agents. */
  state() {
    const r = this.renderer;
    const target = this.game.cameraTarget(this.context);
    return {
      game: this.game.name,
      backend: r.backend,
      fallbackReason: r.fallbackReason,
      mode: r.mode,
      resolution: { ...r.resolution },
      framing: { ...r.framing },
      frame: this.frame,
      physicsSteps: this.physics.steps,
      gpuErrors: r.gpuErrors.map((e) => ({ ...e })),
      target: target.toArray(),
      camera: this.camera.camera.position.toArray(),
      cameraRig: this.camera.describe(),
      /** Visible world extents of an orthographic camera (what's in frame). */
      view:
        this.camera instanceof OrthoRig
          ? (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(this.camera.camera)
          : null,
      filters: [...r.filters],
      status: this.game.status?.(this.context) ?? '',
    };
  }

  private tick(timeMs: number): void {
    const t = timeMs / 1000;
    const dt = this.lastTime < 0 ? 1 / 60 : Math.min(t - this.lastTime, 0.1);
    this.lastTime = t;
    this.time += dt;
    const ctx = this.context;

    if (this.input.wasPressed('KeyP')) this.toggleMode();
    if (this.input.wasPressed('KeyR')) this.toggleResolution();
    if (this.input.wasPressed('Backquote')) this.debug?.toggle();
    if (this.input.wasPressed('BracketRight')) this.cycleLook(1);
    if (this.input.wasPressed('BracketLeft')) this.cycleLook(-1);
    this.input.wantsPointerLock = this.camera.preset === 'first' || (this.camera instanceof FreeRig && !this.camera.fixed);

    if (this.paused) {
      this.renderer.render();
      this.input.endFrame();
      this.frame++;
      return;
    }
    this.physics.update(dt, (fixedDt) => this.game.fixedUpdate?.(ctx, fixedDt));
    this.game.update?.(ctx, dt);

    const target = this.game.cameraTarget(ctx);
    const eye = this.game.eyePosition?.(ctx) ?? target.clone().setY(target.y + 0.7);
    this.camera.update({
      target,
      eye,
      dt,
      resolution: this.renderer.resolution,
      input: this.input,
      world: { raycast: (from, dir, max) => this.physics.raycast(from, dir, max, ['character', 'noCamera']) },
    });

    // Keep the shadow frustum centred on the action, moved in whole shadow texels so
    // shadow edges don't crawl while the camera follows the player.
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const f = this.camera.focus;
    const r = snapToGrid(f.dot(this.sunRight), texel);
    const u = snapToGrid(f.dot(this.sunUp), texel);
    const d = f.dot(this.sunDirection);
    this.sunFocus.copy(this.sunRight).multiplyScalar(r).addScaledVector(this.sunUp, u).addScaledVector(this.sunDirection, d);
    this.sun.target.position.copy(this.sunFocus);
    this.sun.position.copy(this.sunFocus).addScaledVector(this.sunDirection, 25);

    this.renderer.render();
    this.debug?.update(this.game.status?.(ctx) ?? '');
    this.input.endFrame();
    this.frame++;
  }
}
