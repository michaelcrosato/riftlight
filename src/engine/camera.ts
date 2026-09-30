import { type Camera, MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { type Resolution, snapToGrid, worldUnitsPerPixel } from './framing';
import type { Input } from './input';

/**
 * Camera presets. A game picks ONE at startup (EngineOptions.camera / `?camera=`). For
 * reviewing, `engine.setCamera()` swaps presets live without touching the world. `free`
 * is an authoring tool: fly around, press Enter to fix the view, and paste the printed
 * `fixed` config into your game.
 */
export type CameraPreset = 'iso' | 'topdown' | 'side' | 'third' | 'first' | 'free' | 'fixed';

export const CAMERA_PRESETS: readonly CameraPreset[] = ['iso', 'topdown', 'side', 'third', 'first', 'free', 'fixed'];

export interface CameraConfig {
  preset?: CameraPreset;
  /** Zoom factor, 1 = preset default, >1 = closer. Ignored by `first`. */
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Ortho presets: visible world height at zoom 1. */
  viewHeight?: number;
  /** iso: degrees below horizon / around Y. */
  pitch?: number;
  yaw?: number;
  /** Perspective presets: vertical field of view in degrees. */
  fov?: number;
  /** third: orbit distance at zoom 1. */
  distance?: number;
  /** fixed: camera position and look-at target. */
  position?: [number, number, number];
  target?: [number, number, number];
  /** fixed/free: projection. */
  projection?: 'perspective' | 'ortho';
  /** Follow smoothing; higher is snappier. */
  stiffness?: number;
}

/** What rigs may ask of the world (e.g. third-person wall avoidance). */
export interface CameraWorld {
  /** Distance from `from` along `dir` to the first obstacle, or null. */
  raycast?(from: Vector3, dir: Vector3, maxDistance: number): number | null;
}

export interface CameraUpdate {
  /** Point to follow (character center/chest). */
  target: Vector3;
  /** First-person eye point. */
  eye: Vector3;
  dt: number;
  resolution: Resolution;
  input: Input;
  world: CameraWorld;
}

const UP = new Vector3(0, 1, 0);

/** Base rig: owns the three.js camera, zoom and the ground-plane movement basis. */
export abstract class CameraRig {
  abstract readonly preset: CameraPreset;
  abstract readonly camera: OrthographicCamera | PerspectiveCamera;
  /** World point the rig is centred on (used for shadow framing). */
  readonly focus = new Vector3();
  zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Whether zoom applies (all presets except first person). */
  readonly zoomable: boolean = true;
  /** First person hides the player model. */
  readonly hidesTarget: boolean = false;
  /** Side-scroller: characters should stay on their depth lane. */
  readonly lockDepth: boolean = false;
  /** False while the free camera is flying (input drives the camera, not the player). */
  controlsCharacter = true;
  /** Pixel-snap the camera (ortho only). */
  snap = true;
  protected readonly stiffness: number;

  constructor(config: CameraConfig) {
    this.zoom = config.zoom ?? 1;
    this.minZoom = config.minZoom ?? 0.35;
    this.maxZoom = config.maxZoom ?? 4;
    this.stiffness = config.stiffness ?? 6;
  }

  setZoom(zoom: number): void {
    if (!this.zoomable) return;
    this.zoom = MathUtils.clamp(zoom, this.minZoom, this.maxZoom);
    this.applyZoom();
  }

  /** Called once after construction and whenever zoom changes. */
  protected abstract applyZoom(): void;

  /** Place the camera without smoothing. */
  teleport(target: Vector3): void {
    this.focus.copy(target);
  }

  /** Screen-relative movement basis on the ground plane. */
  groundBasis(): { right: Vector3; forward: Vector3 } {
    const m = this.camera.matrixWorld;
    const right = new Vector3().setFromMatrixColumn(m, 0).setY(0);
    let forward = new Vector3().setFromMatrixColumn(m, 2).negate().setY(0);
    if (forward.lengthSq() < 1e-6) forward = new Vector3().setFromMatrixColumn(m, 1).setY(0); // looking straight down
    return { right: right.normalize(), forward: forward.normalize() };
  }

  update(u: CameraUpdate): void {
    if (this.zoomable && u.input.wheel !== 0) this.setZoom(this.zoom * Math.pow(1.12, -u.input.wheel));
    if (this.zoomable && u.input.isDown('Equal', 'NumpadAdd')) this.setZoom(this.zoom * (1 + u.dt));
    if (this.zoomable && u.input.isDown('Minus', 'NumpadSubtract')) this.setZoom(this.zoom / (1 + u.dt));
    this.step(u);
    this.camera.updateMatrixWorld();
  }

  protected abstract step(u: CameraUpdate): void;

  /** Serializable description (debug UI, `state()`). */
  describe(): Record<string, unknown> {
    return { preset: this.preset, zoom: +this.zoom.toFixed(3), zoomable: this.zoomable };
  }

  protected follow(target: Vector3, dt: number): void {
    this.focus.lerp(target, 1 - Math.exp(-this.stiffness * dt));
  }
}

/** Orthographic presets: classic 3/4 isometric, straight top-down, straight side-on. */
export class OrthoRig extends CameraRig {
  readonly camera: OrthographicCamera;
  readonly preset: 'iso' | 'topdown' | 'side';
  override readonly lockDepth: boolean;
  readonly baseViewHeight: number;
  private readonly offset: Vector3;
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly forward = new Vector3();
  private readonly tmp = new Vector3();

  constructor(preset: 'iso' | 'topdown' | 'side', config: CameraConfig = {}) {
    super(config);
    this.preset = preset;
    this.lockDepth = preset === 'side';
    this.baseViewHeight = config.viewHeight ?? (preset === 'side' ? 11 : preset === 'topdown' ? 16 : 13.5);
    const distance = 40;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 1, distance * 2);
    if (preset === 'topdown') {
      this.offset = new Vector3(0, distance, 0);
      this.camera.up.set(0, 0, -1); // screen-up = world -Z
    } else if (preset === 'side') {
      this.offset = new Vector3(0, 0, distance);
    } else {
      const p = MathUtils.degToRad(config.pitch ?? 32);
      const y = MathUtils.degToRad(config.yaw ?? 45);
      this.offset = new Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(distance);
    }
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.forward.setFromMatrixColumn(this.camera.matrixWorld, 2);
    this.applyZoom();
  }

  get viewHeight(): number {
    return this.baseViewHeight / this.zoom;
  }

  protected applyZoom(): void {
    const h = this.viewHeight / 2;
    const aspect = 16 / 9;
    this.camera.left = -h * aspect;
    this.camera.right = h * aspect;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  protected step(u: CameraUpdate): void {
    this.follow(u.target, u.dt);
    const pos = this.tmp.copy(this.focus);
    if (this.snap) {
      const px = worldUnitsPerPixel(this.viewHeight, u.resolution);
      const r = snapToGrid(pos.dot(this.right), px);
      const up = snapToGrid(pos.dot(this.up), px);
      const f = pos.dot(this.forward);
      pos.copy(this.right).multiplyScalar(r).addScaledVector(this.up, up).addScaledVector(this.forward, f);
    }
    this.camera.position.copy(pos).add(this.offset);
  }
}

/** Over-the-shoulder orbit camera: mouse-drag or Q/E to orbit, wheel to zoom, avoids walls. */
export class ThirdPersonRig extends CameraRig {
  readonly preset = 'third' as const;
  readonly camera: PerspectiveCamera;
  yaw: number;
  pitch: number;
  private readonly baseDistance: number;
  private currentDistance: number;

  constructor(config: CameraConfig = {}) {
    super(config);
    this.snap = false;
    this.camera = new PerspectiveCamera(config.fov ?? 50, 16 / 9, 0.3, 160);
    this.baseDistance = config.distance ?? 7;
    this.currentDistance = this.baseDistance;
    this.yaw = MathUtils.degToRad(config.yaw ?? 0);
    this.pitch = MathUtils.degToRad(config.pitch ?? 20);
    this.applyZoom();
  }

  protected applyZoom(): void {
    /* distance is derived from zoom every frame */
  }

  protected step(u: CameraUpdate): void {
    const turn = (u.input.isDown('KeyE') ? 1 : 0) - (u.input.isDown('KeyQ') ? 1 : 0);
    this.yaw -= turn * 2.2 * u.dt;
    this.yaw -= u.input.mouseDelta.x * 0.005;
    this.pitch = MathUtils.clamp(this.pitch + u.input.mouseDelta.y * 0.004, -0.35, 1.3);
    this.follow(u.target, u.dt);

    const dir = new Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const want = this.baseDistance / this.zoom;
    const hit = u.world.raycast?.(this.focus, dir, want);
    const allowed = hit != null ? Math.max(0.8, hit - 0.3) : want;
    // Pull in instantly when blocked, ease back out when clear.
    this.currentDistance = allowed < this.currentDistance ? allowed : MathUtils.lerp(this.currentDistance, allowed, 1 - Math.exp(-4 * u.dt));
    this.camera.position.copy(this.focus).addScaledVector(dir, this.currentDistance);
    this.camera.lookAt(this.focus);
  }

  override describe() {
    return { ...super.describe(), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3) };
  }
}

/** Eyes of the character: mouse look (click to lock the pointer) or Q/E to turn. No zoom. */
export class FirstPersonRig extends CameraRig {
  readonly preset = 'first' as const;
  readonly camera: PerspectiveCamera;
  override readonly zoomable = false;
  override readonly hidesTarget = true;
  yaw: number;
  pitch = 0;

  constructor(config: CameraConfig = {}) {
    super({ ...config, zoom: 1 });
    this.snap = false;
    this.camera = new PerspectiveCamera(config.fov ?? 70, 16 / 9, 0.05, 160);
    this.camera.rotation.order = 'YXZ';
    this.yaw = MathUtils.degToRad(config.yaw ?? 0);
  }

  protected applyZoom(): void {}

  protected step(u: CameraUpdate): void {
    const turn = (u.input.isDown('KeyE') ? 1 : 0) - (u.input.isDown('KeyQ') ? 1 : 0);
    this.yaw -= turn * 2.4 * u.dt + u.input.mouseDelta.x * 0.0025;
    this.pitch = MathUtils.clamp(this.pitch - u.input.mouseDelta.y * 0.0025, -1.45, 1.45);
    this.focus.copy(u.target);
    this.camera.position.copy(u.eye);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  override groundBasis() {
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new Vector3().crossVectors(forward, UP).normalize();
    return { right, forward };
  }

  override describe() {
    return { ...super.describe(), yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3) };
  }
}

/**
 * Authoring camera. While flying: WASD move, Q/E down/up, drag (or click to lock) to look,
 * Shift = fast, wheel = field of view. Press Enter to fix it: the view freezes, the player
 * gets control, and `fixedConfig()` returns the config to hard-code (preset 'fixed').
 * Enter again unfixes.
 */
export class FreeRig extends CameraRig {
  readonly preset: 'free' | 'fixed';
  readonly camera: PerspectiveCamera | OrthographicCamera;
  fixed: boolean;
  yaw: number;
  pitch: number;
  private readonly baseFov: number;
  private readonly baseViewHeight: number;
  private readonly projection: 'perspective' | 'ortho';
  onFix: ((config: CameraConfig) => void) | null = null;

  constructor(preset: 'free' | 'fixed', config: CameraConfig = {}) {
    super(config);
    this.preset = preset;
    this.snap = false;
    this.projection = config.projection ?? 'perspective';
    this.baseFov = config.fov ?? 55;
    this.baseViewHeight = config.viewHeight ?? 14;
    this.camera =
      this.projection === 'ortho'
        ? new OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
        : new PerspectiveCamera(this.baseFov, 16 / 9, 0.2, 200);
    this.camera.rotation.order = 'YXZ';
    const position = new Vector3(...(config.position ?? [0, 9, 14]));
    const target = new Vector3(...(config.target ?? [0, 0, 0]));
    this.camera.position.copy(position);
    const d = target.clone().sub(position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(MathUtils.clamp(d.y, -1, 1));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.fixed = preset === 'fixed';
    this.controlsCharacter = this.fixed;
    this.applyZoom();
  }

  protected applyZoom(): void {
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.fov = MathUtils.clamp(this.baseFov / this.zoom, 10, 110);
    } else {
      const h = this.baseViewHeight / this.zoom / 2;
      Object.assign(this.camera, { left: (-h * 16) / 9, right: (h * 16) / 9, top: h, bottom: -h });
    }
    this.camera.updateProjectionMatrix();
  }

  /** Freeze (or unfreeze) the view. */
  setFixed(fixed: boolean): void {
    this.fixed = fixed;
    this.controlsCharacter = fixed;
    if (fixed) this.onFix?.(this.fixedConfig());
  }

  fixedConfig(): CameraConfig {
    const pos = this.camera.position;
    const dir = new Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const target = pos.clone().addScaledVector(dir, 10);
    const r = (v: Vector3) => v.toArray().map((n) => +n.toFixed(2)) as [number, number, number];
    return {
      preset: 'fixed',
      projection: this.projection,
      position: r(pos),
      target: r(target),
      ...(this.projection === 'ortho' ? { viewHeight: +this.baseViewHeight.toFixed(2) } : { fov: +this.baseFov.toFixed(1) }),
      zoom: +this.zoom.toFixed(3),
    };
  }

  protected step(u: CameraUpdate): void {
    this.focus.copy(u.target);
    if (this.preset === 'free' && u.input.wasPressed('Enter', 'NumpadEnter')) this.setFixed(!this.fixed);
    if (this.fixed) return;
    this.yaw -= u.input.mouseDelta.x * 0.003;
    this.pitch = MathUtils.clamp(this.pitch - u.input.mouseDelta.y * 0.003, -1.55, 1.55);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const speed = (u.input.isDown('ShiftLeft', 'ShiftRight') ? 18 : 6) * u.dt;
    const fwd = new Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const right = new Vector3(1, 0, 0).applyEuler(this.camera.rotation);
    const a = u.input.moveAxis();
    const lift = (u.input.isDown('KeyE', 'Space') ? 1 : 0) - (u.input.isDown('KeyQ', 'KeyC') ? 1 : 0);
    this.camera.position.addScaledVector(fwd, a.y * speed).addScaledVector(right, a.x * speed).addScaledVector(UP, lift * speed);
  }

  override describe() {
    return { ...super.describe(), fixed: this.fixed, config: this.fixedConfig() };
  }
}

export function createCameraRig(config: CameraConfig = {}): CameraRig {
  const preset = config.preset ?? 'iso';
  switch (preset) {
    case 'iso':
    case 'topdown':
    case 'side':
      return new OrthoRig(preset, config);
    case 'third':
      return new ThirdPersonRig(config);
    case 'first':
      return new FirstPersonRig(config);
    case 'free':
    case 'fixed':
      return new FreeRig(preset, config);
  }
}

export function isPerspective(camera: Camera): camera is PerspectiveCamera {
  return (camera as PerspectiveCamera).isPerspectiveCamera === true;
}
