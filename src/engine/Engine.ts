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
import { Input, type InputFrame, type SnapshotMemory } from './input';
import { clearScene } from './lifecycle';
import { LoadingScreen } from './LoadingScreen';
import { Particles } from './particles/Particles';
import { type TouchButton, TouchControls } from './TouchControls';
import { PALETTE } from './palette';
import { Physics } from './physics/Physics';
import { FrameLimiter, QUALITY, QUALITY_LEVELS, type QualityLevel, type QualityOption, defaultQuality, qualityForFps } from './quality';
import { FILTER_IDS, getFilter } from './render/filters';
import { type Look, LOOK_PRESETS, lookPresetName, lookPresetOf } from './render/look';
import { LightPool } from './render/lights';
import { type EdgeSettings, PixelRenderer, type RenderMode } from './render/PixelRenderer';
import { ENGINE_VERSION } from './version';
import { GameClock } from './clock';
import { hashString, Rng } from './random';
import { MAX_FRAMES, type Recording, recordingProblem } from './replay';
import { CameraShake } from './shake';
import { Tweens } from './tween';
import type { ScreenFx } from './render/screenFx';

/** A replayed frame polls no gamepads: their buttons and stick were recorded as keys and axes. */
const NO_PADS: readonly null[] = [];
/** Matches no frame: the next frame records held keys, pointer and gamepad in full. */
const FULL_FRAME: SnapshotMemory = { held: '-', pointer: '-' };

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
  /**
   * This level's seeded randomness (src/engine/random.ts): the same engine seed and game give
   * the same numbers. Use it (or forks of it) for everything random; never Math.random.
   */
  readonly random: Rng;
  /** Sound effects, music, volumes (src/engine/audio). */
  readonly audio: AudioManager;
  /** Pixel particles: `particles.burst('dust', at)` (src/engine/particles). */
  readonly particles: Particles;
  /** Pixel HUD text and icons in art pixels (src/engine/hud). */
  readonly hud: Hud;
  /**
   * Dynamic point lights: `lights.request({ position, color, intensity, radius, flicker })`
   * (src/engine/render/lights.ts). A fixed pool sized by quality, created on first use.
   */
  readonly lights: LightPool;
  /**
   * Tweens on game time: `tweens.to(door.position, { y: 3 }, { duration: 0.8, ease: 'outBack' })`
   * (src/engine/tween.ts). Cleared when the level unloads.
   */
  readonly tweens: Tweens;
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
   * `resolution`, letterboxed. `fill`: adjusts both art dimensions to cover the viewport
   * at an integer scale, without black borders or stretched pixels.
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
  /**
   * A full look: pixel art or clean rendering and filters per layer (characters & objects,
   * environment) plus whole-scene filters (render/look.ts). Wins over `filters` and `edges`.
   */
  look?: Look;
  /** Debug/test only: use WebGPURenderer's WebGL 2 backend without trying WebGPU. */
  forceWebGL?: boolean;
  /**
   * Seed for `ctx.random`: each level gets its own stream from this and the game's name, so
   * the same seed replays the same game. Default 1. `?seed=` in the URL.
   */
  seed?: number;
  /**
   * Frames of input the engine keeps for each level (`recording()`). Default `MAX_FRAMES`, an
   * hour at 60 fps (up to some 20 MB of JSON with the mouse moving all the time); 0 records nothing.
   */
  record?: number;
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
  /**
   * The touch top bar of engine tools (⚙ debug panel, P, R, ◐ looks, ♪ mute). Default true; a
   * game that ships to phones sets false, and the bar then shows only with the debug UI
   * (`?debug=1`, dev builds).
   */
  touchBar?: boolean;
  background?: number;
}

/**
 * Read engine options from the URL:
 *   ?backend=webgl  ?mode=raw  ?res=320  ?debug=1|0
 *   ?aspect=fixed|adaptive  ?fps=30 (0 = uncapped)  ?quality=low|medium|high|auto
 *   ?camera=iso|topdown|side|third|first|free|fixed  ?zoom=1.5
 *   ?cam=<JSON CameraConfig>   (e.g. the config printed by the free camera)
 *   ?filters=crt,lcd  or  ?look=handheld (a LOOK_PRESETS name, e.g. pixel_heroes)
 */
export function optionsFromUrl(search = location.search): Partial<EngineOptions> {
  const p = new URLSearchParams(search);
  const opts: Partial<EngineOptions> = {};
  if (p.get('backend') === 'webgl') opts.forceWebGL = true;
  const seed = p.get('seed');
  if (seed && /^\d+$/.test(seed)) opts.seed = Number(seed) >>> 0;
  if (p.get('mode') === 'raw') opts.mode = 'raw';
  if (p.get('res') === '320') opts.resolution = RESOLUTIONS.compare;
  if (p.get('debug') === '0') opts.debugUI = false;
  if (p.get('debug') === '1') opts.debugUI = true;
  if (p.get('touch') === '1') opts.touch = true;
  if (p.get('touch') === '0') opts.touch = false;
  const aspect = p.get('aspect');
  if (aspect === 'fixed' || aspect === 'adaptive' || aspect === 'fill') opts.aspect = aspect;
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
  const named = look ? lookPresetName(look) : null;
  if (named) opts.look = LOOK_PRESETS[named];
  const filters = p.get('filters');
  if (filters) {
    opts.filters = filters.split(',').filter((id) => getFilter(id));
    delete opts.look; // ?filters= wins, as it always did
  }
  return opts;
}

/**
 * A game's own options with the review flags from the page URL (optionsFromUrl) on top:
 * `Engine.start(game, withUrlOptions({ container, camera: { preset: 'side', zoom: 1.2 } }))`.
 * The camera is merged key by key (`?zoom=1.5` keeps the game's `side` preset), and
 * `?filters=` replaces the game's look (a look would win over filters otherwise).
 */
export function withUrlOptions(options: EngineOptions, search = location.search): EngineOptions {
  const url = optionsFromUrl(search);
  const merged: EngineOptions = { ...options, ...url };
  if (options.camera || url.camera) merged.camera = { ...options.camera, ...url.camera };
  if (url.filters) delete merged.look;
  return merged;
}

export class Engine {
  /** The engine's version (package.json). */
  static readonly version = ENGINE_VERSION;
  /**
   * Errors thrown by the game's hooks while the render loop ran, each message once, oldest
   * first (at most 20). They are logged to the console and shown in a box on screen; the
   * frame keeps rendering so the picture stays up. Fix the first one first. (`step()` throws
   * a hook's error to its caller instead: it is for tools.)
   */
  readonly errors: string[] = [];
  readonly input = new Input();
  readonly sun: DirectionalLight;
  readonly ambient: AmbientLight;
  readonly context: GameContext;
  readonly audio = new AudioManager();
  readonly particles: Particles;
  readonly hud: Hud;
  /** Tweens on game time (`ctx.tweens`). */
  readonly tweens = new Tweens();
  /**
   * Screen shake (trauma 0..1): `engine.shake.add(0.4)`. Added to the camera after the rig
   * placed it, on real time; ortho cameras move by whole art pixels. Reset on level unload.
   */
  readonly shake = new CameraShake();
  /** Game time from real time: the speed and hitstops (`timeScale`, `hitstop()`). */
  private readonly clock = new GameClock();
  debug: DebugUI | null = null;
  touch: TouchControls | null = null;
  /** The dynamic light pool, created on first use of `ctx.lights` / `engine.lights`. */
  private _lights: LightPool | null = null;
  /** Active engine hotkeys (from EngineOptions.debugKeys). */
  debugKeys: DebugKeyMap = resolveDebugKeys();
  private _game: Game;
  private _paused = false;
  /** False while a game's setup() is running (start, loadGame): nothing advances. */
  private ready = false;
  private disposed = false;
  /** Incremented by every loadGame() and by dispose(): a load that is no longer the latest stops. */
  private loadToken = 0;
  /** The load in flight (loads run one at a time), if any. */
  private loading: Promise<void> | null = null;
  /** What a level may change and the next level starts from again (see unloadGame). */
  private defaults!: { background: Scene['background']; sun: [number, number]; ambient: [number, number] };
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
  private readonly sunDirection = new Vector3().copy(DEFAULT_SUN);
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
    const random = () => this._random;
    const rig = () => this.camera;
    const lights = () => this.lights;
    this.particles = new Particles(() => ({ camera: this.camera.camera, focus: this.camera.focus, height: this.renderer.resolution.height }));
    this.hud = new Hud(renderer.container);
    renderer.onError = (e) => this.reportError(e); // a view or mirror that throws: on screen, in errors
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
      get random() {
        return random();
      },
      audio: this.audio,
      particles: this.particles,
      hud: this.hud,
      get lights() {
        return lights();
      },
      tweens: this.tweens,
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
    this._seed = options.seed !== undefined && Number.isFinite(options.seed) ? options.seed >>> 0 : 1;
    this.recordLimit = Math.max(0, Math.min(MAX_FRAMES, Math.floor(options.record ?? MAX_FRAMES))) || 0;
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

  /**
   * The dynamic light pool (render/lights.ts), engine-owned: its lights stay in the scene
   * across levels, so loading another level never changes the light count (no recompiles).
   * Created on first use; sized by quality.
   */
  get lights(): LightPool {
    if (!this._lights) {
      this._lights = new LightPool({ size: QUALITY[this._quality].lights, parent: this.scene });
      this._lights.group.userData.engineOwned = true;
    }
    return this._lights;
  }

  /**
   * Game speed: 1 normal, 0.25 slow motion, 2 double, 0 frozen (a menu: key presses made
   * meanwhile are dropped, like a pause). Scales game time, physics, animation, particles,
   * tweens and the camera follow; not transitions, shake or the render loop. Back to 1 when a
   * level unloads. Values that aren't numbers are ignored.
   */
  get timeScale(): number {
    return this.clock.scale;
  }

  set timeScale(v: number) {
    this.clock.scale = v;
  }

  /**
   * Freeze the game for `seconds` of real time: impact frames that sell a hit. Rendering,
   * screen shake and transitions keep going; overlapping hitstops keep the longest. Key
   * presses made during a hitstop still count afterwards (a buffered jump).
   */
  hitstop(seconds: number): void {
    this.clock.freeze(seconds);
  }

  /** Transitions, flashes and shockwaves (render/screenFx.ts): `await engine.screen.cover('iris')`. */
  get screen(): ScreenFx {
    return this.renderer.screen;
  }

  /** The direction sunlight comes from (unit, pointing at the sun). */
  get sunDir(): Vector3 {
    return this.sunDirection.clone();
  }

  /**
   * Point the sun (and its shadows): a direction toward the sun, normalised here. A level's
   * time of day or a sun dial; reset to the engine default when the level unloads. Below the
   * horizon the sun is kept just above it (lower `sun.intensity` for night instead).
   */
  setSunDirection(dir: Vector3 | readonly [number, number, number]): void {
    const d = dir instanceof Vector3 ? this.tmp.copy(dir) : this.tmp.set(dir[0], dir[1], dir[2]);
    if (d.lengthSq() < 1e-8) return;
    d.normalize();
    d.y = Math.max(d.y, 0.05);
    this.sunDirection.copy(d.normalize());
    // the light-space axes for texel snapping (degenerate straight up: any horizontal axis)
    this.sunRight.crossVectors(UP, this.sunDirection);
    if (this.sunRight.lengthSq() < 1e-8) this.sunRight.set(1, 0, 0);
    this.sunRight.normalize();
    this.sunUp.crossVectors(this.sunDirection, this.sunRight).normalize();
    this.shadowRadius = 0;
  }

  /** The quality level in use (see `EngineOptions.quality`). */
  get quality(): QualityLevel {
    return this._quality;
  }

  setQuality(level: QualityLevel): void {
    this._quality = level;
    this.sun.shadow.mapSize.setScalar(QUALITY[level].shadowMapSize); // the shadow map resizes itself
    this.shadowRadius = 0; // re-fit (texel snapping depends on the map size)
    this._lights?.resize(QUALITY[level].lights); // one recompile of lit materials
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
          look: options.look,
          forceWebGL: options.forceWebGL,
        }).finally(() => (done.renderer = true)),
        Physics.create().finally(() => (done.physics = true)),
      ]);
      const engine = new Engine(game, renderer, physics, camera, scene, options);
      engine.startCamera = { ...options.camera, preset: camera.preset };
      scene.background = new Color(options.background ?? PALETTE.night);
      engine.defaults = {
        background: scene.background,
        sun: [engine.sun.color.getHex(), engine.sun.intensity],
        ambient: [engine.ambient.color.getHex(), engine.ambient.intensity],
      };
      camera.setAspect(renderer.resolution.width / renderer.resolution.height);

      engine.input.attachPointer(renderer.renderer.domElement);
      engine.wireRig(camera);
      engine.debugKeys = resolveDebugKeys(options.debugKeys);

      engine.reseed(game);
      await game.setup(engine.context);
      done.setup = true;
      loading?.set(progress(), 'COMPILING');
      camera.teleport(game.cameraTarget(engine.context));
      engine.updateView(0); // place camera + shadow box before compiling and the first frame
      await renderer.precompile();
      engine.becomeReady();
      engine.finishStart(container, options);
      loading?.set(1);
      // The handle tests, tools and agents read: window.__PIXEL_ENGINE__.state()
      (globalThis as { __PIXEL_ENGINE__?: Engine }).__PIXEL_ENGINE__ = engine;
      return engine;
    } catch (e) {
      // Starting failed (a game's setup threw, no GPU at all...): say so on screen too.
      if (!container.querySelector('.fatal')) {
        const el = document.createElement('div');
        el.className = 'fatal';
        el.textContent = `Failed to start: ${e instanceof Error ? e.message : String(e)}`;
        container.appendChild(el);
      }
      throw e;
    } finally {
      clearInterval(ticker);
      loading?.done();
    }
  }

  /** Debug panel, touch controls, then the render loop. */
  private finishStart(container: HTMLElement, options: EngineOptions): void {
    const debug = options.debugUI ?? defaultDebugUI();
    if (debug) this.debug = new DebugUI(this);
    if (options.touch ?? TouchControls.wanted()) {
      const k = this.debugKeys;
      const bar: TouchButton[] = !(options.touchBar ?? true) && !debug ? [] : [
        { label: '⚙', code: k.debug[0] ?? '' },
        { label: 'P', code: k.mode[0] ?? '' },
        { label: 'R', code: k.resolution[0] ?? '' },
        { label: '◐', code: k.nextLook[0] ?? '' },
        { label: '♪', code: k.mute[0] ?? '' },
      ];
      this.touch = new TouchControls(container, this.input, options.touchButtons, bar.filter((b) => b.code));
      if (this.debug?.visible) this.debug.toggle(); // small screens: panel behind the ⚙ button
    }
    this.renderer.setAnimationLoop(this.loop);
  }

  /**
   * Swap the camera preset mid-game (review tool: presets are a per-game choice). The
   * player, physics and the rest of the world are left exactly as they are. `free` and
   * `fixed` without an explicit position start from the view currently on screen.
   * Keeps `?camera=` in the URL in sync so a reload restores the preset; a game that swaps
   * presets as part of play (a side-scroller stage, a first-person hall, a photo mode) passes
   * `{ syncUrl: false }` so a reload still starts with its own camera.
   */
  setCamera(config: CameraConfig, options: { syncUrl?: boolean } = {}): CameraRig {
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
    if (options.syncUrl === false) return rig;
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

  /** The current look (a copy): per-layer pixel art and filters, whole-scene filters. */
  get look(): Look {
    return this.renderer.look;
  }

  /** Every named look (LOOK_PRESETS): `engine.setLook(engine.lookPresets.pixel_heroes)`. */
  get lookPresets(): Readonly<Record<string, Look>> {
    return LOOK_PRESETS;
  }

  /** Apply a look (render/look.ts); `LOOK_PRESETS` has named ones. */
  setLook(look: Look): void {
    this.renderer.setLook(look);
  }

  /** Cycle through LOOK_PRESETS ([ and ] keys). */
  cycleLook(step: 1 | -1): string {
    const names = Object.keys(LOOK_PRESETS);
    const name = lookPresetOf(this.renderer.look);
    const current = name ? names.indexOf(name) : -1;
    const next = names[(current + step + names.length) % names.length]!;
    this.renderer.setLook(LOOK_PRESETS[next]!);
    return next;
  }

  /** Snapshot for tests, tooling and agents. */
  state() {
    const r = this.renderer;
    const target = this.ready ? this.game.cameraTarget(this.context) : this.camera.focus;
    return {
      version: ENGINE_VERSION,
      game: this.game.name,
      seed: this.seed,
      ready: this.ready,
      paused: this.paused,
      time: this.time,
      timeScale: this.timeScale,
      hitstop: +this.clock.hitstop.toFixed(3),
      screen: this.renderer.screen.state(),
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
      /** Errors the game's hooks threw in the render loop (each once; also on screen). */
      errors: [...this.errors],
      target: target.toArray(),
      camera: this.camera.camera.position.toArray(),
      cameraRig: this.camera.describe(),
      /** Visible world extents of an orthographic camera (what's in frame). */
      view:
        this.camera instanceof OrthoRig
          ? (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(this.camera.camera)
          : null,
      filters: [...r.filters],
      /** The look preset in use, or `custom`; `split` when layers render as two passes. */
      look: lookPresetOf(r.look) ?? 'custom',
      split: r.split,
      status: this.game.status?.(this.context) ?? '',
    };
  }

  /**
   * Tooling: switch to manual time and advance `n` frames of `dt` seconds (simulation,
   * animation, camera). Nothing is drawn; call `renderer.capture()` to see the result.
   */
  step(n = 1, dt = 1 / 60): void {
    this.manual = true;
    for (let i = 0; i < n && this.ready; i++) this.frameStep(dt);
    this.hud.sync(this.renderer.resolution, this.renderer.framing);
  }

  /**
   * One manual frame (`step()`), its input live or from a recorded frame (`replay()`). A game
   * hook's exception finishes the frame first, then is thrown to the caller of `step()`; in a
   * replay it is reported and the replay goes on, as in live play (`tick()`).
   */
  private frameStep(dt: number, play?: InputFrame): void {
    const gameDt = this.clock.delta(dt);
    this.time += gameDt;
    if (play) this.input.playBefore(play);
    this.input.beginFrame(this.time, gameDt, play ? NO_PADS : undefined);
    if (play) this.input.playAfter(play);
    if (this.clock.frozen) this.input.clearQueued(); // speed 0 is a pause: nothing queued fires later
    this.record(dt);
    let thrown: { error: unknown } | null = null;
    try {
      this.advance(gameDt, dt);
    } catch (e) {
      if (play) this.reportError(e);
      else thrown = { error: e };
    }
    this.renderer.screen.update(dt, this.camera.camera);
    this.endFrame();
    if (thrown) throw thrown.error;
  }

  /** The end of every frame: input's per-frame state goes, and a marker notes when promise callbacks run. */
  private endFrame(): void {
    this.input.endFrame();
    this.frame++;
    this.drained = false;
    queueMicrotask(this.markDrained);
  }

  /**
   * Unload the running game and start `game` in the same engine (renderer, canvas,
   * camera rig, input, audio context and debug UI stay).
   *
   * Safe to call from anywhere, including a game's own hooks (a level door in `update`,
   * `fixedUpdate` or a trigger's `onEnter`): the swap waits for the current frame to end.
   * Loads run one at a time, and only the latest one wins: a newer `loadGame()` (or
   * `dispose()`) makes an older one stop after its `setup()`, and the newer one unloads
   * whatever it built. The returned promise resolves when the level runs (or was superseded).
   *
   * Unloading calls the old game's `dispose(ctx)`, removes every scene object that is not
   * engine-owned and frees its GPU resources, clears physics (bodies, colliders, joints,
   * controllers, triggers, tags, movers, force fields, belts; gravity and the solver back to
   * their defaults), particles, HUD and music, and resets the scene background, fog and the
   * sun / ambient light to the engine defaults. Filters, render
   * mode, resolution, quality, volumes and the camera rig carry over; pass `camera` to
   * switch the preset (applied before `setup()`, so `ctx.camera` is already the new one).
   * Nothing advances while loading, and input made while loading is dropped.
   */
  async loadGame(game: Game, options: { camera?: CameraConfig } = {}): Promise<void> {
    if (this.disposed) throw new Error('Engine.loadGame: engine was disposed');
    const token = ++this.loadToken;
    const live = () => token === this.loadToken && !this.disposed;
    const previous = this.loading;
    const run = (async () => {
      if (previous) await previous.catch(() => {}); // one load at a time
      await Promise.resolve(); // never swap in the middle of a frame (called from a game hook)
      if (!live()) return;
      if (game.assets) preloadModels(game.assets);
      this.ready = false;
      this.unloadGame();
      this._game = game;
      if (options.camera) this.useCamera(options.camera);
      this.reseed(game);
      await game.setup(this.context);
      if (!live()) return; // superseded: the newer load (or dispose) unloads what setup built
      this.camera.teleport(game.cameraTarget(this.context));
      this.updateView(0);
      // Compile the new level's pipelines with the loop stopped: precompile renders into the
      // pixel pass's MRT target, and a frame drawn meanwhile would build the output pipeline
      // against that target (invalid on WebGPU, GL errors on WebGL 2).
      this.renderer.setAnimationLoop(null);
      try {
        await this.renderer.precompile();
      } finally {
        // A newer load stops and restarts the loop itself; a disposed engine has none.
        if (!this.disposed) this.renderer.setAnimationLoop(this.loop);
      }
      if (!live()) return;
      this.becomeReady();
    })();
    this.loading = run;
    try {
      await run;
    } finally {
      if (this.loading === run) this.loading = null;
    }
  }

  /**
   * Stop the loop and free everything: game, scene, physics, audio, input listeners, DOM,
   * GPU. With a `loadGame()` in flight, the world and GPU resources are freed once its
   * `setup()` has finished (it never runs against a freed physics world or renderer).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken++;
    const g = globalThis as { __PIXEL_ENGINE__?: Engine };
    if (g.__PIXEL_ENGINE__ === this) delete g.__PIXEL_ENGINE__; // don't keep a disposed engine alive
    this.renderer.setAnimationLoop(null);
    this.ready = false;
    this.audio.dispose();
    this.debug?.root.remove();
    this.touch?.root.remove();
    this.input.dispose();
    const free = () => {
      this.unloadGame();
      this.particles.dispose();
      this.hud.dispose();
      this.physics.dispose();
      this.renderer.dispose();
    };
    if (this.loading) void this.loading.then(free, free);
    else free();
  }

  /** Switch the camera preset for a level that is loading (no game hooks, no URL sync). */
  private useCamera(config: CameraConfig): void {
    this.startCamera = { ...config, preset: config.preset ?? 'iso' };
    const rig = createCameraRig(this.startCamera);
    rig.setAspect(this.renderer.resolution.width / this.renderer.resolution.height);
    rig.focus.copy(this.camera.focus);
    this.renderer.setCamera(rig.camera);
    this.camera = rig;
    this.wireRig(rig);
  }

  /** Start running the game: nothing pressed or timed while loading carries over. */
  private becomeReady(): void {
    this.input.clearQueued();
    this.input.endFrame();
    this.input.now = this.time; // a press before the first frame queues at the level's start
    this.lastTime = -1; // the first frame is 1/60 s, not a 0.1 s catch-up
    this.ready = true;
  }

  private readonly loop = (t: number) => this.tick(t);

  /** The seed every level's `ctx.random` comes from (`EngineOptions.seed`, `?seed=`; a replay sets it). */
  get seed(): number {
    return this._seed;
  }
  private _seed: number;
  private _random = new Rng(1);
  /** The running level's recording (from its start), and whether a replay is driving the frames. */
  private rec: { game: string; seed: number; time: number; frames: InputFrame[]; last: SnapshotMemory; truncated: boolean } | null = null;
  private replaying = false;
  private readonly recordLimit: number;
  /** Whether promise callbacks (microtasks) ran since the last frame ended (`InputFrame.sync`). */
  private drained = true;
  private readonly markDrained = () => {
    this.drained = true;
  };

  /** This level's seeded randomness (`ctx.random`). */
  get random(): Rng {
    return this._random;
  }

  /** A fresh stream for `game`, before its setup: the same seed and game give the same numbers. */
  private reseed(game: Game): void {
    this._random = new Rng(hashString(`${this._seed}:${game.name}`));
    this.particles.reseed(this._random.fork('particles'));
    this.rec = { game: game.name, seed: this._seed, time: this.time, frames: [], last: { ...FULL_FRAME }, truncated: false };
  }

  /** Keep this frame's input in the level's recording (live play and `step()`, not replays). */
  private record(dt: number): void {
    const r = this.rec;
    if (!r || this.replaying) return;
    if (r.frames.length >= this.recordLimit) {
      r.truncated = true;
      return;
    }
    const f = this.input.snapshot(dt, r.last);
    if (!this.drained) f.sync = true;
    r.frames.push(f);
  }

  /**
   * The running level's recording: its seed, when it began and every frame's input since
   * (src/engine/replay.ts). Plain JSON: save it, attach it to a bug, replay it with `replay()`.
   */
  recording(): Recording | null {
    const r = this.rec;
    if (!r) return null;
    return { format: 1, engine: ENGINE_VERSION, game: r.game, seed: r.seed, time: r.time, frames: [...r.frames], ...(r.truncated ? { truncated: true } : {}) };
  }

  /**
   * Play a recording back: its seed and start time are restored, `start` loads the level it was
   * made in (e.g. `() => engine.loadGame(new MyGame())`; it must not wait on frames, so load
   * without a transition), then every frame runs with the recorded input, in manual time
   * (`step()`), waiting for promise callbacks wherever the recorded run did. `frames` stops
   * early. Afterwards the level is where the recorded one was (`fingerprint()` matches if the
   * game is deterministic) and stays in manual time: `step()` plays on from there, live, and
   * the level's recording carries on from it. Live input is ignored during a replay; afterwards
   * nothing the recording held stays held. A game hook's exception is reported and the replay
   * goes on, as in live play.
   */
  async replay(rec: Recording, start: () => unknown, o: { frames?: number } = {}): Promise<void> {
    const problem = recordingProblem(rec);
    if (problem) throw new Error(`Engine.replay: ${problem}`);
    this.manual = true; // nothing advances on its own while the level loads
    this._seed = rec.seed;
    this.time = rec.time;
    const slow = setTimeout(() => console.warn('[engine] replay: start() has not finished after 10 s; nothing advances during a replay, so it must not wait on frames (load without a transition)'), 10_000);
    try {
      await start();
    } finally {
      clearTimeout(slow);
    }
    if (this.game.name !== rec.game) console.warn(`[engine] replaying a recording of "${rec.game}" in "${this.game.name}"`);
    const n = Math.max(0, Math.min(Math.floor(o.frames ?? Infinity), rec.frames.length));
    // promise callbacks run between frames where they did in the recorded run: a task boundary
    // (not just a microtask) so chains of them finish, as they do between two animation frames
    const channel = new MessageChannel();
    let wake = () => {};
    channel.port1.onmessage = () => wake();
    const settle = () => new Promise<void>((resolve) => ((wake = resolve), channel.port2.postMessage(0)));
    let played = 0;
    const level = this.rec;
    this.replaying = true;
    this.input.playing = true;
    try {
      for (; played < n && this.ready; played++) {
        const f = rec.frames[played]!;
        if (!f.sync) await settle();
        // a promise callback loaded another level (or is loading it): its frames are not these
        if (!this.ready || this.disposed || this.rec !== level) break;
        this.frameStep(f.dt, f);
      }
    } finally {
      channel.port1.close();
      this.replaying = false;
      this.input.playing = false;
      this.input.release(); // input is live again: nothing the recording held stays held (queued presses do)
      // from here on the level's recording is the replayed one, carried on by whatever comes next
      if (level && level === this.rec) {
        level.frames = rec.frames.slice(0, played);
        level.truncated = !!rec.truncated && played === rec.frames.length;
        level.last = { ...FULL_FRAME };
      }
    }
    this.hud.sync(this.renderer.resolution, this.renderer.framing);
  }

  /**
   * A hash of the simulation: game time, every physics body (exact) and `ctx.random`'s state.
   * Two runs that should be the same (a replay) compare equal. Not the `status()` line: a
   * debug line may carry measurements (a step's milliseconds) that differ run to run.
   */
  fingerprint(): string {
    const parts = [this.time, this.physics.fingerprint(), this._random.state];
    return hashString(parts.join('|')).toString(16).padStart(8, '0');
  }

  private unloadGame(): void {
    this.game.dispose?.(this.context);
    this.audio.stopMusic();
    this.audio.stopLoops();
    this.tweens.clear();
    this.shake.reset();
    this.clock.reset();
    this.particles.clear();
    this.hud.clear();
    this._lights?.clear();
    this.renderer.clearBeforeRender(); // views and mirrors the level attached
    clearScene(this.scene);
    this.physics.clear();
    this.input.reset();
    // What levels commonly tweak goes back to the engine defaults.
    const d = this.defaults;
    if (d) {
      this.scene.background = d.background;
      this.scene.fog = null;
      (this.scene as Scene & { fogNode: Node | null }).fogNode = null; // TSL fog (Riftlight's levels)
      this.setSunDirection(DEFAULT_SUN);
      this.sun.color.setHex(d.sun[0]);
      this.sun.intensity = d.sun[1];
      this.ambient.color.setHex(d.ambient[0]);
      this.ambient.intensity = d.ambient[1];
    }
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
    const gameDt = running ? this.clock.delta(dt) : 0;
    this.time += gameDt; // game time stops while paused or loading
    this.measure(timeMs);
    this.input.beginFrame(this.time, running ? gameDt : dt);
    // presses made during a pause (or at speed 0, a menu) never fire later
    if (!running || this.clock.frozen) this.input.clearQueued();
    if (running) this.record(dt);

    if (this.ready) this.handleDebugKeys(); // hotkeys work while paused, not while a level loads
    this.input.wantsPointerLock = this.camera.preset === 'first' || (this.camera instanceof FreeRig && !this.camera.fixed);
    this.audio.update();

    if (running) {
      try {
        this.advance(gameDt, dt);
      } catch (e) {
        this.reportError(e);
      }
    }
    if (this.disposed) return; // a game hook disposed the engine during this frame
    this.renderer.screen.update(dt, this.camera.camera); // transitions run on real time, loads included
    this.renderer.render();
    this.hud.sync(this.renderer.resolution, this.renderer.framing);
    // The status line is only built while the panel is on screen.
    if (running && this.debug?.visible) this.debug.update(this.game.status?.(this.context) ?? '');
    this.endFrame();
  }

  /** A game hook threw in the render loop: log it (once per message) and show it on screen. */
  private reportError(e: unknown): void {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    if (this.errors.includes(message) || this.errors.length >= 20) return; // a new message every frame stays bounded
    this.errors.push(message);
    console.error('[engine] game error (the frame keeps rendering):', e);
    const container = this.renderer.container;
    let box = container.querySelector<HTMLElement>('[data-engine-error]');
    if (!box) {
      box = document.createElement('div');
      box.dataset.engineError = 'true';
      box.style.cssText =
        'position:absolute;left:8px;top:8px;right:8px;z-index:50;padding:8px 10px;background:rgb(93 39 93 / 0.92);color:#fff;' +
        'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;pointer-events:none;border:2px solid #b13e53';
      container.appendChild(box);
    }
    const more = this.errors.length > 1 ? `\n(+${this.errors.length - 1} more: engine.errors, the console)` : '';
    box.textContent = `GAME ERROR: ${this.errors[0]}${more}\nFix the first one first; the console has the stack.`;
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

  /**
   * One frame of simulation, game logic, camera and light (no drawing). `dt` is game time
   * (scaled, 0 in a hitstop); `realDt` drives the screen shake.
   */
  private advance(dt: number, realDt = dt): void {
    const ctx = this.context;
    this.physics.update(dt, this.fixedStep);
    if (!this.ready) return; // a hook disposed the engine mid-frame
    this.tweens.update(dt);
    this.game.update?.(ctx, dt);
    if (!this.ready) return;
    this.particles.update(dt);
    this.cameraUpdate.shake = this.shake.update(realDt);
    this.updateView(dt);
    this._lights?.update(dt, this.camera.focus, this.lightRange());
  }

  /** How far from the camera focus a light can matter: half the view diagonal. */
  private lightRange(): number {
    const cam = this.camera.camera;
    if (cam instanceof OrthographicCamera) return 0.5 * Math.hypot(cam.right - cam.left, cam.top - cam.bottom) / cam.zoom + 2;
    return 24;
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

  private readonly fixedStep = (fixedDt: number) => {
    if (this.ready) this.game.fixedUpdate?.(this.context, fixedDt);
  };

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
const UP = new Vector3(0, 1, 0);
/** Where sunlight comes from unless a level points it elsewhere (`setSunDirection`). */
const DEFAULT_SUN = new Vector3(-0.55, 1, 0.35).normalize();

/** Debug panel default: on in dev builds or with ?debug=1, off in production. */
function defaultDebugUI(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}
