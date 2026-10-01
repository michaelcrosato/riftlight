import { AmbientLight, Color, DirectionalLight, type Node, OrthographicCamera, type PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { abs, dot, max, min, normalWorld, sqrt, uniform } from 'three/tsl';
import { assetProgress, loadModel, preloadModels } from './assets';
import { AudioManager } from './audio/AudioManager';
import {
  CAMERA_PRESETS,
  type CameraConfig,
  type CameraPreset,
  type CameraRig,
  type CameraUpdate,
  FreeRig,
  OrthoRig,
  createCameraRig,
  isPerspective,
} from './camera';
import { DebugUI } from './DebugUI';
import { type DebugKeyMap, type DebugKeysOption, resolveDebugKeys } from './debugKeys';
import { type AspectMode, RESOLUTIONS, type Resolution, snapToGrid } from './framing';
import { Hud } from './hud/Hud';
import { Input } from './input';
import { clearScene } from './lifecycle';
import { LoadingScreen } from './LoadingScreen';
import { Particles } from './particles/Particles';
import { type TouchButton, TouchControls } from './TouchControls';
import { PALETTE } from './palette';
import { Physics } from './physics/Physics';
import { FrameLimiter, QUALITY, QUALITY_LEVELS, type QualityLevel, type QualityOption, defaultQuality, qualityForFps } from './quality';
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
  /** Game time in seconds since start. Frozen while paused or loading. */
  readonly time: number;
  /** Sound effects, music, volumes (src/engine/audio). */
  readonly audio: AudioManager;
  /** Pixel particles: `particles.burst('dust', at)` (src/engine/particles). */
  readonly particles: Particles;
  /** Pixel HUD text and icons in art pixels (src/engine/hud). */
  readonly hud: Hud;
}

/**
 * A game is a plain object. The engine owns rendering, physics stepping, camera,
 * lighting and debug UI; the game only builds its world and reacts to input.
 */
export interface Game {
  readonly name: string;
  /**
   * Models `setup` will load (`ctx.loadModel` URLs). Optional: listing them lets the
   * engine start downloading while the renderer and physics initialise.
   */
  readonly assets?: readonly string[];
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
  /**
   * Called after `engine.setCamera()` swapped the camera preset mid-game. The world,
   * physics and player are untouched; adjust anything that depends on the preset
   * (e.g. side-scroller lane lock, hiding the player model in first person).
   */
  onCameraChange?(ctx: GameContext): void;
  /**
   * Called when the game is unloaded (`engine.loadGame(other)` or `engine.dispose()`),
   * before the engine removes its scene objects, physics bodies, triggers, particles, HUD
   * and music. Free anything else the game owns: DOM, timers, listeners, HMR hooks.
   */
  dispose?(ctx: GameContext): void;
}

export interface EngineOptions {
  container?: HTMLElement;
  resolution?: Resolution;
  /**
   * `adaptive` (default): the art height stays `resolution.height` and the art width
   * follows the screen's aspect (portrait phones fill the screen). `fixed`: always exactly
   * `resolution`, letterboxed. Identical on 16:9 screens.
   */
  aspect?: AspectMode;
  /**
   * Cap the render loop (simulation keeps its fixed 60 Hz physics step). Default 60, so
   * 120 Hz phones don't run the whole pipeline twice per game frame. 0 = display rate.
   */
  maxFps?: number;
  /** Shadow map quality, or `auto` (default: low on touch devices, else medium; lowered once on a slow start). */
  quality?: QualityOption;
  /** Pixel-styled loading indicator while the renderer, physics and assets load. Default true. */
  loadingScreen?: boolean;
  mode?: RenderMode;
  edges?: EdgeSettings;
  /** Camera preset + parameters. Pick one per game; not meant to change during play. */
  camera?: CameraConfig;
  /** Post filters (ids from FILTERS) applied in Pixel mode, in order. */
  filters?: readonly string[];
  /** Debug/test only: use WebGPURenderer's WebGL 2 backend without trying WebGPU. */
  forceWebGL?: boolean;
  /** Debug panel. Default: on in dev (`vite`) or with ?debug=1, off in production builds. */
  debugUI?: boolean;
  /**
   * Engine hotkeys (P Pixel/Raw, R resolution, ` debug panel, [ ] looks, M mute).
   * `false` disables them all; an object rebinds or disables (null) single actions.
   */
  debugKeys?: DebugKeysOption;
  /** On-screen joystick + buttons. Default: auto (coarse pointer), or ?touch=1 / ?touch=0. */
  touch?: boolean;
  /** On-screen action buttons. Default: the platformer's (DEFAULT_TOUCH_BUTTONS). */
  touchButtons?: readonly TouchButton[];
  background?: number;
}

/**
 * Read engine options from the URL:
 *   ?backend=webgl  ?mode=raw  ?res=320  ?debug=1|0
 *   ?aspect=fixed|adaptive  ?fps=30 (0 = uncapped)  ?quality=low|medium|high|auto
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
  if (p.get('debug') === '1') opts.debugUI = true;
  if (p.get('touch') === '1') opts.touch = true;
  if (p.get('touch') === '0') opts.touch = false;
  const aspect = p.get('aspect');
  if (aspect === 'fixed' || aspect === 'adaptive') opts.aspect = aspect;
  const fps = p.get('fps');
  if (fps !== null && Number(fps) >= 0) opts.maxFps = Number(fps);
  const quality = p.get('quality');
  if (quality === 'auto' || (QUALITY_LEVELS as readonly string[]).includes(quality ?? '')) opts.quality = quality as QualityOption;
  let camera: CameraConfig = {};
  const cam = p.get('cam');
  if (cam) {
    try {
      const parsed: unknown = JSON.parse(cam);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) camera = parsed as CameraConfig;
      else console.warn('Ignoring ?cam=: expected a JSON object');
    } catch {
      console.warn('Ignoring invalid ?cam= JSON');
    }
    if (camera.preset && !(CAMERA_PRESETS as readonly string[]).includes(camera.preset)) {
      console.warn(`Ignoring unknown camera preset "${camera.preset}"`);
      delete camera.preset;
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
  readonly audio = new AudioManager();
  readonly particles: Particles;
  readonly hud: Hud;
  debug: DebugUI | null = null;
  touch: TouchControls | null = null;
  /** Active engine hotkeys (from EngineOptions.debugKeys). */
  debugKeys: DebugKeyMap = resolveDebugKeys();
  private _game: Game;
  private _paused = false;
  /** False while a game's setup() is running (start, loadGame): nothing advances. */
  private ready = false;
  private disposed = false;
  /**
   * Tooling: the render loop stops driving the game; advance it yourself with `step()`.
   * Frame-exact and independent of how fast the browser renders (filmstrips, replays).
   */
  manual = false;
  frame = 0;
  /** Rendered frames per second (measured over ~0.5 s). */
  fps = 0;
  /** Requested quality (`auto` adapts); `quality` is the level in use. */
  readonly qualityOption: QualityOption;
  private _quality: QualityLevel;
  /** The game's own camera config; switching back to its preset restores zoom, yaw etc. */
  private startCamera: CameraConfig = {};
  time = 0;
  private lastTime = -1;
  private readonly limiter: FrameLimiter;
  private fpsFrames = 0;
  private fpsSince = -1;
  /** `auto` quality: one measurement window after start-up (ms timestamps), then done. */
  private autoQuality: { start: number; frames: number } | null = null;
  private readonly sunDirection = new Vector3(-0.55, 1, 0.35).normalize();
  // Light-space axes perpendicular to the sun, for snapping the shadow frustum to texels.
  private readonly sunRight = new Vector3().crossVectors(new Vector3(0, 1, 0), this.sunDirection).normalize();
  private readonly sunUp = new Vector3().crossVectors(this.sunDirection, this.sunRight).normalize();
  private readonly sunFocus = new Vector3();
  private shadowRadius = 0;
  /** Shadow depth-bias unit: one shadow texel in normalized light depth. */
  private readonly shadowTexelDepth = uniform(0);
  private readonly tmp = new Vector3();
  private readonly eye = new Vector3();
  // Reused every frame (no per-frame allocations in advance()).
  private readonly cameraWorld = {
    raycast: (from: Vector3, dir: Vector3, max: number) => this.physics.raycast(from, dir, max, CAMERA_IGNORE),
  };
  private readonly cameraUpdate: CameraUpdate;

  private constructor(
    game: Game,
    readonly renderer: PixelRenderer,
    readonly physics: Physics,
    public camera: CameraRig,
    readonly scene: Scene,
    options: EngineOptions,
  ) {
    this._game = game;
    const clock = () => this.time;
    const rig = () => this.camera;
    this.particles = new Particles(() => ({ camera: this.camera.camera, focus: this.camera.focus, height: this.renderer.resolution.height }));
    this.hud = new Hud(renderer.container);
    this.context = {
      engine: this,
      scene,
      physics,
      input: this.input,
      get camera() {
        return rig();
      },
      loadModel,
      palette: PALETTE,
      get time() {
        return clock();
      },
      audio: this.audio,
      particles: this.particles,
      hud: this.hud,
    };

    this.cameraUpdate = {
      target: new Vector3(),
      eye: this.eye,
      dt: 0,
      resolution: renderer.resolution,
      input: this.input,
      world: this.cameraWorld,
    };
    this.limiter = new FrameLimiter(options.maxFps ?? 60);
    this.qualityOption = options.quality ?? 'auto';
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(hover: hover)').matches;
    this._quality = this.qualityOption === 'auto' ? defaultQuality({ coarsePointer: coarse }) : this.qualityOption;
    if (this.qualityOption === 'auto') this.autoQuality = { start: -1, frames: 0 };

    // One directional light (with hard shadow map) + modest ambient fill. The shadow box
    // follows the camera and scales with the view (see updateShadow).
    this.sun = new DirectionalLight(new Color(PALETTE.white), 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(QUALITY[this._quality].shadowMapSize);
    this.sun.shadow.normalBias = 0;
    // Slope-scaled depth bias, in shadow texels: three renders the *back* faces into the
    // shadow map, so the surfaces that compare against themselves face away from the sun
    // (still lit by the toon ramp's dark band). Biasing them toward the light by a texel or
    // so, more at grazing angles, keeps them free of acne stipple at every map size while
    // contact shadows on surfaces facing the sun stay tight.
    const nl = max(abs(dot(normalWorld, uniform(this.sunDirection))), 0.05);
    const slope = min(sqrt(nl.mul(nl).oneMinus()).div(nl), 4);
    (this.sun.shadow as unknown as { biasNode: Node }).biasNode = this.shadowTexelDepth.mul(slope.add(0.75)).negate() as unknown as Node;
    this.ambient = new AmbientLight(new Color(PALETTE.mist), 1.1);
    this.scene.add(this.sun, this.sun.target, this.ambient, this.particles.group);
    // Engine-owned: survive level unloads (engine.loadGame).
    for (const o of [this.sun, this.sun.target, this.ambient]) o.userData.engineOwned = true;
    renderer.onRecovered = (canvas) => this.input.attachPointer(canvas);
  }

  /** The running game. Replace it with `loadGame()`. */
  get game(): Game {
    return this._game;
  }

  /**
   * Freeze simulation, animation, particles and game time (rendering continues). For
   * tooling, capture and pause menus. Queued key presses are dropped while paused.
   */
  get paused(): boolean {
    return this._paused;
  }

  set paused(value: boolean) {
    if (value) this.input.clearQueued();
    this._paused = value;
  }

  /** The quality level in use (see `EngineOptions.quality`). */
  get quality(): QualityLevel {
    return this._quality;
  }

  setQuality(level: QualityLevel): void {
    this._quality = level;
    this.sun.shadow.mapSize.setScalar(QUALITY[level].shadowMapSize); // the shadow map resizes itself
    this.shadowRadius = 0; // re-fit (texel snapping depends on the map size)
  }

  /** Frame cap of the render loop (0 = display rate). */
  get maxFps(): number {
    return this.limiter.maxFps;
  }

  set maxFps(fps: number) {
    this.limiter.maxFps = fps;
  }

  static async start(game: Game, options: EngineOptions = {}): Promise<Engine> {
    const container = options.container ?? document.body;
    // Downloads first: models, the renderer (GPU adapter/device) and Rapier's wasm all
    // load in parallel, behind a loading indicator.
    if (game.assets) preloadModels(game.assets);
    const loading = options.loadingScreen === false ? null : new LoadingScreen(container);
    const done = { renderer: false, physics: false, setup: false };
    const progress = () =>
      (done.renderer ? 0.2 : 0) + (done.physics ? 0.2 : 0) + assetProgress() * 0.45 + (done.setup ? 0.1 : 0);
    const ticker = loading ? setInterval(() => loading.set(progress()), 100) : 0;
    try {
      const camera = createCameraRig(options.camera);
      const scene = new Scene();
      const [renderer, physics] = await Promise.all([
        PixelRenderer.create({
          container,
          scene,
          camera: camera.camera,
          resolution: options.resolution,
          aspect: options.aspect,
          mode: options.mode,
          edges: options.edges,
          filters: options.filters,
          forceWebGL: options.forceWebGL,
        }).finally(() => (done.renderer = true)),
        Physics.create().finally(() => (done.physics = true)),
      ]);
      const engine = new Engine(game, renderer, physics, camera, scene, options);
      engine.startCamera = { ...options.camera, preset: camera.preset };
      scene.background = new Color(options.background ?? PALETTE.night);
      camera.setAspect(renderer.resolution.width / renderer.resolution.height);

      engine.input.attachPointer(renderer.renderer.domElement);
      engine.wireRig(camera);
      engine.debugKeys = resolveDebugKeys(options.debugKeys);

      await game.setup(engine.context);
      done.setup = true;
      loading?.set(progress(), 'COMPILING');
      camera.teleport(game.cameraTarget(engine.context));
      engine.updateView(0); // place camera + shadow box before compiling and the first frame
      await renderer.precompile();
      engine.ready = true;
      engine.finishStart(container, options);
      loading?.set(1);
      return engine;
    } finally {
      clearInterval(ticker);
      loading?.done();
    }
  }

  /** Debug panel, touch controls, then the render loop. */
  private finishStart(container: HTMLElement, options: EngineOptions): void {
    if (options.debugUI ?? defaultDebugUI()) this.debug = new DebugUI(this);
    if (options.touch ?? TouchControls.wanted()) {
      const k = this.debugKeys;
      const bar: TouchButton[] = [
        { label: '⚙', code: k.debug[0] ?? '' },
        { label: 'P', code: k.mode[0] ?? '' },
        { label: 'R', code: k.resolution[0] ?? '' },
        { label: '◐', code: k.nextLook[0] ?? '' },
        { label: '♪', code: k.mute[0] ?? '' },
      ];
      this.touch = new TouchControls(container, this.input, options.touchButtons, bar.filter((b) => b.code));
      if (this.debug?.visible) this.debug.toggle(); // small screens: panel behind the ⚙ button
    }
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /**
   * Swap the camera preset mid-game (review tool: presets are a per-game choice). The
   * player, physics and the rest of the world are left exactly as they are. `free` and
   * `fixed` without an explicit position start from the view currently on screen.
   * Keeps `?camera=` in the URL in sync so a reload restores the preset.
   */
  setCamera(config: CameraConfig): CameraRig {
    const preset = config.preset ?? 'iso';
    const old = this.camera;
    // Back to the game's own preset: restore its configured zoom, angles, view height...
    let cfg: CameraConfig = preset === this.startCamera.preset ? { ...this.startCamera, ...config, preset } : { ...config, preset };
    if ((preset === 'free' || preset === 'fixed') && !config.position) {
      const dir = old.camera.getWorldDirection(new Vector3());
      const pos = old.camera.position.clone();
      if (old.preset === 'first') pos.addScaledVector(dir, -3).add(new Vector3(0, 1, 0)); // step out of the head
      const ortho = old.camera instanceof OrthographicCamera;
      cfg = {
        ...cfg,
        position: pos.toArray() as [number, number, number],
        target: pos.clone().addScaledVector(dir, 10).toArray() as [number, number, number],
        projection: config.projection ?? (ortho ? 'ortho' : 'perspective'),
        ...(ortho ? { viewHeight: (old.camera as OrthographicCamera).top * 2 } : { fov: config.fov ?? (old.camera as PerspectiveCamera).fov }),
      };
    }
    const rig = createCameraRig(cfg);
    rig.setAspect(this.renderer.resolution.width / this.renderer.resolution.height);
    rig.teleport(this.game.cameraTarget(this.context));
    rig.focus.copy(old.focus);
    this.renderer.setCamera(rig.camera);
    this.camera = rig;
    this.wireRig(rig);
    if (preset !== 'first' && document.pointerLockElement) document.exitPointerLock?.();
    this.game.onCameraChange?.(this.context);
    try {
      // free/fixed need their full config (position, target...) to come back on reload.
      const url = new URL(location.href);
      if (preset === 'free' || preset === 'fixed') {
        url.searchParams.set('cam', JSON.stringify(cfg));
        url.searchParams.delete('camera');
      } else {
        url.searchParams.set('camera', preset);
        url.searchParams.delete('cam');
      }
      history.replaceState(null, '', url);
    } catch {
      /* file:// or sandboxed: URL sync is best-effort */
    }
    return rig;
  }

  private wireRig(rig: CameraRig): void {
    if (rig instanceof FreeRig) {
      rig.onFix = (config) => {
        const json = JSON.stringify(config);
        console.info(`[camera] fixed. Use: camera: ${json}  or  ?cam=${encodeURIComponent(json)}`);
        void navigator.clipboard?.writeText(json).catch(() => {});
      };
    }
  }

  toggleMode(): RenderMode {
    return this.renderer.toggleMode();
  }

  toggleResolution(): Resolution {
    const next = this.renderer.baseResolution === RESOLUTIONS.default ? RESOLUTIONS.compare : RESOLUTIONS.default;
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
    const target = this.ready ? this.game.cameraTarget(this.context) : this.camera.focus;
    return {
      game: this.game.name,
      ready: this.ready,
      paused: this.paused,
      time: this.time,
      backend: r.backend,
      fallbackReason: r.fallbackReason,
      mode: r.mode,
      resolution: { ...r.resolution },
      aspect: r.aspect,
      framing: { ...r.framing },
      frame: this.frame,
      fps: this.fps,
      maxFps: this.maxFps,
      quality: this.quality,
      gpuRecoveries: r.recoveries,
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

  /**
   * Tooling: switch to manual time and advance `n` frames of `dt` seconds (simulation,
   * animation, camera). Nothing is drawn; call `renderer.capture()` to see the result.
   */
  step(n = 1, dt = 1 / 60): void {
    this.manual = true;
    for (let i = 0; i < n && this.ready; i++) {
      this.time += dt;
      this.input.beginFrame(this.time, dt);
      this.advance(dt);
      this.input.endFrame();
      this.frame++;
    }
    this.hud.sync(this.renderer.resolution, this.renderer.framing);
  }

  /**
   * Unload the running game and start `game` in the same engine (renderer, canvas,
   * camera rig, input, audio context and debug UI stay). The old game's `dispose(ctx)`
   * runs first; then every scene object that is not engine-owned is removed and its GPU
   * resources freed, and physics (bodies, colliders, controllers, triggers, tags),
   * particles, HUD and music are cleared. Nothing advances until the new `setup()` has
   * resolved and its pipelines are compiled. Pass `camera` to switch the camera preset.
   */
  async loadGame(game: Game, options: { camera?: CameraConfig } = {}): Promise<void> {
    if (this.disposed) throw new Error('Engine.loadGame: engine was disposed');
    if (game.assets) preloadModels(game.assets);
    this.ready = false;
    this.unloadGame();
    this._game = game;
    await game.setup(this.context);
    if (options.camera) {
      this.startCamera = { ...options.camera, preset: options.camera.preset ?? 'iso' };
      this.setCamera(this.startCamera);
    }
    this.camera.teleport(game.cameraTarget(this.context));
    this.updateView(0);
    // Compile the new level's pipelines with the loop stopped: precompile renders into the
    // pixel pass's MRT target, and a frame drawn meanwhile would build the output pipeline
    // against that target (invalid on WebGPU, GL errors on WebGL 2).
    this.renderer.setAnimationLoop(null);
    try {
      await this.renderer.precompile();
    } finally {
      if (!this.disposed) this.renderer.setAnimationLoop((t) => this.tick(t));
    }
    this.ready = true;
  }

  /** Stop the loop and free everything: game, scene, physics, audio, input listeners, DOM, GPU. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ready = false;
    this.unloadGame();
    this.particles.dispose();
    this.hud.dispose();
    this.audio.dispose();
    this.debug?.root.remove();
    this.touch?.root.remove();
    this.input.dispose();
    this.physics.dispose();
    this.renderer.dispose();
  }

  private unloadGame(): void {
    this.game.dispose?.(this.context);
    this.audio.stopMusic();
    this.particles.clear();
    this.hud.clear();
    clearScene(this.scene);
    this.physics.clear();
    this.input.reset();
  }

  private tick(timeMs: number): void {
    // Frame cap: skip whole display frames (the next run sees the full elapsed dt, and the
    // fixed-step physics accumulator catches up exactly).
    if (!this.limiter.shouldRun(timeMs)) return;
    const t = timeMs / 1000;
    const dt = this.lastTime < 0 ? 1 / 60 : Math.min(t - this.lastTime, 0.1);
    this.lastTime = t;
    if (this.manual) return;
    const running = this.ready && !this.paused;
    if (running) this.time += dt; // game time stops while paused or loading
    this.measure(timeMs);
    this.input.beginFrame(this.time, dt);
    if (!running) this.input.clearQueued(); // presses made during a pause never fire later

    this.handleDebugKeys();
    this.input.wantsPointerLock = this.camera.preset === 'first' || (this.camera instanceof FreeRig && !this.camera.fixed);
    this.audio.update();

    if (running) this.advance(dt);
    this.renderer.render();
    this.hud.sync(this.renderer.resolution, this.renderer.framing);
    // The status line is only built while the panel is on screen.
    if (running && this.debug?.visible) this.debug.update(this.game.status?.(this.context) ?? '');
    this.input.endFrame();
    this.frame++;
  }

  private handleDebugKeys(): void {
    const k = this.debugKeys;
    const hit = (codes: readonly string[]) => codes.length > 0 && this.input.wasPressed(...codes);
    if (hit(k.mode)) this.toggleMode();
    if (hit(k.resolution)) this.toggleResolution();
    if (hit(k.debug)) {
      if (this.debug) this.debug.toggle();
      else this.debug = new DebugUI(this); // created on demand (off by default in production)
    }
    if (hit(k.nextLook)) this.cycleLook(1);
    if (hit(k.prevLook)) this.cycleLook(-1);
    if (hit(k.mute)) this.audio.toggleMute();
  }

  /** Rendered-fps counter, and the one-shot `auto` quality check a few seconds in. */
  private measure(now: number): void {
    if (this.fpsSince < 0) this.fpsSince = now;
    this.fpsFrames++;
    if (now - this.fpsSince >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsSince));
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
    const a = this.autoQuality;
    if (!a) return;
    if (a.start < 0) a.start = now + 1500; // skip start-up hitches (first compiles, uploads)
    if (now < a.start) return;
    a.frames++;
    if (now - a.start < 3000) return;
    const fps = (a.frames * 1000) / (now - a.start);
    const next = qualityForFps(this._quality, fps, this.maxFps > 0 ? this.maxFps : 60);
    if (next !== this._quality) {
      console.info(`[engine] ${fps.toFixed(1)} fps at start-up: quality ${this._quality} → ${next}`);
      this.setQuality(next);
    }
    this.autoQuality = null;
  }

  /** One frame of simulation, game logic, camera and light (no drawing). */
  private advance(dt: number): void {
    const ctx = this.context;
    this.physics.update(dt, this.fixedStep);
    this.game.update?.(ctx, dt);
    this.particles.update(dt);
    this.updateView(dt);
  }

  /** Camera follow + shadow box for the current game state. */
  private updateView(dt: number): void {
    const ctx = this.context;
    const u = this.cameraUpdate;
    u.target.copy(this.game.cameraTarget(ctx));
    if (this.game.eyePosition) this.eye.copy(this.game.eyePosition(ctx));
    else this.eye.copy(u.target).setY(u.target.y + 0.7);
    u.dt = dt;
    u.resolution = this.renderer.resolution;
    this.camera.update(u);
    this.updateShadow();
  }

  private readonly fixedStep = (fixedDt: number) => this.game.fixedUpdate?.(this.context, fixedDt);

  /**
   * Fit the sun's shadow box to what the camera sees: ortho presets cover the visible
   * ground (so zooming out keeps shadows), perspective presets cover a box reaching ahead
   * of the camera. The box moves in whole shadow texels so shadow edges don't crawl while
   * the camera follows the player.
   */
  private updateShadow(): void {
    const cam = this.camera.camera;
    const center = this.tmp;
    let radius: number;
    if (isPerspective(cam)) {
      radius = 18;
      // Ahead of the camera on the ground plane, at the followed target's height.
      cam.getWorldDirection(center).setY(0);
      if (center.lengthSq() < 1e-6) center.set(0, 0, -1);
      center.normalize().multiplyScalar(radius * 0.6).add(cam.position).setY(this.camera.focus.y);
    } else {
      const o = cam as OrthographicCamera;
      const viewW = (o.right - o.left) / o.zoom;
      const viewH = (o.top - o.bottom) / o.zoom;
      // The view's ground footprint is stretched by 1/sin(pitch) in depth.
      const sinPitch = Math.abs(cam.getWorldDirection(center).y);
      radius = 0.5 * Math.max(viewW, viewH / Math.max(sinPitch, 0.35)) + 2;
      center.copy(this.camera.focus);
    }
    radius = Math.ceil(radius); // only changes on zoom, not every frame
    const sc = this.sun.shadow.camera;
    if (radius !== this.shadowRadius) {
      this.shadowRadius = radius;
      sc.left = sc.bottom = -radius;
      sc.right = sc.top = radius;
      sc.near = 1;
      sc.far = 2 * (radius + 16);
      sc.updateProjectionMatrix();
    }
    const texel = (2 * radius) / this.sun.shadow.mapSize.x;
    this.shadowTexelDepth.value = texel / (sc.far - sc.near);
    const r = snapToGrid(center.dot(this.sunRight), texel);
    const u = snapToGrid(center.dot(this.sunUp), texel);
    const d = center.dot(this.sunDirection);
    this.sunFocus.copy(this.sunRight).multiplyScalar(r).addScaledVector(this.sunUp, u).addScaledVector(this.sunDirection, d);
    this.sun.target.position.copy(this.sunFocus);
    this.sun.position.copy(this.sunFocus).addScaledVector(this.sunDirection, radius + 16);
  }
}

/** Camera rays pass through the player and anything tagged `noCamera`. */
const CAMERA_IGNORE = ['character', 'noCamera'];

/** Debug panel default: on in dev builds or with ?debug=1, off in production. */
function defaultDebugUI(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}
